import bcrypt from 'bcryptjs';
import moment from 'moment';
import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, formatDateInQuery, asyncHandler } from '../../utils.js';
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

/** Station add/edit — “Administrative Status” (not used on chargers) */
const STATION_ADMIN_STATUSES = ['Active', 'Inactive', 'Pending approval', 'Under maintenance'];

/** Charger add/edit — “Initial Administrative Status” */
const CHARGER_INITIAL_ADMIN_STATUSES = [
    'Active',
    'Pending Connection',
    'Available',
    'Charging',
    'Faulty',
    'Inactive',
];

const normalizeStationAdminStatus = (value) => {
    let v = String(value ?? '').trim();
    if (v === 'In-active') v = 'Inactive';
    if (v === 'Pending Connection') v = 'Pending approval';
    return v;
};

const normalizeChargerInitialAdminStatus = (value) => {
    let v = String(value ?? '').trim();
    if (v === 'In-active') v = 'Inactive';
    if (v === 'Pending approval') v = 'Pending Connection';
    return v;
};

const CHARGER_TYPES = ['AC', 'DC'];

const CONNECTOR_TYPES = ['Type 2', 'CCS2', 'CHAdeMO', 'GB/T', 'Type 1'];

const INPUT_SUPPLY_OPTIONS = [
    'Single Phase',
    'Three Phase',
    'Industrial',
];

const STATION_DETAIL_COLUMNS = `
    station_id, station_name, station_type, operator_name, address, city, state_emirate,
    country, postal_code, latitude, longitude, contact_person, country_code, contact_number,
    operating_hours, admin_status, description, number_of_chargers, master_email, status,
    ${formatDateTimeInQuery(['created_at', 'updated_at'])}
`;

const normalizeStationCountryCode = (value) => {
    const code = String(value ?? '').trim();
    if (!code) return '+971';
    return code.startsWith('+') ? code : `+${code}`;
};

/** Store local number only; strip leading country_code if the client sent a combined value. */
const normalizeStationContactNumber = (contactNumber, countryCode) => {
    let local = String(contactNumber ?? '').trim();
    if (!local) return null;

    const code = normalizeStationCountryCode(countryCode);
    const digitsOnly = code.replace(/\D/g, '');
    const localDigits = local.replace(/\D/g, '');

    if (digitsOnly && localDigits.startsWith(digitsOnly)) {
        local = localDigits.slice(digitsOnly.length);
    } else if (local.startsWith(code)) {
        local = local.slice(code.length).replace(/^[\s\-]+/, '');
    }

    local = local.replace(/^[\s\-]+/, '').trim();
    return local || null;
};

const CHARGER_DETAIL_COLUMNS = `
    charger_id, charger_name, station_id, manufacturer, model, serial_number,
    charger_type, rated_power_kw, connector_type, connector_count, input_supply,
    max_output_voltage_v, ${formatDateInQuery(['installation_date'])}, sim_iccid, imei,
    installation_notes, admin_status, status,
    ${formatDateTimeInQuery(['created_at', 'updated_at'])}
`;

