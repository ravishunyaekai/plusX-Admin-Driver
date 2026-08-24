import moment from 'moment';
import { asyncHandler, deleteFile, mergeParam, formatDateTimeInQuery, formatDateInQuery } from '../../utils.js';
import { getPaginatedData, insertRecord, updateRecord, queryDB } from '../../dbUtils.js';
import validateFields from '../../validation.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const INQUIRY_TABLE = 'charger_installation_inquiry';
const UPLOAD_FOLDER = 'charger-installation-inquiry';

const LEAD_SOURCES = ['WhatsApp', 'Call', 'Email', 'Website', 'Other'];
const YES_NO_VALUES = ['Yes', 'No'];
const SITE_VISIT_STATUSES = ['Planned', 'Completed', 'Cancelled'];
const CHARGER_AVAILABILITY = ['already_has', 'buy_from_us'];

const ENQUIRY_STATUS_MAP = {
    'ASG'                    : 'ASG',
    'ASSIGNED'               : 'ASG',
    'CTC'                    : 'CTC',
    'CONTACTED'              : 'CTC',
    'FUR'                    : 'FUR',
    'FOLLOW-UP REQUIRED'     : 'FUR',
    'SVP'                    : 'SVP',
    'SITE VISIT PLANNED'     : 'SVP',
    'SVC'                    : 'SVC',
    'SITE VISIT COMPLETED'   : 'SVC',
    'QSH'                    : 'QSH',
    'QUOTATION SHARED'       : 'QSH',
    'ISC'                    : 'ISC',
    'INSTALLATION SCHEDULED' : 'ISC',
    'INC'                    : 'INC',
    'INSTALLATION COMPLETED' : 'INC',
    'LCN'                    : 'LCN',
    'LOST / CANCELLED'       : 'LCN',
};

const ENQUIRY_STATUS_LABEL = {
    ASG : 'Assigned',
    CTC : 'Contacted',
    FUR : 'Follow-up Required',
    SVP : 'Site Visit Planned',
    SVC : 'Site Visit Completed',
    QSH : 'Quotation Shared',
    ISC : 'Installation Scheduled',
    INC : 'Installation Completed',
    LCN : 'Lost / Cancelled',
};

const resolveEnquiryStatus = (value) => {
    if (!value) return null;
    return ENQUIRY_STATUS_MAP[String(value).trim().toUpperCase()] || null;
};

const enquiryStatusLabel = (value) => ENQUIRY_STATUS_LABEL[value] || value || null;

const parseDate = (value) => {
    if (!value || String(value).includes('_')) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
        return moment(trimmed, 'DD-MM-YYYY').format('YYYY-MM-DD');
    }
    return null;
};

