# Property Onboarding Workflow

What has to happen when a building enters the portfolio, in order, so that every downstream surface recognizes it: financial reporting, rent roll, vacancy, collections, work orders, civic risk, and the observation inbox. Miss a step and the property silently drops out of one of them.

## Identifiers

A property carries several identifiers, each owned by a different system. Getting these right is the whole job.

| Identifier | Column | Owned by | Used for |
|------------|--------|----------|----------|
| Property UUID | `portfolio.properties.id` | Command | The primary key everything internal joins on |
| Property code | `portfolio.properties.property_code` | Yardi, arriving through the Golden Data Model | Joining to `gdm.property.propertycode`, matching general ledger and financial workbook rows |
| Property HMY | `hmy_mappings` where `hmy_type` in `('property','phmy')` | Yardi | The strongest match key on any Yardi-sourced record |
| Canonical property id | `portfolio.properties.canonical_property_id` | Command | Points an inactive twin row at the surviving active property |
| APN | `stacks.portfolio_parcels.apn` | SF Assessor and SF Planning | Every civic record: permits, violations, complaints, evictions, fire, hazards, zoning |
| Unit HMY | `hmy_mappings` where `hmy_type` is the unit type | Yardi | Unit-level rent roll and lease records |

**Property code is not settable at creation.** The create endpoint does not accept it. It arrives from the Golden Data Model import, which upserts it with a `COALESCE` so a value already present is never overwritten by a null. Until a property code lands, every Yardi-sourced report row for that building will fail to match.

## The sequence

### Stage 1: Create the property record

**App:** Command. **Endpoint:** `POST /api/v1/properties`, admin role required.

| Field | Required | Default |
|-------|----------|---------|
| `name` | Yes | none |
| `address` | Yes | none |
| `city` | No | `San Francisco` |
| `state` | No | `CA` |
| `zip_code` | No | null |
| `property_type` | No | `multifamily` |
| `portfolio` | No | null |
| `market` | No | null |
| `total_units` | No | null |
| `status` | No | `active` |

The name matters more than it looks. It is a fallback match key for report rows that carry no code and no HMY, and financial workbooks are matched on a sheet banner name with prefix matching. Enter the name exactly as it appears in Yardi.

### Stage 2: Create units

**App:** Command. **Endpoint:** `POST /api/v1/units`, or the `cockpit_create_unit` tool.

Required: `property_id` and `unit_number`. Everything else (floor, bedrooms, bathrooms, square feet, unit type, current rent, market rent) is optional but feeds the rent-upside and renovation surfaces. `status` defaults to `occupied`, which is usually wrong on a fresh acquisition. Set it deliberately.

In practice units arrive in bulk from the rent roll import rather than being hand-entered. Hand-create units only when the property is not yet live in Yardi.

### Stage 3: Get the property into Yardi and the Golden Data Model

This is the step nobody in the platform controls. There is no Yardi API access from our side, no stored login, and no Voyager integration anywhere in the fleet. The property has to be set up in Yardi by the Mosser side, after which:

1. The nightly Golden Data Model extract loads `gdm.property`, `gdm.unit`, and the rest of the 70-plus tables.
2. The GDM import in Command upserts `property_code` and the HMY mapping onto the existing `portfolio.properties` row.
3. Yardi's report scheduler starts including the property in the rent roll, vacancy, general ledger, and AP exports.

Until this lands, the property exists in Command but has no financials, no rent roll, and no AR.

### Stage 4: Resolve the APN

**App:** Stacks.

The authoritative source is the SF Planning Property Information Map, a public no-auth ArcGIS service that returns a parcel's official street and address range, so it handles ranges and corner lots natively. It returns nothing for a non-SF address, which is the correct exclusion for the East Bay assets.

```bash
cd /Volumes/minibase-ssd/justinsato/Projects/ACTIVE/brick.stacks

# Resolve owned properties to APNs (read-only, produces a map file for review)
node scripts/sfpim-resolve.mjs

# Write the reviewed map into stacks.portfolio_parcels + stacks.parcel_info
node scripts/seed-portfolio-parcels.mjs
```

