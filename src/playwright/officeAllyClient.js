const axios = require("axios");
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
  const u = new URL(urlLike);
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

function parseAppointmentsFromDailyHtml(html, pageUrl) {
  const rows = [];
  const tbodyMatch = /<table[^>]*id=["']tblDailyApp["'][\s\S]*?<tbody[^>]*>([\s\S]*?)<\/tbody>/i.exec(
    String(html || ""),
  );
  if (!tbodyMatch) return rows;
  const rowBlocks = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const tr of rowBlocks) {
    const cells = tr.match(/<td[\s\S]*?<\/td>/gi) || [];
    if (cells.length < 10) continue;
    const patientCell = cells[3] || "";
    const patientText = stripTags(patientCell);
    if (!patientText) continue;
    const hrefMatch = /<a[^>]*href=["']([^"']+)["']/i.exec(patientCell);
    const href = hrefMatch?.[1] || "";
    if (!href) continue;

    let patientUrl = href;
    if (!/^https?:\/\//i.test(patientUrl)) {
      patientUrl = new URL(patientUrl, pageUrl).toString();
    }
    const patientId = /[?&]PID=(\d+)/i.exec(patientUrl)?.[1] || "";
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

async function requestZyteRenderedHtml({
  url,
  officeAllyUsername,
  officeAllyPassword,
}) {
  const apiKey = String(env.officeAlly.zyteApiKey || "").trim();
  if (!apiKey) return null;

  const endpoint = String(env.officeAlly.zyteApiUrl || "https://api.zyte.com/v1/extract");
  const commonHeaders = { "Content-Type": "application/json" };
  const targetUrl = String(url || "").trim();
  const baseUrl = String(env.officeAlly.baseUrl || "").trim();
  const css = (value) => ({ type: "css", value });

  // Zyte action grammar can differ by account/version.
  // Try a few compatible payload shapes before failing hard.
  const payloadVariants = [
    {
      label: "type+goto",
      payload: {
        url: baseUrl,
        browserHtml: true,
        actions: [
          { action: "click", selector: css("#w-dropdown-toggle-4") },
          { action: "click", selector: css("#nav_practice") },
          {
            action: "type",
            selector: css("input[name='username']"),
            value: officeAllyUsername,
          },
          {
            action: "type",
            selector: css("input[name='password']"),
            value: officeAllyPassword,
          },
          { action: "click", selector: css("button[type='submit']") },
          { action: "goto", url: targetUrl },
        ],
      },
    },
    {
      label: "fill+goto",
      payload: {
        url: baseUrl,
        browserHtml: true,
        actions: [
          { action: "click", selector: css("#w-dropdown-toggle-4") },
          { action: "click", selector: css("#nav_practice") },
          {
            action: "fill",
            selector: css("input[name='username']"),
            value: officeAllyUsername,
          },
          {
            action: "fill",
            selector: css("input[name='password']"),
            value: officeAllyPassword,
          },
          { action: "click", selector: css("button[type='submit']") },
          { action: "goto", url: targetUrl },
        ],
      },
    },
    {
      label: "type-direct-url",
      payload: {
        url: targetUrl,
        browserHtml: true,
        actions: [
          { action: "click", selector: css("#w-dropdown-toggle-4") },
          { action: "click", selector: css("#nav_practice") },
          {
            action: "type",
            selector: css("input[name='username']"),
            value: officeAllyUsername,
          },
          {
            action: "type",
            selector: css("input[name='password']"),
            value: officeAllyPassword,
          },
          { action: "click", selector: css("button[type='submit']") },
        ],
      },
    },
    {
      label: "type-text-no-goto",
      payload: {
        url: baseUrl,
        browserHtml: true,
        actions: [
          { action: "click", selector: css("#w-dropdown-toggle-4") },
          { action: "click", selector: css("#nav_practice") },
          {
            action: "type",
            selector: css("input[name='username']"),
            text: officeAllyUsername,
          },
          {
            action: "type",
            selector: css("input[name='password']"),
            text: officeAllyPassword,
          },
          { action: "click", selector: css("button[type='submit']") },
          { action: "waitForTimeout", timeout: 2500 },
        ],
      },
    },
  ];

  let lastErr = null;
  for (const variant of payloadVariants) {
    try {
      const response = await axios.post(endpoint, variant.payload, {
        headers: commonHeaders,
        auth: { username: apiKey },
        timeout: 120000,
      });
      const html = response?.data?.browserHtml || null;
      if (html) return html;
    } catch (error) {
      lastErr = error;
      // eslint-disable-next-line no-console
      console.warn(
        `[zyte] variant failed (${variant.label}) status=${
          error?.response?.status || "n/a"
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
    const byId = (id) => document.getElementById(id);
    const byIdValue = (id) => clean(byId(id)?.value);
    const byIdText = (id) => clean(byId(id)?.textContent);
    const selectedText = (id) => {
      const el = byId(id);
      if (!el || !el.options) return "";
      const selected = Array.from(el.options).find((opt) => opt.selected);
      return clean(selected?.textContent);
    };
    const multiLabelText = (id) => byIdText(`lblMultiSelect${id}`);

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
        ) || byIdValue("ctl00_phFolderContent_ucPatient_hdnPatientID"),
      firstName: byIdValue("ctl00_phFolderContent_ucPatient_FirstName"),
      middleName: byIdValue("ctl00_phFolderContent_ucPatient_MiddleName"),
      lastName: byIdValue("ctl00_phFolderContent_ucPatient_LastName"),
      dob: joinDateParts("ctl00_phFolderContent_ucPatient_DOB"),
      sex: selectedText("ctl00_phFolderContent_ucPatient_lstGender"),
      maritalStatus: selectedText(
        "ctl00_phFolderContent_ucPatient_lstMaritalStatus",
      ),
      employmentStatus: selectedText(
        "ctl00_phFolderContent_ucPatient_lstEmploymentStatus",
      ),
      professionalTitle: byIdValue(
        "ctl00_phFolderContent_ucPatient_ProfessionalTitle",
      ),
      preferredLanguage: selectedText(
        "ctl00_phFolderContent_ucPatient_ddlLanguage",
      ),
      religion: selectedText("ctl00_phFolderContent_ucPatient_ddlReligion"),
      ethnicity: multiLabelText("ddlEthnicity"),
      race: multiLabelText("ddlRace"),
      addressLine1: byIdValue("ctl00_phFolderContent_ucPatient_AddressLine1"),
      addressLine2: byIdValue("ctl00_phFolderContent_ucPatient_AddressLine2"),
      city: byIdValue("ctl00_phFolderContent_ucPatient_City"),
      state: selectedText("ctl00_phFolderContent_ucPatient_lstState"),
      zip: byIdValue("ctl00_phFolderContent_ucPatient_Zip"),
      homePhone: joinPhone("ctl00_phFolderContent_ucPatient_HomePhone"),
      workPhone: joinPhone("ctl00_phFolderContent_ucPatient_WorkPhone"),
      cellPhone: joinPhone("ctl00_phFolderContent_ucPatient_CellPhone"),
      fax: joinPhone("ctl00_phFolderContent_ucPatient_Fax"),
      preferredPhone: selectedText(
        "ctl00_phFolderContent_ucPatient_lstPreferredPhone",
      ),
      email: byIdValue("ctl00_phFolderContent_ucPatient_Email"),
      communicationPreference: selectedText(
        "ctl00_phFolderContent_ucPatient_ddlPatientReminder",
      ),
      employerName: byIdValue("ctl00_phFolderContent_ucPatient_EmployerName"),
      emergencyContactName: byIdValue(
        "ctl00_phFolderContent_ucPatient_EmergencyContactName",
      ),
      emergencyContactRelation: byIdValue(
        "ctl00_phFolderContent_ucPatient_EmergencyContactRelation",
      ),
      nextOfKinName: byIdValue(
        "ctl00_phFolderContent_ucPatient_NextKinContactName",
      ),
      nextOfKinRelation: selectedText(
        "ctl00_phFolderContent_ucPatient_lstNextKinRelation",
      ),
    };

    const primaryInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType"),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceID",
      ),
      insuranceName: byIdValue("ctl00_phFolderContent_ucPatient_InsuranceName"),
      insuredId: byIdValue("ctl00_phFolderContent_ucPatient_InsuredID"),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuredLastName",
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuredFirstName",
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToInsuredID",
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceSubscriberID",
      ),
      groupNo: byIdValue("ctl00_phFolderContent_ucPatient_InsuranceGroupNo"),
      planName: byIdValue("ctl00_phFolderContent_ucPatient_InsurancePlanName"),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceDeductible",
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_InsuranceVisitCopay",
      ),
      signatureOnFile: selectedText(
        "ctl00_phFolderContent_ucPatient_lstSignatureOnFile",
      ),
      signatureDate: joinDateParts(
        "ctl00_phFolderContent_ucPatient_SignatureOnFileDate",
      ),
    };

    const secondaryInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType2"),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceID",
      ),
      insuranceName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceName",
      ),
      insuredId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredID",
      ),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredLastName",
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuredFirstName",
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToSecondaryInsuredID",
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceSubscriberID",
      ),
      groupNo: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceGroupNo",
      ),
      planName: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsurancePlanName",
      ),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceDeductible",
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_SecondaryInsuranceVisitCopay",
      ),
      signatureOnFile: selectedText(
        "ctl00_phFolderContent_ucPatient_lstSecondarySignatureOnFile",
      ),
      signatureDate: joinDateParts(
        "ctl00_phFolderContent_ucPatient_SecondarySignatureOnFileDate",
      ),
    };

    const thirdInsurance = {
      insuranceType: multiLabelText("ddlPatientInsuranceType3"),
      insuranceCompanyId: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceID",
      ),
      insuranceName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceName",
      ),
      insuredId: byIdValue("ctl00_phFolderContent_ucPatient_ThirdInsuredID"),
      insuredLastName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuredLastName",
      ),
      insuredFirstName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuredFirstName",
      ),
      relationshipToInsured: selectedText(
        "ctl00_phFolderContent_ucPatient_lstRelationshipToThirdInsuredID",
      ),
      subscriberId: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceSubscriberID",
      ),
      groupNo: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceGroupNo",
      ),
      planName: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsurancePlanName",
      ),
      deductible: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceDeductible",
      ),
      visitCopay: byIdValue(
        "ctl00_phFolderContent_ucPatient_ThirdInsuranceVisitCopay",
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

        // Move to insurance tab for read-only scrape.
        let onInsuranceTab = false;
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
          onInsuranceTab = false;
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
  const html = await requestZyteRenderedHtml({
    url: dailyUrl,
    officeAllyUsername,
    officeAllyPassword,
  });
  if (!html) {
    throw new Error(
      "Zyte did not return rendered HTML. Check ZYTE_API_KEY and ZYTE_API_URL.",
    );
  }
  const rows = parseAppointmentsFromDailyHtml(html, dailyUrl);
  if (!rows.length) {
    throw new Error(
      "Zyte returned zero appointment rows for the requested date.",
    );
  }
  return rows.map((row) => ({ ...row, patientDetails: null }));
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
