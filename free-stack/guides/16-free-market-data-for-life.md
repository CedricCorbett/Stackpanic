# 16. Free Market Data for Life

**Time: 75 minutes. Cost: $0. Code: copy and paste.**

Type in an address, get real Census data back about that block. No data vendor in between.

---

## What you get

A page where anyone, you or a visitor, types an address and gets back median household income, median year homes were built, and what share of homes are owner-occupied, for the exact census tract that address sits in. Government data, publicly available, wired into your own site.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Esri Demographics | Licensing starts around $200+/mo | Built for GIS professionals, priced like it |
| Regional data vendors | $100 to $500 per month | Often the same Census data, repackaged |

The Census Bureau publishes this data itself, for free, no license required. What people actually pay for is the lookup convenience, address in, numbers out, without learning FIPS codes. That convenience is what this guide builds.

---

## What is actually free and what is not

Entirely free. The Census Geocoder needs no API key at all. The ACS data API technically works without a key too, but is rate-limited hard enough to be unusable for anything beyond a couple of lookups. Get a free key, it takes under a minute: `https://api.census.gov/data/key_signup.html`, no cost, no card, ever.

---

## Prerequisites

- Guide 00 complete
- Guide 03 complete, with `src/index.js` deployed and working
- A free Census API key from the signup link above

---

## The shape of what you are building

```
  Visitor types an address
                |
                v
  Census Geocoder   (free, no key)  ->  which census tract is this?
                |
                v
  Check D1 cache for this tract first
                |
        -----------------
        |               |
    cached?         not cached
        |               |
   return it      Census ACS API (needs your free key)
                        |
                        v
                  cache it, then return it
```

Caching by tract, not by address, matters. Two different addresses on the same block share a tract, and tract-level statistics do not change day to day, so there is no reason to hit the Census API twice for the same tract.

---

## Step 1. Get your free Census API key

Go to `https://api.census.gov/data/key_signup.html`. Fill in an email and organization name. The key arrives by email within a few minutes.

## Step 2. Store it

```
npx wrangler secret put CENSUS_API_KEY
```

## Step 3. Add the cache table

Create `schema-market.sql`:

```sql
CREATE TABLE IF NOT EXISTS market_lookups (
  tract_geoid       TEXT PRIMARY KEY,
  looked_up_at      TEXT NOT NULL,
  median_income     INTEGER,
  median_year_built INTEGER,
  owner_occupied_pct REAL,
  raw_json          TEXT
);
```

```
npx wrangler d1 execute leads --remote --file=./schema-market.sql
```

## Step 4. Add the route

Above the `/admin/leads.csv` check:

```js
    if (url.pathname === "/api/market-lookup" && request.method === "GET") {
      return lookupMarket(url, env);
    }

```

## Step 5. Add the lookup logic

