/* stamp.js — bake_section.py's stamp step: one format, one owner (sync plan §2.8).
   The bake assembles plain numbers; the shared slice-format.js quantises, checksums,
   validates and verifies them, so a baked pack is the same object a drawn pack is.
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
