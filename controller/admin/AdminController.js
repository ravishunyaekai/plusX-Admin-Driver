import db from '../../config/db.js';
import dotenv from 'dotenv';
import validateFields from "../../validation.js";
import { insertRecord,  getPaginatedData, queryDB, updateRecord } from '../../dbUtils.js';
import { asyncHandler, mergeParam, formatDateTimeInQuery } from '../../utils.js';
import moment from 'moment';
dotenv.config();

export const getDashboardData = async (req, resp) => {
    try {
        const today         = new Date();
        const formattedDate = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
        
        const givenDateTime    = formattedDate+' 00:00:01'; // Replace with your datetime string
        const modifiedDateTime = moment(givenDateTime).subtract(4, 'hours'); // Subtract 4 hours
        const currentDate      = modifiedDateTime.format('YYYY-MM-DD HH:mm:ss');
        
        const [counts] = await db.execute(`SELECT 
            (SELECT COUNT(*) FROM riders WHERE created_at >= "${currentDate}") AS total_rider,
            (SELECT COUNT(*) FROM rsa) AS total_rsa,
            (SELECT COUNT(*) FROM portable_charger_booking WHERE created_at >= "${currentDate}" and status != "PNR") AS total_charger_booking,
            (SELECT COUNT(*) FROM charging_service WHERE created_at >= "${currentDate}" and order_status != "PNR") AS total_charging_service,
            (SELECT COUNT(*) FROM road_assistance WHERE created_at >= "${currentDate}" and order_status != "PNR") AS total_road_assistance,
            (SELECT COUNT(*) FROM charging_installation_service WHERE created_at >= "${currentDate}") AS total_installation,
            (SELECT COUNT(*) FROM public_charging_station_list) AS total_station,
            (SELECT COUNT(*) FROM failed_portable_charger_booking WHERE created_at >= "${currentDate}" ) AS total_pod_failed,
            (SELECT COUNT(*) FROM failed_charging_service WHERE created_at >= "${currentDate}" ) AS valet_failed,
            (SELECT COUNT(*) FROM failed_road_assistance WHERE created_at >= "${currentDate}" ) AS total_rsa_failed,
            (SELECT COUNT(*) FROM ev_insurance WHERE created_at >= "${currentDate}") AS total_insurance,
            (SELECT COUNT(*) FROM ev_charger_booiking WHERE created_at >= "${currentDate}") AS total_charger_booiking,
            (SELECT COUNT(*) FROM ev_accessories_booiking WHERE created_at >= "${currentDate}") AS total_accessories_booiking,
            (SELECT COUNT(*) FROM charge_share WHERE created_at >= "${currentDate}") AS charge_share_booiking`
        );
        const [rsaRecords] = await db.execute(`SELECT id, rsa_id, rsa_name, email, country_code, mobile, status, latitude AS lat, longitude AS lng FROM rsa where latitude != '' and status In(1, 2)`);
        const [podRecords] = await db.execute(`SELECT id, pod_id, device_id, pod_name, status, charging_status, latitude AS lat, longitude AS lng FROM pod_devices where latitude != ''`);

        const location = rsaRecords.map((rsa, i) => ({
            key         : rsa.rsa_id,
            rsaId       : rsa.rsa_id,
            rsaName     : rsa.rsa_name,
            email       : rsa.email,
            countryCode : rsa.country_code,
            mobile      : rsa.mobile,
            status      : rsa.status,
            location    : { lat: parseFloat(rsa.lat), lng: parseFloat(rsa.lng) },
        }));

        const podLocation = podRecords.map((pod, i) => ({
            podId           : pod.pod_id,
            deviceId        : pod.device_id,
            podName         : pod.pod_name,
            status          : pod.status,
            charging_status : pod.charging_status,
            location        : { lat: parseFloat(pod.lat), lng: parseFloat(pod.lng) },
        }));

        const count_arr = [
            { module : 'App Sign Up',                            count : counts[0].total_rider },
            { module : 'POD Bookings',                           count : counts[0].total_charger_booking },
            { module : 'Pickup & Dropoff Bookings',              count : counts[0].total_charging_service },
            { module : 'Charger Installation Bookings',          count : counts[0].total_installation },
            { module : 'EV Road Assistance',                     count : counts[0].total_road_assistance },
            { module : 'EV Insurance Leads',                     count : counts[0].total_insurance },
            { module : 'No. of Regs. Drivers',                   count : counts[0].total_rsa },
            { module : 'Total Public Chargers',                  count : counts[0].total_station }, 
            { module : 'Today POD Failed Bookings',              count : counts[0].total_pod_failed }, 
            { module : 'Today Pickup & Dropoff Failed Bookings', count : counts[0].valet_failed },
            { module : 'Today Road Side Failed Bookings',        count : counts[0].total_rsa_failed },
            { module : 'EV Chargers Booking',                    count : counts[0].total_charger_booiking },
            { module : 'EV Accessories Booking',                 count : counts[0].total_accessories_booiking },
            { module : 'Charger Share List',                     count : counts[0].charge_share_booiking },
        ];
        //io.emit('notification-list', {msCount : 1});
        return resp.json({code : 200, data : {count_arr, location, podLocation}});
    } catch (error) {
        console.log('Error fetching dashboard data:', error);
        resp.json({ message: 'Error fetching dashboard data' });
    }
};

