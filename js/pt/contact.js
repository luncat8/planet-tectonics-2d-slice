// pt/contact.js — 0.3.0 P4.0: the inter-plate contact kernel (0.3.0-p4-plan.md §3 P4.0).
// P3 closed the melt-to-plate path with a closed ledger, so the mechanical question P2
// deliberately left open can be asked: two plates that converge currently pass through each
// other, and the surface orogen term that reads their convergence is a kinematic proxy, not a
// contact response. This is that response, at the lid scale the plan's gate is about.
//
// A contact is a pair of adjacent surface columns held by different clusters whose velocities
// close on each other above P.contactYield. The pass finds them from the same per-column
// shallowest-crust-marker reading the relief terms take, one frame earlier, and answers in one
// of two regimes (params.js):
//
//   subduction  the colder side is denser than the warmer side by at least P.contactdT. The
//               colder plate subducts: it keeps its velocity, and its leading band bends down
//               along P.contactDip beneath the override, whose approach is held. The band's
//               velocity blends from the plate's rigid velocity at its inner edge to the slab
//               velocity at the trench, so the bend rotates the velocity instead of stretching
//               it: the slab speed is the subducting plate's own approach, because the hold has
//               just made the trench stationary, and the closing rate is what the shortening
//               counter books.
//   arrest      no usable contrast. Both clusters take a mass-weighted share of the correction
//               that cancels the closing -- a balanced impulse pair -- and nothing bends. The
//               convergence is recorded in S.ctConv for the relief terms, because a locked
//               boundary that keeps converging is a boundary that keeps thickening.
//
// The kernel changes velocities and positions only: it never touches mass, enthalpy,
// composition, melt, phase or id, so the P3 ledgers close bitwise across it by construction.
// Momentum is not a conserved quantity in this engine (the mantle advection itself moves
// markers by an interpolated flow), and the subduction brake's hold is deliberately
// unbalanced -- the reaction a real override carries is mantle traction the one-way Stokes
// coupling does not model -- so brake() books the momentum it injects in S.contactHold
// rather than hiding it.
//
// The order inside G4 (solid.js) is: fit, detect, brake, projection, hinge, guard. The brake
// has to correct the cluster's rigid velocity before the projection moves markers with it,
// and the bending band has to move markers *instead of* the projection, which is why the
// projection skips them and this kernel moves them itself.
//
// One global per new file (0.3.0-p3-plan.md §6): the IIFE's only export is PTCONTACT.
'use strict';

