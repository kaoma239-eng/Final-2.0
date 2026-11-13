const allowedRoles = ['super_admin', 'administrator', 'insurance_officer', 'claims_officer', 'finance_officer'];
const loginPanel = document.getElementById('loginPanel');
const dashboardPanel = document.getElementById('dashboardPanel');
const adminToolbar = document.getElementById('adminToolbar');
const notice = document.getElementById('notice');
const applicationsBody = document.getElementById('applicationsBody');
const staffUsersBody = document.getElementById('staffUsersBody');
const ADMIN_IDLE_TIMEOUT_MS = 30_000;
const SESSION_HEARTBEAT_INTERVAL_MS = 10_000;
const SESSION_HEARTBEAT_ACTIVITY_WINDOW_MS = 20_000;
let currentPage = 1;
let currentPageSize = 25;
let idleTimeoutId = null;
let heartbeatIntervalId = null;
let lastUserActivityAt = 0;
let logoutInProgress = false;

function showNotice(message, type = 'error') {
  notice.textContent = message;
  notice.className = `notice ${type === 'success' ? 'notice-success' : 'notice-error'}`;
  notice.classList.remove('hidden');
}

function clearNotice() {
  notice.textContent = '';
  notice.classList.add('hidden');
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const error = new Error(`The admin API returned a non-JSON response (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }

  const result = await response.json();
  if (!response.ok || !result.success) {
    const error = new Error(result.message || 'The request could not be completed.');
    error.status = response.status;
    throw error;
  }
  return result;
}

async function signOut(message = '') {
  if (logoutInProgress) return;
  logoutInProgress = true;
  window.clearTimeout(idleTimeoutId);
  window.clearInterval(heartbeatIntervalId);

  let logoutError = null;
  try {
    await requestJson('/api/auth/logout', { method: 'POST' });
  } catch (error) {
    if (error.status !== 401) logoutError = error;
  }

  dashboardPanel.classList.add('hidden');
  adminToolbar.classList.add('hidden');
  loginPanel.classList.remove('hidden');
  document.getElementById('loginForm').reset();
  lastUserActivityAt = 0;
  logoutInProgress = false;

  if (logoutError) {
    showNotice(`Could not confirm server sign-out. ${logoutError.message}`);
  } else if (message) {
    showNotice(message, 'success');
  }
}

function resetIdleTimer() {
  if (logoutInProgress || dashboardPanel.classList.contains('hidden')) return;

  lastUserActivityAt = Date.now();
  window.clearTimeout(idleTimeoutId);
  idleTimeoutId = window.setTimeout(() => {
    signOut('Signed out after 30 seconds of inactivity.');
  }, ADMIN_IDLE_TIMEOUT_MS);
}

function startSessionHeartbeat() {
  window.clearInterval(heartbeatIntervalId);
  heartbeatIntervalId = window.setInterval(() => {
    if (logoutInProgress || dashboardPanel.classList.contains('hidden')) return;

    const idleDuration = Date.now() - lastUserActivityAt;
    if (idleDuration >= ADMIN_IDLE_TIMEOUT_MS) {
      signOut('Signed out after 30 seconds of inactivity.');
      return;
    }

    if (idleDuration >= SESSION_HEARTBEAT_ACTIVITY_WINDOW_MS) return;
    requestJson('/api/auth/me').catch((error) => {
      if (error.status === 401) {
        signOut('Your admin session expired. Please sign in again.');
        return;
      }
      showNotice(`Unable to refresh your admin session. ${error.message}`);
    });
  }, SESSION_HEARTBEAT_INTERVAL_MS);
}

function formatMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `ZMW ${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '-';
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function addCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = value == null || value === '' ? '-' : String(value);
  row.appendChild(cell);
  return cell;
}

function getFilterParams() {
  return new URLSearchParams({
    search: document.getElementById('searchFilter').value.trim(),
    status: document.getElementById('statusFilter').value,
    from: document.getElementById('fromDate').value,
    to: document.getElementById('toDate').value
  });
}

async function loadOverview() {
  const { summary } = await requestJson('/api/admin/overview');
  document.getElementById('metricApplications').textContent = Number(summary.applications || 0).toLocaleString();
  document.getElementById('metricPolicies').textContent = Number(summary.policies || 0).toLocaleString();
  document.getElementById('metricClaims').textContent = Number(summary.claims || 0).toLocaleString();
  document.getElementById('metricPremiums').textContent = formatMoney(summary.recordedPremiums);
  document.getElementById('metricPremiumCount').textContent =
    `${Number(summary.purchaseRecords || 0).toLocaleString()} purchase records`;
}

function renderApplications(result) {
  applicationsBody.replaceChildren();
  const applications = result.applications || [];
  const total = Number(result.total || 0);
  const page = Number(result.page || 1);
  const pageSize = Number(result.pageSize || currentPageSize);
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  document.getElementById('applicationCount').textContent = `Showing ${start}-${end} of ${total.toLocaleString()}`;
  document.getElementById('pageInfo').textContent = `Page ${page} of ${Number(result.totalPages || 1)}`;
  document.getElementById('previousPage').disabled = page <= 1;
  document.getElementById('nextPage').disabled = page >= Number(result.totalPages || 1);
  document.getElementById('emptyState').classList.toggle('hidden', applications.length > 0);

  applications.forEach((application) => {
    const row = document.createElement('tr');
    addCell(row, application.applicationReference);

    const customer = addCell(row, application.customerName);
    if (application.companyName) {
      const company = document.createElement('span');
      company.className = 'subtext';
      company.textContent = application.companyName;
      customer.appendChild(company);
    }

    addCell(row, application.customerId);
    addCell(row, application.phoneNumber);
    addCell(row, application.customerEmail);
    addCell(row, application.productType);
    addCell(row, formatMoney(application.loanAmount));
    addCell(row, formatMoney(application.coverageAmount));
    addCell(row, formatMoney(application.premiumAmount));
    addCell(row, formatDate(application.createdAt));

    const statusCell = addCell(row, '');
    statusCell.textContent = '';
    const status = String(application.status || 'unknown');
    const badge = document.createElement('span');
    badge.className = `status-badge status-${status.toLowerCase().replace(/[^a-z0-9-]/g, '')}`;
    badge.textContent = status.replace(/_/g, ' ');
    statusCell.appendChild(badge);

    const documentCell = addCell(row, '');
    documentCell.textContent = '';
    if (application.hasNrcDocument) {
      const link = document.createElement('a');
      link.href = `/api/admin/applications/${encodeURIComponent(application.applicationReference)}/nrc`;
      link.textContent = 'Download';
      link.className = 'text-link';
      link.setAttribute('aria-label', `Download NRC for ${application.applicationReference}`);
      documentCell.appendChild(link);
    } else {
      documentCell.textContent = 'Not uploaded';
    }
    applicationsBody.appendChild(row);
  });
}

async function loadApplications(page = 1) {
  currentPage = page;
  currentPageSize = Number(document.getElementById('pageSize').value) || 25;
  const params = getFilterParams();
  params.set('page', String(currentPage));
  params.set('pageSize', String(currentPageSize));
  const result = await requestJson(`/api/admin/applications?${params.toString()}`);
  currentPage = Number(result.page || 1);
  renderApplications(result);
}

async function downloadApplications() {
  const button = document.getElementById('downloadCsv');
  button.disabled = true;
  try {
    const params = getFilterParams();
    const response = await fetch(`/api/admin/applications/export.csv?${params.toString()}`, {
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') || '';
      const result = contentType.includes('application/json') ? await response.json() : null;
      throw new Error(result?.message || `Export failed (HTTP ${response.status}).`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mkca-applications-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } finally {
    button.disabled = false;
  }
}

async function loadStaffAccounts() {
  const result = await requestJson('/api/admin/users');
  staffUsersBody.replaceChildren();
  document.getElementById('staffEmptyState').classList.toggle('hidden', result.users.length > 0);

  result.users.forEach((user) => {
    const row = document.createElement('tr');
    addCell(row, user.fullName);
    addCell(row, user.email);
    addCell(row, user.phone);
    addCell(row, user.role.replace(/_/g, ' '));
    addCell(row, formatDate(user.createdAt));
    staffUsersBody.appendChild(row);
  });
}

async function acceptUser(user) {
  if (!user || !allowedRoles.includes(user.role)) {
    throw new Error('This account does not have permission to access the admin dashboard.');
  }

  document.getElementById('adminName').textContent = user.fullName || user.email;
  loginPanel.classList.add('hidden');
  dashboardPanel.classList.remove('hidden');
  adminToolbar.classList.remove('hidden');
  lastUserActivityAt = Date.now();
  resetIdleTimer();
  startSessionHeartbeat();

  const staffPanel = document.getElementById('staffPanel');
  staffPanel.classList.toggle('hidden', user.role !== 'super_admin');

  const results = await Promise.allSettled([loadOverview(), loadApplications(1)]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) showNotice(failed.reason.message || 'Unable to load dashboard data.');

  if (user.role === 'super_admin') {
    try {
      await loadStaffAccounts();
    } catch (error) {
      showNotice(error.message);
    }
  }
}

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('loginButton');
  button.disabled = true;
  clearNotice();

  try {
    const result = await requestJson('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value
      })
    });
    await acceptUser(result.user);
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('filtersForm').addEventListener('submit', (event) => {
  event.preventDefault();
  loadApplications(1).catch((error) => showNotice(error.message));
});

document.getElementById('clearFilters').addEventListener('click', () => {
  document.getElementById('filtersForm').reset();
  document.getElementById('pageSize').value = '25';
  loadApplications(1).catch((error) => showNotice(error.message));
});

document.getElementById('pageSize').addEventListener('change', () => {
  loadApplications(1).catch((error) => showNotice(error.message));
});

document.getElementById('previousPage').addEventListener('click', () => {
  if (currentPage > 1) loadApplications(currentPage - 1).catch((error) => showNotice(error.message));
});

document.getElementById('nextPage').addEventListener('click', () => {
  loadApplications(currentPage + 1).catch((error) => showNotice(error.message));
});

document.getElementById('downloadCsv').addEventListener('click', () => {
  downloadApplications().catch((error) => showNotice(error.message));
});

document.getElementById('refreshDashboard').addEventListener('click', async () => {
  clearNotice();
  const results = await Promise.allSettled([loadOverview(), loadApplications(currentPage)]);
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) showNotice(failed.reason.message || 'Unable to refresh dashboard data.');
  if (document.getElementById('staffPanel').classList.contains('hidden') === false) {
    try {
      await loadStaffAccounts();
    } catch (error) {
      showNotice(error.message);
    }
  }
});

document.getElementById('staffForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = document.getElementById('createStaffButton');
  button.disabled = true;
  clearNotice();

  try {
    const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    const result = await requestJson('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    event.currentTarget.reset();
    showNotice(result.message, 'success');
    try {
      await loadStaffAccounts();
    } catch (error) {
      showNotice(`Account created, but the staff list could not be refreshed. ${error.message}`);
    }
  } catch (error) {
    showNotice(error.message);
  } finally {
    button.disabled = false;
  }
});

document.getElementById('logoutButton').addEventListener('click', () => {
  signOut();
});

['pointerdown', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((eventName) => {
  document.addEventListener(eventName, resetIdleTimer, { passive: true });
});

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !dashboardPanel.classList.contains('hidden')) {
    if (Date.now() - lastUserActivityAt >= ADMIN_IDLE_TIMEOUT_MS) {
      signOut('Signed out after 30 seconds of inactivity.');
      return;
    }
    resetIdleTimer();
  }
});

requestJson('/api/auth/me')
  .then((result) => acceptUser(result.user))
  .catch((error) => {
    loginPanel.classList.remove('hidden');
    if (error.status !== 401) showNotice(error.message);
  });
