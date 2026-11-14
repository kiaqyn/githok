"""Build GitHok's original parametric vector sculpture and paper texture.

No raster inputs, external assets or models are used. The surface is a warped
toroid, lit and depth-sorted before emitting a compact, script-free SVG.
"""
from pathlib import Path
import math
import random

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'art'
ROOT.mkdir(parents=True, exist_ok=True)
TAU = math.tau


def rotate(p):
    x, y, z = p
    a = math.radians(53)
    y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
    a = math.radians(-23)
    x, z = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
    a = math.radians(-27)
    return x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z


def surface(u, v):
    radius = 1.38 + .13 * math.cos(3 * u)
    tube = .53 + .06 * math.sin(2 * u)
    return rotate(((radius + tube * math.cos(v)) * math.cos(u),
                   (radius + tube * math.cos(v)) * math.sin(u),
                   tube * math.sin(v) + .28 * math.sin(2 * u)))


def project(p):
    scale = 148 * 7 / (7 - p[2])
    return (340 + p[0] * scale, 325 - p[1] * scale)


def normal(u, v):
    p = surface(u, v)
    a, b = surface(u + .001, v), surface(u, v + .001)
    a = [a[i] - p[i] for i in range(3)]
    b = [b[i] - p[i] for i in range(3)]
    n = (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])
    length = math.sqrt(sum(t * t for t in n))
    return tuple(t / length for t in n)


def lit(u, v):
    n = normal(u, v)
    light = (-.45, .65, .61)
    diffuse = max(0, sum(n[i] * light[i] for i in range(3)))
    specular = max(0, -.23 * n[0] + .36 * n[1] + .9 * n[2]) ** 28
    base = (239, 92, 49)
    rgb = [max(0, min(255, round(c * (.30 + .66 * diffuse) + 160 * specular))) for c in base]
    return '#%02x%02x%02x' % tuple(rgb)


elements = []
nu, nv = 112, 28
for i in range(nu):
    for j in range(nv):
        u, v = i * TAU / nu, j * TAU / nv
        du, dv = TAU / nu, TAU / nv
        points = [surface(u, v), surface(u + du, v), surface(u + du, v + dv), surface(u, v + dv)]
        coords = [project(p) for p in points]
        path = 'M' + 'L'.join(f'{x:.1f},{y:.1f}' for x, y in coords) + 'Z'
        color = lit(u + du / 2, v + dv / 2)
        depth = sum(p[2] for p in points) / 4
        elements.append((depth, f'<path d="{path}" fill="{color}" stroke="{color}" stroke-width=".45"/>'))
        # Fine contour engraving follows the tube; depth sorting occludes hidden lines.
        a, b = coords[0], coords[1]
        edge = f'M{a[0]:.1f},{a[1]:.1f}L{b[0]:.1f},{b[1]:.1f}'
        elements.append(((points[0][2] + points[1][2]) / 2 + .001,
                         f'<path d="{edge}" fill="none" stroke="#411b13" stroke-opacity=".27" stroke-width=".55"/>'))

sculpture = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 680" fill="none">'
sculpture += '<defs><radialGradient id="shadow"><stop stop-color="#48372c" stop-opacity=".17"/><stop offset="1" stop-color="#48372c" stop-opacity="0"/></radialGradient></defs>'
sculpture += '<ellipse cx="354" cy="577" rx="231" ry="31" fill="url(#shadow)"/>'
sculpture += '<ellipse cx="340" cy="325" rx="307" ry="259" transform="rotate(-27 340 325)" stroke="#8d8174" stroke-opacity=".26" stroke-width=".8"/>'
sculpture += ''.join(markup for _, markup in sorted(elements, key=lambda t: t[0]))
sculpture += '<circle cx="571" cy="177" r="5" fill="#213baf"/><circle cx="571" cy="177" r="12" stroke="#213baf" stroke-opacity=".2"/>'
sculpture += '</svg>'
(ROOT / 'orbit-v1.svg').write_text(sculpture, encoding='utf-8')

rng = random.Random(417)
grain = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">'
for _ in range(210):
    grain += f'<circle cx="{rng.uniform(0,180):.1f}" cy="{rng.uniform(0,180):.1f}" r="{rng.uniform(.15,.42):.2f}" fill="#3a342b" opacity="{rng.uniform(.03,.08):.3f}"/>'
grain += '</svg>'
(ROOT / 'paper-v1.svg').write_text(grain, encoding='utf-8')
print(f'Built orbit-v1.svg ({len(sculpture):,} characters) and paper-v1.svg.')
