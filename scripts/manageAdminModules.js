#!/usr/bin/env node
/**
 * Manage module access for an admin user (backend-only).
 * Schema: `admin_modules`, `user_admin_modules` (FK to admin_modules.id), `users.is_super_admin`.
 *
 * Examples:
 *   node scripts/manageAdminModules.js --email x@y.com --super
 *   node scripts/manageAdminModules.js --email x@y.com --not-super --set charger_installation,dashboard
 *   node scripts/manageAdminModules.js --user-id 12 --add coupon --remove offer
 *   node scripts/manageAdminModules.js --email x@y.com --list
 */
import dotenv from 'dotenv';
import db from '../config/db.js';
import { ADMIN_MODULE_KEYS, ADMIN_MODULES } from '../constants/adminModules.js';

dotenv.config();

function parseArgs(argv) {
  const out = { flags: {}, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--super') {
      out.flags.super = true;
      continue;
    }
    if (a === '--not-super') {
      out.flags.notSuper = true;
      continue;
    }
    if (a === '--list') {
      out.list = true;
      continue;
    }
    if (!a.startsWith('--')) continue;
    const key = a.slice(2).replace(/-/g, '_');
    const val = argv[i + 1];
    if (key === 'set' || key === 'add' || key === 'remove') {
      if (!val || val.startsWith('--')) {
        console.error(`Missing value for --${a.slice(2)}`);
        process.exit(1);
      }
      out[key] = val.split(',').map((s) => s.trim()).filter(Boolean);
      i++;
      continue;
    }
    if (!val || val.startsWith('--')) {
      console.error(`Missing value for --${a.slice(2)}`);
      process.exit(1);
    }
    out[key] = val;
    i++;
  }
  return out;
}

function validateKeys(keys, label) {
  for (const k of keys) {
    if (!ADMIN_MODULE_KEYS.has(k)) {
      console.error(`Invalid module key in ${label}: ${k}`);
      console.error('Valid keys:', [...ADMIN_MODULE_KEYS].sort().join(', '));
      process.exit(1);
    }
  }
}

async function moduleIdsForKeys(keys) {
  if (keys.length === 0) return [];
  const ph = keys.map(() => '?').join(',');
  const [rows] = await db.execute(
    `SELECT id, module_key FROM admin_modules WHERE module_key IN (${ph})`,
    keys
  );
  const byKey = Object.fromEntries(rows.map((r) => [r.module_key, r.id]));
  const missing = keys.filter((k) => byKey[k] == null);
  if (missing.length) {
    console.error('Unknown module_key in admin_modules:', missing.join(', '));
    process.exit(1);
  }
  return keys.map((k) => byKey[k]);
}

const args = parseArgs(process.argv);
const email = args.email;
const userId = args.user_id ? Number(args.user_id) : null;

if ((!email && !userId) || (email && userId)) {
  console.error('Specify exactly one of --email <email> or --user-id <id>');
  process.exit(1);
}

const wantsChange =
  args.flags?.super ||
  args.flags?.notSuper ||
  (args.set && args.set.length) ||
  (args.add && args.add.length) ||
  (args.remove && args.remove.length);

if (!args.list && !wantsChange) {
  console.error('Provide --list or a change: --super | --not-super | --set | --add | --remove');
  process.exit(1);
}

if (args.flags?.super && args.flags?.notSuper) {
  console.error('Use only one of --super and --not-super');
  process.exit(1);
}

if (args.set) validateKeys(args.set, '--set');
if (args.add) validateKeys(args.add, '--add');
if (args.remove) validateKeys(args.remove, '--remove');

try {
  let uid = userId;
  if (email) {
    const [rows] = await db.execute(
      'SELECT id, email, COALESCE(is_super_admin,0) AS is_super_admin FROM users WHERE email = ? LIMIT 1',
      [email]
    );
    if (rows.length === 0) {
      console.error('User not found:', email);
      process.exit(1);
    }
    uid = rows[0].id;
  }

  const [userRows] = await db.execute(
    'SELECT id, email, COALESCE(is_super_admin,0) AS is_super_admin FROM users WHERE id = ? LIMIT 1',
    [uid]
  );
  if (userRows.length === 0) {
    console.error('User not found, id=', uid);
    process.exit(1);
  }
  const u = userRows[0];

  const labelFallback = Object.fromEntries(ADMIN_MODULES.map((m) => [m.key, m.label]));

  if (args.list || !wantsChange) {
    const [mods] = await db.execute(
      `SELECT m.module_key, m.label, m.sort_order
       FROM user_admin_modules u
       INNER JOIN admin_modules m ON m.id = u.module_id
       WHERE u.user_id = ?
       ORDER BY m.sort_order ASC, m.id ASC`,
      [uid]
    );
    console.log(JSON.stringify({
      id: u.id,
      email: u.email,
      isSuperAdmin: Number(u.is_super_admin) === 1,
      moduleKeys: mods.map((r) => r.module_key),
      modules: mods.map((r) => ({
        key: r.module_key,
        label: r.label || labelFallback[r.module_key] || r.module_key,
      })),
    }, null, 2));
    if (!wantsChange) process.exit(0);
  }

  if (args.flags?.super) {
    await db.execute('UPDATE users SET is_super_admin = 1 WHERE id = ?', [uid]);
    await db.execute('DELETE FROM user_admin_modules WHERE user_id = ?', [uid]);
    console.log(`User ${u.email} (id=${uid}) is now Super Admin (user_admin_modules cleared).`);
  } else if (args.flags?.notSuper) {
    await db.execute('UPDATE users SET is_super_admin = 0 WHERE id = ?', [uid]);
    console.log(`User ${u.email} (id=${uid}) is not Super Admin.`);
  }

  if (args.set && args.set.length) {
    await db.execute('UPDATE users SET is_super_admin = 0 WHERE id = ?', [uid]);
    await db.execute('DELETE FROM user_admin_modules WHERE user_id = ?', [uid]);
    const ids = await moduleIdsForKeys(args.set);
    for (const mid of ids) {
      await db.execute(
        'INSERT INTO user_admin_modules (user_id, module_id) VALUES (?, ?)',
        [uid, mid]
      );
    }
    console.log(`Set modules for ${u.email}: ${args.set.join(', ')}`);
  } else {
    if (args.add && args.add.length) {
      await db.execute('UPDATE users SET is_super_admin = 0 WHERE id = ?', [uid]);
      const ids = await moduleIdsForKeys(args.add);
      for (const mid of ids) {
        await db.execute(
          'INSERT IGNORE INTO user_admin_modules (user_id, module_id) VALUES (?, ?)',
          [uid, mid]
        );
      }
      console.log(`Added modules for ${u.email}: ${args.add.join(', ')}`);
    }
    if (args.remove && args.remove.length) {
      const ids = await moduleIdsForKeys(args.remove);
      const ph = ids.map(() => '?').join(',');
      await db.execute(
        `DELETE FROM user_admin_modules WHERE user_id = ? AND module_id IN (${ph})`,
        [uid, ...ids]
      );
      console.log(`Removed modules for ${u.email}: ${args.remove.join(', ')}`);
    }
  }

  process.exit(0);
} catch (err) {
  console.error(err.message || err);
  if (err.code === 'ER_BAD_FIELD_ERROR' || err.code === 'ER_NO_SUCH_TABLE') {
    console.error('Ensure admin_modules and user_admin_modules exist (see sql/admin_user_module_access.sql).');
  }
  process.exit(1);
}
