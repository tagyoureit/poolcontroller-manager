// add source map support for .js to .ts files
require('source-map-support').install();
import { init } from 'raspi';
import { I2C } from 'raspi-i2c';
import { AtlasScientific, probeController } from './devices/AtlasScientific';
import { PSIGauge } from './devices/ADS1x15';
import { TankPump, tankPump } from './devices/TankPump';
const ADS1x15 = require('raspi-kit-ads1x15');
import { state, AtlasScientificState } from './controller/State';
import { rpiComms } from './comms/RPIBus';
import { PULL_DOWN, HIGH, LOW } from 'raspi-gpio';
import { controller } from './controller/Controller';
import { webApp } from './web/Server';
import { config } from './config/Config'
import { logger } from './logger/Logger';

const startAsync = async () => {
    console.log(`Starting app at ${new Date().toISOString()}`)
    try {
        return Promise.resolve()
            .then(function () { logger.init(); })
            .then(function () { state.init(); })
            .then(function () { config.init(); })
            .then(rpiComms.initAsync)
            .then(function () {
                let cfgPC = config.getSection('poolController')
                state.serverOptions.protocol = cfgPC.protocol;
                state.serverOptions.host = cfgPC.server;
                state.serverOptions.port = cfgPC.port;
            })
            .then(controller.httpComms.loadOptionsAsync)
            .then(function(){

                let cfgDevices = config.getSection('devices');
                // init orp probe
                let orpProbe = state.probes.getItemById(1, true);
                orpProbe.address = parseInt(cfgDevices.orpProbe.address, 16);
                orpProbe.type = 'orp';
                orpProbe.delay = parseInt(cfgDevices.orpProbe.delay, 10);
                if (typeof orpProbe.orpSetpoint === 'undefined') orpProbe.orpSetpoint = 750;

                // init pH Probe
                let phProbe = state.probes.getItemById(2, true);
                phProbe.address = parseInt(cfgDevices.pHProbe.address, 16);
                phProbe.type = 'pH'
                phProbe.delay = parseInt(cfgDevices.pHProbe.delay, 10);
                if (typeof phProbe.pHSetpoint === 'undefined') phProbe.pHSetpoint = 7.7; // should never go above 7.7 but can be set lower

                // init 1st tank/pump
                let tank1 = state.tankPumps.getItemById(1, true);
                tank1.sensorAddress = parseInt(cfgDevices.tank1.sensorAddress, 10);
                tank1.pumpAddress = parseInt(cfgDevices.tank1.pumpAddress, 10);
                tank1.type = cfgDevices.tank1.type;
                tank1.isOn = false;
                rpiComms.addGPIO({ type: 'tankSensor', pin: tank1.sensorAddress, pud: PULL_DOWN })
                rpiComms.addGPIO({ type: 'pump', pin: tank1.pumpAddress })

                // init 2nd tank/pump
                let tank2 = state.tankPumps.getItemById(2, true);
                tank2.sensorAddress = parseInt(cfgDevices.tank2.sensorAddress, 10);;
                tank2.pumpAddress = parseInt(cfgDevices.tank2.pumpAddress, 10);;
                tank2.type = cfgDevices.tank2.type;
                tank2.isOn = false;
                rpiComms.addGPIO({ type: 'tankSensor', pin: tank2.sensorAddress, pud: PULL_DOWN })
                rpiComms.addGPIO({ type: 'pump', pin: tank2.pumpAddress })
            })

            .then(function () { webApp.init(); })
            .then(function () { PSIGauge.init(); })
            .then(controller.mainLoop)
    }
    catch (err) {
        console.log(`ERROR in startAsync.  ${err}`)
    }
}

startAsync();

process.on('SIGINT', async function () {
    try {

        logger.info(`Received Ctrl-C.  Stopping pumps.`);
        controller.tankPumps.stopPumps();
        await state.stopAsync()
        logger.info(`Finished stopping pumps.  Exiting.`);
    }
    catch (err) {
        console.log(`Error shutting down. ${err}`)
    }
    finally {
        process.exit(1);
    }
});
