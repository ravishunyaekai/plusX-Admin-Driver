import db, { startTransaction, commitTransaction, rollbackTransaction } from "../../config/db.js";
import { getPaginatedData, insertRecord, queryDB, updateRecord } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import { createNotification, pushNotification, asyncHandler, formatDateTimeInQuery, mergeParam, convertTo24HourFormat } from '../../utils.js';
import moment from 'moment';
import emailQueue from '../../emailQueue.js';
import generateUniqueId from 'generate-unique-id';
// import { sendAppDownloadWhatsApp } from '../../whatsappService.js';

import dotenv from 'dotenv';
dotenv.config();

const RSA_OFFLINE_DEVICE_NAME = 'Admin Offline';

const RSA_OFFLINE_STATUS_MAP = {
    'CNF'       : 'CNF',
    'CONFIRMED' : 'CNF',
    'PU'        : 'PU',
    'COMPLETED' : 'PU',
};

// const RSA_OFFLINE_STATUS_LABEL = {
//     CNF : 'confirmed',
//     PU  : 'completed',
// };

const RSA_OFFLINE_BOOKING_TABLE = 'rsa_offline_booking';
const RSA_OFFLINE_HISTORY_TABLE = 'rsa_offline_order_history';
const RSA_OFFLINE_INVOICE_TABLE = 'rsa_offline_invoice';

// Both ids are derived from the row's AUTO_INCREMENT id, so two admins saving at the
// same moment can never be handed the same number.
const buildOfflineRequestId = (rowId) => `RA-${String(rowId).padStart(3, '0')}`;
const buildOfflineInvoiceId = (rowId) => `RAINV-${String(rowId).padStart(2, '0')}`;

const toYesNo = (value) => ([true, 1, '1', 'true', 'yes', 'Yes', 'YES'].includes(value) ? 'Yes' : 'No');

const buildVehicleData = (vehicle_make, vehicle_model) =>
    [vehicle_make, vehicle_model].filter(Boolean).join(', ') || null;

const isMissingDate = (value) =>
    value === undefined || value === null || String(value).trim() === '' || String(value).includes('_');

const parseOfflineDate = (value) => {
    if (isMissingDate(value)) return null;
    const trimmed = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const parsed = moment(trimmed, [
        'YYYY-MM-DD HH:mm:ss',
        'YYYY-MM-DDTHH:mm:ss',
        'YYYY-MM-DDTHH:mm:ssZ',
        'DD-MM-YYYY',
        'DD/MM/YYYY',
        'DD-MM-YYYY HH:mm:ss',
    ], true);
    if (parsed.isValid()) return parsed.format('YYYY-MM-DD');

    const loose = moment(trimmed);
    return loose.isValid() ? loose.format('YYYY-MM-DD') : null;
};

const resolveOfflineDates = (booking_date, booking_completed_date, isCompleted) => {
    const bookingDate = parseOfflineDate(booking_date);
    const completedDate = isCompleted ? parseOfflineDate(booking_completed_date) : null;

    if (!isMissingDate(booking_date) && !bookingDate) {
        return { error: 'Invalid booking_date.' };
    }
    if (isCompleted && !isMissingDate(booking_completed_date) && !completedDate) {
        return { error: 'Invalid booking_completed_date.' };
    }

    return { bookingDate, completedDate };
};

const resolveOfflineRsaDriver = async (rsa_id, driver_name, booking_completed_by, connection = null) => {
    const completedByDriver = (driver_name || booking_completed_by || '').toString().trim() || null;

    if (!rsa_id) {
        return { rsa_id: null, driver_name: completedByDriver };
    }

    const rsa = await queryDB(
        `SELECT rsa_id, rsa_name FROM rsa WHERE rsa_id = ? AND booking_type = ? LIMIT 1`,
        [rsa_id, 'Roadside Assistance'],
        connection
    );
    if (!rsa) {
        return null;
    }

    return {
        rsa_id      : rsa.rsa_id,
        driver_name : completedByDriver || rsa.rsa_name,
    };
};

const RSA_OFFLINE_PROOF_FOLDER = 'rsa-offline-proof';

// Look up an existing rider by mobile. Never create a rider for offline bookings.
const findRiderIdByMobile = async (mobile, connection = null) => {
    const rider = await queryDB(
        `SELECT rider_id FROM riders WHERE rider_mobile = ? LIMIT 1`,
        [mobile],
        connection
    );
    return rider?.rider_id || null;
};

const parsePriceDetails = (value) => {
    if (!value) return {};
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value) || {};
    } catch {
        return {};
    }
};

/* RA Booking */
export const bookingList = asyncHandler(async (req, resp) => {
    const { start_date, end_date, search_text = '', status, page_no, rowSelected } = req.body;

    const whereFields    = ['order_status', `COALESCE(device_name, '')`]
    const whereValues    = ['PNR', RSA_OFFLINE_DEVICE_NAME]
    const whereOperators = ["!=", "!="]

    if (start_date && end_date) {
        
        // const startToday         = new Date(start_date);
        // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                    
        // const givenStartDateTime    = startFormattedDate+' 00:00:01';
        // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
        // const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
        
        // const endToday         = new Date(end_date);
        // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
        // const end = formattedEndDate+' 19:59:59';

        //optimized code
        const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
        const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

        whereFields.push('created_at', 'created_at');
        whereValues.push(start, end);
        whereOperators.push('>=', '<=');
    }
    if(status) {
        whereFields.push('order_status');
        whereValues.push(status);
        whereOperators.push('=');
    }
    const result = await getPaginatedData({
        tableName : 'road_assistance',
        columns   : `request_id, rider_id, name, ROUND(road_assistance.price/100, 2) AS price, order_status, ${formatDateTimeInQuery(['created_at'])}, (select rsa_name from rsa where rsa.rsa_id = road_assistance.rsa_id) as rsa_name`,
        liveSearchFields : ['request_id', 'name'],
        liveSearchTexts  : [search_text, search_text],
        sortColumn       : 'id',
        sortOrder        : 'DESC',
        page_no,
        limit         : rowSelected || 10,
        whereField    : whereFields,
        whereValue    : whereValues,
        whereOperator : whereOperators
    });
    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Booking List fetch successfully!"],
        data       : result.data,
        total_page : result.totalPage,
        total      : result.total,
    });    
});

