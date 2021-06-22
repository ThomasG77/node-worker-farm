'use strict';
const { pathToFileURL } = require('url');
const Farm = require('./farm.js');

// Keep record of farms so we can end() them if required
let farms = [];

function farm(options, path, methods) {
  if (typeof options === 'string') {
    methods = path;
    path = options;
    options = {};
  }

  let f = new Farm(options, path);
  let api = f.setup(methods);
  farms.push({ farm: f, api });
  return api;

}

function threaded(options, path, methods) {
  if (typeof options === 'string' || options instanceof URL) {
    methods = path;
    path = options;
    options = {};
  }

  // If we received a string, ensure it's a file url and not simply a path.
  if (typeof path === 'string') {
    if (!path.startsWith('file://')) {
      path = String(pathToFileURL(path));
    }
  } else {
    path = String(path);
  }
  options = { workerThreads: true, ...options };
  return farm(options, path, methods);
}

function end(api, callback) {
  for (let i = 0; i < farms.length; i++) {
    if (farms[i] && farms[i].api === api) {
      return farms[i].farm.end(callback);
    }
  }
  process.nextTick(callback.bind(null, new Error('Worker farm not found!')));
}

module.exports = threaded;
module.exports.end = threaded.end = end;
