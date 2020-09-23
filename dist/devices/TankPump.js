"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tankPump = exports.TankPump = void 0;
const raspi_gpio_1 = require("raspi-gpio");
const RPIBus_1 = require("../comms/RPIBus");
const Controller_1 = require("../controller/Controller");
const Logger_1 = require("../logger/Logger");
const State_1 = require("../controller/State");
class TankPump {
    constructor() {
        this.runPump = (tank) => {
            if (tank.isOn === true)
                return;
            RPIBus_1.rpiComms.getGPIO(tank.pumpAddress).write(raspi_gpio_1.LOW);
            Controller_1.controller.tankPumps.calcRunningTime(tank, false);
            tank.isOn = true;
            Logger_1.logger.info(`Turned on tank pump ${tank.id}`);
            this.saveTankState(tank);
        };
        this.stopPump = (tank) => {
            RPIBus_1.rpiComms.getGPIO(tank.pumpAddress).write(raspi_gpio_1.HIGH);
            Controller_1.controller.tankPumps.calcRunningTime(tank, true);
            tank.isOn = false;
            this.saveTankState(tank);
        };
        this.saveTankState = (tank) => {
            if (tank.type === 'pH')
                if (tank.isOn) {
                    tank.pHDosingStatus = State_1.state.chemController.options.dosingStatus.find(wf => wf.name === 'dosing').val;
                }
                else {
                    tank.pHDosingStatus = State_1.state.chemController.options.dosingStatus.find(wf => wf.name === 'monitoring').val;
                }
            else if (tank.type === 'orp')
                if (tank.isOn) {
                    tank.orpDosingStatus = State_1.state.chemController.options.dosingStatus.find(wf => wf.name === 'dosing').val;
                }
                else {
                    tank.orpDosingStatus = State_1.state.chemController.options.dosingStatus.find(wf => wf.name === 'monitoring').val;
                }
        };
        this.readSensor = (tank) => {
            let tank1 = RPIBus_1.rpiComms.getGPIO(tank.sensorAddress);
            let r1 = tank1.read();
            let res = RPIBus_1.rpiComms.getGPIO(tank.sensorAddress).read();
            if (res)
                tank.isEmpty = false;
            else
                tank.isEmpty = true;
            if (tank.type === 'pH')
                if (tank.isEmpty) {
                    State_1.state.chemController.alarms.pHTank = State_1.state.chemController.options.alarms.pHTank.find(wf => wf.name === 'phtankempty').val;
                }
                else {
                    State_1.state.chemController.alarms.pHTank = State_1.state.chemController.options.alarms.pHTank.find(wf => wf.name === 'ok').val;
                }
            else if (tank.type === 'orp')
                if (tank.isOn) {
                    State_1.state.chemController.alarms.pHTank = State_1.state.chemController.options.alarms.orpTank.find(wf => wf.name === 'orptankempty').val;
                }
                else {
                    State_1.state.chemController.alarms.orpTank = State_1.state.chemController.options.alarms.orpTank.find(wf => wf.name === 'ok').val;
                }
        };
    }
}
exports.TankPump = TankPump;
exports.tankPump = new TankPump();
//# sourceMappingURL=TankPump.js.map