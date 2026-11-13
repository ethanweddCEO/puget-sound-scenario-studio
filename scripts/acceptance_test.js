/* Acceptance test: the Studio must reproduce the v2 addendum numbers.
 *
 * Run: node scripts/acceptance_test.js
 * It loads the same model.js the browser runs and the same generated data
 * files the app loads, then checks four cases against data/validation.json:
 *   base preset at 100% realization  ->  8,990 homes / 28,462 jobs
 *   max preset at 100% realization   -> 21,705 homes / 52,123 jobs
 *   base preset at 50% realization   ->  4,495 homes / 14,231 jobs
 *   max preset at 50% realization    -> 10,853 homes / 26,062 jobs
 * Tolerance is 1 home/job (rounding). It also checks the how-to guide:
 * the Guide button and panel exist in index.html, every id guide.js
 * queries exists, every section has content, the glossary names the
 * required terms, the worked examples carry the verified model figures,
 * the guide copy has no em dash, and the panel open/close logic works
 * against a minimal DOM stub. Exit code 0 means all checks pass.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var model = require("../js/model.js");

var root = path.join(__dirname, "..");
var standardsDoc = JSON.parse(
  fs.readFileSync(path.join(root, "data", "belred", "standards.json"), "utf8"));
var parcelsDoc = JSON.parse(
  fs.readFileSync(path.join(root, "data", "belred", "parcels.geojson"), "utf8"));
var validation = JSON.parse(
  fs.readFileSync(path.join(root, "data", "validation.json"), "utf8"));

var districts = standardsDoc.districts;
var parcels = parcelsDoc.features.map(function (f) { return f.properties; });

function runCase(label, opts, expected) {
  var result = model.computeScenario(parcels, districts, opts);
  var homes = Math.round(result.totals.homes);
  var jobs = Math.round(result.totals.jobs);
  var homesOk = Math.abs(homes - expected.homes) <= validation.tolerance;
  var jobsOk = Math.abs(jobs - expected.jobs) <= validation.tolerance;
  var pass = homesOk && jobsOk;
  console.log(
    (pass ? "PASS" : "FAIL") + "  " + label +
    "  homes " + homes + " (expected " + expected.homes + ")" +
    "  jobs " + jobs + " (expected " + expected.jobs + ")" +
    "  gross floor area " + Math.round(result.totals.grossSf).toLocaleString("en-US") + " sq ft");
  return pass;
}

var base = model.defaultOptions();
var max = model.defaultOptions();
max.participation = 1;
var base50 = model.defaultOptions();
base50.realization = 0.5;
var max50 = model.defaultOptions();
max50.participation = 1;
max50.realization = 0.5;

var allPass = true;
allPass = runCase("base preset, 100% realization", base, validation.base_100pct) && allPass;
allPass = runCase("max preset, 100% realization", max, validation.max_100pct) && allPass;
allPass = runCase("base preset, 50% realization", base50, validation.base_50pct) && allPass;
allPass = runCase("max preset, 50% realization", max50, validation.max_50pct) && allPass;

// District-level spot check: BR-MO at base must be 0 homes / 4,870 jobs,
// because its residential share is 0 and it is capped at FAR 1.0.
var mo = model.computeScenario(parcels, districts, base).byDistrict["BR-MO"];
var moOk = mo && Math.round(mo.homes) === 0 && Math.abs(Math.round(mo.jobs) - 4870) <= 1;
console.log((moOk ? "PASS" : "FAIL") + "  BR-MO spot check: " +
  Math.round(mo.homes) + " homes / " + Math.round(mo.jobs) +
  " jobs (expected 0 / 4,870)");
allPass = allPass && moOk;

/* --- How-to guide checks --- */

var guideOk = true;
function guideCheck(label, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  guide: " + label + (detail ? " (" + detail + ")" : ""));
  guideOk = guideOk && ok;
}

var guide = require("../js/guide.js");
var indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
var guideSrc = fs.readFileSync(path.join(root, "js", "guide.js"), "utf8");

