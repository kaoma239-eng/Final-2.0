const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateParams } = require('../premium-calculator');

const quoteFile = path.join(__dirname, '..', 'quote-calculator.html');
const quoteHtml = fs.readFileSync(quoteFile, 'utf8');

test('customers can select whole-month cover periods up to 12 months', () => {
  assert.match(quoteHtml, /id="durationInput"[^\n]*min="1"/i);
  assert.match(quoteHtml, /id="durationInput"[^\n]*max="12"/i);
  assert.match(quoteHtml, /id="durationInput"[^\n]*step="1"/i);
  assert.doesNotMatch(quoteHtml, /id="durationInput"[^\n]*readonly/i);

  const baseParams = {
    insurer: 'sanlam',
    age: 35,
    gender: 'male',
    coverage: 100000
  };

  for (const product of ['life', 'salary', 'p2p']) {
    assert.equal(validateParams({ ...baseParams, product, duration: 1 }).isValid, true);
    assert.equal(validateParams({ ...baseParams, product, duration: 12 }).isValid, true);
    assert.equal(validateParams({ ...baseParams, product, duration: 13 }).isValid, false);
    assert.equal(validateParams({ ...baseParams, product, duration: 1.5 }).isValid, false);
  }
});
