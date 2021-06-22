// # index.js
const run = require('./run.js');
const cjs = require.resolve('./child.js');
const esm = require.resolve('./child.mjs');

describe('A worker farm (cjs)', run({ childPath: cjs }));
describe('A worker farm (esm)', run({ childPath: esm }));
