"""Build a map-coordinate ocean-current texture for the Europe campaign view."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "map-relief" / "europe-dem-relief.webp"
OUT = ROOT / "assets" / "map-relief" / "europe-ocean-currents.webp"
SIZE = (2600, 2425)


def curve(points, steps=96):
    result = []
    for index in range(steps + 1):
        t = index / steps
        u = 1 - t
        x = u**3 * points[0][0] + 3 * u*u*t * points[1][0] + 3 * u*t*t * points[2][0] + t**3 * points[3][0]
        y = u**3 * points[0][1] + 3 * u*u*t * points[1][1] + 3 * u*t*t * points[2][1] + t**3 * points[3][1]
        result.append((round(x), round(y)))
    return result


def points(values):
    return [(round(x * SIZE[0]), round(y * SIZE[1])) for x, y in values]


lines = [
    [(0.00, .30), (.10, .22), (.18, .31), (.22, .41)],
    [(.00, .36), (.10, .28), (.17, .38), (.21, .48)],
    [(.04, .48), (.12, .39), (.19, .47), (.26, .58)],
    [(.10, .62), (.17, .54), (.22, .63), (.29, .72)],
    [(.25, .18), (.31, .12), (.36, .15), (.40, .24)],
    [(.30, .28), (.35, .23), (.39, .28), (.43, .36)],
    [(.38, .42), (.45, .37), (.51, .43), (.54, .51)],
    [(.42, .61), (.49, .55), (.55, .59), (.60, .67)],
    [(.58, .71), (.65, .65), (.72, .69), (.79, .77)],
    [(.65, .34), (.72, .27), (.79, .33), (.86, .43)],
    [(.70, .47), (.77, .40), (.85, .47), (.93, .56)],
    [(.75, .18), (.81, .12), (.88, .17), (.96, .25)],
]

base = Image.new("RGBA", SIZE, (0, 0, 0, 0))
glow = Image.new("RGBA", SIZE, (0, 0, 0, 0))
draw = ImageDraw.Draw(base)
glow_draw = ImageDraw.Draw(glow)
for index, item in enumerate(lines):
    path = curve(points(item))
    draw.line(path, fill=(103, 196, 186, 46 if index % 3 else 58), width=2, joint="curve")
    glow_draw.line(path, fill=(51, 154, 165, 45), width=9, joint="curve")

for cx, cy, radius in [(0.15, .36, .048), (.48, .51, .042), (.78, .42, .055), (.61, .72, .04)]:
    center_x, center_y = round(cx * SIZE[0]), round(cy * SIZE[1])
    for inset in range(0, 4):
        box = (center_x - radius * SIZE[0] + inset * 24, center_y - radius * SIZE[0] + inset * 24, center_x + radius * SIZE[0] - inset * 24, center_y + radius * SIZE[0] - inset * 24)
        draw.arc(tuple(round(value) for value in box), 208, 498, fill=(114, 204, 191, 38), width=2)
        glow_draw.arc(tuple(round(value) for value in box), 208, 498, fill=(50, 156, 165, 32), width=8)

base = Image.alpha_composite(glow.filter(ImageFilter.GaussianBlur(7)), base)
with Image.open(SOURCE) as relief:
    land_alpha = relief.convert("RGBA").getchannel("A").resize(SIZE, Image.Resampling.LANCZOS)
current_alpha = base.getchannel("A")
water_alpha = Image.eval(land_alpha, lambda value: 255 - value)
current_alpha = Image.composite(current_alpha, Image.new("L", SIZE, 0), water_alpha)
base.putalpha(current_alpha)
OUT.parent.mkdir(parents=True, exist_ok=True)
base.save(OUT, "WEBP", quality=88, method=6)
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")