export const notificationList = asyncHandler(async (req, resp) => {
    const { page_no, getCount } = mergeParam(req);
    const { isValid, errors }   = validateFields(mergeParam(req), { page_no: ["required"],});

    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

    const limit = 10;
    const start = parseInt((page_no * limit) - limit, 10);

    const totalRows  = await queryDB(`SELECT COUNT(*) AS total FROM notifications WHERE panel_to = ? and status = '0' `, ['Admin']);
    if(getCount){
        return resp.json({ 
            status : 1, 
            code       : 200, 
            message    : ["Notification Count Only"], 
            data       : [], 
            total_page : 0, 
            totalRows  : totalRows.total
        });
    }
    const total_page = Math.ceil(totalRows.total / limit) || 1; 
    const [rows] = await db.execute(`SELECT id, heading, description, module_name, panel_to, panel_from, receive_id, status, ${formatDateTimeInQuery(['created_at'])}, href_url
        FROM notifications WHERE panel_to = 'Admin' ORDER BY id DESC LIMIT ${start}, ${parseInt(limit)} 
    `, []);
    
    const notifications = rows;  // and status = 0 
    await db.execute(`UPDATE notifications SET status=? WHERE status=? AND panel_to=?`, ['1', '0', 'Admin']);
    
    return resp.json({ 
        status     : 1, 
        code       : 200, 
        message    : ["Notification list fetch successfully"], 
        data       : notifications, 
        total_page : total_page, 
        totalRows  : totalRows.total
    });
});

export const riderList = async (req, resp) => {
    let { page_no, sortBy, addedFrom, emirates, start_date, end_date, search_text = '' } = req.body;
    page_no = (isNaN(page_no) || page_no < 1)  ? 1 : parseInt(page_no, 10);
    try {
        const params = {
            tableName: 'riders',
            columns: `rider_id, rider_name, rider_email, country_code, rider_mobile, emirates, profile_img, vehicle_type, status, ${formatDateTimeInQuery(['created_at', 'updated_at'])}`,
            sortColumn: 'id',
            sortOrder : "DESC",
            page_no : page_no,
            limit: 10,
            liveSearchFields: ['rider_name', 'rider_id', 'rider_email', 'rider_mobile',],
            liveSearchTexts: [search_text, search_text, search_text, search_text,],
            whereField: [],
            whereValue: [],
            whereOperator: []
        };
        if (start_date && end_date) {
            
            // const startToday = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                        
            // const givenStartDateTime    = startFormattedDate+' 00:00:01';
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours');
            // const start        = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            // if(modifiedStartDateTime.format('YYYY') != '1999'){
            
            //     const endToday = new Date(end_date);
            //     const formattedEndDate = `${endToday.getFullYear()}-${(endToday.getMonth() + 1).toString()
            //         .padStart(2, '0')}-${endToday.getDate().toString().padStart(2, '0')}`;
            //     const end = formattedEndDate+' 19:59:59';
    
            //     params.whereField.push('created_at', 'created_at');
            //     params.whereValue.push(start, end);
            //     params.whereOperator.push('>=', '<=');
            // }

            //optimized code
            const start = moment(`${start_date} 00:00:01`, "YYYY-MM-DD HH:mm:ss").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
            const end = moment(end_date, "YYYY-MM-DD").format("YYYY-MM-DD") + " 19:59:59";

            params.whereField.push("created_at", "created_at");
            params.whereValue.push(start, end);
            params.whereOperator.push(">=", "<=");
        }
        if(addedFrom) {
            params.whereField.push('added_from');
            params.whereValue.push(addedFrom);
            params.whereOperator.push('=');
        }
        if(emirates) {
            params.whereField.push('emirates');
            params.whereValue.push(emirates);
            params.whereOperator.push('=');
        }

        const result = await getPaginatedData(params);
        const [emiratesResult] = await db.query('SELECT DISTINCT emirates FROM riders');
        
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Rider list fetched successfully!"],
            data       : result.data,
            emirates   : emiratesResult,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching rider list:', error);
        return resp.status(500).json({
            status  : 0,
            code    : 500,
            message : ['Error fetching rider list'],
        });
    }
};

