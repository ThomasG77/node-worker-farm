'use strict';
const { parentPort } = require('worker_threads');
const handle = require('./handle.js');
parentPort.on('message', handle(parentPort.postMessage.bind(parentPort)));
