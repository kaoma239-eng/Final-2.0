// MKCA Insurance Premium Calculator
// Insurer multipliers for baseline premiums

const insurers = {
  sanlam: { name: 'Sanlam Life Assurance', multiplier: 1.00 }
};

const baseRates = {
  life: 0.0015,
  salary: 0.0012,
  p2p: 0.0014
};

const loanInsurerRates = {
  sanlam: 0.03
};

const productNames = {
  life: 'Loan Protection',
  salary: 'Salary Advance',
  p2p: 'P2P Lending'
};

/**
 * Calculate monthly premium based on parameters
 * @param {Object} params - Premium calculation parameters
 * @param {string} params.product - Product type (life, salary, p2p)
 * @param {string} params.insurer - Insurer code
 * @param {number} params.age - Age of applicant
 * @param {string} params.gender - Gender (male, female)
 * @param {number} params.coverage - Coverage amount in ZMW
 * @param {number} params.duration - Loan/coverage duration in months
 * @returns {Object} Premium calculation results
 */
function calculatePremium(params) {
  const {
    product = 'life',
    insurer = 'sanlam',
    age = 35,
    gender = 'male',
    coverage = 100000,
    duration = 24
  } = params;

  if (product === 'life' || product === 'salary' || product === 'p2p') {
    // Loan protection pays the outstanding balance if the borrower dies.
    const loanRate = loanInsurerRates[insurer] || 0.03;
    const ageFactor = 1 + Math.max(0, (age - 20) * 0.015);
    const monthlyPremium = Math.round(coverage * loanRate * ageFactor);
    const totalCost = Math.round(monthlyPremium * Math.max(1, duration));
    const policyFee = Math.round(totalCost * 0.02); // 2% policy fee

    return {
      monthlyPremium,
      totalCost,
      policyFee,
      totalWithFee: Math.round(totalCost + policyFee),
      coverageValue: coverage,
      duration,
      insurer: insurers[insurer]?.name || 'Sanlam Life Assurance',
      product: productNames[product] || 'Loan Protection'
    };
  }

  return {
    monthlyPremium: 0,
    totalCost: 0,
    policyFee: 0,
    totalWithFee: 0,
    coverageValue: coverage,
    duration,
    insurer: insurers[insurer]?.name || 'Sanlam Life Assurance',
    product: productNames[product] || 'Loan Protection'
  };
}

/**
 * Format ZMW currency
 * @param {number} value - Value to format
 * @returns {string} Formatted currency string
 */
function formatCurrency(value) {
  return 'ZMW ' + Math.round(value).toLocaleString();
}

/**
 * Get all insurers
 * @returns {Object} Insurers object
 */
function getInsurers() {
  return insurers;
}

/**
 * Get all products
 * @returns {Object} Products object
 */
function getProducts() {
  return productNames;
}

/**
 * Get base rates
 * @returns {Object} Base rates object
 */
function getBaseRates() {
  return baseRates;
}

/**
 * Validate premium parameters
 * @param {Object} params - Parameters to validate
 * @returns {Object} Validation result with errors array
 */
function validateParams(params) {
  const errors = [];

  if (!params.product || !productNames[params.product]) {
    errors.push('Invalid product selected');
  }

  if (!params.insurer || !insurers[params.insurer]) {
    errors.push('Invalid insurer selected');
  }

  if (params.age < 20 || params.age > 75) {
    errors.push('Age must be between 20 and 75');
  }

  if (!params.gender || !['male', 'female'].includes(params.gender)) {
    errors.push('Gender must be male or female');
  }

  if (params.coverage < 1000 || params.coverage > 5000000) {
    errors.push('Coverage amount must be between ZMW 1,000 and ZMW 5,000,000');
  }

  if (params.product === 'salary' || params.product === 'p2p') {
    if (params.duration < 1 || params.duration > 12) {
      errors.push('Loan duration must be between 1 and 12 months');
    }
  } else {
    if (params.duration < 1 || params.duration > 120) {
      errors.push('Duration must be between 1 and 120 months');
    }
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Export for use in Node.js if needed
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculatePremium,
    formatCurrency,
    getInsurers,
    getProducts,
    getBaseRates,
    validateParams
  };
}
