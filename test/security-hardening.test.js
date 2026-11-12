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
    for (const route of ['/api/admin/applications', '/api/admin/applications/APP-TEST/nrc']) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`);
      assert.equal(response.status, 401, `${route} should reject unauthenticated requests`);
    }
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

test('homepage links to a publicly served crawler-accessible favicon', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const homepage = await fetch(`http://127.0.0.1:${port}/`);
    const homepageHtml = await homepage.text();
    assert.equal(homepage.status, 200);
    assert.match(homepageHtml, /rel="icon"[^>]+href="\/favicon\.png"/);

    const icon = await fetch(`http://127.0.0.1:${port}/favicon.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\/png/);

    const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robots.status, 200);
    assert.match(await robots.text(), /User-agent:\s*\*/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
