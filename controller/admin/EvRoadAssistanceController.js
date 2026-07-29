import db from "../../config/db.js";
import { getPaginatedData, insertRecord, queryDB, updateRecord } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import { createNotification, pushNotification, asyncHandler, formatDateTimeInQuery, mergeParam, convertTo24HourFormat } from '../../utils.js';
import moment from 'moment';
import emailQueue from '../../emailQueue.js';
import generateUniqueId from 'generate-unique-id';

import dotenv from 'dotenv';
dotenv.config();

/* RA Booking */
export const bookingList = asyncHandler(async (req, resp) => {
    const { start_date, end_date, search_text = '', status, page_no, rowSelected } = req.body;

    const whereFields    = ['order_status']
    const whereValues    = ['PNR']
    const whereOperators = ["!="]

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
        if (booking.length === 0) {
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
        tableName : 'road_assistance_invoice',
        columns   : `invoice_id, payment_status, invoice_date, currency, ROUND(amount/100, 2) AS amount,
            (select concat(name, ",", country_code, "-", contact_no) from road_assistance as rs where rs.request_id = road_assistance_invoice.request_id limit 1)
            AS riderDetails`,
        sortColumn : 'id',
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

    const data = await queryDB(`
        SELECT 
            invoice_id, invoice_date, currency,  
            rs.name, rs.request_id, rs.current_percent, price_details
        FROM 
            road_assistance_invoice AS pci 
        LEFT JOIN 
            road_assistance AS rs ON rs.request_id = pci.request_id
        WHERE pci.invoice_id = ?
    `, [invoice_id]);

    data.currency      = data.currency == "null" || data.currency == null ? 'aed' : data.currency;
    data.servicePrice  = data.price_details.amount;
    data.dis_price     = data.price_details.discount_amt;
    data.t_vat_amt     = data.price_details.vat_amount; 
    data.price         = data.price_details.total_price ; 
    data.price_details = {};
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
        console.log('slot_date',req.body.slot_date);
        

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