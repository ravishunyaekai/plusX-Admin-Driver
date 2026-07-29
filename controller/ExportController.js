import db from "../config/db.js";
import ExcelJS from 'exceljs';
import moment from "moment";
import { formatDateInQuery, mergeParam, formatDateTimeInQuery } from "../utils.js";
import { tryCatchErrorHandler } from "../middleware/errorHandler.js";

export const donwloadPodBookingList = async (req, resp) => {
    try{
        const { status, start_date, end_date, search_text='', scheduled_start_date, scheduled_end_date } = mergeParam(req);
        let query = `
            SELECT
                ${formatDateInQuery(['created_at'])},
                booking_id,
                service_type,
                ROUND(service_price/100, 2) AS service_price,
                CONCAT(slot_date,' ',slot_time) AS schedule_date_time,
                user_name,
                (select rider_email from riders AS r where r.rider_id = portable_charger_booking.rider_id) AS email,
                CONCAT(country_code,'-',contact_no) AS mobile,
                address, concat('https://www.google.com/maps?q=','',latitude,',',longitude) as map_address, 
                (select rsa_name from rsa where rsa.rsa_id = portable_charger_booking.rsa_id) AS rsa_name,
                (select concat(country_code,'-',mobile) from rsa where rsa.rsa_id = portable_charger_booking.rsa_id) AS rsa_phone,
                (SELECT CONCAT(vehicle_make, "-", vehicle_model) FROM riders_vehicles WHERE vehicle_id = portable_charger_booking.vehicle_id) AS vehicle_data,
                CASE
                    WHEN status = 'CNF' THEN 'Booking Confirmed'
                    WHEN status = 'A'   THEN 'Assigned'
                    WHEN status = 'RL'  THEN 'POD Reached at Location'
                    WHEN status = 'CS'  THEN 'Charging Started'
                    WHEN status = 'CC'  THEN 'Charging Completed'
                    WHEN status = 'PU'  THEN 'Picked Up'
                    WHEN status = 'C'   THEN 'Cancel'
                    WHEN status = 'ER'  THEN 'Enroute'
                    WHEN status = 'RO'  THEN 'POD Reached at Office'
                END AS status
            FROM
                portable_charger_booking  
        `; 
        let params = [];

        if (search_text) {
            query += ` WHERE booking_id LIKE ? OR user_name LIKE ? OR service_name LIKE ?`;
            const likeSearchText = `%${search_text}%`; 
            params.push(likeSearchText, likeSearchText, likeSearchText);
        }
        if (start_date && end_date) {
            const start = moment(start_date, "YYYY-MM-DD").startOf('day').format("YYYY-MM-DD HH:mm:ss");
            const end   = moment(end_date, "YYYY-MM-DD").endOf('day').format("YYYY-MM-DD HH:mm:ss");
            if (params.length === 0) query += ` WHERE created_at BETWEEN ? AND ?`;
            else query += ` AND created_at BETWEEN ? AND ?`; 
            params.push(start, end);
            
        } 
        if (scheduled_start_date && scheduled_end_date) {
            const schStart = moment(scheduled_start_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            const schEnd   = moment(scheduled_end_date, "YYYY-MM-DD").format("YYYY-MM-DD");
            if (params.length === 0) query += ` WHERE slot_date BETWEEN ? AND ?`;
            else query += ` AND slot_date BETWEEN ? AND ?`; 
            params.push(schStart, schEnd);
        }
        if (status) {
            if (params.length === 0) query += ` WHERE status = ?`;
            else query += ` AND status = ?`; 
            params.push(status);
        } else {
            if (params.length === 0) query += ` WHERE status != ?`;
            else query += ` AND status != ?`; 
            params.push('PNR');
        }
        if (params.length === 0)  {
            const year  = moment().format("YYYY");
            const month =  moment().format("MM");
        
            query += ` WHERE MONTH(created_at) = ? AND YEAR(created_at) = ?`;
            params.push(month, year);
        }
        query += ' ORDER BY id DESC ';
        
        const [rows]    = await db.execute(query, params);
        const workbook  = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');
    
        worksheet.columns = [
            { header : 'Booking Date',           key : 'created_at'         },
            { header : 'Booking Id',             key : 'booking_id'         },
            { header : 'Service Type',           key : 'service_type'       },
            { header : 'Service Price',          key : 'service_price'      },
            { header : 'Schedule Date',          key : 'schedule_date_time' },
            { header : 'Customer Name',          key : 'user_name'          },
            { header : 'Customer Email',         key : 'email'              },
            { header : 'Customer Contact No',    key : 'mobile'             },
            { header : 'Address',                key : 'address'            },
            { header : 'Driver Name',            key : 'rsa_name'           },
            { header : 'Driver Contact No',      key : 'rsa_phone'          },
            { header : 'Status',                 key : 'status'             },
            { header : 'Map Link',               key  : 'map_address'        },
            { header : 'Vehicle Name',           key: 'vehicle_data'       },
        ];
        worksheet.getColumn(1).numFmt = 'dd-mmm-yyyy';
        rows.forEach((item) => {
            worksheet.addRow(item); 
        });
        resp.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        resp.setHeader('Content-Disposition', 'attachment; filename=Portable-Charger-Booking-List.xlsx');
      
        await workbook.xlsx.write(resp);
        resp.end();

    } catch(err) {
        console.log('err exporting : ', err);
        tryCatchErrorHandler(err, resp, 'Error exporting charger booking lists');
    }
};
export const donwloadUserList = async (req, resp) => {
    try{
        const { addedFrom, emirates, start_date, end_date, search_text =''} = mergeParam(req);

        let query = `
            SELECT
                rider_id, rider_name, rider_email, country_code, rider_mobile, emirates, ${formatDateTimeInQuery(['created_at'])},
                ( SELECT concat(vehicle_make , " - ", vehicle_model) FROM riders_vehicles where rider_id = riders.rider_id order by id desc limit 1) as vehicle, added_from 
            FROM
                riders
        `; 
        let params = [];

        if (search_text) {
            query += ` WHERE rider_name LIKE ? OR rider_id LIKE ? OR rider_email LIKE ? OR rider_mobile LIKE ?`;
            const likeSearchText = `%${search_text}%`; 
            params.push(likeSearchText, likeSearchText, likeSearchText, likeSearchText);
        }
        if (start_date && end_date) {
            const start = moment(start_date, "YYYY-MM-DD").startOf('day').format("YYYY-MM-DD HH:mm:ss");
            const end   = moment(end_date, "YYYY-MM-DD").endOf('day').format("YYYY-MM-DD HH:mm:ss");
            if (params.length === 0) query += ` WHERE created_at BETWEEN ? AND ?`;
            else query += ` AND created_at BETWEEN ? AND ?`; 
            params.push(start, end);
        } 
        if(addedFrom) {
            if (params.length === 0) query += ` WHERE added_from = ?`;
            else query += ` AND added_from = ?`; 
            params.push(addedFrom);

        }
        if(emirates) {

            if (params.length === 0) query += ` WHERE emirates = ?`;
            else query += ` AND emirates = ?`; 
            params.push(emirates);
        }
        if (params.length === 0)  {
            const year  = moment().format("YYYY");
            const month =  moment().format("MM");
        
            query += ` WHERE MONTH(created_at) = ? AND YEAR(created_at) = ?`;
            params.push(month, year);
        }
        query += ' ORDER BY id DESC ';
        
        const [rows] = await db.execute(query, params);
        // return resp.json(rows);
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Sheet 1');
    
        worksheet.columns = [
            
            { header: 'Customer ID',   key: 'rider_id'  },
            { header: 'Customer Name', key: 'rider_name' },
            { header: 'Email',         key: 'rider_email' },
            { header: 'Mobile No',     key: 'rider_mobile' },
            { header: 'Emirate	',     key: 'emirates' },
            { header: 'Date',          key: 'created_at' },
            { header: 'Added From',    key: 'added_from' },
        ];
    
        rows.forEach((item) => {
            worksheet.addRow(item);
        });
        resp.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        resp.setHeader('Content-Disposition', 'attachment; filename=Portable-Charger-Booking-List.xlsx');
      
        await workbook.xlsx.write(resp);
        resp.end();

    }catch(err){
        console.log('err exporting : ', err);
        tryCatchErrorHandler(err, resp, 'Error exporting charger User lists');
    }
    
}; 