const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const env = require("../config/env");

function parseDateParts(appointmentDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(appointmentDate || "").trim(),
  );
  if (!m) {
    throw new Error("appointmentDate must be YYYY-MM-DD");
  }
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function calendarTitleFromDate(appointmentDate) {
  const { year, month, day } = parseDateParts(appointmentDate);
  const monthName = new Date(Date.UTC(year, month - 1, day)).toLocaleString("en-US", {
    month: "long",
    timeZone: "UTC",
  });
  return `${monthName} ${day}`;
}

function buildDailyViewUrl(baseUrl, appointmentDate) {
  const { year, month, day } = parseDateParts(appointmentDate);
  const root = new URL(baseUrl);
  const daily = new URL("/pm/Appointments/ViewAppointments.aspx", root.origin);
  daily.searchParams.set("Tab", "A");
  daily.searchParams.set("View", "d");
  daily.searchParams.set("Day", String(day));
  daily.searchParams.set("Month", String(month));
  daily.searchParams.set("Year", String(year));
  daily.searchParams.set("ProviderID", "");
  daily.searchParams.set("OfficeID", "");
  daily.searchParams.set("StatusID", "");
  daily.searchParams.set("TimeInterval", "30");
  daily.searchParams.set("DailyMode", "");
  return daily.toString();
}

function buildPatientEditUrl(baseUrl, patientId, tab) {
  const root = new URL(baseUrl);
  const patientUrl = new URL(
    "/pm/ManagePatients/EditPatient.aspx",
    root.origin,
  );
  patientUrl.searchParams.set("PID", String(patientId || "").trim());
  patientUrl.searchParams.set("Tab", String(tab || "P"));
  patientUrl.searchParams.set("PageAction", "edit");
  patientUrl.searchParams.set("From", "ViewAppointments");
  return patientUrl.toString();
}

function withTab(urlLike, tab) {
  const u = new URL(decodeHtmlEntities(urlLike));
  u.searchParams.set("Tab", tab);
  return u.toString();
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .trim();
}

function extractInputValueById(html, id) {
  const body = String(html || "");
  const openTag = new RegExp(
    `<(input|textarea)[^>]*(?:id|name)=["']${escapeRegExp(id)}["'][^>]*>`,
    "i",
  );
  const m = openTag.exec(body);
  if (!m) return "";
  const tag = m[0] || "";
  const valueMatch = /\bvalue=["']([^"']*)["']/i.exec(tag);
  return decodeHtmlEntities(valueMatch?.[1] || "");
}

function extractSelectedTextById(html, id) {
  const re = new RegExp(
    `<select[^>]*id=["']${escapeRegExp(id)}["'][\\s\\S]*?<option[^>]*selected[^>]*>([\\s\\S]*?)<\\/option>`,
    "i",
  );
  const m = re.exec(String(html || ""));
  return stripTags(m?.[1] || "");
}

function extractTextById(html, id) {
  const re = new RegExp(
    `<[^>]*id=["']${escapeRegExp(id)}["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    "i",
  );
  const m = re.exec(String(html || ""));
  return stripTags(m?.[1] || "");
}

function parsePatientAndInsuranceDetailsFromHtml(html) {
  const body = String(html || "");
  const primaryPatientId = extractInputValueById(
    body,
    "ctl00_phFolderContent_ucPatient_PAEnrollment_hdnPAPatientID",
  );
  const fallbackPatientId = extractInputValueById(
    body,
    "ctl00_phFolderContent_ucPatient_hdnPatientID",
  );
  const patientTab = {
    patientId: primaryPatientId || fallbackPatientId,
    firstName: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_FirstName"),
    middleName: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_MiddleName"),
    lastName: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_LastName"),
    dob: [
      extractInputValueById(body, "ctl00_phFolderContent_ucPatient_DOB_Month"),
      extractInputValueById(body, "ctl00_phFolderContent_ucPatient_DOB_Day"),
      extractInputValueById(body, "ctl00_phFolderContent_ucPatient_DOB_Year"),
    ]
      .filter(Boolean)
      .join("/"),
    sex: extractSelectedTextById(body, "ctl00_phFolderContent_ucPatient_lstGender"),
    maritalStatus: extractSelectedTextById(
      body,
      "ctl00_phFolderContent_ucPatient_lstMaritalStatus",
    ),
    addressLine1: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_AddressLine1",
    ),
    addressLine2: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_AddressLine2",
    ),
    city: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_City"),
    state: extractSelectedTextById(body, "ctl00_phFolderContent_ucPatient_lstState"),
    zip: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_Zip"),
    email: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_Email"),
  };

  const primaryInsurance = {
    insuranceType: extractTextById(
      body,
      "lblMultiSelectddlPatientInsuranceType",
    ),
    insuranceCompanyId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_InsuranceID",
    ),
    insuranceName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_InsuranceName",
    ),
    insuredId: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_InsuredID"),
    insuredLastName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_InsuredLastName",
    ),
    insuredFirstName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_InsuredFirstName",
    ),
    relationshipToInsured: extractSelectedTextById(
      body,
      "ctl00_phFolderContent_ucPatient_lstRelationshipToInsuredID",
    ),
    subscriberId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_InsuranceSubscriberID",
    ),
    groupNo: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_InsuranceGroupNo"),
    planName: extractInputValueById(body, "ctl00_phFolderContent_ucPatient_InsurancePlanName"),
  };

  const secondaryInsurance = {
    insuranceType: extractTextById(
      body,
      "lblMultiSelectddlPatientInsuranceType2",
    ),
    insuranceCompanyId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsuranceID",
    ),
    insuranceName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsuranceName",
    ),
    insuredId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsuredID",
    ),
    relationshipToInsured: extractSelectedTextById(
      body,
      "ctl00_phFolderContent_ucPatient_lstRelationshipToSecondaryInsuredID",
    ),
    subscriberId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsuranceSubscriberID",
    ),
    groupNo: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsuranceGroupNo",
    ),
    planName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_SecondaryInsurancePlanName",
    ),
  };

  const thirdInsurance = {
    insuranceType: extractTextById(
      body,
      "lblMultiSelectddlPatientInsuranceType3",
    ),
    insuranceCompanyId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsuranceID",
    ),
    insuranceName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsuranceName",
    ),
    insuredId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsuredID",
    ),
    relationshipToInsured: extractSelectedTextById(
      body,
      "ctl00_phFolderContent_ucPatient_lstRelationshipToThirdInsuredID",
    ),
    subscriberId: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsuranceSubscriberID",
    ),
    groupNo: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsuranceGroupNo",
    ),
    planName: extractInputValueById(
      body,
      "ctl00_phFolderContent_ucPatient_ThirdInsurancePlanName",
    ),
  };

  return {
    patientTab,
    insuranceTab: { primaryInsurance, secondaryInsurance, thirdInsurance },
  };
}

function parseAppointmentsFromDailyHtml(html, pageUrl) {
  const rows = [];
  const tableMatch = /<table[^>]*id=["']tblDailyApp["'][\s\S]*?<\/table>/i.exec(
    String(html || ""),
  );
  if (!tableMatch) return rows;
  const rowBlocks = tableMatch[0].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of rowBlocks) {
    const cells = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 10) continue;
    const patientCell = cells[3] || "";
    const patientText = stripTags(patientCell);
    if (!patientText) continue;
    const hrefMatch = /<a[^>]*href=["']([^"']+)["']/i.exec(patientCell);
    const onclickHref =
      /(?:window\.location(?:\.href)?|location(?:\.href)?)\s*=\s*["']([^"']+)["']/i.exec(
        patientCell,
      )?.[1] ||
      "";
    const href = decodeHtmlEntities(hrefMatch?.[1] || onclickHref);
    if (!href) continue;

    let patientUrl = href;
    if (!/^https?:\/\//i.test(patientUrl)) {
      patientUrl = new URL(patientUrl, pageUrl).toString();
    }
    const patientId =
      /[?&](?:PID|PatientID|InsuredID|ID)=(\d+)/i.exec(patientUrl)?.[1] ||
      /EditPatient\((\d+)/i.exec(patientCell)?.[1] ||
      /EditPatient\((\d+)/i.exec(tr)?.[1] ||
      "";
    const [lastName, firstName] = patientText.split(",").map((x) => stripTags(x));
    const apptIcon = /<img[^>]*onclick=["'][^"']*EditAppointment\((\d+)/i.exec(tr);

    rows.push({
      "Patient ID": patientId,
      "First Name": firstName || patientText,
      "Last Name": lastName || "",
      "Date Of Birth": stripTags(cells[4]),
      "Appointment ID": apptIcon?.[1] || "",
      Time: `${stripTags(cells[0])}${stripTags(cells[1]) ? `:${stripTags(cells[1])}` : ""}`,
      Provider: stripTags(cells[6]),
      Reason: stripTags(cells[7]),
      Status: stripTags(cells[8]),
      "Visit Length": stripTags(cells[2]),
      RawPatient: patientText,
      PatientUrl: patientUrl,
    });
  }
  return rows;
}

function parseEmbeddedPatientDetailsPayload(html) {
  const body = String(html || "");
  const startRe = /<script[^>]*\bid=["']nexxaura-zyte-patient-payload["'][^>]*>/i;
  const startMatch = startRe.exec(body);
  if (!startMatch) return { data: {}, diagnostics: { scriptFound: false } };
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = body.indexOf("</script>", startIdx);
  if (endIdx === -1) {
    return { data: {}, diagnostics: { scriptFound: true, parseError: "no_closing_script_tag" } };
  }
  const jsonText = body.slice(startIdx, endIdx).trim();
  try {
    return {
      data: JSON.parse(jsonText || "{}"),
      diagnostics: { scriptFound: true, jsonLength: jsonText.length },
    };
  } catch (e) {
    return {
      data: {},
      diagnostics: {
        scriptFound: true,
        jsonLength: jsonText.length,
        parseError: e?.message || "json_parse_failed",
        jsonHead: jsonText.slice(0, 500),
        jsonTail: jsonText.slice(Math.max(0, jsonText.length - 500)),
      },
    };
  }
}

function parseEmbeddedJsonByScriptId(html, scriptId) {
  const body = String(html || "");
  const id = String(scriptId || "").trim();
  if (!id) return null;
  const startRe = new RegExp(`<script[^>]*\\bid=["']${id}["'][^>]*>`, "i");
  const startMatch = startRe.exec(body);
  if (!startMatch) return null;
  const startIdx = startMatch.index + startMatch[0].length;
  const endIdx = body.indexOf("</script>", startIdx);
  if (endIdx === -1) return null;
  const jsonText = body.slice(startIdx, endIdx).trim();
  try {
    return JSON.parse(jsonText || "{}");
  } catch (e) {
    return null;
  }
}

function parseMoneyLike(value) {
  const txt = String(value || "")
    .replace(/[$,]/g, "")
    .trim();
  const m = /-?\d+(?:\.\d+)?/.exec(txt);
  if (!m) return null;
  const num = Number(m[0]);
  return Number.isFinite(num) ? num : null;
}

function parsePatientVisitsFromHtml(html) {
  const body = String(html || "");
  const rows = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRe.exec(body))) {
    const trBody = trMatch[1] || "";
    const tdRe = /<td\b([^>]*)>([\s\S]*?)<\/td>/gi;
    const cellMap = {};
    let tdMatch;
    while ((tdMatch = tdRe.exec(trBody))) {
      const attrs = tdMatch[1] || "";
      const rawCell = tdMatch[2] || "";
      const cell = stripTags(rawCell);
      if (!cell) continue;
      const keyRaw =
        /aria-describedby=["'][^"']*?_([A-Za-z0-9]+)["']/i.exec(attrs)?.[1] ||
        /id=["'][^"']*?_([A-Za-z0-9]+)["']/i.exec(attrs)?.[1] ||
        "";
      const key = String(keyRaw || "").trim().toLowerCase();
      if (!key) continue;
      cellMap[key] = cell;
    }
    const pmVisitId = cellMap.id || null;
    const visitDate = cellMap.datevisited || cellMap.visitdate || null;
    if (!pmVisitId || !visitDate) continue;
    rows.push({
      pmVisitId,
      visitDate,
      visitType: cellMap.visittype || cellMap.type || null,
      providerName: cellMap.provider || cellMap.providername || null,
      status: cellMap.status || null,
      charges: parseMoneyLike(cellMap.charges),
      balance: parseMoneyLike(cellMap.balances || cellMap.balance),
      rawCellMap: cellMap,
    });
  }
  return rows;
}

