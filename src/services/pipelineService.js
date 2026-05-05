const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { chromium } = require('playwright');
const db = require('../config/db');
const env = require('../config/env');
const redis = require('../config/redis');
const { buildAvailityConfig } = require('../config/availityConfigForUser');
const { scrapeAppointmentsByDate } = require('../playwright/officeAllyClient');
const { availityLoginWithApiOtp } = require('../playwright/availityOtpFlow');
const { withAsyncTimeout } = require('../utils/withAsyncTimeout');
const cacheService = require('./cacheService');

function pickField(raw, pattern) {
  const key = Object.keys(raw).find((k) => pattern.test(k));
  return key ? raw[key] : null;
}

function toIsoDate(v) {
  const s = String(v || '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) {
    const mm = us[1].padStart(2, '0');
    const dd = us[2].padStart(2, '0');
    return `${us[3]}-${mm}-${dd}`;
  }
  return null;
}

function pickFirstNonEmpty(...values) {
  return values.find((v) => String(v || '').trim()) || null;
}

function parseMoney(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '');
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function findFirstByKeyRegexDeep(value, regex, depth = 0) {
  if (value == null || depth > 6) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const hit = findFirstByKeyRegexDeep(item, regex, depth + 1);
      if (hit != null && String(hit).trim() !== '') return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [k, v] of Object.entries(value)) {
    if (regex.test(String(k)) && v != null && String(v).trim() !== '') {
      return v;
    }
  }
  for (const nested of Object.values(value)) {
    const hit = findFirstByKeyRegexDeep(nested, regex, depth + 1);
    if (hit != null && String(hit).trim() !== '') return hit;
  }
  return null;
}

function extractFinancialFields(resultRow, snap) {
  const raw = (resultRow && resultRow.rawSnapshot) || (snap && snap.rawSnapshot) || snap || {};
  const copayRaw =
    resultRow?.copayAmount ??
    resultRow?.copay ??
    findFirstByKeyRegexDeep(raw, /(copay|co[_\s-]?pay|patient[_\s-]?responsibility)/i);
  const deductibleRaw =
    resultRow?.deductibleAmount ??
    resultRow?.deductible ??
    findFirstByKeyRegexDeep(raw, /(deductible)/i);
  const coinsuranceRaw =
    resultRow?.coinsurance ??
    findFirstByKeyRegexDeep(raw, /(coinsurance|co[_\s-]?insurance)/i);
  const oopRaw =
    resultRow?.oopRemaining ??
    resultRow?.outOfPocketRemaining ??
    findFirstByKeyRegexDeep(raw, /(oop[_\s-]?remaining|out[_\s-]?of[_\s-]?pocket.*remaining|remaining.*out[_\s-]?of[_\s-]?pocket)/i);

  return {
    copayAmount: parseMoney(copayRaw),
    deductibleAmount: parseMoney(deductibleRaw),
    coinsurance: coinsuranceRaw == null ? null : String(coinsuranceRaw).trim() || null,
    oopRemaining: parseMoney(oopRaw),
  };
}

