# coding=utf-8

######
######  Note: My local time and InfluxDB time were off.  I set my RasPi to use my Synology as the NTP server (where Influx is running as a container.
######  and the time issues went away.  Would be better to query influx for time, but it isn't possible right now.


import RPi.GPIO as GPIO
import time
from dateutil.parser import parse
from pytz import reference
from feed.date.rfc3339 import *
import urllib2
import json
import logging
import math
import datetime
import threading
import requests #only for InfluxDB Error catching
from datetime import timedelta
from utilities.atlas_scientific_i2c import AtlasI2C
from twilio.rest import Client
import Adafruit_ADS1x15
from influxdb import InfluxDBClient

###### SETUP LOGGING #######
LOGGING = True # True or False
DEBUG = False  # True or False
if LOGGING == True:
    logger = logging.getLogger(__name__)
    handler = logging.FileHandler('./poolcontroller-manager.log')
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    handler.setFormatter(formatter)
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    logger.filemode = 'a'


def log(str):
    # type: (string) -> None
    if LOGGING == True:
        logger.info(str)
        print(str)

def debug(str):
    if DEBUG == True:
        logger.info("DEBUG: {0}".format(str))
        print("DEBUG: {0}".format(str))

log("Starting application at {0}".format(time.strftime('%m/%d/%Y %H:%M:%S', time.localtime(time.time()))))

'''
BEGIN SETUP OF VARIABLES AND INITIALIZATION
'''
log("***STARTING INITIALIZATION***")

# Setup upper/lower bounds for chemicals
orp_lower_threshold = 640
orp_upper_threshold = 670
ph_lower_threshold = 7.5
ph_upper_threshold = 7.7
alert_threshold = 5  # as a percent

number_of_chemistry_readings_required = 5
lookback_time_for_chemistry_readings = 10 # minutes

log("   ph thresholds set as {0}-{1} with alerts at <{2} and >{3}".format(ph_lower_threshold, ph_upper_threshold, ph_lower_threshold*(100-alert_threshold)/100, ph_upper_threshold*(100+alert_threshold)/100))
log("   orp thresholds set as {0}-{1} with alerts at <{2} and >{3}".format(orp_lower_threshold, orp_upper_threshold, orp_lower_threshold*(100-alert_threshold)/100, orp_upper_threshold*(100+alert_threshold)/100))
log("   app will require {0} readings of ph/ORP in the last {1} minutes to determine the current value".format(number_of_chemistry_readings_required, lookback_time_for_chemistry_readings ))

# Setup our GPIO Pins
GPIO.setwarnings(False)  # Don't tell me about GPIO warnings.
GPIO.setmode(GPIO.BCM)  # Use BCM Pin Numbering Scheme
log("   GPIO Pins setup")

#### Tank Pump Relay Setup ####
## Setup GPIO Pins for sensors and relay
acid_pump_relay_pin = 13
chlorine_pump_relay_pin = 26
####### PUMP RELAYS ARE HIGH/OFF and LOW/ON!!!
GPIO.setup(acid_pump_relay_pin, GPIO.OUT, initial=GPIO.HIGH)
GPIO.setup(chlorine_pump_relay_pin, GPIO.OUT, initial=GPIO.HIGH)
acid_pump_relay_state = GPIO.HIGH
chlorine_pump_relay_state = GPIO.HIGH
acid_pump_current_start_time = 0
chlorine_pump_current_start_time = 0
which_tank_pump_running = "acid"

tank_pump_switch_desired_delay = 3 # How long should the application wait between switching from acid<-->chlorine tanks, in minutes
log("   Tank Pump Relays setup")


