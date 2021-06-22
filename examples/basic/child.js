'use strict';
const { threadId } = require('worker_threads');

module.exports = function(inp) {
  return `${inp} BAR (${threadId})`;
};
