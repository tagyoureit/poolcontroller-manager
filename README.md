
# poolcontroller-manager - Version 2.0.0

# Overview

This is v2 of pool controller manager.  It reads Atlas Scientific pH and ORP sensors, monitors the acid tanks, controllers stenner pumps, and read the PSI of the filter.  

It communicates with nodejs-poolController 6.0+ to receive chemController updates (pHSetpoint, orpSetpoint, temps, etc) and posts status updates back to the app.  It will also adjust the chlorinator higher/lower based on the ORP setpoint.

# Instructions

Start the app once then kill it.  Then edit `config.json`.
```js
"poolController": {
        "protocol": "http://",
        "server": "10.0.0.170",
        "port": 4200
    },
    "devices": {
        "orpProbe": {
            "address": "0x62",
            "delay": 1500
        },
        "phProbe": {
            "address": "0x63",
            "delay": 1500
        },
        "tank1": {
            "sensorAddress": 21,
            "pumpAddress": 23,
            "type": "pH"
        },
        "tank2": {
            "sensorAddress": 22,
            "pumpAddress": 25,
            "type": "orp"
        }
    },
```

Futures:
* Support dynamic configs for users that don't have some/all (or additional) equipment

# Credit for v1+

1.  Richard Sears at [Hackster.io](https://www.hackster.io/user3424878278/pool-fill-control-119ab7) and [Github/@rjsears](https://github.com/rjsears/Pool_Fill_Control/).  He has been an inspiration and my Python modules are modeled after his.
2.  [@johnny2678](https://github.com/johnny2678) who has been there (in the chat rooms) with me planning and leaning
3.  [TroubleFreePool.com](https://www.troublefreepool.com/) and their [Pool Calculator](https://www.troublefreepool.com/calc.html) are some of the absolute best resources on the internet for pool knowledge.