function splitIntoChunks(values, size) {
  const out = [];
  const arr = Array.isArray(values) ? values : [];
  const n = Math.max(1, Number(size) || 1);
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const results = new Array(list.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= list.length) return;
      results[i] = await mapper(list[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/** Zyte /extract timeout for Office Ally patient-visits-only jobs (login + grid + search). */
function zytePatientVisitsExtractTimeoutMs() {
  const n = Number(process.env.OA_PATIENT_VISITS_REQUEST_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 120000;
}

/** One browser session + N synchronous searches needs more wall time than a single patient lookup. */
function zytePatientVisitsBatchExtractTimeoutMs(patientCount) {
  const baseMs = zytePatientVisitsExtractTimeoutMs();
  const per = Math.max(0, Number(process.env.OA_ZYTE_PATIENT_VISITS_BATCH_EXTRA_MS_PER_ID || 9500));
  const cap = Math.max(
    baseMs,
    Number(process.env.OA_ZYTE_PATIENT_VISITS_BATCH_TIMEOUT_CAP_MS || 360000),
  );
  const n = Math.max(1, Number(patientCount) || 1);
  return Math.min(cap, baseMs + per * (n - 1));
}

function zytePatientVisitsWantScreenshot() {
  return String(process.env.OA_ZYTE_PATIENT_VISITS_SCREENSHOT || "").toLowerCase() === "true";
}

/** After navigating to Patient Visits, wait before touching search (jqGrid often shows Loading… first). */
function zytePatientVisitsPageReadySeconds() {
  const n = Number(process.env.OA_ZYTE_PATIENT_VISITS_PAGE_READY_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 9;
}

function zytePatientVisitsExtraSettleSeconds() {
  const n = Number(process.env.OA_ZYTE_PATIENT_VISITS_EXTRA_SETTLE_SECONDS);
  return Number.isFinite(n) && n >= 0 ? n : 3;
}

function zytePatientVisitsPostSearchSeconds() {
  const n = Number(process.env.OA_ZYTE_PATIENT_VISITS_POST_SEARCH_SECONDS);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

/** Zyte API: each actions[].evaluate.source must stay under ~6000 chars. Batch uses UI search + DOM scrape per patient (matches per-patient extract). */
const PV_BATCH_SETUP_EVALUATE_SOURCE = `(function(){function S(o){var n=document.getElementById("nexxaura-zyte-patient-payload");if(!n){n=document.createElement("script");n.id="nexxaura-zyte-patient-payload";n.type="application/json";document.body.appendChild(n);}n.textContent=JSON.stringify(o||{});}function C(v){return String(v||"").replace(/\\s+/g," ").trim();}function V(h){var o=[],d=new DOMParser().parseFromString(String(h||""),"text/html"),r=d.querySelectorAll("tr.jqgrow,#ctl00_phFolderContent_myCustomGrid_myGrid tr"),ri,cells,ci,td,raw,k,m,vid,vdt;for(ri=0;ri<r.length;ri++){cells=r[ri].querySelectorAll("td");if(!cells.length)continue;m={};for(ci=0;ci<cells.length;ci++){td=cells[ci];raw=(td.getAttribute("aria-describedby")||td.id||"").split("_").pop();k=C(raw).toLowerCase();if(!k)continue;m[k]=C(td.textContent);}vid=m.id||"";vdt=m.datevisited||m.visitdate||"";if(vid&&vdt)o.push({pmVisitId:vid,visitDate:vdt,visitType:m.visittype||m.type||null,providerName:m.provider||m.providername||null,status:m.status||null,charges:m.charges||null,balance:m.balances||m.balance||null,rawCellMap:m});}return o;}window.__nxPv={S:S,V:V};window.__nxPvAcc={};S({});})();`;

function buildPvBatchUiSearchStep(pid) {
  const idLit = JSON.stringify(String(pid));
  return `(function(){var pid=${idLit},by=document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchBy"),cond=document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchCondition"),txt=document.getElementById("ctl00_phFolderContent_ucSearch_txtSearch"),btn=document.getElementById("ctl00_phFolderContent_ucSearch_btnSearch");if(by){by.value="PatientID";by.dispatchEvent(new Event("change",{bubbles:true}));}if(cond){cond.value="EqualsTo";cond.dispatchEvent(new Event("change",{bubbles:true}));}if(txt){txt.value=String(pid);txt.dispatchEvent(new Event("input",{bubbles:true}));txt.dispatchEvent(new Event("change",{bubbles:true}));}if(btn)btn.click();})();`;
}

function buildPvBatchUiScrapeStep(pid) {
  const idLit = JSON.stringify(String(pid));
  return `(function(){var Z=window.__nxPv,pid=${idLit};if(!Z)return;var h=document.documentElement.outerHTML,x=Z.V(h);window.__nxPvAcc[String(pid)]=Array.isArray(x)?x:[];Z.S(window.__nxPvAcc);})();`;
}

async function requestZytePatientVisitsByPatientId({
  officeAllyUsername,
  officeAllyPassword,
  patientId,
  postLoginWaitSeconds = Number(process.env.OA_PATIENT_VISITS_POST_LOGIN_WAIT_SECONDS || 12),
}) {
  const apiKey = String(env.officeAlly.zyteApiKey || "").trim();
  if (!apiKey) return [];
  const normalizedPatientId = String(patientId || "").trim();
  if (!normalizedPatientId) return [];

  const endpoint = String(env.officeAlly.zyteApiUrl || "https://api.zyte.com/v1/extract");
  const baseUrl = String(env.officeAlly.baseUrl || "").trim();
  const patientVisitsUrl = new URL("/pm/PatientVisits/Visits.aspx?Tab=V", baseUrl).toString();
  const pageReady = zytePatientVisitsPageReadySeconds();
  const extraSettle = zytePatientVisitsExtraSettleSeconds();
  const postSearch = zytePatientVisitsPostSearchSeconds();
  const payload = {
    url: baseUrl,
    browserHtml: true,
    screenshot: zytePatientVisitsWantScreenshot(),
    actions: [
      { action: "waitForTimeout", timeout: 1.0 },
      {
        action: "evaluate",
        source: `
          (function () {
            const u = document.querySelector("#username, input[name='username']");
            const p = document.querySelector("#password, input[name='password']");
            const f = document.querySelector("form[data-form-primary='true'], form");
            if (!u || !p || !f) return;
            u.focus();
            u.value = ${JSON.stringify(officeAllyUsername)};
            u.dispatchEvent(new Event("input", { bubbles: true }));
            u.dispatchEvent(new Event("change", { bubbles: true }));
            p.focus();
            p.value = ${JSON.stringify(officeAllyPassword)};
            p.dispatchEvent(new Event("input", { bubbles: true }));
            p.dispatchEvent(new Event("change", { bubbles: true }));
            f.submit();
          })();
        `,
      },
      { action: "waitForTimeout", timeout: postLoginWaitSeconds },
      { action: "evaluate", source: `window.location.href = ${JSON.stringify(patientVisitsUrl)};` },
      { action: "waitForTimeout", timeout: pageReady },
      { action: "waitForTimeout", timeout: extraSettle },
      {
        action: "evaluate",
        source: `
          (function () {
            var by = document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchBy");
            if (by) by.value = "PatientID";
            if (by) by.dispatchEvent(new Event("change", { bubbles: true }));
            var cond = document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchCondition");
            if (cond) cond.value = "EqualsTo";
            if (cond) cond.dispatchEvent(new Event("change", { bubbles: true }));
            var txt = document.getElementById("ctl00_phFolderContent_ucSearch_txtSearch");
            if (txt) txt.value = ${JSON.stringify(normalizedPatientId)};
            if (txt) txt.dispatchEvent(new Event("input", { bubbles: true }));
            if (txt) txt.dispatchEvent(new Event("change", { bubbles: true }));
            var btn = document.getElementById("ctl00_phFolderContent_ucSearch_btnSearch");
            if (btn) btn.click();
          })();
        `,
      },
      { action: "waitForTimeout", timeout: postSearch },
    ],
  };

  const response = await axiosPostZyteExtract({
    endpoint,
    payload,
    apiKey,
    timeoutMs: zytePatientVisitsExtractTimeoutMs(),
    logPrefix: `patient-visits pid=${normalizedPatientId}`,
    onAttemptFailure: async ({ attempt, transportRetries, error, responseData }) => {
      const meta = formatAxiosErrorMeta(error);
      await writeZyteArtifacts({
        label: `patient-visits-fail-${normalizedPatientId}-attempt-${attempt}-of-${transportRetries}`,
        responseData,
        failureMeta: {
          kind: "patient_visits_per_pid_transport_or_http",
          patientId: normalizedPatientId,
          attempt,
          transportRetries,
          axiosCode: meta.code,
          httpStatus: meta.status,
          message: meta.message,
        },
      });
    },
  });
  await writeZyteArtifacts({
    label: `patient-visits-auth0-evaluate-submit-${normalizedPatientId}`,
    responseData: response?.data || {},
  }).catch(() => {});
  const html = response?.data?.browserHtml || "";
  const state = detectZyteHtmlState(html);
  if (state === "login_page_returned" || state !== "patient_visits_present") {
    await writeZyteArtifacts({
      label: `patient-visits-bad-state-${normalizedPatientId}-${state}`,
      responseData: response?.data || {},
      failureMeta: {
        kind: "patient_visits_wrong_page_shape",
        patientId: normalizedPatientId,
        html_state: state,
      },
    }).catch(() => {});
    throw new Error(`patient visits page not ready for ${normalizedPatientId}; html_state=${state}`);
  }
  return parsePatientVisitsFromHtml(html);
}

async function requestZytePatientVisitsByPatientIds({
  officeAllyUsername,
  officeAllyPassword,
  patientIds,
  postLoginWaitSeconds = Number(process.env.OA_PATIENT_VISITS_POST_LOGIN_WAIT_SECONDS || 12),
  debugLabelSuffix = "",
}) {
  const apiKey = String(env.officeAlly.zyteApiKey || "").trim();
  if (!apiKey) return {};
  const ids = [...new Set((patientIds || []).map((v) => String(v || "").trim()).filter(Boolean))];
  if (!ids.length) return {};
  const useSafeBatch = String(
    process.env.OA_ZYTE_PATIENT_VISITS_SAFE_BATCH || "false",
  ).toLowerCase() === "true";
  if (useSafeBatch) {
    const parallel = Math.max(1, Number(process.env.OA_ZYTE_PATIENT_VISITS_PARALLEL || 6));
    const runPid = async (pid) => {
      try {
        const rows = await requestZytePatientVisitsByPatientId({
          officeAllyUsername,
          officeAllyPassword,
          patientId: pid,
          postLoginWaitSeconds,
        });
        return { pid, rows };
      } catch (error) {
        const detail = typeof error?.response?.data === "string"
          ? error.response.data
          : JSON.stringify(error?.response?.data || {});
        const status = error?.response?.status || "n/a";
        const code = error?.code || "n/a";
        // eslint-disable-next-line no-console
        console.warn(
          `[zyte] patient visits safe-batch failed pid=${pid} status=${status} code=${code} detail=${detail} message=${
            error?.message || String(error)
          }`,
        );
        return { pid, rows: [] };
      }
    };
    if (parallel <= 1 || ids.length === 1) {
      const out = {};
      for (const pid of ids) {
        const { rows } = await runPid(pid);
        out[pid] = rows;
      }
      return out;
    }
    // eslint-disable-next-line no-console
    console.log(
      `[zyte] patient visits safe-batch parallel concurrency=${parallel} patients=${ids.length}`,
    );
    const pairs = await mapWithConcurrency(ids, parallel, (pid) => runPid(pid));
    const out = {};
    for (const { pid, rows } of pairs) out[pid] = rows;
    return out;
  }

  const visitsScreenshot = zytePatientVisitsWantScreenshot();
  const batchTimeoutMs = zytePatientVisitsBatchExtractTimeoutMs(ids.length);
  // eslint-disable-next-line no-console
  console.log(
    `[zyte] patient visits single-session extract patients=${ids.length} mode=ui_search_per_pid screenshot=${visitsScreenshot} axios_timeout_ms=${batchTimeoutMs}`,
  );
  const endpoint = String(env.officeAlly.zyteApiUrl || "https://api.zyte.com/v1/extract");
  const baseUrl = String(env.officeAlly.baseUrl || "").trim();
  const patientVisitsUrl = new URL("/pm/PatientVisits/Visits.aspx?Tab=V", baseUrl).toString();
  const pvPageReady = zytePatientVisitsPageReadySeconds();
  const pvExtra = zytePatientVisitsExtraSettleSeconds();
  const payload = {
    url: baseUrl,
    browserHtml: true,
    screenshot: visitsScreenshot,
    actions: [
      { action: "waitForTimeout", timeout: 1.0 },
      {
        action: "evaluate",
        source: `
          (function () {
            const u = document.querySelector("#username, input[name='username']");
            const p = document.querySelector("#password, input[name='password']");
            const f = document.querySelector("form[data-form-primary='true'], form");
            if (!u || !p || !f) return;
            u.focus();
            u.value = ${JSON.stringify(officeAllyUsername)};
            u.dispatchEvent(new Event("input", { bubbles: true }));
            u.dispatchEvent(new Event("change", { bubbles: true }));
            p.focus();
            p.value = ${JSON.stringify(officeAllyPassword)};
            p.dispatchEvent(new Event("input", { bubbles: true }));
            p.dispatchEvent(new Event("change", { bubbles: true }));
            f.submit();
          })();
        `,
      },
      { action: "waitForTimeout", timeout: postLoginWaitSeconds },
      { action: "evaluate", source: `window.location.href = ${JSON.stringify(patientVisitsUrl)};` },
      { action: "waitForTimeout", timeout: pvPageReady },
      { action: "waitForTimeout", timeout: pvExtra },
      {
        action: "evaluate",
        source: PV_BATCH_SETUP_EVALUATE_SOURCE,
      },
      ...ids.flatMap((pid) => {
        const uiWait = Number(process.env.OA_ZYTE_PV_UI_SEARCH_WAIT_SECONDS || 2.2);
        const gap = Number(process.env.OA_ZYTE_PV_BATCH_STEP_GAP_SECONDS || 0.03);
        return [
          { action: "evaluate", source: buildPvBatchUiSearchStep(pid) },
          { action: "waitForTimeout", timeout: uiWait },
          { action: "evaluate", source: buildPvBatchUiScrapeStep(pid) },
          ...(gap > 0 ? [{ action: "waitForTimeout", timeout: gap }] : []),
        ];
      }),
      { action: "waitForTimeout", timeout: 1.0 },
    ],
  };

  let response;
  try {
    response = await axiosPostZyteExtract({
      endpoint,
      payload,
      apiKey,
      timeoutMs: batchTimeoutMs,
      logPrefix: `patient-visits-batch${debugLabelSuffix ? `-${debugLabelSuffix}` : ""}`,
      onAttemptFailure: async ({ attempt, transportRetries, error, responseData }) => {
        const meta = formatAxiosErrorMeta(error);
        const safeSuffix = String(debugLabelSuffix || "chunk").replace(/[^a-z0-9_-]/gi, "_");
        await writeZyteArtifacts({
          label: `patient-visits-batch-fail-${safeSuffix}-attempt-${attempt}-of-${transportRetries}`,
          responseData,
          failureMeta: {
            kind: "patient_visits_batch_transport_or_http",
            batchSuffix: debugLabelSuffix || null,
            attempt,
            transportRetries,
            axiosCode: meta.code,
            httpStatus: meta.status,
            message: meta.message,
          },
        });
      },
    });
  } catch (error) {
    const detail = typeof error?.response?.data === "string"
      ? error.response.data
      : JSON.stringify(error?.response?.data || {});
    const status = error?.response?.status || "n/a";
    const code = error?.code || "n/a";
    const timeoutMs = error?.config?.timeout || "n/a";
    // eslint-disable-next-line no-console
    console.warn(
      `[zyte] patient visits batch request failed status=${status} code=${code} timeout_ms=${timeoutMs} detail=${detail} message=${
        error?.message || String(error)
      }`,
    );
    throw error;
  }
  await writeZyteArtifacts({
    // Dedicated artifact label so it's easy to spot Patient Visits page-open evidence.
    label: `patient-visits-open-auth0-evaluate-submit${debugLabelSuffix ? `-${debugLabelSuffix}` : ""}`,
    responseData: response?.data || {},
  }).catch(() => {});
  await writeZyteArtifacts({
    label: `patient-visits-batch-auth0-evaluate-submit${debugLabelSuffix ? `-${debugLabelSuffix}` : ""}`,
    responseData: response?.data || {},
  }).catch(() => {});
  const html = response?.data?.browserHtml || "";
  const flowTrace = parseEmbeddedJsonByScriptId(html, "nexxaura-zyte-flow-trace");
  if (Array.isArray(flowTrace) && flowTrace.length) {
    // eslint-disable-next-line no-console
    console.log(`[zyte] patient visits flow trace ${JSON.stringify(flowTrace)}`);
  }
  const state = detectZyteHtmlState(html);
  if (state === "login_page_returned" || state !== "patient_visits_present") {
    const safeSuffix = String(debugLabelSuffix || "chunk").replace(/[^a-z0-9_-]/gi, "_");
    await writeZyteArtifacts({
      label: `patient-visits-batch-bad-state-${safeSuffix}-${state}`,
      responseData: response?.data || {},
      failureMeta: {
        kind: "patient_visits_batch_wrong_page_shape",
        html_state: state,
        batchSuffix: debugLabelSuffix || null,
      },
    }).catch(() => {});
    throw new Error(`patient visits batch page not ready; html_state=${state}`);
  }
  const { data } = parseEmbeddedPatientDetailsPayload(html);
  const out = {};
  for (const pid of ids) {
    const rows = Array.isArray(data?.[pid]) ? data[pid] : [];
    out[pid] = rows.map((v) => ({
      ...v,
      charges: parseMoneyLike(v?.charges),
      balance: parseMoneyLike(v?.balance),
    }));
  }
  const batchRows = ids.reduce((s, pid) => s + (Array.isArray(out[pid]) ? out[pid].length : 0), 0);
  if (batchRows === 0 && ids.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[zyte] patient visits batch UI-search parsed 0 rows for ${ids.length} patients; increase OA_ZYTE_PV_UI_SEARCH_WAIT_SECONDS (default 2.2s) or set OA_ZYTE_PATIENT_VISITS_SAFE_BATCH=true for parallel per-patient Zyte jobs`,
    );
  }
  return out;
}

async function requestZytePatientVisitsByPatientLastName({
  officeAllyUsername,
  officeAllyPassword,
  patientLastName,
  postLoginWaitSeconds = Number(process.env.OA_PATIENT_VISITS_POST_LOGIN_WAIT_SECONDS || 12),
}) {
  const apiKey = String(env.officeAlly.zyteApiKey || "").trim();
  if (!apiKey) return [];
  const normalizedLastName = String(patientLastName || "").trim();
  if (!normalizedLastName) return [];
  const endpoint = String(env.officeAlly.zyteApiUrl || "https://api.zyte.com/v1/extract");
  const baseUrl = String(env.officeAlly.baseUrl || "").trim();
  const patientVisitsUrl = new URL("/pm/PatientVisits/Visits.aspx?Tab=V", baseUrl).toString();
  const pageReady = zytePatientVisitsPageReadySeconds();
  const extraSettle = zytePatientVisitsExtraSettleSeconds();
  const postSearch = zytePatientVisitsPostSearchSeconds();
  const payload = {
    url: baseUrl,
    browserHtml: true,
    screenshot: zytePatientVisitsWantScreenshot(),
    actions: [
      { action: "waitForTimeout", timeout: 1.0 },
      {
        action: "evaluate",
        source: `
          (function () {
            const u = document.querySelector("#username, input[name='username']");
            const p = document.querySelector("#password, input[name='password']");
            const f = document.querySelector("form[data-form-primary='true'], form");
            if (!u || !p || !f) return;
            u.value = ${JSON.stringify(officeAllyUsername)};
            p.value = ${JSON.stringify(officeAllyPassword)};
            f.submit();
          })();
        `,
      },
      { action: "waitForTimeout", timeout: postLoginWaitSeconds },
      { action: "evaluate", source: `window.location.href = ${JSON.stringify(patientVisitsUrl)};` },
      { action: "waitForTimeout", timeout: pageReady },
      { action: "waitForTimeout", timeout: extraSettle },
      {
        action: "evaluate",
        source: `
          (function () {
            var by = document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchBy");
            if (by) by.value = "PatientLastName";
            if (by) by.dispatchEvent(new Event("change", { bubbles: true }));
            var cond = document.getElementById("ctl00_phFolderContent_ucSearch_lstSearchCondition");
            if (cond) cond.value = "StartsWith";
            if (cond) cond.dispatchEvent(new Event("change", { bubbles: true }));
            var txt = document.getElementById("ctl00_phFolderContent_ucSearch_txtSearch");
            if (txt) txt.value = ${JSON.stringify(normalizedLastName)};
            if (txt) txt.dispatchEvent(new Event("input", { bubbles: true }));
            if (txt) txt.dispatchEvent(new Event("change", { bubbles: true }));
            var btn = document.getElementById("ctl00_phFolderContent_ucSearch_btnSearch");
            if (btn) btn.click();
          })();
        `,
      },
      { action: "waitForTimeout", timeout: postSearch },
    ],
  };
  const response = await axiosPostZyteExtract({
    endpoint,
    payload,
    apiKey,
    timeoutMs: zytePatientVisitsExtractTimeoutMs(),
    logPrefix: `patient-visits lastName=${normalizedLastName}`,
    onAttemptFailure: async ({ attempt, transportRetries, error, responseData }) => {
      const meta = formatAxiosErrorMeta(error);
      await writeZyteArtifacts({
        label: `patient-visits-lastname-fail-${String(normalizedLastName).replace(/[^a-z0-9_-]/gi, "_")}-attempt-${attempt}-of-${transportRetries}`,
        responseData,
        failureMeta: {
          kind: "patient_visits_last_name_transport_or_http",
          patientLastName: normalizedLastName,
          attempt,
          transportRetries,
          axiosCode: meta.code,
          httpStatus: meta.status,
          message: meta.message,
        },
      });
    },
  });
  const html = response?.data?.browserHtml || "";
  return parsePatientVisitsFromHtml(html);
}

function detectZyteHtmlState(html) {
  const body = String(html || "").toLowerCase();
  if (!body.trim()) return "empty_html";
  if (body.includes("tbldailyapp")) return "appointments_table_present";
  if (
    body.includes("patient visit list") ||
    body.includes("ctl00_phfoldercontent_ucsearch_lstsearchby") ||
    body.includes("ctl00_phfoldercontent_mycustomgrid_mygrid")
  ) {
    return "patient_visits_present";
  }
  if (
    body.includes("editpatient.aspx") ||
    body.includes("ctl00_phfoldercontent_ucpatient_insurancename") ||
    body.includes("ctl00_phfoldercontent_ucpatient_insurancesubscriberid") ||
    body.includes("id=\"tbltab1\"")
  ) {
    return "patient_detail_present";
  }
  if (
    body.includes("input name=\"username\"") ||
    body.includes("id=\"username\"") ||
    body.includes("input name='username'")
  ) {
    return "login_page_returned";
  }
  if (body.includes("captcha") || body.includes("human visitor")) {
    return "captcha_or_bot_challenge";
  }
  return "unknown_page_shape";
}

function artifactDir() {
  return path.resolve(process.cwd(), "debug");
}

function formatAxiosErrorMeta(error) {
  if (error == null) {
    return {
      status: null,
      detail: "{}",
      code: null,
      message: "unknown_error_no_exception_recorded",
      isAxiosError: false,
      method: null,
      url: null,
      timeoutMs: null,
    };
  }
  const status = error?.response?.status ?? null;
  const responseData = error?.response?.data;
  const detail = typeof responseData === "string"
    ? responseData
    : JSON.stringify(responseData || {});
  return {
    status,
    detail,
    code: error?.code || null,
    message: error?.message || String(error),
    isAxiosError: Boolean(error?.isAxiosError),
    method: error?.config?.method || null,
    url: error?.config?.url || null,
    timeoutMs: error?.config?.timeout || null,
  };
}

function isRetryableZyteTransportError(error) {
  const code = String(error?.code || "").toUpperCase();
  return (
    code === "ECONNRESET" ||
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "EAI_AGAIN"
  );
}

function normalizeZyteExtractResponseData(raw) {
  if (raw == null) return {};
  if (Buffer.isBuffer(raw)) {
    try {
      const txt = raw.toString("utf8");
      return JSON.parse(txt);
    } catch {
      return {};
    }
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return { _rawBodySnippet: raw.slice(0, 12000) };
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

function escapeHtmlForArtifact(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function axiosPostZyteExtract({
  endpoint,
  payload,
  apiKey,
  timeoutMs,
  logPrefix = "zyte-extract",
  onAttemptFailure = null,
}) {
  const transportRetries = Math.max(
    1,
    Number(process.env.OA_ZYTE_TRANSPORT_RETRIES || 3),
  );
  let attempt = 0;
  let lastErr = null;
  while (attempt < transportRetries) {
    attempt += 1;
    try {
      return await axios.post(endpoint, payload, {
        headers: { "Content-Type": "application/json" },
        auth: { username: apiKey },
        timeout: timeoutMs,
      });
    } catch (err) {
      lastErr = err;
      const responseData = normalizeZyteExtractResponseData(err?.response?.data);
      if (typeof onAttemptFailure === "function") {
        try {
          await onAttemptFailure({
            attempt,
            transportRetries,
            error: err,
            responseData,
          });
        } catch {
          /* ignore artifact helper failures */
        }
      }
      if (!isRetryableZyteTransportError(err) || attempt >= transportRetries) {
        throw err;
      }
      const delayMs = Math.min(5000, 800 * attempt);
      // eslint-disable-next-line no-console
      console.warn(
        `[zyte] ${logPrefix} transport retry attempt=${attempt}/${transportRetries} code=${
          err?.code || "n/a"
        } delay_ms=${delayMs}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

async function writeZyteArtifacts({
  label,
  responseData = {},
  failureMeta = null,
}) {
  const dir = artifactDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const safeLabel = String(label || "variant").replace(/[^a-z0-9_-]/gi, "_");

  const merged =
    responseData && typeof responseData === "object" && !Buffer.isBuffer(responseData)
      ? responseData
      : normalizeZyteExtractResponseData(responseData);

  let html = merged?.browserHtml;
  if (!html && failureMeta) {
    const meta = {
      ...failureMeta,
      responseKeys: Object.keys(merged || {}),
    };
    html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Zyte extract failure</title></head><body><pre>${escapeHtmlForArtifact(
      JSON.stringify(meta, null, 2),
    )}</pre></body></html>`;
  }
  if (html) {
    const htmlPath = path.join(dir, `zyte-${safeLabel}.html`);
    await fs.promises.writeFile(htmlPath, String(html), "utf8");
    // eslint-disable-next-line no-console
    console.log(`[zyte] html snapshot saved: ${htmlPath}`);
  }

  const screenshotB64 = merged?.screenshot;
  if (screenshotB64) {
    const pngPath = path.join(dir, `zyte-${safeLabel}.png`);
    await fs.promises.writeFile(pngPath, Buffer.from(screenshotB64, "base64"));
    // eslint-disable-next-line no-console
    console.log(`[zyte] screenshot saved: ${pngPath}`);
  }
}

async function requestZyteRenderedHtml({
  url,
  officeAllyUsername,
  officeAllyPassword,
  postLoginWaitSeconds = 12,
  calendarDateTitle = "",
  expectedHtmlStates = [],
  collectPatientDetailsInPage = false,
}) {
  const apiKey = String(env.officeAlly.zyteApiKey || "").trim();
  if (!apiKey) return null;

  const endpoint = String(env.officeAlly.zyteApiUrl || "https://api.zyte.com/v1/extract");
  const commonHeaders = { "Content-Type": "application/json" };
  const targetUrl = String(url || "").trim();
  const baseUrl = String(env.officeAlly.baseUrl || "").trim();
  const appointmentsBaseUrl = new URL(
    "/pm/Appointments/ViewAppointments.aspx?Tab=A&View=d",
    baseUrl,
  ).toString();
  const css = (value) => ({ type: "css", value });

  const zytePatientCollectorActions = collectPatientDetailsInPage
    ? [
        {
          action: "evaluate",
          source: `(function(){window.__nxSetPayload=function(o){var n=document.getElementById("nexxaura-zyte-patient-payload");if(!n){n=document.createElement("script");n.id="nexxaura-zyte-patient-payload";n.type="application/json";document.body.appendChild(n);}n.textContent=JSON.stringify(o||{});};window.__nxClean=function(v){return String(v||"").replace(/\\s+/g," ").trim();};window.__nxSel=function(d,id){var el=d.getElementById(id);if(!el||!el.options)return"";var opt=Array.prototype.slice.call(el.options).filter(function(x){return x.selected;})[0];return window.__nxClean(opt?opt.textContent:"");};window.__nxVal=function(d,id){var el=d.getElementById(id);return window.__nxClean(el?el.value:"");};window.__nxTxt=function(d,id){var el=d.getElementById(id);return window.__nxClean(el?el.textContent:"");};window.__nxParseI=function(html){var d=new DOMParser().parseFromString(String(html||""),"text/html");function v(id){return window.__nxVal(d,id);}function t(id){return window.__nxTxt(d,id);}function s(id){return window.__nxSel(d,id);}var p=v("ctl00_phFolderContent_ucPatient_PAEnrollment_hdnPAPatientID")||v("ctl00_phFolderContent_ucPatient_hdnPatientID");var P="ctl00_phFolderContent_ucPatient_";var pri={insuranceType:t("lblMultiSelectddlPatientInsuranceType"),insuranceCompanyId:v(P+"InsuranceID"),insuranceName:v(P+"InsuranceName"),insuredId:v(P+"InsuredID"),insuredLastName:v(P+"InsuredLastName"),insuredFirstName:v(P+"InsuredFirstName"),relationshipToInsured:s(P+"lstRelationshipToInsuredID"),subscriberId:v(P+"InsuranceSubscriberID"),groupNo:v(P+"InsuranceGroupNo"),planName:v(P+"InsurancePlanName")};var sec={insuranceType:t("lblMultiSelectddlPatientInsuranceType2"),insuranceCompanyId:v(P+"SecondaryInsuranceID"),insuranceName:v(P+"SecondaryInsuranceName"),insuredId:v(P+"SecondaryInsuredID"),relationshipToInsured:s(P+"lstRelationshipToSecondaryInsuredID"),subscriberId:v(P+"SecondaryInsuranceSubscriberID"),groupNo:v(P+"SecondaryInsuranceGroupNo"),planName:v(P+"SecondaryInsurancePlanName")};var thi={insuranceType:t("lblMultiSelectddlPatientInsuranceType3"),insuranceCompanyId:v(P+"ThirdInsuranceID"),insuranceName:v(P+"ThirdInsuranceName"),insuredId:v(P+"ThirdInsuredID"),relationshipToInsured:s(P+"lstRelationshipToThirdInsuredID"),subscriberId:v(P+"ThirdInsuranceSubscriberID"),groupNo:v(P+"ThirdInsuranceGroupNo"),planName:v(P+"ThirdInsurancePlanName")};return{patientTab:{patientId:p},insuranceTab:{primaryInsurance:pri,secondaryInsurance:sec,thirdInsurance:thi}}};window.__nxFetchTextSync=function(url){var x=new XMLHttpRequest();x.open("GET",url,false);x.withCredentials=true;x.send(null);return{status:x.status||0,text:String(x.responseText||"")};};window.__nxCollectFromDaily=function(){try{var out={},seen={},trs=document.querySelectorAll("#tblDailyApp tr");for(var i=0;i<trs.length;i++){var cells=trs[i].querySelectorAll("td");if(cells.length<10)continue;var pc=cells[3],a=pc&&pc.querySelector("a"),h=a?a.getAttribute("href")||"":"";if(!h)continue;var abs;try{abs=new URL(h,window.location.href).toString();}catch(e){continue;}var pid=(/[?&](?:PID|PatientID|InsuredID|ID)=(\\d+)/i.exec(abs)||[])[1]||"",key=pid||abs;if(!key||seen[key])continue;seen[key]=1;try{var fetchUrl=(function(a,pid){try{var u=new URL(a,window.location.href);if(!/EditPatient\\.aspx/i.test(u.pathname))return a;var id=String(pid||"").trim();if(id)u.searchParams.set("PID",id);u.searchParams.set("Tab","P");u.searchParams.set("PageAction","edit");if(!u.searchParams.get("From"))u.searchParams.set("From","ViewAppointments");return u.toString();}catch(e){return a;}})(abs,pid);var r=window.__nxFetchTextSync(fetchUrl);var html=r.text||"";var low=html.toLowerCase();var parsed=window.__nxParseI(html);parsed.__debug={httpStatus:r.status,respLen:html.length,fetchUrl:fetchUrl,insuranceFetchMode:"patient_tab_html",hasTblTab1:low.indexOf("tbltab1")>=0,hasInsuranceNameId:html.indexOf("ctl00_phFolderContent_ucPatient_InsuranceName")>=0,looksLikeLogin:low.indexOf('id="username"')>=0||low.indexOf("name='username'")>=0||low.indexOf('name="username"')>=0};out[key]=parsed;}catch(err){out[key]={scrapeError:String(err&&err.message?err.message:"detail fetch failed")};}}window.__nxSetPayload(out);}catch(e2){window.__nxSetPayload({__error:String(e2&&e2.message?e2.message:"payload collection failed")});}};})();`,
        },
        {
          action: "evaluate",
          source: `(function(){if(window.__nxCollectFromDaily)window.__nxCollectFromDaily();})();`,
        },
        {
          action: "evaluate",
          source: `(function(){var n=document.getElementById("nexxaura-zyte-patient-payload");window.__nxPidPayload=n?String(n.textContent||"{}"):"{}";})();`,
        },
        {
          action: "evaluate",
          source: `(function(){window.__nxVisitAccum=window.__nxVisitAccum||{};window.__nxVisitFormState=null;window.__nxVisitFns={sf:function(html){var d=(typeof html==="string"?new DOMParser().parseFromString(html,"text/html"):html);var o={};Array.prototype.forEach.call(d.querySelectorAll("input[type='hidden'][name]"),function(el){o[el.name]=el.value||""});o.__EVENTTARGET="";o.__EVENTARGUMENT="";return o},gf:function(u){var x=new XMLHttpRequest();x.open("GET",u,false);x.withCredentials=true;x.send(null);return{s:x.status||0,t:String(x.responseText||"")}},pf:function(u,f){var b=Object.keys(f).map(function(k){return encodeURIComponent(k)+"="+encodeURIComponent(f[k]==null?"":String(f[k]))}).join("&");var x=new XMLHttpRequest();x.open("POST",u,false);x.withCredentials=true;x.setRequestHeader("Content-Type","application/x-www-form-urlencoded");x.send(b);return{s:x.status||0,t:String(x.responseText||"")}},pv:function(html){var out=[],doc=new DOMParser().parseFromString(String(html||""),"text/html"),rows=doc.querySelectorAll("tr.jqgrow,#ctl00_phFolderContent_myCustomGrid_myGrid tr");for(var ri=0;ri<rows.length;ri++){var cells=rows[ri].querySelectorAll("td");if(!cells.length)continue;var m={};for(var ci=0;ci<cells.length;ci++){var td=cells[ci],raw=(td.getAttribute("aria-describedby")||td.id||"").split("_").pop(),k=String(raw||"").trim().toLowerCase();if(!k)continue;m[k]=String(td.textContent||"").replace(/\\s+/g," ").trim()}var vid=m.id||"",vdt=m.datevisited||m.visitdate||"";if(vid&&vdt)out.push({pmVisitId:vid,visitDate:vdt,visitType:m.visittype||m.type||null,providerName:m.provider||m.providername||null,status:m.status||null,charges:m.charges||null,balance:m.balances||m.balance||null,rawCellMap:m})}return out}}})();`,
        },
        {
          action: "evaluate",
          source: `(function(){var t=document.querySelector("#patient-visits_tab")||document.querySelector("li#patient-visits_tab")||document.querySelector("[id='patient-visits_tab'] span");if(t&&typeof t.click==="function")t.click();})();`,
        },
        {
          action: "waitForTimeout",
          timeout: Number(process.env.OA_ZYTE_VISIT_TAB_WAIT_SECONDS || 5),
        },
        ...(() => {
          const perChunk = Math.max(
            1,
            Math.min(6, Number(process.env.OA_ZYTE_VISITS_PER_CHUNK_EVAL || 3)),
          );
          const chunkCount = Math.max(
            1,
            Math.min(24, Number(process.env.OA_ZYTE_VISIT_CHUNK_COUNT || 12)),
          );
          const chunks = [];
          for (let ch = 0; ch < chunkCount; ch += 1) {
            chunks.push({
              action: "evaluate",
              source: `(function(){var CH=${ch},PC=${perChunk},F=window.__nxVisitFns,acc=window.__nxVisitAccum||(window.__nxVisitAccum={});if(!F)return;var raw=window.__nxPidPayload||"{}";var P={};try{P=JSON.parse(String(raw))}catch(e){return}var ids=Object.keys(P).filter(function(k){return/^\\d+$/.test(String(k))}).sort(function(a,b){return Number(a)-Number(b)});var slice=ids.slice(CH*PC,(CH+1)*PC);if(!slice.length)return;var base=String(window.location.href||"").split("#")[0];var vu=new URL("/pm/PatientVisits/Visits.aspx?Tab=V",base).toString();var st=window.__nxVisitFormState;if(!st){var fr=F.gf(vu);if(fr.s>=400)return;st=F.sf(fr.t);window.__nxVisitFormState=st}for(var i=0;i<slice.length;i++){var pid=slice[i],fd={},k;for(k in st)fd[k]=st[k];fd["ctl00$phFolderContent$ucSearch$lstSearchBy"]="PatientID";fd["ctl00$phFolderContent$ucSearch$lstSearchCondition"]="EqualsTo";fd["ctl00$phFolderContent$ucSearch$txtSearch"]=String(pid);fd["ctl00$phFolderContent$ucSearch$btnSearch"]=" Search ";var pr=F.pf(vu,fd);acc[String(pid)]=pr.s<400&&pr.t?F.pv(pr.t):[];st=F.sf(pr.t);window.__nxVisitFormState=st}})();`,
            });
            chunks.push({
              action: "waitForTimeout",
              timeout: Number(process.env.OA_ZYTE_VISIT_CHUNK_GAP_SECONDS || 0.35),
            });
          }
          return chunks;
        })(),
        {
          action: "evaluate",
          source: `(function(){var acc=window.__nxVisitAccum||{};var raw=window.__nxPidPayload||"{}";var P={};try{P=JSON.parse(String(raw))}catch(e){return}Object.keys(acc).forEach(function(pid){var ex=P[pid]&&typeof P[pid]==="object"&&!Array.isArray(P[pid])?P[pid]:{};ex.patientVisits=acc[pid]||[];P[pid]=ex});var json=JSON.stringify(P);window.__nxPidPayload=json;var node=document.getElementById("nexxaura-zyte-patient-payload");if(node){node.textContent=json;return}if(window.__nxSetPayload)window.__nxSetPayload(P);else{node=document.createElement("script");node.id="nexxaura-zyte-patient-payload";node.type="application/json";document.body.appendChild(node);node.textContent=json}})();`,
        },
        {
          action: "evaluate",
          source: `(function(){
            function parsePayloadNode() {
              var node = document.getElementById("nexxaura-zyte-patient-payload");
              if (!node) return {};
              try { return JSON.parse(String(node.textContent || "{}")); } catch (e) { return {}; }
            }
            function writePayload(data) {
              if (window.__nxSetPayload) return window.__nxSetPayload(data || {});
              var node = document.getElementById("nexxaura-zyte-patient-payload");
              if (!node) {
                node = document.createElement("script");
                node.id = "nexxaura-zyte-patient-payload";
                node.type = "application/json";
                document.body.appendChild(node);
              }
              node.textContent = JSON.stringify(data || {});
            }
            try {
              // Align Zyte sequencing with Playwright intent:
              // appointments -> visits -> manage-patients details.
              var payload = parsePayloadNode();
              var keys = Object.keys(payload || {}).filter(function (k) { return /^\\d+$/.test(String(k || "")); });
              keys.forEach(function (pid) {
                var existing = payload[pid];
                if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
                  existing = {};
                }
                var patientUrl = "https://pm.officeally.com/pm/ManagePatients/EditPatient.aspx?Tab=P&PageAction=edit&PID=" + encodeURIComponent(String(pid)) + "&From=ViewAppointments";
                try {
                  var r = window.__nxFetchTextSync ? window.__nxFetchTextSync(patientUrl) : { status: 0, text: "" };
                  var html = String(r && r.text ? r.text : "");
                  var low = html.toLowerCase();
                  var parsed = window.__nxParseI ? window.__nxParseI(html) : {};
                  parsed.__debug = {
                    httpStatus: r && r.status ? r.status : 0,
                    respLen: html.length,
                    fetchUrl: patientUrl,
                    insuranceFetchMode: "patient_tab_html_after_visits",
                    hasTblTab1: low.indexOf("tbltab1") >= 0,
                    hasInsuranceNameId: html.indexOf("ctl00_phFolderContent_ucPatient_InsuranceName") >= 0,
                    looksLikeLogin: low.indexOf('id="username"') >= 0 || low.indexOf("name='username'") >= 0 || low.indexOf('name="username"') >= 0,
                  };
                  var visits = Array.isArray(existing.patientVisits) ? existing.patientVisits : [];
                  payload[pid] = {
                    patientTab: parsed.patientTab || {},
                    insuranceTab: parsed.insuranceTab || {},
                    __debug: parsed.__debug || {},
                    patientVisits: visits,
                  };
                } catch (e) {
                  var keepVisits = Array.isArray(existing.patientVisits) ? existing.patientVisits : [];
                  existing.scrapeError = String(e && e.message ? e.message : e);
                  existing.patientVisits = keepVisits;
                  payload[pid] = existing;
                }
              });
              writePayload(payload);
            } catch (e2) {
              // keep current payload if post-visit patient refresh fails
            }
          })();`,
        },
        { action: "waitForTimeout", timeout: 3.0 },
        // Ending on Patient Visits breaks success check (expects appointments_table_present)
        // and loses embedded payload on full navigation unless we snapshot first.
        {
          action: "evaluate",
          source: `(function(){var n=document.getElementById("nexxaura-zyte-patient-payload");window.__nxFinalPatientPayload=n?String(n.textContent||""):String(window.__nxPidPayload||"{}");if(!window.__nxFinalPatientPayload)window.__nxFinalPatientPayload="{}";})();`,
        },
        {
          action: "evaluate",
          source: `window.location.href = ${JSON.stringify(targetUrl)};`,
        },
        {
          action: "waitForTimeout",
          timeout: Number(process.env.OA_ZYTE_RETURN_TO_DAILY_WAIT_SECONDS || 5),
        },
        {
          action: "evaluate",
          source: `(function(){try{var j=window.__nxFinalPatientPayload||"{}";var node=document.getElementById("nexxaura-zyte-patient-payload");if(node){node.textContent=j;return;}node=document.createElement("script");node.id="nexxaura-zyte-patient-payload";node.type="application/json";node.textContent=j;(document.body||document.documentElement).appendChild(node);}catch(e){}})();`,
        },
        { action: "waitForTimeout", timeout: 2.0 },
      ]
    : [];

  // Zyte action grammar can differ by account/version.
  // Try a few compatible payload shapes before failing hard.
  const payloadVariants = [
    {
      label: "auth0-evaluate-calendar-click",
      payload: {
        url: baseUrl,
        browserHtml: true,
        screenshot: true,
        actions: [
          { action: "waitForTimeout", timeout: 1.0 },
          {
            action: "evaluate",
            source: `
              (function () {
                const u = document.querySelector("#username, input[name='username']");
                const p = document.querySelector("#password, input[name='password']");
                const f = document.querySelector("form[data-form-primary='true'], form");
                if (!u || !p || !f) return;
                u.focus();
                u.value = ${JSON.stringify(officeAllyUsername)};
                u.dispatchEvent(new Event("input", { bubbles: true }));
                u.dispatchEvent(new Event("change", { bubbles: true }));
                p.focus();
                p.value = ${JSON.stringify(officeAllyPassword)};
                p.dispatchEvent(new Event("input", { bubbles: true }));
                p.dispatchEvent(new Event("change", { bubbles: true }));
                f.submit();
              })();
            `,
          },
          { action: "waitForTimeout", timeout: postLoginWaitSeconds },
          { action: "evaluate", source: `window.location.href = ${JSON.stringify(appointmentsBaseUrl)};` },
          { action: "waitForTimeout", timeout: 4.0 },
          ...(calendarDateTitle
            ? [
                {
                  action: "click",
                  selector: css(
                    `#ctl00_phFolderContent_Appointments_Calendar1 a[title='${String(
                      calendarDateTitle,
                    ).replace(/'/g, "\\'")}']`,
                  ),
                },
                { action: "waitForTimeout", timeout: 4.0 },
              ]
            : []),
          { action: "evaluate", source: `window.location.href = ${JSON.stringify(targetUrl)};` },
          { action: "waitForTimeout", timeout: 3.0 },
          ...zytePatientCollectorActions,
        ],
      },
    },
    {
      label: "auth0-evaluate-submit",
      payload: {
        url: baseUrl,
        browserHtml: true,
        screenshot: true,
        actions: [
          { action: "waitForTimeout", timeout: 1.0 },
          {
            action: "evaluate",
            source: `
              (function () {
                const u = document.querySelector("#username, input[name='username']");
                const p = document.querySelector("#password, input[name='password']");
                const f = document.querySelector("form[data-form-primary='true'], form");
                if (!u || !p || !f) return;
                u.focus();
                u.value = ${JSON.stringify(officeAllyUsername)};
                u.dispatchEvent(new Event("input", { bubbles: true }));
                u.dispatchEvent(new Event("change", { bubbles: true }));
                p.focus();
                p.value = ${JSON.stringify(officeAllyPassword)};
                p.dispatchEvent(new Event("input", { bubbles: true }));
                p.dispatchEvent(new Event("change", { bubbles: true }));
                f.submit();
              })();
            `,
          },
          // Office Ally/Auth0 can take time to finish redirect/session bootstrap.
          { action: "waitForTimeout", timeout: postLoginWaitSeconds },
          { action: "evaluate", source: `window.location.href = ${JSON.stringify(targetUrl)};` },
          { action: "waitForTimeout", timeout: postLoginWaitSeconds },
          ...zytePatientCollectorActions,
        ],
      },
    },
  ];
  const wantAppointments = expectedHtmlStates.includes("appointments_table_present");
  const wantPatientDetail = expectedHtmlStates.includes("patient_detail_present");
  /** Submit-first: shorter action chain; calendar-click often hits limits / ends on Patient Visits. */
  const appointmentVariantPreference = [
    "auth0-evaluate-submit",
    "auth0-evaluate-calendar-click",
  ];
  const orderedVariants = wantPatientDetail
    ? payloadVariants.filter((v) => v.label === "auth0-evaluate-submit")
    : wantAppointments
      ? appointmentVariantPreference
          .map((label) => payloadVariants.find((v) => v.label === label))
          .filter(Boolean)
      : payloadVariants;

  let lastErr = null;
  for (const variant of orderedVariants) {
    try {
      // eslint-disable-next-line no-console
      console.log(`[zyte] trying variant=${variant.label} login_flow=start`);
      let response = null;
      const transportRetries = Math.max(
        1,
        Number(process.env.OA_ZYTE_TRANSPORT_RETRIES || 3),
      );
      let attempt = 0;
      while (attempt < transportRetries) {
        attempt += 1;
        try {
          response = await axios.post(endpoint, variant.payload, {
            headers: commonHeaders,
            auth: { username: apiKey },
            timeout: 120000,
          });
          break;
        } catch (err) {
          if (!isRetryableZyteTransportError(err) || attempt >= transportRetries) {
            throw err;
          }
          const delayMs = Math.min(5000, 800 * attempt);
          // eslint-disable-next-line no-console
          console.warn(
            `[zyte] transport retry variant=${variant.label} attempt=${attempt}/${transportRetries} code=${
              err?.code || "n/a"
            } delay_ms=${delayMs}`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
      await writeZyteArtifacts({
        label: variant.label,
        responseData: response?.data || {},
      }).catch(() => {});
      const html = response?.data?.browserHtml || null;
      const state = detectZyteHtmlState(html || "");
      const acceptableStates = Array.isArray(expectedHtmlStates) && expectedHtmlStates.length
        ? expectedHtmlStates
        : ["appointments_table_present", "patient_detail_present", "unknown_page_shape"];
      const loginSuccess = acceptableStates.includes(state);
      // eslint-disable-next-line no-console
      console.log(
        `[zyte] variant=${variant.label} login_flow=done html_state=${state} login_success=${loginSuccess}`,
      );
      if (html && loginSuccess) return html;
      lastErr = new Error(
        `Zyte variant=${variant.label} finished but html_state=${state} not acceptable for this scrape (wanted_one_of=${JSON.stringify(
          acceptableStates,
        )})`,
      );
    } catch (error) {
      lastErr = error;
      const meta = formatAxiosErrorMeta(error);
      // eslint-disable-next-line no-console
      console.warn(
        `[zyte] variant failed (${variant.label}) status=${meta.status || "n/a"} code=${
          meta.code || "n/a"
        } timeout_ms=${meta.timeoutMs || "n/a"} detail=${meta.detail} message=${meta.message}`,
      );
    }
  }

  const meta = formatAxiosErrorMeta(lastErr);
  throw new Error(
    `Zyte extract failed after retries. status=${meta.status || "n/a"} code=${
      meta.code || "n/a"
    } timeout_ms=${meta.timeoutMs || "n/a"} method=${meta.method || "n/a"} url=${
      meta.url || "n/a"
    } detail=${meta.detail} message=${meta.message}`,
  );
}

async function scrapePatientAndInsuranceDetails(page) {
  return page.evaluate(() => {
    const clean = (v) =>
      String(v || "")
        .replace(/\s+/g, " ")
        .trim();
    const patientRoot = document.querySelector("#tblTab0") || document;
    const insuranceRoot = document.querySelector("#tblTab1") || document;
    const byIdWithin = (root, id) =>
      root?.querySelector(`#${CSS.escape(id)}`) || document.getElementById(id);
    const byId = (id) => byIdWithin(document, id);
    const byIdValue = (id, root = document) => clean(byIdWithin(root, id)?.value);
    const byIdText = (id, root = document) => clean(byIdWithin(root, id)?.textContent);
    const selectedText = (id, root = document) => {
      const el = byIdWithin(root, id);
      if (!el || !el.options) return "";
      const selected = Array.from(el.options).find((opt) => opt.selected);
      return clean(selected?.textContent);
    };
    const multiLabelText = (id, root = document) => byIdText(`lblMultiSelect${id}`, root);

    const joinDateParts = (prefix) => {
      const m = byIdValue(`${prefix}_Month`);
      const d = byIdValue(`${prefix}_Day`);
      const y = byIdValue(`${prefix}_Year`);
      if (!m && !d && !y) return "";
      return `${m}/${d}/${y}`.replace(/^\/+|\/+$/g, "");
    };

    const joinPhone = (prefix) => {
      const a = byIdValue(`${prefix}_AreaCode`);
      const p = byIdValue(`${prefix}_Prefix`);
      const n = byIdValue(`${prefix}_Number`);
      const ext = byIdValue(`${prefix}_Extension`);
      const base = [a, p, n].filter(Boolean).join("-");
      if (!base) return "";
      return ext ? `${base} x${ext}` : base;
    };

    const patientTab = {
      patientId:
        byIdValue(
          "ctl00_phFolderContent_ucPatient_PAEnrollment_hdnPAPatientID",
          patientRoot,
        ) || byIdValue("ctl00_phFolderContent_ucPatient_hdnPatientID", patientRoot),
      firstName: byIdValue("ctl00_phFolderContent_ucPatient_FirstName", patientRoot),
      middleName: byIdValue("ctl00_phFolderContent_ucPatient_MiddleName", patientRoot),
      lastName: byIdValue("ctl00_phFolderContent_ucPatient_LastName", patientRoot),
      dob: joinDateParts("ctl00_phFolderContent_ucPatient_DOB"),
      sex: selectedText("ctl00_phFolderContent_ucPatient_lstGender", patientRoot),
      maritalStatus: selectedText(
        "ctl00_phFolderContent_ucPatient_lstMaritalStatus",
        patientRoot,
      ),
      employmentStatus: selectedText(
        "ctl00_phFolderContent_ucPatient_lstEmploymentStatus",
        patientRoot,
      ),
      professionalTitle: byIdValue(
        "ctl00_phFolderContent_ucPatient_ProfessionalTitle",
        patientRoot,
      ),
      preferredLanguage: selectedText(
        "ctl00_phFolderContent_ucPatient_ddlLanguage",
        patientRoot,
      ),
      religion: selectedText("ctl00_phFolderContent_ucPatient_ddlReligion", patientRoot),
      ethnicity: multiLabelText("ddlEthnicity", patientRoot),
      race: multiLabelText("ddlRace", patientRoot),
      addressLine1: byIdValue("ctl00_phFolderContent_ucPatient_AddressLine1", patientRoot),
      addressLine2: byIdValue("ctl00_phFolderContent_ucPatient_AddressLine2", patientRoot),
      city: byIdValue("ctl00_phFolderContent_ucPatient_City", patientRoot),
      state: selectedText("ctl00_phFolderContent_ucPatient_lstState", patientRoot),
      zip: byIdValue("ctl00_phFolderContent_ucPatient_Zip", patientRoot),
      homePhone: joinPhone("ctl00_phFolderContent_ucPatient_HomePhone"),
      workPhone: joinPhone("ctl00_phFolderContent_ucPatient_WorkPhone"),
      cellPhone: joinPhone("ctl00_phFolderContent_ucPatient_CellPhone"),
      fax: joinPhone("ctl00_phFolderContent_ucPatient_Fax"),
      preferredPhone: selectedText(
        "ctl00_phFolderContent_ucPatient_lstPreferredPhone",
        patientRoot,
      ),
      email: byIdValue("ctl00_phFolderContent_ucPatient_Email", patientRoot),
      communicationPreference: selectedText(
        "ctl00_phFolderContent_ucPatient_ddlPatientReminder",
        patientRoot,
      ),
      employerName: byIdValue("ctl00_phFolderContent_ucPatient_EmployerName", patientRoot),
      emergencyContactName: byIdValue(
        "ctl00_phFolderContent_ucPatient_EmergencyContactName",
        patientRoot,
      ),
      emergencyContactRelation: byIdValue(
        "ctl00_phFolderContent_ucPatient_EmergencyContactRelation",
        patientRoot,
      ),
      nextOfKinName: byIdValue(
        "ctl00_phFolderContent_ucPatient_NextKinContactName",
        patientRoot,
      ),
      nextOfKinRelation: selectedText(
        "ctl00_phFolderContent_ucPatient_lstNextKinRelation",
        patientRoot,
      ),
    };

    const primaryInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType", insuranceRoot),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceID",
        insuranceRoot,
      ),
      insuranceName: byIdValue("ctl00_phFolderContent_ucPatient_InsuranceName", insuranceRoot),
      insuredId: byIdValue("ctl00_phFolderContent_ucPatient_InsuredID", insuranceRoot),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuredLastName",
        insuranceRoot,
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuredFirstName",
        insuranceRoot,
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToInsuredID",
        insuranceRoot,
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceSubscriberID",
        insuranceRoot,
      ),
      groupNo: byIdValue("ctl00_phFolderContent_ucPatient_InsuranceGroupNo", insuranceRoot),
      planName: byIdValue("ctl00_phFolderContent_ucPatient_InsurancePlanName", insuranceRoot),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceDeductible",
        insuranceRoot,
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceVisitCopay",
        insuranceRoot,
      ),
      signatureOnFile: selectedText(
        "ctl00_phFolderContent_ucPatient_lstSignatureOnFile",
        insuranceRoot,
      ),
      signatureDate: joinDateParts(
        "ctl00_phFolderContent_ucPatient_SignatureOnFileDate",
      ),
    };

    const secondaryInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType2", insuranceRoot),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceID",
        insuranceRoot,
      ),
      insuranceName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceName",
        insuranceRoot,
      ),
      insuredId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredID",
        insuranceRoot,
      ),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredLastName",
        insuranceRoot,
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredFirstName",
        insuranceRoot,
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToSecondaryInsuredID",
        insuranceRoot,
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceSubscriberID",
        insuranceRoot,
      ),
      groupNo: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceGroupNo",
        insuranceRoot,
      ),
      planName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsurancePlanName",
        insuranceRoot,
      ),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceDeductible",
        insuranceRoot,
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceVisitCopay",
        insuranceRoot,
      ),
      signatureOnFile: selectedText(
        "ctl00_phFolderContent_ucPatient_lstSecondarySignatureOnFile",
        insuranceRoot,
      ),
      signatureDate: joinDateParts(
        "ctl00_phFolderContent_ucPatient_SecondarySignatureOnFileDate",
      ),
    };

    const thirdInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType3", insuranceRoot),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceID",
        insuranceRoot,
      ),
      insuranceName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceName",
        insuranceRoot,
      ),
      insuredId: byIdValue("ctl00_phFolderContent_ucPatient_ThirdInsuredID", insuranceRoot),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuredLastName",
        insuranceRoot,
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuredFirstName",
        insuranceRoot,
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToThirdInsuredID",
        insuranceRoot,
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceSubscriberID",
        insuranceRoot,
      ),
      groupNo: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceGroupNo",
        insuranceRoot,
      ),
      planName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsurancePlanName",
        insuranceRoot,
      ),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceDeductible",
        insuranceRoot,
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceVisitCopay",
        insuranceRoot,
      ),
    };

    return {
      patientTab,
      insuranceTab: { primaryInsurance, secondaryInsurance, thirdInsurance },
    };
  });
}

