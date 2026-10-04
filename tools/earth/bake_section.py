#!/usr/bin/env python3
"""tools/earth/bake_section.py - offline bake of a pgt-slice-pack from a baked Earth pack.

0.4.0-sync-plan.md §2.8 / §5 M4, the "other half" of 0.4.1 M4: the interactive cutter
draws a line on the live map (planet-geotectonics, js/slice.js, a running world) and
this script bakes the same object from the baked Earth data pack (js/data/earth-*.js),
reproducible, no browser, the one a test uses. Neither owns the format: both write
through the shared port/slice-format.js, which this script calls for the quantise,
the checksum and the validate (tools/earth/stamp.js) - a baked pack and a drawn pack
are the same object with a different source block.

Home note: the plan lists the bake under the counterpart's tools/earth/ (it reads
the counterpart's data packs); this copy lives here next to the generated bundles in
js/data/ so a bundle is regenerable without a second checkout. Pass --pack the
counterpart's baked Earth pack and --commit its commit.

The walk is the raster form of 0.4.1-plan.md §3.2: sample the great circle at a third
of the local cell spacing so a cell cannot be jumped, bisect each cell crossing to
1 m of arc, one sample per crossed cell, each carrying the arc it spans. The cells
are the Earth pack's own raster cells (the pack is the source), so the baked profile
equals the source pack's cells by construction - and the post-bake check asserts it
sample by sample rather than trusting the construction.

Field honesty, one rule: a static snapshot carries no accumulated dynamics, so the
six ore potentials and damage are 0 (the section's own deposit engine grows them
from fert while it runs) and the plate velocities are the pack's Euler poles (the
motion the sim would integrate from this pack), classified into boundaries with the
counterpart's own edge law (epsHi, oceanic by hFel, older oceanic subducts).

Usage:
    python3 tools/earth/bake_section.py \
        --pack /path/to/planet-geotectonics/js/data/earth-100Ma.js \
        --id earth-100Ma-gc0 --lat0 0 --lon0 0 --az0 90 \
        --out js/data/section-earth-100Ma-gc0.js

The bake is circle-only: an Earth transect is a great circle, and a polyline walk
over a static raster has no buyer in M4.
"""

import argparse
import base64
import json
import math
import os
import subprocess
import struct
import sys
import tempfile

# The shared format is the one owner of the field table, the quantisation and the
# checksum. The bake assembles plain numbers; stamp.js runs them through SlicePack.
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))

# planet-geotectonics @ d909476 constants, read at the pinned commit:
# js/params.js (radius, epsHi, hOceanic, hOro, fertLo), js/edges.js (the edge law),
# js/extract.js (host), js/earth.js (K9 inversion, fert quartile),
# port/slice-format.js (R_KM).
R_KM = 6371.0          # SlicePack.R_KM: the arc in km
R_M = 6371000.0        # Params.radius: the velocity in m/Myr
FERT_LO = 0.5          # Params.fertLo
H_OCEANIC = 8000.0     # Params.hOceanic: below this, oceanic crust
H_ORO = 45000.0        # Params.hOro: above this, thick continental
EPS_HI = 2000.0        # Params.epsHi, m/Myr: |relN| below this reads as transform
CONT_AG = 500.0        # Earth.apply: continental age is held at 500 Myr
DEG = 180.0 / math.pi
TWO_PI_R = 2.0 * math.pi * R_KM     # a closed great circle, km
CROSS_M = 1e-3                      # the crossing bisection, 1 m of arc


def smoothstep(x, lo, hi):
	t = max(0.0, min(1.0, (x - lo) / (hi - lo)))
	return t * t * (3.0 - 2.0 * t)


