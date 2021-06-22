'use strict';

const workerFarm = require('worker-farm');
const workers = workerFarm(require.resolve('./child.js'), ['args']);

workers.args().then(result => {
  console.log(result);
  workerFarm.end(workers);
  console.log('FINISHED');
  process.exit(0);
});
