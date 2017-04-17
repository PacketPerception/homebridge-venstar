# homebridge-venstar

Supports Venstar thermostat devices on HomeBridge Platform

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-venstar
3. Update your configuration file. See bellow for a sample.

# Configuration

## Options

TBD

## Example

Configuration sample:

 ```
    {
        "bridge": {
            ...
        },

        "description": "...",

        "accessories": [],

        "platforms": [
            {
                "platform": "Venstar",

                "auth": { "user": "username", "pass": "password" },

                "thermostats": [
                  {
                    "name": "Home",
                    "uri": "https://192.168.1.10",
                  },
                  {
                    "name": "Garage",
                    "uri": "http://192.168.1.11"
                    "auth": null,
                  }
                ]
            }
        ]
    }
```
