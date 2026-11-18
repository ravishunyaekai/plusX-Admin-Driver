import dotenv from 'dotenv';
import db from '../../config/db.js';

dotenv.config();

/**
 * Station Master auth for protected /partner-station routes.
 * Expects: accesstoken header (CUSTOM_TOKEN), station_id + email in body.
 * Attaches req.stationMaster (includes station_id).
 */
export const authenticateStationMaster = async (req, resp, next) => {
    const station_id = req.body.station_id;
    const email      = req.body.email;
    const token      = req.headers.accesstoken;

    if (!token) {
        return resp.json({ status: 401, message: 'Access token is missing' });
    }

    if (token !== process.env.CUSTOM_TOKEN) {
        return resp.status(403).json({ status: 403, message: 'Unauthorized access' });
    }

    if (!station_id || !email) {
        return resp.json({ status: 422, message: 'station_id and email are required' });
    }

    try {
        const [rows] = await db.execute(`
            SELECT id, station_id, station_name, master_email, admin_status, status
            FROM partner_charging_stations
            WHERE station_id = ? AND master_email = ? AND status = 1
            LIMIT 1
        `, [station_id, email]);

        if (rows.length === 0) {
            return resp.json({ status: 403, message: 'Unauthorized access or invalid station master' });
        }

        if (rows[0].admin_status && rows[0].admin_status !== 'Active') {
            return resp.json({
                status: 0,
                code: 403,
                message: 'Station is not active. Please contact admin.',
            });
        }

        req.stationMaster = rows[0];
        next();
    } catch (error) {
        console.error('Station master authentication error:', error);
        return resp.json({ status: 500, message: 'Internal server error' });
    }
};

export const assertStationScope = (req, station_id, resp) => {
    if (req.stationMaster && req.stationMaster.station_id !== station_id) {
        resp.json({ status: 0, code: 403, message: 'Unauthorized access to this station.' });
        return false;
    }
    return true;
};