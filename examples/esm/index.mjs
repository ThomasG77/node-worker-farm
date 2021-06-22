import workerFarm from 'worker-farm';

const workers = workerFarm(new URL('./child.mjs', import.meta.url));
let ret = 0;

for (let i = 0; i < 10; i++) {
  workers(`#${i} FOO`).then(result => {
    console.log(result);
    if (++ret === 10) {
      workerFarm.end(workers);
    }
  });
}
