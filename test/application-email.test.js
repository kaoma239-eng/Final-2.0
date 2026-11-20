const test = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');
const { sendApplicationConfirmationEmail } = require('../server');

const application = {
  customerEmail: 'customer@example.com',
  customerName: 'Taylor <Customer>',
  applicationReference: 'APP-2026-123456',
  productType: 'Loan Protection',
  insurerName: 'Sanlam Life Assurance',
  coverageAmount: 25000,
  premiumAmount: 750,
  durationMonths: 12
};

function saveEmailEnvironment() {
  return {
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_FROM_NAME: process.env.EMAIL_FROM_NAME
  };
}

function restoreEmailEnvironment(environment) {
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test('application confirmation is sent through Resend with its reference', async () => {
  const originalPost = axios.post;
  const originalEnvironment = saveEmailEnvironment();
  let request;
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.EMAIL_FROM = 'info@mkcharteredaccountants.co';
  process.env.EMAIL_FROM_NAME = 'eDIP';
  axios.post = async (...args) => {
    request = args;
    return { data: { id: 'email_test_123' } };
  };

  try {
    await sendApplicationConfirmationEmail(application);

    assert.equal(request[0], 'https://api.resend.com/emails');
    assert.equal(request[1].from, '"eDIP" <info@mkcharteredaccountants.co>');
    assert.deepEqual(request[1].to, ['customer@example.com']);
    assert.equal(request[1].subject, 'eDIP Application Received');
    assert.match(request[1].text, /APP-2026-123456/);
    assert.match(request[1].text, /MKCA will contact you about payment and next steps/);
    assert.doesNotMatch(request[1].text, /Lipila|mobile-money prompt/i);
    assert.match(request[1].html, /APP-2026-123456/);
    assert.match(request[1].html, /Taylor &lt;Customer&gt;/);
    assert.equal(request[2].headers.Authorization, 'Bearer test-resend-key');
  } finally {
    axios.post = originalPost;
    restoreEmailEnvironment(originalEnvironment);
  }
});

test('Resend failures include safe response details without API credentials', async () => {
  const originalPost = axios.post;
  const originalEnvironment = saveEmailEnvironment();
  process.env.RESEND_API_KEY = 'test-secret-key';
  process.env.EMAIL_FROM = 'info@mkcharteredaccountants.co';
  process.env.EMAIL_FROM_NAME = 'eDIP';
  axios.post = async () => {
    const error = new Error('Request failed with status code 500');
    error.response = { status: 500, data: { message: 'Sender domain is not verified' } };
    throw error;
  };

  try {
    await assert.rejects(
      sendApplicationConfirmationEmail(application),
      (error) => {
        assert.match(error.message, /Resend email API failed \(HTTP 500\).*Sender domain is not verified/);
        assert.doesNotMatch(error.message, /test-secret-key/);
        return true;
      }
    );
  } finally {
    axios.post = originalPost;
    restoreEmailEnvironment(originalEnvironment);
  }
});

test('email sending fails explicitly when the Resend API key is missing', async () => {
  const originalPost = axios.post;
  const originalEnvironment = saveEmailEnvironment();
  delete process.env.RESEND_API_KEY;
  process.env.EMAIL_FROM = 'info@mkcharteredaccountants.co';
  axios.post = async () => {
    throw new Error('Resend should not be called without an API key');
  };

  try {
    await assert.rejects(
      sendApplicationConfirmationEmail(application),
      /RESEND_API_KEY must be configured/
    );
  } finally {
    axios.post = originalPost;
    restoreEmailEnvironment(originalEnvironment);
  }
});
