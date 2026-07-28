# 17. Free Census Reports for Life

**Time: 60 minutes. Cost: $0. Code: Python.**

Real numbers about a whole city, pulled fresh, saved as a document you can actually use.

---

## What you get

A script you run with a city and state. It comes back with population, median income, median home value, median year built, owner-occupied percentage, median age, and poverty rate, and saves it all as a clean markdown file with the source cited.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| ESRI Business Analyst reports | $100s per report or licensed access | Built for enterprise GIS teams |
| Data broker "market reports" | $50 to $300 per report | Often the same public Census data, marked up |

---

## What is actually free and what is not

Entirely free. Same Census API as guide 16, one level up, place instead of tract.

---

## Prerequisites

- Python 3 installed. Check with `python3 --version` in a terminal. If missing, get it at `https://www.python.org/downloads/`.
- A free Census API key. Same one from guide 16 if you already did it, `https://api.census.gov/data/key_signup.html` if not.

No Cloudflare, no Worker, no D1. This one is a script that runs on your own computer.

---

## Step 1. Save the script

Create a file called `census_report.py` anywhere convenient. This uses only Python's built-in libraries, nothing to install.

```python
#!/usr/bin/env python3
"""
Free Census Reports for Life
Pull real ACS data for any US city and generate a citable markdown report.

Usage:
    python3 census_report.py "Greenville" SC
"""

import sys
import json
from datetime import date
import urllib.request

CENSUS_API_KEY = "YOUR_KEY_HERE"  # https://api.census.gov/data/key_signup.html
ACS_YEAR = "2023"  # check for a newer vintage before running this months from now

STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08",
    "CT": "09", "DE": "10", "DC": "11", "FL": "12", "GA": "13", "HI": "15",
    "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27",
    "MS": "28", "MO": "29", "MT": "30", "NE": "31", "NV": "32", "NH": "33",
    "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46",
    "TN": "47", "TX": "48", "UT": "49", "VT": "50", "VA": "51", "WA": "53",
    "WV": "54", "WI": "55", "WY": "56"
}

VARIABLES = {
    "B01003_001E": "population",
    "B19013_001E": "median_income",
    "B25077_001E": "median_home_value",
    "B25035_001E": "median_year_built",
    "B25003_001E": "total_units",
    "B25003_002E": "owner_units",
    "B01002_001E": "median_age",
    "B17001_001E": "poverty_universe",
    "B17001_002E": "poverty_count"
}


def fetch_json(url):
    with urllib.request.urlopen(url) as resp:
        return json.loads(resp.read())


def find_place(city, state_abbr):
    state_fips = STATE_FIPS.get(state_abbr.upper())
    if not state_fips:
        raise ValueError(f"Unknown state abbreviation: {state_abbr}")

    url = (
        f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
        f"?get=NAME&for=place:*&in=state:{state_fips}&key={CENSUS_API_KEY}"
    )
    header, *rows = fetch_json(url)
    name_idx = header.index("NAME")
    place_idx = header.index("place")

    matches = [r for r in rows if city.lower() in r[name_idx].lower()]
    if not matches:
        raise ValueError(f"No place found matching '{city}' in {state_abbr}")
    if len(matches) > 1:
        print("Multiple matches found, using the first:")
        for m in matches:
            print("  -", m[name_idx])

    return {"name": matches[0][name_idx], "state": state_fips, "place": matches[0][place_idx]}


def fetch_stats(place):
    var_codes = ",".join(VARIABLES.keys())
    url = (
        f"https://api.census.gov/data/{ACS_YEAR}/acs/acs5"
        f"?get={var_codes}&for=place:{place['place']}&in=state:{place['state']}"
        f"&key={CENSUS_API_KEY}"
    )
    header, row = fetch_json(url)
    raw = dict(zip(header, row))

    def num(code, as_float=False):
        # Census returns every field as a string. Most of these are whole
        # numbers, but median age (B01002_001E) comes back as a decimal like
        # "38.4" -- int("38.4") raises ValueError. Parse as float first, which
        # never throws on either shape, then round to a whole number except
        # for the one field that is genuinely a decimal.
        val = raw.get(code)
        if val is None:
            return None
        try:
            parsed = float(val)
        except ValueError:
            return None
        if parsed < 0:
            return None
        return parsed if as_float else int(round(parsed))

    stats = {
        label: num(code, as_float=(code == "B01002_001E"))
        for code, label in VARIABLES.items()
    }

    stats["owner_occupied_pct"] = (
        round(stats["owner_units"] / stats["total_units"] * 100, 1)
        if stats["total_units"] and stats["owner_units"] is not None else None
    )
    stats["poverty_pct"] = (
        round(stats["poverty_count"] / stats["poverty_universe"] * 100, 1)
        if stats["poverty_universe"] and stats["poverty_count"] is not None else None
    )

    return stats


def line(label, value, prefix="", suffix=""):
    return f"- {label}: {prefix}{value:,}{suffix}" if value is not None else f"- {label}: not available"


def build_report(place, stats):
    today = date.today().isoformat()
    return "\n".join([
        f"# {place['name']}",
        f"Pulled {today} from the Census Bureau's {ACS_YEAR} 5-year American Community Survey.",
        "",
        "## The receipts",
        "",
        line("Population", stats["population"]),
        line("Median household income", stats["median_income"], prefix="$"),
        line("Median home value", stats["median_home_value"], prefix="$"),
        f"- Median year homes were built: {stats['median_year_built']}" if stats["median_year_built"] else "- Median year built: not available",
        f"- Owner-occupied: {stats['owner_occupied_pct']}%" if stats["owner_occupied_pct"] is not None else "- Owner-occupied: not available",
        f"- Median age: {stats['median_age']}" if stats["median_age"] else "- Median age: not available",
        f"- Poverty rate: {stats['poverty_pct']}%" if stats["poverty_pct"] is not None else "- Poverty rate: not available",
        "",
        "## Source",
        f"U.S. Census Bureau, {ACS_YEAR} American Community Survey 5-Year Estimates.",
        "https://www.census.gov/programs-surveys/acs"
    ])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print('Usage: python3 census_report.py "City Name" ST')
        sys.exit(1)

    place = find_place(sys.argv[1], sys.argv[2])
    stats = fetch_stats(place)
    report = build_report(place, stats)

    filename = place["name"].split(",")[0].replace(" ", "-").lower() + "-report.md"
    with open(filename, "w") as f:
        f.write(report)

    print(report)
    print(f"\nSaved to {filename}")
```

