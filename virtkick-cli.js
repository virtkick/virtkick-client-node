#!/usr/bin/env node
const VirtkickApi = require('./');
const Promise = require('bluebird');

let virtkick;

let commands = {};

function registerCommand(command, handler) {
  commands[command] = {
    handler: handler
  };
}

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  completer(line) {
    let command = line.split(/\s+/)[0];
    const completions = Object.keys(commands);
    const hits = completions.filter((c) => { return c.indexOf(command) == 0 })
    // show all completions if none found
    return [hits.length ? hits : completions, command]
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


class TablePrinter {
  constructor(...lengths) {
    this.lengths = lengths;
  }
  pad(str, len) {
    str = ' ' + str;
    while(str.length < len) str += ' ';
    return str;
  }
  print(...entries) {
    let str = entries.map((entry, i) => {
      return this.pad(entry, this.lengths[i]);
    }).join('|');
    console.log(str);
  }
};

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

registerCommand('show', (num) => {
  let printer = new TablePrinter(16, 50);
  let machinePromise;
  if(num.match(/^\d+$/)) {
    machinePromise = virtkick.machine(num);
  } else {
    machinePromise = virtkick.machines().then(machines => {
      let matches =  machines.filter(machine => machine.hostname.match(new RegExp(num)));
      if(matches.length > 1) {
        console.log('Multiple matches: ', matches.map(machine => machine.hostname).join(', '));
        return null;
      }
      if(matches.length) {
        return matches[0];
      }
      throw new ApiError(`Cannot find machine matching your query: ${num}`);
    });
  }
  return machinePromise.then(machine => {
    if(machine == null) return;
    
    let fields = {
      id: true,
      hostname: true,
      status: true,
      ip: () => machine.ips[0].address,
      rootPassword: true,
      cpuUsage: true,
      cpus: true
    }
    console.log(machine);
    for(let field of Object.keys(fields)) {
      printer.print(...[field, fields[field] === true ? machine[field] : fields[field]()]);
    }
  });
});

registerCommand('list', () => {
  return virtkick.machines().then(machines => {
    if(!machines.length) {
      return console.log(`You don't have any machines yet, why don't you create one?`);
    }
    let printer = new TablePrinter(6, 20, 16, 10);
    printer.print('id', 'hostname', 'ip', 'status');
    machines.map(machine => {
      printer.print(machine.id, machine.hostname, machine.ips[0].address, machine.status);
    });
  });
});

registerCommand('help', () => {
  return console.log('List of commands: create list');
})

registerCommand('create', () => {
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
})

function setupPrompt() {
  rl.prompt('');
  rl.on('line', (line) => {
    Promise.try(() => {
      let [command, ...args] = line.trim().split(/\s+/);
      if(commands[command]) {
        return commands[command].handler(...args);
      }
      console.log(`Unknown command: ${line} `);
      return commands['help'].handler();
    })
    .catch(err => console.error('Error:', err.message))
    .finally(() => rl.prompt());
  }).on('close', () => {
    console.log("\nkthx, Keep on virtkickin'");
    process.exit(0);
  });
}
