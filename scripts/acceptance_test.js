/* Acceptance test: the Studio must reproduce the v2 addendum numbers.
 *
 * Run: node scripts/acceptance_test.js
 * It loads the same model.js the browser runs and the same generated data
 * files the app loads, then checks four cases against data/validation.json:
 *   base preset at 100% realization  ->  8,990 homes / 28,462 jobs
 *   max preset at 100% realization   -> 21,705 homes / 52,123 jobs
 *   base preset at 50% realization   ->  4,495 homes / 14,231 jobs
 *   max preset at 50% realization    -> 10,853 homes / 26,062 jobs
 * Tolerance is 1 home/job (rounding). Exit code 0 means all four pass.
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

console.log(allPass ? "\nAll acceptance checks passed." : "\nACCEPTANCE FAILED.");
process.exit(allPass ? 0 : 1);
