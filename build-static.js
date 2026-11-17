const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = path.join(root, 'dist');
const browserScripts = [
  'script.js',
  'premium-calculator.js',
  'company-logos.js',
  'admin-dashboard.js',
  'nrc-formatter.js'
];
const rootAssets = [
  'styles.css',
  'favicon.ico',
  'favicon.png',
  'robots.txt',
  'sitemap.xml',
  ...browserScripts
];
const publicExtensions = new Set(['.html', '.js', '.css', '.png', '.ico', '.svg', '.xml', '.txt']);
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico']);

function copyFile(relativePath) {
  const source = path.join(root, relativePath);
  const destination = path.join(output, relativePath);

  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyPublicDirectory(sourceDirectory, relativeDirectory) {
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    const relativePath = path.join(relativeDirectory, entry.name);
    const sourcePath = path.join(root, relativePath);

    if (entry.isDirectory()) {
      copyPublicDirectory(sourcePath, relativePath);
    } else if (entry.isFile() && publicExtensions.has(path.extname(entry.name).toLowerCase())) {
      copyFile(relativePath);
    }
  }
}

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (entry.isFile() && entry.name.endsWith('.html')) {
    copyFile(entry.name);
  }
}

for (const relativePath of rootAssets) {
  if (fs.existsSync(path.join(root, relativePath))) {
    copyFile(relativePath);
  }
}

const logoDirectory = path.join(root, 'assets', 'logos');
if (fs.existsSync(logoDirectory)) {
  for (const entry of fs.readdirSync(logoDirectory, { withFileTypes: true })) {
    if (entry.isFile() && imageExtensions.has(path.extname(entry.name).toLowerCase())) {
      copyFile(path.join('assets', 'logos', entry.name));
    }
  }
}

const publicDirectory = path.join(root, 'public');
if (fs.existsSync(publicDirectory)) {
  copyPublicDirectory(publicDirectory, 'public');
}
