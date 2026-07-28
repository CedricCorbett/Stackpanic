# 21. Free Content Engine for Life

**Time: 60 minutes. Cost: $0. Code: Python.**

A spreadsheet of headlines in. A folder of finished, on-brand graphics out.

---

## What you get

Fill in a simple CSV, one row per post, headline and a subline. Run one command. Every row becomes a properly sized, on-brand graphic, ready to upload, no opening a design tool ten separate times.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Later or Buffer, content creation add-ons | $25 to $100+ per month | Scheduling tools, not actually design tools |
| A part-time VA for graphics | $200+ per month | Real money for repetitive, template-shaped work |

The repetitive part of a content calendar, same layout, same brand colors, different headline each time, is exactly the kind of task a script does better than a person: it never gets the margins wrong and it never charges by the hour.

---

## What is actually free and what is not

Entirely free, same Pillow library as guide 22.

---

## Prerequisites

- Guide 22 complete. This guide reuses its text-wrapping function directly rather than writing a second version of the same logic.

---

## Step 1. Set your brand

Save this as `content_engine.py`, in the same folder as `Anton-Regular.ttf` from guide 22.

```python
#!/usr/bin/env python3
"""
Free Content Engine for Life
Turn a content calendar CSV into a folder of ready-to-post graphics.

Usage:
    python3 content_engine.py queue.csv output/
"""

import sys
import csv
import os
from PIL import Image, ImageDraw, ImageFont

CANVAS_SIZE = (1080, 1350)
FONT_PATH = "Anton-Regular.ttf"
HEADLINE_SIZE = 88
SUBTEXT_SIZE = 40
BG_COLOR = (14, 15, 18)        # change to your brand's dark tone
ACCENT_COLOR = (255, 62, 48)   # change to your brand's accent color
TEXT_COLOR = (240, 240, 236)
SUBTEXT_COLOR = (150, 150, 150)
MARGIN = 80


def wrap_lines(text, font, max_width, draw):
    # Same wrapping logic as guide 22, reused rather than rewritten.
    words = text.split()
    lines, current = [], ""
    for word in words:
        test = (current + " " + word).strip()
        if draw.textlength(test, font=font) <= max_width:
            current = test
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def make_slide(headline, subtext, output_path):
    img = Image.new("RGB", CANVAS_SIZE, BG_COLOR)
    draw = ImageDraw.Draw(img)

    # A thin accent bar along the top, a simple, repeatable brand mark
    # that costs nothing to render and makes every post recognizable.
    draw.rectangle([(0, 0), (CANVAS_SIZE[0], 14)], fill=ACCENT_COLOR)

    headline_font = ImageFont.truetype(FONT_PATH, HEADLINE_SIZE)
    subtext_font = ImageFont.truetype(FONT_PATH, SUBTEXT_SIZE)
    max_width = CANVAS_SIZE[0] - (MARGIN * 2)

    headline_lines = wrap_lines(headline.upper(), headline_font, max_width, draw)
    subtext_lines = wrap_lines(subtext, subtext_font, max_width, draw) if subtext else []

    total_height = (len(headline_lines) * HEADLINE_SIZE * 1.15) + \
                   (len(subtext_lines) * SUBTEXT_SIZE * 1.3) + 40
    y = (CANVAS_SIZE[1] - total_height) / 2

    for line in headline_lines:
        w = draw.textlength(line, font=headline_font)
        draw.text(((CANVAS_SIZE[0] - w) / 2, y), line, font=headline_font, fill=TEXT_COLOR)
        y += HEADLINE_SIZE * 1.15

    y += 20
    for line in subtext_lines:
        w = draw.textlength(line, font=subtext_font)
        draw.text(((CANVAS_SIZE[0] - w) / 2, y), line, font=subtext_font, fill=SUBTEXT_COLOR)
        y += SUBTEXT_SIZE * 1.3

    img.save(output_path, quality=92)


def run(queue_path, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    count = 0

    with open(queue_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            headline = row.get("headline", "").strip()
            subtext = row.get("subtext", "").strip()
            date = row.get("date", "").strip() or f"item{i}"

            if not headline:
                continue

            filename = f"{date}-{i}.jpg".replace(" ", "-").replace("/", "-")
            output_path = os.path.join(output_dir, filename)
            make_slide(headline, subtext, output_path)
            print(f"Made {output_path}")
            count += 1

    print(f"\n{count} graphics generated in {output_dir}/")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("Usage: python3 content_engine.py queue.csv output/")
        sys.exit(1)
    run(sys.argv[1], sys.argv[2])
```

Change `BG_COLOR` and `ACCENT_COLOR` to your own brand's values before running this for real.

## Step 2. Build your content queue

Create `queue.csv` in the same folder, three columns:

```csv
date,headline,subtext
2026-08-03,Your AC dies in July not us,Same-day service across the Upstate
2026-08-04,One storm one roof done right,Licensed roofing insurance paperwork handled
2026-08-05,Stop guessing what your neighbors pay,Free market teardown 15 minutes
```

One row per post. `subtext` can be blank, `date` becomes part of the filename so your output folder sorts itself into calendar order automatically.

## Step 3. Run it

```
python3 content_engine.py queue.csv output/
```

## Step 4. Check the output

Open the `output/` folder. One image per row, named by date, ready to drag into whatever you post with, including guide 24 if you build it.

---

## Verify it works

- [ ] The output folder contains exactly one image per non-empty row in the CSV
- [ ] Filenames sort in the same order as the dates in the spreadsheet
- [ ] A row with no `subtext` still renders correctly, just without a subline
- [ ] A long headline wraps onto multiple lines and stays centered, same as guide 22
- [ ] Running it twice on the same queue overwrites the same files rather than duplicating them

---

## What breaks and how to fix it

**"No such file or directory: Anton-Regular.ttf"**
The font file needs to sit next to `content_engine.py`, not inside `output/` and not inside wherever `queue.csv` lives if that is a different folder.

**Some rows silently produce nothing**
Blank `headline` cells are skipped on purpose, check for rows where that column is genuinely empty, often a trailing comma issue from editing the CSV in a spreadsheet app that adds extra empty columns.

**Text looks vertically off-center when a row has no subtext**
This is expected, the layout math accounts for zero subtext lines correctly, but a headline-only slide will sit slightly higher than a slide with both, since the total content block is shorter. Not a bug, a visual side effect of centering a shorter block.

**CSV opens fine in a text editor but the script errors on it**
Almost always an encoding issue from saving out of Excel. Re-save as CSV UTF-8 specifically, not plain CSV, if your spreadsheet tool offers that option.

**Colors do not match your actual brand once printed or viewed on a different screen**
RGB values render slightly differently across displays. Treat the constants at the top as a starting point, adjust by eye against your actual logo files, not just the numbers.

---

## What to do next

Go to **23. Free Reel Scripts for Life**. The system is content by number, this is content by structure.

---

## Sources to verify yourself

- Pillow documentation: `https://pillow.readthedocs.io/`
- Python's built-in `csv` module: `https://docs.python.org/3/library/csv.html`
