/*
{
    "bridge": {
    	...
    },

    "description": "...",

    "accessories": []
    "platforms": [
        {
            "platform": "Venstar",

            // These comments are not JSON, remove them if copied
            // optional. All options can be overwritten within each thermostat config
            "auth": { "user": "username", "pass": "password" },

            "thermostats": [
              { 
                "name": "Home",
                "uri": "https://192.168.1.10",
                // auth requires https uri if enabled
              },
              {
                "name": "Garage",
                "uri": "http://192.168.1.11"
                "auth": null,
              }
            ]
        },
    ]
}

*/

var debug = require('debug')('venstar');
var error = debug('app:error');

var request = require("request");
var NodeCache = require("node-cache");
var Q = require("q");
var Semaphore = require("semaphore");
var _ = require("underscore");

var REQUEST_OPTIONS = {
  'strictSSL': false
}

var Service, Characteristic, HomebridgeAPI;
module.exports = function(homebridge){
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;

  homebridge.registerPlatform("homebridge-venstar", "Venstar", VenstarPlatform);
  homebridge.registerAccessory("homebridge-venstar", "VenstarThermostat", VenstarThermostat)
};


function VenstarPlatform(log, config, api) {
	this.log = log;
  this.config = config
  this.name = (config.name==undefined) ? "Venstar" : config.name;
  
  this.auth = config.auth || null;
  this.pin = config.pin || null;
}

VenstarPlatform.prototype.accessories = function(callback) {
  this.accessories = [];
  for (var i = 0; i < this.config.thermostats.length; i++) {
    debug("Venstar: Adding thermostat", i);
    var thermostatAccessory = new VenstarThermostat(this.log, this.config.thermostats[i], this);
    this.accessories.push(thermostatAccessory);
  }
  callback(this.accessories);
}

