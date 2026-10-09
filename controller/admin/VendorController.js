
import { mergeParam, formatDateTimeInQuery, asyncHandler, createNotification, pushNotification, } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB, getPaginatedData, updateRecord, insertRecord } from '../../dbUtils.js';
import db from "../../config/db.js";
import moment from "moment";
import bcrypt from "bcryptjs";

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";
 
export const vendorList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        const params = {
            tableName  : ' vendor_list',
            columns    : `vendor_id, vendor_name, area_name, emirate, package_price, showroom_name`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['vendor_name', 'area_name', 'showroom_name'],
            liveSearchTexts  : [search_text, search_text, search_text],
            limit            : 10,
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],
        }
        const result = await getPaginatedData(params);
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Vendor List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const vendorDetail = asyncHandler(async (req, resp) => {
    const { vendor_id } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), { vendor_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    const vendorData = await queryDB(`
        SELECT 
            vendor_id, vendor_name, area_name, showroom_name, emirate, address, package_price, rsa_session, pod_session, ${formatDateTimeInQuery(['created_at'])}
        FROM vendor_list 
        WHERE vendor_id = ?`, [vendor_id]
    );
    if (!vendorData) return resp.json({status: 0, code:404, message: 'vendor not found.'});

    return resp.json({
        status  : 1,
        code    : 200,
        message : ["Vendor Details fetched successfully!"],
        data    : vendorData,
    });
});

