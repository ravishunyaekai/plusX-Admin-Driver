# Archive: Multi-Community Resident Design

**Archived:** 2026-08-31  
**Status:** Planning only — no code changes applied  
**Context:** Allow multi-select of communities when adding/editing a resident in `CommunityController.js`

---

## Requirement

Allow a resident to belong to **multiple communities** instead of a single `community_id` on `community_resident`.

---

## Approaches Considered

### ❌ JSON in `community_id` column

Example (invalid — user’s first idea):

```json
{ community_id: '213', community_name: 'dubai holding', community_id: 214, community_name: 'dubai new' }
```

Correct JSON array form would be:

```json
[
  { "community_id": "CMT0010", "community_name": "Downtown Dubai" },
  { "community_id": "CMT0011", "community_name": "Dubai Hills" }
]
```

**Why not store this in `community_id`:**

| Issue | Impact |
|--------|--------|
| Column meaning breaks | `community_id` becomes JSON, not an ID |
| Broken queries | `WHERE community_id = ?` and `JOIN cm.community_id = cr.community_id` fail |
| Denormalized names | `community_name` goes stale when renamed in `community_list` |
| Hard filtering | Needs `JSON_EXTRACT` / `JSON_CONTAINS` instead of simple equality |
| Manager portal | Resident list, counts, bookings, invoices assume single string ID |
| No integrity | DB cannot enforce that IDs exist |

If JSON were used anyway, store **IDs only** (`["CMT0010", "CMT0011"]`) and resolve names on read — still worse than a junction table.

### ❌ One `community_resident` row per community

Duplicates person data; mobile/email uniqueness becomes awkward.

### ✅ Junction table (recommended)

One resident profile row + many community links in a map table.

---

## Recommended Model

```
community_resident          → one row per person (profile, mobile, email, allocations…)
community_resident_map      → (resident_id, community_id) unique pair
community_list              → source of truth for names
```

- **Store:** only IDs in the map table
- **Return:** `{ community_id, community_name }` via JOIN to `community_list`
- **Do not** put JSON in `community_id`

Optional migration: keep existing `community_resident.community_id` as **primary/default** community, backfill map from it, deprecate later.

**API input (add/edit):**

```json
{ "community_ids": ["CMT0010", "CMT0011"] }
```

---

## Database Structure

### `community_list` (existing)

| id | community_id | community_name     | area_name | status |
|----|--------------|--------------------|-----------|--------|
| 1  | CMT0010      | Downtown Dubai     | Dubai     | 1      |
| 2  | CMT0011      | Dubai Hills        | Dubai     | 1      |
| 3  | CMT0012      | Arabian Ranches    | Dubai     | 1      |

### `community_resident` (existing — profile only)

| id | resident_id | community_id* | resident_name | resident_mobile | resident_email       | kwh_allocated | status |
|----|-------------|---------------|---------------|-----------------|----------------------|---------------|--------|
| 1  | RD0001      | CMT0010       | Ahmed Ali     | 501234567       | ahmed@mail.com       | 100           | 1      |
| 2  | RD0002      | CMT0011       | Sara Khan     | 509876543       | sara@mail.com        | 80            | 1      |
| 3  | RD0003      | CMT0010       | John Doe      | 505551234       | john@mail.com        | 120           | 1      |

\*Optional during migration: primary/default community. Stop using once everything reads from map.

### `community_resident_map` (new)

| id | resident_id | community_id |
|----|-------------|--------------|
| 1  | RD0001      | CMT0010      |
| 2  | RD0001      | CMT0011      |
| 3  | RD0002      | CMT0011      |
| 4  | RD0003      | CMT0010      |
| 5  | RD0003      | CMT0011      |
| 6  | RD0003      | CMT0012      |

**Membership meaning:**

- Ahmed → Downtown Dubai + Dubai Hills
- Sara → Dubai Hills only
- John → all three communities

### DDL

```sql
CREATE TABLE community_resident_map (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  resident_id  VARCHAR(50) NOT NULL,
  community_id VARCHAR(50) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_resident_community (resident_id, community_id),
  KEY idx_map_community (community_id),
  KEY idx_map_resident  (resident_id)
);
```

### Dummy inserts

```sql
INSERT INTO community_resident_map (resident_id, community_id) VALUES
('RD0001', 'CMT0010'),
('RD0001', 'CMT0011'),
('RD0002', 'CMT0011'),
('RD0003', 'CMT0010'),
('RD0003', 'CMT0011'),
('RD0003', 'CMT0012');
```

---

## Example Queries

### Communities for one resident

```sql
SELECT cl.community_id, cl.community_name, cl.area_name
FROM community_resident_map m
JOIN community_list cl ON cl.community_id = m.community_id
WHERE m.resident_id = 'RD0001';
```

Result: `CMT0010 / Downtown Dubai`, `CMT0011 / Dubai Hills`

### Residents in one community

```sql
SELECT r.resident_id, r.resident_name, r.resident_mobile
FROM community_resident r
JOIN community_resident_map m ON m.resident_id = r.resident_id
WHERE m.community_id = 'CMT0011';
```

Result: Ahmed, Sara, John

---

## API Response Shape (build via JOIN — do not persist)

```json
{
  "resident_id": "RD0001",
  "resident_name": "Ahmed Ali",
  "communities": [
    { "community_id": "CMT0010", "community_name": "Downtown Dubai" },
    { "community_id": "CMT0011", "community_name": "Dubai Hills" }
  ]
}
```

Object shape `{ community_id, community_name }` is fine for **API responses**, not for storage in `community_id`.

---

## Changes Required (when implementing)

### Database

- Create `community_resident_map`
- Migration: copy existing `community_resident.community_id` → map rows
- Decide: keep `community_id` column temporarily vs drop later

### Admin — `controller/admin/CommunityController.js`

- `addResident` — accept `community_ids[]`; insert resident + map rows; validate IDs exist
- `editResident` — sync map rows on update
- `residentList` — JOIN via map; filter with EXISTS/IN
- `residentDetail` — return `communities` array
- `residentSearch` — filter via map

### Community manager portal

- `controller/community/ResidentController.js` — list/detail via map
- `controller/community/AuthController.js` — resident counts via map
- `controller/community/BookingController.js` — resident-in-community checks via map
- `controller/community/InvoiceController.js` — JOIN/filter via map

### Bookings / `resident_data` snapshot

Bookings store single `resident_data.community_id` / `community_name` (JSON snapshot). Decide:

- Which community is stamped at booking time (usually charger’s community)
- Access: resident belongs to community via map; booking community stays session’s community
- Historical rows unchanged

### Invoices

- Manager scoping via map membership
- Clarify: one invoice per resident-month overall vs per community?

### Business rules to decide

- Allocations (`kwh_allocated`, sessions, charges) shared across communities or per community?
- Can managers of community A see resident also in B?
- Can resident book chargers in all linked communities?
- Primary community for invoices/UI labels?

If allocations are per community, junction table alone may not be enough — need per-community allocation fields or separate design.

### Frontend

- Multi-select on add/edit resident
- List/detail show multiple communities
- Payload: `community_ids: []` instead of single `community_id`

### Likely unchanged

- `community_list`, chargers, managers (one community each)
- Manager auth (one `community_id` per manager)
- Charger ↔ community mapping

---

## Verdict

**Best and most efficient:** junction table `community_resident_map` + JOIN for names. Do not store JSON objects in `community_id`.

---

## How to recall this archive

Ask in chat: *"show multi-community resident archive"* or *"show archived multi-community design"*

File path: `docs/archive/multi-community-resident-design.md`
