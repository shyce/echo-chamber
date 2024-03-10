import { Server } from "mock-socket";
import { EchoChamber, ConnectionState } from "./EchoChamber.ts";

describe("EchoChamber WebSocket interactions", () => {
    let mockLogger = jest.fn();
    let mockServer: Server;
    const serverUrl: string = "ws://localhost:8080";
    let echoChamber: EchoChamber;

    function mockWindowLocation(hostname: string, port: string) {
        Object.defineProperty(window, 'location', {
            value: {
                hostname: hostname,
                port: port,
            },
            writable: true
        });
    }

    beforeEach(() => {
        mockServer = new Server(serverUrl);
    });

    afterEach(() => {
        echoChamber.cleanup();
        mockServer.stop();
    });

    describe("Connection Management", () => {
        test("Handles reconnection", (done) => {
            echoChamber = new EchoChamber(serverUrl, {
                log: false,
                reconnect: true,
                reconnectDelay: 10,
            });

            let connections = 0;

            mockServer.on("connection", (socket) => {
                connections++;
                if (connections === 1) {
                    socket.close();
                } else if (connections === 2) {
                    expect(echoChamber._internalConnectionState).toBe("connected");
                    done();
                }
            });
        });
        test('Correctly handles disconnection', async () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            await echoChamber.disconnect();
        
            expect(echoChamber._internalConnectionState).toBe('closed');
            expect(echoChamber._internalSocket).toBeNull();
            expect(echoChamber._internalMessageQueue.length).toBe(0);
            expect([...echoChamber._internalSubscriptions].length).toBe(0);
            expect([...echoChamber._internalPendingSubscriptions].length).toBe(0);
        });
        test("Calculates reconnection delay", (done) => {
            let attemptCounts = 0;
            const initialDelay = 10;
            const multiplier = 2;
            const maxDelay = 50;

            echoChamber = new EchoChamber(serverUrl, {
                log: false,
                reconnect: true,
                reconnectDelay: initialDelay,
                reconnectMultiplier: multiplier,
                maxReconnectDelay: maxDelay,
            });

            echoChamber.on('connect', () => {
                attemptCounts++;
            })

            mockServer.on('connection', socket => {
                setTimeout(() => socket.close(), 50);
            });

            setTimeout(() => {
                expect(attemptCounts).toBeGreaterThan(1);
                if (echoChamber !== null) {
                    echoChamber.options.reconnect = false;
                    echoChamber.cleanup();
                }
                done();
            }, 500);
        });
        test("Updates connection state", (done) => {
            echoChamber = new EchoChamber(serverUrl, { log: false });

            expect(echoChamber._internalConnectionState).toBe("connecting");

            mockServer.on("connection", (socket) => {
                expect(echoChamber._internalConnectionState).toBe("connected");

                mockServer.simulate("error");
                expect(echoChamber._internalConnectionState).toBe("error");

                socket.close();
            });

            echoChamber._internalSocket?.addEventListener("close", () => {
                expect(echoChamber._internalConnectionState).toBe("closed");
                done();
            });
        });
    });

    describe("Message Handling", () => {
        test('Gracefully handles a null socket when sending messages', () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, autoconnect: false, reconnect: false });
            echoChamber._internalSocket = null;

            expect(() => echoChamber.send({ action: 'test' })).not.toThrow();
        });
        test("Gracefully flushes message queue on connection", (done) => {
            const testMessage = { action: "testAction", room: "testRoom" };
            echoChamber = new EchoChamber(serverUrl, { log: false, autoconnect: false, reconnect: false });
            echoChamber._internalMessageQueue.push(JSON.stringify(testMessage));
            echoChamber.connect()
            mockServer.on("connection", (socket) => {
                socket.on("message", (data) => {
                    if (typeof data === "string") {
                        const message = JSON.parse(data);
                        expect(message).toEqual(testMessage);
                        done();
                    }
                });
            });

            echoChamber.disconnect()
            echoChamber._internalSocket = null
            echoChamber._internalMessageQueue.push(JSON.stringify(testMessage));
            echoChamber._internalFlushQueueu();
            setTimeout(() => {
                expect(Object.keys(echoChamber._internalMessageQueue).length).toBe(1)
                done()
            }, 100);
        });
        test("Queues messages when offline, sends on reconnect", (done) => {
            echoChamber = new EchoChamber(serverUrl, { log: false, logger: mockLogger });
            const testMessage = {
                room: "testRoom",
                payload: { message: "hello" },
            };

            mockServer.on("connection", (socket) => {
                socket.on("message", (data) => {
                    if (typeof data === "string") {
                        const message = JSON.parse(data);
                        expect(message).toEqual({
                            action: "publish",
                            room: testMessage.room,
                            payload: testMessage.payload,
                        });
                    }
                });
            });

            if (echoChamber.connected()) {
                echoChamber.disconnect();
            }

            echoChamber.pub(testMessage.room, testMessage.payload);
            expect(echoChamber._internalMessageQueue.length).toBe(1);
            echoChamber.connect()

            setTimeout(() => {
                expect(echoChamber._internalMessageQueue.length).toBe(0);
                done()
            }, 200);
        });
        test("Sends ping at set interval", (done) => {
            const pingInterval = 10;
            echoChamber = new EchoChamber(serverUrl, { log: false, pingInterval });

            let pingReceived = false;

            mockServer.on("connection", (socket) => {
                socket.on("message", (data) => {
                    if (typeof data === "string") {
                        const message = JSON.parse(data);
                        if (message.action === "ping") {
                            pingReceived = true;
                            expect(pingReceived).toBe(true);
                            done();
                        }
                    }
                });
            });

            setTimeout(() => {
                if (!pingReceived) {
                    done.fail('Ping was not received in time');
                }
            }, pingInterval + 100);
        });
        test("Processes pong messages correctly", (done) => {
            echoChamber = new EchoChamber(serverUrl, { log: false, logger: mockLogger });

            mockServer.on("connection", (socket) => {
                socket.send(JSON.stringify({ action: "pong" }));
            });

            setTimeout(() => {
                const callArgs = mockLogger.mock.calls.flat();
                const hasPongReceived = callArgs.some(
                    (arg) => typeof arg === "string" && arg.includes("Pong received")
                );
                expect(hasPongReceived).toBe(true);

                done();
            }, 100);
        });
        test("Handles invalid JSON messages", (done) => {
            echoChamber = new EchoChamber(serverUrl, { log: false, logger: mockLogger });

            mockServer.on("connection", (socket) => {
                socket.send("This is not valid JSON!");
            });

            echoChamber.on("error", (data) => {
                expect(data).toBeTruthy();
                done();
            });

            setTimeout(() => {
                const errorLogged = mockLogger.mock.calls.some((call) => call[1].includes("Error parsing message"));
                expect(errorLogged).toBe(true);
                done();
            }, 100);
        });
    });

    describe("Subscription Management", () => {
        test("Manages subscriptions, resubscribes on reconnect", (done) => {
            const roomName = "testRoom";
            let echoChamber = new EchoChamber(serverUrl, {
                log: false,
                reconnect: true,
                reconnectDelay: 100,
            });

            function setupMockServer() {
                let connections = 0;

                mockServer.on("connection", (socket) => {
                    connections++;
                    socket.on("message", (data) => {
                        if (typeof data === "string") {
                            const message = JSON.parse(data);
                            if (message.action === "subscribe" && message.room === roomName) {
                                socket.send(JSON.stringify({ action: "subscribed", room: roomName }));
                            }
                        }
                    });

                    if (connections === 1) {
                        setTimeout(() => socket.close(), 100);
                    } else if (connections === 2) {
                        socket.on("message", (data) => {
                            if (typeof data === "string") {
                                const message = JSON.parse(data);
                                if (message.action === "subscribe" && message.room === roomName) {
                                    done();
                                }
                            }
                        });
                    }
                });
            }

            setupMockServer();

            setTimeout(() => {
                echoChamber.sub(roomName);
                expect(echoChamber._internalPendingSubscriptions.has(roomName)).toBe(true);
                done();
            }, 100);
        });
        test("Removes subscription and sends unsubscribe message, including pending subscriptions", (done) => {
            const roomName = "testRoom";
            echoChamber = new EchoChamber(serverUrl, { log: false });
        
            // Test setting pending subscriptions directly
            const newPendingSubscriptions = new Set<string>([roomName]);
            echoChamber._internalPendingSubscriptions = newPendingSubscriptions;
        
            // Ensure the room is considered for unsubscribing by being in pending subscriptions
            expect(echoChamber._internalPendingSubscriptions.has(roomName)).toBe(true);
        
            mockServer.on("connection", (socket) => {
                socket.on("message", (data) => {
                    if (typeof data === "string") {
                        const message = JSON.parse(data);
        
                        if (message.action === "unsubscribe" && message.room === roomName) {
                            expect(message).toEqual({ action: "unsubscribe", room: roomName });
        
                            setTimeout(() => {
                                // Ensure both subscriptions and pending subscriptions are checked and cleared
                                expect(echoChamber._internalSubscriptions.has(roomName)).toBe(false);
                                expect(echoChamber._internalPendingSubscriptions.has(roomName)).toBe(false);
                                done();
                            }, 0);
                        }
                    }
                });
            });
        
            echoChamber.unsub(roomName);
        });
        test('Unsubscribe from a room that was not subscribed', () => {
            echoChamber = new EchoChamber('ws://test', { log: false });
            jest.spyOn(echoChamber, 'log').mockImplementation(() => {});
            const room = 'nonSubscribedRoom';
            echoChamber.unsub(room);
    
            expect(echoChamber.log).toHaveBeenCalledWith('User', `Attempt to unsubscribe from a room that was not subscribed: ${room}`);
            jest.restoreAllMocks();
        });
    });

    describe("State Management", () => {
        test("Resets state on cleanup", () => {
            echoChamber = new EchoChamber(serverUrl, { log: false });
            echoChamber.cleanup();

            expect(echoChamber._internalSocket).toBeNull();
            expect(echoChamber._internalConnectionState).toBe("closed");
            expect(echoChamber._internalPingInterval).toBeNull();
            expect(echoChamber._internalMessageQueue.length).toBe(0);
            expect(echoChamber._internalSubscriptions.size).toBe(0);
        });
        test("Getter and setter for connection state", () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            const states: ConnectionState[] = ['connecting', 'connected', 'error', 'closed'];
            states.forEach(state => {
                echoChamber._internalConnectionState = state;
                expect(echoChamber._internalConnectionState).toBe(state);
            });
        });
        test("Getter and setter for message queue", () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            const messageQueue = ["message1", "message2"];
            echoChamber._internalMessageQueue = messageQueue;
            expect(echoChamber._internalMessageQueue).toEqual(messageQueue);
        });
        test("Getter and setter for subscriptions", () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            const subscriptions = new Set(["room1", "room2"]);
            echoChamber._internalSubscriptions = subscriptions;
            expect(echoChamber._internalSubscriptions).toEqual(subscriptions);
        });
        test("Getter and setter for WebSocket", () => {
            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            const mockSocket = new WebSocket(serverUrl);
            echoChamber._internalSocket = mockSocket;
            expect(echoChamber._internalSocket).toEqual(mockSocket);
        });
        test("Getter and setter for ping interval", () => {
            jest.useFakeTimers();

            echoChamber = new EchoChamber(serverUrl, { log: false, reconnect: false });
            const mockInterval = setInterval(() => { }, 50);
            echoChamber._internalPingInterval = mockInterval;
            expect(echoChamber._internalPingInterval).toBe(mockInterval);
            clearInterval(mockInterval);

            jest.runOnlyPendingTimers();
            jest.clearAllTimers();
            jest.useRealTimers();
        });
    });

    describe("Configuration and Custom Events Handling", () => {
        test("Handles onMessage events", (done) => {
            const testMessage = { action: "test", room: "testRoom" };
            echoChamber = new EchoChamber(serverUrl, { log: false });

            echoChamber.on("test", (data) => {
                expect(data).toEqual(testMessage);
                done();
            });

            mockServer.on("connection", (socket) => {
                socket.send(JSON.stringify(testMessage));
            });
        });
        test("Invokes close callback on disconnection", (done) => {
            const onCloseSpy = jest.fn();

            echoChamber = new EchoChamber(serverUrl, { log: false });
            echoChamber.on('close', onCloseSpy)
            mockServer.on("connection", (socket) => {
                socket.close();
            });

            setTimeout(() => {
                expect(onCloseSpy).toHaveBeenCalled();
                done();
            }, 100);
        });
        test("Invokes error callback on error", (done) => {
            echoChamber = new EchoChamber(serverUrl, { log: false });

            echoChamber.on('error', (data) => {
                expect(data).toBeTruthy();
                done();
            })

            mockServer.on("connection", () => {
                mockServer.simulate("error");
            });
        });
        test("Updates options without side effects", () => {
            echoChamber = new EchoChamber(serverUrl, {
                log: false,
                maxReconnectDelay: 30000,
                pingInterval: 30000,
                reconnect: false,
                reconnectDelay: 1000,
                reconnectMultiplier: 2,
            });
            const newOptions = {
                reconnect: true,
                pingInterval: 15000,
            };

            echoChamber.newOptions = newOptions;

            expect(echoChamber.options.reconnect).toBe(true);
            expect(echoChamber.options.pingInterval).toBe(15000);

            expect(echoChamber.options.reconnectDelay).toBe(1000);
            expect(echoChamber.options.reconnectMultiplier).toBe(2);
            expect(echoChamber.options.maxReconnectDelay).toBe(30000);
        });
        test("Handles custom event handlers", (done) => {
            const testMessage = { action: "customEvent", data: "testData" };
            echoChamber = new EchoChamber(serverUrl, { log: false });

            echoChamber.on("customEvent", (data) => {
                expect(data).toEqual(testMessage);
                done();
            });

            mockServer.on("connection", (socket) => {
                socket.send(JSON.stringify(testMessage));
            });
        });
        test('Gracefully skips when no handlers are defined', () => {
            echoChamber = new EchoChamber(serverUrl, { log: false });
            echoChamber._internalEventHandlers = {};
            expect(Object.keys(echoChamber._internalEventHandlers).length).toBe(0)
            expect(() => echoChamber._internalTriggerEvent('testEvent', { test: true })).not.toThrow();
        });
        test("Logs connection events", (done) => {
            const onOpenSpy = jest.fn();
            echoChamber = new EchoChamber(serverUrl, {
                log: false,
                logger: mockLogger,
            });
            echoChamber.on('connect', onOpenSpy)

            setTimeout(() => {
                expect(mockLogger).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.stringContaining("Connection state updated to connecting")
                );
                expect(mockLogger).toHaveBeenCalledWith(
                    expect.anything(),
                    expect.stringContaining("Connection state updated to connected")
                );
                expect(onOpenSpy).toHaveBeenCalled();
                done();
            }, 1000);
        });
    });

    describe("URL Handling and Customization", () => {
        test("Formats WebSocket URL with port", () => {
            mockWindowLocation("example.com", "8080");
            const echoChamber = new EchoChamber("/test/server", { log: false });
            expect(echoChamber._internalServerUrl).toBe("wss://example.com:8080/test/server");
        });
        test("Formats WebSocket URL without port", () => {
            mockWindowLocation("example.com", "");
            const echoChamber = new EchoChamber("/test/server", { log: false });
            expect(echoChamber._internalServerUrl).toBe("wss://example.com/test/server");
        });
        test("Allows overriding server URL", () => {
            mockWindowLocation("example.com", "8080");
            const echoChamber = new EchoChamber("/test/server", { log: false });
            echoChamber._internalServerUrl = 'wss://override.me/ws';
            expect(echoChamber._internalServerUrl).toBe("wss://override.me/ws");
        });
    });


    describe('Logger', () => {
        let consoleSpy: jest.SpyInstance<void, [message?: any, ...optionalParams: any[]], any>;

        beforeEach(() => {
            consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => { });
            echoChamber = new EchoChamber('/ws');
        });

        afterEach(() => {
            consoleSpy.mockRestore();
        });

        const testCases = [
            { category: 'Client', expectedColor: 'background: #007CF0; color: #E1E1E1;' },
            { category: 'User', expectedColor: 'background: #009688; color: #E1E1E1;' },
            { category: 'Server', expectedColor: 'background: #4CAF50; color: #E1E1E1;' },
            { category: 'Error', expectedColor: 'background: #F44336; color: #E1E1E1;' },
            { category: 'Info', expectedColor: 'background: #9C27B0; color: #E1E1E1;' },
        ];

        testCases.forEach(({ category, expectedColor }) => {
            test(`Correctly logs ${category} messages`, () => {
                const message = 'Test message';
                const additionalData = { foo: "bar" };
                consoleSpy.mockClear();

                echoChamber.log(category, message, additionalData);
                expect(consoleSpy).toHaveBeenCalled();

                const [formatString, categoryStyle, messageContent, additionalDataArg] = consoleSpy.mock.calls[0];
                expect(formatString).toContain(category);
                expect(formatString).toContain(message);
                expect(categoryStyle).toContain(expectedColor);

                if (additionalDataArg) {
                    expect(additionalDataArg).toEqual(JSON.stringify(additionalData));
                }
            });
        });
    });
});