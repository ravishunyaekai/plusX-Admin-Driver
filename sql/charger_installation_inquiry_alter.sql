-- Convert enquiry_status from full labels / VARCHAR to ENUM shorthand.
-- Safe to skip if the table was created from charger_installation_inquiry.sql after this change.

UPDATE charger_installation_inquiry SET enquiry_status = 'ASG' WHERE enquiry_status IN ('Assigned', 'ASG');
UPDATE charger_installation_inquiry SET enquiry_status = 'CTC' WHERE enquiry_status IN ('Contacted', 'CTC');
UPDATE charger_installation_inquiry SET enquiry_status = 'FUR' WHERE enquiry_status IN ('Follow-up Required', 'FUR');
UPDATE charger_installation_inquiry SET enquiry_status = 'SVP' WHERE enquiry_status IN ('Site Visit Planned', 'SVP');
UPDATE charger_installation_inquiry SET enquiry_status = 'SVC' WHERE enquiry_status IN ('Site Visit Completed', 'SVC');
UPDATE charger_installation_inquiry SET enquiry_status = 'QSH' WHERE enquiry_status IN ('Quotation Shared', 'QSH');
UPDATE charger_installation_inquiry SET enquiry_status = 'ISC' WHERE enquiry_status IN ('Installation Scheduled', 'ISC');
UPDATE charger_installation_inquiry SET enquiry_status = 'INC' WHERE enquiry_status IN ('Installation Completed', 'INC');
UPDATE charger_installation_inquiry SET enquiry_status = 'LCN' WHERE enquiry_status IN ('Lost / Cancelled', 'LCN');

ALTER TABLE charger_installation_inquiry
    MODIFY COLUMN enquiry_status ENUM('ASG', 'CTC', 'FUR', 'SVP', 'SVC', 'QSH', 'ISC', 'INC', 'LCN') NOT NULL;