(function () {
	var P = (typeof module !== 'undefined' && module.exports) ? require('./params.js') : window.PTP;
	var G = (typeof module !== 'undefined' && module.exports) ? require('./grid.js') : window.PTG;

	var CONTACT = {
		// The per-frame table, the sites, the brake demands and the bending bands, in one
		// pass over the lid band and one over the columns. `dt` is the geological substep:
		// zero reports the table and changes nothing, like every other geological kernel.
		detect: function (M, S, dt) {
			var nx = M.nx, dx = M.dx, wrap = M.wrap, K = P.ctTop;
			var cl = S.cl, ph = S.ph, sol = P.PH_SOLID, x = S.x, y = S.y;
			var ctCl = S.ctCl, ctY = S.ctY, ctP = S.ctP, ctT = S.ctT, ctV = S.ctV, ctN = S.ctN;
			var csVX = S.csVX, csVY = S.csVY, csW = S.csW, csX = S.csX, csY = S.csY, csM = S.csM;
			var hinge = S.hinge, hgCl = S.hgCl, hgX = S.hgX, S_ = S.hgS, hgC = S.hgC;
			var hvx = S.hvx, hvy = S.hvy;
			var p, i, ip, k, a, b, c, n, base, v, t, sites = 0, worst = 0, hold = 0, hgN = 0, over = 0;
			var ca, cb, closing, dT, sub, xh, u, mA, mB, mt, vrx, vry, rx, ry;

			// the bending-band workspace is consumed by hinge() in the same frame: clear it
			// here so the first band to claim a marker wins and no stale flag survives
			for (p = 0; p < S.n; p++) hinge[p] = 0;
			for (i = 0; i < nx; i++) { ctN[i] = 0; S.ctConv[i] = 0; S.ctSite[i] = 0; }

			// the shallowest strong crust marker of each cluster, per column. The velocity is
			// the cluster's rigid one at that marker, rotation included, so the closing rate
			// below is what the two plates are doing where they meet.
			for (p = 0; p < S.n; p++) {
				c = cl[p];
				if (c < 0 || !sol[ph[p]] || y[p] > P.yCrust) continue;
				i = Math.round(x[p] / dx);
				i -= Math.floor(i / nx) * nx;
				base = i * K;
				n = ctN[i];
				for (k = 0; k < n; k++) if (ctCl[base + k] === c) break;
				v = csVX[c] - csW[c] * (y[p] - csY[c]);
				if (k < n) {
					if (y[p] < ctY[base + k]) {
						ctY[base + k] = y[p]; ctP[base + k] = p;
						ctT[base + k] = S.T[p]; ctV[base + k] = v;
					}
				} else if (n < K) {
					ctN[i] = n + 1;
					ctCl[base + n] = c; ctY[base + n] = y[p]; ctP[base + n] = p;
					ctT[base + n] = S.T[p]; ctV[base + n] = v;
				}
			}

			// adjacent columns, different clusters, closing above the yield. The site is the
			// boundary between the two columns; the closing rate is the left column's plate
			// moving into the right column's.
			for (i = 0; i < nx; i++) {
				ip = i + 1 === nx ? 0 : i + 1;
				for (a = 0; a < ctN[i]; a++) for (b = 0; b < ctN[ip]; b++) {
					ca = ctCl[i * K + a]; cb = ctCl[ip * K + b];
					if (ca === cb) continue;
					closing = (ctV[i * K + a] - ctV[ip * K + b]) / dx;
					if (closing <= P.contactYield) continue;
					sites++;
					if (closing > worst) worst = closing;
					S.contactShort += closing * dx * dt;
					S.ctSite[i] = 1;
					// the temperature contrast decides the regime: the colder side is the
					// denser one (plan §1.1, T is the engine's only density proxy), so it is
					// the one that goes under. sub = 0 numbers the left plate as subducting,
					// which happens exactly when it is the colder of the two.
					dT = ctT[i * K + a] - ctT[ip * K + b];       // > 0: the left column is warmer
					sub = dT >= 0 ? 1 : 0;                        // 0: the left plate subducts
					if ((dT < 0 ? -dT : dT) < P.contactdT) {
						// arrest: the correction that cancels the closing, split by mass, so
						// the pair is one balanced impulse and the two clusters' combined
						// momentum is unchanged
						mA = csM[ca]; mB = csM[cb]; mt = mA + mB;
						if (!(mt > 0)) continue;
						S.csBX[ca] -= closing * dx * mB / mt; S.csBN[ca]++;
						S.csBX[cb] += closing * dx * mA / mt; S.csBN[cb]++;
						S.ctConv[i] = closing;                    // the belt's source, kept
						continue;
					}
					// subduction: the colder plate is free to feed the trench, the warmer one
					// is held. The hold cancels the override's approach along the trench
					// direction and nothing else -- it may roll back, it may not advance --
					// so the rule is idempotent and the convergence the slab takes up is the
					// subducting plate's own speed. The impulse is not balanced (see the
					// header): brake() books it in S.contactHold and S.d.hold counts the sites.
					hold++;
					xh = (i + 0.5) * dx;
					if (sub === 0) {
						if (ctV[ip * K + b] < 0) { S.csBX[cb] -= ctV[ip * K + b]; S.csBN[cb]++; }
					} else if (ctV[i * K + a] > 0) {
						S.csBX[ca] -= ctV[i * K + a]; S.csBN[ca]++;
					}
					if (hgN < P.ctHinge) {
						hgCl[hgN] = sub === 0 ? ca : cb;
						hgX[hgN] = xh;
						S_[hgN] = sub === 0 ? 1 : -1;             // the direction into the trench
						// the slab's speed is the subducting plate's own approach, not the
						// closing rate. The hold has just made the override stationary, so the
						// trench does not migrate and the plate arrives at the trench at its own
						// speed -- which is also what makes the bend a rotation of that velocity
						// rather than a stretch: at t = 1 the marker's speed is the plate's. The
						// closing rate is what S.contactShort books, and the two differ by the
						// override's cancelled approach.
						v = sub === 0 ? ctV[i * K + a] : -ctV[ip * K + b];
						hgC[hgN] = v > 0 ? v : 0;
						hgN++;
					} else over++;                                // a site the cap left unbent
				}
			}
			S.hgN = hgN; S.hgOver += over;
			S.d.contact = sites; S.d.contactC = worst; S.d.hold = hold; S.d.over = over;

			// the bending bands. A marker belongs to the band of the subducting cluster when
			// it is on that cluster's side of a site, inside the band's reach, and still in
			// the lid. Its target velocity blends from the cluster's rigid velocity at the
			// inner edge (t = 0, no discontinuity with the plate behind) to the slab velocity
			// at the trench (t = 1), so the band shears into the dip instead of tearing.
			if (!hgN) return;
			var cos = P.contactCos, sin = P.contactSin, band = P.contactBand;
			for (p = 0; p < S.n; p++) {
				if (hinge[p] || !sol[ph[p]] || y[p] > P.yCrust) continue;
				c = cl[p];
				if (c < 0) continue;
				for (k = 0; k < hgN; k++) {
					if (hgCl[k] !== c) continue;
					u = S_[k] * (hgX[k] - x[p]);
					u -= Math.floor(u / wrap + 0.5) * wrap;
					if (u < 0 || u > band) continue;
					rx = x[p] - csX[c];
					rx -= Math.floor(rx / wrap + 0.5) * wrap;
					ry = y[p] - csY[c];
					vrx = csVX[c] - csW[c] * ry;
					vry = csVY[c] + csW[c] * rx;
					// u measures the distance behind the hinge, so the blend runs the other
					// way round: t = 0 at the band's inner edge (the plate behind, no
					// discontinuity) and t = 1 at the trench, where the marker takes the
					// slab's own velocity and the bend is a rotation, not a stretch
					t = 1 - u / band;
					hvx[p] = vrx + t * (S_[k] * hgC[k] * cos - vrx);
					hvy[p] = vry + t * (hgC[k] * sin - vry);
					hinge[p] = 1;
					break;
				}
			}
		},

		// the mean of each cluster's demanded corrections. A cluster pressed at several
		// boundaries takes the average, which never over-corrects into separation; what the
		// average leaves closing is the guard's business and is counted there.
		//
		// This is also where the momentum the pass injects is booked. An arrest pair cancels
		// inside this loop by construction, so what survives in S.contactHold is the subduction
		// hold's unbalanced impulse -- the one place P4 adds momentum (plan §1.2). It is booked
		// signed, because two trenches holding opposite ways really do cancel in the plate
		// population's momentum, and the cancellation is a fact about the run rather than a
		// reason to hide one of them.
		brake: function (M, S) {
			var c, n = S.csBN, bx = S.csBX, vx = S.csVX, m = S.csM, dv;
			for (c = 0; c < S.csN; c++) {
				if (!n[c]) continue;
				dv = bx[c] / n[c];
				vx[c] += dv;
				S.contactHold += m[c] * dv;
				bx[c] = 0; n[c] = 0;
			}
		},

		// the bending band's own motion: the projection skipped these markers, so this is
		// where they move. The slab speed detect() wrote is the subducting plate's own approach
		// to the trench the hold is holding still.
		hinge: function (M, S, dt) {
			var p, dy, ym, n = 0, hvx = S.hvx, hvy = S.hvy, hinge = S.hinge;
			for (p = 0; p < S.n; p++) {
				if (!hinge[p]) continue;
				S.vx[p] = hvx[p]; S.vy[p] = hvy[p];
				dy = hvy[p] * dt;
				ym = S.y[p] + 0.5 * dy;
				S.x[p] += hvx[p] * dt;
				S.y[p] += dy;
				S.e[p] += dy / Math.sqrt(M.yLin * M.yLin + ym * ym);
				G.keepInside(M, S, p);
				hinge[p] = 0;
				n++;
			}
			S.d.subduct = n;
		},

		// the no-penetration guard: the discrete statement of the plan's gate. Inter-cluster
		// crust markers closer than P.contactHard of a cell are pushed apart along their
		// separation, half each, so neither plate is preferred. It is the last step of the frame
		// and it moves positions only -- mass, enthalpy and every other field ride the parcel
		// and are untouched.
		//
		// One sweep is not always enough: where several pairs share a marker, separating p from
		// q can push p into r. The sweep therefore repeats while it finds work, so a frame ends
		// with nothing inside its own hard radius instead of a residue the next frame has to
		// find again (measured: a single sweep left up to three pairs on 10% of the live
		// planet's frames). P.ctSweep bounds it; the count it reports is every push, not every
		// pair, so a pair two sweeps needed is booked twice -- which is what "how often the
		// velocity-level response left work for it" asks.
		guard: function (M, S) {
			var hard = P.contactHard * M.dx, s, n = 0, pushed = 0;
			for (s = 0; s < P.ctSweep; s++) {
				n = sweep(M, S, hard, true);
				pushed += n;
				if (!n) break;
			}
			// What the sweeps left is the plan's gate as a number: "colliding plates do not
			// interpenetrate" is this being zero. It is read here, where the table is live,
			// because a frame's later kernels move parcels the table names -- a wholly molten
			// one leaves for the melt pass, and every removal compacts the pool's tail into the
			// hole it made -- so a re-read at the end of the frame is not this number.
			S.d.resid = n ? sweep(M, S, hard, false) : 0;
			S.d.push = pushed;
			S.contactPush += pushed;
		}
	};

	// One pass over the table the frame built: every inter-cluster pair inside the hard radius
	// is separated along its own direction, half each, so neither plate is preferred. With
	// `move` false it only counts them, which is how the guard reports what it left.
	//
	// The radius is squared with a rounding slop because a separation the push has already
	// achieved *is* a separation: it lands the pair on the radius to within an ulp, and a
	// strict test then finds it still inside and chases the rounding for as many sweeps as it
	// is given (measured: pairs at d/hard = 1.000 survived twenty extra sweeps, and every one
	// of the live planet's residues was such a pair).
	function sweep(M, S, hard, move) {
		var nx = M.nx, wrap = M.wrap, K = P.ctTop, h2 = hard * hard * (1 - 1e-12);
		var i, ip, a, b, p, q, ddx, ddy, d2, d, push, ux, uy, n = 0;
		for (i = 0; i < nx; i++) {
			ip = i + 1 === nx ? 0 : i + 1;
			for (a = 0; a < S.ctN[i]; a++) for (b = 0; b < S.ctN[ip]; b++) {
				if (S.ctCl[i * K + a] === S.ctCl[ip * K + b]) continue;
				p = S.ctP[i * K + a]; q = S.ctP[ip * K + b];
				ddx = S.x[q] - S.x[p];
				ddx -= Math.floor(ddx / wrap + 0.5) * wrap;
				ddy = S.y[q] - S.y[p];
				d2 = ddx * ddx + ddy * ddy;
				if (d2 >= h2 || d2 < 1e-6) continue;
				n++;
				if (!move) continue;
				d = Math.sqrt(d2);
				push = 0.5 * (hard - d);
				ux = ddx / d; uy = ddy / d;
				S.x[p] -= ux * push; S.y[p] -= uy * push;
				S.x[q] += ux * push; S.y[q] += uy * push;
				// the push is a move like any other, so it ends the same way: eta rebuilt from
				// y, then the domain's own rule for a marker the move took outside it, which
				// also folds x through the seam (grid.js keepInside)
				S.e[p] = Math.asinh(S.y[p] / M.yLin); G.keepInside(M, S, p);
				S.e[q] = Math.asinh(S.y[q] / M.yLin); G.keepInside(M, S, q);
			}
		}
		return n;
	}

	if (typeof module !== 'undefined' && module.exports) module.exports = CONTACT; else window.PTCONTACT = CONTACT;
}());
