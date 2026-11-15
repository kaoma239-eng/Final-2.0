const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
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

test('application confirmation uses Zoho CPaaS API with the eDIP sender', async () => {
  const originalPost = axios.post;
  const originalEnvironment = {
    ZEPTO_API_KEY: process.env.ZEPTO_API_KEY,
    API_KEY: process.env.API_KEY,
    ZEPTO_API_URL: process.env.ZEPTO_API_URL,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME
  };
  let request;
  delete process.env.ZEPTO_API_KEY;
  process.env.API_KEY = 'test-api-key';
  process.env.ZEPTO_API_URL = 'https://cpaas.example.test/v1.1/email';
  process.env.EMAIL_FROM = 'info@mkcharteredaccountants.co';
  process.env.EMAIL_FROM_NAME = 'eDIP';
  axios.post = async (...args) => {
    request = args;
    return { data: { message: 'OK' } };
  };

  try {
    await sendApplicationConfirmationEmail({
      customerEmail: 'customer@example.com',
      customerName: 'Taylor',
      applicationReference: 'APP-2026-123456',
      productType: 'Loan Protection',
      insurerName: 'Sanlam Life Assurance',
      coverageAmount: 25000,
      premiumAmount: 750,
      durationMonths: 12
    });

    assert.equal(request[0], 'https://cpaas.example.test/v1.1/email');
    assert.equal(request[1].from.address, 'info@mkcharteredaccountants.co');
    assert.equal(request[1].from.name, 'eDIP');
    assert.deepEqual(request[1].to, [{ email_address: { address: 'customer@example.com' } }]);
    assert.equal(request[1].subject, 'eDIP Application Received');
    assert.equal(request[2].headers.Authorization, 'Zoho-enczapikey test-api-key');
  } finally {
    axios.post = originalPost;
    for (const [key, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
