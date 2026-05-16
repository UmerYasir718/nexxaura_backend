import fs from "fs";

const html = fs.readFileSync(process.argv[2], "utf8");
const t = (s) => s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

for (const p of [
  "plan-details-summary",
  "plan-date-information",
  "patient-card",
  "Date of Service",
  "Transaction ID",
  "Transaction Time",
  "Transaction Date",
  "DOB",
  "Payer ID",
  "patient-card-extended",
  "Member ID",
]) {
  console.log(p, html.includes(p) ? "YES" : "NO");
}

const cardIdx = html.indexOf('id="patient-card"');
console.log("\n--- patient-card raw ---");
console.log(html.slice(cardIdx, cardIdx + 2200));

const planIdx = html.indexOf("plan-details-summary");
console.log("\n--- plan-details-summary ---");
console.log(t(html.slice(planIdx, planIdx + 1500)));

const dateUl = html.match(/plan-date|Plan Begin Date|Eligibility Begin/i);
console.log("\nplan date ul match", dateUl?.[0]);
