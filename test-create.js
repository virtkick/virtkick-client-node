let VirtkickApi = require('./');

let virtkick = new VirtkickApi({
  apiKey: '2:B0dPnQiiY3CGfkeeJxAEwVW3DuslrcjJKXc5Q-fpW8w',
  panelUrl: 'http://localhost:8080/'
});

virtkick.createMachine({
  hostname: 'foo5',
  imageId: 5,
  planId: 3,
  subscriptionId: 1
}).then(data => {
  console.log('Machine created', data);
});
