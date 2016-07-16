#!/usr/bin/env node
const VirtkickApi = require('./');
const Promise = require('bluebird');
const ApiError = VirtkickApi.ApiError;


class CliError extends Error {
  constructor(message) {
    super(message);
    Error.captureStackTrace( this, this.constructor )
    this.message = message;
    this.name = 'CliError';
  }
}


let virtkick;

let commands = {};
let args = {};

function registerCommand(command, options) {
  commands[command] = options;
}

const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: true,
  completer(line,  cb) {
    return Promise.try(() => {
      let [command, ...args] = line.split(/\s+/)
      if(args.length) {
        let paramInfo = commands[command].params && commands[command].params[args.length - 1];
        if(paramInfo && paramInfo.completer) {
          let arg = args[args.length - 1];
          return Promise.resolve(paramInfo.completer(arg, command)).then(result => {
            let {hits, completions} = result;
            line = [command, ...args].join(' ');
            args.pop();
            hits = hits.map(hit => {
              return [command, ...args, hit].join(' ');
            })
            return [hits.length ? hits : completions, line];
          });
        }
      }
      const completions = Object.keys(commands);
      const hits = completions.filter((c) => { return c.indexOf(command) == 0 })
      // show all completions if none found
      return [hits.length ? hits : completions, command]
    }).nodeify(cb)
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
        throw new CliError(`Unknown image: ${imageId}`);
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
        throw new CliError(`Unknown plan: ${planId}`);
      }
      return planMap[planId];
    });
  });
}

let machineHostnameParam = {
  completer(hostname) {
    return virtkick.machines().map(machine => machine.hostname).then(completions => {
      const hits = completions.filter((c) => { return c.indexOf(hostname) == 0 })
      return {
        hits: hits,
        completions: completions
      };
    });
  },
  name: 'hostname'
};

function matchMachine(hostname) {
  if(hostname.match(/^\d+$/)) {
    machinePromise = virtkick.machine(hostname);
  } else {
    machinePromise = virtkick.machines().then(machines => {
      let machineMap = {};
      let matches =  machines.filter(machine => {
        machineMap[machine.hostname] = machine;
        return machine.hostname.match(new RegExp(hostname));
      });
      if(matches.length > 1 && !machineMap[hostname]) {
        console.log('Multiple matches: ', matches.map(machine => machine.hostname).join(', '));
        return null;
      }
      if(matches.length) {
        return machineMap[hostname] || matches[0];
      }
      throw new CliError(`Cannot find machine matching your query: ${hostname}`);
    });
  }
  return machinePromise;
}


registerCommand('show', {
  handler(num) {
    let printer = new TablePrinter(16, 50);
    let machinePromise = matchMachine(num);
    return machinePromise.then(machine => {
      if(machine == null) return;
      
      let fields = {
        id: true,
        hostname: true,
        status: true,
        ip: () => machine.ips[0].address,
        rootPassword: true,
        cpuUsage: () => machine.cpuUsage.toFixed(2),
        cpus: true,
        storage: () => `${machine.storage[0].capacity / 1024 / 1024} GB`,
        memory: () => `${machine.memory / 1024 / 1024} GB`
      }
      for(let field of Object.keys(fields)) {
        let value = fields[field] === true ? machine[field] : fields[field]();
        if(typeof value !== 'undefined')
          printer.print(...[field, value]);
      }
    });
  },
  params: [machineHostnameParam]
});

['start', 'pause', 'resume', 'stop', 'forceStop',
'restart', 'forceRestart', 'resetRootPassword'].forEach(command => {
  registerCommand(command, {
    handler(hostname) {
      let machinePromise = matchMachine(hostname);
      return machinePromise.then(machine => {
        if(machine == null) return;
        return machine[command]().then(() => {
          console.log('Action successful');
        });
      });
    },
    params: [machineHostnameParam]
  });
});


registerCommand('list', {
  handler() {
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
  }
});

registerCommand('help', {
  handler() {
    return console.log('List of commands: create list');
  }
});

registerCommand('create', {
  handler() {
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
  }
});

function setupPrompt() {
  rl.prompt('');
  rl.on('line', (line) => {
    Promise.try(() => {
      let [command, ...args] = line.trim().split(/\s+/);
      let commandInfo = commands[command];
      if(commandInfo) {
        if(commandInfo.params) {
          if(args.length < commandInfo.params.length) {
            throw new CliError(`Usage: ${command} ${commandInfo.params.map((param, i) => `<${param.name || `arg${i+1}`}>`).join(' ')}`);
          }
        }
        
        return commandInfo.handler(...args);
      }
      console.log(`Unknown command: ${line} `);
      return commands['help'].handler();
    })
    .catch(ApiError, err => console.error('ApiError:', err.message))
    .catch(CliError, err => console.error('Error:', err.message))
    .catch(err => console.error(err.stack))
    .finally(() => rl.prompt());
  }).on('close', () => {
    console.log("\nkthx, Keep on virtkickin'");
    process.exit(0);
  });
}
