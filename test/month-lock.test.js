const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateParams } = require('../premium-calculator');

const quoteFile = path.join(__dirname, '..', 'quote-calculator.html');
const quoteHtml = fs.readFileSync(quoteFile, 'utf8');
const paymentHtml = fs.readFileSync(path.join(__dirname, '..', 'payment.html'), 'utf8');
const serverJs = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const databaseSchema = fs.readFileSync(path.join(__dirname, '..', 'database-schema.sql'), 'utf8');

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

test('coverage from ZMW 500 is accepted consistently across quote and application validation', () => {
  const baseParams = {
    product: 'life',
    insurer: 'sanlam',
    age: 35,
    gender: 'male',
    duration: 1
  };

  assert.equal(validateParams({ ...baseParams, coverage: 500 }).isValid, true);
  assert.equal(validateParams({ ...baseParams, coverage: 499 }).isValid, false);
  assert.match(quoteHtml, /id="coverageInput" min="500" step="1"/);
  assert.match(paymentHtml, /quoteCoverage < 500/);
  assert.match(paymentHtml, /Coverage must be at least ZMW 500/);
  assert.match(serverJs, /numericCoverage < 500/);
  assert.match(serverJs, /coverage must be at least ZMW 500/i);
  assert.match(databaseSchema, /minimum_coverage DECIMAL\(14,2\) NOT NULL DEFAULT 500\.00/);
  assert.match(databaseSchema, /0\.03000,\s+500\.00,/);
});
