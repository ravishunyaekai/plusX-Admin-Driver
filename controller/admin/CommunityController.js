
import { mergeParam, formatDateTimeInQuery, asyncHandler, createNotification, pushNotification, } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB, getPaginatedData, updateRecord, insertRecord } from '../../dbUtils.js';
import db from "../../config/db.js";
import moment from "moment";
import bcrypt from "bcryptjs";

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";
  
export const communityList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        const params = { //;
            tableName  : ' community_list as cl',
            columns    : `cl.community_id, community_name, area_name, total_residence, (SELECT count(*) FROM community_chargers as cc WHERE cc.community_id = cl.community_id ) AS no_of_chargers`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['community_name', 'area_name'],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],
        }
        const result = await getPaginatedData(params);
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Community List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const communityDetail = asyncHandler(async (req, resp) => {
    const { community_id } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), { community_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    const communities = await queryDB(`
        SELECT 
            community_id, community_name, area_name, total_residence, ${formatDateTimeInQuery(['created_at'])}, status
        FROM community_list 
        WHERE community_id = ?`, [community_id]
    );
    if (!communities) return resp.json({status: 0, code:404, message: 'Community not found.'});

    const [chargers] = await db.execute(`
        SELECT id, charger_id, kw
        FROM community_chargers 
        WHERE community_id = ?`, [ community_id ]
    );

    const manager = await queryDB(`
        SELECT 
            manager_id, manager_name, manager_email, manager_contact, status, ${formatDateTimeInQuery(['created_at'])}
        FROM community_managers 
        WHERE community_id = ?`, [ community_id ]
    );

    return resp.json({
        status  : 1,
        code    : 200,
        message : ["Community Details fetched successfully!"],
        data    : communities,
        chargers,
        manager,
    });
});

