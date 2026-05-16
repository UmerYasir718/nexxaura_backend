/**
 * Parse a saved Availity eligibility iframe HTML and print benefits JSON.
 * Usage: node scripts/test-parse-eligibility-html.mjs <path-to-iframe.html>
 */
import { readFileSync } from "fs";
import { chromium } from "playwright";
import {
  availityParseResponseSnapshot,
  buildEligibilityBenefitsPayload,
} from "../availity/src/eligibilityScraper.js";

const htmlPath = process.argv[2];
if (!htmlPath) {
  console.error(
    "Usage: node scripts/test-parse-eligibility-html.mjs <iframe.html>",
  );
  process.exit(1);
}

const html = readFileSync(htmlPath, "utf8");
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "domcontentloaded" });
const snap = await availityParseResponseSnapshot(page.mainFrame());
const payload = buildEligibilityBenefitsPayload(snap);
console.log(JSON.stringify(payload, null, 2));
await browser.close();