async function scrapeAppointmentsByDateViaPlaywright({
  appointmentDate,
  officeAllyUsername,
  officeAllyPassword,
}) {
  if (!officeAllyUsername || !officeAllyPassword) {
    throw new Error("Office Ally credentials missing for user");
  }
  const browser = await chromium.launch({
    headless: env.officeAlly.headless, slowMo: 300
  });
  const context = await browser.newContext({
    viewport: { width: 1365, height: 900 },
  });

  const page = await context.newPage();


  try {
    // 1) Reach Office Ally entry page and capture debug evidence early.
    await page.goto(env.officeAlly.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page.goto(env.officeAlly.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    console.log("?? Navigated to:", page.url());

    await page.screenshot({
      path: "debug-login-page.png",
      fullPage: true,
    });
    if (await page.locator("text=human visitor").isVisible().catch(() => false)) {
      console.log("⚠️ CAPTCHA detected");
      await page.screenshot({ path: "captcha.png" });
      throw new Error("CAPTCHA blocking automation");
    }

    // 2) Open/resolve login page.
    // New Office Ally flow often lands directly on auth.officeally.com, where the
    // legacy Practice dropdown selectors do not exist.
    const hasLegacyPracticeMenu = await page
      .locator("#w-dropdown-toggle-4")
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (hasLegacyPracticeMenu) {
      await page.locator("#w-dropdown-toggle-4").click();
      await page.locator("#nav_practice").click();
      await page.locator("#nav_practice").click();
      // wait for either redirect OR popup
      await page.waitForTimeout(3000);
    } else {
      // eslint-disable-next-line no-console
      console.log("[office-ally] legacy practice menu not found; using current page as auth entry");
    }

    const pages = context.pages();
    // eslint-disable-next-line no-console
    console.log("ALL PAGES:");
    for (const p of pages) {
      // eslint-disable-next-line no-console
      console.log(p.url());
    }

    const newPage = pages.find((p) =>
      p.url().includes("cms.officeally.com") ||
      p.url().includes("auth.officeally.com")
    ) || page;

    if (!newPage) {
      throw new Error("No usable OfficeAlly page found");
    }

    await newPage.bringToFront();
    console.log(newPage);
    console.log("Current URL1:", newPage.url());
    await newPage.screenshot({ path: "debug-after-login1.png", fullPage: true });
    await newPage.waitForLoadState("domcontentloaded");
    // console.log("Current URL2:", newPage.url());
    // await newPage.screenshot({ path: "debug-after-login2.png", fullPage: true });
    await newPage.screenshot({
      path: "debug-login-page.png",
      fullPage: true,
    });
    // 3) Authenticate with provider credentials.
    await newPage
      .locator("input[name='username'], #username")
      .first()
      .fill(officeAllyUsername);
    await newPage
      .locator("input[name='password'], #password")
      .first()
      .fill(officeAllyPassword);
    await newPage
      .locator("button[type='submit'], input[type='submit']")
      .first()
      .click();
    await newPage
      .waitForLoadState("networkidle", { timeout: 120000 })
      .catch(() => {});

    // 4) Navigate to requested day (URL first, date controls as fallback).
    const dailyUrl = buildDailyViewUrl(env.officeAlly.baseUrl, appointmentDate);
    await newPage
      .goto(dailyUrl, { waitUntil: "domcontentloaded", timeout: 120000 })
      .catch(() => {});
    const dailyTable = newPage.locator("#tblDailyApp").first();
    if (!(await dailyTable.isVisible({ timeout: 5000 }).catch(() => false))) {
      const { year, month, day } = parseDateParts(appointmentDate);
      await newPage
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Month")
        .fill(String(month))
        .catch(() => {});
      await newPage
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Day")
        .fill(String(day))
        .catch(() => {});
      await newPage
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Year")
        .fill(String(year))
        .catch(() => {});
      await newPage
        .locator("#ctl00_phFolderContent_Appointments_btnGotoDate")
        .click({ timeout: 5000 })
        .catch(() => {});
    }
    await newPage
      .locator("#tblDailyApp")
      .waitFor({ state: "visible", timeout: 30000 });

    // 5) Parse the daily schedule table.
    const rows = await newPage.evaluate(() => {
      const clean = (v) =>
        String(v || "")
          .replace(/\s+/g, " ")
          .trim();
      const rowsToRead = Array.from(
        document.querySelectorAll("#tblDailyApp tbody tr"),
      );
      const parsed = [];
      for (const tr of rowsToRead) {
        const cells = Array.from(tr.querySelectorAll("td"));
        if (cells.length < 10) continue;
        const patientCell = cells[3];
        const patientText = clean(patientCell && patientCell.textContent);
        if (!patientText) continue;
        const patientLink = patientCell.querySelector("a");
        if (!patientLink) continue;

        const timeHr = clean(cells[0] && cells[0].textContent);
        const timeMin = clean(cells[1] && cells[1].textContent);
        const provider = clean(cells[6] && cells[6].textContent);
        const reason = clean(cells[7] && cells[7].textContent);
        const status = clean(cells[8] && cells[8].textContent);
        const len = clean(cells[2] && cells[2].textContent);
        const dob = clean(cells[4] && cells[4].textContent);

        const [lastName, firstName] = patientText
          .split(",")
          .map((x) => clean(x));
        const href = patientLink.getAttribute("href") || "";
        const patientIdMatch = /[?&]PID=(\d+)/i.exec(href);
        const patientId = patientIdMatch ? patientIdMatch[1] : "";
        const patientUrl = href
          ? href.startsWith("http")
            ? href
            : new URL(href, window.location.origin).toString()
          : "";
        const apptIcon = tr.querySelector("img[onclick*='EditAppointment(']");
        let appointmentId = "";
        if (apptIcon) {
          const onclickVal = apptIcon.getAttribute("onclick") || "";
          const m = /EditAppointment\((\d+)/i.exec(onclickVal);
          appointmentId = m ? m[1] : "";
        }

        parsed.push({
          "Patient ID": patientId,
          "First Name": firstName || patientText,
          "Last Name": lastName || "",
          "Date Of Birth": dob,
          "Appointment ID": appointmentId,
          Time: `${timeHr}${timeMin ? `:${timeMin}` : ""}`,
          Provider: provider,
          Reason: reason,
          Status: status,
          "Visit Length": len,
          RawPatient: patientText,
          PatientUrl: patientUrl,
        });
      }
      return parsed;
    });

    const visitPatientIds = [
      ...new Set(
        rows
          .map((r) => String(r["Patient ID"] || "").trim())
          .filter(Boolean),
      ),
    ];
    const visitsByPatientId = {};
    if (visitPatientIds.length) {
      try {
        const visitsUrl = new URL(
          "/pm/PatientVisits/Visits.aspx?Tab=V",
          env.officeAlly.baseUrl,
        ).toString();
        await newPage
          .goto(visitsUrl, { waitUntil: "domcontentloaded", timeout: 120000 })
          .catch(() => {});

        await newPage
          .locator(
            "#ctl00_phFolderContent_ucSearch_lstSearchBy, #ctl00_phFolderContent_ucSearch_txtSearch",
          )
          .first()
          .waitFor({ state: "visible", timeout: 20000 })
          .catch(() => {});

        for (const pid of visitPatientIds) {
          await newPage
            .locator("#ctl00_phFolderContent_ucSearch_lstSearchBy")
            .first()
            .selectOption("PatientID")
            .catch(() => {});
          await newPage
            .locator("#ctl00_phFolderContent_ucSearch_lstSearchCondition")
            .first()
            .selectOption("EqualsTo")
            .catch(() => {});
          await newPage
            .locator("#ctl00_phFolderContent_ucSearch_txtSearch")
            .first()
            .fill(String(pid))
            .catch(() => {});
          await newPage
            .locator("#ctl00_phFolderContent_ucSearch_btnSearch")
            .first()
            .click({ timeout: 10000 })
            .catch(() => {});
          await newPage.waitForTimeout(1200);

          visitsByPatientId[pid] = await newPage.evaluate(() => {
            const clean = (v) =>
              String(v || "")
                .replace(/\s+/g, " ")
                .trim();
            const money = (value) => {
              const txt = clean(value).replace(/[$,]/g, "");
              const m = /-?\d+(?:\.\d+)?/.exec(txt);
              if (!m) return null;
              const n = Number(m[0]);
              return Number.isFinite(n) ? n : null;
            };
            const out = [];
            const rowsToRead = Array.from(
              document.querySelectorAll(
                "tr.jqgrow, #ctl00_phFolderContent_myCustomGrid_myGrid tr",
              ),
            );
            for (const tr of rowsToRead) {
              const cells = Array.from(tr.querySelectorAll("td"));
              if (!cells.length) continue;
              const map = {};
              for (const td of cells) {
                const rawKey =
                  td.getAttribute("aria-describedby") || td.id || "";
                const key = clean(rawKey.split("_").pop()).toLowerCase();
                if (!key) continue;
                map[key] = clean(td.textContent);
              }
              const pmVisitId = map.id || "";
              const visitDate = map.datevisited || map.visitdate || "";
              if (!pmVisitId || !visitDate) continue;
              out.push({
                pmVisitId,
                visitDate,
                visitType: map.visittype || map.type || null,
                providerName: map.provider || map.providername || null,
                status: map.status || null,
                charges: money(map.charges),
                balance: money(map.balances || map.balance),
                rawCellMap: map,
              });
            }
            return out;
          });
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[playwright] patient visits scrape failed err=${error?.message || String(error)}`,
        );
      }
    }

    // 6) Open each unique patient once to collect demographics + insurance tabs.
    const detailsByPatientId = {};
    for (const row of rows) {
      const patientId = row["Patient ID"];
      if (!patientId || detailsByPatientId[patientId]) continue;
      try {
        const patientUrl =
          row.PatientUrl ||
          buildPatientEditUrl(env.officeAlly.baseUrl, patientId, "P");
        await newPage.goto(patientUrl, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        });
        await newPage
          .locator("#tblTab0")
          .waitFor({ state: "attached", timeout: 30000 });

        const patientData = await scrapePatientAndInsuranceDetails(newPage);

        // Insurance tab is client-side (e.g. javascript:ChangePatientTab(1);) — avoid deep-link Tab=I.
        let onInsuranceTab = false;
        try {
          onInsuranceTab = await newPage.evaluate(() => {
            const fn = window.ChangePatientTab;
            if (typeof fn !== "function") return false;
            fn.call(window, 1);
            return true;
          });
        } catch {
          onInsuranceTab = false;
        }
        if (!onInsuranceTab) {
          try {
            const insuranceTabLink = newPage
              .locator(
                'a[href*="ChangePatientTab(1)"], #PatientTabs a:has-text("Insurance")',
              )
              .first();
            if (
              await insuranceTabLink
                .isVisible({ timeout: 2000 })
                .catch(() => false)
            ) {
              await insuranceTabLink.click({ timeout: 5000 });
              await newPage
                .waitForLoadState("domcontentloaded", { timeout: 30000 })
                .catch(() => {});
              onInsuranceTab = true;
            }
          } catch {
            /* */
          }
        }
        if (!onInsuranceTab) {
          try {
            const insuranceTabLink = newPage
              .locator("a[href*='Tab=I'], a:has-text('Insurance')")
              .first();
            if (
              await insuranceTabLink
                .isVisible({ timeout: 1500 })
                .catch(() => false)
            ) {
              await insuranceTabLink.click({ timeout: 5000 });
              await newPage
                .waitForLoadState("domcontentloaded", { timeout: 30000 })
                .catch(() => {});
              onInsuranceTab = true;
            }
          } catch {
            /* */
          }
        }
        if (!onInsuranceTab) {
          const insuranceUrl = withTab(patientUrl, "I");
          await newPage
            .goto(insuranceUrl, {
              waitUntil: "domcontentloaded",
              timeout: 120000,
            })
            .catch(() => {});
        }
        await newPage
          .locator("#tblTab1")
          .waitFor({ state: "attached", timeout: 30000 })
          .catch(() => {});
        const insuranceData = await scrapePatientAndInsuranceDetails(newPage);

        detailsByPatientId[patientId] = {
          patientTab: patientData.patientTab || {},
          insuranceTab: insuranceData.insuranceTab || {},
          patientVisits: visitsByPatientId[patientId] || [],
        };
      } catch (error) {
        detailsByPatientId[patientId] = {
          scrapeError: error?.message || "Failed to scrape patient details",
          patientVisits: visitsByPatientId[patientId] || [],
        };
      }
    }

    // 7) Attach details back onto each appointment row.
    return rows.map((row) => ({
      ...row,
      patientDetails: detailsByPatientId[row["Patient ID"]] || null,
    }));
  } finally {
    await browser.close();
  }
}

async function scrapeAppointmentsByDateViaZyte({
  appointmentDate,
  officeAllyUsername,
  officeAllyPassword,
}) {
  if (!env.officeAlly.zyteEnabled) {
    throw new Error(
      "Zyte scraping is disabled in runtime env. Set OA_ZYTE_ENABLED=true or provide ZYTE_API_KEY, then restart the Node process.",
    );
  }
  const dailyUrl = buildDailyViewUrl(env.officeAlly.baseUrl, appointmentDate);
  // eslint-disable-next-line no-console
  console.log(`[zyte] office ally scrape start date=${appointmentDate}`);
  let html = await requestZyteRenderedHtml({
    url: dailyUrl,
    officeAllyUsername,
    officeAllyPassword,
    calendarDateTitle: calendarTitleFromDate(appointmentDate),
    expectedHtmlStates: ["appointments_table_present"],
    collectPatientDetailsInPage: true,
  });
  if (!html) {
    throw new Error(
      "Zyte did not return rendered HTML. Check ZYTE_API_KEY and ZYTE_API_URL.",
    );
  }
  // eslint-disable-next-line no-console
  console.log("[zyte] daily HTML received; parsing appointment rows");
  let rows = parseAppointmentsFromDailyHtml(html, dailyUrl);
  if (!rows.length) {
    // eslint-disable-next-line no-console
    console.warn("[zyte] first pass parsed 0 rows; retrying with longer waits");
    const fallbackHtml = await requestZyteRenderedHtml({
      url: dailyUrl,
      officeAllyUsername,
      officeAllyPassword,
      postLoginWaitSeconds: 6,
      calendarDateTitle: calendarTitleFromDate(appointmentDate),
      expectedHtmlStates: ["appointments_table_present"],
      collectPatientDetailsInPage: true,
    });
    if (fallbackHtml) {
      html = fallbackHtml;
      rows = parseAppointmentsFromDailyHtml(html, dailyUrl);
    }
  }
  if (!rows.length) {
    const htmlState = detectZyteHtmlState(html);
    throw new Error(
      `Zyte returned zero appointment rows for the requested date. html_state=${htmlState}`,
    );
  }

  // eslint-disable-next-line no-console
  console.log(`[zyte] appointment rows parsed count=${rows.length}`);
  const { data: embeddedDetails, diagnostics: embeddedDiag } = parseEmbeddedPatientDetailsPayload(html);
  // eslint-disable-next-line no-console
  console.log(
    `[zyte] embedded patient detail payload keys=${Object.keys(embeddedDetails || {}).length}`,
  );
  if (embeddedDiag?.parseError) {
    // eslint-disable-next-line no-console
    console.warn(`[zyte] embedded JSON parse issue: ${embeddedDiag.parseError}`);
  }
  if (embeddedDetails && embeddedDetails.__error) {
    // eslint-disable-next-line no-console
    console.warn(`[zyte] embedded patient payload error=${embeddedDetails.__error}`);
  }

  const uniq = new Set(
    rows
      .map((r) => String(r["Patient ID"] || "").trim() || String(r.PatientUrl || "").trim())
      .filter(Boolean),
  );
  const missingPayloadKeys = [...uniq].filter((k) => !embeddedDetails[k]).length;
  if (missingPayloadKeys) {
    // eslint-disable-next-line no-console
    console.warn(
      `[zyte] warning: ${missingPayloadKeys} unique patients missing embedded detail payload keys`,
    );
  }

  const visitPatients = [
    ...new Set(
      rows
        .map((r) => String(r["Patient ID"] || "").trim())
        .filter(Boolean),
    ),
  ];
  const configuredMaxVisitPatients = Number(process.env.OA_PATIENT_VISITS_MAX_PATIENTS || 0);
  const maxVisitPatients = configuredMaxVisitPatients > 0
    ? configuredMaxVisitPatients
    : visitPatients.length;
  const batchSize = Number(process.env.OA_PATIENT_VISITS_BATCH_SIZE || 12);
  const batchRetries = Number(process.env.OA_PATIENT_VISITS_BATCH_RETRIES || 2);
  const retryDelayMs = Number(process.env.OA_PATIENT_VISITS_RETRY_DELAY_MS || 1200);
  const forcePerPatientDebug =
    String(process.env.OA_PATIENT_VISITS_FORCE_PER_PATIENT_DEBUG || "").toLowerCase() === "true";
  const selectedVisitPatients = visitPatients.slice(0, maxVisitPatients);
  let visitsByPatientId = {};
  for (const patientId of selectedVisitPatients) {
    const embeddedVisits = embeddedDetails?.[patientId]?.patientVisits;
    if (Array.isArray(embeddedVisits)) {
      visitsByPatientId[patientId] = embeddedVisits.map((v) => ({
        ...v,
        charges: parseMoneyLike(v?.charges),
        balance: parseMoneyLike(v?.balance),
      }));
    }
  }

  const embeddedVisitRows = Object.values(visitsByPatientId).reduce(
    (sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
    0,
  );
  const allEmbeddedVisitKeysPresent =
    selectedVisitPatients.length > 0 &&
    selectedVisitPatients.every((pid) => Object.prototype.hasOwnProperty.call(visitsByPatientId, pid));
  const shouldFallbackWhenEmbeddedEmpty = allEmbeddedVisitKeysPresent && embeddedVisitRows === 0;
  if (shouldFallbackWhenEmbeddedEmpty) {
    // eslint-disable-next-line no-console
    console.warn(
      `[zyte] embedded patient visits were all empty for ${selectedVisitPatients.length} patients; retrying via visit page fetch`,
    );
  }
  const patientsMissingVisits = shouldFallbackWhenEmbeddedEmpty
    ? selectedVisitPatients
    : selectedVisitPatients.filter(
        (pid) => !Object.prototype.hasOwnProperty.call(visitsByPatientId, pid),
      );

  if (!forcePerPatientDebug && patientsMissingVisits.length) {
    try {
      // Preferred path: keep patient visits extraction in one Zyte browser session.
      const fetchedVisitsByPatientId = await requestZytePatientVisitsByPatientIds({
        officeAllyUsername,
        officeAllyPassword,
        patientIds: patientsMissingVisits,
        debugLabelSuffix: `all-${patientsMissingVisits[0]}-to-${patientsMissingVisits[patientsMissingVisits.length - 1]}`,
      });
      visitsByPatientId = { ...visitsByPatientId, ...fetchedVisitsByPatientId };
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(
        `[zyte] single-session patient visits request failed count=${patientsMissingVisits.length} err=${
          e?.message || String(e)
        }; falling back to chunked requests`,
      );
    }
  }

  const missingAfterSingleSession = selectedVisitPatients.filter(
    (pid) => !Object.prototype.hasOwnProperty.call(visitsByPatientId, pid),
  );
  const chunks = forcePerPatientDebug
    ? missingAfterSingleSession.map((pid) => [pid])
    : splitIntoChunks(missingAfterSingleSession, batchSize);
  for (const chunk of chunks) {
    let chunkOut = null;
    let lastErr = null;
    for (let attempt = 1; attempt <= Math.max(1, batchRetries); attempt += 1) {
      try {
        chunkOut = await requestZytePatientVisitsByPatientIds({
          officeAllyUsername,
          officeAllyPassword,
          patientIds: chunk,
          debugLabelSuffix: `chunk-${chunk[0]}-to-${chunk[chunk.length - 1]}`,
        });
        break;
      } catch (e) {
        lastErr = e;
        if (attempt < batchRetries) {
          await new Promise((r) => setTimeout(r, retryDelayMs * attempt));
        }
      }
    }
    if (chunkOut) {
      visitsByPatientId = { ...visitsByPatientId, ...chunkOut };
      continue;
    }
    // Fallback: try each patient individually so one socket hang up
    // does not drop the whole chunk.
    // eslint-disable-next-line no-console
    console.warn(
      `[zyte] patient visits chunk failed size=${chunk.length} err=${
        lastErr?.message || String(lastErr)
      }; falling back to per-patient requests`,
    );
    for (const patientId of chunk) {
      try {
        visitsByPatientId[patientId] = await requestZytePatientVisitsByPatientId({
          officeAllyUsername,
          officeAllyPassword,
          patientId,
        });
      } catch (e) {
        visitsByPatientId[patientId] = [];
        // eslint-disable-next-line no-console
        console.warn(
          `[zyte] patient visits fallback failed patientId=${patientId} err=${
            e?.message || String(e)
          }`,
        );
      }
    }
  }
  const patientsWithVisits = Object.values(visitsByPatientId).filter(
    (v) => Array.isArray(v) && v.length > 0,
  ).length;
  const totalVisitRows = Object.values(visitsByPatientId).reduce(
    (sum, v) => sum + (Array.isArray(v) ? v.length : 0),
    0,
  );
  // eslint-disable-next-line no-console
  console.log(
    `[zyte] patient visits summary attempted=${selectedVisitPatients.length} fetched=${Object.keys(
      visitsByPatientId,
    ).length} patients_with_visits=${patientsWithVisits} total_visit_rows=${totalVisitRows}`,
  );

  return rows.map((row) => {
    const patientId = String(row["Patient ID"] || "").trim();
    const patientUrl = String(row.PatientUrl || "").trim();
    const detailsKey = patientId || patientUrl;
    const details = embeddedDetails[detailsKey] || null;
    if (!details) {
      return {
        ...row,
        patientDetails: {
          patientVisits: visitsByPatientId[patientId] || [],
        },
      };
    }
    const mergedPatientId =
      String(row["Patient ID"] || "").trim() ||
      String(details?.patientTab?.patientId || "").trim();
    const patientDetails = { ...details };
    delete patientDetails.__rawInsuranceHtml;
    patientDetails.patientVisits =
      visitsByPatientId[mergedPatientId || patientId] || [];
    return {
      ...row,
      "Patient ID": mergedPatientId,
      patientDetails,
    };
  });
}

async function scrapeAppointmentsByDate({
  appointmentDate,
  officeAllyUsername,
  officeAllyPassword,
}) {
  if (!officeAllyUsername || !officeAllyPassword) {
    throw new Error("Office Ally credentials missing for user");
  }

  const configuredMode = String(env.officeAlly.scrapeMode || "").trim();
  const mode = configuredMode || (env.officeAlly.usePlaywright ? "playwright" : "zyte");

  if (mode === "playwright") {
    // eslint-disable-next-line no-console
    console.log(
      `[office-ally] using Playwright mode headless=${env.officeAlly.headless} for date=${appointmentDate}`,
    );
    return scrapeAppointmentsByDateViaPlaywright({
      appointmentDate,
      officeAllyUsername,
      officeAllyPassword,
    });
  }

  if (mode === "hybrid") {
    try {
      // eslint-disable-next-line no-console
      console.log(`[office-ally] using Hybrid mode (zyte->playwright fallback) date=${appointmentDate}`);
      return await scrapeAppointmentsByDateViaZyte({
        appointmentDate,
        officeAllyUsername,
        officeAllyPassword,
      });
    } catch (zyteErr) {
      // eslint-disable-next-line no-console
      console.warn(
        `[office-ally] hybrid fallback: zyte failed, switching to Playwright. err=${
          zyteErr?.message || String(zyteErr)
        }`,
      );
      return scrapeAppointmentsByDateViaPlaywright({
        appointmentDate,
        officeAllyUsername,
        officeAllyPassword,
      });
    }
  }

  // Default route: Zyte extraction (production-friendly against CAPTCHA).
  return scrapeAppointmentsByDateViaZyte({
    appointmentDate,
    officeAllyUsername,
    officeAllyPassword,
  });
}

module.exports = {
  scrapeAppointmentsByDate,
  __test: {
    parsePatientVisitsFromHtml,
    requestZytePatientVisitsByPatientLastName,
  },
};
