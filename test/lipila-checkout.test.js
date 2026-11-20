const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  app,
  getLipilaApiBaseUrl,
  normalizeLipilaPaymentStatus,
  buildLipilaCollectionPayload
} = require('../server');

async function withServer(run) {
  const server = app.listen(0);
  const { port } = server.address();

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('Lipila uses the documented production and sandbox API hosts', () => {
  assert.equal(getLipilaApiBaseUrl('production'), 'https://blz.lipila.io');
  assert.equal(getLipilaApiBaseUrl('live'), 'https://blz.lipila.io');
  assert.equal(getLipilaApiBaseUrl('sandbox'), 'https://api.lipila.dev');
  assert.throws(() => getLipilaApiBaseUrl('unknown'), /LIPILA_ENVIRONMENT/);
});

test('Lipila payment statuses are normalized without treating unknown states as success', () => {
  assert.equal(normalizeLipilaPaymentStatus('Pending'), 'Pending');
  assert.equal(normalizeLipilaPaymentStatus('Successful'), 'Successful');
  assert.equal(normalizeLipilaPaymentStatus('Failed'), 'Failed');
  assert.equal(normalizeLipilaPaymentStatus('processing'), null);
});

test('Lipila collection uses a flat production payload with a country-code account number', () => {
  assert.deepEqual(buildLipilaCollectionPayload({
    premium_amount: '18.50',
    phone_number: '0977123456',
    product_type: 'Loan Protection',
    customer_email: 'customer@example.com'
  }, 'payment-id', 'APP-20260101-123456'), {
    referenceId: 'payment-id',
    amount: 18.5,
    narration: 'eDIP Loan Protection premium',
    accountNumber: '260977123456',
    currency: 'ZMW',
    email: 'customer@example.com',
    referenceData: 'APP-20260101-123456'
  });
});

test('checkout rejects requests without a saved application reference', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      message: 'A valid application reference is required.'
    });
  });
});

test('payment status rejects malformed references without contacting Lipila', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/checkout/not-a-reference/status`);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      success: false,
      message: 'A valid payment reference is required.'
    });
  });
});

test('backend CORS allows the production website and Vercel domain', async () => {
  await withServer(async (baseUrl) => {
    for (const origin of [
      'https://mkcharteredaccountants.co',
      'https://www.mkcharteredaccountants.co',
      'https://final-2-0-ten.vercel.app'
    ]) {
      const response = await fetch(`${baseUrl}/api/health`, {
        headers: { Origin: origin }
      });

      assert.equal(response.status, 200, `${origin} should be allowed`);
      assert.equal(response.headers.get('access-control-allow-origin'), origin);
      assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    }
  });
});

test('application page saves the application without starting checkout', () => {
  const paymentPage = fs.readFileSync(path.join(__dirname, '..', 'payment.html'), 'utf8');
  const inlineScript = [...paymentPage.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()?.[1];
  const apiBaseConfig = paymentPage.match(/const API_BASE_URLS = ([\s\S]*?);/);

  assert.match(paymentPage, /applicationResponse = await fetchApi\('\/api\/save-application'/);
  assert.match(paymentPage, /Submit Application<\/button>/);
  assert.match(paymentPage, /MKCA will contact you about payment and next steps/);
  assert.doesNotMatch(paymentPage, /\/api\/checkout|Lipila|mobile-money prompt/i);
  assert.match(paymentPage, /Your quote is missing or invalid/);
  assert.ok(apiBaseConfig, 'Expected API base URLs to be configured');
  assert.match(apiBaseConfig[1], /:\s*\[window\.location\.origin\]/);
  assert.ok(inlineScript, 'Expected the page to include its checkout script');
  assert.doesNotThrow(() => new Function(inlineScript));
});
