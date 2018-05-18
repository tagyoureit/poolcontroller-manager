/*  nodejs-poolController.  An application to control pool equipment.
 *  Copyright (C) 2016, 2017.  Russell Goldin, tagyoureit.  russ.goldin@gmail.com
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU Affero General Public License as
 *  published by the Free Software Foundation, either version 3 of the
 *  License, or (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU Affero General Public License for more details.
 *
 *  You should have received a copy of the GNU Affero General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */


var Influx = require('influx')
var conn = {
    host: '11.11.11.240',
    port: 32769,
    database: 'pool'
}

var influx = new Influx.InfluxDB(conn)

var debug = false

var init = function () {

}

function writeFilterChange(data) {
    var last_filter_change = null
    var datetime = null

    datetime = new Date(data.datetime * 1000)

    if (debug) {
        console.log('writing to influx: ', JSON.stringify(data))

        console.log('epoch: ', data.datetime)
        console.log('date: ', datetime);
        datestr = datetime.toLocaleString('en-US', {timeZone: 'america/los_angeles'})
        console.log('date formatted in pst: ', datestr);
    }



    return influx.query("select max(current_filter_change) from filter where \"type\"=\'change\' order by desc limit 1")
        .then(function (res) {
            console.log('last filter change: %s', JSON.stringify(res))

            last_filter_change = res[0].max
        })
        .then(function () {
            return influx.writePoints([{
                measurement: 'filter',
                tags: {
                    source: 'manual',
                    type: 'change'
                },
                fields: {
                    current_filter_change: (last_filter_change + 1)*1.0
                },
                timestamp: datetime
            }])
        })

        .then(function () {
            return influx.query("select max(current_filter_change) from filter where \"type\"=\'change\' order by desc limit 1")


        })
        .then(function (res) {
            return "Updated filter change to : " + res[0].max
        })
        .catch(function (err) {
            console.error('Something bad happened writing to InfluxDB (filter change): ', err.message)
            return Promise.reject(err.message)
        })


}

function writeAddChemicalsToTank(data) {
    datetime = new Date(data.datetime * 1000)
    if (debug) {
        console.log('writing add chem to tank to influx: ', JSON.stringify(data))

        console.log('epoch: ', data.datetime)

        console.log('date: ', datetime);

        datestr = datetime.toLocaleString('en-US', {timeZone: 'america/los_angeles'})
        console.log('date formatted in pst: ', datestr);
    }

    return influx.writePoints([{
        measurement: 'tank_level',
        tags: {
            description: 'refill',
            source: 'manual',
            type: data.chemical,
            manufacturer: data.manufacturer,
            vendor: data.vendor

        },
        fields: {
            status: 1,
            strength_of_chemical: data.strength_of_chemical / 100.0,
            gallons_of_chemical: data.gallons_of_chemical * 1.0,
            gallons_of_water: data.gallons_of_water * 1.0,
            total_gallons: (data.gallons_of_chemical*1.0 + data.gallons_of_water*1.0)
        },
        timestamp: datetime
    }])

        .then(function () {
            // return influx.query("select * from tank_level where \"description\"=\'refill\' order by desc limit 1")
            return "Successfully wrote 'Add Chemicals to Tank' measurement"
        })
        .catch(function (err) {
            console.error('Something bad happened writing to InfluxDB (tank_level): ', err.message)
            return Promise.reject(err.message)
        })


}

function writeAddChemistryReadings(data) {
    datetime = new Date(data.datetime * 1000)
    if (debug) {
        console.log('writing chemistry readings to influx: ', JSON.stringify(data))

        console.log('epoch: ', data.datetime)

        console.log('date: ', datetime);

        datestr = datetime.toLocaleString('en-US', {timeZone: 'america/los_angeles'})
        console.log('date formatted in pst: ', datestr);

        console.log("data: ", JSON.stringify(data))
    }
    var data_array = [];
    for (var key in data) {
        if (!(key === 'source' || key === 'datetime' || data[key]==='')) {

                data_array.push({
                    measurement: 'chemistry',
                    tags: {
                        'source': data.source,
                        'type': key
                    },
                    fields: {
                        'value': data[key]*1.0
                    },
                    timestamp: datetime
                })

        }
    }
    console.log('would be writing points: ', data_array)

    if (data_array.length>0) {
        return influx.writePoints(data_array)

            .then(function () {
                return "Successfully wrote chemistry measurements."
            })
            .catch(function (err) {
                console.error('Something bad happened writing to InfluxDB (pump): ', err.message)
                return Promise.reject(err.message)
            })
    }
    else
        return Promise.resolve("No chemistry measurements to add.")
}


module.exports = {
    init: init,
    writeFilterChange: writeFilterChange,
    writeAddChemicalsToTank: writeAddChemicalsToTank,
    writeAddChemistryReadings: writeAddChemistryReadings

}

