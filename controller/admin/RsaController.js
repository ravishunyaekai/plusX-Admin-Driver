import generateUniqueId from 'generate-unique-id';
import db, { startTransaction, commitTransaction, rollbackTransaction } from '../../config/db.js';
import { getPaginatedData, insertRecord, queryDB, updateRecord, } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import { asyncHandler, deleteFile, formatDateInQuery, formatDateTimeInQuery } from '../../utils.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import bcrypt from "bcryptjs";
import moment from 'moment';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const rsaList = asyncHandler(async (req, resp) => {
    const{ rsa_id, rsa_name, rsa_email, rsa_mobile, page_no = 1, list, service_type, start_date, end_date, search_text = ''} = req.body;

    const searchField = [];
    const searchText = [];
    const whereFields = []
    const whereValues = []
    const whereOperators = []

    if (start_date && end_date) {

        // const startToday = new Date(start_date);
        // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                    
        // const givenStartDateTime    = startFormattedDate+' 00:00:01'; // Replace with your datetime string
        // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
        // const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
        
        // const endToday = new Date(end_date);
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
    const result = await getPaginatedData({
        tableName: 'rsa',
        columns: 'id, rsa_id, rsa_name, email, country_code, mobile, profile_img, status, booking_type',
        liveSearchFields: ['rsa_id', 'rsa_name', 'email', 'booking_type',],
        liveSearchTexts: [search_text, search_text, search_text, search_text,],
        sortColumn: 'id',
        sortOrder: 'DESC',
        page_no: page_no,
        limit: 10,
        whereField: whereFields,
        whereValue: whereValues,
        whereOperator: whereOperators
    });
    return resp.json({
        status: 1,
        code: 200,
        message: ["Emergency Team List fetch successfully!"],
        data: result.data,
        total_page: result.totalPage,
        total: result.total,
    });

});

export const rsaData = asyncHandler(async (req, resp) => {
    const { rsa_id }  = req.body; 
    const rsaData     = await queryDB(`SELECT * FROM rsa WHERE rsa_id = ? LIMIT 1`, [rsa_id]);
    const bookingType = ['Charger Installation', 'EV Pre-Sale', 'Portable Charger', 'Roadside Assistance', 'Valet Charging'];
    
    const [locationHistory] = await db.execute(` SELECT rsa_id, latitude, longitude, ${formatDateTimeInQuery(['created_at'])} FROM rsa_location_history  WHERE rsa_id = ? group by DATE(created_at) order by id desc limit 10`, [rsa_id]);
           
    return resp.json({
        status  : 0,
        code    : 200,
        message : "RSA data fetched successfully",
        rsaData,
        bookingType,
        locationHistory,
        base_url  : `${process.env.DIR_UPLOADS}rsa_images/`
    });
});

export const driverBookingList = async (req, resp) => {
    try {
        const { rsa_id, driverType, page_no, status, start_date, end_date, search_text = '', scheduleFilters } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            rsa_id     : ["required"],
            page_no    : ["required"],
            driverType : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });

        const tableName     = (driverType === 'Valet Charging') ? 'charging_service' : 'portable_charger_booking';
        const liveSearchFields = ['booking_id', 'user_name' ];
        var sortColumn         = 'slot_date DESC, slot_time ASC';

        var selectColumns = `booking_id, user_name, country_code, contact_no, status, ${formatDateInQuery(['slot_date'])}, concat(slot_date, " ", slot_time) as slot_time, ${formatDateInQuery(['created_at'])}`;

        if (driverType === 'Valet Charging') {
            sortColumn    = 'slot_date_time DESC ';
            selectColumns = `request_id as booking_id, name as user_name, order_status as status, DATE_FORMAT(slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time, ${formatDateInQuery(['created_at'])}`
        }
        const params = {
            tableName        : tableName,
            columns          : selectColumns,
            sortColumn       : sortColumn,
            sortOrder        : '',
            page_no,
            limit            : 10,
            liveSearchFields : liveSearchFields,
            liveSearchTexts  : [search_text, search_text ],
            whereField       : ['rsa_id'],
            whereValue       : [rsa_id],
            whereOperator    : ['=']
        };
        if (start_date && end_date) {

            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                        
            // const givenStartDateTime    = startFormattedDate+' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
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
        if(status) {
            params.whereField.push('status');
            params.whereValue.push(status);
            params.whereOperator.push('=');
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
            message    : ["Driver Booking List!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};

export const allRsaList = async (req, resp) => {
    try {
        const { service_type } = req.body;

        const { isValid, errors } = validateFields(req.body, { service_type : ["required"] });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });

        const [result] = await db.execute(`SELECT rsa_id, rsa_name, status, booking_type FROM rsa WHERE booking_type = ? `, [service_type]);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Driver Booking List!"],
            data       : result,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};

export const rsaAdd = asyncHandler(async (req, resp) => {
    const{ rsa_name, rsa_email, mobile, service_type, password, confirm_password } = req.body;
    const { isValid, errors } = validateFields(req.body, { 
        rsa_name         : ["required"],
        rsa_email        : ["required"],
        mobile           : ["required"],
        service_type     : ["required"],
        password         : ["required"],
        confirm_password : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if(password.length < 6) return resp.json({status:0, code: 422, message:["Password must be 6 digit"]});
    if(password != confirm_password) return resp.json({ status: 0, code: 422, message: ['Password and confirm password not matched!'] });
    
    const [duplicateCheck] = await db.query(`
        SELECT 'mobile' AS type FROM rsa WHERE mobile = ?
        UNION
            SELECT 'email' AS type FROM rsa WHERE email = ?
        UNION
            SELECT 'mobile' AS type FROM riders WHERE rider_mobile = ?
        UNION
        SELECT 'email' AS type FROM riders WHERE rider_email = ?
    `, [mobile, rsa_email, mobile, rsa_email]);
    
    const types = duplicateCheck.map(row => row.type);
    if (types.includes('mobile') && types.includes('email')) {
        return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
        
    } else if (types.includes('mobile')) {
        return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
        
    } else if (types.includes('email')) {
        return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
    }
    let profile_image = req.files['profile_image'] ? req.files['profile_image'][0].filename  : '';
    const hashedPswd  = await bcrypt.hash(password, 10);
    const rsaNameArr  = rsa_name.split(" "); 
    
    const insert = await insertRecord('rsa', [
        'rsa_id', 'rsa_name', 'email', 'country_code', 'mobile', 'booking_type', 'password', 'status', 'running_order', 'profile_img'
    ], [
        `${rsaNameArr[0]}-${generateUniqueId({length:5})}`, rsa_name, rsa_email, '+971', mobile, service_type, hashedPswd, 0, 0, profile_image
    ]);
    
    return resp.json({
        status  : insert.affectedRows > 0 ? 1 : 0, 
        code    : insert.affectedRows > 0 ? 200 : 422, 
        message : insert.affectedRows > 0 ? "RSA created successfully" : ["Failed to create, Please Try Again!"], 
    });
});

export const rsaUpdate = asyncHandler(async (req, resp) => {
    const{ rsa_id, rsa_name, rsa_email, mobile, service_type, password, confirm_password } = req.body;
    const { isValid, errors } = validateFields(req.body, { 
        rsa_id: ["required"],
        rsa_name: ["required"],
        rsa_email: ["required"],
        mobile: ["required"],
        service_type: ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if(password && password?.length < 6) return resp.json({status:1, code: 422, message:["Password must be 6 digit"]});
    
    const emailCheck = await queryDB(`SELECT rsa_id FROM rsa WHERE email = ? AND rsa_id != ? UNION SELECT rider_id FROM riders WHERE rider_email = ?`,[rsa_email, rsa_id, rsa_email]);
    const mobileCheck = await queryDB(`SELECT rsa_id FROM rsa WHERE mobile = ? AND rsa_id != ? UNION SELECT rider_id FROM riders WHERE rider_mobile = ?`, [mobile, rsa_id, mobile]);
    if (emailCheck?.length > 0) return resp.json({status:1, code: 200, message:["Email already exists"]});
    if (mobileCheck?.length > 0) return resp.json({status:1, code: 200, message:["Mobile number already exists"]});
    
    const rsaData = await queryDB(`SELECT profile_img FROM rsa WHERE rsa_id = ?`, [rsa_id]);
    const profile_image = req.files['profile_image'] ? files['profile_image'][0].filename : rsaData.profile_img;
    const updates = {rsa_name, email: rsa_email, mobile, booking_type: service_type, profile_img: profile_image};

    if(password) updates.password = await bcrypt.hash(password, 10);

    const update = await updateRecord('rsa', updates, ['rsa_id'], [rsa_id]);

    if(rsaData.profile_img) deleteFile('rsa_images', rsaData.profile_img);

    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0, 
        code: 200, 
        message: update.affectedRows > 0 ? "RSA updated successfully" : "Failed to update, Please Try Again!", 
    });
});

export const rsaDelete = asyncHandler(async (req, resp) => {
    return resp.json({ status: 1, code: 200, error: false, message: ['Driver account deleted successfully!'] });
    const { rsa_id } = req.body;
    const rsaData = await queryDB(`SELECT profile_img FROM rsa WHERE rsa_id = ? LIMIT 1`, [rsa_id]);
    if(!rsaData) return resp.json({status:0, message: "RSA Data can not delete, or invalid "});
    const conn = await startTransaction();
    
    try{
        await conn.execute(`DELETE FROM rsa WHERE rsa_id = ?`, [rsa_id]);
        await conn.execute(`DELETE FROM notifications WHERE receive_id = ?`, [rsa_id]);
        await conn.execute(`DELETE FROM road_assistance WHERE rsa_id = ?`, [rsa_id]);
        await conn.execute(`DELETE FROM order_assign WHERE rsa_id = ?`, [rsa_id]);

        const profileImgPath = path.join(__dirname, 'public/uploads/rsa_images', rsaData.profile_img);
        if (rsaData.profile_img) deleteFile('rsa_images', rsaData.profile_img);

        await commitTransaction(conn);
        return resp.json({ status: 1, code: 200, error: false, message: ['Driver account deleted successfully!'] });
    } catch(err){
        await rollbackTransaction(conn);
        // console.error("Transaction failed:", err);
        return resp.status(500).json({status: 0, code: 500, message: "Oops! There is something went wrong! Please Try Again" });
    }finally{
        if (conn) conn.release();
    }

});

export const rsaStatusChange = asyncHandler(async (req, resp) => {
    const{ id, status } = req.body;

    if(status == 4){
        const orderCheck = queryDB(`SELECT COUNT(*) AS check_order FROM order_assign WHERE rsa_id = ? AND order_status IN ('AR', 'EN')`, [id]);
        if (orderCheck.check_order > 0) return resp.status(422).json({status: 0, msg: "You cannot deactivate this RSA because an order is currently active."});    
    }

    const update = await updateRecord('rsa', {status, access_token:''}, ['id'], [id]);
    
    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0, 
        code: 200, 
        message: update.affectedRows > 0 ? "RSA status changed successfully." : "Failed to update, Please Try Again!", 
    });
});

export const driverLocationList = async (req, resp) => {
    try {
        const { rsa_id, page_no, start_date, end_date  } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            rsa_id  : ["required"],
            page_no : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });

        const limit = 10;
        const startIndex = parseInt((page_no * limit) - limit, 10);
        
        let query    = '';
        if (start_date && end_date) {

            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                       
            // const givenStartDateTime    = startFormattedDate+' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            // const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            // const endToday = new Date(end_date);
            // const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            // const end = formattedEndDate+' 19:59:59';

            //optimized code
            const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";
            
            query = `SELECT SQL_CALC_FOUND_ROWS rsa_id, latitude, longitude, ${formatDateTimeInQuery(['created_at'])} FROM rsa_location_history WHERE rsa_id ="${rsa_id}" and created_at >= "${start}" AND created_at <= "${end}" order by created_at DESC LIMIT ${startIndex}, ${parseInt(limit, 10)}`
        } 
        else {
            query = ` 
                SELECT 
                    SQL_CALC_FOUND_ROWS rsa_id, latitude, longitude, ${formatDateTimeInQuery(['created_at'])}
                FROM 
                    rsa_location_history h
                JOIN (
                    SELECT 
                        DATE(created_at) AS date_only, MAX(created_at) AS max_created_at
                    FROM 
                        rsa_location_history
                    WHERE 
                        rsa_id = "${rsa_id}"
                    GROUP BY DATE(created_at)
                ) latest 
                ON 
                    DATE(h.created_at) = latest.date_only AND h.created_at = latest.max_created_at
                WHERE 
                    h.rsa_id = "${rsa_id}"
                ORDER BY 
                    h.created_at 
                DESC`
            ;
        }
        const [rows]        = await db.execute(query, []);
        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage     = Math.max(Math.ceil(total / limit), 1);
    
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Driver Location List!"],
            data       : rows,
            total_page : totalPage,
            total      : total,
        });
    } catch (error) {
        console.error('Error fetching charger booking list:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger booking lists' });
    }
};