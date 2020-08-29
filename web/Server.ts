
import express = require('express');
import * as io from "socket.io-client";
import { StateRoute } from "./services/State";
import { StateSocket } from "./services/StateSocket";
import * as http2 from "http2";
import * as http from "http";
import * as os from 'os';
import { controller } from "../controller/Controller";
import { config } from '../config/Config';
import { logger } from '../logger/Logger'

// This class serves data and pages for
// external interfaces as well as an internal dashboard.
export class WebServer {
    private _servers: ProtoServer[] = [];
    constructor() { }
    public init() {
        let cfg = config.getSection('web');

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
    public emitToClients(evt: string, ...data: any) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToClients(evt, ...data);
        }
    }
    public emitToChannel(channel: string, evt: string, ...data: any) {
        for (let i = 0; i < this._servers.length; i++) {
            this._servers[i].emitToChannel(channel, evt, ...data);
        }
    }

    public deviceXML() { } // override in SSDP
    public stop() {
        for (let s in this._servers) {
            if (typeof this._servers[s].stop() === 'function') this._servers[s].stop();
        }
    }
}
class ProtoServer {
    // base class for all servers.
    public isRunning: boolean = false;
    public emitToClients(evt: string, ...data: any) { }
    public emitToChannel(channel: string, evt: string, ...data: any) { }
    public stop() { }
    protected _dev: boolean = process.env.NODE_ENV !== 'production';
    // todo: how do we know if the client is using IPv4/IPv6?
    private family = 'IPv4';
    private getInterface() {
        const networkInterfaces = os.networkInterfaces();
        // RKS: We need to get the scope-local nic. This has nothing to do with IP4/6 and is not necessarily named en0 or specific to a particular nic.  We are
        // looking for the first IPv4 interface that has a mac address which will be the scope-local address.  However, in the future we can simply use the IPv6 interface
        // if that is returned on the local scope but I don't know if the node ssdp server supports it on all platforms.
        for (let name in networkInterfaces) {
            let nic = networkInterfaces[name];
            for (let ndx in nic) {
                let addr = nic[ndx];
                // All scope-local addresses will have a mac.  In a multi-nic scenario we are simply grabbing
                // the first one we come across.
                if (!addr.internal && addr.mac.indexOf('00:00:00:') < 0 && addr.family === this.family) {
                    return addr;
                }
            }
        }
    }
    protected ip() {
        return typeof this.getInterface() === 'undefined' ? '0.0.0.0' : this.getInterface().address;
    }
    protected mac() {
        return typeof this.getInterface() === 'undefined' ? '00:00:00:00' : this.getInterface().mac;
    }
}
export class Http2Server extends ProtoServer {
    public server: http2.Http2Server;
    public app: Express.Application;
    public init(cfg) {
        if (cfg.enabled) {
            this.app = express();
            // TODO: create a key and cert at some time but for now don't fart with it.
        }
    }
}
export class HttpServer extends ProtoServer {
    // Http protocol
    public app: express.Application;
    public server: http.Server;
    public sockClient: SocketIOClient.Socket;
    //public parcel: parcelBundler;
    // private _sockets: socketio.Socket[]=[];
    // private _pendingMsg: Inbound;
    // public emitToClients(evt: string, ...data: any) {
    //     if (this.isRunning) {
    //         // logger.info(JSON.stringify({evt:evt, msg: 'Emitting...', data: data },null,2));
    //         this.sockClient.emit(evt, ...data);
    //     }
    // }
    // public emitToChannel(channel: string, evt: string, ...data: any) {
    //     //logger.info(`Emitting to channel ${channel} - ${evt}`)
    //     if (this.isRunning) this.sockClient.to(channel).emit(evt, ...data);
    // }
    private initSockets() {
        this.sockClient = io(controller.httpComms.baseURL());

        //this.sockServer.origins('*:*');
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
            logger.info(`Socket received controller emit: ${JSON.stringify(data)}`);
            // controller.tankPumps.readTankLevels();
            // controller.probes.readProbes();
        })
        this.sockClient.on('chemController', (data) => {
            controller.probes.setData(data);
        })
        this.sockClient.on('temp', (data) => {
            controller.probes.setData(data);
        })
        // this.app.use('/socket.io-client', express.static(path.join(process.cwd(), '/node_modules/socket.io-client/dist/'), { maxAge: '60d' }));
    }

    public init(cfg) {
        if (cfg.enabled) {
            this.app = express();

            //this.app.use();
            this.server = http.createServer(this.app);
            // if (cfg.httpsRedirect) {
            //     var cfgHttps = config.getSection('web').server.https;
            //     this.app.get('*', (res: express.Response, req: express.Request) => {
            //         let host = res.get('host');
            //         host = host.replace(/:\d+$/, ':' + cfgHttps.port);
            //         return res.redirect('https://' + host + req.url);
            //     });
            // }
            this.app.use(express.json());
            this.app.use((req, res, next) => {
                res.header('Access-Control-Allow-Origin', '*');
                res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
                res.header('Access-Control-Allow-Methods', 'OPTIONS, GET, POST, PUT, DELETE');
                if ('OPTIONS' === req.method) { res.sendStatus(200); }
                else {
                    if (req.url !== '/device') {
                        logger.info(`${req.ip} ${req.method} ${req.url} ${typeof req.body === 'undefined' ? '' : JSON.stringify(req.body)}`);
                        // logger.infoAPI(`{"dir":"in","proto":"api","requestor":"${req.ip}","method":"${req.method}","path":"${req.url}",${ typeof req.body === 'undefined' ? '' : `"body":${JSON.stringify(req.body)},` }"ts":"${Timestamp.toISOLocal(new Date())}"}${os.EOL}`);
                    }
                    next();
                }
            });


            // Put in a custom replacer so that we can send error messages to the client.  If we don't do this the base properties of Error
            // are omitted from the output.
            this.app.set('json replacer', (key, value) => {
                if (value instanceof Error) {
                    var err = {};
                    Object.getOwnPropertyNames(value).forEach((prop) => { err[prop] = value[prop]; });
                    return err;
                }
                return value;
            });

            // ConfigRoute.initRoutes(this.app);
            StateRoute.initRoutes(this.app);
            // UtilitiesRoute.initRoutes(this.app);

            // The socket initialization needs to occur before we start listening.  If we don't then
            // the headers from the server will not be picked up.
            this.initSockets();
            this.app.use((error, req, res, next) => {
                console.error(error);
                if (!res.headersSent) {
                    let httpCode = error.httpCode || 500;
                    res.status(httpCode).send(error);
                }
            });

            // start our server on port
            this.server.listen(cfg.port, cfg.ip, function () {
                console.info('Server is now listening on %s:%s', cfg.ip, cfg.port);
            });
            this.isRunning = true;
        }
    }
}

export const webApp = new WebServer();
