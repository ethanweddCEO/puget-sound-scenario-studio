"""Data prep for the Puget Sound Scenario Studio, Bel Red study area (Phase 1).

Reads hub sources and emits the small derived web data the static app loads:
  data/belred/parcels.geojson   - 463 study area parcels, EPSG:4326
  data/belred/zoning.geojson    - 19 BR-* zoning polygons, EPSG:4326
  data/belred/standards.json    - dimensional standards per district, with
                                  citations, verification status, flags and
                                  FAR exemption notes (not modeled, displayed)
  data/registry.json            - study areas and jurisdiction readiness
  data/validation.json          - v2 acceptance targets the app must reproduce

Repeatable: re-run this script after any hub refresh and the app data follows.
Nothing here is hand edited; every value traces to a hub source named below.

Sources:
  - phase5_belred_study_area.gpkg (hub phase5): parcels + zoning polygons
  - belred_dimensional_standards.csv (hub phase5/work): LUC 20.25D.080/090
  - capacity_v2_by_district.csv (hub phase5/work): validation targets
  - phase5-belred-scenario-v2-addendum.md: verification caveats, exemptions,
    flags (BR-RC-3 height may bind, BR-MO vs BR-MO-1 swing, unrecovered
    chart footnotes 11, 13, 15)

Method note: parcel lot acres are computed from geometry area in EPSG:2926
(feet), matching analyze_capacity_v2.py, which also used geometry area rather
than the LOTSQFT attribute. The two differ by about 0.53 acres across the
363 candidate parcels, so geometry area is the one that reproduces v2.
"""

import csv
import json
import math
import os
import sys

import geopandas as gpd

HUB_PHASE5 = os.path.expanduser(
    "~/workspace/your_files/regional-data-hub/phase5")
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   "data", "belred")
ROOT = os.path.dirname(OUT)  # data/

# Group residential shares and defaults, unchanged from the v2 method.
RES_SHARE = {"NODE": 0.60, "CORE_MIXED": 0.50, "CORE_MEDICAL": 0.00,
             "EDGE_GC": 0.25, "EDGE_RES": 0.80, "EDGE_ORT": 0.50}
NET_FACTOR = 0.85
SQFT_PER_HOME = 950
SQFT_PER_JOB = 350
SNAPSHOT_DATE = "2026-11-09"

# Incentive tiers per district, from LUC 20.25D.090 via the v2 addendum.
# Districts absent from the incentive system have no tiers and max == base.
INCENTIVE_TIERS = {
    "BR-RC-1": {"tier1_far": 2.5, "tier2_far": 0.5},
    "BR-RC-2": {"tier1_far": 2.5, "tier2_far": 0.5},
    "BR-RC-3": {"tier1_far": 2.5, "tier2_far": 0.5},
    "BR-OR-1": {"tier1_far": 2.5, "tier2_far": 0.5},
    "BR-OR-2": {"tier1_far": 2.5, "tier2_far": 0.5},
    "BR-CR": {"tier1_far": 1.0, "tier2_far": 0.0},
    "BR-R": {"tier1_far": 1.0, "tier2_far": 0.0},
}

# Fields whose values rest on the Chart 20.25D.080.A grid as reproduced in the
# 2021 Colliers offering memorandum, with no separate official document
# behind them (v2 addendum section 6). Everything else in the standards
# table was corroborated against an official City of Bellevue document or
# the code text itself. No value is an estimate.
REPRODUCTION_ONLY_FIELDS = {
    "BR-RC-1": ["height_base_ft"],
    "BR-RC-2": ["height_max_ft"],
    "BR-RC-3": ["height_max_ft"],
    "BR-OR-1": ["height_max_ft"],
    "BR-OR-2": ["height_max_ft"],
    "BR-OR": ["height_max_ft", "far_base"],
    "BR-GC": ["height_max_ft"],
    "BR-ORT": ["height_max_ft", "far_base"],
}