# K9 inversion, exact mirror of js/earth.js Earth.invert (same clamps, same fixed-point
# loop), so the bake's thicknesses are the thicknesses the sim's decode would read.
def invert(z, age, sed, cont):
	if not cont:
		thermal = 350.0 * math.sqrt(min(age, 80.0))
		maf = ((z + 3342.0 + thermal) * 3300.0 - sed * 900.0) / 350.0
		return 0.0, max(2000.0, min(35000.0, maf))
	fel = (z + 3342.0 + 2091.0 - sed * 900.0 / 3300.0) * 6.0
	ci = smoothstep(fel, 5000.0, 20000.0)
	for _ in range(5):
		if ci >= 1.0:
			break
		thermal = (1.0 - ci) * 350.0 * math.sqrt(min(age, 80.0)) + ci * 2091.0
		fel = (z + 3342.0 + thermal - sed * 900.0 / 3300.0) * 6.0
		ci = smoothstep(fel, 5000.0, 20000.0)
	return max(1000.0, min(80000.0, fel)), 0.0


def host_code(fel, maf, sed):
	# Extract.host, by the section's HOSTS order (port/slice-format.js).
	if sed > 2000.0 and sed > fel and sed > maf:
		return 4                       # sediment
	if fel >= H_OCEANIC:
		return 3 if fel > H_ORO else 2 # thick continental / continental
	return 1                           # oceanic


def load_pack(pack_path):
	# The Earth pack is a classic-script IIFE, so read it the way a page would:
	# node evaluates it and prints the registered pack as JSON.
	js = ('global.window = global; require(process.argv[1]);'
		 'console.log(JSON.stringify(global.EarthPacks));')
	out = subprocess.run(['node', '-e', js, pack_path],
						 capture_output=True, text=True, check=True).stdout
	return json.loads(out)[-1]


def bank_u8(b64):
	return list(base64.b64decode(b64))


