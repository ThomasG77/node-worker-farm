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

module.exports.err = function([type, message, data = {}]) {

  if (type === 'TypeError') {
    throw new TypeError(message);
  }

  let err = new Error(message);
  Object.keys(data).forEach(key => {
    err[key] = data[key];
  });
  throw err;

};

module.exports.block = function() {
  // eslint-disable-next-line no-constant-condition
  while (true);
};

// use provided file path to save retries count among terminated workers
module.exports.stubborn = function(path) {
  function isOutdated(path) {
    return ((new Date).getTime() - fs.statSync(path).mtime.getTime()) > 2000;
  }

  // file may not be properly deleted, check if modified no earler than two seconds ago
  if (!fs.existsSync(path) || isOutdated(path)) {
    fs.writeFileSync(path, '1');
    process.exit(-1);
  }

  let retry = parseInt(fs.readFileSync(path, 'utf8'));
  if (Number.isNaN(retry))
    throw new Error('file contents is not a number');

  if (retry > 4) {
    return 12;
  } else {
    fs.writeFileSync(path, String(retry + 1));
    process.exit(-1);
  }
};

module.exports.uptime = function() {
  return Date.now() - started;
};

module.exports.transfer = function([one, two], { transfer }) {
  let sum = 0;
  for (let buffer of [one, two]) {
    for (let value of buffer) sum += value;
  }
  let arr = new Uint32Array([sum]);
  transfer(arr.buffer);
  return arr;
};

module.exports.shared = function(buffer) {
  buffer[0] = Math.E;
};
