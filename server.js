const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const crypto = require('crypto');
const axios = require('axios');
const nodemailer = require('nodemailer');
const mysql = require('mysql2/promise');
const PDFDocument = require('pdfkit');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const argon2 = require('argon2');
const { getLogoPath, normalizeSanlamName, companyLogos } = require('./company-logos');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const isProduction = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'MKCA24';
const applicationAdminRoles = ['super_admin', 'administrator', 'insurance_officer', 'claims_officer', 'finance_officer'];
const ADMIN_SESSION_IDLE_TIMEOUT_MS = 30_000;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || `${BASE_URL},http://localhost:${PORT},http://127.0.0.1:${PORT}`).split(',').map((value) => value.trim()).filter(Boolean);
const certificatesDir = path.join(__dirname, 'certificates');
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const purchaseRecordsPath = path.join(dataDir, 'purchase_records.json');
const loanApplicationsPath = path.join(dataDir, 'loan_applications.json');
const applicationDocumentsDir = path.join(dataDir, 'application-documents');
const policyRecordsPath = path.join(dataDir, 'policies.json');
const claimDocumentsPath = path.join(dataDir, 'claim_documents.json');
const logosDir = path.join(__dirname, 'assets', 'logos');

let dbAvailable = false;
let mailTransporter = null;

// Database connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mkca_platform',
  ssl: String(process.env.DB_SSL || '').toLowerCase() === 'true' ? {} : undefined,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

if (!fs.existsSync(certificatesDir)) {
  fs.mkdirSync(certificatesDir, { recursive: true });
}

// Ensure assets/logos directory exists and try to organize legacy logo files
if (!fs.existsSync(logosDir)) {
  fs.mkdirSync(logosDir, { recursive: true });
}

function ensureLogos() {
  Object.values(companyLogos).forEach((relPath) => {
    const dest = path.join(__dirname, relPath);
    if (fs.existsSync(dest)) return; // already in place

    // Try to find a legacy file in project root matching keywords
    const keywords = path.basename(relPath).split(/[-_.]/).filter(Boolean).slice(0,2);
    const files = fs.readdirSync(__dirname);
    for (const f of files) {
      const low = f.toLowerCase();
      if (keywords.every(k => low.includes(k))) {
        try {
          fs.copyFileSync(path.join(__dirname, f), dest);
          console.log(`Copied legacy logo ${f} -> ${dest}`);
          break;
        } catch (err) {
          console.warn(`Failed copying legacy logo ${f} -> ${dest}: ${err.message}`);
        }
      }
    }
  });

  // Ensure default-logo exists: prefer logo1.png in project root
  const defaultDest = path.join(__dirname, 'assets', 'logos', 'default-logo.png');
  if (!fs.existsSync(defaultDest)) {
    const candidates = ['logo1.png', 'logo1.png', 'logo1.base64.txt', 'logo1.datauri.txt'];
    for (const c of candidates) {
      const p = path.join(__dirname, c);
      if (fs.existsSync(p) && c.endsWith('.png')) {
        try { fs.copyFileSync(p, defaultDest); console.log(`Copied ${c} -> default-logo.png`); break; } catch (e) { }
      }
      if (fs.existsSync(p) && c.endsWith('.txt')) {
        try {
          const content = fs.readFileSync(p, 'utf8').trim();
          // handle base64 or datauri
          const base64 = content.includes('base64,') ? content.split('base64,')[1] : content;
          const buf = Buffer.from(base64, 'base64');
          fs.writeFileSync(defaultDest, buf);
          console.log(`Decoded ${c} -> default-logo.png`);
          break;
        } catch (e) {}
      }
    }
  }
}

ensureLogos();

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

async function loadLocalPurchaseRecords() {
  try {
    const existing = await fsPromises.readFile(purchaseRecordsPath, 'utf8');
    return JSON.parse(existing || '[]');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

async function saveLocalPurchaseRecord(record) {
  const records = await loadLocalPurchaseRecords();
  records.push(record);
  await fsPromises.writeFile(purchaseRecordsPath, JSON.stringify(records, null, 2), 'utf8');
}

async function loadJsonFile(filePath, fallback = []) {
  try {
    const existing = await fsPromises.readFile(filePath, 'utf8');
    return JSON.parse(existing || JSON.stringify(fallback));
  } catch (err) {
    if (err.code === 'ENOENT') {
      return fallback;
    }
    throw err;
  }
}

async function saveJsonFile(filePath, data) {
  await fsPromises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function generateApplicationReference() {
  const date = new Date();
  return `APP-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}-${String(Math.floor(Math.random() * 900000) + 100000)}`;
}

async function ensureDefaultCustomerUser() {
  if (!dbAvailable) return null;

  let connection;
  try {
    connection = await pool.getConnection();

    const [roleRows] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', ['customer']);
    let roleId = roleRows[0]?.id;
    if (!roleId) {
      await connection.execute('INSERT INTO roles (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)', ['customer', 'Customer']);
      const [newRoleRows] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', ['customer']);
      roleId = newRoleRows[0]?.id;
    }

    const defaultEmail = 'customer@mkca.local';
    const defaultNrc = 'DEFAULT-NRC';
    const [userRows] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [defaultEmail]);
    if (userRows[0]?.id) {
      return userRows[0].id;
    }

    await connection.execute(
      `INSERT INTO users (role_id, business_id, full_name, email, phone, nrc_passport, date_of_birth, address, password_hash, profile_type, is_email_verified)
       VALUES (?, NULL, ?, ?, ?, ?, '2000-01-01', 'Lusaka, Zambia', 'system-user', 'individual', 1)`,
      [roleId, 'System Customer', defaultEmail, '260000000000', defaultNrc]
    );

    const [freshRows] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [defaultEmail]);
    return freshRows[0]?.id || null;
  } catch (error) {
    console.warn('Failed to ensure default customer user:', error?.message || error);
    return null;
  } finally {
    if (connection) connection.release();
  }
}

async function ensureDefaultAdminAccount() {
  if (!dbAvailable) return null;

  let connection;
  try {
    connection = await pool.getConnection();
    const roleNames = ['super_admin', 'administrator', 'insurance_officer', 'claims_officer', 'finance_officer', 'lender', 'customer'];

    for (const roleName of roleNames) {
      const descriptionMap = {
        super_admin: 'Super Administrator',
        administrator: 'Administrator',
        insurance_officer: 'Insurance Officer',
        claims_officer: 'Claims Officer',
        finance_officer: 'Finance Officer',
        lender: 'Lender',
        customer: 'Customer'
      };

      await connection.execute(
        'INSERT INTO roles (name, description) VALUES (?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name)',
        [roleName, descriptionMap[roleName] || roleName]
      );
    }

    const [adminRoleRows] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', ['super_admin']);
    const adminRoleId = adminRoleRows[0]?.id;
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@mkca.local').toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD || (isProduction ? '' : 'MKCAdev24');
    if (!adminPassword) {
      throw new Error('ADMIN_PASSWORD must be configured in production.');
    }
    const passwordHash = await argon2.hash(adminPassword);

    const [existingUserRows] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [adminEmail]);
    if (existingUserRows[0]?.id) {
      await connection.execute(
        'UPDATE users SET role_id = ?, full_name = ?, password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?',
        [adminRoleId, 'System Administrator', passwordHash, adminEmail]
      );
      return existingUserRows[0].id;
    }

    await connection.execute(
      `INSERT INTO users (role_id, business_id, full_name, email, phone, nrc_passport, date_of_birth, address, password_hash, profile_type, is_email_verified)
       VALUES (?, NULL, ?, ?, ?, ?, '2000-01-01', 'Lusaka, Zambia', ?, 'individual', 1)`,
      [adminRoleId, 'System Administrator', adminEmail, '260000000000', 'ADMIN-NRC', passwordHash]
    );

    const [freshRows] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [adminEmail]);
    return freshRows[0]?.id || null;
  } catch (error) {
    console.warn('Failed to ensure default admin account:', error?.message || error);
    return null;
  } finally {
    if (connection) connection.release();
  }
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, message: 'Authentication required.' });
  }

  return next();
}

