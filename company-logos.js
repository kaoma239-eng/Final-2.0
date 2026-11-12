const path = require('path');
const fs = require('fs');

const companyLogos = {
  'Sanlam Life Assurance': 'assets/logos/sanlam-life.png'
};

const SANLAM_NAMES = ['Sanlam Life Assurance', 'Sanlam Life Insurance'];

function normalizeSanlamName(companyName) {
  if (!companyName) return 'Sanlam Life Assurance';
  return SANLAM_NAMES.includes(companyName) ? 'Sanlam Life Assurance' : companyName;
}

const defaultLogo = 'assets/logos/default-logo.png';

function getLogoPath(companyName) {
  const normalizedName = normalizeSanlamName(companyName);
  const trustedLogo = companyLogos[normalizedName] || companyLogos['Sanlam Life Assurance'];

  // Preferred path inside assets/logos
  const candidate = trustedLogo ? path.join(__dirname, trustedLogo) : path.join(__dirname, defaultLogo);

  if (fs.existsSync(candidate)) {
    return candidate;
  }

  // Fallback: look for legacy files in project root
  if (trustedLogo) {
    const legacyPath = path.join(__dirname, path.basename(trustedLogo));
    if (fs.existsSync(legacyPath)) {
      console.warn(`Using legacy logo path for "${companyName}" -> ${legacyPath}`);
      return legacyPath;
    }
    console.warn(`Missing logo file for "${companyName}" at ${candidate} - falling back to default`);
  }

  // Try generic logo1.png in repo root
  const fallback = path.join(__dirname, 'logo1.png');
  if (fs.existsSync(fallback)) return fallback;

  // Try default path inside assets
  const defaultPath = path.join(__dirname, defaultLogo);
  if (fs.existsSync(defaultPath)) return defaultPath;

  console.warn('No insurer logo found; continuing without logo');
  return null;
}

module.exports = { getLogoPath, companyLogos, SANLAM_NAMES, normalizeSanlamName };