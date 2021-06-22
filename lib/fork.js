'use strict';

const childProcess = require('child_process');
const childModule = require.resolve('./child/index.js');

let checked;
let available;
function fork(forkModule, workerOptions, workerThreads) {

  // Check whether we need to run using worker_threads.
  if (workerThreads) {

    if (!checked) {
      try {
        require('worker_threads');
        available = true;
      } catch (e) {
        available = false;
        console.warn('[WARNING] Worker threads are not available! Make sure you run node 12.x or higher, or 10.5 with the --experimental-worker flag!');
      }
      checked = true;
    }

    if (available) {
      return thread(forkModule, workerOptions);
    }
  }

  // suppress --debug / --inspect flags while preserving others (like --harmony)
  let filteredArgs = process.execArgv.filter(function(v) {
      return !(/^--(debug|inspect)/).test(v);
    }),
    options = { execArgv: filteredArgs,
      env: process.env,
      cwd: process.cwd(), ...workerOptions },
    child = childProcess.fork(childModule, process.argv, options);

  child.on('error', function() {
    // this *should* be picked up by onExit and the operation requeued
  });

  child.send({ owner: 'farm', module: forkModule });

  // return a send() function for this child
  return {
    send(call) {
      delete call.transferList;
      child.send(call);
    },
    child,
  };
}

function thread(forkModule, workerOptions) {
  const { Worker } = require('worker_threads');
  let child = new Worker(require.resolve('./child/thread'), workerOptions);
  child.on('error', function() {});
  child.postMessage({ owner: 'farm', module: forkModule });
  return {
    send(call) {
      let transferList = call.transferList;
      delete call.transferList;
      child.postMessage(call, transferList);
    },
    child,
  };
}

module.exports = fork;
