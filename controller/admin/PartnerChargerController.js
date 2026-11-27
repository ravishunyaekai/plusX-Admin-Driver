import bcrypt from 'bcryptjs';
import moment from 'moment';
import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, formatDateInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

const STATION_TYPES = ['Public Station', 'Private Station'];

const OPERATING_HOUR_WEEKDAYS = [
    'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
];

const STATION_STATUSES = ['Active', 'Inactive', 'Under Maintenance'];

const CHARGING_TYPES = ['Free', 'Paid'];
const CHARGING_MODES = ['auto', 'manual', 'Automatic', 'Manual'];

const normalizeChargingModeForStorage = (value) => {
    const key = String(value ?? '').trim().toLowerCase();
    if (key === 'automatic' || key === 'auto') return 'auto';
    if (key === 'manual') return 'manual';
    return String(value ?? '').trim();
};
const CHARGER_STATUSES = ['Available', 'Faulty', 'Connection Pending'];

const normalizeStationStatus = (value) => {
    let v = String(value ?? '').trim();
    if (v === 'In-active') v = 'Inactive';
    if (v.toLowerCase() === 'under maintenance' || v === 'Under maintenance') v = 'Under Maintenance';
    return v;
};

const normalizeChargerStatus = (value) => {
    let v = String(value ?? '').trim();
    if (v === 'Pending Connection' || v === 'Pending connection') v = 'Connection Pending';
    if (v === 'Pending approval') v = 'Connection Pending';
    return v;
};

const CHARGER_TYPES = ['AC', 'DC'];

const CONNECTOR_TYPES = ['Type 2', 'CCS2', 'CHAdeMO', 'GB/T', 'Type 1', 'NACS'];

const INPUT_SUPPLY_OPTIONS = [
    'Single Phase',
    'Three Phase',
    'Industrial',
];

/** List APIs: `start_date` / `end_date` → `created_at` bounds (same TZ adjustment as other admin lists). */
export const resolvePartnerListCreatedAtRange = (start_date, end_date) => {
    if (!start_date || !end_date) return null;
    const startDay = moment(start_date, ['YYYY-MM-DD', 'DD-MM-YYYY'], true);
    const endDay = moment(end_date, ['YYYY-MM-DD', 'DD-MM-YYYY'], true);
    if (!startDay.isValid() || !endDay.isValid()) return null;
    const start = moment(`${startDay.format('YYYY-MM-DD')} 00:00:01`, 'YYYY-MM-DD HH:mm:ss')
        .subtract(4, 'hours')
        .format('YYYY-MM-DD HH:mm:ss');
    const end = `${endDay.format('YYYY-MM-DD')} 19:59:59`;
    return { start, end };
};

export const appendCreatedAtRangeWhere = (whereField, whereValue, whereOperator, start_date, end_date, column) => {
    const range = resolvePartnerListCreatedAtRange(start_date, end_date);
    if (!range) return;
    whereField.push(column, column);
    whereValue.push(range.start, range.end);
    whereOperator.push('>=', '<=');
};

const STATION_DETAIL_COLUMNS = `
    station_id, station_name, station_type, emirates, address, latitude, longitude,
    manager_name, manager_email, country_code, manager_contact_no,
    operating_hours, station_status, status,
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
    charger_id, station_id, rated_power_kw, charging_type, unit_price_aed, charging_mode,
    manufacturer, model, serial_number, charger_type, connector_type, connector_count,
    input_supply, max_output_voltage_v, ${formatDateInQuery(['installation_date'])},
    sim_iccid, imei, charger_status, online, status,
    ${formatDateTimeInQuery(['created_at', 'updated_at'])}
`;

const DAY_NAME_ALIASES = {
    mon: 'monday', monday: 'monday',
    tue: 'tuesday', tues: 'tuesday', tuesday: 'tuesday',
    wed: 'wednesday', wednesday: 'wednesday',
    thu: 'thursday', thur: 'thursday', thurs: 'thursday', thursday: 'thursday',
    fri: 'friday', friday: 'friday',
    sat: 'saturday', saturday: 'saturday',
    sun: 'sunday', sunday: 'sunday',
};

