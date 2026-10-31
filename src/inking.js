// New initials are uncovered by one stain of ink spreading over the whole field from its focus (the
// clicked initial, or the middle of the screen). The stain is a single shape: when it reaches each
// point of the plane is one function, distance from the focus pushed about by the paper's grain
// into lobes and fingers. Inside an initial it runs through the initial's own shapes: once it
// touches a shape (a ground, a leaf, the letter) the shape floods in whole, quicker than the stain
// moves, while crossing into a shape of another colour costs it time. So each initial comes in
// piece by piece, its edges its own outlines (after a reveal where a picture pours in region by
// region from where it was clicked).
// The stain keeps its own clock, and that clock waits: while an initial just ahead of its edge is
// still rendering, the edge holds (for a while: one that takes too long is left to ink in by itself
// when it lands, from the side the stain came in, at the stain's pace). So the stain spreads only
// as fast as there is something to uncover. One drawn again (a new letter) is uncovered over the
// old the same way.

import { makeNoise } from '../render/src/util.js?v=a8136959';

export const PACE = 150;   // ms per cell of distance
const G = 72;              // mask cells across an initial
const FLOOD = 0.1;         // inside one shape the ink runs this much of the stain's time per step
const EDGE = 320;          // ms to cross from one colour into a wholly different one
const SOFT = 14;           // ms the edge of the stain takes to pass a point

const noises = new Map();
const noiseFor = seed => { if (!noises.has(seed)) noises.set(seed, makeNoise(seed)); return noises.get(seed); };

// ms of stain time at which it reaches world point (x, y), in cell units
export function arrival(wave, x, y) {
	const n = noiseFor(wave.seed);
	const wx = x + 0.38 * n(x * 0.42, y * 0.42) + 0.09 * n(x * 2.3 + 11, y * 2.3);
	const wy = y + 0.38 * n(x * 0.42 + 37, y * 0.42 + 5) + 0.09 * n(x * 2.3 + 3, y * 2.3 + 29);
	return Math.hypot(wx - wave.x, wy - wave.y) * PACE + 22 * n(x * 9 + 51, y * 9 + 17);
}

// when the stain reaches each point of an initial's mask: the wave's own times, then flooded through
// the initial's shapes. Pure, and run in ink-worker.js so the page never stalls on it.
export function maskTimes(bitmap, rect, wave) {
	const T = new Float32Array(G * G);
	for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) T[j * G + i] = arrival(wave, rect.x - rect.s / 2 + (i + 0.5) / G * rect.s, rect.y - rect.s / 2 + (j + 0.5) / G * rect.s);
	flood(T, colours(bitmap), rect.s / G * PACE);
	let lo = Infinity, hi = -Infinity;
	for (const t of T) { if (t < lo) lo = t; if (t > hi) hi = t; }
	return { T, lo, hi };
}

