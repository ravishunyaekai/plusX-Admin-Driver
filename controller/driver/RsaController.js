import fs from "fs";
import path from "path";
import crypto from 'crypto';
import bcrypt from "bcryptjs";
import db from "../../config/db.js";
import emailQueue from "../../emailQueue.js";
import validateFields from "../../validation.js";
import { insertRecord, queryDB, updateRecord } from '../../dbUtils.js';
import { asyncHandler, formatDateTimeInQuery, generateRandomPassword, mergeParam } from "../../utils.js";

import dotenv from "dotenv";
dotenv.config();

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";
import { deleteImageFromS3 } from "../../fileUpload.js";

export const rsaLogin = asyncHandler(async (req, resp) => {
    const { mobile, password ,fcm_token , latitude, longitude } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        mobile: ["required"], password: ["required"], fcm_token: ["required"], latitude: ["required"], longitude: ["required"]
    });
    
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const rsa = await queryDB(`SELECT rsa_name, password, rsa_id, profile_img, status, email, mobile, running_order FROM rsa WHERE mobile=? LIMIT 1`, [mobile]);
    
    if(!rsa) return resp.json({ status:0, code:405, error:true, message: ["Mobile number is not matching with our records"] });
    if (password.length < 6) return resp.json({ status:0, code:405, error:true, message: ["Password must be 6 character"] });
    const isMatch = await bcrypt.compare(password, rsa.password);
    if (!isMatch) return resp.json({ status:0, code:405, error:true, message: ["Password is incorrect"] });
    if (rsa.status > 3) return resp.json({ status:0, code:405, error:true, message: ["You can not login as your status is inactive. Kindly contact to customer care"] });

    const status = rsa.running_order > 0 ? 2 : 1;
    const access_token = crypto.randomBytes(12).toString('hex');
    const update = await updateRecord('rsa', {access_token, latitude, longitude, fcm_token, status}, ['mobile'], [mobile]);

    if(update.affectedRows > 0){
        const result = {
            rsa_id       : rsa.rsa_id,
            rsa_name     : rsa.rsa_name,
            email        : rsa.email,
            mobile       : rsa.mobile,
            gender       : rsa.gender,
            rsa_type     : rsa.rsa_type,
            birthday     : rsa.birthday,
            profile_img  : `https://plusx.s3.ap-south-1.amazonaws.com/uploads/rsa_images/${rsa.profile_img}`,
            access_token : access_token,
        };
        return resp.json({status:1, code:200, message: ["RSA Login successfully"], data: result});
    } else {
        return resp.json({status:0, code:405, message: ["Oops! There is something went wrong! Please Try Again"], error: true});
    }

});

