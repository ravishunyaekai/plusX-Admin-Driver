import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import db from '../../config/db.js';
import { formatDateTimeInQuery, mergeParam, asyncHandler } from '../../utils.js';
import validateFields from '../../validation.js';
import { assertStationScope } from '../../middleware/partnerStation/authenticationMiddleware.js';
import { enrichPartnerStationRecord } from '../admin/PartnerChargerController.js';

const DASHBOARD_COUNT_CARD_META = [
    { key: 'total_chargers', label: 'Total Chargers' },
    { key: 'available_chargers', label: 'Available Chargers' },
    { key: 'connection_pending', label: 'Connection Pending' },
    { key: 'faulty_chargers', label: 'Faulty Chargers' },
];

const dashboardCount = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
};

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
                id, station_id, station_name, manager_email, manager_password,
                station_status, emirates, address, country_code, manager_contact_no, status,
                ${formatDateTimeInQuery(['created_at', 'updated_at'])}
            FROM partner_charging_stations
            WHERE manager_email = ? AND status = 1
            LIMIT 1
        `, [email]);

        if (rows.length === 0) {
            return resp.status(200).json({ status: 0, code: 200, message: 'Invalid email' });
        }

        const station = rows[0];

        if (station.station_status && station.station_status !== 'Active') {
            return resp.status(200).json({
                status: 0,
                code: 200,
                message: 'Station account is inactive. Please contact admin.',
            });
        }

        const isMatch = await bcrypt.compare(password, station.manager_password);
        if (!isMatch) {
            return resp.status(200).json({ status: 0, code: 200, message: 'Invalid password' });
        }

        const token = jwt.sign(
            {
                id: station.id,
                station_id: station.station_id,
                email: station.manager_email,
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

        delete station.manager_password;

        return resp.status(200).json({
            status: 1,
            code: 200,
            message: 'Login successful',
            userDetails: {
                station_id: station.station_id,
                station_name: station.station_name,
                email: station.manager_email,
                emirates: station.emirates,
                address: station.address,
                country_code: station.country_code,
                manager_contact_no: station.manager_contact_no,
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
            'SELECT id FROM partner_charging_stations WHERE manager_email = ? AND status = 1',
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
            station_id, station_name, station_type, emirates, address, latitude, longitude,
            manager_name, manager_email, country_code, manager_contact_no,
            operating_hours, station_status,
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
        data: enrichPartnerStationRecord(rows[0]),
    });
});

/** Station master dashboard — charger counts + map pin for the logged-in station. */
export const getDashboardData = asyncHandler(async (req, resp) => {
    const { station_id } = mergeParam(req);
    const { isValid, errors } = validateFields(mergeParam(req), { station_id: ['required'] });
    if (!isValid) return resp.json({ status: 0, code: 422, message: errors });
    if (!assertStationScope(req, station_id, resp)) return;

    const sid = String(station_id).trim();

    const [countRows] = await db.execute(`
        SELECT
            COUNT(*) AS total_chargers,
            COALESCE(SUM(charger_status = 'Available'), 0) AS available_chargers,
            COALESCE(SUM(charger_status = 'Connection Pending'), 0) AS connection_pending,
            COALESCE(SUM(charger_status = 'Faulty'), 0) AS faulty_chargers
        FROM partner_chargers
        WHERE station_id = ? AND status = 1
    `, [sid]);

    const [stationRows] = await db.execute(`
        SELECT
            ps.station_id, ps.station_name, ps.emirates, ps.station_status,
            ps.latitude, ps.longitude,
            (SELECT COUNT(*) FROM partner_chargers AS pc
                WHERE pc.station_id = ps.station_id AND pc.status = 1) AS charger_count
        FROM partner_charging_stations AS ps
        WHERE ps.station_id = ? AND ps.status = 1
        LIMIT 1
    `, [sid]);

    if (!stationRows.length) {
        return resp.json({ status: 0, code: 404, message: 'Station not found.' });
    }

    const raw = countRows[0] || {};
    const counts = {
        total_chargers: dashboardCount(raw.total_chargers),
        available_chargers: dashboardCount(raw.available_chargers),
        connection_pending: dashboardCount(raw.connection_pending),
        faulty_chargers: dashboardCount(raw.faulty_chargers),
    };

    const count_cards = DASHBOARD_COUNT_CARD_META.map(({ key, label }) => ({
        key,
        label,
        count: counts[key],
    }));

    const stations = stationRows
        .filter((row) => row.latitude != null && row.longitude != null)
        .map((row) => {
            const lat = Number(row.latitude);
            const lng = Number(row.longitude);
            return {
                station_id: row.station_id,
                station_name: row.station_name,
                emirates: row.emirates,
                station_status: row.station_status,
                charger_count: dashboardCount(row.charger_count),
                latitude: lat,
                longitude: lng,
                location: { lat, lng },
            };
        });

    return resp.json({
        status: 1,
        code: 200,
        message: ['Partner chargers dashboard fetched successfully!'],
        data: {
            counts,
            count_cards,
            stations,
        },
    });
});