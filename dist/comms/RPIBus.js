"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.rpiComms = exports.GPIOOutput = exports.GPIOInput = exports.GPIOClass = exports.RPIBus = void 0;
const raspi_1 = require("raspi");
const raspi_i2c_1 = require("raspi-i2c");
const raspi_gpio_1 = require("raspi-gpio");
const Logger_1 = require("../logger/Logger");
class RPIBus {
    constructor() {
        this.gpioCollection = [];
        this.initAsync = async () => {
            return new Promise((resolve, reject) => {
                raspi_1.init(() => {
                    Logger_1.logger.info(`Raspi.js initialized.`);
                    resolve();
                });
                this.i2c = new raspi_i2c_1.I2C();
            });
        };
    }
    addGPIO({ type, pin, pud }) {
        if (typeof pud === 'undefined') {
            this.gpioCollection.push(new GPIOOutput(type, pin));
        }
        else {
            this.gpioCollection.push(new GPIOInput(type, pin, pud));
        }
    }
    getGPIO(pin) {
        return this.gpioCollection.find(gpio => gpio.id === pin);
    }
}
exports.RPIBus = RPIBus;
class GPIOClass {
    constructor(type, pin) {
        this.type = type;
        this.id = pin;
    }
}
exports.GPIOClass = GPIOClass;
class GPIOInput extends GPIOClass {
    constructor(type, pin, pud) {
        super(type, pin);
        this.sensor = new raspi_gpio_1.DigitalInput({
            pin,
            pullResistor: pud
        });
    }
    read() {
        try {
            return this.sensor.read();
        }
        catch (err) {
            Logger_1.logger.info(`Error reading from pin ${this.pin}.  Error: ${err}`);
        }
    }
}
exports.GPIOInput = GPIOInput;
class GPIOOutput extends GPIOClass {
    constructor(type, pin) {
        super(type, pin);
        this.sensor = new raspi_gpio_1.DigitalOutput({
            pin
        });
    }
    write(val) {
        try {
            this.sensor.write(val);
        }
        catch (err) {
            Logger_1.logger.info(`Error writing to pin ${this.pin}.  Error: ${err}`);
        }
    }
}
exports.GPIOOutput = GPIOOutput;
exports.rpiComms = new RPIBus();
//# sourceMappingURL=RPIBus.js.map