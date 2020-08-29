"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.probeController = exports.AtlasScientific = void 0;
const RPIBus_1 = require("../comms/RPIBus");
const State_1 = require("../controller/State");
class AtlasScientific {
    constructor() {
        this.readMeasurement = async (probe) => {
            return new Promise(async (resolve, reject) => {
                try {
                    let res = await this.sendAndResponse(probe, 'R');
                    resolve(res);
                }
                catch (err) {
                    reject(err);
                }
            });
        };
        this.setTemp = async (probe) => {
            return new Promise(async (resolve, reject) => {
                try {
                    let _tempC = probe.temp;
                    if (probe.tempUnits !== 'C')
                        _tempC = (probe.temp - 32) * 5 / 9;
                    await this.sendData(probe, `T,${_tempC}`);
                    resolve();
                }
                catch (err) {
                    reject(err);
                }
            });
        };
        this.sendAndResponse = async (probe, command) => {
            try {
                await this.sendData(probe, command);
                return await this.readData(probe, command);
            }
            catch (err) {
                return err;
            }
        };
        this.sendData = async (probe, command) => {
            return new Promise((resolve, reject) => {
                RPIBus_1.rpiComms.i2c.write(probe.address, Buffer.from(command), async (err) => {
                    if (err) {
                        reject(`Error writing to probe ${probe.type}: ${err}`);
                    }
                    else {
                        await this.sleep(probe.delay);
                        resolve();
                    }
                });
            });
        };
        this.readData = async (probe, command) => {
            return new Promise((resolve, reject) => {
                RPIBus_1.rpiComms.i2c.read(probe.address, this.responseLength(command), (err, data) => {
                    if (err) {
                        reject(`Error reading from probe ${probe.type}: ${err}`);
                    }
                    else {
                        let str2 = data.toString();
                        let num = parseFloat(str2.replace(/[^ -~]+/g, ""));
                        if (isNaN(num) || num === 0) {
                            console.error(`Error: ${probe.type} - cannot convert ${data} to a number`);
                            reject(`Error converting val to a number`);
                        }
                        else {
                            if (probe.type === 'pH') {
                                probe.pHLevel = num;
                                if (num <= 7.3)
                                    State_1.state.chemController.alarms.pH = State_1.state.chemController.options.alarms.pH.find(wf => wf.name === 'phlow').val;
                                else if (num >= 7.7)
                                    State_1.state.chemController.alarms.pH = State_1.state.chemController.options.alarms.pH.find(wf => wf.name === 'phhigh').val;
                                else
                                    State_1.state.chemController.alarms.pH = State_1.state.chemController.options.alarms.pH.find(wf => wf.name === 'ok').val;
                            }
                            else if (probe.type === 'orp') {
                                probe.orpLevel = num;
                                if (num <= 7.3)
                                    State_1.state.chemController.alarms.orp = State_1.state.chemController.options.alarms.orp.find(wf => wf.name === 'orplow').val;
                                else if (num >= 7.7)
                                    State_1.state.chemController.alarms.orp = State_1.state.chemController.options.alarms.orp.find(wf => wf.name === 'orphigh').val;
                                else
                                    State_1.state.chemController.alarms.orp = State_1.state.chemController.options.alarms.orp.find(wf => wf.name === 'ok').val;
                            }
                            resolve(num);
                        }
                    }
                });
            });
        };
        this.responseLength = (command) => {
            switch (command) {
                case 'I':
                    return 9;
                default:
                    return 10;
            }
        };
        this.sleep = async (ms) => {
            return await new Promise(r => setTimeout(r, 2000));
        };
    }
}
exports.AtlasScientific = AtlasScientific;
exports.probeController = new AtlasScientific();
//# sourceMappingURL=AtlasScientific.js.map