export const addCommunity = asyncHandler(async (req, resp) => {
    try {
        const {
            community_name, area_name, total_residence, chargers, kwValues,
            manager_name, manager_email, manager_contact, password
        } = req.body;
        
        // return resp.json({ status : 0, message : "Community added successfully.", body : req.body });

        const { isValid, errors } = validateFields(req.body, { 
            community_name   : ["required"], 
            area_name        : ["required"], 
            total_residence  : ["required"], 
            chargers         : ["required"],
            kwValues         : ["required"],
            manager_name     : ["required"],
            manager_email    : ["required"],
            // manager_contact  : ["required"],
            password         : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (password.length < 6) return resp.json({ status: 0, code: 422, message: ["Password must be at least 6 characters"] });

        const [duplicateCheck] = await db.query(`
            SELECT 'contact' AS type FROM community_managers WHERE manager_contact = ?
            UNION
                SELECT 'email' AS type FROM community_managers WHERE manager_email = ? `,
            [ manager_contact, manager_email ]
        );
        const types = duplicateCheck.map(row => row.type);
        if (types.includes('contact') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Manager contact number and Email already exist"] });
        } else if (types.includes('contact')) {
            return resp.json({ status: 0, code: 422, message: ["Manager contact number already exists"] });
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Manager email already exists"] });
        }

        const insert = await insertRecord('community_list',
            [ 'community_id', 'community_name', 'area_name', 'total_residence', 'status' ], 
            [ "community_id", community_name, area_name, total_residence, 1 ]
        );
        // community_id
        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add public charger! Please try again after some time."});

        const community_id = 'CMT' + String( insert.insertId ).padStart(4, '0');
        await updateRecord('community_list', { community_id : community_id }, ['id'], [insert.insertId] );
        
        const charger_points = JSON.parse(chargers);
        const kw             = JSON.parse(kwValues);
        if( charger_points.length > 0 ) {
             
            const values       = charger_points.map((charger_point, index) => [ community_id, charger_point, kw[index] ]);
            const placeholders = values.map(() => '(?, ?, ?)').join(', ');

            await db.execute(
                `INSERT INTO community_chargers (community_id, charger_id, kw) VALUES ${placeholders}`, values.flat()
            );
        }

        const hashedPswd = await bcrypt.hash(password, 10);
        const managerInsert = await insertRecord('community_managers',
            [ 'manager_id', 'community_id', 'manager_name', 'manager_email', 'manager_contact', 'password', 'status' ],
            [ 'manager_id', community_id, manager_name, manager_email, manager_contact, hashedPswd, 1 ]
        );
        if (managerInsert.affectedRows == 0) {
            return resp.json({ status: 0, message: "Community added but failed to add community manager. Please try again." });
        }
        const manager_id = 'CM-' + String(managerInsert.insertId).padStart(3, '0');
        await updateRecord('community_managers', { manager_id }, ['id'], [managerInsert.insertId]);

        return resp.json({ status  : 1, message : "Community added successfully." });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

export const editCommunity = asyncHandler(async (req, resp) => {
    try {
        const {
            community_id, community_name, area_name, total_residence, chargers, kwValues,
            manager_name, manager_email, manager_contact, password
        } = req.body;
        
        // return resp.json({ status : 0, message : "Community added successfully.", body : req.body });

        const { isValid, errors } = validateFields(req.body, { 
            community_id     : ["required"], 
            community_name   : ["required"], 
            area_name        : ["required"], 
            total_residence  : ["required"], 
            chargers         : ["required"],
            kwValues         : ["required"],
            manager_name     : ["required"],
            manager_email    : ["required"],
            // manager_contact  : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        if (password && password.length < 6) {
            return resp.json({ status: 0, code: 422, message: ["Password must be at least 6 characters"] });
        }

        const [duplicateCheck] = await db.query(`
            SELECT 'contact' AS type FROM community_managers WHERE manager_contact = ? AND community_id != ?
            UNION
                SELECT 'email' AS type FROM community_managers WHERE manager_email = ? AND community_id != ? `,
            [ manager_contact, community_id, manager_email, community_id ]
        );
        const types = duplicateCheck.map(row => row.type);
        if (types.includes('contact') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Manager contact number and Email already exist"] });
        } else if (types.includes('contact')) {
            return resp.json({ status: 0, code: 422, message: ["Manager contact number already exists"] });
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Manager email already exists"] });
        }

        const updtObj = { community_name, area_name, total_residence }
        const update = await updateRecord('community_list', updtObj, ['community_id'], [ community_id ] );
        
        const charger_points = JSON.parse(chargers);
        const kw             = JSON.parse(kwValues);
        if( charger_points.length > 0 ) {
            await db.execute('DELETE FROM community_chargers WHERE community_id = ?', [ community_id ]);
            const values       = charger_points.map((charger_point, index) => [ community_id, charger_point, kw[index] ]);
            const placeholders = values.map(() => '(?, ?, ?)').join(', ');

            await db.execute(
                `INSERT INTO community_chargers (community_id, charger_id, kw) VALUES ${placeholders}`, values.flat()
            );
        }

        const managerUpdtObj = { manager_name, manager_email, manager_contact };
        if (password) {
            managerUpdtObj.password = await bcrypt.hash(password, 10);
        }
        await updateRecord('community_managers', managerUpdtObj, ['community_id'], [ community_id ]);

        return resp.json({
            status: update.affectedRows > 0 ? 1 : 0, 
            code: 200, 
            message: update.affectedRows > 0 ? "Community updated successfully" : "Failed to update, Please Try Again!", 
        });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

// Resident Functions
export const allCommunityList = asyncHandler(async (req, resp) => {
    const [list] = await db.execute(`
        SELECT community_id as value, community_name as label 
        FROM community_list 
        WHERE status = 1 
        ORDER BY community_name ASC`
    );
    return resp.json({status: 1, code: 200, message: '', data: list});
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

export const addResident = asyncHandler(async (req, resp) => {
    try {
        const {
            resident_name, mobile_number, resident_email, community_id, address, monthly_session_allocation,
            alloted_time, kwh_allocated, per_kwh_charge, extra_charge
        } = req.body;

        const { isValid, errors } = validateFields(req.body, { 
            resident_name              : ["required"], 
            mobile_number              : ["required"], 
            resident_email             : ["required"], 
            community_id               : ["required"],
            address                    : ["required"], 
            monthly_session_allocation : ["required"], 
            alloted_time               : ["required"], 
            kwh_allocated              : ["required"],
            per_kwh_charge             : ["required"], 
            extra_charge               : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [duplicateCheck] = await db.query(`
            SELECT 'mobile' AS type FROM community_resident WHERE resident_mobile = ?
            UNION
                SELECT 'email' AS type FROM community_resident WHERE resident_email = ? `, 
            [ mobile_number, resident_email ]
        );
        
        const types = duplicateCheck.map(row => row.type);
        if (types.includes('mobile') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
            
        } else if (types.includes('mobile')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
            
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
        }
        const insert = await insertRecord('community_resident',
        [
            'resident_id', 'community_id', 'resident_name', 'resident_mobile', 'resident_email', 'address', 'monthly_session_allocation', 'alloted_time', 'kwh_allocated', 'per_kwh_charge', 'extra_charge', 'status',
        ], [
            'resident_id', community_id, resident_name, mobile_number, resident_email, address, monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge, 1, 
        ]);

        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add Please try again after some time."});
        
        const resident_id = 'RD' + String( insert.insertId ).padStart(4, '0');
        await updateRecord('community_resident', { resident_id : resident_id }, ['id'], [insert.insertId] );
        return resp.json({ status  : 1, message : "Resident added successfully." });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});

export const residentList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        
        const params = {
            tableName  : ' community_resident as cr',
            columns    : `resident_id, resident_name, community_name, area_name, monthly_session_allocation, '0' AS session_used, kwh_allocated, '0' AS kwh_used `,
            sortColumn : 'cr.id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['resident_name', 'resident_mobile'],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],
            joinTable        : ' community_list as cm ',
            joinCondition    : ' cm.community_id = cr.community_id ',
        }
        const result = await getPaginatedData(params);
         
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Community List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const residentDetail = asyncHandler(async (req, resp) => {
    const { resident_id } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), { 
        resident_id : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    const residents = await queryDB(`
        SELECT 
            resident_id, resident_name, resident_mobile, resident_email, address, monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge, ${formatDateTimeInQuery(['rs.created_at'])}, rs.status,
            community_name, area_name, rs.community_id
        FROM community_resident as rs
        LEFT JOIN community_list as cm ON cm.community_id = rs.community_id
        WHERE resident_id = ?`, [ resident_id ]
    );
    if (!residents) return resp.json({status: 0, code:404, message: 'Resident not found.'});

    return resp.json({
        status  : 1,
        code    : 200,
        message : ["Resident Details fetched successfully!"],
        data    : residents,
    });
});

export const residentSearch = asyncHandler(async (req, resp) => {
    const { search, community_id } = req.body;
    const { isValid, errors }      = validateFields(mergeParam(req), { search : ["required"], community_id : ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const [list] = await db.execute(`
        SELECT resident_id, resident_name, resident_mobile
        FROM community_resident 
        WHERE community_id = ? AND ( resident_id LIKE ? OR resident_name LIKE ? OR resident_mobile LIKE ? )
        ORDER BY resident_name ASC`, [ community_id, `%${search}%`, `%${search}%`, `%${search}%` ]
    );
    return resp.json({status: 1, code: 200, message: '', data: list});
});

export const editResident = asyncHandler(async (req, resp) => {
    try {
        const {
            resident_id, resident_name, mobile_number, resident_email, community_id, address, monthly_session_allocation,
            alloted_time, kwh_allocated, per_kwh_charge, extra_charge
        } = req.body;

        const { isValid, errors } = validateFields(req.body, { 
            resident_id                : ["required"],
            resident_name              : ["required"],
            mobile_number              : ["required"],
            resident_email             : ["required"],
            community_id               : ["required"],
            address                    : ["required"], 
            monthly_session_allocation : ["required"], 
            alloted_time               : ["required"], 
            kwh_allocated              : ["required"],
            per_kwh_charge             : ["required"], 
            extra_charge               : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [duplicateCheck] = await db.query(`
            SELECT 'mobile' AS type FROM community_resident WHERE resident_mobile = ? AND resident_id != ?
            UNION
                SELECT 'email' AS type FROM community_resident WHERE resident_email = ? AND resident_id != ?`, 
            [ mobile_number, resident_id, resident_email, resident_id ]
        );
        
        const types = duplicateCheck.map(row => row.type);
        if (types.includes('mobile') && types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number and Email already exist"] });
            
        } else if (types.includes('mobile')) {
            return resp.json({ status: 0, code: 422, message: ["Mobile number already exists"] });
            
        } else if (types.includes('email')) {
            return resp.json({ status: 0, code: 422, message: ["Email already exists"] });
        }
        const updtObj = { 
            resident_name,
            resident_email,
            resident_mobile : mobile_number, 
            community_id, 
            address, 
            monthly_session_allocation, 
            alloted_time, 
            kwh_allocated, 
            per_kwh_charge, 
            extra_charge
        } ;
        const update = await updateRecord('community_resident', updtObj, ['resident_id'], [ resident_id ] );
         
        return resp.json({
            status  : update.affectedRows > 0 ? 1 : 0, 
            code    : 200, 
            message : update.affectedRows > 0 ? "Resident updated successfully!" : "Failed to update, Please Try Again!", 
        });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});


export const getInvoiceData = asyncHandler(async (req, resp) => {
    const { resident_mobile, invoice_month } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { 
        resident_mobile : ["required"],
        invoice_month   : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const riderData = await queryDB(`
        SELECT rider_id 
        FROM riders
        WHERE rider_mobile = ?`, [ resident_mobile ]
    );
    if (!riderData) return resp.json({status: 0, code:404, message: 'Resident not found.'});

    const date      = moment(invoice_month, "YYYY-MM-DD");
    const startDate = date.clone().startOf("month").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
    const endDate   = date.clone().endOf("month").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
    const bookingData = await queryDB(`
        SELECT
            SUM(total_consumption) as total_consumption, SUM(extra_minutes) as extra_minutes, resident_data 
        FROM scan_charger_booking
        WHERE rider_id = ? AND created_at >= ? AND created_at <= ?  `, [ riderData.rider_id, startDate, endDate ]
    );
    
    const energy_price        = bookingData?.resident_data?.per_kwh_charge * bookingData?.total_consumption;
    const over_time_min_price = bookingData?.extra_minutes * bookingData?.resident_data?.extra_charge;
    const totalAmount          = parseFloat(energy_price) + parseFloat(over_time_min_price);

    const returnObj = {
        resident_name     : bookingData?.resident_data?.resident_name,
        total_consumption : (bookingData?.total_consumption || 0).toFixed(2),
        kwh_allocated     : bookingData?.resident_data?.kwh_allocated,

        energy_charge   : bookingData?.resident_data?.per_kwh_charge, //over_time_min
        energy_price    : (energy_price || 0).toFixed(2),
        
        over_time_min : bookingData?.extra_minutes || 0,
        extra_charge  : (over_time_min_price || 0 ) .toFixed(2),
        total_amount  : (totalAmount || 0).toFixed(2),
    }
    return resp.json({
        status  : 1,
        code    : 200,
        message : ["Invoice Details fetched successfully!"],
        data    : returnObj,
    });
});

export const createScanChargeInvoice = asyncHandler(async (req, resp) => {
    try {
        const { resident_id, resident_mobile, invoice_month, community_name, area_name  } = mergeParam(req);
        const { isValid, errors } = validateFields(mergeParam(req), { 
            resident_mobile : ["required"],
            resident_id     : ["required"], 
            invoice_month   : ["required"],
            community_name  : ["required"],
            area_name       : ["required"], 
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const billing_month = moment(invoice_month).format('MMMM')+' - ' +moment(invoice_month).format('YYYY');
        // check same month bill craeted or not      - 
        const riderData = await queryDB(`
            SELECT rider_id, ( SELECT COUNT(*) FROM scan_charger_invoice WHERE billing_month = ? ) AS invoiceExt
            FROM riders
            WHERE rider_mobile = ? `, [ billing_month, resident_mobile ]
        );
        if (!riderData) return resp.json({status: 0, code:404, message: 'Resident not found.'});

        if(riderData.invoiceExt ) { 
            return resp.json({ message : "You have reached the maximum number of allowed sessions.", status: 0 });
        }
        const date      = moment(invoice_month, "YYYY-MM-DD");
        const startDate = date.clone().startOf("month").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
        const endDate   = date.clone().endOf("month").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");

        const bookingData = await queryDB(`
            SELECT
                COUNT(*) AS total_session,
                COALESCE(SUM(total_consumption), 0) AS total_consumption,
                COALESCE(SUM(extra_minutes), 0) AS extra_minutes,
                resident_data 
            FROM scan_charger_booking
            WHERE rider_id = ? AND created_at >= ? AND created_at <= ? AND status = ? `, 
            [ riderData.rider_id, startDate, endDate, "C" ]
        );
        if (!bookingData || bookingData.total_session == 0) {
            return resp.json({ status: 0, code: 404, message: "No session found for selected month." });
        }
        const over_time_min        = bookingData?.extra_minutes || 0;
        const extra_charge_per_min = bookingData?.resident_data?.extra_charge || 0;
        const extra_charge_total   = ( over_time_min * extra_charge_per_min ).toFixed(2);

        const total_consumption  = bookingData?.total_consumption || 0;
        const per_kwh_charge     = bookingData?.resident_data?.per_kwh_charge || 0;
        const energy_price_total = ( per_kwh_charge * total_consumption ).toFixed(2);
        
        const resident_name    = bookingData?.resident_data?.resident_name;
        const resident_email   = bookingData?.resident_data?.resident_email;
        const resident_address = bookingData?.resident_data?.address;

        const no_of_session     = bookingData?.total_session; 
        const kwh_allocated     = bookingData?.resident_data?.kwh_allocated;

        const sub_total_amount = ( parseFloat(energy_price_total) + parseFloat(extra_charge_total) ).toFixed(2);
        const vat_amt          = ( sub_total_amount * 5 ) / 100 ;
        const total_amount     = ( parseFloat(sub_total_amount) + parseFloat(vat_amt) ).toFixed(2); 
   
        const insert = await insertRecord('scan_charger_invoice',
        [
            'invoice_id', 'rider_id', 'resident_name', 'resident_email', 'resident_address', 
            'community_name', 'area_name', 'resident_id', 'billing_month',
            'no_of_session', 'total_consumption', 'kwh_allocated', 'per_kwh_charge', 'energy_price_total', 
            'over_time_min', 'extra_charge_per_min', 'extra_charge_total',
            'subtotal', 'vat', 'total_amount', 'invoice_status'
        ], [
            'invoice_id', riderData.rider_id, resident_name, resident_email, resident_address,
            community_name, area_name, resident_id, billing_month,
            no_of_session, total_consumption, kwh_allocated, per_kwh_charge, energy_price_total, 
            over_time_min, extra_charge_per_min, extra_charge_total, 
            sub_total_amount, (vat_amt || 0 ).toFixed(2), total_amount, 0
        ]);

        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add Please try again after some time."});
        
        const invoice_id = 'INV' + String( insert.insertId ).padStart(4, '0');
        await updateRecord('scan_charger_invoice', { invoice_id : invoice_id }, ['id'], [insert.insertId] );
        return resp.json({ status  : 1, message : "Invoice Created Successfully!" });

    } catch (error) {
        console.log('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
});



export const scanChargeInvoiceList = async (req, resp) => {
    try {
        const { 
            resident_mobile='', page_no = 1, search_text = '', start_date = '', end_date= '', 
        } = mergeParam(req);

        const params = {
            tableName  : ' scan_charger_invoice',
            columns    : `invoice_id, resident_name, community_name, area_name, kwh_allocated, total_consumption, per_kwh_charge, energy_price_total, extra_charge_total, total_amount, ${formatDateTimeInQuery(['created_at'])}, CASE WHEN invoice_status = 1 THEN 'Paid' ELSE 'Pending' END AS invoice_status`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['invoice_id', 'resident_name'],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : [],
            whereValue       : [],
            whereOperator    : [],
        }
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

        if(resident_mobile) {
            const riderData = await queryDB(`
                SELECT rider_id FROM riders WHERE rider_mobile = ? `, [ resident_mobile ]
            );
            params.whereField.push('rider_id');
            params.whereValue.push(riderData.rider_id);
            params.whereOperator.push('=');
        }
        const result = await getPaginatedData(params);
         
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Session List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const scanChargeInvoiceDetail = async (req, resp) => {
    try {
        const { invoice_id } = mergeParam(req);
        const { isValid, errors }      = validateFields(mergeParam(req), { 
            invoice_id : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const invoiceData = await queryDB(`
            SELECT 
                invoice_id, resident_name, resident_email, resident_address, billing_month, resident_id, area_name, community_name, total_consumption, kwh_allocated, per_kwh_charge, energy_price_total, over_time_min, extra_charge_per_min, extra_charge_total, no_of_session, subtotal, vat, total_amount, ${formatDateTimeInQuery(['created_at'])}, 
                CASE WHEN invoice_status = 1 THEN 'Paid' ELSE 'Pending' END AS invoice_status
            FROM scan_charger_invoice
            WHERE invoice_id = ? `, [ invoice_id ]
        );
        if (!invoiceData) return resp.json({status: 0, code:404, message: 'Invoice not found.'});

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Invoice Details fetched successfully!"],
            data    : invoiceData,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const sessionList = async (req, resp) => {
    try {
        const { resident_id, page_no = 1, search_text = '', start_date = '', end_date= '', } = mergeParam(req);
        
        const params = {
            tableName  : ' scan_charger_booking',
            columns    : `booking_id, JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_name')) AS resident_name, JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.area_name')) AS area_name, charger_id, total_consumption, total_duration, ${formatDateTimeInQuery(['created_at'])},
            CASE WHEN status = 'S' THEN 'Start' WHEN status = 'C' THEN 'Stoped' ELSE 'Unknown' END AS status`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['booking_id', 'charger_id'],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : ["JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_id'))"],
            whereValue       : [resident_id],
            whereOperator    : ["="], //resident_data -> resident_id
        }
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
            message    : ["Session List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};

export const sessionDetail = async (req, resp) => {
    try {
        const { session_id } = mergeParam(req);
        const { isValid, errors } = validateFields(mergeParam(req), { session_id : ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const invoiceData = await queryDB(`
            SELECT 
                booking_id, charger_id, total_consumption, total_duration, extra_minutes, start_time, end_time, start_kwh, end_kwh, ${formatDateTimeInQuery(['created_at'])}, 
                CASE WHEN status = "S" THEN 'Started' ELSE 'Stoped' END AS session_status,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_name')) AS resident_name,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.resident_mobile')) AS resident_mobile,
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.community_name')) AS community_name, 
                JSON_UNQUOTE(JSON_EXTRACT(resident_data, '$.area_name')) AS area_name
            FROM scan_charger_booking
            WHERE booking_id = ? `, [ session_id ] //
        );
        if (!invoiceData) return resp.json({status: 0, code:404, message: 'Invoice not found.'});

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Session Details fetched successfully!"],
            data    : invoiceData,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};