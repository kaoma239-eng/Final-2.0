-- MySQL schema for MKCA insurance and accounting platform.
-- Includes users, businesses, insurance products, policies, premiums, claims, documents, notifications, roles and permissions.

CREATE DATABASE IF NOT EXISTS mkca_platform CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mkca_platform;

CREATE TABLE IF NOT EXISTS businesses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_name VARCHAR(150) NOT NULL,
  pacra_number VARCHAR(64) NOT NULL UNIQUE,
  tpin VARCHAR(64) NOT NULL UNIQUE,
  business_address VARCHAR(255) NOT NULL,
  point_of_contact VARCHAR(128) NULL,
  contact_email VARCHAR(150) NULL,
  contact_phone VARCHAR(32) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS permissions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INT UNSIGNED NOT NULL,
  permission_id INT UNSIGNED NOT NULL,
  PRIMARY KEY(role_id, permission_id),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_id INT UNSIGNED NOT NULL,
  business_id INT UNSIGNED NULL,
  full_name VARCHAR(128) NOT NULL,
  email VARCHAR(150) NOT NULL UNIQUE,
  phone VARCHAR(32) NOT NULL,
  nrc_passport VARCHAR(64) NOT NULL,
  date_of_birth DATE NOT NULL,
  address VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  profile_type ENUM('individual','business') NOT NULL DEFAULT 'individual',
  is_email_verified TINYINT(1) NOT NULL DEFAULT 0,
  last_login_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at DATETIME NULL,
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS loan_applications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_reference VARCHAR(64) NOT NULL UNIQUE,
  customer_name VARCHAR(128) NOT NULL,
  customer_email VARCHAR(150) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  nrc_number VARCHAR(64) NOT NULL,
  customer_type ENUM('individual','company') NOT NULL DEFAULT 'individual',
  company_name VARCHAR(128) NULL,
  product_type VARCHAR(64) NOT NULL DEFAULT 'Loan Protection',
  insurer_name VARCHAR(128) NOT NULL DEFAULT 'Sanlam Life Assurance',
  loan_amount DECIMAL(14,2) NOT NULL,
  coverage_amount DECIMAL(14,2) NOT NULL,
  premium_amount DECIMAL(14,2) NOT NULL,
  duration_months INT NOT NULL,
  age_at_application INT UNSIGNED NOT NULL,
  nrc_uploaded TINYINT(1) NOT NULL DEFAULT 0,
  document_path VARCHAR(255) NULL,
  status ENUM('draft','submitted','approved','rejected','paid') NOT NULL DEFAULT 'submitted',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_application_email (customer_email),
  INDEX idx_application_nrc (nrc_number)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS insurance_products (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  description TEXT NOT NULL,
  base_rate DECIMAL(7,5) NOT NULL,
  minimum_coverage DECIMAL(14,2) NOT NULL DEFAULT 1000.00,
  coverage_multiplier DECIMAL(5,2) NOT NULL DEFAULT 1.00,
  insurer_name VARCHAR(128) NOT NULL DEFAULT 'Sanlam Life Assurance',
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS policies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_number VARCHAR(64) NOT NULL UNIQUE,
  user_id INT UNSIGNED NOT NULL,
  business_id INT UNSIGNED NULL,
  product_id INT UNSIGNED NOT NULL,
  loan_amount DECIMAL(14,2) NOT NULL,
  coverage_amount DECIMAL(14,2) NOT NULL,
  premium_amount DECIMAL(14,2) NOT NULL,
  policy_fee DECIMAL(14,2) NOT NULL,
  total_payable DECIMAL(14,2) NOT NULL,
  issue_date DATE NOT NULL,
  expiry_date DATE NOT NULL,
  cover_type ENUM('death_only') NOT NULL DEFAULT 'death_only',
  insurer_name VARCHAR(128) NOT NULL DEFAULT 'Sanlam Life Assurance',
  age_at_application INT UNSIGNED NOT NULL,
  status ENUM('active','expired','cancelled','pending') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id) REFERENCES insurance_products(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS beneficiaries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id INT UNSIGNED NOT NULL,
  full_name VARCHAR(128) NOT NULL,
  relationship VARCHAR(64) NOT NULL,
  phone VARCHAR(32) NULL,
  email VARCHAR(150) NULL,
  share_percentage DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS premiums (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id INT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  amount DECIMAL(14,2) NOT NULL,
  paid_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
  status ENUM('due','paid','overdue') NOT NULL DEFAULT 'due',
  payment_date DATE NULL,
  payment_method ENUM('airtel_money','mtn_mobile_money','visa','mastercard','cash') NOT NULL,
  reference_code VARCHAR(128) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claims (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  claim_reference VARCHAR(64) NOT NULL UNIQUE,
  claim_type ENUM('death','accident','disability') NOT NULL DEFAULT 'death',
  status ENUM('submitted','documents_uploaded','verification','approved','rejected','completed') NOT NULL DEFAULT 'submitted',
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME NULL,
  settled_at DATETIME NULL,
  amount_requested DECIMAL(14,2) NOT NULL,
  amount_paid DECIMAL(14,2) NOT NULL DEFAULT 0,
  notes TEXT NULL,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS claim_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  claim_id INT UNSIGNED NOT NULL,
  document_type ENUM('death_certificate','nrc','policy_certificate','loan_agreement','medical_records','other') NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(255) NOT NULL,
  file_type VARCHAR(64) NOT NULL,
  file_size INT UNSIGNED NOT NULL,
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (claim_id) REFERENCES claims(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  policy_id INT UNSIGNED NULL,
  premium_id INT UNSIGNED NULL,
  amount DECIMAL(14,2) NOT NULL,
  method ENUM('airtel_money','mtn_mobile_money','visa','mastercard','cash') NOT NULL,
  transaction_reference VARCHAR(128) NOT NULL UNIQUE,
  status ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
  processed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (policy_id) REFERENCES policies(id) ON DELETE SET NULL,
  FOREIGN KEY (premium_id) REFERENCES premiums(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notifications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  type ENUM('email','sms','system') NOT NULL,
  subject VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  delivered_at DATETIME NULL,
  read_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  event_type VARCHAR(128) NOT NULL,
  resource_type VARCHAR(128) NULL,
  resource_id VARCHAR(128) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_policies_policy_number ON policies(policy_number);
CREATE INDEX idx_claims_status ON claims(status);
CREATE INDEX idx_premiums_status ON premiums(status);
CREATE INDEX idx_payments_transaction_reference ON payments(transaction_reference);

-- Purchase records table for storing customer payments and reference numbers
CREATE TABLE IF NOT EXISTS purchase_records (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference_number VARCHAR(64) NOT NULL UNIQUE,
  customer_type ENUM('individual','company') NOT NULL,
  customer_name VARCHAR(128) NOT NULL,
  company_name VARCHAR(128) NULL,
  customer_email VARCHAR(150) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  phone_number VARCHAR(32) NOT NULL,
  product_type VARCHAR(100) NOT NULL,
  insurer_name VARCHAR(128) NOT NULL DEFAULT 'Sanlam Life Assurance',
  coverage_amount DECIMAL(14,2) NOT NULL,
  premium_paid DECIMAL(14,2) NOT NULL,
  duration_months INT NOT NULL,
  cover_description VARCHAR(255) NOT NULL DEFAULT 'Loan Protection - death only',
  payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_reference_number (reference_number),
  INDEX idx_customer_email (customer_email),
  INDEX idx_customer_type (customer_type),
  INDEX idx_payment_date (payment_date)
) ENGINE=InnoDB;

INSERT INTO insurance_products (code, name, description, base_rate, minimum_coverage, coverage_multiplier, insurer_name, status)
VALUES (
  'LOAN_PROTECTION',
  'Loan Protection',
  'Monthly death-only cover for protected loan balances. Premium is calculated as 3% of the protected loan amount, with age loading from age 20.',
  0.03000,
  1000.00,
  1.00,
  'Sanlam Life Assurance',
  'active'
)
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  description = VALUES(description),
  base_rate = VALUES(base_rate),
  minimum_coverage = VALUES(minimum_coverage),
  coverage_multiplier = VALUES(coverage_multiplier),
  insurer_name = VALUES(insurer_name),
  status = VALUES(status);