The link row records how it was matched:

| `match_method` | Meaning | Trust |
|----------------|---------|-------|
| `sfpim_address` | Address range matched the parcel record | Good |
| `sfpim_point` | Point-in-parcel fallback | Check it |
| `geo_fallback` | Neither worked; nearest centroid | Verify by hand before use |

A property may legitimately have more than one APN. The table is keyed on `(property_id, apn)` with an `is_primary` flag, because buildings span parcels.

Once the link exists, civic records attach by parcel rather than by radius. The read paths that used to fall back to address or radius matching were removed, so a property with no on-parcel events now correctly shows zero rather than the whole block's count.

### Stage 5: Push the property into Intel

Intel keeps a local cache of the roster at `items.property_lookup` so it can render property names without calling the Command backend. It is populated by `POST /api/ingest/property-lookup`, an idempotent upsert, called by the insight-tagger job (currently every 15 minutes on Fly) and on demand after a roster mutation.

| Column | Note |
|--------|------|
| `property_id` | Primary key, the Command UUID |
| `property_code`, `name`, `address` | Display and matching |
| `market`, `portfolio`, `submarket` | Grouping |
| `units_count` | Display |
| `property_manager`, `asset_manager`, `lender` | Feed the knowledge graph edges |
| `status` | Active or inactive |
| `refreshed_at` | Last sync |

This table is **overwritten** by the sync. Operator edits go in `items.property_overrides`, a separate table keyed on the same `property_id` with `ON DELETE CASCADE`. A null column there means "no override, use the cached value." Never hand-edit `property_lookup`; the next sync will erase it.

Once the property is in `property_lookup`, the insight tagger can resolve inbox observations to it, which sets `items.inbox_items.property_id` and makes the property appear in the activity tab, search results, the priorities digest, and the property graph.

### Stage 6: Confirm the report imports match

Every Yardi-sourced report row is resolved to a property by `PropertyResolver` in `backend/app/imports/gdm_validation.py`, in this order:

1. Property HMY against `hmy_mappings`
2. A direct `property_id` UUID on the record
3. `property_code` against the properties table
4. Exact property name match
5. Sheet banner name, with prefix matching for financial workbooks

Every resolved id is then run through the canonical map, which follows an inactive twin to the surviving active property.

A row that matches none of the five is unmatched. It does not stop the import and it does not raise. It just does not appear anywhere. This is the single most common failure mode of a bad onboarding: the import reports success, the property page shows nothing, and nobody notices for a month.

## Data-quality checks

Run the deterministic scan after onboarding, before declaring the property live.

```bash
# Via the Command backend
POST /api/v1/agents/run/data-accuracy
```

The scan covers these patterns:

| Pattern | Priority | Dimension | What it catches |
|---------|----------|-----------|-----------------|
| `orphan_hmy_mapping` | Critical | Consistency | An HMY mapping pointing at a property, unit, resident, or job row that no longer exists |
| `financials_orphan_property` | Critical | Consistency | Financial rows pointing at a property id that is not in the properties table |
| `lease_end_before_start` | High | Accuracy | Reversed lease dates, usually an import mapping error |
| `occupied_unit_missing_rent` | High | Completeness | A unit marked occupied with no current rent |
| `active_resident_without_property_or_unit` | Medium | Completeness | Residents that never got linked |
| `duplicate_active_resident_per_property` | Medium | Uniqueness | Two active rows for the same name at one property, usually a person HMY mapping problem |
| `property_missing_name` | Medium | Completeness | Blank name, which breaks the name fallback for every future report row |

Then run these by hand. They are what the automated scan does not cover.

