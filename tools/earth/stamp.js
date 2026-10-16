/* stamp.js — bake_section.py's stamp step: one format, one owner (sync plan §2.8).
   The bake assembles plain numbers; the shared slice-format.js quantises, checksums,
   validates and verifies them, so a baked pack is the same object a drawn pack is.
   FROZEN and unrunnable under v2 (0.4.2, archive/0.4.2-counterpart-audit-response.md F4.3):
   this calls SP.normalize / SP.quantize, which the pgt-slice-pack v2 codec keeps internal and
   does not export, so it throws TypeError against port/slice-format.js today. Do not repair it
   in either direction — porting it to make/seal would resurrect a private bake against
   earth-1deg.js (0.4.2-plan.md A3 forbids it) and exporting those two from the codec would be a
   unilateral edit to a shared file (boundary 5). Regeneration is the globe's Node CLI
   tools/earth/bake_section.js only. Kept as the 0.4.1 M4 record.
   argv: <slice-format.js> <raw-pack.json> — the canonical pack JSON goes to stdout. */
'use strict';

var fs = require('fs');
var SP = require(process.argv[2]);

var pack = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
SP.normalize(pack);
SP.quantize(pack);
pack.checksum = SP.checksum(pack);
var bad = SP.validate(pack) || SP.verify(pack);
if (bad) {
	console.error(bad);
	process.exit(1);
}
process.stdout.write(SP.encode(pack, false));