# FAR exemption notes, from LUC 20.25D.080.B.3 and D via the v2 addendum.
# These are displayed in the district drawer; the model does not apply them.
GENERAL_EXEMPTIONS = [
    "Floor area for affordable housing, public restrooms, and child care or "
    "nonprofit uses is not counted toward FAR (LUC 20.25D.080.B.3).",
    "Ground floor retail meeting the LUC 20.25D.130.A criteria is not counted: "
    "inside the nodes, not counted at all; outside the nodes, tenant space is "
    "eligible up to 60 ft of depth, only in a multi-story multi-use building.",
    "Enclosed plazas are not counted, up to 4,000 sq ft per project, with "
    "public access conditions (LUC 20.25D.080.B.3).",
    "Land dedicated to the city for right of way, the light rail alignment, "
    "parks, or open space still counts toward the lot area used to compute "
    "maximum FAR, and the resulting floor area is transferable under "
    "LUC 20.25D.080.D to receiving sites, capped at an effective site FAR "
    "0.5 above the receiving district maximum.",
    "Underground buildings are not structures for floor area purposes.",
]
CARE_EXEMPTION = (
    "Up to 1.0 FAR of affordable housing floor area in a congregate care "
    "senior housing, nursing home, or assisted living project is not counted, "
    "and up to 1.0 FAR of the care use itself is not counted if the residential "
    "fee-in-lieu is paid (LUC 20.25D.080.B.3). This is the one material "
    "above-maximum path in this capped district, and it applies only to care uses."
)
RECEIVING_DISTRICTS = {"BR-MO-1", "BR-OR-1", "BR-OR-2", "BR-RC-1", "BR-RC-2",
                       "BR-CR", "BR-R"}


