'use strict';
const { pathToFileURL } = require('url');
const Farm = require('./farm.js');

// Keep record of farms so we can end() them if required
let farms = [];

function farm(...args) {
  let [options, path, methods] = normalize(...args);
  let f = new Farm(options, path);
  let api = f.setup(methods);
  farms.push({ farm: f, api });
  return api;
}

function cp(...args) {
  let [options, path, methods] = normalize(...args);
  return farm({
    workerThreads: false,
    ...options,
  }, path, methods);
}

function normalize(options, path, methods) {
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
  return [options, path, methods];
}

function end(api) {
  for (let i = 0; i < farms.length; i++) {
    if (farms[i] && farms[i].api === api) {
      return new Promise((resolve, reject) => {
        return farms[i].farm.end((err) => {
          if (err) return reject(err);
          return resolve();
        });
      });
    }
  }
  return Promise.reject(new Error('Worker farm not found!'));
}

farm.cp = cp;
cp.end = end;
module.exports = farm;
module.exports.end = farm.end = end;