function buildAppointmentStart(appointmentDate, timeValue) {
  const time = String(timeValue || '').trim();
  if (!time) return null;
  const normalized = /^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i.exec(time);
  if (!normalized) return null;
  let hour = Number(normalized[1]);
  const minute = Number(normalized[2]);
  const meridian = normalized[3] ? normalized[3].toUpperCase() : '';
  if (meridian === 'PM' && hour < 12) hour += 12;
  if (meridian === 'AM' && hour === 12) hour = 0;
  return `${appointmentDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function createLogger() {
  return {
    info: (...a) => console.log('[sync]', ...a),
    warn: (...a) => console.warn('[sync]', ...a),
    step: (a, b) => console.log('[sync]', a, b),
  };
}

async function loadEligibilityScraper() {
  const rel = process.env.ELIGIBILITY_SCRAPER_PATH;
  const candidates = [];
  if (rel) {
    const resolved = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    candidates.push(resolved);
    candidates.push(path.join(resolved, 'eligibilityScraper.js'));
    candidates.push(path.join(resolved, 'src', 'eligibilityScraper.js'));
  }
  candidates.push(
    path.join(process.cwd(), 'availity', 'src', 'eligibilityScraper.js'),
    path.join(process.cwd(), 'scripts', 'availity', 'src', 'eligibilityScraper.js'),
    path.join(process.cwd(), '..', 'availity', 'src', 'eligibilityScraper.js'),
    path.join(__dirname, '..', '..', 'availity', 'src', 'eligibilityScraper.js'),
    path.join(__dirname, '..', '..', 'scripts', 'availity', 'src', 'eligibilityScraper.js'),
    path.join(__dirname, '..', '..', '..', 'availity', 'src', 'eligibilityScraper.js'),
  );
  const absolute = candidates.find((p) => fs.existsSync(p));
  if (!absolute) {
    throw new Error(
      `Eligibility scraper not found. Checked: ${candidates.join(', ')}`,
    );
  }
  return import(pathToFileURL(absolute).href);
}

async function getOtpFromRedis(syncId) {
  const key = `sync:otp:${syncId}`;
  const deadline = Date.now() + 15 * 60 * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const v = await redis.get(key);
    if (v) {
      await redis.del(key);
      return String(v).trim();
    }
    if (Date.now() > deadline) {
      throw new Error('OTP not received in time (15m)');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function listPrimaryInsuranceForUser(userId, limit, appointmentDate = null, ids = {}) {
  const patientIds = ids.patientIds && ids.patientIds.length ? ids.patientIds : null;
  const appointmentIds = ids.appointmentIds && ids.appointmentIds.length ? ids.appointmentIds : null;
  const insuranceIds = ids.insuranceIds && ids.insuranceIds.length ? ids.insuranceIds : null;
  const { rows } = await db.query(
    `SELECT
        p.id AS patient_id,
        p.pm_patient_id,
        pi.id AS patient_insurance_id,
        to_char(p.date_of_birth::date, 'YYYY-MM-DD') AS date_of_birth,
        pi.coverage_rank,
        pi.payer_name,
        pi.member_id
      FROM patients p
      INNER JOIN patient_insurance pi
        ON pi.patient_id = p.id AND pi.coverage_rank = 1
      WHERE p.user_id = $1
        AND p.date_of_birth IS NOT NULL
        AND NULLIF(trim(pi.member_id), '') IS NOT NULL
        AND NULLIF(trim(pi.payer_name), '') IS NOT NULL
        AND (
          $3::date IS NULL OR EXISTS (
            SELECT 1
              FROM appointments a
             WHERE a.patient_id = p.id
               AND a.user_id = p.user_id
               AND a.appointment_date = $3::date
          )
        )
        AND ($4::uuid[] IS NULL OR p.id = ANY($4::uuid[]))
        AND (
          $5::uuid[] IS NULL OR EXISTS (
            SELECT 1
              FROM appointments a
             WHERE a.id = ANY($5::uuid[])
               AND a.patient_id = p.id
               AND a.user_id = p.user_id
          )
        )
        AND ($6::uuid[] IS NULL OR pi.id = ANY($6::uuid[]))
      ORDER BY p.updated_at DESC
      LIMIT $2`,
    [userId, limit, appointmentDate, patientIds, appointmentIds, insuranceIds],
  );
  return rows;
}

async function getEligibilityQueueDiagnostics(userId, appointmentDate) {
  if (!appointmentDate) {
    return {
      appointmentDate: null,
      appointmentsOnDate: null,
      patientsOnDate: null,
      patientsWithDob: null,
      patientsWithPrimaryInsurance: null,
      patientsWithMemberId: null,
      patientsWithPayerName: null,
      fullyEligiblePatients: null,
    };
  }
  const { rows } = await db.query(
    `WITH appt_patients AS (
       SELECT DISTINCT p.id AS patient_id
         FROM appointments a
         INNER JOIN patients p ON p.id = a.patient_id
        WHERE a.user_id = $1
          AND a.appointment_date = $2::date
          AND p.user_id = $1
     ),
     base AS (
       SELECT
         ap.patient_id,
         p.date_of_birth,
         pi.id AS primary_insurance_id,
         NULLIF(trim(pi.member_id), '') AS member_id,
         NULLIF(trim(pi.payer_name), '') AS payer_name
       FROM appt_patients ap
       INNER JOIN patients p ON p.id = ap.patient_id
       LEFT JOIN patient_insurance pi
         ON pi.patient_id = ap.patient_id AND pi.coverage_rank = 1
     )
     SELECT
       (SELECT COUNT(*) FROM appointments a WHERE a.user_id = $1 AND a.appointment_date = $2::date) AS appointments_on_date,
       (SELECT COUNT(*) FROM appt_patients) AS patients_on_date,
       COUNT(*) FILTER (WHERE date_of_birth IS NOT NULL) AS patients_with_dob,
       COUNT(*) FILTER (WHERE primary_insurance_id IS NOT NULL) AS patients_with_primary_insurance,
       COUNT(*) FILTER (WHERE member_id IS NOT NULL) AS patients_with_member_id,
       COUNT(*) FILTER (WHERE payer_name IS NOT NULL) AS patients_with_payer_name,
       COUNT(*) FILTER (
         WHERE date_of_birth IS NOT NULL
           AND primary_insurance_id IS NOT NULL
           AND member_id IS NOT NULL
           AND payer_name IS NOT NULL
       ) AS fully_eligible_patients
     FROM base`,
    [userId, appointmentDate],
  );
  const r = rows[0] || {};
  return {
    appointmentDate,
    appointmentsOnDate: Number(r.appointments_on_date || 0),
    patientsOnDate: Number(r.patients_on_date || 0),
    patientsWithDob: Number(r.patients_with_dob || 0),
    patientsWithPrimaryInsurance: Number(r.patients_with_primary_insurance || 0),
    patientsWithMemberId: Number(r.patients_with_member_id || 0),
    patientsWithPayerName: Number(r.patients_with_payer_name || 0),
    fullyEligiblePatients: Number(r.fully_eligible_patients || 0),
  };
}

async function listOfficeAllySavedIdsForDate(userId, appointmentDate) {
  const { rows: appointmentRows } = await db.query(
    `SELECT
        a.id AS appointment_id,
        a.pm_appointment_id,
        p.id AS patient_id,
        p.pm_patient_id
      FROM appointments a
      INNER JOIN patients p ON p.id = a.patient_id
      WHERE a.user_id = $1
        AND a.appointment_date = $2::date
      ORDER BY a.updated_at DESC`,
    [userId, appointmentDate],
  );

  const patientIds = [...new Set(appointmentRows.map((r) => r.patient_id))];
  let insuranceRows = [];
  if (patientIds.length) {
    const { rows } = await db.query(
      `SELECT id, patient_id, coverage_rank
         FROM patient_insurance
        WHERE patient_id = ANY($1::uuid[])
        ORDER BY patient_id, coverage_rank`,
      [patientIds],
    );
    insuranceRows = rows;
  }

  return {
    patients: patientIds.map((patientId) => {
      const row = appointmentRows.find((r) => r.patient_id === patientId);
      return {
        id: patientId,
        pmPatientId: row?.pm_patient_id || null,
      };
    }),
    appointments: appointmentRows.map((r) => ({
      id: r.appointment_id,
      pmAppointmentId: r.pm_appointment_id,
      patientId: r.patient_id,
    })),
    insurance: insuranceRows.map((r) => ({
      id: r.id,
      patientId: r.patient_id,
      coverageRank: r.coverage_rank,
    })),
  };
}

function sanitizeForFileName(value) {
  return String(value || 'unknown')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Supports:
 * - explicit file path
 * - directory path (adds per-user filename)
 * - templates with {userId}
 */
function resolveAvailityStorageStatePath(storageStatePath, userId) {
  const raw = String(storageStatePath || '').trim();
  if (!raw) return '';
  const withUser = raw.replace(/\{userId\}/g, sanitizeForFileName(userId));
  const ext = path.extname(withUser).toLowerCase();
  if (ext === '.json') {
    return path.isAbsolute(withUser) ? withUser : path.resolve(process.cwd(), withUser);
  }
  const asDir = path.isAbsolute(withUser) ? withUser : path.resolve(process.cwd(), withUser);
  return path.join(asDir, `availity-session-${sanitizeForFileName(userId)}.json`);
}

/**
 * Batch insert/update patients and appointments from a scrape (avoids per-row round trips).
 * @param {{ userId: string, syncId: string, appointmentDate: string, rawAppointments: object[] }} p
 * @returns {Promise<{ savedAppointments: number, ids: { patients: object[], appointments: object[], insurance: object[] } }>} rows written
 */
async function bulkPersistOfficeAllyScrape(p) {
  const { userId, syncId, appointmentDate, rawAppointments } = p;
  const n = rawAppointments.length;
  if (n === 0) {
    return { savedAppointments: 0, ids: { patients: [], appointments: [], insurance: [] } };
  }
  // eslint-disable-next-line no-console
  console.log(`[date-sync] persist start rows=${n} syncId=${syncId}`);
  const pmPids = [];
  const firsts = [];
  const lasts = [];
  const dobs = [];
  const phones = [];
  const emails = [];
  const raws = [];
  const ords = [];
  const apptIds = [];
  const startsAts = [];
  const provs = [];
  const st = [];
  const reas = [];
  for (let i = 0; i < n; i += 1) {
    const raw = rawAppointments[i];
    const pmPatientId = String(raw['Patient ID'] || pickField(raw, /patient\s*id|account|acct|mrn|chart/i) || 'unknown-patient');
    const details = raw.patientDetails || {};
    const pTab = details.patientTab || {};
    const firstName = pTab.firstName || pickField(raw, /first\s*name/i);
    const lastName = pTab.lastName || pickField(raw, /last\s*name/i);
    const dobIso = toIsoDate(pTab.dob || raw['Date Of Birth'] || pickField(raw, /date\s*of\s*birth|dob/i));
    const phonePrimary = pTab.cellPhone || pTab.homePhone || pTab.workPhone || null;
    const email = pTab.email || null;
    const pmAppointmentId = String(raw['Appointment ID'] || `syn-${appointmentDate}-${pmPatientId}-${i}`);
    const startsAt = buildAppointmentStart(appointmentDate, raw.Time);
    pmPids.push(pmPatientId);
    firsts.push(firstName);
    lasts.push(lastName);
    dobs.push(dobIso);
    phones.push(phonePrimary);
    emails.push(email);
    raws.push(raw);
    ords.push(i + 1);
    apptIds.push(pmAppointmentId);
    startsAts.push(startsAt);
    provs.push(raw.Provider || pickField(raw, /provider|doctor/i));
    st.push(raw.Status || pickField(raw, /status/i));
    reas.push(raw.Reason || pickField(raw, /reason|visit|type/i));
  }

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    // eslint-disable-next-line no-console
    console.log(`[date-sync] upserting patients rows=${n}`);
    const { rows: pOut } = await client.query(
      `WITH ord AS (SELECT * FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::date[], $6::text[], $7::text[], $8::jsonb[], $9::int[]) AS
        t(user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email, raw_payload, ord)),
      p AS (
        SELECT DISTINCT ON (user_id, pm_patient_id) user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email, raw_payload
        FROM ord
        ORDER BY user_id, pm_patient_id, ord DESC
      )
      INSERT INTO patients (user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email, raw_payload)
      SELECT user_id, pm_patient_id, first_name, last_name, date_of_birth, phone_primary, email, raw_payload FROM p
      ON CONFLICT (user_id, pm_patient_id) DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        date_of_birth = COALESCE(EXCLUDED.date_of_birth, patients.date_of_birth),
        phone_primary = COALESCE(EXCLUDED.phone_primary, patients.phone_primary),
        email = COALESCE(EXCLUDED.email, patients.email),
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING id, user_id, pm_patient_id`,
      [Array(n).fill(userId), pmPids, firsts, lasts, dobs, phones, emails, raws, ords],
    );
    const byPm = new Map(pOut.map((r) => [r.pm_patient_id, r.id]));
    const patientIds = pmPids.map((pm) => {
      const id = byPm.get(pm);
      if (!id) throw new Error(`bulkPersist: missing patient id for ${pm}`);
      return id;
    });
    // eslint-disable-next-line no-console
    console.log(`[date-sync] upserting appointments rows=${n}`);
    const { rows: appointmentOut } = await client.query(
      `INSERT INTO appointments
        (sync_request_id, user_id, pm_appointment_id, patient_id, appointment_date, starts_at, provider_name, status, reason, raw_payload)
       SELECT * FROM unnest(
         $1::uuid[], $2::uuid[], $3::text[], $4::uuid[], $5::date[], $6::timestamptz[], $7::text[], $8::text[], $9::text[], $10::jsonb[]
       ) AS t(
         sync_request_id, user_id, pm_appointment_id, patient_id, appointment_date, starts_at, provider_name, status, reason, raw_payload
       )
      ON CONFLICT (user_id, pm_appointment_id) DO UPDATE SET
        sync_request_id = EXCLUDED.sync_request_id,
        patient_id = EXCLUDED.patient_id,
        appointment_date = EXCLUDED.appointment_date,
        starts_at = EXCLUDED.starts_at,
        provider_name = EXCLUDED.provider_name,
        status = EXCLUDED.status,
        reason = EXCLUDED.reason,
        raw_payload = EXCLUDED.raw_payload,
        updated_at = NOW()
      RETURNING id, pm_appointment_id, patient_id`,
      [
        Array(n).fill(syncId),
        Array(n).fill(userId),
        apptIds,
        patientIds,
        Array(n).fill(appointmentDate),
        startsAts,
        provs,
        st,
        reas,
        raws,
      ],
    );

    const insPatientIds = [];
    const insRanks = [];
    const insPayerNames = [];
    const insMemberIds = [];
    const insPlanNames = [];
    const insGroupNos = [];
    const insRelationships = [];
    const insRaw = [];

    const seenInsurance = new Set();
    const appendInsurance = (patientId, rank, source) => {
      if (!source || typeof source !== 'object') return;
      const dedupeKey = `${patientId}:${rank}`;
      if (seenInsurance.has(dedupeKey)) return;
      seenInsurance.add(dedupeKey);
      const payerName = pickFirstNonEmpty(source.insuranceName, source.payerName);
      const memberId = pickFirstNonEmpty(source.subscriberId, source.insuredId, source.memberId);
      const planName = pickFirstNonEmpty(source.planName);
      const groupNo = pickFirstNonEmpty(source.groupNo, source.groupNumber);
      const relationship = pickFirstNonEmpty(source.relationshipToInsured, source.relationship);
      insPatientIds.push(patientId);
      insRanks.push(rank);
      insPayerNames.push(payerName);
      insMemberIds.push(memberId);
      insPlanNames.push(planName);
      insGroupNos.push(groupNo);
      insRelationships.push(relationship);
      insRaw.push(source);
    };

    for (let i = 0; i < n; i += 1) {
      const raw = rawAppointments[i];
      const pm = pmPids[i];
      const patientId = byPm.get(pm);
      if (!patientId) continue;
      const ins = raw?.patientDetails?.insuranceTab || {};
      appendInsurance(patientId, 1, ins.primaryInsurance);
      appendInsurance(patientId, 2, ins.secondaryInsurance);
      appendInsurance(patientId, 3, ins.thirdInsurance);
    }

    let insuranceOut = [];
    if (insPatientIds.length) {
      // eslint-disable-next-line no-console
      console.log(`[date-sync] upserting insurance rows=${insPatientIds.length}`);
      const { rows } = await client.query(
        `INSERT INTO patient_insurance
          (patient_id, coverage_rank, payer_name, member_id, plan_name, group_number, relationship, raw_payload)
         SELECT * FROM unnest(
           $1::uuid[], $2::smallint[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::jsonb[]
         ) AS t(patient_id, coverage_rank, payer_name, member_id, plan_name, group_number, relationship, raw_payload)
         ON CONFLICT (patient_id, coverage_rank) DO UPDATE SET
           payer_name = EXCLUDED.payer_name,
           member_id = EXCLUDED.member_id,
           plan_name = EXCLUDED.plan_name,
           group_number = EXCLUDED.group_number,
           relationship = EXCLUDED.relationship,
           raw_payload = EXCLUDED.raw_payload,
           updated_at = NOW()
         RETURNING id, patient_id, coverage_rank`,
        [insPatientIds, insRanks, insPayerNames, insMemberIds, insPlanNames, insGroupNos, insRelationships, insRaw],
      );
      insuranceOut = rows;
    }
    // eslint-disable-next-line no-console
    console.log('[date-sync] committing office ally transaction');
    await client.query('COMMIT');
    // eslint-disable-next-line no-console
    console.log(`[date-sync] persist done rows=${n} syncId=${syncId}`);
    return {
      savedAppointments: n,
      ids: {
        patients: pOut.map((r) => ({
          id: r.id,
          pmPatientId: r.pm_patient_id,
        })),
        appointments: appointmentOut.map((r) => ({
          id: r.id,
          pmAppointmentId: r.pm_appointment_id,
          patientId: r.patient_id,
        })),
        insurance: insuranceOut.map((r) => ({
          id: r.id,
          patientId: r.patient_id,
          coverageRank: r.coverage_rank,
        })),
      },
    };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[date-sync] persist failed syncId=${syncId}`, e);
    try {
      await client.query('ROLLBACK');
    } catch {
      /* */
    }
    throw e;
  } finally {
    client.release();
  }
}