function VenstarThermostat(log, config, platform) {
  this.log = log;
  this.name = config['name'];
  this.uri = config['uri'].replace(/\/$/, "");;
  this.platform = platform;
  this.cache = new NodeCache({stdTTL: 30});
  this.api_info_lock = new Semaphore(1);

  this.debug("VenstarThermostat: ", this.name, this.uri, config);

  this.auth = config.auth || platform.config.auth;
  this.pin = config.pin || platform.config.pin;

  if (this.auth) {
    this.auth.sendImmediately = false;
  }

  this.APIGetInfo();

  var informationService = new Service.AccessoryInformation();
  this.informationService = informationService;

  this.informationService
    .setCharacteristic(Characteristic.Manufacturer, "Venstar")
    .setCharacteristic(Characteristic.Model, "T7900");

  var thermostatService = new Service.Thermostat(this.name);
  this.thermostatService = thermostatService;

  this.thermostatService
    .getCharacteristic(Characteristic.CurrentHeatingCoolingState)
    .on('get', this.getCurrentHeatingCoolingState.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .on('get', this.getTargetHeatingCoolingState.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.TargetHeatingCoolingState)
    .on('set', this.setTargetHeatingCoolingState.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.CurrentTemperature)
    .on('get', this.getCurrentTemp.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.TargetTemperature)
    .on('get', this.getTargetTemp.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.TargetTemperature)
    .on('set', this.setTargetTemp.bind(this));

  this.thermostatService
    .getCharacteristic(Characteristic.TemperatureDisplayUnits)
    .on('get', this.getTempDisplayUnits.bind(this));

   // .getCharacteristic(Characteristic.CurrentRelativeHumidity)
   // .getCharacteristic(Characteristic.TargetRelativeHumidity)
   // .getCharacteristic(Characteristic.CoolingThresholdTemperature)
   // .getCharacteristic(Characteristic.HeatingThresholdTemperature)

}

VenstarThermostat.prototype.convertftoc = function(temp) {
  return Number(((temp-32) * 5 / 9).toFixed(2));
}

VenstarThermostat.prototype.convertctof = function(temp) {
  return Number((temp * 9 / 5 + 32).toFixed(2));
}

VenstarThermostat.prototype.debug = function() {
  var args = Array.from(arguments);
  debug.apply(null, [this.name + ": " + args[0]].concat(args.slice(1)));
}

VenstarThermostat.prototype.APIrequest = function(opts, callback) {
  opts.uri = this.uri + opts.uri;
  opts = _.extend(opts, REQUEST_OPTIONS);

  this.debug('APIrequest', opts);

  return request(_.extend(opts, {auth: this.auth}), callback);
}

VenstarThermostat.prototype.APIGetInfo = function(callback) {
  var that = this;

  function getInfo(cache) {
    var deferred = Q.defer();

    that.api_info_lock.take(function(){
      cache.get("info", function(err, info){
        if (err) {
          that.log(err);
        } else {
          if (info == undefined) {
            that.debug(that.name, 'refreshing info from api: ' + that.uri + '/query/info');
            that.APIrequest({uri: '/query/info'}, function(error, response, body) {
              // that.debug('got response from api', error, response.statusCode, body);
              if (!error && response.statusCode == 200) {
                try {
                  data = JSON.parse(body);
                  cache.set('info', data);
                  deferred.resolve(data);
                } catch(e) {
                  deferred.reject(e);
                }
              } else {
                deferred.reject(error);
              }
            });
          } else {
            // that.debug('info from cache');
            deferred.resolve(info);
          }
        }
      });
    });
    return deferred.promise;
  }
  
  getInfo(that.cache).timeout(30000).then(function(info){
    that.debug('Updating vars and releasing sem');

    // update vars
    that.info = info;
    that.currentHeatingCoolingState = (info.state > 2) ? 0: info.state;
    that.targetHeatingCoolingState = info.mode;
    that.currentTemp = that.convertftoc(info.spacetemp);
    that.currentHeatTemp = info.heattemp;
    that.currentCoolTemp = info.cooltemp;
    that.setpointdelta = info.setpointdelta;

    switch(that.targetHeatingCoolingState) {
      case Characteristic.TargetHeatingCoolingState.HEAT:
        that.targettemp = that.convertftoc(that.currentHeatTemp);
        break;
      case Characteristic.TargetHeatingCoolingState.COOL:
        that.targettemp = that.convertftoc(that.currentCoolTemp);
        break;
      default:
        that.targettemp = that.convertftoc((info.heattemp + info.cooltemp) / 2);
    }

    that.api_info_lock.leave();

    callback(null, info);
  }, function(err) {
    sem.leave();
    callback(err, null);
  })
}

VenstarThermostat.prototype.APISendControl = function(opts, callback) {
  var that = this;

  data = {}

  if (opts.state!=undefined) {
    data.mode = opts.state;
  }

  if (opts.targettemp) {
    opts.targettemp = this.convertctof(opts.targettemp);
    switch(opts.state || this.targetHeatingCoolingState){
      case Characteristic.TargetHeatingCoolingState.HEAT:
        data.heattemp = opts.targettemp
        data.cooltemp = opts.targettemp + 1
        break;
      case Characteristic.TargetHeatingCoolingState.COOL:
        data.heattemp = opts.targettemp - 1
        data.cooltemp = opts.targettemp
        break;
      default:
        data.heattemp = opts.targettemp - (this.setpointdelta/2);
        data.cooltemp = opts.targettemp + (this.setpointdelta/2);
        break;
    }
  } else {
    data.heattemp = this.currentHeatTemp;
    data.cooltemp = this.currentCoolTemp;
  }

  if (this.pin) {
    data.pin = this.pin;
  }

  opts = {
    "uri": "/control",
    "method": "POST",
    "form": data
  }

  this.APIrequest(opts, function(error, response, body) {
    if (!error && response.statusCode == 200) {
      data = JSON.parse(body);

      if (!data.error) {
        // refresh info
        that.cache.del('info');
        that.APIGetInfo();
        callback(true, error, response);
      } else {
        callback(false, data.reason, response);
      }
    } else {
      that.log(error, body);
      callback(false, error, response);
    }
  });
}

VenstarThermostat.prototype.identify = function(callback) {
  callback();
}

VenstarThermostat.prototype.getCurrentHeatingCoolingState = function(callback) {
  var that = this;

  this.APIGetInfo(function(err, info) {
    if (!err) {
      that.debug('getCurrentHeatingCoolingState: ', that.currentHeatingCoolingState);
      that.thermostatService.setCharacteristic(Characteristic.CurrentHeatingCoolingState,
        that.currentHeatingCoolingState);
      callback(null, that.currentHeatingCoolingState);
    } else {
      that.debug("Error getting CurrentHeatingCoolingState: %s", err);
      callback(err);
    }
  });
};

VenstarThermostat.prototype.getTargetHeatingCoolingState = function(callback) {
  var that = this;

  this.APIGetInfo(function(err, info){
    if (!err) {
      that.debug('getTargetHeatingCoolingState:', that.targetHeatingCoolingState);
      that.thermostatService.setCharacteristic(Characteristic.TargetHeatingCoolingState,
        that.targetHeatingCoolingState);
      callback(null, that.targetHeatingCoolingState);
    } else {
      that.log("Error getting targetHeatingCoolingState: %s", err);
      callback(err);
    }
  });
};

VenstarThermostat.prototype.setTargetHeatingCoolingState = function(state, callback) {
  var that = this;

  if (this.targetHeatingCoolingState != state) {
    this.debug('setTargetHeatingCoolingState: ', state);

    this.APISendControl({state: state}, function(success, err, resp){
      if (success) {
        callback(null);
      } else {
        that.log("Error setting TargetHeatingCoolingState: %s", err);
        callback(err);
      }
    });
  } else {
    this.debug('setTargetHeatingCoolingState: ', this.currentHeatingCoolingState, "(skip)");
    callback(null);
  }
};

VenstarThermostat.prototype.getCurrentTemp = function(callback) {
  var that = this;

  this.APIGetInfo(function(err, info){
    if (!err) {
      that.debug("getCurrentTemp: ", info.spacetemp + "F (" + that.currentTemp + "C)");
      that.thermostatService.setCharacteristic(Characteristic.CurrentTemperature,
        that.currentTemp);
      callback(null, that.currentTemp);
    } else {
      that.log("Error getting current temp: %s", err);
      callback(err);
    }
  });
};

VenstarThermostat.prototype.getTargetTemp = function(callback) {
  var that = this;

  this.APIGetInfo(function(err, info){
    if (!err) {
      that.debug('getTargetTemp: ');
      that.debug('    Heat: ' + info.heattemp + "F (" + that.convertftoc(info.heattemp) + "C)");
      that.debug('    Cool: ' + info.cooltemp + "F (" + that.convertftoc(info.cooltemp) + "C)");
      that.debug('    Target: ' + that.convertctof(that.targettemp) + 'F (' + that.targettemp + "C)");

      that.thermostatService.setCharacteristic(Characteristic.TargetTemperature, that.targettemp);
      callback(null, that.targettemp);
    } else {
      that.log("Error getting current temp: %s", err);
      callback(err);
    }
  });
};

VenstarThermostat.prototype.setTargetTemp  = function(temp, callback) {
  var that = this;
  var tempf = this.convertctof(temp);

  this.debug('setTargetTemp: ', tempf + 'F (' + temp + 'C)', this.name);

  this.APISendControl({targettemp: temp}, function(success, err, resp){
    if (success) {
      callback(null);
    } else {
      that.log("Error setting TargetTemp: %s", err);
      callback(err);
    }
  });
};

VenstarThermostat.prototype.getTempDisplayUnits  = function(callback) {
  this.debug('getTempDisplayUnits');
  callback(null, Characteristic.TemperatureDisplayUnits.FAHRENHEIT);
};

VenstarThermostat.prototype.getServices = function() {
  return [this.informationService, this.thermostatService];
}