function requireRole(roles) {
  const allowedRoles = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.session || !req.session.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!allowedRoles.includes(req.session.user.role)) {
      return res.status(403).json({ success: false, message: 'You do not have permission to perform this action.' });
    }

    return next();
  };
}

async function checkDatabaseAvailability() {
  try {
    const connection = await pool.getConnection();
    if (typeof connection.ping === 'function') {
      await connection.ping();
    }
    connection.release();
    dbAvailable = true;
    console.log('Database connection available.');
    return true;
  } catch (error) {
    dbAvailable = false;
    console.error('MySQL is required but unavailable. Please start MySQL and verify DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME.', error?.message || error);
    return false;
  }
}

async function ensureDatabaseIsReady() {
  const isAvailable = await checkDatabaseAvailability();
  if (!isAvailable) {
    throw new Error('MySQL database is not available. The application cannot start without it.');
  }
}


app.disable('x-powered-by');
if (isProduction) {
  app.set('trust proxy', 1);
}
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Origin not allowed by CORS policy'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-CSRF-Token']
}));
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      connectSrc: ["'self'", 'https://lipila.dev'],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"]
    }
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(session({
  secret: process.env.SESSION_SECRET || 'replace-with-a-long-random-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 60 * 60 * 1000
  }
}));
app.use('/api', (req, res, next) => {
  const user = req.session && req.session.user;
  if (!user || !applicationAdminRoles.includes(user.role) || req.path === '/auth/login') {
    return next();
  }

  const now = Date.now();
  const lastActivityAt = Number(req.session.adminLastActivityAt);
  if (Number.isFinite(lastActivityAt) && lastActivityAt > 0 && now - lastActivityAt >= ADMIN_SESSION_IDLE_TIMEOUT_MS) {
    return req.session.destroy((error) => {
      if (error) {
        console.error('Failed to expire inactive admin session:', error);
        return res.status(500).json({ success: false, message: 'Unable to end the inactive admin session.' });
      }

      res.clearCookie('connect.sid');
      return res.status(401).json({ success: false, message: 'Admin session expired due to inactivity.' });
    });
  }

  req.session.adminLastActivityAt = now;
  return next();
});
app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests. Please try again later.'
  }
}));
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use('/assets', express.static(path.join(__dirname, 'assets')));

const rootStaticFiles = new Set([
  'index.html',
  'quote-calculator.html',
  'contact.html',
  'products.html',
  'claims.html',
  'payment.html',
  'payment-success.html',
  'favicon.ico',
  'favicon.png',
  'robots.txt',
  'sitemap.xml',
  'styles.css',
  'script.js',
  'premium-calculator.js',
  'company-logos.js',
  'admin-dashboard.js'
]);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});

app.get('/services', (req, res) => {
  res.sendFile(path.join(__dirname, 'services.html'));
});

app.get('/insurance', (req, res) => {
  res.sendFile(path.join(__dirname, 'products.html'));
});

app.get('/insurance/products', (req, res) => {
  res.sendFile(path.join(__dirname, 'products.html'));
});

app.get('/insurance/quote', (req, res) => {
  res.sendFile(path.join(__dirname, 'quote-calculator.html'));
});

app.get('/insurance/apply', (req, res) => {
  res.sendFile(path.join(__dirname, 'quote-calculator.html'));
});

app.get('/insurance/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment.html'));
});

app.get('/insurance/claims', (req, res) => {
  res.sendFile(path.join(__dirname, 'claims.html'));
});

app.get('/payment-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment-success.html'));
});

app.get('/payment-failed', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment-failed.html'));
});

app.get('/payment-cancelled', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment-cancelled.html'));
});

app.get('/payment/callback', (req, res) => {
  res.sendFile(path.join(__dirname, 'payment-callback.html'));
});

app.get('/contact', (req, res) => {
  res.sendFile(path.join(__dirname, 'contact.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/:file', (req, res, next) => {
  const requested = req.params.file;
  if (rootStaticFiles.has(requested)) {
    return res.sendFile(path.join(__dirname, requested));
  }
  next();
});

app.use(express.static(publicDir));
app.use('/certificates', requireAuth, express.static(certificatesDir));

app.post('/api/auth/login', async (req, res) => {
  try {
    if (!dbAvailable) {
      return res.status(503).json({ success: false, message: 'Database is unavailable.' });
    }

    const loginIdentifier = sanitizeText(req.body.username || req.body.email || '');
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@mkca.local').toLowerCase();
    const email = loginIdentifier.toLowerCase() === ADMIN_USERNAME.toLowerCase()
      ? adminEmail
      : loginIdentifier.toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!loginIdentifier || !password) {
      return res.status(400).json({ success: false, message: 'Username/email and password are required.' });
    }

    const [rows] = await pool.execute(
      `SELECT u.id, u.email, u.full_name, u.password_hash, r.name AS role_name
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? LIMIT 1`,
      [email]
    );

    const user = rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid login credentials.' });
    }

    const passwordMatches = await argon2.verify(user.password_hash, password);
    if (!passwordMatches) {
      return res.status(401).json({ success: false, message: 'Invalid login credentials.' });
    }

    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role_name
    };
    if (applicationAdminRoles.includes(user.role_name)) {
      req.session.adminLastActivityAt = Date.now();
    }

    return res.json({
      success: true,
      message: 'Login successful.',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_name
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ success: false, message: 'Unable to complete login.' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  if (req.session) {
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.json({ success: true, message: 'Logged out successfully.' });
    });
    return;
  }

  return res.json({ success: true, message: 'Logged out successfully.' });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.session.user.id,
      email: req.session.user.email,
      fullName: req.session.user.fullName,
      role: req.session.user.role
    }
  });
});

app.get('/api/admin/overview', requireAuth, requireRole(['super_admin', 'administrator', 'insurance_officer', 'claims_officer', 'finance_officer']), async (req, res) => {
  try {
    if (!dbAvailable) {
      return res.status(503).json({ success: false, message: 'Database unavailable.' });
    }

    const connection = await pool.getConnection();
    try {
      const [applicationCountRows] = await connection.execute('SELECT COUNT(*) AS total FROM loan_applications');
      const [policyCountRows] = await connection.execute('SELECT COUNT(*) AS total FROM policies');
      const [paymentCountRows] = await connection.execute('SELECT COUNT(*) AS total FROM payments');
      const [claimCountRows] = await connection.execute('SELECT COUNT(*) AS total FROM claims');
      const [purchaseSummaryRows] = await connection.execute(
        'SELECT COUNT(*) AS total, COALESCE(SUM(premium_paid), 0) AS premiums FROM purchase_records'
      );

      return res.json({
        success: true,
        summary: {
          applications: Number(applicationCountRows[0]?.total || 0),
          policies: Number(policyCountRows[0]?.total || 0),
          payments: Number(paymentCountRows[0]?.total || 0),
          claims: Number(claimCountRows[0]?.total || 0),
          purchaseRecords: Number(purchaseSummaryRows[0]?.total || 0),
          recordedPremiums: Number(purchaseSummaryRows[0]?.premiums || 0)
        }
      });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error('Admin overview error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load admin overview.' });
  }
});

