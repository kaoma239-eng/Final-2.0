const test = require('node:test');
const assert = require('node:assert/strict');
const { sendApplicationConfirmationEmail } = require('../server');

test('application confirmation is sent to the submitted email with its reference', async () => {
  let message;
  await sendApplicationConfirmationEmail({
    customerEmail: 'customer@example.com',
    customerName: 'Taylor <Customer>',
    applicationReference: 'APP-2026-123456',
    productType: 'Loan Protection',
    insurerName: 'Sanlam Life Assurance',
    coverageAmount: 25000,
    premiumAmount: 750,
    durationMonths: 12
  }, {
    async sendMail(mail) {
      message = mail;
    }
  });

  assert.equal(message.to, 'customer@example.com');
  assert.equal(message.subject, 'eDIP Application Received');
  assert.match(message.from, /eDIP/);
  assert.match(message.text, /APP-2026-123456/);
  assert.match(message.html, /APP-2026-123456/);
  assert.match(message.html, /Taylor &lt;Customer&gt;/);
});
