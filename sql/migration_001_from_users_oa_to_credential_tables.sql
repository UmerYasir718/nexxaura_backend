-- Run once on existing DBs that had office_ally_* on users
ALTER TABLE users DROP COLUMN IF EXISTS office_ally_username;
ALTER TABLE users DROP COLUMN IF EXISTS office_ally_password;

CREATE TABLE IF NOT EXISTS office_ally_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS availity_credentials (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE sync_requests
  ADD COLUMN IF NOT EXISTS current_stage TEXT;

ALTER TABLE sync_requests
  DROP CONSTRAINT IF EXISTS sync_requests_status_check;
ALTER TABLE sync_requests
  ADD CONSTRAINT sync_requests_status_check
  CHECK (status IN ('pending', 'running', 'awaiting_otp', 'success', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_one_active_sync_per_user
  ON sync_requests (user_id)
  WHERE (status = ANY (ARRAY['running', 'awaiting_otp']::text[]));

CREATE TABLE IF NOT EXISTS availity_eligibility_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    coverage_rank SMALLINT NOT NULL DEFAULT 1,
    payer_name_used TEXT,
    member_id_used TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    message TEXT
);

CREATE TABLE IF NOT EXISTS availity_eligibility_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    run_id UUID NOT NULL REFERENCES availity_eligibility_runs (id) ON DELETE CASCADE,
    coverage_status_text TEXT,
    is_active BOOLEAN,
    member_id TEXT,
    payer_id TEXT,
    patient_name_on_file TEXT,
    benefit_line TEXT,
    date_of_service TEXT,
    transaction_date TEXT,
    insurance_type TEXT,
    plan_product TEXT,
    coverage_level TEXT,
    raw_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