export const bookingData = asyncHandler(async (req, resp) => {
    try {
        const { request_id } = req.body;
        if (!request_id) {
            return resp.json({ status : 0, code : 400, message : ['Booking ID is required.'] });
        }

        const booking = await queryDB(`
            SELECT 
                request_id, rider_id, ${formatDateTimeInQuery(['created_at'])}, name, country_code, contact_no, order_status, pickup_address, pickup_latitude, pickup_longitude, ROUND(road_assistance.price/100, 2) AS price, parking_number, parking_floor, 
                (select concat(rsa_name, ",", country_code, "-", mobile) from rsa where rsa.rsa_id = road_assistance.rsa_id) as rsa_data, vehicle_id, vehicle_data,
                (select pod_name from pod_devices as pd where pd.pod_id = road_assistance.pod_id) as pod_name, current_percent
            FROM 
                road_assistance 
            WHERE 
                request_id = ?
            LIMIT 1`, 
        [request_id]);
        if (!booking) {
            return resp.json({ status : 0, code : 404, message : ['Booking not found.'] });
        } 
        if(booking.vehicle_data == '' || booking.vehicle_data == null) {
            const vehicledata = await queryDB(`
                SELECT                 
                    vehicle_make, vehicle_model, vehicle_specification, emirates, vehicle_code, vehicle_number
                FROM 
                    riders_vehicles
                WHERE 
                    rider_id = ? and vehicle_id = ? 
                LIMIT 1 `,
            [ booking.rider_id, booking.vehicle_id ]);
            if(vehicledata) {
                booking.vehicle_data = vehicledata.vehicle_make + ", " + vehicledata.vehicle_model+ ", "+ vehicledata.vehicle_specification+ ", "+ vehicledata.emirates+ "-" + vehicledata.vehicle_code + "-"+ vehicledata.vehicle_number ;
            }
        }
        const [bookingHistory] = await db.execute(`
            SELECT 
                order_status, cancel_by, cancel_reason as reason, rsa_id, ${formatDateTimeInQuery(['created_at'])}, image, remarks,   
                (select rsa.rsa_name from rsa where rsa.rsa_id = order_history.rsa_id) as rsa_name
            FROM 
                order_history 
            WHERE 
                order_id = ?`, 
            [request_id]
        );
        booking.imageUrl = `${process.env.DIR_UPLOADS}road-assistance/`;
        booking.price = booking.price.toFixed(2);
        
        const feedBack = await queryDB(`
            SELECT 
                rating, description, ${formatDateTimeInQuery(['created_at'])} 
            FROM 
                road_assistance_feedback 
            WHERE 
                request_id = ?
            LIMIT 1`, 
        [request_id]);
        
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Booking details fetched successfully!"],
            data : {
                booking : booking,
                history : bookingHistory,
                feedBack
            }, 
        });
    } catch (error) {
        console.error('Error fetching booking details:', error);
        return resp.json({ 
            status  : 0, 
            code    : 500, 
            message : ['Error fetching booking details' ]
        });
    }
});

export const offlineRSABookingData = asyncHandler(async (req, resp) => {
    try {
        const { request_id } = req.body;
        if (!request_id) {
            return resp.json({ status : 0, code : 400, message : ['Booking ID is required.'] });
        }

        const booking = await queryDB(`
            SELECT
                b.request_id, b.rider_id, ${formatDateTimeInQuery(['b.created_at'])},
                DATE_FORMAT(b.booking_date, '%Y-%m-%d') AS booking_date,
                DATE_FORMAT(b.booking_completed_date, '%Y-%m-%d') AS booking_completed_date,
                b.customer_name AS name, b.mobile_no AS contact_no, b.email_id AS email, b.country_code,
                b.order_status, b.address AS pickup_address, b.location_link,
                b.vehicle_data, b.battery_level, b.jump_start_required,
                b.price, b.booking_price, b.mode_of_payment, b.rsa_id, b.proof_of_transaction,
                (SELECT h.driver_name FROM ${RSA_OFFLINE_HISTORY_TABLE} AS h
                    WHERE h.order_id = b.request_id ORDER BY h.id DESC LIMIT 1) AS driver_name,
                r.rsa_name,
                r.country_code AS driver_country_code,
                r.mobile AS driver_mobile_no,
                inv.invoice_id,
                COALESCE(b.payment_status, inv.payment_status) AS payment_status,
                COALESCE(b.transaction_id, inv.transaction_id) AS transaction_id
            FROM ${RSA_OFFLINE_BOOKING_TABLE} AS b
            LEFT JOIN ${RSA_OFFLINE_INVOICE_TABLE} AS inv ON inv.request_id = b.request_id
            LEFT JOIN rsa AS r ON r.rsa_id = b.rsa_id
            WHERE b.request_id = ?
            LIMIT 1
        `, [request_id]);

        if (!booking) {
            return resp.json({ status : 0, code : 404, message : ['Booking not found.'] });
        }

        const [history] = await db.execute(`
            SELECT order_status, driver_name, remarks, ${formatDateTimeInQuery(['created_at'])}
            FROM ${RSA_OFFLINE_HISTORY_TABLE}
            WHERE order_id = ?
            ORDER BY id ASC
        `, [request_id]);

        // vehicle_data is stored as "Make, Model" but the edit form needs the two dropdowns separately
        const [vehicleMake = null, ...vehicleModelParts] = String(booking.vehicle_data || '')
            .split(',')
            .map((part) => part.trim())
            .filter(Boolean);

        booking.price                    = Number(booking.price || 0).toFixed(2);
        booking.vehicle_make             = vehicleMake;
        booking.vehicle_model            = vehicleModelParts.join(', ') || null;
        booking.mobile_no                = booking.contact_no;
        booking.proof_of_transaction_url = booking.proof_of_transaction
            ? `${process.env.DIR_UPLOADS}${RSA_OFFLINE_PROOF_FOLDER}/${booking.proof_of_transaction}`
            : null;
        booking.booking_completed_by     = booking.driver_name;

        return resp.json({
            status  : 1,
            code    : 200,
            message : ['Offline booking details fetched successfully!'],
            data    : {
                booking,
                history,
                feedBack: null,
            },
        });
    } catch (error) {
        console.error('Error fetching offline booking details:', error);
        return resp.json({
            status  : 0,
            code    : 500,
            message : ['Error fetching offline booking details'],
        });
    }
});

