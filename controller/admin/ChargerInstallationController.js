import db from '../../config/db.js';
import dotenv from 'dotenv';
import generateUniqueId from 'generate-unique-id';
import { formatDateTimeInQuery, formatDateInQuery, asyncHandler, deleteFile} from '../../utils.js';
import { getPaginatedData, insertRecord, updateRecord, queryDB } from '../../dbUtils.js';
import validateFields from "../../validation.js";
dotenv.config();
import moment from 'moment';
import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";

export const chargerInstallationList = asyncHandler(async (req, resp) => {
    try {
        const { page_no=1, booking_type, search_text='', start_date, end_date} = req.body;
        
        const { isValid, errors } = validateFields(req.body, { booking_type: ["required"] });
        if (!isValid)  return resp.json({ status: 0, code: 422, message: errors }); 

        const limit      = 10;
        const startIndex = parseInt((page_no * limit) - limit, 10);

        const tableObj = {
            FCB : "ev_charger_booiking", 
            AB  : "ev_accessories_booiking",
            CIS : "charging_installation_service"
        }    
        let whereQry =  booking_type == "CIS" ?  ' (charger_id IS NULL OR charger_id = "" ) ' : ' id > 0 ';
        if (start_date && end_date) {

            const startToday = new Date(start_date);
            const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString() .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                    
            const givenStartDateTime    = startFormattedDate+' 00:00:01'; // Replace with your datetime string
            const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            const endToday = new Date(end_date);
            const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
                .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            const end = formattedEndDate+' 19:59:59';
            
            whereQry += ` and created_at >= "${start}" AND created_at <= "${end}" `;
        }  
        if(search_text){
            whereQry += ` and (request_id LIKE "%${search_text}%" OR name LIKE "%${search_text}%" ) `;
        }
        const query = `
            SELECT  SQL_CALC_FOUND_ROWS
                request_id, name, email, country_code, contact_no, looking_for, resident_type, address, latitude, longitude, order_status, ${formatDateTimeInQuery(['created_at'])}
            FROM 
                ${tableObj[booking_type]} 
            WHERE 
                ${whereQry} 
            ORDER BY 
                created_at DESC 
            LIMIT ${startIndex}, ${parseInt(limit, 10)}
        `;
        const [rows] = await db.execute(query, []);
        
        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Booking List fetch successfully!"],
            data       : rows,
            total_page : totalPage,
            total      : total,
        });
        
    } catch (error) {
        console.error('Error fetching charger Offer history:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching charger booking lists' });
    }
});

export const chargerInstallationDetails = asyncHandler(async (req, resp) => {     
    const { request_id, booking_type } = req.body;
    const { isValid, errors } = validateFields(req.body, { request_id : ["required"] });
    if (!isValid) {
        return resp.json({ status: 0, code: 422, message: errors });
    }
    const table = {
        FCB : "ev_charger_booiking", 
        AB  : "ev_accessories_booiking",
        CIS : "charging_installation_service"
    } 
    const historytable = {
        FCB : "ev_charger_booiking_history", 
        AB  : "ev_accessories_booiking_history",
        CIS : "charging_installation_service_history"
    } 
    const chargerQuery = (booking_type != "CIS" ) ? ', (SELECT charger_name FROM ev_charger as ch WHERE ch.charger_id = chi.charger_id) as charger_name' : '';

    const orderData = await queryDB(`
        SELECT 
            request_id, name, email, country_code, contact_no, resident_type, address, latitude, longitude,
            description, order_status, looking_for, charger_id, ${formatDateTimeInQuery(['created_at'])}
            ${chargerQuery}
        FROM 
            ${table[booking_type]} as chi
        WHERE 
            request_id = ? LIMIT 1`, 
    [request_id]);

    const [history] = await db.execute(`SELECT order_status, ${formatDateTimeInQuery(['created_at'])} FROM ${historytable[booking_type]} WHERE service_id = ?`, [request_id]);

    return resp.json({
        message       : ["Booking Details fetched successfully!"],
        service_data  : orderData,
        order_history : history,
        status        : 1,
        code          : 200,
    });
} );

