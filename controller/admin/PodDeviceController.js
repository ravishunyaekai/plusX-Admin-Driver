import db from '../../config/db.js';
import dotenv from 'dotenv';
import { getPaginatedData, insertRecord, updateRecord } from '../../dbUtils.js';
import validateFields from "../../validation.js";
import generateUniqueId from 'generate-unique-id';
import { formatDateInQuery, formatDateTimeInQuery } from '../../utils.js';
dotenv.config();

// POD Device Start
export const podDeviceList = async (req, resp) => {
    try {
        const {page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'pod_devices',
            columns          : `pod_id, pod_name, device_id, design_model, inverter, charger, ${formatDateInQuery(['date_of_manufacturing'])}, status, ${formatDateTimeInQuery(['created_at'])}, 
                (SELECT AVG(percentage) FROM pod_device_battery as pb where pb.pod_id = pod_devices.pod_id) AS avgBattery`,
            sortColumn       : 'pod_name',
            sortOrder        : 'ASC',
            page_no,
            limit            : 10,
            liveSearchFields : ['pod_id', 'pod_name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : 'status',
            whereValue       : 1
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Device List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};

export const podDeviceDetails = async (req, resp) => {
    try {
        const { pod_id, } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            pod_id : ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [chargerDetails] = await db.execute(`
            SELECT 
                pod_id, pod_name, device_id, design_model, inverter, charger, ${formatDateInQuery(['date_of_manufacturing'])}, status, ${formatDateTimeInQuery(['created_at'])}, temp1, temp2
            FROM 
                pod_devices 
            WHERE 
                pod_id = ?`, 
            [pod_id]
        );
        const [batteryData] = await db.execute(`
            SELECT 
                id, battery_id as batteryId, capacity, cells, temp1, temp2, temp3, current, voltage, percentage, charge_cycle, ${formatDateTimeInQuery(['updated_at'])}
            FROM 
                pod_device_battery 
            WHERE 
                pod_id = ?`, 
            [pod_id]
        );

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["POD Device Details fetched successfully!"],
            data    : chargerDetails[0],
            batteryData 
        });
    } catch (error) {
        console.error('Error fetching device details:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching device details' });
    }
};

