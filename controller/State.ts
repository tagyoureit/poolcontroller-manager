var extend = require('extend');
import * as fs from 'fs'
import * as path from 'path';
import { controller } from './Controller';
import { logger } from '../logger/Logger';

export class State {
    constructor() { this.statePath = path.posix.join(process.cwd(), '/data/PCMData.json'); }
    statePath: string;
    data: any;
    private _isDirty: boolean;
    private _timerDirty: NodeJS.Timeout;
    public _lastUpdated: Date = new Date();
    private _updateServer = false;
    private _updateServerTimerDirty: NodeJS.Timeout;
    public get updateServer(): boolean { return this._updateServer; }
    public set updateServer(val: boolean) {
        // TODO: think more about this logic; if it only increments 0.01%
        // but it does so continually, will this get triggered?
        // or do I need a "static" last update value or go based off 
        // diff from the target?
        this._updateServer = val;
        if (this._updateServer) {
            clearTimeout(this._updateServerTimerDirty);
            this._updateServerTimerDirty = null;
            this._updateServerTimerDirty = setTimeout(async function () { await controller.httpComms.updateServerChemController(); }, 3000);
        }
    }
    public getState() {
        return this.data;
    }
    public init() {
        logger.info(`Init state for Pool Controller Manager`);
        var state = this.loadFile(this.statePath, {});
        var self = this;
        this.data = this.onchange(state, function () {
            self.dirty = true;
        });
        this.tankPumps = new TankPumpCollection(this.data, 'tankPumps');
        this.pressureGauge = new PressureGauge(this.data, 'pressureGauge');
        this.probes = new AtlasScientificStateCollection(this.data, 'probes');
        this.serverOptions = new ServerOptions(this.data, 'serverOptions');
        this.chemController = new ChemController(this.data, 'chemController');
    }

    protected onchange = (obj, fn) => {
        const handler = {
            get(target, property, receiver) {
                const val = Reflect.get(target, property, receiver);
                if (typeof val === 'function') return val.bind(receiver);
                if (typeof (val) === 'object' && val !== null) {
                    return new Proxy(val, handler);
                }
                return val;
            },
            set(target, property, value, receiver) {
                if (property !== 'lastUpdated' && Reflect.get(target, property, receiver) !== value) {
                    fn();
                }
                return Reflect.set(target, property, value, receiver);
            },
            deleteProperty(target, property) {
                if (property in target) {
                    delete target[property];
                }
                return true;
            }
        };
        return new Proxy(obj, handler);
    };

    public tankPumps: TankPumpCollection;
    public pressureGauge: PressureGauge;
    public probes: AtlasScientificStateCollection;
    public serverOptions: ServerOptions;
    public chemController: ChemController;
    public get lastComm(): Date { return new Date(this.data.lastComm); }
    public set lastComm(val: Date) { this.data.lastComm = val.toLocaleString() };
    public get dirty(): boolean { return this._isDirty; }
    public set dirty(val) {
        var self = this;
        if (val !== this._isDirty) {
            self._lastUpdated = new Date();
            self.data.lastUpdated = self._lastUpdated.toLocaleString();
            this._isDirty = val;
            if (this._timerDirty) {
                clearTimeout(this._timerDirty);
                this._timerDirty = null;
            }
            if (this._isDirty) this._timerDirty = setTimeout(function () { self.persist(); }, 3000);
        }
    }
    // This performs a safe load of the state file.  If the file gets corrupt or actually does not exist
    // it will not break the overall system and allow hardened recovery.
    private loadFile(path: string, def: any) {
        let state = def;
        if (!fs.existsSync('data')) fs.mkdirSync('data');
        try {
            state = JSON.parse(fs.readFileSync(path, 'utf8') || '{}');
        }
        catch (ex) {
            state = def;
        }
        return state;
    }
    public persist() {
        this._isDirty = false;
        var self = this;
        Promise.resolve()
            .then(() => {
                fs.writeFileSync(self.statePath, JSON.stringify(self.data, undefined, 2));
            })
            .catch(function (err) { if (err) logger.info(`Error writing pool state ${err} ${self.statePath}`); });
    }
    public async stopAsync() {
        if (this._timerDirty) clearTimeout(this._timerDirty);
        this.persist();
        await controller.httpComms.updateServerChemController();
        return Promise.resolve();
    }
}