export const offlineRSABookingList = asyncHandler(async (req, resp) => {
    const { start_date, end_date, search_text = '', status, page_no, rowSelected } = req.body;

    const whereFields    = [];
    const whereValues    = [];
    const whereOperators = [];

    if (status) {
        const orderStatus = RSA_OFFLINE_STATUS_MAP[String(status).trim().toUpperCase()];
        if (orderStatus) {
            whereFields.push('order_status');
            whereValues.push(orderStatus);
            whereOperators.push('=');
        }
    }

    if (start_date && end_date) {
        // Same window as the online bookingList: start of day minus the 4-hour UTC offset,
        // and end of day (23:59:59 Gulf time = 19:59:59 UTC) so bookings on end_date are included.
        const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
        const end   = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + ' 19:59:59';

        whereFields.push('created_at', 'created_at');
        whereValues.push(start, end);
        whereOperators.push('>=', '<=');
    }

    const result = await getPaginatedData({
        tableName : RSA_OFFLINE_BOOKING_TABLE,
        columns   : `request_id, rider_id, customer_name AS name, mobile_no AS contact_no, country_code, address AS pickup_address, location_link,
            vehicle_data, battery_level, jump_start_required,
            rsa_id,
            (SELECT h.driver_name FROM ${RSA_OFFLINE_HISTORY_TABLE} AS h
                WHERE h.order_id = ${RSA_OFFLINE_BOOKING_TABLE}.request_id ORDER BY h.id DESC LIMIT 1) AS driver_name,
            (SELECT r.rsa_name FROM rsa AS r WHERE r.rsa_id = ${RSA_OFFLINE_BOOKING_TABLE}.rsa_id LIMIT 1) AS rsa_name,
            price, order_status, payment_status, mode_of_payment, transaction_id, proof_of_transaction,
            DATE_FORMAT(booking_date, '%Y-%m-%d') AS booking_date,
            DATE_FORMAT(booking_completed_date, '%Y-%m-%d') AS booking_completed_date,
            ${formatDateTimeInQuery(['created_at'])},
            (SELECT invoice_id FROM ${RSA_OFFLINE_INVOICE_TABLE} AS inv WHERE inv.request_id = ${RSA_OFFLINE_BOOKING_TABLE}.request_id LIMIT 1) AS invoice_id`,
        liveSearchFields : ['request_id', 'customer_name', 'mobile_no'],
        liveSearchTexts  : [search_text, search_text, search_text],
        sortColumn       : 'id',
        sortOrder        : 'DESC',
        page_no,
        limit            : rowSelected || 10,
        whereField       : whereFields,
        whereValue       : whereValues,
        whereOperator    : whereOperators
    });

    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Offline RSA booking list fetched successfully!"],
        data       : result.data,
        total_page : result.totalPage,
        total      : result.total,
    });
});

export const offlineRSAVehicleList = asyncHandler(async (req, resp) => {
    const [vehicles] = await db.execute(`
        SELECT DISTINCT TRIM(make) AS make, TRIM(model) AS model
        FROM vehicle_brand_list
        WHERE status = ?
          AND make IS NOT NULL
          AND TRIM(make) != ''
          AND model IS NOT NULL
          AND TRIM(model) != ''
        ORDER BY make ASC, model ASC
    `, [1]);

    const vehicleMap = new Map();
    vehicles.forEach(({ make, model }) => {
        if (!vehicleMap.has(make)) {
            vehicleMap.set(make, {
                value  : make,
                label  : make,
                models : [],
            });
        }

        vehicleMap.get(make).models.push({
            value : model,
            label : model,
        });
    });

    return resp.json({
        status  : 1,
        code    : 200,
        message : ['Vehicle make and model list fetched successfully!'],
        data    : Array.from(vehicleMap.values()),
    });
});