const applicationStatuses = new Set(['draft', 'submitted', 'approved', 'rejected', 'paid']);
const manageableStaffRoles = ['administrator', 'insurance_officer', 'claims_officer', 'finance_officer'];
const visibleAdminRoles = ['super_admin', ...manageableStaffRoles];

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseApplicationFilters(query) {
  const search = typeof query.search === 'string' ? query.search.trim().slice(0, 100) : '';
  const status = typeof query.status === 'string' ? query.status.trim() : '';
  const from = typeof query.from === 'string' ? query.from.trim() : '';
  const to = typeof query.to === 'string' ? query.to.trim() : '';

  if (status && status !== 'all' && !applicationStatuses.has(status)) {
    return { error: 'Invalid application status.' };
  }
  if ((from && !isValidIsoDate(from)) || (to && !isValidIsoDate(to))) {
    return { error: 'Dates must be valid calendar dates in YYYY-MM-DD format.' };
  }
  if (from && to && from > to) {
    return { error: 'The start date must be before or equal to the end date.' };
  }

  return {
    filters: {
      search,
      status: status === 'all' ? '' : status,
      from,
      to
    }
  };
}

function buildApplicationWhere(filters) {
  const conditions = [];
  const values = [];

  if (filters.status) {
    conditions.push('status = ?');
    values.push(filters.status);
  }
  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push('(application_reference LIKE ? OR customer_name LIKE ? OR customer_email LIKE ? OR phone_number LIKE ? OR nrc_number LIKE ?)');
    values.push(pattern, pattern, pattern, pattern, pattern);
  }
  if (filters.from) {
    conditions.push('created_at >= ?');
    values.push(filters.from);
  }
  if (filters.to) {
    conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
    values.push(filters.to);
  }

  return {
    sql: conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '',
    values
  };
}

function mapApplicationRow(row) {
  return {
    applicationReference: row.application_reference,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    phoneNumber: row.phone_number,
    customerId: row.nrc_number,
    customerType: row.customer_type,
    companyName: row.company_name,
    productType: row.product_type,
    insurerName: row.insurer_name,
    loanAmount: Number(row.loan_amount),
    coverageAmount: Number(row.coverage_amount),
    premiumAmount: Number(row.premium_amount),
    durationMonths: Number(row.duration_months),
    ageAtApplication: Number(row.age_at_application),
    nrcUploaded: Boolean(row.nrc_uploaded),
    hasNrcDocument: Boolean(row.document_path),
    status: row.status,
    createdAt: row.created_at
  };
}

function filterLocalApplications(records, filters) {
  const search = filters.search.toLowerCase();
  return records.filter((record) => {
    if (filters.status && record.status !== filters.status) return false;

    if (search) {
      const searchable = [
        record.applicationReference,
        record.customerName,
        record.customerEmail,
        record.phoneNumber,
        record.customerId || record.nrcNumber
      ].join(' ').toLowerCase();
      if (!searchable.includes(search)) return false;
    }

    const createdDate = String(record.createdAt || '').slice(0, 10);
    if (filters.from && createdDate < filters.from) return false;
    if (filters.to && createdDate > filters.to) return false;
    return true;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
}

async function getAdminApplications(filters, pagination = null) {
  if (dbAvailable) {
    const connection = await pool.getConnection();
    try {
      const where = buildApplicationWhere(filters);
      const [countRows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM loan_applications${where.sql}`,
        where.values
      );
      const total = Number(countRows[0]?.total || 0);
      const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
      const page = Math.min(pagination.page, totalPages);
      const offset = (page - 1) * pagination.pageSize;
      // TiDB requires validated integer literals for LIMIT and OFFSET.
      const [rows] = await connection.execute(
        `SELECT application_reference, customer_name, customer_email, phone_number, nrc_number,
                customer_type, company_name, product_type, insurer_name, loan_amount, coverage_amount,
                premium_amount, duration_months, age_at_application, nrc_uploaded, document_path, status, created_at
         FROM loan_applications${where.sql}
         ORDER BY created_at DESC, application_reference DESC
         LIMIT ${pagination.pageSize} OFFSET ${offset}`,
        where.values
      );

      return {
        applications: rows.map(mapApplicationRow),
        total,
        page,
        pageSize: pagination.pageSize,
        totalPages
      };
    } finally {
      connection.release();
    }
  }

  const records = filterLocalApplications(await loadJsonFile(loanApplicationsPath, []), filters);
  const total = records.length;
  const totalPages = Math.max(1, Math.ceil(total / pagination.pageSize));
  const page = Math.min(pagination.page, totalPages);
  const start = (page - 1) * pagination.pageSize;
  const applications = records.slice(start, start + pagination.pageSize).map((record) => {
    const { documentPath, ...visibleRecord } = record;
    return { ...visibleRecord, hasNrcDocument: Boolean(documentPath) };
  });

  return { applications, total, page, pageSize: pagination.pageSize, totalPages };
}

async function getAllAdminApplications(filters) {
  if (dbAvailable) {
    const where = buildApplicationWhere(filters);
    const [rows] = await pool.execute(
      `SELECT application_reference, customer_name, customer_email, phone_number, nrc_number,
              customer_type, company_name, product_type, insurer_name, loan_amount, coverage_amount,
              premium_amount, duration_months, age_at_application, nrc_uploaded, document_path, status, created_at
       FROM loan_applications${where.sql}
       ORDER BY created_at DESC, application_reference DESC`,
      where.values
    );
    return rows.map(mapApplicationRow);
  }

  return filterLocalApplications(await loadJsonFile(loanApplicationsPath, []), filters).map((record) => {
    const { documentPath, ...visibleRecord } = record;
    return { ...visibleRecord, hasNrcDocument: Boolean(documentPath) };
  });
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  const safeText = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safeText.replace(/"/g, '""')}"`;
}

app.get('/api/admin/users', requireAuth, requireRole(['super_admin']), async (req, res) => {
  try {
    if (!dbAvailable) {
      return res.status(503).json({ success: false, message: 'Database unavailable.' });
    }

    const rolePlaceholders = visibleAdminRoles.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `SELECT u.id, u.full_name, u.email, u.phone, r.name AS role, u.created_at
       FROM users u
       INNER JOIN roles r ON r.id = u.role_id
       WHERE r.name IN (${rolePlaceholders})
       ORDER BY u.created_at DESC, u.id DESC`,
      visibleAdminRoles
    );

    return res.json({
      success: true,
      users: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        phone: row.phone,
        role: row.role,
        createdAt: row.created_at
      }))
    });
  } catch (error) {
    console.error('Admin users error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load staff accounts.' });
  }
});

