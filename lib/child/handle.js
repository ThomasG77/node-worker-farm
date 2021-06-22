'use strict';
let $module;
function handle(data, send) {
  let idx = data.idx;
  let child = data.child;
  let method = data.method;
  let args = data.args;
  let callback = function(..._args) {
    if (_args[0] instanceof Error) {
      let e = _args[0];
      _args[0] = {
        $error: '$error',
        type: e.constructor.name,
        message: e.message,
        stack: e.stack,
      };
      Object.keys(e).forEach(function(key) {
        _args[0][key] = e[key];
      });
    }
    send({ owner: 'farm', idx, child, args: _args.slice(0, 2) }, _args[2]);
  };
  let exec;

  if (!method && typeof $module === 'function') {
    exec = $module;
  } else if (typeof $module[method] === 'function') {
    exec = $module[method];
  }

  if (!exec) {
    return console.error('NO SUCH METHOD:', method);
  }

  exec.call(null, ...args, callback);
}

module.exports = function(send) {
  return function(data) {
    if (data.owner !== 'farm') {
      return;
    }
    if (!$module) return $module = require(data.module);
    if (data.event === 'die') return process.exit(0);
    handle(data, send);
  };
};
