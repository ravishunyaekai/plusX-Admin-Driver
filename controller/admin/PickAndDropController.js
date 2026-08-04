import db from '../../config/db.js';
import dotenv from 'dotenv';
import moment from 'moment';
import { mergeParam, asyncHandler, convertTo24HourFormat, formatDateTimeInQuery, formatDateInQuery, createNotification, pushNotification } from '../../utils.js';
import { queryDB, getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import emailQueue from '../../emailQueue.js';
import validateFields from "../../validation.js";
import generateUniqueId from 'generate-unique-id';
dotenv.config();

export const bookingList = async (req, resp) => {
    try {
        const { page_no, order_status, start_date, end_date, search_text, rowSelected } = req.body;
        const { isValid, errors } = validateFields(req.body, { page_no: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName : 'charging_service',
            columns   : `request_id, rider_id, name, order_status, ROUND(price/100, 2) AS price, ${formatDateTimeInQuery(['created_at'])}, rescheduled_booking,
            (select rsa_name from rsa where rsa.rsa_id = charging_service.rsa_id) as rsa_name`,
            sortColumn : 'created_at',
            sortOrder  : 'DESC',
            page_no,
            limit            : rowSelected || 10,
            liveSearchFields : ['request_id', 'name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : ['order_status'],
            whereValue       : ['PNR'],
            whereOperator    : ["!="]
        };
        if (start_date && end_date) {
            
            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;

            // const givenStartDateTime = startFormattedDate + ' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            // const start = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')

            // const endToday = new Date(end_date);
            // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            // const end = formattedEndDate + ' 19:59:59';

             //optimized code
             const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
             const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

            params.whereField.push('created_at', 'created_at');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        if (order_status) {
            params.whereField.push('order_status');
            params.whereValue.push(order_status);
            params.whereOperator.push('=');
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Pick & Drop  Booking List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching p & d booking list:', error);
        resp.status(500).json({ message: 'Error fetching p & d booking list' });
    }
};

export const bookingDetails = async (req, resp) => {
    try {
        const { request_id } = req.body;
        if (!request_id) {
            return resp.json({ status: 0, code: 400, message: 'Booking ID is required.'});
        }
        const [[result]] = await db.execute(`
            SELECT 
                cs.request_id, cs.name, cs.country_code, cs.contact_no, cs.order_status, cs.pickup_address, ROUND(cs.price/100, 2) AS price, 
                cs.parking_number, cs.parking_floor, cs.pickup_latitude, cs.pickup_longitude, 
                (select concat(rsa_name, ",", country_code, "-", mobile) from rsa where rsa.rsa_id = cs.rsa_id) as rsa_data, cs.vehicle_id, cs.vehicle_data,
                DATE_FORMAT(cs.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time, 
                ${formatDateTimeInQuery(['cs.created_at'])}
            FROM 
                charging_service cs
            WHERE 
                cs.request_id = ?`,
            [request_id]
        );
        if (result.length === 0) {
            return resp.json({ status: 0, code: 404, message: 'Booking not found.', });
        }
        if(result.vehicle_data == '' || result.vehicle_data == null) {
            const vehicledata = await queryDB(`
                SELECT                 
                    vehicle_make, vehicle_model, vehicle_specification, emirates, vehicle_code, vehicle_number
                FROM 
                    riders_vehicles
                WHERE 
                    rider_id = ? and vehicle_id = ? 
                LIMIT 1 `,
            [ rider_id, result.vehicle_id ]);
            if(vehicledata) {
                result.vehicle_data = vehicledata.vehicle_make + ", " + vehicledata.vehicle_model+ ", "+ vehicledata.vehicle_specification+ ", "+ vehicledata.emirates+ "-" + vehicledata.vehicle_code + "-"+ vehicledata.vehicle_number ;
            }
        }
        const [history] = await db.execute(`
            SELECT 
                order_status, cancel_by, cancel_reason as reason, ${formatDateTimeInQuery(['created_at'])}, image, 
                (select rsa.rsa_name from rsa WHERE rsa.rsa_id = charging_service_history.rsa_id) as rsa_name
            FROM 
                charging_service_history 
            WHERE 
                service_id = ?
            ORDER By 
                id 
            ASC`, 
        [request_id]);

        const feedBack = await queryDB(`
            SELECT 
                rating, description, ${formatDateTimeInQuery(['created_at'])} 
            FROM 
                charging_service_feedback 
            WHERE 
                booking_id = ?
            LIMIT 1`,
        [request_id]);

        const order_status = history.filter(item => item.order_status === 'CNF');
        if(order_status.length > 1) {

            const matchingIndexes = history.map((item, index) => item.order_status === 'CNF' ? index : -1).filter(index => index !== -1);

            const lastValue                 = matchingIndexes[matchingIndexes.length - 1];
            history[lastValue].order_status = 'RPD'
        }
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Pick and Drop booking details fetched successfully!"],
            data    : result,
            history,
            imageUrl : `${process.env.DIR_UPLOADS}pick-drop-images/`,
            feedBack
        });
    } catch (error) {
        
        return resp.json({
            status  : 0,
            code    : 500,
            message : 'Error fetching booking details'
        });
    }
};

/* Invoice */
export const pdInvoiceList = async (req, resp) => {
    try {
        const { page_no, start_date, end_date, search_text } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const whereFields = []
        const whereValues = []
        const whereOperators = []

        if (start_date && end_date) {
           
            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;

            // const givenStartDateTime = startFormattedDate + ' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            // const start = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')

            // const endToday = new Date(end_date);
            // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            // const end = formattedEndDate + ' 19:59:59';

            //optimized code
            const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

            whereFields.push('created_at', 'created_at');
            whereValues.push(start, end);
            whereOperators.push('>=', '<=');
        }

        const result = await getPaginatedData({
            tableName: 'charging_service_invoice',
            columns: `invoice_id, amount, payment_status, invoice_date, currency, receipt_url, ${formatDateTimeInQuery(['created_at'])},
                (select concat(name, ",", country_code, "-", contact_no) from charging_service as cs where cs.request_id = charging_service_invoice.request_id limit 1)
                AS riderDetails`,
            sortColumn: 'created_at',
            sortOrder: 'DESC',
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
            message    : ["Portable Charger Invoice List fetched successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching invoice list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching invoice lists' });
    }
};

export const pdInvoiceDetails = asyncHandler(async (req, resp) => {
    const { invoice_id } = req.body;
    const { isValid, errors } = validateFields(req.body, { invoice_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const invoice = await queryDB(`
        SELECT 
            invoice_id, amount AS price, ${formatDateInQuery(['invoice_date'])},
            currency, cs.name, cs.request_id, price_details
        FROM 
            charging_service_invoice AS csi
        LEFT JOIN
            charging_service AS cs ON cs.request_id = csi.request_id
        WHERE 
            csi.invoice_id = ?
    `, [invoice_id]);

    invoice.servicePrice = invoice.price_details.amount;
    
    invoice.kw_dewa_amt  = invoice.price_details.kw_dewa_amt; 
    invoice.kw_cpo_amt   = invoice.price_details.kw_cpo_amt; 
    invoice.delv_charge  = invoice.price_details.delivry_charge;
     
    invoice.dis_price  = invoice.price_details.discount_amt;
    invoice.t_vat_amt  = invoice.price_details.vat_amount; 
    invoice.price      = invoice.price_details.total_price ; 
    invoice.price_details = {};
    
    return resp.json({
        message  : ["Pick & Drop Invoice Details fetched successfully!"],
        data     : invoice,
        status   : 1,
        code     : 200,
    });
});
/* Invoice */

/* Slot */
export const pdSlotList = async (req, resp) => {
    try {
        const { page_no, search_text = '', start_date, end_date } = req.body;
        const { isValid, errors } = validateFields(req.body, { page_no: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName: 'pick_drop_slot',
            columns: `slot_id, start_time, end_time, booking_limit, status, ${formatDateTimeInQuery(['created_at'])},${formatDateInQuery(['slot_date'])}, 
                (SELECT COUNT(id) FROM charging_service AS cs WHERE DATE(cs.slot_date_time) = pick_drop_slot.slot_date AND TIME(slot_date_time) = pick_drop_slot.start_time AND order_status NOT IN ("C") ) AS slot_booking_count
            `,
            sortColumn: 'slot_date DESC, start_time ASC',
            sortOrder: '',
            page_no,
            limit: 10,
            liveSearchFields: ['slot_id',],
            liveSearchTexts: [search_text,],
            whereField: [],
            whereValue: [],
            whereOperator: []
        };
        if (start_date && end_date) {
            const start = moment(start_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD");

            params.whereField.push('slot_date', 'slot_date');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status: 1,
            code: 200,
            message: ["Pick & Drop Slot List fetched successfully!"],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const pdSlotDetails = async (req, resp) => {
    try {
        const { slot_id, slot_date } = req.body;
        const { isValid, errors } = validateFields(req.body, { slot_date: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        // , "PNR"
        const [slotDetails] = await db.execute(`
            SELECT 
                id, slot_id, start_time, end_time, booking_limit, status, ${formatDateInQuery(['slot_date'])},
                (SELECT COUNT(id) FROM charging_service AS cs WHERE DATE(cs.slot_date_time) = pick_drop_slot.slot_date AND TIME(slot_date_time) = pick_drop_slot.start_time AND order_status NOT IN ("C") ) AS slot_booking_count
            FROM 
                pick_drop_slot 
            WHERE 
                slot_date = ?`,
            [slot_date]
        );
        return resp.json({
            status: 1,
            code: 200,
            message: ["Portable And Drop Slot Details fetched successfully!"],
            data: slotDetails,

        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const pdAddSlot = async (req, resp) => {
    try {
        const { slot_date, start_time, end_time, booking_limit, status = 1 } = req.body;
        const { isValid, errors } = validateFields(req.body, { slot_date: ["required"], start_time: ["required"], end_time: ["required"], booking_limit: ["required"], });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        if (!Array.isArray(start_time) || !Array.isArray(end_time) || !Array.isArray(booking_limit) || !Array.isArray(status)) {
            return resp.json({ status: 0, code: 422, message: 'Input data must be in array format.' });
        }
        if (start_time.length !== end_time.length || end_time.length !== booking_limit.length || booking_limit.length !== status.length) {
            return resp.json({ status: 0, code: 422, message: 'All input arrays must have the same length.' });
        }

        const values = []; const placeholders = [];
        const fSlotDate = moment(slot_date, "DD-MM-YYYY").format("YYYY-MM-DD");
        for (let i = 0; i < start_time.length; i++) {
            const slotId = `PDS${generateUniqueId({ length: 6 })}`;
            values.push(slotId, fSlotDate, convertTo24HourFormat(start_time[i]), convertTo24HourFormat(end_time[i]), booking_limit[i], status[i]);
            placeholders.push('(?, ?, ?, ?, ?, ?)');
        }

        const query = `INSERT INTO pick_drop_slot (slot_id, slot_date, start_time, end_time, booking_limit, status) VALUES ${placeholders.join(', ')}`;
        const [insert] = await db.execute(query, values);

        return resp.json({
            code: 200,
            message: insert.affectedRows > 0 ? ['Slots added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status: insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};

export const pdEditSlot = asyncHandler(async (req, resp) => {
    const { slot_id, slot_date, start_time, end_time, booking_limit, status } = req.body;
    const { isValid, errors } = validateFields(req.body, {
        slot_id: ["required"],
        slot_date: ["required"],
        start_time: ["required"],
        end_time: ["required"],
        booking_limit: ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    if (!Array.isArray(slot_id) || !Array.isArray(start_time) || !Array.isArray(end_time) || !Array.isArray(booking_limit) || !Array.isArray(status)
    ) {
        return resp.json({ status: 0, code: 422, message: "Input data must be in array format." });
    }
    if (
        start_time.length !== end_time.length || end_time.length !== booking_limit.length || booking_limit.length !== status.length
    ) {
        return resp.json({ status: 0, code: 422, message: "All input arrays must have the same length." });
    }

    let fSlotDate = moment(slot_date, "DD-MM-YYYY").format("YYYY-MM-DD");
    let errMsg = [];

    //  Fetch existing slots for the given date
    const [existingSlots] = await db.execute("SELECT slot_id FROM pick_drop_slot WHERE slot_date = ?", [fSlotDate]);
    const existingSlotIds = existingSlots.map((slot) => slot.slot_id);

    // Determine slots to delete
    const slotsToDelete = existingSlotIds.filter((id) => !slot_id.includes(id));

    //Delete slots that are no longer needed
    for (let id of slotsToDelete) {
        const [deleteResult] = await db.execute("DELETE FROM pick_drop_slot WHERE slot_id = ?", [id]);

        if (deleteResult.affectedRows === 0) {
            errMsg.push(`Failed to delete slot with id ${id}.`);
        }
    }

    // Update or insert slots
    for (let i = 0; i < start_time.length; i++) {
        const updates = {
            slot_date: fSlotDate,
            start_time: convertTo24HourFormat(start_time[i]),
            end_time: convertTo24HourFormat(end_time[i]),
            booking_limit: booking_limit[i],
            status: status[i],
        };

        if (slot_id[i]) {
            // Update existing slot
            const [updateResult] = await db.execute(`UPDATE pick_drop_slot SET start_time = ?, end_time = ?, booking_limit = ?, status = ? 
                  WHERE slot_id = ? AND slot_date = ?`,
                [
                    updates.start_time,
                    updates.end_time,
                    updates.booking_limit,
                    updates.status,
                    slot_id[i],
                    fSlotDate,
                ]
            );
            if (updateResult.affectedRows === 0)
                errMsg.push(`Failed to update ${start_time[i]} for slot_date ${fSlotDate}.`);
        } else {
            // Insert new slot
            const newSlotId = `PST${generateUniqueId({ length: 6 })}`;
            const [insertResult] = await db.execute(`INSERT INTO pick_drop_slot (slot_id, slot_date, start_time, end_time, booking_limit, status)  VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    newSlotId,
                    fSlotDate,
                    updates.start_time,
                    updates.end_time,
                    updates.booking_limit,
                    updates.status,
                ]
            );
            if (insertResult.affectedRows === 0)
                errMsg.push(`Failed to add ${start_time[i]} for slot_date ${fSlotDate}.`);
        }
    }

    if (errMsg.length > 0) {
        return resp.json({ status: 0, code: 400, message: errMsg.join(" | ") });
    }

    return resp.json({ code: 200, message: "Slots updated successfully!", status: 1 });
});

export const pdDeleteSlot = async (req, resp) => {
    try {
        const { slot_date } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            slot_date: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [del] = await db.execute(`DELETE FROM pick_drop_slot WHERE slot_date = ?`, [slot_date]);

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
/* Slot */

export const PodAssignBooking = async (req, resp) => {
    const { rsa_id, booking_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        rsa_id: ["required"],
        booking_id: ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    // const conn = await startTransaction();

    try {
        // , (select fcm_token from riders as r where r.rider_id = charging_service.rider_id ) as fcm_token
        const booking_data = await queryDB(`SELECT rider_id, rsa_id, slot_date_time FROM charging_service WHERE request_id = ?
        `, [booking_id]);

        if (!booking_data) {
            return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
        }
        const rsa = await queryDB(`SELECT rsa_name, email, fcm_token FROM rsa WHERE rsa_id = ?`, [rsa_id]);

        if (rsa_id == booking_data.rsa_id) {
            return resp.json({ message: `The booking is already assigned to Driver Name ${rsa.rsa_name}. Would you like to assign it to another driver?`, status: 0, code: 404 });
        }
        if (booking_data.rsa_id) {
            await db.execute(`DELETE FROM charging_service_assign WHERE order_id = ? AND rsa_id = ?`, [booking_id, booking_data.rsa_id]);
        }
        await insertRecord('charging_service_assign',
            ['order_id', 'rider_id', 'rsa_id', 'slot_date_time', 'status'],
            [booking_id, booking_data.rider_id, rsa_id, booking_data.slot_date_time, 0]);
        await updateRecord('charging_service', { rsa_id: rsa_id }, ['request_id'], [booking_id]);

        const href    = 'charging_service/' + booking_id;
        const heading = 'EV Pick Up & Drop Off Booking!';
        const desc    = `Booking Assigned: ${booking_id}`;
        createNotification(heading, desc, 'Charging Service', 'RSA', 'Admin', '', rsa_id, href);
        // pushNotification(booking_data.fcm_to ken, heading, desc, 'RDRFCM', href);
        pushNotification(rsa.fcm_token, heading, desc, 'RSAFCM', href);

        const htmlDriver = `<html>
            <body>
                <h4>Dear ${rsa.rsa_name},</h4>
                <p>A Booking of the EV Pick Up & Drop Off Service booking has been assigned to you.</p> 
                <p>Booking Details:</p>
                <p>Booking ID: ${booking_id}</p>
                <p>Date and Time of Service: ${moment(booking_data.slot_date_time, 'YYYY-MM-DD HH:mm:ss').format('D MMM, YYYY, h:mm A')}</p>
                <p> Best regards,<br/>PlusX Electric Team </p>
            </body>
        </html>`;
        emailQueue.addEmail(rsa.email, 'PlusX Electric App: Booking Confirmation for Your EV Pick Up & Drop Off Service', htmlDriver);

        // await commitTransaction(conn);
        return resp.json({
            status: 1,
            code: 200,
            message: "You have successfully assigned EV Pick Up & Drop Off booking."
        });

    } catch (err) {
        // await rollbackTransaction(conn);
        console.error("Transaction failed:", err);
        return resp.json({ status: 0, code: 500, message: "Oops! There is something went wrong! Please Try Again" });
    } finally {
        // if (conn) conn.release();
    }
};

/* Admin Cancel Booking */
export const adminCancelCSBooking = asyncHandler(async (req, resp) => {
    const { rider_id, booking_id, reason } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { rider_id: ["required"], booking_id: ["required"], reason: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const checkOrder = await queryDB(`
        SELECT 
            name, rsa_id, slot_date_time,
            (select MAX(cancel_reason) from charging_service_history as csh where csh.service_id = charging_service.request_id ) as cancel_reason, 
            concat( country_code, "-", contact_no) as contact_no, 
            (SELECT rd.rider_email FROM riders AS rd WHERE rd.rider_id = charging_service.rider_id) AS rider_email,
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service.rider_id) AS fcm_token,
            (select fcm_token from rsa where rsa.rsa_id = charging_service.rsa_id ) as rsa_fcm_token
        FROM 
            charging_service
        WHERE 
            request_id = ? AND rider_id = ? AND order_status IN ('CNF','A','ER') 
        LIMIT 1
    `, [booking_id, rider_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }

    const insert = await db.execute(
        'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, cancel_by, cancel_reason) VALUES (?, ?, "C", ?, "Admin", ?)',
        [booking_id, rider_id, checkOrder.rsa_id, reason]
    );
    if (insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

    await updateRecord('charging_service', { order_status: 'C' }, ['request_id'], [booking_id]);
    const href = `charging_service/${booking_id}`;
    const title = 'EV Pick Up & Drop Off Cancel!';
    const message = `We regret to inform you that your EV Pick Up & Drop Off booking (ID: ${booking_id}) has been cancelled by the admin.`;
    await createNotification(title, message, 'Charging Service', 'Rider', 'Rider', rider_id, rider_id, href);
    await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

    if (checkOrder.rsa_id) {
        await db.execute(`DELETE FROM charging_service_assign WHERE rider_id=? AND order_id = ?`, [rider_id, booking_id]);
        await db.execute('UPDATE rsa SET running_order = running_order - 1 WHERE rsa_id = ?', [checkOrder.rsa_id]);

        const message1 = `A Booking of the EV Pick Up & Drop Off booking has been cancelled by admin with booking id : ${booking_id}`;
        await createNotification(title, message1, 'Charging Service', 'RSA', 'Rider', rider_id, checkOrder.rsa_id, href);
        await pushNotification(checkOrder.rsa_fcm_token, title, message1, 'RSAFCM', href);
    }
    const slot_date_time = moment(checkOrder.slot_date_time).format('YYYY-MM-DD');

    const html = `<html>
        <body>
            <h4>Dear ${checkOrder.user_name},</h4>
            <p>We would like to inform you that your recent booking for the Pickup and Drop-Off EV Charging Service with PlusX Electric has been cancelled.</p><br />
            <p>Booking Details:</p><br />
            <p>Booking ID    : ${booking_id}</p>
            <p>Booking Date : ${slot_date_time}</p>
            <p>Thank you for choosing PlusX Electric, and we hope to serve you in the future!</p><br />
            <p>Warm regards,<br/> The PlusX Electric Team </p>
        </body>
    </html>`;
    emailQueue.addEmail(checkOrder.rider_email, `Booking Cancellation Confirmation - PlusX Electric Pickup & Drop-Off Charging Service`, html);

    const adminHtml = `<html>
        <body>
            <h4>Dear Admin,</h4>
            <p>This is to notify you that admin has canceled their PlusX Electric Pickup and Drop-Off EV Charging Service booking. Please find the details below:</p> <br />
            <p>Booking Details:</p><br />
            <p>Name         : ${checkOrder.name}</p>
            <p>Contact      : ${checkOrder.contact_no}</p>
            <p>Booking ID   : ${booking_id}</p>
            <p>Booking Date : ${checkOrder.slot_date_time}</p> 
            <p>Reason       : ${checkOrder.cancel_reason}</p> <br />
            <p>Thank you,<br/> The PlusX Electric Team </p>
        </body>
    </html>`;
    emailQueue.addEmail(process.env.MAIL_CS_ADMIN, `Pickup & Drop-Off Charging Service : Booking Cancellation `, adminHtml);

    return resp.json({ message: ['Booking has been cancelled successfully!'], status: 1, code: 200 });
});

export const failedBookingList = async (req, resp) => {
    try {
        const { page_no, start_date, end_date, search_text } = req.body;
        const { isValid, errors } = validateFields(req.body, { page_no: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName: 'failed_charging_service',
            columns: `request_id, name, order_status, ROUND(price/100, 2) AS price, ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn: 'created_at',
            sortOrder: 'DESC',
            page_no,
            limit: 10,
            liveSearchFields: ['request_id', 'name'],
            liveSearchTexts: [search_text, search_text],
            whereField: [],
            whereValue: [],
            whereOperator: []
        };

        if (start_date && end_date) {
            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;

            // const givenStartDateTime = startFormattedDate + ' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            // const start = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')

            // const endToday = new Date(end_date);
            // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            // const end = formattedEndDate + ' 19:59:59';

            //optimized code
            const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

            params.whereField = ['created_at', 'created_at'];
            params.whereValue = [start, end];
            params.whereOperator = ['>=', '<='];
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status: 1,
            code: 200,
            message: ["Failed Pick & Drop Booking List fetch successfully!"],
            data: result.data,
            total_page: result.totalPage,
            total: result.total,
        });
    } catch (error) {
        console.error('Error fetching p & d booking list:', error);
        resp.status(500).json({ message: 'Error fetching p & d booking list' });
    }
};

export const failedbookingDetails = async (req, resp) => {
    try {
        const { request_id } = req.body;

        if (!request_id) {
            return resp.json({ status: 0, code: 400, message: 'Booking ID is required.', });
        }
        const result = await db.execute(`
            SELECT 
                cs.request_id, cs.name, cs.country_code, cs.contact_no, cs.order_status, cs.pickup_address, ROUND(cs.price/100, 2) AS price, cs.parking_number, cs.parking_floor, cs.pickup_latitude, cs.pickup_longitude, cs.vehicle_data, DATE_FORMAT(cs.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ${formatDateTimeInQuery(['cs.created_at'])}
            FROM 
                failed_charging_service cs
            WHERE 
                cs.request_id = ?`,
            [request_id]
        );
        if (result.length === 0) {
            return resp.json({ status: 0, code: 404, message: 'Booking not found.', });
        }
        
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Failed Pick & Drop booking details fetched successfully!"],
            data    : result[0],
        });
    } catch (error) {
        return resp.json({
            status: 0,
            code: 500,
            message: 'Error fetching booking details'
        });
    }
};