## Step 2. Add your API key

Replace `YOUR_KEY_HERE` on the `CENSUS_API_KEY` line with your real key.

## Step 3. Run it

```
python3 census_report.py "Greenville" SC
```

Use the city name only, no "city" or "town" suffix, and the two-letter state code.

## Step 4. Check the output

A file appears in the same folder, `greenville-report.md`, with every stat filled in and a source line at the bottom.

---

## Verify it works

- [ ] Running it against a city you know produces numbers that look roughly right
- [ ] A misspelled or nonexistent city raises a clear error instead of a cryptic traceback
- [ ] Running it against a common name that exists in multiple places, "Greenville" exists in several states, correctly finds the one in the state you specified
- [ ] The saved `.md` file opens and reads correctly in any text editor or markdown viewer

---

## What breaks and how to fix it

**"No place found matching '(city)' in (state)"**
Check spelling first. If the city is genuinely small, try a partial name, `python3 census_report.py "Green" SC` will match anything containing "Green," then check the printed list of matches.

**"Unknown state abbreviation"**
Two-letter code only, uppercase or lowercase both work since the script uppercases it, but it must be a real postal abbreviation, not a full state name.

**HTTP 403 or "Invalid Key" error**
The key has not activated yet, this can take up to a couple of hours after signup, or `YOUR_KEY_HERE` was never actually replaced.

**Numbers show as "not available" across the board**
Some very small places have too little data for reliable ACS estimates and the Bureau suppresses it. Try a larger nearby place, or accept that number does not exist for that location, it is not a bug.

**Multiple matches print but the script picks the wrong one**
The script always uses the first match. If your target is not first, narrow the search, `"Greenville city, South Carolina"` as the search term instead of just `"Greenville"` will usually isolate the right one.

**"python3: command not found"**
Some systems, particularly some Windows installs, register the command as `python` instead of `python3`. Try that instead.

---

## What to do next

Go to **20. Free SOP Library for Life**. No code at all, the fastest one left in the library.

---

## Sources to verify yourself

- ACS 5-year data and variable definitions: `https://www.census.gov/data/developers/data-sets/acs-5year.html`
- Census API variable browser: `https://api.census.gov/data/2023/acs/acs5/variables.html`
