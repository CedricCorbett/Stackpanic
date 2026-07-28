# 22. Free Thumbnails for Life

**Time: 45 minutes. Cost: $0. Code: Python.**

A photo and a headline in, a scroll-stopping thumbnail out. Every time, the same look.

---

## What you get

Run one command with a photo and a headline, get back a properly cropped, correctly sized image with bold white text over a dark readable bar at the bottom, the same visual pattern every high-performing thumbnail in your feed already uses.

---

## What it replaces

| Tool | Cost | The catch |
|---|---|---|
| Canva Pro | $13 to $20 per month | Paying monthly for a template you could script once |
| Photoshop | $23 per month | Massive overkill for one repeated task |

---

## What is actually free and what is not

Entirely free. Pillow is an open-source Python imaging library, no license fee, no watermark, no export limit.

---

## Prerequisites

- Python 3 installed, `python3 --version` to check
- A free font. Anton is a strong, heavy, highly legible choice for this exact use, download it at `https://fonts.google.com/specimen/Anton`, unzip it, and keep `Anton-Regular.ttf` in the same folder as the script below.

---

## Step 1. Install Pillow

```
pip install Pillow
```

If that fails with an "externally managed environment" error, a increasingly common lockdown on newer systems, add the override flag:

```
pip install Pillow --break-system-packages
```

## Step 2. Save the script

```python
#!/usr/bin/env python3
"""
Free Thumbnails for Life
Turn a photo and a headline into a scroll-stopping thumbnail.

Usage:
    python3 make_thumbnail.py photo.jpg "YOUR AC IS ABOUT TO DIE" output.jpg
"""

import sys
from PIL import Image, ImageDraw, ImageFont

CANVAS_SIZE = (1080, 1350)  # 4:5, works for feed posts and most reel covers
FONT_PATH = "Anton-Regular.ttf"
FONT_SIZE = 96
BAR_OPACITY = 160  # 0 to 255, higher is more opaque
MARGIN = 60


def wrap_text(text, font, max_width, draw):
    words = text.split()
    lines = []
    current = ""
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


def make_thumbnail(photo_path, headline, output_path):
    img = Image.open(photo_path).convert("RGB")

    # Crop to the target aspect ratio first, centered, then resize.
    target_ratio = CANVAS_SIZE[0] / CANVAS_SIZE[1]
    w, h = img.size
    if (w / h) > target_ratio:
        new_w = int(h * target_ratio)
        left = (w - new_w) // 2
        img = img.crop((left, 0, left + new_w, h))
    else:
        new_h = int(w / target_ratio)
        top = (h - new_h) // 2
        img = img.crop((0, top, w, top + new_h))
    img = img.resize(CANVAS_SIZE, Image.LANCZOS).convert("RGBA")

    # Text and the bar behind it get drawn on a separate transparent
    # layer, then composited on top. Drawing a semi-transparent fill
    # straight onto an RGB image does not blend correctly, this is
    # the correct way to do it in Pillow.
    overlay = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(FONT_PATH, FONT_SIZE)

    max_text_width = CANVAS_SIZE[0] - (MARGIN * 2)
    lines = wrap_text(headline.upper(), font, max_text_width, draw)

    line_height = FONT_SIZE * 1.15
    block_height = len(lines) * line_height + MARGIN
    bar_top = CANVAS_SIZE[1] - block_height - MARGIN

    draw.rectangle([(0, bar_top), (CANVAS_SIZE[0], CANVAS_SIZE[1])], fill=(0, 0, 0, BAR_OPACITY))

    y = bar_top + (MARGIN / 2)
    for line in lines:
        line_width = draw.textlength(line, font=font)
        x = (CANVAS_SIZE[0] - line_width) / 2
        draw.text((x, y), line, font=font, fill=(255, 255, 255, 255))
        y += line_height

    final = Image.alpha_composite(img, overlay).convert("RGB")
    final.save(output_path, quality=92)
    print(f"Saved {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print('Usage: python3 make_thumbnail.py photo.jpg "HEADLINE TEXT" output.jpg')
        sys.exit(1)
    make_thumbnail(sys.argv[1], sys.argv[2], sys.argv[3])
```

Save it as `make_thumbnail.py`, in the same folder as `Anton-Regular.ttf` and whatever source photo you are starting from.

## Step 3. Run it

```
python3 make_thumbnail.py photo.jpg "YOUR AC IS ABOUT TO DIE" output.jpg
```

Open `output.jpg`.

---

## Verify it works

- [ ] The output image is exactly 1080 by 1350 pixels, regardless of the source photo's original size or shape
- [ ] Long headlines wrap onto multiple lines instead of running off the edge
- [ ] The dark bar behind the text is genuinely semi-transparent, you can still see the photo through it, not a solid black block
- [ ] A short headline and a long headline both look correctly positioned, the bar height adjusts to fit

---

## What breaks and how to fix it

**"cannot open resource" or a font-related error**
`Anton-Regular.ttf` is not in the same folder as the script, or was renamed during download. Check the exact filename matches `FONT_PATH`.

**The dark bar is fully opaque, no photo visible through it at all**
Almost certainly the compositing step was skipped or edited, drawing straight onto the RGB image instead of a separate RGBA overlay composited afterward. Re-check that block matches exactly, this is the one part of this script where a shortcut breaks the visual entirely.

**Text runs off the right edge**
`wrap_text()` was skipped or its `max_width` argument is wrong. It should equal the canvas width minus both margins, not the full canvas width.

**Output looks stretched or squished**
The source photo's crop math got altered. The crop-before-resize order matters, resizing an oddly shaped crop directly to `CANVAS_SIZE` without cropping to the right ratio first is what causes stretching.

**"externally managed environment" pip error**
Covered in step 1, add `--break-system-packages` to the install command.

---

## What to do next

Two guides left worth naming here: **21, Free Content Engine for Life**, and **23, Free Reel Scripts for Life**, both close cousins of this one. Those are next.

---

## Sources to verify yourself

- Pillow documentation: `https://pillow.readthedocs.io/`
- Anton font, open license: `https://fonts.google.com/specimen/Anton`
