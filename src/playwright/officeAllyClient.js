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

async function scrapeAppointmentsByDate({
  appointmentDate,
  officeAllyUsername,
  officeAllyPassword,
}) {
  if (!officeAllyUsername || !officeAllyPassword) {
    throw new Error("Office Ally credentials missing for user");
  }

  const browser = await chromium.launch({ headless: env.officeAlly.headless });
  const page = await browser.newPage({
    viewport: { width: 1365, height: 900 },
  });

  try {
    await page.goto(env.officeAlly.baseUrl, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await page
      .locator("input[name='username'], #username")
      .first()
      .fill(officeAllyUsername);
    await page
      .locator("input[name='password'], #password")
      .first()
      .fill(officeAllyPassword);
    await page
      .locator("button[type='submit'], input[type='submit']")
      .first()
      .click();
    await page
      .waitForLoadState("networkidle", { timeout: 120000 })
      .catch(() => {});

    // Office Ally renders appointments in Daily View table (#tblDailyApp).
    // Open the exact day URL first, then fallback to date controls if needed.
    const dailyUrl = buildDailyViewUrl(env.officeAlly.baseUrl, appointmentDate);
    await page
      .goto(dailyUrl, { waitUntil: "domcontentloaded", timeout: 120000 })
      .catch(() => {});
    const dailyTable = page.locator("#tblDailyApp").first();
    if (!(await dailyTable.isVisible({ timeout: 5000 }).catch(() => false))) {
      const { year, month, day } = parseDateParts(appointmentDate);
      await page
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Month")
        .fill(String(month))
        .catch(() => {});
      await page
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Day")
        .fill(String(day))
        .catch(() => {});
      await page
        .locator("#ctl00_phFolderContent_Appointments_GoToDate_Year")
        .fill(String(year))
        .catch(() => {});
      await page
        .locator("#ctl00_phFolderContent_Appointments_btnGotoDate")
        .click({ timeout: 10000 })
        .catch(() => {});
    }
    await page
      .locator("#tblDailyApp")
      .waitFor({ state: "visible", timeout: 30000 });

    const rows = await page.evaluate(() => {
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

    const detailsByPatientId = {};
    for (const row of rows) {
      const patientId = row["Patient ID"];
      if (!patientId || detailsByPatientId[patientId]) continue;
      try {
        const patientUrl =
          row.PatientUrl ||
          buildPatientEditUrl(env.officeAlly.baseUrl, patientId, "P");
        await page.goto(patientUrl, {
          waitUntil: "domcontentloaded",
          timeout: 120000,
        });
        await page
          .locator("#tblTab0")
          .waitFor({ state: "attached", timeout: 30000 });

        const patientData = await scrapePatientAndInsuranceDetails(page);

        // Move to insurance tab for read-only scrape.
        let onInsuranceTab = false;
        try {
          const insuranceTabLink = page
            .locator("a[href*='Tab=I'], a:has-text('Insurance')")
            .first();
          if (
            await insuranceTabLink
              .isVisible({ timeout: 1500 })
              .catch(() => false)
          ) {
            await insuranceTabLink.click({ timeout: 5000 });
            await page
              .waitForLoadState("domcontentloaded", { timeout: 30000 })
              .catch(() => {});
            onInsuranceTab = true;
          }
        } catch {
          onInsuranceTab = false;
        }
        if (!onInsuranceTab) {
          const insuranceUrl = withTab(patientUrl, "I");
          await page
            .goto(insuranceUrl, {
              waitUntil: "domcontentloaded",
              timeout: 120000,
            })
            .catch(() => {});
        }
        await page
          .locator("#tblTab1")
          .waitFor({ state: "attached", timeout: 30000 })
          .catch(() => {});
        const insuranceData = await scrapePatientAndInsuranceDetails(page);

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

    return rows.map((row) => ({
      ...row,
      patientDetails: detailsByPatientId[row["Patient ID"]] || null,
    }));
  } finally {
    await browser.close();
  }
}

module.exports = { scrapeAppointmentsByDate };
