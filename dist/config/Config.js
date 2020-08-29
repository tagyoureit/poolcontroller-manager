"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const path = require("path");
const fs = require("fs");
const extend = require("extend");
const Logger_1 = require("../logger/Logger");
class Config {
    constructor() {
        this._isInitialized = false;
        this._fileTime = new Date(0);
        this._isLoading = false;
        let self = this;
        this.cfgPath = path.posix.join(process.cwd(), "/config.json");
        try {
            this._isLoading = true;
            this._cfg = fs.existsSync(this.cfgPath) ? JSON.parse(fs.readFileSync(this.cfgPath, "utf8")) : {};
            const def = JSON.parse(fs.readFileSync(path.join(process.cwd(), "/defaultConfig.json"), "utf8").trim());
            const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "/package.json"), "utf8").trim());
            this._cfg = extend(true, {}, def, this._cfg, { appVersion: packageJson.version });
            this._isInitialized = true;
            this.update((err) => {
                if (typeof err === 'undefined') {
                    fs.watch(this.cfgPath, (event, fileName) => {
                        if (fileName && event === 'change') {
                            if (self._isLoading)
                                return;
                            const stats = fs.statSync(self.cfgPath);
                            if (stats.mtime.valueOf() === self._fileTime.valueOf())
                                return;
                            this._cfg = fs.existsSync(this.cfgPath) ? JSON.parse(fs.readFileSync(this.cfgPath, "utf8")) : {};
                            this._cfg = extend(true, {}, def, this._cfg, { appVersion: packageJson.version });
                            Logger_1.logger.init();
                            Logger_1.logger.info(`Reloading app config: ${fileName}`);
                        }
                    });
                }
                else
                    throw err;
            });
            this._isLoading = false;
        }
        catch (err) {
            Logger_1.logger.info(`Error reading configuration information.  Aborting startup: ${err}`);
            throw err;
        }
    }
    update(callback) {
        try {
            if (!this._isInitialized) {
                if (typeof callback === 'function')
                    callback(new Error('njsPC has not been initialized.'));
                return;
            }
            this._isLoading = true;
            fs.writeFileSync(this.cfgPath, JSON.stringify(this._cfg, undefined, 2));
            if (typeof callback === 'function')
                callback();
            setTimeout(() => { this._isLoading = false; }, 2000);
        }
        catch (err) {
            Logger_1.logger.error("Error writing configuration file %s", err);
            if (typeof callback === 'function')
                callback(err);
        }
    }
    setSection(section, val) {
        let c = this._cfg;
        if (section.indexOf('.') !== -1) {
            let arr = section.split('.');
            for (let i = 0; i < arr.length - 1; i++) {
                if (typeof c[arr[i]] === 'undefined')
                    c[arr[i]] = {};
                c = c[arr[i]];
            }
            section = arr[arr.length - 1];
        }
        c[section] = val;
        this.update();
    }
    getSection(section, opts) {
        if (typeof section === 'undefined')
            return this._cfg;
        let c = this._cfg;
        if (section.indexOf('.') !== -1) {
            const arr = section.split('.');
            for (let i = 0; i < arr.length; i++) {
                if (typeof c[arr[i]] === "undefined") {
                    c = null;
                    break;
                }
                else
                    c = c[arr[i]];
            }
        }
        else
            c = c[section];
        return extend(true, {}, opts || {}, c || {});
    }
    init() {
        let baseDir = process.cwd();
        this.ensurePath(baseDir + '/logs/');
        this.ensurePath(baseDir + '/data/');
        setTimeout(() => { exports.config.update(); }, 100);
    }
    ensurePath(dir) {
        if (!fs.existsSync(dir)) {
            fs.mkdir(dir, (err) => {
                if (err)
                    Logger_1.logger.info(`Error creating directory: ${dir} - ${err.message}`);
            });
        }
    }
}
exports.config = new Config();
//# sourceMappingURL=Config.js.map