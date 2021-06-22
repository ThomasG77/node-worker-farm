'use strict';
const workerFarm = require('worker-farm');
const workers = workerFarm(require.resolve('./child.js'));
const n = 100;
const size = 5*1024*1024;

(async function() {

  console.time('With transferList');
  for (let i = 0; i < n; i++) {
    let data = new Uint32Array(size);
    data[0] = size;
    await workers({ data, list: true }, [data.buffer]);
  }
  console.timeEnd('With transferList');

  console.time('Without transferList');
  for (let i = 0; i < n; i++) {
    let data = new Uint32Array(size);
    data[0] = size;
    await workers({ data, list: false });
  }
  console.timeEnd('Without transferList');

  workerFarm.end(workers);

})().catch(console.error);
