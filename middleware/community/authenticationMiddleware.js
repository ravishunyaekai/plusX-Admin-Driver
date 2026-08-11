import dotenv from 'dotenv';
import db from "../../config/db.js";
dotenv.config();

/**
 * Authenticate community manager for protected /community routes
 * Expects: accesstoken header (CUSTOM_TOKEN), manager_id + email in body
 * Attaches manager record to req.manager (includes community_id)
 */
export const authenticateCommunityManager = async (req, resp, next) => {
    const managerId = req.body.manager_id;
    const email     = req.body.email;
    const token     = req.headers["accesstoken"];

    if (!token) {
        return resp.json({ status: 401, message: "Access token is missing" });
    }

    if (token !== process.env.CUSTOM_TOKEN) {
        return resp.status(403).json({ status: 403, message: "Unauthorized access" });
    }

    if (!managerId || !email) {
        return resp.json({ status: 422, message: "manager_id and email are required" });
    }

    try {
        const [rows] = await db.execute(`
            SELECT id, manager_id, community_id, manager_name, manager_email, manager_contact, status
            FROM community_managers
            WHERE manager_id = ? AND manager_email = ? AND status = 1
        `, [managerId, email]);

        if (rows.length === 0) {
            return resp.json({ status: 403, message: "Unauthorized access or invalid manager status" });
        }

        req.manager = rows[0];
        next();
    } catch (error) {
        console.error("Error in community manager authentication:", error);
        return resp.json({ status: 500, message: "Internal server error" });
    }
};
