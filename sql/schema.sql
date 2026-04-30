CREATE EXTENSION
IF NOT EXISTS "uuid-ossp";

CREATE TABLE
IF NOT EXISTS users
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff' CHECK
(role IN
('admin', 'doctor', 'staff', 'reception')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
()
);

-- Per-integration credentials (separate from app login)
CREATE TABLE
IF NOT EXISTS office_ally_credentials
(
    user_id UUID PRIMARY KEY REFERENCES users
(id) ON
DELETE CASCADE,
    company_name TEXT,
    title TEXT,
    description TEXT,
    name TEXT,
    username TEXT
NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
()
);

CREATE TABLE
IF NOT EXISTS availity_credentials
(
    user_id UUID PRIMARY KEY REFERENCES users
(id) ON
DELETE CASCADE,
    company_name TEXT,
    title TEXT,
    description TEXT,
    name TEXT,
    username TEXT
NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
()
);

-- overall_status: running = work in progress; awaiting_otp = waiting for user MFA from API
CREATE TABLE
IF NOT EXISTS sync_requests
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    user_id UUID NOT NULL REFERENCES users
(id) ON
DELETE CASCADE,
    appointment_date DATE
NOT NULL,
    current_stage TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK
(
        status IN
('pending', 'running', 'awaiting_otp', 'success', 'failed')
    ),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
()
);

CREATE TABLE
IF NOT EXISTS patients
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    user_id UUID NOT NULL REFERENCES users
(id) ON
DELETE CASCADE,
    pm_patient_id TEXT
NOT NULL,
    first_name TEXT,
    last_name TEXT,
    date_of_birth DATE,
    phone_primary TEXT,
    email TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    UNIQUE
(user_id, pm_patient_id)
);

CREATE TABLE
IF NOT EXISTS patient_insurance
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    patient_id UUID NOT NULL REFERENCES patients
(id) ON
DELETE CASCADE,
    coverage_rank SMALLINT
NOT NULL DEFAULT 1,
    payer_name TEXT,
    member_id TEXT,
    plan_name TEXT,
    group_number TEXT,
    relationship TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    UNIQUE
(patient_id, coverage_rank)
);

CREATE TABLE
IF NOT EXISTS appointments
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    sync_request_id UUID NOT NULL REFERENCES sync_requests
(id) ON
DELETE CASCADE,
    user_id UUID
NOT NULL REFERENCES users
(id) ON
DELETE CASCADE,
    pm_appointment_id TEXT
NOT NULL,
    patient_id UUID NOT NULL REFERENCES patients
(id) ON
DELETE CASCADE,
    appointment_date DATE
NOT NULL,
    starts_at TIMESTAMPTZ,
    provider_name TEXT,
    status TEXT,
    reason TEXT,
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    UNIQUE
(user_id, pm_appointment_id)
);

CREATE TABLE
IF NOT EXISTS availity_eligibility_runs
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    user_id UUID NOT NULL REFERENCES users
(id) ON
DELETE CASCADE,
    patient_id UUID
NOT NULL REFERENCES patients
(id) ON
DELETE CASCADE,
    coverage_rank SMALLINT
NOT NULL DEFAULT 1,
    payer_name_used TEXT,
    member_id_used TEXT,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW
(),
    finished_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running' CHECK
(status IN
('running', 'success', 'failed')),
    message TEXT
);

CREATE INDEX
IF NOT EXISTS idx_availity_runs_user_patient
    ON availity_eligibility_runs
(user_id, patient_id, started_at DESC);

CREATE TABLE
IF NOT EXISTS availity_eligibility_results
(
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4
(),
    run_id UUID NOT NULL REFERENCES availity_eligibility_runs
(id) ON
DELETE CASCADE,
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
    copay_amount NUMERIC
(12,2),
    deductible_amount NUMERIC
(12,2),
    coinsurance TEXT,
    oop_remaining NUMERIC
(12,2),
    raw_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW
()
);

CREATE INDEX
IF NOT EXISTS idx_availity_results_run ON availity_eligibility_results
(run_id);

CREATE INDEX
IF NOT EXISTS idx_sync_user_active
    ON sync_requests
(user_id) WHERE status IN
('running', 'awaiting_otp');

-- At most one active sync per user (avoids double POST race without advisory locks)
CREATE UNIQUE INDEX
IF NOT EXISTS uq_one_active_sync_per_user
  ON sync_requests
(user_id)
  WHERE
(status = ANY
(ARRAY['running', 'awaiting_otp']::text[]));
