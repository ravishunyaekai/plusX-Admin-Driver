-- Offline RSA: Not Converted (NC) for is_booking_completed = 'No' (30-10-2026)
-- Migrate legacy Confirmed (CNF) on incomplete bookings to Not Converted (NC).

UPDATE rsa_offline_booking
SET order_status = 'NC'
WHERE is_booking_completed = 'No'
  AND order_status = 'CNF';

UPDATE rsa_offline_order_history AS h
JOIN rsa_offline_booking AS b ON b.request_id = h.order_id
SET h.order_status = 'NC'
WHERE b.is_booking_completed = 'No'
  AND h.order_status = 'CNF';
