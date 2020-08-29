"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PSIGauge = exports.ADS1115 = void 0;
const RPIBus_1 = require("../comms/RPIBus");
const ADS1x15 = require('raspi-kit-ads1x15');
const State_1 = require("../controller/State");
const Logger_1 = require("../logger/Logger");
class ADS1115 {
    constructor() {
        this._inducerOffset = 0.5;
        this._psiPerVolt = 25;
        this.readChip = async () => {
            return new Promise((resolve, reject) => {
                try {
                    this._adc.readChannel(State_1.state.pressureGauge.channel, (err, value, volts) => {
                        if (err) {
                            reject(err);
                        }
                        else {
                            resolve({ value, volts });
                        }
                    });
                }
                catch (err) {
                    Logger_1.logger.error(`Error reading ADS chip: ${err}`);
                    reject();
                }
            });
        };
        this.getPSIAsync = async () => {
            return new Promise(async (resolve, reject) => {
                try {
                    let { volts } = await this.readChip();
                    State_1.state.pressureGauge.psi = Math.max(this.convertToPSI(volts), 0);
                    return resolve(State_1.state.pressureGauge.psi);
                }
                catch (err) {
                    reject(err);
                }
            });
        };
        this.convertToPSI = (volts) => {
            return (volts - this._inducerOffset) * this._psiPerVolt;
        };
    }
    init() {
        State_1.state.pressureGauge.chip = ADS1x15.chips.IC_ADS1115;
        State_1.state.pressureGauge.address = ADS1x15.address.ADDRESS_0x48;
        State_1.state.pressureGauge.pga = ADS1x15.pga.PGA_4_096V;
        State_1.state.pressureGauge.sps = ADS1x15.spsADS1015.SPS_250;
        State_1.state.pressureGauge.channel = ADS1x15.channel.CHANNEL_3;
        this._adc = new ADS1x15({
            i2c: RPIBus_1.rpiComms.i2c,
            chip: State_1.state.pressureGauge.chip,
            address: State_1.state.pressureGauge.address,
            pga: State_1.state.pressureGauge.pga,
            sps: State_1.state.pressureGauge.sps
        });
    }
}
exports.ADS1115 = ADS1115;
exports.PSIGauge = new ADS1115();
//# sourceMappingURL=ADS1x15.js.map