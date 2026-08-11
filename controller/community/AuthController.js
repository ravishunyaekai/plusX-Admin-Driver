import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../../config/db.js';
import { formatDateTimeInQuery, mergeParam, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { tryCatchErrorHandler } from '../../middleware/errorHandler.js';

dotenv.config();

/**
 * Community manager login
 * Uses community_managers table (email + password)
 */
export const login = async (req, resp) => {
    const { email, password } = req.body;

    try {
        const { isValid, errors } = validateFields(req.body, {
            email    : ["required"],
            password : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [managers] = await db.execute(`
            SELECT
                id, manager_id, community_id, manager_name, manager_email, manager_contact,
                password, status, ${formatDateTimeInQuery(['created_at', 'updated_at'])}
            FROM community_managers
            WHERE manager_email = ?
        `, [email]);

        if (managers.length === 0) {
            return resp.status(200).json({ status: 0, code: 200, message: "Invalid email" });
        }

        const manager = managers[0];

        if (manager.status != 1) {
            return resp.status(200).json({ status: 0, code: 200, message: "Account is inactive. Please contact admin." });
        }

        const isMatch = await bcrypt.compare(password, manager.password);
        if (!isMatch) {
            return resp.status(200).json({ status: 0, code: 200, message: "Invalid password" });
        }

        const token = jwt.sign(
            {
                id           : manager.id,
                manager_id   : manager.manager_id,
                email        : manager.manager_email,
                community_id : manager.community_id,
                role         : 'community_manager',
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        resp.cookie('communityAuthToken', token, {
            httpOnly : true,
            secure   : process.env.NODE_ENV === 'production',
            sameSite : 'None',
            maxAge   : 3600000,
        });

        // Do not expose password hash to the client
        delete manager.password;

        return resp.status(200).json({
            status        : 1,
            code          : 200,
            message       : "Login successful",
            userDetails   : manager,
            Token         : process.env.CUSTOM_TOKEN,
        });
    } catch (error) {
        console.error("Community manager login error:", error);
        return resp.status(500).json({
            status      : 0,
            code        : 500,
            message     : "Login failed",
            userDetails : {},
            Token       : '',
        });
    }
};

/**
 * Community manager dashboard
 * Returns resident count and charger count for the logged-in manager's community
 */
export const getDashboardData = asyncHandler(async (req, resp) => {
    try {
        const { community_id } = mergeParam(req);
        const { isValid, errors } = validateFields(mergeParam(req), {
            community_id : ["required"],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        // Ensure manager can only view their own community stats
        if (req.manager && req.manager.community_id !== community_id) {
            return resp.json({ status: 0, code: 403, message: "Unauthorized access to this community." });
        }

        const [counts] = await db.execute(`
            SELECT
                (SELECT COUNT(*) FROM community_resident WHERE community_id = ?) AS total_residents,
                (SELECT COUNT(*) FROM community_chargers WHERE community_id = ?) AS total_chargers,
                (SELECT community_name FROM community_list WHERE community_id = ?) AS community_name,
                (SELECT area_name FROM community_list WHERE community_id = ?) AS area_name
        `, [community_id, community_id, community_id, community_id]);

        return resp.json({
            status  : 1,
            code    : 200,
            message : ["Dashboard data fetched successfully!"],
            data    : {
                community_id,
                community_name  : counts[0]?.community_name || '',
                area_name       : counts[0]?.area_name || '',
                total_residents : counts[0]?.total_residents || 0,
                total_chargers  : counts[0]?.total_chargers || 0,
            },
        });
    } catch (error) {
        console.log('Error fetching community dashboard data:', error);
        tryCatchErrorHandler(req.originalUrl, error, resp);
    }
});

export const logout = async (req, resp) => {
    const { email } = req.body;
console.log('email',req.body)
    if (!email) {
        return resp.json({ status: 0, message: "Email is required." });
    }

    try {
        const [managers] = await db.execute(
            'SELECT id FROM community_managers WHERE manager_email = ?',
            [email]
        );

        if (managers.length === 0) {
            return resp.json({ status: 0, message: "Manager not found." });
        }

        resp.clearCookie('communityAuthToken');
        return resp.json({ status: 1, message: "Logged out successfully." });
    } catch (error) {
        console.error("Error during community logout:", error);
        return resp.json({ status: 0, message: "Logout failed." });
    }
};
