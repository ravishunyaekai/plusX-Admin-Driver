import db from '../config/db.js';
import { ADMIN_MODULES, ADMIN_MODULE_KEYS } from '../constants/adminModules.js';

/**
 * Labels from DB (`admin_modules`) when available; fallback to `ADMIN_MODULES` in code.
 * @param {string} key
 * @param {string} [dbLabel]
 */
function labelForKey(key, dbLabel) {
  if (dbLabel) return dbLabel;
  const fromConstants = ADMIN_MODULES.find((m) => m.key === key);
  return fromConstants ? fromConstants.label : key;
}

/**
 * @param {number} userId
 * @returns {Promise<{ isSuperAdmin: boolean, moduleKeys: string[], modules: { key: string, label: string }[] }>}
 */
export async function fetchAdminAccessForUser(userId) {
  const [[userRow]] = await db.execute(
    'SELECT COALESCE(is_super_admin, 0) AS is_super_admin FROM users WHERE id = ? LIMIT 1',
    [userId]
  );
  if (!userRow) {
    return { isSuperAdmin: false, moduleKeys: [], modules: [] };
  }
  const isSuperAdmin = Number(userRow.is_super_admin) === 1;

  if (isSuperAdmin) {
    const [rows] = await db.execute(
      'SELECT module_key, label FROM admin_modules ORDER BY sort_order ASC, id ASC'
    );
    const modules = rows.map((r) => ({
      key: r.module_key,
      label: labelForKey(r.module_key, r.label),
    }));
    const moduleKeys = modules.map((m) => m.key);
    return { isSuperAdmin: true, moduleKeys, modules };
  }

  const [rows] = await db.execute(
    `SELECT m.module_key, m.label
     FROM user_admin_modules u
     INNER JOIN admin_modules m ON m.id = u.module_id
     WHERE u.user_id = ?
     ORDER BY m.sort_order ASC, m.id ASC`,
    [userId]
  );
  let modules = rows.map((r) => ({
    key: r.module_key,
    label: labelForKey(r.module_key, r.label),
  }));
  modules = modules.filter((m) => ADMIN_MODULE_KEYS.has(m.key));
  const moduleKeys = modules.map((m) => m.key);
  return { isSuperAdmin: false, moduleKeys, modules };
}
