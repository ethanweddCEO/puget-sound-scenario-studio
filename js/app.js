/* Puget Sound Scenario Studio, Phase 1: application logic.
 *
 * Architecture (see README for the full picture):
 *   data/*.json        - standards, parcels, zoning, registry, validation
 *   js/model.js        - pure capacity model, no DOM, no map, no fetch
 *   js/app.js (this)   - state, settings, map, controls, results, drawer
 * Data flows one way: data files -> model.computeScenario -> results panel,
 * district table, and map colors. The map never computes capacity itself;
 * it only paints properties the model run attaches to features.
 *
 * State has three parts, kept separate on purpose:
 *   scenario   - the control values the model runs on; lives in the URL
 *                hash so a link restores the exact scenario.
 *   comparison - a baseline preset or a snapshot of a scenario; lives in
 *                memory and in the URL hash alongside the scenario.
 *   settings   - display and behavior preferences; lives in localStorage
 *                and is applied on every load. A shared link always wins
 *                over the default-preset settings.
 *
 * Error policy (standing rule: no silent failures): every failure path logs
 * a useful message to the console AND shows it in the page. There are no
 * empty catch blocks anywhere in this file.
 */
(function () {
  "use strict";

  /* ---------- small utilities ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  /* Escape any string that goes into innerHTML. All data shown in the
   * drawer and tables passes through here, including parcel addresses from
   * the hub and scenario names from user-loaded files. */
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function showError(message) {
    console.error("[scenario-studio] " + message);
    var banner = $("load-error");
    if (!banner) {
      banner = el("div", "load-error");
      banner.id = "load-error";
      document.body.insertBefore(banner, document.body.firstChild);
    }
    banner.textContent = message;
    banner.hidden = false;
  }

  function showStatus(message) {
    var node = $("status-line");
    if (!node) {
      node = el("p", "hint");
      node.id = "status-line";
      $("btn-link").parentNode.appendChild(node);
    }
    node.textContent = message;
  }

  /* ---------- constants ---------- */

  var SETTINGS_KEY = "pss-settings-v1";
  var SNAPSHOT_DATE = "2026-11-09";

  /* One color per district, used in the checklist, the table, and the map's
   * district color mode. Kept in one place so the three never drift. */
  var DISTRICT_COLORS = {
    "BR-RC-1": "#1f77b4", "BR-RC-2": "#2ca02c", "BR-RC-3": "#d62728",
    "BR-OR-1": "#9467bd", "BR-OR-2": "#ff7f0e", "BR-CR": "#17becf",
    "BR-OR": "#8c564b", "BR-MO": "#e377c2", "BR-GC": "#7f7f7f",
    "BR-R": "#bcbd22", "BR-ORT": "#17a398",
  };

  /* Basemap: OpenStreetMap raster tiles only. CARTO's basemaps were
   * removed 2026-11-13: they now answer every tile with an
   * "API KEY REQUIRED" placeholder, and this app has no key input, so
   * a CARTO option would be a control that cannot work. If a future
   * basemap ever needs a key, it must come from environment at runtime,
   * never from a hardcoded value in this repo. */
  var BASEMAP = {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
  };

  var GROUP_LABELS = {
    NODE: "Node", CORE_MIXED: "Core mixed", CORE_MEDICAL: "Core medical",
    EDGE_GC: "Edge general commercial", EDGE_RES: "Edge residential",
    EDGE_ORT: "Edge office/residential transition",
  };

  /* ---------- settings ----------
   * Every setting below changes real behavior; there is no decorative
   * setting in this panel. See README for the one-line reason per setting. */

  var DEFAULT_SETTINGS = {
    defaultPreset: "base",
    defaultRealization: 1,
    rounding: "exact",        // exact | nearest10 | nearest100
    areaUnit: "sqft",         // sqft | msf
    showZoning: true,
    showNonCandidates: true,
    showBadges: true,
    showCitations: true,
    showFlags: true,
    showGrossArea: true,
    showDelta: true,
    districtSort: "homes",    // homes | jobs | acres | name
  };

  var settings = loadSettings();

  /* Load settings from localStorage, validating each value against the
   * known set. An unknown or out-of-range value falls back to the default
   * for that key, and the bad value is logged, not silently swallowed. */
  function loadSettings() {
    var out = {};
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      out[key] = DEFAULT_SETTINGS[key];
    });
    var raw = null;
    try {
      raw = window.localStorage.getItem(SETTINGS_KEY);
    } catch (err) {
      console.error("[scenario-studio] localStorage read failed: " + err.message);
      return out;
    }
    if (!raw) { return out; }
    var parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("[scenario-studio] saved settings are not valid JSON, using defaults: " + err.message);
      return out;
    }
    if (!parsed || typeof parsed !== "object") {
      console.error("[scenario-studio] saved settings are not an object, using defaults.");
      return out;
    }
    Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
      var value = parsed[key];
      if (value === undefined) { return; }
      var def = DEFAULT_SETTINGS[key];
      if (typeof value !== typeof def) {
        console.error("[scenario-studio] setting " + key + " has the wrong type, using default.");
        return;
      }
      if (typeof def === "string" && ["rounding", "areaUnit", "districtSort", "defaultPreset"].indexOf(key) >= 0) {
        var allowed = {
          rounding: ["exact", "nearest10", "nearest100"],
          areaUnit: ["sqft", "msf"],
          districtSort: ["homes", "jobs", "acres", "name"],
          defaultPreset: ["base", "full", "partial40"],
        }[key];
        if (allowed.indexOf(value) < 0) {
          console.error("[scenario-studio] setting " + key + " has an unknown value '" + value + "', using default.");
          return;
        }
      }
      if (key === "defaultRealization" && [1, 0.75, 0.5].indexOf(value) < 0) {
        console.error("[scenario-studio] setting defaultRealization has an unknown value, using default.");
        return;
      }
      out[key] = value;
    });
    return out;
  }

  function saveSettings() {
    try {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (err) {
      console.error("[scenario-studio] localStorage write failed, settings will not persist: " + err.message);
    }
  }

  /* ---------- formatting, driven by settings ---------- */

  function fmtCount(value) {
    var rounded = value;
    if (settings.rounding === "nearest10") { rounded = Math.round(value / 10) * 10; }
    if (settings.rounding === "nearest100") { rounded = Math.round(value / 100) * 100; }
    return Math.round(rounded).toLocaleString("en-US");
  }

  function fmtArea(sqft) {
    if (settings.areaUnit === "msf") {
      return (sqft / 1e6).toFixed(2) + "M sq ft";
    }
    return Math.round(sqft).toLocaleString("en-US") + " sq ft";
  }

  function fmtPct(value) {
    return Math.round(value * 100) + "%";
  }

  function fmtMoney(value) {
    if (value === null || value === undefined) { return "n/a"; }
    return "$" + Math.round(value).toLocaleString("en-US");
  }

  /* ---------- scenario state and URL encoding ----------
   * A scenario is { presetId, opts } where opts is exactly what the model
   * takes. The URL hash carries the scenario plus the comparison baseline,
   * so a link restores the whole view. Encoding is base64url JSON; no eval
   * is involved anywhere in parsing it. */

  var state = {
    scenario: null,       // { presetId, opts }
    comparison: null,     // { kind: "preset", presetId } | { kind: "snapshot", opts }
    data: null,           // loaded data files
    result: null,         // last model run
    colorMode: "district",
    selectedParcel: null,
    selectedDistrict: null,
  };

  function encodeUrlState() {
    var payload = {
      v: 1,
      preset: state.scenario.presetId,
      opts: state.scenario.opts,
      comparison: state.comparison,
    };
    var json = JSON.stringify(payload);
    var b64 = btoa(unescape(encodeURIComponent(json)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return "#s=" + b64;
  }

  function decodeUrlState() {
    var hash = window.location.hash || "";
    if (hash.indexOf("#s=") !== 0) { return null; }
    var b64 = hash.slice(3).replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) { b64 += "="; }
    var parsed = null;
    try {
      parsed = JSON.parse(decodeURIComponent(escape(atob(b64))));
    } catch (err) {
      console.error("[scenario-studio] share link could not be decoded, starting from defaults: " + err.message);
      return null;
    }
    var check = validateScenarioPayload(parsed);
    if (!check.ok) {
      console.error("[scenario-studio] share link failed validation (" + check.errors.join("; ") + "), starting from defaults.");
      return null;
    }
    return parsed;
  }

  /* Validate a scenario payload (from a URL hash or a loaded file) before
   * it touches the model. Numbers are range-checked; anything with the
   * wrong type or an out-of-range value is rejected with a reason. */
  function validateScenarioPayload(payload) {
    var errors = [];
    if (!payload || typeof payload !== "object") {
      return { ok: false, errors: ["payload is not an object"] };
    }
    var opts = payload.opts;
    if (!opts || typeof opts !== "object") {
      return { ok: false, errors: ["payload has no scenario options"] };
    }
    function num(field, min, max) {
      var value = opts[field];
      if (typeof value !== "number" || isNaN(value)) {
        errors.push(field + " is not a number");
      } else if (value < min || value > max) {
        errors.push(field + " is out of range (" + min + " to " + max + ")");
      }
    }
    num("participation", 0, 1);
    num("realization", 0, 1);
    num("sqftPerHome", 100, 10000);
    num("sqftPerJob", 50, 5000);
    num("netFactor", 0.1, 1);
    if (opts.resShareOverrides !== undefined) {
      if (typeof opts.resShareOverrides !== "object") {
        errors.push("resShareOverrides is not an object");
      } else {
        Object.keys(opts.resShareOverrides).forEach(function (group) {
          var share = opts.resShareOverrides[group];
          if (typeof share !== "number" || share < 0 || share > 1) {
            errors.push("residential share for " + group + " is out of range (0 to 1)");
          }
        });
      }
    }
    if (opts.excludedDistricts !== undefined) {
      if (!Array.isArray(opts.excludedDistricts)) {
        errors.push("excludedDistricts is not a list");
      } else if (opts.excludedDistricts.some(function (c) { return typeof c !== "string"; })) {
        errors.push("excludedDistricts contains a non-string entry");
      }
    }
    return { ok: errors.length === 0, errors: errors };
  }

  function scenarioFromPreset(presetId, realizationOverride) {
    var preset = StudioModel.PRESETS[presetId] || StudioModel.PRESETS.base;
    var opts = StudioModel.defaultOptions();
    opts.participation = preset.participation;
    opts.realization = realizationOverride !== undefined
      ? realizationOverride : preset.realization;
    return { presetId: preset.id, opts: opts };
  }

  function writeUrlState() {
    var url = window.location.pathname + window.location.search + encodeUrlState();
    window.history.replaceState(null, "", url);
  }

  /* ---------- data loading ---------- */

  function loadData() {
    var base = "data/";
    return Promise.all([
      fetch(base + "belred/standards.json").then(checkJson),
      fetch(base + "belred/parcels.geojson").then(checkJson),
      fetch(base + "belred/zoning.geojson").then(checkJson),
      fetch(base + "registry.json").then(checkJson),
    ]).then(function (results) {
      return {
        standards: results[0],
        parcels: results[1],
        zoning: results[2],
        registry: results[3],
      };
    });
  }

  function checkJson(response) {
    if (!response.ok) {
      throw new Error("failed to load " + response.url + " (HTTP " + response.status + ")");
    }
    return response.json();
  }

  /* ---------- model run ----------
   * The single place the model runs. Every control change funnels here,
   * then the results panel, district table, constraints, and map all
   * re-render from the one result. */

  function runModel() {
    var parcels = state.data.parcels.features.map(function (f) { return f.properties; });
    state.result = StudioModel.computeScenario(
      parcels, state.data.standards.districts, state.scenario.opts);
    renderAll();
    writeUrlState();
  }

  function comparisonTotals() {
    if (!state.comparison) { return null; }
    var parcels = state.data.parcels.features.map(function (f) { return f.properties; });
    var opts = null;
    if (state.comparison.kind === "preset") {
      opts = scenarioFromPreset(state.comparison.presetId).opts;
    } else if (state.comparison.kind === "snapshot") {
      opts = JSON.parse(JSON.stringify(state.comparison.opts));
    } else {
      return null;
    }
    return StudioModel.computeScenario(
      parcels, state.data.standards.districts, opts).totals;
  }

  /* ---------- map ----------
   * The map paints; it never computes. After each model run, renderAll
   * stamps per-parcel properties (contrib, constraint, excluded) onto the
   * GeoJSON features and hands them to the source. Color modes are paint
   * expressions over those properties, so switching modes never re-runs
   * the model. */

  var map = null;
  var mapLoaded = false;

  function initMap() {
    /* The center and zoom below are a fallback only. Once the style
     * loads, fitToStudyArea re-centres on the zoning polygons, so the
     * study parcels are visible on first paint instead of starting
     * off-screen. If the data failed to load, initMap is never called
     * and the error banner shows instead. */
    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: BASEMAP.tiles,
            tileSize: 256,
            attribution: BASEMAP.attribution,
          },
        },
        layers: [{ id: "basemap", type: "raster", source: "basemap" }],
      },
      center: [-122.148, 47.595],
      zoom: 13,
    });
    map.addControl(new maplibregl.NavigationControl(), "bottom-right");
    map.on("load", function () {
      mapLoaded = true;
      addMapSources();
      fitToStudyArea();
      applyMapSettings();
      paintParcels();
      wireMapEvents();
    });
    map.on("error", function (e) {
      console.error("[scenario-studio] map error: " + (e && e.error ? e.error.message : "unknown"));
    });
  }

  function addMapSources() {
    var parcels = state.data.parcels;
    parcels.features.forEach(function (feature, index) {
      feature.id = index;
      feature.properties.contrib = 0;
      feature.properties.constraint = constraintOf(feature.properties.district);
      feature.properties.excluded = false;
    });
    map.addSource("parcels", { type: "geojson", data: parcels });
    map.addSource("zoning", { type: "geojson", data: state.data.zoning });
    map.addLayer({
      id: "parcels-fill", type: "fill", source: "parcels",
      paint: { "fill-color": districtColorExpression(), "fill-opacity": 0.65 },
    });
    map.addLayer({
      id: "parcels-line", type: "line", source: "parcels",
      paint: {
        "line-color": "#ffffff", "line-width": 1,
        "line-opacity": ["case", ["boolean", ["feature-state", "hover"], false], 1, 0.35],
      },
    });
    map.addLayer({
      id: "zoning-line", type: "line", source: "zoning",
      paint: { "line-color": "#16324a", "line-width": 2, "line-dasharray": [4, 2] },
    });
  }

  /* Fit the initial view to the study area. The zoning polygons bound
   * every parcel, so their bounding box puts the whole study area on
   * screen at first paint. Runs once, when the style loads and the data
   * is already in hand (initMap is only called after loadData
   * resolves). If the bounds cannot be computed, it logs the reason
   * and leaves the fallback centre in place; it never fails silently. */
  function fitToStudyArea() {
    var bounds = null;
    function extend(lng, lat) {
      if (typeof lng !== "number" || typeof lat !== "number" || isNaN(lng) || isNaN(lat)) { return; }
      if (!bounds) { bounds = [[lng, lat], [lng, lat]]; return; }
      bounds[0][0] = Math.min(bounds[0][0], lng);
      bounds[0][1] = Math.min(bounds[0][1], lat);
      bounds[1][0] = Math.max(bounds[1][0], lng);
      bounds[1][1] = Math.max(bounds[1][1], lat);
    }
    function walk(coords) {
      if (!Array.isArray(coords)) { return; }
      if (typeof coords[0] === "number") { extend(coords[0], coords[1]); return; }
      coords.forEach(walk);
    }
    if (!state.data || !state.data.zoning || !Array.isArray(state.data.zoning.features)) {
      console.error("[scenario-studio] cannot fit the map: no zoning data in hand.");
      return;
    }
    state.data.zoning.features.forEach(function (feature) {
      if (feature.geometry) { walk(feature.geometry.coordinates); }
    });
    if (!bounds) {
      console.error("[scenario-studio] cannot fit the map: zoning polygons hold no coordinates.");
      return;
    }
    try {
      map.fitBounds(bounds, { padding: 40, maxZoom: 15, duration: 0 });
    } catch (err) {
      console.error("[scenario-studio] fit to study area failed, keeping the fallback view: " + err.message);
    }
  }

  /* Constraint class of a district, used by the constraint color mode and
   * by the constraints summary. One district can hold several flags; the
   * class picks the most binding one for the map. */
  function constraintOf(districtCode) {
    var district = state.data.standards.districts[districtCode];
    if (!district) { return "none"; }
    if (district.flags.height_may_bind) { return "height"; }
    if (district.flags.capped_no_incentive) { return "capped"; }
    if (district.flags.incentive_dependent) { return "incentive"; }
    return "none";
  }

  function districtColorExpression() {
    var expr = ["match", ["get", "district"]];
    Object.keys(DISTRICT_COLORS).forEach(function (code) {
      expr.push(code, DISTRICT_COLORS[code]);
    });
    expr.push("#cccccc");
    return ["case", ["get", "excluded"], "#e3e8ec", expr];
  }

  function capacityColorExpression(maxContrib) {
    var top = Math.max(maxContrib, 1);
    return ["case", ["get", "excluded"], "#e3e8ec",
      ["case", ["!", ["get", "candidate"]], "#e3e8ec",
        ["interpolate", ["linear"], ["get", "contrib"],
          0, "#f1f4f7", top * 0.5, "#7fb3d5", top, "#16324a"]]];
  }

  function constraintColorExpression() {
    return ["case", ["get", "excluded"], "#e3e8ec",
      ["match", ["get", "constraint"],
        "height", "#d97706",
        "capped", "#b91c1c",
        "incentive", "#2563eb",
        "#9aa5ad"]];
  }

  function candidateColorExpression() {
    return ["case", ["get", "excluded"], "#e3e8ec",
      ["case", ["get", "candidate"], districtColorExpression(), "#d5dde3"]];
  }

  /* Re-stamp per-parcel model properties and re-paint. Called after every
   * model run and after any district exclusion change. */
  function paintParcels() {
    if (!mapLoaded) { return; }
    var parcels = state.data.parcels;
    var maxContrib = 0;
    var excluded = {};
    state.scenario.opts.excludedDistricts.forEach(function (code) { excluded[code] = true; });
    parcels.features.forEach(function (feature) {
      var props = feature.properties;
      var cap = state.result.byParcel[props.pin];
      props.contrib = cap ? cap.homes + cap.jobs : 0;
      if (props.contrib > maxContrib) { maxContrib = props.contrib; }
      props.excluded = !!excluded[props.district];
    });
    map.getSource("parcels").setData(parcels);
    var expr = state.colorMode === "capacity" ? capacityColorExpression(maxContrib)
      : state.colorMode === "constraint" ? constraintColorExpression()
      : state.colorMode === "candidate" ? candidateColorExpression()
      : districtColorExpression();
    map.setPaintProperty("parcels-fill", "fill-color", expr);
    renderLegend(maxContrib);
  }

  function renderLegend(maxContrib) {
    var legend = $("map-legend");
    var html = "";
    if (state.colorMode === "district") {
      html = Object.keys(DISTRICT_COLORS).map(function (code) {
        return "<span><span class='swatch' style='background:" + DISTRICT_COLORS[code] + "'></span>" + escapeHtml(code) + "</span>";
      }).join("");
    } else if (state.colorMode === "capacity") {
      html = "Low contribution <span class='swatch' style='background:#f1f4f7'></span> to high <span class='swatch' style='background:#16324a'></span> (max " + fmtCount(maxContrib) + " homes + jobs per parcel)";
    } else if (state.colorMode === "constraint") {
      html = "<span><span class='swatch' style='background:#b91c1c'></span>Capped, no incentive system</span>"
        + "<span><span class='swatch' style='background:#d97706'></span>Height may bind</span>"
        + "<span><span class='swatch' style='background:#2563eb'></span>Incentive dependent</span>";
    } else {
      html = "Colored parcels are redevelopment candidates; grey parcels did not pass the screen.";
    }
    legend.innerHTML = html;
  }

  function wireMapEvents() {
    var hoveredId = null;
    map.on("mousemove", "parcels-fill", function (e) {
      if (!e.features.length) { return; }
      map.getCanvas().style.cursor = "pointer";
      var id = e.features[0].id;
      if (hoveredId !== null && hoveredId !== id) {
        map.setFeatureState({ source: "parcels", id: hoveredId }, { hover: false });
      }
      hoveredId = id;
      map.setFeatureState({ source: "parcels", id: id }, { hover: true });
    });
    map.on("mouseleave", "parcels-fill", function () {
      map.getCanvas().style.cursor = "";
      if (hoveredId !== null) {
        map.setFeatureState({ source: "parcels", id: hoveredId }, { hover: false });
        hoveredId = null;
      }
    });
    map.on("click", "parcels-fill", function (e) {
      if (!e.features.length) { return; }
      openParcelDrawer(e.features[0].properties);
    });
  }

  /* Settings that touch the map, applied immediately on change. There
   * is no basemap switch here: OpenStreetMap is the only basemap, so
   * there is nothing to switch to. */
  function applyMapSettings() {
    if (!mapLoaded) { return; }
    map.setLayoutProperty("zoning-line", "visibility",
      settings.showZoning ? "visible" : "none");
    map.setFilter("parcels-fill", settings.showNonCandidates ? null : ["==", ["get", "candidate"], true]);
    map.setFilter("parcels-line", settings.showNonCandidates ? null : ["==", ["get", "candidate"], true]);
  }

  /* ---------- rendering: results, table, constraints ---------- */

  function renderAll() {
    renderControls();
    renderTotals();
    renderDistrictTable();
    renderConstraints();
    paintParcels();
  }

  function renderControls() {
    var opts = state.scenario.opts;
    $("ctl-participation").value = Math.round(opts.participation * 100);
    $("val-participation").textContent = fmtPct(opts.participation);
    $("ctl-realization").value = Math.round(opts.realization * 100);
    $("val-realization").textContent = fmtPct(opts.realization);
    $("ctl-sqft-home").value = opts.sqftPerHome;
    $("val-sqft-home").textContent = opts.sqftPerHome;
    $("ctl-sqft-job").value = opts.sqftPerJob;
    $("val-sqft-job").textContent = opts.sqftPerJob;
    $("ctl-net-factor").value = opts.netFactor;
    $("val-net-factor").textContent = opts.netFactor.toFixed(2);
    var preset = StudioModel.PRESETS[state.scenario.presetId];
    $("preset-label").textContent = "Preset: " + (preset ? preset.label : "Custom");
    document.querySelectorAll(".preset[data-preset]").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-preset") === state.scenario.presetId);
    });
    document.querySelectorAll("#district-checks input[type=checkbox]").forEach(function (box) {
      box.checked = state.scenario.opts.excludedDistricts.indexOf(box.value) < 0;
    });
  }

  function renderTotals() {
    var totals = state.result.totals;
    var grossRow = $("tot-gross").parentNode;
    grossRow.style.display = settings.showGrossArea ? "" : "none";
    $("tot-gross").textContent = fmtArea(totals.grossSf);
    $("tot-homes").textContent = fmtCount(totals.homes);
    $("tot-jobs").textContent = fmtCount(totals.jobs);
    var parcels = state.data.parcels.features.map(function (f) { return f.properties; });
    var included = parcels.filter(function (p) {
      return p.candidate && state.scenario.opts.excludedDistricts.indexOf(p.district) < 0;
    });
    var acres = included.reduce(function (sum, p) { return sum + p.lot_acres; }, 0);
    $("tot-parcels").textContent = included.length + " of 363";
    $("tot-acres").textContent = acres.toFixed(1) + " acres";

    var block = $("compare-block");
    var baseline = comparisonTotals();
    if (!baseline) {
      block.hidden = true;
      return;
    }
    block.hidden = false;
    $("cmp-homes").textContent = fmtCount(baseline.homes);
    $("cmp-jobs").textContent = fmtCount(baseline.jobs);
    var deltaHomes = $("delta-homes");
    var deltaJobs = $("delta-jobs");
    deltaHomes.parentNode.style.display = settings.showDelta ? "" : "none";
    deltaJobs.parentNode.style.display = settings.showDelta ? "" : "none";
    var dh = totals.homes - baseline.homes;
    var dj = totals.jobs - baseline.jobs;
    deltaHomes.textContent = (dh >= 0 ? "+" : "") + fmtCount(dh);
    deltaJobs.textContent = (dj >= 0 ? "+" : "") + fmtCount(dj);
    deltaHomes.className = dh >= 0 ? "positive" : "negative";
    deltaJobs.className = dj >= 0 ? "positive" : "negative";
  }

  function districtRows() {
    var districts = state.data.standards.districts;
    var rows = Object.keys(districts).map(function (code) {
      var district = districts[code];
      var cap = state.result.byDistrict[code] || { grossSf: 0, homes: 0, jobs: 0 };
      return {
        code: code, district: district, cap: cap,
        acres: district.candidate_acres,
        effFar: StudioModel.effectiveFar(district, state.scenario.opts.participation),
        excluded: state.scenario.opts.excludedDistricts.indexOf(code) >= 0,
      };
    });
    var sort = settings.districtSort;
    rows.sort(function (a, b) {
      if (sort === "name") { return a.code < b.code ? -1 : 1; }
      if (sort === "acres") { return b.acres - a.acres; }
      if (sort === "jobs") { return b.cap.jobs - a.cap.jobs; }
      return b.cap.homes - a.cap.homes;
    });
    return rows;
  }

  function flagBadges(district) {
    if (!settings.showFlags) { return ""; }
    var out = [];
    if (district.flags.capped_no_incentive) {
      out.push("<span class='badge capped'>Capped: no incentive system</span>");
    }
    if (district.flags.incentive_dependent) {
      out.push("<span class='badge'>Incentive dependent</span>");
    }
    if (district.flags.height_may_bind) {
      out.push("<span class='badge warn'>Height may bind</span>");
    }
    return out.join("");
  }

  function renderDistrictTable() {
    var tbody = document.querySelector("#district-table tbody");
    tbody.innerHTML = "";
    districtRows().forEach(function (row) {
      var tr = document.createElement("tr");
      if (row.excluded) { tr.className = "excluded"; }
      tr.tabIndex = 0;
      tr.setAttribute("role", "button");
      tr.setAttribute("aria-label", "Details for district " + row.code);
      var cells = [
        "<span class='swatch' style='display:inline-block;width:10px;height:10px;border-radius:2px;background:" + DISTRICT_COLORS[row.code] + "'></span> " + escapeHtml(row.code),
        row.acres.toFixed(1),
        row.effFar.toFixed(2),
        fmtCount(row.cap.homes),
        fmtCount(row.cap.jobs),
        flagBadges(row.district),
      ];
      tr.innerHTML = cells.map(function (c, i) {
        return "<td" + (i === 5 ? " class='flag-col'" : "") + ">" + c + "</td>";
      }).join("");
      tr.addEventListener("click", function () { openDistrictDrawer(row.code); });
      tr.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openDistrictDrawer(row.code); }
      });
      tbody.appendChild(tr);
    });
    var flagCol = document.querySelector("#district-table .flag-col");
    if (flagCol) { flagCol.style.display = settings.showFlags ? "" : "none"; }
  }

  function renderConstraints() {
    var list = $("constraints");
    list.innerHTML = "";
    var opts = state.scenario.opts;
    var districts = state.data.standards.districts;
    var capped = Object.keys(districts).filter(function (code) {
      return districts[code].flags.capped_no_incentive &&
        opts.excludedDistricts.indexOf(code) < 0;
    });
    if (capped.length) {
      list.appendChild(el("li", null,
        "Capped no matter what: " + capped.join(", ") + " have no incentive system, so their maximum FAR is their base FAR at any participation rate."));
    }
    if (opts.participation > 0) {
      var dependent = Object.keys(districts).filter(function (code) {
        return districts[code].flags.incentive_dependent &&
          opts.excludedDistricts.indexOf(code) < 0;
      });
      if (dependent.length) {
        list.appendChild(el("li", null,
          "Incentive dependent at " + fmtPct(opts.participation) + " participation: " + dependent.join(", ") +
          " only reach this FAR if projects provide or buy the full amenity package. The maximum bound is a policy outcome, not a zoning entitlement."));
      }
      if (opts.excludedDistricts.indexOf("BR-RC-3") < 0) {
        list.appendChild(el("li", null,
          "Height may bind in BR-RC-3: 4.0 max FAR against a 70 ft height cap and floor plate caps, so the full FAR is not physically reachable on most sites. Bounded by the district's whole maximum contribution (405 homes / 732 jobs)."));
      }
    }
    if (!list.children.length) {
      list.appendChild(el("li", null,
        "No active constraint flags at base FAR with these districts. Raise participation above 0% to see where the amenity system binds."));
    }
  }

  function renderGaps() {
    var list = $("gaps-list");
    if (list.children.length) { return; }
    var items = [
      "BR-MO vs BR-MO-1 swing: a City LUCA staff analysis (2026-07-08) describes the 116th Ave medical corridor at node standards (max FAR 4.0, heights 45/150 ft). This build applies plain BR-MO (FAR 1.0 flat, 70 ft). If node standards ultimately apply, BR-MO rises from 4,870 jobs to about 19,482 jobs at the maximum bound.",
      "Chart footnotes (11), (13), and (15) were not recovered. They attach to the BR-ORT height and to the BR-RC-3 and BR-CR heights.",
      "The Chart 20.25D.080.A grid was read from the chart as reproduced in a 2021 Colliers offering memorandum, corroborated district by district against official city documents where one exists. Values resting on the reproduction alone are badged in the district drawer.",
      "No numeric density limit exists for any Bel Red district in the code as read; capacity is governed by FAR and height.",
      "Capacity is gross, not net of existing homes or jobs, and FAR exemptions are displayed, not modeled.",
      "Snapshot risk: the standards are the code in force on 2026-11-09. If the BelRed Look Forward LUCA is adopted, the standards must be re-extracted and scenarios re-run.",
    ];
    items.forEach(function (text) { list.appendChild(el("li", null, text)); });
    var readiness = el("li", null, "Jurisdiction readiness: ");
    state.data.registry.jurisdictions.forEach(function (j) {
      readiness.appendChild(el("span", "badge", j.name + ": " + j.readiness));
    });
    list.appendChild(readiness);
  }

  /* ---------- detail drawer ---------- */

  function openDrawer() {
    $("drawer").hidden = false;
  }

  function closeDrawer() {
    $("drawer").hidden = true;
    state.selectedParcel = null;
    state.selectedDistrict = null;
  }

  function verificationBadges(district) {
    if (!settings.showBadges) { return ""; }
    var fields = district.verification.reproduction_only_fields;
    var out = "<span class='badge'>Chart grid: reproduction + corroboration</span>";
    if (fields.length) {
      out += "<span class='badge warn'>Reproduction only: " + fields.map(escapeHtml).join(", ") + "</span>";
    }
    return out;
  }

  function openParcelDrawer(props) {
    state.selectedParcel = props.pin;
    state.selectedDistrict = null;
    var district = state.data.standards.districts[props.district];
    var cap = state.result.byParcel[props.pin];
    var body = $("drawer-body");
    var html = "<h2>Parcel " + escapeHtml(props.pin) + "</h2>"
      + "<p>" + escapeHtml(props.address || "No street address in the parcel record.") + "</p>"
      + "<dl>"
      + "<dt>District</dt><dd>" + escapeHtml(props.district) + " (" + escapeHtml(props.district_name || "") + ")</dd>"
      + "<dt>Lot</dt><dd>" + props.lot_acres.toFixed(2) + " acres</dd>"
      + "<dt>Use</dt><dd>" + escapeHtml(props.preuse || "n/a") + " (" + escapeHtml(props.proptype || "n/a") + ")</dd>"
      + "<dt>Appraised values</dt><dd>Land " + fmtMoney(props.land_value) + ", improvements " + fmtMoney(props.impr_value)
      + (props.impr_share !== null && props.impr_share !== undefined
        ? ", improvement share " + props.impr_share.toFixed(2) : "") + "</dd>"
      + "<dt>Redevelopment screen</dt><dd>" + (props.candidate
        ? "Candidate: improvement share at or under 0.30, or vacant, and not an excluded use."
        : "Not a candidate. " + escapeHtml(props.screen_reason || "")) + "</dd>";
    if (cap) {
      html += "<dt>Capacity at current settings</dt><dd>" + fmtArea(cap.grossSf) + " gross floor area, "
        + fmtCount(cap.homes) + " homes, " + fmtCount(cap.jobs) + " jobs</dd>";
    } else {
      html += "<dt>Capacity at current settings</dt><dd>None: this parcel is not a candidate, or its district is excluded.</dd>";
    }
    html += "</dl>";
    if (district) {
      html += "<p><button type='button' id='drawer-district-btn'>View district " + escapeHtml(props.district) + " standards</button></p>";
    }
    body.innerHTML = html;
    var btn = $("drawer-district-btn");
    if (btn) {
      btn.addEventListener("click", function () { openDistrictDrawer(props.district); });
    }
    openDrawer();
  }

  function openDistrictDrawer(code) {
    state.selectedDistrict = code;
    state.selectedParcel = null;
    var district = state.data.standards.districts[code];
    if (!district) {
      console.error("[scenario-studio] unknown district code: " + code);
      return;
    }
    var cap = state.result.byDistrict[code] || { grossSf: 0, homes: 0, jobs: 0 };
    var body = $("drawer-body");
    var html = "<h2>" + escapeHtml(code) + "</h2>"
      + "<p>" + escapeHtml(district.name) + " (" + escapeHtml(GROUP_LABELS[district.group] || district.group) + ")</p>"
      + verificationBadges(district)
      + "<dl>"
      + "<dt>Height</dt><dd>" + district.height_base_ft + " ft base, " + district.height_max_ft + " ft max</dd>"
      + "<dt>FAR</dt><dd>" + district.far_base.toFixed(2) + " base, " + district.far_max.toFixed(2) + " max with incentives</dd>"
      + "<dt>Effective FAR now</dt><dd>" + StudioModel.effectiveFar(district, state.scenario.opts.participation).toFixed(2) + "</dd>"
      + "<dt>Incentive tiers</dt><dd>" + (district.incentive_tiers
        ? "Tier 1 +" + district.incentive_tiers.tier1_far + " FAR" + (district.incentive_tiers.tier2_far ? ", Tier 2 +" + district.incentive_tiers.tier2_far + " FAR" : ", no Tier 2")
        : "None: this district is not in the FAR Amenity Incentive System.") + "</dd>"
      + "<dt>Density limit</dt><dd>" + escapeHtml(district.density_limit) + "</dd>"
      + "<dt>Candidate land</dt><dd>" + district.candidate_acres.toFixed(1) + " acres across " + district.candidate_parcels + " parcels</dd>"
      + "<dt>Capacity at current settings</dt><dd>" + fmtArea(cap.grossSf) + ", " + fmtCount(cap.homes) + " homes, " + fmtCount(cap.jobs) + " jobs</dd>"
      + "</dl>"
      + "<h3>Flags</h3><p>" + (flagBadges(district) || "None at current settings.") + "</p>";
    if (settings.showCitations) {
      html += "<h3>Code citation</h3><p class='citation'>" + escapeHtml(district.citation) + "</p>"
        + "<h3>Source basis</h3><p class='citation'>" + escapeHtml(district.source_basis) + "</p>";
    }
    html += "<h3>FAR exemptions (displayed, not modeled)</h3><ul class='flag-list'>"
      + district.far_exemptions.map(function (text) { return "<li>" + escapeHtml(text) + "</li>"; }).join("") + "</ul>";
    if (district.notes) {
      html += "<div class='note-box'>" + escapeHtml(district.notes) + "</div>";
    }
    if (district.open_item) {
      html += "<div class='note-box'><strong>" + escapeHtml(district.open_item.title) + ".</strong> "
        + escapeHtml(district.open_item.detail) + "</div>";
    }
    body.innerHTML = html;
    openDrawer();
  }

  /* ---------- controls: build and wire ---------- */

  function buildDistrictChecks() {
    var list = $("district-checks");
    list.innerHTML = "";
    Object.keys(state.data.standards.districts).sort().forEach(function (code) {
      var district = state.data.standards.districts[code];
      var li = el("li");
      var box = el("input");
      box.type = "checkbox";
      box.value = code;
      box.checked = true;
      box.setAttribute("aria-label", "Include district " + code);
      box.addEventListener("change", function () {
        setScenario(null, function (opts) {
          if (box.checked) {
            opts.excludedDistricts = opts.excludedDistricts.filter(function (c) { return c !== code; });
          } else if (opts.excludedDistricts.indexOf(code) < 0) {
            opts.excludedDistricts.push(code);
          }
        });
      });
      var swatch = el("span", "swatch");
      swatch.style.background = DISTRICT_COLORS[code];
      var label = el("span", null, code + " (" + district.candidate_acres.toFixed(0) + " ac)");
      var info = el("button", "info", "Details");
      info.type = "button";
      info.addEventListener("click", function () { openDistrictDrawer(code); });
      li.appendChild(box);
      li.appendChild(swatch);
      li.appendChild(label);
      li.appendChild(info);
      list.appendChild(li);
    });
  }

  function buildReshareControls() {
    var wrap = $("reshare-controls");
    wrap.innerHTML = "";
    var groups = ["NODE", "CORE_MIXED", "CORE_MEDICAL", "EDGE_GC", "EDGE_RES", "EDGE_ORT"];
    groups.forEach(function (group) {
      var defaults = state.data.standards.defaults.res_share_by_group;
      var label = el("label", null, (GROUP_LABELS[group] || group) + " residential share");
      var value = el("span", "slider-value", fmtPct(defaults[group]));
      var input = el("input");
      input.type = "range";
      input.min = "0"; input.max = "100"; input.step = "5";
      input.value = String(Math.round(defaults[group] * 100));
      input.setAttribute("aria-label", "Residential share for " + group);
      input.addEventListener("input", function () {
        value.textContent = input.value + "%";
        setScenario(null, function (opts) {
          opts.resShareOverrides[group] = Number(input.value) / 100;
        });
      });
      label.appendChild(value);
      label.appendChild(input);
      wrap.appendChild(label);
    });
    $("btn-reshare-reset").addEventListener("click", function () {
      setScenario(null, function (opts) { opts.resShareOverrides = {}; });
      buildReshareControls();
    });
  }

  /* Apply a scenario change: presetId null keeps the current preset label
   * logic (any manual change forks the preset into "custom"). */
  function setScenario(presetId, mutate) {
    if (presetId) {
      state.scenario = scenarioFromPreset(presetId);
    } else if (state.scenario.presetId) {
      state.scenario = { presetId: null, opts: JSON.parse(JSON.stringify(state.scenario.opts)) };
    }
    if (mutate) { mutate(state.scenario.opts); }
    runModel();
  }

  function wireControls() {
    document.querySelectorAll(".preset[data-preset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setScenario(btn.getAttribute("data-preset"));
      });
    });
    function slider(id, apply) {
      $(id).addEventListener("input", function (e) {
        setScenario(null, function (opts) { apply(opts, Number(e.target.value)); });
      });
    }
    slider("ctl-participation", function (opts, v) { opts.participation = v / 100; });
    slider("ctl-realization", function (opts, v) { opts.realization = v / 100; });
    slider("ctl-sqft-home", function (opts, v) { opts.sqftPerHome = v; });
    slider("ctl-sqft-job", function (opts, v) { opts.sqftPerJob = v; });
    slider("ctl-net-factor", function (opts, v) { opts.netFactor = v; });

    $("ctl-colormode").addEventListener("change", function (e) {
      state.colorMode = e.target.value;
      paintParcels();
    });
    $("ctl-baseline").addEventListener("change", function (e) {
      var value = e.target.value;
      if (!value) { state.comparison = null; }
      else if (value === "snapshot") {
        if (!state.comparison || state.comparison.kind !== "snapshot") {
          state.comparison = { kind: "snapshot", opts: JSON.parse(JSON.stringify(state.scenario.opts)) };
        }
      } else {
        state.comparison = { kind: "preset", presetId: value };
      }
      renderTotals();
      writeUrlState();
    });
    $("btn-snapshot").addEventListener("click", function () {
      state.comparison = { kind: "snapshot", opts: JSON.parse(JSON.stringify(state.scenario.opts)) };
      $("ctl-baseline").value = "snapshot";
      renderTotals();
      writeUrlState();
      showStatus("Current scenario snapshotted as the comparison baseline.");
    });

    document.querySelectorAll("#district-table th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        settings.districtSort = th.getAttribute("data-sort");
        saveSettings();
        renderDistrictTable();
      });
    });

    $("drawer-close").addEventListener("click", closeDrawer);
    $("btn-save").addEventListener("click", saveScenarioFile);
    $("btn-load").addEventListener("click", function () { $("file-load").click(); });
    $("file-load").addEventListener("change", loadScenarioFile);
    $("btn-link").addEventListener("click", copyShareLink);
    $("btn-settings").addEventListener("click", function () { $("settings-panel").hidden = false; });
    $("settings-close").addEventListener("click", function () { $("settings-panel").hidden = true; });
    wireSettings();
  }

  /* ---------- settings panel wiring ----------
   * Each control writes the setting, persists it, and applies it at once.
   * Nothing here is decorative. */

  function wireSettings() {
    function bindSelect(id, key, apply) {
      var node = $(id);
      node.value = String(settings[key]);
      node.addEventListener("change", function () {
        var value = node.value;
        if (key === "defaultRealization") { value = Number(value); }
        settings[key] = value;
        saveSettings();
        if (apply) { apply(); }
        showStatus("Setting saved.");
      });
    }
    function bindCheck(id, key, apply) {
      var node = $(id);
      node.checked = !!settings[key];
      node.addEventListener("change", function () {
        settings[key] = node.checked;
        saveSettings();
        if (apply) { apply(); }
        showStatus("Setting saved.");
      });
    }
    bindSelect("set-default-preset", "defaultPreset");
    bindSelect("set-default-realization", "defaultRealization");
    bindSelect("set-rounding", "rounding", function () { renderTotals(); renderDistrictTable(); });
    bindSelect("set-area-unit", "areaUnit", function () { renderTotals(); renderDistrictTable(); });
    bindCheck("set-show-zoning", "showZoning", applyMapSettings);
    bindCheck("set-show-noncandidates", "showNonCandidates", applyMapSettings);
    bindCheck("set-show-badges", "showBadges", function () { if (state.selectedDistrict) { openDistrictDrawer(state.selectedDistrict); } });
    bindCheck("set-show-citations", "showCitations", function () { if (state.selectedDistrict) { openDistrictDrawer(state.selectedDistrict); } });
    bindCheck("set-show-flags", "showFlags", renderDistrictTable);
    bindCheck("set-show-gross", "showGrossArea", renderTotals);
    bindCheck("set-show-delta", "showDelta", renderTotals);
    bindSelect("set-district-sort", "districtSort", renderDistrictTable);
    $("btn-settings-reset").addEventListener("click", function () {
      try {
        window.localStorage.removeItem(SETTINGS_KEY);
      } catch (err) {
        console.error("[scenario-studio] could not clear saved settings: " + err.message);
      }
      settings = loadSettings();
      syncSettingsPanel();
      applyMapSettings();
      renderTotals();
      renderDistrictTable();
      showStatus("Settings reset to defaults.");
    });
  }

  /* Reflect the current settings object back into the panel controls
   * (used after a reset). */
  function syncSettingsPanel() {
    $("set-default-preset").value = settings.defaultPreset;
    $("set-default-realization").value = String(settings.defaultRealization);
    $("set-rounding").value = settings.rounding;
    $("set-area-unit").value = settings.areaUnit;
    $("set-show-zoning").checked = settings.showZoning;
    $("set-show-noncandidates").checked = settings.showNonCandidates;
    $("set-show-badges").checked = settings.showBadges;
    $("set-show-citations").checked = settings.showCitations;
    $("set-show-flags").checked = settings.showFlags;
    $("set-show-gross").checked = settings.showGrossArea;
    $("set-show-delta").checked = settings.showDelta;
    $("set-district-sort").value = settings.districtSort;
  }

  /* ---------- scenario save / load / share ---------- */

  function saveScenarioFile() {
    var payload = {
      name: "Bel Red scenario",
      app: "puget-sound-scenario-studio",
      standardsSnapshotDate: SNAPSHOT_DATE,
      preset: state.scenario.presetId,
      opts: state.scenario.opts,
      comparison: state.comparison,
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = el("a");
    link.href = url;
    link.download = "belred-scenario.json";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showStatus("Scenario downloaded as belred-scenario.json.");
  }

  function loadScenarioFile(event) {
    var file = event.target.files && event.target.files[0];
    if (!file) { return; }
    var reader = new FileReader();
    reader.onerror = function () {
      showError("Could not read the scenario file: " + file.name);
    };
    reader.onload = function () {
      var parsed = null;
      try {
        parsed = JSON.parse(reader.result);
      } catch (err) {
        showError("The file " + file.name + " is not valid JSON: " + err.message);
        return;
      }
      var check = validateScenarioPayload(parsed);
      if (!check.ok) {
        showError("The file " + file.name + " is not a valid scenario: " + check.errors.join("; "));
        return;
      }
      state.scenario = { presetId: parsed.preset || null, opts: parsed.opts };
      state.comparison = parsed.comparison || null;
      syncBaselineControl();
      runModel();
      showStatus("Scenario loaded from " + file.name + ".");
    };
    reader.readAsText(file);
    event.target.value = "";
  }

  function syncBaselineControl() {
    if (!state.comparison) { $("ctl-baseline").value = ""; }
    else if (state.comparison.kind === "preset") { $("ctl-baseline").value = state.comparison.presetId; }
    else { $("ctl-baseline").value = "snapshot"; }
  }

  function copyShareLink() {
    writeUrlState();
    var url = window.location.href;
    function done() { showStatus("Share link copied to the clipboard."); }
    function fallback() {
      var area = el("textarea");
      area.value = url;
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        done();
      } catch (err) {
        console.error("[scenario-studio] copy to clipboard failed: " + err.message);
        showStatus("Copy failed; the link is in the address bar.");
      }
      document.body.removeChild(area);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(done, function (err) {
        console.error("[scenario-studio] clipboard write failed, trying fallback: " + err.message);
        fallback();
      });
    } else {
      fallback();
    }
  }

  /* ---------- init ---------- */

  function initScenario() {
    var fromUrl = decodeUrlState();
    if (fromUrl) {
      state.scenario = { presetId: fromUrl.preset || null, opts: fromUrl.opts };
      state.comparison = fromUrl.comparison || null;
      syncBaselineControl();
      return;
    }
    state.scenario = scenarioFromPreset(settings.defaultPreset, settings.defaultRealization);
  }

  function init() {
    initScenario();
    loadData().then(function (data) {
      state.data = data;
      buildDistrictChecks();
      buildReshareControls();
      renderGaps();
      wireControls();
      initMap();
      runModel();
    }).catch(function (err) {
      showError("The Studio could not load its data files, so it cannot start: " + err.message
        + " Serve the repo folder over HTTP (python3 -m http.server) and reload.");
    });
  }

  window.addEventListener("error", function (event) {
    console.error("[scenario-studio] uncaught error: " + (event.message || "unknown"));
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