async function runOfficeAllyStage({ userId, appointmentDate, syncId, officeAllyCreds }) {
  // eslint-disable-next-line no-console
  console.log(`[date-sync] office ally stage start syncId=${syncId} date=${appointmentDate}`);
  await db.query(
    "UPDATE sync_requests SET status = 'running', current_stage = 'office_ally', message = 'Office Ally: starting', started_at = COALESCE(started_at, NOW()) WHERE id = $1",
    [syncId],
  );

  const rawAppointments = await withAsyncTimeout(
    scrapeAppointmentsByDate({
      appointmentDate,
      officeAllyUsername: officeAllyCreds.username,
      officeAllyPassword: officeAllyCreds.password,
    }),
    Math.max(env.medicalBackend.timeoutMs, 120000),
    { label: 'office_ally_scrape' },
  );
  // eslint-disable-next-line no-console
  console.log(`[date-sync] scrape done rows=${rawAppointments.length} syncId=${syncId}`);
  await db.query("UPDATE sync_requests SET message = $2 WHERE id = $1", [
    syncId,
    `Office Ally: scraped ${rawAppointments.length} rows, persisting to DB`,
  ]);

  const persistResult = await withAsyncTimeout(
    bulkPersistOfficeAllyScrape({
      userId,
      syncId,
      appointmentDate,
      rawAppointments,
    }),
    Math.max(env.pg.statementTimeoutMs * 2, 60000),
    { label: 'office_ally_persist' },
  );
  const { savedAppointments, ids } = persistResult;
  // eslint-disable-next-line no-console
  console.log(`[date-sync] db save done saved=${savedAppointments} syncId=${syncId}`);

  // eslint-disable-next-line no-console
  console.log(`[date-sync] office ally stage done syncId=${syncId}`);
  return { rawAppointments, savedAppointments, ids };
}

