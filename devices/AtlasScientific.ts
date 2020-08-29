import { I2C } from 'raspi-i2c';
import { rpiComms } from '../comms/RPIBus';
import { state, AtlasScientificState } from '../controller/State';
export interface IAtlas {
    addr: number;
    type: string;
    id: number;
}

export class AtlasScientific {
    public readMeasurement = async (probe: AtlasScientificState) => {
        return new Promise(async (resolve, reject)=>{
            try {
                let res = await this.sendAndResponse(probe, 'R');
                // await this.sendData(probe, 'Sleep');
                resolve(res);
            }
            catch (err){
                reject(err);
            }
        })
    }

    public setTemp = async (probe: AtlasScientificState) => {
        return new Promise(async (resolve, reject)=>{
            try {
                let _tempC = probe.temp;
                if (probe.tempUnits !== 'C') _tempC = (probe.temp - 32) * 5/9;
                await this.sendData(probe, `T,${_tempC}`);
                // await this.sendData(probe, 'Sleep');
                resolve();
            }
            catch (err){
                reject(err);
            }
        })
    }
    public sendAndResponse = async (probe: AtlasScientificState, command: string) => {
        try {
            await this.sendData(probe, command);
            return await this.readData(probe, command);
        }
        catch (err) {
            return err;
        }
    }

    public sendData = async (probe: AtlasScientificState, command: string) => {
        return new Promise((resolve, reject) => {
            rpiComms.i2c.write(probe.address, Buffer.from(command), async (err) => {
                if (err) {
                    reject(`Error writing to probe ${probe.type}: ${err}`)
                }
                else {
                    await this.sleep(probe.delay);
                    resolve();
                }
            });
        })
    }

    public readData = async (probe: AtlasScientificState, command: string) => {
        return new Promise((resolve, reject) => {
            rpiComms.i2c.read(probe.address, this.responseLength(command), (err, data) => {
                if (err) {
                    reject(`Error reading from probe ${probe.type}: ${err}`)
                }
                else {
                    let str2 = data.toString();
                    let num = parseFloat(str2.replace(/[^ -~]+/g, ""))
                    if (isNaN(num) || num === 0) {
                        console.error(`Error: ${probe.type} - cannot convert ${data} to a number`);
                        reject(`Error converting val to a number`)
                    }
                    else {
                        if (probe.type === 'pH'){
                            probe.pHLevel = num;
                            if (num <= 7.3) state.chemController.alarms.pH = state.chemController.options.alarms.pH.find(wf => wf.name === 'phlow').val;
                            else if (num >= 7.7) state.chemController.alarms.pH = state.chemController.options.alarms.pH.find(wf => wf.name === 'phhigh').val;
                            else state.chemController.alarms.pH = state.chemController.options.alarms.pH.find(wf => wf.name === 'ok').val;
                        }
                        else if (probe.type === 'orp'){
                            probe.orpLevel = num;
                            if (num <= 7.3) state.chemController.alarms.orp = state.chemController.options.alarms.orp.find(wf => wf.name === 'orplow').val;
                            else if (num >= 7.7) state.chemController.alarms.orp = state.chemController.options.alarms.orp.find(wf => wf.name === 'orphigh').val;
                            else state.chemController.alarms.orp = state.chemController.options.alarms.orp.find(wf => wf.name === 'ok').val;
                        }
                        resolve(num);
                    }                    
                }
            })
        })
    }

    private responseLength = (command) => {
        switch (command) {
            case 'I':
                return 9;
            default:
                return 10;
        }
    }

    private sleep = async (ms) => {
        return await new Promise(r => setTimeout(r, 2000));
    }
}

export var probeController = new AtlasScientific();