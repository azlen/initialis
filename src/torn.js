// Paper for the chrome, after deckle: a flat sheet with a little tooth and a few
// loose fibres in it; torn edges that wander, show the paler core of the paper in a thin rim and
// bristle with fibres; deckle edges that ripple softly; cut edges straight; and a soft shadow on
// the field. paperize(el, …) puts a sheet behind an element and keeps it fitted to it.

import { rng, makeNoise } from '../render/src/util.js?v=a8136959';

const PAD = 14; // css px round the element for fibres and shadow

let grainTile = null;
function grain() {
	if (grainTile) return grainTile;
	const n = 96, cv = new OffscreenCanvas(n, n), x = cv.getContext('2d'), im = x.createImageData(n, n), r = rng(7);
	for (let i = 0; i < n * n; i++) { const v = 128 + (r() - 0.5) * 34; im.data.set([v, v, v, 255], i * 4); }
	x.putImageData(im, 0, 0);
	return (grainTile = cv);
}

// the outline: each side walked in short steps and pushed in by its edge's profile
function outline(w, h, edges, r, noise) {
	const pts = [], kinds = [];
	const sides = [
		['top', [0, 0], [w, 0], [0, 1]],
		['right', [w, 0], [w, h], [-1, 0]],
		['bottom', [w, h], [0, h], [0, -1]],
		['left', [0, h], [0, 0], [1, 0]],
	];
	sides.forEach(([side, a, b, nrm], si) => {
		const kind = edges[side] || 'cut';
		const len = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(2, Math.round(len / (kind === 'torn' ? 2.2 : 4)));
		for (let i = 0; i < n; i++) {
			const t = i / n, s = t * len;
			let off = 0;
			if (kind === 'torn') off = 2.4 + 2.2 * noise(s / 38, si * 9.1) + 1.0 * noise(s / 9, si * 3.7 + 40) + (r() - 0.5) * 1.3;
			else if (kind === 'deckle') off = 1.6 + 1.3 * noise(s / 16, si * 5.3) + (r() - 0.5) * 0.5;
			// corners stay put, so neighbouring sides meet
			off *= Math.min(1, s / 10, (len - s) / 10);
			pts.push([a[0] + (b[0] - a[0]) * t + nrm[0] * off, a[1] + (b[1] - a[1]) * t + nrm[1] * off]);
			kinds.push(kind);
		}
	});
	return { pts, kinds };
}

export function paperSheet({ w, h, dpr = 1, color = '#fbf8f1', core = '#ffffff', edges = {}, seed = 1, fibres = 1 }) {
	const W = w + 2 * PAD, H = h + 2 * PAD;
	const cv = document.createElement('canvas');
	cv.width = Math.ceil(W * dpr); cv.height = Math.ceil(H * dpr);
	const x = cv.getContext('2d');
	x.scale(dpr, dpr);
	x.translate(PAD, PAD);
	const r = rng(seed), noise = makeNoise(seed);
	const { pts, kinds } = outline(w, h, edges, r, noise);
	const path = new Path2D();
	pts.forEach(([px, py], i) => i ? path.lineTo(px, py) : path.moveTo(px, py));
	path.closePath();
	// the sheet and its shadow
	x.save();
	x.shadowColor = 'rgba(60, 45, 30, 0.22)'; x.shadowBlur = 7; x.shadowOffsetY = 1.5;
	x.fillStyle = color; x.fill(path);
	x.restore();
	x.save();
	x.clip(path);
	// tooth
	x.globalAlpha = 0.07; x.globalCompositeOperation = 'multiply';
	x.fillStyle = x.createPattern(grain(), 'repeat'); x.fillRect(-PAD, -PAD, W, H);
	x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
	// a few loose fibres in the sheet
	x.strokeStyle = core; x.lineWidth = 0.5;
	for (let i = 0, n = Math.round(w * h / 900 * fibres); i < n; i++) {
		const fx = r() * w, fy = r() * h, a = r() * Math.PI * 2, l = 5 + r() * 14, c = (r() - 0.5) * 0.6;
		x.globalAlpha = 0.25 + r() * 0.25;
		x.beginPath(); x.moveTo(fx, fy);
		x.quadraticCurveTo(fx + Math.cos(a + c) * l / 2, fy + Math.sin(a + c) * l / 2, fx + Math.cos(a) * l, fy + Math.sin(a) * l);
		x.stroke();
	}
	// the pale core along torn edges, wider and narrower as the tear bevels
	x.strokeStyle = core; x.lineCap = 'round';
	for (let i = 0; i < pts.length; i++) {
		if (kinds[i] !== 'torn') continue;
		const a = pts[i], b = pts[(i + 1) % pts.length];
		x.globalAlpha = 0.75 + r() * 0.25;
		x.lineWidth = 1.6 + r() * 2.6 + 1.6 * Math.max(0, noise(i / 7, seed));
		x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
	}
	x.restore();
	// fibres pulled out of torn and deckle edges
	x.strokeStyle = core; x.lineWidth = 0.45;
	for (let i = 0; i < pts.length; i++) {
		if (kinds[i] === 'cut' || r() > (kinds[i] === 'torn' ? 0.55 : 0.35)) continue;
		const [px, py] = pts[i], q = pts[(i + 1) % pts.length];
		const tx = q[0] - px, ty = q[1] - py, tl = Math.hypot(tx, ty) || 1;
		// outward normal for a clockwise outline in y-down space
		const nx = ty / tl, ny = -tx / tl, l = 1.5 + r() * (kinds[i] === 'torn' ? 5 : 3), bend = (r() - 0.5) * 2;
		x.globalAlpha = 0.4 + r() * 0.4;
		x.beginPath(); x.moveTo(px - nx * 1.2, py - ny * 1.2);
		x.quadraticCurveTo(px + nx * l / 2 + tx / tl * bend, py + ny * l / 2 + ty / tl * bend, px + nx * l + tx / tl * bend * 1.5, py + ny * l + ty / tl * bend * 1.5);
		x.stroke();
	}
	return { canvas: cv, pad: PAD };
}

// keep a sheet behind el (which must be positioned), redrawn when its size changes
export function paperize(el, opts) {
	let cv = null, last = '';
	const draw = () => {
		const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
		const key = w + 'x' + h;
		if (!w || !h || key === last) return;
		last = key;
		const s = paperSheet({ ...opts, w, h, dpr: Math.min(2, devicePixelRatio || 1) });
		Object.assign(s.canvas.style, { position: 'absolute', left: -s.pad + 'px', top: -s.pad + 'px', width: w + 2 * s.pad + 'px', height: h + 2 * s.pad + 'px', zIndex: -1, pointerEvents: 'none' });
		s.canvas.className = 'sheet-bg';
		if (cv) cv.replaceWith(s.canvas); else el.prepend(s.canvas);
		cv = s.canvas;
	};
	new ResizeObserver(draw).observe(el);
	draw();
	return { redraw: () => { last = ''; draw(); } };
}