def bank_i16(b64):
	raw = base64.b64decode(b64)
	return list(struct.unpack('<%dh' % (len(raw) // 2), raw))


def decode(pack):
	# The banks, in the units js/earth.js decodes them to: metres, Myr, metres.
	w, h = pack['w'], pack['h']
	n = w * h
	scale = pack.get('scale', {'z': 1, 'age': 1, 'sed': 0.1})
	z = [v * scale['z'] for v in bank_i16(pack['banks']['z'])]
	age = [v * scale['age'] for v in bank_u8(pack['banks']['age'])]
	sed = [v * scale['sed'] * 1000.0 for v in bank_u8(pack['banks']['sed'])]
	kind = bank_u8(pack['banks']['kind'])
	plate = bank_u8(pack['plates']['ids'])
	if len(z) != n or len(kind) != n or len(plate) != n:
		raise ValueError('bank lengths do not match w x h = %d' % n)
	hfel = [0.0] * n
	hmaf = [0.0] * n
	for i in range(n):
		cont = bool(kind[i] & 1)
		hfel[i], hmaf[i] = invert(z[i], CONT_AG if cont else age[i], sed[i], cont)
	return {'w': w, 'h': h, 'z': z, 'age': age, 'sed': sed, 'kind': kind,
			'plate': plate, 'hfel': hfel, 'hmaf': hmaf,
			'poles': pack['plates']['poles'], 'count': pack['plates']['count']}


# ---------------------------------------------------------------- the great circle
# The same construction as SlicePack.stepFrom: p(s) = d0 cos(s/R) + t0 sin(s/R), a
# point s km along the circle that leaves (lat0, lon0) on azimuth az0 from north.
class Circle:
	def __init__(self, lat0, lon0, az0):
		lat, lon, az = lat0 / DEG, lon0 / DEG, az0 / DEG
		cl, sl, cL, sL, ca, sa = (math.cos(lat), math.sin(lat), math.cos(lon),
								  math.sin(lon), math.cos(az), math.sin(az))
		self.d0 = (cl * cL, sl, cl * sL)
		self.t0 = (-sl * cL * ca - sL * sa, cl * ca, -sl * sL * ca + cL * sa)

	def point(self, s):
		th = s / R_KM
		c, sn = math.cos(th), math.sin(th)
		return (self.d0[0] * c + self.t0[0] * sn,
				self.d0[1] * c + self.t0[1] * sn,
				self.d0[2] * c + self.t0[2] * sn)

	def tangent(self, s):
		# dp/ds made unit: the cut's direction at s, what vt is measured against.
		th = s / R_KM
		c, sn = math.cos(th), math.sin(th)
		return (-self.d0[0] * sn + self.t0[0] * c,
				-self.d0[1] * sn + self.t0[1] * c,
				-self.d0[2] * sn + self.t0[2] * c)

	def lat(self, s):
		return math.asin(max(-1.0, min(1.0, self.point(s)[1]))) * DEG


# ---------------------------------------------------------------- the walk
def cell_at(circle, s, w, h):
	# Equirectangular, cell-centred: row 0 = 90S, col 0 = 180W, the pack's convention.
	p = circle.point(s)
	lat = math.asin(max(-1.0, min(1.0, p[1]))) * DEG
	lon = math.atan2(p[2], p[0]) * DEG
	col = int(((lon + 180.0) % 360.0) / (360.0 / w)) % w
	row = int((lat + 90.0) / (180.0 / h))
	return max(0, min(h - 1, row)) * w + col


def adjacent(a, b, w):
	dr = abs(a // w - b // w)
	dc = abs(a % w - b % w)
	return dr <= 1 and min(dc, w - dc) <= 1


def local_step(circle, s, w, h):
	# A third of the local cell spacing: the step that cannot jump a cell (plan §3.2).
	lat = circle.lat(s)
	dlat = (180.0 / h) / DEG * R_KM
	dlon = (360.0 / w) / DEG * R_KM * max(abs(math.cos(lat / DEG)), 1e-4)
	return min(dlat, dlon) / 3.0


def walk(circle, w, h, total):
	"""One sample per crossed raster cell: (cell, s0, s1), the spans tiling [0, total]."""
	spans = []
	s, s0 = 0.0, 0.0
	cell = cell_at(circle, 0.0, w, h)

	def first_crossing(end):
		# end is outside `cell`, s is inside: the first point outside, to 1 m of arc.
		lo, hi = s, end
		while hi - lo > CROSS_M:
			mid = 0.5 * (lo + hi)
			if cell_at(circle, mid, w, h) == cell:
				lo = mid
			else:
				hi = mid
		return hi

	def process_to(s1):
		# Advance from s (inside `cell`, the current run started at s0) to s1, closing
		# a run at every crossing and starting the next at the crossing.
		nonlocal s, s0, cell
		while s < s1 - 1e-12:
			if cell_at(circle, s1, w, h) == cell:
				s = s1
				return
			hi = first_crossing(s1)
			c_hi = cell_at(circle, hi, w, h)
			if not adjacent(cell, c_hi, w):
				# the cells narrowed between s and s1, so the step was too big for
				# them: close at the first crossing of the front half instead
				mid = 0.5 * (s + hi)
				if cell_at(circle, mid, w, h) != cell:
					hi = first_crossing(mid)
					c_hi = cell_at(circle, hi, w, h)
				if not adjacent(cell, c_hi, w):
					raise RuntimeError('walk jumped cells at s=%.3f: %d -> %d' % (s, cell, c_hi))
			spans.append((cell, s0, hi))
			s, s0, cell = hi, hi, c_hi

	while s < total - 1e-9:
		process_to(min(s + local_step(circle, s, w, h), total))
	# the open run to the end of the cut
	if s0 < total - 1e-9:
		spans.append((cell, s0, total))
	# a closed line back onto its first cell: one run, not two
	if spans[0][0] == spans[-1][0]:
		spans[0] = (spans[0][0], 0.0, total)
		del spans[-1]
	return spans


# ---------------------------------------------------------------- the fields
def unit(v):
	m = math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
	if m < 1e-12:
		return (0.0, 0.0, 0.0)
	return (v[0] / m, v[1] / m, v[2] / m)


def dot(a, b):
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
	return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def plate_omega(poles, idx):
	# The pack's geo-frame Euler pole [x, y, z, om], om in rad/Myr: v = R (omega x p).
	p = poles[idx]
	return (p[0] * p[3], p[1] * p[3], p[2] * p[3])


def velocity(omega, p):
	return (R_M * (omega[1] * p[2] - omega[2] * p[1]),
			R_M * (omega[2] * p[0] - omega[0] * p[2]),
			R_M * (omega[0] * p[1] - omega[1] * p[0]))


def edge_of(g, i, j):
	"""bnd, pol, vt, vp at sample i: the boundary to sample j (i+1, wrapped for the
	closed cut). The counterpart's edge law (js/edges.js) on the pack's poles: relN
	against the face normal, epsHi, oceanic by hFel, older oceanic subducts."""
	spans, circle = g['_spans'], g['_circle']
	ca, cb = spans[i][0], spans[j][0]
	oa, ob = g['plate'][ca], g['plate'][cb]
	# the cut's own tangent and its out-of-plane direction, at the sample's mid
	sm = 0.5 * (spans[i][1] + spans[i][2])
	pm = circle.point(sm)
	tang = circle.tangent(sm)
	va = velocity(plate_omega(g['poles'], oa), pm)
	vt = dot(va, tang)
	vp = abs(dot(va, cross(pm, tang)))
	if oa == ob:
		return 0, 0, vt, vp
	x = circle.point(spans[i][2])
	da, db = g['_cell_dir'][ca], g['_cell_dir'][cb]
	nrm = unit((db[0] - da[0], db[1] - da[1], db[2] - da[2]))
	nrm = unit((nrm[0] - dot(nrm, x) * x[0], nrm[1] - dot(nrm, x) * x[1],
			   nrm[2] - dot(nrm, x) * x[2]))
	reln = dot(velocity(plate_omega(g['poles'], ob), x), nrm) - dot(velocity(plate_omega(g['poles'], oa), x), nrm)
	if reln > EPS_HI:
		return 2, 0, vt, vp                    # open
	if reln < -EPS_HI:
		# the polarity law (js/plates.js PLT.polarity, the section's sign: -1 the
		# left sample subducts, +1 the right, 0 a collision)
		oac, obc = g['hfel'][ca] < H_OCEANIC, g['hfel'][cb] < H_OCEANIC
		if not oac and not obc:
			return 4, 0, vt, vp                # collide
		if oac and obc:
			return 3, -1 if g['age'][ca] >= g['age'][cb] else 1, vt, vp
		return 3, -1 if oac else 1, vt, vp     # the oceanic side goes down
	return 1, 0, vt, vp                        # neutral: a transform


def bake(g, circle):
	w, h = g['w'], g['h']
	spans = walk(circle, w, h, TWO_PI_R)
	g['_circle'] = circle
	g['_spans'] = spans
	g['_cell_dir'] = {}
	for c in set(cs for cs, _, _ in spans):
		row, col = divmod(c, w)
		lat = (-90.0 + (row + 0.5) * 180.0 / h) / DEG
		lon = (-180.0 + (col + 0.5) * 360.0 / w) / DEG
		cl = math.cos(lat)
		g['_cell_dir'][c] = (cl * math.cos(lon), math.sin(lat), cl * math.sin(lon))

	n = len(spans)
	keys = ('sKm', 'zM', 'hFelM', 'hMafM', 'hSedM', 'ageMyr', 'fert', 'damage',
			'host', 'plate', 'bnd', 'pol', 'alive', 'wet', 'vt', 'vp', 'pot')
	f = {k: [] for k in keys}
	for i in range(n):
		c, s0, _ = spans[i]
		bnd, pol, vt, vp = edge_of(g, i, (i + 1) % n)
		f['sKm'].append(s0)
		f['zM'].append(int(round(g['z'][c])))
		f['hFelM'].append(int(round(g['hfel'][c])))
		f['hMafM'].append(int(round(g['hmaf'][c])))
		f['hSedM'].append(int(round(g['sed'][c])))
		f['ageMyr'].append(CONT_AG if g['kind'][c] & 1 else g['age'][c])
		f['fert'].append(FERT_LO + (1.0 - FERT_LO) * ((g['kind'][c] >> 1) & 7) / 7.0)
		f['damage'].append(0.0)
		f['host'].append(host_code(g['hfel'][c], g['hmaf'][c], g['sed'][c]))
		f['plate'].append(g['plate'][c])
		f['bnd'].append(bnd)
		f['pol'].append(pol)
		f['alive'].append(1)
		f['wet'].append(1 if g['z'][c] < 0 else 0)
		f['vt'].append(vt)
		f['vp'].append(vp)
		f['pot'].extend([0.0] * 6)
	return spans, f


def stamp(format_path, raw_path):
	# One owner for the format: quantise, checksum, validate, verify, canonical text.
	js = os.path.join(HERE, 'stamp.js')
	out = subprocess.run(['node', js, format_path, raw_path],
						 capture_output=True, text=True)
	if out.returncode != 0:
		raise SystemExit('stamp refused the pack: ' + out.stderr.strip())
	return out.stdout


def wrap_bundle(path, pack_id, canon, provenance):
	lines = ['// %s — generated by tools/earth/bake_section.py, do not edit.' % os.path.basename(path)]
	lines.extend(provenance)
	lines.append('// The pack is the canonical pgt-slice-pack JSON: quantised, checksummed and')
	lines.append('// verified by the shared port/slice-format.js before it ever reached this file.')
	lines.append('(function () {')
	lines.append("\tvar globalObject = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);")
	lines.append('\tif (!globalObject.SECTION_PACKS) globalObject.SECTION_PACKS = {};')
	lines.append("\tglobalObject.SECTION_PACKS['%s'] =" % pack_id)
	lines.append('\t\t' + canon + ';')
	lines.append('\tif (typeof module !== \'undefined\' && module.exports) module.exports = globalObject.SECTION_PACKS;')
	lines.append('})();')
	with open(path, 'w') as fh:
		fh.write('\n'.join(lines) + '\n')


def round6(v):
	# The stamp's number rule (toPrecision(6)), so the check compares quantised to
	# quantised and never blames the checker for the checker's own extra digits.
	if v == 0:
		return 0.0
	return float('%.6g' % v)


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('--pack', required=True, help='the counterpart baked Earth pack (js/data/earth-*.js)')
	ap.add_argument('--id', required=True, help='the bundle id: the ?pack= value')
	ap.add_argument('--lat0', type=float, required=True)
	ap.add_argument('--lon0', type=float, required=True)
	ap.add_argument('--az0', type=float, required=True)
	ap.add_argument('--out', required=True, help='the generated js/data/section-<id>.js')
	ap.add_argument('--format', default=os.path.join(REPO, 'port', 'slice-format.js'))
	ap.add_argument('--commit', default='', help='the counterpart commit the pack was read from')
	ap.add_argument('--rot-model', default='', help='the rotation model the pack carries')
	ap.add_argument('--report', default=None, help='write the bake report here')
	args = ap.parse_args()

	pack = load_pack(args.pack)
	g = decode(pack)
	circle = Circle(args.lat0, args.lon0, args.az0)
	max_lat = max(abs(circle.lat(s)) for s in range(0, 3600, 15))
	if max_lat > 89.0:
		raise SystemExit('the circle passes over a pole: the equirectangular raster '
						 'degenerates there; choose another line')

	spans, f = bake(g, circle)
	arc = TWO_PI_R
	cell_km = arc / len(spans)

	# the plates block: {id, n, wx, wy, wz} - the sim-frame omega (the pack's geo pole
	# negated-and-swizzled the way js/earth.js reads it) and the cell count per plate
	plate_n = [0] * g['count']
	for p in g['plate']:
		plate_n[p] += 1
	plates = []
	for p in range(g['count']):
		if not plate_n[p]:
			continue
		x, y, z, om = g['poles'][p]
		plates.append({'id': p, 'n': plate_n[p], 'wx': -x * om, 'wy': -z * om, 'wz': -y * om})

	epoch = pack.get('epoch', 0)
	provenance = [
		'// source: planet-geotectonics @ %s, Earth pack %s (%s)' %
		(args.commit or 'unknown commit', pack.get('name', args.pack), pack.get('source', 'no source line')),
		'// cut: great circle through (%.6g, %.6g) on azimuth %.6g, closes, %.6g km' %
		(args.lat0, args.lon0, args.az0, arc),
		"// %d samples over the pack's %dx%d raster (%.6g km cells); static bake: ore potentials and damage are 0" %
		(len(spans), g['w'], g['h'], cell_km),
		'// rot model: %s; license: CC-BY 4.0 (planet-geotectonics data/earth/License.txt)' %
		(args.rot_model or 'unrecorded'),
	]
	pack_json = {
		'format': 'pgt-slice-pack', 'version': 1,
		'source': {
			'repo': 'planet-geotectonics', 'commit': args.commit, 'pack': pack.get('name', ''),
			'epochMa': float(epoch), 'rotModel': args.rot_model, 'built': '',
			'tMyr': float(epoch), 'level': 0, 'gridSeed': 0, 'simSeed': 0,
		},
		'path': {'kind': 'circle', 'lat0': args.lat0, 'lon0': args.lon0, 'az0': args.az0,
				 'closes': True, 'arcKm': arc, 'cellKm': cell_km},
		'planet': {'rKm': R_KM},
		'sea': {'mode': 'level', 'levelM': 0.0, 'volScale': 1.0},
		'plates': plates,
		'n': len(spans),
		'checksum': '',
		'license': 'CC-BY 4.0 - %s; sources: planet-geotectonics data/earth/SOURCES.md'
				   % pack.get('source', 'PALEOMAP'),
	}
	pack_json.update(f)

	raw = tempfile.NamedTemporaryFile('w', suffix='.json', delete=False)
	try:
		json.dump(pack_json, raw)
		raw.close()
		canon = stamp(args.format, raw.name)
	finally:
		os.unlink(raw.name)

	ck = json.loads(canon)

	# ---------------------------------------------------------------- the check:
	# the baked profile equals the source pack's cells, the spans tile the cut, and a
	# second bake is the same cut. All asserted, none assumed.
	bad = None
	for i in range(len(spans)):
		c, s0, s1 = spans[i]
		if round6(s0) != ck['sKm'][i]:
			bad = 'sKm at sample %d does not tile the cut' % i
		elif ck['zM'][i] != int(round(g['z'][c])):
			bad = 'z at sample %d is not the source cell' % i
		elif ck['hFelM'][i] != int(round(g['hfel'][c])) or ck['hMafM'][i] != int(round(g['hmaf'][c])):
			bad = 'thickness at sample %d is not the source cell' % i
		elif ck['wet'][i] != (1 if g['z'][c] < 0 else 0) or ck['plate'][i] != g['plate'][c]:
			bad = 'flag at sample %d is not the source cell' % i
		elif i + 1 < len(spans) and not (ck['sKm'][i + 1] > ck['sKm'][i]):
			bad = 'sKm is not increasing at %d' % i
		if bad:
			break
	if bad:
		raise SystemExit('bake check failed: ' + bad)
	g2 = decode(pack)
	spans2, f2 = bake(g2, Circle(args.lat0, args.lon0, args.az0))
	if f2['sKm'] != f['sKm'] or f2['plate'] != f['plate'] or f2['zM'] != f['zM']:
		raise SystemExit('bake check failed: the walk is not reproducible')

	out = os.path.abspath(args.out)
	os.makedirs(os.path.dirname(out), exist_ok=True)
	wrap_bundle(out, args.id, canon, provenance)
	kb = os.path.getsize(out) / 1024.0
	if kb * 1024 > 535724 / 5:
		raise SystemExit('bake check failed: the bundle is not 5x smaller than the pack it replaces')

	report = [
		'bake %s' % args.id,
		'  source pack: %s (%dx%d raster, %s)' % (pack.get('name', args.pack), g['w'], g['h'], pack.get('source', '')),
		'  cut: circle through (%.6g, %.6g) az %.6g, max |lat| %.3f, closes' % (args.lat0, args.lon0, args.az0, max_lat),
		'  samples: %d, cells %.6g km, arc %.6g km' % (len(spans), cell_km, arc),
		'  checksum: %s' % ck['checksum'],
		'  bundle: %s (%.1f KB, gate: < %.0f KB = the 536 KB pack / 5)' % (out, kb, 535724 / 5 / 1024.0),
		'  profile: every sample equals its source cell (sKm, z, hFel, hMaf, wet, plate)  PASS',
		'  reproducibility: a second bake gives the same walk and fields  PASS',
	]
	print('\n'.join(report))
	if args.report:
		with open(args.report, 'w') as fh:
			fh.write('\n'.join(report) + '\n')


if __name__ == '__main__':
	main()
