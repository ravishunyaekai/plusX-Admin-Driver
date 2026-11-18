import bcrypt from 'bcryptjs';
import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const STATION_TYPES = [
    'Public Station',
    'Private Station',
    'Commercial Hub',
    'Residential Community',
];

const OPERATING_HOURS = ['24 x 7', '6 AM - 10 PM', '9 AM - 9 PM', 'Custom Schedule'];

const ADMIN_STATUSES = ['Active', 'Inactive', 'Pending approval', 'Under maintenance'];

const CHARGER_TYPES = ['AC', 'DC'];

const CONNECTOR_TYPES = ['Type 2', 'CCS2', 'CHAdeMO', 'GB/T', 'Type 1'];

const INPUT_SUPPLY_OPTIONS = [
    'Single Phase',
    'Three Phase',
    'Industrial',
];

const STATION_DETAIL_COLUMNS = `
    station_id, station_name, station_type, operator_name, address, city, state_emirate,
    country, postal_code, latitude, longitude, contact_person, contact_number,
    operating_hours, admin_status, description, master_email, status,
    ${formatDateTimeInQuery(['created_at', 'updated_at'])}
`;

const CHARGER_DETAIL_COLUMNS = `
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, admin_status, status,
    ${formatDateTimeInQuery(['created_at', 'updated_at'])}
`;

const stationEnumPayload = () => ({
    stationTypes: STATION_TYPES,
    operatingHours: OPERATING_HOURS,
    adminStatuses: ADMIN_STATUSES,
});

const chargerEnumPayload = () => ({
    chargerTypes: CHARGER_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    inputSupplyOptions: INPUT_SUPPLY_OPTIONS,
    adminStatuses: ADMIN_STATUSES,
});

async function assertStationExists(station_id, resp) {
    const row = await queryDB(
        `SELECT station_id FROM partner_charging_stations WHERE station_id = ? AND status = 1 LIMIT 1`,
        [station_id]
    );
    if (!row) {
        resp.json({ status: 0, code: 404, message: ['Station not found.'] });
        return false;
    }
    return true;
}

async function checkDuplicateStation(station_id, master_email, excludeStationId = null) {
    let sql = `
        SELECT 'station_id' AS field FROM partner_charging_stations
        WHERE station_id = ? AND status = 1`;
    const params = [station_id];

    if (excludeStationId) {
        sql += ` AND station_id != ?`;
        params.push(excludeStationId);
    }

    sql += `
        UNION
        SELECT 'master_email' AS field FROM partner_charging_stations
        WHERE master_email = ? AND status = 1`;
    params.push(master_email);

    if (excludeStationId) {
        sql += ` AND station_id != ?`;
        params.push(excludeStationId);
    }

    const [rows] = await db.execute(sql, params);
    return rows.map((r) => r.field);
}

async function checkDuplicateCharger(charger_id, excludeChargerId = null) {
    let sql = `SELECT charger_id FROM partner_chargers WHERE charger_id = ? AND status = 1`;
    const params = [charger_id];
    if (excludeChargerId) {
        sql += ` AND charger_id != ?`;
        params.push(excludeChargerId);
    }
    const [rows] = await db.execute(sql, params);
    return rows.length > 0;
}

