const test = require('node:test');
const assert = require('node:assert/strict');
const { formatNrcInput } = require('../nrc-formatter');

test('NRC entry inserts slashes in the six-two-one format', () => {
  assert.deepEqual(formatNrcInput('123456', 6), {
    value: '123456/',
    caretPosition: 7
  });
  assert.deepEqual(formatNrcInput('12345678', 8), {
    value: '123456/78/',
    caretPosition: 10
  });
  assert.deepEqual(formatNrcInput('123456789', 9), {
    value: '123456/78/9',
    caretPosition: 11
  });
});

test('NRC formatting handles pasted separators, preserves the cursor, and limits digits', () => {
  assert.deepEqual(formatNrcInput('123456/78/9', 10), {
    value: '123456/78/9',
    caretPosition: 10
  });
  assert.deepEqual(formatNrcInput('123456789', 7), {
    value: '123456/78/9',
    caretPosition: 8
  });
  assert.equal(formatNrcInput('123456789123456', 15).value, '123456/78/9');
});
