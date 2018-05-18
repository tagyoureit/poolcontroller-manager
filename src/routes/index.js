var express = require('express');
var router = express.Router();
var influx = require('../bin/influx-connector')


/* GET home page. */
router.get('/', function (req, res, next) {
    res.render('index', {title: 'Express'});
});

router.get('/api/filter_change', function (req, res) {
    influx.writeFilterChange(req.query)
        .then(function (data) {
            json = {
                result: 'ok',
                text: data
            }

            console.log(json)
            res.send(json)

        })
        .catch(function (err) {
            json = {
                result: 'error',
                text: err
            }
            console.log(json)
            res.send(json)
        })
})

router.get('/api/tank_refill', function (req, res) {
    influx.writeAddChemicalsToTank(req.query)
        .then(function (data) {
            json = {
                result: 'ok',
                text: data
            }

            console.log(json)
            res.send(json)

        })
        .catch(function (err) {
            json = {
                result: 'error',
                text: err
            }
            console.log(json)
            res.send(json)
        })
})

router.get('/api/chemistry', function (req, res) {
    influx.writeAddChemistryReadings(req.query)
        .then(function (data) {
            json = {
                result: 'ok',
                text: data
            }

            console.log(json)
            res.send(json)

        })
        .catch(function (err) {
            json = {
                result: 'error',
                text: err
            }
            console.log(json)
            res.send(json)
        })
})


module.exports = router;
