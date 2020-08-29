
import { HIGH, LOW } from 'raspi-gpio';
import { rpiComms } from '../comms/RPIBus';
import { TankPumpState } from '../controller/State';
import { controller } from '../controller/Controller';
import { logger } from '../logger/Logger';
import { state } from '../controller/State';
//  Liquid Level Sensor Setup
//  Acid level sensor pin here is tied to GPIO xx. The acid level sensor is
//  a three wire connection with ground and 5V plus GPIO for detecting the
//  level of the acid in our acid tank. It provides OK or LOW only, not a
//  specific level in the tank.

export class TankPump {

    public runPump = (tank: TankPumpState) => {
        if (tank.isOn === true) return;
        rpiComms.getGPIO(tank.pumpAddress).write(LOW);
        controller.tankPumps.calcRunningTime(tank, false);
        tank.isOn = true;
        logger.info(`Turned on tank pump ${tank.id}`);
        this.saveTankState(tank);
    }
    public stopPump = (tank: TankPumpState) => {
        // if (tank.isOn === false) return; 
        // RG - took this out.  If the data doesn't match the actual status let's still 
        // send the signal to turn off the pumps.
        rpiComms.getGPIO(tank.pumpAddress).write(HIGH);
        controller.tankPumps.calcRunningTime(tank, true);
        tank.isOn = false;
        this.saveTankState(tank);
    }

    public saveTankState = (tank: TankPumpState) => {
        if (tank.type === 'pH')
            if (tank.isOn) {
                tank.pHDosingStatus = state.chemController.options.dosingStatus.find(wf => wf.name === 'monitoring').val;
            }
            else {
                tank.pHDosingStatus = state.chemController.options.dosingStatus.find(wf => wf.name === 'dosing').val;
            }
        else if (tank.type === 'orp')
            if (tank.isOn) {
                tank.orpDosingStatus = state.chemController.options.dosingStatus.find(wf => wf.name === 'monitoring').val;
            }
            else {
                tank.orpDosingStatus = state.chemController.options.dosingStatus.find(wf => wf.name === 'dosing').val;
            }
    }
    public readSensor = (tank: TankPumpState) => {
        let tank1 = rpiComms.getGPIO(tank.sensorAddress)
        let r1 = tank1.read();
        let res = rpiComms.getGPIO(tank.sensorAddress).read();
        if (res) tank.isEmpty = false;
        else tank.isEmpty = true;
        if (tank.type === 'pH')
            if (tank.isEmpty) {
                state.chemController.alarms.pHTank = state.chemController.options.alarms.pHTank.find(wf => wf.name === 'phtankempty').val;
            }
            else {
                state.chemController.alarms.pHTank = state.chemController.options.alarms.pHTank.find(wf => wf.name === 'ok').val;
            }
        else if (tank.type === 'orp')
            if (tank.isOn) {
                state.chemController.alarms.pHTank = state.chemController.options.alarms.orpTank.find(wf => wf.name === 'orptankempty').val;
            }
            else {
                state.chemController.alarms.orpTank = state.chemController.options.alarms.orpTank.find(wf => wf.name === 'ok').val;
            }
    }
}

export var tankPump = new TankPump();