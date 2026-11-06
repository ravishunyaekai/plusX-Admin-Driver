# Dubai admin panel — module-wise access (backend-managed)

- **Super Admin** (`users.is_super_admin = 1`): all modules, all routes.
- **Limited admin**: one or many modules via **`user_admin_modules`** (joins to **`admin_modules`** by `module_id`).

## Database

Canonical reference DDL lives in `sql/admin_user_module_access.sql` (adjust if your live `users` table already differs).

- `users.is_super_admin` — place per your migration (e.g. after `department_id`).
- `admin_modules` — catalogue (`module_key`, `label`, `sort_order`).
- `user_admin_modules` — `(user_id, module_id)` unique; user may have **multiple** rows.

Example grant (by keys):

```sql
INSERT INTO user_admin_modules (user_id, module_id)
SELECT 42, id FROM admin_modules WHERE module_key IN ('dashboard', 'charger_installation');
```

## Module keys (must match `admin_modules.module_key`)

`dashboard`, `app_signup`, `drivers`, `portable_charger`, `pick_drop`, `ev_road_assistance`, `ev_insurance`, `public_chargers`, `charger_installation`, `community_charger`, `vendor_charging`, `charge_share`, `coupon`, `offer`.

Route → module mapping is in `constants/adminModules.js` (`ADMIN_ROUTE_TO_MODULE`). New admin routes must be listed there.

## CLI (no frontend)

```bash
node scripts/createAdminUser.js --email ops@example.com --password '...' --name 'Ops User'
node scripts/createAdminUser.js --email admin@example.com --password '...' --name 'Super' --super

node scripts/manageAdminModules.js --email ops@example.com --list
node scripts/manageAdminModules.js --email admin@example.com --super
node scripts/manageAdminModules.js --email ops@example.com --not-super --set charger_installation,dashboard
node scripts/manageAdminModules.js --email ops@example.com --add coupon
node scripts/hashPassword.js 'YourPassword'
```

`--super` clears `user_admin_modules` for that user (access comes only from the flag).

## API

- **`POST /admin/login`**: `adminAccess.modules` is `{ key, label }[]` from **`admin_modules`** (labels follow DB).
- Other `/admin` routes: **403** if the route’s module is not allowed (unless Super Admin).
