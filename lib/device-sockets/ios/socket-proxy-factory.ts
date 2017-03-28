import { PacketStream } from "./packet-stream";
import * as net from "net";
import * as ws from "ws";
import temp = require("temp");

export class SocketProxyFactory implements ISocketProxyFactory {
	constructor(private $logger: ILogger,
		private $config: IConfiguration,
		private $options: IOptions) { }

	public createTCPSocketProxy(factory: () => Promise<net.Socket>): any {
		this.$logger.info("\nSetting up proxy...\nPress Ctrl + C to terminate, or disconnect.\n");

		let server = net.createServer({
			allowHalfOpen: true
		});

		server.on("connection", async (frontendSocket: net.Socket) => {
			this.$logger.info("Frontend client connected.");

			frontendSocket.on("end", () => {
				this.$logger.info('Frontend socket closed!');
				if (!(this.$config.debugLivesync && this.$options.watch)) {
					process.exit(0);
				}
			});

			const backendSocket: net.Socket = await factory();
			this.$logger.info("Backend socket created.");

			backendSocket.on("end", () => {
				this.$logger.info("Backend socket closed!");
				if (!(this.$config.debugLivesync && this.$options.watch)) {
					process.exit(0);
				}
			});

			frontendSocket.on("close", () => {
				console.log("frontend socket closed");
				if (!(<any>backendSocket).destroyed) {
					backendSocket.destroy();
				}
			});
			backendSocket.on("close", () => {
				console.log("backend socket closed");
				if (!(<any>frontendSocket).destroyed) {
					frontendSocket.destroy();
				}
			});

			backendSocket.pipe(frontendSocket);
			frontendSocket.pipe(backendSocket);
			frontendSocket.resume();
		});

		let socketFileLocation = temp.path({ suffix: ".sock" });
		server.listen(socketFileLocation);
		if (!this.$options.client) {
			this.$logger.info("socket-file-location: " + socketFileLocation);
		}

		return server;
	}

	public createWebSocketProxy(factory: () => Promise<net.Socket>): ws.Server {
		// NOTE: We will try to provide command line options to select ports, at least on the localhost.
		let localPort = 8080;

		this.$logger.info("\nSetting up debugger proxy...\nPress Ctrl + C to terminate, or disconnect.\n");

		// NB: When the inspector frontend connects we might not have connected to the inspector backend yet.
		// That's why we use the verifyClient callback of the websocket server to stall the upgrade request until we connect.
		// We store the socket that connects us to the device in the upgrade request object itself and later on retrieve it
		// in the connection callback.

		let server = new ws.Server(<any>{
			port: localPort,
			verifyClient: async (info: any, callback: Function) => {
				this.$logger.info("Frontend client connected.");
				const _socket = await factory();
				this.$logger.info("Backend socket created.");
				info.req["__deviceSocket"] = _socket;
				callback(true);
			}
		});
		server.on("connection", (webSocket) => {
			let encoding = "utf16le";

			let deviceSocket: net.Socket = (<any>webSocket.upgradeReq)["__deviceSocket"];
			let packets = new PacketStream();
			deviceSocket.pipe(packets);

			packets.on("data", (buffer: Buffer) => {
				webSocket.send(buffer.toString(encoding));
			});

			webSocket.on("message", (message, flags) => {
				let length = Buffer.byteLength(message, encoding);
				let payload = new Buffer(length + 4);
				payload.writeInt32BE(length, 0);
				payload.write(message, 4, length, encoding);
				deviceSocket.write(payload);
			});

			deviceSocket.on("end", () => {
				this.$logger.info("Backend socket closed!");
				process.exit(0);
			});

			webSocket.on("close", () => {
				this.$logger.info('Frontend socket closed!');
				if (!this.$options.watch) {
					process.exit(0);
				}
			});

		});

		this.$logger.info("Opened localhost " + localPort);
		return server;
	}
}
$injector.register("socketProxyFactory", SocketProxyFactory);
