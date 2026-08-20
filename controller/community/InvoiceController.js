import moment from 'moment';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const assertCommunityAccess = (req, community_id, resp) => {
    if (req.manager && req.manager.community_id !== community_id) {
        resp.json({ status: 0, code: 403, message: 'Unauthorized access to this community.' });
        return false;
    }
    return true;
};

/**
 * Invoice list for a community, optionally filtered to one resident/customer
 */
export const invoiceList = asyncHandler(async (req, resp) => {
    try {
        const {
            community_id,
            resident_id = '',
            resident_mobile = '',
            page_no = 1,
            search_text = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertCommunityAccess(req, community_id, resp)) return;

        const whereFields = ['cr.community_id'];
        const whereValues = [community_id];
        const whereOperators = ['='];

        if (resident_id) {
            whereFields.push('sci.resident_id');
            whereValues.push(resident_id);
            whereOperators.push('=');
        }

        if (resident_mobile) {
            whereFields.push('cr.resident_mobile');
            whereValues.push(resident_mobile);
            whereOperators.push('=');
        }

        if (start_date && end_date) {
            const start = moment(`${start_date} 00:00:01`, 'YYYY-MM-DD HH:mm:ss').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss');
            const end   = moment(end_date, 'YYYY-MM-DD').format('YYYY-MM-DD') + ' 19:59:59';
            whereFields.push('sci.created_at', 'sci.created_at');
            whereValues.push(start, end);
            whereOperators.push('>=', '<=');
        }

        const result = await getPaginatedData({
            tableName        : ' scan_charger_invoice AS sci',
            columns          : `sci.invoice_id, sci.resident_id, sci.resident_name, sci.community_name, sci.area_name,
                sci.kwh_allocated, sci.total_consumption, sci.per_kwh_charge, sci.energy_price_total,
                sci.extra_charge_total, sci.total_amount,
                ${formatDateTimeInQuery(['sci.created_at'])},
                CASE WHEN sci.invoice_status = 1 THEN 'Paid' ELSE 'Pending' END AS invoice_status`,
            sortColumn       : 'sci.id',
            sortOrder        : 'DESC',
            page_no,
            liveSearchFields : ['sci.invoice_id', 'sci.resident_name'],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : whereFields,
            whereValue       : whereValues,
            whereOperator    : whereOperators,
            joinTable        : ' community_resident AS cr ',
            joinCondition    : ' cr.resident_id = sci.resident_id ',
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ['Invoice list fetched successfully!'],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.log('Error fetching community invoice list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

/**
 * Invoice details — only if the invoice belongs to a resident in the manager's community
 */
export const invoiceDetail = asyncHandler(async (req, resp) => {
    try {
        const { community_id, invoice_id } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id : ['required'],
            invoice_id   : ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertCommunityAccess(req, community_id, resp)) return;

        const invoice = await queryDB(`
            SELECT
                sci.invoice_id, sci.resident_name, sci.resident_email, sci.resident_address,
                sci.billing_month, sci.resident_id, sci.area_name, sci.community_name,
                sci.total_consumption, sci.kwh_allocated, sci.per_kwh_charge, sci.energy_price_total,
                sci.over_time_min, sci.extra_charge_per_min, sci.extra_charge_total,
                sci.no_of_session, sci.subtotal, sci.vat, sci.total_amount,
                ${formatDateTimeInQuery(['sci.created_at'])},
                CASE WHEN sci.invoice_status = 1 THEN 'Paid' ELSE 'Pending' END AS invoice_status
            FROM scan_charger_invoice AS sci
            INNER JOIN community_resident AS cr ON cr.resident_id = sci.resident_id
            WHERE sci.invoice_id = ? AND cr.community_id = ?
            LIMIT 1
        `, [invoice_id, community_id]);

        if (!invoice) {
            return resp.json({ status: 0, code: 404, message: 'Invoice not found.' });
        }

        return resp.json({
            status  : 1,
            code    : 200,
            message : ['Invoice details fetched successfully!'],
            data    : invoice,
        });
    } catch (error) {
        console.log('Error fetching community invoice details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
