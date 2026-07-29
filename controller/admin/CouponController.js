import db from '../../config/db.js';
import { getPaginatedData, insertRecord, queryDB, updateRecord } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import { asyncHandler, formatDateInQuery, formatDateTimeInQuery } from '../../utils.js';
import moment from "moment-timezone";

const validations = async (coupan_code, resp, coupon_id=null) => {
    if (typeof coupan_code !== 'string') {
        return resp.json({ status: 0, code: 422, message: "Coupan code must be a string." });
    }
    if (coupan_code.length > 25) {
        return resp.json({ status: 0, code: 422, message: "The coupan code may not be greater than 25 characters." });
    }

    let query = `SELECT COUNT(*) AS count FROM coupon WHERE coupan_code = ?`;
    const params = [coupan_code];

    if (coupon_id) {
        query += ` AND id != ?`;
        params.push(coupon_id);
    }
    const result = await queryDB(query, params);
    console.log(query, params, result);

    if (result.count > 0) {
        return resp.json({ status: 0, code: 422, message: "Coupan code must be unique." });
    }

    return null;
};

export const couponList = asyncHandler(async (req, resp) => {
    const { start_date, end_date, search_text = '', page_no } = req.body;

    const whereFields    = []
    const whereValues    = []
    const whereOperators = []

    if (start_date && end_date) {
        const start = moment(start_date, "YYYY-MM-DD").startOf('day').format("YYYY-MM-DD HH:mm:ss");
        const end = moment(end_date, "YYYY-MM-DD").endOf('day').format("YYYY-MM-DD HH:mm:ss");

        whereFields.push('end_date', 'end_date');
        whereValues.push(start, end);
        whereOperators.push('>=', '<=');
    }
    const result = await getPaginatedData({
        tableName: 'coupon',
        columns: `id, coupan_name, coupan_code, user_per_user, coupan_percentage, ${formatDateInQuery(['end_date'])}, status, booking_for, (select count(*) from coupon_usage as cu where cu.coupan_code = coupon.coupan_code) as counpon_used`,
        liveSearchFields : ['id', 'coupan_name', 'coupan_code',],
        liveSearchTexts  : [search_text, search_text, search_text],
        sortColumn       : 'end_date DESC, status DESC',
        sortOrder        : '',
        page_no,
        limit: 10,
        whereField: whereFields,
        whereValue: whereValues,
        whereOperator: whereOperators
    });
    const currDate = moment().utcOffset(4).format('YYYY-MM-DD');
    for (const res of result.data) {
        
        res.status = (res.end_date < currDate) ? 'Expired' : (res.status == 1 ) ? "Active" : "Inactive"
    }
    return resp.json({
        status     : 1,
        code       : 200,
        message    : "Coupon List fetch successfully!",
        data       : result.data,
        total_page : result.totalPage,
        total      : result.total,
    });    
});

export const couponDetail = asyncHandler(async (req, resp) => {
    const { coupon_id } = req.body;
    if (!coupon_id) return resp.json({ status: 0, code: 422, message: "Coupon Id is required" });
    
    const coupon = await queryDB(`SELECT *, ${formatDateInQuery(['end_date'])}, ${formatDateTimeInQuery(['created_at', 'updated_at'])} FROM coupon WHERE id = ?`, [coupon_id]);
    
    return resp.status(200).json({status: 1, data: coupon, message: "Coupon Data fetch successfully!"});
});

export const couponData = asyncHandler(async (req, resp) => {
    const bookingType = [
        'Charger Installation', 'EV Pre-Sale', 'POD-On Demand Service', 'POD-Get Monthly Subscription',
        'Roadside Assistance', 'Valet Charging',   
    ];
    return resp.json({status: 1, message: "Coupon data fetch successfully!"}, bookingType );
});

export const couponAdd = asyncHandler(async (req, resp) => {
    const { coupan_name, coupan_code, coupan_percentage, expiry_date, user_per_user, service_type, status = '1' } = req.body;
    const { isValid, errors } = validateFields(req.body, { coupan_name: ["required"], coupan_code: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    const validationErr = await validations(coupan_code, resp);
    if (validationErr) return validationErr;
    const fExpiry = moment(expiry_date, "YYYY-MM-DD").format("YYYY-MM-DD");
    
    const insert = await insertRecord('coupon', [
        'coupan_name', 'coupan_code', 'coupan_percentage', 'end_date', 'user_per_user', 'booking_for', 'status',
    ], [
        coupan_name, coupan_code, coupan_percentage, fExpiry, user_per_user, service_type, status
    ]);
    

    return resp.json({
        status: insert.affectedRows > 0 ? 1 : 0,
        message: insert.affectedRows > 0 ? "Coupon added successfully" : "Failed to insert, Please try again.",
    });
    
});

export const couponEdit = asyncHandler(async (req, resp) => {
    const { coupan_name, coupan_code, coupan_percentage, expiry_date, user_per_user, service_type, status='' } = req.body;
    const { isValid, errors } = validateFields(req.body, { coupan_name: ["required"], coupan_code: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    console.log(req.body);
    // return false
    const {coupon_id} = await queryDB(`SELECT id AS coupon_id FROM coupon WHERE coupan_code = ? `, [coupan_code]);
    const validationErr = await validations(coupan_code, resp, coupon_id);
    if (validationErr) return validationErr;

    const fExpiryDate = moment(expiry_date, "YYYY-MM-DD").format("YYYY-MM-DD");
    const updates = {coupan_name, coupan_percentage, end_date: fExpiryDate, user_per_user: user_per_user, booking_for: service_type, status: status };
    
    const update = await updateRecord('coupon', updates, ['coupan_code'], [coupan_code]);
    
    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0,
        message: update.affectedRows > 0 ? "Coupon updated successfully" : "Failed to update, Please try again.",
    });

});

export const couponDelete = asyncHandler(async (req, resp) => {
    const { coupan_code } = req.body;
    if (!coupan_code) return resp.json({ status: 0, code: 422, message: "Coupon Code is required" });
    
    const [del] = await db.execute(`DELETE FROM coupon WHERE coupan_code = ?`, [coupan_code]);

    return resp.json({ 
        status: del.affectedRows > 0 ? 1 : 0, 
        code: 200, 
        message: del.affectedRows > 0 ? "Coupon deleted successfully!" : "Coupon can not delete, or invalid" 
    });
});
