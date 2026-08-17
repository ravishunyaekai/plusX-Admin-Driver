import { mergeParam, formatDateTimeInQuery, asyncHandler } from "../../utils.js";
import validateFields from "../../validation.js";
import { queryDB } from '../../dbUtils.js';
import db from "../../config/db.js";
import { tryCatchErrorHandler } from "../../middleware/errorHandler.js";

/**
 * Get details of the community the logged-in manager belongs to
 * Scoped by community_id (must match authenticated manager's community)
 */
export const communityDetail = asyncHandler(async (req, resp) => {
    try {
        const { community_id } = mergeParam(req);
        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // Ensure manager can only view their own community
        if (req.manager && req.manager.community_id !== community_id) {
            return resp.json({ status: 0, code: 403, message: "Unauthorized access to this community." });
        }

        const community = await queryDB(`
            SELECT
                community_id, community_name, area_name, total_residence, status,
                ${formatDateTimeInQuery(['created_at'])}
            FROM community_list
            WHERE community_id = ?
        `, [community_id]);

        if (!community) {
            return resp.json({ status: 0, code: 404, message: "Community not found." });
        }

        const [chargers] = await db.execute(`
            SELECT id, charger_id, kw
            FROM community_chargers
            WHERE community_id = ?
        `, [community_id]);

        const manager = await queryDB(`
            SELECT
                manager_id, manager_name, manager_email, manager_contact, status,
                ${formatDateTimeInQuery(['created_at'])}
            FROM community_managers
            WHERE community_id = ?
        `, [community_id]);

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Community details fetched successfully!"],
            data    : community,
            chargers,
            manager,
        });
    } catch (error) {
        console.log('Error fetching community details:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});
