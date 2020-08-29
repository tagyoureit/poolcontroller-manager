import { state, TankPumpState } from './State';
import { tankPump } from '../devices/TankPump';
import { probeController } from '../devices/AtlasScientific';
import { PSIGauge } from '../devices/ADS1x15';
import axios from 'axios';
import { rejects } from 'assert';
import { logger } from '../logger/Logger';
export class Controller {

    public tankPumps: TankPumpCommands = new TankPumpCommands();
    public probes: ProbeCommands = new ProbeCommands();
    public psiGauge: PSICommands = new PSICommands();
    public httpComms: HTTPCommands = new HTTPCommands();

    private _timer: NodeJS.Timeout;
    public mainLoop = async () => {
        try {
            let dt = new Date();
            if (typeof this._timer !== 'undefined') {
                clearTimeout(this._timer);
                this._timer = null;
            }
            logger.info(`Readings at ${state._lastUpdated.toLocaleTimeString()}`);

            // get PSI (is pump running) and tank levels
            // stop pump when necessary
            await controller.psiGauge.readPSIAsync();
            if (controller.tankPumps.runPumpCheck()) {
                controller.tankPumps.runPumps();
            }
            else {
                controller.tankPumps.stopPumps();
            }

            // every 1 mins
            if (dt.getSeconds() % 60 === 0) {
                await controller.probes.readProbes()
                try {
                    let chlorSetpoint = await controller.httpComms.getChlorSetpoint()
                    let orpProbe = state.probes.getItemById(1);
                    let isOver = orpProbe.orpLevel > orpProbe.orpSetpoint;
                    let newSetpoint = -1;
                    if (isOver && chlorSetpoint > 2) newSetpoint = 2;
                    if (!isOver && chlorSetpoint <= 50) newSetpoint = 50;
                    if (newSetpoint > 0) await controller.httpComms.updateServerChlorinator(newSetpoint);
                }
                catch (err) {
                    console.error(`Trouble updating server chlorinator: ${err.message}`)
                }
            }

            if (dt.getHours() === 0 && dt.getMinutes() === 0 && dt.getSeconds() === 0) {
                controller.tankPumps.resetRunTime();

            }
            // run this every 5 seconds (get new date to account for async stuff)
            this._timer = setTimeout(function () {
                controller.mainLoop();
            }, (5 - (new Date().getSeconds() % 5)) * 1000);
        }
        catch (err) {
            logger.error(`Error in main loop: ${err}`)
        }
    }
}

export class TankPumpCommands {
    public readTankLevels() {
        let stank1 = state.tankPumps.getItemById(1);
        let stank2 = state.tankPumps.getItemById(2);
        tankPump.readSensor(stank1);
        tankPump.readSensor(stank2);
    }
    public runPumpCheck = () => {
        this.readTankLevels();
        let anyTankNotEmpty = this.anyTankNotEmpty();
        let hasFlow = controller.psiGauge.hasFlow();
        let needsAcid = controller.probes.needsAcid();
        let bRunPumps = anyTankNotEmpty && hasFlow && needsAcid;
        logger.info(` * Run Pumps?: ${bRunPumps}`);
        if (bRunPumps) {
            return true;
        }
        else {
            if (!anyTankNotEmpty) logger.info(`   * tanks have acid: ${anyTankNotEmpty}`);
            if (!hasFlow) logger.info(`   * has flow: ${hasFlow}`);
            if (!needsAcid) logger.info(`   * needsAcid: ${needsAcid}`);
            return false;
        }
    }


    public anyTankNotEmpty() { return state.tankPumps.get(true).reduce((acc, val) => acc || !val.isEmpty, false) }
    public bothTanksEmpty() { return state.tankPumps.get(true).reduce((acc, val) => acc && val.isEmpty, true) }

    public runPumps() {
        let stank1 = state.tankPumps.getItemById(1);
        let stank2 = state.tankPumps.getItemById(2);
        tankPump.runPump(stank1);
        tankPump.runPump(stank2);
    }
    public stopPumps() {
        let stank1 = state.tankPumps.getItemById(1);
        let stank2 = state.tankPumps.getItemById(2);
        tankPump.stopPump(stank1);
        tankPump.stopPump(stank2);
    }

    public resetRunTime = () => {
        let stank1 = state.tankPumps.getItemById(1);
        let stank2 = state.tankPumps.getItemById(2);
        stank1.currentDailyRunMins = 0;
        stank2.currentDailyRunMins = 0;
        state.chemController.warnings.orpDailyLimitReached = state.chemController.options.warnings.find(el => el.name === 'ok');
        state.chemController.warnings.pHDailyLimitReached = state.chemController.options.warnings.find(el => el.name === 'ok');
    }
    public calcRunningTime = (tank: TankPumpState, bStop: boolean) => {
        if (typeof tank.lastStartTime !== 'undefined')
            tank.currentDailyRunMins = (tank.currentDailyRunMins || 0) + (new Date().valueOf() - tank.lastStartTime) / 1000 / 60;
        if (bStop) tank.lastStartTime = undefined;
        else tank.lastStartTime = new Date().valueOf();
    }
}