const toTruthy = (value) => value === true || value === 1 || value === '1'
    || String(value ?? '').trim().toLowerCase() === 'true';

const normalizeWeekdayKey = (raw) => {
    const key = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '');
    return DAY_NAME_ALIASES[key] ?? null;
};

const parseOperatingTime = (value) => {
    if (isBlank(value)) return { valid: true, value: null };
    const m = moment(String(value).trim(), ['HH:mm', 'H:mm', 'hh:mm A', 'h:mm A'], true);
    if (!m.isValid()) return { valid: false, value: null };
    return { valid: true, value: m.format('HH:mm') };
};

const emptyOperatingSchedule = () => {
    const schedule = {};
    for (const day of OPERATING_HOUR_WEEKDAYS) {
        schedule[day] = { open: null, close: null, closed: true };
    }
    return schedule;
};

const buildOperatingHoursStorage = (alwaysOpen, schedule) => JSON.stringify({
    always_open: Boolean(alwaysOpen),
    schedule: alwaysOpen ? {} : schedule,
});

const parseJsonObject = (input) => {
    if (input && typeof input === 'object' && !Array.isArray(input)) return input;
    if (typeof input === 'string' && input.trim()) {
        try {
            const parsed = JSON.parse(input);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
        } catch {
            return null;
        }
    }
    return null;
};

/** Accept always_open + per-day open/close (HH:mm) from admin UI. */
const parseOperatingHoursFromBody = (body) => {
    const alwaysOpen = toTruthy(body.always_open ?? body.alwaysOpen);

    const schedule = emptyOperatingSchedule();
    if (alwaysOpen) {
        return {
            always_open: true,
            schedule,
            storage: buildOperatingHoursStorage(true, schedule),
        };
    }

    let raw = body.operating_hours ?? body.operating_hour ?? body.operatingHours;
    const parsedObj = parseJsonObject(raw);
    if (parsedObj) {
        if (toTruthy(parsedObj.always_open ?? parsedObj.alwaysOpen)) {
            return {
                always_open: true,
                schedule: emptyOperatingSchedule(),
                storage: buildOperatingHoursStorage(true, {}),
            };
        }
        raw = parsedObj;
    }

    const listSource = Array.isArray(body.weekly_schedule)
        ? body.weekly_schedule
        : (Array.isArray(body.operating_hours_schedule) ? body.operating_hours_schedule : null);

    if (listSource) {
        for (const row of listSource) {
            if (!row || typeof row !== 'object') continue;
            const day = normalizeWeekdayKey(row.day ?? row.weekday ?? row.name);
            if (!day) continue;
            const open = parseOperatingTime(row.open ?? row.open_time ?? row.start);
            const close = parseOperatingTime(row.close ?? row.close_time ?? row.end);
            const closed = toTruthy(row.closed ?? row.is_closed) || (isBlank(row.open) && isBlank(row.close));
            schedule[day] = {
                open: open.value,
                close: close.value,
                closed,
            };
        }
    } else if (parsedObj || (raw && typeof raw === 'object')) {
        const source = parsedObj?.schedule ?? parsedObj ?? raw;
        if (source && typeof source === 'object') {
            for (const [key, val] of Object.entries(source)) {
                if (key === 'always_open' || key === 'alwaysOpen') continue;
                const day = normalizeWeekdayKey(key);
                if (!day || !val || typeof val !== 'object') continue;
                const open = parseOperatingTime(val.open ?? val.open_time ?? val.start);
                const close = parseOperatingTime(val.close ?? val.close_time ?? val.end);
                const closed = toTruthy(val.closed ?? val.is_closed)
                    || (isBlank(val.open) && isBlank(val.close));
                schedule[day] = {
                    open: open.value,
                    close: close.value,
                    closed,
                };
            }
        }
    }

    for (const day of OPERATING_HOUR_WEEKDAYS) {
        const openRaw = body[`${day}_open`] ?? body[`${day}Open`];
        const closeRaw = body[`${day}_close`] ?? body[`${day}Close`];
        const closedRaw = body[`${day}_closed`] ?? body[`${day}Closed`];
        if (openRaw === undefined && closeRaw === undefined && closedRaw === undefined) continue;

        const open = parseOperatingTime(openRaw);
        const close = parseOperatingTime(closeRaw);
        const closed = toTruthy(closedRaw) || (isBlank(openRaw) && isBlank(closeRaw));
        schedule[day] = {
            open: open.value,
            close: close.value,
            closed,
        };
    }

    return {
        always_open: false,
        schedule,
        storage: buildOperatingHoursStorage(false, schedule),
    };
};