async function runAvailityStage({ userId, syncId, availityCreds, appointmentDate = null, ids = {}, officeAllySavedAppointments = null }) {
  const logger = createLogger();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const scraper = await loadEligibilityScraper();
  const avConfig = buildAvailityConfig({
    avUsername: availityCreds.username,
    avPassword: availityCreds.password,
  });
  const ctx = { config: avConfig, logger, browser: {} };

  const stageMessage = officeAllySavedAppointments == null
    ? 'Availity: starting'
    : `Office Ally: saved ${officeAllySavedAppointments} appointments. Availity: starting`;
  await db.query(
    "UPDATE sync_requests SET status = 'running', current_stage = 'availity', message = $2 WHERE id = $1",
    [syncId, stageMessage],
  );

  const storageStatePath = resolveAvailityStorageStatePath(avConfig.availity.storageStatePath, userId);
  const headless = String(process.env.HEADLESS || 'true').toLowerCase() === 'true';
  const slowMo = Number(process.env.SLOW_MO_MS || 0);
  const browser = await chromium.launch({ headless, slowMo: slowMo || undefined });
  const hasStoredState = Boolean(storageStatePath) && (await fs.promises.stat(storageStatePath).then(() => true).catch(() => false));
  const contextOpts = { viewport: { width: 1400, height: 900 }, acceptDownloads: true };
  if (hasStoredState) {
    contextOpts.storageState = storageStatePath;
    logger.info(`Availity: loading saved Playwright storage state from ${storageStatePath}`);
  }
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  ctx.browser = {
    page,
    setPage(nextPage) {
      if (nextPage) this.page = nextPage;
    },
    async saveStorageState() {
      if (!storageStatePath) return;
      await fs.promises.mkdir(path.dirname(storageStatePath), { recursive: true });
      await context.storageState({ path: storageStatePath });
      logger.info(`Availity: saved Playwright storage state to ${storageStatePath}`);
    },
    async screenshot(name) {
      if (String(process.env.AVAILITY_SCREENSHOTS || '').toLowerCase() !== 'true') return;
      const dir = path.resolve(process.cwd(), 'availity', 'screenshots');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${name}-${Date.now()}.png`);
      await this.page.screenshot({ path: file, fullPage: true }).catch(() => {});
      logger.info(`Availity screenshot: ${file}`);
    },
  };

  try {
    await db.query("UPDATE sync_requests SET message = $2 WHERE id = $1", [
      syncId,
      hasStoredState
        ? 'Availity: restoring saved session'
        : 'Availity: logging in',
    ]);
    await availityLoginWithApiOtp(page, ctx, availityCreds, logger, {
      onAwaitingOtp: async () => {
        await db.query(
          "UPDATE sync_requests SET status = 'awaiting_otp', current_stage = 'availity', message = $2 WHERE id = $1",
          [syncId, 'Availity MFA required: enter OTP code to continue'],
        );
      },
      getOtp: async () => {
        const code = await getOtpFromRedis(syncId);
        await db.query(
          "UPDATE sync_requests SET status = 'awaiting_otp', current_stage = 'availity', message = $2 WHERE id = $1",
          [syncId, 'Availity OTP received, validating code'],
        );
        return code;
      },
    });
    await ctx.browser.saveStorageState?.();
    await db.query("UPDATE sync_requests SET status = 'running', current_stage = 'availity', message = $2 WHERE id = $1", [
      syncId,
      'Availity MFA complete, continuing',
    ]);

    await db.query("UPDATE sync_requests SET status = 'running', current_stage = 'availity', message = $2 WHERE id = $1", [
      syncId,
      'Availity: opening eligibility and processing queue',
    ]);

    const queue = await listPrimaryInsuranceForUser(userId, avConfig.availity.maxPatientsPerRun, appointmentDate, ids);
    const diag = await getEligibilityQueueDiagnostics(userId, appointmentDate).catch(() => null);
    // eslint-disable-next-line no-console
    console.log(
      `[eligibility] queue summary userId=${userId} date=${appointmentDate} limit=${avConfig.availity.maxPatientsPerRun} queueSize=${queue.length} diag=${
        diag ? JSON.stringify(diag) : 'unavailable'
      } sample=${JSON.stringify(
        queue.slice(0, 10).map((r) => ({
          patientId: r.patient_id,
          pmPatientId: r.pm_patient_id,
          insuranceId: r.patient_insurance_id,
          rank: r.coverage_rank,
          hasDob: Boolean(r.date_of_birth),
          hasMemberId: Boolean(String(r.member_id || '').trim()),
          hasPayerName: Boolean(String(r.payer_name || '').trim()),
        })),
      )}`,
    );
    if (!queue.length) {
      // eslint-disable-next-line no-console
      console.warn(
        `[eligibility] empty queue userId=${userId} date=${appointmentDate} limit=${avConfig.availity.maxPatientsPerRun} diag=${
          diag ? JSON.stringify(diag) : 'unavailable'
        }`,
      );
      await db.query(
        "UPDATE sync_requests SET status = 'success', current_stage = 'complete', message = $2, finished_at = NOW() WHERE id = $1",
        [
          syncId,
          officeAllySavedAppointments == null
            ? 'Complete: Availity skipped: no patients with DOB+primary insurance+member_id'
            : `Complete: OA rows=${officeAllySavedAppointments}; Availity skipped: no patients with DOB+primary insurance+member_id`,
        ],
      );
      await cacheService.invalidateUserDashboard(userId);
      return { queueSize: 0, processed: 0, successCount: 0, results: [] };
    }

    let done = 0;
    const results = [];
    for (const row of queue) {
      const patientPayload = {
        payerName: row.payer_name,
        memberId: row.member_id,
        patientDobIso: row.date_of_birth,
      };
      const runRes = await db.query(
        `INSERT INTO availity_eligibility_runs
          (user_id, patient_id, coverage_rank, payer_name_used, member_id_used, status, message)
         VALUES ($1, $2, $3, $4, $5, 'running', 'started')
         RETURNING id`,
        [userId, row.patient_id, row.coverage_rank || 1, row.payer_name, row.member_id],
      );
      const elRunId = runRes.rows[0].id;
      try {
        await scraper.availityOpenEligibilityApp(ctx);
        if (avConfig.availity.resultScreenDelayMs > 0) {
          await sleep(avConfig.availity.resultScreenDelayMs);
        }
        const frame = await scraper.availityGetContentFrame(ctx);
        await frame.locator('#organization-field').waitFor({ state: 'visible', timeout: 120000 });
        await scraper.availityFillInquiryForm(ctx, frame, patientPayload);
        await scraper.availitySubmitInquiry(ctx, frame);
        await scraper.availityWaitForResponse(ctx, frame);
        if (avConfig.availity.resultScreenDelayMs > 0) {
          await sleep(avConfig.availity.resultScreenDelayMs);
        }
        const snap = await scraper.availityParseResponseSnapshot(frame);
        const resultRow = scraper.mapAvailitySnapshotToResultRow(snap);
        const financials = extractFinancialFields(resultRow, snap);
        if (snap.alertText) {
          throw new Error(snap.alertText);
        }
        await db.query(
          `INSERT INTO availity_eligibility_results
            (run_id, coverage_status_text, is_active, member_id, payer_id, patient_name_on_file, benefit_line, date_of_service, transaction_date, insurance_type, plan_product, coverage_level, copay_amount, deductible_amount, coinsurance, oop_remaining, raw_snapshot)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [
            elRunId,
            resultRow.coverageStatusText,
            resultRow.isActive,
            resultRow.memberId,
            resultRow.payerId,
            resultRow.patientNameOnFile,
            resultRow.benefitLine,
            resultRow.dateOfService,
            resultRow.transactionDate,
            resultRow.insuranceType,
            resultRow.planProduct,
            resultRow.coverageLevel,
            financials.copayAmount,
            financials.deductibleAmount,
            financials.coinsurance,
            financials.oopRemaining,
            resultRow.rawSnapshot || {},
          ],
        );
        await db.query(
          "UPDATE availity_eligibility_runs SET status = 'success', finished_at = NOW(), message = 'ok' WHERE id = $1",
          [elRunId],
        );
        done += 1;
        results.push({
          runId: elRunId,
          patientId: row.patient_id,
          patientInsuranceId: row.patient_insurance_id,
          status: 'success',
          coverageStatusText: resultRow.coverageStatusText,
          isActive: resultRow.isActive,
          copayAmount: financials.copayAmount,
          deductibleAmount: financials.deductibleAmount,
          coinsurance: financials.coinsurance,
          oopRemaining: financials.oopRemaining,
        });
      } catch (e) {
        await db.query("UPDATE availity_eligibility_runs SET status = 'failed', finished_at = NOW(), message = $2 WHERE id = $1", [
          elRunId,
          e.message,
        ]);
        results.push({
          runId: elRunId,
          patientId: row.patient_id,
          patientInsuranceId: row.patient_insurance_id,
          status: 'failed',
          error: e.message,
        });
        if (avConfig.availity.stopOnFirstError) {
          throw e;
        }
      }
    }

    await db.query(
      "UPDATE sync_requests SET status = 'success', current_stage = 'complete', message = $2, finished_at = NOW() WHERE id = $1",
      [
        syncId,
        officeAllySavedAppointments == null
          ? `Complete: Availity processed=${queue.length} (ok=${done})`
          : `Complete: OA appts=${officeAllySavedAppointments}; Availity processed=${queue.length} (ok=${done})`,
      ],
    );
    return { queueSize: queue.length, processed: queue.length, successCount: done, results };
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

/**
 * @param {object} params
 * @param {string} params.userId
 * @param {string} params.appointmentDate
 * @param {string} params.syncId
 * @param {{username:string,password:string}} params.officeAllyCreds
 * @param {{username:string,password:string}} params.availityCreds
 */
async function runEndToEndSync({ userId, appointmentDate, syncId, officeAllyCreds, availityCreds }) {
  const { savedAppointments } = await runOfficeAllyStage({
    userId,
    appointmentDate,
    syncId,
    officeAllyCreds,
  });
  await runAvailityStage({
    userId,
    syncId,
    availityCreds,
    appointmentDate,
    officeAllySavedAppointments: savedAppointments,
  });
  await cacheService.invalidateUserDashboard(userId);
}

module.exports = {
  runEndToEndSync,
  runOfficeAllyStage,
  runAvailityStage,
  loadEligibilityScraper,
  listPrimaryInsuranceForUser,
  listOfficeAllySavedIdsForDate,
  getOtpFromRedis,
  bulkPersistOfficeAllyScrape,
};