```sql
-- 1. Does the property have a code and an HMY yet?
SELECT p.id, p.name, p.property_code, p.status,
       (SELECT count(*) FROM hmy_mappings m
         WHERE m.entity_id = p.id AND m.hmy_type IN ('property','phmy')) AS hmy_rows
FROM portfolio.properties p
WHERE p.name ILIKE '%<name fragment>%';

-- 2. Does the code join to the Golden Data Model?
SELECT p.property_code, g.propertycode
FROM portfolio.properties p
LEFT JOIN gdm.property g ON g.propertycode = p.property_code
WHERE p.property_code IS NOT NULL AND g.propertycode IS NULL;

-- 3. Stated unit count vs. actual unit rows
SELECT p.name, p.total_units, count(u.id) AS unit_rows
FROM portfolio.properties p
LEFT JOIN portfolio.units u ON u.property_id = p.id
GROUP BY p.id, p.name, p.total_units
HAVING p.total_units IS DISTINCT FROM count(u.id);

-- 4. Is the APN linked, and how confidently?
SELECT pp.property_id, pp.apn, pp.is_primary, pp.match_method, pi.zoning, pi.year_built
FROM stacks.portfolio_parcels pp
LEFT JOIN stacks.parcel_info pi USING (apn);

-- 5. Active properties missing an APN link entirely
SELECT p.id, p.name
FROM portfolio.properties p
LEFT JOIN stacks.portfolio_parcels pp ON pp.property_id = p.id
WHERE p.status = 'active' AND pp.apn IS NULL;

-- 6. Is Intel's cache current?
SELECT property_id, property_code, name, units_count, status, refreshed_at
FROM items.property_lookup
ORDER BY refreshed_at DESC
LIMIT 20;

-- 7. Are observations tagging to the property?
SELECT source, count(*), max(received_at)
FROM items.inbox_items
WHERE property_id = '<uuid>'
GROUP BY source;
```

## Failure modes

| Symptom | Root cause | Fix |
|---------|------------|-----|
| Property page renders but every financial panel is empty | No `property_code`, so nothing joins to `gdm.*` | Wait for the Yardi setup and the next GDM extract, then confirm check 2 |
| Rent roll imports report success, property shows no units | Report rows unmatched on all five resolver keys | Compare the report's property label against the name and code in Command |
| Civic risk shows zero permits and violations on an obviously active building | No APN link | Run the SFPIM resolver and seed the link |
| Civic counts look absurdly high | The link is a radius match, not a parcel match | Confirm `match_method`, re-resolve |
| Property name never appears in Intel search or the inbox | Not in `items.property_lookup` | Trigger the property-lookup push, then check `refreshed_at` |
| Operator's manual field edits keep reverting | Edited `items.property_lookup` instead of `items.property_overrides` | Move the edit to the overrides table |
| Two rows for the same building, financials split across both | Duplicate property with no canonical link | Set `canonical_property_id` on the inactive row to point at the survivor |
| East Bay property shows no zoning or hazard data | Correct behavior. The SF Planning service only covers San Francisco | Nothing to fix |

## Onboarding checklist

| # | Step | App | Done when |
|---|------|-----|-----------|
| 1 | Create the property | Command | Row exists with the exact Yardi name |
| 2 | Create or import units | Command | Unit count matches `total_units` |
| 3 | Yardi setup on the Mosser side | Yardi | Property appears in `gdm.property` |
| 4 | Confirm `property_code` and HMY landed | Command | Checks 1 and 2 return clean |
| 5 | Resolve and seed the APN | Stacks | `match_method` is `sfpim_address` or verified |
| 6 | Push the roster to Intel | Intel | `refreshed_at` is current |
| 7 | Confirm reports match | Command | Rent roll and vacancy rows land on the property |
| 8 | Run the accuracy scan | Command | No critical or high issues on the new property |

## Related pages

- [Command](/docs/apps/command)
- [Intel](/docs/apps/intel)
- [Stacks](/docs/apps/stacks)
- [Data Ingestion](/docs/data-ingestion)
- [Deal Sourcing](/docs/deal-sourcing)
- [Architecture Overview](/docs/architecture)
- [Neon Database](/docs/neon-database)