export const addOfflineRSABooking = asyncHandler(async (req, resp) => {
    const {
        customer_name, mobile_no, email_id, emailId, country_code = '+971', location_link, address, price,
        vehicle_make, vehicle_model, battery_level, jump_start_required, payment_status, mode_of_payment,
        transaction_id, booking_status, driver_name = null, booking_completed_by = null, rsa_id = null,
        booking_date = null, booking_completed_date = null,
    } = mergeParam(req);

    const proofOfTransaction = req.files?.['proof_of_transaction']?.[0]?.filename || null;
    const email              = email_id || emailId;

    const { isValid, errors } = validateFields({
        ...mergeParam(req),
        email_id: email,
    }, {
        customer_name : ["required"],
        mobile_no     : ["required"],
        email_id      : ["required"],
        location_link : ["required"],
        address       : ["required"],
        price         : ["required"],
        booking_status: ["required"],
    });
    if (!isValid) {
        return resp.json({ status: 0, code: 422, message: errors });
    }

    const orderStatus = RSA_OFFLINE_STATUS_MAP[String(booking_status).trim().toUpperCase()];
    if (!orderStatus) {
        return resp.json({ status: 0, code: 422, message: ['Invalid booking status. Allowed values are Confirmed (CNF) or Completed (PU).'] });
    }
    const isCompleted = orderStatus === 'PU';
    const { error: dateError, bookingDate, completedDate } = resolveOfflineDates(
        booking_date, booking_completed_date, isCompleted
    );
    if (dateError) {
        return resp.json({ status: 0, code: 422, message: [dateError] });
    }

    const bookingPrice = Number(price);
    const jumpStart    = toYesNo(jump_start_required);
    const vehicleData  = buildVehicleData(vehicle_make, vehicle_model);

    let connection;
    try {
        connection = await startTransaction();

        const driverInfo = await resolveOfflineRsaDriver(rsa_id, driver_name, booking_completed_by, connection);
        if (driverInfo === null) {
            await rollbackTransaction(connection);
            connection = null;
            return resp.json({ status: 0, code: 422, message: ['Invalid RSA driver selected.'] });
        }

        const rider_id = await findRiderIdByMobile(mobile_no, connection);

        const temporaryRequestId = `TMP-${generateUniqueId({ length: 12 })}`;
        const insert = await insertRecord(RSA_OFFLINE_BOOKING_TABLE, [
            'request_id', 'rider_id', 'customer_name', 'mobile_no', 'email_id', 'country_code', 'location_link', 'address',
            'price', 'jump_start_required', 'battery_level', 'vehicle_data', 'booking_price',
            'order_status', 'payment_status', 'mode_of_payment', 'rsa_id', 'transaction_id', 'proof_of_transaction',
            'booking_date', 'booking_completed_date',
        ], [
            temporaryRequestId, rider_id, customer_name, mobile_no, email, country_code || '+971', location_link || null, address,
            bookingPrice, jumpStart, battery_level ?? 0, vehicleData, bookingPrice,
            orderStatus, payment_status || 'Pending', mode_of_payment || null, driverInfo.rsa_id, transaction_id || null, proofOfTransaction,
            bookingDate, completedDate,
        ], connection);

        if (insert.affectedRows === 0) {
            await rollbackTransaction(connection);
            connection = null;
            return resp.json({ status: 0, code: 500, message: ['Failed to create offline booking. Please try again.'] });
        }

        const request_id = buildOfflineRequestId(insert.insertId);
        await updateRecord(RSA_OFFLINE_BOOKING_TABLE, { request_id }, ['id'], [insert.insertId], connection);

        let invoice_id = null;
        if (isCompleted) {
            const temporaryInvoiceId = `TMP-${generateUniqueId({ length: 12 })}`;
            const invoiceInsert = await insertRecord(RSA_OFFLINE_INVOICE_TABLE, [
                'invoice_id', 'request_id', 'rider_id', 'amount', 'transaction_id', 'payment_status', 'invoice_date',
            ], [
                temporaryInvoiceId, request_id, rider_id, bookingPrice, transaction_id || null,
                payment_status || 'Pending', moment().format('YYYY-MM-DD HH:mm:ss'),
            ], connection);

            if (invoiceInsert.affectedRows === 0) {
                throw new Error('Failed to create offline RSA invoice');
            }

            invoice_id = buildOfflineInvoiceId(invoiceInsert.insertId);
            await updateRecord(RSA_OFFLINE_INVOICE_TABLE, { invoice_id }, ['id'], [invoiceInsert.insertId], connection);
        }

        await insertRecord(RSA_OFFLINE_HISTORY_TABLE, [
            'order_id', 'rider_id', 'driver_name', 'rsa_id', 'order_status', 'remarks',
        ], [
            request_id, rider_id, driverInfo.driver_name, driverInfo.rsa_id, orderStatus, null,
        ], connection);

        await commitTransaction(connection);
        connection = null;

        return resp.json({
            status               : 1,
            code                 : 200,
            message              : ['Offline RSA booking added successfully!'],
            request_id,
            rider_id,
            invoice_id,
            order_status         : orderStatus,
            rsa_id               : driverInfo.rsa_id,
            driver_name            : driverInfo.driver_name,
            proof_of_transaction   : proofOfTransaction,
            booking_date           : bookingDate,
            booking_completed_date : completedDate,
        });
    } catch (error) {
        if (connection) {
            await rollbackTransaction(connection);
        }
        console.error('[addOfflineRSABooking] error:', error);
        return resp.json({ status: 0, code: 500, message: ['Failed to add offline RSA booking.'] });
    }
});

