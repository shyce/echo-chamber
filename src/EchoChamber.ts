interface MessageData {
    action: string;
    room?: string;
    payload?: object;
}

type ConnectionState = 'connecting' | 'connected' | 'error' | 'closed';

class EchoChamber {
    private _serverUrl: string;
    private _socket: WebSocket | null = null;
    private _options: {
        pingInterval: number;
        reconnectDelay: number;
        reconnectMultiplier: number;
        maxReconnectDelay: number;
        logger: (category: string, message: string, ...args: any[]) => void;
        onError?: (event: Event) => void;
        onClose?: () => void;
        onMessage?: (data: any) => void;
        onConnect?: () => void;
        reconnect?: boolean;
    };
    private _messageQueue: string[] = [];
    private _subscriptions: Set<string> = new Set();
    private _eventHandlers: { [key: string]: ((data: any) => void)[] } = {};
    private _reconnectAttempts: number = 0;
    private _pingInterval: ReturnType<typeof setInterval> | null = null;
    private _connectionState: ConnectionState = 'connecting';

    private _boundOnOpen: () => void;
    private _boundOnMessage: (event: MessageEvent) => void;
    private _boundOnError: (event: Event) => void;
    private _boundOnClose: () => void;

    constructor(serverUrl: string, options: Partial<typeof EchoChamber.prototype._options> = {}) {
        this._serverUrl = this._formatServerUrl(serverUrl);
        this._options = {
            pingInterval: 30000,
            reconnectDelay: 1000,
            reconnectMultiplier: 2,
            maxReconnectDelay: 30000,
            logger: (category, message, ...args) => {
                console.log(`EchoChamber [${category}]: ${message}`, ...args);
            },
            ...options,
        };
        this._boundOnOpen = this._onOpen.bind(this);
        this._boundOnMessage = this._onMessage.bind(this);
        this._boundOnError = this._onError.bind(this);
        this._boundOnClose = this._onClose.bind(this);
        this.connect();
    }

    public get _internalConnectionState(): ConnectionState {
        return this._connectionState;
    }

    public set _internalConnectionState(connectionState: ConnectionState) {
        this._connectionState = connectionState;
    }

    public get _internalMessageQueue(): string[] {
        return this._messageQueue;
    }

    public set _internalMessageQueue(messageQueue) {
        this._messageQueue = messageQueue;
    }

    public get _internalSubscriptions(): Set<string> {
        return this._subscriptions;
    }

    public set _internalSubscriptions(subscriptions: Set<string>) {
        this._subscriptions = subscriptions;
    }

    public get _internalSocket(): WebSocket | null {
        return this._socket;
    }

    public set _internalSocket(socket: WebSocket) {
        this._socket = socket;
    }

    public get _internalPingInterval(): NodeJS.Timeout | null {
        return this._pingInterval;
    }

    public set _internalPingInterval(pingInterval: NodeJS.Timeout | null) {
        this._pingInterval = pingInterval;
    }

    private _formatServerUrl(serverUrl: string): string {
        if (serverUrl.startsWith("/")) {
            const { hostname, port } = window.location;
            return `wss://${hostname}${port ? `:${port}` : ''}${serverUrl}`;
        }
        return serverUrl;
    }

    private async connect(): Promise<void> {
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
    }

    private _onOpen(): void {
        this._updateConnectionState('connected');
        this._reconnectAttempts = 0;
        this._flushQueue();
        this._subscriptions.forEach(room => this.sub(room));
        this._options.onConnect?.();
    }

    private async _onMessage(event: MessageEvent): Promise<void> {
        let data: MessageData;
        try {
            data = JSON.parse(event.data);
        } catch (e) {
            this._options.logger('error', 'Error parsing message', e);
            return;
        }

        if (data.action === 'pong') {
            this._options.logger('info', 'Pong received');
            return;
        }

        const handlers = this._eventHandlers[data.action];
        handlers?.forEach(handler => handler(data));

        this._options.onMessage?.(data);
    }

    private _onError(event: Event): void {
        this._updateConnectionState('error');
        this._options.onError?.(event);
    }

    private _onClose(): void {
        this._updateConnectionState('closed');
        this._options.onClose?.();
        if (this._options.reconnect && this._connectionState !== 'connecting') { // Prevent reconnection attempts if already trying to connect.
            const delay = Math.min(this._options.reconnectDelay * (this._options.reconnectMultiplier ** this._reconnectAttempts), this._options.maxReconnectDelay);
            setTimeout(() => this.connect(), delay);
            this._reconnectAttempts++;
        }
    }

    private _updateConnectionState(state: ConnectionState): void {
        this._connectionState = state;
        this._options.logger('info', `Connection state updated to ${state}`);
    }

    private async _send(data: MessageData): Promise<void> {
        if (this._socket?.readyState === WebSocket.OPEN) {
            const message = JSON.stringify(data);
            this._socket.send(message);
            this._options.logger('info', `Sent: ${data.action}`, data);
        } else {
            this._messageQueue.push(JSON.stringify(data));
        }
    }

    private _flushQueue(): void {
        this._messageQueue.forEach(data => {
            this._socket?.send(data);
            this._options.logger('info', 'Flushed message from queue');
        });
        this._messageQueue = [];
    }

    public sub(room: string): void {
        this._subscriptions.add(room);
        this._send({ action: 'subscribe', room });
    }

    public unsub(room: string): void {
        this._subscriptions.delete(room);
        this._send({ action: 'unsubscribe', room });
    }

    public pub(room: string, payload: any): void {
        this._send({ action: 'publish', room, payload });
    }

    public on(eventType: string, handler: (data: any) => void): void {
        if (!this._eventHandlers[eventType]) {
            this._eventHandlers[eventType] = [];
        }
        this._eventHandlers[eventType].push(handler);
    }

    public cleanup(): void {
        // Clear the ping interval.
        if (this._pingInterval !== null) {
            clearInterval(this._pingInterval);
            this._pingInterval = null;
        }

        // Close and nullify the WebSocket connection.
        if (this._socket) {
            // Remove event listeners to prevent memory leaks.
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

export default EchoChamber
