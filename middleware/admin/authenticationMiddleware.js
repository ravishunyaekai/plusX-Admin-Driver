import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import db from "../../config/db.js";
import { fetchAdminAccessForUser } from '../../utils/adminModuleAccess.js';
dotenv.config();

// export const authorizeUser = (req, resp, next) => {
//   console.log(req.body);
//   const userId = req.body.userId;
//   const token = req.headers["access_token"];

//   if (!token) {
//     return resp.status(401).json({ message: 'Access token is missing' });
//   }
  
//   db.execute("SELECT * from users where id=? AND access_token=?", [userId, token])
//     .then(([rows]) => {
//       if (rows.length === 0) {
//         return resp.status(403).json({ message: "Unauthorized access" });
//       }
//       next();
//     })
//     .catch((err) => {
//       console.error(err);
//       resp.status(500).json({ message: "Database error" });
//     });
// };


export const authenticateAdmin = async (req, resp, next) => {
    const userId = req.body.userId;
    const email  = req.body.email
    const token  = req.headers["accesstoken"];
    // console.log('body', req.body)

    if (!token) {
        return resp.json({ status : 401, message: 'Access token is missing' });
    }
    if (token !== process.env.CUSTOM_TOKEN) {
        return resp.status(403).json({ status : 403, message: "Unauthorized access" });
    }
    try {
        const [rows] = await db.execute("SELECT * FROM users WHERE id = ? AND email = ? AND status = 1", [userId, email]);

        if (rows.length === 0) {
            return resp.json({ status : 403, message: "Unauthorized access or invalid user status" });
        }
        const adminUser = rows[0];
        let access;
        try {
            access = await fetchAdminAccessForUser(adminUser.id);
        } catch (accessErr) {
            console.error('Error loading admin module access:', accessErr);
            if (accessErr.code === 'ER_BAD_FIELD_ERROR' || accessErr.code === 'ER_NO_SUCH_TABLE') {
                return resp.status(503).json({
                    status: 503,
                    message:
                        'Admin access is not configured. Ensure users.is_super_admin, admin_modules, and user_admin_modules exist (see sql/admin_user_module_access.sql).',
                });
            }
            throw accessErr;
        }
        req.adminUser = adminUser;
        req.adminAccess = {
            isSuperAdmin: access.isSuperAdmin,
            moduleKeys: access.moduleKeys,
            moduleKeySet: new Set(access.moduleKeys),
        };
        next();

    } catch (error) {
        console.error('Error in authentication:', error);
        return resp.json({ status : 500, message: "Internal server error" });
    }
};
export const authenticateAdminOld = async (req, resp, next) => {
  const userId = req.body.userId;
  const email  = req.body.email
  const token  = req.headers["accesstoken"];

  if (!token) {
    return resp.status(401).json({ message: 'Access token is missing' });
  }

  if (token !== process.env.CUSTOM_TOKEN) {
    return resp.status(403).json({ message: "Unauthorized access" });
  }

  try {
    const [rows] = await db.execute("SELECT * FROM users WHERE id = ? AND email = ? AND status = 1", [userId, email]);

    if (rows.length === 0) {
      return resp.status(403).json({ message: "Unauthorized access or invalid user status" });
    }

    next();

  } catch (error) {
    console.error('Error in authentication:', error);
    return resp.status(500).json({ message: "Internal server error" });
  }
};

export const authenticate = (req, res, next) => {
  console.log('Cookies:', req.cookies);
  const token = req.cookies.authToken; 
  console.log('req.cookies.authToken', token);
  
  if (!token) {
      return res.status(401).json({ message: "Unauthorized access" });
  }
  try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET); 
      req.user = decoded; 
      next(); 
  } catch (error) {
      return res.status(401).json({ message: "Invalid token" });
  }
};
