'use strict';
const childProcess = require('child_process');
const { Worker } = require('worker_threads');
const childModule = require.resolve('./child/process.js');
const threadModule = require.resolve('./child/thread.js');

function fork(forkModule, workerOptions, workerThreads) {

  // Check whether we need to run using worker_threads. This is now the default.
  if (workerThreads) {
    return thread(forkModule, workerOptions);
  } else {
    return cp(forkModule, workerOptions);
  }

}

function cp(forkModule, workerOptions) {

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
      child.send(call);
    },
    child,
  };
}

function thread(forkModule, workerOptions) {
  let child = new Worker(threadModule, workerOptions);
  child.on('error', function() {});
  child.postMessage({ owner: 'farm', module: forkModule });
  return {
    send(call, transferList = null) {
      child.postMessage(call, transferList);
    },
    child,
  };
}

module.exports = fork;
