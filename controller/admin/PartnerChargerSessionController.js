import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';
import moment from 'moment';
import { resolvePartnerListCreatedAtRange } from './PartnerChargerController.js';

const SESSION_ALERT_ERROR_PREDICATE = `sh.error_code IS NOT NULL AND TRIM(sh.error_code) <> ''`;

const sessionHistoryStationJoin = `
    LEFT JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
    LEFT JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
`;

/** Alerts = session history rows where IoT set a human-readable error_code (fault message). */
export const mapSessionHistoryAlertRow = (row) => ({
    alert_id: String(row.id),
    id: row.id,
    time: row.created_at,
    message: row.error_code,
    title: row.error_code,
    error_code: row.error_code,
    station_name: row.station_name,
    station_id: row.station_id,
    charger_id: row.charger_id,
    session_id: row.session_id,
    display_session_id: row.session_id ? `S-${row.session_id}` : '',
    connector_id: row.connector_id,
    status: row.status,
    created_at: row.created_at,
});

export async function listPartnerSessionHistoryAlerts({
    page_no = 1,
    search_text = '',
    status = '',
    station_id = '',
    start_date = '',
    end_date = '',
    limit = 10,
} = {}) {
    const pageSize = Math.max(Number(limit) || 10, 1);
    const offset = (Math.max(Number(page_no), 1) - 1) * pageSize;
    const params = [];
    let where = ` WHERE ${SESSION_ALERT_ERROR_PREDICATE} `;

    if (station_id) {
        where += ' AND pc.station_id = ?';
        params.push(String(station_id).trim());
    }
    if (status) {
        where += ' AND LOWER(sh.status) = LOWER(?)';
        params.push(String(status).trim());
    }
    if (search_text) {
        const like = `%${String(search_text).trim()}%`;
        where += ` AND (
            sh.error_code LIKE ? OR sh.charger_id LIKE ? OR ps.station_name LIKE ?
            OR sh.session_id LIKE ? OR CONCAT('S-', sh.session_id) LIKE ?
        )`;
        params.push(like, like, like, like, like);
    }
    const createdRange = resolvePartnerListCreatedAtRange(start_date, end_date);
    if (createdRange) {
        where += ' AND sh.created_at >= ? AND sh.created_at <= ?';
        params.push(createdRange.start, createdRange.end);
    }

    const countSql = `
        SELECT COUNT(*) AS total
        FROM partner_charger_session_history AS sh
        ${sessionHistoryStationJoin}
        ${where}
    `;
    const [[{ total }]] = await db.execute(countSql, params);

    const listSql = `
        SELECT
            sh.id, sh.charger_id, sh.session_id, sh.connector_id, sh.error_code, sh.status,
            pc.station_id, ps.station_name,
            ${formatDateTimeInQuery(['sh.created_at'])}
        FROM partner_charger_session_history AS sh
        ${sessionHistoryStationJoin}
        ${where}
        ORDER BY sh.created_at DESC
        LIMIT ${pageSize} OFFSET ${offset}
    `;
    const [rows] = await db.execute(listSql, params);
    const totalNum = Number(total) || 0;

    return {
        data: rows.map(mapSessionHistoryAlertRow),
        total: totalNum,
        totalPage: Math.max(Math.ceil(totalNum / pageSize), 1),
    };
}

export async function getPartnerSessionHistoryAlertById(alertId, { station_id = '' } = {}) {
    const id = Number(alertId);
    if (!Number.isFinite(id) || id <= 0) return null;

    const params = [id];
    let where = ` WHERE sh.id = ? AND ${SESSION_ALERT_ERROR_PREDICATE} `;
    if (station_id) {
        where += ' AND pc.station_id = ?';
        params.push(String(station_id).trim());
    }

    return queryDB(
        `
        SELECT
            sh.id, sh.charger_id, sh.session_id, sh.connector_id, sh.error_code, sh.status,
            pc.station_id, ps.station_name,
            ${formatDateTimeInQuery(['sh.created_at'])}
        FROM partner_charger_session_history AS sh
        ${sessionHistoryStationJoin}
        ${where}
        LIMIT 1
        `,
        params
    );
}

export const formatDurationSeconds = (seconds) => {
    const sec = Math.max(Number(seconds) || 0, 0);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
};

export const parseDisplaySessionId = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/^S-/i.test(s)) return s.slice(2);
    return s;
};

/** Session list "User" column — station identity (no app rider). */
export const sessionUserLabel = (stationId, stationName) => {
    const sid = String(stationId ?? '').trim();
    const sname = String(stationName ?? '').trim();
    if (sid && sname) return `${sid} — ${sname}`;
    return sid || sname || null;
};

