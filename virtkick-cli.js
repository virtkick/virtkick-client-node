#!/usr/bin/env node
const VirtkickApi = require('./');
const Promise = require('bluebird');

let virtkick;

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  completer(line) {;
    const completions = 'list create help'.split(' ')
    const hits = completions.filter((c) => { return c.indexOf(line) == 0 })
    // show all completions if none found
    return [hits.length ? hits : completions, line]
  }
});


readline.emitKeypressEvents(process.stdin);
if(process.stdin.isTTY)
  process.stdin.setRawMode(true);

rl.setPrompt('> ')

function question(ask) {
  return new Promise((resolve, reject) => {
    rl.question(ask, resolve);
  });
}

function getApiKey() {
  return Promise.try(() => process.env.API_KEY || question('Enter API Key (or set env var API_KEY): '));
}

function getPanelUrl() {
  return Promise.try(() => process.env.PANEL_URL || question('Enter panel URL (or set env var PANEL_URL): '));
}

function initializeApi() {
  return getApiKey().then(apiKey => {
    return getPanelUrl().then(panelUrl => {
      virtkick = new VirtkickApi({
        apiKey: apiKey,
        panelUrl: panelUrl
      });
    })
  });
}

initializeApi().then(() => {
  virtkick.user().then(user => {
    console.log(`Howdy ${user.email}!`)
    
    setupPrompt();
  });
});


function pad(str, len) {
  str = ' ' + str;
  while(str.length < len) str += ' ';
  return str;
}

function askForImage() {
  return virtkick.images().then(images => {
    let imageMap = {};
    let imageList = images.map(image => {
      imageMap[image.id] = image;
      return `${image.id}) ${image.distribution.name} ${image.version} (${image.imageType})`;
    }).join('\n');
    
    return question(`${imageList}\nChoose image: `).then(imageId => {
      if(!imageMap[imageId]) {
        throw new Error(`Unknown image: ${imageId}`);
      }
      return imageMap[imageId];
    });
  });
}

function askForPlan() {
  return virtkick.plans().then(plans => {
    let planMap = {};
    let planList = plans.map(plan => {
      planMap[plan.id] = plan;
      let {cpu, memory, storage, storageType} = plan.params;
      storage /= 1024 * 1024 * 1024;
      let planName = plan.name || `CPU ${cpu} / RAM ${memory}GB / ${storageType} ${storage}GB`
      return `${plan.id}) ${planName} - $${plan.price.value/100}`;
    }).join('\n');
    
    return question(`${planList}\nChoose plan: `).then(planId => {
      if(!planMap[planId]) {
        throw new Error(`Unknown plan: ${planId}`);
      }
      return planMap[planId];
    });
  });
}

function setupPrompt() {
  rl.prompt('');
  rl.on('line', (line) => {
    Promise.try(() => {
      switch(line.trim()) {
        case 'list':
          return virtkick.machines().then(machines => {
            if(!machines.length) {
              return console.log(`You don't have any machines yet, why don't you create one?`);
            }
            console.log(`${pad('id', 6)}|${pad('hostname', 20)}|${pad('ip', 16)}|${pad('status', 10)}`)
            machines.map(machine => {
              console.log(`${pad(machine.id, 6)}|${pad(machine.hostname, 20)}|${pad(machine.ips[0].address, 16)}|${pad(machine.status, 10)}`)
            });
          });
        case 'help':
          return console.log('List of commands: create list');
        case 'create':
          return askForImage().then(image => {
            return askForPlan().then(plan => {
              return question('Enter hostname: ').then(hostname => {
                console.log('Creating your machine...');
                return virtkick.createMachine({
                  hostname: hostname,
                  imageId: image.id,
                  planId: plan.id
                }).then(() => {
                  console.log('Machine created');
                });
              });
            })
          })
          break;
        default:
          console.log(`Unknown command: ${line} `);
          break;
      }
    })
    .catch(err => console.error('Error:', err.message))
    .finally(() => rl.prompt());
  }).on('close', () => {
    console.log("kthx, Keep on virtkickin'");
    process.exit(0);
  });
}