interface IEqStateCreator<T> { ctor(data: any, name: string): T; }
class EqState implements IEqStateCreator<EqState> {
    public dataName: string;
    public data: any;
    ctor(data, name?: string): EqState { return new EqState(data, name); }
    constructor(data, name?: string) {
        if (typeof (name) !== 'undefined') {
            if (typeof (data[name]) === 'undefined') data[name] = {};
            this.data = data[name];
            this.dataName = name;
        }
        else
            this.data = data;
    }
    public get(bCopy?: boolean): any {
        if (typeof bCopy === 'undefined' || !bCopy) return this.data;
        let copy = extend(true, {}, this.data);
        if (typeof this.dataName !== 'undefined') copy.equipmentType = this.dataName;
        // RSG 7/10/2020 - nested object were still being returned as proxy; changed to parse/stringify
        return JSON.parse(JSON.stringify(copy));
    }
    protected setDataVal(name, val, persist?: boolean): any {
        if (this.data[name] !== val) {
            // logger.info(`Changing state: ${ this.dataName } ${ this.data.id } ${ name }:${ this.data[name] } --> ${ val }`);
            let prevVal = this.data[name];
            this.data[name] = val;
            let tolerance = 0.05;
            if (name === 'psi') tolerance = 5
            if (Math.abs((prevVal - val) / val * 100) > tolerance) state.updateServer = true;
            if (persist) state.updateServer = true;
        }
        // Added for chaining.
        return this.data[name];
    }
}
class EqStateCollection<T> {
    protected data: any;
    constructor(data: [], name: string) {
        if (typeof (data[name]) === 'undefined') data[name] = [];
        this.data = data[name];
    }
    public getItemById(id: number, add?: boolean, data?: any): T {
        for (let i = 0; i < this.data.length; i++)
            if (typeof this.data[i].id !== 'undefined' && this.data[i].id === id) {
                return this.createItem(this.data[i]);
            }
        if (typeof add !== 'undefined' && add)
            return this.add(data || { id: id });
        return this.createItem(data || { id: id });
    }
    public getItemByVal(val: number, add?: boolean, data?: any): T {
        for (let i = 0; i < this.data.length; i++)
            if (typeof this.data[i].val !== 'undefined' && this.data[i].val === val) {
                return this.createItem(this.data[i]);
            }
        if (typeof add !== 'undefined' && add)
            return this.add(data || { val });
        return this.createItem(data || { val });
    }
    public getItemByIndex(ndx: number, add?: boolean): T {
        return (this.data.length > ndx) ? this.createItem(this.data[ndx]) : (typeof (add) !== 'undefined' && add) ? this.add(this.createItem({ id: ndx + 1 })) : this.createItem({ id: ndx + 1 });
    }
    public removeItemById(id: number): T {
        let rem: T = null;
        for (let i = 0; i < this.data.length; i++) {
            if (typeof (this.data[i].id) !== 'undefined' && this.data[i].id === id) {
                rem = this.data.splice(i, 1);
            }
        }
        return rem;
    }
    public createItem(data: any): T { return new EqState(data) as unknown as T; }
    public clear() { this.data.length = 0; }
    public get length(): number { return typeof (this.data) !== 'undefined' ? this.data.length : 0; }
    public add(obj: any): T { this.data.push(obj); return this.createItem(obj); }
    public sortByName() {
        this.sort((a, b) => {
            return a.name > b.name ? 1 : a.name !== b.name ? -1 : 0;
        });
    }
    public sortById() {
        this.sort((a, b) => {
            return a.id > b.id ? 1 : a.id !== b.id ? -1 : 0;
        });
    }
    public sort(fn: (a, b) => number) { this.data.sort(fn); }
    public get(bCopy?: boolean) { return typeof bCopy === 'undefined' || !bCopy ? this.data : JSON.parse(JSON.stringify(this.data)); }
    // Finds an item and returns undefined if it doesn't exist.
    public find(f: (value: any, index?: number, obj?: any) => boolean): T {
        let itm = this.data.find(f);
        if (typeof itm !== 'undefined') return this.createItem(itm);
    }
}