/** kWh delivered in session window from cumulative meter readings */
export async function resolveSessionEnergyKwh(chargerId, startRaw, endRaw) {
    const [rows] = await db.execute(
        `
        SELECT energy
        FROM partner_charger_data_history
        WHERE charger_id = ?
          AND created_at >= ?
          AND created_at <= ?
          AND energy IS NOT NULL
        ORDER BY created_at ASC
        `,
        [chargerId, startRaw, endRaw]
    );
    if (!rows.length) return null;

    const values = rows.map((r) => Number(r.energy)).filter((n) => Number.isFinite(n));
    if (!values.length) return null;
    if (values.length === 1) return values[0];

    const delta = values[values.length - 1] - values[0];
    if (Number.isFinite(delta) && delta > 0) {
        return Math.round(delta * 10000) / 10000;
    }

    const secondLast = values[values.length - 2];
    return Number.isFinite(secondLast) ? secondLast : values[values.length - 1];
}

export const sessionGroupSubquery = `
    SELECT
        sh.charger_id,
        sh.session_id,
        MAX(pc.station_id) AS station_id,
        MAX(ps.station_name) AS station_name,
        MIN(sh.created_at) AS start_time,
        MAX(sh.created_at) AS end_time,
        TIMESTAMPDIFF(SECOND, MIN(sh.created_at), MAX(sh.created_at)) AS duration_seconds
    FROM partner_charger_session_history AS sh
    LEFT JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
    LEFT JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
    GROUP BY sh.charger_id, sh.session_id
`;

export const latestStatusJoin = `
    LEFT JOIN (
        SELECT sh.charger_id, sh.session_id, sh.status, sh.error_code, sh.connector_id
        FROM partner_charger_session_history AS sh
        INNER JOIN (
            SELECT charger_id, session_id, MAX(id) AS max_id
            FROM partner_charger_session_history
            GROUP BY charger_id, session_id
        ) AS latest ON latest.max_id = sh.id
    ) AS ls ON ls.charger_id = g.charger_id AND ls.session_id = g.session_id
`;

export const partnerChargerSessionList = asyncHandler(async (req, resp) => {
    try {
        const {
            page_no = 1,
            search_text = '',
            start_date = '',
            end_date = '',
            station_id = '',
            status = '',
        } = mergeParam(req);

        const limit = 10;
        const offset = (Math.max(Number(page_no), 1) - 1) * limit;
        const params = [];
        let where = ' WHERE 1=1 ';

        if (search_text) {
            const like = `%${String(search_text).trim()}%`;
            where += ` AND (
                g.charger_id LIKE ? OR g.session_id LIKE ? OR CONCAT('S-', g.session_id) LIKE ?
                OR g.station_id LIKE ? OR g.station_name LIKE ?
                OR CONCAT(IFNULL(g.station_id, ''), ' — ', IFNULL(g.station_name, '')) LIKE ?
            )`;
            params.push(like, like, like, like, like, like);
        }
        if (station_id) {
            where += ' AND g.station_id = ?';
            params.push(String(station_id).trim());
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
    } catch (error) {
        console.error('partnerChargerSessionList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerChargerSessionDetail = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        let { charger_id, session_id, display_session_id } = body;

        if (!session_id && display_session_id) {
            session_id = parseDisplaySessionId(display_session_id);
        }

        const { isValid, errors } = validateFields(body, {
            charger_id: ['required'],
        });
        if (!session_id) {
            errors.push('session_id is required.');
        }
        if (!isValid || !session_id) {
            return resp.json({ status: 0, code: 422, message: errors });
        }

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
        if (!summary) {
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
    } catch (error) {
        console.error('partnerChargerSessionDetail:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerChargerAlertList = asyncHandler(async (req, resp) => {
    try {
        const {
            page_no = 1,
            search_text = '',
            status = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);

        const result = await listPartnerSessionHistoryAlerts({
            page_no,
            search_text,
            status,
            start_date,
            end_date,
            limit: 10,
        });

        return resp.json({
            status: 1,
            code: 200,
            message: ['Alert list fetched successfully!'],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('partnerChargerAlertList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerChargerAlertDetail = asyncHandler(async (req, resp) => {
    const { alert_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { alert_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const row = await getPartnerSessionHistoryAlertById(alert_id);
    if (!row) {
        return resp.json({ status: 0, code: 404, message: ['Alert not found.'] });
    }

    const mapped = mapSessionHistoryAlertRow(row);
    return resp.json({
        status: 1,
        code: 200,
        message: ['Alert details fetched successfully!'],
        data: {
            ...mapped,
            alert_type: 'Session fault',
            description: mapped.display_session_id
                ? `Session ${mapped.display_session_id} on connector ${mapped.connector_id ?? '—'}`
                : null,
        },
    });
});

/** Session alerts are IoT insert-only; admin status is not stored on session history. */
export const partnerChargerAlertUpdate = asyncHandler(async (req, resp) => {
    return resp.json({
        status: 0,
        code: 422,
        message: ['Alerts are recorded from session events and cannot be updated.'],
    });
});