async function activeStationsForDropdown() {
    const [rows] = await db.execute(`
        SELECT station_id, station_name
        FROM partner_charging_stations
        WHERE status = 1
        ORDER BY station_name ASC
    `);
    return rows;
}

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export const partnerStationList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        const params = {
            tableName: ' partner_charging_stations AS ps',
            columns: `ps.station_id, ps.station_name, ps.city, ps.contact_number, ps.admin_status,
                (SELECT COUNT(*) FROM partner_chargers AS pc
                    WHERE pc.station_id = ps.station_id AND pc.status = 1) AS charger_count`,
            sortColumn: 'ps.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['ps.station_id', 'ps.station_name', 'ps.city'],
            liveSearchTexts: [search_text, search_text, search_text],
            whereField: ['ps.status'],
            whereValue: [1],
            whereOperator: ['='],
        };
        const result = await getPaginatedData(params);
        return resp.json({
            status: 1,
            code: 200,
            message: ['Station list fetched successfully!'],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('partnerStationList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const partnerStationFormData = asyncHandler(async (req, resp) => {
    const { station_id } = mergeParam(req);
    const payload = { ...stationEnumPayload(), stations: await activeStationsForDropdown() };

    if (station_id) {
        const station = await queryDB(
            `SELECT ${STATION_DETAIL_COLUMNS} FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
            [station_id]
        );
        if (!station) {
            return resp.json({ status: 0, code: 404, message: ['Station not found.'] });
        }
        payload.stationData = station;
    }

    return resp.json({ status: 1, code: 200, message: ['Station form data fetched successfully!'], data: payload });
});

export const partnerStationDetail = asyncHandler(async (req, resp) => {
    const { station_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const station = await queryDB(
        `SELECT ${STATION_DETAIL_COLUMNS},
            (SELECT COUNT(*) FROM partner_chargers WHERE station_id = ? AND status = 1) AS charger_count
         FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
        [station_id, station_id]
    );
    if (!station) return resp.json({ status: 0, code: 404, message: ['Station not found.'] });

    return resp.json({
        status: 1,
        code: 200,
        message: ['Station details fetched successfully!'],
        data: station,
        ...stationEnumPayload(),
    });
});

export const partnerStationAdd = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const {
            station_id,
            station_name,
            address,
            city,
            country,
            master_email,
            master_password,
            station_type = '',
            operator_name = '',
            state_emirate = '',
            postal_code = '',
            latitude = null,
            longitude = null,
            contact_person = '',
            contact_number = '',
            operating_hours = '',
            admin_status = 'Active',
            description = '',
        } = body;

        const { isValid, errors } = validateFields(body, {
            station_id: ['required'],
            station_name: ['required'],
            address: ['required'],
            city: ['required'],
            country: ['required'],
            master_email: ['required'],
            master_password: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        if (String(master_password).length < 6) {
            return resp.json({ status: 0, code: 422, message: ['Password must be at least 6 characters'] });
        }

        const dupFields = await checkDuplicateStation(station_id, master_email);
        if (dupFields.includes('station_id')) {
            return resp.json({ status: 0, code: 422, message: ['Station ID already exists'] });
        }
        if (dupFields.includes('master_email')) {
            return resp.json({ status: 0, code: 422, message: ['Station master email already exists'] });
        }

        const hashed = await bcrypt.hash(master_password, 10);

        const insert = await insertRecord(
            'partner_charging_stations',
            [
                'station_id', 'station_name', 'station_type', 'operator_name', 'address', 'city',
                'state_emirate', 'country', 'postal_code', 'latitude', 'longitude', 'contact_person',
                'contact_number', 'operating_hours', 'admin_status', 'description', 'master_email',
                'master_password', 'status',
            ],
            [
                station_id,
                station_name,
                station_type || null,
                operator_name || null,
                address,
                city,
                state_emirate || null,
                country,
                postal_code || null,
                latitude === '' || latitude == null ? null : latitude,
                longitude === '' || longitude == null ? null : longitude,
                contact_person || null,
                contact_number || null,
                operating_hours || null,
                admin_status,
                description || null,
                master_email,
                hashed,
                1,
            ]
        );

        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add station. Please try again.'] });
        }

        return resp.json({ status: 1, code: 200, message: ['Station added successfully!'] });
    } catch (error) {
        console.error('partnerStationAdd:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerStationEdit = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const {
            station_id,
            station_name,
            address,
            city,
            country,
            master_email,
            master_password,
            station_type = '',
            operator_name = '',
            state_emirate = '',
            postal_code = '',
            latitude = null,
            longitude = null,
            contact_person = '',
            contact_number = '',
            operating_hours = '',
            admin_status = 'Active',
            description = '',
        } = body;

        const { isValid, errors } = validateFields(body, {
            station_id: ['required'],
            station_name: ['required'],
            address: ['required'],
            city: ['required'],
            country: ['required'],
            master_email: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        if (master_password && String(master_password).length < 6) {
            return resp.json({ status: 0, code: 422, message: ['Password must be at least 6 characters'] });
        }

        const exists = await queryDB(
            `SELECT id FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
            [station_id]
        );
        if (!exists) return resp.json({ status: 0, code: 404, message: ['Station not found.'] });

        const dupFields = await checkDuplicateStation(station_id, master_email, station_id);
        if (dupFields.includes('master_email')) {
            return resp.json({ status: 0, code: 422, message: ['Station master email already exists'] });
        }

        const updates = {
            station_name,
            station_type: station_type || null,
            operator_name: operator_name || null,
            address,
            city,
            state_emirate: state_emirate || null,
            country,
            postal_code: postal_code || null,
            latitude: latitude === '' || latitude == null ? null : latitude,
            longitude: longitude === '' || longitude == null ? null : longitude,
            contact_person: contact_person || null,
            contact_number: contact_number || null,
            operating_hours: operating_hours || null,
            admin_status,
            description: description || null,
            master_email,
        };

        if (master_password) {
            updates.master_password = await bcrypt.hash(master_password, 10);
        }

        await updateRecord('partner_charging_stations', updates, ['station_id'], [station_id]);

        return resp.json({ status: 1, code: 200, message: ['Station updated successfully!'] });
    } catch (error) {
        console.error('partnerStationEdit:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const allPartnerStationList = asyncHandler(async (req, resp) => {
    const stations = await activeStationsForDropdown();
    return resp.json({
        status: 1,
        code: 200,
        message: ['Station list fetched successfully!'],
        data: stations,
    });
});

// ---------------------------------------------------------------------------
// Chargers
// ---------------------------------------------------------------------------

export const partnerChargerList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        const params = {
            tableName: ' partner_chargers AS pc',
            joinTable: ' partner_charging_stations AS ps',
            joinCondition: 'pc.station_id = ps.station_id AND ps.status = 1',
            columns: `pc.charger_id, pc.charger_name, ps.station_name, pc.station_id,
                pc.charger_type, pc.rated_power_kw, pc.connector_type, pc.connector_count,
                pc.admin_status`,
            sortColumn: 'pc.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['pc.charger_id', 'pc.charger_name', 'ps.station_name'],
            liveSearchTexts: [search_text, search_text, search_text],
            whereField: ['pc.status'],
            whereValue: [1],
            whereOperator: ['='],
        };
        const result = await getPaginatedData(params);
        return resp.json({
            status: 1,
            code: 200,
            message: ['Charger list fetched successfully!'],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('partnerChargerList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const partnerChargerFormData = asyncHandler(async (req, resp) => {
    const { charger_id } = mergeParam(req);
    const payload = {
        ...chargerEnumPayload(),
        stations: await activeStationsForDropdown(),
    };

    if (charger_id) {
        const charger = await queryDB(
            `SELECT ${CHARGER_DETAIL_COLUMNS} FROM partner_chargers WHERE charger_id = ? AND status = 1`,
            [charger_id]
        );
        if (!charger) {
            return resp.json({ status: 0, code: 404, message: ['Charger not found.'] });
        }
        payload.chargerData = charger;
    }

    return resp.json({ status: 1, code: 200, message: ['Charger form data fetched successfully!'], data: payload });
});

export const partnerChargerDetail = asyncHandler(async (req, resp) => {
    const { charger_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { charger_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const charger = await queryDB(
        `SELECT pc.charger_id, pc.charger_name, pc.station_id, ps.station_name,
            pc.manufacturer, pc.model, pc.serial_number, pc.charger_type, pc.rated_power_kw,
            pc.connector_type, pc.connector_count, pc.input_supply, pc.max_output_voltage_v,
            pc.admin_status, pc.status,
            ${formatDateTimeInQuery(['pc.created_at', 'pc.updated_at'])}
         FROM partner_chargers AS pc
         LEFT JOIN partner_charging_stations AS ps ON ps.station_id = pc.station_id AND ps.status = 1
         WHERE pc.charger_id = ? AND pc.status = 1`,
        [charger_id]
    );
    if (!charger) return resp.json({ status: 0, code: 404, message: ['Charger not found.'] });

    return resp.json({
        status: 1,
        code: 200,
        message: ['Charger details fetched successfully!'],
        data: charger,
        ...chargerEnumPayload(),
    });
});

export const partnerChargerAdd = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const {
            charger_id,
            charger_name,
            station_id,
            charger_type,
            rated_power_kw,
            connector_type,
            manufacturer = '',
            model = '',
            serial_number = '',
            connector_count = 1,
            input_supply = '',
            max_output_voltage_v = null,
            admin_status = 'Active',
        } = body;

        const { isValid, errors } = validateFields(body, {
            charger_id: ['required'],
            charger_name: ['required'],
            station_id: ['required'],
            charger_type: ['required'],
            rated_power_kw: ['required'],
            connector_type: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        if (!(await assertStationExists(station_id, resp))) return;

        if (await checkDuplicateCharger(charger_id)) {
            return resp.json({ status: 0, code: 422, message: ['Charger ID already exists'] });
        }

        const insert = await insertRecord(
            'partner_chargers',
            [
                'charger_id', 'charger_name', 'station_id', 'manufacturer', 'model', 'serial_number',
                'charger_type', 'rated_power_kw', 'connector_type', 'connector_count', 'input_supply',
                'max_output_voltage_v', 'admin_status', 'status',
            ],
            [
                charger_id,
                charger_name,
                station_id,
                manufacturer || null,
                model || null,
                serial_number || null,
                charger_type,
                rated_power_kw,
                connector_type,
                connector_count || 1,
                input_supply || null,
                max_output_voltage_v === '' || max_output_voltage_v == null ? null : max_output_voltage_v,
                admin_status,
                1,
            ]
        );

        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add charger. Please try again.'] });
        }

        return resp.json({ status: 1, code: 200, message: ['Charger added successfully!'] });
    } catch (error) {
        console.error('partnerChargerAdd:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerChargerEdit = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const {
            charger_id,
            charger_name,
            station_id,
            charger_type,
            rated_power_kw,
            connector_type,
            manufacturer = '',
            model = '',
            serial_number = '',
            connector_count = 1,
            input_supply = '',
            max_output_voltage_v = null,
            admin_status = 'Active',
        } = body;

        const { isValid, errors } = validateFields(body, {
            charger_id: ['required'],
            charger_name: ['required'],
            station_id: ['required'],
            charger_type: ['required'],
            rated_power_kw: ['required'],
            connector_type: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const exists = await queryDB(
            `SELECT id FROM partner_chargers WHERE charger_id = ? AND status = 1`,
            [charger_id]
        );
        if (!exists) return resp.json({ status: 0, code: 404, message: ['Charger not found.'] });

        if (!(await assertStationExists(station_id, resp))) return;

        const updates = {
            charger_name,
            station_id,
            manufacturer: manufacturer || null,
            model: model || null,
            serial_number: serial_number || null,
            charger_type,
            rated_power_kw,
            connector_type,
            connector_count: connector_count || 1,
            input_supply: input_supply || null,
            max_output_voltage_v:
                max_output_voltage_v === '' || max_output_voltage_v == null ? null : max_output_voltage_v,
            admin_status,
        };

        await updateRecord('partner_chargers', updates, ['charger_id'], [charger_id]);

        return resp.json({ status: 1, code: 200, message: ['Charger updated successfully!'] });
    } catch (error) {
        console.error('partnerChargerEdit:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});