const parseDecimal = (value) => {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const isAllowed = (value, allowed) => !value || allowed.includes(String(value).trim());

const buildInquiryId = (insertId) => `CII-${String(insertId).padStart(4, '0')}`;

const attachFileUrls = (inquiry) => {
    if (!inquiry) return inquiry;
    inquiry.completion_certificate_url = inquiry.completion_certificate
        ? `${process.env.DIR_UPLOADS}${UPLOAD_FOLDER}/${inquiry.completion_certificate}`
        : null;
    inquiry.charger_purchase_invoice_url = inquiry.charger_purchase_invoice
        ? `${process.env.DIR_UPLOADS}${UPLOAD_FOLDER}/${inquiry.charger_purchase_invoice}`
        : null;
    return inquiry;
};

const validateInquiryPayload = (body) => {
    const {
        customer_name,
        mobile_no,
        email_id,
        lead_source,
        assigned_person_name,
        enquiry_status,
        follow_up_required,
        next_follow_up_date,
        follow_up_remarks,
        site_visit_required,
        site_visit_date,
        site_visit_location,
        site_visit_person,
        site_visit_status,
        cabling_required,
        civil_work_required,
        charger_availability,
        lost_cancelled_remark,
    } = body;

    const { isValid, errors } = validateFields(body, {
        customer_name        : ['required'],
        mobile_no            : ['required'],
        email_id             : ['required'],
        lead_source          : ['required'],
        assigned_person_name : ['required'],
        enquiry_status       : ['required'],
    });
    if (!isValid) return { isValid: false, errors };

    const enquiryStatusCode = resolveEnquiryStatus(enquiry_status);

    if (!isAllowed(lead_source, LEAD_SOURCES)) {
        return { isValid: false, errors: ['Invalid lead_source value.'] };
    }
    if (!enquiryStatusCode) {
        return { isValid: false, errors: ['Invalid enquiry_status value.'] };
    }
    if (!isAllowed(follow_up_required, YES_NO_VALUES)) {
        return { isValid: false, errors: ['Invalid follow_up_required value.'] };
    }
    if (!isAllowed(site_visit_required, YES_NO_VALUES)) {
        return { isValid: false, errors: ['Invalid site_visit_required value.'] };
    }
    if (!isAllowed(site_visit_status, SITE_VISIT_STATUSES)) {
        return { isValid: false, errors: ['Invalid site_visit_status value.'] };
    }
    if (!isAllowed(cabling_required, YES_NO_VALUES)) {
        return { isValid: false, errors: ['Invalid cabling_required value.'] };
    }
    if (!isAllowed(civil_work_required, YES_NO_VALUES)) {
        return { isValid: false, errors: ['Invalid civil_work_required value.'] };
    }
    if (!isAllowed(charger_availability, CHARGER_AVAILABILITY)) {
        return { isValid: false, errors: ['Invalid charger_availability value.'] };
    }

    if (follow_up_required === 'Yes') {
        if (!next_follow_up_date || !follow_up_remarks?.trim()) {
            return {
                isValid: false,
                errors: ['next_follow_up_date and follow_up_remarks are required when follow_up_required is Yes.'],
            };
        }
    }

    if (site_visit_required === 'Yes') {
        if (!site_visit_date || !site_visit_location?.trim() || !site_visit_person?.trim()) {
            return {
                isValid: false,
                errors: ['site_visit_date, site_visit_location and site_visit_person are required when site_visit_required is Yes.'],
            };
        }
    }

    if (enquiryStatusCode === 'LCN' && !lost_cancelled_remark?.trim()) {
        return { isValid: false, errors: ['lost_cancelled_remark is required when enquiry_status is Lost / Cancelled.'] };
    }

    return { isValid: true, errors: [], enquiryStatusCode };
};

const buildInquiryRecord = (body, files = {}, existing = {}) => {
    const {
        customer_name,
        mobile_no,
        country_code = '+971',
        email_id,
        lead_source,
        assigned_person_name,
        customer_feedback = null,
        follow_up_required = null,
        next_follow_up_date = null,
        follow_up_remarks = null,
        site_visit_required = null,
        site_visit_date = null,
        site_visit_time = null,
        site_visit_location = null,
        site_visit_person = null,
        site_visit_status = null,
        site_visit_remarks = null,
        cabling_required = null,
        civil_work_required = null,
        existing_electrical_setup = null,
        charger_availability = null,
        charger_capacity = null,
        charger_cost = null,
        material_requirement_details = null,
        material_cost_to_us = null,
        material_cost_quoted = null,
        installation_date = null,
        installation_person = null,
        installation_completion_date = null,
        installation_completed_by = null,
        final_amount = null,
        enquiry_status,
        lost_cancelled_remark = null,
    } = body;

    const completionCertificate = files.completion_certificate
        ?? existing.completion_certificate
        ?? null;
    const purchaseInvoice = files.charger_purchase_invoice
        ?? existing.charger_purchase_invoice
        ?? null;

    const followUpIsYes = follow_up_required === 'Yes';
    const siteVisitIsYes = site_visit_required === 'Yes';
    const buyFromUs = charger_availability === 'buy_from_us';
    const enquiryStatusCode = resolveEnquiryStatus(enquiry_status);
    const isLost = enquiryStatusCode === 'LCN';

    return {
        customer_name,
        mobile_no,
        country_code: country_code || '+971',
        email_id,
        lead_source,
        assigned_person_name,
        customer_feedback: customer_feedback || null,
        follow_up_required: follow_up_required || null,
        next_follow_up_date: followUpIsYes ? parseDate(next_follow_up_date) : null,
        follow_up_remarks: followUpIsYes ? (follow_up_remarks || null) : null,
        site_visit_required: site_visit_required || null,
        site_visit_date: siteVisitIsYes ? parseDate(site_visit_date) : null,
        site_visit_time: siteVisitIsYes ? (site_visit_time || null) : null,
        site_visit_location: siteVisitIsYes ? (site_visit_location || null) : null,
        site_visit_person: siteVisitIsYes ? (site_visit_person || null) : null,
        site_visit_status: siteVisitIsYes ? (site_visit_status || null) : null,
        site_visit_remarks: siteVisitIsYes ? (site_visit_remarks || null) : null,
        cabling_required: cabling_required || null,
        civil_work_required: civil_work_required || null,
        existing_electrical_setup: existing_electrical_setup || null,
        charger_availability: charger_availability || null,
        charger_capacity: charger_capacity || null,
        charger_cost: buyFromUs ? parseDecimal(charger_cost) : null,
        material_requirement_details: material_requirement_details || null,
        material_cost_to_us: parseDecimal(material_cost_to_us),
        material_cost_quoted: parseDecimal(material_cost_quoted),
        installation_date: parseDate(installation_date),
        installation_person: installation_person || null,
        installation_completion_date: parseDate(installation_completion_date),
        installation_completed_by: installation_completed_by || null,
        final_amount: parseDecimal(final_amount),
        completion_certificate: completionCertificate,
        charger_purchase_invoice: purchaseInvoice,
        enquiry_status: enquiryStatusCode,
        lost_cancelled_remark: isLost ? (lost_cancelled_remark || null) : null,
    };
};

export const chargerInstallationInquiryList = asyncHandler(async (req, resp) => {
    try {
        const {
            page_no = 1,
            search_text = '',
            start_date,
            end_date,
            lead_source,
            enquiry_status,
            site_visit_status,
            rowSelected,
        } = req.body;

        const whereFields = [];
        const whereValues = [];
        const whereOperators = [];

        if (lead_source) {
            whereFields.push('lead_source');
            whereValues.push(lead_source);
            whereOperators.push('=');
        }
        const enquiryStatusCode = resolveEnquiryStatus(enquiry_status);
        if (enquiryStatusCode) {
            whereFields.push('enquiry_status');
            whereValues.push(enquiryStatusCode);
            whereOperators.push('=');
        }
        if (site_visit_status) {
            whereFields.push('site_visit_status');
            whereValues.push(site_visit_status);
            whereOperators.push('=');
        }

        if (start_date && end_date) {
            const start = moment(`${start_date} 00:00:01`, 'YYYY-MM-DD HH:mm:ss').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss');
            const end = moment(end_date, 'YYYY-MM-DD').format('YYYY-MM-DD') + ' 19:59:59';
            whereFields.push('created_at', 'created_at');
            whereValues.push(start, end);
            whereOperators.push('>=', '<=');
        }

        const result = await getPaginatedData({
            tableName: INQUIRY_TABLE,
            columns: `inquiry_id, customer_name, mobile_no, country_code, lead_source, assigned_person_name,
                enquiry_status, site_visit_status,
                ${formatDateInQuery(['installation_date'])},
                ${formatDateInQuery(['installation_completion_date'])},
                ${formatDateTimeInQuery(['created_at'])}`,
            liveSearchFields: ['inquiry_id', 'customer_name', 'mobile_no'],
            liveSearchTexts: [search_text, search_text, search_text],
            sortColumn: 'id',
            sortOrder: 'DESC',
            page_no,
            limit: rowSelected || 10,
            whereField: whereFields,
            whereValue: whereValues,
            whereOperator: whereOperators,
        });

        const data = (result.data || []).map((row) => ({
            ...row,
            enquiry_status: enquiryStatusLabel(row.enquiry_status),
        }));

        return resp.json({
            status: 1,
            code: 200,
            message: ['Inquiry list fetched successfully!'],
            data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('[chargerInstallationInquiryList] error:', error);
        return resp.json({ status: 0, code: 500, message: ['Error fetching inquiry list.'] });
    }
});

export const chargerInstallationInquiryDetails = asyncHandler(async (req, resp) => {
    try {
        const { inquiry_id } = req.body;
        const { isValid, errors } = validateFields(req.body, { inquiry_id: ['required'] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const inquiry = await queryDB(`
            SELECT
                inquiry_id, customer_name, mobile_no, country_code, email_id, lead_source,
                assigned_person_name, customer_feedback, follow_up_required,
                ${formatDateInQuery(['next_follow_up_date'])},
                follow_up_remarks, site_visit_required,
                ${formatDateInQuery(['site_visit_date'])},
                site_visit_time, site_visit_location, site_visit_person, site_visit_status,
                site_visit_remarks, cabling_required, civil_work_required, existing_electrical_setup,
                charger_availability, charger_capacity, charger_cost, material_requirement_details,
                material_cost_to_us, material_cost_quoted,
                ${formatDateInQuery(['installation_date'])},
                installation_person,
                ${formatDateInQuery(['installation_completion_date'])},
                installation_completed_by, final_amount,
                completion_certificate, charger_purchase_invoice,
                enquiry_status, lost_cancelled_remark,
                ${formatDateTimeInQuery(['created_at'])},
                ${formatDateTimeInQuery(['updated_at'])}
            FROM ${INQUIRY_TABLE}
            WHERE inquiry_id = ?
            LIMIT 1
        `, [inquiry_id]);

        if (!inquiry) {
            return resp.json({ status: 0, code: 404, message: ['Inquiry not found.'] });
        }

        attachFileUrls(inquiry);
        inquiry.enquiry_status = enquiryStatusLabel(inquiry.enquiry_status);

        return resp.json({
            status: 1,
            code: 200,
            message: ['Inquiry details fetched successfully!'],
            data: { inquiry },
        });
    } catch (error) {
        console.error('[chargerInstallationInquiryDetails] error:', error);
        return resp.json({ status: 0, code: 500, message: ['Error fetching inquiry details.'] });
    }
});

export const chargerInstallationInquiryAdd = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const validation = validateInquiryPayload(body);
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const files = {
            completion_certificate: req.files?.completion_certificate?.[0]?.filename || null,
            charger_purchase_invoice: req.files?.charger_purchase_invoice?.[0]?.filename || null,
        };

        const record = buildInquiryRecord(body, files);
        const columns = ['inquiry_id', ...Object.keys(record)];
        const values = ['CII', ...Object.values(record)];

        const insert = await insertRecord(INQUIRY_TABLE, columns, values);
        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add inquiry. Please try again.'] });
        }

        const inquiry_id = buildInquiryId(insert.insertId);
        await updateRecord(INQUIRY_TABLE, { inquiry_id }, ['id'], [insert.insertId]);

        return resp.json({
            status: 1,
            code: 200,
            message: ['Inquiry added successfully'],
            inquiry_id,
        });
    } catch (error) {
        console.error('[chargerInstallationInquiryAdd] error:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Failed to add inquiry.');
    }
});

export const chargerInstallationInquiryEdit = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const { inquiry_id } = body;

        const validation = validateInquiryPayload(body);
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const { isValid, errors } = validateFields(body, { inquiry_id: ['required'] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const existing = await queryDB(`
            SELECT inquiry_id, completion_certificate, charger_purchase_invoice
            FROM ${INQUIRY_TABLE}
            WHERE inquiry_id = ?
            LIMIT 1
        `, [inquiry_id]);

        if (!existing) {
            return resp.json({ status: 0, code: 404, message: ['Inquiry not found.'] });
        }

        const newCompletionCert = req.files?.completion_certificate?.[0]?.filename || null;
        const newPurchaseInvoice = req.files?.charger_purchase_invoice?.[0]?.filename || null;

        const files = {
            completion_certificate: newCompletionCert || existing.completion_certificate || null,
            charger_purchase_invoice: newPurchaseInvoice || existing.charger_purchase_invoice || null,
        };

        const record = buildInquiryRecord(body, files, existing);
        const update = await updateRecord(INQUIRY_TABLE, record, ['inquiry_id'], [inquiry_id]);

        if (newCompletionCert && existing.completion_certificate) {
            deleteFile(UPLOAD_FOLDER, existing.completion_certificate);
        }
        if (newPurchaseInvoice && existing.charger_purchase_invoice) {
            deleteFile(UPLOAD_FOLDER, existing.charger_purchase_invoice);
        }

        return resp.json({
            status: update.affectedRows > 0 ? 1 : 0,
            code: 200,
            message: update.affectedRows > 0
                ? ['Inquiry updated successfully']
                : ['No changes were made to the inquiry.'],
        });
    } catch (error) {
        console.error('[chargerInstallationInquiryEdit] error:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Failed to update inquiry.');
    }
});
