import { Router } from "express";
import { adminAuthorization } from "../middleware/admin/authorizeMiddleware.js";
import { authenticateCommunityManager } from "../middleware/community/authenticationMiddleware.js";

import { login, logout, getDashboardData } from "../controller/community/AuthController.js";
import { communityDetail } from "../controller/community/CommunityController.js";
import { residentList, residentDetail } from "../controller/community/ResidentController.js";
import { bookingList, bookingDetail } from "../controller/community/BookingController.js";
import { chargerList, chargerDetail } from "../controller/community/ChargerController.js";
import { invoiceList, invoiceDetail } from "../controller/community/InvoiceController.js";

const router = Router();

// Public / auth-key only routes (no manager session required)
const communityAuthRoutes = [
    { method: 'post', path: '/login',  handler: login },
];

communityAuthRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, handler);
});

// Protected routes — require API auth key + community manager authentication
const communityRoutes = [
    { method: 'post', path: '/logout',            handler: logout },
    { method: 'post', path: '/dashboard',         handler: getDashboardData },
    { method: 'post', path: '/community-details', handler: communityDetail },
    { method: 'post', path: '/resident-list',     handler: residentList },
    { method: 'post', path: '/resident-details',  handler: residentDetail },

    { method: 'post', path: '/booking-list',     handler: bookingList },
    { method: 'post', path: '/booking-details',  handler: bookingDetail },

    { method: 'post', path: '/community-charger-list',    handler: chargerList },
    { method: 'post', path: '/community-charger-details', handler: chargerDetail },

    { method: 'post', path: '/invoice-list',               handler: invoiceList },
    { method: 'post', path: '/invoice-details',            handler: invoiceDetail },
];

communityRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, authenticateCommunityManager, handler);
});

export default router;