export class Inking {
	// waiting(tau): true while something the stain is about to reach isn't ready
	constructor(waiting) {
		this.jobs = []; this.raf = 0; this.waiting = waiting; this.front = null;
		this.asks = new Map(); // id -> what's waiting on the ink worker
		this.ids = 0;
		this.worker = new Worker(new URL('./ink-worker.js?v=a8136959', import.meta.url), { type: 'module' });
		this.worker.onmessage = (e) => this.answered(e.data);
	}
	// a new stain: wave {x, y, seed}; it runs until `until` ms of its own time
	start(wave, until) {
		this.front = { wave, tau: 0, last: performance.now(), until };
		this.run();
	}
	get wave() { return this.front && this.front.wave; }
	get tau() { return this.front ? this.front.tau : Infinity; }
	// frames when the page gets them; a timer when it doesn't (some panes stop them while still
	// calling themselves visible), so an initial is never left waiting for a frame that won't come
	run() {
		if (this.raf) return;
		this.raf = requestAnimationFrame(this.tick);
		this.fallback = setTimeout(() => { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; this.tick(performance.now()); } }, 200);
	}
	// canvas: a 2d canvas the size of bitmap, showing the initial whose square is rect (cell units:
	// centre x, y and side s). old: what it showed before, if it's a redraw. from: where ink would
	// come from if the stain has already passed (a neighbour that's showing, toward the way the view
	// came from): the stain carries on from there into this one, now.
	add(canvas, bitmap, { rect, old = null, from = null }) {
		this.jobs = this.jobs.filter(j => { if (j.canvas !== canvas) return true; this.finish(j); return false; });
		for (const [id, a] of this.asks) if (a.canvas === canvas) a.dropped = true;
		const f = this.front, at = arrival(f.wave, rect.x, rect.y);
		// has the stain gone past it already (its nearest point, roughly), or will it never get here?
		// (it's sized to the screen it started on: the view may have moved a long way since)
		const passed = at - 0.75 * rect.s * PACE < f.tau - SOFT || f.tau >= f.until || at > f.until;
		const wave = passed && from ? { x: from.x, y: from.y, seed: f.wave.seed } : f.wave;
		const id = ++this.ids;
		this.asks.set(id, { canvas, old, passed, dropped: false });
		this.worker.postMessage({ id, bitmap, rect, wave }, [bitmap]);
	}
	answered({ id, bitmap, T, lo, hi }) {
		const a = this.asks.get(id);
		this.asks.delete(id);
		if (!a || a.dropped) { bitmap.close(); return; }
		const { canvas, old, passed } = a;
		// no times for it: it's simply shown
		if (!T) { this.finish({ canvas, bitmap }); return; }
		const late = passed || this.front.tau >= this.front.until ? performance.now() - lo : null;
		const mask = new OffscreenCanvas(G, G);
		const job = { canvas, bitmap, old, T, lo, hi, late, mask, mx: mask.getContext('2d'), img: new ImageData(G, G) };
		job.img.data.fill(255);
		const x = canvas.getContext('2d');
		x.clearRect(0, 0, canvas.width, canvas.height);
		if (old) x.drawImage(old, 0, 0);
		this.jobs.push(job);
		this.run();
	}
	finish(j) {
		const x = j.canvas.getContext('2d');
		x.clearRect(0, 0, j.canvas.width, j.canvas.height);
		x.drawImage(j.bitmap, 0, 0);
		j.bitmap.close();
	}
	tick = (now) => {
		this.raf = 0;
		clearTimeout(this.fallback);
		const f = this.front;
		if (f) {
			const dt = Math.min(50, now - f.last);
			f.last = now;
			if (f.tau < f.until && !this.waiting(f.tau)) f.tau += dt;
		}
		const over = f && f.tau >= f.until;
		this.jobs = this.jobs.filter(j => {
			// the stain stopped before it finished this one: the rest comes in by itself, from where
			// it had got to. Otherwise it would stay half inked for good
			if (j.late == null && over) j.late = now - Math.max(f.tau, j.lo - SOFT);
			const t = j.late != null ? now - j.late : f ? f.tau : Infinity;
			if (t >= j.hi + SOFT) { this.finish(j); return false; }
			if (t < j.lo - SOFT) return true;
			const d = j.img.data;
			for (let i = 0; i < j.T.length; i++) d[i * 4 + 3] = Math.max(0, Math.min(255, ((t - j.T[i]) / SOFT + 0.5) * 255));
			j.mx.putImageData(j.img, 0, 0);
			const w = j.canvas.width, x = j.canvas.getContext('2d');
			x.clearRect(0, 0, w, w);
			if (j.old) {
				x.drawImage(j.old, 0, 0);
				x.globalCompositeOperation = 'destination-out';
				x.drawImage(j.mask, 0, 0, w, w);
				x.globalCompositeOperation = 'source-over';
			}
			const s = scratchFor(w), sx = s.getContext('2d');
			sx.globalCompositeOperation = 'copy';
			sx.drawImage(j.bitmap, 0, 0);
			sx.globalCompositeOperation = 'destination-in';
			sx.drawImage(j.mask, 0, 0, w, w);
			sx.globalCompositeOperation = 'source-over';
			x.drawImage(s, 0, 0);
			return true;
		});
		if (this.jobs.length || (f && f.tau < f.until)) this.run();
	};
	// still inking this canvas in (or about to)
	has(canvas) {
		return this.jobs.some(j => j.canvas === canvas) || [...this.asks.values()].some(a => a.canvas === canvas && !a.dropped);
	}
	// a canvas going away: stop drawing into it
	drop(canvas) {
		for (const a of this.asks.values()) if (a.canvas === canvas) a.dropped = true;
		this.jobs = this.jobs.filter(j => { if (j.canvas !== canvas) return true; j.bitmap.close(); return false; });
	}
}

