'use strict';

module.exports = function({ data, list }, { transfer }) {
  let [size] = data;
  let arr = new Float64Array(size);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = Math.random();
  }
  if (list) {
    transfer(arr.buffer);
  }
  return arr;
};
