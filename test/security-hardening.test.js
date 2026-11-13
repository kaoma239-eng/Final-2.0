const test = require('node:test');
const assert = require('node:assert/strict');

let app;

try {
  ({ app } = require('../server'));
} catch (error) {
  app = null;
}

test('server exports an Express app', () => {
  assert.ok(app, 'Expected the server module to export an Express app');
  assert.equal(typeof app.use, 'function');
});

test('admin routes require an authenticated session', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
      method: 'GET',
      redirect: 'manual'
    });

    assert.equal(response.status, 401, 'Unauthenticated requests should be rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application records and NRC documents require an authorized session', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    for (const route of [
      '/api/admin/applications',
      '/api/admin/applications/export.csv',
      '/api/admin/applications/APP-TEST/nrc',
      '/api/admin/users'
    ]) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 401, `${route} should reject unauthenticated requests`);
    }

    const createUserResponse = await fetch(`http://127.0.0.1:${port}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(createUserResponse.status, 401, 'Staff account creation should reject unauthenticated requests');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('admin dashboard and its assets are served', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const dashboard = await fetch(`http://127.0.0.1:${port}/admin`);
    const dashboardHtml = await dashboard.text();
    assert.equal(dashboard.status, 200);
    assert.match(dashboardHtml, /\/assets\/logos\/mkca-logo\.svg/);
    assert.match(dashboardHtml, /\/admin-dashboard\.js/);
    assert.match(dashboardHtml, /Premiums recorded/);

    const script = await fetch(`http://127.0.0.1:${port}/admin-dashboard.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    assert.match(await script.text(), /\/api\/admin\/applications\/export\.csv/);

    const logo = await fetch(`http://127.0.0.1:${port}/assets/logos/mkca-logo.svg`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /image\/svg\+xml/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application submission rejects missing customer and NRC details', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    assert.equal(response.status, 400, 'Incomplete applications should be rejected');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('security headers are configured', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const headers = response.headers;

    assert.ok(headers.get('x-frame-options') || headers.get('x-content-type-options') || headers.get('content-security-policy'), 'Expected at least one security header');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('all pages use the branded SVG favicon and expose crawler rules', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const pagePaths = [
      '/',
      '/admin',
      '/about',
      '/services',
      '/contact',
      '/insurance',
      '/insurance/products',
      '/insurance/quote',
      '/insurance/payment',
      '/insurance/claims',
      '/payment-success',
      '/payment-failed',
      '/payment-cancelled',
      '/payment/callback',
      '/payment.html'
    ];
    const pages = await Promise.all(pagePaths.map(async (pagePath) => ({
      path: pagePath,
      response: await fetch(`http://127.0.0.1:${port}${pagePath}`)
    })));

    for (const { path: pagePath, response } of pages) {
      assert.equal(response.status, 200, `${pagePath} should be served`);
      assert.match(await response.text(), /<link rel="icon" type="image\/svg\+xml" href="\/assets\/logos\/mkca-logo\.svg"/);
    }

    const icon = await fetch(`http://127.0.0.1:${port}/assets/logos/mkca-logo.svg`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\/svg\+xml/);

    const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /User-agent:\s*\*/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
