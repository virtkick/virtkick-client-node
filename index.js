let humps = require('humps');
let Promise = require('bluebird');
let merge = require('merge');

Promise.longStackTraces(true);

function requireOptions(options, names) {
  names.forEach(name => {
    if(!options[name]) {
      throw new Error(`Options should contain: ${name}`)
    }
  });
}
let apiSymbol = Symbol('api');

class VirtkickMachine {
  constructor(api, data) {
    this[apiSymbol] = api;
  }
  get api() {
    return this[apiSymbol];
  }
  static fromMachineId(api, machineId) {
    let machine = new VirtkickMachine(api);
    machine.id = machineId;
    return machine.refresh();
  }
  refresh() {
    return this.api.get(`machines/${this.id}`).get('machine')
      .then(data => {
        merge(this, data);
      }).then(() => this);
  }
  destroy() {
    return this.api.delete(`machines/${this.id}`).bind(this.api)
      .then(this.api.pollForFinished);
  }
}

class VirtkickApi {
  constructor(options) {
    requireOptions(options, ['apiKey', 'panelUrl']);
    let {apiKey, panelUrl} = options;
    
    this.panelUrl = panelUrl.replace(/\/$/, '');
    this.token = apiKey;
    this.axios = require('axios').create({
      auth: {
        username: apiKey.split(':')[0],
        password: apiKey.split(':')[1]
      },
      headers: {
        'Content-Type': 'application/json'
      },
      transformRequest: [humps.decamelizeKeys, JSON.stringify],
      transformResponse: [JSON.parse, humps.camelizeKeys],
    });
  }
  
  pollForFinished(data, progressCb = () => {}) {
    let progressId = data.progressId || data;
    return this.get(`progress/${progressId}`).then(data => {
      progressCb(data.data);
      if(!data.finished) {
        return Promise.delay(100)
          .then(() => this.pollForFinished(progressId, progressCb));
      }
      return data;
    });
  }
    
  createMachine(options, progressCb) {
    requireOptions(options, ['hostname', 'imageId', 'planId']);
    let {hostname, imageId, planId, subscriptionId} = options;
    
    return this.post('machines', {
      machine: {
        hostname: hostname,
        imageId: imageId,
        planId: planId,
        subscriptionId: subscriptionId
      }
    }).then(data => this.pollForFinished(data.machine.progressId, progressCb))
      .get('data')
      .then(data => {
        return VirtkickMachine.fromMachineId(this, data.machineId);
      });
  }
}

class ApiError extends Error {
  constructor(message, originalError) {
    super(message);
    Error.captureStackTrace( this, this.constructor )
    this.originalError = originalError;
    this.message = message;
    this.name = 'ApiError';
  }
}

['post', 'get', 'put', 'delete'].forEach(httpMethod => {
  VirtkickApi.prototype[httpMethod] = function(endpoint, data, progressCb = () => {}) {
    return Promise.try(() => {
      return this.axios[httpMethod](`${this.panelUrl}/api/${endpoint}`, data);
    }).get('data').catch(err => err.response, err => {
      let data = JSON.parse(err.response.data);
      if(data.error) {
        throw new ApiError(`${err.response.status} ${err.response.statusText} : ${err.config.url} : ${data.error}`, err);
      }
      if(data.errors) {
        throw new ApiError(`${err.response.status} ${err.response.statusText} : ${err.config.url} : ${data.errors.join(', ')}`, err);
      }
      throw err;
    });
  }
});


module.exports = VirtkickApi;