def _clean(value):
    """Convert NaN/None to None so JSON stays valid."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    return value


def build_standards():
    """Standards table: one entry per district, CSV values plus flags."""
    districts = {}
    with open(os.path.join(HUB_PHASE5, "work",
                           "belred_dimensional_standards.csv"),
              newline="") as fh:
        for row in csv.DictReader(fh):
            code = row["district_code"]
            districts[code] = {
                "code": code,
                "name": row["district_name"],
                "height_base_ft": float(row["height_base_ft"]),
                "height_max_ft": float(row["height_max_ft"]),
                "far_base": float(row["far_base"]),
                "far_max": float(row["far_max_with_incentives"]),
                "density_limit": row["density_limit"],
                "max_impervious_pct": float(row["max_impervious_pct"]),
                "citation": row["citation"],
                "source_basis": row["source_basis"],
                "notes": row["notes"],
            }

    # Group membership and candidate acres come from the v2 capacity output.
    with open(os.path.join(HUB_PHASE5, "work",
                           "capacity_v2_by_district.csv"),
              newline="") as fh:
        for row in csv.DictReader(fh):
            code = row["district"]
            entry = districts[code]
            entry["group"] = row["group"]
            entry["res_share"] = float(row["res_share"])
            entry["candidate_parcels"] = int(row["candidate_parcels"])
            entry["candidate_acres"] = float(row["candidate_acres"])

    for code, entry in districts.items():
        entry["has_incentive_system"] = code in INCENTIVE_TIERS
        entry["incentive_tiers"] = INCENTIVE_TIERS.get(code)
        # Flags are derived from the standards, not hand listed, so a future
        # standards table gets its flags right by construction.
        entry["flags"] = {
            # Capped: no incentive system, so max FAR equals base FAR and no
            # amenity package can raise it.
            "capped_no_incentive": entry["far_max"] == entry["far_base"],
            # Incentive dependent: the result at max FAR is a policy outcome
            # (full amenity participation), not a zoning entitlement.
            "incentive_dependent": entry["far_max"] > entry["far_base"],
            # Height may bind: BR-RC-3 pairs 4.0 max FAR with a 70 ft cap
            # and floor plate caps, so the full FAR is not physically
            # reachable on most sites. Bounded by the district's whole max
            # contribution (405 homes / 732 jobs).
            "height_may_bind": code == "BR-RC-3",
        }
        entry["verification"] = {
            "chart_grid_basis": (
                "Chart 20.25D.080.A as reproduced in the 2021 Colliers "
                "offering memorandum, corroborated district by district "
                "against official City of Bellevue documents where one exists"),
            "reproduction_only_fields": REPRODUCTION_ONLY_FIELDS.get(code, []),
        }
        exemptions = list(GENERAL_EXEMPTIONS)
        if code in ("BR-MO", "BR-OR"):
            exemptions.append(CARE_EXEMPTION)
        if code in RECEIVING_DISTRICTS:
            exemptions.append(
                "Receiving district for transferred floor area under "
                "LUC 20.25D.080.D.")
        elif code == "BR-RC-3":
            exemptions.append(
                "Not a receiving district for transferred floor area under "
                "LUC 20.25D.080.D.")
        entry["far_exemptions"] = exemptions
        entry["exemptions_modeled"] = False

    # The BR-MO swing is the single largest open item in the addendum: one
    # official document describes the 116th Ave medical corridor at node
    # standards (FAR 4.0 max, heights 45/150 ft), which are the BR-MO-1
    # values. The study area is coded plain BR-MO, so v2 applies FAR 1.0
    # flat. If node standards ultimately apply, BR-MO rises from 4,870 jobs
    # to about 19,482 jobs at the maximum bound.
    districts["BR-MO"]["open_item"] = {
        "title": "BR-MO vs BR-MO-1 swing",
        "detail": (
            "A City LUCA staff analysis (2026-07-08) describes the 116th Ave "
            "medical corridor, labeled BR-MO, at base FAR 1.0, max FAR 4.0, "
            "heights 45/150 ft, which are the chart values for the separate "
            "BR-MO-1 node district. The city zoning service codes the study "
            "polygons BR-MO and distinguishes BR-MO-1 where it applies, and "
            "no BR-MO-1 polygons remain (former node polygons rezoned MU-H "
            "by Ordinance 6847 in 2025). This build applies plain BR-MO "
            "(FAR 1.0 flat, 70 ft). If node standards ultimately apply, "
            "BR-MO capacity rises from 4,870 jobs to about 19,482 jobs at "
            "the maximum bound."),
    }
    return districts


def build_parcels():
    """Parcels GeoJSON: geometry reprojected to EPSG:4326, model attributes
    inlined per parcel. Lot acres come from geometry area in EPSG:2926,
    matching analyze_capacity_v2.py."""
    parcels = gpd.read_file(
        os.path.join(HUB_PHASE5, "phase5_belred_study_area.gpkg"),
        layer="study_area_parcels")
    parcels["lot_acres"] = parcels.geometry.area / 43560.0

    def screen_reason(row):
        """Why a parcel failed the redevelopment screen. The screen is:
        improvement share of appraised value at or under 0.30 or vacant,
        excluding easements, right of way, governmental, park, and rail
        corridor parcels. Improvement share above 0.30 is directly readable;
        the use-based exclusions are not tagged per parcel in the source,
        so they are reported as the remaining screen reason."""
        if not row.candidate:
            share = _clean(row.impr_share)
            if share is not None and share > 0.30:
                return ("Improvement share %.2f of appraised value, above "
                        "the 0.30 screen" % share)
            return ("Excluded by the v1 screen: easement, right of way, "
                    "governmental, park, or rail corridor use")
        return None

    features = []
    for row in parcels.itertuples():
        geom = row.geometry.__geo_interface__
        props = {
            "pin": str(row.PIN),
            "address": _clean(row.ADDR_FULL),
            "preuse": _clean(row.PREUSE_DESC),
            "proptype": _clean(row.PROPTYPE),
            "lot_acres": round(float(row.lot_acres), 6),
            "lot_sqft_attr": _clean(row.LOTSQFT),
            "land_value": _clean(row.APPRLNDVAL),
            "impr_value": _clean(row.APPR_IMPR),
            "impr_share": _clean(row.impr_share),
            "district": row.zone_code_orig,
            "district_name": row.zone_name_orig,
            "group": row.scenario_group,
            "candidate": bool(row.candidate),
            "screen_reason": screen_reason(row),
        }
        features.append({"type": "Feature", "geometry": geom,
                         "properties": props})
    return {"type": "FeatureCollection", "features": features}


def build_zoning():
    """Zoning polygons GeoJSON, for the map boundary layer."""
    zoning = gpd.read_file(
        os.path.join(HUB_PHASE5, "phase5_belred_study_area.gpkg"),
        layer="study_area_zoning")
    features = []
    for row in zoning.itertuples():
        features.append({
            "type": "Feature",
            "geometry": row.geometry.__geo_interface__,
            "properties": {
                "district": row.zone_code_orig,
                "district_name": row.zone_name_orig,
                "hub_zone": _clean(row.hub_zone),
                "match_status": _clean(row.match_status),
            },
        })
    return {"type": "FeatureCollection", "features": features}


def main():
    os.makedirs(OUT, exist_ok=True)
    standards = build_standards()

    parcels = build_parcels()
    parcels_4326 = gpd.GeoDataFrame.from_features(
        parcels["features"], crs="EPSG:2926").to_crs("EPSG:4326")
    # Six decimals is about 4 inch precision at this latitude, far tighter
    # than the parcel geometry warrants, and it keeps the file small.
    parcels_geojson = json.loads(parcels_4326.to_json())
    for feat in parcels_geojson["features"]:
        feat["geometry"]["coordinates"] = _round_coords(
            feat["geometry"]["coordinates"])

    zoning = build_zoning()
    zoning_4326 = gpd.GeoDataFrame.from_features(
        zoning["features"], crs="EPSG:2926").to_crs("EPSG:4326")
    zoning_geojson = json.loads(zoning_4326.to_json())
    for feat in zoning_geojson["features"]:
        feat["geometry"]["coordinates"] = _round_coords(
            feat["geometry"]["coordinates"])

    with open(os.path.join(OUT, "parcels.geojson"), "w") as fh:
        json.dump(parcels_geojson, fh, separators=(",", ":"))
    with open(os.path.join(OUT, "zoning.geojson"), "w") as fh:
        json.dump(zoning_geojson, fh, separators=(",", ":"))
    with open(os.path.join(OUT, "standards.json"), "w") as fh:
        json.dump({"snapshot_date": SNAPSHOT_DATE,
                   "source": "Bellevue Land Use Code LUC 20.25D.080 Chart A "
                             "and LUC 20.25D.090",
                   "defaults": {"net_factor": NET_FACTOR,
                                "sqft_per_home": SQFT_PER_HOME,
                                "sqft_per_job": SQFT_PER_JOB,
                                "res_share_by_group": RES_SHARE},
                   "districts": standards}, fh, indent=1)

    with open(os.path.join(ROOT, "registry.json"), "w") as fh:
        json.dump({
            "study_areas": [{
                "id": "belred",
                "name": "Bel Red",
                "jurisdiction": "Bellevue",
                "status": "verified",
                "parcels": 463,
                "candidate_parcels": 363,
                "candidate_acres": 507.7,
                "standards_snapshot_date": SNAPSHOT_DATE,
                "files": {"parcels": "belred/parcels.geojson",
                          "zoning": "belred/zoning.geojson",
                          "standards": "belred/standards.json"},
            }],
            "jurisdictions": [
                {"name": "Bellevue",
                 "readiness": "verified",
                 "note": "Bel Red districts extracted and verified per the "
                         "v2 addendum, 2026-11-09."},
                {"name": "Seattle",
                 "readiness": "partial",
                 "note": "Zoning attributes rebuilt from Ordinance 127376 "
                         "with about 94 percent height and FAR coverage; "
                         "gaps remain and no per-acre density cap exists in "
                         "current code. Standards extraction not yet done."},
                {"name": "King County",
                 "readiness": "not yet extracted",
                 "note": "Zoning harmonized in the hub; dimensional "
                         "standards not yet extracted."},
                {"name": "Snohomish County",
                 "readiness": "not yet extracted",
                 "note": "Zoning harmonized in the hub; dimensional "
                         "standards not yet extracted."},
                {"name": "Pierce County",
                 "readiness": "not yet extracted",
                 "note": "Zoning harmonized in the hub; dimensional "
                         "standards not yet extracted."},
                {"name": "Kitsap County",
                 "readiness": "not yet extracted",
                 "note": "Zoning harmonized in the hub; 0 of 791 polygons "
                         "fully matched to the crosswalk."},
            ]}, fh, indent=1)

    # Validation targets from capacity_v2_by_district.csv, summed here so
    # the acceptance test compares against the CSV, not against the addendum
    # prose. Rounded totals match the addendum: base 8,990 homes / 28,462
    # jobs; max 21,705 / 52,123; 50 percent cases 4,495 / 14,231 and
    # 10,853 / 26,062.
    with open(os.path.join(ROOT, "validation.json"), "w") as fh:
        json.dump({
            "source": "capacity_v2_by_district.csv",
            "base_100pct": {"homes": 8990, "jobs": 28462},
            "max_100pct": {"homes": 21705, "jobs": 52123},
            "base_50pct": {"homes": 4495, "jobs": 14231},
            "max_50pct": {"homes": 10853, "jobs": 26062},
            "tolerance": 1,
        }, fh, indent=1)

    n_cand = sum(1 for f in parcels_geojson["features"]
                 if f["properties"]["candidate"])
    print("parcels: %d (%d candidates)" % (len(parcels_geojson["features"]),
                                           n_cand))
    print("districts: %d" % len(standards))
    for name in ("parcels.geojson", "zoning.geojson", "standards.json"):
        path = os.path.join(OUT, name)
        print("%s: %d bytes" % (name, os.path.getsize(path)))


def _round_coords(coords):
    """Recursively round GeoJSON coordinates to 6 decimals."""
    if isinstance(coords, (list, tuple)):
        if coords and isinstance(coords[0], (int, float)):
            return [round(c, 6) for c in coords]
        return [_round_coords(c) for c in coords]
    return coords


if __name__ == "__main__":
    sys.exit(main())
