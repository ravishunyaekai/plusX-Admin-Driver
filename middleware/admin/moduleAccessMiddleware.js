import {
  ADMIN_ROUTE_TO_MODULE,
  ADMIN_MODULE_EXEMPT_PATHS,
} from '../../constants/adminModules.js';

/**
 * Enforces module access after `authenticateAdmin` has set `req.adminAccess`.
 * Super admins pass; exempt paths pass; otherwise route must map to a module the user has.
 */
export const requireAdminModule = (req, resp, next) => {
  const access = req.adminAccess;
  if (!access) {
    return resp.status(500).json({
      status: 500,
      message: 'Admin access not loaded',
    });
  }
  if (access.isSuperAdmin) {
    return next();
  }

  const path = req.route?.path != null ? req.route.path : '';
  if (!path.startsWith('/')) {
    return resp.status(500).json({
      status: 500,
      message: 'Module check: invalid route path',
    });
  }

  if (ADMIN_MODULE_EXEMPT_PATHS.has(path)) {
    return next();
  }

  const moduleKey = ADMIN_ROUTE_TO_MODULE[path];
  if (!moduleKey) {
    return resp.status(403).json({
      status: 403,
      message: 'This action is not permitted for your role.',
    });
  }

  if (!access.moduleKeySet.has(moduleKey)) {
    return resp.status(403).json({
      status: 403,
      message: 'You do not have access to this module.',
    });
  }

  next();
};
