import { rpiComms } from '../comms/RPIBus';
import { PressureGauge } from '../controller/State';
const ADS1x15 = require('raspi-kit-ads1x15');
import { state } from '../controller/State';
import { logger } from '../logger/Logger';

export interface IADS1x15 {
    chip: string;
    address: number;
    pga: number;
    sps: number;
    ch: number
}

export class ADS1115 {
    public init() {
        state.pressureGauge.chip = ADS1x15.chips.IC_ADS1115;
        state.pressureGauge.address = ADS1x15.address.ADDRESS_0x48;
        state.pressureGauge.pga = ADS1x15.pga.PGA_4_096V;
        state.pressureGauge.sps = ADS1x15.spsADS1015.SPS_250;
        state.pressureGauge.channel = ADS1x15.channel.CHANNEL_3  // channel

        this._adc = new ADS1x15({
            i2c: rpiComms.i2c,                     // i2c interface
            chip: state.pressureGauge.chip,        // chip model
            address: state.pressureGauge.address,  // i2c address on the bus

            // Defaults for future readings
            pga: state.pressureGauge.pga,     // power-gain-amplifier range
            sps: state.pressureGauge.sps      // data rate (samples per second)
        })
    }

    private _adc: any;
    private _inducerOffset = 0.5;
    private _psiPerVolt = 25;

    public readChip = async (): Promise<{ value: number, volts: number }> => {

        return new Promise((resolve, reject) => {
            try {
                this._adc.readChannel(state.pressureGauge.channel, (err, value, volts) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve({ value, volts });
                    }
                });
            }
            catch (err) {
                logger.error(`Error reading ADS chip: ${err}`)
                reject();
            }
        })
    }

    public getPSIAsync = async () => {
        return new Promise(async (resolve, reject) => {
            try {
                let { volts } = await this.readChip();
                state.pressureGauge.psi = Math.max(this.convertToPSI(volts), 0);
                return resolve(state.pressureGauge.psi);
            }
            catch (err) {
                reject(err);
            }
        })
    }

    private convertToPSI = (volts: number) => {
        return (volts - this._inducerOffset) * this._psiPerVolt;
    }
}

export var PSIGauge = new ADS1115();