export const addVendor = asyncHandler(async (req, resp) => {
    try {
        const {
            vendor_name, area_name, showroom_name, emirate, address, package_price, rsa_session=0, pod_session=0
        } = req.body;
        
        const { isValid, errors } = validateFields(req.body, { 
            vendor_name   : ["required"], 
            area_name     : ["required"], 
            showroom_name : ["required"],
            emirate       : ["required"],
            address       : ["required"],
            // package_price : ["required"],
            // rsa_session   : ["required"],
            // pod_session   : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
         
        const insert = await insertRecord('vendor_list',
            [ 'vendor_id', 'vendor_name', 'area_name', 'showroom_name', 'emirate', 'address', 'package_price', 'rsa_session', 'pod_session' ],
            [ "vendor_id", vendor_name, area_name, showroom_name, emirate, address, package_price, rsa_session, pod_session ]
        );
        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add vendor! Please try again after some time."});

        const vendor_id = 'VND' + String( insert.insertId ).padStart(4, '0');
        await updateRecord('vendor_list', { vendor_id : vendor_id }, ['id'], [insert.insertId] );
        
        return resp.json({ status  : 1, message : "Vendor added successfully." });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

export const editVendor = asyncHandler(async (req, resp) => {
    try {
        const {
            vendor_id, vendor_name, area_name, showroom_name, emirate, address, package_price, rsa_session=0, pod_session=0
        } = req.body;
        
        const { isValid, errors } = validateFields(req.body, { 
            vendor_id     : ["required"],
            vendor_name   : ["required"],
            area_name     : ["required"],
            showroom_name : ["required"],
            emirate       : ["required"],
            address       : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
         
        const updtObj = {
            vendor_name, area_name, showroom_name, emirate, address, package_price, rsa_session, pod_session  
        }
        const update = await updateRecord('vendor_list', updtObj, ['vendor_id'], [ vendor_id ] );
        
        return resp.json({
            status: update.affectedRows > 0 ? 1 : 0, 
            code: 200,
            message: update.affectedRows > 0 ? "Vendor updated successfully" : "Failed to update, Please Try Again!",
        });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

export const allVendorList = asyncHandler(async (req, resp) => {
    const { vendor_name="" } = req.body;

    if(vendor_name){
        const [list] = await db.execute(`
            SELECT showroom_name as value, showroom_name as label 
            FROM vendor_list
            WHERE vendor_name LIKE ?
            ORDER BY showroom_name ASC`, [`%${vendor_name}%`]
        );
        return resp.json({status: 1, code: 200, message: '', data: list});
    } else {
        const [list] = await db.execute(`
            SELECT vendor_id as value, vendor_name as label 
            FROM vendor_list
            ORDER BY vendor_name ASC`
        );
        return resp.json({status: 1, code: 200, message: '', data: list});
    }
    
});

export const communityAreaList = asyncHandler(async (req, resp) => {
    const { community } = req.body;
    const { isValid, errors }      = validateFields(mergeParam(req), { community: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const [list] = await db.execute(`
        SELECT area_name as value, area_name as label 
        FROM community_list 
        WHERE status = 1 AND community_name LIKE "%${community}%"
        ORDER BY area_name ASC`
    );
    return resp.json({status: 1, code: 200, message: '', data: list});
});

// Customer Functions
export const addCustomer = asyncHandler(async (req, resp) => {
    try {
        const {
            vendor_id, showroom_name, customer_name, country_code = '+971', mobile_number, customer_email, emirate, ev_make, ev_model, purchase_date, pod_charging_session_number=0,
            pod_charging_session_validity="", rsa_charging_session_number=0, rsa_charging_session_validity=""
        } = req.body;

        const { isValid, errors } = validateFields(req.body, { 
            vendor_id      : ["required"],
            showroom_name  : ["required"],
            customer_name  : ["required"],
            mobile_number  : ["required"],
            customer_email : ["required"],
            emirate        : ["required"],
            ev_make        : ["required"],
            ev_model       : ["required"], 
            purchase_date  : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const countryCode = '+'+country_code;

        const [duplicateCheck] = await db.query(`
            SELECT 'mobile' AS type FROM vendor_customers WHERE mobile_number = ?
            UNION
                SELECT 'email' AS type FROM vendor_customers WHERE customer_email = ? `, 
            [ mobile_number, customer_email ]
        );
        const types = duplicateCheck.map(row => row.type);
        if (types.includes('mobile') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
            
        } else if (types.includes('mobile')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
            
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
        }
        const purchaseDate        = moment(purchase_date, 'DD-MM-YYYY').format("YYYY-MM-DD");
        const podChargingValidity = moment(pod_charging_session_validity, 'DD-MM-YYYY').format("YYYY-MM-DD");
        const rsaChargingValidity = moment(rsa_charging_session_validity, 'DD-MM-YYYY').format("YYYY-MM-DD");

        const insert = await insertRecord('vendor_customers',
        [
            'customer_id', 'vendor_id', 'customer_name', 'country_code', 'mobile_number', 'customer_email', 'showroom_name', 'emirate', 'ev_make', 'ev_model', 'purchase_date',
            'pod_charging_session_number', 'pod_charging_session_validity', 'rsa_charging_session_number',
            'rsa_charging_session_validity'
        ], [
            'customer_id', vendor_id, customer_name, countryCode, mobile_number, customer_email, showroom_name, emirate, ev_make, ev_model, purchaseDate,
            pod_charging_session_number, podChargingValidity, rsa_charging_session_number, rsaChargingValidity
        ]);

        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add Please try again after some time."});
        
        const customer_id = 'VC' + String( insert.insertId ).padStart(4, '0');
        await updateRecord('vendor_customers', { customer_id : customer_id }, ['id'], [insert.insertId] );

        await createMainUser(customer_name, customer_email, countryCode, mobile_number, emirate);

        return resp.json({ status  : 1, message : "Customer added successfully." });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

const createMainUser = async (customer_name, customer_email, country_code, mobile_number, emirate) => {
    const fullMobile = `${country_code}${mobile_number}`;
    const [[isExist]] = await db.execute(`
        SELECT rider_mobile, 
            (SELECT COUNT(*) FROM riders AS r WHERE r.rider_email = ?) AS check_email,
            (SELECT COUNT(*) FROM riders AS r1 WHERE r1.rider_mobile = ?) AS check_mob,
            (SELECT COUNT(*) FROM rsa WHERE rsa.mobile = ? ) AS rsa_mob
        FROM 
            riders
        LIMIT 1 `, [customer_email, mobile_number, fullMobile ]
    );
    if(isExist.check_mob > 0 || isExist.rsa_mob > 0 ) return false;
    if(isExist.check_email > 0 ) return false;

    const rider = await insertRecord('riders', 
    [
        'rider_id', 'rider_name', 'rider_email', 'country_code', 'rider_mobile', 'emirates', 'status', 'added_from' 
    ], [ 
        'ER', customer_name, customer_email, country_code, mobile_number, emirate, 0, 'Admin' 
    ]);
    if(!rider) return false; 

    const riderId = 'ER' + String(rider.insertId).padStart(4, '0');
    await updateRecord('riders', { rider_id : riderId }, ['id'], [ rider.insertId ]);
    return true; 
}


export const customerList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);

        const limit  = 10;
        const page   = (isNaN(page_no) || page_no < 1) ? 1 : parseInt(page_no, 10);
        const offset = (page * limit) - limit;

        const monthStart = moment().startOf('month').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss');
        const monthEnd   = moment().endOf('month').subtract(4, 'hours').format('YYYY-MM-DD HH:mm:ss');

        let whereSql      = ``;
        const queryParams = [];
        if (search_text && String(search_text).trim()) {
            const like = `%${String(search_text).trim()}%`;
            whereSql = `WHERE ( vc.customer_name LIKE ? OR vc.showroom_name LIKE ) `;
            queryParams.push(like, like);
        }
        const [rows] = await db.execute(`
            SELECT SQL_CALC_FOUND_ROWS
                vc.customer_id, vc.customer_name, CONCAT(vc.country_code, '-', vc.mobile_number) AS mobileNumber, vc.emirate, 
                CONCAT(vc.ev_make,', ', vc.ev_model) AS makeModel, vc.purchase_date, v.vendor_name
            FROM vendor_customers AS vc
            LEFT JOIN vendor_list AS v ON v.vendor_id = vc.vendor_id
            ${whereSql}
            ORDER BY vc.id DESC
            LIMIT ${offset}, ${limit} `, queryParams
        );
        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Customer List fetch successfully!"],
            data       : rows,
            total_page : totalPage,
            total,
        });

    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};