export const editOfflineRSABooking = asyncHandler(async (req, resp) => {
    const {
        request_id, customer_name, mobile_no, email_id, emailId, country_code = '+971', location_link, address, price,
        vehicle_make, vehicle_model, battery_level, jump_start_required, payment_status, mode_of_payment,
        transaction_id, booking_status, driver_name = null, booking_completed_by = null, rsa_id = null,
        booking_date = null, booking_completed_date = null,
    } = mergeParam(req);

    const proofOfTransaction = req.files?.['proof_of_transaction']?.[0]?.filename || null;
    const email              = email_id || emailId;

    const { isValid, errors } = validateFields({
        ...mergeParam(req),
        email_id: email,
    }, {
        request_id    : ["required"],
        customer_name : ["required"],
        mobile_no     : ["required"],
        email_id      : ["required"],
        location_link : ["required"],
        address       : ["required"],
        price         : ["required"],
        booking_status: ["required"],
    });
    if (!isValid) {
        return resp.json({ status: 0, code: 422, message: errors });
    }

    const orderStatus = RSA_OFFLINE_STATUS_MAP[String(booking_status).trim().toUpperCase()];
    if (!orderStatus) {
        return resp.json({
            status  : 0,
            code    : 422,
            message : ['Invalid booking status. Allowed values are Confirmed (CNF) or Completed (PU).'],
        });
    }

    const existing = await queryDB(
        `SELECT request_id, order_status, proof_of_transaction
         FROM ${RSA_OFFLINE_BOOKING_TABLE}
         WHERE request_id = ?
         LIMIT 1`,
        [request_id]
    );
    if (!existing) {
        return resp.json({ status: 0, code: 404, message: ['Offline booking not found.'] });
    }

    const wasCompleted = existing.order_status === 'PU';
    const isCompleted  = orderStatus === 'PU';
    const { error: dateError, bookingDate, completedDate } = resolveOfflineDates(
        booking_date, booking_completed_date, isCompleted
    );
    if (dateError) {
        return resp.json({ status: 0, code: 422, message: [dateError] });
    }

    const bookingPrice = Number(price);
    const jumpStart    = toYesNo(jump_start_required);
    const vehicleData  = buildVehicleData(vehicle_make, vehicle_model);
    const savedProof   = proofOfTransaction || existing.proof_of_transaction || null;

    let connection;
    try {
        connection = await startTransaction();

        const driverInfo = await resolveOfflineRsaDriver(rsa_id, driver_name, booking_completed_by, connection);
        if (driverInfo === null) {
            await rollbackTransaction(connection);
            connection = null;
            return resp.json({ status: 0, code: 422, message: ['Invalid RSA driver selected.'] });
        }

        const rider_id = await findRiderIdByMobile(mobile_no, connection);

        const update = await updateRecord(RSA_OFFLINE_BOOKING_TABLE, {
            rider_id,
            customer_name,
            mobile_no,
            email_id              : email,
            country_code          : country_code || '+971',
            location_link         : location_link || null,
            address,
            price                 : bookingPrice,
            jump_start_required   : jumpStart,
            battery_level         : battery_level ?? 0,
            vehicle_data          : vehicleData,
            booking_price         : bookingPrice,
            order_status          : orderStatus,
            payment_status        : payment_status || 'Pending',
            mode_of_payment       : mode_of_payment || null,
            rsa_id                 : driverInfo.rsa_id,
            transaction_id         : transaction_id || null,
            proof_of_transaction   : savedProof,
            booking_date           : bookingDate,
            booking_completed_date : completedDate,
        }, ['request_id'], [request_id], connection);

        if (update.affectedRows === 0) {
            await rollbackTransaction(connection);
            connection = null;
            return resp.json({ status: 0, code: 500, message: ['Failed to update offline booking. Please try again.'] });
        }

        let invoice_id = null;
        const existingInvoice = await queryDB(
            `SELECT invoice_id FROM ${RSA_OFFLINE_INVOICE_TABLE} WHERE request_id = ? LIMIT 1`,
            [request_id],
            connection
        );

        if (isCompleted) {
            if (existingInvoice?.invoice_id) {
                invoice_id = existingInvoice.invoice_id;
                await updateRecord(RSA_OFFLINE_INVOICE_TABLE, {
                    rider_id,
                    amount         : bookingPrice,
                    payment_status : payment_status || 'Pending',
                    transaction_id : transaction_id || null,
                    invoice_date   : moment().format('YYYY-MM-DD HH:mm:ss'),
                }, ['request_id'], [request_id], connection);
            } else {
                const temporaryInvoiceId = `TMP-${generateUniqueId({ length: 12 })}`;
                const invoiceInsert = await insertRecord(RSA_OFFLINE_INVOICE_TABLE, [
                    'invoice_id', 'request_id', 'rider_id', 'amount', 'transaction_id', 'payment_status', 'invoice_date',
                ], [
                    temporaryInvoiceId, request_id, rider_id, bookingPrice, transaction_id || null,
                    payment_status || 'Pending', moment().format('YYYY-MM-DD HH:mm:ss'),
                ], connection);

                if (invoiceInsert.affectedRows === 0) {
                    throw new Error('Failed to create offline RSA invoice');
                }

                invoice_id = buildOfflineInvoiceId(invoiceInsert.insertId);
                await updateRecord(RSA_OFFLINE_INVOICE_TABLE, { invoice_id }, ['id'], [invoiceInsert.insertId], connection);
            }
        } else {
            invoice_id = existingInvoice?.invoice_id || null;
            if (existingInvoice?.invoice_id) {
                await updateRecord(RSA_OFFLINE_INVOICE_TABLE, { rider_id }, ['request_id'], [request_id], connection);
            }
        }

        const statusChanged = existing.order_status !== orderStatus;
        const latestHistory = await queryDB(
            `SELECT id, driver_name, rsa_id FROM ${RSA_OFFLINE_HISTORY_TABLE}
             WHERE order_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [request_id],
            connection
        );

        if (!latestHistory || statusChanged) {
            await insertRecord(RSA_OFFLINE_HISTORY_TABLE, [
                'order_id', 'rider_id', 'driver_name', 'rsa_id', 'order_status', 'remarks',
            ], [
                request_id, rider_id, driverInfo.driver_name, driverInfo.rsa_id, orderStatus, null,
            ], connection);
        } else {
            const historyUpdate = { rider_id };
            if ((driverInfo.driver_name || null) !== (latestHistory.driver_name || null)) {
                historyUpdate.driver_name = driverInfo.driver_name;
            }
            if ((driverInfo.rsa_id || null) !== (latestHistory.rsa_id || null)) {
                historyUpdate.rsa_id = driverInfo.rsa_id;
            }
            await updateRecord(
                RSA_OFFLINE_HISTORY_TABLE,
                historyUpdate,
                ['id'],
                [latestHistory.id],
                connection
            );
        }

        await commitTransaction(connection);
        connection = null;

        return resp.json({
            status               : 1,
            code                 : 200,
            message              : ['Offline RSA booking updated successfully!'],
            request_id,
            rider_id,
            invoice_id,
            order_status         : orderStatus,
            previous_status      : existing.order_status,
            rsa_id               : driverInfo.rsa_id,
            driver_name            : driverInfo.driver_name,
            proof_of_transaction   : savedProof,
            booking_date           : bookingDate,
            booking_completed_date : completedDate,
            invoice_created        : isCompleted && !wasCompleted && !!invoice_id && !existingInvoice,
        });
    } catch (error) {
        if (connection) {
            await rollbackTransaction(connection);
        }
        console.error('[editOfflineRSABooking] error:', error);
        return resp.json({ status: 0, code: 500, message: ['Failed to update offline RSA booking.'] });
    }
});

export const evRoadAssistanceCancelBooking = asyncHandler(async (req, resp) => {
    const { request_id, rider_id, reason } = req.body;
    const { isValid, errors }    = validateFields(req.body, { request_id : ["required"], reason : ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const order = await queryDB(`
        SELECT 
            rider_id, (select fcm_token from riders as r where r.rider_id = road_assistance.rider_id ) as fcm_token
        FROM 
            road_assistance
        WHERE 
            request_id = ? AND rider_id = ? AND order_status IN ('CNF', 'A', 'ER') 
        LIMIT 1  
    `, [request_id, rider_id]);

    if(!order) return resp.json({ status : 0, message: ["No booking found on this booking id."]});

    await db.execute(`UPDATE road_assistance SET order_status = 'C' WHERE request_id = ?`, [request_id]);
    await insertRecord('order_history', ['order_id', 'rider_id', 'cancel_by', 'order_status', 'cancel_reason'], [request_id, order.rider_id, 'Admin', 'C', reason]);

    const title = 'Order Cancelled!';
    const msg   = `We regret to inform you that your roadside assistance order no : ${request_id} has been cancelled.`;
    const href  = `road_assistance/${request_id}`;
    createNotification(title, msg, 'Roadside Assistance', 'Rider', 'Admin', '', order.rider_id, href);
    pushNotification(order.fcm_token, title, msg, 'RDRFCM', href);

    return resp.json({ status: 1, code:200, message: "Booking has been cancelled successfully!."});
});

/* RA Invoie */
export const invoiceList = asyncHandler(async (req, resp) => {
    const { page_no, search_text,start_date, end_date } = req.body;

    const whereFields = []
    const whereValues = []
    const whereOperators = []

    if (start_date && end_date) {
    
        // const startToday         = new Date(start_date);
        // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                    
        // const givenStartDateTime    = startFormattedDate+' 00:00:01';
        // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); 
        // const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
        
        // const endToday         = new Date(end_date);
        // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
        // const end = formattedEndDate+' 19:59:59';

        //optimized code
        const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
        const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

        whereFields.push('created_at', 'created_at');
        whereValues.push(start, end);
        whereOperators.push('>=', '<=');
    }
    // Online and offline invoices live in separate tables but are shown as one list.
    const combinedInvoices = `(
        SELECT
            rai.invoice_id, rai.request_id, rai.payment_status, rai.invoice_date, rai.currency,
            rai.amount, rai.created_at, 'Online' AS booking_source,
            (SELECT CONCAT(rs.name, ",", rs.country_code, "-", rs.contact_no)
                FROM road_assistance AS rs WHERE rs.request_id = rai.request_id LIMIT 1) AS riderDetails
        FROM road_assistance_invoice AS rai
        UNION ALL
        SELECT
            roi.invoice_id, roi.request_id, roi.payment_status, roi.invoice_date, 'aed' AS currency,
            ROUND(roi.amount * 100, 0) AS amount, roi.created_at, 'Offline' AS booking_source,
            (SELECT CONCAT(rob.customer_name, ",", rob.mobile_no)
                FROM ${RSA_OFFLINE_BOOKING_TABLE} AS rob WHERE rob.request_id = roi.request_id LIMIT 1) AS riderDetails
        FROM ${RSA_OFFLINE_INVOICE_TABLE} AS roi
    ) AS invoices`;

    const result = await getPaginatedData({
        tableName : combinedInvoices,
        columns   : `invoice_id, request_id, booking_source, payment_status, invoice_date, currency,
            ROUND(amount/100, 2) AS amount, riderDetails`,
        sortColumn : 'created_at',
        sortOrder  : 'DESC',
        page_no,
        limit: 10,
        liveSearchFields : ['invoice_id'],
        liveSearchTexts  : [search_text],
        whereField       : whereFields,
        whereValue       : whereValues,
        whereOperator    : whereOperators
    });
    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Invoice List fetch successfully!"],
        data       : result.data,
        total_page : result.totalPage,
        total      : result.total,
    });    
});

export const invoiceData = async (req, resp) => {
    const { invoice_id } = req.body;
    const { isValid, errors } = validateFields(req.body, { invoice_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    // Offline invoices are numbered RAINV-## and live in their own table.
    const isOffline = /^RAINV-/i.test(invoice_id);

    let data;
    if (isOffline) {
        data = await queryDB(`
            SELECT
                pci.invoice_id, pci.invoice_date, 'aed' AS currency,
                rs.customer_name AS name, rs.request_id, rs.battery_level AS current_percent,
                rs.price AS booking_amount, rs.booking_price
            FROM ${RSA_OFFLINE_INVOICE_TABLE} AS pci
            LEFT JOIN ${RSA_OFFLINE_BOOKING_TABLE} AS rs ON rs.request_id = pci.request_id
            WHERE pci.invoice_id = ?
        `, [invoice_id]);

        if (!data) return resp.json({ status: 0, code: 404, message: ["Invoice not found!"] });

        data.booking_source = 'Offline';
        data.servicePrice   = Number(data.booking_amount ?? data.booking_price ?? 0);
        data.dis_price      = 0;
        data.t_vat_amt      = 0;
        data.price          = Number(data.booking_price ?? data.booking_amount ?? 0);
        data.price_details  = {};
    } else {
        data = await queryDB(`
            SELECT
                invoice_id, invoice_date, currency,
                rs.name, rs.request_id, rs.current_percent, price_details
            FROM road_assistance_invoice AS pci
            LEFT JOIN road_assistance AS rs ON rs.request_id = pci.request_id
            WHERE pci.invoice_id = ?
        `, [invoice_id]);

        if (!data) return resp.json({ status: 0, code: 404, message: ["Invoice not found!"] });

        const priceDetails = parsePriceDetails(data.price_details);

        data.currency       = data.currency == "null" || data.currency == null ? 'aed' : data.currency;
        data.booking_source = 'Online';
        data.servicePrice   = priceDetails.amount ?? 0;
        data.dis_price      = priceDetails.discount_amt ?? 0;
        data.t_vat_amt      = priceDetails.vat_amount ?? 0;
        data.price          = priceDetails.total_price ?? 0;
        data.price_details  = {};
    }

    return resp.json({
        message : ["Ev Roadside Assistance Invoice Details fetched successfully!"],
        data    : data,
        status  : 1,
        code    : 200,
    });
};

export const rsaAssignBooking = async (req, resp) => {
    const {  rsa_id, booking_id  } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), {
        rsa_id     : ["required"],
        booking_id : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    try { 
        const booking_data = await queryDB( `SELECT rider_id, rsa_id, (select fcm_token from riders as r where r.rider_id = road_assistance.rider_id ) as fcm_token FROM road_assistance WHERE request_id = ?
        `, [booking_id ] );
    
        if (!booking_data) {
            return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
        }
        const rsa = await queryDB(`SELECT rsa_name, email, fcm_token FROM rsa WHERE rsa_id = ?`, [rsa_id]);
        if(rsa_id == booking_data.rsa_id) {
            return resp.json({ message: [`The booking is already assigned to Driver Name ${rsa.rsa_name}. Would you like to assign it to another driver?`], status: 0, code: 404 });
        }
        await insertRecord('order_assign', 
            ['order_id', 'rsa_id', 'rider_id', 'status'], [booking_id, rsa_id, booking_data.rider_id, 0]
        );
        await db.execute(`DELETE FROM order_assign WHERE order_id = ? AND rsa_id = ?`, [booking_id, booking_data.rsa_id]);
        await updateRecord('road_assistance', {rsa_id: rsa_id}, ['request_id'], [booking_id]);
       
        const href    = 'road_assistance/' + booking_id;
        const heading = 'EV Roadside Assistance';
        const desc    = `Booking Assigned : ${booking_id}`;
        // createNotification(heading, desc, 'Roadside Assistance', 'Rider', 'Admin', '', booking_data.rider_id, href);
        // pushNotification(booking_data.fcm_token, heading, desc, 'RDRFCM', href);

        const desc1 = `Booking Assigned : ${booking_id}`;
        createNotification(heading, desc1, 'Roadside Assistance', 'RSA', 'Admin', '', rsa_id, href);
        if(rsa.fcm_token) {
            pushNotification(rsa.fcm_token, heading, desc1, 'RSAFCM', href);
        }
        const htmlDriver = `<html>
            <body>
                <h4>Dear ${rsa.rsa_name},</h4>
                <p>A Booking of the EV Roadside Assistance booking has been assigned to you.</p> 
                <p>Booking Details:</p>
                Booking ID: ${booking_id}<br>
                <p> Best regards,<br/>PlusX Electric Team </p>
            </body>
        </html>`;
        emailQueue.addEmail(rsa.email, 'PlusX Electric App: Booking Confirmation for Your EV Roadside Assistance!', htmlDriver);
        
        return resp.json({
            status  : 1, 
            code    : 200,
            message : ["You have successfully assigned EV Roadside Assistance booking." ]
        });

    } catch(err){
        
        console.error("Transaction failed:", err);
        return resp.json({status: 0, code: 500, message: ["Oops! There is something went wrong! Please Try Again"] });
    } finally {
        
    }
};

export const failedRSABookingList = async (req, resp) => {
    try {
        const { page_no, start_date, end_date, search_text = '' } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no : ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName : 'failed_road_assistance',
            columns   : `request_id, name, ROUND(price/100, 2) AS price, order_status, ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            limit: 10,
            liveSearchFields : ['request_id', 'name' ],
            liveSearchTexts  : [search_text, search_text ],
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],          
            whereField       : [],
            whereValue       : [],
            whereOperator    : []
        };
        if (start_date && end_date) {
            
            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                       
            // const givenStartDateTime    = startFormattedDate+' 00:00:01';
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
            // const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            // const endToday = new Date(end_date);
            // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            // const end = formattedEndDate+' 19:59:59';

            //optimized code
            const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

            params.whereField.push('created_at', 'created_at');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Failed POD Booking List fetched successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};
export const failedRSABookingDetails = async (req, resp) => {
    try {
        const { booking_id } = req.body;

        if (!booking_id) {
            return resp.json({ status : 0, code : 400, message : ['Booking ID is required.']});
        } 
        const [[bookingResult]] = await db.execute(`
            SELECT 
                request_id, rider_id, ${formatDateTimeInQuery(['created_at'])}, name, country_code, contact_no, order_status, pickup_address, pickup_latitude, pickup_longitude, parking_number, parking_floor, ROUND(price/100, 2) AS price, vehicle_id, vehicle_data
            FROM 
                failed_road_assistance 
            WHERE 
                request_id = ?`, 
            [booking_id]
        ); 
        if (bookingResult.length === 0) {
            return resp.json({ status : 0, code : 404, message : ['Booking not found.'] });
        } 
        
        if(bookingResult.vehicle_data == '' || bookingResult.vehicle_data == null) {
            const vehicledata = await queryDB(`
                SELECT                 
                    vehicle_make, vehicle_model, vehicle_specification, emirates, vehicle_code, vehicle_number
                FROM 
                    riders_vehicles
                WHERE 
                    rider_id = ? and vehicle_id = ? 
                LIMIT 1 `,
            [ bookingResult.rider_id, bookingResult.vehicle_id ]);
            
            if(vehicledata) {
                bookingResult.vehicle_data = vehicledata.vehicle_make + ", " + vehicledata.vehicle_model+ ", "+ vehicledata.vehicle_specification+ ", "+ vehicledata.emirates+ "-" + vehicledata.vehicle_code + "-"+ vehicledata.vehicle_number ;
            }
        }
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["failed Booking details fetched successfully!"],
            data : bookingResult, 
        });
    } catch (error) {
        console.error('Error fetching booking details:', error);
        return resp.json({ 
            status  : 0, 
            code    : 500, 
            message : 'Error fetching booking details' 
        });
    }
};

