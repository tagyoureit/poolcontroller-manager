"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const ADS1x15_1 = require("./devices/ADS1x15");
const ADS1x15 = require('raspi-kit-ads1x15');
const State_1 = require("./controller/State");
const RPIBus_1 = require("./comms/RPIBus");
const raspi_gpio_1 = require("raspi-gpio");
const Controller_1 = require("./controller/Controller");
const Server_1 = require("./web/Server");
const Config_1 = require("./config/Config");
const Logger_1 = require("./logger/Logger");
const startAsync = async () => {
    console.log(`Starting app at ${new Date().toISOString()}`);
    try {
        return Promise.resolve()
            .then(function () { Logger_1.logger.init(); })
            .then(function () { State_1.state.init(); })
            .then(function () { Config_1.config.init(); })
            .then(RPIBus_1.rpiComms.initAsync)
            .then(function () {
            let cfgPC = Config_1.config.getSection('poolController');
            State_1.state.serverOptions.protocol = cfgPC.protocol;
            State_1.state.serverOptions.host = cfgPC.server;
            State_1.state.serverOptions.port = cfgPC.port;
        })
            .then(Controller_1.controller.httpComms.loadOptionsAsync)
            .then(function () {
            let cfgDevices = Config_1.config.getSection('devices');
            let orpProbe = State_1.state.probes.getItemById(1, true);
            orpProbe.address = parseInt(cfgDevices.orpProbe.address, 16);
            orpProbe.type = 'orp';
            orpProbe.delay = parseInt(cfgDevices.orpProbe.delay, 10);
            if (typeof orpProbe.orpSetpoint === 'undefined')
                orpProbe.orpSetpoint = 750;
            let phProbe = State_1.state.probes.getItemById(2, true);
            phProbe.address = parseInt(cfgDevices.pHProbe.address, 16);
            phProbe.type = 'pH';
            phProbe.delay = parseInt(cfgDevices.pHProbe.delay, 10);
            if (typeof phProbe.pHSetpoint === 'undefined')
                phProbe.pHSetpoint = 7.7;
            let tank1 = State_1.state.tankPumps.getItemById(1, true);
            tank1.sensorAddress = parseInt(cfgDevices.tank1.sensorAddress, 10);
            tank1.pumpAddress = parseInt(cfgDevices.tank1.pumpAddress, 10);
            tank1.type = cfgDevices.tank1.type;
            tank1.isOn = false;
            RPIBus_1.rpiComms.addGPIO({ type: 'tankSensor', pin: tank1.sensorAddress, pud: raspi_gpio_1.PULL_DOWN });
            RPIBus_1.rpiComms.addGPIO({ type: 'pump', pin: tank1.pumpAddress });
            let tank2 = State_1.state.tankPumps.getItemById(2, true);
            tank2.sensorAddress = parseInt(cfgDevices.tank2.sensorAddress, 10);
            ;
            tank2.pumpAddress = parseInt(cfgDevices.tank2.pumpAddress, 10);
            ;
            tank2.type = cfgDevices.tank2.type;
            tank2.isOn = false;
            RPIBus_1.rpiComms.addGPIO({ type: 'tankSensor', pin: tank2.sensorAddress, pud: raspi_gpio_1.PULL_DOWN });
            RPIBus_1.rpiComms.addGPIO({ type: 'pump', pin: tank2.pumpAddress });
        })
            .then(function () { Server_1.webApp.init(); })
            .then(function () { ADS1x15_1.PSIGauge.init(); })
            .then(Controller_1.controller.mainLoop);
    }
    catch (err) {
        console.log(`ERROR in startAsync.  ${err}`);
    }
};
startAsync();
process.on('SIGINT', async function () {
    try {
        Logger_1.logger.info(`Received Ctrl-C.  Stopping pumps.`);
        Controller_1.controller.tankPumps.stopPumps();
        await State_1.state.stopAsync();
        Logger_1.logger.info(`Finished stopping pumps.  Exiting.`);
    }
    catch (err) {
        console.log(`Error shutting down. ${err}`);
    }
    finally {
        process.exit(1);
    }
});
//# sourceMappingURL=app.js.map