import { Server } from "mock-socket";
import EchoChamber, { ConnectionState } from "./EchoChamber.ts";

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

    test("EchoChamber successfully flushes message queue upon connection", (done) => {
        const testMessage = { action: "subscribe", room: "testRoom" };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber._internalMessageQueue.push(JSON.stringify(testMessage));

        mockServer.on("connection", (socket) => {
            socket.on("message", (data) => {
                if (typeof data === "string") {
                    expect(JSON.parse(data)).toEqual(testMessage);
                }
                done();
            });
        });
    });

    test("EchoChamber attempts to reconnect after close", (done) => {
        echoChamber = new EchoChamber(serverUrl, {
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

    test("EchoChamber handles onMessage events", (done) => {
        const testMessage = { action: "test", room: "testRoom" };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber.on("test", (data) => {
            expect(data).toEqual(testMessage);
            done();
        });

        mockServer.on("connection", (socket) => {
            socket.send(JSON.stringify(testMessage));
        });
    });

    test("EchoChamber handles onError callback", (done) => {
        echoChamber = new EchoChamber(serverUrl, {
            onError: (event) => {
                expect(event).toBeTruthy();
                done();
            },
        });

        mockServer.on("connection", () => {
            mockServer.simulate("error");
        });
    });

    test("EchoChamber cleanup properly resets object state", () => {
        echoChamber = new EchoChamber(serverUrl);
        echoChamber.cleanup();

        expect(echoChamber._internalSocket).toBeNull();
        expect(echoChamber._internalConnectionState).toBe("closed");
        expect(echoChamber._internalPingInterval).toBeNull();
        expect(echoChamber._internalMessageQueue.length).toBe(0);
        expect(echoChamber._internalSubscriptions.size).toBe(0);
    });

    test("EchoChamber flushes message queue upon connection", (done) => {
        const testMessage = { action: "testAction", room: "testRoom" };
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        echoChamber._internalMessageQueue.push(JSON.stringify(testMessage));

        mockServer.on("connection", (socket) => {
            socket.on("message", (data) => {
                if (typeof data === "string") {
                    const message = JSON.parse(data);
                    expect(message).toEqual(testMessage);
                    done();
                }
            });
        });
    });

    test("EchoChamber correctly calls event handlers for custom events", (done) => {
        const testMessage = { action: "customEvent", data: "testData" };
        echoChamber = new EchoChamber(serverUrl);

        echoChamber.on("customEvent", (data) => {
            expect(data).toEqual(testMessage);
            done();
        });

        mockServer.on("connection", (socket) => {
            socket.send(JSON.stringify(testMessage));
        });
    });

    test("EchoChamber sends a ping at the expected interval", (done) => {
        const pingInterval = 1000;
        echoChamber = new EchoChamber(serverUrl, { pingInterval });

        let pingReceived = false;

        mockServer.on("connection", (socket) => {
            socket.on("message", (data) => {
                if (typeof data === "string") {
                    const message = JSON.parse(data);
                    if (message.action === "ping") {
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

    test("EchoChamber correctly manages subscriptions and resubscribes on reconnect", (done) => {
        const roomName = "testRoom";
        echoChamber = new EchoChamber(serverUrl, {
            reconnect: true,
            reconnectDelay: 100,
        });

        function setupMockServer() {
            let connections = 0;

            mockServer.on("connection", (socket) => {
                connections++;
                if (connections === 1) {
                    socket.on("message", (data) => {
                        if (typeof data === "string") {
                            const message = JSON.parse(data);
                            expect(message).toEqual({ action: "subscribe", room: roomName });
                            setTimeout(() => socket.close(), 100);
                        }
                    });
                } else if (connections === 2) {
                    socket.on("message", (data) => {
                        if (typeof data === "string") {
                            const message = JSON.parse(data);
                            expect(message).toEqual({ action: "subscribe", room: roomName });
                            done();
                        }
                    });
                }
            });
        }

        setupMockServer();

        setTimeout(() => {
            echoChamber.sub(roomName);
            expect(echoChamber._internalSubscriptions.has(roomName)).toBe(true);
        }, 100);
    });

    test("EchoChamber handles receiving pong message correctly", (done) => {
        echoChamber = new EchoChamber(serverUrl, { logger: mockLogger });

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

    test("EchoChamber queues messages when disconnected and sends them upon reconnection", (done) => {
        echoChamber = new EchoChamber(serverUrl, {
            reconnect: true,
            reconnectDelay: 100,
        });
        const testMessage = {
            action: "test",
            room: "testRoom",
            payload: { message: "hello" },
        };

        if (echoChamber._internalSocket) {
            echoChamber._internalSocket.close();
        }

        echoChamber.pub(testMessage.room, testMessage.payload);
        expect(echoChamber._internalMessageQueue.length).toBe(1);

        let connections = 0;
        mockServer.on("connection", (socket) => {
            connections++;
            if (connections === 1) {
                socket.on("message", (data) => {
                    if (typeof data === "string") {
                        const message = JSON.parse(data);
                        expect(message).toEqual({
                            action: "publish",
                            room: testMessage.room,
                            payload: testMessage.payload,
                        });
                        done();
                    }
                });

                echoChamber._internalSocket?.dispatchEvent(new Event("open"));
            }
        });
    });

    test("EchoChamber calls onError callback with an error event", (done) => {
        const onErrorSpy = jest.fn();

        echoChamber = new EchoChamber(serverUrl, {
            onError: onErrorSpy,
        });

        mockServer.on("connection", () => {
            mockServer.simulate("error");
        });

        setTimeout(() => {
            expect(onErrorSpy).toHaveBeenCalled();
            done();
        }, 100);
    });

    test("EchoChamber calls onClose callback when the connection is closed", (done) => {
        const onCloseSpy = jest.fn();

        echoChamber = new EchoChamber(serverUrl, {
            onClose: onCloseSpy,
        });

        mockServer.on("connection", (socket) => {
            socket.close();
        });

        setTimeout(() => {
            expect(onCloseSpy).toHaveBeenCalled();
            done();
        }, 100);
    });

    test("EchoChamber updates connection state correctly", (done) => {
        echoChamber = new EchoChamber(serverUrl);

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

    test("EchoChamber logs connection events", (done) => {
        const onOpenSpy = jest.fn();
        echoChamber = new EchoChamber(serverUrl, {
            logger: mockLogger,
            onConnect: onOpenSpy,
        });

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

    test("EchoChamber logs message sending and receiving", (done) => {
        echoChamber = new EchoChamber(serverUrl, { logger: mockLogger });
        const testRoom = "testRoom";
        const payload = { message: "hello" };

        mockServer.on("connection", (socket) => {
            echoChamber.pub(testRoom, payload);
        });

        setTimeout(() => {
            let found = false;
            mockLogger.mock.calls.forEach((call) => {
                const action = call[1];
                const data = call[2];
                if (
                    action.includes("Sent: publish") &&
                    data.room === testRoom &&
                    data.payload === payload
                ) {
                    found = true;
                }
            });

            expect(found).toBe(true);
            done();
        }, 500);
    });

    test('EchoChamber calculates reconnection delay correctly', done => {
        let attemptCounts = 0;
        const initialDelay = 10;
        const multiplier = 2;
        const maxDelay = 50;

        echoChamber = new EchoChamber(serverUrl, {
            reconnect: true,
            reconnectDelay: initialDelay,
            reconnectMultiplier: multiplier,
            maxReconnectDelay: maxDelay,
            onConnect: () => { attemptCounts++; },
            logger: (category, message) => console.log(message)
        });

        mockServer.on('connection', socket => {
            setTimeout(() => socket.close(), 50);
        });

        setTimeout(() => {
            expect(attemptCounts).toBeGreaterThan(1);
            if (echoChamber !== null) {
                echoChamber._internalOptions.reconnect = false;
                echoChamber.cleanup();
            }
            done();
        }, 500);
    });

    test("EchoChamber gracefully handles invalid JSON in messages", (done) => {
        echoChamber = new EchoChamber(serverUrl, { logger: mockLogger });

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

    test("EchoChamber unsub method removes subscription and sends an unsubscribe message", (done) => {
        const roomName = "testRoom";
        echoChamber = new EchoChamber(serverUrl);

        echoChamber._internalSubscriptions.add(roomName);

        expect(echoChamber._internalSubscriptions.has(roomName)).toBe(true);

        mockServer.on("connection", (socket) => {
            socket.on("message", (data) => {
                if (typeof data === "string") {
                    const message = JSON.parse(data);

                    if (message.action === "unsubscribe" && message.room === roomName) {
                        expect(message).toEqual({ action: "unsubscribe", room: roomName });

                        setTimeout(() => {
                            expect(echoChamber._internalSubscriptions.has(roomName)).toBe(false);
                            done();
                        }, 0);
                    }
                }
            });
        });

        echoChamber.unsub(roomName);
    });

    test("EchoChamber _internalConnectionState getter and setter", () => {
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        const states: ConnectionState[] = ['connecting', 'connected', 'error', 'closed'];
        states.forEach(state => {
            echoChamber._internalConnectionState = state;
            expect(echoChamber._internalConnectionState).toBe(state);
        });
    });

    test("EchoChamber _internalMessageQueue getter and setter", () => {
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        const messageQueue = ["message1", "message2"];
        echoChamber._internalMessageQueue = messageQueue;
        expect(echoChamber._internalMessageQueue).toEqual(messageQueue);
    });

    test("EchoChamber _internalSubscriptions getter and setter", () => {
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        const subscriptions = new Set(["room1", "room2"]);
        echoChamber._internalSubscriptions = subscriptions;
        expect(echoChamber._internalSubscriptions).toEqual(subscriptions);
    });

    test("EchoChamber _internalSocket getter and setter", () => {
        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        const mockSocket = new WebSocket(serverUrl);
        echoChamber._internalSocket = mockSocket;
        expect(echoChamber._internalSocket).toEqual(mockSocket);
    });

    test("EchoChamber _internalPingInterval getter and setter", () => {
        jest.useFakeTimers();

        echoChamber = new EchoChamber(serverUrl, { reconnect: false });
        const mockInterval = setInterval(() => { }, 50);
        echoChamber._internalPingInterval = mockInterval;
        expect(echoChamber._internalPingInterval).toBe(mockInterval);
        clearInterval(mockInterval);

        jest.runOnlyPendingTimers();
        jest.clearAllTimers();
        jest.useRealTimers();
    });

    test("EchoChamber updates specific options without affecting others", () => {
        echoChamber = new EchoChamber(serverUrl, {
            reconnect: false,
            pingInterval: 30000,
            reconnectDelay: 1000,
            reconnectMultiplier: 2,
            maxReconnectDelay: 30000,
            logger: (category, message, ...args) => {
                console.log(`EchoChamber [${category}]: ${message}`, ...args);
            },
        });
        const newOptions = {
            reconnect: true,
            pingInterval: 15000,
        };

        echoChamber._internalOptions = newOptions;

        expect(echoChamber._internalOptions.reconnect).toBe(true);
        expect(echoChamber._internalOptions.pingInterval).toBe(15000);

        expect(echoChamber._internalOptions.reconnectDelay).toBe(1000);
        expect(echoChamber._internalOptions.reconnectMultiplier).toBe(2);
        expect(echoChamber._internalOptions.maxReconnectDelay).toBe(30000);

        expect(echoChamber._internalOptions.logger).toBeDefined();
        expect(typeof echoChamber._internalOptions.logger).toBe("function");
    });

    describe("EchoChamber formats relative URL to WebSocket URL based on window.location", () => {
        test("with port specified in window.location", () => {
            mockWindowLocation("example.com", "8080");
            const echoChamber = new EchoChamber("/test/server");
            expect(echoChamber._internalServerUrl).toBe("wss://example.com:8080/test/server");
        });

        test("without port specified in window.location", () => {
            mockWindowLocation("example.com", "");
            const echoChamber = new EchoChamber("/test/server");
            expect(echoChamber._internalServerUrl).toBe("wss://example.com/test/server");
        });

        test("with overridden internal server URL", () => {
            mockWindowLocation("example.com", "8080");
            const echoChamber = new EchoChamber("/test/server");
            echoChamber._internalServerUrl = 'wss://override.me/ws';
            expect(echoChamber._internalServerUrl).toBe("wss://override.me/ws");
        });
    });

    test("EchoChamber calls onMessage callback if it exists", (done) => {
        const testData = { action: "test", payload: { message: "Test message" } };
        const mockOnMessage = jest.fn();

        echoChamber = new EchoChamber(serverUrl, {
            onMessage: mockOnMessage
        });

        mockServer.on("connection", (socket) => {
            socket.send(JSON.stringify(testData));
        });

        setTimeout(() => {
            expect(mockOnMessage).toHaveBeenCalled();
            expect(mockOnMessage).toHaveBeenCalledWith(testData);
            done();
        }, 100);
    });
});
