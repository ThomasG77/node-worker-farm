'use strict';
const errno = require('errno');
const os = require('os');
const fork = require('./fork.js');

const DEFAULT_OPTIONS = {
  workerOptions: {},
  maxCallsPerWorker: Infinity,
  maxConcurrentWorkers: (os.cpus() || { length: 1 }).length,
  maxConcurrentCallsPerWorker: 10,
  maxConcurrentCalls: Infinity,

  // exceed this and the whole worker is terminated
  maxCallTime: Infinity,
  maxRetries: Infinity,
  forcedKillTime: 100,
  autoStart: false,
  workerThreads: true,
  onChild() {},
};

const TimeoutError = errno.create('TimeoutError');
const ProcessTerminatedError = errno.create('ProcessTerminatedError');
const MaxConcurrentCallsError = errno.create('MaxConcurrentCallsError');

// # Farm
class Farm {

  // ## constructor(options, path)
  constructor(options, path) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
    this.path = path;
    this.activeCalls = 0;
  }

  // ## mkhandle(method)
  // Make a handle to pass back in the form of an external API
  mkhandle(method) {
    return (arg, transferList = null) => {
      return new Promise((resolve, reject) => {

        // Make sure that we don't have too many concurrent calls.
        if (
          this.activeCalls + this.callQueue.length >=
          this.options.maxConcurrentCalls
        ) {
          let err = new MaxConcurrentCallsError(
            `Too many concurrent calls (active: ${this.activeCalls}, queued: ${this.callQueue.length})`,
          );
          return reject(err);
        }

        // Even though our api now uses promises, we'll still use callbacks 
        // under the hood, so we'll construct a callback that resolves or 
        // rejects the promise.
        this.addCall({
          method,
          callback: (err, value) => {
            if (err) return reject(err);
            return resolve(value);
          },
          args: [arg],
          retries: 0,
          transferList,
        });

      });
    };
  }

  // ## setup(methods)
  // A constructor of sorts
  setup(methods) {
    let iface;
    // single-function export
    if (!methods) {
      iface = this.mkhandle();
    } else {
      // multiple functions on the export
      iface = {};
      methods.forEach((m) =>{
        iface[m] = this.mkhandle(m);
      });
    }

    this.searchStart = -1;
    this.childId = -1;
    this.children = {};
    this.activeChildren = 0;
    this.callQueue = [];

    if (this.options.autoStart) {
      while (this.activeChildren < this.options.maxConcurrentWorkers) {
        this.startChild();
      }
    }

    return iface;
  }

  // ## onExit(childId)
  // When a child exits, check if there are any outstanding jobs and requeue 
  // them.
  onExit(childId) {

    // Delay this to give any sends a chance to finish
    setTimeout(() => {
      let doQueue = false;
      if (this.children[childId] && this.children[childId].activeCalls) {
        this.children[childId].calls.forEach((call, i) => {
          if (!call) return;
          else if (call.retries >= this.options.maxRetries) {
            this.receive({
              idx: i,
              child: childId,
              args: [new ProcessTerminatedError('cancel after ' + call.retries + ' retries!')],
            });
          } else {
            call.retries++;
            this.callQueue.unshift(call);
            doQueue = true;
          }
        });
      }
      this.stopChild(childId);
      doQueue && this.processQueue();
    }, 10);
  }

  // ## startChild()
  // Start a new worker
  startChild() {
    this.childId++;

    let forked = fork(
      this.path,
      this.options.workerOptions,
      this.options.workerThreads,
    );
    let id = this.childId;
    let c = {
      send: forked.send,
      child: forked.child,
      calls: [],
      activeCalls: 0,
      exitCode: null,
    };

    this.options.onChild(forked.child);

    forked.child.on('message', (data) => {
      if (data.owner !== 'farm') {
        return;
      }
      this.receive(data);
    });
    forked.child.once('exit', (code) => {
      c.exitCode = code;
      this.onExit(id);
    });

    this.activeChildren++;
    this.children[id] = c;
  }

  // ## stopChild(childId)
  // Stop a worker, identified by id
  stopChild(childId) {
    let child = this.children[childId];
    if (child) {
      child.send({ owner: 'farm', event: 'die' });
      setTimeout(() => {
        if (child.exitCode === null) {

          // Difference between worker_threads and child_process.
          if (child.child.kill)
            child.child.kill('SIGKILL');
          else
            child.child.terminate();

        }
      }, this.options.forcedKillTime).unref();
      delete this.children[childId];
      this.activeChildren--;
    }
  }

  // ## receive(data)
  // Called from a child process, the data contains information needed to
  // look up the child and the original call so we can invoke the callback
  receive(data) {
    let idx = data.idx;
    let childId = data.child;
    let args = data.args;
    let child = this.children[childId];
    let call;

    if (!child) {
      return console.error(
        'Worker Farm: Received message for unknown child. ' +
        'This is likely as a result of premature child death, ' +
        'the operation will have been re-queued.',
      );
    }

    call = child.calls[idx];
    if (!call) {
      return console.error(
        'Worker Farm: Received message for unknown index for existing child. ' +
        'This should not happen!',
      );
    }

    if (this.options.maxCallTime !== Infinity) {
      clearTimeout(call.timer);
    }

    if (args[0] && args[0].$error === '$error') {
      let e = args[0];
      switch (e.type) {
      case 'TypeError': args[0] = new TypeError(e.message); break;
      case 'RangeError': args[0] = new RangeError(e.message); break;
      case 'EvalError': args[0] = new EvalError(e.message); break;
      case 'ReferenceError': args[0] = new ReferenceError(e.message); break;
      case 'SyntaxError': args[0] = new SyntaxError(e.message); break;
      case 'URIError': args[0] = new URIError(e.message); break;
      default: args[0] = new Error(e.message);
      }
      args[0].type = e.type;
      args[0].stack = e.stack;

      // Copy any custom properties to pass it on.
      Object.keys(e).forEach((key) => {
        args[0][key] = e[key];
      });
    }

    process.nextTick(() => {
      call.callback.apply(null, args);
    });
    delete child.calls[idx];
    child.activeCalls--;
    this.activeCalls--;

    if (
      child.calls.length >= this.options.maxCallsPerWorker &&
      Object.keys(child.calls).length === 0
    ) {
      // This child has finished its run, kill it
      this.stopChild(childId);
    }

    // Allow any outstanding calls to be processed
    this.processQueue();
  }

  // ## childTimeout(childId)
  childTimeout(childId) {
    let child = this.children[childId];
    let i;

    if (!child) return;
    for (i in child.calls) {
      this.receive({
        idx: i,
        child: childId,
        args: [new TimeoutError('worker call timed out!')],
      });
    }
    this.stopChild(childId);
  }

  // # send(childId, call)
  // Send a call to a worker, identified by id
  send(childId, call) {
    let child = this.children[childId];
    let idx = child.calls.length;

    child.calls.push(call);
    child.activeCalls++;
    this.activeCalls++;

    child.send({
      owner: 'farm',
      idx,
      child: childId,
      method: call.method,
      args: call.args,
    }, call.transferList);

    if (this.options.maxCallTime !== Infinity) {
      call.timer = setTimeout(
        this.childTimeout.bind(this, childId),
        this.options.maxCallTime,
      );
    }
  }

  // ## childKeys()
  // a list of active worker ids, in order, but the starting offset is
  // shifted each time this method is called, so we work our way through
  // all workers when handing out jobs
  childKeys() {
    let cka = Object.keys(this.children);
    let cks;

    if (this.searchStart >= cka.length - 1) {
      this.searchStart = 0;
    } else {
      this.searchStart++;
    }

    cks = cka.splice(0, this.searchStart);
    return cka.concat(cks);
  }

  // ## processQueue()
  // Calls are added to a queue, this processes the queue and is called
  // whenever there might be a chance to send more calls to the workers.
  // The various options all impact on when we're able to send calls,
  // they may need to be kept in a queue until a worker is ready.
  processQueue() {
    let cka; let i = 0; let childId;

    if (!this.callQueue.length) {
      return this.ending && this.end();
    }

    if (this.activeChildren < this.options.maxConcurrentWorkers) {
      this.startChild();
    }

    for (cka = this.childKeys(); i < cka.length; i++) {
      childId = +cka[i];
      if (
        this.children[childId].activeCalls < this.options.maxConcurrentCallsPerWorker &&
        this.children[childId].calls.length < this.options.maxCallsPerWorker
      ) {

        this.send(childId, this.callQueue.shift());
        if (!this.callQueue.length) {
          return this.ending && this.end();
        }
      } /* else {
        console.log(
          , this.children[childId].activeCalls < this.options.maxConcurrentCallsPerWorker
          , this.children[childId].calls.length < this.options.maxCallsPerWorker
          , this.children[childId].calls.length , this.options.maxCallsPerWorker)
      }*/
    }

    if (this.ending) {
      this.end();
    }

  }

  // ## addCall(call)
  // add a new call to the call queue, then trigger a process of the queue
  addCall(call) {
    if (this.ending) {
      // don't add anything new to the queue
      return this.end();
    }
    this.callQueue.push(call);
    this.processQueue();
  }

  // ## end(callback)
  // kills child workers when they're all done
  end(callback) {
    let complete = true;
    if (this.ending === false) return;
    if (callback) {
      this.ending = callback;
    } else if (!this.ending) {
      this.ending = true;
    }

    Object.keys(this.children).forEach((child) => {
      if (!this.children[child]) return;
      if (!this.children[child].activeCalls) {
        this.stopChild(child);
      } else {
        complete = false;
      }
    });

    if (complete && typeof this.ending === 'function') {
      process.nextTick(() => {
        this.ending();
        this.ending = false;
      });
    }
  }

}

module.exports = Farm;
module.exports.TimeoutError = TimeoutError;