const validateOperatingHoursPayload = (payload) => {
    const errors = [];
    if (payload.always_open) {
        return { isValid: true, errors, storage: payload.storage };
    }

    let hasOpenDay = false;
    for (const day of OPERATING_HOUR_WEEKDAYS) {
        const slot = payload.schedule[day];
        if (!slot || slot.closed) continue;

        if (isBlank(slot.open) && isBlank(slot.close)) continue;

        const open = parseOperatingTime(slot.open);
        const close = parseOperatingTime(slot.close);

        if (!open.valid) {
            errors.push(`${day.charAt(0).toUpperCase()}${day.slice(1)} open time is invalid (use HH:mm).`);
        }
        if (!close.valid) {
            errors.push(`${day.charAt(0).toUpperCase()}${day.slice(1)} close time is invalid (use HH:mm).`);
        }
        if (isBlank(slot.open) || isBlank(slot.close)) {
            errors.push(`${day.charAt(0).toUpperCase()}${day.slice(1)} requires both open and close time.`);
            continue;
        }

        hasOpenDay = true;
    }

    if (!hasOpenDay) {
        errors.push('Operating Hours is required (enable Always Open or set hours for at least one day).');
    }

    return { isValid: errors.length === 0, errors, storage: payload.storage };
};

export const formatStationOperatingHours = (stored) => {
    if (stored === null || stored === undefined) {
        return { always_open: false, schedule: emptyOperatingSchedule() };
    }

    if (typeof stored === 'object' && !Buffer.isBuffer(stored)) {
        const root = stored;
        const always_open = toTruthy(root.always_open ?? root.alwaysOpen);
        const schedule = emptyOperatingSchedule();
        const source = root.schedule && typeof root.schedule === 'object' ? root.schedule : {};
        for (const day of OPERATING_HOUR_WEEKDAYS) {
            const slot = source[day];
            if (!slot || typeof slot !== 'object') continue;
            schedule[day] = {
                open: slot.open ?? null,
                close: slot.close ?? null,
                closed: toTruthy(slot.closed) || (isBlank(slot.open) && isBlank(slot.close)),
            };
        }
        return { always_open, schedule };
    }

    const text = String(stored).trim();
    if (!text) return { always_open: false, schedule: emptyOperatingSchedule() };

    const parsed = parseJsonObject(text);
    if (parsed) return formatStationOperatingHours(parsed);

    const legacyAlwaysOpen = /24\s*x\s*7|24\/7|always\s*open/i.test(text);
    return {
        always_open: legacyAlwaysOpen,
        schedule: emptyOperatingSchedule(),
        legacy_label: text,
    };
};

export const enrichPartnerStationRecord = (row) => {
    if (!row || typeof row !== 'object') return row;
    const formatted = formatStationOperatingHours(row.operating_hours);
    return {
        ...row,
        always_open: formatted.always_open,
        operating_hours: formatted,
        ...(formatted.legacy_label ? { operating_hours_legacy: formatted.legacy_label } : {}),
    };
};