var htmlIds = {};
var idRe = /id="([^"]+)"/g;
var idMatch;
while ((idMatch = idRe.exec(indexHtml)) !== null) { htmlIds[idMatch[1]] = true; }

guideCheck("Guide button exists in index.html", !!htmlIds["btn-guide"]);
guideCheck("Guide panel exists in index.html", !!htmlIds["guide-panel"]);
var missingIds = guide.IDS_USED.filter(function (id) { return !htmlIds[id]; });
guideCheck("every id guide.js queries exists in index.html", missingIds.length === 0,
  missingIds.length ? "missing: " + missingIds.join(", ") : "6 ids");

var emptySections = guide.SECTIONS.filter(function (s) { return !s.title || !s.html; });
guideCheck("every guide section has a title and body (" + guide.SECTIONS.length + " sections)",
  emptySections.length === 0);
var expectedSections = ["guide-what", "guide-tour", "guide-controls", "guide-glossary", "guide-examples", "guide-caveats"];
var sectionIds = guide.SECTIONS.map(function (s) { return s.id; });
var missingSections = expectedSections.filter(function (id) { return sectionIds.indexOf(id) < 0; });
guideCheck("all six required sections present", missingSections.length === 0,
  missingSections.length ? "missing: " + missingSections.join(", ") : "");

var guideText = guide.SECTIONS.map(function (s) { return s.html; }).join(" ");
var guideTextLower = guideText.toLowerCase();
var requiredTerms = ["FAR", "LUCA", "LUC", "candidate parcel", "realization rate",
  "net factor", "BR-MO", "BR-RC-3", "PIN", "Tier 1"];
var missingTerms = requiredTerms.filter(function (t) { return guideTextLower.indexOf(t.toLowerCase()) < 0; });
guideCheck("glossary and examples name the required terms", missingTerms.length === 0,
  missingTerms.length ? "missing: " + missingTerms.join(", ") : "");

/* Worked-example figures must match the verified model runs, not prose:
 * base 8,990 / 28,462, full 21,705 / 52,123, 40% participation
 * 14,076 / 37,926, base at 50% 4,495 / 14,231. */
var requiredFigures = ["8,990", "28,462", "21,705", "52,123", "14,076", "37,926", "4,495", "14,231"];
var missingFigures = requiredFigures.filter(function (f) { return guideText.indexOf(f) < 0; });
guideCheck("worked examples carry the verified model figures", missingFigures.length === 0,
  missingFigures.length ? "missing: " + missingFigures.join(", ") : "");

/* Standing copy rule: no em dash in the guide source. The escape below
 * is the check itself, not a literal em dash in this file. */
guideCheck("guide copy has no em dash", guideSrc.indexOf("\u2014") < 0);

/* Panel open/close logic against a minimal DOM stub. This checks the
 * logic, not a browser render; the visual check happens on the branch
 * preview. */
var stubPanel = {
  hidden: true,
  addEventListener: function () {},
  querySelectorAll: function () { return []; }
};
var stubClose = { focused: false, focus: function () { this.focused = true; } };
var stubBtn = { focused: false, focus: function () { this.focused = true; } };
global.document = {
  activeElement: null,
  getElementById: function (id) {
    if (id === "guide-panel") { return stubPanel; }
    if (id === "guide-close") { return stubClose; }
    if (id === "btn-guide") { return stubBtn; }
    return null;
  }
};
var opened = guide.open();
guideCheck("panel opens (hidden false, focus moves to Close)",
  opened === true && stubPanel.hidden === false && stubClose.focused === true);
var closed = guide.close();
guideCheck("panel closes and focus returns to Guide",
  closed === true && stubPanel.hidden === true && stubBtn.focused === true);
delete global.document;

allPass = allPass && guideOk;

console.log(allPass ? "\nAll acceptance checks passed." : "\nACCEPTANCE FAILED.");
process.exit(allPass ? 0 : 1);
