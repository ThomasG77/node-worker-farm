'use strict';
const { EventEmitter } = require('events');
const { expect } = require('chai');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const child_process = require('child_process');
const workerFarmModule = require('worker-farm');

function uniq(arr) {
  return [...new Set(arr)];
}

module.exports = function wrap(...args) {
  return function() {
    return run.call(this, ...args);
  };
};

function run(childPath, cp = false) {

  const childURL = pathToFileURL(childPath);
  const threaded = !cp;
  const workerFarm = cp ? workerFarmModule.cp : workerFarmModule;

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
    this.plan = function(n) {
      let calls = 0;
      let bus = new EventEmitter();
      function call(...args) {
        calls++;
        if (calls === n) {
          bus.emit('complete');
        }
        return expect(...args);
      }
      call.then = cb => {
        bus.on('complete', () => cb());
      };
      return call;
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

  it('on child', async function() {
    if (threaded) {
      let threadId = null;
      let child = this.setup({
        onChild(worker) {
          threadId = worker.threadId;
        },
      }, childPath);

      let [tid] = await child(0);
      expect(threadId).to.equal(tid);
    } else {
      let childPid = null;
      let child = this.setup({
        onChild(cp) {
          childPid = cp.pid;
        },
      }, childPath);
      let [pid] = await child(0);
      expect(childPid).to.equal(pid);
    }
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

  it('call timeout test', async function() {

    const expect = this.plan(6);
    let child = this.setup({
      maxCallTime: 250,
      maxConcurrentWorkers: 1,
    }, childPath);

    // Should come back ok.
    child(50).then(([pid, rnd]) => {
      expect(rnd).to.be.within(0, 1);
    });

    // Should come back ok.
    child(50).then(([pid, rnd]) => {
      expect(rnd).to.be.within(0, 1);
    });

    // Should die
    child(500).catch(err => {
      expect(err.type).to.equal('TimeoutError');
    });

    // Should die
    child(1000).catch(err => {
      expect(err.type).to.equal('TimeoutError');
    });

    // Should die event htough it is only a 100ms task, it'll get caught up in 
    // a dying worker.
    setTimeout(() => {
      child(100).catch(err => {
        expect(err.type).to.equal('TimeoutError');
      });
    }, 200);

    // Should be ok, new worker.
    setTimeout(() => {
      child(50).then(([pid, rnd]) => {
        expect(rnd).to.be.within(0, 1);
      });
    }, 400);

    return expect;

  });

  it('test error passing', async function() {

    const expect = this.plan(9);
    let child = this.setup(childPath, ['err']);

    child.err(['Error', 'this is an Error']).catch(err => {
      expect(err).to.be.an.instanceOf(Error);
      expect(err.type).to.equal('Error');
      expect(err.message).to.equal('this is an Error');
    });

    child.err(['TypeError', 'this is a TypeError']).catch(err => {
      expect(err).to.be.an.instanceOf(TypeError);
      expect(err.type).to.equal('TypeError');
      expect(err.message).to.equal('this is a TypeError');
    });

    child.err(['Error', 'this is an Error with custom props', {
      foo: 'bar',
      baz: 1,
    }]).catch(err => {
      expect(err).to.be.an.instanceOf(Error);
      expect(err.foo).to.equal('bar');
      expect(err.baz).to.equal(1);
    });

    return expect;

  });

  it('test maxConcurrentCalls', async function() {
    const expect = this.plan(7);
    let child = this.setup({ maxConcurrentCalls: 5 }, childPath);
    child(50).then(() => expect(true).to.be.ok);
    child(50).then(() => expect(true).to.be.ok);
    child(50).then(() => expect(true).to.be.ok);
    child(50).then(() => expect(true).to.be.ok);
    child(50).then(() => expect(true).to.be.ok);
    child(50).catch(err => {
      expect(err.type).to.equal('MaxConcurrentCallsError');
    });
    child(50).catch(err => {
      expect(err.type).to.equal('MaxConcurrentCallsError');
    });
    return expect;
  });

  it('test maxConcurrentCalls + queue', async function() {

    const expect = this.plan(9);
    let child = this.setup({
      maxConcurrentCalls: 4,
      maxConcurrentWorkers: 2,
      maxConcurrentCallsPerWorker: 1,
    }, childPath);

    child(20).then(() => expect(true).to.be.ok);
    child(20).then(() => expect(true).to.be.ok);
    child(300).then(() => expect(true).to.be.ok);
    child(300).then(() => expect(true).to.be.ok);
    child(20).catch(err => {
      expect(err.type).to.equal('MaxConcurrentCallsError');
    });
    child(20).catch(err => {
      expect(err.type).to.equal('MaxConcurrentCallsError');
    });

    // Cross fingers and hope the two short jobs have ended.
    await this.delay(250);
    child(20).then(() => expect(true).to.be.ok);
    child(20).then(() => expect(true).to.be.ok);
    child(20).catch(err => {
      expect(err.type).to.equal('MaxConcurrentCallsError');
    });

    return expect;

  });

  it('test timeout kill', async function() {

    const expect = this.plan(2);
    let child = this.setup({
      maxCallTime: 250,
      maxConcurrentWorkers: 1,
    }, childPath, ['block']);
    child.block().catch(err => {
      expect(err).to.be.ok;
      expect(err.type).to.equal('TimeoutError');
    });
    return expect;

  });

  it('test max retries after process terminate', async function() {

    let filepath1 = '.retries1';
    let child1 = this.setup({
      maxConcurrentWorkers: 1,
      maxRetries: 5,
    }, childPath, ['stubborn']);
    let result = await child1.stubborn(filepath1);
    expect(result).to.equal(12);

    await this.end(child1);
    fs.unlinkSync(filepath1);

    let filepath2 = '.retries2';
    let child2 = this.setup({
      maxConcurrentWorkers: 1,
      maxRetries: 3,
    }, childPath, ['stubborn']);

    try {
      await child2.stubborn(filepath2);
    } catch (err) {
      expect(err.type).to.equal('ProcessTerminatedError');
      expect(err.message).to.equal('cancel after 3 retries!');
      await this.end();
      fs.unlinkSync(filepath2);
      return;
    }

    throw new Error('Shouldn\'t get here!');

  });

  // Only run the following tests in a threaded environment. Transfer lists and 
  // SharedArrayBuffers don't work with child processes.
  if (threaded) {

    it('pass a transferList when running in threaded mode', async function() {

      let child = this.setup(childPath, ['transfer']);
      let one = new Float64Array([0, 1, 2]);
      let two = new Uint8Array([3, 4, 5]);

      let result = await child.transfer([one, two], [one.buffer, two.buffer]);
      expect(one.byteLength).to.equal(0);
      expect(two.byteLength).to.equal(0);
      expect(result[0]).to.equal(15);

    });

    it('modify a shared array buffer', async function() {

      let child = this.setup(childPath, ['shared']);
      let arr = new Float64Array(new SharedArrayBuffer(8));
      arr[0] = Math.PI;
      await child.shared(arr);
      expect(arr[0]).to.equal(Math.E);

    });

  } else {

    // Following tests only need to be run for child processes.
    it('custom arguments can be passed to "fork"', async function() {

      let cwd = fs.realpathSync(os.tmpdir());
      let workerOptions = {
        cwd,
        execArgv: ['--expose-gc'],
      };
      let child = this.setup({
        maxConcurrentWorkers: 1,
        maxRetries: 5,
        workerOptions,
      }, childPath, ['args']);

      let result = await child.args();
      expect(result.execArgv[0]).to.equal('--expose-gc');
      expect(result.cwd).to.equal(cwd);
    
    });

    it('ensure --inspect not propagated to children', function(done) {

      let script = __dirname + '/debug.js';
      let debugArg = '--inspect';

      let child = child_process.spawn(process.execPath, [debugArg, script]);
      let stdout = '';

      child.stdout.on('data', data => {
        stdout += String(data);
      });

      child.on('close', code => {
        expect(code).to.equal(0);
        expect(stdout.indexOf('FINISHED')).to.be.above(-1);
        expect(stdout.indexOf('--debug')).to.equal(-1);
        done();
      });

    });

  }

}
