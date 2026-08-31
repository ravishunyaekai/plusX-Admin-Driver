
import { mergeParam, formatDateTimeInQuery, asyncHandler } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB, updateRecord, insertRecord } from '../../dbUtils.js';
import db from "../../config/db.js";
import moment from "moment";

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";

/**
 * Parse community_ids from body — supports array or JSON string array.
 */
const parseCommunityIds = (input) => {
    if (Array.isArray(input)) {
        return [...new Set(input.map((id) => String(id).trim()).filter(Boolean))];
    }
    if (typeof input === 'string' && input.trim()) {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) {
                return [...new Set(parsed.map((id) => String(id).trim()).filter(Boolean))];
            }
        } catch {
            return [input.trim()];
        }
    }
    return [];
};

/**
 * Ensure all community IDs exist and are active.
 */
const validateCommunityIds = async (communityIds) => {
    if (!communityIds.length) {
        return { valid: false, message: ['At least one community is required.'] };
    }

    const placeholders = communityIds.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT community_id FROM community_list WHERE status = 1 AND community_id IN (${placeholders})`,
        communityIds
    );

    if (rows.length !== communityIds.length) {
        return { valid: false, message: ['Invalid or inactive community selected.'] };
    }

    return { valid: true, communityIds };
};

/**
 * Replace map rows for a resident.
 */
const syncResidentCommunities = async (residentId, communityIds) => {
    await db.execute('DELETE FROM community_resident_map WHERE resident_id = ?', [residentId]);

    if (!communityIds.length) return;

    const values       = communityIds.map((communityId) => [residentId, communityId]);
    const placeholders = values.map(() => '(?, ?)').join(', ');

    await db.execute(
        `INSERT INTO community_resident_map (resident_id, community_id) VALUES ${placeholders}`,
        values.flat()
    );
};

/**
 * Fetch communities linked to a resident.
 */
const getCommunitiesForResident = async (residentId) => {
    const [rows] = await db.execute(`
        SELECT cl.community_id, cl.community_name, cl.area_name
        FROM community_resident_map AS m
        INNER JOIN community_list AS cl ON cl.community_id = m.community_id
        WHERE m.resident_id = ?
        ORDER BY cl.community_name ASC
    `, [residentId]);

    return rows;
};

/** Current-month booking match for session_used / kwh_used (same window as invoice). */
const getResidentUsageBookingMatchSql = () => `
    scb.status = 'C'
    AND scb.created_at >= ? AND scb.created_at <= ?
    AND (
        JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.resident_id')) = cr.resident_id
        OR scb.rider_id IN (SELECT r.rider_id FROM riders AS r WHERE r.rider_mobile = cr.resident_mobile)
    )`;

const getCurrentMonthUsageWindow = () => ({
    monthStart : moment().startOf('month').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss'),
    monthEnd   : moment().endOf('month').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss'),
});

const formatUsageToThreeDecimals = (value) => parseFloat(value || 0).toFixed(3);

export const addResidentMulti = asyncHandler(async (req, resp) => {
    try {
        const {
            resident_name, mobile_number, country_code = '+971', resident_email, community_ids,
            address, monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge
        } = req.body;

        const parsedCommunityIds = parseCommunityIds(community_ids);

        const { isValid, errors } = validateFields(req.body, {
            resident_name              : ["required"],
            mobile_number              : ["required"],
            resident_email             : ["required"],
            address                    : ["required"],
            monthly_session_allocation : ["required"],
            alloted_time               : ["required"],
            kwh_allocated              : ["required"],
            per_kwh_charge             : ["required"],
            extra_charge               : ["required"],
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const communityCheck = await validateCommunityIds(parsedCommunityIds);
        if (!communityCheck.valid) {
            return resp.json({ status: 0, code: 422, message: communityCheck.message });
        }

        const [duplicateCheck] = await db.query(`
            SELECT 'mobile' AS type FROM community_resident WHERE resident_mobile = ?
            UNION
                SELECT 'email' AS type FROM community_resident WHERE resident_email = ? `,
            [mobile_number, resident_email]
        );

        const types = duplicateCheck.map((row) => row.type);
        if (types.includes('mobile') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
        } else if (types.includes('mobile')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
        }

        const primaryCommunityId = communityCheck.communityIds[0];

        const insert = await insertRecord('community_resident',
            [
                'resident_id', 'community_id', 'resident_name', 'country_code', 'resident_mobile', 'resident_email',
                'address', 'monthly_session_allocation', 'alloted_time', 'kwh_allocated', 'per_kwh_charge', 'extra_charge', 'status',
            ], [
                'resident_id', primaryCommunityId, resident_name, country_code || '+971', mobile_number, resident_email,
                address, monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge, 1,
            ]);

        if (insert.affectedRows == 0) {
            return resp.json({ status: 0, message: "Failed to add Please try again after some time." });
        }

        const resident_id = 'RD' + String(insert.insertId).padStart(4, '0');
        await updateRecord('community_resident', { resident_id }, ['id'], [insert.insertId]);
        await syncResidentCommunities(resident_id, communityCheck.communityIds);

        const communities = await getCommunitiesForResident(resident_id);

        return resp.json({
            status  : 1,
            message : "Resident added successfully.",
            data    : { resident_id, communities },
        });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const residentListMultiOld = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', community_id = '' } = mergeParam(req);

        const limit  = 10;
        const page   = (isNaN(page_no) || page_no < 1) ? 1 : parseInt(page_no, 10);
        const offset = (page * limit) - limit;

        const whereParts = ['1 = 1'];
        const queryParams = [];

        if (community_id) {
            whereParts.push('EXISTS (SELECT 1 FROM community_resident_map AS fm WHERE fm.resident_id = cr.resident_id AND fm.community_id = ?)');
            queryParams.push(community_id);
        }

        if (search_text && String(search_text).trim()) {
            const like = `%${String(search_text).trim()}%`;
            whereParts.push('(cr.resident_id LIKE ? OR cr.resident_name LIKE ? OR cr.resident_mobile LIKE ?)');
            queryParams.push(like, like, like);
        }

        const whereSql = `WHERE ${whereParts.join(' AND ')}`;

        const [rows] = await db.execute(`
            SELECT SQL_CALC_FOUND_ROWS
                cr.resident_id,
                cr.resident_name,
                cr.country_code,
                cr.resident_mobile,
                cr.resident_email,
                cr.monthly_session_allocation,
                cr.kwh_allocated,
                '0' AS session_used,
                '0' AS kwh_used,
                GROUP_CONCAT(DISTINCT cl.community_name ORDER BY cl.community_name SEPARATOR ', ') AS community_names,
                GROUP_CONCAT(DISTINCT cl.community_id ORDER BY cl.community_id SEPARATOR ',') AS community_ids
            FROM community_resident AS cr
            INNER JOIN community_resident_map AS m ON m.resident_id = cr.resident_id
            INNER JOIN community_list AS cl ON cl.community_id = m.community_id
            ${whereSql}
            GROUP BY cr.id, cr.resident_id, cr.resident_name, cr.country_code, cr.resident_mobile, cr.resident_email, cr.monthly_session_allocation, cr.kwh_allocated
            ORDER BY cr.id DESC
            LIMIT ${offset}, ${limit}
        `, queryParams);

        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Resident list fetched successfully!"],
            data       : rows,
            total_page : totalPage,
            total,
        });

    } catch (error) {
        console.log('Error fetching resident list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const residentListMulti = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', community_id = '' } = mergeParam(req);

        const limit  = 10;
        const page   = (isNaN(page_no) || page_no < 1) ? 1 : parseInt(page_no, 10);
        const offset = (page * limit) - limit;

        const { monthStart, monthEnd } = getCurrentMonthUsageWindow();
        const bookingMatchSql = getResidentUsageBookingMatchSql();

        const whereParts = ['1 = 1'];
        const queryParams = [monthStart, monthEnd, monthStart, monthEnd];

        if (community_id) {
            whereParts.push('EXISTS (SELECT 1 FROM community_resident_map AS fm WHERE fm.resident_id = cr.resident_id AND fm.community_id = ?)');
            queryParams.push(community_id);
        }

        if (search_text && String(search_text).trim()) {
            const like = `%${String(search_text).trim()}%`;
            whereParts.push('(cr.resident_id LIKE ? OR cr.resident_name LIKE ? OR cr.resident_mobile LIKE ?)');
            queryParams.push(like, like, like);
        }

        const whereSql = `WHERE ${whereParts.join(' AND ')}`;

        const [rows] = await db.execute(`
            SELECT SQL_CALC_FOUND_ROWS
                cr.resident_id,
                cr.resident_name,
                cr.country_code,
                cr.resident_mobile,
                cr.resident_email,
                cr.monthly_session_allocation,
                cr.kwh_allocated,
                (SELECT COUNT(*)
                    FROM scan_charger_booking AS scb
                    WHERE ${bookingMatchSql}) AS session_used,
                (SELECT COALESCE(SUM(scb.total_consumption), 0)
                    FROM scan_charger_booking AS scb
                    WHERE ${bookingMatchSql}) AS kwh_used,
                GROUP_CONCAT(DISTINCT cl.community_name ORDER BY cl.community_name SEPARATOR ', ') AS community_names,
                GROUP_CONCAT(DISTINCT cl.community_id ORDER BY cl.community_id SEPARATOR ',') AS community_ids
            FROM community_resident AS cr
            INNER JOIN community_resident_map AS m ON m.resident_id = cr.resident_id
            INNER JOIN community_list AS cl ON cl.community_id = m.community_id
            ${whereSql}
            GROUP BY cr.id, cr.resident_id, cr.resident_name, cr.country_code, cr.resident_mobile, cr.resident_email, cr.monthly_session_allocation, cr.kwh_allocated
            ORDER BY cr.id DESC
            LIMIT ${offset}, ${limit}
        `, queryParams);

        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        const data = rows.map((row) => ({
            ...row,
            session_used : formatUsageToThreeDecimals(row.session_used),
            kwh_used     : formatUsageToThreeDecimals(row.kwh_used),
        }));

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Resident list fetched successfully!"],
            data,
            total_page : totalPage,
            total,
        });

    } catch (error) {
        console.log('Error fetching resident list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const residentDetailMulti = asyncHandler(async (req, resp) => {
    const { resident_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        resident_id : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const resident = await queryDB(`
        SELECT
            resident_id, resident_name, country_code, resident_mobile, resident_email, address,
            monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge,
            ${formatDateTimeInQuery(['rs.created_at'])}, rs.status, rs.community_id AS primary_community_id
        FROM community_resident AS rs
        WHERE resident_id = ?`, [resident_id]
    );

    if (!resident) return resp.json({ status: 0, code: 404, message: 'Resident not found.' });

    const communities = await getCommunitiesForResident(resident_id);

    return resp.json({
        status  : 1,
        code    : 200,
        message : ["Resident Details fetched successfully!"],
        data    : { ...resident, communities },
    });
});

export const residentSearchMulti = asyncHandler(async (req, resp) => {
    const { search, community_id } = req.body;
    const { isValid, errors } = validateFields(mergeParam(req), {
        search       : ["required"],
        community_id : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const [list] = await db.execute(`
        SELECT cr.resident_id, cr.resident_name, cr.resident_mobile
        FROM community_resident AS cr
        INNER JOIN community_resident_map AS m ON m.resident_id = cr.resident_id
        WHERE m.community_id = ?
          AND (cr.resident_id LIKE ? OR cr.resident_name LIKE ? OR cr.resident_mobile LIKE ?)
        ORDER BY cr.resident_name ASC`,
        [community_id, `%${search}%`, `%${search}%`, `%${search}%`]
    );

    return resp.json({ status: 1, code: 200, message: '', data: list });
});

export const editResidentMulti = asyncHandler(async (req, resp) => {
    try {
        const {
            resident_id, resident_name, mobile_number, country_code = '+971', resident_email, community_ids,
            address, monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge
        } = req.body;

        const parsedCommunityIds = parseCommunityIds(community_ids);

        const { isValid, errors } = validateFields(req.body, {
            resident_id                : ["required"],
            resident_name              : ["required"],
            mobile_number              : ["required"],
            resident_email             : ["required"],
            address                    : ["required"],
            monthly_session_allocation : ["required"],
            alloted_time               : ["required"],
            kwh_allocated              : ["required"],
            per_kwh_charge             : ["required"],
            extra_charge               : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const communityCheck = await validateCommunityIds(parsedCommunityIds);
        if (!communityCheck.valid) {
            return resp.json({ status: 0, code: 422, message: communityCheck.message });
        }

        const existing = await queryDB('SELECT resident_id FROM community_resident WHERE resident_id = ?', [resident_id]);
        if (!existing) return resp.json({ status: 0, code: 404, message: 'Resident not found.' });

        const [duplicateCheck] = await db.query(`
            SELECT 'mobile' AS type FROM community_resident WHERE resident_mobile = ? AND resident_id != ?
            UNION
                SELECT 'email' AS type FROM community_resident WHERE resident_email = ? AND resident_id != ?`,
            [mobile_number, resident_id, resident_email, resident_id]
        );

        const types = duplicateCheck.map((row) => row.type);
        if (types.includes('mobile') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
        } else if (types.includes('mobile')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
        }

        const primaryCommunityId = communityCheck.communityIds[0];

        const updtObj = {
            resident_name,
            resident_email,
            country_code    : country_code || '+971',
            resident_mobile : mobile_number,
            community_id    : primaryCommunityId,
            address,
            monthly_session_allocation,
            alloted_time,
            kwh_allocated,
            per_kwh_charge,
            extra_charge,
        };

        const update = await updateRecord('community_resident', updtObj, ['resident_id'], [resident_id]);

        if (update.affectedRows > 0) {
            await syncResidentCommunities(resident_id, communityCheck.communityIds);
        }

        const communities = await getCommunitiesForResident(resident_id);

        return resp.json({
            status  : update.affectedRows > 0 ? 1 : 0,
            code    : 200,
            message : update.affectedRows > 0 ? "Resident updated successfully!" : "Failed to update, Please Try Again!",
            data    : { resident_id, communities },
        });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
