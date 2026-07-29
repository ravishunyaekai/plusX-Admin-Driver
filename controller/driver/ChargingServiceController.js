import path from 'path';
import moment from "moment";
import dotenv from 'dotenv';
import 'moment-duration-format';
import { fileURLToPath } from 'url';
import emailQueue from "../../emailQueue.js";
import validateFields from "../../validation.js";
import { insertRecord, queryDB, updateRecord } from '../../dbUtils.js';
import db from "../../config/db.js";
import { createNotification, mergeParam, pushNotification, asyncHandler } from "../../utils.js";
dotenv.config();

import Stripe from "stripe";
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";

/* RSA - Booking Action */
export const getRsaBookingStage = asyncHandler(async (req, resp) => {
    const {rsa_id, booking_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {rsa_id: ["required"], booking_id: ["required"]});
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const booking = await queryDB(`SELECT order_status, created_at, updated_at FROM charging_service WHERE request_id=?`, [booking_id]);
    if(!booking) return resp.json({status:0, code:200, message: "Sorry no data found with given order id: " + booking_id}); 

    const orderStatus = ['CNF','A', 'VP', 'RS','CC','DO','WC', 'C']; //order_status 
    const placeholders = orderStatus.map(() => '?').join(', ');

    const [bookingTracking] = await db.execute(`SELECT order_status, remarks, image, cancel_reason, cancel_by, longitude, latitude FROM charging_service_history 
        WHERE service_id = ? AND rsa_id = ? AND order_status IN (${placeholders})
    `, [booking_id, rsa_id, ...orderStatus]);

    const seconds = Math.floor((booking.updated_at - booking.created_at) / 1000);
    const humanReadableDuration = moment.duration(seconds, 'seconds').format('h [hours], m [minutes]');
    
    return resp.json({
        status          : 1,
        code            : 200,
        message         : ["Booking stage fetch successfully."],
        booking_status  : booking.order_status,
        execution_time  : humanReadableDuration,
        booking_history : bookingTracking,
        image_path      : `${process.env.DIR_UPLOADS}pick-drop-images/`
    });
});

export const handleBookingAction = asyncHandler(async (req, resp) => {
    const {rsa_id, booking_id, reason, latitude, longitude, booking_status } = req.body;
    let validationRules = {
        rsa_id         : ["required"], 
        booking_id     : ["required"], 
        latitude       : ["required"], 
        longitude      : ["required"], 
        booking_status : ["required"],
    };
    if (booking_status == "C") validationRules = { ...validationRules, reason : ["required"] };
    const { isValid, errors } = validateFields(req.body, validationRules);
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    switch (booking_status) {
        case 'A': return await acceptBooking(req, resp);
        case 'ER': return await driverEnroute(req, resp);
        case 'VP': return await vehiclePickUp(req, resp);
        case 'RS': return await reachedLocation(req, resp);
        case 'CC': return await chargingComplete(req, resp);
        case 'DO': return await vehicleDrop(req, resp);
        case 'WC': return await workComplete(req, resp);
        default: return resp.json({status: 0, code: 200, message: ['Invalid booking status.']});
    };
});

