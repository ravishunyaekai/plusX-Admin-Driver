import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { getPaginatedData, queryDB, updateRecord } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';
import moment from 'moment';
import { appendCreatedAtRangeWhere, resolvePartnerListCreatedAtRange } from './PartnerChargerController.js';

const ALERT_ADMIN_STATUSES = ['Open', 'Acknowledged', 'Resolved'];

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

/** PlusX: fill station on IoT session rows from partner_chargers. */
export async function backfillPartnerSessionStations() {
    await db.execute(`
        UPDATE partner_charger_session_history AS sh
        INNER JOIN partner_chargers AS pc ON pc.charger_id = sh.charger_id AND pc.status = 1
        INNER JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
        SET sh.station_id = ps.station_id,
            sh.station_name = ps.station_name
        WHERE sh.station_id IS NULL OR sh.station_name IS NULL
    `);
}

export const sessionGroupSubquery = `
    SELECT
        charger_id,
        session_id,
        MAX(station_id) AS station_id,
        MAX(station_name) AS station_name,
        MIN(created_at) AS start_time,
        MAX(created_at) AS end_time,
        TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) AS duration_seconds
    FROM partner_charger_session_history
    GROUP BY charger_id, session_id
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
        await backfillPartnerSessionStations();

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
        await backfillPartnerSessionStations();

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
                charger_id,
                session_id,
                CONCAT('S-', session_id) AS display_session_id,
                MAX(station_id) AS station_id,
                MAX(station_name) AS station_name,
                MIN(created_at) AS start_time_raw,
                MAX(created_at) AS end_time_raw,
                TIMESTAMPDIFF(SECOND, MIN(created_at), MAX(created_at)) AS duration_seconds
            FROM partner_charger_session_history
            WHERE charger_id = ? AND session_id = ?
            GROUP BY charger_id, session_id
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

export const partnerChargerAlertList = async (req, resp) => {
    try {
        const {
            page_no = 1,
            search_text = '',
            admin_status = '',
            severity = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);

        const whereField = ['status'];
        const whereValue = [1];
        const whereOperator = ['='];

        if (admin_status) {
            whereField.push('admin_status');
            whereValue.push(String(admin_status).trim());
            whereOperator.push('=');
        }
        if (severity) {
            whereField.push('severity');
            whereValue.push(String(severity).trim());
            whereOperator.push('=');
        }
        appendCreatedAtRangeWhere(whereField, whereValue, whereOperator, start_date, end_date, 'created_at');

        const params = {
            tableName: ' partner_charger_alerts',
            columns: `alert_id, charger_id, station_name, title,
                ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn: 'id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['charger_id', 'station_name', 'title'],
            liveSearchTexts: [search_text, search_text, search_text],
            whereField,
            whereValue,
            whereOperator,
        };

        const result = await getPaginatedData(params);
        const data = result.data.map((row) => ({
            alert_id: row.alert_id,
            time: row.created_at,
            message: row.title,
            station_name: row.station_name,
            charger_id: row.charger_id,
        }));

        return resp.json({
            status: 1,
            code: 200,
            message: ['Alert list fetched successfully!'],
            data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('partnerChargerAlertList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const partnerChargerAlertDetail = asyncHandler(async (req, resp) => {
    const { alert_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { alert_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const alert = await queryDB(
        `
        SELECT alert_id, charger_id, station_id, station_name, connector_id,
            alert_type, severity, error_code, title, description, admin_status,
            ${formatDateTimeInQuery(['created_at', 'updated_at'])}
        FROM partner_charger_alerts
        WHERE alert_id = ? AND status = 1
        `,
        [alert_id]
    );
    if (!alert) {
        return resp.json({ status: 0, code: 404, message: ['Alert not found.'] });
    }

    return resp.json({
        status: 1,
        code: 200,
        message: ['Alert details fetched successfully!'],
        data: alert,
        alertAdminStatuses: ALERT_ADMIN_STATUSES,
    });
});

export const partnerChargerAlertUpdate = asyncHandler(async (req, resp) => {
    const { alert_id, admin_status } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { alert_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    if (!admin_status || !ALERT_ADMIN_STATUSES.includes(String(admin_status).trim())) {
        return resp.json({
            status: 0,
            code: 422,
            message: ['Administrative Status is invalid.'],
        });
    }

    const exists = await queryDB(
        `SELECT id FROM partner_charger_alerts WHERE alert_id = ? AND status = 1`,
        [alert_id]
    );
    if (!exists) return resp.json({ status: 0, code: 404, message: ['Alert not found.'] });

    await updateRecord(
        'partner_charger_alerts',
        { admin_status: String(admin_status).trim() },
        ['alert_id'],
        [alert_id]
    );

    return resp.json({ status: 1, code: 200, message: ['Alert updated successfully!'] });
});