"""
Genera los PNG del manifest a partir del mismo diseño que icons/icon.svg.

Sin dependencias: solo zlib y struct de la librería estándar. Se rasteriza con
funciones de distancia con signo (SDF) y supermuestreo 3x3 para el antialiasing.

Uso:  python tools/make_icons.py
"""

import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

# ---------------------------------------------------------------- SDF ----


def sd_rounded_rect(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - hw + r
    qy = abs(py - cy) - hh + r
    outside = math.hypot(max(qx, 0.0), max(qy, 0.0))
    return min(max(qx, qy), 0.0) + outside - r


def sd_segment(px, py, ax, ay, bx, by):
    pax, pay = px - ax, py - ay
    bax, bay = bx - ax, by - ay
    denom = bax * bax + bay * bay
    t = 0.0 if denom == 0 else max(0.0, min(1.0, (pax * bax + pay * bay) / denom))
    return math.hypot(pax - bax * t, pay - bay * t)


def sd_circle(px, py, cx, cy, r):
    return math.hypot(px - cx, py - cy) - r


# ------------------------------------------------------------ composición --


def over(dst, src, alpha):
    """Mezcla `src` sobre `dst` con cobertura `alpha` (source-over)."""
    if alpha <= 0:
        return dst
    sr, sg, sb, sa = src
    a = sa * alpha
    if a <= 0:
        return dst
    dr, dg, db, da = dst
    out_a = a + da * (1 - a)
    if out_a == 0:
        return (0.0, 0.0, 0.0, 0.0)
    return (
        (sr * a + dr * da * (1 - a)) / out_a,
        (sg * a + dg * da * (1 - a)) / out_a,
        (sb * a + db * da * (1 - a)) / out_a,
        out_a,
    )


def hexrgb(s):
    s = s.lstrip("#")
    return (int(s[0:2], 16) / 255, int(s[2:4], 16) / 255, int(s[4:6], 16) / 255)


def lerp(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# El diseño está definido en un lienzo de 512x512, igual que el SVG.
BARS = [
    (104, 286, 46, 122, "#fb7185", 0.85),
    (176, 238, 46, 170, "#5b8cff", 0.55),
    (248, 300, 46, 108, "#fb7185", 0.85),
    (320, 196, 46, 212, "#34d399", 0.90),
]
LINE = [(104, 268), (176, 216), (248, 236), (320, 150), (392, 108)]

BG_A, BG_B = hexrgb("#2b3446"), hexrgb("#12151c")
LINE_A, LINE_B = hexrgb("#5b8cff"), hexrgb("#34d399")


def shade(x, y, radius, inset, fg_scale=1.0):
    """
    Color del punto (x, y) del lienzo 512x512.

    `fg_scale` encoge el dibujo (barras y línea) respecto al centro sin tocar el
    fondo: es lo que permite meter el contenido en la zona segura del maskable.
    """
    px = (0.0, 0.0, 0.0, 0.0)

    # Fondo redondeado con degradado diagonal.
    d = sd_rounded_rect(x, y, 256, 256, 256 - inset, 256 - inset, radius)
    cov = max(0.0, min(1.0, 0.5 - d))
    if cov > 0:
        t = max(0.0, min(1.0, (x + y) / 1024))
        px = over(px, lerp(BG_A, BG_B, t) + (1.0,), cov)
    else:
        return px  # fuera del icono: nada que dibujar encima

    # A partir de aquí trabajamos en coordenadas del dibujo.
    if fg_scale != 1.0:
        x = (x - 256) / fg_scale + 256
        y = (y - 256) / fg_scale + 256

    # Barras.
    for bx, by, bw, bh, color, alpha in BARS:
        d = sd_rounded_rect(x, y, bx + bw / 2, by + bh / 2, bw / 2, bh / 2, 14)
        c = max(0.0, min(1.0, 0.5 - d))
        if c > 0:
            px = over(px, hexrgb(color) + (alpha,), c)

    # Línea de tendencia (cápsulas con degradado a lo largo del recorrido).
    best = 1e9
    for (ax, ay), (bx2, by2) in zip(LINE, LINE[1:]):
        best = min(best, sd_segment(x, y, ax, ay, bx2, by2) - 10)
    c = max(0.0, min(1.0, 0.5 - best))
    if c > 0:
        t = max(0.0, min(1.0, (x - 104) / (392 - 104)))
        px = over(px, lerp(LINE_A, LINE_B, t) + (1.0,), c)

    # Punto final.
    c = max(0.0, min(1.0, 0.5 - sd_circle(x, y, 392, 108, 18)))
    if c > 0:
        px = over(px, hexrgb("#34d399") + (1.0,), c)

    return px


def render(size, radius=114, inset=0, fg_scale=1.0, ss=3):
    """Rasteriza a `size`x`size` con supermuestreo `ss`x`ss`."""
    scale = 512 / size
    rows = []
    inv = 1.0 / (ss * ss)
    for py in range(size):
        row = bytearray()
        for pxi in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(ss):
                for sx in range(ss):
                    x = (pxi + (sx + 0.5) / ss) * scale
                    y = (py + (sy + 0.5) / ss) * scale
                    r, g, b, a = shade(x, y, radius, inset, fg_scale)
                    acc[0] += r * a
                    acc[1] += g * a
                    acc[2] += b * a
                    acc[3] += a
            a = acc[3] * inv
            if a > 0:
                # Los canales se acumulan premultiplicados; se deshace al final.
                r, g, b = (acc[i] * inv / a for i in range(3))
            else:
                r = g = b = 0.0
            row += bytes(
                (
                    int(max(0, min(255, round(r * 255)))),
                    int(max(0, min(255, round(g * 255)))),
                    int(max(0, min(255, round(b * 255)))),
                    int(max(0, min(255, round(a * 255)))),
                )
            )
        rows.append(row)
    return rows


# ------------------------------------------------------------------ PNG --


def write_png(path, rows):
    size = len(rows)
    raw = b"".join(b"\x00" + bytes(r) for r in rows)  # filtro 0 en cada scanline

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)
    print(f"  {path.name}  ({size}x{size}, {len(png) / 1024:.1f} KB)")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    print("Generando iconos en", OUT)

    write_png(OUT / "icon-192.png", render(192))
    write_png(OUT / "icon-512.png", render(512))
    # Maskable: el lanzador puede recortar el icono con cualquier forma. El
    # fondo se lleva a sangre (sin esquinas redondeadas, que ya las pone el
    # sistema) y el dibujo se encoge para caber en la zona segura central.
    write_png(OUT / "icon-maskable.png", render(512, radius=0, inset=-64, fg_scale=0.72))

    print("Listo.")
