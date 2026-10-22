import { mergeParam, formatDateTimeInQuery, asyncHandler } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB } from '../../dbUtils.js';
import db from "../../config/db.js";
import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";

/**
 * Paginated resident list for the manager's community only
 */
export const residentList = async (req, resp) => {
    try {
        const { page_no = 1, search_text = '', community_id } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // Ensure manager can only view residents of their own community
        if (req.manager && req.manager.community_id !== community_id) {
            return resp.json({ status: 0, code: 403, message: "Unauthorized access to this community." });
        }

        const limit  = 10;
        const page   = (isNaN(page_no) || page_no < 1) ? 1 : parseInt(page_no, 10);
        const offset = (page * limit) - limit;

        const whereParts = ['m.community_id = ?'];
        const queryParams = [community_id];

        if (search_text && String(search_text).trim()) {
            const like = `%${String(search_text).trim()}%`;
            whereParts.push('(cr.resident_id LIKE ? OR cr.resident_name LIKE ? OR cr.resident_mobile LIKE ? OR cr.resident_email LIKE ?)');
            queryParams.push(like, like, like, like);
        }

        const [rows] = await db.execute(`
            SELECT SQL_CALC_FOUND_ROWS
                cr.resident_id,
                cr.resident_name,
                cr.resident_mobile,
                cr.resident_email,
                cm.community_name,
                cm.area_name,
                cr.monthly_session_allocation,
                '0' AS session_used,
                cr.kwh_allocated,
                '0' AS kwh_used,
                cr.status
            FROM community_resident AS cr
            INNER JOIN community_resident_map AS m
                ON m.resident_id = cr.resident_id
            INNER JOIN community_list AS cm
                ON cm.community_id = m.community_id
            WHERE ${whereParts.join(' AND ')}
            ORDER BY cr.id DESC
            LIMIT ${offset}, ${limit}
        `, queryParams);

        const [[{ total }]] = await db.query('SELECT FOUND_ROWS() AS total');
        const totalPage = Math.max(Math.ceil(total / limit), 1);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Resident list fetched successfully!"],
            data       : rows,
            total_page : totalPage,
            total,
        });
    } catch (error) {
        console.log('Error fetching resident list:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
};

/**
 * Resident details — only if resident belongs to the manager's community
 */
export const residentDetail = asyncHandler(async (req, resp) => {
    try {
        const { resident_id, community_id } = mergeParam(req);

        const { isValid, errors } = validateFields(mergeParam(req), {
            resident_id  : ["required"],
            community_id : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // Ensure manager can only view residents of their own community
        if (req.manager && req.manager.community_id !== community_id) {
            return resp.json({ status: 0, code: 403, message: "Unauthorized access to this community." });
        }

        const resident = await queryDB(`
            SELECT
                rs.resident_id, rs.resident_name, rs.resident_mobile, rs.resident_email, rs.address, rs.emirates,
                rs.monthly_session_allocation, rs.alloted_time, rs.kwh_allocated, rs.per_kwh_charge, rs.extra_charge,
                ${formatDateTimeInQuery(['rs.created_at'])}, rs.status,
                cm.community_name, cm.area_name, m.community_id
            FROM community_resident as rs
            INNER JOIN community_resident_map AS m
                ON m.resident_id = rs.resident_id AND m.community_id = ?
            LEFT JOIN community_list as cm ON cm.community_id = m.community_id
            WHERE rs.resident_id = ?
        `, [community_id, resident_id]);

        if (!resident) {
            return resp.json({ status: 0, code: 404, message: "Resident not found." });
        }

        const rider = await queryDB(
            `SELECT rider_id FROM riders WHERE rider_mobile = ? LIMIT 1`,
            [resident.resident_mobile]
        );

        let residentVehicles = [];
        if (rider?.rider_id) {
            const [vehicles] = await db.execute(`
                SELECT
                    vehicle_id, vehicle_type, vehicle_make, vehicle_model, vehicle_specification,
                    emirates, vehicle_code, vehicle_number, default_vehicle
                FROM riders_vehicles
                WHERE rider_id = ?
                ORDER BY default_vehicle DESC, id DESC
            `, [rider.rider_id]);
            residentVehicles = vehicles;
        }

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Resident details fetched successfully!"],
            data    : {
                ...resident,
                rider_id : rider?.rider_id || null,
                residentVehicles,
            },
        });
    } catch (error) {
        console.log('Error fetching resident details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
