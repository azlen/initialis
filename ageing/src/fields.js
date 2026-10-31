// Where things happen, from seeds: lists of rings, creases, strips and tears for the shader's
// geometry buffer, and arrival-time maps for things that spread or multiply (mould colonies,
// worm tunnels). An arrival map holds, per texel, when (0..1 of the effect's amount)
// it is first reached, so one texture grows smoothly as the amount slides up.

import { MM, PAGE_W as W, PAGE_H as H, TEXT_X } from './page.js?v=a8136959';
import { GEO } from './shader.js?v=a8136959';
import { FX } from './effects.js?v=a8136959';

export function rng(seed) {
	let a = (seed * 2654435761) >>> 0 || 1;
	const r = () => {
		a = (a + 0x6D2B79F5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
	r.range = (lo, hi) => lo + (hi - lo) * r();
	r.normal = () => { const u = Math.max(r(), 1e-9), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
	return r;
}
const opt = (id, k, v) => FX[id].params.find(p => p.k === k).options.indexOf(v);
const sel = (s, id, k) => { const v = s[k]; const i = opt(id, k, v); return i >= 0 ? i : +v || 0; };

// ── the geometry buffer ─────────────────────────────────────────────────────────────────────
export function buildGeo(state) {
	const g = new Float32Array(GEO.size * 4);
	const put = (i, a, b, c, d) => g.set([a, b, c, d], i * 4);
	const counts = { coffee: 0, grease: 0, folds: 0, crumple: 0, tape: 0, rust: 0, prints: 0, tear: 0, smudge: 0, tearKind: 0 };
	const fx = state.fx;

	// coffee: a ring or two from the cup's foot, splashes
	{
		const s = fx.coffee, R = rng(s.seed * 7 + 1);
		const rings = 1 + Math.round(s.count * 2);
		let n = 0;
		const r0 = (26 + s.size * 16) * MM;
		const c0 = [R.range(0.15, 0.95) * W, R.range(0.1, 0.9) * H];
		for (let i = 0; i < rings && n < 16; i++) {
			const c = i === 0 ? c0 : [c0[0] + R.range(-18, 18) * MM, c0[1] + R.range(-18, 18) * MM];
			const full = R() < 0.4;
			put(GEO.coffee + n * 2, c[0], c[1], r0 * R.range(0.96, 1.04), R.range(0.5, 1.1) * MM);
			put(GEO.coffee + n * 2 + 1, R() * Math.PI * 2, full ? 1 : R.range(0.55, 0.92), i === 0 ? 1 : R.range(0.4, 0.75), 0);
			n++;
		}
		const drops = Math.round(s.splash * 12);
		for (let i = 0; i < drops && n < 16; i++) {
			const a = R() * Math.PI * 2, d = r0 * R.range(0.9, 1.7);
			put(GEO.coffee + n * 2, c0[0] + Math.cos(a) * d, c0[1] + Math.sin(a) * d, R.range(0.6, 3.2) * MM, R.range(0.3, 0.6) * MM);
			put(GEO.coffee + n * 2 + 1, 0, 1, R.range(0.5, 1), 1);
			n++;
		}
		counts.coffee = n;
	}

	// grease spots
	{
		const s = fx.grease, R = rng(s.seed * 11 + 2);
		const n = 1 + Math.round(s.count * 4);
		const c0 = [R.range(0.2, 0.9) * W, R.range(0.15, 0.9) * H];
		for (let i = 0; i < n; i++) {
			const c = i === 0 ? c0 : [c0[0] + R.normal() * 22 * MM, c0[1] + R.normal() * 22 * MM];
			put(GEO.grease + i * 2, c[0], c[1], (3 + s.size * 15) * MM * R.range(0.4, 1.1), R.range(0.6, 1));
		}
		counts.grease = n;
	}

	// folds: like a letter, a little off true
	{
		const s = fx.folds, R = rng(s.seed * 13 + 3);
		const pat = sel(s, 'folds', 'pattern');
		const lines = [];
		const hz = (y) => lines.push([[W / 2, y], [0, 1]]);
		const vt = (x) => lines.push([[x, H / 2], [1, 0]]);
		if (pat === 0) hz(H / 2);
		else if (pat === 1) { hz(H / 3); hz(2 * H / 3); }
		else if (pat === 2) { hz(H / 2); vt(W / 2); }
		else { hz(H / 3); hz(2 * H / 3); vt(W / 2); }
		lines.forEach(([o, n], i) => {
			const a = R.range(-0.012, 0.012);
			const nx = n[0] * Math.cos(a) - n[1] * Math.sin(a), ny = n[0] * Math.sin(a) + n[1] * Math.cos(a);
			put(GEO.folds + i * 2, o[0] + R.range(-3, 3) * MM * n[0], o[1] + R.range(-3, 3) * MM * n[1], nx, ny);
			put(GEO.folds + i * 2 + 1, i % 2 ? -1 : 1, R.range(0.018, 0.03), 0, 0);
		});
		counts.folds = lines.length;
	}

	// crumple: creases radiating from a few points (where the ball was crushed), plus long ones
	{
		const s = fx.crumple, R = rng(s.seed * 17 + 4);
		const segs = [];
		const hubs = 3 + Math.round(s.count * 6);
		for (let h = 0; h < hubs && segs.length < 48; h++) {
			const c = [R.range(-0.05, 1.05) * W, R.range(-0.05, 1.05) * H];
			const rays = 3 + Math.floor(R() * 4);
			const a0 = R() * Math.PI * 2;
			for (let k = 0; k < rays && segs.length < 48; k++) {
				const a = a0 + (k / rays) * Math.PI * 2 + R.range(-0.4, 0.4);
				const L = R.range(25, 110) * MM;
				segs.push([c[0], c[1], c[0] + Math.cos(a) * L, c[1] + Math.sin(a) * L]);
			}
		}
		const longs = Math.round(s.count * 8);
		for (let k = 0; k < longs && segs.length < 48; k++) {
			const c = [R() * W, R() * H], a = R() * Math.PI, L = R.range(80, 220) * MM;
			segs.push([c[0] - Math.cos(a) * L / 2, c[1] - Math.sin(a) * L / 2, c[0] + Math.cos(a) * L / 2, c[1] + Math.sin(a) * L / 2]);
		}
		segs.forEach((sg, i) => {
			put(GEO.crumple + i * 2, ...sg);
			put(GEO.crumple + i * 2 + 1, R() < 0.5 ? -1 : 1, R.range(0.012, 0.035), R.range(8, 30) * MM, 0);
		});
		counts.crumple = segs.length;
	}

	// tears: crisp jagged lines, a vertex every couple of millimetres with a jump at each
	const jag = (pts, R, amp, step) => {
		const out = [];
		const ph = [R() * 6, R() * 6, R() * 6];
		for (let i = 0; i + 1 < pts.length; i++) {
			const [a, b] = [pts[i], pts[i + 1]];
			const L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / step));
			const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
			for (let k = 0; k < n; k++) {
				const t = k / n, s = (out.length * step) / MM;
				const off = amp * (0.55 * Math.sin(s * 0.11 + ph[0]) + 0.3 * Math.sin(s * 0.37 + ph[1]) + 0.18 * Math.sin(s * 0.9 + ph[2]) + 0.35 * (R() - 0.5));
				out.push([a[0] + (b[0] - a[0]) * t + nx * off, a[1] + (b[1] - a[1]) * t + ny * off]);
			}
		}
		out.push(pts[pts.length - 1]);
		return out;
	};
	{
		const s = fx.tear, R = rng(s.seed * 19 + 5);
		const kind = sel(s, 'tear', 'kind');
		counts.tearKind = kind;
		let pts = [];
		const amt = Math.max(0.15, s.amount);
		if (kind === 0) {
			// a corner gone: from the top or bottom edge round to the fore-edge
			const low = R() < 0.6;
			const a = (22 + 45 * amt) * MM * R.range(0.8, 1.2), b = (22 + 45 * amt) * MM * R.range(0.8, 1.25);
			const y0 = low ? H : 0, sy = low ? -1 : 1;
			const mid = [W - a * R.range(0.35, 0.6), y0 + sy * b * R.range(0.35, 0.6)];
			const line = jag([[W - a, y0 - sy * 2], mid, [W + 2, y0 + sy * b]], R, 2.4 * MM, 2.4 * MM);
			pts = [[W - a, y0 - sy * 40], ...line, [W + 40, y0 + sy * b], [W + 40, y0 - sy * 40]];
			pts = pts.map(p => [...p, 0]);
		} else if (kind === 1) {
			// a split running in from an edge, wide at the mouth
			const side = R();
			let p0, dir;
			if (side < 0.5) { p0 = [W, R.range(0.2, 0.8) * H]; dir = Math.PI + R.range(-0.5, 0.5); }
			else if (side < 0.75) { p0 = [R.range(0.25, 0.85) * W, H]; dir = -Math.PI / 2 + R.range(-0.5, 0.5); }
			else { p0 = [R.range(0.25, 0.85) * W, 0]; dir = Math.PI / 2 + R.range(-0.5, 0.5); }
			const L = (20 + 70 * amt) * MM;
			const ctrl = [];
			for (let k = 0; k <= 4; k++) {
				const d = dir + R.range(-0.25, 0.25);
				const t = k / 4;
				ctrl.push([p0[0] + Math.cos(d) * L * t - (k === 0 ? Math.cos(dir) * 6 : 0), p0[1] + Math.sin(d) * L * t - (k === 0 ? Math.sin(dir) * 6 : 0)]);
			}
			const line = jag(ctrl, R, 1.4 * MM, 1.8 * MM);
			pts = line.map((p, i) => [...p, (0.06 + 0.75 * amt) * MM * Math.pow(1 - i / (line.length - 1), 1.5)]);
		} else {
			// a bite out of an edge
			const onSide = R() < 0.6;
			const r = (8 + 22 * amt) * MM;
			const c = onSide ? [W, R.range(0.2, 0.8) * H] : [R.range(0.3, 0.8) * W, H];
			const arc = [];
			const a0 = onSide ? Math.PI / 2 : 0, n = 9;
			for (let k = 0; k <= n; k++) {
				const a = a0 + Math.PI * k / n;
				const rr = r * R.range(0.75, 1.1);
				arc.push([c[0] + Math.cos(a) * rr * (onSide ? 1 : 1.3), c[1] - Math.sin(a) * rr * (onSide ? 1.3 : 1)]);
			}
			const line = jag(arc, R, 1.6 * MM, 2.2 * MM);
			const far = onSide ? [[W + 40, line[line.length - 1][1]], [W + 40, line[0][1]]] : [[line[line.length - 1][0], H + 40], [line[0][0], H + 40]];
			pts = [...line, ...far].map(p => [...p, 0]);
		}
		pts = pts.slice(0, 96);
		pts.forEach((p, i) => put(GEO.tear + i, p[0], p[1], p[2], 0));
		counts.tear = pts.length;
		counts.tearSplit = kind === 1 ? pts : null;
	}

	// tape: across the split if there is one, otherwise over the edge, holding something on
	{
		const s = fx.tape, R = rng(s.seed * 23 + 6);
		const n = 1 + Math.round(s.count * 2);
		for (let i = 0; i < n; i++) {
			let c, a;
			const split = fx.tear.amount > 0 && counts.tearKind === 1 && counts.tearSplit;
			if (i === 0 && split) {
				const pts = counts.tearSplit, m = pts[Math.floor(pts.length * R.range(0.15, 0.45))], m2 = pts[Math.min(pts.length - 1, Math.floor(pts.length * 0.5))];
				c = [m[0], m[1]];
				a = Math.atan2(m2[1] - m[1], m2[0] - m[0]) + Math.PI / 2 + R.range(-0.2, 0.2);
			} else {
				const e = Math.floor(R() * 3);
				if (e === 0) { c = [W - R.range(4, 16) * MM, R.range(0.15, 0.85) * H]; a = R.range(-0.3, 0.3); }
				else if (e === 1) { c = [R.range(0.2, 0.8) * W, R.range(4, 14) * MM]; a = Math.PI / 2 + R.range(-0.3, 0.3); }
				else { c = [R.range(0.2, 0.8) * W, R.range(0.2, 0.8) * H]; a = R() * Math.PI; }
			}
			put(GEO.tape + i * 2, c[0], c[1], a, R.range(38, 65) * MM);
			put(GEO.tape + i * 2 + 1, (R() < 0.6 ? 19 : 12.5) * MM, i === 0 ? 0 : R.range(0.05, 0.4), 0, 0);
		}
		counts.tape = n;
	}

	// rust: what the metal was
	{
		const s = fx.rust, R = rng(s.seed * 29 + 7);
		const kind = sel(s, 'rust', 'kind');
		let n = 0;
		if (kind === 0) {
			const x = R.range(0.3, 0.85) * W, L = R.range(30, 36) * MM, w = R.range(7.5, 9) * MM;
			const a = Math.PI / 2 + R.range(-0.15, 0.15);
			put(GEO.rust, x, L * 0.5 - 8 * MM, L, w);
			put(GEO.rust + 1, a, 0, 0, 0);
			n = 1;
		} else if (kind === 1) {
			const c = [R.range(0.08, 0.2) * W, R.range(0.04, 0.1) * H];
			for (let k = 0; k < 2; k++) {
				const a = -Math.PI / 4 + R.range(-0.15, 0.15), L = 12.5 * MM;
				const cx = c[0] + k * R.range(30, 60) * MM, cy = c[1] + k * R.range(-5, 30) * MM;
				put(GEO.rust + k * 2, cx - Math.cos(a) * L / 2, cy - Math.sin(a) * L / 2, cx + Math.cos(a) * L / 2, cy + Math.sin(a) * L / 2);
				put(GEO.rust + k * 2 + 1, 0, 0, 0, 1);
			}
			n = 2;
		} else {
			const c = [R.range(0.55, 0.85) * W, R.range(0.04, 0.15) * H], a = R.range(-0.5, 0.5), L = R.range(26, 34) * MM;
			put(GEO.rust, c[0] - Math.cos(a) * L / 2, c[1] - Math.sin(a) * L / 2, c[0] + Math.cos(a) * L / 2, c[1] + Math.sin(a) * L / 2);
			put(GEO.rust + 1, 0, 0, 0, 1);
			n = 1;
		}
		counts.rust = n;
	}

	// fingerprints near the corner that gets lifted
	{
		const s = fx.thumb, R = rng(s.seed * 31 + 8);
		const corner = sel(s, 'thumb', 'corner');
		const cs = corner === 0 ? [[W, H]] : corner === 1 ? [[W, 0]] : [[W, H], [W, 0]];
		let n = 0;
		for (const c of cs) {
			const k = 1 + Math.round(R() * 1.4);
			for (let j = 0; j < k && n < 4; j++) {
				const dx = R.range(9, 24) * MM, dy = R.range(10, 30) * MM;
				put(GEO.prints + n * 2, c[0] - dx, c[1] === 0 ? dy : c[1] - dy, R.range(6.5, 8.5) * MM, R.range(9, 11.5) * MM);
				put(GEO.prints + n * 2 + 1, R.range(-0.8, 0.4) + (c[1] === 0 ? Math.PI : 0), R(), R.range(0.5, 1), 0);
				n++;
			}
		}
		counts.prints = n;
	}

	// smudges, across the text
	{
		const s = fx.smudge, R = rng(s.seed * 37 + 9);
		const n = 1 + Math.round(s.count * 3);
		for (let i = 0; i < n; i++) {
			const c = [TEXT_X + R.range(0.1, 0.9) * 600, R.range(0.3, 0.85) * H];
			const a = s.angle * Math.PI * 2 + R.range(-0.25, 0.25);
			put(GEO.smudge + i * 2, c[0], c[1], R.range(14, 34) * MM, R.range(6, 9) * MM);
			put(GEO.smudge + i * 2 + 1, a, R.range(0.6, 1), 0, 0);
		}
		counts.smudge = n;
	}
	return { data: g, counts };
}

// ── arrival maps (g mould, b worm tunnels; r spare) ────────────────────────────────────────
export const FIELD_S = 2;   // texels per unit

export function fieldKey(state) {
	const f = state.fx;
	return JSON.stringify([f.mould.count, f.mould.size, f.mould.seed, f.worms.count, f.worms.holes, f.worms.seed]);
}

export function buildField(state) {
	const s = FIELD_S;
	const cv = new OffscreenCanvas(Math.round(W * s), Math.round(H * s));
	const ctx = cv.getContext('2d');
	ctx.fillStyle = '#fff';
	ctx.fillRect(0, 0, cv.width, cv.height);
	ctx.scale(s, s);
	ctx.globalCompositeOperation = 'darken';
	const spot = (x, y, r, birth, ch) => {
		const v = Math.round(Math.min(254, birth * 255));
		const col = ch === 0 ? `rgb(${v},255,255)` : ch === 1 ? `rgb(255,${v},255)` : `rgb(255,255,${v})`;
		const g = ctx.createRadialGradient(x, y, 0, x, y, r);
		g.addColorStop(0, col);
		g.addColorStop(1, '#fff');
		ctx.fillStyle = g;
		ctx.fillRect(x - r, y - r, r * 2, r * 2);
	};

	// mould: colonies from a damp corner of the shelf, satellites round each
	{
		const f = state.fx.mould, R = rng(f.seed * 43 + 11);
		const K = 1 + Math.round(f.count * 7);
		const base = [R() < 0.5 ? R.range(0.6, 1.0) * W : R.range(0, 0.4) * W, R.range(0.55, 1.0) * H];
		for (let k = 0; k < K; k++) {
			const c = k === 0 ? base : [base[0] + R.normal() * 45 * MM, base[1] + R.normal() * 45 * MM];
			const r = (6 + f.size * 26) * MM * R.range(0.5, 1.2);
			const b0 = R.range(0, 0.35) + k * 0.04;
			spot(c[0], c[1], r, b0, 1);
			const sats = 4 + Math.floor(R() * 12);
			for (let j = 0; j < sats; j++) {
				const a = R() * Math.PI * 2, d = r * R.range(0.6, 1.8);
				spot(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d, r * R.range(0.1, 0.4), Math.min(0.95, b0 + R.range(0.15, 0.5)), 1);
			}
		}
	}

	// worm tunnels: wandering walks in from the spine or the foot, then exit holes
	{
		const f = state.fx.worms, R = rng(f.seed * 47 + 12);
		const T = 1 + Math.round(f.count * 6);
		ctx.lineCap = 'round';
		ctx.lineJoin = 'round';
		for (let t = 0; t < T; t++) {
			let x, y, a;
			const from = R();
			if (from < 0.45) { x = R.range(-2, 15) * MM; y = R.range(0.1, 0.9) * H; a = R.range(-0.6, 0.6); }
			else if (from < 0.75) { x = R.range(0.1, 0.9) * W; y = H + 2 * MM; a = -Math.PI / 2 + R.range(-0.6, 0.6); }
			else { x = R.range(0.1, 0.9) * W; y = R.range(0.1, 0.9) * H; a = R() * Math.PI * 2; }
			const L = R.range(25, 130) * MM, step = 1.2 * MM, n = Math.ceil(L / step);
			let width = R.range(1.1, 1.9) * MM;
			const birth = R.range(0, 0.45);
			let turn = 0;
			for (let i = 0; i < n; i++) {
				turn = turn * 0.8 + R.normal() * 0.16;
				a += turn;
				width = Math.min(2.4 * MM, Math.max(0.8 * MM, width + R.normal() * 0.12 * MM));
				ctx.lineWidth = width;
				const nx = x + Math.cos(a) * step, ny = y + Math.sin(a) * step;
				const v = Math.round(Math.min(254, (birth + (i / n) * (1 - birth) * 0.92) * 255));
				ctx.strokeStyle = `rgb(255,255,${v})`;
				ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(nx, ny); ctx.stroke();
				x = nx; y = ny;
			}
		}
		const holes = Math.round(f.holes * 14);
		for (let h = 0; h < holes; h++) {
			const v = Math.round(R.range(0.1, 0.9) * 255);
			ctx.fillStyle = `rgb(255,255,${v})`;
			ctx.beginPath();
			ctx.arc(R() * W, R() * H, R.range(0.7, 1.4) * MM, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	return cv;
}
