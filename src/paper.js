// A sheet of paper that tiles: soft cloudy formation, fine grain and a scatter of fibres.
// Drawn once into a canvas; the field repeats it under the initials and pans it with them.

import { rng } from '../render/src/util.js?v=a8136959';

// value noise on a lattice of p × p cells across the tile, wrapping at its edges
function layer(r, p) {
	const g = Float32Array.from({ length: p * p }, () => r());
	return (u, v) => {
		u *= p; v *= p;
		const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
		const i1 = (i + 1) % p, j1 = (j + 1) % p;
		const a = g[j * p + i], b = g[j * p + i1], c = g[j1 * p + i], e = g[j1 * p + i1];
		const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
		return a + (b - a) * su + (c - a) * sv + (a - b - c + e) * su * sv;
	};
}

export function paperTile({ css = 512, dpr = 1, seed = 11, base = [243, 239, 230] } = {}) {
	const n = Math.round(css * dpr);
	// an OffscreenCanvas in a worker (paper-worker.js), a canvas on the page
	const cv = typeof document === 'undefined' ? new OffscreenCanvas(n, n) : document.createElement('canvas');
	cv.width = cv.height = n;
	const x = cv.getContext('2d');
	const r = rng(seed);
	const img = x.createImageData(n, n), d = img.data;
	// formation: clouds a few cm across down to flecks a few px
	const L = [[5, 0.42], [10, 0.25], [20, 0.15], [44, 0.1], [110, 0.08]].map(([p, w]) => [layer(r, p), w]);
	for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
		const u = i / n, v = j / n;
		let m = 0;
		for (const [f, w] of L) m += f(u, v) * w;
		const k = 1 + (m - 0.5) * 0.055 + (r() - 0.5) * 0.022;
		const o = (j * n + i) * 4;
		d[o] = base[0] * k; d[o + 1] = base[1] * k; d[o + 2] = base[2] * k; d[o + 3] = 255;
	}
	x.putImageData(img, 0, 0);
	// fibres, drawn into every neighbouring tile too so they cross the seams
	x.lineCap = 'round';
	for (let f = 0; f < 340; f++) {
		const px = r() * n, py = r() * n, a = r() * Math.PI * 2, len = (4 + r() * r() * 26) * dpr, bend = (r() - 0.5) * 0.9;
		const dark = r() < 0.55;
		x.strokeStyle = dark ? `rgba(110,88,58,${0.05 + r() * 0.08})` : `rgba(255,253,246,${0.25 + r() * 0.3})`;
		x.lineWidth = (0.35 + r() * 0.55) * dpr;
		const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
		const cx = (px + ex) / 2 - Math.sin(a) * len * bend, cy = (py + ey) / 2 + Math.cos(a) * len * bend;
		for (const ox of [-n, 0, n]) for (const oy of [-n, 0, n]) {
			x.beginPath();
			x.moveTo(px + ox, py + oy);
			x.quadraticCurveTo(cx + ox, cy + oy, ex + ox, ey + oy);
			x.stroke();
		}
	}
	return cv;
}