// Charger Brand Function 
export const chargerBrandList = asyncHandler(async (req, resp) => {
    const { search_text, page_no } = req.body;
    const result = await getPaginatedData({
        tableName        : 'charger_brands',
        columns          : `brand_id, brand_name`,
        liveSearchFields : ['brand_name', 'brand_id'],
        liveSearchTexts  : [search_text, search_text],
        sortColumn       : 'id',
        sortOrder        : 'DESC',
        page_no,
        limit            : 10,
    });
    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Charger Brand List fetch successfully!"],
        data       : result.data,
        total_page : result.totalPage,
        total      : result.total,
    });
});
export const chargerBrandCreate = asyncHandler(async (req, resp) => {
    const { brand_name }      = req.body;
    const { isValid, errors } = validateFields(req.body, { brand_name: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const insert = await insertRecord('charger_brands', ['brand_id', 'brand_name'], [`STB${generateUniqueId({length:6})}`, brand_name]);

    return resp.json({
        status: insert.affectedRows > 0 ? 1 : 0 ,
        code: 200 ,
        message: insert.affectedRows > 0 ? "Charger Brand Added successfully." : "Failed to insert, Please Try Again." ,
    });
});
export const chargerBrandUpdate = asyncHandler(async (req, resp) => {
    const { brand_name, brand_id } = req.body;
    const { isValid, errors }      = validateFields(req.body, { brand_name: ["required"], brand_id: ["required"] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const update = await updateRecord('charger_brands', {brand_name}, ['brand_id'], [brand_id]);

    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0 ,
        code: 200 ,
        message: update.affectedRows > 0 ? "Charger Brand Updated successfully." : "Failed to update, Please Try Again." ,
    });
});

export const allChargerBrand = asyncHandler(async (req, resp) => {
    
    // const firstBrands = [{ value: "Works with all brands", label: "Works with all brands" }] ;

    const [brandData] = await db.execute(`
        SELECT 
            brand_id as value, brand_name as label
        FROM 
            charger_brands 
        Order By brand_name ASC`, 
    []);    
    const [vehicleData] = await db.execute(`
        SELECT 
            make as brand, model
        FROM 
            vehicle_brand_list 
        WHERE 
            status = ?   
        Order By brand ASC`, 
    [1]);   //GROUP By brand
    // const allBrands = [...firstBrands, ...brandData];
    return resp.json({status: 1, code: 200, data: brandData, vehicleData});
});

// EV Charger  
export const eVChargerAdd = asyncHandler(async (req, resp) => {
    try {
        
        const { charger_name, compatible, outputPower, warrantyType, charger_feature, description,
            vehicleSpecification, vehicleBrand="", vehicleModal="", price, usedFor, propertyType
        } = req.body;

        const charger_image     = req.files['charger_image']     ? req.files['charger_image'][0].filename : null;
        const specification_pdf = req.files['specification_pdf'] ? req.files['specification_pdf'][0].filename : null;
        const chargerGallery    = req.files['charger_gallery']?.map(file => file.filename) || [];

        const { isValid, errors } = validateFields({ charger_name, compatible, outputPower, warrantyType, charger_feature, description, charger_image, specification_pdf,
            vehicleSpecification, price, usedFor, propertyType
        }, {
            charger_name      : ["required"],
            compatible        : ["required"],
            outputPower       : ["required"],
            warrantyType      : ["required"], 
            charger_feature   : ["required"],
            description       : ["required"],
            // charger_image     : ["required"],
            // specification_pdf : ["required"],

            vehicleSpecification : ["required"],
            // vehicleBrand         : ["required"],
            // vehicleModal         : ["required"], 
            price                : ["required"],
            usedFor              : ["required"],
            propertyType         : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        //'vehicle_brand', 'vehicle_modal', vehicleBrand, vehicleModal,
        const insert = await insertRecord('ev_charger', [
            'charger_id', 'charger_name', 'compatible', 'outputPower', 'warrantyType', 'charger_feature', 'description', 'charger_image', 'specification_pdf', 
            'vehicle_specification',  'price', 'used_for', 'property_type',
            'status', 'data_type'
        ],[
            'CHI', charger_name, compatible, outputPower, warrantyType, charger_feature, description, charger_image, specification_pdf, vehicleSpecification, price, usedFor, propertyType, 1, 'C'
        ]);
        const lastId     = insert.insertId;
        const charger_id = `CHR-${String(lastId).padStart(4, "0")}`;
        await updateRecord('ev_charger', {charger_id}, ['id'], [lastId]);

        if(chargerGallery.length > 0){
            const values       = chargerGallery.map(filename => [charger_id, filename]);
            const placeholders = values.map(() => '(?, ?)').join(', ');
            await db.execute(`INSERT INTO ev_charger_gallery (charger_id, image_name) VALUES ${placeholders}`, values.flat());
        }
        return resp.json({
            code: 200,
            message: insert.affectedRows > 0 ? 'EV Charger added successfully!' : 'Oops! Something went wrong. Please try again.',
            status: insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
        // return resp.json({ status:0, code: 500, message: 'Something went wrong' });
    }
});

export const eVChargerList = asyncHandler(async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', start_date, end_date} = req.body;

        const params = {
            tableName  : 'ev_charger',
            columns    : `charger_id, charger_name, outputPower, price, status`,
            sortColumn : 'status DESC, id DESC',
            sortOrder  : '',
            page_no,
            liveSearchFields : ['charger_id', 'charger_name' ],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : ['data_type'],
            whereValue       : ['C'],
            whereOperator    : ["="]
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
            message    : ["EV Charger List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });

    } catch (error) {
        console.error('Error fetching station list:', error);
        return resp.json({
            status  : 0,
            code    : 500,
            message : 'Error fetching station list'
        });
    }
});

export const evChargerDetails = asyncHandler(async (req, resp) => {
    try {
        const { charger_id, brand_data = 0 } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            charger_id: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
        const chargerDetails = await queryDB(`
            SELECT 
                charger_id, charger_name, compatible, outputPower, warrantyType, charger_image, charger_feature, description, specification_pdf, status, created_at, vehicle_specification,  price, used_for, property_type,
                ( SELECT COUNT(*) from charger_brands ) as brand_total
            FROM 
                ev_charger 
            WHERE 
                charger_id = ? AND data_type= 'C'`, 
            [charger_id]
        );
        
        let allBrand       = [];
        let brandModelData = []
        if(brand_data) {
            const [brandData] = await db.execute(`
                SELECT 
                    brand_id as value, brand_name as label
                FROM 
                    charger_brands 
                Order By brand_name ASC`, 
            []); 
            const [vehicleData] = await db.execute(`
                SELECT 
                    make as brand, model
                FROM 
                    vehicle_brand_list 
                WHERE 
                    status = ?   
                
                Order By brand ASC`, 
            [1]); 
            allBrand       = brandData;
            brandModelData = vehicleData;
        } 
        else {
            const compatible          =  chargerDetails.compatible.map(item => item.label);
            chargerDetails.compatible = (compatible.length == chargerDetails.brand_total) ? 'Works with all EVs' : compatible.join(", "); 
        }    
        const [gallery] = await db.execute(`SELECT id, image_name FROM ev_charger_gallery WHERE charger_id = ? ORDER BY id DESC `, [charger_id]);
        const imgName = gallery.map(row => row.image_name);
        const imgId   = gallery.map(row => row.id);   
        return resp.json({
            status    : 1,
            code      : 200,
            message   : ["Portable Charger Details fetched successfully!"],
            data      : chargerDetails,
            brandData : allBrand,
            vehicleData : brandModelData,
            
            gallery_data : imgName,
            gallery_id   : imgId,
            base_url     : `${process.env.DIR_UPLOADS}charger-installation/`
        });
    } catch (error) {
        console.error('Error fetching charger details:', error);
        return resp.json({ status: 0, message: 'Error fetching charger details' });
    }
});

export const eVChargerEdit = asyncHandler(async (req, resp) => {
    try {
        const { charger_id, charger_name, compatible, outputPower, warrantyType, charger_feature, description, status,
            vehicleSpecification, vehicleBrand="", vehicleModal="", price, usedFor, propertyType
        } = req.body;
        
        const { isValid, errors } = validateFields({ charger_id, charger_name, compatible, outputPower, warrantyType, charger_feature, description, vehicleSpecification, price, usedFor, propertyType
        }, {
            charger_id      : ["required"],
            charger_name    : ["required"],
            compatible      : ["required"],
            outputPower     : ["required"],
            warrantyType    : ["required"], 
            charger_feature : ["required"],
            description     : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
        const charger = await queryDB(`
            SELECT 
                charger_image, specification_pdf 
            FROM 
                ev_charger 
            WHERE 
                charger_id = ?`, 
        [charger_id]);
        if(!charger) return resp.json({status:0, message: "Charger Data can not edit, or invalid charger Id"});

        const charger_image = req.files && req.files['charger_image'] ? req.files['charger_image'][0].filename : charger.charger_image;
        const specification_pdf = req.files && req.files['specification_pdf'] ? req.files['specification_pdf'][0].filename : charger.specification_pdf;

        const uploadedFiles  = req.files;
        const chargerGallery = uploadedFiles['charger_gallery']?.map(file => file.filename) || [];

        const updates = { 
            charger_name, outputPower, warrantyType, description, charger_image, 
            specification_pdf,  compatible, charger_feature,
            status                : status == 'true' ? 1 : 0, 
            vehicle_specification : vehicleSpecification,   
            // vehicle_brand         : vehicleBrand,
            // vehicle_modal         : vehicleModal,
            price                 : price, 
            used_for              : usedFor, 
            property_type         : propertyType,
        };
        const update = await updateRecord('ev_charger', updates, ['charger_id'], [charger_id]);

        if(req.files && req.files['charger_image']){
            deleteFile('charger-installation', charger.charger_image);
        }
        if(req.files && req.files['specification_pdf']){ 
            deleteFile('charger-installation', charger.specification_pdf); 
        }
        if(chargerGallery.length > 0){
            const values = chargerGallery.map(filename => [charger_id, filename]);
            const placeholders = values.map(() => '(?, ?)').join(', ');
            await db.execute(`INSERT INTO ev_charger_gallery (charger_id, image_name) VALUES ${placeholders}`, values.flat());
        }
        return resp.json({
            code: 200,
            message: update.affectedRows > 0 ? 'EV Charger updated successfully!' : 'Oops! Something went wrong. Please try again.',
            status: update.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        // resp.json({ status:0, code: 500, message: 'Something went wrong' });
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
    }
});

// Accessroies Func
export const AccessoriesAdd = asyncHandler(async (req, resp) => {
    try {
        
        const { charger_name, compatible, outputPower='', warrantyType='', charger_feature, description='',
            vehicleSpecification='', price, chargerType='', connectorType=''
        } = req.body;

        const charger_image     = req.files['charger_image']     ? req.files['charger_image'][0].filename : null;
        const specification_pdf = req.files['specification_pdf'] ? req.files['specification_pdf'][0].filename : null;
        const chargerGallery    = req.files['charger_gallery']?.map(file => file.filename) || [];

        const { isValid, errors } = validateFields({ charger_name, compatible, charger_feature, price },
        {
            charger_name     : ["required"],
            compatible       : ["required"],
            charger_feature  : ["required"],
            price            : ["required"],
            // charger_image    : ["required"],
            // outputPower       : ["required"],
            // warrantyType      : ["required"], 
            // description       : ["required"],
            // specification_pdf : ["required"],
            // vehicleSpecification : ["required"],
            // vehicleBrand         : ["required"],
            // vehicleModal         : ["required"], 
            // chargerType         : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        if (!req.files || !req.files['charger_image']) return resp.json({ message: "Cover Image is required", status: 0, code: 405, error: true });

        // 'vehicle_brand', 'vehicle_modal',  vehicleBrand, vehicleModal,
        const insert = await insertRecord('ev_charger', [
            'charger_id', 'charger_name', 'compatible', 'outputPower', 'warrantyType', 'charger_feature', 'description', 'charger_image', 'specification_pdf', 'vehicle_specification', 'price', 'charger_type', 'connector_type', 'status', 'data_type'
        ],[
            'CHA', charger_name, compatible, outputPower, warrantyType, charger_feature, description, charger_image, specification_pdf, vehicleSpecification, price, chargerType, connectorType, 1, 'A', 
        ]);
        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add public charger! Please try again after some time."});

        const lastId     = insert.insertId;
        const charger_id = `CHA-${String(lastId).padStart(4, "0")}`;
        await updateRecord('ev_charger', {charger_id}, ['id'], [lastId]);

        if(chargerGallery.length > 0){
            const values       = chargerGallery.map(filename => [charger_id, filename]);
            const placeholders = values.map(() => '(?, ?)').join(', ');
            await db.execute(`INSERT INTO ev_charger_gallery (charger_id, image_name) VALUES ${placeholders}`, values.flat());
        }
        return resp.json({
            code: 200,
            message: insert.affectedRows > 0 ? 'Accessories added successfully!' : 'Oops! Something went wrong. Please try again.',
            status: insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.log('Something went wrong:', error);
        console.error('Something went wrong:', error);
        // resp.json({ status:0, code: 500, message: 'Something went wrong' });
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
    }
});

export const AccessoriesList = asyncHandler(async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', start_date, end_date} = req.body;
        
        const params = {
            tableName  : 'ev_charger',
            columns    : `charger_id, charger_name, outputPower, price, charger_type, status`,
            sortColumn : 'status DESC, id DESC',
            sortOrder  : '',
            page_no,
            liveSearchFields : ['charger_id', 'charger_name' ],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : ['data_type'],  //, 'status'
            whereValue       : ['A'],
            whereOperator    : ["=" ]
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
            message    : ["EV Accessories List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });

    } catch (error) {
        console.error('Error fetching list:', error);
        return resp.json({
            status  : 0,
            code    : 500,
            message : 'Error fetching list'
        });
    }
});

export const AccessoriesDetails = asyncHandler(async (req, resp) => {
    try {
        
        const { charger_id, brand_data = 0 } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            charger_id: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        // vehicle_brand, vehicle_modal,
        const chargerDetails = await queryDB(`
            SELECT 
                charger_id, charger_name, compatible, outputPower, warrantyType, charger_image, charger_feature, description, specification_pdf, status, created_at, vehicle_specification, price, charger_type, connector_type,
                ( SELECT COUNT(*) from charger_brands ) as brand_total
            FROM 
                ev_charger 
            WHERE 
                charger_id = ? AND data_type= ?`, 
            [charger_id, 'A' ]
        );
        
        let allBrand       = [];
        let brandModelData = []
        if(brand_data) {
            const [brandData] = await db.execute(`
                SELECT 
                    brand_id as value, brand_name as label
                FROM 
                    charger_brands 
                Order By brand_name ASC`, 
            []); 
            const [vehicleData] = await db.execute(`
                SELECT 
                    make as brand, model
                FROM 
                    vehicle_brand_list 
                WHERE 
                    status = ?   
                
                Order By brand ASC`, 
            [1]); 
            allBrand       = brandData;
            brandModelData = vehicleData;
        } 
        else {
            const compatible          = chargerDetails.compatible.map(item => item.label);
            chargerDetails.compatible = (compatible.length == chargerDetails.brand_total) ? 'Works with all EVs' : compatible.join(", "); 
        }

        const [gallery] = await db.execute(`SELECT id, image_name FROM ev_charger_gallery WHERE charger_id = ? ORDER BY id DESC `, [charger_id]);
        const imgName = gallery.map(row => row.image_name);
        const imgId   = gallery.map(row => row.id);

        return resp.json({
            status    : 1,
            code      : 200,
            message   : ["Accessories Details fetched successfully!"],
            data      : chargerDetails,
            brandData : allBrand,
            vehicleData : brandModelData,
             
            gallery_data : imgName,
            gallery_id   : imgId,
            base_url     : `${process.env.DIR_UPLOADS}charger-installation/`
        });
    } catch (error) {
        console.error('Error fetching Accessories details:', error);
        return resp.json({ status: 0, message: 'Error fetching Accessories details' });
    }
});

export const AccessoriesEdit = asyncHandler(async (req, resp) => {
    try {
        const { charger_id, charger_name, compatible, outputPower='', warrantyType='', charger_feature, description='', status,
            vehicleSpecification='', vehicleBrand="", vehicleModal="", price, chargerType='', connectorType=''
        } = req.body;
        
        const { isValid, errors } = validateFields({ 
            charger_id, charger_name, compatible, charger_feature,  price,
        }, {
            charger_id      : ["required"],
            charger_name    : ["required"],
            compatible      : ["required"],
            charger_feature : ["required"],
            price           : ["required"],
            // charger_image   : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
        const charger = await queryDB(`
            SELECT 
                charger_image, specification_pdf 
            FROM 
                ev_charger 
            WHERE 
                charger_id = ? AND data_type= ?`, 
        [charger_id, 'A']);
        if(!charger) return resp.json({status:0, message: "Charger Data can not edit, or invalid charger Id"});

        const charger_image = req.files && req.files['charger_image'] ? req.files['charger_image'][0].filename : charger.charger_image;
        const specification_pdf = req.files && req.files['specification_pdf'] ? req.files['specification_pdf'][0].filename : charger.specification_pdf;

        const uploadedFiles = req.files;
        const chargerGallery = uploadedFiles['charger_gallery']?.map(file => file.filename) || [];

        const updates = { charger_name, outputPower, warrantyType, description, charger_image, 
            specification_pdf, compatible, charger_feature,
            status                : status == 'true' ? 1 : 0, 
            vehicle_specification : vehicleSpecification,   
            // vehicle_brand         : vehicleBrand,
            // vehicle_modal         : vehicleModal,
            price                 : price, 
            charger_type          : chargerType, 
            connector_type        : connectorType,
        };
        const update = await updateRecord('ev_charger', updates, ['charger_id'], [charger_id]);

        if(req.files && req.files['charger_image']){
            deleteFile('charger-installation', charger.charger_image);
        }
        if(req.files && req.files['specification_pdf']){ 
            deleteFile('charger-installation', charger.specification_pdf); 
        }
        if(chargerGallery.length > 0){
            const values = chargerGallery.map(filename => [charger_id, filename]);
            const placeholders = values.map(() => '(?, ?)').join(', ');
            await db.execute(`INSERT INTO ev_charger_gallery (charger_id, image_name) VALUES ${placeholders}`, values.flat());
        }
        return resp.json({
            code: 200,
            message: update.affectedRows > 0 ? 'Accessories updated successfully!' : 'Oops! Something went wrong. Please try again.',
            status: update.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.log(error);
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
    }
});

export const deleteEVChargerGallery = asyncHandler(async (req, resp) => {
    const { gallery_id } = req.body;
    if(!gallery_id) return resp.json({status:0, message: "Gallery Id is required"});

    const galleryData = await queryDB(`SELECT image_name FROM ev_charger_gallery WHERE id = ? LIMIT 1`, [gallery_id]);
    
    if(galleryData){
        deleteFile('charger-installation', galleryData.image_name);
        await db.execute('DELETE FROM ev_charger_gallery WHERE id = ?', [gallery_id]);
    }
    return resp.json({status: 1, code: 200,  message: "Gallery image deleted successfully"});
});

// Purchase history Func
export const PurchaseHistoryAdd = asyncHandler(async (req, resp) => {
    try {
        
        const { customer_name, customer_email, customer_mobile, customer_address=null, product_name, output_Power=null, price=0, type_of_service, purchase_date=null, warranty_expiry_date=null, installation_date=null } = req.body;

        const purchase_pdf = req.files['purchase_invoice_pdf'] ? req.files['purchase_invoice_pdf'][0].filename : null;

        const installation_pdf = req.files['installation_invoice_pdf'] ? req.files['installation_invoice_pdf'][0].filename : null;

        const completion_pdf = req.files['completion_certificate_pdf'] ? req.files['completion_certificate_pdf'][0].filename : null;
        
        const { isValid, errors } = validateFields({ customer_name, customer_email, customer_mobile, product_name, type_of_service },
        {
            customer_name        : ["required"],
            customer_email       : ["required"],
            customer_mobile      : ["required"],
            // customer_address     : ["required"],
            product_name         : ["required"],
            // output_Power         : ["required"],
            // price                : ["required"], 
            type_of_service      : ["required"],
            // purchase_date        : ["required"],
            // warranty_expiry_date : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // if (!req.files || !req.files['charger_image']) return resp.json({ message: "Cover Image is required", status: 0, code: 405, error: true });

        const purchaseDate    = purchase_date ? moment(purchase_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null;
        const warrantyExpDate = warranty_expiry_date ? moment(warranty_expiry_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null;
 
        const installationDate = installation_date ? moment(installation_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null; 

        const insert = await insertRecord('purchase_history', [
            'purchase_id', 'customer_name', 'customer_email', 'customer_mobile', 'customer_address', 'product_name', 'output_Power', 'price', 'type_of_service', 
            'purchase_date', 'warranty_expiry_date', 'installation_date', 
            'purchase_invoice_pdf', 'installation_invoice_pdf', 'completion_certificate_pdf'
        ],[
            'PRH', customer_name, customer_email, customer_mobile, customer_address, 
            product_name, output_Power, price, type_of_service, 
            purchaseDate, warrantyExpDate, installationDate,
            purchase_pdf, installation_pdf, completion_pdf
        ]);
        if(insert.affectedRows == 0) return resp.json({status:0, message: "Failed to add public charger! Please try again after some time."});

        const lastId      = insert.insertId;
        const purchase_id = `PRH-${String(lastId).padStart(4, "0")}`;
        await updateRecord('purchase_history', {purchase_id}, ['id'], [lastId]);

        return resp.json({
            code: 200,
            message: insert.affectedRows > 0 ? 'Purchase details added successfully!' : 'Oops! Something went wrong. Please try again.',
            status: insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.log('Something went wrong:', error);
        // resp.json({ status:0, code: 500, message: 'Something went wrong' });
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
    }
});

export const PurchaseHistoryList = asyncHandler(async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', start_date, end_date} = req.body;
        
        const params = {
            tableName  : 'purchase_history',
            columns    : `purchase_date, customer_name, customer_mobile, product_name, type_of_service, purchase_id`,
            sortColumn : 'id DESC',
            sortOrder  : '',
            page_no,
            liveSearchFields : ['customer_mobile', 'product_name' ],
            liveSearchTexts  : [search_text, search_text],
            limit            : 10,
            whereField       : [],
            whereValue       : [],
            whereOperator    : []
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

            params.whereField.push('purchase_date', 'purchase_date');
            params.whereValue.push(start, end);
            params.whereOperator.push('>=', '<=');
        }
        const result = await getPaginatedData(params);
        
        return resp.json({
            status     : 1,
            message    : ["Purchase History List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });

    } catch (error) {
        console.error('Error fetching list:', error);
        return resp.json({
            status  : 0,
            code    : 500,
            message : 'Error fetching list'
        });
    }
});

export const PurchaseHistoryDetails = asyncHandler(async (req, resp) => {
    try {
        const { purchase_id } = req.body;
        const { isValid, errors } = validateFields(req.body, { purchase_id : ["required"] });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
         
        const purchaseDetails = await queryDB(`
            SELECT 
                purchase_id, customer_name, customer_email, customer_mobile, customer_address, 
                product_name, output_Power, price, type_of_service, purchase_invoice_pdf, installation_invoice_pdf, completion_certificate_pdf, created_at,
                ${formatDateInQuery(['purchase_date'])}, ${formatDateInQuery(['warranty_expiry_date'])}, ${formatDateInQuery(['installation_date'])}
            FROM 
                purchase_history 
            WHERE 
                purchase_id = ?`, 
            [ purchase_id ]
        );
        const outputPower           = purchaseDetails.output_Power.map(item => item.label);
        purchaseDetails.outputPower = outputPower.join(", "); 

        purchaseDetails.typeOfService = Array.isArray(purchaseDetails.type_of_service) ? purchaseDetails.type_of_service.map(o => o.label).join(", ") : purchaseDetails.type_of_service.label || ''
        
        return resp.json({
            status    : 1,
            code      : 200,
            message   : ["Purchase history Details fetched successfully!"],
            data      : purchaseDetails,
            base_url  : `${process.env.DIR_UPLOADS}charger-installation/`
        });
    } catch (error) {
        console.error('Error fetching Purchase details:', error);
        return resp.json({ status: 0, message: 'Error fetching Accessories details' });
    }
});

export const PurchaseHistoryEdit = asyncHandler(async (req, resp) => {
    try {
        const { purchase_id, customer_name, customer_email, customer_mobile, customer_address=null, product_name, output_Power=null, price=0, type_of_service, purchase_date=null, warranty_expiry_date=null, installation_date=null 
        } = req.body;
        
        const { isValid, errors } = validateFields({ 
            purchase_id, customer_name, customer_email, customer_mobile, product_name, type_of_service
        }, {
            purchase_id      : ["required"],
            customer_name    : ["required"],
            customer_email   : ["required"],
            customer_mobile  : ["required"],
            product_name     : ["required"],
            type_of_service  : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
        const purchaseData = await queryDB(`
            SELECT 
                purchase_invoice_pdf, installation_invoice_pdf, completion_certificate_pdf 
            FROM 
                purchase_history 
            WHERE 
                purchase_id = ?`, 
        [ purchase_id ]);
        if(!purchaseData) return resp.json({status:0, message: "Purchase Data can not edit, or invalid purchase Id"});

       const purchase_pdf = req.files['purchase_invoice_pdf'] ? req.files['purchase_invoice_pdf'][0].filename : purchaseData.purchase_invoice_pdf;

        const installation_pdf = req.files['installation_invoice_pdf'] ? req.files['installation_invoice_pdf'][0].filename : purchaseData.installation_invoice_pdf;

        const completion_pdf = req.files['completion_certificate_pdf'] ? req.files['completion_certificate_pdf'][0].filename : purchaseData.completion_certificate_pdf;

        const purchaseDate    = purchase_date ? moment(purchase_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null;
        const warrantyExpDate = warranty_expiry_date ? moment(warranty_expiry_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null;
 
        const installationDate = installation_date ? moment(installation_date, "DD-MM-YYYY").format("YYYY-MM-DD") : null; 
 
        const updates = { 
            customer_name, customer_email, customer_mobile, customer_address, 
            product_name, output_Power, price, type_of_service, 
        
            purchase_date              : purchaseDate,
            warranty_expiry_date       : warrantyExpDate,
            installation_date          : installationDate,
            purchase_invoice_pdf       : purchase_pdf,
            installation_invoice_pdf   : installation_pdf, 
            completion_certificate_pdf : completion_pdf,
        };
        const update = await updateRecord('purchase_history', updates, ['purchase_id'], [purchase_id]);

        if(req.files && req.files['purchase_invoice_pdf']){
            deleteFile('charger-installation', purchaseData.purchase_invoice_pdf);
        }
        if(req.files && req.files['installation_invoice_pdf']){ 
            deleteFile('charger-installation', purchaseData.installation_invoice_pdf); 
        }
        if(req.files && req.files['completion_certificate_pdf']){ 
            deleteFile('charger-installation', purchaseData.completion_certificate_pdf); 
        }
        return resp.json({
            code: 200,
            message: update.affectedRows > 0 ? 'Purchase history updated successfully!' : 'Oops! Something went wrong. Please try again.',
            status: update.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.log(error);
        tryCatchErrorHandler(req.originalUrl, error, resp, 'Oops! There is something went wrong!');
    }
});

