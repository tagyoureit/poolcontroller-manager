import RPi.GPIO as GPIO
import time

GPIO.setwarnings(False)  # Don't tell me about GPIO warnings.
GPIO.setmode(GPIO.BCM)  # Use BCM Pin Numbering Scheme


#### Tank Pump Relay Setup ####
## Setup GPIO Pins for sensors and relay
acid_pump_relay_pin = 13
chlorine_pump_relay_pin = 26
####### PUMP RELAYS ARE HIGH/OFF and LOW/ON!!!
GPIO.setup(acid_pump_relay_pin, GPIO.OUT, initial=GPIO.HIGH)
GPIO.setup(chlorine_pump_relay_pin, GPIO.OUT, initial=GPIO.HIGH)
acid_pump_relay_state = GPIO.HIGH
chlorine_pump_relay_state = GPIO.HIGH



def main():

    while True:
        GPIO.output(acid_pump_relay_pin, GPIO.HIGH)
        time.sleep(1)
        GPIO.output(acid_pump_relay_pin, GPIO.LOW)
        time.sleep(1)


if __name__ == '__main__':
    main()