// the initial's colours on the mask's grid, as [r, g, b, a] in 0..1
const probe = new OffscreenCanvas(G, G), px = probe.getContext('2d', { willReadFrequently: true });
function colours(bitmap) {
	px.clearRect(0, 0, G, G);
	px.drawImage(bitmap, 0, 0, G, G);
	const d = px.getImageData(0, 0, G, G).data, c = new Float32Array(G * G * 4);
	for (let i = 0; i < d.length; i++) c[i] = d[i] / 255;
	return c;
}
// Dijkstra from every point at once, each starting at the stain's own time there: a step costs the
// stain's time over that distance (FLOOD of it within one colour) plus EDGE for how far the colour
// changes. Bare paper (no ink) floods nothing, so the ink can't run round a shape through a gap.
function flood(T, c, step) {
	const n = G * G, heap = new Int32Array(n * 9), key = new Float64Array(n * 9);
	let size = 0;
	const push = (i, k) => {
		let at = size++;
		while (at > 0) { const up = (at - 1) >> 1; if (key[up] <= k) break; heap[at] = heap[up]; key[at] = key[up]; at = up; }
		heap[at] = i; key[at] = k;
	};
	const pop = () => {
		const top = heap[0], last = heap[--size], lk = key[size];
		let at = 0;
		for (;;) {
			let ch = 2 * at + 1;
			if (ch >= size) break;
			if (ch + 1 < size && key[ch + 1] < key[ch]) ch++;
			if (key[ch] >= lk) break;
			heap[at] = heap[ch]; key[at] = key[ch]; at = ch;
		}
		heap[at] = last; key[at] = lk;
		return top;
	};
	for (let i = 0; i < n; i++) push(i, T[i]);
	const done = new Uint8Array(n);
	while (size) {
		const t0 = key[0], p = pop();
		if (done[p] || t0 > T[p]) continue;
		done[p] = 1;
		const x = p % G, y = (p / G) | 0, pa = c[p * 4 + 3];
		for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
			if (!dx && !dy) continue;
			const qx = x + dx, qy = y + dy;
			if (qx < 0 || qy < 0 || qx >= G || qy >= G) continue;
			const q = qy * G + qx;
			if (done[q]) continue;
			const qa = c[q * 4 + 3];
			const diff = Math.min(1, Math.hypot(c[p * 4] * pa - c[q * 4] * qa, c[p * 4 + 1] * pa - c[q * 4 + 1] * qa, c[p * 4 + 2] * pa - c[q * 4 + 2] * qa, pa - qa) * 1.4);
			const run = pa > 0.15 && qa > 0.15 ? FLOOD : 1;
			const t = T[p] + (dx && dy ? 1.414 : 1) * step * run + diff * EDGE;
			if (t < T[q]) { T[q] = t; push(q, t); }
		}
	}
}

const scratch = new Map();
function scratchFor(w) {
	if (!scratch.has(w)) scratch.set(w, new OffscreenCanvas(w, w));
	return scratch.get(w);
}
