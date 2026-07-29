
import { mergeParam, formatDateTimeInQuery, asyncHandler, createNotification, pushNotification, } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB, getPaginatedData, updateRecord } from '../../dbUtils.js';
import db from "../../config/db.js";

import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";
  
export const chargeShareList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '' } = mergeParam(req);
        const params = {
            tableName  : ' charge_share',
            columns    : `rider_name, charger_id, mobile, charger_name, charger_type, output, 
            CASE 
                WHEN charger_status = 1 THEN 'Accepted'
                WHEN charger_status = 2 THEN 'Rejected'
                ELSE 'Pending'
            END AS charger_status`,
            sortColumn : 'id',
            sortOrder  : 'DESC',
            page_no,
            liveSearchFields : ['compatible', 'charger_name'],
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
            message    : [" Charger Share List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
            base_url   : `${process.env.DIR_UPLOADS}charge-share-images/`,
        });
 
    } catch (error) {
        console.log('Error fetching station list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp );
    }
};
 
export const chargeShareDetail = asyncHandler(async (req, resp) => {
    const { charger_id, rider_id } = mergeParam(req);
    const { isValid, errors }      = validateFields(mergeParam(req), { charger_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
    const charger = await queryDB(`
        SELECT 
            charger_id, rider_name, email, mobile, charger_name, description, charger_type, output, connector_type, compatible, park_no, park_floor, open_days, open_timing, charger_image, address, latitude, longitude, charger_status, ${formatDateTimeInQuery(['created_at'])}
        FROM charge_share 
        WHERE charger_id = ?`, [charger_id]
    );
    if (!charger) return resp.status(404).json({status: 0, code:404, message: 'Charge share Product not found.'});
    return resp.json({
        status   : 1,
        code     : 200,
        message  : ["Charge Share Details fetched successfully!"],
        data     : charger,
        base_url : `${process.env.DIR_UPLOADS}charge-share-images/`,
    });
});

export const outputAndConnector = asyncHandler(async (req, resp) => {
    // const { requirement } = mergeParam(req);
    let modelData = [{ value : "All EVs", label : "All EVs" }]; 
    
    const op_query    = `SELECT value, value as label  FROM output_connector where status = ? order by id asc`    
    const [connector] = await db.execute(op_query, ['connector']);
    const [output_ac] = await db.execute(op_query, ['AC']);
    const [output_dc] = await db.execute(op_query, ['DC']);

    let [make_list] = await db.execute('SELECT make as value, make as label FROM vehicle_brand_list WHERE status = ? AND make != ? GROUP BY make Order by make ASC',[1, "Other"]);
    make_list.push({ value : "Other", label : "Other" });
    
    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Out Put, Connector Data fetched successfully!"],
        weeks      : ["All Days", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",],
        connector,
        make_list  : [...modelData, ...make_list],
        AC_output  : output_ac,
        DC_output  : output_dc
    });
});

export const editAcceptChargShare = asyncHandler(async (req, resp) => { 

    const {
        charger_id, charger_name, description, address, latitude, longitude, charger_type, output_power, connector_type, compatible, parking_no, parking_floor, open_days, open_timing,
    } = mergeParam(req);

    const { isValid, errors } = validateFields(mergeParam(req), { 
        charger_id      : ["required"], 
        customer_name   : ["required"], 
        customer_email  : ["required"], 
        customer_mobile : ["required"], 
        charger_name    : ["required"], 
        description     : ["required"], 
        address         : ["required"], 
        latitude        : ["required"],
        longitude       : ["required"],
        charger_type    : ["required"], 
        output_power    : ["required"],
        connector_type  : ["required"],
        compatible      : ["required"],
        open_days       : ["required"],
        open_timing     : ['required'],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
    const checkCharger = await queryDB(`
        SELECT cs.charger_image, cs.rider_id, (select fcm_token from riders as r where r.rider_id = cs.rider_id ) as fcm_token 
        FROM charge_share as cs
        WHERE cs.charger_id = ?`,[ charger_id ]
    );
    if(!checkCharger) return resp.json({ status : 0, message : "Invailed Charger ID" });
    
    let charger_image = checkCharger.charger_image;
    if(req.files && req.files['charger_image']) { 
        charger_image = req.files['charger_image'][0].filename ;
    } 
    let updates = {
        charger_name, description, charger_type, connector_type, compatible, address, latitude, longitude,
        output     : output_power,
        park_no    : parking_no,
        park_floor : parking_floor,
        open_days, open_timing, charger_image, charger_status : 1,  
    };
    const update = await updateRecord('charge_share', updates, [ 'charger_id'], [ charger_id ]);
    if(update.affectedRows){ 
        const href    = 'charge_share_accept/'+ charger_id;
        const heading = charger_name; 
        const desc    = `Your listing has been approved!`;

        createNotification(heading, desc, 'charge_share_accept', 'Rider', 'Admin', '', checkCharger.rider_id, href);
        pushNotification(checkCharger.fcm_token, heading, desc, 'RDRFCM', href);

        return resp.json({ status  : 1, message : "Charger Share has been accepted successfully!" });
    } else {
        return resp.json({ status: 0, message: 'Something went wrong in add charge share' });
    } 
});

export const rejectChargShare = asyncHandler(async (req, resp) => {
    
    const { charger_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { charger_id : ["required"]});
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const checkCharger = await queryDB(`
        SELECT cs.charger_name, cs.rider_id, (select fcm_token from riders as r where r.rider_id = cs.rider_id ) as fcm_token 
        FROM charge_share as cs
        WHERE cs.charger_id = ?`,[ charger_id ]
    );
    if(!checkCharger) return resp.json({ status : 0, message : "Invailed Charger ID" });
    
    let updates = { charger_status : 2 };
    const update = await updateRecord('charge_share', updates, [ 'charger_id'], [ charger_id ]);
    if(update.affectedRows){
        const href    = 'charge_share_reject/' + charger_id;
        const heading = checkCharger.charger_name;
        const desc    = `Your listing has been rejected as it does not meet our guidelines.`;
        createNotification(heading, desc, 'charge_share_reject', 'Rider', 'Admin', '', checkCharger.rider_id, href);
        pushNotification(checkCharger.fcm_token, heading, desc, 'RDRFCM', href);

        return resp.json({ status  : 1, message : "Charger Share has been rejected successfully!" });
    } else {
        return resp.json({ status: 0, message: 'Something went wrong in add charge share' });
    }    
});