export const rsaUpdatePassword = asyncHandler(async (req, resp) => {
    const { rsa_id, old_password, new_password, confirm_password} = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {
        rsa_id: ["required"], old_password: ["required"], new_password: ["required"], confirm_password: ["required"]
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    if(new_password != confirm_password) return resp.json({ status: 0, code: 422, message: ['New password and confirm password not matched!'] });
    
    if (new_password == old_password) return resp.status(401).json({ message: ["Old and New Password can't be same, Please enter correct password."] });
    
    const insert = await insertRecord('password_history', [ 'user_id', 'panel' ], [ rsa_id, 'driver' ] );
    if( insert.affectedRows == 0 ) {  
        return resp.json({ status: 0, code: 400, message: ['Password was not changed!'] });
    }
    const rsa = await queryDB(`SELECT password FROM rsa WHERE rsa_id=?`, [rsa_id]);
    
    const isMatch = await bcrypt.compare(old_password, rsa.password);  
    if (!isMatch) return resp.status(401).json({ message: ["Please enter correct current password."] });

    const hashedPswd = await bcrypt.hash(new_password, 10);
    const update = await updateRecord('rsa', {password: hashedPswd}, ['rsa_id'], [rsa_id]);

    return resp.json({
        status  : update.affectedRows > 0 ? 1 : 0, 
        code    : update.affectedRows > 0 ? 200 : 422, 
        message : update.affectedRows > 0 ? ['Password changed successfully'] : ['Failed to updated password. Please Try Again']
    });
});

export const rsaForgotPassword = asyncHandler(async (req, resp) => {
    const { email } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { email: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const rsa = queryDB(`SELECT rsa_name FROM rsa WHERE email=? LIMIT 1`, [email]);
    if(!rsa) return resp.json({status: 0, code: 400, message: ['Oops! Invalid Email Address']});

    const password = generateRandomPassword(6);
    const hashedPswd = await bcrypt.hash(password, 10);
    await db.execute('UPDATE rsa SET password=? WHERE email=?', [hashedPswd, email]);
    const html = `<html>
        <body> 
            <h4>Hello ${rsa.rsa_name},</h4>
            <p>We have received a request for a forgotten password. So we are sharing one random password here, with this password you can login to your RSA account. </p><p> Password - <b>${password}</b> </p>  
            <p>Note:- For security and your convenience, we recommend that you should change your password once you login to your account. </p><br/>   
            <p></p>                        
            <p> Regards,<br/>PlusX Electric App </p>
        </body>
    </html>`;
    
    emailQueue.addEmail(email, 'Forgot password Request', html);

    resp.status(200).json({ status: 1, code: 200, message: ["An email has been sent to your given email address. Kindly check your email"] });
});  

export const rsaLogout = asyncHandler(async (req, resp) => {
    const {rsa_id} = mergeParam(req);
    if (!rsa_id) return resp.json({ status: 0, code: 422, message: ["Rsa Id is required"] });
    
    const rsa = queryDB(`SELECT EXISTS (SELECT 1 FROM rsa WHERE rsa_id = ?) AS rsa_exists`, [rsa_id]);
    if(!rsa) return resp.json({status:0, code:400, message: 'Rider ID Invalid!'});

    const update = await updateRecord('rsa', {status:0, access_token: "", fcm_token:""},['rsa_id'], [rsa_id]);
    
    if(update.affectedRows > 0){
        return resp.json({status: 1, code: 200, message: ['Logged out sucessfully']});
    }else{
        return resp.json({status: 0, code: 405, message: ['Oops! There is something went wrong! Please Try Again']});
    }
});

export const rsaLogutAll = asyncHandler(async (req, resp) => {
    const [allRSA] = await db.execute('SELECT rsa_id FROM rsa');

    for (const val of allRSA) {
        await updateRecord('rsa', {status: 0, access_token: ''}, ['rsa_id'], [val.rsa_id]);
        // await insertRecord('rsa', ['rsa_id', 'status'], [val.rsa_id, 0]); /* table doesn't exist for now */
    }

    return resp.json({status:1, code:200, message: ["All RSA Logout successful"]});
});

export const rsaUpdateProfile = asyncHandler(async (req, resp) => {
    try {         
        const { rsa_id } = mergeParam(req);
        const { isValid, errors } = validateFields(mergeParam(req), { rsa_id: ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
        const rsa = await queryDB(`SELECT profile_img FROM rsa WHERE rsa_id=?`, [rsa_id]);

        let profile_image = rsa.profile_img;
        if( req.files && req.files['profile-image'] ){
            const files = req.files;
            profile_image = files ? files['profile-image'][0].filename : '';
        }
        // if (rsa.profile_img && req.files[['profile-image']]){

        //     const oldImagePath = path.join(process.env.S3_FOLDER_NAME, 'rsa_images', rsa.profile_img || '').replace(/\\/g, '/');
        //     await deleteImageFromS3(oldImagePath);
        // }
        const insert = await insertRecord('profile_history', 
            [ 'user_id', 'panel', 'image', 'action' ],
            [ rsa_id, 'driver', profile_image, 'profile updated' ]
        );
        if( insert.affectedRows == 0 ) {  
            return resp.json({ status: 0, code: 400, message: ['RSA profile was not updated!'] });
        }
        await updateRecord('rsa', { profile_img: profile_image }, ['rsa_id'], [rsa_id]);
        return resp.json({
            status    : 1, 
            code      : 200, 
            message   : ["RSA profile updated successfully"],
            image_url : `${process.env.DIR_UPLOADS}rsa_images/${profile_image}`
        });

    } catch(err) {
        console.log(err);
        tryCatchErrorHandler(req.originalUrl, err, resp, 'Oops! There is something went wrong! while profile update' );
    }
});

export const rsaStatusChange = asyncHandler(async (req, resp) => {
    const { rsa_id, status } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { rsa_id: ["required"], status: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    const parsedStatus = parseInt(status, 10);
    if (![0, 1, 2, 3, 4].includes(parsedStatus)) return resp.json({status:0, code:422, message:"Status should be 0, 1, 2, 3 and 4"});
    const rsa = await queryDB(`SELECT running_order FROM rsa WHERE rsa_id=? LIMIT 1`, [rsa_id]);
    
    if(!rsa){
        return resp.json({status:0, code:405, message: ["RSA ID invalid"], error: true});
    }
    else if(rsa.running_order > 0){
        return resp.json({status:0, code:405, message: ["Please complete your pending order first"], error: true});
    }
    else{
        const update = await updateRecord('rsa', {status: parsedStatus}, ['rsa_id'], [rsa_id]);
        return resp.json({
            status: update.affectedRows > 0 ? 1 : 0, 
            code: update.affectedRows > 0 ? 200 : 422, 
            message: update.affectedRows > 0 ? ['Status changed successfully'] : ['Failed to change status. Please Try Again']
        });
    }

});
export const rsaHome = asyncHandler(async (req, resp) => {
    const { rsa_id } = mergeParam(req);
    
    const rsaData = await queryDB( `
        SELECT status, booking_type 
        FROM rsa 
        WHERE rsa_id = ? 
        LIMIT 1`, [rsa_id]
    );
    if (!rsaData) return resp.json({ message: "RSA data not found", status: 0 });

    const bookingType = rsaData.booking_type;

    if (rsaData.length === 0) return resp.json({ message: "RSA data not found", status: 0 });

    let result = {
        rsa_status    : (rsaData.status === 1) ? 'Login' : (rsaData.status === 2 ) ? 'Available' : 'Logout',
        service_type  : bookingType,  
    };
    
    if (bookingType === "Portable Charger") {
        const data = await queryDB(`
            SELECT
                COALESCE(pa.running, 0) AS running_order_count,
                COALESCE(pa.pending, 0) AS pod_count,
                COALESCE(pr.rejected, 0) AS pod_rejected,
                COALESCE(pb.completed, 0) AS pod_completed,
                COALESCE(pb.cancelled, 0) AS pod_cancelled
            FROM rsa r

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM portable_charger_booking_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pa ON pa.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id, COUNT(*) AS rejected
                FROM portable_charger_booking_rejected
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pr ON pr.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status IN ('PU','CC','RO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN status = 'C' THEN 1 END) AS cancelled
                FROM portable_charger_booking
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pb ON pb.rsa_id = r.rsa_id

            WHERE r.rsa_id = ? `, [rsa_id, rsa_id, rsa_id, rsa_id]
        );
        const [podAssign] = await db.execute(`
            SELECT 
                portable_charger_booking_assign.status AS assign_status, pb.booking_id as request_id, 
                pb.address as pickup_address, pb.latitude as pickup_latitude, pb.longitude pickup_longitude, 
                pb.status as order_status,
                CONCAT(pb.user_name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
                ${formatDateTimeInQuery(['pb.created_at'])}, 
                (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data,
                COALESCE(
                    (SELECT guideline FROM portable_charger_history pch WHERE pch.rider_id = pb.rider_id AND pch.order_status = 'CS' LIMIT 1),''
                ) AS guideline,
                DATE_FORMAT(portable_charger_booking_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time
            FROM portable_charger_booking_assign
            LEFT JOIN portable_charger_booking AS pb ON pb.booking_id = portable_charger_booking_assign.order_id
            WHERE portable_charger_booking_assign.rsa_id = ?
            ORDER BY portable_charger_booking_assign.slot_date_time ASC `,[rsa_id]
        );
        result.running_order_count = data.running_order_count || 0 ;
        result.booking_count       = data.pod_count || 0 ;
        result.rejected_count      = data.pod_rejected || 0 ;
        result.completed_count     = data.pod_completed || 0 ;
        result.cancelled_count     = data.pod_cancelled || 0 ;
        result.assigned_booking    = podAssign.filter(item => item.assign_status === 0); 
        result.ongoing_booking     = podAssign.filter(item => item.assign_status === 1); 
         
    } 
    else if (bookingType === "Valet Charging") {
        const data = await queryDB(`
            SELECT
                COALESCE(ca.running, 0) AS running_order_count,
                COALESCE(ca.pending, 0) AS valet_count,
                COALESCE(cr.rejected, 0) AS valet_rejected,
                COALESCE(cs.completed, 0) AS valet_completed,
                COALESCE(cs.cancelled, 0) AS valet_cancelled
            FROM rsa r

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM charging_service_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) ca ON ca.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id, COUNT(*) AS rejected
                FROM charging_service_rejected
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) cr ON cr.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN order_status IN ('WC','DO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN order_status = 'C' THEN 1 END) AS cancelled
                FROM charging_service
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) cs ON cs.rsa_id = r.rsa_id

            WHERE r.rsa_id = ? `, [rsa_id, rsa_id, rsa_id, rsa_id]
        );
        const [assignValet] = await db.execute(`
            SELECT 
                charging_service_assign.status AS assign_status,
                cs.request_id, cs.pickup_address, cs.pickup_latitude, cs.pickup_longitude,
                cs.order_status, CONCAT(cs.name, ",", cs.country_code, "-", cs.contact_no) AS riderDetails,
                DATE_FORMAT(charging_service_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ${formatDateTimeInQuery(['cs.created_at'])}
            FROM charging_service_assign
            LEFT JOIN charging_service AS cs ON cs.request_id = charging_service_assign.order_id
            WHERE charging_service_assign.rsa_id = ? AND cs.request_id IS NOT NULL
            ORDER BY charging_service_assign.slot_date_time ASC `,[rsa_id]
        );
        result.running_order_count = data.running_order_count || 0 ;
        result.booking_count       = data.valet_count || 0 ;
        result.rejected_count      = data.valet_rejected || 0 ;
        result.completed_count     = data.valet_completed || 0 ;
        result.cancelled_count     = data.valet_cancelled || 0 ;
        result.assigned_booking    = assignValet.filter(item => item.assign_status === 0); 
        result.ongoing_booking     = assignValet.filter(item => item.assign_status === 1); 
    }
    else if (bookingType === "Roadside Assistance") {
        const data = await queryDB(`
            SELECT
                COALESCE(oa.running, 0) AS running_order_count,
                COALESCE(oa.pending, 0) AS rsa_count,
                COALESCE(ob.completed, 0) AS rsa_completed,
                COALESCE(ob.cancelled, 0) AS rsa_cancelled
            FROM rsa r

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM order_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) oa ON oa.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN order_status IN ('PU','RO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN order_status = 'C' THEN 1 END) AS cancelled
                FROM road_assistance
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) ob ON ob.rsa_id = r.rsa_id
            WHERE r.rsa_id = ? `, [rsa_id, rsa_id, rsa_id]
        );
        const [rsaAssign] = await db.execute(`
            SELECT
                order_assign.status AS assign_status,
                pb.request_id, pb.pickup_address, pb.pickup_latitude, pb.pickup_longitude, pb.order_status,
                CONCAT(pb.name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
                ${formatDateTimeInQuery(['pb.created_at'])}, 
                (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data
            FROM order_assign
            LEFT JOIN 
                road_assistance AS pb ON pb.request_id = order_assign.order_id
            WHERE 
                order_assign.rsa_id = ?
            ORDER BY order_assign.id ASC `,[rsa_id]
        );
        result.running_order_count = data.running_order_count || 0 ;
        result.booking_count       = data.rsa_count || 0 ;
        result.rejected_count      = 0
        result.completed_count     = data.rsa_completed || 0 ;
        result.cancelled_count     = data.rsa_cancelled || 0 ;
        result.assigned_booking    = rsaAssign.filter(item => item.assign_status === 0); 
        result.ongoing_booking     = rsaAssign.filter(item => item.assign_status === 1); 
    }
    return resp.json({
        message : ["RSA Home Page Data"],
        data    : result,
        status  : 1,
        code    : 200
    });
});

export const rsaHomeOld = asyncHandler(async (req, resp) => {
    const { rsa_id } = mergeParam(req);
    
    const rsaData = await queryDB(`
        SELECT 
            r.status, 
            r.booking_type,

            COALESCE(pa.running, 0) + COALESCE(ca.running, 0) + COALESCE(rsaa.running, 0) AS running_order_count,

            COALESCE(pa.pending, 0) AS pod_count,
            COALESCE(pr.rejected, 0) AS pod_rejected,
            COALESCE(pb.completed, 0) AS pod_completed,
            COALESCE(pb.cancelled, 0) AS pod_cancelled,

            COALESCE(ca.pending, 0) AS valet_count,
            COALESCE(cr.rejected, 0) AS valet_rejected,
            COALESCE(cs.completed, 0) AS valet_completed,
            COALESCE(cs.cancelled, 0) AS valet_cancelled,

            COALESCE(rsaa.pending, 0)   AS rsa_count,
            COALESCE(0)                 AS rsa_rejected,
            COALESCE(rsb.completed, 0) AS rsa_completed,
            COALESCE(rsb.cancelled, 0) AS rsa_cancelled

        FROM rsa r

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM portable_charger_booking_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pa ON pa.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(*) AS rejected
                FROM portable_charger_booking_rejected
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pr ON pr.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status IN ('PU', 'CC', 'RO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN status = 'C' THEN 1 END) AS cancelled
                FROM portable_charger_booking
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) pb ON pb.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM charging_service_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) ca ON ca.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(*) AS rejected
                FROM charging_service_rejected
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) cr ON cr.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN order_status IN ('WC', 'DO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN order_status = 'C' THEN 1 END) AS cancelled
                FROM charging_service
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) cs ON cs.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN status = 1 THEN 1 END) AS running,
                    COUNT(CASE WHEN status = 0 THEN 1 END) AS pending
                FROM order_assign
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) rsaa ON rsaa.rsa_id = r.rsa_id

            LEFT JOIN (
                SELECT rsa_id,
                    COUNT(CASE WHEN order_status IN ('PU', 'C', 'RO') THEN 1 END) AS completed,
                    COUNT(CASE WHEN order_status = 'C' THEN 1 END) AS cancelled
                FROM road_assistance
                WHERE rsa_id = ?
                GROUP BY rsa_id
            ) rsb ON rsb.rsa_id = r.rsa_id

        WHERE 
            r.rsa_id = ?
        LIMIT 1;
    `, [rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id]);

    if (rsaData.length === 0) return resp.json({ message: "RSA data not found", status: 0 });

    const [assignValet] = await db.execute(`
        SELECT 
           charging_service_assign.status AS assign_status,
           cs.request_id, cs.pickup_address, cs.pickup_latitude, cs.pickup_longitude,
           cs.order_status, cs.parking_number, cs.parking_floor,
           CONCAT(cs.name, ",", cs.country_code, "-", cs.contact_no) AS riderDetails,
           DATE_FORMAT(charging_service_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
           ${formatDateTimeInQuery(['cs.created_at'])}
        FROM charging_service_assign
        LEFT JOIN charging_service AS cs ON cs.request_id = charging_service_assign.order_id
        WHERE charging_service_assign.rsa_id = ? AND cs.request_id IS NOT NULL
        ORDER BY charging_service_assign.slot_date_time ASC
    `,[rsa_id]);

    const [podAssign] = await db.execute(`
        SELECT 
            portable_charger_booking_assign.status AS assign_status,
            pb.booking_id, pb.address, pb.latitude, pb.longitude, pb.status,
            CONCAT(pb.user_name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
            ${formatDateTimeInQuery(['pb.created_at'])}, 
            (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data,
            COALESCE(
                (SELECT guideline FROM portable_charger_history pch WHERE pch.rider_id = pb.rider_id AND pch.order_status = 'CS' LIMIT 1),''
            ) AS guideline,
            DATE_FORMAT(portable_charger_booking_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time
        FROM portable_charger_booking_assign
        LEFT JOIN portable_charger_booking AS pb ON pb.booking_id = portable_charger_booking_assign.order_id
        WHERE portable_charger_booking_assign.rsa_id = ?
        ORDER BY portable_charger_booking_assign.slot_date_time ASC
    `,[rsa_id]);
    const [rsaAssign] = await db.execute(`
        SELECT 
            order_assign.status AS assign_status,
            pb.request_id, pb.pickup_address, pb.pickup_latitude, pb.pickup_longitude, pb.order_status,
            CONCAT(pb.name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
            ${formatDateTimeInQuery(['pb.created_at'])}, 
            (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data
        FROM order_assign
        LEFT JOIN 
            road_assistance AS pb ON pb.request_id = order_assign.order_id
        WHERE 
            order_assign.rsa_id = ?
        ORDER BY 
            order_assign.id ASC
    `,[rsa_id]);
   
    const { status, booking_type, valet_count, pod_count, running_order_count, valet_rejected, pod_rejected, valet_completed, pod_completed, pod_cancelled, valet_cancelled, rsa_count, rsa_rejected, rsa_completed, rsa_cancelled } = rsaData;
    const rsaStatus = (status === 1) ? 'Login' : (status === 2 ) ? 'Available' : 'Logout';
    
    const result = {
        rsa_status    : rsaStatus,
        service_type  : booking_type,
        running_order_count,

        pod_count,
        pod_rejected_count    : pod_rejected,
        pod_completed_count   : pod_completed,
        pod_cancelled_count   : pod_cancelled,
        pod_assign            : podAssign,

        valet_count,
        valet_rejected_count  : valet_rejected,
        valet_completed_count : valet_completed,
        valet_cancelled_count : valet_cancelled,
        assign_orders         : assignValet,
        
        rsa_count,
        rsa_rejected_count    : rsa_rejected,
        rsa_completed_count   : rsa_completed,
        rsa_cancelled_count   : rsa_cancelled,
        rsa_assign            : rsaAssign
    };

    return resp.json({
        message : ["RSA Home Page Data"],
        data    : result,
        status  : 1,
        code    : 200
    });
});

export const rsaHomeOldd = asyncHandler(async (req, resp) => {
    const { rsa_id } = mergeParam(req);
    
    const rsaData = await queryDB(`
        SELECT 
            status, booking_type, running_order,
            (SELECT COUNT(*) FROM charging_service_assign WHERE rsa_id = ? AND status = 0) AS valet_count,
            (SELECT COUNT(*) FROM portable_charger_booking_assign WHERE rsa_id = ? AND status = 0) AS pod_count,
            (
                (SELECT COUNT(*) FROM portable_charger_booking_assign WHERE rsa_id = ? AND status = 1) 
                +
                (SELECT COUNT(*) FROM charging_service_assign WHERE rsa_id = ? AND status = 1) 
            ) AS running_order_count,
            (SELECT COUNT(*) FROM charging_service_rejected WHERE rsa_id = ?) AS valet_rej,
            (SELECT COUNT(*) FROM portable_charger_booking_rejected WHERE rsa_id = ?) AS pod_rejected,
            (SELECT COUNT(*) FROM charging_service WHERE rsa_id = ? AND order_status IN ("WC", "C")) AS valet_completed,
            (SELECT COUNT(*) FROM portable_charger_booking WHERE rsa_id = ? AND status IN ("PU", "C", "RO")) AS pod_completed,
            (SELECT COUNT(*) FROM portable_charger_booking WHERE rsa_id = ? AND status = "C") AS pod_cancelled,
            (SELECT COUNT(*) FROM charging_service WHERE rsa_id = ? AND order_status = "C") AS valet_cancelled
        FROM rsa 
        WHERE rsa_id = ? LIMIT 1
    `, [rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id, rsa_id]);

    if (rsaData.length === 0) return resp.json({ message: "RSA data not found", status: 0 });

    const [assignValet] = await db.execute(`
        SELECT 
           charging_service_assign.status AS assign_status,
           cs.request_id, cs.pickup_address, cs.pickup_latitude, cs.pickup_longitude,
           cs.order_status, cs.parking_number, cs.parking_floor,
           CONCAT(cs.name, ",", cs.country_code, "-", cs.contact_no) AS riderDetails,
           DATE_FORMAT(charging_service_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
           ${formatDateTimeInQuery(['cs.created_at'])}
        FROM charging_service_assign
        LEFT JOIN charging_service AS cs ON cs.request_id = charging_service_assign.order_id
        WHERE charging_service_assign.rsa_id = ? AND cs.request_id IS NOT NULL
        ORDER BY charging_service_assign.slot_date_time ASC
    `,[rsa_id]);

    const [podAssign] = await db.execute(`
        SELECT 
            portable_charger_booking_assign.status AS assign_status,
            pb.booking_id, pb.address, pb.latitude, pb.longitude, pb.status,
            CONCAT(pb.user_name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
            ${formatDateTimeInQuery(['pb.created_at'])}, 
            (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data,
            COALESCE(
                (SELECT guideline FROM portable_charger_history pch WHERE pch.rider_id = pb.rider_id AND pch.order_status = 'CS' LIMIT 1),''
            ) AS guideline,
            DATE_FORMAT(portable_charger_booking_assign.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time
        FROM portable_charger_booking_assign
        LEFT JOIN portable_charger_booking AS pb ON pb.booking_id = portable_charger_booking_assign.order_id
        WHERE portable_charger_booking_assign.rsa_id = ?
        ORDER BY portable_charger_booking_assign.slot_date_time ASC
    `,[rsa_id]);
    const [rsaAssign] = await db.execute(`
        SELECT 
            order_assign.status AS assign_status,
            pb.request_id, pb.pickup_address, pb.pickup_latitude, pb.pickup_longitude, pb.order_status,
            CONCAT(pb.name, ",", pb.country_code, "-", pb.contact_no) AS riderDetails,
            ${formatDateTimeInQuery(['pb.created_at'])}, 
            (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = pb.vehicle_id) AS vehicle_data
        FROM order_assign
        LEFT JOIN 
            road_assistance AS pb ON pb.request_id = order_assign.order_id
        WHERE 
            order_assign.rsa_id = ?
        ORDER BY 
            order_assign.id ASC
    `,[rsa_id]);
   
    const { status, running_order, booking_type, valet_count, pod_count, running_order_count, valet_rej, pod_rejected, valet_completed, pod_completed, pod_cancelled, valet_cancelled } = rsaData;
    const rsaStatus = (status === 1) ? 'Login' : (status === 2 || running_order > 0) ? 'Available' : 'Logout';
    
    const result = {
        rsa_status    : rsaStatus,
        service_type  : booking_type,
        valet_count,
        pod_count,
        running_order_count,
        valet_rejected_count  : valet_rej,
        pod_rejected_count    : pod_rejected,
        valet_completed_count : valet_completed,
        pod_completed_count   : pod_completed,
        valet_cancelled_count : valet_cancelled,
        pod_cancelled_count   : pod_cancelled,
        assign_orders         : assignValet,
        pod_assign            : podAssign,
        rsa_assign            : rsaAssign
    };

    return resp.json({
        message: ["RSA Home Page Data"],
        data: result,
        status: 1,
        code: 200
    });
});

export const rsaBookingHistory = asyncHandler(async (req, resp) => {
    const { rsa_id, booking_type } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), {
        rsa_id       : ["required"], 
        booking_type : ["required"]
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    let result = {};
    
    if(booking_type == 'PCB'){
        
        const [podCompleted] = await db.execute(`
            SELECT 
                pcb.booking_id, pcb.address, pcb.latitude, pcb.longitude, pcb.status, pch.remarks, pch.image, 
                ${formatDateTimeInQuery(['pcb.created_at', 'pcb.updated_at'])}, 
                CONCAT(pcb.user_name, ",", pcb.country_code, "-", pcb.contact_no) AS riderDetails,
                pcb.vehicle_data,
                CONCAT(pcb.slot_date, " ", pcb.slot_time) AS slot_date_time
            FROM 
                portable_charger_booking AS pcb
            LEFT JOIN 
                portable_charger_history AS pch 
                ON CONVERT(pcb.booking_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = 
                CONVERT(pch.booking_id USING utf8mb4) COLLATE utf8mb4_unicode_ci 
            WHERE 
                pcb.rsa_id = ? AND pcb.status = 'RO'
            GROUP BY 
                pcb.booking_id
            ORDER BY 
                pcb.updated_at DESC
        `, [rsa_id]);
        
        const baseUrl = `${process.env.DIR_UPLOADS}portable-charger/`;
        const podCompletedWithImages = podCompleted.map(record => {
            return {
                ...record,
                image : record.image ? record.image.split('*').map(img => `${baseUrl}${img}`) : []
            };
        });
        const [podCancelled] = await db.execute(`
            SELECT 
                booking_id, address, latitude, longitude, status, ${formatDateTimeInQuery(['created_at', 'updated_at'])}, vehicle_data,
                CONCAT(user_name, ",", country_code, "-", contact_no) AS riderDetails,
                CONCAT(slot_date, " ", slot_time) AS slot_date_time
            FROM 
                portable_charger_booking AS pcb
            WHERE 
                rsa_id = ? AND status = 'C'
            ORDER BY 
                slot_date_time 
            DESC
        `, [rsa_id]);
        
        result.booking_completed = podCompletedWithImages;
        result.booking_cancelled = podCancelled;
    } else if(booking_type == 'CS'){
        
        const [valetCompleted] = await db.execute(`
            SELECT
                request_id, pickup_address, pickup_latitude, pickup_longitude, order_status, parking_number, parking_floor, CONCAT(name, ",", country_code, "-", contact_no) as riderDetails, 
                DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ${formatDateTimeInQuery(['created_at', 'updated_at'])} 
            FROM 
                charging_service
            WHERE 
                rsa_id = ? AND order_status = 'WC'
            ORDER BY 
                slot_date_time 
            DESC
        `, [rsa_id]);

        const [valetCancelled] = await db.execute(`
            SELECT
                request_id, pickup_address, pickup_latitude, pickup_longitude, order_status, parking_number, parking_floor, CONCAT(name, ",", country_code, "-", contact_no) as riderDetails, 
                DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time, 
                ${formatDateTimeInQuery(['created_at', 'updated_at',])} 
            FROM 
                charging_service
            WHERE 
                rsa_id = ? AND order_status = 'C'
            ORDER BY 
                slot_date_time DESC
        `, [rsa_id]);

        result.booking_completed = valetCompleted;
        result.booking_cancelled = valetCancelled;
        
    } else if(booking_type == 'RSA'){
        
        const [rsaCompleted] = await db.execute(`
            SELECT 
                rsa.request_id, rsa.pickup_address, rsa.pickup_latitude, rsa.pickup_longitude, rsa.order_status, 
                rsah.remarks, rsah.image, rsa.vehicle_data,
                ${formatDateTimeInQuery(['rsa.created_at', 'rsa.updated_at'])}, 
                CONCAT(rsa.name, ",", rsa.country_code, "-", rsa.contact_no) AS riderDetails                
            FROM 
                road_assistance AS rsa
            LEFT JOIN 
                order_history AS rsah 
                ON CONVERT(rsa.request_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = 
                CONVERT(rsah.order_id USING utf8mb4) COLLATE utf8mb4_unicode_ci 
            WHERE 
                rsa.rsa_id = ? AND rsa.order_status = 'RO'
            GROUP BY 
                rsa.request_id
            ORDER BY 
                rsa.updated_at DESC
        `, [rsa_id]);
        
        const baseUrl                = `${process.env.DIR_UPLOADS}road-assistance/`;
        const rsaCompletedWithImages = rsaCompleted.map(record => {
            return {
                ...record,
                image : record.image ? record.image.split('*').map(img => `${baseUrl}${img}`) : []
            };
        });
        result.booking_completed = rsaCompletedWithImages;
        result.booking_cancelled = [];
    } 
    return resp.json({
        message : [ "Driver Booking Completed/ Cancelled History" ], 
        data   : result, 
        status : 1,
        code   : 200
    }); 
});

export const rsaBookingHistoryOld = asyncHandler(async (req, resp) => {
    const { rsa_id, booking_type } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), {rsa_id: ["required"], booking_type: ["required"]});
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    let result = {};
    
    if(booking_type != 'R'){
        
        const [valetCompleted] = await db.execute(`
            SELECT
                request_id, pickup_address, pickup_latitude, pickup_longitude, order_status, parking_number, parking_floor, 
                CONCAT(name, ",", country_code, "-", contact_no) as riderDetails, 
                DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ${formatDateTimeInQuery(['created_at', 'updated_at'])} 
            FROM 
                charging_service
            WHERE 
                rsa_id = ? AND order_status = 'WC'
            ORDER BY 
                slot_date_time DESC
        `, [rsa_id]);
        
        const [podCompleted] = await db.execute(`
            SELECT 
                pcb.booking_id, pcb.address, pcb.latitude, pcb.longitude, pcb.status, pch.remarks, pch.image, 
                ${formatDateTimeInQuery(['pcb.created_at', 'pcb.updated_at'])}, 
                CONCAT(pcb.user_name, ",", pcb.country_code, "-", pcb.contact_no) AS riderDetails,
                CONCAT(rv.vehicle_make, "-", rv.vehicle_model) AS vehicle_data,
                CONCAT(pcb.slot_date, " ", pcb.slot_time) AS slot_date_time
            FROM 
                portable_charger_booking AS pcb
            LEFT JOIN 
                portable_charger_history AS pch 
                ON CONVERT(pcb.booking_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = 
                CONVERT(pch.booking_id USING utf8mb4) COLLATE utf8mb4_unicode_ci 
            LEFT JOIN
                riders_vehicles AS rv ON pcb.vehicle_id = rv.vehicle_id
            WHERE 
                pcb.rsa_id = ? AND pcb.status = 'RO'
            GROUP BY 
                pcb.booking_id
            ORDER BY 
                pcb.updated_at DESC
        `, [rsa_id]);
        
        const baseUrl = `${process.env.DIR_UPLOADS}portable-charger/`;
        const podCompletedWithImages = podCompleted.map(record => {
            return {
                ...record,
                image: record.image ? record.image.split('*').map(img => `${baseUrl}${img}`) : []
            };
        });
        
        result.valet_completed = valetCompleted;
        result.pod_completed = podCompletedWithImages;
    } else {
        
        const [valetRejected] = await db.execute(`
            SELECT 
                cs.request_id, cs.pickup_address, cs.pickup_latitude, cs.pickup_longitude, cs.order_status, cs.parking_number, cs.parking_floor, 
                CONCAT(name, ",", country_code, "-", contact_no) AS riderDetails, 
                DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ${formatDateTimeInQuery(['cs.created_at'])}, cs.slot_date_time, csr.reason 
            FROM 
                charging_service_rejected AS csr
            LEFT JOIN 
                charging_service AS cs 
            ON 
                cs.request_id = csr.booking_id 
            WHERE 
                csr.rsa_id = ? 
            ORDER BY 
                cs.created_at DESC
        `, [rsa_id]);

        const [podRejected] = await db.execute(`
            SELECT 
                pb.booking_id, pb.address, pb.latitude, pb.longitude, pb.status, ${formatDateTimeInQuery(['pb.created_at'])},
                CONCAT(pb.user_name, ", ", pb.country_code, "-", pb.contact_no) AS riderDetails, 
                (SELECT CONCAT(rv.vehicle_make, "-", rv.vehicle_model) FROM riders_vehicles AS rv WHERE rv.vehicle_id = pb.vehicle_id) AS vehicle_data,  
                CONCAT(pb.slot_date, " ", pb.slot_time) AS slot_date_time, 
                pbr.reason 
            FROM 
                portable_charger_booking_rejected AS pbr
            LEFT JOIN 
                portable_charger_booking AS pb 
            ON 
                pb.booking_id = pbr.booking_id 
            WHERE 
                pbr.rsa_id = ? 
            ORDER BY 
                created_at DESC
        `, [rsa_id]);

        const [valetCancelled] = await db.execute(`
            SELECT
                request_id, pickup_address, pickup_latitude, pickup_longitude, order_status, parking_number, parking_floor, 
                CONCAT(name, ",", country_code, "-", contact_no) as riderDetails, 
                DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time, 
                ${formatDateTimeInQuery(['created_at', 'updated_at',])} 
            FROM 
                charging_service
            WHERE 
                rsa_id = ? AND order_status = 'C'
            ORDER BY 
                slot_date_time DESC
        `, [rsa_id]);

        const [podCancelled] = await db.execute(`
            SELECT 
                booking_id, address, latitude, longitude, status, ${formatDateTimeInQuery(['created_at', 'updated_at'])},
                CONCAT(user_name, ",", country_code, "-", contact_no) AS riderDetails,
                (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles AS rv WHERE rv.vehicle_id = pcb.vehicle_id) AS vehicle_data,
                CONCAT(slot_date, " ", slot_time) AS slot_date_time
            FROM portable_charger_booking AS pcb
            WHERE rsa_id = ? 
            AND status = 'C'
            ORDER BY slot_date_time DESC
        `, [rsa_id]);

        result.valet_rejected  = valetRejected;
        result.pod_rejected    = podRejected;
        result.valet_cancelled = valetCancelled;
        result.pod_cancelled   = podCancelled;
    }
    return resp.json({
        messag : [ "RSA Booking Completed/ Rejected History" ], 
        data   : result, 
        status : 1,
        code   : 200
    }); 
});

export const rsaUpdateLatLong = asyncHandler(async (req, resp) => {
    const { rsa_id, latitude, longitude } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { rsa_id: ["required"], latitude: ["required"], longitude: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const update = await updateRecord('rsa', {latitude, longitude}, ['rsa_id'], [rsa_id]);
    const insert = await insertRecord('rsa_location_history', ['rsa_id', 'latitude', 'longitude'], [rsa_id, latitude, longitude]);

    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0,
        message: update.affectedRows > 0 ? "Latitude Longitude updated successfully" : "Failed to update, Please try again.",
    });
});