```js
// ---------------------------------------------------------------
// Market data (guide 16)
// ---------------------------------------------------------------

async function lookupMarket(url, env) {
  const address = url.searchParams.get("address");
  if (!address) return json({ ok: false, error: "Missing address." }, 400);

  const geoRes = await fetch(
    "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
    "?address=" + encodeURIComponent(address) +
    "&benchmark=Public_AR_Current&vintage=Current_Current&format=json"
  );
  const geoData = await geoRes.json();
  const match = geoData.result?.addressMatches?.[0];
  if (!match) return json({ ok: false, error: "Could not find that address." }, 404);

  const tract = match.geographies?.["Census Tracts"]?.[0];
  if (!tract) return json({ ok: false, error: "Address found, but no tract on file for it." }, 404);

  const geoid = tract.GEOID;

  const cached = await env.DB.prepare(
    `SELECT raw_json FROM market_lookups WHERE tract_geoid = ?`
  ).bind(geoid).first();

  if (cached) {
    return json({ ok: true, ...JSON.parse(cached.raw_json), cached: true });
  }

  // ACS 5-year estimates. Check for a more recent year than 2023 at
  // https://www.census.gov/data/developers/data-sets/acs-5year.html
  const acsRes = await fetch(
    "https://api.census.gov/data/2023/acs/acs5" +
    "?get=B19013_001E,B25035_001E,B25003_001E,B25003_002E" +
    `&for=tract:${tract.TRACT}&in=state:${tract.STATE}+county:${tract.COUNTY}` +
    `&key=${env.CENSUS_API_KEY}`
  );
  const acsData = await acsRes.json();

  if (!Array.isArray(acsData) || !acsData[1]) {
    return json({ ok: false, error: "Census data unavailable for this tract." }, 502);
  }

  const [income, yearBuilt, totalUnits, ownerUnits] = acsData[1];

  const result = {
    tract: geoid,
    medianIncome: Number(income) > 0 ? Number(income) : null,
    medianYearBuilt: Number(yearBuilt) > 0 ? Number(yearBuilt) : null,
    ownerOccupiedPct: Number(totalUnits) > 0
      ? Math.round((Number(ownerUnits) / Number(totalUnits)) * 1000) / 10
      : null
  };

  await env.DB.prepare(
    `INSERT OR REPLACE INTO market_lookups
     (tract_geoid, looked_up_at, median_income, median_year_built, owner_occupied_pct, raw_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    geoid, new Date().toISOString(),
    result.medianIncome, result.medianYearBuilt, result.ownerOccupiedPct,
    JSON.stringify(result)
  ).run();

  return json({ ok: true, ...result, cached: false });
}
```

> **Why `-1` and negative values get filtered to `null`.** The Census Bureau uses specific negative numbers as "not available" or "not applicable" codes rather than leaving a field blank. Checking `> 0` before trusting a value catches this. Displaying a literal `-666666666` as someone's neighborhood income, which does happen if you skip this check, is not a good look.

## Step 6. Build the lookup page

Add to any page, or make a new `public/market-data.html` using the `wrap`/`hero` styles from guide 02:

```html
<div class="hero">
  <h1>Look up any block</h1>
  <p>Type an address to see real Census data for that neighborhood.</p>
  <input id="addr" placeholder="123 Main St, Greenville, SC" style="width:100%;max-width:420px;padding:12px;border:1px solid var(--line);border-radius:6px;font-size:16px;margin-top:16px;">
  <button class="btn" id="lookupBtn" style="border:0;cursor:pointer;margin-left:8px">Look it up</button>
  <div id="result" style="margin-top:24px"></div>
</div>

<script>
document.getElementById("lookupBtn").addEventListener("click", async () => {
  const address = document.getElementById("addr").value.trim();
  const result = document.getElementById("result");
  if (!address) return;

  result.textContent = "Looking it up...";
  const res = await fetch("/api/market-lookup?address=" + encodeURIComponent(address));
  const data = await res.json();

  if (!data.ok) {
    result.textContent = data.error;
    return;
  }

  result.innerHTML = `
    <p><b>Tract ${data.tract}</b></p>
    <p>Median household income: ${data.medianIncome ? "$" + data.medianIncome.toLocaleString() : "not available"}</p>
    <p>Median year built: ${data.medianYearBuilt || "not available"}</p>
    <p>Owner-occupied: ${data.ownerOccupiedPct ? data.ownerOccupiedPct + "%" : "not available"}</p>
  `;
});
</script>
```

## Step 7. Deploy and test

```
npx wrangler deploy
```

Try a real address. Then try the same address again, it should return instantly the second time, `cached: true` in the response confirming it skipped the Census API entirely.

---

## Verify it works

- [ ] A real address returns income, year built, and owner-occupied percentage
- [ ] Looking up the same address twice is noticeably faster the second time
- [ ] A nonsense address like "asdf 123" returns "Could not find that address" instead of crashing
- [ ] A valid address in a tract with suppressed Census data shows "not available" for that field, not a broken negative number

---

## What breaks and how to fix it

**"Could not find that address"**
Almost always formatting. Include city and state, `123 Main St, Greenville, SC` works far more reliably than a street address alone.

**"Census data unavailable for this tract"**
Very rare, but some sparsely populated tracts genuinely have suppressed data for privacy. Nothing to fix, that is the real answer for that tract.

**Every lookup is slow, cache never seems to help**
Confirm `schema-market.sql` was run with `--remote`. Without the table, every lookup silently fails to cache and re-queries every time.

**Numbers look absurd, income in the billions or negative years**
The `> 0` filtering from step 5 is missing or was edited out. Census suppression codes are large negative numbers, not zeros, so a naive "is this falsy" check will not catch them.

**"Invalid Key" error from the ACS API**
The key has not finished activating yet, this can take up to a couple of hours after signup, or there is stray whitespace in the stored secret. Re-run `npx wrangler secret put CENSUS_API_KEY`.

---

## What to do next

Go to **17. Free Census Reports for Life**. Same data source, a deeper cut, delivered as a document instead of a live page.

---

## Sources to verify yourself

- Census Geocoder API: `https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.pdf`
- ACS 5-year data: `https://www.census.gov/data/developers/data-sets/acs-5year.html`
- Free API key signup: `https://api.census.gov/data/key_signup.html`
