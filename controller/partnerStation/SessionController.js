import db from '../../config/db.js';
import { formatDateTimeInQuery, mergeParam, asyncHandler } from '../../utils.js';
import { queryDB } from '../../dbUtils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';
import moment from 'moment';
import { resolvePartnerListCreatedAtRange } from '../admin/PartnerChargerController.js';
import {
    formatDurationSeconds,
    parseDisplaySessionId,
    sessionUserLabel,
    resolveSessionEnergyKwh,
    sessionGroupSubquery,
    latestStatusJoin,
} from '../admin/PartnerChargerSessionController.js';

export const sessionList = asyncHandler(async (req, resp) => {
    const {
        station_id,
        page_no = 1,
        search_text = '',
        start_date = '',
        end_date = '',
        status = '',
    } = mergeParam(req);

    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const limit = 10;
    const offset = (Math.max(Number(page_no), 1) - 1) * limit;
    const params = [String(station_id).trim()];
    let where = ' WHERE g.station_id = ? ';

    if (search_text) {
        const like = `%${String(search_text).trim()}%`;
        where += ` AND (
            g.charger_id LIKE ? OR g.session_id LIKE ? OR CONCAT('S-', g.session_id) LIKE ?
        )`;
        params.push(like, like, like);
    }
    const createdRange = resolvePartnerListCreatedAtRange(start_date, end_date);
    if (createdRange) {
        where += ' AND g.start_time >= ? AND g.start_time <= ?';
        params.push(createdRange.start, createdRange.end);
    }

    const statusFilter = String(status ?? '').trim();
    const filterByStatus = Boolean(statusFilter);
    if (filterByStatus) {
        where += ' AND LOWER(ls.status) = LOWER(?)';
        params.push(statusFilter);
    }

    const statusJoin = filterByStatus ? latestStatusJoin : '';
    const countSql = `
        SELECT COUNT(*) AS total
        FROM (${sessionGroupSubquery}) AS g
        ${statusJoin}
        ${where}
    `;
    const [[{ total }]] = await db.execute(countSql, params);

    const listSql = `
        SELECT
            g.charger_id,
            g.session_id,
            CONCAT('S-', g.session_id) AS display_session_id,
            g.station_id,
            g.station_name,
            ${formatDateTimeInQuery(['g.start_time', 'g.end_time'])},
            g.duration_seconds,
            ls.status,
            ls.error_code,
            ls.connector_id
        FROM (${sessionGroupSubquery}) AS g
        ${latestStatusJoin}
        ${where}
        ORDER BY g.start_time DESC
        LIMIT ${limit} OFFSET ${offset}
    `;
    const [rows] = await db.execute(listSql, params);

    const data = rows.map((row) => ({
        ...row,
        user: sessionUserLabel(row.station_id, row.station_name),
        duration: formatDurationSeconds(row.duration_seconds),
    }));

    const totalNum = Number(total) || 0;
    return resp.json({
        status: 1,
        code: 200,
        message: ['Session list fetched successfully!'],
        data,
        total: totalNum,
        total_page: Math.max(Math.ceil(totalNum / limit), 1),
    });
});

export const sessionDetails = asyncHandler(async (req, resp) => {
    const body = mergeParam(req);
    let { station_id, charger_id, session_id, display_session_id } = body;

    if (!session_id && display_session_id) {
        session_id = parseDisplaySessionId(display_session_id);
    }

    const { isValid, errors } = validateFields(body, {
        station_id: ['required'],
        charger_id: ['required'],
    });
    if (!session_id) {
        errors.push('session_id is required.');
    }
    if (!isValid || !session_id) {
        return resp.json({ status: 0, code: 422, message: errors });
    }
    if (!assertStationScope(req, station_id, resp)) return;

    const summary = await queryDB(
        `
        SELECT
            sh.charger_id,
            sh.session_id,
            CONCAT('S-', sh.session_id) AS display_session_id,
            MAX(pc.station_id) AS station_id,
            MAX(ps.station_name) AS station_name,
            MIN(sh.created_at) AS start_time_raw,
            MAX(sh.created_at) AS end_time_raw,
            TIMESTAMPDIFF(SECOND, MIN(sh.created_at), MAX(sh.created_at)) AS duration_seconds
        FROM partner_charger_session_history AS sh
        LEFT JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
        LEFT JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
        WHERE sh.charger_id = ? AND sh.session_id = ?
        GROUP BY sh.charger_id, sh.session_id
        `,
        [charger_id, session_id]
    );
    if (!summary || String(summary.station_id) !== String(station_id).trim()) {
        return resp.json({ status: 0, code: 404, message: ['Session not found.'] });
    }

    const [events] = await db.execute(
        `
        SELECT id, connector_id, error_code, status,
            ${formatDateTimeInQuery(['created_at'])}
        FROM partner_charger_session_history
        WHERE charger_id = ? AND session_id = ?
        ORDER BY created_at ASC, id ASC
        `,
        [charger_id, session_id]
    );

    const energy_kwh = await resolveSessionEnergyKwh(
        charger_id,
        summary.start_time_raw,
        summary.end_time_raw
    );

    const [samples] = await db.execute(
        `
        SELECT energy, power, voltage, current, connector_id,
            ${formatDateTimeInQuery(['created_at'])}
        FROM partner_charger_data_history
        WHERE charger_id = ?
          AND created_at >= ?
          AND created_at <= ?
        ORDER BY created_at ASC
        LIMIT 50
        `,
        [charger_id, summary.start_time_raw, summary.end_time_raw]
    );

    const start_time = summary.start_time_raw
        ? moment(summary.start_time_raw).format('YYYY-MM-DD HH:mm:ss')
        : null;
    const end_time = summary.end_time_raw
        ? moment(summary.end_time_raw).format('YYYY-MM-DD HH:mm:ss')
        : null;

    return resp.json({
        status: 1,
        code: 200,
        message: ['Session details fetched successfully!'],
        data: {
            charger_id: summary.charger_id,
            session_id: summary.session_id,
            display_session_id: summary.display_session_id,
            station_id: summary.station_id,
            station_name: summary.station_name,
            user: sessionUserLabel(summary.station_id, summary.station_name),
            start_time,
            end_time,
            duration: formatDurationSeconds(summary.duration_seconds),
            latest_status: events.length ? events[events.length - 1].status : null,
            latest_error_code: events.length ? events[events.length - 1].error_code : null,
            energy_kwh,
            events,
            meter_samples: samples,
        },
    });
});