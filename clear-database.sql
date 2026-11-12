-- Clear the MKCA platform database to start from scratch.
USE mkca_platform;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE claim_documents;
TRUNCATE TABLE claims;
TRUNCATE TABLE notifications;
TRUNCATE TABLE payments;
TRUNCATE TABLE premiums;
TRUNCATE TABLE beneficiaries;
TRUNCATE TABLE policies;
TRUNCATE TABLE loan_applications;
TRUNCATE TABLE insurance_products;
TRUNCATE TABLE users;
TRUNCATE TABLE businesses;
TRUNCATE TABLE role_permissions;
TRUNCATE TABLE permissions;
TRUNCATE TABLE roles;
TRUNCATE TABLE audit_logs;
TRUNCATE TABLE purchase_records;
SET FOREIGN_KEY_CHECKS = 1;

-- Reset any AUTO_INCREMENT counters if needed.
ALTER TABLE claim_documents AUTO_INCREMENT = 1;
ALTER TABLE claims AUTO_INCREMENT = 1;
ALTER TABLE notifications AUTO_INCREMENT = 1;
ALTER TABLE payments AUTO_INCREMENT = 1;
ALTER TABLE premiums AUTO_INCREMENT = 1;
ALTER TABLE beneficiaries AUTO_INCREMENT = 1;
ALTER TABLE policies AUTO_INCREMENT = 1;
ALTER TABLE loan_applications AUTO_INCREMENT = 1;
ALTER TABLE insurance_products AUTO_INCREMENT = 1;
ALTER TABLE users AUTO_INCREMENT = 1;
ALTER TABLE businesses AUTO_INCREMENT = 1;
ALTER TABLE role_permissions AUTO_INCREMENT = 1;
ALTER TABLE permissions AUTO_INCREMENT = 1;
ALTER TABLE roles AUTO_INCREMENT = 1;
ALTER TABLE audit_logs AUTO_INCREMENT = 1;
ALTER TABLE purchase_records AUTO_INCREMENT = 1;
