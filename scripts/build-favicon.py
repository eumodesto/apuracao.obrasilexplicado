"""Generate src/app/favicon.ico (16/32/48) as a simplified Brazil silhouette.
The detailed artwork stays in icon.png and apple-icon.png; at tab sizes its 3D
layers turn to mush, so this draws the outline from data/geography/br-ufs.geojson.
Requires Pillow and ImageMagick (`convert`), since Next fails to decode Pillow's ICO.
"""
import json, math, pathlib, subprocess, tempfile
from PIL import Image, ImageDraw, ImageFilter

GREEN, YELLOW, BLUE = (22, 163, 74, 255), (255, 196, 0, 255), (21, 101, 216, 255)
# Border widths in final pixels: (yellow, blue). 16px drops the blue to stay legible.
SPEC = {16: (1.2, 0), 32: (1.6, 1.3), 48: (2.2, 1.7)}
SUPERSAMPLE = 16

geojson = json.loads(pathlib.Path('data/geography/br-ufs.geojson').read_text())
rings = []
for feature in geojson['features']:
    geometry = feature['geometry']
    polygons = geometry['coordinates'] if geometry['type'] == 'MultiPolygon' else [geometry['coordinates']]
    rings.extend(polygon[0] for polygon in polygons)

k = math.cos(math.radians(15))
points = [(x * k, -y) for ring in rings for x, y in ring]
minx, maxx = min(p[0] for p in points), max(p[0] for p in points)
miny, maxy = min(p[1] for p in points), max(p[1] for p in points)

def dilate(mask, radius):
    if not radius:
        return mask
    return mask.filter(ImageFilter.GaussianBlur(radius)).point(lambda v: 255 if v > 8 else 0)

with tempfile.TemporaryDirectory() as tmp:
    frames = []
    for size, (yellow, blue) in SPEC.items():
        n = size * SUPERSAMPLE
        border = (yellow + blue) * SUPERSAMPLE
        scale = (n - 2 * border - SUPERSAMPLE * 0.3) / max(maxx - minx, maxy - miny)
        ox, oy = (n - (maxx - minx) * scale) / 2, (n - (maxy - miny) * scale) / 2
        mask = Image.new('L', (n, n), 0)
        draw = ImageDraw.Draw(mask)
        for ring in rings:
            draw.polygon([(ox + (x * k - minx) * scale, oy + (-y - miny) * scale) for x, y in ring], fill=255)
        mask = mask.filter(ImageFilter.MaxFilter(5))  # closes slivers between states
        image = Image.new('RGBA', (n, n), (0, 0, 0, 0))
        image.paste(BLUE, (0, 0), dilate(mask, (yellow + blue) * SUPERSAMPLE * 0.55))
        image.paste(YELLOW, (0, 0), dilate(mask, yellow * SUPERSAMPLE * 0.55))
        image.paste(GREEN, (0, 0), mask)
        frame = pathlib.Path(tmp, f'{size}.png')
        image.resize((size, size), Image.LANCZOS).save(frame)
        frames.append(str(frame))
    subprocess.run(['convert', *frames, 'src/app/favicon.ico'], check=True)
print('wrote src/app/favicon.ico')