app.post('/api/admin/users', requireAuth, requireRole(['super_admin']), async (req, res) => {
  if (!dbAvailable) {
    return res.status(503).json({ success: false, message: 'Database unavailable.' });
  }

  const fullName = sanitizeText(req.body?.fullName).slice(0, 128);
  const email = sanitizeText(req.body?.email).toLowerCase().slice(0, 150);
  const phone = sanitizeText(req.body?.phone).slice(0, 32);
  const nrcPassport = sanitizeText(req.body?.nrcPassport).slice(0, 64);
  const dateOfBirth = sanitizeText(req.body?.dateOfBirth);
  const address = sanitizeText(req.body?.address).slice(0, 255);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const role = sanitizeText(req.body?.role);

  if (!fullName || !email || !phone || !nrcPassport || !dateOfBirth || !address || !password || !role) {
    return res.status(400).json({ success: false, message: 'Complete all required staff account fields.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  }
  if (!isValidIsoDate(dateOfBirth)) {
    return res.status(400).json({ success: false, message: 'Enter a valid date of birth.' });
  }
  if (password.length < 12) {
    return res.status(400).json({ success: false, message: 'Staff passwords must be at least 12 characters.' });
  }
  if (!manageableStaffRoles.includes(role)) {
    return res.status(400).json({ success: false, message: 'Select a permitted staff role.' });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    const [roleRows] = await connection.execute('SELECT id FROM roles WHERE name = ? LIMIT 1', [role]);
    if (!roleRows[0]) {
      return res.status(400).json({ success: false, message: 'The selected role is not available.' });
    }

    const passwordHash = await argon2.hash(password);
    const [result] = await connection.execute(
      `INSERT INTO users (role_id, business_id, full_name, email, phone, nrc_passport, date_of_birth, address,
                          password_hash, profile_type, is_email_verified)
       VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, 'individual', 0)`,
      [roleRows[0].id, fullName, email, phone, nrcPassport, dateOfBirth, address, passwordHash]
    );

    return res.status(201).json({
      success: true,
      user: {
        id: result.insertId,
        fullName,
        email,
        phone,
        role
      },
      message: 'Staff account created. The user can sign in with their email and the password you set.'
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ success: false, message: 'An account with that email already exists.' });
    }
    console.error('Admin user creation error:', error);
    return res.status(500).json({ success: false, message: 'Unable to create the staff account.' });
  } finally {
    if (connection) connection.release();
  }
});

app.get('/api/admin/applications', requireAuth, requireRole(applicationAdminRoles), async (req, res) => {
  try {
    const parsed = parseApplicationFilters(req.query);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const requestedPage = Number.parseInt(req.query.page, 10);
    const requestedPageSize = Number.parseInt(req.query.pageSize, 10);
    const pagination = {
      page: Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
      pageSize: Number.isSafeInteger(requestedPageSize) && requestedPageSize > 0
        ? Math.min(requestedPageSize, 100)
        : 25
    };
    const result = await getAdminApplications(parsed.filters, pagination);

    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Admin applications error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load applications.' });
  }
});

app.get('/api/admin/applications/export.csv', requireAuth, requireRole(applicationAdminRoles), async (req, res) => {
  try {
    const parsed = parseApplicationFilters(req.query);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: parsed.error });
    }
    const applications = await getAllAdminApplications(parsed.filters);
    const headers = [
      'Reference',
      'Customer type',
      'Customer name',
      'Company name',
      'Email',
      'Phone',
      'NRC number',
      'Product',
      'Insurer',
      'Loan amount (ZMW)',
      'Coverage amount (ZMW)',
      'Premium (ZMW)',
      'Duration (months)',
      'Age at application',
      'Status',
      'Submitted',
      'NRC uploaded'
    ];
    const rows = applications.map((application) => [
      application.applicationReference,
      application.customerType,
      application.customerName,
      application.companyName,
      application.customerEmail,
      application.phoneNumber,
      application.customerId,
      application.productType,
      application.insurerName,
      application.loanAmount,
      application.coverageAmount,
      application.premiumAmount,
      application.durationMonths,
      application.ageAtApplication,
      application.status,
      application.createdAt,
      application.hasNrcDocument ? 'Yes' : 'No'
    ]);
    const csv = [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mkca-applications-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(`\uFEFF${csv}`);
  } catch (error) {
    console.error('Admin applications export error:', error);
    return res.status(500).json({ success: false, message: 'Unable to export applications.' });
  }
});

app.get('/api/admin/applications/:reference/nrc', requireAuth, requireRole(applicationAdminRoles), async (req, res) => {
  try {
    let documentPath;
    if (dbAvailable) {
      const [rows] = await pool.execute(
        'SELECT document_path FROM loan_applications WHERE application_reference = ? LIMIT 1',
        [sanitizeText(req.params.reference)]
      );
      documentPath = rows[0]?.document_path;
    } else {
      const records = await loadJsonFile(loanApplicationsPath, []);
      documentPath = records.find((record) => record.applicationReference === req.params.reference)?.documentPath;
    }

    if (!documentPath) {
      return res.status(404).json({ success: false, message: 'NRC document not found.' });
    }

    const resolvedPath = path.resolve(__dirname, documentPath);
    if (!resolvedPath.startsWith(`${applicationDocumentsDir}${path.sep}`) || !fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'NRC document not found.' });
    }

    res.set('X-Content-Type-Options', 'nosniff');
    return res.download(resolvedPath, 'customer-nrc' + path.extname(resolvedPath));
  } catch (error) {
    console.error('Admin NRC download error:', error);
    return res.status(500).json({ success: false, message: 'Unable to retrieve NRC document.' });
  }
});

function sanitizeText(value) {
  return String(value || '').trim();
}

function formatZambianPhoneNumber(phoneNumber) {
  const cleaned = sanitizeText(phoneNumber).replace(/[^0-9+]/g, '');
  if (!cleaned) return '';

  if (cleaned.startsWith('+260')) {
    return cleaned;
  }

  if (cleaned.startsWith('260')) {
    return `+${cleaned}`;
  }

  if (cleaned.startsWith('0')) {
    return `+260${cleaned.slice(1)}`;
  }

  return `+260${cleaned}`;
}

function isValidZambianMobileNumber(phoneNumber) {
  const formatted = formatZambianPhoneNumber(phoneNumber);
  if (!formatted || !/^\+260(?:97|96|95|77|76|75|71|70|74|66|61|62|91|92)\d{7}$/.test(formatted)) {
    return false;
  }
  return true;
}

function createCertificateNumber() {
  const year = new Date().getFullYear();
  const sequence = String(Math.floor(Math.random() * 900000) + 100000);
  return `CERT-${year}-${sequence}`;
}

function createTransporter() {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    throw new Error('EMAIL_USER and EMAIL_PASS must be set in the .env file');
  }

  const port = Number(process.env.EMAIL_PORT || 465);
  const secure = String(process.env.EMAIL_SECURE || (port === 465)).toLowerCase() === 'true';
  const emailUser = process.env.EMAIL_USER.trim();
  const emailPass = process.env.EMAIL_PASS.replace(/[\s-]/g, '');

  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: emailUser,
      pass: emailPass
    }
  });
}

function getMailTransporter() {
  if (!mailTransporter) {
    mailTransporter = createTransporter();
  }

  return mailTransporter;
}

