'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */

function __awaiter(thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
}

typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
    var e = new Error(message);
    return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

class EchoChamber {
    constructor(serverUrl, options = {}) {
        this._connectionState = 'connecting';
        this._eventHandlers = {};
        this._messageQueue = [];
        this._pendingSubscriptions = new Set();
        this._pingInterval = null;
        this._reconnectAttempts = 0;
        this._socket = null;
        this._subscriptions = new Set();
        this._serverUrl = this._formatServerUrl(serverUrl);
        this.options = Object.assign({ autoconnect: true, maxReconnectDelay: 30000, pingInterval: 30000, reconnectDelay: 1000, reconnectMultiplier: 2, logger: (category, message, ...args) => {
                if (!this.options.log)
                    return;
                let style = "";
                const sharedStyle = "font-weight: bold; padding: 3px 5px; border-radius: 4px;";
                switch (category) {
                    case 'Client':
                        style = "background: #007CF0; color: #E1E1E1;";
                        break;
                    case 'User':
                        style = "background: #009688; color: #E1E1E1;";
                        break;
                    case 'Server':
                        style = "background: #4CAF50; color: #E1E1E1;";
                        break;
                    case 'Error':
                        style = "background: #F44336; color: #E1E1E1;";
                        break;
                    case 'Info':
                    default:
                        style = "background: #9C27B0; color: #E1E1E1;";
                        break;
                }
                console.log(`%c${category}%c: ${message}`, `${sharedStyle}${style}`, ...args);
            }, log: true }, options);
        this._boundOnOpen = this._onOpen.bind(this);
        this._boundOnMessage = this._onMessage.bind(this);
        this._boundOnError = this._onError.bind(this);
        this._boundOnClose = this._onClose.bind(this);
        if (this.options.autoconnect) {
            this.connect();
        }
    }
    get _internalConnectionState() {
        return this._connectionState;
    }
    set _internalConnectionState(connectionState) {
        this._connectionState = connectionState;
    }
    set newOptions(options) {
        this.options = Object.assign(Object.assign({}, this.options), options);
    }
    get _internalMessageQueue() {
        return this._messageQueue;
    }
    set _internalMessageQueue(messageQueue) {
        this._messageQueue = messageQueue;
    }
    get _internalSubscriptions() {
        return this._subscriptions;
    }
    set _internalSubscriptions(subscriptions) {
        this._subscriptions = subscriptions;
    }
    get _internalPendingSubscriptions() {
        return this._pendingSubscriptions;
    }
    set _internalPendingSubscriptions(pendingSubscriptions) {
        this._pendingSubscriptions = pendingSubscriptions;
    }
    get _internalSocket() {
        return this._socket;
    }
    set _internalSocket(socket) {
        this._socket = socket;
    }
    get _internalPingInterval() {
        return this._pingInterval;
    }
    set _internalPingInterval(pingInterval) {
        this._pingInterval = pingInterval;
    }
    get _internalServerUrl() {
        return this._serverUrl;
    }
    set _internalServerUrl(url) {
        this._serverUrl = url;
    }
    get _internalEventHandlers() {
        return this._eventHandlers;
    }
    set _internalEventHandlers(handlers) {
        this._eventHandlers = handlers;
    }
    log(category, message, ...args) {
        this.options.logger(category, message, ...args);
    }
    _formatServerUrl(serverUrl) {
        if (serverUrl.startsWith("/")) {
            const hostname = window.location.hostname;
            const port = window.location.port ? `:${window.location.port}` : '';
            return `wss://${hostname}${port}${serverUrl}`;
        }
        return serverUrl;
    }
    send(data) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (((_a = this._socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                this.log('Client', `Sending message: ${data.action}`, data);
                const message = JSON.stringify(data);
                this._socket.send(message);
            }
            else {
                this.log('Client', 'Queueing message', data);
                this._messageQueue.push(JSON.stringify(data));
            }
        });
    }
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            this._updateConnectionState('connecting');
            this.log('Client', 'Attempting to connect', this._serverUrl);
            if (this._socket) {
                this._socket.close();
                this._socket = null;
            }
            this._socket = new WebSocket(this._serverUrl);
            this._socket.addEventListener('open', this._boundOnOpen);
            this._socket.addEventListener('message', this._boundOnMessage);
            this._socket.addEventListener('error', this._boundOnError);
            this._socket.addEventListener('close', this._boundOnClose);
            if (this._pingInterval !== null) {
                clearInterval(this._pingInterval);
            }
            this._pingInterval = setInterval(() => this.send({ action: 'ping' }), this.options.pingInterval);
        });
    }
    connected() {
        return this._socket !== null && this._socket.readyState === WebSocket.OPEN;
    }
    disconnect() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this._pingInterval !== null) {
                clearInterval(this._pingInterval);
                this._pingInterval = null;
            }
            if (this._socket && (this._socket.readyState === WebSocket.OPEN || this._socket.readyState === WebSocket.CONNECTING)) {
                this._socket.close();
                this._socket = null;
            }
            this._updateConnectionState('closed');
            this._triggerEvent('close');
            this._messageQueue = [];
            this._subscriptions.clear();
            this._pendingSubscriptions.clear();
            this.log('Client', 'WebSocket client disconnected');
        });
    }
    _onOpen() {
        this.log('Server', 'Connection established');
        this._updateConnectionState('connected');
        this._reconnectAttempts = 0;
        this._flushQueue();
        [...this._subscriptions, ...this._pendingSubscriptions].forEach(room => this.sub(room));
        this._triggerEvent('connect');
    }
    _onMessage(event) {
        return __awaiter(this, void 0, void 0, function* () {
            let data;
            try {
                data = JSON.parse(event.data);
            }
            catch (e) {
                this.log('Error', 'Error parsing message', e);
                return;
            }
            this._triggerEvent('message', data);
            if (data.action === 'subscribed' && data.room) {
                this._subscribed(data.room);
                return;
            }
            if (data.action === 'pong') {
                this.log('Info', 'Pong received');
                return;
            }
            else {
                this.log('Server', 'Message received', event.data);
            }
            const handlers = this._eventHandlers[data.action];
            handlers.forEach(handler => handler(data));
        });
    }
    _onError(event) {
        this.log('Error', 'WebSocket error encountered', event);
        this._updateConnectionState('error');
        this._triggerEvent('error', event);
    }
    _onClose() {
        this.log('Client', 'WebSocket connection closed');
        this._updateConnectionState('closed');
        this._triggerEvent('close');
        if (this._connectionState !== 'connecting') {
            const delay = Math.min(this.options.reconnectDelay * Math.pow(this.options.reconnectMultiplier, this._reconnectAttempts), this.options.maxReconnectDelay);
            setTimeout(() => {
                if (this.options.reconnect) {
                    this.connect();
                }
            }, delay);
            this._reconnectAttempts++;
        }
    }
    _updateConnectionState(state) {
        this._connectionState = state;
        this.log('Info', `Connection state updated to ${state}`);
    }
    _flushQueue() {
        var _a;
        this._messageQueue.forEach(data => {
            var _a;
            (_a = this._socket) === null || _a === void 0 ? void 0 : _a.send(data);
            this.log('Info', 'Flushed message from queue');
        });
        if (((_a = this._socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
            this._messageQueue = [];
        }
    }
    _internalFlushQueueu() {
        this._flushQueue();
    }
    _subscribed(room) {
        if (this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.delete(room);
            this._subscriptions.add(room);
            this.log('User', `Subscription confirmed for room: ${room}`);
        }
    }
    _triggerEvent(eventType, data) {
        if (this._eventHandlers[eventType]) {
            this._eventHandlers[eventType].forEach(handler => handler(data));
        }
    }
    _internalTriggerEvent(eventType, data) {
        this._triggerEvent(eventType, data);
    }
    sub(room) {
        if (!this._subscriptions.has(room) && !this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.add(room);
            this.send({ action: 'subscribe', room });
            this.log('User', `Subscription request sent for room: ${room}`);
        }
        else {
            this.log('User', `Already subscribed or pending subscription for room: ${room}`);
        }
    }
    unsub(room) {
        if (this._subscriptions.has(room) || this._pendingSubscriptions.has(room)) {
            this._subscriptions.delete(room);
            this._pendingSubscriptions.delete(room);
            this.send({ action: 'unsubscribe', room });
            this.log('User', `Unsubscribe request sent for room: ${room}`);
        }
        else {
            this.log('User', `Attempt to unsubscribe from a room that was not subscribed: ${room}`);
        }
    }
    pub(room, payload) {
        this.send({ action: 'publish', room, payload });
        this.log('User', `User published to room: ${room}`, payload);
    }
    on(eventType, handler) {
        if (!this._eventHandlers[eventType]) {
            this._eventHandlers[eventType] = [];
        }
        this._eventHandlers[eventType].push(handler);
    }
    cleanup() {
        this._pendingSubscriptions.clear();
        if (this._pingInterval !== null) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._socket) {
            this._socket.removeEventListener('open', this._boundOnOpen);
            this._socket.removeEventListener('message', this._boundOnMessage);
            this._socket.removeEventListener('error', this._boundOnError);
            this._socket.removeEventListener('close', this._boundOnClose);
            this._socket.close();
            this._socket = null;
        }
        this._messageQueue = [];
        this._subscriptions.clear();
        this._reconnectAttempts = 0;
        this._connectionState = 'closed';
    }
}

exports.EchoChamber = EchoChamber;
//# sourceMappingURL=EchoChamber.cjs.js.map
