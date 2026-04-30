-- Add metadata fields for Office Ally / Availity credential settings payload.
-- Safe to run multiple times.

ALTER TABLE office_ally_credentials
  ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE office_ally_credentials
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE office_ally_credentials
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE office_ally_credentials
  ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE office_ally_credentials
  DROP COLUMN IF EXISTS username_or_email;

ALTER TABLE availity_credentials
  ADD COLUMN IF NOT EXISTS company_name TEXT;

ALTER TABLE availity_credentials
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE availity_credentials
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE availity_credentials
  ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE availity_credentials
  DROP COLUMN IF EXISTS username_or_email;
