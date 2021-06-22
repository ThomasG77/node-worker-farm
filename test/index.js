// # index.js
const run = require('./run.js');
const cjs = require.resolve('./child.js');
const esm = require.resolve('./child.mjs');

describe('A threaded worker farm (cjs)', run(cjs));
describe('A threaded worker farm (esm)', run(esm));

describe('A child process worker farm (cjs)', run(cjs, true));
describe('A child process worker farm (esm)', run(esm, true));
