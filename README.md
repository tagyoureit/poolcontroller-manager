
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

# Devices used in this project
1. [Non contact liquid level sensor](https://www.aliexpress.com/item/32870009405.html) - These seem great but are hard to get to have a good seal on a round tank.  I replaced one faulty one and on my current two tanks one works flawlessly and the other works ~50% of the time.  There might be better options out there.
2. [2x Stenner Pumps and 15 gallon tanks](https://cannonwater.com/stenner-non-adjustable-fixed-high-pressure-pump-45mphp-or-85mphp-with-tank/) - These have been rock solid.  I originally used one tank for chlorine and one for muriatic acid but my chlorinator negates the need for chlorine most of the year so both are acid tanks now.
3.  [ADS1115 ADC](https://www.adafruit.com/product/1085) - Used to read from the digital pressure sensor.  Can also be used for temperature probes.
4. [5v Pressure transducer](https://www.ebay.com/itm/Pressure-transducer-or-sender-100-psi-5V-for-oil-fuel-air-water/261260635816?ssPageName=STRK%3AMEBIDX%3AIT&_trksid=p2057872.m2749.l2649) - to read PSI from the tank.  You'll need a few connectors to put this inline with your tank.
5. Atlas Scientific [ph probe](https://atlas-scientific.com/probes/consumer-grade-ph-probe/), [ph ezo circuit chip](https://atlas-scientific.com/circuits/ezo-ph-circuit/), [orp sensor](https://atlas-scientific.com/probes/consumer-grade-orp-probe/), [orp ezo circuit chip](https://atlas-scientific.com/circuits/ezo-orp-circuit/), and [whitebox tentacle shield](https://atlas-scientific.com/carrier-boards/whitebox-labs-tentacle-t3/) and wire extenders, connectors, etc as necessary.
6. Generic 5v relays to turn on power to the stenner pumps

Futures:
* Support dynamic configs for users that don't have some/all (or additional) equipment

# Credit for v1+

1.  Richard Sears at [Hackster.io](https://www.hackster.io/user3424878278/pool-fill-control-119ab7) and [Github/@rjsears](https://github.com/rjsears/Pool_Fill_Control/).  He has been an inspiration and my Python modules are modeled after his.
2.  [@johnny2678](https://github.com/johnny2678) who has been there (in the chat rooms) with me planning and leaning
3.  [TroubleFreePool.com](https://www.troublefreepool.com/) and their [Pool Calculator](https://www.troublefreepool.com/calc.html) are some of the absolute best resources on the internet for pool knowledge.