#### Liquid Level Sensor Setup
# Acid level sensor pin here is tied to GPIO 14. The acid level sensor is
# a three wire connection with ground and 5V plus GPIO for detecting the
# level of the acid in our acid tank. It provides OK or LOW only, not a
# specific level in the tank.
acid_level_sensor_pin = 5
chlorine_level_sensor_pin = 6
GPIO.setup(acid_level_sensor_pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
GPIO.add_event_detect(acid_level_sensor_pin, GPIO.BOTH)
GPIO.setup(chlorine_level_sensor_pin, GPIO.IN, pull_up_down=GPIO.PUD_DOWN)
GPIO.add_event_detect(chlorine_level_sensor_pin, GPIO.BOTH)
acid_level_sensor_prev = -1
acid_level_sensor_prev_time = -1
chlorine_level_sensor_prev = -1
chlorine_level_sensor_prev_time = -1

log("   Liquid level sensors")

# Create an ADS1115 ADC (16-bit) instance.
adc = Adafruit_ADS1x15.ADS1115()
log("   ADC for PSI Readings initialized")

# set a global variable to hold current pump rpm
current_pump1_rpm = 0
pool_temp_f = 0
ph = 0
orp = 0
log("   Pool variables initialiazed")

## Setup Atlas Scientific devices
ph_sensor = AtlasI2C()
ph_sensor_address = 99
ph_sensor.set_i2c_address(ph_sensor_address)
ph_sensor.wake()
log("   pH I2C address set to " + str(ph_sensor_address))

orp_sensor = AtlasI2C()
orp_sensor_address = 98
orp_sensor.set_i2c_address(orp_sensor_address)
log("   orp I2C address set to " + str(orp_sensor_address))
orp_sensor.wake()
orp_sensor.query("C,0") #disable continuous query mode
orp_ph_sensor_sleep = 0


###### Connection to nodejs-poolController
nodejspoolController_base_url = "http://"

###### INFLUX
influx_database = 'pool'
client = InfluxDBClient('', 32769,'','',influx_database)

log("   InfluxDB Connection established")

###### Twilio
# Your Account SID from twilio.com/console
account_sid = ""
# Your Auth Token from twilio.com/console
auth_token  = ""

twilio_to = "+"
twilio_from = "+"
twilio_client = Client(account_sid, auth_token)
log("   Authenticated with Twilio")

log("***FINISHED INITIALIZATION***")

def influxdb_initializeDB():
    found = False
    dbs = client.get_list_database()
    debug("Influx Check Database")
    for db in dbs:
        debug('   found DB: {0}'.format(db))
        if db['name']==influx_database:
            found = True
            break
    if not found:
        log('Influx: Creating database {0}'.format(influx_database))
        client.create_database(influx_database)
    else:
        log('Influx: Found existing database {0}'.format(influx_database))




def influxdb_write(measurement, tags, fields):
    global client
    # Expecting measurement to be a name, tags to be a json object, and fields to be a json object.
    # We will not pass time and let the database handle that.
    # >>> example json_body = [
    #     {
    #         "measurement": "cpu_load_short",
    #         "tags": {
    #             "host": "server01",
    #             "region": "us-west"
    #         },
    #         "time": "2009-11-10T23:00:00Z",
    #         "fields": {
    #             "value": 0.64
    #         }
    #     }
    # ]
    # >>> client.write_points(json_body, time_precision='s')
    json_body = [
        {
            "measurement": measurement,
            "tags": tags,
            "fields": fields
        }
    ]
    result = client.write_points(json_body,'s')
    if result == False:
        log("ERROR!!! Write result for {0} is {1}".format(measurement,result))
        send_twilio_sms("InfluxDB", "Cannot reach server.")


def influxdb_query(query):
    global client
    result = client.query(query)
    return result

###### PH/ORP #######



def ph_orp_read():
    global ph
    global orp
    global pool_temp_f
    global orp_ph_sensor_sleep
    orp_sensor.wake()  # wake up from standby
    ph_sensor.wake()
    time.sleep(.5)
    #get pool temperature
    pool_temp_f = get_pool_temp_f()
    debug("   Setting pool temp of sensors as %d" % pool_temp_f)
    pool_temp_c = float(5 * (pool_temp_f - 32) / 9)
    debug("   Sending pool temp {0}°F to Atlas pH Sensor".format(pool_temp_f))

    # there is NO temp calibration for orp...  <orp_sensor.query("T,%d" % pool_temp)>

    ph_sensor.query("T,{0}".format(pool_temp_c))
    time.sleep(1)
    orp = orp_sensor.query("R")
    ph = ph_sensor.query("R")
    orp_sensor.queryStr("Sleep")  # set to standby
    ph_sensor.queryStr("Sleep")
    orp_ph_sensor_sleep = 1

    log ("pH of sensor is {0}".format(ph))
    log ("orp of sensor is {0}".format(orp))
    measurement = "chemistry"
    ph_tags = {"type":"ph", "source": "python_app"}
    orp_tags = {"type":"orp", "source": "python_app"}
    ph_fields = {"value": ph}
    orp_fields = {"value": orp}
    influxdb_write(measurement, ph_tags, ph_fields)
    influxdb_write(measurement, orp_tags, orp_fields)



def get_chemistry(chem, math_function, at_least_n_values):
    # Function to retrieve math_function (eg mean) values with minimum count of entries

    count_query = "select count(*) from chemistry where time > now()-" + str(lookback_time_for_chemistry_readings) + "m and \"type\" =\'" + chem + "\'"
    mean_query = "select mean(\"value\") from chemistry where time > now()-" + str(lookback_time_for_chemistry_readings) + "m and \"type\" =\'" + chem + "\'"


    count_rs = influxdb_query(count_query)
    if list(count_rs) == []:
        return None
    else:
        count_val = list(count_rs.get_points(measurement='chemistry'))[0]["count_value"]
        if count_val > at_least_n_values:
            rs = influxdb_query(mean_query)
            value = list(rs.get_points(measurement='chemistry'))[0][math_function]
            return value
        else:
            return None


####### MANAGE PUMP RELAYS ########

def pump_relays():
    global acid_pump_relay_state
    global chlorine_pump_relay_state
    global ph
    global orp
    global which_tank_pump_running
    global tank_pump_prev_switch_time
    global tank_pump_switch_desired_delay
    measurement = "chemistry"
    # read ph and orp for calculations


    chlorine_pump_run_duration = 10
    acid_pump_run_duration = 10

    log("Starting Tank Pump Relay Logic")

    last_pump_change_query = "select status from tank_pump where \"type\"=\'pump_change\' order by desc limit 1"
    last_pump_change_rs = influxdb_query(last_pump_change_query)
    if list(last_pump_change_rs) == []:
        log("      No previous tank pump changes recorded.")
        tank_pump_prev_switch_time = 0
    else:
        tank_pump_prev_switch_time = list(last_pump_change_rs.get_points(measurement='tank_pump'))[0]["time"]
        tank_pump_prev_switch_time = tf_from_timestamp(tank_pump_prev_switch_time)

    debug("tank_pump_time_remaining_until_switch_in_mins ({0:.2f})= \n   tank_pump_switch_desired_delay({1} mins) - (( time.time() ({2}) - tank_pump_prev_switch_time ({3}) ) {4:.2f}/ 60) # for mins".format(tank_pump_switch_desired_delay - (( time.time() - tank_pump_prev_switch_time ) / 60), tank_pump_switch_desired_delay , time.ctime(time.time()), time.ctime(tank_pump_prev_switch_time), time.time() - tank_pump_prev_switch_time))

    tank_pump_time_remaining_until_switch_in_mins = tank_pump_switch_desired_delay - (( time.time() - tank_pump_prev_switch_time ) / 60) # for mins
    if tank_pump_time_remaining_until_switch_in_mins <=0:
        tank_pump_time_remaining_until_switch_in_mins=0

    # Logic and thoughts
    # Mixing chlorine and acid creates a toxic gas.  General rule of thumb is 30 min - 1 hour between adding each chemical.
    # The amounts we add here are so small it probably isn't a big issue, but we should still leave 5? 10? minutes between each chemical.
    # That also brings into play how long each pump runs before switching.
    # EG if we need total run time of 4 hours per pump do we run chlorine for 2 hours, acid for 2 hours and repeat?  Or acid for 4 hours and then chlorine for 4 only 1x?

    # -1 should only be for the first time the app is running.  Maybe put this in Influx?
    if (tank_pump_time_remaining_until_switch_in_mins <= 0) :
        if which_tank_pump_running == "acid":
            log("   ACID PUMP:  Getting PH Data")
            mean_ph = get_chemistry("ph", "mean", number_of_chemistry_readings_required)
            if mean_ph is None:
                log("      Not enough pH data values in last {0}m.".format(number_of_chemistry_readings_required))
            else:
                log("      Mean ph for last 5 mins is {0} and acid pump relay state is {1}".format(mean_ph, tank_pump_relay_state_str(acid_pump_relay_state)))


                # If the pH is HIGH and pump is off, dose acid
                if (mean_ph >= ph_upper_threshold):

                    log("      Requesting to turn ON acid pump")
                    run_pump_for_duration("acid", acid_pump_run_duration )

                # turn off when ph drops to x and the pump is running.
                else:
                    log("      Pool ph at desired level.  Switching to Chlorine pump.")
                    log("      Will start Chlorine pump after {} min delay".format(tank_pump_switch_desired_delay))
                    turn_off_tank_pump("acid")  # just to be sure
                    which_tank_pump_running = "chlorine"
                    # tank_pump_prev_switch_time = time.time()
                    filter_tags = {"source": "python_app", "type": "pump_change", "from_str": "acid", "to_str": "chlorine"}
                    # can also store types for when the pump filter was cleaned
                    filter_fields = {"status": 1.0}
                    influxdb_write("tank_pump", filter_tags, filter_fields)
                if (mean_ph > ph_upper_threshold*(100+alert_threshold)/100 or mean_ph < ph_lower_threshold*(100-alert_threshold)/100):
                    # should change this to be +/- 10% or something like that, not hardcoded in case we change the params
                    send_twilio_sms("PH", "Value out of range ({:.2f})".format(mean_ph),12*60)

        elif which_tank_pump_running == "chlorine":

            # Chlorine only should run with pool temp is < 65 or there is a big party where SWG can't keep up.
            log("   CHLORINE PUMP:  Getting ORP Data in last {0}m.".format(number_of_chemistry_readings_required))
            mean_orp = get_chemistry("orp", "mean", number_of_chemistry_readings_required)
            if mean_orp is None:
                log("      Not enough ORP data values in last {0}m. Skipping Chlorine Dosing. (Temp <=65 degrees)".format(number_of_chemistry_readings_required))
            else:
                log("      Mean orp for last 5 mins is {0} and acid pump relay state is {1}".format(mean_orp, tank_pump_relay_state_str(acid_pump_relay_state)))
                if  pool_temp_f<=65:
                    if (mean_orp <= orp_lower_threshold):

                        log("      Requesting to turn ON chlorine pump")
                        run_pump_for_duration("chlorine", chlorine_pump_run_duration)

                        # turn off when ph drops to 7.6 and the pump is running.
                    else:
                        log("      Pool ORP (chlorine) has returned to desired level (Temp <=65 degrees).  Switching to Acid tank.")
                        log("      Will start Acid pump after {} minute delay".format(tank_pump_switch_desired_delay))
                        turn_off_tank_pump("chlorine")  # just to be sure
                        which_tank_pump_running = "acid"
                        # tank_pump_prev_switch_time = time.time()
                        filter_tags = {"source": "python_app", "type": "pump_change", "from_str": "chlorine", "to_str": "acid"}
                        # can also store types for when the pump filter was cleaned
                        filter_fields = {"status": 1.0}
                        influxdb_write("tank_pump", filter_tags, filter_fields)

                else:
                    # supplement to SWG if ORP drops too low
                    if mean_orp <= orp_upper_threshold:
                        # how to handle this?  Should first increase SWG %?
                        log("      Pool ORP (chlorine) LOWER than threshold.  Need some extra love... CODE ME!")
                    else:
                        log("      Pool ORP (chlorine) has returned to desired level (Temp >65 degrees).  Switching to Acid tank.")
                        future_time = time.time() + 30
                        print time.time()
                        print future_time
                        log("      Will start Acid pump in {0:.2f} minutes = {1}".format(tank_pump_switch_desired_delay, time.ctime(future_time)))
                        turn_off_tank_pump("chlorine")  # just to be sure
                        which_tank_pump_running = "acid"
                        # tank_pump_prev_switch_time = time.time()
                        filter_tags = {"source": "python_app", "type": "pump_change", "from_str": "chlorine", "to_str": "acid"}
                        # can also store types for when the pump filter was cleaned
                        filter_fields = {"status": 1.0}
                        influxdb_write("tank_pump", filter_tags, filter_fields)


                if (mean_orp > orp_upper_threshold*(100+alert_threshold)/100 or mean_orp < orp_lower_threshold*(100-ph_lower_threshold)/100):
                    # send an alert for out of range, but only if it hasn't been sent in past 12 hours
                    send_twilio_sms("ORP", "Value out of range ({:.2f})-Temp<=65".format(mean_orp),12*60)

    else:
        log("      Waiting {0:.1f} minutes until we start the {1} tank".format(tank_pump_time_remaining_until_switch_in_mins, which_tank_pump_running))


def tank_pump_relay_state_str(val):
    # the relays run on low/On and high/Off logic
    if val==0:
        return "on"
    elif val==1:
        return "off"
    else:
        return 'Unknown'

tank_off_thread = None
def run_pump_for_duration(tank_pump, sec):
    global tank_off_thread
    #log("Running Tank Pump:  Turning on %s tank pump for %i sec" % (tank_pump, sec))
    turn_on_tank_pump(tank_pump)
    #log("Starting timer to turn off pump")
    tank_off_thread = threading.Timer(sec, turn_off_tank_pump, [tank_pump])
    tank_off_thread.start()



def turn_off_tank_pump(tank_pump):
    global acid_pump_relay_pin
    global acid_pump_relay_state
    global chlorine_pump_relay_pin
    global chlorine_pump_relay_state
    measurement = "tank_pump"
    if tank_pump=="acid":

        if acid_pump_relay_state==GPIO.HIGH:
            log("Tank pump ACID: Asking to turn off pump, but it is already off.")
        else:
            log("Tank pump ACID: acid pump on.  changing to off.")

            # for Influx Integral, log the previous state and current state back to back
            filter_tags = {"pump": "acid", "source": "python_app", "type": "current_state"}
            # can also store types for when the pump filter was cleaned
            filter_fields = {"status": 1}
            influxdb_write(measurement, filter_tags, filter_fields)

            GPIO.output(acid_pump_relay_pin, GPIO.HIGH)
            acid_pump_relay_state = GPIO.HIGH

            filter_tags = {"pump": "acid", "source": "python_app", "type": "state_change", "from_str": "on", "to_str": "off"}
            # can also store types for when the pump filter was cleaned
            filter_fields = {"from_int": 1.0, "to_int": 0.0, "status": 0.0}
            influxdb_write(measurement, filter_tags, filter_fields)

    elif tank_pump=="chlorine":
        if chlorine_pump_relay_state == GPIO.HIGH:
            log("Tank pump CLORINE: Asking to turn off " + tank_pump + " pump, but it is already off.")
        else:
            log("Tank pump CLORINE: chlorine pump on.  changing to off.")

            # for Influx Integral, log the previous state and current state back to back
            filter_tags = {"pump": "chlorine", "source": "python_app", "type": "current_state"}
            # can also store types for when the pump filter was cleaned
            filter_fields = {"status": 1}
            influxdb_write(measurement, filter_tags, filter_fields)

            GPIO.output(chlorine_pump_relay_pin, GPIO.HIGH)
            chlorine_pump_relay_state = GPIO.HIGH

            filter_tags = {"pump": "chlorine", "source": "python_app", "type": "state_change", "from_str": "on", "to_str": "off"}
            # can also store types for when the pump filter was cleaned
            filter_fields = {"from_int": 1.0, "to_int": 0.0, "status": 0.0}
            influxdb_write(measurement, filter_tags, filter_fields)

    else:
        log("Unknown pump (" + tank_pump + ") string received.")


def turn_on_tank_pump(tank_pump):
    global acid_pump_relay_pin
    global acid_pump_relay_state
    global chlorine_pump_relay_pin
    global chlorine_pump_relay_state
    measurement = "tank_pump"
    if tank_pump == "acid":

        if acid_pump_relay_state == GPIO.LOW:
            log("Tank pump ACID: Asking to turn on " + tank_pump + " pump, but it is already on.")
        else:
            log("Tank pump ACID: acid pump off.  changing to on.")

            # for Influx Integral, log the previous state and current state back to back
            tank_tags = {"pump": "acid", "source": "python_app", "type": "current_state"}
            tank_fields = {"status": 0.0}
            influxdb_write(measurement, tank_tags, tank_fields)

            GPIO.output(acid_pump_relay_pin, GPIO.LOW)
            acid_pump_relay_state = GPIO.LOW

            tank_tags = {"pump": "acid", "source": "python_app", "type": "state_change", "from_str": "off", "to_str": "on"}
            tank_fields = {"from_int": 0.0, "to_int": 1.0, "status": 1.0}
            influxdb_write(measurement, tank_tags, tank_fields)

    elif tank_pump == "chlorine":
        if chlorine_pump_relay_state == GPIO.LOW:
            log("Tank pump CLORINE: Asking to turn on pump, but it is already on.")
        else:
            log("Tank pump CLORINE: chlorine pump off.  changing to on.")

            # for Influx Integral, log the previous state and current state back to back
            tank_tags = {"pump": "chlorine", "source": "python_app", "type": "current_state"}
            tank_fields = {"status": 0.0}
            influxdb_write(measurement, tank_tags, tank_fields)

            GPIO.output(chlorine_pump_relay_pin, GPIO.HIGH)
            chlorine_pump_relay_state = GPIO.HIGH

            tank_tags = {"pump": "chlorine", "source": "python_app", "type": "state_change"}
            tank_fields = {"status": 0.0}
            influxdb_write(measurement, tank_tags, tank_fields)

    else:
        log("Unknown pump (" + tank_pump + ") string received.")


####### MANAGE SWG ########
def manage_swg():
    # orp_lower_threshold = 640
    # orp_upper_threshold = 670
    log("Manage SWG Output Percentages")
    if pool_temp_f <= 65:
        # turn off SWG; it's ineffective
        set_swg_level(0)
    else:
        # tune SWG
        # ideal is to find the sweetspot where the output % keep the orp right between upper and lower thresholds,
        # but of course that will vary significantly due to sun, temp, bathers, etc

        # starting assumptions
        # 20% output will keep swg within the 50% (middle quartile) between upper/lower

        # get swg current level
        current_swg_level = get_pool_data("chlorinator", "outputPoolPercent")

        # get mean org for last 5 mins.
        mean_orp = get_chemistry("mean", "orp", number_of_chemistry_readings_required)
        if mean_orp is None:
            log("   Not enough ORP data values in last 10m. Skipping Chlorine Dosing. (Temp >=65 degrees")
        else:


            quartile = (orp_upper_threshold-orp_lower_threshold) / 4
            good_range_low = orp_lower_threshold + quartile
            good_range_high = orp_upper_threshold - quartile
            set_level = 50
            if orp >= good_range_low and orp <= good_range_high:
                # between 647.5 and 662.5
                set_level = 50
            elif orp > good_range_high and orp < orp_upper_threshold:
                # between 662.5 and 670
                set_level = 25
            elif orp < good_range_low and orp > orp_lower_threshold:
                # between 640 and 647.5
                set_level = 75
            elif orp < orp_lower_threshold:
                # less than 640
                set_level = 100
            elif orp > orp_upper_threshold:
                # greater than 670
                set_level = 5

            set_swg_level(set_level)
            log("   Setting SWG to {0}% (from {1}%)".format(set_level, current_swg_level))


            if (mean_orp > orp_upper_threshold * (100 + alert_threshold) / 100 or mean_orp < orp_lower_threshold * (
                    100 - ph_lower_threshold) / 100):
                # send an alert for out of range, but only if it hasn't been sent in past 12 hours
                send_twilio_sms("ORP", "Value out of range ({}) - Temp>65".format(mean_orp), 12 * 60)


####### READ PUMP PSI ########

def read_pump_psi():

    # Read all the ADC channel values in a list.
    # Note you can change the I2C address from its default (0x48), and/or the I2C
    # bus by passing in these optional parameters:
    #adc = Adafruit_ADS1x15.ADS1015(address=0x49, busnum=1)

    # Choose a gain of 1 for reading voltages from 0 to 4.09V.
    # Or pick a different gain to change the range of voltages that are read:
    #  - 2/3 = +/-6.144V
    #  -   1 = +/-4.096V
    #  -   2 = +/-2.048V
    #  -   4 = +/-1.024V
    #  -   8 = +/-0.512V
    #  -  16 = +/-0.256V
    # See table 3 in the ADS1015/ADS1115 datasheet for more info on gain.
    GAIN = 1
    values = [0]*4

    log("PUMP PSI")

    current_filter_change_query = "select max(current_filter_change) from filter where \"type\"=\'change\' order by desc limit 1"
    filter_change_rs = influxdb_query(current_filter_change_query)
    if list(filter_change_rs) == []:
        current_filter_change = 0.0 # first time we are writing to DB
        # write record to DB
        filter_tags = {"source": "python_app", "type": "change"}
        # can also store types for when the pump filter was cleaned
        filter_fields = {"current_filter_change": current_filter_change}
        influxdb_write('filter', filter_tags, filter_fields)
    else:
        current_filter_change = list(filter_change_rs.get_points(measurement='filter'))[0]["max"]


    for i in range(4):
        # Read the specified ADC channel using the previously set gain value.
        values[i] = adc.read_adc(i, gain=GAIN)
        # Note you can also pass in an optional data_rate parameter that controls
        # the ADC conversion time (in samples/second). Each chip has a different
        # set of allowed data rate values, see datasheet Table 9 config register
        # DR bit values.
        #values[i] = afrdc.read_adc(i, gain=GAIN, data_rate=128)
        # Each value will be a 12 or 16 bit signed integer value depending on the
        # ADC (ADS1015 = 12-bit, ADS1115 = 16-bit).
    # Print the ADC values.
    debug("   Reading Pressure Transducer Digital Conversion (0-32767): {0}".format(values[3]))


    # ((sensorVoltage x conversionRate)-inducerOffset) x psiPerVolt=PSI
    # sensorVoltage - the reading coming from the analog to digital reading
    # conversionRate - This is the range of readings (accuracy) of the analog to digital chip. For my chip it's 16-bit so 32767 at 4.096v. 4.096/32767=.000125 volts per increment of 1 digital value. I took a quick look but couldn't find the chip on the Monteino. If it is 12-bit ADC you would use 2048 instead of 32767 for the calculation.
    # inducerOffset - the inducer starts at 0.5v for 0 PSI so we subtract the .5v
    # psiPerVolt - looks like you have this right. The inducer outputs 25 psi per Volt.
    sensorVoltage = values[3]
    conversionRate = 4.096/32767
    inducerOffset = 0.5
    psiPerVolt = 25
    voltage = sensorVoltage * conversionRate
    psi = ((voltage)-inducerOffset) * psiPerVolt
    voltage = round(voltage, 2)
    psi = round(psi, 2)
    log('   Sensor voltage is {0} and PSI is {1}'.format(voltage, psi))

    measurement = "filter"
    filter_tags = {"type": "reading", "current_filter_change": current_filter_change}
    # can also store types for when the pump filter was cleaned
    global current_pump1_rpm
    if current_pump1_rpm is None:
        current_pump1_rpm = get_pool_data("pump", "current_pump1_rpm")
    debug("   Current pump rpm: {0}".format(current_pump1_rpm))

    # do not log
    if voltage<.5:
        filter_fields = {"adc": values[0], "voltage": voltage , "psi": psi, "pump1_rpm": current_pump1_rpm}
        debug("   Writing pump rpm filter values: {0}; {1}; {2}".format(measurement, filter_tags, filter_fields))

        influxdb_write(measurement, filter_tags, filter_fields)
        check_filter_change_psi(current_filter_change)
    else:
        if "notset" in current_pump1_rpm:
            log("   Not writing pump speed and PSI because the pump speed is not present yet.")
        elif voltage < .5:
            log("   Not writing pump speed and PSI because voltage is below threshold (.5v).")
        else:
            log("   Not writing pump speed and PSI for unknown reason.")


def check_filter_change_psi(current_filter_change):
    # if starting PSI + 10 > current PSI, send alert
    # need to check at higher RPM only

    # get last checked time at JETS rpm
    psi_query = "select min(psi),max(psi) from filter where \"current_filter_change\"={0} and \"type\"=\'reading\' and \"pump1_rpm\" = 2300".format(current_filter_change)
    psi_rs = influxdb_query(psi_query)
    if list(psi_rs) == []:
        log("   No values at filter change {0} for 2300 rpm".format(current_filter_change))
    else:
        min_psi = list(psi_rs.get_points(measurement='filter'))[0]["min"]
        max_psi = list(psi_rs.get_points(measurement='filter'))[0]["max"]
        pressure_change = max_psi - min_psi
        log("   Filter PSI Change ({0}-{1}): {2}".format(max_psi, min_psi, pressure_change ))
        if pressure_change > 10:
            log("ALERT!!! Filter has increased {0} psi from {1} to {2}".format(pressure_change, min_psi, max_psi))
            send_twilio_sms("Filter", "Filter has increased by {0} PSI.".format(pressure_change), 24*60)

####### READ ACID LEVEL ########


def read_tank_levels():
    global acid_level_sensor_prev
    global acid_level_sensor_prev_time
    global acid_level_sensor_current

    global chlorine_level_sensor_prev
    global chlorine_level_sensor_prev_time
    global chlorine_level_sensor_current

    log("\n0. Reading Tank Liquid Levels upon App Startup")



    # Read current state
    acid_level_sensor_current = GPIO.input(acid_level_sensor_pin)
    log("   Acid Level Sensor: {0}".format(acid_level_sensor_current))

    # Read current state
    chlorine_level_sensor_current = GPIO.input(chlorine_level_sensor_pin)
    log("   Chlorine Level Sensor: {0}".format(chlorine_level_sensor_current))


    # Checking to see if tank_level measurements exist in db
    count_query = "select count(*) from tank_level"
    count_rs = influxdb_query(count_query)
    if list(count_rs) == []:
        log('NO DATA YET on tank_level measurement.  Must be the first time running.')
        write_tank_levels("chlorine", chlorine_level_sensor_current)
        write_tank_levels("acid", chlorine_level_sensor_current)



    # Read previous (db) state
    acid_level_sensor_prev = query_last_tank_level("acid")

    # If the liquid level sensor (acid or bleach) reads LOW, send alerts, set flag to delay for 3 days.  Reset flag when sensor reads NORMAL.
    #    Record in Influx(?) the amount of chemicals (and strength of chemicals) added
    #    It should always be 10% diluted 4:1

    # If state is not equal to current state, and trigger a manual change
    if acid_level_sensor_current <> acid_level_sensor_prev:
        # change in state
        log("   Acid level is DIFFERENT, triggering a change")
        acid_level_change(acid_level_sensor_current)
    else:
        log("   Acid level has not changed.")

        # Else, write current state,
        write_tank_levels("acid", acid_level_sensor_current)



    # Read previous (db) state
    chlorine_level_sensor_prev = query_last_tank_level("chlorine")

    # If state is not equal to current state, and trigger a manual change
    if chlorine_level_sensor_current <> chlorine_level_sensor_prev:
        # change in state
        log("   Chlorine level is DIFFERENT, triggering a change")
        chlorine_level_change(chlorine_level_sensor_current)
    else:
        log("   Chlorine level has not changed.")

        # Else, write current state,
        write_tank_levels("chlorine", chlorine_level_sensor_current)
    log("")


def write_tank_levels(container, level):
    # these will be the same for every measurement we record
    measurement = "tank_level"
    if level == 0:
        description = "low"
    else:
        description = "ok"
    level = level*1.0 # convert to float
    level_tags = {"type": container, "source": "python_app", "description": description}


    level_fields = {"status": level}
    influxdb_write(measurement, level_tags, level_fields)



def query_last_tank_level_time(container, level):
    level_query = "select * from tank_level where \"type\"=\'" + container + "\' and \"status\"=" + str(level) + " group by * order by desc limit 1"
    level_rs = influxdb_query(level_query)
    if list(level_rs) == []:
        #print 'NO DATA YET on last tank levels.  Must be the first time running.'
        return None
    last_time = list(level_rs.get_points(measurement='tank_level'))[0]["time"]
    ts = tf_from_timestamp(last_time)
    return ts

def query_last_tank_level(container):
    level_query = "select * from tank_level where \"type\"=\'" + container + "\' group by * order by desc limit 1"
    level_rs = influxdb_query(level_query)

    if list(level_rs) == []:
        #print 'NO DATA YET on last tank levels.  Must be the first time running.'
        return None
    else:
        last_level = list(level_rs.get_points(measurement='tank_level'))[0]["status"]
        last_time = list(level_rs.get_points(measurement='tank_level'))[0]["time"]
        return last_level


##### ACID TANK LEVEL CALLBACK #####
def acid_level_change(self):
    global acid_level_sensor_prev
    global acid_level_sensor_prev_time
    global acid_level_sensor_pin
    acid_level_sensor_current = GPIO.input(acid_level_sensor_pin)
    log("Acid level Sensor CHANGED.")

    # if new state is 0, query for previous 1 state or vice versa
    acid_level_sensor_prev_time = query_last_tank_level_time('acid', acid_level_sensor_prev)


    if (acid_level_sensor_current == 0):
        log("    Acid sensor is LOW/0 at {0}.  Duration: {1}".format(time.strftime('%l:%M:%S%p '), timedelta(seconds=time.time()-acid_level_sensor_prev_time)))
        send_twilio_sms("Acid tank", "Tank is reporting low.", 12*60)
    else:
        log("    Acid sensor is OK/1 at {0}.  Duration: {1}".format(time.strftime('%l:%M:%S%p '), timedelta(seconds=time.time()-acid_level_sensor_prev_time)))


    # for the InfluxDB Integral operation, record the prev status followed immediately by the current status.
    write_tank_levels("acid", acid_level_sensor_prev)
    time.sleep(1)
    write_tank_levels("acid", acid_level_sensor_current)

    acid_level_sensor_prev_time = time.time()

    # update our variable
    acid_level_sensor_prev = acid_level_sensor_current





###### CHLORINE TANK LEVEL CALLBACK #######
def chlorine_level_change(self):
    global chlorine_level_sensor_prev
    global chlorine_level_sensor_prev_time
    global chlorine_level_sensor_pin
    chlorine_level_sensor_current = GPIO.input(chlorine_level_sensor_pin)
    log("Chlorine level Sensor CHANGED.")

    # if new state is 0, query for previous 1 state or vice versa
    chlorine_level_sensor_prev_time =  query_last_tank_level_time('chlorine', chlorine_level_sensor_prev)

    if (chlorine_level_sensor_current == 0):
        log("    Chlorine sensor is LOW/0 at {0}.  Duration: {1}".format(time.strftime('%l:%M:%S%p '),timedelta(seconds=time.time()-chlorine_level_sensor_prev_time)))
        send_twilio_sms("Chlorine tank", "Tank is reporting low.", 12*60)
    else:
        log("    Chlorine sensor is OK/1 at {0}.  Duration: {1}".format(time.strftime('%l:%M:%S%p '), timedelta(seconds=time.time()-chlorine_level_sensor_prev_time)))


    # for the InfluxDB Integral operation, record the prev status followed immediately by the current status.
    write_tank_levels("chlorine", chlorine_level_sensor_prev)
    time.sleep(1)
    write_tank_levels("chlorine", chlorine_level_sensor_current)

    chlorine_level_sensor_prev_time = time.time()

    # update our variable
    chlorine_level_sensor_prev = chlorine_level_sensor_current

# Add callback for event change listener
GPIO.add_event_callback(acid_level_sensor_pin, acid_level_change)
# Add callback for event change listener
GPIO.add_event_callback(chlorine_level_sensor_pin, chlorine_level_change)



####### GET/SET POOL DATA  #########

# Function to talk to pump control software
# See https://github.com/tagyoureit/nodejs-poolController
def get_pool_data(equipment, key):
    global pump_data
    # TODO: If we cannot reach the poolcontroller app, send an alert

    req = urllib2.Request(nodejspoolController_base_url + '/' + equipment)
    opener = urllib2.build_opener()
    f = opener.open(req)
    d = f.read()
    # type(d)
    data = json.loads(d)
    pump_data = data[equipment]["1"][key]
    ##pump_rpm = rpm["pump"]["1"]["rpm"]
    return pump_data

def get_pool_temp_f():
    global pool_temp_f
    req = urllib2.Request(nodejspoolController_base_url + '/temperature')
    opener = urllib2.build_opener()
    f = opener.open(req)
    d = f.read()
    # type(d)
    data = json.loads(d)
    pool_temp_p = data["temperature"]["poolTemp"]
    ##pump_rpm = rpm["pump"]["1"]["rpm"]


    #return pool_temp_f
    ###### FIX WHEN POOL IS RUNNING AGAIN
    return 65

def set_swg_level(level):
    req = urllib2.Request(nodejspoolController_base_url + '/chlorinator/' + level)
    opener = urllib2.build_opener()
    f = opener.open(req)
    d = f.read()
    # type(d)
    print f
    ### TODO: what to do here?  Return the value?

def read_chemistry_from_influx():
    # need to read the following and return them
    # level_query = "select * from tank_level where \"type\"=\'" + container + "\' and \"status\"=" + str(level) + " group by * order by desc limit 1"
    global pool_temp_f

    try:
        ph_query = "select * from chemistry where \"type\"=\'ph\' order by desc limit 1"
        ph_rs = influxdb_query(ph_query)
        ph  = list(ph_rs.get_points(measurement='chemistry'))[0]["value"]
        ch_query = "select * from chemistry where \"type\"=\'ch\' order by desc limit 1"
        ch_rs = influxdb_query(ch_query)
        ch = list(ch_rs.get_points(measurement='chemistry'))[0]["value"]
        cya_query = "select * from chemistry where \"type\"=\'cya\' order by desc limit 1"
        cya_rs = influxdb_query(cya_query)
        cya = list(cya_rs.get_points(measurement='chemistry'))[0]["value"]
        ta_query = "select * from chemistry where \"type\"=\'ta\' order by desc limit 1"
        ta_rs = influxdb_query(ta_query)
        ta = list(ta_rs.get_points(measurement='chemistry'))[0]["value"]
        salt_query = "select * from chemistry where \"type\"=\'salt\' order by desc limit 1"
        salt_rs = influxdb_query(salt_query)
        salt = list(salt_rs.get_points(measurement='chemistry'))[0]["value"]
        pool_temp_f = get_pool_temp_f()
        pool_temp_oC = float(5 * (pool_temp_f - 32) / 9)
    except:
        return None

    chemistry_rs = {"ph":float(ph), "ch": float(ch), "cya": float(cya), "ta": float(ta), "borates": 0, "oC": float(pool_temp_oC), "salt": float(salt)}
    return chemistry_rs


chemistry = {}

def calculate_csi():
    '''
    From chem geek at https://www.troublefreepool.com/threads/19688-CSI-formula?p=166165&viewfull=1#post166165:

    A very close approximation to the accurate Calcite Saturation Index uses the following formulas (I do refer to these in that post, but in the spreadsheet itself, not in the text of the post):

    LSI = pH - 6.9395 + log(ppm CH) + log(ppm CarbAlk) - 2.56*sqrt(I)/(1+1.65*sqrt(I)) - 1412.5/(oC+273.15)

    I = (1.5*(ppm CH)+(ppm TA))/50045 + (extra NaCl ppm)/58440

    extra NaCl ppm = Salt - 1.168*(ppm CH), but if <0 then use 0

    ppm CarbAlk = (ppm TA) - 0.38772*(ppm CYA)/(1+10^(6.83-pH)) - 4.63*(ppm Borates)/(1+10^(9.11-pH)) 


    The "log" are logarithms to the base 10 (i.e. they aren't "ln"). So start with the bottom formula and work your way up. So first calculate CarbAlk using TA and CYA.
    Then calculate the extra salt via the TDS, CH, CarbAlk just calculated and CYA. Then calculate the "I" which is the ionic strength using the CH, TA and
    extra NaCl (salt) that was calculated. Finally, the LSI is computed.

    Obviously, the above is best done online, or in a spreadsheet, or in a program. Michael Smith can add this to BleachCalc and you can add this to your online calculations.
    It will be close to, but not the same as, the Langelier Saturation Index (LSI), but will actually be more accurate. It seems to be virtually the same as the Taylor Watergram
    wheel except at very high temperatures above 120F and even then the error is small. You'll need to convert the temperature from Fahrenheit to Celsius but that's just
    oC = 5*(oF - 32)/9. The LSI as used by the pool industry is actually incorrect and uses logarithms for the temperature and TDS portions of the computation when they should
    have used the formulas I showed above, but then they were trying to simplify things though the temperature formula isn't complicated so I'm not sure why they went with
    logarithms for that except to "appear" consistent with all factors except for pH (which is already a logarithm).
    '''
    global chemistry
    chemistry = read_chemistry_from_influx()
    if chemistry is not None:
        log("STARTING CSI ANALYSIS")
        #log("   CHEMISTRY Result: " + json.dumps(chemistry))

        CarbAlk = chemistry["ta"] - 0.38772*chemistry["cya"]/(1+pow(10,(6.83-chemistry["ph"]))) - 4.63*chemistry["borates"]/(1+pow(10,(9.11-chemistry["ph"])))


        extra_NaCL =  chemistry["salt"] - 1.168*chemistry["ch"]
        #log("   extra_NaCL: " + str(extra_NaCL))
        if extra_NaCL < 0:
            extra_NaCL = 0
        #log("   extra NaCL (should be 0 if prev res was less than 0): " + str(extra_NaCL))

        I = (1.5*chemistry["ch"]+chemistry["ta"])/50045 + extra_NaCL/58440
        #log("   I: " + str(I))

        CSI = chemistry["ph"] - 6.9395 + math.log10(chemistry["ch"]) + math.log10(CarbAlk) - 2.56*math.sqrt(I)/(1+1.65*math.sqrt(I)) - 1412.5/(chemistry["oC"]+273.15)
        log("   CHEMISTRY CSI: " + str(CSI))


        # Write results back to DB
        measurement = "chemistry"
        level_tags = {"source": "python_app", "type": "csi"}
        level_fields = {"value": CSI}
        influxdb_write(measurement, level_tags, level_fields)
    else:
        log("Not enough values for CSI Analysis in Database.")

    return None

def send_twilio_sms(alert, body, snooze=None):
    # snooze = time in minutes
    send_message = False

    if snooze == None:
        send_message = True
    else:
        alert_query = "select * from alerts where \"alert\"=\'{0}\' order by desc limit 1".format(alert)
        alert_rs = influxdb_query(alert_query)
        if list(alert_rs) == []:
            # If no results returned from the query, send the alert
            send_message = True
            last_alert = "never"
        else:
            last_alert = list(alert_rs.get_points(measurement='alerts'))[0]["time"]

            ts = tf_from_timestamp(last_alert) # convert seconds to mins

            debug("last {0} alert timestamp: {1}".format(alert, time.ctime(ts)))
            delta = (time.time()-ts) / 60
            m_delta, s_delta = divmod(delta, 60)
            h_delta, m_delta = divmod(m_delta, 60)
            m_snooze, s_snooze = divmod(snooze, 60)
            h_snooze, m_snooze = divmod(m_snooze, 60)
            log("Alert: analyzing snooze time {0}h {1}m {2}s vs time since last alert {3:.0f}h {4:.0f}m {5:.0f}s.  Delta>=Snooze: {6}".format(h_snooze, m_snooze, s_snooze, h_delta, m_delta, s_delta, delta>=snooze))
            if delta>=snooze:
                send_message = True
# TODO: Why is it sending an alert when we start up the app???




    if send_message==True:
        message = twilio_client.messages.create(
            to=twilio_to,
            from_=twilio_from,
            body="{0}: {1}".format(alert, body))

        log("ALERT!!! {0}:{1}".format(alert, body))

        # record the message
        # Write results back to DB
        measurement = "alerts"
        level_tags = {"source": "python_app", "type": "twilio", "to": twilio_to, "from": twilio_from,  "alert": alert, "body": body}
        level_fields = {"sid": message.sid, "status": 1.0}
        influxdb_write(measurement, level_tags, level_fields)



def main():
    # initialize Influx and the DB
    influxdb_initializeDB()

    # Do this once when we load up the application, and thereafter it will be fired by an event.
    read_tank_levels()

    # Go to our loop
    pool_loop()


last_loop_run_time = None
def pool_loop():


    delaytime = 60  #in seconds
    csi_delaytime = delaytime * 5
    global current_pump1_rpm
    global main_thread
    global last_loop_run_time

    last_loop_run_time = 0

    while True:

        debug("last loop run time {}".format(last_loop_run_time))
        debug("delaytime: {}".format(delaytime))
        debug("time.time()-delaytime: {}".format(time.time() - delaytime))
        debug("time.time()-delaytime>last_loop_run_time: {}".format(time.time() - delaytime > last_loop_run_time))


        if time.time()-delaytime>last_loop_run_time:
            current_pump1_rpm = get_pool_data("pump", "rpm")

            current_timestamp = time.time()
            log("--------------Start of Readings------------")
            log("Starting new readings at {0}".format(time.strftime('%m/%d/%Y %H:%M:%S', time.localtime(current_timestamp))))

            log("   Analyzing pump 1.  Current rpm of Pump 1 is {0}".format(current_pump1_rpm))
            if current_pump1_rpm > 0 and "notset" not in current_pump1_rpm:
                log("   Pump Running")
                ph_orp_read()
                read_pump_psi()
                pump_relays()
                if time.time() - csi_delaytime > last_loop_run_time:
                    calculate_csi()
                else:
                    log('Not running CSI until we hit the delay.')
                # time.sleep(delaytime - AtlasI2C.long_timeout)
            else:
                log("   Pump NOT Running... will skip readings and turn off relays")
                ### PUT EZO CHIPS TO SLEEP
                global orp_ph_sensor_sleep
                if orp_ph_sensor_sleep == 0:
                    orp_sensor.queryStr("Sleep")  # set to standby
                    ph_sensor.queryStr("Sleep")
                    orp_ph_sensor_sleep = 1

                ### FOR TESTING WHILE PUMPS ARE DOWN
                ph_orp_read()
                read_pump_psi()
                pump_relays()

                if time.time() - csi_delaytime > last_loop_run_time:
                    calculate_csi()
                else:
                    debug('Not running CSI until we hit the delay.  Time until next run: (time.time()-csi_delaytime-last_loop_run_time: {}'.format(
                    time.time() - csi_delaytime - last_loop_run_time))

            log("--------------End of Readings--------------\n")
            # time.sleep(delaytime)



            # time_plus_delay = time.time() + delay

            last_loop_run_time = time.time()
        time.sleep(delaytime)


def destroy():
    if tank_off_thread <> None:
        tank_off_thread.cancel()
    GPIO.output(chlorine_pump_relay_pin, GPIO.HIGH)
    GPIO.output(acid_pump_relay_pin, GPIO.HIGH)
    GPIO.cleanup()
    log("\nCleanup Finished.  Exiting.")

if __name__ == '__main__':
    try:
        main()
        #while True: time.sleep(100)
    except requests.ConnectionError:
        log("OMG!  Influx is down... notify someone!!!")
        send_twilio_sms("Influx Down", "Cannot contact Influx Server.")
        # TODO: This will crash now because Influx can't be contacted.
    except KeyboardInterrupt:
        destroy()
