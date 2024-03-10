import { Server } from 'mock-socket';
import EchoChamber from './EchoChamber';

describe('EchoChamber WebSocket interactions', () => {
    let mockServer: Server;
    const serverUrl: string = 'ws://localhost:8080';
    let echoChamber: EchoChamber | null;

    beforeEach(() => {
        mockServer = new Server(serverUrl);
    });

    afterEach(() => {
        echoChamber?.cleanup();
        mockServer.stop();
    });

    test('EchoChamber successfully flushes message queue upon connection', (done) => {
        const testMessage = { action: 'subscribe', room: 'testRoom' };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber._internalMessageQueue.push(JSON.stringify(testMessage)); // Simulate adding a message to the queue before connection is established

        mockServer.on('connection', (socket) => {
            socket.on('message', (data) => {
                if (typeof data === 'string') {
                    expect(JSON.parse(data)).toEqual(testMessage);
                }
                done();
            });
        });
    });

    test('EchoChamber attempts to reconnect after close', (done) => {
        echoChamber = new EchoChamber(serverUrl, { reconnect: true, reconnectDelay: 10 }); // Use short delay for test

        let connections = 0;

        mockServer.on('connection', socket => {
            connections++;
            if (connections === 1) {
                socket.close();
            } else if (connections === 2) {
                expect(echoChamber?._internalConnectionState).toBe('connected');
                done();
            }
        });
    });

    test('EchoChamber handles onMessage events', (done) => {
        const testMessage = { action: 'test', room: 'testRoom' };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber.on('test', (data) => {
            expect(data).toEqual(testMessage);
            done();
        });

        mockServer.on('connection', (socket) => {
            socket.send(JSON.stringify(testMessage));
        });
    });

    test('EchoChamber handles onError callback', (done) => {
        echoChamber = new EchoChamber(serverUrl, {
            onError: (event) => {
                expect(event).toBeTruthy();
                done();
            },
        });

        mockServer.on('connection', () => {
            mockServer.simulate('error');
        });
    });

    test('EchoChamber cleanup properly resets object state', () => {
        echoChamber = new EchoChamber(serverUrl);
        echoChamber.cleanup();

        expect(echoChamber._internalSocket).toBeNull();
        expect(echoChamber._internalConnectionState).toBe('closed');
        expect(echoChamber._internalPingInterval).toBeNull();
        expect(echoChamber._internalMessageQueue.length).toBe(0);
        expect(echoChamber._internalSubscriptions.size).toBe(0);
    });

    test('EchoChamber flushes message queue upon connection', done => {
        const testMessage = { action: 'testAction', room: 'testRoom' };
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });

        // Simulate adding a message to the queue before connection is established
        echoChamber._internalMessageQueue.push(JSON.stringify(testMessage));

        mockServer.on('connection', socket => {
            socket.on('message', data => {
                if (typeof data === 'string') {
                    const message = JSON.parse(data);
                    expect(message).toEqual(testMessage);
                    done();
                }
            });
        });
    });

    test('EchoChamber correctly calls event handlers for custom events', done => {
        const testMessage = { action: 'customEvent', data: 'testData' };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber.on('customEvent', data => {
            expect(data).toEqual(testMessage);
            done();
        });

        mockServer.on('connection', socket => {
            socket.send(JSON.stringify(testMessage));
        });
    });

    test('EchoChamber sends a ping at the expected interval', done => {
        const pingInterval = 1000;
        echoChamber = new EchoChamber(serverUrl, { pingInterval });
    
        let pingReceived = false;
    
        mockServer.on('connection', socket => {
            socket.on('message', data => {
                if (typeof data === 'string') {
                    const message = JSON.parse(data);
                    if (message.action === 'ping') {
                        pingReceived = true;
                    }
                }
            });
        });
    
        setTimeout(() => {
            expect(pingReceived).toBe(true);
            done();
        }, pingInterval + 500);
    });

});
