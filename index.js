let humps = require('humps');
let Promise = require('bluebird');

function requireOptions(options, names) {
  names.forEach(name => {
    if(!options[name]) {
      throw new Error(`Options should contain: ${name}`)
    }
  });
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
  
  pollForFinished(progressId) {
    return this.get(`progress/${progressId}`).then(res => {
      if(!res.data.finished) {
        return Promise.delay(100).then(() => this.pollForFinished(progressId));
      }
      return res.data;
    });
  }
    
  createMachine(options) {
    requireOptions(options, ['hostname', 'imageId', 'planId']);
    let {hostname, imageId, planId, subscriptionId} = options;
    
    return this.post('machines', {
      machine: {
        hostname: hostname,
        imageId: imageId,
        planId: planId,
        subscriptionId: subscriptionId
      }
    }).then(response => {
      return this.pollForFinished(response.data.machine.progressId);
    })
  }
};

['post', 'get', 'put', 'delete'].forEach(httpMethod => {
  VirtkickApi.prototype[httpMethod] = function(endpoint, data, progressCb = () => {}) {
    return this.axios[httpMethod](`${this.panelUrl}/api/${endpoint}`, data)
      .then(Promise.resolve).catch(Promise.reject)
      .then(data => {
        return data;
      });
  }
});


module.exports = VirtkickApi;