export const riderDetails = async (req, resp) => {
    const { riderId } = req.body;

    if (!riderId) {
        return resp.json({ status: 0, code: 400, message: ['Rider ID is required'] });
    }
    try {
        // Fetch rider details
        let [riderRows] = await db.execute(`
            SELECT rider_id, rider_name, last_name, rider_email, country_code, rider_mobile, emirates
            FROM riders
            WHERE rider_id = ? `, [ riderId ]
        );
        // Check deleted riders if not found
        if (!riderRows.length) {
            [riderRows] = await db.execute(`
                SELECT rider_id, rider_name, last_name, rider_email, country_code, rider_mobile, emirates
                FROM deleted_riders
                WHERE rider_id = ? `, [ riderId ]
            );
        }
        if (!riderRows.length) {
            return resp.json({ status: 0, code: 404, message: 'Rider not found' });
        }
        const rider = riderRows[0];
        // Execute all remaining queries in parallel
        const [ [riderAddress], [riderVehicles], ] = await Promise.all([
            db.execute(`
                SELECT 
                    address_id, street_name, emirate, area, building_name, unit_no, landmark, nick_name, latitude, longitude
                FROM rider_address
                WHERE rider_id = ? `, [riderId]
            ),
            db.execute(`
                SELECT
                    vehicle_id, vehicle_type, vehicle_number, vehicle_code, vehicle_model, vehicle_make,
                    vehicle_specification, emirates
                FROM riders_vehicles
                WHERE rider_id = ? `, [riderId]
            )
        ]);
        return resp.json({
            status : 1,
            code   : 200,
            data   : {
                rider_id     : rider.rider_id,
                rider_name   : rider.rider_name,
                rider_email  : rider.rider_email,
                rider_mobile : rider.rider_mobile,
                country_code : rider.country_code,
                emirates     : rider.emirates,

                riderAddress,
                riderVehicles,
            }
        });
    } catch (error) {
        console.log('Error fetching rider details:', error);
        return resp.json({ status : 0, code : 500, message : ['Error fetching rider details'], });
    }
};

