import { formatDateTimeInQuery, mergeParam, asyncHandler } from '../../utils.js';
import { queryDB, getPaginatedData } from '../../dbUtils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';
import { appendCreatedAtRangeWhere } from '../admin/PartnerChargerController.js';

const ALERT_ADMIN_STATUSES = ['Open', 'Acknowledged', 'Resolved'];

export const alertList = asyncHandler(async (req, resp) => {
    const {
        station_id,
        page_no = 1,
        search_text = '',
        admin_status = '',
        severity = '',
        start_date = '',
        end_date = '',
    } = mergeParam(req);

    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const whereField = ['status', 'station_id'];
    const whereValue = [1, String(station_id).trim()];
    const whereOperator = ['=', '='];

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

    const result = await getPaginatedData({
        tableName: ' partner_charger_alerts',
        columns: `alert_id, charger_id, station_name, title,
            ${formatDateTimeInQuery(['created_at'])}`,
        sortColumn: 'id',
        sortOrder: 'DESC',
        page_no,
        limit: 10,
        liveSearchFields: ['charger_id', 'title'],
        liveSearchTexts: [search_text, search_text],
        whereField,
        whereValue,
        whereOperator,
    });

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
});

export const alertDetails = asyncHandler(async (req, resp) => {
    const { station_id, alert_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        station_id: ['required'],
        alert_id: ['required'],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const alert = await queryDB(
        `
        SELECT alert_id, charger_id, station_id, station_name, connector_id,
            alert_type, severity, error_code, title, description, admin_status,
            ${formatDateTimeInQuery(['created_at', 'updated_at'])}
        FROM partner_charger_alerts
        WHERE alert_id = ? AND station_id = ? AND status = 1
        `,
        [alert_id, String(station_id).trim()]
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