export const addPodDevice = async (req, resp) => {
    try {
        const { podId, podName, deviceId, device_model, charger, inverter, date_of_manufacturing, status = 1, battery_ids, capacities } = req.body;
        // Validation
        const { isValid, errors } = validateFields({ 
            podId, podName, deviceId, device_model, charger, inverter, date_of_manufacturing, battery_ids, capacities
        }, {
            podId                 : ["required"],
            podName               : ["required"],
            deviceId              : ["required"],
            device_model          : ["required"],
            charger               : ["required"],
            inverter              : ["required"],
            date_of_manufacturing : ["required"],
            battery_ids           : ["required"],
            capacities            : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });

        if ( !Array.isArray( battery_ids ) || !Array.isArray( capacities )  ) {
            return resp.json({ status: 0, code: 422, message: 'Battery data must be in array format.' });
        }
        if ( battery_ids.length !== capacities.length ) {
            return resp.json({ status: 0, code: 422, message: 'All input arrays must have the same length.' });
        }
        const [[isExist]] = await db.execute(`
            SELECT 
                (SELECT COUNT(id) FROM pod_devices where device_id = ? ) AS check_device,
                (SELECT COUNT(id) FROM pod_devices where pod_id = ? ) AS check_pod
            FROM 
                users
            LIMIT 1
        `, [deviceId, podId]);

        if( isExist.check_device ) return resp.json({ status : 0, code : 422, message : 'Device Id is already registered.'});
        if( isExist.check_pod ) return resp.json({ status : 0, code : 422, message : 'POD Id is already registered.'});
        
        let date_manufacturing    = date_of_manufacturing.split("-");
        const dateOfManufacturing = date_manufacturing[2] +'-'+ date_manufacturing[1] +'-'+date_manufacturing[0];
        
        const insert = await insertRecord('pod_devices', [
            'pod_id', 'pod_name', 'device_id', 'design_model', 'charger', 'inverter', 'date_of_manufacturing', 'status'
        ],[
            podId, podName, deviceId, device_model, charger, inverter, dateOfManufacturing, status
        ]);

        const values = []; const placeholders = [];
        for (let i = 0; i < battery_ids.length; i++) {            
           
            values.push(podId, deviceId, battery_ids[i], capacities[i], 1);
            placeholders.push('(?, ?, ?, ?, ?)');
        }   
        const query = `INSERT INTO pod_device_battery (pod_id, device_id, battery_id, capacity, status) VALUES ${placeholders.join(', ')}`;
        await db.execute(query, values);

        return resp.json({
            code    : 200,
            message : insert.affectedRows > 0 ? ['POD Device added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status : insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};

export const editPodDevice = async (req, resp) => {
    try {
        const { podId, podName, deviceId, device_model, charger, inverter, date_of_manufacturing, battery_ids, capacities } = req.body;
       
        const { isValid, errors } = validateFields({ 
            podId, podName, deviceId, device_model, charger, inverter, date_of_manufacturing
        }, {
            podId                 : ["required"],
            podName               : ["required"],
            deviceId              : ["required"],
            device_model          : ["required"],
            charger               : ["required"],
            inverter              : ["required"],
            date_of_manufacturing : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });

        if ( !Array.isArray( battery_ids ) || !Array.isArray( capacities )  ) {
            return resp.json({ status: 0, code: 422, message: 'Battery data must be in array format.' });
        }
        if ( battery_ids.length !== capacities.length ) {
            return resp.json({ status: 0, code: 422, message: 'All input arrays must have the same length.' });
        }

        const [[isExist]] = await db.execute(`
            SELECT 
                (SELECT COUNT(id) FROM pod_devices where device_id = ? and pod_id != ? ) AS check_device,
                (SELECT COUNT(id) FROM pod_devices as pd1 where pd1.pod_id = ? and pd1.id != pd.id) AS check_pod
            FROM 
                pod_devices as pd
            WHERE 
                pd.pod_id = ? 
            LIMIT 1
        `, [deviceId, podId, podId, podId]);

        const err = [];
        if( isExist.length == 0 ) return resp.json({ status : 0, code : 422, message : 'POD Id is not registered.'});
        if( isExist.check_device ) return resp.json({ status : 0, code : 422, message : 'Device Id is already registered.'});
        if( isExist.check_pod ) return resp.json({ status : 0, code : 422, message : 'POD Id is already registered.'});

        let date_manufacturing = date_of_manufacturing.split("-");
        const dateOfManufacturing = date_manufacturing[2] +'-'+ date_manufacturing[1] +'-'+date_manufacturing[0];

        const updates = { 
            device_id    : deviceId,
            pod_name     : podName,
            design_model : device_model,
            charger,
            inverter,
            date_of_manufacturing : dateOfManufacturing,
        };
        const update = await updateRecord('pod_devices', updates, ['pod_id'], [podId]);
        
        let errMsg = [];
        for (let i = 0; i < battery_ids.length; i++) {            
           
            const [isExist] = await db.execute(`
                SELECT 
                    id 
                FROM 
                    pod_device_battery
                WHERE 
                    battery_id = ? and pod_id = ? 
                LIMIT 1
            `, [battery_ids[i], podId]);
            if( isExist.length > 0 ) {
                
                const [updateResult] = await db.execute(`UPDATE pod_device_battery SET capacity = ? 
                    WHERE battery_id = ? AND pod_id = ?`, [ capacities[i], battery_ids[i], podId ]
                );
                if (updateResult.affectedRows === 0)
                    errMsg.push(`Failed to update ${capacities[i]} for battery_ids ${battery_ids[i]}.`);

            } else {
               
                const [insertResult] = await db.execute(`INSERT INTO pod_device_battery (pod_id, device_id, battery_id, capacity, status)  VALUES (?, ?, ?, ?, ?)`,
                    [ podId, deviceId, battery_ids[i], capacities[i], 1 ]
                );
                if (insertResult.affectedRows === 0)
                    errMsg.push(`Failed to add ${capacities[i]} for slot_date ${battery_ids[i]}.`);
            }
        }   
        if (errMsg.length > 0) {
            return resp.json({ status: 0, code: 400, message: errMsg.join(" | ") });
        }
        return resp.json({
            status  : update.affectedRows > 0 ? 1 : 0,
            code    : 200,
            message : update.affectedRows > 0 ? ['POD Device updated successfully!'] : ['Oops! Something went wrong. Please try again.'],
        });

    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};

export const deletePodDevice = async (req, resp) => {
    try {
        const { deviceId }        = req.body; 
        const { isValid, errors } = validateFields(req.body, {
            deviceId : ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [del] = await db.execute(`DELETE FROM pod_devices WHERE device_id = ?`, [deviceId]);
        return resp.json({
            code    : 200,
            message : del.affectedRows > 0 ? ['POD Device deleted successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status: del.affectedRows > 0 ? 1 : 0
        });
    } catch (err) {
        console.error('Error deleting portable charger', err);
        return resp.json({ status: 0, message: 'Error deleting portable charger' });
    }
};

export const AllpodDevice = async (req, resp) => {
    try {
        
        const [allDevice] = await db.execute(`
            SELECT pod_id as value, pod_name as label FROM pod_devices WHERE status = 1` 
        );
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["All POD Device fetch successfully!"],
            data    : allDevice,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};
// POD Device End

// Brand Start
export const addPodBrand = async (req, resp) => {
    try {
        const { brand_name, device_id, description, start_date, end_date } = req.body;
        const brand_image = req.files && req.files['brand_image'] ? req.files['brand_image'][0].filename : null;

        // Validation
        const { isValid, errors } = validateFields({ 
            brand_name, device_id, description, start_date, end_date, brand_image
        }, {
            brand_name  : ["required"],
            device_id   : ["required"],
            description : ["required"],
            brand_image : ["required"], 
            start_date  : ["required"],
            end_date    : ["required"]
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    
        let startt_date = start_date.split("-");
        const startDate = startt_date[2] +'-'+ startt_date[1] +'-'+startt_date[0];

        let endd_date = end_date.split("-");
        const endDate = endd_date[2] +'-'+ endd_date[1] +'-'+endd_date[0];

        const insert = await insertRecord('pod_brand_history', [
            'device_id', 'brand_name', 'description', 'start_date', 'end_date', 'brand_image'
        ],[
            device_id, brand_name, description, startDate, endDate, brand_image
        ]);
        return resp.json({
            code    : 200,
            message : insert.affectedRows > 0 ? ['POD Brand added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status : insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};
export const podBrandList = async (req, resp) => {
    try {
        const { page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'pod_brand_history',
            columns          : 'device_id, brand_name, start_date, end_date, brand_image',
            sortColumn       : 'created_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,
            liveSearchFields : ['device_id', 'brand_name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : 'status',
            whereValue       : 1
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Brand List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
            base_url   : `${process.env.DIR_UPLOADS}pod-brand-images/`,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};
export const deviceBrandList = async (req, resp) => {
    try {
        const { podId, page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {page_no: ["required"], podId: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'pod_brand_history',
            columns          : 'brand_name, start_date, end_date, brand_image, description',
            sortColumn       : 'created_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,
            liveSearchFields : ['device_id', 'brand_name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : ['device_id'],
            whereValue       : [podId]
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Brand List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
            base_url   : `${process.env.DIR_UPLOADS}pod-brand-images/`,
        });
    } catch (error) {
        console.error('Error fetching device brand list:', error);
        resp.status(500).json({ message: 'Error fetching device brand lists' });
    }
};
// Brand End

// POD Area Start
export const podAreaList = async (req, resp) => {
    try {
        const {page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'pod_area_list',
            columns          : `area_id, area_name, ${formatDateTimeInQuery(['created_at'])}, status`,
            sortColumn       : 'created_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,
            liveSearchFields : ['area_id', 'area_name'],
            liveSearchTexts  : [search_text, search_text],
            whereField       : 'status',
            whereValue       : 1
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Area List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};
export const addPodArea = async (req, resp) => {
    try {
        const { areaName, latitude, longitude, status = 1 } = req.body;
        
        // Validation
        const { isValid, errors } = validateFields({ 
            areaName, latitude, longitude
        }, {
            areaName  : ["required"],
            latitude  : ["required"],
            longitude : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });
    
        const areaId = `Area-${generateUniqueId({ length:6 })}`;
        const insert = await insertRecord('pod_area_list', [
            'area_id', 'area_name', 'latitude', 'longitude', 'status'
        ],[
            areaId, areaName, latitude, longitude, status
        ]);
        return resp.json({
            code    : 200,
            message : insert.affectedRows > 0 ? ['Area added successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status : insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};
export const podAreaDetails = async (req, resp) => {
    try {
        const { area_id, } = req.body;

        const { isValid, errors } = validateFields(req.body, {
            area_id: ["required"]
        });

        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
        
        const [areaDetails] = await db.execute(`
            SELECT 
                area_id, area_name, latitude, longitude, status 
            FROM 
                pod_area_list 
            WHERE 
                area_id = ?`, 
            [area_id]
        );
        // console.log(areaDetails[0])
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["POD Area Details fetched successfully!"],
            data    : areaDetails[0],
        });
    } catch (error) {
        console.error('Error fetching device details:', error);
        return resp.status(500).json({ status: 0, message: 'Error fetching device details' });
    }
};
export const editPodArea = async (req, resp) => {
    try {
        const { areaId, areaName, latitude, longitude, status } = req.body;
       
        const { isValid, errors } = validateFields({ 
            areaId, areaName, latitude, longitude
        }, {
            areaId    : ["required"],
            areaName  : ["required"],
            latitude  : ["required"],
            longitude : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });
        const [[isExist]] = await db.execute(`
            SELECT 
                COUNT(id)
            FROM 
                pod_area_list 
            WHERE 
                area_id = ? 
            LIMIT 1
        `, [areaId]);

        if( isExist.length == 0 ) return resp.json({ status : 0, code : 422, message : 'Area Id is not valid.'});

        const updates = { 
            area_name : areaName,
            latitude  : latitude,
            longitude : longitude,
            status,
        };
        const update = await updateRecord('pod_area_list', updates, ['area_id'], [areaId]);
        return resp.json({
            status  : update.affectedRows > 0 ? 1 : 0,
            code    : 200,
            message : update.affectedRows > 0 ? ['POD Area updated successfully!'] : ['Oops! Something went wrong. Please try again.'],
        });

    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};

export const AllpodArea = async (req, resp) => {
    try {
        
        const [allDevice] = await db.execute(`
            SELECT area_id, area_name, latitude, longitude FROM pod_area_list WHERE status = 1` 
        );
        return resp.json({
            status  : 1,
            code    : 200,
            message : ["All POD Area fetch successfully!"],
            data    : allDevice,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};

export const assignPodDeviceArea = async (req, resp) => {
    try {
        const { podId, selectedArea } = req.body;
        // Validation
        const { isValid, errors } = validateFields({ 
            podId, selectedArea
        }, {
            podId        : ["required"],
            selectedArea : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });
    
        const [[isExist]] = await db.execute(`
            SELECT 
                (SELECT COUNT(id) FROM pod_devices where pod_id = ? ) AS check_device,
                (SELECT COUNT(id) FROM pod_area_list where area_id = ? ) AS check_area
            FROM 
                users
            LIMIT 1
        `, [podId, selectedArea]);

        const err = [];
        if( isExist.check_device == 0 ) err.push('POD Id is not registered.');
        if( isExist.check_area == 0 ) err.push('Area Id is not registered.');
        if(err.length > 0) return resp.json({ status : 0, code : 422, message : err });

        
        const insert = await insertRecord('pod_assign_area', [
            'area_id', 'device_id'
        ],[
            selectedArea, podId
        ]);
        return resp.json({
            code    : 200,
            message : insert.affectedRows > 0 ? ['POD Area Assign successfully!'] : ['Oops! Something went wrong. Please try again.'],
            status : insert.affectedRows > 0 ? 1 : 0
        });
    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};
export const podAreaAssignList = async (req, resp) => {
    try {
        const { podId, page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {podId: ["required"], page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'pod_assign_area as paa',
            columns          : `paa.area_id, ${formatDateTimeInQuery(['paa.created_at'])}, (select area_name from pod_area_list as ar where ar.area_id = paa.area_id) as area_name`,
            sortColumn       : 'paa.created_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,
            liveSearchFields : ['area_name' ],
            liveSearchTexts  : [search_text, search_text],
            whereField       : ['paa.device_id'],
            whereValue       : [podId]
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Assign Area List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};

export const podDeviceStatusChange = async (req, resp) => {
    try {
        const { podId, deviceStatus } = req.body;
        const { isValid, errors } = validateFields({ 
            podId, deviceStatus 
        }, {
            podId        : ["required"],
            deviceStatus : ["required"]
        });
        if (!isValid) return resp.json({ status : 0, code : 422, message : errors });
        const [[isExist]] = await db.execute(`
            SELECT 
                pod_id
            FROM 
                pod_devices as pd
            WHERE 
                pd.pod_id = ? 
            LIMIT 1
        `, [ podId]);

        if( isExist.length == 0 ) return resp.json({ status : 0, code : 422, message : 'POD Id is not registered.'});

        const updates = { 
            status : deviceStatus,
        };
        const update = await updateRecord('pod_devices', updates, ['pod_id'], [podId]);
        return resp.json({
            status  : update.affectedRows > 0 ? 1 : 0,
            code    : 200,
            message : update.affectedRows > 0 ? ['POD Device status updated successfully!'] : ['Oops! Something went wrong. Please try again.'],
        });

    } catch (error) {
        console.error('Something went wrong:', error);
        resp.status(500).json({ message: 'Something went wrong' });
    }
};

export const podAreaInputList = async (req, resp) => {
    try {
        const { podId, page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {podId: ["required"], page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'portable_charger_booking as pcb',
            columns          : `pcb.booking_id, pcb.start_charging_level, pcb.end_charging_level, (select created_at from portable_charger_history as pch where pch.booking_id = pcb.booking_id and pch.order_status="CC") as date_time`,
            sortColumn       : 'pcb.updated_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,
            liveSearchFields : [],
            liveSearchTexts  : [],
            whereField       : ['pcb.pod_id'],
            whereValue       : [podId]
        });

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Input History List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};
export const podAreaBookingList = async (req, resp) => {
    try {
        const { podId, page_no, search_text = '' } = req.body;
        const { isValid, errors } = validateFields(req.body, {podId: ["required"], page_no: ["required"]});
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const result = await getPaginatedData({
            tableName        : 'portable_charger_booking as pcb',
            columns          : `pcb.booking_id, pcb.start_charging_level, pcb.end_charging_level, 
            (select ${formatDateTimeInQuery(['created_at'])} from portable_charger_history as pch where pch.booking_id = pcb.booking_id and pch.order_status="CS") as start_time, (select ${formatDateTimeInQuery(['created_at'])} from portable_charger_history as pch where pch.booking_id = pcb.booking_id and pch.order_status="CC") as end_time, (select pod_data from portable_charger_history as pch where pch.booking_id = pcb.booking_id and pch.order_status="CC") as pod_data`,
            sortColumn       : 'pcb.updated_at',
            sortOrder        : 'DESC',
            page_no,
            limit            : 10,   // ${formatDateTimeInQuery(['created_at'])}
            liveSearchFields : [], 
            liveSearchTexts  : [],
            whereField       : ['pcb.pod_id', 'pcb.status'],  
            whereValue       : [podId, 'RO']
        });
        console.log(result.data)
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["POD Booking History List fetch successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching device list:', error);
        resp.status(500).json({ message: 'Error fetching device lists' });
    }
};