import db from "../config/db.js";
import dotenv from 'dotenv';

import { queryDB } from '../dbUtils.js';
dotenv.config();

/* Helper to retrive total amount from PCB or CS */
export const getTotalAmountFromService = async (booking_id, booking_type) => {
    let invoiceId, total_amount;

    if(booking_type === 'PCB'){

        const data = await queryDB(`
            SELECT 
                pcb.user_name AS rider_name,
                (select r.rider_email from riders AS r where r.rider_id = pcb.rider_id limit 1) AS rider_email,
                (SELECT coupan_percentage FROM coupon_usage WHERE booking_id = pcb.booking_id limit 1) AS discount
            FROM
                portable_charger_booking as pcb
            WHERE 
                booking_id = ? LIMIT 1
        `, [booking_id]);

        if (!data) return { success: false, message: 'No data found for the invoice.' };
        
        data.kw           = 25;
        data.kw_dewa_amt  = data.kw * 0.44;
        data.kw_cpo_amt   = data.kw * 0.26;
        data.delv_charge  = 30;
        data.t_vat_amt    = 0.00;
        data.total_amt    = 0.00;

        total_amount = (data.total_amt) ? Math.round(data.total_amt) : 0.00;

        return {success: true, total_amount, data, message: 'Pod Amount fetched successfully'};
    } else if(booking_type === 'CS') {
        invoiceId = booking_id.replace('CS', 'INVCS');

        const data = await queryDB(`
            SELECT 
                csi.invoice_id, csi.amount, cs.request_id
            FROM 
                charging_service_invoice AS csi
            LEFT JOIN
                charging_service AS cs ON cs.request_id = csi.request_id
            WHERE 
                csi.invoice_id = ?
            LIMIT 1
        `, [invoiceId]);

        if (!data) return { success: false, message: 'No data found for the invoice.' };

        total_amount = (data.amount) ? data.amount : 0.00;
        return {success: true, total_amount, message: 'PickDrop Amount fetched successfully'};

    } else if(booking_type === 'RSA'){
 
        const data = await queryDB(`
            SELECT 
                rsa.name AS rider_name,
                (select r.rider_email from riders AS r where r.rider_id = rsa.rider_id limit 1) AS rider_email,
                (SELECT coupan_percentage FROM coupon_usage WHERE booking_id = rsa.request_id limit 1) AS discount
            FROM
                road_assistance as rsa
            WHERE 
                request_id = ? LIMIT 1
        `, [booking_id]);

        if (!data) return { success: false, message: 'No data found for the invoice.' };
        
        data.kw           = 25;
        data.kw_dewa_amt  = data.kw * 0.44;
        data.kw_cpo_amt   = data.kw * 0.26;
        data.delv_charge  = 90;
        data.t_vat_amt    = 0.00;
        data.total_amt    = 0.00;

        total_amount = (data.total_amt) ? Math.round(data.total_amt) : 0.00;

        return {success: true, total_amount, data, message: 'Pod Amount fetched successfully'};
    } else {
        return {success: false, total_amount,  message: 'Invalid Booking Id'}; 
    }
}
