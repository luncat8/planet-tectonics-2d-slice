// pc/opt.js — 0.5.0 M1: the option registry (0.5.0-plan.md §3.5).
//
// The request's open questions "may be hard to solve by calculation and may need just options
// to choose and adjust in GUI and see how it behaves", so the registry is a deliverable and
// not a convenience. One table owns every knob: id, kind, range, default per engine, whether
// it applies live or only at the next planet, and which section of the plan owns the default.
// The pages carry a static bar whose elements name their registry entry in `data-pc-opt`;
// experiments/pc-opt.js asserts registry and bar agree entry for entry — id, kind, range,
// default — so the GUI cannot drift from this table.
//
// Engine scoping: `engine: 'both'` entries appear on both pages, `'hy'` and `'sp'` on one.
// The defaults that M0 decided per engine are spelled per engine (`def: { hy: 0, sp: 0.98 }`),
// which is why a value lives in an instance (`PCOPT.make('sp')`) and the table does not.
//
// Live vs reset: a live option takes effect on the next frame; a reset option is staged in
// `pending` and torn down at the next planet, because changing it mid-run would invalidate
// the state it set up (particle size, the coordinate space, a bond layout).
'use strict';

(function (root) {
	// kind: 'range' | 'toggle' | 'enum'. `def` is a number, a boolean or a string, or a map
	// keyed by engine when M0 measured a different default for each.
	// `owner` names the plan section that owns the default; `note` is the one-line reason a
	// reader of the bar deserves.
	var REG = [
		// ---- the clock and the scenario preset -------------------------------------------
		{ id: 'clock', engine: 'both', kind: 'range', min: 5, max: 500, step: 5, def: 50,
			live: true, owner: '§3.4', label: 'clock', unit: 'kyr/frame',
			note: 'geological clock; the wall clock runs only the airborne pass' },
		{ id: 'scenario', engine: 'both', kind: 'enum', values: ['S1', 'S2', 'S3', 'S4'],
			def: 'S1', live: true, owner: '§3.6', label: 'scenario',
			note: 'the preset: clock, camera and a few options together' },

		// ---- particles ------------------------------------------------------------------
		{ id: 'partSize', engine: 'both', kind: 'range', min: 0.5, max: 2, step: 0.1, def: 1,
			live: false, owner: '§6', label: 'size',
			note: 'spacing, not mass: shrinking a parcel keeps its weight and raises its density' },
		{ id: 'sizeByHeat', engine: 'both', kind: 'range', min: 0, max: 0.5, step: 0.05, def: 0,
			live: true, owner: '§6', label: 'hot shrink',
			note: 'off until the M5 crack-flow leg measures it' },
		{ id: 'sizeByMaterial', engine: 'both', kind: 'toggle', def: true, live: false,
			owner: '§6', label: 'material size',
			note: 'eruption seeds fine parcels, buried ones coarsen' },
		{ id: 'links', engine: 'both', kind: 'toggle', def: true, live: false, owner: '§2',
			label: 'links',
			note: 'crust bonds on or off; the soup needs them to have plates at all' },

		// ---- mechanics ------------------------------------------------------------------
		{ id: 'inertia', engine: 'both', kind: 'range', min: 0, max: 0.99, step: 0.01,
			def: { hy: 0, sp: 0.98 }, live: true, owner: '§6', label: 'inertia',
			note: 'carried circulation, retention per 50 kyr; M0 selected SP 0.98, HY overdamped' },
		{ id: 'substepCap', engine: 'both', kind: 'range', min: 0.1, max: 0.5, step: 0.05,
			def: 0.35, live: true, owner: '§6', label: 'substep',
			note: 'displacement cap in diameters; 0.35 is the tunnelling gate, not a safety hope' },
		{ id: 'mobContrast', engine: 'both', kind: 'range', min: 0, max: 8, step: 1,
			def: { hy: 4, sp: 0 }, live: true, owner: '§6', label: 'mobility',
			note: 'e-folds of hot-over-cold mobility; SP 0 selected by M0\'s 300 Myr leg' },

		// ---- strength -------------------------------------------------------------------
		{ id: 'yieldRate', engine: 'both', kind: 'range', min: 0.25, max: 4, step: 0.25, def: 1,
			live: true, owner: '§3.3', label: 'yield x',
			note: 'multiplier on 0.3\'s 0.06 /Myr elastic rate' },
		{ id: 'kDamage', engine: 'both', kind: 'range', min: 0.25, max: 4, step: 0.25, def: 1,
			live: true, owner: '§3.3', label: 'damage x',
			note: 'multiplier on 0.3\'s 90 /Myr per unit excess' },
		{ id: 'tauHeal', engine: 'both', kind: 'range', min: 0.25, max: 4, step: 0.25, def: 1,
			live: true, owner: '§3.3', label: 'heal x',
			note: 'multiplier on 0.3\'s 40 Myr annealing time' },
		{ id: 'solidusOf', engine: 'both', kind: 'enum', values: ['depth', 'load'],
			def: 'load', live: true, owner: '§3.1', label: 'solidus',
			note: 'load is the physical source; depth is the 0.3 comparison and S4\'s control' },

		// ---- the hybrid's own ------------------------------------------------------------
		{ id: 'projIters', engine: 'hy', kind: 'range', min: 8, max: 40, step: 2, def: 20,
			live: true, owner: '§4.3', label: 'sweeps',
			note: 'red-black sweeps per frame, split between the viscous relaxation and the pressure projection; neither is converged, both are warm-started' },
		{ id: 'advect', engine: 'hy', kind: 'enum', values: ['donor', 'maccormack'],
			def: 'donor', live: true, owner: '§4.3', label: 'advect',
			note: 'donor is conservative and diffusive; MacCormack is the sharpness option' },

		// ---- the soup's own --------------------------------------------------------------
		{ id: 'space', engine: 'sp', kind: 'enum', values: ['screen', 'km'], def: 'screen',
			live: false, owner: '§6', label: 'space',
			note: 'screen is round by construction; km is physically isotropic and cross-checks it' },
		{ id: 'magmaMode', engine: 'sp', kind: 'enum', values: ['pbf', 'contact'], def: 'pbf',
			live: true, owner: '§6', label: 'magma',
			note: 'PBF for the mantle; contact is the granular/deposit mode, not an S1 path' },
		{ id: 'pbfIters', engine: 'sp', kind: 'range', min: 1, max: 4, step: 1, def: 2,
			live: true, owner: '§6', label: 'PBF sweeps',
			note: 'two sweeps at 6,656 particles is the M0-selected kernel' },
		{ id: 'heatMode', engine: 'sp', kind: 'enum', values: ['analytic', 'explicit'],
			def: 'analytic', live: true, owner: '§5.4', label: 'heat',
			note: 'analytic is the exact two-parcel exponential; explicit is the CFL control' },
		{ id: 'alphaScale', engine: 'sp', kind: 'range', min: 0.25, max: 4, step: 0.25, def: 1,
			live: false, owner: '§5.4', label: 'conduction x',
			note: 'pair exchange coefficient multiplier' },
		{ id: 'kappaScale', engine: 'sp', kind: 'range', min: 0.25, max: 4, step: 0.25, def: 1,
			live: false, owner: '§5.4', label: 'carry x',
			note: 'carried-circulation heat transport multiplier' },

		// ---- overlays -------------------------------------------------------------------
		{ id: 'markers', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'markers', note: 'draw the parcels' },
		{ id: 'melt', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'melt', note: 'colour by equilibrium melt fraction' },
		{ id: 'crust', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'crust', note: 'solid parcels as rock rather than as heat' },
		{ id: 'relief', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'relief', note: 'the pile top per column is the horizon' },
		{ id: 'ruler', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'ruler', note: 'the asinh depth ruler' },
		{ id: 'bonds', engine: 'both', kind: 'toggle', def: true, live: true, owner: '§7',
			label: 'bonds web', note: 'a plate is only visible as a thing with its bonds drawn' }
	];

	function entryOf(id) {
		var i;
		for (i = 0; i < REG.length; i++) if (REG[i].id === id) return REG[i];
		return null;
	}

	function applies(entry, engine) {
		return entry.engine === 'both' || entry.engine === engine;
	}

	// the registry as one page sees it, in table order
	function forEngine(engine) {
		var out = [], i;
		for (i = 0; i < REG.length; i++) if (applies(REG[i], engine)) out.push(REG[i]);
		return out;
	}

	function defaultOf(entry, engine) {
		var d = entry.def;
		return (d !== null && typeof d === 'object') ? d[engine] : d;
	}

	// clamp/validate a proposed value against the entry's own range
	function coerce(entry, v) {
		if (entry.kind === 'toggle') return !!v;
		if (entry.kind === 'enum') return entry.values.indexOf(String(v)) >= 0 ? String(v) : null;
		v = Number(v);
		if (!(v === v)) return NaN;
		if (v < entry.min) v = entry.min;
		if (v > entry.max) v = entry.max;
		return v;
	}

	var PCOPT = {
		REG: REG,
		entry: entryOf,
		forEngine: forEngine,
		defaultOf: defaultOf,
		coerce: coerce,

		// a value set for one engine. `values` is what the engine reads this frame; `pending`
		// holds reset-scope changes until commit() (the next planet).
		make: function (engine, onChange) {
			var opts = {
				engine: engine,
				values: {},
				pending: {},
				onChange: onChange || null,

				// every entry this engine sees, with its current value
				list: function () { return forEngine(engine); },

				entry: function (id) {
					var e = entryOf(id);
					if (!e || !applies(e, engine)) throw new Error('option not on this engine: ' + id);
					return e;
				},

				def: function (id) { return defaultOf(this.entry(id), engine); },

				get: function (id) {
					return (id in this.values) ? this.values[id] : this.def(id);
				},

				// what the bar shows: a staged reset-scope value is already the user's choice,
				// so the control reflects it while the engine keeps reading the committed one
				// until the next planet. Without this a click on a reset toggle would look
				// like it did nothing.
				shown: function (id) {
					return (id in this.pending) ? this.pending[id] : this.get(id);
				},

				// stage or apply one change. Returns true when it took effect now.
				set: function (id, v, silent) {
					var e = this.entry(id), val = coerce(e, v);
					if (val === null || val !== val) return false;
					if (e.live) {
						if (this.values[id] === val) return true;
						this.values[id] = val;
						if (this.onChange && !silent) this.onChange(id, val, e);
						return true;
					}
					if (this.pending[id] === val) return false;
					this.pending[id] = val;
					return false;
				},

				// apply the staged set: called when a new planet is built, because a reset
				// option's whole point is that the state it configures is rebuilt
				commit: function () {
					var id, changed = [];
					for (id in this.pending) {
						if (this.values[id] !== this.pending[id]) {
							this.values[id] = this.pending[id];
							changed.push(id);
						}
					}
					this.pending = {};
					return changed;
				},

				pendingList: function () {
					var out = [], id;
					for (id in this.pending) out.push(id);
					return out;
				},

				// back to the registry's defaults (a page's "reset options")
				resetAll: function () {
					var i, e, changed = [];
					this.values = {};
					this.pending = {};
					for (i = 0; i < REG.length; i++) {
						e = REG[i];
						if (applies(e, engine)) changed.push(e.id);
					}
					return changed;
				},

				// the multipliers the bond law reads (0.3's constants scaled, never replaced)
				scale: function (id) { return this.get(id); }
			};
			return opts;
		},

		// Wire a page's static bar to an option set. The registry is the runtime authority:
		// every element is written from it at bind time and after every change, so markup and
		// table can only disagree in a way the parity harness sees.
		bind: function (rootEl, opts, onLive) {
			if (!rootEl || !rootEl.querySelectorAll) return null;
			var els = rootEl.querySelectorAll('[data-pc-opt]'), i, el, id, e, syncOne, sync;
			var bound = [];

			// the readout beside a range control, so the bar shows the number instead of
			// asking the reader to infer it from a thumb position
			syncOne = function (el, id, e) {
				var v = opts.shown(id), k;
				if (e.kind === 'range') {
					el.value = String(v);
					if (el._pcVal) el._pcVal.textContent = String(v);
					return;
				}
				if (e.kind === 'toggle') { el.setAttribute('aria-pressed', v ? 'true' : 'false'); return; }
				for (k = 0; k < el.options.length; k++) {
					el.options[k].selected = el.options[k].value === String(v);
				}
			};

			sync = function () {
				var j;
				for (j = 0; j < bound.length; j++) syncOne(bound[j].el, bound[j].id, bound[j].e);
			};

			for (i = 0; i < els.length; i++) {
				el = els[i];
				id = el.getAttribute('data-pc-opt');
				e = PCOPT.entry(id);
				if (!e) continue;
				if (e.kind === 'range') {
					el._pcVal = rootEl.querySelector('[data-pc-val="' + id + '"]');
				}
				bound.push({ el: el, id: id, e: e });
				(function (el, id, e) {
					if (e.kind === 'toggle') {
						el.addEventListener('click', function () {
							opts.set(id, !opts.shown(id));
							sync();
							if (onLive) onLive(id, opts.shown(id));
						});
						return;
					}
					if (e.kind === 'enum') {
						el.addEventListener('change', function () {
							opts.set(id, el.value);
							sync();
							if (onLive) onLive(id, opts.shown(id));
						});
						return;
					}
					el.addEventListener('input', function () {
						opts.set(id, Number(el.value));
						sync();
						if (onLive) onLive(id, opts.shown(id));
					});
				}(el, id, e));
			}
			sync();
			return sync;
		}
	};

	if (typeof module !== 'undefined' && module.exports) module.exports = PCOPT;
	else root.PCOPT = PCOPT;
}(typeof window !== 'undefined' ? window : this));
