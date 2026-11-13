/* Capacity model for the Puget Sound Scenario Studio.
 *
 * This module is jurisdiction neutral: districts, standards, parcels, and
 * group residential shares all arrive as data (see data/belred/standards.json
 * and data/belred/parcels.geojson). Nothing in here names Bel Red. Adding a
 * second study area means preparing its data files, not changing this code.
 *
 * The model implements the Phase 5 v2 method exactly (see the v2 addendum,
 * phase5-belred-scenario-v2-addendum.md, and analyze_capacity_v2.py):
 *   lot_sqft        = parcel lot acres x 43,560
 *   effective_far   = district base FAR + participation x (max FAR - base FAR)
 *                     Districts with no incentive system have max == base, so
 *                     they always use base FAR; no special case is needed.
 *   gross_floor_area = lot_sqft x effective_far x net factor (default 0.85)
 *   residential_sqft = gross_floor_area x group residential share
 *   homes           = residential_sqft / sq ft per home (default 950)
 *   jobs            = (gross_floor_area - residential_sqft) / sq ft per job
 *                     (default 350)
 *   scenario totals = summed capacity x realization rate (default 100%)
 *
 * Deliberate limits, matching v2: capacity is GROSS, not net of existing
 * homes or jobs. Height is a flag, not a calculation input. FAR exemptions
 * are displayed as notes in the UI, never modeled. There is no density cap
 * in the Bel Red code, so none is applied.
 *
 * UMD wrapper: works as a browser global (window.StudioModel) and as a
 * Node module (require), so the acceptance test runs the exact same code
 * the browser runs. There is no second implementation to drift.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.StudioModel = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var SQFT_PER_ACRE = 43560;

  /* Scenario presets. A preset is only a set of starting control values;
   * any user adjustment forks the active preset into a custom scenario.
   * The LUCA preset is intentionally absent: it needs the draft LUCA
   * standards extracted into the v2 table format first (Phase 2). */
  var PRESETS = {
    base: {
      id: "base",
      label: "Current code, base FAR",
      participation: 0,
      realization: 1,
    },
    full: {
      id: "full",
      label: "Current code, full incentives",
      participation: 1,
      realization: 1,
    },
    partial40: {
      id: "partial40",
      label: "Current code, 40% participation",
      participation: 0.4,
      realization: 1,
    },
  };

  /* Effective FAR for one district at a participation rate from 0 to 1.
   * Capped districts (max == base) return base FAR at any participation. */
  function effectiveFar(district, participation) {
    return district.far_base + participation * (district.far_max - district.far_base);
  }

  /* Capacity of a single candidate parcel at the given settings.
   * Returns null for non-candidate parcels: they never contribute. */
  function parcelCapacity(parcel, district, opts) {
    if (!parcel.candidate) {
      return null;
    }
    var resShare = opts.resShareOverrides[district.group] !== undefined
      ? opts.resShareOverrides[district.group]
      : district.res_share;
    var lotSqft = parcel.lot_acres * SQFT_PER_ACRE;
    var grossSf = lotSqft * effectiveFar(district, opts.participation) * opts.netFactor;
    var resSf = grossSf * resShare;
    return {
      grossSf: grossSf,
      homes: resSf / opts.sqftPerHome,
      jobs: (grossSf - resSf) / opts.sqftPerJob,
    };
  }

  function emptyTotals() {
    return { grossSf: 0, homes: 0, jobs: 0 };
  }

  function addInto(target, add) {
    target.grossSf += add.grossSf;
    target.homes += add.homes;
    target.jobs += add.jobs;
  }

  /* Run a whole scenario over a parcel list.
   * opts: { participation, realization, sqftPerHome, sqftPerJob, netFactor,
   *         resShareOverrides (group -> share), excludedDistricts (array) }
   * districts: map of district code -> standards entry (with far_base,
   *   far_max, group, res_share).
   * Returns { totals, byDistrict, byParcel } where totals already include
   * the realization rate, matching the v2 50% comparison case (totals x 0.5).
   * byParcel maps parcel PIN to its un-realized capacity, so the map and the
   * detail drawer can show a parcel's contribution at current settings. */
  function computeScenario(parcels, districts, opts) {
    var excluded = {};
    (opts.excludedDistricts || []).forEach(function (code) {
      excluded[code] = true;
    });
    var byDistrict = {};
    var byParcel = {};
    var totals = emptyTotals();

    parcels.forEach(function (parcel) {
      var district = districts[parcel.district];
      if (!district || excluded[parcel.district]) {
        return;
      }
      var cap = parcelCapacity(parcel, district, opts);
      if (!cap) {
        return;
      }
      if (!byDistrict[parcel.district]) {
        byDistrict[parcel.district] = emptyTotals();
      }
      addInto(byDistrict[parcel.district], cap);
      byParcel[parcel.pin] = cap;
    });

    Object.keys(byDistrict).forEach(function (code) {
      addInto(totals, byDistrict[code]);
    });

    // Realization applies to the summed capacity, exactly as the v2
    // 50% case did (totals x 0.5), not per parcel.
    totals.grossSf *= opts.realization;
    totals.homes *= opts.realization;
    totals.jobs *= opts.realization;
    Object.keys(byDistrict).forEach(function (code) {
      byDistrict[code].grossSf *= opts.realization;
      byDistrict[code].homes *= opts.realization;
      byDistrict[code].jobs *= opts.realization;
    });

    return { totals: totals, byDistrict: byDistrict, byParcel: byParcel };
  }

  /* Default control values, from the v2 method. */
  function defaultOptions() {
    return {
      participation: 0,
      realization: 1,
      sqftPerHome: 950,
      sqftPerJob: 350,
      netFactor: 0.85,
      resShareOverrides: {},
      excludedDistricts: [],
    };
  }

  return {
    PRESETS: PRESETS,
    defaultOptions: defaultOptions,
    effectiveFar: effectiveFar,
    parcelCapacity: parcelCapacity,
    computeScenario: computeScenario,
  };
}));
