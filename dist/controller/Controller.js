"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.controller = exports.HTTPCommands = exports.PSICommands = exports.ProbeCommands = exports.TankPumpCommands = exports.Controller = void 0;
const State_1 = require("./State");
const TankPump_1 = require("../devices/TankPump");
const AtlasScientific_1 = require("../devices/AtlasScientific");
const ADS1x15_1 = require("../devices/ADS1x15");
const axios_1 = require("axios");
const Logger_1 = require("../logger/Logger");
class Controller {
    constructor() {
        this.tankPumps = new TankPumpCommands();
        this.probes = new ProbeCommands();
        this.psiGauge = new PSICommands();
        this.httpComms = new HTTPCommands();
        this.mainLoop = async () => {
            try {
                let dt = new Date();
                if (typeof this._timer !== 'undefined') {
                    clearTimeout(this._timer);
                    this._timer = null;
                }
                Logger_1.logger.info(`Readings at ${State_1.state._lastUpdated.toLocaleTimeString()}`);
                await exports.controller.psiGauge.readPSIAsync();
                if (exports.controller.tankPumps.runPumpCheck()) {
                    exports.controller.tankPumps.runPumps();
                }
                else {
                    exports.controller.tankPumps.stopPumps();
                }
                if (dt.getSeconds() % 60 === 0) {
                    await exports.controller.probes.readProbes();
                    try {
                        let chlorSetpoint = await exports.controller.httpComms.getChlorSetpoint();
                        let orpProbe = State_1.state.probes.getItemById(1);
                        let isOver = orpProbe.orpLevel > orpProbe.orpSetpoint;
                        let newSetpoint = -1;
                        if (isOver && chlorSetpoint > 2)
                            newSetpoint = 2;
                        if (!isOver && chlorSetpoint <= 50)
                            newSetpoint = 50;
                        if (newSetpoint > 0)
                            await exports.controller.httpComms.updateServerChlorinator(newSetpoint);
                    }
                    catch (err) {
                        console.error(`Trouble updating server chlorinator: ${err.message}`);
                    }
                }
                if (dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0) {
                    exports.controller.tankPumps.resetRunTime();
                }
                this._timer = setTimeout(function () {
                    exports.controller.mainLoop();
                }, (5 - (new Date().getSeconds() % 5)) * 1000);
            }
            catch (err) {
                Logger_1.logger.error(`Error in main loop: ${err}`);
            }
        };
    }
}
exports.Controller = Controller;
class TankPumpCommands {
    constructor() {
        this.runPumpCheck = () => {
            this.readTankLevels();
            let anyTankNotEmpty = this.anyTankNotEmpty();
            let hasFlow = exports.controller.psiGauge.hasFlow();
            let needsAcid = exports.controller.probes.needsAcid();
            let bRunPumps = anyTankNotEmpty && hasFlow && needsAcid;
            Logger_1.logger.info(` * Run Pumps?: ${bRunPumps}`);
            if (bRunPumps) {
                return true;
            }
            else {
                if (!anyTankNotEmpty)
                    Logger_1.logger.info(`   * tanks have acid: ${anyTankNotEmpty}`);
                if (!hasFlow)
                    Logger_1.logger.info(`   * has flow: ${hasFlow}`);
                if (!needsAcid)
                    Logger_1.logger.info(`   * needsAcid: ${needsAcid}`);
                return false;
            }
        };
        this.resetRunTime = () => {
            let stank1 = State_1.state.tankPumps.getItemById(1);
            let stank2 = State_1.state.tankPumps.getItemById(2);
            stank1.currentDailyRunMins = 0;
            stank2.currentDailyRunMins = 0;
            State_1.state.chemController.warnings.orpDailyLimitReached = State_1.state.chemController.options.warnings.find(el => el.name === 'ok');
            State_1.state.chemController.warnings.pHDailyLimitReached = State_1.state.chemController.options.warnings.find(el => el.name === 'ok');
        };
        this.calcRunningTime = (tank, bStop) => {
            if (typeof tank.lastStartTime !== 'undefined')
                tank.currentDailyRunMins = (tank.currentDailyRunMins || 0) + (new Date().valueOf() - tank.lastStartTime) / 1000 / 60;
            if (bStop)
                tank.lastStartTime = undefined;
            else
                tank.lastStartTime = new Date().valueOf();
        };
    }
    readTankLevels() {
        let stank1 = State_1.state.tankPumps.getItemById(1);
        let stank2 = State_1.state.tankPumps.getItemById(2);
        TankPump_1.tankPump.readSensor(stank1);
        TankPump_1.tankPump.readSensor(stank2);
    }
    anyTankNotEmpty() { return State_1.state.tankPumps.get(true).reduce((acc, val) => acc || !val.isEmpty, false); }
    bothTanksEmpty() { return State_1.state.tankPumps.get(true).reduce((acc, val) => acc && val.isEmpty, true); }
    runPumps() {
        let stank1 = State_1.state.tankPumps.getItemById(1);
        let stank2 = State_1.state.tankPumps.getItemById(2);
        TankPump_1.tankPump.runPump(stank1);
        TankPump_1.tankPump.runPump(stank2);
    }
    stopPumps() {
        let stank1 = State_1.state.tankPumps.getItemById(1);
        let stank2 = State_1.state.tankPumps.getItemById(2);
        TankPump_1.tankPump.stopPump(stank1);
        TankPump_1.tankPump.stopPump(stank2);
    }
}
exports.TankPumpCommands = TankPumpCommands;
class ProbeCommands {
    constructor() {
        this.setPHProbeTemp = async () => {
            let pHProbe = State_1.state.probes.getItemById(2, true);
            await AtlasScientific_1.probeController.setTemp(pHProbe);
        };
        this.needsAcid = () => {
            let pHProbe = State_1.state.probes.getItemById(2, true);
            if (pHProbe.pHSetpoint < pHProbe.pHLevel)
                return true;
            return false;
        };
        this.readProbes = async () => {
            let orpProbe = State_1.state.probes.getItemById(1, true);
            let resORP = await AtlasScientific_1.probeController.readMeasurement(orpProbe);
            let pHProbe = State_1.state.probes.getItemById(2, true);
            let resPH = await AtlasScientific_1.probeController.readMeasurement(pHProbe);
            Logger_1.logger.info(` * ORP : ${resORP}`);
            Logger_1.logger.info(` * pH  : ${resPH}`);
        };
        this.setData = (obj) => {
            var _a;
            let orpProbe = State_1.state.probes.getItemById(1, true);
            if (typeof obj.orpSetpoint !== 'undefined')
                orpProbe.orpSetpoint = obj.orpSetpoint;
            let pHProbe = State_1.state.probes.getItemById(2, true);
            if (typeof obj.pHSetpoint !== 'undefined')
                pHProbe.pHSetpoint = obj.pHSetpoint;
            if (typeof obj.waterSensor1 !== 'undefined')
                pHProbe.temp = obj.waterSensor1;
            if (typeof obj.temp !== 'undefined')
                pHProbe.temp = obj.temp;
            if (typeof ((_a = obj.units) === null || _a === void 0 ? void 0 : _a.name) !== 'undefined')
                pHProbe.tempUnits = obj.units.name;
            this.setPHProbeTemp();
        };
    }
}
exports.ProbeCommands = ProbeCommands;
class PSICommands {
    constructor() {
        this.readPSIAsync = async () => {
            await ADS1x15_1.PSIGauge.getPSIAsync();
            Logger_1.logger.info(` * PSI : ${Math.round((State_1.state.pressureGauge.psi + Number.EPSILON) * 100) / 100}`);
            if (exports.controller.psiGauge.hasFlow()) {
                let chem = State_1.state.chemController;
                let alarms = chem.alarms;
                let flow = alarms.flow;
                State_1.state.chemController.alarms.flow = State_1.state.chemController.options.alarms.flow.find(wf => wf.name === 'ok').val;
            }
            else {
                let chem = State_1.state.chemController;
                let alarms = chem.alarms;
                let flow = alarms.flow;
                let options = chem.options;
                State_1.state.chemController.alarms.flow = State_1.state.chemController.options.alarms.flow.find(wf => wf.name === 'noflow').val;
            }
        };
        this.hasFlow = () => {
            return State_1.state.pressureGauge.psi > 3;
        };
    }
}
exports.PSICommands = PSICommands;
class HTTPCommands {
    constructor() {
        this.baseURL = () => {
            return `${State_1.state.serverOptions.protocol}${State_1.state.serverOptions.host}:${State_1.state.serverOptions.port}`;
        };
        this.loadOptionsAsync = async () => {
            return new Promise(async (resolve, reject) => {
                try {
                    Logger_1.logger.debug(`Connecting to ${this.baseURL()}`);
                    let res = await axios_1.default.get(`${this.baseURL()}/config/options/chemControllers`);
                    let orpProbe = State_1.state.probes.getItemById(1, true);
                    if (typeof res.data.orpSetpoint !== 'undefined')
                        orpProbe.orpSetpoint = res.data.controllers[0].orpSetpoint;
                    let pHProbe = State_1.state.probes.getItemById(2, true);
                    if (typeof res.data.pHSetpoint !== 'undefined')
                        pHProbe.pHSetpoint = res.data.controllers[0].pHSetpoint;
                    delete res.data.controllers;
                    State_1.state.chemController.options = res.data;
                    resolve();
                }
                catch (err) {
                    console.error(`Error getting data from server for /config/options/chemControllers`);
                    console.error(err.message);
                    reject(err);
                }
            });
        };
        this.updateServerChemController = async () => {
            try {
                let data = {
                    address: 144,
                    alarms: {
                        flow: State_1.state.chemController.alarms.flow,
                        pHTank: State_1.state.chemController.alarms.pHTank,
                        orpTank: State_1.state.chemController.alarms.orpTank,
                    },
                    warnings: {
                        waterChemistry: State_1.state.chemController.warnings.waterChemistry,
                        pHDailyLimitReached: State_1.state.chemController.warnings.pHDailyLimitReached,
                        orpDailyLimitReached: State_1.state.chemController.warnings.orpDailyLimitReached,
                    },
                    pHLevel: State_1.state.probes.getItemById(2).pHLevel,
                    orpLevel: State_1.state.probes.getItemById(1).orpLevel,
                    acidTankLevel: State_1.state.tankPumps.getItemById(1).isEmpty ? 0 : 6,
                    orpTankLevel: State_1.state.tankPumps.getItemById(2).isEmpty ? 0 : 6,
                    pHDosingTime: State_1.state.tankPumps.getItemById(1).currentDailyRunMins,
                    orpDosingTime: State_1.state.tankPumps.getItemById(2).currentDailyRunMins,
                    pHDosingStatus: State_1.state.tankPumps.getItemById(1).pHDosingStatus,
                    orpDosingStatus: State_1.state.tankPumps.getItemById(2).orpDosingStatus,
                };
                let res = await axios_1.default.request({
                    method: 'put',
                    url: `${this.baseURL()}/state/chemController`,
                    data
                });
                State_1.state.updateServer = false;
            }
            catch (err) {
                console.error(`Error updating server with chem controller data: ${err.message}`);
            }
        };
        this.getChlorSetpoint = async () => {
            return new Promise(async (resolve, reject) => {
                try {
                    let chlorRes = await axios_1.default.get(`${this.baseURL()}/state/chlorinators`);
                    if (typeof chlorRes.data === 'undefined' || chlorRes.data.length === 0)
                        reject('No chlors installed.');
                    resolve(chlorRes.data[0].poolSetpoint);
                }
                catch (err) {
                    reject(err);
                }
            });
        };
        this.updateServerChlorinator = async (poolSetpoint) => {
            try {
                await axios_1.default.request({
                    method: 'PUT',
                    url: `${this.baseURL()}/state/chlorinator`,
                    data: {
                        id: 1,
                        poolSetpoint
                    }
                });
                State_1.state.updateServer = false;
            }
            catch (err) {
                console.error(`Error updating server: ${err.message}`);
            }
        };
    }
}
exports.HTTPCommands = HTTPCommands;
exports.controller = new Controller();
//# sourceMappingURL=Controller.js.map