export const riderDetailsOld = async (req, resp) => {
    const { riderId } = req.body;
    if (!riderId) {
        return resp.status(200).json({ status : 0, code : 400, message : ['Rider ID is required'] });
    }
    try {
        var [rows] = await db.execute( `
            SELECT rider_id, rider_name, last_name, rider_email, country_code, rider_mobile, emirates 
            FROM riders 
            WHERE rider_id = ?`, [ riderId ] 
        );
        if (rows.length === 0) {
            var [rows2] = await db.execute( `
                SELECT rider_id, rider_name, last_name, rider_email, country_code, rider_mobile, emirates
                FROM deleted_riders 
                WHERE rider_id = ?`, [ riderId ] 
            );
            rows = rows2;
        }
        if (rows.length === 0) {
            return resp.status(200).json({ status : 0, code : 404, message : 'Rider not found' });
        }
        const [riderAddress] = await db.execute(`
            SELECT 
                address_id, street_name, emirate, area, building_name, unit_no, landmark, nick_name, latitude, longitude
            FROM rider_address 
            WHERE rider_id = ?`, [ riderId ]
        );
        var [riderVehicles] = await db.execute( `
            SELECT 
                vehicle_id, vehicle_type, vehicle_number, vehicle_code, vehicle_model, vehicle_make, vehicle_specification, emirates
            FROM riders_vehicles
            WHERE rider_id = ?`, [ riderId ]
        );
        const [chargerRows] = await db.execute(
            `SELECT 
                pcb.booking_id, rsa.rsa_name, pcb.vehicle_id, pcb.service_name, ROUND(pcb.service_price/100, 2) AS service_price, pcb.service_type, pcb.status, 
                ${formatDateTimeInQuery(['pcb.created_at'])}, pcb.slot_date, pcb.slot_time
            FROM portable_charger_booking pcb
            Left JOIN rsa ON pcb.rsa_id = rsa.rsa_id
            WHERE pcb.rider_id = ?
            ORDER BY pcb.created_at DESC LIMIT 5 `, [ riderId ]
        ); 
        const [chargingServiceRows] = await db.execute(
            `SELECT 
                cs.request_id, rsa.rsa_name, cs.vehicle_id, cs.order_status, 
                DATE_FORMAT(cs.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                ROUND(cs.price / 100, 2) AS price,
                ${formatDateTimeInQuery(['cs.created_at'])}
            FROM charging_service cs
            Left JOIN rsa ON cs.rsa_id = rsa.rsa_id
            WHERE cs.rider_id = ?
            ORDER BY cs.created_at DESC LIMIT 5 `, [ riderId ]
        );
        const [rsaBookings] = await db.execute(
            `SELECT 
                request_id, vehicle_id, ROUND(price/100, 2) AS price, order_status, 
                ${formatDateTimeInQuery(['created_at'])}, 
                (SELECT rsa_name FROM rsa WHERE rsa_id = road_assistance.rsa_id) AS rsa_name 
            FROM road_assistance 
            WHERE rider_id = ?
            ORDER BY created_at DESC LIMIT 5`, [ riderId ]
        );
        const rider = {
            rider_id     : rows[0].rider_id,
            rider_name   : rows[0].rider_name,
            rider_email  : rows[0].rider_email,
            rider_mobile : rows[0].rider_mobile,
            country_code : rows[0].country_code,
            emirates     : rows[0].emirates,

            portableChargerBookings : chargerRows,
            pickAndDropBookings     : chargingServiceRows,
            riderAddress,
            riderVehicles,
            rsaBookings 
        };
        return resp.json({ status : 1, code : 200, data : rider });
    } catch (error) {
        console.error('Error fetching rider details:', error);
        return resp.json({ status : 0, code : 500, message : ['Error fetching rider details'], });
    }
};

export const deleteRider = async (req, resp) => {
    const {rider_id} = req.body 
    if (!rider_id) return resp.json({ status: 0, code: 422, message: "Rider ID is required" });

    try {
        const [[rider]] = await db.execute('SELECT profile_img, rider_name, last_name, rider_email, country_code, rider_mobile, emirates, area, country, date_of_birth, added_from FROM riders WHERE rider_id = ?', [rider_id]);
        if (rider.length === 0) return resp.json({ status: 0, message: 'Rider not found.' });

        const deleteQueries = [ 'DELETE FROM riders WHERE rider_id = ?' ];
        // Execute each delete query
        for (const query of deleteQueries) {
            await db.execute(query, [rider_id]);
        }
        await insertRecord('deleted_riders', [
            'rider_id', 'rider_name', 'last_name', 'rider_email', 'country_code', 'rider_mobile', 'emirates', 'area', 'country', 'profile_img', 'date_of_birth', 'added_from' 
        ],[
            rider_id, rider.rider_name, rider.last_name, rider.rider_email, rider.country_code, rider.rider_mobile,  rider.emirates, rider.area, rider.country, rider.profile_img, rider.date_of_birth, rider.added_from 
        ]);

        return resp.json({ status: 1, code: 200, error: false, message: ['Rider account deleted successfully!'] });
    } catch (err) {
        
        console.error('Error deleting rider account:', err.message);
        return resp.json({ status: 1, code: 500, error: true, message: ['Something went wrong. Please try again!'] });
    } finally {
    
    }
};

//admin profile
export const profileDetails = async (req, resp) => {
    const { email, userId } = req.body;

    if (!userId) {
        return resp.status(400).json({
            status  : 0,
            code    : 400,
            message : 'User ID is required'
        });
    }
    try {
        const [user] = (await db.execute('SELECT * FROM users WHERE email=? and id = ?', [email, userId]));

        resp.status(200).json({
            message     :"Profile Details",
            code        : 200, 
            userDetails : user[0], 
            base_url    : `${process.env.DIR_UPLOADS}profile-image/`,
        })
       
    } catch (error) {
        console.error('Error fetching profile details:', error);
        return resp.status(500).json({
            status  : 0,
            code    : 500,
            message : 'Error fetching profile details',
        });
    }
};

