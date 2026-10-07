import base64
import io
import json
import math
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "/System/Library/Fonts/HelveticaNeue.ttc"
BOLD = 1
SCALE = 2
fonts = {}


def font(size):
    if size not in fonts:
        fonts[size] = ImageFont.truetype(FONT_PATH, size, index=BOLD)
    return fonts[size]


def advances(face, text, tracking):
    widths = []
    previous = 0.0
    for i in range(len(text)):
        current = face.getlength(text[: i + 1])
        widths.append(current - previous + tracking)
        previous = current
    return widths


def measure(face, text, tracking):
    return sum(advances(face, text, tracking)) - (tracking if text else 0)


def wrap(face, text, limit, tracking):
    lines = []
    line = ""
    for word in text.split():
        candidate = f"{line} {word}" if line else word
        if line and measure(face, candidate, tracking) > limit:
            lines.append(line)
            line = word
        else:
            line = candidate
    if line:
        lines.append(line)
    return lines or [""]


def hex_color(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4)) + (255,)


def render(job):
    cell_w = job["cellW"] * SCALE
    cell_h = job["cellH"] * SCALE
    size = round(job["fontPx"] * SCALE)
    face = font(size)
    tracking = job.get("tracking", 0) * size
    box = job["rows"] * cell_h
    limit = job["maxCols"] * cell_w
    lines = wrap(face, job["text"], limit, tracking)
    width = max(measure(face, line, tracking) for line in lines)
    cols = max(1, math.ceil((width + size * 0.08) / cell_w))
    image = Image.new("RGBA", (cols * cell_w, box * len(lines)), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    color = hex_color(job["color"])
    for row, line in enumerate(lines):
        x = 0.0
        y = row * box + box / 2
        for char, advance in zip(line, advances(face, line, tracking)):
            draw.text((x, y), char, font=face, fill=color, anchor="lm")
            x += advance
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    data = buffer.getvalue()
    return {
        "key": job["key"],
        "data": base64.b64encode(data).decode(),
        "size": len(data),
        "cols": cols,
        "rows": job["rows"] * len(lines),
    }


for raw in sys.stdin:
    try:
        reply = render(json.loads(raw))
    except Exception as error:
        reply = {"key": json.loads(raw).get("key"), "error": str(error)}
    sys.stdout.write(json.dumps(reply) + "\n")
    sys.stdout.flush()
