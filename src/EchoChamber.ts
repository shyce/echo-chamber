export interface MessageData {
    action: string;
    room?: string;
    payload?: object;
}

export type ConnectionState = 'connecting' | 'connected' | 'error' | 'closed';

export class EchoChamber {
    private _boundOnClose: () => void;
    private _boundOnError: (event: Event) => void;
    private _boundOnMessage: (event: MessageEvent) => void;
    private _boundOnOpen: () => void;
    private _connectionState: ConnectionState = 'connecting';
    private _eventHandlers: { [key: string]: ((data: any) => void)[] } = {};
    private _messageQueue: string[] = [];
    private _pendingSubscriptions: Set<string> = new Set();
    private _pingInterval: ReturnType<typeof setInterval> | null = null;
    private _reconnectAttempts: number = 0;
    private _serverUrl: string;
    private _socket: WebSocket | null = null;
    private _subscriptions: Set<string> = new Set();

    public options: {
        autoconnect: boolean;
        logger: (category: string, message: string, ...args: any[]) => void;
        log: boolean;
        maxReconnectDelay: number;
        pingInterval: number;
        reconnect?: boolean;
        reconnectDelay: number;
        reconnectMultiplier: number;
    };

    constructor(serverUrl: string, options: Partial<typeof EchoChamber.prototype.options> = {}) {
        this._serverUrl = this._formatServerUrl(serverUrl);
        this.options = {
            autoconnect: true,
            maxReconnectDelay: 30000,
            pingInterval: 30000,
            reconnectDelay: 1000,
            reconnectMultiplier: 2,
            logger: (category, message, ...args) => {
                if (!this.options.log) return;

                let style = "";
                const sharedStyle = "font-weight: bold; padding: 3px 5px; border-radius: 4px;"

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
            },
            log: true,
            ...options,
        };
        this._boundOnOpen = this._onOpen.bind(this);
        this._boundOnMessage = this._onMessage.bind(this);
        this._boundOnError = this._onError.bind(this);
        this._boundOnClose = this._onClose.bind(this);
        if (this.options.autoconnect) {
            this.connect();
        }
    }

    public get _internalConnectionState(): ConnectionState {
        return this._connectionState;
    }

    public set _internalConnectionState(connectionState: ConnectionState) {
        this._connectionState = connectionState;
    }

    public set newOptions(options: Partial<typeof EchoChamber.prototype.options>) {
        this.options = {...this.options, ...options};
    }

    public get _internalMessageQueue(): string[] {
        return this._messageQueue;
    }

    public set _internalMessageQueue(messageQueue: string[]) {
        this._messageQueue = messageQueue;
    }

    public get _internalSubscriptions(): Set<string> {
        return this._subscriptions;
    }

    public set _internalSubscriptions(subscriptions: Set<string>) {
        this._subscriptions = subscriptions;
    }

    public get _internalPendingSubscriptions(): Set<string> {
        return this._pendingSubscriptions;
    }

    public set _internalPendingSubscriptions(pendingSubscriptions: Set<string>) {
        this._pendingSubscriptions = pendingSubscriptions;
    }

    public get _internalSocket(): WebSocket | null {
        return this._socket;
    }

    public set _internalSocket(socket: WebSocket | null) {
        this._socket = socket;
    }

    public get _internalPingInterval(): NodeJS.Timeout | null {
        return this._pingInterval;
    }

    public set _internalPingInterval(pingInterval: NodeJS.Timeout | null) {
        this._pingInterval = pingInterval;
    }

    public get _internalServerUrl(): string {
        return this._serverUrl;
    }

    public set _internalServerUrl(url: string) {
        this._serverUrl = url;
    }

    public get _internalEventHandlers(): { [key: string]: ((data: any) => void)[]; } {
        return this._eventHandlers;
    }

    public set _internalEventHandlers(handlers: { [key: string]: ((data: any) => void)[]; }) {
        this._eventHandlers = handlers;
    }

    public log(category: string, message: string, ...args: any[]) {
        this.options.logger(category, message, ...args)
    }

    private _formatServerUrl(serverUrl: string): string {
        if (serverUrl.startsWith("/")) {
            const hostname = window.location.hostname;
            const port = window.location.port ? `:${window.location.port}` : '';
            return `wss://${hostname}${port}${serverUrl}`;
        }
        return serverUrl
    }

