const test = require('node:test');
const assert = require('node:assert/strict');
const argon2 = require('argon2');

let app;
let pool;
let ensureDatabaseIsReady;

try {
  ({ app, pool, ensureDatabaseIsReady } = require('../server'));
} catch (error) {
  app = null;
}

test('server exports an Express app', () => {
  assert.ok(app, 'Expected the server module to export an Express app');
  assert.equal(typeof app.use, 'function');
});

test('public aliases redirect to canonical URLs and unknown pages return 404', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const aliasResponse = await fetch(`http://127.0.0.1:${port}/insurance/quote`, {
      redirect: 'manual'
    });
    assert.equal(aliasResponse.status, 308);
    assert.equal(aliasResponse.headers.get('location'), '/quote-calculator');

    const callbackResponse = await fetch(`http://127.0.0.1:${port}/payment/callback`, {
      redirect: 'manual'
    });
    assert.equal(callbackResponse.status, 308);
    assert.equal(callbackResponse.headers.get('location'), '/payment-callback');

    const missingPageResponse = await fetch(`http://127.0.0.1:${port}/page-that-does-not-exist`);
    assert.equal(missingPageResponse.status, 404);
    assert.match(await missingPageResponse.text(), /Page Not Found/);

    const missingApiResponse = await fetch(`http://127.0.0.1:${port}/api/not-a-real-endpoint`);
    assert.equal(missingApiResponse.status, 404);
    assert.match(missingApiResponse.headers.get('content-type'), /application\/json/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
      '/api/auth/me',
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

test('record listings, deletion and restoration require an authenticated session', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const requests = [
      ['/api/admin/records/policies', 'GET'],
      ['/api/admin/records/claims', 'GET'],
      ['/api/admin/records/payments', 'GET'],
      ['/api/admin/records/purchases', 'GET'],
      ['/api/admin/records/applications/APP-TEST', 'DELETE'],
      ['/api/admin/records/staff/1', 'DELETE'],
      ['/api/admin/records/policies/MKCA-TEST/restore', 'POST']
    ];

    for (const [route, method] of requests) {
      const response = await fetch(`http://127.0.0.1:${port}${route}`, { method });
      assert.equal(response.status, 401, `${method} ${route} should reject unauthenticated requests`);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('only a master admin can soft-delete dashboard records', async () => {
  if (!app || !pool || !ensureDatabaseIsReady) {
    throw new Error('Server database test dependencies were not exported');
  }

  const originalGetConnection = pool.getConnection;
  const originalExecute = pool.execute;
  const password = 'Integration-test-password';
  const passwordHash = await argon2.hash(password);
  const adminEmail = 'staff-admin@example.com';
  const masterEmail = 'master-admin@example.com';
  let applicationDeleted = false;

  pool.getConnection = async () => ({
    ping: async () => {},
    release() {},
    async beginTransaction() {},
    async execute(query) {
      if (query.startsWith('SELECT deleted_at FROM loan_applications')) {
        return [[{ deleted_at: applicationDeleted ? new Date() : null }], []];
      }
      if (query.startsWith('UPDATE loan_applications SET deleted_at = CURRENT_TIMESTAMP')) {
        applicationDeleted = true;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected test database query: ${query}`);
    },
    async commit() {},
    async rollback() {}
  });
  pool.execute = async (query, values) => {
    if (query.includes('information_schema.COLUMNS')) {
      return [[{ COLUMN_NAME: 'deleted_at' }], []];
    }
    if (query.startsWith('SELECT deleted_at FROM users WHERE id')) {
      return [[{ deleted_at: null }], []];
    }
    if (query.startsWith('SELECT deleted_at FROM loan_applications')) {
      return [[{ deleted_at: applicationDeleted ? new Date() : null }], []];
    }
    if (query.startsWith('UPDATE loan_applications SET deleted_at = NULL')) {
      applicationDeleted = false;
      return [{ affectedRows: 1 }, []];
    }
    if (query.startsWith('SELECT COUNT(*) AS total FROM policies')) {
      return [[{ total: 1 }], []];
    }
    if (query.startsWith('SELECT policy_number AS recordId')) {
      return [[{
        recordId: 'MKCA-TEST',
        userId: 1,
        loanAmount: '1000.00',
        coverageAmount: '1000.00',
        premiumAmount: '30.00',
        status: 'active',
        recordDate: '2025-01-01',
        createdAt: '2025-01-01',
        deletedAt: null
      }], []];
    }
    if (query.includes('FROM users u') && query.includes('INNER JOIN roles')) {
      const email = values[0];
      const isMaster = email === masterEmail;
      return [[{
        id: isMaster ? 2 : 1,
        email,
        full_name: isMaster ? 'Master Admin' : 'Staff Admin',
        password_hash: passwordHash,
        role_name: isMaster ? 'super_admin' : 'administrator'
      }], []];
    }
    throw new Error(`Unexpected test database query: ${query}`);
  };

  const server = app.listen(0);
  const { port } = server.address();

  try {
    await ensureDatabaseIsReady();
    const login = async (email) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password })
      });
      assert.equal(response.status, 200);
      return response.headers.get('set-cookie').split(';', 1)[0];
    };

    const staffCookie = await login(adminEmail);
    const deniedResponse = await fetch(`http://127.0.0.1:${port}/api/admin/records/applications/APP-TEST`, {
      method: 'DELETE',
      headers: { Cookie: staffCookie }
    });
    assert.equal(deniedResponse.status, 403);
    assert.equal(applicationDeleted, false);

    const masterCookie = await login(masterEmail);
    const deletedResponse = await fetch(`http://127.0.0.1:${port}/api/admin/records/applications/APP-TEST`, {
      method: 'DELETE',
      headers: { Cookie: masterCookie }
    });
    assert.equal(deletedResponse.status, 200);
    assert.equal((await deletedResponse.json()).success, true);
    assert.equal(applicationDeleted, true);

    const recordsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/records/policies?page=1&pageSize=25`, {
      headers: { Cookie: masterCookie }
    });
    assert.equal(recordsResponse.status, 200);
    const recordsResult = await recordsResponse.json();
    assert.equal(recordsResult.records[0].recordId, 'MKCA-TEST');

    const restoredResponse = await fetch(`http://127.0.0.1:${port}/api/admin/records/applications/APP-TEST/restore`, {
      method: 'POST',
      headers: { Cookie: masterCookie }
    });
    assert.equal(restoredResponse.status, 200);
    assert.equal(applicationDeleted, false);
  } finally {
    pool.getConnection = originalGetConnection;
    pool.execute = originalExecute;
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
    assert.match(dashboardHtml, /\/assets\/logos\/Bright%20Cyan%20MKCA%20Logo%20Letters\.png/);
    assert.match(dashboardHtml, /aria-label="MKCA home"/);
    assert.doesNotMatch(dashboardHtml, /Mpangwe Kasonso Chartered Accountants/);
    assert.match(dashboardHtml, /\/admin-dashboard\.js/);
    assert.match(dashboardHtml, /Premiums recorded/);
    assert.match(dashboardHtml, /Policies, claims, payments and purchases/);
    assert.match(dashboardHtml, /Show deleted staff/);

    const script = await fetch(`http://127.0.0.1:${port}/admin-dashboard.js`);
    assert.equal(script.status, 200);
    assert.match(script.headers.get('content-type'), /javascript/);
    const scriptText = await script.text();
    assert.match(scriptText, /\/api\/admin\/applications\/export\.csv/);
    assert.match(scriptText, /\/api\/admin\/records\//);
    assert.match(scriptText, /currentUserRole !== 'super_admin'/);

    const logo = await fetch(`http://127.0.0.1:${port}/assets/logos/Bright%20Cyan%20MKCA%20Logo%20Letters.png`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /image\/png/);
    await logo.arrayBuffer();
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
    assert.equal((await response.json()).message, 'Select an individual or company customer type.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application submission validates quote coverage and cover duration', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();
  const applicationData = {
    customerType: 'individual',
    customerName: 'Test Applicant',
    customerEmail: 'applicant@example.com',
    customerId: '123456/11/1',
    phoneNumber: '0977123456',
    productType: 'Loan Protection',
    insurerName: 'Sanlam Life Assurance',
    coverageAmount: 1000,
    premiumPaid: 30,
    age: 20,
    nrcDocumentData: 'data:image/png;base64,AAAA'
  };

  try {
    for (const duration of [1, 12]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...applicationData, durationMonths: duration })
      });

      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /NRC file is invalid/);
    }

    const minimumCoverageResponse = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...applicationData, coverageAmount: 500, durationMonths: 12 })
    });

    assert.equal(minimumCoverageResponse.status, 400);
    assert.match((await minimumCoverageResponse.json()).message, /NRC file is invalid/);

    for (const duration of [0, 13]) {
      const response = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...applicationData, durationMonths: duration })
      });

      assert.equal(response.status, 400);
      assert.match((await response.json()).message, /cover duration from 1 to 12 months/i);
    }

    const invalidNrcResponse = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...applicationData,
        customerId: '12345678/11/1',
        durationMonths: 12
      })
    });

    assert.equal(invalidNrcResponse.status, 400);
    assert.match((await invalidNrcResponse.json()).message, /NRC number must use the format/i);

    const invalidQuoteResponse = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...applicationData, coverageAmount: 0, durationMonths: 12 })
    });

    assert.equal(invalidQuoteResponse.status, 400);
    assert.match((await invalidQuoteResponse.json()).message, /Quote coverage must be at least ZMW 500/i);

    const belowMinimumCoverageResponse = await fetch(`http://127.0.0.1:${port}/api/save-application`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...applicationData, coverageAmount: 499, durationMonths: 12 })
    });

    assert.equal(belowMinimumCoverageResponse.status, 400);
    assert.match((await belowMinimumCoverageResponse.json()).message, /Quote coverage must be at least ZMW 500/i);
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