export class ProbeCommands {
    public setPHProbeTemp = async () => {
        let pHProbe = state.probes.getItemById(2, true);
        await probeController.setTemp(pHProbe);
    }
    public needsAcid = (): boolean => {
        let pHProbe = state.probes.getItemById(2, true);
        if (pHProbe.pHSetpoint < pHProbe.pHLevel) return true;
        return false;
    }
    public readProbes = async () => {
        let orpProbe = state.probes.getItemById(1, true);
        let resORP = await probeController.readMeasurement(orpProbe);
        let pHProbe = state.probes.getItemById(2, true);
        let resPH = await probeController.readMeasurement(pHProbe);
        logger.info(` * ORP : ${resORP}`); // uses color here but not with string interpolation
        logger.info(` * pH  : ${resPH}`);

    }
    public setData = (obj: any) => {
        let orpProbe = state.probes.getItemById(1, true);
        if (typeof obj.orpSetpoint !== 'undefined') orpProbe.orpSetpoint = obj.orpSetpoint;
        let pHProbe = state.probes.getItemById(2, true);
        if (typeof obj.pHSetpoint !== 'undefined') pHProbe.pHSetpoint = obj.pHSetpoint;
        if (typeof obj.waterSensor1 !== 'undefined') pHProbe.temp = obj.waterSensor1; // from temp emit
        if (typeof obj.temp !== 'undefined') pHProbe.temp = obj.temp; // from chemController emit
        if (typeof obj.units?.name !== 'undefined') pHProbe.tempUnits = obj.units.name;
        this.setPHProbeTemp();
    }
}

export class PSICommands {
    public readPSIAsync = async () => {
        await PSIGauge.getPSIAsync();
        logger.info(` * PSI : ${Math.round((state.pressureGauge.psi + Number.EPSILON) * 100) / 100}`)
        if (controller.psiGauge.hasFlow()) {
            let chem = state.chemController;
            let alarms = chem.alarms;
            let flow = alarms.flow;
            state.chemController.alarms.flow = state.chemController.options.alarms.flow.find(wf => wf.name === 'ok').val;
        }
        else {
            let chem = state.chemController;
            let alarms = chem.alarms;
            let flow = alarms.flow;
            let options = chem.options;
            state.chemController.alarms.flow = state.chemController.options.alarms.flow.find(wf => wf.name === 'noflow').val;
        }
    }
    public hasFlow = () => {
        return state.pressureGauge.psi > 3;
    }
}

export class HTTPCommands {
    public baseURL = () => {
        return `${state.serverOptions.protocol}${state.serverOptions.host}:${state.serverOptions.port}`
    }

    public loadOptionsAsync = async () => {
        return new Promise( async (resolve, reject) => {

            try {
                logger.debug(`Connecting to ${this.baseURL()}`);
                
                let res = await axios.get(
                    `${this.baseURL()}/config/options/chemControllers`
                    )
                    // adjust for different addresses
                    let orpProbe = state.probes.getItemById(1, true);
                    if (typeof res.data.orpSetpoint !== 'undefined') orpProbe.orpSetpoint = res.data.controllers[0].orpSetpoint;
                    let pHProbe = state.probes.getItemById(2, true);
                    if (typeof res.data.pHSetpoint !== 'undefined') pHProbe.pHSetpoint = res.data.controllers[0].pHSetpoint;
                    delete res.data.controllers;
                    state.chemController.options = res.data;
                    resolve();
                }
                catch (err) {
                    console.error(`Error getting data from server for /config/options/chemControllers`);
                    console.error(err.message);
                    reject(err);
                }
            })
    }

    public updateServerChemController = async () => {
        try {
            let data = {
                address: 144, // TODO: update this for dynamic id/address
                alarms: {
                    flow: state.chemController.alarms.flow,
                    pHTank: state.chemController.alarms.pHTank,
                    orpTank: state.chemController.alarms.orpTank,
                },
                warnings: {
                    waterChemistry: state.chemController.warnings.waterChemistry,
                    pHDailyLimitReached: state.chemController.warnings.pHDailyLimitReached,  // not implemented yet
                    orpDailyLimitReached: state.chemController.warnings.orpDailyLimitReached, // not implemented yet
                },
                pHLevel: state.probes.getItemById(2).pHLevel,
                orpLevel: state.probes.getItemById(1).orpLevel,
                acidTankLevel: state.tankPumps.getItemById(1).isEmpty ? 0 : 6,
                orpTankLevel: state.tankPumps.getItemById(2).isEmpty ? 0 : 6,
                pHDosingTime: state.tankPumps.getItemById(1).currentDailyRunMins,
                orpDosingTime: state.tankPumps.getItemById(2).currentDailyRunMins,
                pHDosingStatus: state.tankPumps.getItemById(1).pHDosingStatus,
                orpDosingStatus: state.tankPumps.getItemById(2).orpDosingStatus,
            }
            let res = await axios.request({
                method: 'put',
                url: `${this.baseURL()}/state/chemController`,
                data
            })
            state.updateServer = false;
        }
        catch (err) {
            console.error(`Error updating server with chem controller data: ${err.message}`);
        }
    }
    public getChlorSetpoint = async () => {
        return new Promise(async (resolve, reject) => {
            try {
                let chlorRes = await axios.get(`${this.baseURL()}/state/chlorinators`);
                if (typeof chlorRes.data === 'undefined' || chlorRes.data.length === 0) reject('No chlors installed.');
                resolve(chlorRes.data[0].poolSetpoint);
            }
            catch (err) {
                reject(err);
            }
        })
    }
    public updateServerChlorinator = async (poolSetpoint: number) => {
        try {
            await axios.request({
                method: 'PUT',
                url: `${this.baseURL()}/state/chlorinator`,
                data: {
                    id: 1, // TODO: update this for dynamic id
                    poolSetpoint
                }
            })
            state.updateServer = false;
        }
        catch (err) {
            console.error(`Error updating server: ${err.message}`);
        }
    }
}

export var controller = new Controller();