-- User roles: admin, doctor, staff, reception
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT;

UPDATE users SET role = 'staff' WHERE role IS NULL;

ALTER TABLE users
  ALTER COLUMN role SET DEFAULT 'staff';

ALTER TABLE users
  ALTER COLUMN role SET NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'doctor', 'staff', 'reception'));