const stationEnumPayload = () => ({
    stationTypes: STATION_TYPES,
    operatingHourWeekdays: OPERATING_HOUR_WEEKDAYS,
    /** @deprecated — use weekly schedule in operating_hours */
    operatingHours: [],
    stationStatuses: STATION_STATUSES,
    /** @deprecated use stationStatuses */
    administrativeStatuses: STATION_STATUSES,
    adminStatuses: STATION_STATUSES,
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
    const manager_password = body.manager_password ?? body.master_password ?? body.password ?? '';
    const confirm_password = body.confirm_password ?? body.confirmPassword ?? '';

    return {
        station_id: String(body.station_id ?? '').trim(),
        station_name: String(body.station_name ?? '').trim(),
        station_type: String(body.station_type ?? '').trim(),
        emirates: String(body.emirates ?? body.state_emirate ?? '').trim(),
        address: String(body.address ?? '').trim(),
        latitude: body.latitude,
        longitude: body.longitude,
        manager_name: String(
            body.manager_name ?? body.contact_person ?? body.operator_name ?? ''
        ).trim(),
        country_code: normalizeStationCountryCode(body.country_code),
        manager_contact_no: normalizeStationContactNumber(
            body.manager_contact_no ?? body.contact_number ?? body.contact_no ?? body.mobile,
            body.country_code
        ),
        operating_hours: null,
        station_status: normalizeStationStatus(
            body.station_status ?? body.admin_status ?? body.administrative_status ?? ''
        ) || 'Active',
        manager_email: String(
            body.manager_email ?? body.master_email ?? body.email_id ?? body.email ?? ''
        ).trim(),
        manager_password: String(manager_password),
        confirm_password: String(confirm_password),
        _rawBody: body,
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
    requireField(fields.address, 'Address');
    requireField(fields.emirates, 'Emirates');

    const lat = parseStationCoord(fields.latitude, 'lat');
    const lng = parseStationCoord(fields.longitude, 'lng');
    if (lat.empty) errors.push('Latitude is required.');
    else if (!lat.valid) errors.push('Latitude is invalid.');
    if (lng.empty) errors.push('Longitude is required.');
    else if (!lng.valid) errors.push('Longitude is invalid.');

    requireField(fields.manager_name, 'Manager Name');

    if (isBlank(fields.manager_email)) {
        errors.push('Email ID is required.');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.manager_email)) {
        errors.push('Please enter a valid Email ID.');
    }

    if (isEdit) {
        if (!isBlank(fields.manager_password)) {
            if (fields.manager_password.length < 6) {
                errors.push('Password must be at least 6 characters');
            }
            if (fields.manager_password !== fields.confirm_password) {
                errors.push('Passwords do not match.');
            }
        }
    } else {
        requireField(fields.manager_password, 'Password');
        if (!isBlank(fields.manager_password) && fields.manager_password.length < 6) {
            errors.push('Password must be at least 6 characters');
        }
        requireField(fields.confirm_password, 'Confirm Password');
        if (!isBlank(fields.manager_password) && !isBlank(fields.confirm_password)
            && fields.manager_password !== fields.confirm_password) {
            errors.push('Passwords do not match.');
        }
    }

    if (!isBlank(fields.station_type) && !STATION_TYPES.includes(fields.station_type)) {
        errors.push('Station Type is invalid.');
    }
    requireField(fields.station_status, 'Station Status');
    if (!isBlank(fields.station_status) && !STATION_STATUSES.includes(fields.station_status)) {
        errors.push('Station Status is invalid.');
    }

    const operatingPayload = parseOperatingHoursFromBody(fields._rawBody ?? {});
    const operatingValidation = validateOperatingHoursPayload(operatingPayload);
    if (!operatingValidation.isValid) {
        errors.push(...operatingValidation.errors);
    }

    return {
        isValid: errors.length === 0,
        errors,
        latitude: lat.num,
        longitude: lng.num,
        operating_hours: operatingValidation.storage,
    };
};

const parsePartnerChargerBody = (body) => ({
    charger_id: String(body.charger_id ?? '').trim(),
    station_id: String(body.station_id ?? body.station ?? '').trim(),
    rated_power_kw: body.rated_power_kw ?? body.rated_power ?? body.ratedPowerKw,
    charging_type: String(body.charging_type ?? body.chargingType ?? 'Free').trim(),
    unit_price_aed: body.unit_price_aed ?? body.unit_price ?? body.unitPrice,
    charging_mode: normalizeChargingModeForStorage(
        body.charging_mode ?? body.chargingMode ?? 'auto'
    ),
    manufacturer: String(body.manufacturer ?? '').trim(),
    model: String(body.model ?? '').trim(),
    serial_number: String(body.serial_number ?? '').trim(),
    charger_type: String(body.charger_type ?? '').trim(),
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
    charger_status: normalizeChargerStatus(
        body.charger_status ?? body.admin_status ?? body.initial_administrative_status ?? ''
    ) || 'Available',
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

    requireField(fields.charger_id, 'Charger ID');
    requireField(fields.station_id, 'Station');
    requireField(fields.manufacturer, 'Manufacturer');
    requireField(fields.model, 'Model');
    requireField(fields.serial_number, 'Serial Number');
    requireField(fields.charger_type, 'Charger Type');
    requireField(fields.connector_type, 'Connector Type');
    requireField(fields.input_supply, 'Input Supply');
    requireField(fields.charger_status, 'Charger Status');
    requireField(fields.charging_type, 'Charging Type');
    requireField(fields.charging_mode, 'Charging Mode');

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
    if (!isBlank(fields.charging_type) && !CHARGING_TYPES.includes(fields.charging_type)) {
        errors.push('Charging Type is invalid.');
    }
    const chargingModeStored = normalizeChargingModeForStorage(fields.charging_mode);
    fields.charging_mode = chargingModeStored;
    if (!isBlank(fields.charging_mode) && !['auto', 'manual'].includes(fields.charging_mode)) {
        errors.push('Charging Mode is invalid.');
    }
    if (!isBlank(fields.charger_status) && !CHARGER_STATUSES.includes(fields.charger_status)) {
        errors.push('Charger Status is invalid.');
    }

    let unit_price_aed = null;
    const chargingType = String(fields.charging_type || '').trim();
    if (chargingType === 'Paid') {
        if (fields.unit_price_aed === undefined || fields.unit_price_aed === null
            || String(fields.unit_price_aed).trim() === '') {
            errors.push('Unit Price is required when Charging Type is Paid.');
        } else {
            unit_price_aed = Number(fields.unit_price_aed);
            if (!Number.isFinite(unit_price_aed) || unit_price_aed < 0) {
                errors.push('Unit Price is invalid.');
            }
        }
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
        unit_price_aed: chargingType === 'Paid' ? unit_price_aed : null,
        charging_type: chargingType || 'Free',
    };
};

const chargerEnumPayload = () => ({
    chargerTypes: CHARGER_TYPES,
    connectorTypes: CONNECTOR_TYPES,
    inputSupplyOptions: INPUT_SUPPLY_OPTIONS,
    chargingTypes: CHARGING_TYPES,
    chargingModes: CHARGING_MODES,
    chargerStatuses: CHARGER_STATUSES,
    /** @deprecated use chargerStatuses */
    initialAdministrativeStatuses: CHARGER_STATUSES,
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

async function checkDuplicateStation(station_id, manager_email, excludeStationId = null) {
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
        SELECT 'manager_email' AS field FROM partner_charging_stations
        WHERE manager_email = ? AND status = 1`;
    params.push(manager_email);

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

export async function activeStationsForDropdown() {
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
            SUM(charger_status = 'Available') AS available_chargers,
            SUM(charger_status = 'Connection Pending') AS connection_pending,
            SUM(charger_status = 'Faulty') AS faulty_chargers
        FROM partner_chargers
        WHERE status = 1
    `);

    const [stationRows] = await db.execute(`
        SELECT ps.station_id, ps.station_name, ps.emirates, ps.station_status,
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
        connection_pending: Number(rawCounts.connection_pending) || 0,
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
                emirates: row.emirates,
                station_status: row.station_status,
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
                { key: 'connection_pending', label: 'Connection Pending', count: counts.connection_pending },
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
        const {
            page_no = 1,
            search_text = '',
            admin_status = '',
            station_status = '',
            status = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);
        const stationStatusFilter = String(station_status || admin_status || status || '').trim();

        const whereField = ['ps.status'];
        const whereValue = [1];
        const whereOperator = ['='];
        if (stationStatusFilter) {
            whereField.push('ps.station_status');
            whereValue.push(stationStatusFilter);
            whereOperator.push('=');
        }
        appendCreatedAtRangeWhere(whereField, whereValue, whereOperator, start_date, end_date, 'ps.created_at');

        const params = {
            tableName: ' partner_charging_stations AS ps',
            columns: `ps.station_id, ps.station_name, ps.station_type, ps.emirates, ps.country_code,
                ps.manager_contact_no, ps.station_status,
                (SELECT COUNT(*) FROM partner_chargers AS pc
                    WHERE pc.station_id = ps.station_id AND pc.status = 1) AS charger_count`,
            sortColumn: 'ps.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['ps.station_id', 'ps.station_name', 'ps.emirates'],
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
        payload.stationData = enrichPartnerStationRecord(station);
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
        data: enrichPartnerStationRecord(station),
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
            emirates,
            address,
            manager_name,
            country_code,
            manager_contact_no,
            station_status,
            manager_email,
            manager_password,
        } = fields;
        const { latitude, longitude, operating_hours } = validation;

        const station_id = await generateNextStationId();

        const dupFields = await checkDuplicateStation(station_id, manager_email);
        if (dupFields.includes('station_id')) {
            return resp.json({ status: 0, code: 500, message: ['Could not allocate Station ID. Please try again.'] });
        }
        if (dupFields.includes('manager_email')) {
            return resp.json({ status: 0, code: 422, message: ['Manager email already exists'] });
        }

        const hashed = await bcrypt.hash(manager_password, 10);

        const insert = await insertRecord(
            'partner_charging_stations',
            [
                'station_id', 'station_name', 'station_type', 'emirates', 'address',
                'latitude', 'longitude', 'manager_name', 'manager_email', 'country_code',
                'manager_contact_no', 'manager_password', 'operating_hours', 'station_status', 'status',
            ],
            [
                station_id,
                station_name,
                station_type,
                emirates,
                address,
                latitude,
                longitude,
                manager_name,
                manager_email,
                country_code,
                manager_contact_no,
                hashed,
                operating_hours,
                station_status,
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
            emirates,
            address,
            manager_name,
            country_code,
            manager_contact_no,
            station_status,
            manager_email,
            manager_password,
        } = fields;
        const { latitude, longitude, operating_hours } = validation;

        const exists = await queryDB(
            `SELECT id FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
            [station_id]
        );
        if (!exists) return resp.json({ status: 0, code: 404, message: ['Station not found.'] });

        const dupFields = await checkDuplicateStation(station_id, manager_email, station_id);
        if (dupFields.includes('manager_email')) {
            return resp.json({ status: 0, code: 422, message: ['Manager email already exists'] });
        }

        const updates = {
            station_name,
            station_type,
            emirates,
            address,
            latitude,
            longitude,
            manager_name,
            country_code,
            manager_contact_no,
            operating_hours,
            station_status,
            manager_email,
        };

        if (!isBlank(manager_password)) {
            updates.manager_password = await bcrypt.hash(manager_password, 10);
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
        const {
            page_no = 1,
            search_text = '',
            admin_status = '',
            status = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);
        const chargerStatusFilter = String(
            req.body.charger_status || admin_status || status || ''
        ).trim();

        const whereField = ['pc.status'];
        const whereValue = [1];
        const whereOperator = ['='];
        if (chargerStatusFilter) {
            whereField.push('pc.charger_status');
            whereValue.push(chargerStatusFilter);
            whereOperator.push('=');
        }
        appendCreatedAtRangeWhere(whereField, whereValue, whereOperator, start_date, end_date, 'pc.created_at');

        const params = {
            tableName: ' partner_chargers AS pc',
            joinTable: ' partner_charging_stations AS ps',
            joinCondition: 'pc.station_id = ps.station_id AND ps.status = 1',
            columns: `pc.charger_id, ps.station_name, pc.station_id, pc.charging_type, pc.unit_price_aed,
                pc.charger_type, pc.rated_power_kw, pc.connector_type, pc.connector_count,
                pc.charger_status, pc.online`,
            sortColumn: 'pc.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['pc.charger_id', 'ps.station_name', 'pc.serial_number'],
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
    }

    return resp.json({ status: 1, code: 200, message: ['Charger form data fetched successfully!'], data: payload });
});

export const partnerChargerDetail = asyncHandler(async (req, resp) => {
    const { charger_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { charger_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const charger = await queryDB(
        `SELECT pc.charger_id, pc.station_id, ps.station_name, pc.rated_power_kw, pc.charging_type,
            pc.unit_price_aed, pc.charging_mode, pc.manufacturer, pc.model, pc.serial_number,
            pc.charger_type, pc.connector_type, pc.connector_count, pc.input_supply,
            pc.max_output_voltage_v, ${formatDateInQuery(['pc.installation_date'])},
            pc.sim_iccid, pc.imei, pc.charger_status, pc.online, pc.status,
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

        const { charger_id, station_id,
            manufacturer,
            model,
            serial_number,
            charger_type,
            connector_type,
            input_supply,
            sim_iccid,
            imei,
            charging_mode,
            charger_status,
        } = fields;
        const {
            rated_power_kw,
            max_output_voltage_v,
            connector_count,
            installation_date,
            unit_price_aed,
            charging_type,
        } = validation;

        if (!(await assertStationExists(station_id, resp))) return;

        if (await checkDuplicateCharger(charger_id)) {
            return resp.json({ status: 0, code: 422, message: ['Charger ID already exists.'] });
        }

        const insert = await insertRecord(
            'partner_chargers',
            [
                'charger_id', 'station_id', 'rated_power_kw', 'charging_type', 'unit_price_aed', 'charging_mode',
                'manufacturer', 'model', 'serial_number', 'charger_type', 'connector_type', 'connector_count',
                'input_supply', 'max_output_voltage_v', 'installation_date', 'sim_iccid', 'imei',
                'charger_status', 'status',
            ],
            [
                charger_id,
                station_id,
                rated_power_kw,
                charging_type,
                unit_price_aed,
                charging_mode,
                manufacturer,
                model,
                serial_number,
                charger_type,
                connector_type,
                connector_count,
                input_supply,
                max_output_voltage_v,
                installation_date,
                sim_iccid,
                imei,
                charger_status,
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
            station_id,
            manufacturer,
            model,
            serial_number,
            charger_type,
            connector_type,
            input_supply,
            sim_iccid,
            imei,
            charging_mode,
            charger_status,
        } = fields;
        const {
            rated_power_kw,
            max_output_voltage_v,
            connector_count,
            installation_date,
            unit_price_aed,
            charging_type,
        } = validation;

        const exists = await queryDB(
            `SELECT id FROM partner_chargers WHERE charger_id = ? AND status = 1`,
            [charger_id]
        );
        if (!exists) return resp.json({ status: 0, code: 404, message: ['Charger not found.'] });

        if (!(await assertStationExists(station_id, resp))) return;

        const updates = {
            station_id,
            rated_power_kw,
            charging_type,
            unit_price_aed,
            charging_mode,
            manufacturer,
            model,
            serial_number,
            charger_type,
            connector_type,
            connector_count,
            input_supply,
            max_output_voltage_v,
            installation_date,
            sim_iccid,
            imei,
            charger_status,
        };

        await updateRecord('partner_chargers', updates, ['charger_id'], [charger_id]);

        return resp.json({ status: 1, code: 200, message: ['Charger updated successfully!'] });
    } catch (error) {
        console.error('partnerChargerEdit:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

/** Chargers at a station — customer add/edit multi-select dropdown */
export const partnerChargersByStation = asyncHandler(async (req, resp) => {
    const { station_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const [rows] = await db.execute(`
        SELECT charger_id AS value, charger_id AS label, charger_status, rated_power_kw, charging_type
        FROM partner_chargers
        WHERE station_id = ? AND status = 1
        ORDER BY charger_id ASC
    `, [station_id]);

    return resp.json({
        status: 1,
        code: 200,
        message: ['Chargers fetched successfully!'],
        data: rows,
    });
});