function getCertificateFilePath(certificateNumber) {
  const safeNumber = sanitizeText(certificateNumber).replace(/[^A-Z0-9-]/g, '');
  if (!/^CERT-\d{4}-\d{6}$/.test(safeNumber)) {
    return null;
  }
  return path.join(certificatesDir, `${safeNumber}.pdf`);
}

app.post('/api/checkout', async (req, res) => {
  try {
    const { amount, phoneNumber } = req.body || {};
    const numericAmount = Number(amount);
    const sanitizedPhone = sanitizeText(phoneNumber);

    if (!sanitizedPhone) {
      return res.status(400).json({ success: false, message: 'Phone number is required.' });
    }

    if (!isValidZambianMobileNumber(sanitizedPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is invalid. Use a valid Airtel, MTN, or Zamtel number in Zambia.'
      });
    }

    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be greater than zero.' });
    }

    const formattedPhone = formatZambianPhoneNumber(sanitizedPhone);
    const lipilaKey = process.env.LIPILA_API_KEY;
    const callbackUrl = process.env.LIPILA_CALLBACK_URL || `${BASE_URL}/payment/callback`;

    if (!lipilaKey) {
      return res.status(500).json({ success: false, message: 'Payment provider credentials are not configured.' });
    }

    const payload = {
      customerInfo: {
        firstName: 'Customer',
        lastName: 'User',
        phoneNumber: formattedPhone,
        city: 'Lusaka',
        country: 'ZM',
        email: 'billing@domain.com'
      },
      collectionRequest: {
        referenceId: `tx-${Date.now()}`,
        amount: numericAmount,
        accountNumber: formattedPhone,
        currency: 'ZMW',
        backUrl: callbackUrl
      }
    };

    const lipilaResponse = await axios.post('https://lipila.dev', payload, {
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        'x-api-key': lipilaKey,
        callbackUrl: callbackUrl
      },
      timeout: 30000
    });

    if (lipilaResponse && lipilaResponse.data) {
      return res.status(200).json({ success: true, data: lipilaResponse.data });
    }

    return res.status(500).json({ success: false, message: 'Lipila payment request failed.' });
  } catch (error) {
    console.error('Lipila checkout error details:', {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Payment gateway request failed.'
    });
  }
});

app.post('/api/create-payment-link', (req, res) => {
  try {
    const { linkType = 'static', name, quantity, redirectUrl, description } = req.body || {};
    const safeName = sanitizeText(name);
    const safeQuantity = Number(quantity);
    const safeRedirectUrl = sanitizeText(redirectUrl);
    const safeDescription = sanitizeText(description).slice(0, 100);

    if (!safeName) {
      return res.status(400).json({ success: false, message: 'Name is required.' });
    }

    if (!Number.isFinite(safeQuantity) || safeQuantity <= 0) {
      return res.status(400).json({ success: false, message: 'Quantity must be greater than zero.' });
    }

    const linkId = `lipila-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const generatedUrl = safeRedirectUrl || process.env.LIPILA_CALLBACK_URL || `${BASE_URL}/payment/callback?reference=${encodeURIComponent(linkId)}`;

    return res.status(200).json({
      success: true,
      message: 'Payment link created successfully.',
      data: {
        linkType,
        linkId,
        name: safeName,
        quantity: safeQuantity,
        redirectUrl: generatedUrl,
        description: safeDescription,
        paymentLink: `https://lipila.me/${linkId}`
      }
    });
  } catch (error) {
    console.error('Create payment link error:', error.message);
    return res.status(500).json({ success: false, message: 'Unable to create payment link.' });
  }
});

app.post('/api/webhook', async (req, res) => {
  try {
    const { status, referenceId } = req.body || {};
    const normalizedStatus = sanitizeText(status).toUpperCase();
    const normalizedReferenceId = sanitizeText(referenceId || 'unknown-reference');

    if (normalizedStatus === 'SUCCESSFUL') {
      console.log(`Lipila payment successful for referenceId ${normalizedReferenceId}. Order is paid.`);
      // TODO: update order/payment status in your database here.
    } else if (normalizedStatus === 'FAILED' || normalizedStatus === 'CANCELLED') {
      console.log(`Lipila payment issue for referenceId ${normalizedReferenceId}: ${normalizedStatus}`);
      // TODO: update order/payment status in your database here.
    } else {
      console.log(`Lipila webhook received status ${normalizedStatus || 'UNKNOWN'} for referenceId ${normalizedReferenceId}`);
    }
  } catch (error) {
    console.error('Webhook processing error:', error.message);
  } finally {
    res.sendStatus(200);
  }
});

