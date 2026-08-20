import moment from 'moment';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB } from '../../dbUtils.js';
import db from '../../config/db.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const assertCommunityAccess = (req, community_id, resp) => {
    if (req.manager && req.manager.community_id !== community_id) {
        resp.json({ status: 0, code: 403, message: 'Unauthorized access to this community.' });
        return false;
    }
    return true;
};

/**
 * Paginated scan-charge booking list for the manager's community
 */
export const bookingList = asyncHandler(async (req, resp) => {
    try {
        const {
            community_id,
            resident_id = '',
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

        const limit  = 10;
        const page   = (isNaN(page_no) || page_no < 1) ? 1 : parseInt(page_no, 10);
        const offset = (page * limit) - limit;

        const whereParts = [`(
            JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.community_id')) = ?
            OR JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.resident_id')) IN (
                SELECT resident_id FROM community_resident WHERE community_id = ?
            )
            OR scb.charger_id IN (
                SELECT charger_id FROM community_chargers WHERE community_id = ?
            )
        )`];
        const queryParams = [community_id, community_id, community_id];

        if (resident_id) {
            whereParts.push(`JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.resident_id')) = ?`);
            queryParams.push(resident_id);
        }

        if (start_date && end_date) {
            const start = moment(`${start_date} 00:00:01`, 'YYYY-MM-DD HH:mm:ss').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss');
            const end   = moment(end_date, 'YYYY-MM-DD').format('YYYY-MM-DD') + ' 19:59:59';
            whereParts.push('scb.created_at >= ? AND scb.created_at <= ?');
            queryParams.push(start, end);
        }

        if (search_text) {
            const like = `%${String(search_text).trim()}%`;
            whereParts.push(`(
                scb.booking_id LIKE ?
                OR scb.charger_id LIKE ?
                OR JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.resident_name')) LIKE ?
            )`);
            queryParams.push(like, like, like);
        }

        const whereSql = `WHERE ${whereParts.join(' AND ')}`;

        const [rows] = await db.execute(`
            SELECT SQL_CALC_FOUND_ROWS
                scb.booking_id,
                JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.resident_name')) AS resident_name,
                JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.community_name')) AS community_name,
                JSON_UNQUOTE(JSON_EXTRACT(scb.resident_data, '$.area_name')) AS area_name,
                scb.charger_id,
                scb.total_consumption,
                scb.total_duration,
                ${formatDateTimeInQuery(['scb.created_at'])},
                CASE
                    WHEN scb.status = 'S' THEN 'Start'
                    WHEN scb.status = 'C' THEN 'Stoped'
                    ELSE 'Unknown'
                END AS status
            FROM scan_charger_booking AS scb
            ${whereSql}
            ORDER BY scb.id DESC
            LIMIT ${offset}, ${limit}
        `, queryParams);

        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ['Booking list fetched successfully!'],
            data       : rows,
            total_page : totalPage,
            total,
        });
    } catch (error) {
        console.log('Error fetching community booking list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

/**
 * Scan-charge booking details — only if the booking belongs to the manager's community
 */
export const bookingDetail = asyncHandler(async (req, resp) => {
    try {
        const { community_id, session_id, booking_id } = mergeParam(req);
        const sessionId = session_id || booking_id;

        const { isValid, errors } = validateFields({ community_id, session_id: sessionId }, {
            community_id : ['required'],
            session_id   : ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertCommunityAccess(req, community_id, resp)) return;

        const booking = await queryDB(`
            SELECT
                booking_id, charger_id, total_consumption, total_duration, extra_minutes,
                start_time, end_time, start_kwh, end_kwh,
                ${formatDateTimeInQuery(['created_at'])},
                CASE WHEN status = 'S' THEN 'Started' ELSE 'Stoped' END AS session_status,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_id')) AS resident_id,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_name')) AS resident_name,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_mobile')) AS resident_mobile,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.community_id')) AS booking_community_id,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.community_name')) AS community_name,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.area_name')) AS area_name
            FROM scan_charger_booking
            WHERE booking_id = ?
            LIMIT 1
        `, [sessionId]);

        if (!booking) {
            return resp.json({ status: 0, code: 404, message: 'Booking not found.' });
        }

        const residentMatch = booking.resident_id
            ? await queryDB(
                `SELECT resident_id FROM community_resident WHERE community_id = ? AND resident_id = ? LIMIT 1`,
                [community_id, booking.resident_id]
            )
            : null;
        const chargerMatch = booking.charger_id
            ? await queryDB(
                `SELECT charger_id FROM community_chargers WHERE community_id = ? AND charger_id = ? LIMIT 1`,
                [community_id, booking.charger_id]
            )
            : null;

        if (booking.booking_community_id !== community_id && !residentMatch && !chargerMatch) {
            return resp.json({ status: 0, code: 403, message: 'Unauthorized access to this booking.' });
        }

        return resp.json({
            status  : 1,
            code    : 200,
            message : ['Booking details fetched successfully!'],
            data    : booking,
        });
    } catch (error) {
        console.log('Error fetching community booking details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
