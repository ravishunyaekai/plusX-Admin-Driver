import { formatDateTimeInQuery, formatDateInQuery, mergeParam, asyncHandler } from '../../utils.js';
import { queryDB, getPaginatedData } from '../../dbUtils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';
import { appendCreatedAtRangeWhere } from '../admin/PartnerChargerController.js';

export const chargerList = asyncHandler(async (req, resp) => {
    const {
        station_id,
        page_no = 1,
        search_text = '',
        admin_status = '',
        charger_status = '',
        status = '',
        start_date = '',
        end_date = '',
    } = mergeParam(req);
    const chargerStatusFilter = String(charger_status || admin_status || status || '').trim();

    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const whereField = ['pc.station_id', 'pc.status'];
    const whereValue = [station_id, 1];
    const whereOperator = ['=', '='];
    if (chargerStatusFilter) {
        whereField.push('pc.charger_status');
        whereValue.push(chargerStatusFilter);
        whereOperator.push('=');
    }
    appendCreatedAtRangeWhere(whereField, whereValue, whereOperator, start_date, end_date, 'pc.created_at');

    const result = await getPaginatedData({
        tableName: ' partner_chargers AS pc',
        joinTable: ' partner_charging_stations AS ps',
        joinCondition: 'pc.station_id = ps.station_id AND ps.status = 1',
        columns: `pc.charger_id, pc.station_id, ps.station_name, ps.station_type,
            pc.charging_type, pc.charger_type, pc.rated_power_kw, pc.connector_type, pc.connector_count,
            pc.charger_status, pc.online`,
        sortColumn: 'pc.id',
        sortOrder: 'DESC',
        page_no,
        liveSearchFields: ['pc.charger_id', 'pc.serial_number', 'ps.station_name'],
        liveSearchTexts: [search_text, search_text, search_text],
        limit: 10,
        whereField,
        whereValue,
        whereOperator,
    });

    return resp.json({
        status: 1,
        code: 200,
        message: ['Charger list fetched successfully!'],
        data: result.data,
        total_page: result.totalPage,
        total: result.total,
    });
});

export const chargerDetails = asyncHandler(async (req, resp) => {
    const { station_id, charger_id } = mergeParam(req);

    const { isValid, errors } = validateFields(mergeParam(req), {
        station_id: ['required'],
        charger_id: ['required'],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const charger = await queryDB(`
        SELECT
            pc.charger_id, pc.station_id, ps.station_name, pc.rated_power_kw, pc.charging_type,
            pc.unit_price_aed, pc.charging_mode, pc.manufacturer, pc.model, pc.serial_number,
            pc.charger_type, pc.connector_type, pc.connector_count, pc.input_supply,
            pc.max_output_voltage_v, ${formatDateInQuery(['pc.installation_date'])},
            pc.sim_iccid, pc.imei, pc.charger_status, pc.online, pc.status,
            ${formatDateTimeInQuery(['pc.created_at', 'pc.updated_at'])}
        FROM partner_chargers AS pc
        LEFT JOIN partner_charging_stations AS ps
            ON ps.station_id = pc.station_id AND ps.status = 1
        WHERE pc.charger_id = ? AND pc.station_id = ? AND pc.status = 1
        LIMIT 1
    `, [charger_id, station_id]);

    if (!charger) {
        return resp.json({ status: 0, code: 404, message: 'Charger not found.' });
    }

    return resp.json({
        status: 1,
        code: 200,
        message: ['Charger details fetched successfully!'],
        data: charger,
    });
});