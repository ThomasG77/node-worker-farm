'use strict';
let $module;
function handle(data, send) {
  let idx = data.idx;
  let child = data.child;
  let method = data.method;
  let args = data.args;
  let transferList = [];
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
    send({ owner: 'farm', idx, child, args: _args.slice(0, 2) }, transferList);
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

  // Wrap the function call in a promise so that we no longer need to use 
  // callbacks.
  const opts = {
    transfer(...args) {
      transferList.push(...args);
    },
  };
  let [arg] = args;
  wrap(() => exec.call(null, arg, opts)).then(
    result => callback(null, result),
    err => callback(err),
  );

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

// Helper function for wrapping a function in a promise, while ensuring that 
// errors that get thrown *synchronously* are properly handled as rejections as 
// well!
async function wrap(fn) {
  return await fn();
}
