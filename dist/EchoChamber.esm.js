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
                let style = "";
                let textStyle = "color: #a9a9a9;";
                switch (category) {
                    case 'client':
                        style = "background: #007CF0; color: #E1E1E1;";
                        break;
                    case 'user':
                        style = "background: #009688; color: #E1E1E1;";
                        break;
                    case 'server':
                        style = "background: #4CAF50; color: #E1E1E1;";
                        break;
                    case 'error':
                        style = "background: #F44336; color: #E1E1E1;";
                        break;
                    case 'info':
                    default:
                        style = "background: #9C27B0; color: #E1E1E1;";
                        break;
                }
                console.log(`%cEchoChamber%c: ${message}`, `font-weight: bold; padding: 3px 5px; ${style} border-radius: 4px;`, textStyle, ...args);
            } }, options);
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
    connect() {
        return __awaiter(this, void 0, void 0, function* () {
            this._updateConnectionState('connecting');
            this.log('client', 'Attempting to connect', this._serverUrl);
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
            this._pingInterval = setInterval(() => this._send({ action: 'ping' }), this.options.pingInterval);
        });
    }
    connected() {
        return this._socket !== null && this._socket.readyState === WebSocket.OPEN;
    }
    disconnect() {
        if (this._pingInterval !== null) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }
        if (this._socket && (this._socket.readyState === WebSocket.OPEN || this._socket.readyState === WebSocket.CONNECTING)) {
            this._socket.close();
        }
        else {
            this._updateConnectionState('closed');
            this.triggerEvent('close');
        }
        this._messageQueue = [];
        this._subscriptions.clear();
        this._pendingSubscriptions.clear();
        this.log('client', 'WebSocket client disconnected');
    }
    _onOpen() {
        this.log('server', 'Connection established');
        this._updateConnectionState('connected');
        this._reconnectAttempts = 0;
        this._flushQueue();
        [...this._subscriptions, ...this._pendingSubscriptions].forEach(room => this.sub(room));
        this.triggerEvent('connect');
    }
    _onMessage(event) {
        return __awaiter(this, void 0, void 0, function* () {
            let data;
            try {
                data = JSON.parse(event.data);
            }
            catch (e) {
                this.log('error', 'Error parsing message', e);
                return;
            }
            this.triggerEvent('message', data);
            if (data.action === 'subscribed' && data.room) {
                this._subscribed(data.room);
                return;
            }
            if (data.action === 'pong') {
                this.log('info', 'Pong received');
                return;
            }
            else {
                this.log('server', 'Message received', event.data);
            }
            const handlers = this._eventHandlers[data.action];
            handlers === null || handlers === void 0 ? void 0 : handlers.forEach(handler => handler(data));
        });
    }
    _onError(event) {
        this.log('error', 'WebSocket error encountered', event);
        this._updateConnectionState('error');
        this.triggerEvent('error', event);
    }
    _onClose() {
        this.log('client', 'WebSocket connection closed');
        this._updateConnectionState('closed');
        this.triggerEvent('close');
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
        this.log('info', `Connection state updated to ${state}`);
    }
    _send(data) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (((_a = this._socket) === null || _a === void 0 ? void 0 : _a.readyState) === WebSocket.OPEN) {
                this.log('client', `Sending message: ${data.action}`, data);
                const message = JSON.stringify(data);
                this._socket.send(message);
            }
            else {
                this.log('client', 'Queueing message', data);
                this._messageQueue.push(JSON.stringify(data));
            }
        });
    }
    _flushQueue() {
        this._messageQueue.forEach(data => {
            var _a;
            (_a = this._socket) === null || _a === void 0 ? void 0 : _a.send(data);
            this.log('info', 'Flushed message from queue');
        });
        this._messageQueue = [];
    }
    _subscribed(room) {
        if (this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.delete(room);
            this._subscriptions.add(room);
            this.log('user', `Subscription confirmed for room: ${room}`);
        }
    }
    sub(room) {
        if (!this._subscriptions.has(room) && !this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.add(room);
            this._send({ action: 'subscribe', room });
            this.log('user', `Subscription request sent for room: ${room}`);
        }
        else {
            this.log('user', `Already subscribed or pending subscription for room: ${room}`);
        }
    }
    unsub(room) {
        if (this._subscriptions.has(room) || this._pendingSubscriptions.has(room)) {
            this._subscriptions.delete(room);
            this._pendingSubscriptions.delete(room);
            this._send({ action: 'unsubscribe', room });
            this.log('user', `Unsubscribe request sent for room: ${room}`);
        }
        else {
            this.log('user', `Attempt to unsubscribe from a room that was not subscribed: ${room}`);
        }
    }
    pub(room, payload) {
        this._send({ action: 'publish', room, payload });
        this.log('user', `User published to room: ${room}`, payload);
    }
    on(eventType, handler) {
        if (!this._eventHandlers[eventType]) {
            this._eventHandlers[eventType] = [];
        }
        this._eventHandlers[eventType].push(handler);
    }
    triggerEvent(eventType, data) {
        if (this._eventHandlers[eventType]) {
            this._eventHandlers[eventType].forEach(handler => handler(data));
        }
    }
    cleanup() {
        // Clear any pending subscription timeouts
        // this._subscriptionTimeouts.forEach(timeout => clearTimeout(timeout));
        // this._subscriptionTimeouts.clear();
        this._pendingSubscriptions.clear();
        // Existing cleanup logic
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
        this.log('client', 'WebSocket client cleaned up');
    }
}

export { EchoChamber };
//# sourceMappingURL=EchoChamber.esm.js.map