export const handleRejectBooking = asyncHandler(async (req, resp) => {
    const {rsa_id, booking_id, reason, latitude='', longitude='' } = req.body;
    const { isValid, errors } = validateFields(req.body, {rsa_id: ["required"], booking_id: ["required"], reason: ["required"]});
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 0
        LIMIT 1
    `,[booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }
    const insert = await db.execute(
        'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude) VALUES (?, ?, "C", ?, ?, ?)',
        [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude]
    );

    if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

    await insertRecord('charging_service_rejected', ['booking_id', 'rsa_id', 'rider_id', 'reason'],[booking_id, rsa_id, checkOrder.rider_id, reason]);
    await db.execute(`DELETE FROM charging_service_assign WHERE order_id=? AND rsa_id=?`, [booking_id, rsa_id]);

    const href    = `charging_service/${booking_id}`;
    const title   = 'EV Pick Up & Drop Off Booking Rejected!';
    const message = `Driver has rejected the valet service booking with booking id: ${booking_id}`;
    await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);

    const html = `<html>
        <body>
            <h4>Dear Admin,</h4>
            <p>Driver has rejected the valet service booking. please assign one Driver on this booking</p> <br />
            <p>Booking ID: ${booking_id}</p>
            <p> Regards,<br/> PlusX Electric App </p>
        </body>
    </html>`;
    emailQueue.addEmail(process.env.MAIL_CS_ADMIN, `Valet Charging Service Booking rejected - ${booking_id}`, html);

    return resp.json({ message: ['Booking has been rejected successfully!'], status: 1, code: 200 });
});

/* CS booking action helper */
const acceptBooking = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude, booking_status } = req.body;

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 0
        LIMIT 1
    `,[booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }
    const ordHistoryCount = await queryDB(
        `SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "A" AND service_id = ?`,[rsa_id, booking_id]
    );
    if (ordHistoryCount.count === 0) {
        await updateRecord('charging_service', {order_status: 'A', rsa_id}, ['request_id'], [booking_id]);

        const href    = `charging_service/${booking_id}`;
        const title   = 'EV Pick Up & Drop Off Booking!';
        const message = `Booking Accepted! ${booking_id}`;
         await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
       // await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);
         await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

        const insert = await db.execute(
            `INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude) VALUES (?, ?, "A", ?, ?, ?)`,
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude]
        );
        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        // await db.execute('UPDATE rsa SET running_order = running_order + 1 WHERE rsa_id = ?', [rsa_id]);
        await db.execute('UPDATE charging_service_assign SET status = 1 WHERE order_id = ? AND rsa_id = ?', [booking_id, rsa_id]);

        return resp.json({ message: ['EV Pick Up & Drop Off Booking accepted successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const driverEnroute = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;
    
    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token 
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 1
        LIMIT 1
    `,[booking_id, rsa_id]);
  
    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }
    const ordHistoryCount = await queryDB(
        `SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "ER" AND service_id = ?`,[rsa_id, booking_id]
    );
    if (ordHistoryCount.count === 0) {
        await updateRecord('charging_service', {order_status: 'ER'}, ['request_id'], [booking_id]);

        const href    = `charging_service/${booking_id}`;
        const title   = 'EV Pick Up & Drop Off Booking!';
        const message = `PlusX Electric team is on the way!`;
        await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
       // await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);
        await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

        const insert = await db.execute(
            `INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude) VALUES (?, ?, "ER", ?, ?, ?)`,
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude]
        );
        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        return resp.json({ message: ['Booking Status changed successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const vehiclePickUp = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 1
        LIMIT 1
    `,[ booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }

    const ordHistoryCount = await queryDB(
        'SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "VP" AND service_id = ?',[rsa_id, booking_id]
    );

    if (ordHistoryCount.count === 0) {
        const insert = await db.execute(
            'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude, image) VALUES (?, ?, "VP", ?, ?, ?, ?)',
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude, '']
        );
        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        await updateRecord('charging_service', {order_status: 'VP', rsa_id}, ['request_id'], [booking_id]);

        const href    = `charging_service/${booking_id}`;
        const title   = 'EV Pick Up & Drop Off Booking!';
        const message = `PlusX Electric team has picked up your EV.`;
        await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
        // await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);
        await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

        return resp.json({ message: ['Vehicle picked-up successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const reachedLocation = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 1
        LIMIT 1
    `,[booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }

    const ordHistoryCount = await queryDB(
        'SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "RS" AND service_id = ?',[rsa_id, booking_id]
    );

    if (ordHistoryCount.count === 0) {
        const insert = await db.execute(
            'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude) VALUES (?, ?, "RS", ?, ?, ?)',
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude]
        );
        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        await updateRecord('charging_service', {order_status: 'RS', rsa_id}, ['request_id'], [booking_id]);

        const href = `charging_service/${booking_id}`;
        const title = 'EV Pick Up & Drop Off Booking!';
        const message = `Your EV has reached the charging station.`;
        await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
        // await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);
        await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);

        return resp.json({ message: ['Vehicle reached at charging spot successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const chargingComplete = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 1
        LIMIT 1
    `,[booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }

    const ordHistoryCount = await queryDB(
        'SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "CC" AND service_id = ?',[rsa_id, booking_id]
    );

    if (ordHistoryCount.count === 0) {
        const insert = await db.execute(
            'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude) VALUES (?, ?, "CC", ?, ?, ?)',
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude]
        );

        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        await updateRecord('charging_service', {order_status: 'CC', rsa_id}, ['request_id'], [booking_id]);

        const href    = `charging_service/${booking_id}`;
        const title   = 'EV Pick Up & Drop Off Booking!';
        const message = `Your EV charging is completed!`;
        await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
        await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);
        await valetChargerInvoice(checkOrder.rider_id, booking_id);
        return resp.json({ message: ['Vehicle charging completed! successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const vehicleDrop = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;

    const checkOrder = await queryDB(`
        SELECT 
            csa.rider_id, r.fcm_token, r.rider_email, r.rider_name
        FROM 
            charging_service_assign csa
        LEFT JOIN 
            riders r ON r.rider_id = csa.rider_id
        WHERE  csa.order_id = ? AND csa.rsa_id =? AND csa.status = 1
        LIMIT 1
    `,[booking_id, rsa_id]);

    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }

    const ordHistoryCount = await queryDB(
        'SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "DO" AND service_id = ?',[rsa_id, booking_id]
    );

    if (ordHistoryCount.count === 0) {
        const insert = await db.execute(
            'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude, image) VALUES (?, ?, "DO", ?, ?, ?, ?)',
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude, '']
        );

        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        await updateRecord('charging_service', {order_status: 'DO', rsa_id}, ['request_id'], [booking_id]);

        const href    = `charging_service/${booking_id}`;
        const title   = 'EV Pick Up & Drop Off Booking!';
        const message = 'PlusX Electric team has dropped off your EV and handed over the key!';
        await createNotification(title, message, 'Charging Service', 'Rider', 'RSA', rsa_id, checkOrder.rider_id, href);
        // await createNotification(title, message, 'Charging Service', 'Admin', 'RSA', rsa_id, '', href);
        await pushNotification(checkOrder.fcm_token, title, message, 'RDRFCM', href);
       
        const html = `<html>
            <body>
                <h4>Dear ${checkOrder.rider_name}</h4>
                <p>We hope you're doing well.</p>
                <p>Thank you for choosing PlusX Electric for your EV Pickup & Drop-off service. We're pleased to inform you that your service has been successfully completed.</p>
                <p>We truly appreciate your trust in us and look forward to serving you again.</p>
                <p>Best Regards,<br/> PlusX Electric Team </p>
            </body>
        </html>`;
        // , and the details of your invoice are attached
        // const attachment = {
        //     filename: `${invoiceId}-invoice.pdf`, path: pdf.pdfPath, contentType: 'application/pdf'
        // }
        emailQueue.addEmail(checkOrder.rider_email, 'PlusX Electric: Your EV Pickup & Drop-off Service is Now Complete', html); //, attachment

        return resp.json({ message: ['Vehicle drop-off successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};
const workComplete = async (req, resp) => {
    const { booking_id, rsa_id, latitude, longitude } = req.body;

    if (!req.files || !req.files['image']) return resp.status(405).json({ message: ["Vehicle Image is required"], status: 0, code: 405, error: true });

    const checkOrder = await queryDB(`
        SELECT rider_id, 
            (SELECT fcm_token FROM riders WHERE rider_id = charging_service_assign.rider_id limit 1) AS fcm_token
        FROM 
            charging_service_assign
        WHERE 
            order_id = ? AND rsa_id = ? AND status = 1
        LIMIT 1
    `,[booking_id, rsa_id]); 
    if (!checkOrder) {
        return resp.json({ message: [`Sorry no booking found with this booking id ${booking_id}`], status: 0, code: 404 });
    }
    const ordHistoryCount = await queryDB(
        'SELECT COUNT(*) as count FROM charging_service_history WHERE rsa_id = ? AND order_status = "WC" AND service_id = ?',[rsa_id, booking_id]
    );
    if (ordHistoryCount.count === 0) {
        const imgName = req.files.image[0].filename; 
        const insert  = await db.execute(
            'INSERT INTO charging_service_history (service_id, rider_id, order_status, rsa_id, latitude, longitude, image) VALUES (?, ?, "WC", ?, ?, ?, ?)',
            [booking_id, checkOrder.rider_id, rsa_id, latitude, longitude, imgName]
        );
        if(insert.affectedRows == 0) return resp.json({ message: ['Oops! Something went wrong! Please Try Again'], status: 0, code: 200 });

        await updateRecord('charging_service', {order_status: 'WC', rsa_id}, ['request_id'], [booking_id]);
        await db.execute(`DELETE FROM charging_service_assign WHERE rsa_id=? AND order_id = ?`, [rsa_id, booking_id]);
        
        // const data = await queryDB(`
        //     SELECT 
        //         name,
        //         (SELECT rd.rider_email FROM riders AS rd WHERE rd.rider_id = charging_service.rider_id) AS rider_email
        //     FROM 
        //         charging_service 
        //     WHERE 
        //         request_id = ?
        //     LIMIT 1
        // `, [booking_id]);

        return resp.json({ message: ['Work completed! successfully!'], status: 1, code: 200 });
    } else {
        return resp.json({ message: ['Sorry this is a duplicate entry!'], status: 0, code: 200 });
    }
};

// ye new bana hai 
export const valetChargerInvoice = async (rider_id, request_id ) => {
    // console.log(rider_id, request_id)
    try {
        const checkOrder = await queryDB(` 
            SELECT 
                payment_intent_id, booking_price,
                (SELECT coupan_percentage FROM coupon_usage WHERE booking_id = cs.request_id LIMIT 1) AS discount
            FROM 
                charging_service as cs
            WHERE 
                cs.request_id = ? AND cs.rider_id = ?
            LIMIT 1
        `,[request_id, rider_id]);
        if (!checkOrder) {
            return { status : 0  };
        }
        const payment_intent_id = checkOrder.payment_intent_id;
        const invoiceId = request_id.replace('CS', 'INVCS');
        const createObj = {
            invoice_id     : invoiceId,
            request_id     : request_id,
            rider_id       : rider_id,
            invoice_date   : moment().format('YYYY-MM-DD HH:mm:ss'),
            payment_status : 'Approved',
            amount         : 0,
        }
        if(payment_intent_id && payment_intent_id.trim() != '' ){
            const paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
            const charge = await stripe.charges.retrieve(paymentIntent.latest_charge);
            const cardData = {
                brand     : charge.payment_method_details.card.brand,
                country   : charge.payment_method_details.card.country,
                exp_month : charge.payment_method_details.card.exp_month,
                exp_year  : charge.payment_method_details.card.exp_year,
                last_four : charge.payment_method_details.card.last4,
            };
            createObj.amount            = charge.amount;  
            createObj.payment_intent_id = charge.payment_intent;  
            createObj.payment_method_id = charge.payment_method;  
            createObj.payment_cust_id   = charge.customer;  
            createObj.charge_id         = charge.id;  
            createObj.transaction_id = charge.payment_method_details.card.three_d_secure?.transaction_id || null;
            createObj.payment_type   = charge.payment_method_details.type;  
            createObj.currency       = charge.currency;  
            createObj.invoice_date   = moment.unix(charge.created).format('YYYY-MM-DD HH:mm:ss');
            createObj.receipt_url    = charge.receipt_url;
            createObj.card_data      = cardData;
        }
        createObj.price_details = await makeInvoicePriceDetails(checkOrder.booking_price, checkOrder.discount) ;
        const columns = Object.keys(createObj);
        const values  = Object.values(createObj);
        const insert  = await insertRecord('charging_service_invoice', columns, values);
        // console.log('insert', insert)
        return { status: (insert.affectedRows > 0) ? 1 : 0 };
        
    } catch (error) {
        console.log('error', error)
        tryCatchErrorHandler('Valet charging complete invoice', error, []);
        return { status:0  };
    }
};

const makeInvoicePriceDetails = async (amount, discount) => {
   
    let baseAmount      = Number(amount) || 0;
    let discountPercent = Number(discount) || 0;
       
    let discountAmt = 0;
    let vatAmount   = 0;
    let totalPrice  = 0;

    if (discountPercent > 0) {

        if (discountPercent !== 100) {

            discountAmt    = (baseAmount * discountPercent) / 100;
            const afterDis = baseAmount - discountAmt;
            vatAmount      = (afterDis * 5) / 100;
            totalPrice     = afterDis + vatAmount;

        } else {
            discountAmt = baseAmount;
            vatAmount   = 0;
            totalPrice  = 0;
        }
    } else {
        vatAmount = ( baseAmount * 5 ) / 100;
        totalPrice = baseAmount + vatAmount;
    }
    const priceDetails = {
        amount          : baseAmount,
        discount_prcnt  : discountPercent,
        kw_consume      : 0,  
        dewa_unit_price : 0,  
        cpo_unit_price  : 0,
        kw_dewa_amt     : 0,
        kw_cpo_amt      : 0,
        delivry_charge  : 0,
        discount_amt    : discountAmt,
        vat_amount      : vatAmount,
        total_price     : totalPrice
    };
    return priceDetails;
};