app.post('/api/generate-certificate', async (req, res) => {
  try {
    const fullName = sanitizeText(req.body.customerName || req.body.fullName);
    const nrc = sanitizeText(req.body.nrc || req.body.customerNrc);
    const coverType = sanitizeText(req.body.coverType || req.body.insuranceType || req.body.product);
    const insuranceCompany = sanitizeText(req.body.insuranceCompany || req.body.insuranceIssuer || req.body.insurer);
    const premiumAmount = Number(req.body.premiumAmount || 0);
    const policyNumber = sanitizeText(req.body.policyNumber);

    if (!fullName) {
      return res.status(400).json({ success: false, message: 'Full name is required' });
    }
    if (!nrc) {
      return res.status(400).json({ success: false, message: 'NRC is required' });
    }
    if (!coverType) {
      return res.status(400).json({ success: false, message: 'Cover type is required' });
    }
    if (!insuranceCompany) {
      return res.status(400).json({ success: false, message: 'Insurance company is required' });
    }

    // Platform is restricted to Sanlam only.
    const normalizedCompany = normalizeSanlamName(sanitizeText(insuranceCompany));
    if (!companyLogos[normalizedCompany] || !['Sanlam Life Assurance', 'Sanlam Life Insurance'].includes(normalizedCompany)) {
      return res.status(400).json({ success: false, message: 'Only Sanlam Life Assurance is available on this platform' });
    }
    if (!policyNumber) {
      return res.status(400).json({ success: false, message: 'Policy number is required' });
    }

    const certificateNumber = createCertificateNumber();
    const fileName = `${certificateNumber}.pdf`;
    const filePath = path.join(certificatesDir, fileName);
    const issueDate = new Date();
    const startDate = issueDate.toLocaleDateString();
    const certificateIssueDate = issueDate.toLocaleDateString();
    // Only Sanlam templates are supported on this platform.
    const certificateTemplates = {
      'Sanlam Life Assurance': 'sanlam-certificate-template.png',
      'Sanlam Life Insurance': 'sanlam-certificate-template.png'
    };

    const templateFile = certificateTemplates[normalizedCompany] || 'sanlam-certificate-template.png';
    const templatePath = path.join(__dirname, templateFile);

    await new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50 });
      const stream = fs.createWriteStream(filePath);
      doc.pipe(stream);

      const pageWidth = doc.page.width;
      const pageHeight = doc.page.height;
      const contentWidth = pageWidth - 120;
      const marginX = 60;

      // If a full-page template image exists, use it as the background
      if (fs.existsSync(templatePath)) {
        try {
          doc.image(templatePath, 0, 0, { width: pageWidth, height: pageHeight });
        } catch (templateError) {
          console.warn(`Unable to load certificate template ${templatePath}: ${templateError.message}`);
        }
      }

      // Header
      doc.font('Helvetica-Bold').fontSize(26).fillColor('#0F4C81');
      doc.text('Certificate of Insurance', marginX, 120, { width: contentWidth, align: 'center' });
      doc.font('Helvetica').fontSize(12).fillColor('#6B7280');
      doc.text(insuranceCompany, marginX, 152, { width: contentWidth, align: 'center' });
      doc.font('Helvetica').fontSize(10).fillColor('#6B7280');
      doc.text(`Certificate Number: ${certificateNumber}`, marginX, 100);
      doc.text(`Issue Date: ${certificateIssueDate}`, marginX, 116);

      doc.save();
      doc.fillOpacity(0.96).rect(marginX, 190, contentWidth, 190).fill('#FFFFFF');
      doc.restore();
      doc.lineWidth(1).strokeColor('#CBD5E1').roundedRect(marginX, 190, contentWidth, 190, 10).stroke();

      let y = 210;
      const boxLeft = marginX + 18;
      const boxRight = pageWidth / 2 + 10;
      const fieldGap = 24;

      doc.font('Helvetica-Bold').fontSize(14).fillColor('#0F4C81');
      doc.text('Policy Holder', boxLeft, y);
      doc.text('Policy Details', boxRight, y);
      y += fieldGap;

      doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827');
      doc.text(fullName, boxLeft, y);
      doc.font('Helvetica').fontSize(12).fillColor('#374151');
      doc.text(`NRC: ${nrc}`, boxLeft, y + 22);
      doc.text(`Policy Number: ${policyNumber}`, boxRight, y);
      doc.text(`Cover Type: ${coverType}`, boxRight, y + 22);
      doc.text(`Start Date: ${startDate}`, boxRight, y + 44);

      y += 80;
      doc.font('Helvetica-Bold').fontSize(16).fillColor('#0F4C81');
      doc.text(`Premium Amount`, boxLeft, y);
      doc.font('Helvetica-Bold').fontSize(18).fillColor('#111827');
      doc.text(`ZMW ${premiumAmount.toLocaleString()}`, boxLeft, y + 24);

      doc.font('Helvetica').fontSize(11).fillColor('#475569');
      doc.text(
        'This certificate confirms that the insured policy is active as of the issue date shown above. Please retain this document for your records and refer to your policy terms for coverage details.',
        marginX,
        420,
        { width: contentWidth, align: 'justify', lineGap: 4 }
      );

      doc.moveTo(marginX, pageHeight - 130).lineTo(pageWidth - marginX, pageHeight - 130).lineWidth(0.5).strokeColor('#E2E8F0').stroke();
      doc.font('Helvetica').fontSize(10).fillColor('#6B7280');
      doc.text('MKCA Insurance Ltd. • Terms and conditions apply.', marginX, pageHeight - 110);
      doc.font('Helvetica-Bold').fontSize(12).fillColor('#111827');
      doc.text('Authorized Signature', pageWidth - marginX - 200, pageHeight - 100, { width: 200, align: 'center' });
      doc.text('_________________________', pageWidth - marginX - 200, pageHeight - 78, { width: 200, align: 'center' });

      doc.end();
      stream.on('finish', resolve);
      stream.on('error', reject);
    });

    return res.json({
      success: true,
      certificateNumber,
      downloadUrl: `/certificates/${encodeURIComponent(fileName)}`
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// Generate reference number
function generateReferenceNumber() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const random = String(Math.floor(Math.random() * 900000) + 100000);
  return `REF-${year}${month}${day}-${random}`;
}

// Save purchase record
app.post('/api/save-application', async (req, res) => {
  try {
    const {
      customerType,
      customerName,
      companyName,
      customerEmail,
      customerId,
      phoneNumber,
      productType,
      insurerName,
      loanAmount,
      coverageAmount,
      premiumPaid,
      durationMonths,
      age,
      nrcDocumentData
    } = req.body;

    const safeCustomerName = sanitizeText(customerName);
    const safeCustomerEmail = sanitizeText(customerEmail).toLowerCase();
    const safeCustomerId = sanitizeText(customerId);
    const normalizedPhone = formatZambianPhoneNumber(phoneNumber);
    const safeCustomerType = ['individual', 'company'].includes(customerType) ? customerType : 'individual';
    const numericCoverage = Number(coverageAmount);
    const numericPremium = Number(premiumPaid);
    const numericDuration = Number(durationMonths);

    if (!safeCustomerName || !/^\S+@\S+\.\S+$/.test(safeCustomerEmail) || !/^\d{6,9}\/\d{2}\/\d{1,2}$/.test(safeCustomerId) || !isValidZambianMobileNumber(normalizedPhone) || !productType || !insurerName || !Number.isFinite(numericCoverage) || numericCoverage < 1000 || !Number.isFinite(numericPremium) || numericPremium <= 0 || !Number.isInteger(numericDuration) || numericDuration <= 0) {
      return res.status(400).json({ success: false, message: 'Customer application details are incomplete' });
    }

    if (safeCustomerType === 'company' && !sanitizeText(companyName)) {
      return res.status(400).json({ success: false, message: 'Company name is required for company applications.' });
    }

    const nrcMatch = /^data:(application\/pdf|image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(nrcDocumentData || ''));
    if (!nrcMatch) {
      return res.status(400).json({ success: false, message: 'Upload the NRC as a PDF, PNG, or JPEG file.' });
    }

    const nrcBuffer = Buffer.from(nrcMatch[2], 'base64');
    const nrcMimeType = nrcMatch[1];
    const maxNrcBytes = 5 * 1024 * 1024;
    const validNrcSignature = nrcMimeType === 'application/pdf'
      ? nrcBuffer.subarray(0, 5).toString() === '%PDF-'
      : nrcMimeType === 'image/png'
        ? nrcBuffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : nrcBuffer.length >= 3 && nrcBuffer[0] === 255 && nrcBuffer[1] === 216 && nrcBuffer[2] === 255;

    if (nrcBuffer.length === 0 || nrcBuffer.length > maxNrcBytes || !validNrcSignature) {
      return res.status(400).json({ success: false, message: 'NRC file is invalid or exceeds the 5 MB limit.' });
    }

    const normalizedInsurerName = normalizeSanlamName(sanitizeText(insurerName));
    if (normalizedInsurerName !== 'Sanlam Life Assurance') {
      return res.status(400).json({ success: false, message: 'Only Sanlam Life Assurance is available on this platform' });
    }

    const applicationReference = generateApplicationReference();
    const extension = nrcMimeType === 'application/pdf' ? '.pdf' : nrcMimeType === 'image/png' ? '.png' : '.jpg';
    const storedFileName = `${crypto.randomBytes(16).toString('hex')}${extension}`;
    await fsPromises.mkdir(applicationDocumentsDir, { recursive: true });
    await fsPromises.writeFile(path.join(applicationDocumentsDir, storedFileName), nrcBuffer, { flag: 'wx' });
    const storedDocumentPath = path.join('data', 'application-documents', storedFileName);
    const applicationRecord = {
      applicationReference,
      customerType: safeCustomerType,
      customerName: safeCustomerName,
      companyName: companyName ? sanitizeText(companyName) : null,
      customerEmail: safeCustomerEmail,
      customerId: safeCustomerId,
      phoneNumber: normalizedPhone,
      productType: sanitizeText(productType),
      insurerName: normalizedInsurerName,
      loanAmount: Number(loanAmount || numericCoverage),
      coverageAmount: numericCoverage,
      premiumAmount: numericPremium,
      durationMonths: numericDuration,
      ageAtApplication: Number(age || 35),
      nrcUploaded: true,
      documentPath: storedDocumentPath,
      status: 'submitted',
      createdAt: new Date().toISOString()
    };

    if (dbAvailable) {
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.execute(
          `INSERT INTO loan_applications (
            application_reference, customer_name, customer_email, phone_number, nrc_number,
            customer_type, company_name, product_type, insurer_name, loan_amount, coverage_amount,
            premium_amount, duration_months, age_at_application, nrc_uploaded, document_path, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            applicationReference,
            applicationRecord.customerName,
            applicationRecord.customerEmail,
            applicationRecord.phoneNumber,
            applicationRecord.customerId,
            safeCustomerType,
            applicationRecord.companyName,
            applicationRecord.productType,
            normalizedInsurerName,
            applicationRecord.loanAmount,
            applicationRecord.coverageAmount,
            applicationRecord.premiumAmount,
            applicationRecord.durationMonths,
            applicationRecord.ageAtApplication,
            applicationRecord.nrcUploaded ? 1 : 0,
            applicationRecord.documentPath,
            'submitted'
          ]
        );

        return res.json({ success: true, applicationReference, message: 'Application stored successfully.' });
      } catch (error) {
        console.error('Error saving application to database:', error);
        dbAvailable = false;
      } finally {
        if (connection) connection.release();
      }
    }

    const records = await loadJsonFile(loanApplicationsPath, []);
    records.push(applicationRecord);
    await saveJsonFile(loanApplicationsPath, records);
    return res.json({ success: true, applicationReference, message: 'Application saved locally.' });
  } catch (error) {
    console.error('Error saving application:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to save application' });
  }
});

app.post('/api/create-policy', async (req, res) => {
  try {
    const {
      applicationReference,
      customerName,
      customerEmail,
      customerId,
      productType,
      insurerName,
      coverageAmount,
      premiumPaid,
      durationMonths,
      age,
      loanAmount
    } = req.body;

    if (!applicationReference && (!customerName || !customerEmail || !customerId)) {
      return res.status(400).json({ success: false, message: 'Application reference or customer details are required.' });
    }

    const normalizedInsurerName = normalizeSanlamName(sanitizeText(insurerName || 'Sanlam Life Assurance'));
    const policyNumber = `MKCA-${Date.now()}`;
    const issueDate = new Date();
    const expiryDate = new Date(issueDate.getFullYear(), issueDate.getMonth() + 1, issueDate.getDate());

    let userId = await ensureDefaultCustomerUser();

    if (dbAvailable) {
      let connection;
      try {
        connection = await pool.getConnection();
        const [productRows] = await connection.execute('SELECT id FROM insurance_products WHERE code = ? LIMIT 1', ['LOAN_PROTECTION']);
        const productId = productRows[0]?.id || 1;

        await connection.execute(
          `INSERT INTO policies (
            policy_number, user_id, business_id, product_id, loan_amount, coverage_amount,
            premium_amount, policy_fee, total_payable, issue_date, expiry_date, cover_type,
            insurer_name, age_at_application, status
          ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            policyNumber,
            userId || 1,
            productId,
            Number(loanAmount || coverageAmount || 0),
            Number(coverageAmount || 0),
            Number(premiumPaid || 0),
            Math.round((Number(premiumPaid || 0)) * 0.02),
            Number(premiumPaid || 0),
            issueDate.toISOString().slice(0, 10),
            expiryDate.toISOString().slice(0, 10),
            'death_only',
            normalizedInsurerName,
            Number(age || 35),
            'active'
          ]
        );

        if (applicationReference) {
          await connection.execute('UPDATE loan_applications SET status = ? WHERE application_reference = ?', ['approved', applicationReference]);
        }

        return res.json({ success: true, policyNumber, message: 'Policy created successfully.' });
      } catch (error) {
        console.error('Error creating policy in database:', error);
        dbAvailable = false;
      } finally {
        if (connection) connection.release();
      }
    }

    const policies = await loadJsonFile(policyRecordsPath, []);
    policies.push({
      policyNumber,
      customerName: sanitizeText(customerName),
      customerEmail: sanitizeText(customerEmail),
      customerId: sanitizeText(customerId),
      productType: sanitizeText(productType || 'Loan Protection'),
      insurerName: normalizedInsurerName,
      coverageAmount: Number(coverageAmount || 0),
      premiumPaid: Number(premiumPaid || 0),
      durationMonths: Number(durationMonths || 1),
      ageAtApplication: Number(age || 35),
      loanAmount: Number(loanAmount || coverageAmount || 0),
      issueDate: issueDate.toISOString(),
      expiryDate: expiryDate.toISOString(),
      status: 'active'
    });
    await saveJsonFile(policyRecordsPath, policies);

    return res.json({ success: true, policyNumber, message: 'Policy saved locally.' });
  } catch (error) {
    console.error('Error creating policy:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to create policy' });
  }
});

