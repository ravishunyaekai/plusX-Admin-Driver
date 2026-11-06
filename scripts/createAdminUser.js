#!/usr/bin/env node
/**
 * Create an admin user row (backend-only; no UI).
 * Requires: users.is_super_admin, admin_modules, user_admin_modules (see sql/admin_user_module_access.sql).
 *
 * Usage:
 *   node scripts/createAdminUser.js --email a@b.com --password 'secret' --name 'Full Name' [--phone '+971...'] [--super]
 */
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import db from '../config/db.js';

dotenv.config();

function parseArgs(argv) {
  const out = { flags: {} };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--super') {
      out.flags.super = true;
      continue;
    }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (!val || val.startsWith('--')) {
        console.error(`Missing value for --${key}`);
        process.exit(1);
      }
      out[key.replace(/-/g, '_')] = val;
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv);
const email = args.email;
const password = args.password;
const name = args.name;
const phone = args.phone ?? '';
const isSuper = Boolean(args.flags?.super);

if (!email || !password || !name) {
  console.error(
    'Usage: node scripts/createAdminUser.js --email <email> --password <pwd> --name <name> [--phone <phone>] [--super]'
  );
  process.exit(1);
}

const hashed = await bcrypt.hash(password, 10);

try {
  const [existing] = await db.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
  if (existing.length > 0) {
    console.error(`User already exists: ${email} (id=${existing[0].id})`);
    process.exit(1);
  }

  const [result] = await db.execute(
    `INSERT INTO users (name, email, phone, password, image, department_id, status, is_super_admin, created_at, updated_at)
     VALUES (?, ?, ?, ?, '', NULL, 1, ?, NOW(), NOW())`,
    [name, email, phone, hashed, isSuper ? 1 : 0]
  );

  console.log(`Created admin user id=${result.insertId} email=${email} superAdmin=${isSuper}`);
  if (!isSuper) {
    console.log('Grant modules with: node scripts/manageAdminModules.js --email ... --set <module_keys>');
  }
  process.exit(0);
} catch (err) {
  console.error(err.message || err);
  if (err.code === 'ER_BAD_FIELD_ERROR') {
    console.error('Did you apply sql/admin_user_module_access.sql (is_super_admin, admin_modules, user_admin_modules)?');
  }
  process.exit(1);
}
