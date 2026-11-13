/* How-to guide for the Puget Sound Scenario Studio.
 *
 * Architecture: the guide is content plus a panel, kept in its own module
 * so app.js stays about state, map, and results. guide.js owns the Guide
 * button, the panel, the section content, keyboard behavior, and focus.
 * It wires itself on DOMContentLoaded and touches nothing else.
 *
 * Accessibility: the panel is a dialog with a label. Opening it moves
 * focus to the Close button; closing it returns focus to the Guide
 * button. Escape closes it. Tab cycles inside the panel while it is
 * open. Section headings are focus targets for the in-panel nav.
 *
 * Copy rule: no em dashes anywhere in this file. The acceptance test
 * checks for them. The numbers in the worked examples are the verified
 * model figures from data/validation.json and the 40% participation
 * run; if the model changes, the examples must be re-run, not guessed.
 *
 * UMD wrapper, same as model.js: works as a browser global
 * (window.StudioGuide) and as a Node module (require), so the
 * acceptance test can load the same content the browser shows.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.StudioGuide = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* Every id this module queries. The acceptance test checks each one
   * exists in index.html, so a rename in either file fails loudly. */
  var IDS_USED = ["btn-guide", "guide-panel", "guide-close", "guide-nav", "guide-body", "guide-title"];

  var SECTIONS = [
    {
      id: "guide-what",
      title: "What this tool is",
      html: [
        "<p>The Scenario Studio answers one question: under the Bellevue Land Use Code as it stood on 2026-11-09, how many homes and jobs could the Bel Red study area hold if its redevelopment candidate parcels built out, and how does that answer change when projects use the FAR Amenity Incentive System?</p>",
        "<p>It shows three things for every scenario you build: the capacity totals, the constraints that cap the answer, and the evidence behind every number, meaning the code citation, the source basis, and a verification badge for each district.</p>",
        "<p>The numbers are the code's upper bound at a chosen set of assumptions. They describe what the code allows. A forecast of what will actually be built would need market, ownership, and timing inputs the Studio does not hold.</p>"
      ].join("\n")
    },
    {
      id: "guide-tour",
      title: "The three regions",
      html: [
        "<p>On a desktop screen the app has three regions. On a phone they stack in a different order, noted below.</p>",
        "<h4>Scenario, left</h4>",
        "<p>Every control that changes the model lives here: presets, sliders, the district checklist, and the advanced residential share overrides.</p>",
        "<h4>Map, center</h4>",
        "<p>One colored shape per study parcel. Click a parcel to open its detail drawer. The toolbar above the map switches what the colors mean. The map opens fitted to the Bel Red zoning polygons, so the study area is on screen at first paint.</p>",
        "<h4>Results, right</h4>",
        "<p>Totals for the active scenario, the comparison block, the district table, the constraints summary, the known gaps list, and the provenance footer with the code snapshot date.</p>",
        "<h4>On a phone</h4>",
        "<p>The page becomes one scrolling column in this order: map, results, scenario controls. The fixed bar at the bottom (Map, Results, Scenario) jumps to each part in one tap. The detail drawer becomes a bottom sheet and the settings panel becomes a full-screen overlay.</p>"
      ].join("\n")
    },
    {
      id: "guide-controls",
      title: "Every control",
      html: [
        "<h4>Presets</h4>",
        "<p>Three presets reproduce the v2 bounds in one click. Any manual change after picking a preset turns the label above the sliders to Custom, which means the scenario is no longer exactly a preset.</p>",
        "<dl>",
        "<dt>Base FAR</dt><dd>Current code at base FAR. Incentive participation 0%, realization 100%. This is the opening view: 8,990 homes and 28,462 jobs.</dd>",
        "<dt>Full incentives</dt><dd>Current code with every district that has an incentive system at max FAR. Participation 100%, realization 100%: 21,705 homes and 52,123 jobs.</dd>",
        "<dt>40% participation</dt><dd>Current code with projects using 40% of the amenity system. Participation 40%, realization 100%: 14,076 homes and 37,926 jobs.</dd>",
        "<dt>LUCA draft (Phase 2)</dt><dd>Disabled on purpose. The button needs the draft BelRed Look Forward LUCA standards extracted into the v2 table format first. That extraction is Phase 2 work, and the preset stays disabled until the table exists.</dd>",
        "</dl>",
        "<h4>The five sliders</h4>",
        "<p>Each slider re-runs the model the moment you move it, and the totals, table, constraints, and map all update together.</p>",
        "<dl>",
        "<dt>Incentive participation, 0 to 100%, default 0%</dt><dd>Share of the FAR Amenity Incentive System a project uses. It sets the effective FAR for every district that has an incentive system. The four capped districts never move above base FAR, at any value.</dd>",
        "<dt>Realization rate, 0 to 100% in steps of 5, default 100%</dt><dd>Share of screened capacity assumed to actually build. The v2 comparison case is 50%: base at 50% is 4,495 homes and 14,231 jobs.</dd>",
        "<dt>Sq ft per home, 600 to 1,500 in steps of 10, default 950</dt><dd>Floor area counted as one home. Raise it and the same floor area yields fewer homes.</dd>",
        "<dt>Sq ft per job, 200 to 600 in steps of 10, default 350</dt><dd>Floor area counted as one job. Raise it and the same floor area yields fewer jobs.</dd>",
        "<dt>Net factor, 0.70 to 1.00 in steps of 0.01, default 0.85</dt><dd>Share of gross floor area counted as buildable after circulation, walls, and structure.</dd>",
        "</dl>",
        "<h4>District checklist</h4>",
        "<p>One row per district, with its color swatch and candidate acres. Uncheck a district to exclude its parcels from the totals, the table, and the map. The Details button on each row opens that district's drawer without changing the scenario.</p>",
        "<h4>Advanced: residential share by group</h4>",
        "<p>Behind the Advanced fold, one slider per district group overrides the v2 residential share of floor area for that group. Changing a share re-runs the model. The Reset shares button restores the v2 defaults.</p>",
        "<dl>",
        "<dt>Node, 60%</dt><dd>BR-RC-1, BR-RC-2, BR-RC-3, BR-OR-1, BR-OR-2.</dd>",
        "<dt>Core mixed, 50%</dt><dd>BR-CR, BR-OR.</dd>",
        "<dt>Core medical, 0%</dt><dd>BR-MO. Standard residential is not permitted here, so the group builds jobs only.</dd>",
        "<dt>Edge general commercial, 25%</dt><dd>BR-GC.</dd>",
        "<dt>Edge residential, 80%</dt><dd>BR-R.</dd>",
        "<dt>Edge office/residential transition, 50%</dt><dd>BR-ORT.</dd>",
        "</dl>",
        "<h4>Map color modes</h4>",
        "<p>The Color parcels by menu changes only the paint, never the model. Switching modes never re-runs the calculation.</p>",
        "<dl>",
        "<dt>District</dt><dd>One color per district. The legend lists all eleven codes.</dd>",
        "<dt>Capacity contribution</dt><dd>Light to dark by homes plus jobs per parcel, so the parcels that drive the total stand out.</dd>",
        "<dt>Constraint status</dt><dd>Red for capped districts with no incentive system, amber where height may bind, blue where the result depends on the incentive system.</dd>",
        "<dt>Candidate vs excluded</dt><dd>Candidate parcels in their district colors, grey for parcels that did not pass the redevelopment screen.</dd>",
        "</dl>",
        "<h4>Compare against</h4>",
        "<p>The Compare against menu picks a baseline. The results panel then shows the baseline homes and jobs and the delta from the active scenario, with gains in green and losses in red.</p>",
        "<dl>",
        "<dt>Base FAR preset, Full incentives preset, 40% participation preset</dt><dd>Compare against a fixed preset at 100% realization.</dd>",
        "<dt>Snapshot of current scenario</dt><dd>Freeze the scenario as it stands right now, then change controls and watch the delta move. The Snapshot current scenario as baseline button does the same thing in one click.</dd>",
        "</dl>",
        "<p>The baseline travels with a shared link, so someone opening your link sees the same comparison you set up.</p>",
        "<h4>District table</h4>",
        "<p>One row per district: code, candidate acres, effective FAR at the current participation rate, homes, jobs, and flags. Click a column header to sort. Click a row, or focus it and press Enter or Space, to open the district drawer. A district you excluded from the checklist shows faded and contributes zero.</p>",
        "<h4>Detail drawer</h4>",
        "<p>Click any parcel on the map, or any district row, to open the drawer. It closes with the Close button at its top right.</p>",
        "<p>A parcel drawer shows the PIN, street address, district, lot acres, current use, appraised land and improvement values, the improvement share, whether it passed the redevelopment screen and why, and its capacity contribution at the current settings, plus a button to open the district standards.</p>",
        "<p>A district drawer shows the district name and group, base and max height, base and max FAR, the effective FAR right now, the incentive tiers, the density limit, candidate land, capacity at the current settings, flags, the code citation and source basis, the FAR exemptions that apply, any notes, and any open item such as the BR-MO swing.</p>",
        "<h4>Save, load, and share link</h4>",
        "<dl>",
        "<dt>Save scenario</dt><dd>Downloads the current scenario as belred-scenario.json: preset, every control value, and the comparison baseline.</dd>",
        "<dt>Load scenario</dt><dd>Opens a scenario JSON file and restores it. The file is type and range checked first. A file that fails validation shows an error instead of loading.</dd>",
        "<dt>Copy share link</dt><dd>Writes the whole scenario state into the page URL and copies the link. Opening the link restores the exact scenario, including the comparison baseline. A shared link always wins over the Settings defaults on load.</dd>",
        "</dl>",
        "<h4>Settings</h4>",
        "<p>Every setting changes real behavior, and settings persist in this browser between visits. Reset all settings to defaults clears the saved values.</p>",
        "<dl>",
        "<dt>Default preset</dt><dd>Which preset a fresh visit opens on, when no shared link is in the address bar.</dd>",
        "<dt>Default realization rate</dt><dd>The realization rate a fresh visit opens on: 100%, 75%, or 50%.</dd>",
        "<dt>Home and job figures</dt><dd>Exact whole numbers, or rounded to the nearest 10 or 100.</dd>",
        "<dt>Floor area unit</dt><dd>Square feet, or million square feet.</dd>",
        "<dt>Show zoning boundaries</dt><dd>Shows or hides the dashed zoning outline layer on the map.</dd>",
        "<dt>Show non-candidate parcels on the map</dt><dd>Hides parcels that failed the redevelopment screen when off.</dd>",
        "<dt>Show verification badges</dt><dd>Shows or hides the verification badges in the district drawer.</dd>",
        "<dt>Show code citations</dt><dd>Shows or hides the citation and source basis text in the district drawer.</dd>",
        "<dt>Show constraint flags</dt><dd>Shows or hides the flags column in the district table and the flag badges.</dd>",
        "<dt>Show gross floor area in results</dt><dd>Shows or hides the gross floor area row in the totals.</dd>",
        "<dt>Show delta vs comparison baseline</dt><dd>Shows or hides the delta rows in the comparison block.</dd>",
        "<dt>Sort districts by</dt><dd>Re-sorts the district table by homes, jobs, candidate acres, or district code.</dd>",
        "</dl>"
      ].join("\n")
    },
    {
      id: "guide-glossary",
      title: "Terms and abbreviations",
      html: [
        "<dl>",
        "<dt>FAR</dt><dd>Floor area ratio. Floor area allowed divided by lot area. FAR 1.0 on a 10,000 sq ft lot allows 10,000 sq ft of floor area. FAR 4.0 allows 40,000 sq ft.</dd>",
        "<dt>Base FAR</dt><dd>The FAR a district allows with no amenity bonus. 1.0 in every Bel Red district except BR-ORT at 0.75.</dd>",
        "<dt>Max FAR</dt><dd>The FAR with the full amenity package. 4.0 in the five node districts, 2.0 in BR-CR and BR-R, and equal to base FAR in the four capped districts.</dd>",
        "<dt>Effective FAR</dt><dd>The FAR the model actually uses at the current participation rate: base FAR plus participation times (max FAR minus base FAR). Shown per district in the table.</dd>",
        "<dt>LUC</dt><dd>Bellevue Land Use Code, the city zoning code. The standards come from LUC 20.25D.080, the dimensional chart, and LUC 20.25D.090, the FAR Amenity Incentive System.</dd>",
        "<dt>LUCA</dt><dd>Land Use Code Amendment. The BelRed Look Forward LUCA is the draft rewrite of the Bel Red districts. It is a draft and has not been adopted.</dd>",
        "<dt>Gross capacity</dt><dd>Total homes and jobs the model computes, before subtracting anything that already exists on the parcels. The Studio reports gross capacity only.</dd>",
        "<dt>Net factor</dt><dd>Share of gross floor area counted as buildable after circulation, walls, and structure. Default 0.85.</dd>",
        "<dt>Realization rate</dt><dd>Share of the screened capacity assumed to actually build. 100% is full buildout. The v2 comparison case uses 50%.</dd>",
        "<dt>Incentive participation</dt><dd>Share of the FAR Amenity Incentive System a project uses, from 0 to 100%. At 0% every district builds at base FAR. At 100% every district with an incentive system builds at max FAR.</dd>",
        "<dt>Candidate parcel</dt><dd>A parcel that passed the redevelopment screen: improvement share at or under 0.30, or vacant, and not an excluded use. 363 of the 463 study parcels are candidates, covering 507.7 acres.</dd>",
        "<dt>PIN</dt><dd>Parcel identification number, the King County parcel key. It is the title of the parcel drawer.</dd>",
        "<dt>Sq ft per home</dt><dd>Floor area counted as one home. Default 950 sq ft.</dd>",
        "<dt>Sq ft per job</dt><dd>Floor area counted as one job. Default 350 sq ft.</dd>",
        "<dt>Residential share</dt><dd>Share of a district group's floor area counted as homes. Set per group in the advanced overrides.</dd>",
        "<dt>District group</dt><dd>One of six groups that share a residential share default: Node, Core mixed, Core medical, Edge general commercial, Edge residential, Edge office/residential transition.</dd>",
        "<dt>Tier 1 / Tier 2</dt><dd>The two amenity bonus steps in LUC 20.25D.090. Node districts earn 2.5 FAR at Tier 1 and 0.5 at Tier 2. BR-CR and BR-R earn 1.0 at Tier 1 with no Tier 2.</dd>",
        "<dt>Height may bind</dt><dd>A flag meaning the district's height cap and floor plate caps may keep the full FAR from being usable on most sites. The known case is BR-RC-3: 4.0 FAR against a 70 ft height cap.</dd>",
        "<dt>Capped</dt><dd>A district with no incentive system, so its max FAR equals its base FAR at any participation rate. BR-MO, BR-OR, BR-GC, and BR-ORT.</dd>",
        "<dt>Verification badge</dt><dd>Shows how a standard was verified. Reproduction only means the value rests on the chart as reproduced in a 2021 Colliers offering memorandum, with no separate official document found yet.</dd>",
        "<dt>Snapshot date</dt><dd>2026-11-09, the date of the code the standards were read from. If the code changes, the standards must be re-extracted and scenarios re-run.</dd>",
        "</dl>",
        "<h4>District codes</h4>",
        "<dl>",
        "<dt>BR-RC-1</dt><dd>BelRed Residential/Commercial Node 1. FAR 1.0 to 4.0, heights 45 to 150 ft.</dd>",
        "<dt>BR-RC-2</dt><dd>BelRed Residential/Commercial Node 2. FAR 1.0 to 4.0, heights 45 to 125 ft.</dd>",
        "<dt>BR-RC-3</dt><dd>BelRed Residential/Commercial Node 3. FAR 1.0 to 4.0, heights 45 to 70 ft. Height may bind.</dd>",
        "<dt>BR-OR-1</dt><dd>BelRed Office/Residential Node 1. FAR 1.0 to 4.0, heights 45 to 150 ft.</dd>",
        "<dt>BR-OR-2</dt><dd>BelRed Office/Residential Node 2. FAR 1.0 to 4.0, heights 45 to 125 ft.</dd>",
        "<dt>BR-CR</dt><dd>BelRed Commercial/Residential. FAR 1.0 to 2.0, heights 45 to 70 ft.</dd>",
        "<dt>BR-OR</dt><dd>BelRed Office/Residential. FAR 1.0 flat, heights 70 to 70 ft. Capped.</dd>",
        "<dt>BR-MO</dt><dd>BelRed Medical Office. FAR 1.0 flat, heights 70 to 70 ft. Capped.</dd>",
        "<dt>BR-GC</dt><dd>BelRed General Commercial. FAR 1.0 flat, heights 45 to 45 ft. Capped.</dd>",
        "<dt>BR-R</dt><dd>BelRed Residential. FAR 1.0 to 2.0, heights 30 to 45 ft.</dd>",
        "<dt>BR-ORT</dt><dd>BelRed Office/Residential Transition. FAR 0.75 flat, heights 45 to 45 ft. Capped.</dd>",
        "</dl>"
      ].join("\n")
    },
    {
      id: "guide-examples",
      title: "Three worked examples",
      html: [
        "<h4>Example 1: what base zoning delivers</h4>",
        "<div class='example'><ol class='steps'>",
        "<li>Click <strong>Base FAR</strong>. The preset label reads Current code, base FAR.</li>",
        "<li>Read the Results totals: <strong>8,990 homes</strong> and <strong>28,462 jobs</strong>, from 18,501,934 sq ft of gross floor area across 363 candidate parcels on 507.7 acres.</li>",
        "<li>Look at Constraints in this scenario. At base FAR with no participation, no constraint flags are active.</li>",
        "<li>Move Realization rate to 50% to see the v2 comparison case: <strong>4,495 homes</strong> and <strong>14,231 jobs</strong>. Move it back to 100% when you are done.</li>",
        "</ol></div>",
        "<h4>Example 2: 40% participation vs full participation</h4>",
        "<div class='example'><ol class='steps'>",
        "<li>Click <strong>40% participation</strong>. Totals read <strong>14,076 homes</strong> and <strong>37,926 jobs</strong>.</li>",
        "<li>Click <strong>Snapshot current scenario as baseline</strong>. The comparison block appears with those numbers as the baseline.</li>",
        "<li>Click <strong>Full incentives</strong>. Totals read <strong>21,705 homes</strong> and <strong>52,123 jobs</strong>.</li>",
        "<li>Read the delta rows: <strong>+7,629 homes</strong> and <strong>+14,197 jobs</strong> from moving participation from 40% to 100%.</li>",
        "<li>Read the Constraints list. The incentive dependent districts are named, and the note states the maximum bound is a policy outcome, not a zoning entitlement. The BR-RC-3 height flag appears as well.</li>",
        "</ol></div>",
        "<h4>Example 3: what to check in a district drawer</h4>",
        "<div class='example'><ol class='steps'>",
        "<li>In the district table, click the <strong>BR-MO</strong> row.</li>",
        "<li>Check FAR: 1.00 base and 1.00 max, so participation cannot move it. Check the flag: Capped, no incentive system. Check capacity at base: <strong>0 homes and 4,870 jobs</strong>, because BR-MO builds no standard residential.</li>",
        "<li>Read the open item box: the BR-MO vs BR-MO-1 swing. If node standards ultimately apply to the 116th Ave medical corridor, BR-MO rises to about <strong>19,482 jobs</strong> at the maximum bound.</li>",
        "<li>Close the drawer and click the <strong>BR-RC-3</strong> row. FAR runs 1.00 base to 4.00 max, but the Height may bind flag warns the 70 ft cap limits what the 4.0 FAR can deliver. Its whole maximum contribution is bounded at <strong>405 homes and 732 jobs</strong>.</li>",
        "</ol></div>"
      ].join("\n")
    },
    {
      id: "guide-caveats",
      title: "What to keep in mind",
      html: [
        "<ul>",
        "<li>Capacity is gross, not net of existing homes or jobs.</li>",
        "<li>FAR exemptions are displayed in the district drawer, not modeled. Affordable housing floor area, ground floor retail, enclosed plazas, and the care use exemptions add floor area the model does not count.</li>",
        "<li>The BelRed Look Forward LUCA is a draft, not adopted. If it is adopted, the standards must be re-extracted and every scenario re-run.</li>",
        "<li>Code snapshot 2026-11-09. The standards reflect the code in force on that date.</li>",
        "<li>Height is a flag, not a calculation input. The model does not check whether a building of the computed floor area fits under the height cap. It flags the districts where height may bind.</li>",
        "<li>Some values rest on the chart reproduction alone and are badged in the drawer. Chart footnotes (11), (13), and (15) were not recovered.</li>",
        "<li>No numeric density limit exists in the Bel Red code as read. FAR and height govern capacity.</li>",
        "<li>The BR-MO vs BR-MO-1 swing is the biggest open question: about 4,870 vs about 19,482 jobs at the maximum bound.</li>",
        "</ul>"
      ].join("\n")
    }
  ];

  /* ---------- panel behavior ---------- */

  var lastFocused = null;

  function openGuide() {
    var panel = (typeof document !== "undefined") ? document.getElementById("guide-panel") : null;
    var btn = (typeof document !== "undefined") ? document.getElementById("btn-guide") : null;
    if (!panel || !btn) {
      console.error("[scenario-studio] guide panel markup is missing, cannot open the guide.");
      return false;
    }
    lastFocused = document.activeElement;
    panel.hidden = false;
    var closeBtn = document.getElementById("guide-close");
    if (closeBtn && closeBtn.focus) { closeBtn.focus(); }
    return true;
  }

  function closeGuide() {
    var panel = (typeof document !== "undefined") ? document.getElementById("guide-panel") : null;
    var btn = (typeof document !== "undefined") ? document.getElementById("btn-guide") : null;
    if (!panel || !btn) {
      console.error("[scenario-studio] guide panel markup is missing, cannot close the guide.");
      return false;
    }
    panel.hidden = true;
    if (btn.focus) { btn.focus(); }
    return true;
  }

  /* Escape closes. Tab cycles inside the panel while it is open, so
   * keyboard users cannot tab out into the page behind it. */
  function onPanelKeyDown(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      closeGuide();
      return;
    }
    if (e.key !== "Tab") { return; }
    var panel = document.getElementById("guide-panel");
    if (!panel) { return; }
    var focusable = panel.querySelectorAll(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
    if (!focusable.length) { return; }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function renderGuide(nav, body) {
    SECTIONS.forEach(function (section) {
      var link = document.createElement("a");
      link.href = "#" + section.id;
      link.textContent = section.title;
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var heading = document.getElementById(section.id + "-heading");
        if (heading) {
          heading.scrollIntoView();
          heading.focus();
        }
      });
      nav.appendChild(link);

      var wrap = document.createElement("section");
      wrap.id = section.id;
      var heading = document.createElement("h3");
      heading.id = section.id + "-heading";
      heading.tabIndex = -1;
      heading.textContent = section.title;
      wrap.appendChild(heading);
      var content = document.createElement("div");
      content.innerHTML = section.html;
      wrap.appendChild(content);
      body.appendChild(wrap);
    });
  }

  function initGuide() {
    var nav = document.getElementById("guide-nav");
    var body = document.getElementById("guide-body");
    var btn = document.getElementById("btn-guide");
    var closeBtn = document.getElementById("guide-close");
    var panel = document.getElementById("guide-panel");
    if (!nav || !body || !btn || !closeBtn || !panel) {
      console.error("[scenario-studio] guide panel is missing markup, the Guide button will not work.");
      return;
    }
    renderGuide(nav, body);
    btn.addEventListener("click", openGuide);
    closeBtn.addEventListener("click", closeGuide);
    panel.addEventListener("keydown", onPanelKeyDown);
  }

  /* The module only touches the DOM in a browser. In Node (acceptance
   * test) document is undefined and init is skipped, so requiring this
   * file is safe and the content stays testable. */
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initGuide);
    } else {
      initGuide();
    }
  }

  return {
    SECTIONS: SECTIONS,
    IDS_USED: IDS_USED,
    open: openGuide,
    close: closeGuide,
    init: initGuide
  };
}));