export const profileUpdate = asyncHandler(async (req, resp) => {
    const{ user_id, name, email, phone, } = req.body;
    const { isValid, errors } = validateFields(req.body, { 
        user_id : ["required"],
        name    : ["required"],
        email   : ["required"],
        phone   : ["required"],
    });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
   
    const [users] = await db.execute('SELECT * FROM users WHERE email = ?', [email]);
      
      if (users.length === 0) {
          return resp.status(404).json({ message: "Entered email is not registered with us, try with another one." });
      }
    const profile_image = req.files['profile_image'] ? files['profile_image'][0].filename : users[0].image;
    const updates       = { name, email, phone, image: profile_image};

    // if(password) updates.password = await bcrypt.hash(password, 10);

    const update = await updateRecord('users', updates, ['email'], [email]);

    if(userData.image) deleteFile('profile-image', users[0].image);

    return resp.json({
        status: update.affectedRows > 0 ? 1 : 0, 
        code: 200, 
        message: update.affectedRows > 0 ? "Profile updated successfully" : "Failed to update, Please Try Again!", 
    });
});

export const locationList = asyncHandler(async (req, resp) => {
    const [list] = await db.execute(`SELECT location_id as value, location_name as label FROM locations where status = 1 ORDER BY location_name ASC`);
    return resp.json({status: 1, code: 200, message: '', data: list});
});
/* Dynamic Data */
export const areaList = asyncHandler(async (req, resp) => {
    const { location_id } = mergeParam(req);

    let query = `SELECT id AS loc_id, location_id, area_name FROM locations_area_list WHERE location_id = ? AND status = ? ORDER BY area_name ASC`;

    const [result] = await db.execute(query, [location_id, 1]);
    return resp.json({
        status    : 1, 
        code      : 200,
        message   : ["Area List fetch successfully!"],
        area_data : result
    });
});

export const deletedRiderList = async (req, resp) => {
    let { page_no, addedFrom, emirates, start_date, end_date, search_text = '' } = req.body;

    page_no = parseInt(page_no, 10);
    if (isNaN(page_no) || page_no < 1) {
        page_no = 1;
    }

    try {
        const params = {
            tableName : 'deleted_riders',
            columns   : `rider_id, rider_name, last_name, rider_email, country_code, rider_mobile, emirates, profile_img, ${formatDateTimeInQuery(['created_at'])}`,
            sortColumn : 'id',
            sortOrder  : "DESC",
            page_no    : page_no,
            limit      : 10,
            liveSearchFields : ['rider_name', 'last_name', 'rider_id', 'rider_email', 'rider_mobile'],
            liveSearchTexts  : [search_text, search_text, search_text, search_text, search_text],
            whereField    : [],
            whereValue    : [],
            whereOperator : []
        };
        if (start_date && end_date) {
            
            // const startToday         = new Date(start_date);
            // const startFormattedDate = `${startToday.getFullYear()}-${(startToday.getMonth() + 1).toString()
            //     .padStart(2, '0')}-${startToday.getDate().toString().padStart(2, '0')}`;
                        
            // const givenStartDateTime    = startFormattedDate+' 00:00:01'; // Replace with your datetime string
            // const modifiedStartDateTime = moment(givenStartDateTime).subtract(4, 'hours'); // Subtract 4 hours
            // const start                 = modifiedStartDateTime.format('YYYY-MM-DD HH:mm:ss')
            
            // const endToday         = new Date(end_date);
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
        if(addedFrom) {
            params.whereField.push('added_from');
            params.whereValue.push(addedFrom);
            params.whereOperator.push('=');
        }
        if(emirates) {
            params.whereField.push('emirates');
            params.whereValue.push(emirates);
            params.whereOperator.push('=');
        }
        const result           = await getPaginatedData(params);
        const [emiratesResult] = await db.query('SELECT DISTINCT emirates FROM riders');
        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Deleted Rider list fetched successfully!"],
            data       : result.data,
            emirates   : emiratesResult,
            total_page : result.totalPage,
            total      : result.total,
        });
    } catch (error) {
        console.error('Error fetching rider list:', error);
        return resp.status(500).json({
            status  : 0,
            code    : 500,
            message : 'Error fetching rider list',
        });
    }
};

export const bookingAreaList = asyncHandler(async (req, resp) => {
    const { area_name } = mergeParam(req);

    let query = `SELECT area_name FROM dubai_area WHERE status = ? `;

    const areaName = area_name || '';
    const params   = [1];

    if (areaName) {
        query += ' AND area_name LIKE ?';
        params.push(`%${areaName}%`);
    }
    query += ' ORDER BY area_name ASC';
    const [result] = await db.execute(query, params);
    return resp.json({
        status: 1,
        code: 200,
        message: ["Area List fetch successfully!"],
        area_data: result,
        area_count: result.length
    });
});


