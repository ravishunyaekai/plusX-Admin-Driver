import { Router } from 'express';
import { adminAuthorization } from '../middleware/admin/authorizeMiddleware.js';
import { authenticateStationMaster } from '../middleware/partnerStation/authenticationMiddleware.js';

import { login, logout, stationDetails } from '../controller/partnerStation/AuthController.js';
import { chargerList, chargerDetail } from '../controller/partnerStation/ChargerController.js';

const router = Router();

const partnerStationAuthRoutes = [
    { method: 'post', path: '/login', handler: login },
];

partnerStationAuthRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, handler);
});

// Station Master panel scope: auth + station profile + chargers only (no sessions/alerts/IoT).
const partnerStationRoutes = [
    { method: 'post', path: '/logout', handler: logout },
    { method: 'post', path: '/station-details', handler: stationDetails },
    { method: 'post', path: '/charger-list', handler: chargerList },
    { method: 'post', path: '/charger-details', handler: chargerDetail },
];

partnerStationRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, authenticateStationMaster, handler);
});

export default router;