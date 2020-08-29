"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.state = exports.WarningsCollection = exports.AlarmsCollection = exports.ChemController = exports.ServerOptions = exports.PressureGauge = exports.SensorState = exports.SensorCollection = exports.TankPumpState = exports.TankPumpCollection = exports.AtlasScientificState = exports.AtlasScientificStateCollection = exports.State = void 0;
var extend = require('extend');
const fs = require("fs");
const path = require("path");
const Controller_1 = require("./Controller");
const Logger_1 = require("../logger/Logger");
class State {
    constructor() {
        this._lastUpdated = new Date();
        this._updateServer = false;
        this.onchange = (obj, fn) => {
            const handler = {
                get(target, property, receiver) {
                    const val = Reflect.get(target, property, receiver);
                    if (typeof val === 'function')
                        return val.bind(receiver);
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
        this.statePath = path.posix.join(process.cwd(), '/data/PCMData.json');
    }
    get updateServer() { return this._updateServer; }
    set updateServer(val) {
        this._updateServer = val;
        if (this._updateServer) {
            clearTimeout(this._updateServerTimerDirty);
            this._updateServerTimerDirty = null;
            this._updateServerTimerDirty = setTimeout(async function () { await Controller_1.controller.httpComms.updateServerChemController(); }, 3000);
        }
    }
    getState() {
        return this.data;
    }
    init() {
        Logger_1.logger.info(`Init state for Pool Controller Manager`);
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
    get lastComm() { return new Date(this.data.lastComm); }
    set lastComm(val) { this.data.lastComm = val.toLocaleString(); }
    ;
    get dirty() { return this._isDirty; }
    set dirty(val) {
        var self = this;
        if (val !== this._isDirty) {
            self._lastUpdated = new Date();
            self.data.lastUpdated = self._lastUpdated.toLocaleString();
            this._isDirty = val;
            if (this._timerDirty) {
                clearTimeout(this._timerDirty);
                this._timerDirty = null;
            }
            if (this._isDirty)
                this._timerDirty = setTimeout(function () { self.persist(); }, 3000);
        }
    }
    loadFile(path, def) {
        let state = def;
        if (!fs.existsSync('data'))
            fs.mkdirSync('data');
        try {
            state = JSON.parse(fs.readFileSync(path, 'utf8') || '{}');
        }
        catch (ex) {
            state = def;
        }
        return state;
    }
    persist() {
        this._isDirty = false;
        var self = this;
        Promise.resolve()
            .then(() => {
            fs.writeFileSync(self.statePath, JSON.stringify(self.data, undefined, 2));
        })
            .catch(function (err) { if (err)
            Logger_1.logger.info(`Error writing pool state ${err} ${self.statePath}`); });
    }
    async stopAsync() {
        if (this._timerDirty)
            clearTimeout(this._timerDirty);
        this.persist();
        await Controller_1.controller.httpComms.updateServerChemController();
        return Promise.resolve();
    }
}
exports.State = State;
class EqState {
    constructor(data, name) {
        if (typeof (name) !== 'undefined') {
            if (typeof (data[name]) === 'undefined')
                data[name] = {};
            this.data = data[name];
            this.dataName = name;
        }
        else
            this.data = data;
    }
    ctor(data, name) { return new EqState(data, name); }
    get(bCopy) {
        if (typeof bCopy === 'undefined' || !bCopy)
            return this.data;
        let copy = extend(true, {}, this.data);
        if (typeof this.dataName !== 'undefined')
            copy.equipmentType = this.dataName;
        return JSON.parse(JSON.stringify(copy));
    }
    setDataVal(name, val, persist) {
        if (this.data[name] !== val) {
            let prevVal = this.data[name];
            this.data[name] = val;
            let tolerance = 0.05;
            if (name === 'psi')
                tolerance = 5;
            if (Math.abs((prevVal - val) / val * 100) > tolerance)
                exports.state.updateServer = true;
            if (persist)
                exports.state.updateServer = true;
        }
        return this.data[name];
    }
}
class EqStateCollection {
    constructor(data, name) {
        if (typeof (data[name]) === 'undefined')
            data[name] = [];
        this.data = data[name];
    }
    getItemById(id, add, data) {
        for (let i = 0; i < this.data.length; i++)
            if (typeof this.data[i].id !== 'undefined' && this.data[i].id === id) {
                return this.createItem(this.data[i]);
            }
        if (typeof add !== 'undefined' && add)
            return this.add(data || { id: id });
        return this.createItem(data || { id: id });
    }
    getItemByVal(val, add, data) {
        for (let i = 0; i < this.data.length; i++)
            if (typeof this.data[i].val !== 'undefined' && this.data[i].val === val) {
                return this.createItem(this.data[i]);
            }
        if (typeof add !== 'undefined' && add)
            return this.add(data || { val });
        return this.createItem(data || { val });
    }
    getItemByIndex(ndx, add) {
        return (this.data.length > ndx) ? this.createItem(this.data[ndx]) : (typeof (add) !== 'undefined' && add) ? this.add(this.createItem({ id: ndx + 1 })) : this.createItem({ id: ndx + 1 });
    }
    removeItemById(id) {
        let rem = null;
        for (let i = 0; i < this.data.length; i++) {
            if (typeof (this.data[i].id) !== 'undefined' && this.data[i].id === id) {
                rem = this.data.splice(i, 1);
            }
        }
        return rem;
    }
    createItem(data) { return new EqState(data); }
    clear() { this.data.length = 0; }
    get length() { return typeof (this.data) !== 'undefined' ? this.data.length : 0; }
    add(obj) { this.data.push(obj); return this.createItem(obj); }
    sortByName() {
        this.sort((a, b) => {
            return a.name > b.name ? 1 : a.name !== b.name ? -1 : 0;
        });
    }
    sortById() {
        this.sort((a, b) => {
            return a.id > b.id ? 1 : a.id !== b.id ? -1 : 0;
        });
    }
    sort(fn) { this.data.sort(fn); }
    get(bCopy) { return typeof bCopy === 'undefined' || !bCopy ? this.data : JSON.parse(JSON.stringify(this.data)); }
    find(f) {
        let itm = this.data.find(f);
        if (typeof itm !== 'undefined')
            return this.createItem(itm);
    }
}
class AtlasScientificStateCollection extends EqStateCollection {
    createItem(data) { return new AtlasScientificState(data); }
}
exports.AtlasScientificStateCollection = AtlasScientificStateCollection;
class AtlasScientificState extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'probe';
    }
    get id() { return this.data.id; }
    ;
    set id(val) { this.data.id = val; }
    ;
    get address() { return this.data.address; }
    ;
    set address(val) { this.data.address = val; }
    ;
    get type() { return this.data.type; }
    ;
    set type(val) { this.data.type = val; }
    ;
    get delay() { return this.data.delay; }
    ;
    set delay(val) { this.data.delay = val; }
    ;
    get orpLevel() { return this.data.orpLevel; }
    ;
    set orpLevel(val) { this.setDataVal('orpLevel', val); }
    ;
    get pHLevel() { return this.data.pHLevel; }
    ;
    set pHLevel(val) { this.setDataVal('pHLevel', val); }
    ;
    get orpSetpoint() { return this.data.orpSetpoint; }
    ;
    set orpSetpoint(val) { this.data.orpSetpoint = val; }
    ;
    get pHSetpoint() { return this.data.pHSetpoint; }
    ;
    set pHSetpoint(val) { this.data.pHSetpoint = val; }
    ;
    get temp() { return this.data.temp; }
    ;
    set temp(val) { this.data.temp = val; }
    ;
    get tempUnits() { return this.data.tempUnits; }
    ;
    set tempUnits(val) { this.data.tempUnits = val; }
    ;
}
exports.AtlasScientificState = AtlasScientificState;
class TankPumpCollection extends EqStateCollection {
    createItem(data) { return new TankPumpState(data); }
}
exports.TankPumpCollection = TankPumpCollection;
class TankPumpState extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'tankPump';
    }
    get id() { return this.data.id; }
    ;
    set id(val) { this.data.id = val; }
    ;
    get type() { return this.data.type; }
    ;
    set type(val) { this.data.type = val; }
    ;
    get isOn() { return this.data.isOn; }
    ;
    set isOn(val) { this.setDataVal('isOn', val); }
    ;
    get isEmpty() { return this.data.isEmpty; }
    ;
    set isEmpty(val) { this.setDataVal('isEmpty', val); }
    ;
    get pumpAddress() { return this.data.tankAddress; }
    ;
    set pumpAddress(val) { this.data.tankAddress = val; }
    ;
    get sensorAddress() { return this.data.sensorAddress; }
    ;
    set sensorAddress(val) { this.data.sensorAddress = val; }
    ;
    get maxDailyRunMins() { return this.data.maxDailyRunMins; }
    ;
    set maxDailyRunMins(val) { this.data.maxDailyRunMins = val; }
    ;
    get currentDailyRunMins() { return this.data.currentDailyRunMins || 0; }
    ;
    set currentDailyRunMins(val) { this.setDataVal('currentDailyRunMins', val, true); }
    ;
    get lastStartTime() { return this.data.lastStartTime; }
    ;
    set lastStartTime(val) { this.data.lastStartTime = val; }
    ;
    get pHDosingStatus() { return typeof this.data.pHDosingStatus !== 'undefined' ? this.data.pHDosingStatus.val : undefined; }
    ;
    set pHDosingStatus(val) {
        if (this.pHDosingStatus !== val) {
            this.data.pHDosingStatus = exports.state.chemController.options.dosingStatus.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    ;
    get orpDosingStatus() { return typeof this.data.orpDosingStatus !== 'undefined' ? this.data.orpDosingStatus.val : undefined; }
    ;
    set orpDosingStatus(val) {
        if (this.orpDosingStatus !== val) {
            this.data.orpDosingStatus = exports.state.chemController.options.dosingStatus.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    ;
}
exports.TankPumpState = TankPumpState;
class SensorCollection extends EqStateCollection {
    createItem(data) { return new SensorState(data); }
}
exports.SensorCollection = SensorCollection;
class SensorState extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'sensor';
    }
    get id() { return this.data.id; }
    ;
    set id(val) { this.data.id = val; }
    ;
    get voltage() { return this.data.voltage; }
    ;
    set voltage(val) { this.data.voltage = val; }
    ;
    get address() { return this.data.address; }
    ;
    set address(val) { this.data.address = val; }
    ;
    get channel() { return this.data.channel; }
    ;
    set channel(val) { this.data.channel = val; }
    ;
}
exports.SensorState = SensorState;
class PressureGauge extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'pressureGauge';
    }
    get chip() { return this.data.chip; }
    ;
    set chip(val) { this.data.chip = val; }
    ;
    get address() { return this.data.address; }
    ;
    set address(val) { this.data.address = val; }
    ;
    get channel() { return this.data.channel; }
    ;
    set channel(val) { this.data.channel = val; }
    ;
    get pga() { return this.data.pga; }
    ;
    set pga(val) { this.data.pga = val; }
    ;
    get sps() { return this.data.sps; }
    ;
    set sps(val) { this.data.sps = val; }
    ;
    get psi() { return this.data.psi; }
    ;
    set psi(val) { this.setDataVal('psi', val); }
    ;
}
exports.PressureGauge = PressureGauge;
class ServerOptions extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'serverOptions';
    }
    get protocol() { return this.data.protocol; }
    ;
    set protocol(val) { this.data.protocol = val; }
    ;
    get host() { return this.data.host; }
    ;
    set host(val) { this.data.host = val; }
    ;
    get port() { return this.data.port; }
    ;
    set port(val) { this.data.port = val; }
    ;
}
exports.ServerOptions = ServerOptions;
class ChemController extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'chemController';
    }
    get options() { return this.data.options || {}; }
    ;
    set options(val) { this.data.options = val; }
    ;
    get alarms() { return new AlarmsCollection(this.data, "alarms"); }
    ;
    get warnings() { return new WarningsCollection(this.data, "warnings"); }
    ;
}
exports.ChemController = ChemController;
class AlarmsCollection extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'chemControllerAlarms';
    }
    ctor(data) { return new AlarmsCollection(data, name || 'alarms'); }
    get flow() { return typeof this.data.flow === 'undefined' ? undefined : this.data.flow.val; }
    set flow(val) {
        if (this.flow !== val) {
            this.data.flow = exports.state.chemController.options.alarms.flow.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get pHTank() { return typeof this.data.pHTank === 'undefined' ? undefined : this.data.pHTank.val; }
    set pHTank(val) {
        if (this.pHTank !== val) {
            this.data.pHTank = exports.state.chemController.options.alarms.pHTank.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get orpTank() { return typeof this.data.orpTank === 'undefined' ? undefined : this.data.orpTank.val; }
    set orpTank(val) {
        if (this.orpTank !== val) {
            this.data.orpTank = exports.state.chemController.options.alarms.orpTank.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get pH() { return typeof this.data.pH === 'undefined' ? undefined : this.data.pH.val; }
    set pH(val) {
        if (this.pH !== val) {
            this.data.pH = exports.state.chemController.options.alarms.pH.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get orp() { return typeof this.data.orp === 'undefined' ? undefined : this.data.orp.val; }
    set orp(val) {
        if (this.orp !== val) {
            this.data.orp = exports.state.chemController.options.alarms.orp.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
}
exports.AlarmsCollection = AlarmsCollection;
class WarningsCollection extends EqState {
    constructor() {
        super(...arguments);
        this.dataName = 'chemControllerWarnings';
    }
    ctor(data) { return new WarningsCollection(data, name || 'warnings'); }
    get waterChemistry() { return typeof this.data.waterChemistry === 'undefined' ? undefined : this.data.waterChemistry.val; }
    set waterChemistry(val) {
        if (this.waterChemistry !== val) {
            this.data.waterChemistry = exports.state.chemController.options.warnings.waterChemistry.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get pHDailyLimitReached() { return typeof this.data.pHDailyLimitReached === 'undefined' ? undefined : this.data.pHDailyLimitReached.val; }
    set pHDailyLimitReached(val) {
        if (this.pHDailyLimitReached !== val) {
            this.data.pHDailyLimitReached = exports.state.chemController.options.warnings.pHTank.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
    get orpDailyLimitReached() { return typeof this.data.orpDailyLimitReached === 'undefined' ? undefined : this.data.orpDailyLimitReached.val; }
    set orpDailyLimitReached(val) {
        if (this.orpDailyLimitReached !== val) {
            this.data.orpDailyLimitReached = exports.state.chemController.options.warnings.orpDailyLimitReached.find(el => val === el.val);
            exports.state.updateServer = true;
        }
    }
}
exports.WarningsCollection = WarningsCollection;
exports.state = new State();
//# sourceMappingURL=State.js.map