export const topRatedAreaList = asyncHandler(async (req, resp) => {
    const { page_no = 1, start_date = '', end_date = '' } = mergeParam(req);

    let wherQ   = ' ';
    const limit = 10;
    const startIndex = parseInt((page_no * limit) - limit, 10);
    if (start_date && end_date) {
    
        const fromDate = moment(start_date, "YYYY-MM-DD").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");
        const toDate   = moment(end_date, "YYYY-MM-DD").subtract(4, "hours").format("YYYY-MM-DD HH:mm:ss");

        wherQ = `  WHERE created_at >= "${fromDate}" AND created_at <= "${toDate}" `;
    }
    let query = `
        SELECT SQL_CALC_FOUND_ROWS
            COALESCE( NULLIF(TRIM(area), ''), TRIM( SUBSTRING_INDEX( SUBSTRING_INDEX(address, ',', 4), ',', -1 ) )
            ) AS area_name,
            COUNT(*) AS booking_count
        FROM portable_charger_booking
        ${wherQ}
        GROUP BY area_name
        ORDER BY booking_count DESC LIMIT ${startIndex}, ${parseInt(limit, 10)}
    `;
    const [result]      = await db.execute(query, []);
    const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
    const totalPage     = Math.max(Math.ceil(total / limit), 1);

    return resp.json({
        status     : 1,
        code       : 200,
        message    : ["Area List fetch successfully!"],
        area_data  : result,
        total,
        totalPage,
    });
});

export const riderBookingLists = async (req, resp) => {
    const { riderId, service_type, page_no = 1 } = req.body;

    if (!riderId) {
        return resp.json({ status: 0, code: 400, message: ['Rider ID is required'] });
    }
    if (!service_type) {
        return resp.json({ status: 0, code: 400, message: ['Service Type is required'] });
    }
    try {
        let data         = []; 
        const limit      = 10;
        const startIndex = parseInt((page_no * limit) - limit, 10);
        let query        = '';
        if (service_type === "POD") {
            query =  `
                SELECT SQL_CALC_FOUND_ROWS
                    pcb.booking_id, rsa.rsa_name, pcb.vehicle_id, pcb.service_name, pcb.status, pcb.service_type,
                    ROUND(pcb.service_price / 100, 2) AS service_price, pcb.slot_date, pcb.slot_time,
                    ${formatDateTimeInQuery(['pcb.created_at'])} 
                FROM portable_charger_booking pcb
                LEFT JOIN rsa ON pcb.rsa_id = rsa.rsa_id
                WHERE pcb.rider_id = ?
                ORDER BY pcb.created_at DESC
                LIMIT ${startIndex}, ${parseInt(limit, 10)} ` 
            ;         
        }
        else if (service_type == "Valet") {
            query =  `
                SELECT SQL_CALC_FOUND_ROWS
                    cs.request_id, rsa.rsa_name, cs.vehicle_id, cs.order_status,
                    DATE_FORMAT(cs.slot_date_time, '%Y-%m-%d %H:%i:%s') AS slot_date_time,
                    ROUND(cs.price / 100, 2) AS price, ${formatDateTimeInQuery(['cs.created_at'])}
                FROM charging_service cs
                LEFT JOIN rsa ON cs.rsa_id = rsa.rsa_id
                WHERE cs.rider_id = ?
                ORDER BY cs.created_at DESC
                LIMIT ${startIndex}, ${parseInt(limit, 10)} `
            ;
        }
        else if (service_type == "RSA") {
            query =  `
                SELECT SQL_CALC_FOUND_ROWS
                    ra.request_id, ra.vehicle_id, ROUND(ra.price / 100, 2) AS price, ra.order_status, 
                    ${formatDateTimeInQuery(['ra.created_at'])}, rsa.rsa_name
                FROM road_assistance ra
                LEFT JOIN rsa ON ra.rsa_id = rsa.rsa_id
                WHERE ra.rider_id = ?
                ORDER BY ra.created_at DESC
                LIMIT ${startIndex}, ${parseInt(limit, 10)} ` 
            ;
        }
        const [result]      = await db.execute(query, [riderId]);
        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage     = Math.max(Math.ceil(total / limit), 1);
        return resp.json({
            status : 1,
            code   : 200,
            data   : result,
            total,
            totalPage,
        });
    } catch (error) {
        console.log('Error fetching rider details:', error);
        return resp.json({ status : 0, code : 500, message : ['Error fetching rider details'], });
    }
};