app.post('/api/upload-claim-document', async (req, res) => {
  try {
    const {
      claimReference,
      policyNumber,
      documentType,
      fileName,
      fileData,
      mimeType
    } = req.body;

    const safeClaimReference = sanitizeText(claimReference || policyNumber || 'CLAIM-DEFAULT');
    const safeDocumentType = sanitizeText(documentType || 'nrc');
    const safeFileName = sanitizeText(fileName || 'nrc-document.pdf');
    const base64Data = sanitizeText(fileData || '');
    const normalizedMimeType = sanitizeText(mimeType || 'application/pdf');

    if (!base64Data) {
      return res.status(400).json({ success: false, message: 'Document data is required.' });
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const documentsDir = path.join(__dirname, 'data', 'claim-documents');
    await fsPromises.mkdir(documentsDir, { recursive: true });

    const fileSlug = `${Date.now()}-${safeFileName.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
    const filePath = path.join(documentsDir, fileSlug);
    await fsPromises.writeFile(filePath, buffer);

    let claimId = null;
    if (dbAvailable) {
      let connection;
      try {
        connection = await pool.getConnection();
        const [claimRows] = await connection.execute('SELECT id FROM claims WHERE claim_reference = ? LIMIT 1', [safeClaimReference]);

        if (!claimRows[0]?.id) {
          const userId = await ensureDefaultCustomerUser();
          await connection.execute(
            `INSERT INTO claims (policy_id, user_id, claim_reference, claim_type, status, amount_requested, amount_paid)
             VALUES (NULL, ?, ?, ?, 'documents_uploaded', 0, 0)`,
            [userId || 1, safeClaimReference, safeDocumentType === 'death_certificate' ? 'death' : 'death']
          );
          const [newClaimRows] = await connection.execute('SELECT id FROM claims WHERE claim_reference = ? LIMIT 1', [safeClaimReference]);
          claimId = newClaimRows[0]?.id;
        } else {
          claimId = claimRows[0].id;
        }

        await connection.execute(
          `INSERT INTO claim_documents (claim_id, document_type, file_name, file_path, file_type, file_size)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [claimId, safeDocumentType, safeFileName, filePath, normalizedMimeType, buffer.length]
        );
      } catch (error) {
        console.error('Error saving claim document to database:', error);
        dbAvailable = false;
      } finally {
        if (connection) connection.release();
      }
    }

    const records = await loadJsonFile(claimDocumentsPath, []);
    records.push({
      claimReference: safeClaimReference,
      documentType: safeDocumentType,
      fileName: safeFileName,
      filePath,
      mimeType: normalizedMimeType,
      size: buffer.length,
      createdAt: new Date().toISOString()
    });
    await saveJsonFile(claimDocumentsPath, records);

    return res.json({
      success: true,
      claimReference: safeClaimReference,
      documentType: safeDocumentType,
      fileName: safeFileName,
      savedPath: filePath,
      message: 'Claim document saved successfully.'
    });
  } catch (error) {
    console.error('Error uploading claim document:', error);
    return res.status(500).json({ success: false, message: error.message || 'Unable to upload claim document' });
  }
});

