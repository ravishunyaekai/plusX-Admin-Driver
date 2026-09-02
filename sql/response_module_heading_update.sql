-- Update terms heading for portable charger and road assistance modules

UPDATE response_module
SET heading = 'Service Terms and Conditions:',
    updated_at = NOW()
WHERE name = 'portable-charger'
  AND heading = 'Before Booking, Please Note the Following';

UPDATE response_module
SET heading = 'Service Terms and Conditions:',
    updated_at = NOW()
WHERE name = 'road-assistance'
  AND heading = 'Before Booking, Please Note the Following';