export class AtlasScientificStateCollection extends EqStateCollection<AtlasScientificState>{
    public createItem(data: any): AtlasScientificState { return new AtlasScientificState(data); }
}

export class AtlasScientificState extends EqState {
    public dataName: string = 'probe';
    public get id(): number { return this.data.id };
    public set id(val: number) { this.data.id = val };
    public get address(): number { return this.data.address };
    public set address(val: number) { this.data.address = val };
    public get type(): string { return this.data.type };
    public set type(val: string) { this.data.type = val };
    public get delay(): number { return this.data.delay };
    public set delay(val: number) { this.data.delay = val };
    public get orpLevel(): number { return this.data.orpLevel };
    public set orpLevel(val: number) { this.setDataVal('orpLevel', val); };
    public get pHLevel(): number { return this.data.pHLevel };
    public set pHLevel(val: number) { this.setDataVal('pHLevel', val); };
    public get orpSetpoint(): number { return this.data.orpSetpoint };
    public set orpSetpoint(val: number) { this.data.orpSetpoint = val };
    public get pHSetpoint(): number { return this.data.pHSetpoint };
    public set pHSetpoint(val: number) { this.data.pHSetpoint = val };
    public get temp(): number { return this.data.temp };
    public set temp(val: number) { this.data.temp = val };
    public get tempUnits(): string { return this.data.tempUnits };
    public set tempUnits(val: string) { this.data.tempUnits = val };
}
export class TankPumpCollection extends EqStateCollection<TankPumpState>{
    public createItem(data: any): TankPumpState { return new TankPumpState(data); }

}

export class TankPumpState extends EqState {
    public dataName: string = 'tankPump';
    public get id(): number { return this.data.id };
    public set id(val: number) { this.data.id = val };
    public get type(): string { return this.data.type };
    public set type(val: string) { this.data.type = val };
    public get isOn(): boolean { return this.data.isOn };
    public set isOn(val: boolean) { this.setDataVal('isOn', val); };
    public get isEmpty(): boolean { return this.data.isEmpty };
    public set isEmpty(val: boolean) { this.setDataVal('isEmpty', val); };
    public get pumpAddress(): number { return this.data.tankAddress };
    public set pumpAddress(val: number) { this.data.tankAddress = val };
    public get sensorAddress(): number { return this.data.sensorAddress };
    public set sensorAddress(val: number) { this.data.sensorAddress = val };
    public get maxDailyRunMins(): number { return this.data.maxDailyRunMins };
    public set maxDailyRunMins(val: number) { this.data.maxDailyRunMins = val };
    public get currentDailyRunMins(): number { return this.data.currentDailyRunMins || 0 };
    public set currentDailyRunMins(val: number) { this.setDataVal('currentDailyRunMins', val, true); };
    public get lastStartTime(): number { return this.data.lastStartTime };
    public set lastStartTime(val: number) { this.data.lastStartTime = val };
    public get pHDosingStatus(): number { return typeof this.data.pHDosingStatus !== 'undefined' ? this.data.pHDosingStatus.val : undefined };

    public set pHDosingStatus(val: number) {
        if (this.pHDosingStatus !== val) {
            this.data.pHDosingStatus = state.chemController.options.dosingStatus.find(el => val === el.val);
            state.updateServer = true;
        }
    };
    public get orpDosingStatus(): number { return typeof this.data.orpDosingStatus !== 'undefined' ? this.data.orpDosingStatus.val : undefined };
    public set orpDosingStatus(val: number) {
        if (this.orpDosingStatus !== val) {
            this.data.orpDosingStatus = state.chemController.options.dosingStatus.find(el => val === el.val);
            state.updateServer = true;
        }
    };
}

export class SensorCollection extends EqStateCollection<SensorState>{
    public createItem(data: any): SensorState { return new SensorState(data); }
}

export class SensorState extends EqState {
    public dataName: string = 'sensor';
    public get id(): number { return this.data.id };
    public set id(val: number) { this.data.id = val };
    public get voltage(): number { return this.data.voltage };
    public set voltage(val: number) { this.data.voltage = val };
    public get address(): number { return this.data.address };
    public set address(val: number) { this.data.address = val };
    public get channel(): number { return this.data.channel };
    public set channel(val: number) { this.data.channel = val };
}