app.post('/api/save-purchase', async (req, res) => {
  try {
    const {
      customerType,
      customerName,
      companyName,
      customerEmail,
      customerId,
      phoneNumber,
      productType,
      insurerName,
      coverageAmount,
      premiumPaid,
      durationMonths
    } = req.body;

    if (!dbAvailable) {
      return res.status(503).json({
        success: false,
        message: 'MySQL is required and is currently unavailable. Please start the database service.'
      });
    }

    // Validate required fields
    if (!customerType || !customerName || !customerEmail || !customerId || !phoneNumber || !productType || 
        !insurerName || !coverageAmount || !premiumPaid || !durationMonths) {
      return res.status(400).json({ 
        success: false, 
        message: 'All customer and purchase information is required' 
      });
    }

    // Validate customer type
    if (!['individual', 'company'].includes(customerType)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid customer type' 
      });
    }

    const normalizedInsurerName = normalizeSanlamName(sanitizeText(insurerName));
    if (normalizedInsurerName !== 'Sanlam Life Assurance') {
      return res.status(400).json({
        success: false,
        message: 'Only Sanlam Life Assurance is available on this platform'
      });
    }

    // Validate company name if customer type is company
    if (customerType === 'company' && !companyName) {
      return res.status(400).json({ 
        success: false, 
        message: 'Company name is required for company purchases' 
      });
    }

    const referenceNumber = generateReferenceNumber();

    if (dbAvailable) {
      let connection;
      try {
        connection = await pool.getConnection();
        await connection.execute(
          `INSERT INTO purchase_records 
           (reference_number, customer_type, customer_name, company_name, customer_email, customer_id, phone_number, 
            product_type, insurer_name, coverage_amount, premium_paid, duration_months) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            referenceNumber,
            customerType,
            sanitizeText(customerName),
            companyName ? sanitizeText(companyName) : null,
            sanitizeText(customerEmail),
            sanitizeText(customerId),
            sanitizeText(phoneNumber),
            sanitizeText(productType),
            sanitizeText(insurerName),
            Number(coverageAmount),
            Number(premiumPaid),
            Number(durationMonths)
          ]
        );

        return res.json({
          success: true,
          referenceNumber,
          message: 'Purchase record saved successfully'
        });
      } catch (error) {
        console.error('Error saving purchase record to database:', error);
        dbAvailable = false;
      } finally {
        if (connection) {
          connection.release();
        }
      }
    }

    try {
      const record = {
        referenceNumber,
        customerType,
        customerName: sanitizeText(customerName),
        companyName: companyName ? sanitizeText(companyName) : null,
        customerEmail: sanitizeText(customerEmail),
        customerId: sanitizeText(customerId),
        phoneNumber: sanitizeText(phoneNumber),
        productType: sanitizeText(productType),
        insurerName: sanitizeText(insurerName),
        coverageAmount: Number(coverageAmount),
        premiumPaid: Number(premiumPaid),
        durationMonths: Number(durationMonths),
        savedAt: new Date().toISOString(),
        savedWith: dbAvailable ? 'database' : 'local-fallback'
      };
      await saveLocalPurchaseRecord(record);

      return res.json({
        success: true,
        referenceNumber,
        message: 'Purchase record saved locally because the database was unavailable.'
      });
    } catch (error) {
      console.error('Error saving purchase record locally:', error);
      const errorMessage = error?.message || (Array.isArray(error?.errors) ? error.errors.map((err) => err.message).join('; ') : String(error));
      return res.status(500).json({ 
        success: false, 
        message: 'Failed to save purchase record: ' + errorMessage 
      });
    }
  } catch (error) {
    console.error('Error saving purchase record:', error);
    const errorMessage = error?.message || (Array.isArray(error?.errors) ? error.errors.map((err) => err.message).join('; ') : String(error));
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to save purchase record: ' + errorMessage 
    });
  }
});

app.post('/api/send-email', async (req, res) => {
  try {
    const recipientEmail = sanitizeText(req.body.recipientEmail);
    const customerName = sanitizeText(req.body.customerName);
    const premiumAmount = Number(req.body.premiumAmount || 0);
    const referenceNumber = sanitizeText(req.body.referenceNumber);
    const productType = sanitizeText(req.body.productType);
    const insurerName = sanitizeText(req.body.insurerName);

    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'Recipient email is required' });
    }
    if (!customerName) {
      return res.status(400).json({ success: false, message: 'Customer name is required' });
    }
    if (!referenceNumber) {
      return res.status(400).json({ success: false, message: 'Reference number is required' });
    }

    const transporter = getMailTransporter();
    const fromAddress = process.env.EMAIL_FROM || process.env.EMAIL_USER;
    const fromName = process.env.EMAIL_FROM_NAME || 'MKCA Insurance';
    await transporter.sendMail({
      from: `"${fromName}" <${fromAddress}>`,
      to: recipientEmail,
      subject: 'MKCA Insurance Payment Confirmation',
      text: `Dear ${customerName},\n\nThank you for your payment. Your purchase reference number is ${referenceNumber}.\nProduct: ${productType || 'Insurance'}\nInsurer: ${insurerName || 'MKCA Insurance'}\nPremium amount paid: ZMW ${premiumAmount.toLocaleString()}\n\nPlease keep this reference number for your records.\n\nRegards,\nMKCA Insurance`,
      html: `<p>Dear ${customerName},</p>
             <p>Thank you for your payment. Your purchase reference number is <strong>${referenceNumber}</strong>.</p>
             <p>Product: <strong>${productType || 'Insurance'}</strong><br />
             Insurer: <strong>${insurerName || 'MKCA Insurance'}</strong><br />
             Premium amount paid: <strong>ZMW ${premiumAmount.toLocaleString()}</strong></p>
             <p>Please keep this reference number for your records.</p>
             <p>Regards,<br/>MKCA Insurance</p>`
    });

    return res.json({ success: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Server is running' });
});

async function startServer() {
  try {
    await ensureDatabaseIsReady();
    await ensureDefaultAdminAccount();
    app.listen(PORT, () => {
      console.log(`Server is running on ${BASE_URL}`);
    });
  } catch (error) {
    console.error('Failed to start app:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  pool,
  ensureDatabaseIsReady,
  sanitizeText,
  formatZambianPhoneNumber,
  isValidZambianMobileNumber
};
