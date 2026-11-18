import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';

export const chargerList = asyncHandler(async (req, resp) => {
    try {
        const { station_id, page_no = 1, search_text = '' } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertStationScope(req, station_id, resp)) return;

        const result = await getPaginatedData({
            tableName: ' partner_chargers AS pc',
            columns: `pc.charger_id, pc.charger_name, pc.charger_type, pc.rated_power_kw,
                pc.connector_type, pc.connector_count, pc.admin_status`,
            sortColumn: 'pc.id',
            sortOrder: 'DESC',
            page_no,
            liveSearchFields: ['pc.charger_id', 'pc.charger_name'],
            liveSearchTexts: [search_text, search_text],
            limit: 10,
            whereField: ['pc.station_id', 'pc.status'],
            whereValue: [station_id, 1],
            whereOperator: ['=', '='],
        });

        return resp.json({
            status: 1,
            code: 200,
            message: ['Charger list fetched successfully!'],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('Station master charger list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const chargerDetail = asyncHandler(async (req, resp) => {
    try {
        const { station_id, charger_id } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            station_id: ['required'],
            charger_id: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (!assertStationScope(req, station_id, resp)) return;

        const charger = await queryDB(`
            SELECT
                charger_id, charger_name, station_id, manufacturer, model, serial_number,
                charger_type, rated_power_kw, connector_type, connector_count, input_supply,
                max_output_voltage_v, admin_status,
                ${formatDateTimeInQuery(['created_at', 'updated_at'])}
            FROM partner_chargers
            WHERE charger_id = ? AND station_id = ? AND status = 1
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
    } catch (error) {
        console.error('Station master charger detail:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});