"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.webApp = exports.HttpServer = exports.Http2Server = exports.WebServer = void 0;
const express = require("express");
const io = require("socket.io-client");
const State_1 = require("./services/State");
const http = require("http");
const os = require("os");
const Controller_1 = require("../controller/Controller");
const Config_1 = require("../config/Config");
const Logger_1 = require("../logger/Logger");
class WebServer {
    constructor() {
        this._servers = [];
    }
    init() {
        let cfg = Config_1.config.getSection('web');
        let srv;
        for (let s in cfg.servers) {
            let c = cfg.servers[s];
            switch (s) {
                case 'http':
                    srv = new HttpServer();
                    break;
                case 'https':
                    srv = new Http2Server();
                    break;
            }
            if (typeof srv !== 'undefined') {
                this._servers.push(srv);
                srv.init(c);
                srv = undefined;
            }
        }
    }
    emitToClients(evt, ...data) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToClients(evt, ...data);
        }
    }
    emitToChannel(channel, evt, ...data) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToChannel(channel, evt, ...data);
        }
    }
    deviceXML() { }
    stop() {
        for (let s in this._servers) {
            if (typeof this._servers[s].stop() === 'function')
                this._servers[s].stop();
        }
    }
}
exports.WebServer = WebServer;
class ProtoServer {
    constructor() {
        this.isRunning = false;
        this._dev = process.env.NODE_ENV !== 'production';
        this.family = 'IPv4';
    }
    emitToClients(evt, ...data) { }
    emitToChannel(channel, evt, ...data) { }
    stop() { }
    getInterface() {
        const networkInterfaces = os.networkInterfaces();
        for (let name in networkInterfaces) {
            let nic = networkInterfaces[name];
            for (let ndx in nic) {
                let addr = nic[ndx];
                if (!addr.internal && addr.mac.indexOf('00:00:00:') < 0 && addr.family === this.family) {
                    return addr;
                }
            }
        }
    }
    ip() {
        return typeof this.getInterface() === 'undefined' ? '0.0.0.0' : this.getInterface().address;
    }
    mac() {
        return typeof this.getInterface() === 'undefined' ? '00:00:00:00' : this.getInterface().mac;
    }
}
class Http2Server extends ProtoServer {
    init(cfg) {
        if (cfg.enabled) {
            this.app = express();
        }
    }
}
exports.Http2Server = Http2Server;
class HttpServer extends ProtoServer {
    initSockets() {
        this.sockClient = io(Controller_1.controller.httpComms.baseURL());
        this.sockClient.on('error', (err) => {
            console.error('Socket server error %s', err.message);
        });
        this.sockClient.on('connect_error', (err) => {
            console.error('Socket connection error %s', err.message);
        });
        this.sockClient.on('reconnect_failed', (err) => {
            console.error('Failed to reconnect with socket %s', err.message);
        });
        this.sockClient.on('connect', () => {
            console.info(`Socket client connected`);
        });
        this.sockClient.on('disconnect', () => {
            console.info(`Socket client disconnected`);
        });
        this.sockClient.on('controller', data => {
            Logger_1.logger.info(`Socket received controller emit: ${JSON.stringify(data)}`);
        });
        this.sockClient.on('chemController', (data) => {
            Controller_1.controller.probes.setData(data);
        });
        this.sockClient.on('temp', (data) => {
            Controller_1.controller.probes.setData(data);
        });
    }
    init(cfg) {
        if (cfg.enabled) {
            this.app = express();
            this.server = http.createServer(this.app);
            this.app.use(express.json());
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, DELETE');
                if ('OPTIONS' === req.method) {
                    res.sendStatus(200);
                }
                else {
                    if (req.url !== '/device') {
                        Logger_1.logger.info(`${req.ip} ${req.method} ${req.url} ${typeof req.body === 'undefined' ? '' : JSON.stringify(req.body)}`);
                    }
                    next();
                }
            });
            this.app.set('json replacer', (key, value) => {
                if (value instanceof Error) {
                    var err = {};
                    Object.getOwnPropertyNames(value).forEach((prop) => { err[prop] = value[prop]; });
                    return err;
                }
                return value;
            });
            State_1.StateRoute.initRoutes(this.app);
            this.initSockets();
            this.app.use((error, req, res, next) => {
                console.error(error);
                if (!res.headersSent) {
                    let httpCode = error.httpCode || 500;
                    res.status(httpCode).send(error);
                }
            });
            this.server.listen(cfg.port, cfg.ip, function () {
                console.info('Server is now listening on %s:%s', cfg.ip, cfg.port);
            });
            this.isRunning = true;
        }
    }
}
exports.HttpServer = HttpServer;
exports.webApp = new WebServer();
//# sourceMappingURL=Server.js.map