import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../../config/db.js';
import { formatDateTimeInQuery, mergeParam, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';

dotenv.config();

export const login = async (req, resp) => {
    const { email, password } = req.body;

    try {
        const { isValid, errors } = validateFields(req.body, {
            email: ['required'],
            password: ['required'],
        });
        if (!isValid) return resp.json({ status: 0, code: 422, message: errors });

        const [rows] = await db.execute(`
            SELECT
                id, station_id, station_name, master_email, master_password,
                admin_status, city, country, address, contact_number, status,
                ${formatDateTimeInQuery(['created_at', 'updated_at'])}
            FROM partner_charging_stations
            WHERE master_email = ? AND status = 1
            LIMIT 1
        `, [email]);

        if (rows.length === 0) {
            return resp.status(200).json({ status: 0, code: 200, message: 'Invalid email' });
        }

        const station = rows[0];

        if (station.admin_status && station.admin_status !== 'Active') {
            return resp.status(200).json({
                status: 0,
                code: 200,
                message: 'Station account is inactive. Please contact admin.',
            });
        }

        const isMatch = await bcrypt.compare(password, station.master_password);
        if (!isMatch) {
            return resp.status(200).json({ status: 0, code: 200, message: 'Invalid password' });
        }

        const token = jwt.sign(
            {
                id: station.id,
                station_id: station.station_id,
                email: station.master_email,
                role: 'partner_station_master',
            },
            process.env.JWT_SECRET,
            { expiresIn: '1h' }
        );

        resp.cookie('partnerStationAuthToken', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'None',
            maxAge: 3600000,
        });

        delete station.master_password;

        return resp.status(200).json({
            status: 1,
            code: 200,
            message: 'Login successful',
            userDetails: {
                station_id: station.station_id,
                station_name: station.station_name,
                email: station.master_email,
                city: station.city,
                country: station.country,
                address: station.address,
                contact_number: station.contact_number,
            },
            Token: process.env.CUSTOM_TOKEN,
        });
    } catch (error) {
        console.error('Station master login error:', error);
        return resp.status(500).json({
            status: 0,
            code: 500,
            message: 'Login failed',
            userDetails: {},
            Token: '',
        });
    }
};

export const logout = async (req, resp) => {
    const { email } = req.body;
    if (!email) {
        return resp.json({ status: 0, message: 'Email is required.' });
    }

    try {
        const [rows] = await db.execute(
            'SELECT id FROM partner_charging_stations WHERE master_email = ? AND status = 1',
            [email]
        );
        if (rows.length === 0) {
            return resp.json({ status: 0, message: 'Station master not found.' });
        }

        resp.clearCookie('partnerStationAuthToken');
        return resp.json({ status: 1, message: 'Logged out successfully.' });
    } catch (error) {
        console.error('Station master logout error:', error);
        return resp.json({ status: 0, message: 'Logout failed.' });
    }
};

export const stationDetails = asyncHandler(async (req, resp) => {
    const { station_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const [rows] = await db.execute(`
        SELECT
            station_id, station_name, station_type, operator_name, address, city, state_emirate,
            country, postal_code, latitude, longitude, contact_person, contact_number,
            operating_hours, admin_status, description, master_email,
            (SELECT COUNT(*) FROM partner_chargers WHERE station_id = ? AND status = 1) AS charger_count,
            ${formatDateTimeInQuery(['created_at', 'updated_at'])}
        FROM partner_charging_stations
        WHERE station_id = ? AND status = 1
        LIMIT 1
    `, [station_id, station_id]);

    if (rows.length === 0) {
        return resp.json({ status: 0, code: 404, message: 'Station not found.' });
    }

    return resp.json({
        status: 1,
        code: 200,
        message: ['Station details fetched successfully!'],
        data: rows[0],
    });
});