    public async send(data: MessageData): Promise<void> {
        if (this._socket?.readyState === WebSocket.OPEN) {
            this.log('Client', `Sending message: ${data.action}`, data);
            const message = JSON.stringify(data);
            this._socket.send(message);
        } else {
            this.log('Client', 'Queueing message', data);
            this._messageQueue.push(JSON.stringify(data));
        }
    }

    public async connect(): Promise<void> {
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
    }

    public connected(): boolean {
        return this._socket !== null && this._socket.readyState === WebSocket.OPEN;
    }
    
    public async disconnect(): Promise<void> {
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
    }

    private _onOpen(): void {
        this.log('Server', 'Connection established');
        this._updateConnectionState('connected');
        this._reconnectAttempts = 0;
        this._flushQueue();
        [...this._subscriptions, ...this._pendingSubscriptions].forEach(room => this.sub(room));
        this._triggerEvent('connect');
    }

    private async _onMessage(event: MessageEvent): Promise<void> {
        let data: MessageData;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
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
        } else {
            this.log('Server', 'Message received', event.data);
        }

        const handlers = this._eventHandlers[data.action];
        handlers.forEach(handler => handler(data));
    }

    private _onError(event: Event): void {
        this.log('Error', 'WebSocket error encountered', event);
        this._updateConnectionState('error');
        this._triggerEvent('error', event);
    }

    private _onClose(): void {
        this.log('Client', 'WebSocket connection closed');
        this._updateConnectionState('closed');
        this._triggerEvent('close');
        if (this._connectionState !== 'connecting') {
            const delay = Math.min(
                this.options.reconnectDelay * Math.pow(this.options.reconnectMultiplier, this._reconnectAttempts),
                this.options.maxReconnectDelay
            );
            setTimeout(() => {
                if (this.options.reconnect) {
                    this.connect();
                }
            }, delay);
            this._reconnectAttempts++;
        }
    }

    private _updateConnectionState(state: ConnectionState): void {
        this._connectionState = state;
        this.log('Info', `Connection state updated to ${state}`);
    }

    private _flushQueue(): void {
        this._messageQueue.forEach(data => {
            this._socket?.send(data);
            this.log('Info', 'Flushed message from queue');
        });
        if (this._socket?.readyState === WebSocket.OPEN) {
            this._messageQueue = [];
        }
    }

    public _internalFlushQueueu(): void {
        this._flushQueue();
    }
    
    private _subscribed(room: string): void {
        if (this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.delete(room);
            this._subscriptions.add(room);
            this.log('User', `Subscription confirmed for room: ${room}`);
        }
    }
    
    private _triggerEvent(eventType: string, data?: any): void {
        if (this._eventHandlers[eventType]) {
            this._eventHandlers[eventType].forEach(handler => handler(data));
        }
    }

    public _internalTriggerEvent(eventType: string, data?: any): void {
        this._triggerEvent(eventType, data)
    }

    public sub(room: string): void {
        if (!this._subscriptions.has(room) && !this._pendingSubscriptions.has(room)) {
            this._pendingSubscriptions.add(room);
            this.send({ action: 'subscribe', room });
            this.log('User', `Subscription request sent for room: ${room}`);
        } else {
            this.log('User', `Already subscribed or pending subscription for room: ${room}`);
        }
    }

    public unsub(room: string): void {
        if (this._subscriptions.has(room) || this._pendingSubscriptions.has(room)) {
            this._subscriptions.delete(room);
            this._pendingSubscriptions.delete(room);
            this.send({ action: 'unsubscribe', room });
            this.log('User', `Unsubscribe request sent for room: ${room}`);
        } else {
            this.log('User', `Attempt to unsubscribe from a room that was not subscribed: ${room}`);
        }
    }

    public pub(room: string, payload: any): void {
        this.send({ action: 'publish', room, payload });
        this.log('User', `User published to room: ${room}`, payload);
    }

    public on(eventType: string, handler: (data?: any) => void): void {
        if (!this._eventHandlers[eventType]) {
            this._eventHandlers[eventType] = [];
        }
        this._eventHandlers[eventType].push(handler);
    }

    public cleanup(): void {
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