test('all pages use the root MKCA favicon and expose crawler rules', async () => {
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
      const html = await response.text();
      assert.match(html, /<link rel="icon" type="image\/x-icon" href="\/favicon\.ico"/);
      assert.match(html, /<link rel="icon" type="image\/png" sizes="144x144" href="\/favicon\.png"/);
      if (pagePath === '/') {
        assert.match(html, /href="services\.html" class="btn btn-primary btn-lg">Our Services<\/a>/);
        assert.match(html, /href="products\.html" class="btn btn-outline btn-lg[^"]*">Insurance<\/a>/);
        assert.match(html, /href="products\.html">Insurance<\/a>/);
        assert.doesNotMatch(html, /href="contact\.html" class="btn btn-primary btn-sm">Contact Us<\/a>/);
        assert.match(html, /Arbitration/);
      }
      if (pagePath === '/services') {
        assert.match(html, /Arbitration/);
      }
    }

    const ico = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    assert.equal(ico.status, 200);
    assert.match(ico.headers.get('content-type'), /image\/x-icon/);
    const icoBuffer = Buffer.from(await ico.arrayBuffer());
    assert.equal(icoBuffer.readUInt16LE(0), 0);
    assert.equal(icoBuffer.readUInt16LE(2), 1);
    const frameCount = icoBuffer.readUInt16LE(4);
    assert.ok(frameCount >= 3);
    for (let index = 0; index < frameCount; index += 1) {
      const entryOffset = 6 + index * 16;
      const imageSize = icoBuffer.readUInt32LE(entryOffset + 8);
      const imageOffset = icoBuffer.readUInt32LE(entryOffset + 12);
      assert.equal(icoBuffer.toString('hex', imageOffset, imageOffset + 8), '89504e470d0a1a0a');
      assert.ok(imageOffset + imageSize <= icoBuffer.length);
    }

    const icon = await fetch(`http://127.0.0.1:${port}/favicon.png`);
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get('content-type'), /image\/png/);
    const iconBuffer = Buffer.from(await icon.arrayBuffer());
    assert.equal(iconBuffer.readUInt32BE(16), 144);
    assert.equal(iconBuffer.readUInt32BE(20), 144);

    const robots = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robots.status, 200);
    const robotsText = await robots.text();
    assert.match(robotsText, /User-agent:\s*Googlebot[\s\S]*?Allow:\s*\/?/);
    assert.match(robotsText, /User-agent:\s*Googlebot-Image[\s\S]*?Allow:\s*\/?/);

    const sitemap = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
    assert.equal(sitemap.status, 200);
    assert.match(await sitemap.text(), /https:\/\/www\.mkcharteredaccountants\.co\//);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('contact page map targets MKCA at Godfrey House in Lusaka', async () => {
  if (!app) {
    throw new Error('App was not exported');
  }

  const server = app.listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/contact`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /maps\?output=embed&amp;q=Mpangwe%20Kasonso%20Chartered%20Accountants&amp;z=17/);
    assert.match(html, /title="Map to Mpangwe Kasonso Chartered Accountants at Godfrey House, Lusaka"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('admin application pagination uses integer LIMIT values for TiDB', async () => {
  if (!app || !pool || !ensureDatabaseIsReady) {
    throw new Error('Server database test dependencies were not exported');
  }

  const originalGetConnection = pool.getConnection;
  const originalExecute = pool.execute;
  const password = 'Integration-test-password';
  const passwordHash = await argon2.hash(password);
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@mkca.local').toLowerCase();
  const adminUsername = process.env.ADMIN_USERNAME || 'MKCA24';
  let applicationQuery;

  pool.getConnection = async () => ({
    ping: async () => {},
    release() {},
    async execute(query, values) {
      if (query.startsWith('SELECT COUNT(*) AS total FROM loan_applications')) {
        return [[{ total: 1 }], []];
      }
      if (query.includes('FROM loan_applications')) {
        applicationQuery = { query, values };
        return [[], []];
      }
      throw new Error(`Unexpected test database query: ${query}`);
    }
  });
  pool.execute = async (query) => {
    if (query.includes('information_schema.COLUMNS')) {
      return [[{ COLUMN_NAME: 'deleted_at' }], []];
    }
    if (query.startsWith('SELECT deleted_at FROM users WHERE id')) {
      return [[{ deleted_at: null }], []];
    }
    if (query.includes('FROM users u') && query.includes('INNER JOIN roles')) {
      return [[{
        id: 1,
        email: adminEmail,
        full_name: 'Test Admin',
        password_hash: passwordHash,
        role_name: 'super_admin'
      }], []];
    }
    throw new Error(`Unexpected test database query: ${query}`);
  };

  const server = app.listen(0);
  const { port } = server.address();

  try {
    await ensureDatabaseIsReady();
    const loginResponse = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: adminUsername, password })
    });
    assert.equal(loginResponse.status, 200);
    const cookie = loginResponse.headers.get('set-cookie');
    assert.ok(cookie, 'Login should create an authenticated session');

    const applicationsResponse = await fetch(
      `http://127.0.0.1:${port}/api/admin/applications?page=1&pageSize=25`,
      { headers: { Cookie: cookie.split(';', 1)[0] } }
    );
    assert.equal(applicationsResponse.status, 200);
    assert.equal((await applicationsResponse.json()).success, true);
    assert.match(applicationQuery.query, /LIMIT 25 OFFSET 0/);
    assert.deepEqual(applicationQuery.values, []);
  } finally {
    pool.getConnection = originalGetConnection;
    pool.execute = originalExecute;
    await new Promise((resolve) => server.close(resolve));
  }
});
