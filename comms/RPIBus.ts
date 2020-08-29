import { init } from 'raspi';
import { I2C } from 'raspi-i2c';
import { DigitalInput, DigitalOutput, PULL_DOWN, PULL_UP, HIGH, LOW } from 'raspi-gpio';
import { logger } from '../logger/Logger';

export class RPIBus {
    constructor() {


    }
    public i2c: I2C;
    private gpioCollection: any = [];
    public initAsync = async () => {
        return new Promise((resolve, reject) => {
            init(() => {
                logger.info(`Raspi.js initialized.`)
                resolve();
            })

            this.i2c = new I2C();
            // leave outside local scope so this only completes after init is done
            // otherwise, Init returns control too soon.
            // See https://github.com/kfitzgerald/raspi-kit-ads1x15/issues/2
        })

    }
    public addGPIO({ type, pin, pud }: { type: string, pin: number, pud?: number }) {
        if (typeof pud === 'undefined') {
            this.gpioCollection.push(new GPIOOutput(type, pin));
        }
        else {
            this.gpioCollection.push(new GPIOInput(type, pin, pud));
        }
    }
    public getGPIO(pin: number) {
        return this.gpioCollection.find(gpio => gpio.id === pin);
    }
}

export class GPIOClass {
    constructor(type: string, pin: number) {
        this.type = type;
        this.id = pin;
    }
    public id: number;
    public pin: number;
    public type: string;
}

export class GPIOInput extends GPIOClass {
    constructor(type: string, pin: number, pud: number) {
        super(type, pin);
        this.sensor = new DigitalInput({
            pin,
            pullResistor: pud
        }) 
    }
    public sensor: DigitalInput;


    public pud: number;
    public read() {
        try {
            return this.sensor.read();
        }
        catch (err) {
            logger.info(`Error reading from pin ${this.pin}.  Error: ${err}`)
        }
    }

}

export class GPIOOutput extends GPIOClass {
    constructor(type: string, pin: number) {
        super(type, pin);
        this.sensor = new DigitalOutput({
            pin
        })
    }
    public sensor: DigitalOutput;
    public pud: number;
    public write(val: number) {
        try {
            this.sensor.write(val);
        }
        catch (err) {
            logger.info(`Error writing to pin ${this.pin}.  Error: ${err}`)
        }
    }

}

export var rpiComms = new RPIBus();
