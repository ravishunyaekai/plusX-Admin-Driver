#!/usr/bin/env node
/**
 * Print a bcrypt hash for use when inserting/updating admin users via SQL.
 * Usage: node scripts/hashPassword.js 'YourPlainPassword'
 */
import bcrypt from 'bcryptjs';

const plain = process.argv[2];
if (!plain) {
  console.error('Usage: node scripts/hashPassword.js <plain-password>');
  process.exit(1);
}

const hash = await bcrypt.hash(plain, 10);
console.log(hash);
