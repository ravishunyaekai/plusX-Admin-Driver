
import { getPaginatedData, queryDB } from '../../dbUtils.js';
import { asyncHandler, formatDateTimeInQuery } from '../../utils.js';
import validateFields from "../../validation.js";
import moment from 'moment';

// EV Insurance
export const evInsuranceList = asyncHandler(async (req, resp) => {
    const { search_text, page_no, start_date, end_date, } = req.body;
    
    const params = {
        tableName : 'ev_insurance',
        columns   : `insurance_id, owner_name, CONCAT(country_code, "-", mobile_no) as mobile, vehicle_data, ${formatDateTimeInQuery(['created_at'])}`,
        sortColumn : 'id',
        sortOrder  : 'DESC',
        page_no,
        limit            : 10,
        liveSearchFields : ['insurance_id', 'owner_name', 'mobile_no'],
        liveSearchTexts  : [search_text, search_text, search_text],
        whereField       : [],
        whereValue       : [],
        whereOperator    : []
    };
    if (start_date && end_date) {
                
        // const startToday = new Date(start_date);
        // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
        //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                    
        // const givenStartDateTime    = startFormattedDate+' 00:00:01'; 
        // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); 
        // const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
        
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
    const result = await getPaginatedData(params);
    return resp.json({
        status: 1,
        code: 200,
        message: ["EV Insurance List fetch successfully!"],
        data: result.data,
        total_page: result.totalPage,
        total: result.total,
    });   
});

export const evInsuranceDetail = asyncHandler(async (req, resp) => {
    const { insurance_id }    = req.body;
    const { isValid, errors } = validateFields(req.body, {insurance_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const data = await queryDB(`
        SELECT 
            insurance_id, owner_name, country_code, mobile_no, vehicle_data,
            insurance_expiry, driving_licence, car_images, emirates_id, 
            ${formatDateTimeInQuery(['created_at', 'updated_at'])} 
        FROM 
            ev_insurance 
        WHERE 
            insurance_id = ? LIMIT 1`, 
    [insurance_id]);
    
    return resp.json({
        status   : 1,
        code     : 200,
        message  : ["EV Insurance Detail fetched successfully!"],
        data     : data,
        base_url : `${process.env.DIR_UPLOADS}insurance-images/`,
    });
});
