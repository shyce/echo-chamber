(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.EchoChamber = factory());
})(this, (function () { 'use strict';

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
            this._socket = null;
            this._messageQueue = [];
            this._subscriptions = new Set();
            this._eventHandlers = {};
            this._reconnectAttempts = 0;
            this._pingInterval = null;
            this._connectionState = 'connecting';
            this._serverUrl = this._formatServerUrl(serverUrl);
            this._options = Object.assign({ pingInterval: 30000, reconnectDelay: 1000, reconnectMultiplier: 2, maxReconnectDelay: 30000, logger: (category, message, ...args) => {
                    console.log(`EchoChamber [${category}]: ${message}`, ...args);
                } }, options);
            this._boundOnOpen = this._onOpen.bind(this);
            this._boundOnMessage = this._onMessage.bind(this);
            this._boundOnError = this._onError.bind(this);
            this._boundOnClose = this._onClose.bind(this);
            this.connect();
        }
        get _internalConnectionState() {
            return this._connectionState;
        }
        set _internalConnectionState(connectionState) {
            this._connectionState = connectionState;
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
        get _internalOptions() {
            return this._options;
        }
        set _internalOptions(options) {
            this._options = Object.assign(Object.assign({}, this._options), options);
        }
        get _internalServerUrl() {
            return this._serverUrl;
        }
        set _internalServerUrl(url) {
            this._serverUrl = url;
        }
        log(category, message, ...args) {
            this._options.logger(category, message, ...args);
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
                this._pingInterval = setInterval(() => this._send({ action: 'ping' }), this._options.pingInterval);
            });
        }
        _onOpen() {
            var _a, _b;
            this._updateConnectionState('connected');
            this._reconnectAttempts = 0;
            this._flushQueue();
            this._subscriptions.forEach(room => this.sub(room));
            (_b = (_a = this._options).onConnect) === null || _b === void 0 ? void 0 : _b.call(_a);
        }
        _onMessage(event) {
            return __awaiter(this, void 0, void 0, function* () {
                var _a, _b;
                let data;
                try {
                    data = JSON.parse(event.data);
                }
                catch (e) {
                    this.log('error', 'Error parsing message', e);
                    return;
                }
                if (data.action === 'pong') {
                    this.log('info', 'Pong received');
                    return;
                }
                const handlers = this._eventHandlers[data.action];
                handlers === null || handlers === void 0 ? void 0 : handlers.forEach(handler => handler(data));
                (_b = (_a = this._options).onMessage) === null || _b === void 0 ? void 0 : _b.call(_a, data);
            });
        }
        _onError(event) {
            var _a, _b;
            this._updateConnectionState('error');
            (_b = (_a = this._options).onError) === null || _b === void 0 ? void 0 : _b.call(_a, event);
        }
        _onClose() {
            var _a, _b;
            this._updateConnectionState('closed');
            (_b = (_a = this._options).onClose) === null || _b === void 0 ? void 0 : _b.call(_a);
            if (this._connectionState !== 'connecting') {
                const delay = Math.min(this._options.reconnectDelay * Math.pow(this._options.reconnectMultiplier, this._reconnectAttempts), this._options.maxReconnectDelay);
                setTimeout(() => {
                    if (this._options.reconnect) {
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
                    const message = JSON.stringify(data);
                    this._socket.send(message);
                    this.log('info', `Sent: ${data.action}`, data);
                }
                else {
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
        sub(room) {
            this._subscriptions.add(room);
            this._send({ action: 'subscribe', room });
        }
        unsub(room) {
            this._subscriptions.delete(room);
            this._send({ action: 'unsubscribe', room });
        }
        pub(room, payload) {
            this._send({ action: 'publish', room, payload });
        }
        on(eventType, handler) {
            if (!this._eventHandlers[eventType]) {
                this._eventHandlers[eventType] = [];
            }
            this._eventHandlers[eventType].push(handler);
        }
        cleanup() {
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

    return EchoChamber;

}));
