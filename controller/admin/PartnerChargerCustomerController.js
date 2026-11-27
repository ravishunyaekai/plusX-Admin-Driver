import db from '../../config/db.js';
import { mergeParam, formatDateTimeInQuery, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { queryDB, getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';
import { appendCreatedAtRangeWhere, activeStationsForDropdown } from './PartnerChargerController.js';

const VEHICLE_SPECIFICATION_OPTIONS = ['GCC', 'Non-GCC'];

const VEHICLE_DETAIL_FIELDS = [
    'vehicle_id',
    'vehicle_type',
    'vehicle_make',
    'vehicle_model',
    'vehicle_specification',
    'vehicle_emirates',
    'vehicle_code',
    'vehicle_number',
];

const CUSTOMER_TABLE = 'partner_charger_customers';
const CHARGER_MAP_TABLE = 'partner_customer_charger_map';
const VEHICLE_TABLE = 'partner_customer_vehicles';

const isBlank = (value) => value === undefined || value === null || String(value).trim() === '';

const isVehicleFullyEmpty = (vehicle) => {
    if (!vehicle) return true;
    return VEHICLE_DETAIL_FIELDS.every((field) => isBlank(vehicle[field]));
};

const normalizeCountryCode = (value) => {
    const code = String(value ?? '').trim();
    if (!code) return '+971';
    return code.startsWith('+') ? code : `+${code}`;
};

const parseJsonArrayInput = (input) => {
    if (Array.isArray(input)) return input;
    if (typeof input === 'string' && input.trim()) {
        try {
            const parsed = JSON.parse(input);
            if (Array.isArray(parsed)) return parsed;
        } catch {
            return null;
        }
    }
    return null;
};

const normalizeCustomerVehicleInput = (raw) => {
    if (!raw || typeof raw !== 'object') return null;
    const vehicle_emirates = raw.vehicle_emirates ?? raw.emirates ?? null;
    return {
        vehicle_id: raw.vehicle_id ? String(raw.vehicle_id).trim() : null,
        vehicle_type: raw.vehicle_type != null ? String(raw.vehicle_type).trim() : '',
        vehicle_make: raw.vehicle_make != null ? String(raw.vehicle_make).trim() : '',
        vehicle_model: raw.vehicle_model != null ? String(raw.vehicle_model).trim() : '',
        vehicle_specification: raw.vehicle_specification != null ? String(raw.vehicle_specification).trim() : '',
        vehicle_emirates: vehicle_emirates != null ? String(vehicle_emirates).trim() : '',
        vehicle_code: raw.vehicle_code != null ? String(raw.vehicle_code).trim() : '',
        vehicle_number: raw.vehicle_number != null ? String(raw.vehicle_number).trim() : '',
        default_vehicle: raw.default_vehicle === 1 || raw.default_vehicle === '1' || raw.default_vehicle === true,
    };
};

const parseCustomerVehiclesFromBody = (body) => {
    const parsedList = parseJsonArrayInput(body?.vehicles);
    if (parsedList) {
        return parsedList
            .map(normalizeCustomerVehicleInput)
            .filter((v) => v && !isVehicleFullyEmpty(v));
    }
    if (body?.vehicles === undefined || body?.vehicles === null || body?.vehicles === '') {
        const legacy = normalizeCustomerVehicleInput(body);
        if (legacy && !isVehicleFullyEmpty(legacy)) return [legacy];
        return [];
    }
    return [];
};

const validateCustomerVehicles = (vehicles) => {
    const kept = vehicles.filter((v) => !isVehicleFullyEmpty(v));
    const messages = [];
    kept.forEach((vehicle, index) => {
        const label = `Vehicle ${index + 1}`;
        if (vehicle.vehicle_specification
            && !VEHICLE_SPECIFICATION_OPTIONS.includes(vehicle.vehicle_specification)) {
            messages.push(`${label}: vehicle specification must be GCC or Non-GCC.`);
        }
    });
    if (messages.length) return { valid: false, message: messages };
    return { valid: true, vehicles: kept };
};

const parseChargerIds = (body) => {
    const raw = body.charger_ids ?? body.chargerIds ?? body.chargers ?? body.select_chargers;
    if (Array.isArray(raw)) {
        return raw.map((id) => String(id).trim()).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
        if (raw.startsWith('[')) {
            try {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.map((id) => String(id).trim()).filter(Boolean);
                }
            } catch {
                // fall through
            }
        }
        return raw.split(',').map((id) => id.trim()).filter(Boolean);
    }
    return [];
};

const parseCustomerBody = (body) => ({
    customer_id: String(body.customer_id ?? '').trim(),
    customer_name: String(body.customer_name ?? '').trim(),
    country_code: normalizeCountryCode(body.country_code),
    mobile_number: String(body.mobile_number ?? body.mobile_no ?? '').trim(),
    email: String(body.email ?? body.email_id ?? '').trim() || null,
    emirates: String(body.emirates ?? '').trim() || null,
    address: String(body.address ?? '').trim() || null,
    station_id: String(body.station_id ?? body.station ?? '').trim(),
    monthly_session_allocation: body.monthly_session_allocation ?? body.monthlySessionAllocation,
    allocated_time_minutes: body.allocated_time_minutes ?? body.alloted_time ?? body.allocatedTimeMinutes,
    kwh_allocation_per_month: body.kwh_allocation_per_month ?? body.kwh_allocated ?? body.kwhAllocationPerMonth,
    extra_charge_per_min_aed: body.extra_charge_per_min_aed ?? body.extra_charge ?? body.extraChargePerMinAed,
});

const validateCustomerForm = (fields, { isEdit = false } = {}) => {
    const errors = [];
    const requireField = (value, label) => {
        if (isBlank(value)) errors.push(`${label} is required.`);
    };

    if (isEdit) requireField(fields.customer_id, 'Customer ID');
    requireField(fields.mobile_number, 'Mobile Number');
    requireField(fields.station_id, 'Station');

    const numericFields = [
        ['monthly_session_allocation', 'Monthly Session Allocation'],
        ['allocated_time_minutes', 'Allocated Time In Minute'],
        ['kwh_allocation_per_month', 'kWh Allocation/Month'],
        ['extra_charge_per_min_aed', 'Extra Charge/Min Over Allocated Time'],
    ];
    const parsed = {};
    for (const [key, label] of numericFields) {
        if (fields[key] === undefined || fields[key] === null || String(fields[key]).trim() === '') {
            errors.push(`${label} is required.`);
        } else {
            const num = Number(fields[key]);
            if (!Number.isFinite(num) || num < 0) {
                errors.push(`${label} is invalid.`);
            } else {
                parsed[key] = key === 'monthly_session_allocation' || key === 'allocated_time_minutes'
                    ? Math.trunc(num)
                    : num;
            }
        }
    }

    if (!isBlank(fields.email) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) {
        errors.push('Please enter a valid Email Address.');
    }

    return { isValid: errors.length === 0, errors, ...parsed };
};

async function generateNextCustomerId() {
    const row = await queryDB(
        `SELECT MAX(CAST(SUBSTRING(customer_id, 5) AS UNSIGNED)) AS max_num
         FROM ${CUSTOMER_TABLE}
         WHERE customer_id REGEXP '^PCU-[0-9]+$'`
    );
    const next = (row?.max_num ?? 0) + 1;
    return `PCU-${String(next).padStart(3, '0')}`;
}

async function assertChargersBelongToStation(station_id, chargerIds) {
    if (!chargerIds.length) {
        return { ok: false, message: ['At least one charger must be selected.'] };
    }
    const placeholders = chargerIds.map(() => '?').join(', ');
    const [rows] = await db.execute(
        `SELECT charger_id FROM partner_chargers
         WHERE station_id = ? AND status = 1 AND charger_id IN (${placeholders})`,
        [station_id, ...chargerIds]
    );
    const found = new Set(rows.map((r) => r.charger_id));
    const missing = chargerIds.filter((id) => !found.has(id));
    if (missing.length) {
        return {
            ok: false,
            message: [`Charger(s) not linked to selected station: ${missing.join(', ')}`],
        };
    }
    return { ok: true };
}

async function syncCustomerChargers(customer_id, chargerIds) {
    await db.execute(`DELETE FROM ${CHARGER_MAP_TABLE} WHERE customer_id = ?`, [customer_id]);
    if (!chargerIds.length) return;
    const values = chargerIds.map((charger_id) => [customer_id, charger_id]);
    const placeholders = values.map(() => '(?, ?)').join(', ');
    await db.execute(
        `INSERT INTO ${CHARGER_MAP_TABLE} (customer_id, charger_id) VALUES ${placeholders}`,
        values.flat()
    );
}

async function syncCustomerVehicles(customer_id, vehicles) {
    await db.execute(`UPDATE ${VEHICLE_TABLE} SET status = 0 WHERE customer_id = ?`, [customer_id]);
    let defaultIndex = vehicles.findIndex((v) => v.default_vehicle);
    if (defaultIndex < 0) defaultIndex = 0;

    for (let i = 0; i < vehicles.length; i += 1) {
        const v = vehicles[i];
        await insertRecord(
            VEHICLE_TABLE,
            [
                'customer_id', 'vehicle_type', 'vehicle_make', 'vehicle_model', 'vehicle_specification',
                'vehicle_emirates', 'vehicle_code', 'vehicle_number', 'default_vehicle', 'status',
            ],
            [
                customer_id,
                v.vehicle_type || '',
                v.vehicle_make || '',
                v.vehicle_model || '',
                v.vehicle_specification || '',
                v.vehicle_emirates || '',
                v.vehicle_code || '',
                v.vehicle_number || '',
                i === defaultIndex ? 1 : 0,
                1,
            ]
        );
    }
}

async function loadCustomerChargers(customer_id) {
    const [rows] = await db.execute(
        `SELECT m.charger_id, c.charging_type, c.rated_power_kw, c.charger_status
         FROM ${CHARGER_MAP_TABLE} AS m
         INNER JOIN partner_chargers AS c ON c.charger_id = m.charger_id AND c.status = 1
         WHERE m.customer_id = ?`,
        [customer_id]
    );
    return rows;
}

async function loadCustomerVehicles(customer_id) {
    const [rows] = await db.execute(
        `SELECT vehicle_id, vehicle_type, vehicle_make, vehicle_model, vehicle_specification,
            vehicle_emirates, vehicle_code, vehicle_number, default_vehicle
         FROM ${VEHICLE_TABLE}
         WHERE customer_id = ? AND status = 1
         ORDER BY default_vehicle DESC, id ASC`,
        [customer_id]
    );
    return rows;
}

const CUSTOMER_LIST_COLUMNS = `
    c.customer_id, c.customer_name, c.country_code, c.mobile_number, c.email, c.emirates,
    c.station_id, ps.station_name, c.monthly_session_allocation, c.allocated_time_minutes,
    c.kwh_allocation_per_month, c.extra_charge_per_min_aed, ${formatDateTimeInQuery(['c.created_at'])}
`;

export const partnerCustomerFormData = asyncHandler(async (req, resp) => {
    const { customer_id, station_id } = mergeParam(req);
    const payload = {
        stations: await activeStationsForDropdown(),
        vehicleSpecificationOptions: VEHICLE_SPECIFICATION_OPTIONS,
    };

    if (station_id) {
        const [chargers] = await db.execute(`
            SELECT charger_id AS value, charger_id AS label
            FROM partner_chargers WHERE station_id = ? AND status = 1 ORDER BY charger_id
        `, [station_id]);
        payload.chargers = chargers;
    }

    if (customer_id) {
        const customer = await queryDB(
            `SELECT c.customer_id, c.customer_name, c.country_code, c.mobile_number, c.email, c.emirates,
                c.address, c.station_id, c.monthly_session_allocation, c.allocated_time_minutes,
                c.kwh_allocation_per_month, c.extra_charge_per_min_aed
             FROM ${CUSTOMER_TABLE} AS c WHERE c.customer_id = ? AND c.status = 1`,
            [customer_id]
        );
        if (!customer) {
            return resp.json({ status: 0, code: 404, message: ['Customer not found.'] });
        }
        customer.chargers = await loadCustomerChargers(customer_id);
        customer.charger_ids = customer.chargers.map((row) => row.charger_id);
        customer.vehicles = await loadCustomerVehicles(customer_id);
        payload.customerData = customer;
        if (customer.station_id) {
            const [chargers] = await db.execute(`
                SELECT charger_id AS value, charger_id AS label
                FROM partner_chargers WHERE station_id = ? AND status = 1 ORDER BY charger_id
            `, [customer.station_id]);
            payload.chargers = chargers;
        }
    } else {
        payload.nextCustomerId = await generateNextCustomerId();
    }

    return resp.json({
        status: 1,
        code: 200,
        message: ['Customer form data fetched successfully!'],
        data: payload,
    });
});

export const partnerCustomerList = async (req, resp) => {
    try {
        const {
            page_no = 1,
            search_text = '',
            station_id = '',
            start_date = '',
            end_date = '',
        } = mergeParam(req);

        const whereField = ['c.status'];
        const whereValue = [1];
        const whereOperator = ['='];

        if (station_id) {
            whereField.push('c.station_id');
            whereValue.push(station_id);
            whereOperator.push('=');
        }
        appendCreatedAtRangeWhere(whereField, whereValue, whereOperator, start_date, end_date, 'c.created_at');

        const result = await getPaginatedData({
            tableName: ` ${CUSTOMER_TABLE} AS c`,
            joinTable: ' partner_charging_stations AS ps',
            joinCondition: 'c.station_id = ps.station_id AND ps.status = 1',
            columns: CUSTOMER_LIST_COLUMNS,
            sortColumn: 'c.id',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['c.customer_id', 'c.customer_name', 'c.mobile_number'],
            liveSearchTexts: [search_text, search_text, search_text],
            whereField,
            whereValue,
            whereOperator,
        });

        return resp.json({
            status: 1,
            code: 200,
            message: ['Customer list fetched successfully!'],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('partnerCustomerList:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

export const partnerCustomerDetail = asyncHandler(async (req, resp) => {
    const { customer_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { customer_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const customer = await queryDB(
        `SELECT c.customer_id, c.customer_name, c.country_code, c.mobile_number, c.email, c.emirates,
            c.address, c.station_id, ps.station_name, c.monthly_session_allocation, c.allocated_time_minutes,
            c.kwh_allocation_per_month, c.extra_charge_per_min_aed, c.status,
            ${formatDateTimeInQuery(['c.created_at', 'c.updated_at'])}
         FROM ${CUSTOMER_TABLE} AS c
         LEFT JOIN partner_charging_stations AS ps ON ps.station_id = c.station_id AND ps.status = 1
         WHERE c.customer_id = ? AND c.status = 1`,
        [customer_id]
    );
    if (!customer) return resp.json({ status: 0, code: 404, message: ['Customer not found.'] });

    customer.chargers = await loadCustomerChargers(customer_id);
    customer.charger_ids = customer.chargers.map((row) => row.charger_id);
    customer.vehicles = await loadCustomerVehicles(customer_id);

    return resp.json({
        status: 1,
        code: 200,
        message: ['Customer details fetched successfully!'],
        data: customer,
        vehicleSpecificationOptions: VEHICLE_SPECIFICATION_OPTIONS,
    });
});

export const partnerCustomerAdd = asyncHandler(async (req, resp) => {
    try {
        const fields = parseCustomerBody(mergeParam(req));
        const chargerIds = parseChargerIds(mergeParam(req));
        const vehicles = parseCustomerVehiclesFromBody(mergeParam(req));

        const formCheck = validateCustomerForm(fields, { isEdit: false });
        if (!formCheck.isValid) {
            return resp.json({ status: 0, code: 422, message: formCheck.errors });
        }

        const vehicleCheck = validateCustomerVehicles(vehicles);
        if (!vehicleCheck.valid) {
            return resp.json({ status: 0, code: 422, message: vehicleCheck.message });
        }

        const station = await queryDB(
            `SELECT station_id FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
            [fields.station_id]
        );
        if (!station) {
            return resp.json({ status: 0, code: 404, message: ['Station not found.'] });
        }

        const chargerCheck = await assertChargersBelongToStation(fields.station_id, chargerIds);
        if (!chargerCheck.ok) {
            return resp.json({ status: 0, code: 422, message: chargerCheck.message });
        }

        const existingMobile = await queryDB(
            `SELECT customer_id FROM ${CUSTOMER_TABLE} WHERE mobile_number = ? AND status = 1 LIMIT 1`,
            [fields.mobile_number]
        );
        if (existingMobile) {
            return resp.json({ status: 0, code: 422, message: ['Mobile number already exists.'] });
        }

        const customer_id = await generateNextCustomerId();

        const insert = await insertRecord(
            CUSTOMER_TABLE,
            [
                'customer_id', 'customer_name', 'country_code', 'mobile_number', 'email', 'emirates',
                'address', 'station_id', 'monthly_session_allocation', 'allocated_time_minutes',
                'kwh_allocation_per_month', 'extra_charge_per_min_aed', 'status',
            ],
            [
                customer_id,
                fields.customer_name || '',
                fields.country_code,
                fields.mobile_number,
                fields.email,
                fields.emirates,
                fields.address,
                fields.station_id,
                formCheck.monthly_session_allocation,
                formCheck.allocated_time_minutes,
                formCheck.kwh_allocation_per_month,
                formCheck.extra_charge_per_min_aed,
                1,
            ]
        );

        if (insert.affectedRows === 0) {
            return resp.json({ status: 0, code: 500, message: ['Failed to add customer. Please try again.'] });
        }

        await syncCustomerChargers(customer_id, chargerIds);
        await syncCustomerVehicles(customer_id, vehicleCheck.vehicles);

        return resp.json({
            status: 1,
            code: 200,
            message: ['Customer added successfully!'],
            data: { customer_id },
        });
    } catch (error) {
        console.error('partnerCustomerAdd:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const partnerCustomerEdit = asyncHandler(async (req, resp) => {
    try {
        const fields = parseCustomerBody(mergeParam(req));
        const chargerIds = parseChargerIds(mergeParam(req));
        const vehicles = parseCustomerVehiclesFromBody(mergeParam(req));

        const formCheck = validateCustomerForm(fields, { isEdit: true });
        if (!formCheck.isValid) {
            return resp.json({ status: 0, code: 422, message: formCheck.errors });
        }

        const vehicleCheck = validateCustomerVehicles(vehicles);
        if (!vehicleCheck.valid) {
            return resp.json({ status: 0, code: 422, message: vehicleCheck.message });
        }

        const exists = await queryDB(
            `SELECT customer_id FROM ${CUSTOMER_TABLE} WHERE customer_id = ? AND status = 1`,
            [fields.customer_id]
        );
        if (!exists) {
            return resp.json({ status: 0, code: 404, message: ['Customer not found.'] });
        }

        const station = await queryDB(
            `SELECT station_id FROM partner_charging_stations WHERE station_id = ? AND status = 1`,
            [fields.station_id]
        );
        if (!station) {
            return resp.json({ status: 0, code: 404, message: ['Station not found.'] });
        }

        const chargerCheck = await assertChargersBelongToStation(fields.station_id, chargerIds);
        if (!chargerCheck.ok) {
            return resp.json({ status: 0, code: 422, message: chargerCheck.message });
        }

        const dupMobile = await queryDB(
            `SELECT customer_id FROM ${CUSTOMER_TABLE}
             WHERE mobile_number = ? AND customer_id != ? AND status = 1 LIMIT 1`,
            [fields.mobile_number, fields.customer_id]
        );
        if (dupMobile) {
            return resp.json({ status: 0, code: 422, message: ['Mobile number already exists.'] });
        }

        await updateRecord(
            CUSTOMER_TABLE,
            {
                customer_name: fields.customer_name || '',
                country_code: fields.country_code,
                mobile_number: fields.mobile_number,
                email: fields.email,
                emirates: fields.emirates,
                address: fields.address,
                station_id: fields.station_id,
                monthly_session_allocation: formCheck.monthly_session_allocation,
                allocated_time_minutes: formCheck.allocated_time_minutes,
                kwh_allocation_per_month: formCheck.kwh_allocation_per_month,
                extra_charge_per_min_aed: formCheck.extra_charge_per_min_aed,
            },
            ['customer_id'],
            [fields.customer_id]
        );

        await syncCustomerChargers(fields.customer_id, chargerIds);
        await syncCustomerVehicles(fields.customer_id, vehicleCheck.vehicles);

        return resp.json({
            status: 1,
            code: 200,
            message: ['Customer updated successfully!'],
            data: { customer_id: fields.customer_id },
        });
    } catch (error) {
        console.error('partnerCustomerEdit:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});