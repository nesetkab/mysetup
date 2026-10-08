import os
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

LEFT = 0x100000
RIGHT = 0x100001
CELL = 600
PIXEL_WIDTH = 75
OVERLAP = 20
PIXEL_HEIGHT = 130
BOTTOM = 30
ROWS = [
    "  ############  ",
    "  ## ###### ##  ",
    "################",
    "  ############  ",
    "   # #    # #   ",
]


def runs(row):
    start = None
    for x, cell in enumerate(row + " "):
        if cell == "#" and start is None:
            start = x
        elif cell != "#" and start is not None:
            yield start, x
            start = None


def draw(columns, offset, reach):
    pen = TTGlyphPen(None)
    for index, row in enumerate(row[columns] for row in ROWS):
        top = BOTTOM + (len(ROWS) - index) * PIXEL_HEIGHT
        bottom = top - PIXEL_HEIGHT
        for start, end in runs(row):
            left, right = offset + start * PIXEL_WIDTH, offset + end * PIXEL_WIDTH
            if start == 0:
                left -= reach[0]
            if end == len(row):
                right += reach[1]
            pen.moveTo((left, bottom))
            pen.lineTo((left, top))
            pen.lineTo((right, top))
            pen.lineTo((right, bottom))
            pen.closePath()
    return pen.glyph()


def build(path):
    builder = FontBuilder(1000, isTTF=True)
    half = len(ROWS[0]) // 2
    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "clawd.left": draw(slice(0, half), CELL - half * PIXEL_WIDTH, (0, OVERLAP)),
        "clawd.right": draw(slice(half, None), 0, (OVERLAP, 0)),
    }
    builder.setupGlyphOrder(list(glyphs))
    builder.setupCharacterMap({LEFT: "clawd.left", RIGHT: "clawd.right"})
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics({name: (CELL, 0) for name in glyphs})
    builder.setupHorizontalHeader(ascent=1020, descent=-300)
    builder.setupNameTable({"familyName": "Clawd", "styleName": "Regular", "fullName": "Clawd Regular", "psName": "Clawd-Regular", "uniqueFontIdentifier": "Clawd-Regular", "version": "Version 1.000"})
    builder.setupOS2(sTypoAscender=1020, sTypoDescender=-300, usWinAscent=1020, usWinDescent=300, sxHeight=550, sCapHeight=730, xAvgCharWidth=600)
    builder.setupPost()
    staging = path.with_suffix(".tmp")
    builder.save(staging)
    os.replace(staging, path)


if __name__ == "__main__":
    build(Path(__file__).with_name("Clawd.ttf"))
