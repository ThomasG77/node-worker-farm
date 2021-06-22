'use strict';
const workerFarm = require('worker-farm');
const workers = workerFarm(require.resolve('./child.js'));
let ret = 0;

for (let i = 0; i < 10; i++) {
  workers(`#${i} FOO`).then(outp => {
    console.log(outp);
    if (++ret === 10) {
      workerFarm.end(workers);
    }
  });
}