export class PressureGauge extends EqState {
    public dataName: string = 'pressureGauge';
    public get chip(): string { return this.data.chip };
    public set chip(val: string) { this.data.chip = val };
    public get address(): number { return this.data.address };
    public set address(val: number) { this.data.address = val };
    public get channel(): number { return this.data.channel };
    public set channel(val: number) { this.data.channel = val };
    public get pga(): number { return this.data.pga };
    public set pga(val: number) { this.data.pga = val };
    public get sps(): number { return this.data.sps };
    public set sps(val: number) { this.data.sps = val };
    public get psi(): number { return this.data.psi };
    public set psi(val: number) { this.setDataVal('psi', val); };
}
export class ServerOptions extends EqState {
    public dataName: string = 'serverOptions';
    public get protocol(): string { return this.data.protocol };
    public set protocol(val: string) { this.data.protocol = val };
    public get host(): string { return this.data.host };
    public set host(val: string) { this.data.host = val };
    public get port(): number { return this.data.port };
    public set port(val: number) { this.data.port = val };

}
export class ChemController extends EqState {
    public dataName: string = 'chemController';
    public get options(): any { return this.data.options || {} };
    public set options(val: any) { this.data.options = val };
    public get alarms(): AlarmsCollection { return new AlarmsCollection(this.data, "alarms") };
    public get warnings(): WarningsCollection { return new WarningsCollection(this.data, "warnings") };
}
export class AlarmsCollection extends EqState {
    ctor(data): AlarmsCollection { return new AlarmsCollection(data, name || 'alarms'); }
    public dataName = 'chemControllerAlarms';
    public get flow(): number { return typeof this.data.flow === 'undefined' ? undefined : this.data.flow.val; }
    public set flow(val: number) {
        if (this.flow !== val) {
            this.data.flow = state.chemController.options.alarms.flow.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get pHTank(): number { return typeof this.data.pHTank === 'undefined' ? undefined : this.data.pHTank.val; }
    public set pHTank(val: number) {
        if (this.pHTank !== val) {
            this.data.pHTank = state.chemController.options.alarms.pHTank.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get orpTank(): number { return typeof this.data.orpTank === 'undefined' ? undefined : this.data.orpTank.val; }
    public set orpTank(val: number) {
        if (this.orpTank !== val) {
            this.data.orpTank = state.chemController.options.alarms.orpTank.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get pH(): number { return typeof this.data.pH === 'undefined' ? undefined : this.data.pH.val; }
    public set pH(val: number) {
        if (this.pH !== val) {
            this.data.pH = state.chemController.options.alarms.pH.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get orp(): number { return typeof this.data.orp === 'undefined' ? undefined : this.data.orp.val; }
    public set orp(val: number) {
        if (this.orp !== val) {
            this.data.orp = state.chemController.options.alarms.orp.find(el => val === el.val);
            state.updateServer = true;
        }
    }
}
export class WarningsCollection extends EqState {
    ctor(data): WarningsCollection { return new WarningsCollection(data, name || 'warnings'); }
    public dataName = 'chemControllerWarnings';
    public get waterChemistry(): number { return typeof this.data.waterChemistry === 'undefined' ? undefined : this.data.waterChemistry.val; }
    public set waterChemistry(val: number) {
        if (this.waterChemistry !== val) {
            this.data.waterChemistry = state.chemController.options.warnings.waterChemistry.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get pHDailyLimitReached(): number { return typeof this.data.pHDailyLimitReached === 'undefined' ? undefined : this.data.pHDailyLimitReached.val; }
    public set pHDailyLimitReached(val: number) {
        if (this.pHDailyLimitReached !== val) {
            this.data.pHDailyLimitReached = state.chemController.options.warnings.pHTank.find(el => val === el.val);
            state.updateServer = true;
        }
    }
    public get orpDailyLimitReached(): number { return typeof this.data.orpDailyLimitReached === 'undefined' ? undefined : this.data.orpDailyLimitReached.val; }
    public set orpDailyLimitReached(val: number) {
        if (this.orpDailyLimitReached !== val) {
            this.data.orpDailyLimitReached = state.chemController.options.warnings.orpDailyLimitReached.find(el => val === el.val);
            state.updateServer = true;
        }
    }
}

export var state = new State();