import { mergeParam, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';
import {
    getPartnerSessionHistoryAlertById,
    listPartnerSessionHistoryAlerts,
    mapSessionHistoryAlertRow,
} from '../admin/PartnerChargerSessionController.js';

export const alertList = asyncHandler(async (req, resp) => {
    const {
        station_id,
        page_no = 1,
        search_text = '',
        status = '',
        start_date = '',
        end_date = '',
    } = mergeParam(req);

    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const result = await listPartnerSessionHistoryAlerts({
        page_no,
        search_text,
        status,
        station_id,
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
});

export const alertDetails = asyncHandler(async (req, resp) => {
    const { station_id, alert_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        station_id: ['required'],
        alert_id: ['required'],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const row = await getPartnerSessionHistoryAlertById(alert_id, { station_id });
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