'use strict';
const fs = require('fs');
const { threadId, isMainThread } = require('worker_threads');
const started = Date.now();

// Check if we're running as a worker thread or child process. It doesn't make 
// much sense to send along the process id for worker threads because it will 
// be the same as the one in the main thread.
let pid = isMainThread ? process.id : threadId;

module.exports = async function(timeout) {
  if (timeout) {
    await new Promise(cb => setTimeout(cb, timeout));
  }
  return [pid, Math.random(), timeout];
};

module.exports.run0 = function() {
  return module.exports(0);
};

module.exports.killable = function(id) {
  if (Math.random() < 0.5) {
    return process.exit(-1);
  }
  return [id, pid];
};

module.exports.uptime = function() {
  return Date.now() - started;
};
