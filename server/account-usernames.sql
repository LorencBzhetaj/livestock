BEGIN;
UPDATE livestock_sync.accounts SET username=CASE role WHEN 'ADMIN' THEN 'adi' ELSE 'vet' END;
ALTER TABLE livestock_sync.accounts ADD CONSTRAINT account_role_username
 CHECK ((role='ADMIN' AND username='adi') OR (role='VETERINARIAN' AND username='vet'));
COMMIT;
