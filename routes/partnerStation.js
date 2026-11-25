import { Router } from 'express';
import { adminAuthorization } from '../middleware/admin/authorizeMiddleware.js';
import { authenticateStationMaster } from '../middleware/partnerStation/authenticationMiddleware.js';

import { login, logout, stationDetails, getDashboardData } from '../controller/partnerStation/AuthController.js';
import { chargerList, chargerDetails } from '../controller/partnerStation/ChargerController.js';
import { sessionList, sessionDetails } from '../controller/partnerStation/SessionController.js';
import { alertList, alertDetails } from '../controller/partnerStation/AlertController.js';

const router = Router();

const partnerStationAuthRoutes = [
    { method: 'post', path: '/login', handler: login },
];

partnerStationAuthRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, handler);
});

const partnerStationRoutes = [
    { method: 'post', path: '/logout', handler: logout },
    { method: 'post', path: '/dashboard', handler: getDashboardData },
    { method: 'post', path: '/station-details', handler: stationDetails },
    { method: 'post', path: '/charger-list', handler: chargerList },
    { method: 'post', path: '/charger-details', handler: chargerDetails },
    { method: 'post', path: '/session-list', handler: sessionList },
    { method: 'post', path: '/session-details', handler: sessionDetails },
    { method: 'post', path: '/alert-list', handler: alertList },
    { method: 'post', path: '/alert-details', handler: alertDetails },
];

partnerStationRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, authenticateStationMaster, handler);
});

export default router;