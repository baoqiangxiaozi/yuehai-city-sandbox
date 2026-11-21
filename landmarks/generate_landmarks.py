# -*- coding: utf-8 -*-
"""Rebuild every named Yuehai landmark as an editable Blender mesh.

Run (headless, no GUI):

    /opt/yh/bpyenv/bin/python landmarks/generate_landmarks.py
    ONLY=tencent-binhai /opt/yh/bpyenv/bin/python landmarks/generate_landmarks.py

Coordinates: metres, Blender Z-up. X = sandbox raw east, Y = negative raw
south, origin on the ground at the landmark centroid. The glTF / inline
export converts to Y-up (X east, Y height, Z south) exactly once.
China Resources is NOT regenerated: landmarks/assets/china-resources.* from
the checked legacy generator are kept and only re-validated.

This is an architectural reading for a city model, not a survey, BIM or
measured reconstruction. Every height that is not the OSM value is listed
in the written manifest with the source. Plan shapes follow the OSM
footprint unless the manifest says the plan is approximate.
"""
import bpy, bmesh, math, json, os, struct, base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_PATH = Path(os.environ.get('YUEHAI_OSM', ROOT.parent / 'data' / 'yuehai-osm.json'))
OUT = ROOT / 'assets'
OUT.mkdir(exist_ok=True)
PLAN, HS = 0.058, 0.112
TAU = math.tau

# color, metalness, roughness, night
MATS = {
    'glass': ('#8ea6a8', 0.42, 0.24, False),
    'glass_alt': ('#6e908a', 0.36, 0.28, False),
    'metal': ('#c2cac3', 0.82, 0.30, False),
    'bronze': ('#8d6a3e', 0.70, 0.36, False),
    'stone': ('#3c4b42', 0.04, 0.84, False),
    'roof': ('#18241e', 0.22, 0.68, False),
    'dark': ('#4a4036', 0.48, 0.46, False),
    'white': ('#e4ebe6', 0.12, 0.38, False),
    'night': ('#2a2418', 0.05, 0.45, True),
}

# Published heights that replace a bad OSM value. OSM value stays in the note.
HEIGHT = {
    462: (181.0, '百度百科/悉地国际：东塔约180–181m、地上39层；OSM 12.8m 是占位'),
    463: (160.0, '百度百科：西塔地上约160m、33层；OSM 12.8m 是占位'),
    880: (273.0, '沿用页面已采用的官方口径 273m/57层；OSM 为 314m/62层'),
    2404: (24.0, 'OSM 3.2m 为损坏值；沿用页面的 24m，待用户核对'),
}


def rgba(h):
    v = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in v) + (1,)


