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

function detectZyteHtmlState(html) {
  const body = String(html || "").toLowerCase();
  if (!body.trim()) return "empty_html";
  if (body.includes("tbldailyapp")) return "appointments_table_present";
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

async function writeZyteArtifacts({ label, responseData }) {
  const dir = artifactDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const safeLabel = String(label || "variant").replace(/[^a-z0-9_-]/gi, "_");

  const html = responseData?.browserHtml;
  if (html) {
    const htmlPath = path.join(dir, `zyte-${safeLabel}.html`);
    await fs.promises.writeFile(htmlPath, String(html), "utf8");
    // eslint-disable-next-line no-console
    console.log(`[zyte] html snapshot saved: ${htmlPath}`);
  }

  const screenshotB64 = responseData?.screenshot;
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
        { action: "waitForTimeout", timeout: 3.0 },
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
  const orderedVariants = wantPatientDetail
    ? payloadVariants.filter((v) => v.label === "auth0-evaluate-submit")
    : wantAppointments
      ? payloadVariants.filter(
          (v) =>
            v.label === "auth0-evaluate-calendar-click" ||
            v.label === "auth0-evaluate-submit",
        )
      : payloadVariants;

  let lastErr = null;
  for (const variant of orderedVariants) {
    try {
      // eslint-disable-next-line no-console
      console.log(`[zyte] trying variant=${variant.label} login_flow=start`);
      const response = await axios.post(endpoint, variant.payload, {
        headers: commonHeaders,
        auth: { username: apiKey },
        timeout: 120000,
      });
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
    } catch (error) {
      lastErr = error;
      // eslint-disable-next-line no-console
      console.warn(
        `[zyte] variant failed (${variant.label}) status=${
          error?.response?.status || "n/a"
        } detail=${
          typeof error?.response?.data === "string"
            ? error.response.data
            : JSON.stringify(error?.response?.data || {})
        }`,
      );
    }
  }

  const status = lastErr?.response?.status;
  const detail =
    typeof lastErr?.response?.data === "string"
      ? lastErr.response.data
      : JSON.stringify(lastErr?.response?.data || {});
  throw new Error(
    `Zyte extract failed after retries. status=${status || "n/a"} detail=${detail}`,
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

    // 2) Open the Practice login path and wait for auth window/page.
    await page.locator("#w-dropdown-toggle-4").click();
    await page.locator("#nav_practice").click();
    await page.locator("#nav_practice").click();

    // wait for either redirect OR popup
    await page.waitForTimeout(3000);

    const pages = context.pages();

    console.log("ALL PAGES:");
    for (const p of pages) {
      console.log(p.url());
    }

    const newPage = pages.find(p =>
      p.url().includes("cms.officeally.com") ||
      p.url().includes("auth.officeally.com")
    );

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
        .click({ timeout: 10000 })
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
        };
      } catch (error) {
        detailsByPatientId[patientId] = {
          scrapeError: error?.message || "Failed to scrape patient details",
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

  return rows.map((row) => {
    const patientId = String(row["Patient ID"] || "").trim();
    const patientUrl = String(row.PatientUrl || "").trim();
    const detailsKey = patientId || patientUrl;
    const details = embeddedDetails[detailsKey] || null;
    if (!details) return { ...row, patientDetails: null };
    const mergedPatientId =
      String(row["Patient ID"] || "").trim() ||
      String(details?.patientTab?.patientId || "").trim();
    const patientDetails = { ...details };
    delete patientDetails.__rawInsuranceHtml;
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

  // Zyte-only route: avoids Playwright CAPTCHA blocks in production.
  return scrapeAppointmentsByDateViaZyte({
    appointmentDate,
    officeAllyUsername,
    officeAllyPassword,
  });
}

module.exports = { scrapeAppointmentsByDate };