const stationEnumPayload = () => ({
    stationTypes: STATION_TYPES,
    operatingHours: OPERATING_HOURS,
    administrativeStatuses: STATION_ADMIN_STATUSES,
    adminStatuses: STATION_ADMIN_STATUSES,
});

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const parseDmsToDecimal = (raw) => {
    const s = String(raw).trim();
    const dms = s.match(
        /^([+-]?\d+(?:\.\d+)?)\s*°\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*(?:["″]\s*)?([NSEW])?\s*$/i
    );
    if (!dms) return null;

    const degrees = parseFloat(dms[1]);
    const minutes = parseFloat(dms[2]);
    const seconds = parseFloat(dms[3]);
    const hemi = (dms[4] || '').toUpperCase();

    if (minutes >= 60 || seconds >= 60) return null;

    let decimal = Math.abs(degrees) + minutes / 60 + seconds / 3600;
    if (hemi === 'S' || hemi === 'W') decimal *= -1;
    else if (degrees < 0) decimal *= -1;

    return decimal;
};

const parseStationCoord = (value, kind = 'lat') => {
    if (isBlank(value)) return { empty: true, valid: false, num: null };

    let num = parseDmsToDecimal(value);
    if (num === null) {
        const parsed = Number(String(value).trim());
        if (Number.isFinite(parsed)) num = parsed;
    }

    if (num === null || !Number.isFinite(num)) {
        return { empty: false, valid: false, num: null };
    }

    const min = kind === 'lat' ? -90 : -180;
    const max = kind === 'lat' ? 90 : 180;
    if (num < min || num > max) {
        return { empty: false, valid: false, num: null };
    }

    num = Math.round(num * 1e6) / 1e6;
    return { empty: false, valid: true, num };
};

const parsePartnerStationBody = (body) => {
    const master_password = body.master_password ?? body.password ?? '';
    const confirm_password = body.confirm_password ?? body.confirmPassword ?? '';

    return {
        station_id: String(body.station_id ?? '').trim(),
        station_name: String(body.station_name ?? '').trim(),
        station_type: String(body.station_type ?? '').trim(),
        operator_name: String(body.operator_name ?? '').trim(),
        address: String(body.address ?? '').trim(),
        city: String(body.city ?? '').trim(),
        state_emirate: String(body.state_emirate ?? body.emirates ?? '').trim(),
        country: String(body.country ?? '').trim(),
        postal_code: String(body.postal_code ?? '').trim(),
        latitude: body.latitude,
        longitude: body.longitude,
        contact_person: String(body.contact_person ?? '').trim(),
        country_code: normalizeStationCountryCode(body.country_code),
        contact_number: normalizeStationContactNumber(
            body.contact_number ?? body.contact_no ?? body.mobile,
            body.country_code
        ),
        operating_hours: String(body.operating_hours ?? body.operating_hour ?? '').trim(),
        admin_status:
            normalizeStationAdminStatus(body.admin_status ?? body.administrative_status ?? '') || 'Active',
        description: String(body.description ?? body.station_description ?? '').trim(),
        master_email: String(body.master_email ?? body.email_id ?? body.email ?? '').trim(),
        master_password: String(master_password),
        confirm_password: String(confirm_password),
        number_of_chargers: body.number_of_chargers ?? body.no_of_chargers ?? body.numberOfChargers,
    };
};

const validatePartnerStationForm = (fields, { isEdit = false } = {}) => {
    const errors = [];
    const requireField = (value, label) => {
        if (isBlank(value)) errors.push(`${label} is required.`);
    };

    if (isEdit) {
        requireField(fields.station_id, 'Station ID');
    }
    requireField(fields.station_name, 'Station Name');
    requireField(fields.station_type, 'Station Type');
    requireField(fields.operator_name, 'Operator Name');
    requireField(fields.address, 'Address');
    requireField(fields.city, 'City');
    requireField(fields.state_emirate, 'Emirates');
    requireField(fields.country, 'Country');

    const lat = parseStationCoord(fields.latitude, 'lat');
    const lng = parseStationCoord(fields.longitude, 'lng');
    if (lat.empty) errors.push('Latitude is required.');
    else if (!lat.valid) errors.push('Latitude is invalid.');
    if (lng.empty) errors.push('Longitude is required.');
    else if (!lng.valid) errors.push('Longitude is invalid.');

    requireField(fields.contact_person, 'Contact Person');

    if (isBlank(fields.master_email)) {
        errors.push('Email ID is required.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.master_email)) {
        errors.push('Please enter a valid Email ID.');
    }

    if (isEdit) {
        if (!isBlank(fields.master_password)) {
            if (fields.master_password.length < 6) {
                errors.push('Password must be at least 6 characters');
            }
            if (fields.master_password !== fields.confirm_password) {
                errors.push('Passwords do not match.');
            }
        }
    } else {
        requireField(fields.master_password, 'Password');
        if (!isBlank(fields.master_password) && fields.master_password.length < 6) {
            errors.push('Password must be at least 6 characters');
        }
        requireField(fields.confirm_password, 'Confirm Password');
        if (!isBlank(fields.master_password) && !isBlank(fields.confirm_password)
            && fields.master_password !== fields.confirm_password) {
            errors.push('Passwords do not match.');
        }
    }

    if (!isBlank(fields.station_type) && !STATION_TYPES.includes(fields.station_type)) {
        errors.push('Station Type is invalid.');
    }
    requireField(fields.operating_hours, 'Operating Hour');
    if (!isBlank(fields.operating_hours) && !OPERATING_HOURS.includes(fields.operating_hours)) {
        errors.push('Operating Hour is invalid.');
    }

    requireField(fields.admin_status, 'Administrative Status');
    if (!isBlank(fields.admin_status) && !STATION_ADMIN_STATUSES.includes(fields.admin_status)) {
        errors.push('Administrative Status is invalid.');
    }

    requireField(fields.description, 'Station Description');

    let number_of_chargers = null;
    if (fields.number_of_chargers === undefined || fields.number_of_chargers === null
        || String(fields.number_of_chargers).trim() === '') {
        errors.push('No. of Chargers is required.');
    } else {
        number_of_chargers = Number(fields.number_of_chargers);
        if (!Number.isInteger(number_of_chargers) || number_of_chargers < 1) {
            errors.push('No. of Chargers must be at least 1.');
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        latitude: lat.num,
        longitude: lng.num,
        number_of_chargers,
    };
};

const parsePartnerChargerBody = (body) => ({
    charger_id: String(body.charger_id ?? '').trim(),
    charger_name: String(body.charger_name ?? '').trim(),
    station_id: String(body.station_id ?? body.station ?? '').trim(),
    manufacturer: String(body.manufacturer ?? '').trim(),
    model: String(body.model ?? '').trim(),
    serial_number: String(body.serial_number ?? '').trim(),
    charger_type: String(body.charger_type ?? '').trim(),
    rated_power_kw: body.rated_power_kw ?? body.rated_power ?? body.ratedPowerKw,
    connector_type: String(body.connector_type ?? '').trim(),
    connector_count:
        body.connector_count ?? body.no_of_connector ?? body.no_of_connectors
        ?? body.number_of_connectors ?? body.numberOfConnectors,
    input_supply: String(body.input_supply ?? '').trim(),
    max_output_voltage_v:
        body.max_output_voltage_v ?? body.maximum_output_voltage ?? body.output_voltage ?? body.outputVoltage,
    installation_date: body.installation_date ?? body.installationDate,
    sim_iccid: String(body.sim_iccid ?? body.simIccid ?? '').trim() || null,
    imei: String(body.imei ?? body.imei_number ?? body.imeiNumber ?? '').trim() || null,
    installation_notes: String(
        body.installation_notes ?? body.installation_note ?? body.installationNotes ?? ''
    ).trim(),
    admin_status:
        normalizeChargerInitialAdminStatus(
            body.admin_status
                ?? body.initial_administrative_status
                ?? body.initialAdministrativeStatus
                ?? ''
        ) || 'Active',
});

const parseInstallationDate = (value) => {
    if (isBlank(value)) return { empty: true, valid: false, sqlDate: null };

    const trimmed = String(value).trim();
    let m = moment(trimmed, 'DD-MM-YYYY', true);
    if (!m.isValid()) m = moment(trimmed, 'YYYY-MM-DD', true);
    if (!m.isValid()) return { empty: false, valid: false, sqlDate: null };

    return { empty: false, valid: true, sqlDate: m.format('YYYY-MM-DD') };
};

const validatePartnerChargerForm = (fields, { isEdit = false } = {}) => {
    const errors = [];
    const requireField = (value, label) => {
        if (isBlank(value)) errors.push(`${label} is required.`);
    };

    if (isEdit) {
        requireField(fields.charger_id, 'Charger ID');
    }
    requireField(fields.charger_name, 'Charger Name');
    requireField(fields.station_id, 'Station');
    requireField(fields.manufacturer, 'Manufacturer');
    requireField(fields.model, 'Model');
    requireField(fields.serial_number, 'Serial Number');
    requireField(fields.charger_type, 'Charger Type');
    requireField(fields.connector_type, 'Connector Type');
    requireField(fields.input_supply, 'Input Supply');
    requireField(fields.admin_status, 'Initial Administrative Status');
    requireField(fields.installation_notes, 'Installation Notes');

    if (fields.rated_power_kw === undefined || fields.rated_power_kw === null
        || String(fields.rated_power_kw).trim() === '') {
        errors.push('Rated Power is required.');
    } else {
        const power = Number(fields.rated_power_kw);
        if (!Number.isFinite(power) || power <= 0) {
            errors.push('Rated Power is invalid.');
        }
    }

    if (fields.max_output_voltage_v === undefined || fields.max_output_voltage_v === null
        || String(fields.max_output_voltage_v).trim() === '') {
        errors.push('Output Voltage is required.');
    } else {
        const voltage = Number(fields.max_output_voltage_v);
        if (!Number.isFinite(voltage) || voltage <= 0) {
            errors.push('Output Voltage is invalid.');
        }
    }

    if (fields.connector_count === undefined || fields.connector_count === null
        || String(fields.connector_count).trim() === '') {
        errors.push('Number Of Connector is required.');
    } else {
        const count = Number(fields.connector_count);
        if (!Number.isInteger(count) || count < 1) {
            errors.push('Number Of Connector must be at least 1.');
        }
    }

    const installation = parseInstallationDate(fields.installation_date);
    if (installation.empty) errors.push('Installation Date is required.');
    else if (!installation.valid) errors.push('Installation Date is invalid.');

    if (!isBlank(fields.charger_type) && !CHARGER_TYPES.includes(fields.charger_type)) {
        errors.push('Charger Type is invalid.');
    }
    if (!isBlank(fields.connector_type) && !CONNECTOR_TYPES.includes(fields.connector_type)) {
        errors.push('Connector Type is invalid.');
    }
    if (!isBlank(fields.input_supply) && !INPUT_SUPPLY_OPTIONS.includes(fields.input_supply)) {
        errors.push('Input Supply is invalid.');
    }
    if (!isBlank(fields.admin_status) && !CHARGER_INITIAL_ADMIN_STATUSES.includes(fields.admin_status)) {
        errors.push('Initial Administrative Status is invalid.');
    }

    const rated_power_kw = Number(fields.rated_power_kw);
    const max_output_voltage_v = Number(fields.max_output_voltage_v);
    const connector_count = Number(fields.connector_count);

    return {
        isValid: errors.length === 0,
        errors,
        rated_power_kw: Number.isFinite(rated_power_kw) ? rated_power_kw : null,
        max_output_voltage_v: Number.isFinite(max_output_voltage_v) ? max_output_voltage_v : null,
        connector_count: Number.isInteger(connector_count) ? connector_count : null,
        installation_date: installation.sqlDate,
    };
};

const chargerEnumPayload = () => ({
    chargerTypes: CHARGER_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    inputSupplyOptions: INPUT_SUPPLY_OPTIONS,
    initialAdministrativeStatuses: CHARGER_INITIAL_ADMIN_STATUSES,
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

/** Next business id: ST-01, ST-02, … ST-10 (minimum 2-digit suffix) */
async function generateNextStationId() {
    const row = await queryDB(
        `SELECT MAX(CAST(SUBSTRING(station_id, 4) AS UNSIGNED)) AS max_num
         FROM partner_charging_stations
         WHERE station_id REGEXP '^ST-[0-9]+$'`
    );
    const next = (row?.max_num ?? 0) + 1;
    return `ST-${String(next).padStart(2, '0')}`;
}

/** Next business id: PLX-CH-1, PLX-CH-2, … */
async function generateNextChargerId() {
    const row = await queryDB(
        `SELECT MAX(CAST(SUBSTRING(charger_id, 8) AS UNSIGNED)) AS max_num
         FROM partner_chargers
         WHERE charger_id REGEXP '^PLX-CH-[0-9]+$'`
    );
    const next = (row?.max_num ?? 0) + 1;
    return `PLX-CH-${next}`;
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
// Dashboard
// ---------------------------------------------------------------------------

export const partnerChargersDashboard = asyncHandler(async (req, resp) => {
    const [countRows] = await db.execute(`
        SELECT
            COUNT(*) AS total_chargers,
            SUM(admin_status = 'Available') AS available_chargers,
            SUM(admin_status = 'Charging') AS currently_charging,
            SUM(admin_status = 'Faulty') AS faulty_chargers
        FROM partner_chargers
        WHERE status = 1
    `);

    const [stationRows] = await db.execute(`
        SELECT ps.station_id, ps.station_name, ps.city, ps.admin_status,
            ps.latitude, ps.longitude,
            (SELECT COUNT(*) FROM partner_chargers AS pc
                WHERE pc.station_id = ps.station_id AND pc.status = 1) AS charger_count
        FROM partner_charging_stations AS ps
        WHERE ps.status = 1
        ORDER BY ps.station_name ASC
    `);

    const rawCounts = countRows[0] || {};
    const counts = {
        total_chargers: Number(rawCounts.total_chargers) || 0,
        available_chargers: Number(rawCounts.available_chargers) || 0,
        currently_charging: Number(rawCounts.currently_charging) || 0,
        faulty_chargers: Number(rawCounts.faulty_chargers) || 0,
    };

    const stations = stationRows
        .filter((row) => row.latitude != null && row.longitude != null)
        .map((row) => {
            const lat = Number(row.latitude);
            const lng = Number(row.longitude);
            return {
                station_id: row.station_id,
                station_name: row.station_name,
                city: row.city,
                admin_status: row.admin_status,
                charger_count: Number(row.charger_count) || 0,
                latitude: lat,
                longitude: lng,
                location: { lat, lng },
            };
        });

    return resp.json({
        status: 1,
        code: 200,
        message: ['Partner chargers dashboard fetched successfully!'],
        data: {
            counts,
            count_cards: [
                { key: 'total_chargers', label: 'Total Chargers', count: counts.total_chargers },
                { key: 'available_chargers', label: 'Available Chargers', count: counts.available_chargers },
                { key: 'currently_charging', label: 'Currently Charging', count: counts.currently_charging },
                { key: 'faulty_chargers', label: 'Faulty Chargers', count: counts.faulty_chargers },
            ],
            stations,
        },
    });
});

// ---------------------------------------------------------------------------
// Stations
// ---------------------------------------------------------------------------

export const partnerStationList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', admin_status = '', status = '' } = mergeParam(req);
        const adminStatusFilter = String(admin_status || status || '').trim();

        const whereField = ['ps.status'];
        const whereValue = [1];
        const whereOperator = ['='];
        if (adminStatusFilter) {
            whereField.push('ps.admin_status');
            whereValue.push(adminStatusFilter);
            whereOperator.push('=');
        }

        const params = {
            tableName: ' partner_charging_stations AS ps',
            columns: `ps.station_id, ps.station_name, ps.city, ps.country_code, ps.contact_number, ps.admin_status,
                (SELECT COUNT(*) FROM partner_chargers AS pc
                    WHERE pc.station_id = ps.station_id AND pc.status = 1) AS charger_count`,
            sortColumn: 'ps.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['ps.station_id', 'ps.station_name', 'ps.city'],
            liveSearchTexts: [search_text, search_text, search_text],
            whereField,
            whereValue,
            whereOperator,
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
    } else {
        payload.nextStationId = await generateNextStationId();
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
        const fields = parsePartnerStationBody(body);
        const validation = validatePartnerStationForm(fields, { isEdit: false });
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const {
            station_name,
            station_type,
            operator_name,
            address,
            city,
            state_emirate,
            country,
            postal_code,
            contact_person,
            country_code,
            contact_number,
            operating_hours,
            admin_status,
            description,
            master_email,
            master_password,
        } = fields;
        const { latitude, longitude, number_of_chargers } = validation;

        const station_id = await generateNextStationId();

        const dupFields = await checkDuplicateStation(station_id, master_email);
        if (dupFields.includes('station_id')) {
            return resp.json({ status: 0, code: 500, message: ['Could not allocate Station ID. Please try again.'] });
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
                'country_code', 'contact_number', 'operating_hours', 'admin_status', 'description',
                'number_of_chargers', 'master_email', 'master_password', 'status',
            ],
            [
                station_id,
                station_name,
                station_type,
                operator_name,
                address,
                city,
                state_emirate,
                country,
                postal_code || null,
                latitude,
                longitude,
                contact_person,
                country_code,
                contact_number,
                operating_hours,
                admin_status,
                description,
                number_of_chargers,
                master_email,
                hashed,
                1,
            ]
        );

        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add station. Please try again.'] });
        }

        return resp.json({
            status: 1,
            code: 200,
            message: ['Station added successfully!'],
            data: { station_id },
        });
    } catch (error) {
        console.error('partnerStationAdd:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerStationEdit = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const fields = parsePartnerStationBody(body);
        const validation = validatePartnerStationForm(fields, { isEdit: true });
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const {
            station_id,
            station_name,
            station_type,
            operator_name,
            address,
            city,
            state_emirate,
            country,
            postal_code,
            contact_person,
            country_code,
            contact_number,
            operating_hours,
            admin_status,
            description,
            master_email,
            master_password,
        } = fields;
        const { latitude, longitude, number_of_chargers } = validation;

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
            station_type,
            operator_name,
            address,
            city,
            state_emirate,
            country,
            postal_code: postal_code || null,
            latitude,
            longitude,
            contact_person,
            country_code,
            contact_number,
            operating_hours,
            admin_status,
            description,
            number_of_chargers,
            master_email,
        };

        if (!isBlank(master_password)) {
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
        const { page_no = 1, search_text = '', admin_status = '', status = '' } = mergeParam(req);
        const adminStatusFilter = String(admin_status || status || '').trim();

        const whereField = ['pc.status'];
        const whereValue = [1];
        const whereOperator = ['='];
        if (adminStatusFilter) {
            whereField.push('pc.admin_status');
            whereValue.push(adminStatusFilter);
            whereOperator.push('=');
        }

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
            whereField,
            whereValue,
            whereOperator,
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
    } else {
        payload.nextChargerId = await generateNextChargerId();
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
            ${formatDateInQuery(['pc.installation_date'])}, pc.sim_iccid, pc.imei, pc.installation_notes,
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
        const fields = parsePartnerChargerBody(body);
        const validation = validatePartnerChargerForm(fields, { isEdit: false });
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const charger_id = await generateNextChargerId();

        const {
            charger_name,
            station_id,
            manufacturer,
            model,
            serial_number,
            charger_type,
            connector_type,
            input_supply,
            sim_iccid,
            imei,
            installation_notes,
            admin_status,
        } = fields;
        const { rated_power_kw, max_output_voltage_v, connector_count, installation_date } = validation;

        if (!(await assertStationExists(station_id, resp))) return;

        if (await checkDuplicateCharger(charger_id)) {
            return resp.json({ status: 0, code: 500, message: ['Could not allocate Charger ID. Please try again.'] });
        }

        const insert = await insertRecord(
            'partner_chargers',
            [
                'charger_id', 'charger_name', 'station_id', 'manufacturer', 'model', 'serial_number',
                'charger_type', 'rated_power_kw', 'connector_type', 'connector_count', 'input_supply',
                'max_output_voltage_v', 'installation_date', 'sim_iccid', 'imei', 'installation_notes',
                'admin_status', 'status',
            ],
            [
                charger_id,
                charger_name,
                station_id,
                manufacturer,
                model,
                serial_number,
                charger_type,
                rated_power_kw,
                connector_type,
                connector_count,
                input_supply,
                max_output_voltage_v,
                installation_date,
                sim_iccid,
                imei,
                installation_notes,
                admin_status,
                1,
            ]
        );

        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add charger. Please try again.'] });
        }

        return resp.json({
            status: 1,
            code: 200,
            message: ['Charger added successfully!'],
            data: { charger_id },
        });
    } catch (error) {
        console.error('partnerChargerAdd:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerChargerEdit = asyncHandler(async (req, resp) => {
    try {
        const body = mergeParam(req);
        const fields = parsePartnerChargerBody(body);
        const validation = validatePartnerChargerForm(fields, { isEdit: true });
        if (!validation.isValid) {
            return resp.json({ status: 0, code: 422, message: validation.errors });
        }

        const {
            charger_id,
            charger_name,
            station_id,
            manufacturer,
            model,
            serial_number,
            charger_type,
            connector_type,
            input_supply,
            sim_iccid,
            imei,
            installation_notes,
            admin_status,
        } = fields;
        const { rated_power_kw, max_output_voltage_v, connector_count, installation_date } = validation;

        const exists = await queryDB(
            `SELECT id FROM partner_chargers WHERE charger_id = ? AND status = 1`,
            [charger_id]
        );
        if (!exists) return resp.json({ status: 0, code: 404, message: ['Charger not found.'] });

        if (!(await assertStationExists(station_id, resp))) return;

        const updates = {
            charger_name,
            station_id,
            manufacturer,
            model,
            serial_number,
            charger_type,
            rated_power_kw,
            connector_type,
            connector_count,
            input_supply,
            max_output_voltage_v,
            installation_date,
            sim_iccid,
            imei,
            installation_notes,
            admin_status,
        };

        await updateRecord('partner_chargers', updates, ['charger_id'], [charger_id]);

        return resp.json({ status: 1, code: 200, message: ['Charger updated successfully!'] });
    } catch (error) {
        console.error('partnerChargerEdit:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});