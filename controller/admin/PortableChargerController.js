import db from '../../config/db.js';
import dotenv from 'dotenv';
import moment from 'moment';
import { mergeParam, asyncHandler, convertTo24HourFormat, formatDateInQuery, createNotification, pushNotification, formatDateTimeInQuery} from '../../utils.js';
import { queryDB, getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import generateUniqueId from 'generate-unique-id';
import emailQueue from '../../emailQueue.js';
dotenv.config();

export const chargerBookingList = async (req, resp) => {
    try {
        const { page_no, booking_id, name, contact, status, start_date, end_date, search_text = '', scheduleFilters, areaSelected, rowSelected } = req.body;

        const { isValid, errors } = validateFields(req.body, { page_no : ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName : 'portable_charger_booking',
            columns   : `booking_id, rider_id, user_name, status, address_alert, rescheduled_booking, 
            (select rsa_name from rsa where rsa.rsa_id = portable_charger_booking.rsa_id) as rsa_name, 
                ${formatDateInQuery(['slot_date'])}, concat(slot_date, " ", slot_time) as slot_time, ${formatDateTimeInQuery(['created_at'])}, area`,
            sortColumn : 'slot_date DESC, slot_time ASC',
            sortOrder  : '',
            page_no,
            limit            : rowSelected || 10,
            liveSearchFields : ['booking_id', 'user_name' ],
            liveSearchTexts  : [search_text, search_text ],
            whereField       : ['status'],
            whereValue       : ['PNR'],
            whereOperator    : ["!="]
        };

        if (start_date && end_date) {
            
            const startToday = new Date(start_date);
            const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                        
            const givenStartDateTime    = startFormattedDate+' 00:00:01'; 
            const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); 
            const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            const endToday = new Date(end_date);
            const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            const end = formattedEndDate+' 19:59:59';

            params.whereField.push('created_at', 'created_at');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        if (scheduleFilters.start_date && scheduleFilters.end_date) {
            
            const schStart = moment(scheduleFilters.start_date).format("YYYY-MM-DD");
            const schEnd = moment(scheduleFilters.end_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            
            params.whereField.push('slot_date', 'slot_date');
            params.whereValue.push(schStart, schEnd);
            params.whereOperator.push('>=', '<=');
        }
        if(status) {
            params.whereField.push('status');
            params.whereValue.push(status);
            params.whereOperator.push('=');
        }
        if(areaSelected) {
            params.whereField.push('area');
            params.whereValue.push(areaSelected);
            params.whereOperator.push('=');
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Portable Charger Booking List fetched successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};

export const chargerBookingDetails = async (req, resp) => {
    try {
        const { booking_id } = req.body;

        if (!booking_id) {
            return resp.json({ status : 0, code : 400, message : ['Booking ID is required.'] });
        }
        const [[bookingResult]] = await db.execute(`
            SELECT 
                booking_id, rider_id, ${formatDateTimeInQuery(['created_at'])}, user_name, country_code, contact_no, status, address, latitude, area,
                longitude, service_name, service_price, service_type, service_feature, ${formatDateInQuery(['slot_date'])}, slot_time, parking_number, parking_floor, 
                (select concat(rsa_name, ",", country_code, "-", mobile) from rsa where rsa.rsa_id = portable_charger_booking.rsa_id) as rsa_data, vehicle_id, vehicle_data,
                (select pod_name from pod_devices as pd where pd.pod_id = portable_charger_booking.pod_id) as pod_name,
                (select count(*) from portable_charger_booking as pcb where pcb.rider_id = portable_charger_booking.rider_id and pcb.booking_id != portable_charger_booking.booking_id) as cust_booking_count, current_percent
            FROM 
                portable_charger_booking 
            WHERE 
                booking_id = ?`, 
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
        const [bookingHistory] = await db.execute(`
            SELECT 
                order_status, cancel_by, cancel_reason as reason, rsa_id, ${formatDateTimeInQuery(['created_at'])}, image, remarks,   
                (select rsa.rsa_name from rsa where rsa.rsa_id = portable_charger_history.rsa_id) as rsa_name
            FROM 
                portable_charger_history 
            WHERE 
                booking_id = ? order by id asc`, 
            [booking_id]
        );
        const history        = bookingHistory ;
        const order_status = history.filter(item => item.order_status === 'CNF');
        if(order_status.length > 1) {

            const matchingIndexes = history.map((item, index) => item.order_status === 'CNF' ? index : -1)
                .filter(index => index !== -1);

            const lastValue                 = matchingIndexes[matchingIndexes.length - 1];
            history[lastValue].order_status = 'RSB'
        }
        bookingResult.imageUrl = `${process.env.DIR_UPLOADS}portable-charger/`;
        const feedBack = await queryDB(`
            SELECT 
                rating, description, ${formatDateTimeInQuery(['created_at'])} 
            FROM 
                portable_charger_booking_feedback 
            WHERE 
                booking_id = ?
            LIMIT 1`, 
        [booking_id]);
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Booking details fetched successfully!"],
            data : {
                booking : bookingResult,
                history,
                feedBack
            }, 
        });
    } catch (error) {
        console.log('Error fetching booking details:', error);
        return resp.json({ 
            status  : 0, 
            code    : 500, 
            message : 'Error fetching booking details' 
        });
    }
};

/* Invoice */
export const invoiceList = async (req, resp) => {
    try {
        const { page_no, start_date, end_date, search_text } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const whereFields    = []
        const whereValues    = []
        const whereOperators = []

        if (start_date && end_date) {
            
            const startToday         = new Date(start_date);
            const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                       
            const givenStartDateTime    = startFormattedDate+' 00:00:01';
            const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
            const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            const endToday         = new Date(end_date);
            const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            const end = formattedEndDate+' 19:59:59';
    
            whereFields.push('created_at', 'created_at');
            whereValues.push(start, end);
            whereOperators.push('>=', '<=');
        }
        const result = await getPaginatedData({
            tableName : 'portable_charger_invoice',
            columns   : `invoice_id, amount, payment_status, invoice_date, currency, 
                (select concat(user_name, ",", country_code, "-", contact_no) from portable_charger_booking as pcb where pcb.booking_id = portable_charger_invoice.request_id limit 1)
                AS riderDetails`,
            sortColumn : 'invoice_date',
            sortOrder  : 'DESC',
            page_no,
            limit            : 10,
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
        return resp.json({ status: 0, message: 'Error fetching invoice lists' });
    }
};

export const invoiceDetails = async (req, resp) => {
    const { invoice_id } = req.body;
    const { isValid, errors } = validateFields(req.body, { invoice_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const data = await queryDB(`
        SELECT 
            invoice_id, invoice_date, currency,  
            pcb.user_name, pcb.booking_id, pcb.created_at, pcb.start_charging_level, pcb.end_charging_level, price_details
        FROM 
            portable_charger_invoice AS pci 
        LEFT JOIN 
            portable_charger_booking AS pcb ON pcb.booking_id = pci.request_id
        WHERE pci.invoice_id = ?
    `, [invoice_id]);

    const today       = moment('2025-07-17').format("YYYY-MM-DD");
    const bookingdate = moment(data.created_at).format("YYYY-MM-DD");

    data.kw = data.price_details.kw_consume; 
    // if( bookingdate > today) {
    //     let chargeLevel       = data.end_charging_level - data.start_charging_level;
    //     const chargingPercent =  Math.floor(( chargeLevel ) * 36) / 100;

    //     data.kw        = chargeLevel + chargingPercent;
    // }
    data.kw_dewa_amt  = data.price_details.kw_dewa_amt; 
    data.kw_cpo_amt   = data.price_details.kw_cpo_amt; 
    data.delv_charge  = data.price_details.delivry_charge;
     
    data.dis_price  = data.price_details.discount_amt;
    data.t_vat_amt  = data.price_details.vat_amount; 
    data.price      = Math.round(data.price_details.total_price) ; 
    data.price_details = {};
         
    return resp.json({
        message : ["Portable Charger Invoice Details fetched successfully!"],
        data    : data,
        status  : 1,
        code    : 200,
    });
};

/* Slot */
export const slotList = async (req, resp) => {
    try {
        const { page_no,  search_text = '', start_date, end_date} = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no: ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        let slot_date = moment().format("YYYY-MM-DD"); 
 
        const params = {
            tableName  : 'portable_charger_slot',
            columns    : `slot_id, slot_date, start_time, end_time, booking_limit, status, 
                (SELECT COUNT(id) FROM portable_charger_booking AS pod WHERE pod.slot_time = portable_charger_slot.start_time AND pod.slot_date = portable_charger_slot.slot_date AND status NOT IN ("C")) AS slot_booking_count
            `,
            sortColumn : 'slot_date DESC, start_time ASC',
            sortOrder  : '',
            page_no,
            limit            : 10,
            liveSearchFields : ['slot_id',],
            liveSearchTexts  : [search_text,],
            whereField       : [],
            whereValue       : [],
            whereOperator    : []
        };
        if (start_date && end_date) {
            const start = moment(start_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD");

            params.whereField.push('slot_date', 'slot_date');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        const result = await getPaginatedData(params);
        const formattedData = result.data.map((item) => ({
            slot_id            : item.slot_id,
            slot_date          : moment(item.slot_date, "DD-MM-YYYY").format('YYYY-MM-DD'),
            booking_limit      : item.booking_limit,
            status             : item.status,
            slot_booking_count : item.slot_booking_count,
            timing             : `${item.start_time} - ${item.end_time}`
        }));
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Portable Charger Slot List fetched successfully!"],
            data       : formattedData,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const slotDetails = async (req, resp) => {
    try {
        const { slot_id, slot_date} = req.body;
        const { isValid, errors } = validateFields(req.body, {slot_date: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [slotDetails] = await db.execute(`
            SELECT 
                id, slot_id,  start_time, end_time, booking_limit, status, 
                (SELECT COUNT(id) FROM portable_charger_booking AS pod WHERE pod.slot_time = portable_charger_slot.start_time AND pod.slot_date = portable_charger_slot.slot_date AND status NOT IN ("PU", "C", "RO")) AS slot_booking_count,
                ${formatDateInQuery(['slot_date'])}
            FROM 
                portable_charger_slot 
            WHERE 
                slot_date = ?`, 
            [slot_date]
        );
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Portable Charger Slot Details fetched successfully!"],
            data    : slotDetails,
            
        });
    } catch (error) {
        console.error('Error fetching slot list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger lists' });
    }
};

export const addSlot = async (req, resp) => {
    try {
        const { slot_date, start_time, end_time, booking_limit, status = 1 } = req.body;
        const { isValid, errors } = validateFields(req.body, { slot_date: ["required"], start_time: ["required"], end_time: ["required"], booking_limit: ["required"], });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
        if ( !Array.isArray(start_time) || !Array.isArray(end_time) || !Array.isArray(booking_limit) || !Array.isArray(status)) {
            return resp.json({ status: 0, code: 422, message: 'Input data must be in array format.' });
        }
        if ( start_time.length !== end_time.length || end_time.length !== booking_limit.length || booking_limit.length !== status.length) {
            return resp.json({ status: 0, code: 422, message: 'All input arrays must have the same length.' });
        }

        const values = []; const placeholders = [];
        const fSlotDate = moment(slot_date, "DD-MM-YYYY").format("YYYY-MM-DD");
        for (let i = 0; i < start_time.length; i++) {            
            const slotId = `PTS${generateUniqueId({ length:6 })}`;
            values.push(slotId, fSlotDate, convertTo24HourFormat(start_time[i]), convertTo24HourFormat(end_time[i]), booking_limit[i], status[i]);
            placeholders.push('(?, ?, ?, ?, ?, ?)');
        }
        
        const query = `INSERT INTO portable_charger_slot (slot_id, slot_date, start_time, end_time, booking_limit, status) VALUES ${placeholders.join(', ')}`;
        const [insert] = await db.execute(query, values);
        
        return resp.json({
            code: 200,
            message: insert.affectedRows > 0 ? ['Slots added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status: insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.json({ message: 'Something went wrong' });
    }
};

export const editSlot = asyncHandler(async (req, resp) => {
    const { slot_id, slot_date, start_time, end_time, booking_limit, status } = req.body;
    const { isValid, errors } = validateFields(req.body, {
        slot_id       : ["required"],
        slot_date     : ["required"],
        start_time    : ["required"],
        end_time      : ["required"],
        booking_limit : ["required"],
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
    const [existingSlots] = await db.execute("SELECT slot_id FROM portable_charger_slot WHERE slot_date = ?",[fSlotDate]);
    const existingSlotIds = existingSlots.map((slot) => slot.slot_id);

    // Determine slots to delete
    const slotsToDelete = existingSlotIds.filter((id) => !slot_id.includes(id));

    //Delete slots that are no longer needed
    for (let id of slotsToDelete) {
        const [deleteResult] = await db.execute("DELETE FROM portable_charger_slot WHERE slot_id = ?", [id] );

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
            const [updateResult] = await db.execute(`UPDATE portable_charger_slot SET start_time = ?, end_time = ?, booking_limit = ?, status = ? 
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
            const [insertResult] = await db.execute(`INSERT INTO portable_charger_slot (slot_id, slot_date, start_time, end_time, booking_limit, status)  VALUES (?, ?, ?, ?, ?, ?)`,
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

export const deleteSlot = async (req, resp) => {
    try {
        const { slot_date } = req.body; 
        console.log('slot_date',req.body.slot_date);
        

        const { isValid, errors } = validateFields(req.body, {
            slot_date: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [del] = await db.execute(`DELETE FROM portable_charger_slot WHERE slot_date = ?`, [slot_date]);

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

/* Assign Booking */
export const assignBooking = async (req, resp) => {
    const {  rsa_id, booking_id  } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), {
        rsa_id     : ["required"],
        booking_id : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
   
    try{ 
        const booking_data = await queryDB( `SELECT rider_id, rsa_id, slot_date, slot_time, (select fcm_token from riders as r where r.rider_id = portable_charger_booking.rider_id ) as fcm_token FROM portable_charger_booking WHERE booking_id = ?
        `, [booking_id ] );
    
        if (!booking_data) {
            return resp.json({ message: `Sorry no booking found with this booking id ${booking_id}`, status: 0, code: 404 });
        }
        const rsa = await queryDB(`SELECT rsa_name, email, fcm_token FROM rsa WHERE rsa_id = ?`, [rsa_id]);
        if(rsa_id == booking_data.rsa_id) {
            return resp.json({ message: `The booking is already assigned to Driver Name ${rsa.rsa_name}. Would you like to assign it to another driver?`, status: 0, code: 404 });
        }
        const slotDateTime = moment(booking_data.slot_date).format('YYYY-MM-DD') +' '+ booking_data.slot_time;
        await insertRecord('portable_charger_booking_assign', 
            ['order_id', 'rsa_id', 'rider_id', 'slot_date_time', 'status'], [booking_id, rsa_id, booking_data.rider_id, slotDateTime, 0]
        );
        await db.execute(`DELETE FROM portable_charger_booking_assign WHERE order_id = ? AND rsa_id = ?`, [booking_id, booking_data.rsa_id]);
        await updateRecord('portable_charger_booking', {rsa_id: rsa_id}, ['booking_id'], [booking_id]);
       
        const href    = 'portable_charger_booking/' + booking_id;
        const heading = 'Booking Assigned!';
        const desc    = `Booking Assigned : ${booking_id}`; //`Your POD Booking has been assigned to Driver by PlusX admin with booking id : ${booking_id}`;
        // createNotification(heading, desc, 'Portable Charging Booking', 'Rider', 'Admin', '', booking_data.rider_id, href);
        // /pushNotification(booking_data.fcm_token, heading, desc, 'RDRFCM', href);

        const heading1 = 'Portable Charging Booking!';
        const desc1    = `Booking Assigned : ${booking_id}`;
        createNotification(heading, desc1, 'Portable Charger', 'RSA', 'Rider', booking_data.rider_id, rsa_id, href);
        pushNotification(rsa.fcm_token, heading1, desc1, 'RSAFCM', href);

        const htmlDriver = `<html>
            <body>
                <h4>Dear ${rsa.rsa_name},</h4>
                <p>A Booking of the portable charging booking has been assigned to you.</p> 
                <p>Booking Details:</p>
                <p>Booking ID: ${booking_id}</p>
                <p>Date and Time of Service: ${moment(slotDateTime, 'YYYY-MM-DD HH:mm:ss').format('D MMM, YYYY, h:mm A')}</p>
                <p> Best regards,<br/>PlusX Electric Team </p>
            </body>
        </html>`;
        emailQueue.addEmail(rsa.email, 'PlusX Electric App: Booking Confirmation for Your Portable EV Charger', htmlDriver);
        
        return resp.json({
            status  : 1, 
            code    : 200,
            message : "You have successfully assigned POD booking." 
        });

    } catch(err){
        
        console.log("Transaction failed:", err);
        return resp.json({status: 0, code: 500, message: "Oops! There is something went wrong! Please Try Again" });
    } finally {
        
    }
};

/* Admin Cancel Booking */
export const adminCancelPCBooking = asyncHandler(async (req, resp) => {
    const { rider_id, booking_id, reason } = req.body;
    const { isValid, errors } = validateFields(req.body, {rider_id: ["required"], booking_id: ["required"], reason: ["required"]});
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const checkOrder = await queryDB(`
        SELECT 
            rsa_id, address, slot_date, slot_time, user_name, 
            concat( country_code, "-", contact_no) as contact_no, 
            (SELECT rd.rider_email FROM riders AS rd WHERE rd.rider_id = portable_charger_booking.rider_id) AS rider_email,
            (select fcm_token from riders as r where r.rider_id = portable_charger_booking.rider_id ) as fcm_token, 
            (select fcm_token from rsa where rsa.rsa_id = portable_charger_booking.rsa_id ) as rsa_fcm_token
        FROM 
            portable_charger_booking
        WHERE 
            booking_id = ? AND rider_id = ? AND status IN ('CNF','A','ER') 
        LIMIT 1
    `,[booking_id, rider_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }
    const insert = await db.execute(
        'INSERT INTO portable_charger_history (booking_id, rider_id, order_status, rsa_id, cancel_by, cancel_reason) VALUES (?, ?, "C", ?, "Admin", ?)',
        [booking_id, rider_id, checkOrder.rsa_id, reason]
    );
    if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

    await updateRecord('portable_charger_booking', {status : 'C'}, ['booking_id'], [booking_id]);
    const href    = `portable_charger_booking/${booking_id}`;
    const title   = 'Portable Charger Cancel!';
    const message = `We regret to inform you that your portable charging booking (ID: ${booking_id}) has been cancelled by the admin.`;
    await createNotification(title, message, 'Portable Charging', 'Rider', 'Rider',  rider_id, rider_id, href);
    await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

    if(checkOrder.rsa_id) {
        await db.execute(`DELETE FROM portable_charger_booking_assign WHERE order_id=? AND rider_id=?`, [booking_id, rider_id]);
        await db.execute('UPDATE rsa SET running_order = running_order - 1 WHERE rsa_id = ?', [checkOrder.rsa_id]);

        const message1 = `A Booking of the portable charging booking has been cancelled by admin with booking id : ${booking_id}`;
        await createNotification(title, message1, 'Portable Charging', 'RSA', 'Rider', rider_id, checkOrder.rsa_id,  href);
        await pushNotification(checkOrder.rsa_fcm_token, title, message1, 'RSAFCM', href);
    } 

    const html = `<html>
        <body>
            <h4>Dear ${checkOrder.user_name},</h4>
            <p>We would like to inform you that your recent booking for the Portable EV Charger Service with PlusX Electric has been cancelled.</p><br />
            <p>Booking Details:</p><br />
            <p>Booking ID    : ${booking_id}</p>
            <p>Date and Time : ${moment(`${checkOrder.slot_date} ${checkOrder.slot_time}`, 'YYYY-MM-DD HH:mm:ss').format('D MMM, YYYY, h:mm A')} </p>
            <p>Location      : ${checkOrder.address}</p> <br />
            <p>If you have any questions or wish to reschedule your booking, please don't hesitate to reach out to us through the PlusX Electric app or by contacting our support team.</p>
            <p>Thank you for choosing PlusX Electric. We look forward to serving you again in the future.</p><br />
            <p>Best regards,<br/> The PlusX Electric Team </p>
        </body>
    </html>`;
    emailQueue.addEmail(checkOrder.rider_email, `Booking Cancellation Confirmation - PlusX Electric Portable Charger Service (Booking ID : ${booking_id} )`, html);

    const adminHtml = `<html>
        <body>
            <h4>Dear Admin,</h4>
            <p>This is to inform you that admin has cancelled a booking for the Portable EV Charging Service. Please see the details below for record-keeping and any necessary follow-up.</p> <br />
            <p>Booking Details:</p><br />
            <p>User Name    : ${checkOrder.user_name}</p>
            <p>User Contact    : ${checkOrder.contact_no}</p>
            <p>Booking ID    : ${booking_id}</p>
            <p>Scheduled Date and Time : ${moment(`${checkOrder.slot_date} ${checkOrder.slot_time}`, 'YYYY-MM-DD HH:mm:ss').format('D MMM, YYYY, h:mm A')}</p> 
            <p>Location      : ${checkOrder.address}</p> <br />
            <p>Thank you for your attention to this update.</p><br />
            <p>Best regards,<br/> The PlusX Electric Team </p>
        </body>
    </html>`;
    emailQueue.addEmail(process.env.MAIL_POD_ADMIN, `Portable Charger Service Booking Cancellation ( :Booking ID : ${booking_id} )`, adminHtml);

    return resp.json({ message: ['Booking has been cancelled successfully!'], status: 1, code: 200 });
});

export const customerChargerBookingList = async (req, resp) => {
    try {
        const { page_no, customerId, status, start_date, end_date, search_text = '', scheduleFilters } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            customerId : ["required"],
            page_no : ["required"]
        });
        
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName : 'portable_charger_booking',
            columns   : `booking_id, rider_id, rsa_id, charger_id, vehicle_id, service_name, service_price, service_type, user_name, country_code, contact_no, status, rescheduled_booking, 
            (select rsa_name from rsa where rsa.rsa_id = portable_charger_booking.rsa_id) as rsa_name, 
                ${formatDateInQuery(['slot_date'])}, concat(slot_date, " ", slot_time) as slot_time, ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn : 'slot_date',
            sortOrder  : 'DESC',
            page_no,
            limit: 10,
            liveSearchFields : ['booking_id', 'user_name', 'service_name'],
            liveSearchTexts  : [search_text, search_text, search_text],
            whereField       : ['rider_id', 'status'],
            whereValue       : [customerId, 'PNR'],
            whereOperator    : ['=', "!="]
        };
        if (start_date && end_date) {
            
            const startToday = new Date(start_date);
            const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                        
            const givenStartDateTime    = startFormattedDate+' 00:00:01'; 
            const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
            const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            const endToday = new Date(end_date);
            const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            const end = formattedEndDate+' 19:59:59';

            params.whereField.push('created_at', 'created_at');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        if (scheduleFilters.start_date && scheduleFilters.end_date) {
            
            const schStart = moment(scheduleFilters.start_date).format("YYYY-MM-DD");
            const schEnd = moment(scheduleFilters.end_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            
            params.whereField.push('slot_date', 'slot_date');
            params.whereValue.push(schStart, schEnd);
            params.whereOperator.push('>=', '<=');
        }
        if(status) {
            params.whereField.push('status');
            params.whereValue.push(status);
            params.whereOperator.push('=');
        }
        const result = await getPaginatedData(params);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Customer POD Booking List fetched successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};

export const failedChargerBookingList = async (req, resp) => {
    try {
        const { page_no, start_date, end_date, search_text = '', scheduleFilters } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            page_no : ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const params = {
            tableName : 'failed_portable_charger_booking',
            columns   : `booking_id, user_name, status, ${formatDateInQuery(['slot_date'])}, concat(slot_date, " ", slot_time) as slot_time, ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            limit: 10,
            liveSearchFields : ['booking_id', 'user_name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],          
            whereField       : [],
            whereValue       : [],
            whereOperator    : []
        };
        if (start_date && end_date) {
            
            const startToday = new Date(start_date);
            const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                       
            const givenStartDateTime    = startFormattedDate+' 00:00:01';
            const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
            const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            const endToday = new Date(end_date);
            const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            const end = formattedEndDate+' 19:59:59';

            params.whereField.push('created_at', 'created_at');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        if (scheduleFilters.start_date && scheduleFilters.end_date) {
          
            const schStart = moment(scheduleFilters.start_date).format("YYYY-MM-DD");
            const schEnd   = moment(scheduleFilters.end_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            
            params.whereField.push('slot_date', 'slot_date');
            params.whereValue.push(schStart, schEnd);
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

export const failedchargerBookingDetails = async (req, resp) => {
    try {
        const { booking_id } = req.body;

        if (!booking_id) {
            return resp.json({ status : 0, code : 400, message : 'Booking ID is required.'});
        } 
        const [[bookingResult]] = await db.execute(`
            SELECT 
                booking_id, rider_id, ${formatDateTimeInQuery(['created_at'])}, user_name, country_code, contact_no, status, address, latitude, longitude, service_name, service_price, service_type, service_feature, ${formatDateInQuery(['slot_date'])}, slot_time, parking_number, parking_floor, vehicle_data
            FROM 
                failed_portable_charger_booking 
            WHERE 
                booking_id = ?`, 
            [booking_id]
        ); 
        if (bookingResult.length === 0) {
            return resp.json({
                status  : 0,
                code    : 404,
                message : 'Booking not found.',
            });
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