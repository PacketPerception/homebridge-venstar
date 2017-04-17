# homebridge-venstar

Supports Venstar thermostat devices on HomeBridge Platform

# Installation

1. Install homebridge using: npm install -g homebridge
2. Install this plugin using: npm install -g homebridge-venstar
3. Update your configuration file. See bellow for a sample.

# Configuration

## Options

The only required option is `thermostats`. All other options can be supplied in the platform configuration to apply to all thermostats, or on an individual basis. Configurations within a thermostat override the platform defaults. 

- `thermostats` - An array of thermostat configurations
- `auth` - An `auth` object of the format `{ user: 'username', pass: 'password' }`. Note, enabling `auth` requires you to use an https connection to the thermostat
- `pin` - Required if a pin has been configured on the the thermostat

### Thermostat Configuration

Any of the options can be specified to override the platform defaults on an individual basis. The `name` and `uri` configurations are both required.

- `name` - The display name of the thermostat in HomeKit
- `uri` - The uri of the thermostat (e.g. http://192.168.1.10). Note, if `auth` is specified, an https connection must be specified

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
