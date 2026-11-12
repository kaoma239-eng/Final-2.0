const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const quoteFile = path.join(__dirname, '..', 'quote-calculator.html');
const quoteHtml = fs.readFileSync(quoteFile, 'utf8');

test('customer duration selection is locked to one month without changing the pricing engine', () => {
  assert.match(quoteHtml, /id="durationInput"[^\n]*value="1"/i, 'The customer-facing duration field should default to 1 month');
  assert.match(quoteHtml, /id="durationInput"[^\n]*readonly/i, 'The duration field should be read-only so customers cannot choose different month values');
  assert.match(quoteHtml, /Fixed at 1 month|1 month is the first cover period/i, 'The UI should make the fixed one-month cover explicit to the customer');
});
