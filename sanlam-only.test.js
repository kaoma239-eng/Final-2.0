const assert = require('node:assert/strict');
const { companyLogos } = require('./company-logos');
const { calculatePremium, getProducts } = require('./premium-calculator.js');

assert.deepStrictEqual(Object.keys(companyLogos), ['Sanlam Life Assurance']);

const productNames = getProducts();
assert.equal(productNames.life, 'Loan Protection', 'The product must be described as loan protection rather than life insurance');
assert.equal(productNames.salary, 'Salary Advance', 'Salary advance should be named without the old protection suffix or initials');
assert.equal(productNames.p2p, 'P2P Lending', 'P2P lending should be shown by name without a letter badge or extra wording');

const minCoverageLoan = calculatePremium({
  product: 'life',
  insurer: 'sanlam',
  age: 20,
  gender: 'male',
  coverage: 1000,
  duration: 1
});
assert.equal(minCoverageLoan.monthlyPremium, 30, 'At age 20, minimum covered loan premium should be 3% of ZMW 1,000');
assert.equal(minCoverageLoan.totalCost, 30, 'One-month minimum cover should not be annualised');

const olderLoan = calculatePremium({
  product: 'life',
  insurer: 'sanlam',
  age: 35,
  gender: 'male',
  coverage: 100000,
  duration: 1
});
assert.equal(olderLoan.monthlyPremium, 3675, 'Premium should increase as the borrower gets older from age 20');
assert.equal(olderLoan.totalCost, 3675, 'The one-month quote should reflect the monthly premium with age loading');

const oneMonthSalary = calculatePremium({
  product: 'salary',
  insurer: 'sanlam',
  age: 20,
  gender: 'male',
  coverage: 100000,
  duration: 1
});

assert.equal(oneMonthSalary.monthlyPremium, 3000, 'Monthly premium should be 3% of the insured loan amount at age 20');
assert.equal(oneMonthSalary.totalCost, 3000, 'One-month loan premium should not be annualised');

const twoMonthSalary = calculatePremium({
  product: 'salary',
  insurer: 'sanlam',
  age: 35,
  gender: 'male',
  coverage: 100000,
  duration: 2
});

assert.equal(twoMonthSalary.monthlyPremium, 3675, 'Premium should increase with age and remain the monthly rate for each covered month');
assert.equal(twoMonthSalary.totalCost, 7350, 'Two months should reflect two monthly premiums with age loading');

console.log('Sanlam-only platform check passed');
console.log('Loan premium calculation checks passed');
