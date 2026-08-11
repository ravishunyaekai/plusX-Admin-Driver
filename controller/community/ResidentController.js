import { mergeParam, formatDateTimeInQuery, asyncHandler } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB, getPaginatedData } from '../../dbUtils.js';
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

        const params = {
            tableName        : ' community_resident as cr',
            columns          : `resident_id, resident_name, resident_mobile, resident_email, community_name, area_name, monthly_session_allocation, '0' AS session_used, kwh_allocated, '0' AS kwh_used, cr.status`,
            sortColumn       : 'cr.id',
            sortOrder        : 'DESC',
            page_no,
            liveSearchFields : ['resident_name', 'resident_mobile', 'resident_email'],
            liveSearchTexts  : [search_text, search_text, search_text],
            limit            : 10,
            whereField       : ['cr.community_id'],
            whereValue       : [community_id],
            whereOperator    : ['='],
            joinTable        : ' community_list as cm ',
            joinCondition    : ' cm.community_id = cr.community_id ',
        };

        const result = await getPaginatedData(params);

        return resp.json({
            status     : 1,
            code       : 200,
            message    : ["Resident list fetched successfully!"],
            data       : result.data,
            total_page : result.totalPage,
            total      : result.total,
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
                resident_id, resident_name, resident_mobile, resident_email, address,
                monthly_session_allocation, alloted_time, kwh_allocated, per_kwh_charge, extra_charge,
                ${formatDateTimeInQuery(['rs.created_at'])}, rs.status,
                community_name, area_name, rs.community_id
            FROM community_resident as rs
            LEFT JOIN community_list as cm ON cm.community_id = rs.community_id
            WHERE resident_id = ? AND rs.community_id = ?
        `, [resident_id, community_id]);

        if (!resident) {
            return resp.json({ status: 0, code: 404, message: "Resident not found." });
        }

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Resident details fetched successfully!"],
            data    : resident,
        });
    } catch (error) {
        console.log('Error fetching resident details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
