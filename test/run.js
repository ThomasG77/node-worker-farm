'use strict';
const { expect } = require('chai');
const { pathToFileURL } = require('url');
const workerFarm = require('worker-farm');
const childPath = require.resolve('./child.js');
const childURL = pathToFileURL(childPath);

function uniq(arr) {
  return [...new Set(arr)];
}

describe('The worker farm', function() {

  this.slow(10000);
  this.timeout(0);

  before(function() {
    this.setup = function(...args) {
      return this.child = workerFarm(...args);
    };
    this.pid = function(promise) {
      return promise.then(([pid]) => pid);
    };
    this.tasks = function(n, fn) {
      let tasks = [];
      while (n--) {
        tasks.push(fn(n));
      }
      return Promise.all(tasks);
    };
    this.delay = function(delay) {
      return new Promise(cb => setTimeout(cb, delay));
    };
    this.time = async function(fn) {
      let start = Date.now();
      await fn();
      return Date.now() - start;
    };
    this.end = function(child = this.child) {
      if (child) {
        workerFarm.end(child);
        this.child = null;
      }
    };
  });

  afterEach(async function() {
    this.end();
  });

  it('simple, exports=function test', async function() {

    let child = this.setup(childPath);
    let [, rnd] = await child(0);
    expect(rnd).to.be.within(0, 1);

  });

  it('simple, exports=function test with file url', async function() {
    let child = this.setup(childURL);
    let [, rnd] = await child(0);
    expect(rnd).to.be.within(0, 1);
  });

  it('simple, exports.fn test', async function() {
    let child = this.setup(childPath, ['run0']);
    let [, rnd] = await child.run0();
    expect(rnd).to.be.within(0, 1);
  });

  // Use the returned pids to check that we're using a single child worker (or 
  // child process) when maxConcurrentWorkers = 1.
  it('single worker', async function() {
    let child = this.setup({ maxConcurrentWorkers: 1 }, childPath);
    let pids = await this.tasks(10, () => this.pid(child(0)));
    expect(uniq(pids)).to.have.length(1);
  });

  // Use the returned pids to check that we're using two child processes
  // when maxConcurrentWorkers = 2
  it('two workers', async function() {
    let child = this.setup({ maxConcurrentWorkers: 2 }, childURL);
    let pids = await this.tasks(10, () => this.pid(child(0)));
    expect(uniq(pids)).to.have.length(2);
  });

  // Use the returned pids to check that we're using a child process per
  // call when maxConcurrentWorkers = 10
  it('many workers', async function() {
    let child = this.setup({ maxConcurrentWorkers: 10 }, childPath);
    let pids = await this.tasks(10, () => this.pid(child(0)));
    expect(uniq(pids)).to.have.length(10);
  });

  it('auto start workers', async function() {
    let child = this.setup({
      maxConcurrentWorkers: 3,
      autoStart: true,
    }, childPath, ['uptime']);
    let count = 5;
    let delay = 250;

    await this.delay(delay);
    let uptime = await this.tasks(count, () => child.uptime());
    for (let t of uptime) {
      expect(t).to.be.above(10);
    }
  });

  // Use the returned pids to check that we're using a child process per
  // call when we set maxCallsPerWorker = 1 even when we have 
  // maxConcurrentWorkers = 1
  it('single call per worker', async function() {
    const count = 25;
    let child = this.setup({
      maxConcurrentWorkers: 1,
      maxConcurrentCallsPerWorker: Infinity,
      maxCallsPerWorker: 1,
      autoStart: true,
    }, childPath);
    let pids = await this.tasks(count, () => this.pid(child(0)));
    expect(uniq(pids)).to.have.length(count);
  });

  // use the returned pids to check that we're using a child process per
  // two-calls when we set maxCallsPerWorker = 2 even when we have 
  // maxConcurrentWorkers = 1
  it('two calls per worker', async function() {
    const count = 20;
    let child = this.setup({
      maxConcurrentWorkers: 1,
      maxConcurrentCallsPerWorker: Infinity,
      maxCallsPerWorker: 2,
      autoStart: true,
    }, childPath);
    let pids = await this.tasks(count, () => this.pid(child(0)));
    expect(uniq(pids)).to.have.length(count / 2);
  });

  // Use timing to confirm that one worker will process calls sequentially
  it('many concurrent calls', async function() {
    const defer = 200;
    const count = 200;
    let child = this.setup({
      maxConcurrentWorkers: 1,
      maxConcurrentCallsPerWorker: Infinity,
      maxCallsPerWorker: Infinity,
      autoStart: true,
    }, childPath);
    await this.delay(250);

    let time = await this.time(async () => {
      await this.tasks(count, () => child(defer));
    });
    expect(time).to.be.within(defer, 2.5*defer);

  });

  // Use timing to confirm that one child processes calls sequentially with
  // maxConcurrentCallsPerWorker = 1
  it('single concurrent call', async function() {
    const defer = 10;
    const count = 100;
    let child = this.setup({
      maxConcurrentWorkers: 1,
      maxConcurrentCallsPerWorker: 1,
      maxCallsPerWorker: Infinity,
      autoStart: true,
    }, childPath);
    this.slow(5*defer*count);

    await this.delay(250);
    let time = await this.time(async () => {
      await this.tasks(count, () => child(defer));
    });

    // Upper-limit tied closely to `count`, 2 is generous but accounts for 
    // all the timers coming back at the same time and the IPC overhead. We 
    // can't use 1.3 anymore because apparently there's something in the worker 
    // that causes the timeouts to fire later, could be related to esm, don't 
    // know.
    expect(time).to.be.within(defer*count, 2*defer*count);

  });

  // Use timing to confirm that one child processes *only* 5 calls concurrently  
  it('multiple concurrent calls', async function() {
    const defer = 100;
    const count = 100;
    const callsPerWorker = 5;
    let child = this.setup({
      maxConcurrentWorkers: 1,
      maxConcurrentCallsPerWorker: callsPerWorker,
      maxCallsPerWorker: Infinity,
      autoStart: true,
    }, childPath);

    await this.delay(250);
    let time = await this.time(async () => {
      await this.tasks(count, () => child(defer));
    });
    expect(time).to.be.within(1.5*defer, defer*(count / callsPerWorker + 2));

  });

  it('durability', async function() {
    const count = 20;
    let child = this.setup({
      maxConcurrentWorkers: 2,
    }, childPath, ['killable']);

    let ids = [];
    let pids = [];
    await this.tasks(count, async (i) => {
      let [id, pid] = await child.killable(i);
      ids.push(id);
      pids.push(pid);
    });
    expect(uniq(pids)).to.have.length.above(2);
    expect(uniq(ids)).to.have.length(count);

  });

  it('simple, end callback', async function() {
    let child = this.setup(childPath);
    let [, rnd] = await child(0);
    expect(rnd).to.be.within(0, 1);
    await this.end(child);
  });

});
