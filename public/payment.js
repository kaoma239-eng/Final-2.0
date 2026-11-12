const paymentForm = document.getElementById('paymentForm');
const message = document.getElementById('message');
const downloadSection = document.getElementById('downloadSection');
const downloadLink = document.getElementById('downloadLink');

const fields = {
  customerName: document.getElementById('customerName'),
  customerNrc: document.getElementById('customerNrc'),
  recipientEmail: document.getElementById('recipientEmail'),
  insuranceType: document.getElementById('insuranceType'),
  policyNumber: document.getElementById('policyNumber'),
  premiumAmount: document.getElementById('premiumAmount'),
  insuranceIssuer: document.getElementById('insuranceIssuer'),
  coverageAmount: document.getElementById('coverageAmount'),
  duration: document.getElementById('duration')
};

const API_BASE_URLS = window.location.protocol === 'file:'
  ? ['http://localhost:3000', 'http://127.0.0.1:3000']
  : [window.location.origin, 'http://localhost:3000', 'http://127.0.0.1:3000'];

function getQueryParam(name) {
  return new URLSearchParams(window.location.search).get(name) || '';
}

function setMessage(text, type = 'info') {
  message.textContent = text;
  message.className = '';
  message.classList.add('rounded-2xl', 'p-5', 'mb-6');

  if (type === 'success') {
    message.classList.add('bg-emerald-50', 'text-emerald-800');
  } else if (type === 'error') {
    message.classList.add('bg-red-50', 'text-red-800');
  } else {
    message.classList.add('bg-slate-50', 'text-slate-900');
  }

  message.classList.remove('hidden');
}

function clearMessage() {
  message.textContent = '';
  message.classList.add('hidden');
}

function generatePolicyNumber() {
  return `MKCA-${Date.now()}`;
}

function initializeForm() {
  const customerEmail = getQueryParam('email');
  const product = 'Loan Protection';
  const insurerDisplay = getQueryParam('insuranceType') || getQueryParam('insurer') || 'Sanlam Life Insurance';
  const coverage = getQueryParam('coverage') || '0';
  const duration = '1';
  const amount = getQueryParam('amount') || '0';
  const policyNumber = generatePolicyNumber();

  fields.recipientEmail.value = customerEmail;
  fields.insuranceType.value = product;
  fields.insuranceIssuer.value = insurerDisplay;
  fields.coverageAmount.value = coverage ? `ZMW ${Number(coverage).toLocaleString()}` : 'N/A';
  fields.duration.value = `${duration} month`;
  fields.premiumAmount.value = amount ? `ZMW ${Number(amount).toLocaleString()}` : 'N/A';
  fields.policyNumber.value = policyNumber;
}

async function postJson(url, data) {
  let lastError;

  for (const baseUrl of API_BASE_URLS) {
    try {
      const response = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      console.warn(`API request failed for ${baseUrl}${url}:`, error);
    }
  }

  throw lastError;
}

async function handlePayment(event) {
  event.preventDefault();
  clearMessage();
  downloadSection.classList.add('hidden');
  downloadLink.href = '#';

  const customerName = fields.customerName.value.trim();
  const customerNrc = fields.customerNrc.value.trim();
  const recipientEmail = fields.recipientEmail.value.trim();
  const insuranceType = fields.insuranceType.value.trim();
  const policyNumber = fields.policyNumber.value.trim();
  const premiumAmount = fields.premiumAmount.value.replace(/[^0-9.]/g, '').trim();
  const insuranceCompany = fields.insuranceIssuer.value.trim();

  if (!customerName || !recipientEmail) {
    setMessage('Please enter both customer name and email address.', 'error');
    return;
  }

  paymentForm.querySelector('button[type="submit"]').disabled = true;
  setMessage('Processing payment and generating certificate...', 'info');

  try {
    const saveResponse = await postJson('/api/save-purchase', {
      customerType: 'individual',
      customerName,
      companyName: null,
      customerId: customerNrc,
      customerEmail: recipientEmail,
      phoneNumber: '',
      productType: insuranceType,
      insurerName: insuranceCompany,
      coverageAmount: premiumAmount || '0',
      premiumPaid: premiumAmount || '0',
      durationMonths: 1
    });

    if (!saveResponse.success) {
      throw new Error(saveResponse.message || 'Payment save failed.');
    }

    let emailWarning = '';
    try {
      const emailResponse = await postJson('/api/send-email', {
        recipientEmail,
        customerName,
        premiumAmount: Number(premiumAmount) || 0,
        referenceNumber: saveResponse.referenceNumber,
        productType: insuranceType,
        insurerName: insuranceCompany
      });

      if (!emailResponse.success) {
        emailWarning = emailResponse.message || 'Email sending failed.';
      }
    } catch (emailError) {
      emailWarning = emailError.message || 'Email sending failed.';
      console.warn('Email delivery failed, but payment was saved:', emailError);
    }

    const successMessage = emailWarning
      ? `Payment completed successfully. Your reference number is ${saveResponse.referenceNumber}. Email delivery failed: ${emailWarning}`
      : `Payment completed successfully. Your reference number is ${saveResponse.referenceNumber}. A confirmation email has been sent.`;

    setMessage(successMessage, emailWarning ? 'info' : 'success');
  } catch (error) {
    setMessage(`Error: ${error.message}`, 'error');
  } finally {
    paymentForm.querySelector('button[type="submit"]').disabled = false;
  }
}

initializeForm();
paymentForm.addEventListener('submit', handlePayment);
