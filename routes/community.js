import { Router } from "express";
import { adminAuthorization } from "../middleware/admin/authorizeMiddleware.js";
import { authenticateCommunityManager } from "../middleware/community/authenticationMiddleware.js";

import { login, logout, getDashboardData } from "../controller/community/AuthController.js";
import { communityDetail } from "../controller/community/CommunityController.js";
import { residentList, residentDetail } from "../controller/community/ResidentController.js";

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
];

communityRoutes.forEach(({ method, path, handler }) => {
    router[method](path, adminAuthorization, authenticateCommunityManager, handler);
});

export default router;
