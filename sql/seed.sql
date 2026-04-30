INSERT INTO users (email, full_name, password_hash, role)
VALUES
  (
    'demo@nexxaura.com',
    'Demo User',
    '$2b$10$6G8DjeR65W1.4jYjMJr7BOOAkahhuCo9T11y.6YWItNG0WEM.t/ia',
    'doctor'
  ),
  (
    'admin@nexxaura.com',
    'Administrator',
    '$2b$10$JU0TpskoVUFqBU2TX4TBXO96a8ycgmb.8.w/9zwSc.Msmvqqg55j.',
    'admin'
  )
ON CONFLICT (email) DO UPDATE SET
  full_name = EXCLUDED.full_name,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  updated_at = NOW();

INSERT INTO office_ally_credentials
  (user_id, company_name, title, description, name, username, password)
SELECT
  u.id,
  'Office Ally',
  'Office Ally EHR',
  'Demo Office Ally credential',
  'Demo User',
  'OA_DEMO_USER',
  'OA_DEMO_PASSWORD'
FROM users u WHERE u.email = 'demo@nexxaura.com'
ON CONFLICT (user_id) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  name = EXCLUDED.name,
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  updated_at = NOW();

INSERT INTO availity_credentials
  (user_id, company_name, title, description, name, username, password)
SELECT
  u.id,
  'Availity',
  'Availity Payer Portal',
  'Demo Availity credential',
  'Demo User',
  'AVAILITY_DEMO_USER',
  'AVAILITY_DEMO_PASSWORD'
FROM users u WHERE u.email = 'demo@nexxaura.com'
ON CONFLICT (user_id) DO UPDATE SET
  company_name = EXCLUDED.company_name,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  name = EXCLUDED.name,
  username = EXCLUDED.username,
  password = EXCLUDED.password,
  updated_at = NOW();