/* Slot */
export const rsaSlotList = async (req, resp) => {
    try {
        const { page_no,  search_text = '', days =''} = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no: ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        let slot_date = moment().format("YYYY-MM-DD"); 
 
        const params = {
            tableName  : 'road_assistance_slot',
            columns    : `slot_id, slot_date, start_time, end_time, slot_price, status`,
            sortColumn : `FIELD( slot_date, 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday' ), start_time ASC`,
            sortOrder  : '',
            page_no,
            limit            : 10,
            liveSearchFields : ['start_time', 'end_time', 'slot_date'],
            liveSearchTexts  : [search_text, search_text, search_text],
            whereField       : [],
            whereValue       : [],
            whereOperator    : []
        };
        if (days) {
            params.whereField.push('slot_date' );
            params.whereValue.push(days);
            params.whereOperator.push('=');
        }
        const result = await getPaginatedData(params);
        const formattedData = result.data.map((item) => ({
            slot_id            : item.slot_id,
            slot_date          : item.slot_date, //moment(item.slot_date, "DD-MM-YYYY").format('YYYY-MM-DD'),
             
            status             : item.status,
            slot_booking_count : 0, //item.slot_booking_count,
            timing             : `${item.start_time} - ${item.end_time}`,
            slot_price         : item.slot_price,
        }));
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["RSA Slot List fetched successfully!"],
            data       : formattedData,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const rsaSlotDetails = async (req, resp) => {
    try {
        const { slot_id, slot_date} = req.body;
        const { isValid, errors } = validateFields(req.body, {slot_date: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // (SELECT COUNT(id) FROM road_assistance AS pod WHERE pod.slot_time = road_assistance_slot.start_time AND pod.slot_date = road_assistance_slot.slot_date AND status NOT IN ("PU", "C", "RO")) AS slot_booking_count

        const [slotDetails] = await db.execute(`
            SELECT 
                id, slot_id, slot_date, start_time, end_time, slot_price, status
            FROM 
                road_assistance_slot 
            WHERE 
                slot_date = ?`, 
            [slot_date]
        );
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["RSA Slot Details fetched successfully!"],
            data    : slotDetails,
            
        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const rsaSlotAdd = async (req, resp) => {
    try {
        const { slot_date, start_time, end_time, slot_price, status = 1 } = req.body;
        const { isValid, errors } = validateFields(req.body, { 
            slot_date     : ["required"], 
            start_time    : ["required"], 
            end_time      : ["required"],
            slot_price      : ["required"], 
        }); 
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
        if ( !Array.isArray(start_time) || !Array.isArray(end_time) || !Array.isArray(slot_price) || !Array.isArray(status)) {
            return resp.json({ status: 0, code: 422, message: 'Input data must be in array format.' });
        }
        if ( start_time.length !== end_time.length || end_time.length !== slot_price.length || slot_price.length !== status.length) {
            return resp.json({ status: 0, code: 422, message: 'All input arrays must have the same length.' });
        }
        const values = []; const placeholders = [];
        // const fSlotDate = moment(slot_date, "DD-MM-YYYY").format("YYYY-MM-DD");
        for (let i = 0; i < start_time.length; i++) {            
            const slotId = `PTS${generateUniqueId({ length:6 })}`;
            values.push(slotId, slot_date, convertTo24HourFormat(start_time[i]), convertTo24HourFormat(end_time[i]), slot_price[i], status[i]);
            placeholders.push('(?, ?, ?, ?, ?, ?)');
        }
        const query = `INSERT INTO road_assistance_slot (slot_id, slot_date, start_time, end_time, slot_price, status) VALUES ${placeholders.join(', ')}`;
        const [insert] = await db.execute(query, values);
        
        return resp.json({
            code    : 200,
            message : insert.affectedRows > 0 ? ['Slots added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status  : insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.json({ message: 'Something went wrong' });
    }
};

export const rsaSlotEdit = asyncHandler(async (req, resp) => {
    const { slot_id, slot_date, start_time, end_time, slot_price, status } = req.body;
    const { isValid, errors } = validateFields(req.body, {
        slot_id       : ["required"],
        slot_date     : ["required"],
        start_time    : ["required"],
        end_time      : ["required"],
        slot_price    : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    if (!Array.isArray(slot_id) || !Array.isArray(start_time) || !Array.isArray(slot_price) || !Array.isArray(end_time) || !Array.isArray(status) ) {
        return resp.json({ status: 0, code: 422, message: "Input data must be in array format." });
    }
    if ( start_time.length !== end_time.length || end_time.length !== slot_price.length || slot_price.length !== status.length ) {
        return resp.json({ status: 0, code: 422, message: "All input arrays must have the same length." });
    }
    // let fSlotDate = moment(slot_date, "DD-MM-YYYY").format("YYYY-MM-DD");
    let errMsg    = [];

    //  Fetch existing slots for the given date
    const [existingSlots] = await db.execute("SELECT slot_id FROM road_assistance_slot WHERE slot_date = ?",[slot_date]);
    const existingSlotIds = existingSlots.map((slot) => slot.slot_id);

    // Determine slots to delete
    const slotsToDelete = existingSlotIds.filter((id) => !slot_id.includes(id));

    //Delete slots that are no longer needed
    for (let id of slotsToDelete) {
        const [deleteResult] = await db.execute("DELETE FROM road_assistance_slot WHERE slot_id = ?", [id] );

        if (deleteResult.affectedRows === 0) {
            errMsg.push(`Failed to delete slot with id ${id}.`);
        }
    }
    // Update or insert slots
    for (let i = 0; i < start_time.length; i++) {
        const updates = {
            slot_date  : slot_date,
            start_time : convertTo24HourFormat(start_time[i]),
            end_time   : convertTo24HourFormat(end_time[i]),
            status     : status[i],
            slot_price : slot_price[i],
        };
        if (slot_id[i]) {
            // Update existing slot
            const [updateResult] = await db.execute(`UPDATE road_assistance_slot SET start_time = ?, end_time = ?, status = ?, slot_price = ? 
                  WHERE slot_id = ? AND slot_date = ?`,
                [
                    updates.start_time,
                    updates.end_time,
                    updates.status,
                    updates.slot_price,
                    slot_id[i],
                    slot_date,
                ]
            );
            if (updateResult.affectedRows === 0)
                errMsg.push(`Failed to update ${start_time[i]} for slot_day ${slot_date}.`);
        } else {
            // Insert new slot
            const newSlotId = `PST${generateUniqueId({ length: 6 })}`;
            const [insertResult] = await db.execute(`INSERT INTO road_assistance_slot (slot_id, slot_date, start_time, end_time, slot_price, status)  VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    newSlotId,
                    slot_date,
                    updates.start_time,
                    updates.end_time,
                    updates.slot_price,
                    updates.status,
                ]
            );
            if (insertResult.affectedRows === 0)
                errMsg.push(`Failed to add ${start_time[i]} for slot_day ${slot_date}.`);
        }
    }
    if (errMsg.length > 0) {
        return resp.json({ status: 0, code: 400, message: errMsg.join(" | ") });
    }
    return resp.json({ code: 200, message: "Slots updated successfully!", status: 1 });
});

export const rsaDeleteSlot = async (req, resp) => {
    try {
        const { slot_date } = req.body; 

        const { isValid, errors } = validateFields(req.body, {
            slot_date: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [del] = await db.execute(`DELETE FROM road_assistance_slot WHERE slot_date = ?`, [slot_date]);

        return resp.json({
            code: 200,
            message: del.affectedRows > 0 ? ['Time Slot deleted successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status: del.affectedRows > 0 ? 1 : 0
        });
    } catch (err) {
        console.error('Error deleting time slot', err);
        return resp.json({ status: 0, message: 'Error deleting time slot' });
    }
}