def reset(col_name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.save_version = 0
    col = bpy.data.collections.new(col_name)
    bpy.context.scene.collection.children.link(col)
    for name, (color, metal, rough, night) in MATS.items():
        m = bpy.data.materials.new(name)
        m.diffuse_color = rgba(color)
        m.use_nodes = True
        p = m.node_tree.nodes.get('Principled BSDF')
        p.inputs['Base Color'].default_value = rgba(color)
        p.inputs['Metallic'].default_value = metal
        p.inputs['Roughness'].default_value = rough
        if night:
            p.inputs['Emission Color'].default_value = (1, 0.64, 0.27, 1)
            p.inputs['Emission Strength'].default_value = 0.25
    return col


class Builder:
    def __init__(self):
        self.parts = {}

    def face(self, key, verts):
        p, f = self.parts.setdefault(key, ([], []))
        n = len(p)
        p.extend(verts)
        f.append(tuple(range(n, n + len(verts))))

    def box(self, key, c, size, xf=None):
        x, y, z = c
        a, b, h = (max(0.05, v) / 2 for v in size)
        pts = [(x + u * a, y + v * b, z + w * h) for u, v, w in (
            (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
            (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
        if xf:
            pts = [xf(p) for p in pts]
        for q in ((3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
            self.face(key, [pts[i] for i in q])

    def finish(self, col):
        obs = []
        for key, (vs, fs) in self.parts.items():
            if not fs:
                continue
            role, mat = key.split(':')
            me = bpy.data.meshes.new(role)
            me.from_pydata(vs, [], fs)
            me.update()
            bm = bmesh.new()
            bm.from_mesh(me)
            bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
            bm.to_mesh(me)
            bm.free()
            me.update()
            ob = bpy.data.objects.new(role, me)
            col.objects.link(ob)
            me.materials.append(bpy.data.materials[mat])
            ob['role'] = role
            ob['material_key'] = mat
            obs.append(ob)
        return obs


def ring_of(b):
    p = b['p']
    ring = list(zip(p[::2], p[1::2]))
    if len(ring) >= 2 and abs(ring[0][0] - ring[-1][0]) < 1e-6 and abs(ring[0][1] - ring[-1][1]) < 1e-6:
        ring = ring[:-1]
    return ring


def obb(b):
    ring = ring_of(b)
    best = None
    for i, a in enumerate(ring):
        bb = ring[(i + 1) % len(ring)]
        ang = math.atan2(bb[1] - a[1], bb[0] - a[0])
        c, s = math.cos(-ang), math.sin(-ang)
        xs = [x * c - z * s for x, z in ring]
        zs = [x * s + z * c for x, z in ring]
        w, d = max(xs) - min(xs), max(zs) - min(zs)
        if best is None or w * d < best[0]:
            best = (w * d, ang, w, d, (max(xs) + min(xs)) / 2, (max(zs) + min(zs)) / 2)
    _, ang, w, d, lx, lz = best
    if w < d:
        w, d = d, w
        ang += math.pi / 2
    return dict(
        cx=lx * math.cos(ang) - lz * math.sin(ang),
        cz=lx * math.sin(ang) + lz * math.cos(ang),
        w=w, d=d, angle=ang, height=float(b['height']),
        levels=b.get('levels'), name=b.get('n') or '', pts=len(ring), ring=ring)


def bl(x, z, origin):
    return (x - origin[0], -(z - origin[1]))


def frame_xf(spec, origin):
    ang = spec['angle']
    c, s = math.cos(ang), math.sin(ang)
    cx, cz = spec['cx'], spec['cz']

    def xf(p):
        x, y, z = p
        return (*bl(cx + x * c - y * s, cz + x * s + y * c, origin), z)
    return xf


def extrude(B, key, ring, z0, z1, origin, taper=1.0):
    n = len(ring)
    cx = sum(x for x, _ in ring) / n
    cz = sum(z for _, z in ring) / n

    def conv(x, z, zz, k):
        return (*bl(cx + (x - cx) * k, cz + (z - cz) * k, origin), zz)
    a = [conv(x, z, z0, 1) for x, z in ring]
    b = [conv(x, z, z1, taper) for x, z in ring]
    B.face(key, a[::-1])
    B.face(key, b)
    for i in range(n):
        j = (i + 1) % n
        B.face(key, [a[i], a[j], b[j], b[i]])


def span_xf(origin, a, b):
    ax, ay = bl(a['cx'], a['cz'], origin)
    bx, by = bl(b['cx'], b['cz'], origin)
    dx, dy = bx - ax, by - ay
    dist = math.hypot(dx, dy) or 1.0
    ux, uy = dx / dist, dy / dist
    sx, sy = -uy, ux
    mx, my = (ax + bx) / 2, (ay + by) / 2

    def xf(p):
        x, y, z = p
        return (mx + ux * x + sx * y, my + uy * x + sy * y, z)
    return xf, dist


def add_span(B, key, origin, a, b, z0, z1, width, extra):
    xf, dist = span_xf(origin, a, b)
    B.box(key, (0, 0, (z0 + z1) / 2), (dist + extra, width, max(2.0, z1 - z0)), xf)
    return xf, dist


def rounded_ring(w, d, rad, segs=3):
    rad = min(rad, w * 0.45, d * 0.45)
    hw, hd = w / 2, d / 2
    ring = []
    corners = ((hw - rad, hd - rad, 0), (-hw + rad, hd - rad, math.pi / 2),
               (-hw + rad, -hd + rad, math.pi), (hw - rad, -hd + rad, 1.5 * math.pi))
    for cx, cy, a0 in corners:
        for j in range(segs):
            q = a0 + j * (math.pi / 2) / segs
            ring.append((cx + rad * math.cos(q), cy + rad * math.sin(q)))
    return ring


def slab(B, spec, origin, style, h):
    """Footprint extrusion plus façade, crown and a short podium. Not a bare box."""
    w, d = spec['w'], spec['d']
    xf = frame_xf(spec, origin)
    taper = style.get('taper', 1.0)
    floors = spec['levels'] or max(4, round(h / 4.0))
    glass = style.get('glass', 'glass')
    if style.get('round'):
        round_tower(B, spec, origin, style, h)
        return
    extrude(B, 'envelope:' + glass, spec['ring'], 0 if not style.get('pilotis') else style['pilotis'], h - 0.8, origin, taper)
    tw, td = w * taper, d * taper
    B.box('roof_deck:roof', (0, 0, h - 0.35), (tw * 0.9, td * 0.9, 0.5), xf)
    crown = style.get('crown', 'flat' if h < 80 else 'step')
    if crown == 'step':
        B.box('crown_step:metal', (0, 0, h * 0.975), (tw * 0.62, td * 0.62, h * 0.05), xf)
        B.box('crown_screen:metal', (0, 0, h + 1.6), (tw * 0.28, td * 0.28, 3.2), xf)
    elif crown == 'frame':
        for y in (-td * 0.38, td * 0.38):
            B.box('crown_frame:metal', (0, y, h + 4.5), (tw * 0.78, 0.6, 0.6), xf)
        for x in (-tw * 0.38, tw * 0.38):
            B.box('crown_frame:metal', (x, 0, h + 4.5), (0.6, td * 0.78, 9), xf)
    elif crown == 'diamond':
        B.box('crown_diamond:glass_alt', (0, 0, h + 6), (tw * 0.55, td * 0.55, 12), xf)
        B.box('crown_diamond:metal', (0, 0, h + 12.2), (tw * 0.22, td * 0.22, 1.2), xf)
    elif crown == 'slant':
        B.box('crown_slant:metal', (tw * 0.12, 0, h + 3.2), (tw * 0.55, td * 0.7, 6.4), xf)
        B.box('crown_slant:glass_alt', (-tw * 0.16, 0, h + 1.2), (tw * 0.42, td * 0.55, 2.4), xf)
    elif crown == 'box':
        B.box('crown_box:metal', (0, 0, h + 2.2), (tw * 0.46, td * 0.46, 4.4), xf)
    else:
        B.box('parapet:metal', (0, d * 0.46, h - 0.15), (tw * 0.92, 0.4, 1.3), xf)
        B.box('parapet:metal', (0, -d * 0.46, h - 0.15), (tw * 0.92, 0.4, 1.3), xf)
    # vertical fins on the two long faces, full height, so the shaft is not a flat prism
    fins = style.get('fins', 'v' if h >= 70 else 'h')
    if fins in ('v', 'grid') and h >= 18:
        gap = style.get('fin', 4.2 if w > 40 else 3.4)
        n = max(4, min(26, int(w / gap)))
        depth = style.get('fin_d', 0.7 if h >= 120 else 0.45)
        z0 = style.get('pilotis', 0) + 1
        for side in (-1, 1):
            for i in range(n):
                x = -w / 2 + (i + 0.5) * w / n
                # alternate depth so a long façade reads as a rhythm, not a comb of identical sticks
                dep = depth * (1.35 if (i % 5 == 2) else 0.75)
                B.box('fins:metal', (x * (0.5 + 0.5 * taper), side * (d / 2 + dep / 2), (z0 + h * 0.9) / 2),
                      (0.22, dep, h * 0.9 - z0), xf)
    if fins in ('h', 'grid') or h < 70:
        bands = style.get('bands', 6 if h >= 80 else 4)
        for k in range(1, bands + 1):
            z = h * k / (bands + 1)
            B.box('floor_bands:bronze' if k % 2 == 0 else 'floor_bands:metal',
                  (0, 0, z), (w * 1.02, d * 1.02, 0.35), xf)
    belt = style.get('belt')
    if belt:
        B.box('refuge_belt:stone', (0, 0, h * belt), (w * 1.06, d * 1.06, max(1.2, h * 0.018)), xf)
    pilotis = style.get('pilotis', 0)
    if pilotis:
        for x in (-w * 0.32, 0, w * 0.32):
            for y in (-d * 0.32, d * 0.32):
                B.box('pilotis:metal', (x, y, pilotis / 2), (1.1, 1.1, pilotis), xf)
        B.box('pilotis_ring:glass_alt', (0, 0, pilotis * 0.72), (w * 0.78, 0.4, pilotis * 0.35), xf)
    pod = style.get('podium', 0 if h < 50 else min(14.0, max(6.0, h * 0.06)))
    if pod and not pilotis:
        B.box('podium:stone', (0, 0, pod / 2), (w + style.get('podium_extra', min(10, w * 0.18)),
                                               d + style.get('podium_extra', min(8, d * 0.18)), pod), xf)
        B.box('lobby:glass_alt', (0, -d / 2 - 0.2, pod * 0.45), (w * 0.46, 1.4, pod * 0.72), xf)
    # sparse night panes on the long faces only
    if h >= 16:
        rows = min(10, max(3, floors // 4))
        cols = min(8, max(3, int(w / 8)))
        for side in (-1, 1):
            for r in range(rows):
                for c in range(cols):
                    if (r * 5 + c * 3 + (0 if side > 0 else 2)) % 4 == 0:
                        continue
                    x = -w * 0.36 + c * (w * 0.72) / max(1, cols - 1)
                    z = h * (0.18 + 0.7 * (r + 0.5) / rows)
                    B.face('night_windows:night', [xf(p) for p in (
                        (x - 0.7, side * (d / 2 + 0.15), z - 0.9),
                        (x + 0.7, side * (d / 2 + 0.15), z - 0.9),
                        (x + 0.7, side * (d / 2 + 0.15), z + 0.9),
                        (x - 0.7, side * (d / 2 + 0.15), z + 0.9))][::1 if side < 0 else -1])


def round_tower(B, spec, origin, style, h):
    r = min(spec['w'], spec['d']) / 2 * 0.96
    waist = style.get('waist', 0.0)
    seg, rings = 18, 12
    cx, cz = spec['cx'], spec['cz']

    def rad(t):
        return r * (1 - waist * math.sin(math.pi * t)) * (1 - 0.06 * t)

    def pt(i, t):
        a = i / seg * TAU
        rr = rad(t)
        return (*bl(cx + rr * math.cos(a), cz + rr * math.sin(a), origin), h * t)
    for k in range(rings):
        t0, t1 = k / rings, (k + 1) / rings
        for i in range(seg):
            j = (i + 1) % seg
            B.face('envelope:glass', [pt(i, t0), pt(j, t0), pt(j, t1), pt(i, t1)])
    for i in range(0, seg, 2):
        a = TAU * i / seg
        def xf(p, a=a):
            x, y, z = p
            rr = r + 0.45 + y
            return (*bl(cx + math.cos(a) * rr - math.sin(a) * x, cz + math.sin(a) * rr + math.cos(a) * x, origin), z)
        B.box('ribs:metal', (0, 0, h * 0.5), (0.45, 0.55, h * 0.9), xf)
    B.box('crown_ring:metal', (*bl(cx, cz, origin), h + 1.2), (r * 0.55, r * 0.55, 2.4), None)
    # night ring of panes
    for k in range(3, rings - 1, 2):
        t = k / rings
        for i in range(0, seg, 3):
            a = TAU * (i + 0.5) / seg
            rr = rad(t) + 0.2
            c0 = bl(cx + math.cos(a) * rr, cz + math.sin(a) * rr, origin)
            tang = (-math.sin(a), math.cos(a))
            B.face('night_windows:night', [
                (c0[0] + tang[0] * 0.6, c0[1] + tang[1] * 0.6, h * t - 0.8),
                (c0[0] - tang[0] * 0.6, c0[1] - tang[1] * 0.6, h * t - 0.8),
                (c0[0] - tang[0] * 0.6, c0[1] - tang[1] * 0.6, h * t + 0.8),
                (c0[0] + tang[0] * 0.6, c0[1] + tang[1] * 0.6, h * t + 0.8)])


def apply_height(spec, index):
    if index in HEIGHT:
        spec['height'] = HEIGHT[index][0]
        spec['height_note'] = HEIGHT[index][1]
    return spec


def style_for(index, spec):
    h = spec['height']
    base = dict(fins='v' if h >= 80 else 'h', crown='step' if h >= 160 else ('flat' if h >= 60 else 'box'),
                podium=0 if h < 45 else min(12.0, max(6.0, h * 0.045)))
    over = {
        896: dict(crown='diamond', fins='v', fin_d=0.85, taper=0.9),
        1541: dict(crown='slant', fins='grid', fin_d=0.6),
        1675: dict(fins='grid', fin=3.2, belt=0.5, crown='box', rad=4),
        1670: dict(pilotis=8.0, podium=0, fins='grid', crown='flat'),
        880: dict(round=True, waist=0.10, crown='flat'),
        476: dict(taper=0.82, crown='frame', fins='v', fin_d=0.55),
        477: dict(taper=0.9, fins='h', crown='flat', podium=8),
        478: dict(taper=0.9, fins='h', crown='flat', podium=8),
        479: dict(taper=0.92, fins='h', crown='flat', podium=8),
        486: dict(taper=0.94, fins='h', crown='flat', podium=6),
        487: dict(taper=0.92, fins='h', crown='flat', podium=8),
        658: dict(crown='frame', taper=0.94, fins='v'),
        657: dict(crown='step', taper=0.95, fins='v'),
        421: dict(fins='h', crown='box', glass='glass_alt'),
        634: dict(fins='v', fin_d=0.8, crown='step'),
        630: dict(fins='v', fin_d=0.7, belt=0.5, crown='frame'),
        450: dict(fins='grid', crown='step'),
        619: dict(fins='v', fin_d=0.9, crown='box'),
        782: dict(fins='v', fin=3.0, belt=0.5, crown='step'),
        779: dict(fins='v', fin=2.8, crown='flat'),
        780: dict(fins='v', fin=2.8, crown='flat'),
        443: dict(fins='grid', fin=3.2, crown='box', podium=12),
        654: dict(fins='v', fin=2.6, crown='flat'),
        401: dict(fins='v', fin_d=0.5, crown='step'),
        1232: dict(fins='h', crown='step'),
        118: dict(kind='theatre'),
        117: dict(fins='h', podium=0, crown='flat'),
    }
    base.update(over.get(index, {}))
    return base


def build_slabs(B, buildings, indices, origin, styles=None):
    specs = []
    for i in indices:
        spec = apply_height(obb(buildings[i]), i)
        st = style_for(i, spec)
        if styles:
            st.update(styles)
        if st.get('kind') == 'theatre':
            specs.append(spec)
            continue
        if st.get('round'):
            round_tower(B, spec, origin, st, spec['height'])
        elif spec['height'] < 8:
            extrude(B, 'canopy:roof', spec['ring'], 0, max(0.4, spec['height']), origin)
            B.box('canopy_edge:metal', (*bl(spec['cx'], spec['cz'], origin), spec['height']),
                  (spec['w'] * 1.02, spec['d'] * 1.02, 0.35), None)
        else:
            slab(B, spec, origin, st, spec['height'])
        specs.append(spec)
    return specs


def build_tencent(B, buildings, origin):
    specs = [apply_height(obb(buildings[i]), i) for i in (602, 603)]
    for spec in specs:
        # Sharp glass slabs. Street photos show a regular curtain-wall grid,
        # not a deep sawtooth; fins stay shallow so the silhouette stays a slab.
        slab(B, spec, origin, dict(fins='grid', fin=3.6, fin_d=0.42, crown='flat', podium=0, bands=8), spec['height'])
        xf = frame_xf(spec, origin)
        B.box('lobby:glass_alt', (0, 0, 7), (spec['w'] * 0.62, spec['d'] * 0.7, 14), xf)
    south, north = specs
    floor = south['height'] / (south['levels'] or 50)
    # Low link follows the exterior photos (a thick bar over a tall portal),
    # NOT the published "floors 2–5" program range, which would sit almost on
    # the ground. Mid and top follow B+H L21–25 and L35–38 on the south tower.
    links = (
        ('Culture_link', 22.0, 58.0),
        ('Health_link', 21 * floor, 25 * floor),
        ('Knowledge_link', 35 * floor, 38 * floor),
    )
    for name, z0, z1 in links:
        xf, dist = add_span(B, name + ':dark', origin, south, north, z0, z1, 42.0, 30.0)
        # bronze rim so the bar reads as a framed volume, not a hole in the towers
        L = dist + 30
        for y in (-21.4, 21.4):
            B.box(name + '_rim:bronze', (0, y, z0), (L, 0.8, 0.8), xf)
            B.box(name + '_rim:bronze', (0, y, z1), (L, 0.8, 0.8), xf)
        B.box(name + '_terrace:stone', (0, 0, z1 + 0.45), (L * 0.72, 28, 0.7), xf)
        B.face('night_bridge:night', [xf(p) for p in (
            (-L * 0.4, -20.6, z0 + 1.2), (L * 0.4, -20.6, z0 + 1.2),
            (L * 0.4, -20.6, z0 + 2.4), (-L * 0.4, -20.6, z0 + 2.4))])
    return specs


def build_cocoon(B, buildings, origin):
    specs = [obb(buildings[i]) for i in (542, 543)]
    # The two OSM halls sit east-west. The real shell is one continuous roof;
    # its length here is the span of those halls plus a margin, not a surveyed
    # stadium length. East end is left open as an oculus (近似).
    cx = sum(s['cx'] for s in specs) / 2
    cz = sum(s['cz'] for s in specs) / 2
    length, width, height = 430.0, 210.0, 52.0
    nu, nv = 22, 9

    def pt(i, j):
        u = -1 + 2 * i / nu
        v = -1 + 2 * j / nv
        r2 = u * u + v * v
        z = height * math.sqrt(max(0.0, 1 - r2)) if r2 < 1 else 0.0
        x = cx + u * length / 2
        zed = cz + v * width / 2
        return (*bl(x, zed, origin), z), r2, u, v

    def oculus(u, v, z):
        return u > 0.42 and abs(v) < 0.38 and z > height * 0.25

    for j in range(nv):
        for i in range(nu):
            p00, r00, u00, v00 = pt(i, j)
            p10, r10, _, _ = pt(i + 1, j)
            p11, r11, _, _ = pt(i + 1, j + 1)
            p01, r01, _, _ = pt(i, j + 1)
            if max(r00, r10, r11, r01) > 0.98:
                continue
            if oculus(u00, v00, p00[2]):
                continue
            B.face('shell_skin:white', [p00, p10, p11, p01])
    # ribs
    for j in range(0, nv + 1, 1):
        prev = None
        for i in range(nu + 1):
            p, r, u, v = pt(i, j)
            if r > 0.98 or oculus(u, v, p[2]):
                prev = None
                continue
            if prev is not None:
                _beam(B, 'shell_ribs:white', prev, p, 1.1)
            prev = p
    for i in range(0, nu + 1, 2):
        prev = None
        for j in range(nv + 1):
            p, r, u, v = pt(i, j)
            if r > 0.98 or oculus(u, v, p[2]):
                prev = None
                continue
            if prev is not None:
                _beam(B, 'shell_ribs:white', prev, p, 0.8)
            prev = p
    # low plinths so the halls still sit on the ground under the shell
    for spec in specs:
        extrude(B, 'hall_plinth:stone', spec['ring'], 0, 8, origin)
    return specs


def _beam(B, key, a, b, r):
    ax, ay, az = a
    bx, by, bz = b
    dx, dy, dz = bx - ax, by - ay, bz - az
    L = math.sqrt(dx * dx + dy * dy + dz * dz) or 1
    ux, uy, uz = dx / L, dy / L, dz / L
    # a perpendicular
    px, py, pz = (-uy, ux, 0) if abs(uz) < 0.9 else (0, -uz, uy)
    pl = math.sqrt(px * px + py * py + pz * pz) or 1
    px, py, pz = px / pl * r, py / pl * r, pz / pl * r
    qx, qy, qz = (uy * pz - uz * py), (uz * px - ux * pz), (ux * py - uy * px)
    def corner(o, s1, s2):
        return (o[0] + s1 * px + s2 * qx, o[1] + s1 * py + s2 * qy, o[2] + s1 * pz + s2 * qz)
    pts = [corner(a, u, v) for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    pts += [corner(b, u, v) for u, v in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for q in ((3, 2, 1, 0), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)):
        B.face(key, [pts[i] for i in q])


def build_port(B, buildings, indices, origin):
    specs = []
    for i in indices:
        spec = obb(buildings[i])
        specs.append(spec)
        if i == 190:
            extrude(B, 'terminal_wall:glass', spec['ring'], 0, 9, origin)
            _wave_roof(B, spec, origin, 8.5, spec['height'] + 4)
        elif spec['height'] <= 6:
            extrude(B, 'canopy:roof', spec['ring'], max(0, spec['height'] - 0.6), spec['height'], origin)
            # posts
            xf = frame_xf(spec, origin)
            for x in (-spec['w'] * 0.35, spec['w'] * 0.35):
                B.box('canopy_post:metal', (x, 0, spec['height'] / 2), (0.6, 0.6, spec['height']), xf)
        else:
            slab(B, spec, origin, dict(fins='h', podium=0, crown='flat'), spec['height'])
    return specs


def _wave_roof(B, spec, origin, z0, z1):
    xf = frame_xf(spec, origin)
    w, d = spec['w'], spec['d']
    nx, ny = 28, 8
    for j in range(ny):
        for i in range(nx):
            def z_at(ii, jj):
                u, v = ii / nx, jj / ny
                arch = math.sin(math.pi * v)
                wave = 0.18 * math.sin(3 * TAU * u)
                return z0 + (z1 - z0) * (0.35 + 0.65 * arch) * (1 + wave)
            quad = []
            for ii, jj in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                x = -w / 2 + w * ii / nx
                y = -d / 2 + d * jj / ny
                quad.append(xf((x, y, z_at(ii, jj))))
            B.face('wave_roof:white', quad)
            # a thin underside edge strip is enough; skip a second skin


def build_theatre(B, spec, origin):
    extrude(B, 'theatre_wall:glass_alt', spec['ring'], 0, spec['height'] * 0.45, origin)
    xf = frame_xf(spec, origin)
    w, d, h = spec['w'], spec['d'], spec['height']
    nx = 16
    for i in range(nx):
        quad = []
        for ii, side in ((i, -1), (i + 1, -1), (i + 1, 1), (i, 1)):
            u = ii / nx
            x = -w / 2 + w * u
            arch = math.sin(math.pi * u)
            z = h * 0.40 + h * 0.62 * arch
            y = side * d * (0.30 + 0.18 * arch)
            quad.append(xf((x, y, z)))
        B.face('theatre_shell:white', quad)
    B.box('theatre_lobby:glass', (0, -d * 0.42, h * 0.18), (w * 0.46, 2, h * 0.32), xf)


def build_baidu(B, buildings, origin):
    specs = [apply_height(obb(buildings[i]), i) for i in (462, 463)]
    for spec in specs:
        slab(B, spec, origin, dict(fins='v', fin_d=0.8, crown='step', podium=16, bands=5), spec['height'])
        # recessed "zipper" slot on the inner short side — the published
        # description is a vertical-oasis / zipper, not a verified module drawing
        xf = frame_xf(spec, origin)
        inner = -1 if spec['cx'] > origin[0] else 1
        B.box('zipper_slot:dark', (0, inner * spec['d'] * 0.48, spec['height'] * 0.45),
              (spec['w'] * 0.08, 2.2, spec['height'] * 0.62), xf)
    east, west = specs[0], specs[1]
    # one skybridge exists (百科：斜跨钢连廊，跨度超过 26m). Its floor was not published.
    z = west['height'] * 0.40
    add_span(B, 'baidu_link:glass_alt', origin, east, west, z, z + 8, 16, 12)
    add_span(B, 'baidu_link_frame:bronze', origin, east, west, z - 0.4, z + 0.3, 17, 12)
    return specs


def build_anchor_shuttle(B, origin, h, w, d):
    """腾讯大厦：梭形收分 + 水平装饰杆 + 顶部弧形空中花园。平面尺寸为近似。"""
    spec = dict(cx=origin[0], cz=origin[1], w=w, d=d, angle=0.0, height=h, levels=39,
                name='腾讯大厦', pts=4, ring=[
                    (origin[0] - w / 2, origin[1] - d / 2), (origin[0] + w / 2, origin[1] - d / 2),
                    (origin[0] + w / 2, origin[1] + d / 2), (origin[0] - w / 2, origin[1] + d / 2)])
    # One closed shaft. The long axis tapers (published shuttle / 梭形). Plan is approximate.
    extrude(B, 'envelope:glass', spec['ring'], 0, h, origin, 0.72)
    xf = frame_xf(spec, origin)
    for k in range(1, 10):
        z = h * k / 10
        kw = 1 - 0.28 * (z / h)
        B.box('horizontal_fins:metal', (0, 0, z), (w * kw * 1.04, d * 1.05, 0.45), xf)
    # arched crown, published roof-garden structure about 19.3 m
    nx = 10
    for i in range(nx):
        quad = []
        for ii, side in ((i, -1), (i + 1, -1), (i + 1, 1), (i, 1)):
            u = ii / nx
            x = -w * 0.22 + w * 0.44 * u
            z = h + 19.3 * math.sin(math.pi * u)
            quad.append(xf((x, side * d * 0.28, z)))
        B.face('roof_garden:glass_alt', quad)
    B.box('podium:stone', (0, 0, 6), (w * 1.15, d * 1.25, 12), xf)
    return spec


def _extrude_taper_band(B, key, origin, w, d, z0, z1, k0, k1):
    def ring(k, z):
        return [(*bl(origin[0] + x * k, origin[1] + y, origin), z) for x, y in (
            (-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
    a, b = ring(k0, z0), ring(k1, z1)
    B.face(key, a[::-1]) if z0 == 0 else None
    if z1 > z0 and k1 <= k0:
        pass
    for i in range(4):
        j = (i + 1) % 4
        B.face(key, [a[i], a[j], b[j], b[i]])
    if z1 > 190:
        B.face(key, b)


def build_mixc(B, origin):
    """示意：锚点处没有 OSM 轮廓。几栋低层商业体，不是塔。"""
    blocks = ((-70, -20, 90, 48, 22), (30, -30, 70, 40, 28), (-20, 40, 80, 36, 16), (60, 36, 40, 32, 18))
    specs = []
    for dx, dz, w, d, h in blocks:
        cx, cz = origin[0] + dx, origin[1] + dz
        ring = [(cx - w / 2, cz - d / 2), (cx + w / 2, cz - d / 2), (cx + w / 2, cz + d / 2), (cx - w / 2, cz + d / 2)]
        spec = dict(cx=cx, cz=cz, w=w, d=d, angle=0.15, height=h, levels=max(3, round(h / 4)), name='万象城示意', pts=4, ring=ring)
        slab(B, spec, origin, dict(fins='h', podium=0, crown='flat', bands=3), h)
        specs.append(spec)
    return specs


# id, indices, kind. tech-park and the SZU campus bulk are intentionally absent.
GROUPS = [
    ('tencent-binhai', [602, 603], 'tencent'),
    ('baidu-intl', [462, 463], 'baidu'),
    ('software-base', [404, 405, 406, 407, 408, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437], 'slabs'),
    ('spring-cocoon', [542, 543], 'cocoon'),
    ('szbay-port', [190, 191, 192, 193, 194, 195, 196, 197, 198, 760, 264, 265], 'port'),
    ('excellence-houhai', [634], 'slabs'),
    ('youxian-tower', [654], 'slabs'),
    ('ketong-tower', [443], 'slabs'),
    ('bupt-tower', [780], 'slabs'),
    ('caixun-tower', [779], 'slabs'),
    ('lite3', [10, 1175, 1488], 'slabs'),
    ('yihua-tower', [401], 'slabs'),
    ('china-overseas', [1232], 'slabs'),
    ('tsinghua-research', [1257, 1256], 'linked-low'),
    ('innovation-center', [658, 657, 659, 660, 661], 'slabs'),
    ('venture-east-wall', [1258, 1259], 'slabs'),
    ('venture-neighbors', [403, 409, 402, 424], 'slabs'),
    ('xunlei-tower', [782], 'slabs'),
    ('hisense-south', [619], 'slabs'),
    ('bytedance-houhai', [1675], 'slabs'),
    ('haide-office-wall', [902, 638, 637, 899, 897, 895, 635], 'slabs'),
    ('venture-capital', [630], 'slabs'),
    ('rongchao-hq', [450], 'slabs'),
    ('cnooc-twins', [620, 605], 'linked-low'),
    ('aerospace-plaza', [633, 631], 'linked-low'),
    ('capital-plaza', [896], 'slabs'),
    ('hytera-hq', [1541], 'slabs'),
    ('szu-performance', [2404], 'slabs'),
    ('poly-complex', [118, 117], 'poly'),
    ('coastal-city', [119, 121], 'linked-low'),
    ('cr-neighbours', [422, 670], 'slabs'),
    ('xiaomi-shenzhen', [1670], 'slabs'),
    ('dajia', [880], 'slabs'),
    ('lenovo-houhai', [878, 879], 'linked-low'),
    ('andaz', [421], 'slabs'),
    ('shenzhen-bay-one', [476, 477, 478, 479, 486, 487], 'slabs'),
    ('tencent-hq', [], 'shuttle'),
    ('mixc', [], 'mixc'),
]

ANCHORS = {
    'tencent-hq': (824.3, -2218.9),
    'mixc': (1441.3, 544.6),
}


def clusters_of(buildings, indices):
    """Keep far-apart members in separate assets so one group does not span kilometres."""
    if len(indices) <= 1:
        return [indices]
    cents = []
    for i in indices:
        r = ring_of(buildings[i])
        cents.append((sum(x for x, _ in r) / len(r), sum(z for _, z in r) / len(r)))
    groups = [[0]]
    for n in range(1, len(indices)):
        placed = False
        for g in groups:
            if all(math.hypot(cents[n][0] - cents[k][0], cents[n][1] - cents[k][1]) < 450 for k in g):
                g.append(n)
                placed = True
                break
        if not placed:
            groups.append([n])
    return [[indices[i] for i in g] for g in groups]


def origin_of(kind, buildings, indices, lid):
    if lid in ANCHORS:
        return list(ANCHORS[lid])
    pts = []
    for i in indices:
        r = ring_of(buildings[i])
        pts.append((sum(x for x, _ in r) / len(r), sum(z for _, z in r) / len(r)))
    return [sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)]


def export_inline(obs, meta, path):
    meshes, tri = [], 0
    for ob in obs:
        me = ob.data
        me.calc_loop_triangles()
        vs, ns, idx, dedup = [], [], [], {}
        for t in me.loop_triangles:
            for li in t.loops:
                l = me.loops[li]
                p = me.vertices[l.vertex_index].co
                n = me.corner_normals[li].vector
                key = tuple(round(x, 5) for x in (*p, *n))
                if key not in dedup:
                    dedup[key] = len(vs) // 3
                    vs.extend((p.x, p.z, -p.y))
                    ns.extend((n.x, n.z, -n.y))
                idx.append(dedup[key])
        def b64(a, fmt):
            return base64.b64encode(struct.pack('<' + fmt * len(a), *a)).decode()
        meshes.append({
            'name': ob.name, 'material': ob['material_key'],
            'position': b64(vs, 'f'),
            'normal': b64([max(-127, min(127, round(v * 127))) for v in ns], 'b'),
            'normalType': 'int8',
            'index': b64(idx, 'H' if len(vs) // 3 < 65536 else 'I'),
            'indexType': 'uint16' if len(vs) // 3 < 65536 else 'uint32',
            'vertices': len(vs) // 3, 'triangles': len(idx) // 3,
            'night': ob['material_key'] == 'night'})
        tri += len(idx) // 3
    payload = {
        'format': 'yuehai-inline-mesh-v1',
        'axis': 'X=baseline east, Y=up, Z=baseline south; metres',
        'metadata': meta,
        'materials': {k: {'color': v[0], 'metalness': v[1], 'roughness': v[2], 'night': v[3]} for k, v in MATS.items()},
        'meshes': meshes}
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
    return tri


def build_one(lid, indices, kind, buildings, file_id=None):
    origin = origin_of(kind, buildings, indices, lid)
    col = reset(lid)
    B = Builder()
    if kind == 'tencent':
        specs = build_tencent(B, buildings, origin)
    elif kind == 'baidu':
        specs = build_baidu(B, buildings, origin)
    elif kind == 'cocoon':
        specs = build_cocoon(B, buildings, origin)
    elif kind == 'port':
        specs = build_port(B, buildings, indices, origin)
    elif kind == 'poly':
        specs = []
        for i in indices:
            spec = obb(buildings[i])
            specs.append(spec)
            if i == 118:
                build_theatre(B, spec, origin)
            else:
                slab(B, spec, origin, style_for(i, spec), spec['height'])
    elif kind == 'shuttle':
        specs = [build_anchor_shuttle(B, origin, 193.2, 78.0, 40.0)]
    elif kind == 'mixc':
        specs = build_mixc(B, origin)
    elif kind == 'linked-low':
        specs = build_slabs(B, buildings, indices, origin)
        if len(specs) >= 2:
            z1 = min(12.0, min(s['height'] for s in specs) * 0.12)
            add_span(B, 'podium_link:stone', origin, specs[0], specs[1], 0.2, z1, max(specs[0]['d'], specs[1]['d']) * 0.8, 4)
    else:
        specs = build_slabs(B, buildings, indices, origin)
    obs = B.finish(col)
    if not obs:
        raise RuntimeError('no geometry for ' + lid)
    meta = {
        'id': lid, 'originRaw': origin, 'scale': [PLAN, HS, PLAN],
        'baselineBuildingIndices': indices,
        'heightM': max(s['height'] for s in specs),
        'members': [{k: s[k] for k in ('name', 'w', 'd', 'height', 'cx', 'cz')} | ({'heightNote': s['height_note']} if s.get('height_note') else {}) for s in specs],
        'blenderVersion': bpy.app.version_string,
        'caution': 'OSM footprint and height unless heightNote says otherwise. Façade modules, crowns and link floors marked approximate in landmarks/ASSET_NOTES.md. Not a survey.',
    }
    for ob in obs:
        ob['landmark_id'] = lid
    file_id = file_id or lid
    tri = export_inline(obs, meta, OUT / f'{file_id}.inline.json')
    bpy.ops.object.select_all(action='DESELECT')
    for ob in obs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT / f'{file_id}.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_materials='EXPORT')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'{file_id}.blend'), compress=True)
    # bounds
    zs = [ob.matrix_world @ v.co for ob in obs for v in ob.data.vertices]
    zmax = max(p.z for p in zs)
    zmin = min(p.z for p in zs)
    print(f'ASSET {file_id} tris={tri} objects={len(obs)} z={zmin:.1f}..{zmax:.1f} h={meta["heightM"]:.1f}', flush=True)
    meta['file'] = file_id
    meta['triangles'] = tri
    meta['objects'] = len(obs)
    meta['zMin'] = zmin
    meta['zMax'] = zmax
    return meta


def main():
    data = json.loads(DATA_PATH.read_text())
    buildings = data['buildings']
    only = os.environ.get('ONLY', '').strip()
    jobs = [(lid, idx, kind) for lid, idx, kind in GROUPS if not only or lid == only]
    if only and not jobs:
        raise SystemExit('unknown ONLY=' + only)
    stats = []
    for lid, idx, kind in jobs:
        parts = clusters_of(buildings, idx) if idx else [idx]
        for n, part in enumerate(parts):
            file_id = lid if len(parts) == 1 else f'{lid}-{n+1}'
            stats.append(build_one(lid, part, kind, buildings, file_id))
    if not only:
        cr = json.loads((OUT / 'china-resources.inline.json').read_text())
        stats.append({'id': 'china-resources', 'kept': True, 'triangles': sum(m['triangles'] for m in cr['meshes']),
                      'originRaw': cr['metadata']['originRaw'], 'heightM': cr['metadata'].get('heightM'),
                      'note': 'Existing Blender asset retained; not regenerated.'})
        (ROOT / 'manifest.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2))
    print('DONE', len(stats), flush=True)


if __name__ == '__main__':
    main()
