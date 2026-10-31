// scion: a field of drop caps to wander and breed. Pan in any direction and it fills in with more.
// Click one and everything else falls away while it breeds outward: its neighbours are close
// children, and the further out they sit the further they stray, until the edges are wild again.
// The initials are drawn by the renderer (render/), in its own workers.

import { DEFAULTS } from '../render/src/params.js?v=a8136959';
import { fontList } from '../render/src/fonts.js?v=a8136959';
import { hash } from '../render/src/util.js?v=a8136959';
import { SHAPE_FILLS } from '../render/src/patterns.js?v=a8136959';
import { GIFEncoder, quantize, applyPalette } from '../render/vendor/gifenc.esm.js?v=a8136959';
import { Muxer, ArrayBufferTarget } from '../render/vendor/mp4-muxer.mjs?v=a8136959';
import { Field, hexDist, encodeGen, decodeGen, keyHash, shareCode, decodeInitial, collectionCode, decodeCollection, shareBody, shareId, isShareId, fetchShared, fieldFonts, setKept, diff, BLOW_UP } from './breed.js?v=a8136959';
import { paperize } from './torn.js?v=a8136959';
import { drawIcon, drawShare } from './icons.js?v=a8136959';
import { Inking, arrival, PACE } from './inking.js?v=a8136959';
import { zip } from './zip.js?v=a8136959';
import { lesson } from './lesson.js?v=a8136959';
import { count } from './count.js?v=a8136959';
import { retip } from './tips.js?v=a8136959';

const Q = new URLSearchParams(location.search);
const TEST = Q.has('test');
// ?test: a timeline of the first seconds, frame by frame (the gap since the last frame, the ink
// wave's clock, initials shown, initials inking in) and long tasks, for judging how smoothly a
// field comes in: __scion.reveal()
const TL = TEST ? { t0: performance.now(), frames: [], long: [], acc: { ink: 0, arrive: 0, update: 0, answered: 0 } } : null;
// ?test: ms spent in f, added to TL.acc[k] (cleared every frame)
const timed = (k, f) => function (...a) { if (!TL) return f.apply(this, a); const t = performance.now(); try { return f.apply(this, a); } finally { TL.acc[k] += performance.now() - t; } };
if (TL) {
	try { new PerformanceObserver(l => { for (const e of l.getEntries()) TL.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { }
	let last = performance.now();
	const rec = (t) => {
		let tau = -1, until = 0, shown = 0, inkingIn = 0;
		try { tau = inking.front ? inking.front.tau : -1; until = inking.front ? inking.front.until : 0; inkingIn = inking.jobs.length; for (const c of cells.values()) if (c.state === 'shown') shown++; } catch { }
		let gpu = 0, inflight = 0;
		try { gpu = gpuBusy; for (const c of cells.values()) if (c.state === 'inflight') inflight++; } catch { }
		TL.frames.push([t - TL.t0, t - last, tau, shown, inkingIn, until, TL.acc.ink, TL.acc.arrive, TL.acc.update, TL.acc.answered, gpu, inflight]);
		for (const k in TL.acc) TL.acc[k] = 0;
		last = t;
		if (t - TL.t0 < 9000) requestAnimationFrame(rec);
	};
	requestAnimationFrame(rec);
}
const $ = s => document.querySelector(s);
// ?test keeps its own saves, so test runs never land in someone's real collection
const store = {
	get(k) { try { return localStorage.getItem((TEST ? 'test:' : '') + k); } catch { return null; } },
	set(k, v) { try { localStorage.setItem((TEST ? 'test:' : '') + k, v); } catch { } },
};

// layout in cell units (a cell is S css px): rows offset by half and packed close. Each initial is
// a little smaller than its cell by a random amount (up to `spread` smaller) and wanders within the
// room that leaves, plus `wander`, so the rows never line up into a grid. Where an initial sits
// depends only on its place in the grid, never on the field bred into it, so one bred from stays
// put. Set by eye on the sliders that were here: an even grid, every initial its full size.
const LAYOUT = { spacing: 1.08, spread: 0, wander: 0, lean: 0.25 };
const PX = 1.04 * LAYOUT.spacing, PY = 1.0 * LAYOUT.spacing;
function base(q, r) {
	const h = hash(q, r, 'j'), u = i => (h >>> (i * 10) & 1023) / 1023;
	const s = 1 - LAYOUT.spread * u(0), room = (1 - s) / 2 + LAYOUT.wander;
	return [(q + r / 2) * PX + (u(1) - 0.5) * 2 * room, r * PY + (u(2) - 0.5) * 2 * room, s];
}
const spot = base;
const pos = (q, r) => spot(q, r).slice(0, 2);
const cellSize = () => Math.round(Math.max(96, Math.min(200, Math.min(innerWidth, innerHeight) / 4.4)));
// the initials are inked in workers with WebGL2 on an OffscreenCanvas (render/src/ink.js); without
// it (iOS before 17, a browser with the GPU switched off) the field can't fill, so the bar says why
const NO_GL = (() => { try { return !new OffscreenCanvas(1, 1).getContext('webgl2'); } catch { return true; } })();
// A pinch can't zoom the page: dragging belongs to the field, so a zoomed page has no way back out.
// (iOS ignores the viewport's limit for pinches, and starts a selection on a long press even with
// user-select off.)
for (const t of ['gesturestart', 'gesturechange']) document.addEventListener(t, e => e.preventDefault(), { passive: false });
document.addEventListener('selectstart', e => e.preventDefault());

let teach = null; // the first visit's lesson (lesson.js)
// A share link (?i=…) opens on just that initial: large, alone, growing in. The field around it (its
// own children) waits until it's asked for: more like this, a double-click, a drag or a scroll.
// (the code is read at boot; one that doesn't read opens the field as usual)
let solo = !!Q.get('i');
// the one shown alone: a share link's is planted at 0,0; the large view (enterLook) shows the
// picked one where it is
let soloKey = '0,0';
// the large view opened as a page of its own (a reload of it): back goes to the field it came from
const cameFrom = Q.has('look') && document.referrer.startsWith(location.origin);
const soloSize = () => Math.round(Math.max(160, Math.min(innerWidth * 0.78, (innerHeight - 190) * 0.92, 560)));

// ?test&dpr=1.8 stands in for a zoomed page
const DPR = Math.min(2, (TEST && +Q.get('dpr')) || devicePixelRatio || 1);
const QUALITY = +(Q.get('q') || 0.6), BUDGET = 2500, LIMIT = 8000;
const AHEAD = 1.2; // cells rendered past the screen edge
const OFF = AHEAD + 2; // cells past the screen edge where a drawn initial gives up its canvas
const STOWED = 600;   // ... and how many of those are kept as small pictures for panning back
const TILE = 512;  // paper tile, css px

let S = solo ? soloSize() : cellSize();
let fonts, field, gen, painters;
let cells = new Map();     // 'q,r' -> { q, r, key, x, y, el, P, state: pending | inflight | shown | stale | failed }
const leaving = new Map(); // 'q,r' -> when the last generation's initial there has faded
const cam = { x: 0, y: 0 }; // the world point at the screen centre, in cell units
const times = [];           // render ms, for the test hooks
const fieldEl = $('#field'), world = $('#world'), paper = $('#paper');
const mod = (a, n) => ((a % n) + n) % n;
const newSeed = () => (Math.random() * 1e9) | 0;

// a letter typed in sets every initial in the field to it; their styles stay as they are
let letter = null;
const shown = P => letter ? { ...P, text: letter } : P;

// --- rendering --------------------------------------------------------------

// the renderer's workers. An idle worker pulls whichever cell is most wanted right then, so a
// fast pan never leaves a queue of cells that have gone off screen; queued jobs (animation frames,
// exports) go first, and can be called off by their tag.
// A cell that renders for longer than its `limit` is given up on: its worker is replaced, so one
// runaway initial can't hold a worker for minutes, and the cell stays empty.
let ids = 0;
class Painters {
	constructor(n, next) {
		this.next = next;
		this.queue = [];
		this.idle = []; // work for when nothing on screen wants rendering
		this.slots = Array.from({ length: n }, () => this.spawn());
		this.killed = 0;
	}
	spawn() {
		const s = { w: new Worker(new URL('../render/src/worker.js?v=a8136959', import.meta.url), { type: 'module' }), job: null, timer: 0 };
		s.w.onmessage = (e) => {
			clearTimeout(s.timer);
			const j = s.job;
			s.job = null;
			// a worker that's failed may have lost its GPU, or be stuck with something that wouldn't
			// load: the next try gets a new one
			if (e.data.error) { s.w.terminate(); this.slots[this.slots.indexOf(s)] = this.spawn(); }
			j.done(e.data.error ? (console.warn(e.data.error), null) : e.data);
			this.pump();
		};
		return s;
	}
	kill(s) {
		// a tab in the background renders many times slower; only judge while it's being looked at
		if (document.hidden) { s.timer = setTimeout(() => this.kill(s), s.job.limit); return; }
		s.w.terminate();
		this.killed++;
		this.slots[this.slots.indexOf(s)] = this.spawn();
		s.job.done(null);
		this.pump();
	}
	run(req, tag = null) { return new Promise(done => { this.queue.push({ req, done, tag }); this.pump(); }); }
	later(req, tag = null) { return new Promise(done => { this.idle.push({ req, done, tag }); this.pump(); }); }
	cancel(tag) {
		const keep = j => { if (j.tag !== tag) return true; j.done(null); return false; };
		this.queue = this.queue.filter(keep);
		this.idle = this.idle.filter(keep);
	}
	pump() {
		for (const s of this.slots) {
			if (s.job) continue;
			const j = this.queue.shift() || this.next() || this.idle.shift();
			if (!j) return;
			s.job = j;
			s.w.postMessage({ ...j.req, id: ++ids });
			if (j.limit) s.timer = setTimeout(() => this.kill(s), j.limit);
		}
	}
}
// about half the cores, so the page and its drawing keep room to breathe
const poolSize = () => Math.max(2, Math.min(5, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

function view() {
	const w = innerWidth / 2 / S, h = innerHeight / 2 / S;
	return { x0: cam.x - w, x1: cam.x + w, y0: cam.y - h, y1: cam.y + h };
}
const near = (c, v, m = AHEAD) => c.x > v.x0 - m && c.x < v.x1 + m && c.y > v.y0 - m && c.y < v.y1 + m;

// new initials grow out from the root while it's on screen, otherwise from the middle of the screen
function focus(v) {
	const o = gen.root;
	if (o) {
		const [x, y] = pos(o.q, o.r);
		if (x > v.x0 && x < v.x1 && y > v.y0 && y < v.y1) return [x, y];
	}
	return [cam.x, cam.y];
}

// reaction–diffusion coral grows on the GPU in over a thousand passes. Several at once starve the
// page's own drawing and panning stutters, so only one is ever in flight.
let gpuBusy = 0;
const gpuHeavy = P => P.tKind === 'coral';

// Breeding a cell's initial runs on this thread, so it gets a few milliseconds per pick; the rest
// wait for the next.
let morePending = 0;
function next() {
	const v = view(), [fx, fy] = focus(v), until = performance.now() + 6;
	let best = null, bv = Infinity;
	for (const c of cells.values()) {
		if ((c.state !== 'pending' && c.state !== 'stale') || !near(c, v)) continue;
		if (!c.P) {
			if (performance.now() > until) { if (!morePending) morePending = setTimeout(() => { morePending = 0; painters.pump(); }, 0); continue; }
			c.P = field.at(c.q, c.r);
		}
		if (gpuBusy && gpuHeavy(c.P)) continue;
		const dv = (c.x - fx) ** 2 + (c.y - fy) ** 2 + (near(c, v, 0.5) ? 0 : 1e4) + (c.state === 'stale' ? 1e5 : 0);
		if (dv < bv) { bv = dv; best = c; }
	}
	if (!best) return null;
	const c = best, size = Math.round(S * DPR);
	const heavy = gpuHeavy(c.P);
	c.state = 'inflight';
	if (heavy) gpuBusy++;
	const tries = c.tries || 0;
	return { req: { P: shown(c.P), size, quality: QUALITY, budget: BUDGET, clear: true, without: tries >= 3 }, limit: LIMIT * (1 + Math.min(tries, 3)), done: res => { if (heavy) gpuBusy--; arrive(c, res, size); } };
}

// a new initial comes in like ink spreading through the paper (inking.js), once the one that stood
// here before has faded; one drawn again (a new letter) spreads over what was there
// and not one by one: a single stain spreads over the field from the focus (the clicked initial, or
// the middle of the screen for a new field, a typed letter, a first look), uncovering each initial
// where it reaches it. Its edge holds while an initial on screen just ahead of it is still rendering,
// up to WAIT ms for each; then it goes on and that one inks in when it lands.
const WAIT = 350;
// A first look waits a moment to begin: the ink starts once most of the screen is drawn (PREROLL ms
// at most), so it spreads without stopping for the ones still coming. Not for a new generation,
// which answers a click and should start at once.
const PREROLL = 1200;
let preroll = 0;
const inking = new Inking((tau) => {
	const v = view(), now = performance.now(), w = inking.wave;
	if (preroll && tau < 1 && now < preroll) {
		let n = 0, ready = 0;
		for (const c of cells.values()) if (near(c, v, 0)) { n++; if (c.state === 'shown') ready++; }
		if (!n || ready < n * 0.7) return true;
	}
	preroll = 0;
	for (const c of cells.values()) {
		if (c.state !== 'pending' && c.state !== 'inflight') continue;
		if (!near(c, v, 0)) continue;
		if (c.reach == null || c.reachSeed !== w.seed) { c.reach = arrival(w, c.x, c.y) - c.s * 0.7 * PACE; c.reachSeed = w.seed; c.waitFrom = 0; }
		if (c.reach > tau + 40) continue;
		if (!c.waitFrom) c.waitFrom = now;
		if (now - c.waitFrom < WAIT) return true;
	}
	return false;
});
// (?test times its frames and its answers)
if (TL) { inking.tick = timed('ink', inking.tick); inking.answered = timed('answered', inking.answered.bind(inking)); }
// where ink comes into a cell the stain has already passed: the neighbour that's showing nearest the
// middle of the screen (the way the view came from), or the middle itself
const HEX = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
function inkSource(c) {
	let best = null, bd = Infinity;
	for (const [dq, dr] of HEX) {
		const n = cells.get((c.q + dq) + ',' + (c.r + dr));
		if (!n || n.state !== 'shown') continue;
		const d = (n.x - cam.x) ** 2 + (n.y - cam.y) ** 2;
		if (d < bd) { bd = d; best = n; }
	}
	return best ? { x: best.x, y: best.y } : { x: cam.x, y: cam.y };
}
let wave = { x: 0, y: 0, seed: 1 };
function startWave(x = cam.x, y = cam.y) {
	// from somewhere off screen (back, or a reload, after panning away), it would take a while to
	// reach what's in view: it starts from the middle of the screen instead
	const v = view();
	if (x < v.x0 || x > v.x1 || y < v.y0 || y > v.y1) [x, y] = [cam.x, cam.y];
	wave = { x, y, seed: (Math.random() * 1e6) | 0 };
	const reach = (Math.hypot(innerWidth, innerHeight) / 2 / S + Math.hypot(cam.x - x, cam.y - y) + 1) * PACE + 400;
	inking.start(wave, reach);
}
function arrive(c, res, size) { return TL ? timed('arrive', arriveNow)(c, res, size) : arriveNow(c, res, size); }
function arriveNow(c, res, size) {
	if (cells.get(c.key) !== c) { if (res) res.bitmap.close(); return; }
	// given up on, or failed (a phone can take longer than the limit or drop a worker's GPU, and any
	// fetch can fail): it goes round again, with longer each time and less and less often, for as
	// long as it's wanted, so its place is never left empty for good. After a few goes it's drawn
	// without whatever it can't get
	if (!res) {
		const n = c.tries = (c.tries || 0) + 1;
		c.state = 'failed';
		setTimeout(() => { if (cells.get(c.key) === c && c.state === 'failed') { c.state = 'pending'; painters.pump(); } }, Math.min(30000, 250 * 4 ** (n - 1)));
		return;
	}
	times.push(res.stats.total);
	if (TEST) c.stats = res.stats;
	// what it showed till now, to spread the new one over (at the new size, if it was drawn at another)
	let old = null;
	if (c.el.classList.contains('shown')) {
		old = new OffscreenCanvas(size, size);
		old.getContext('2d').drawImage(c.el, 0, 0, size, size);
	}
	// (a new canvas is 300 by 150: one rendered at 300 needs its height set too)
	if (c.el.width !== size || c.el.height !== size) c.el.width = c.el.height = size;
	if (document.hidden) {
		// nothing animates in a background tab: just show it
		const x = c.el.getContext('2d');
		x.clearRect(0, 0, size, size);
		x.drawImage(res.bitmap, 0, 0);
		res.bitmap.close();
	} else if (c.swap) {
		// the large view's initial, drawn again at its new size: it takes the place of the one
		// that was scaled up, as it is
		const x = c.el.getContext('2d');
		x.clearRect(0, 0, size, size);
		x.drawImage(res.bitmap, 0, 0);
		res.bitmap.close();
		c.swap = false;
	} else if (solo && animates(shown(c.P))) {
		// a share link's initial grows in: the still waits, hidden, under the replay (play())
		const x = c.el.getContext('2d');
		x.clearRect(0, 0, size, size);
		x.drawImage(res.bitmap, 0, 0);
		res.bitmap.close();
		c.el.classList.add('under');
	} else inking.add(c.el, res.bitmap, { rect: { x: c.x, y: c.y, s: c.s }, old, from: inkSource(c) });
	c.el.classList.add('shown', 'inked');
	c.state = size === Math.round(S * DPR) ? 'shown' : 'stale';
	if (c.key === picked && uiFor !== c && !leafEl) ui();
	if (c.el.classList.contains('under') && !plays.has(c)) play(c, true);
}

// The view zooms: S takes its new size at once, so whatever is wanted renders at it straight away,
// and the world is scaled to look as it did; the scale then eases to 1 while the camera moves to
// (x, y) (or stays where it is, for x null).
let zoom = null; // { z: the world's scale now }
const ZOOM_MS = (TEST && +Q.get('zoom')) || 560; // ?test&zoom=4000 to watch it slowly
function zoomTo(x, y, size, done = null) {
	const z0 = S * (zoom ? zoom.z : 1) / size, x0 = cam.x, y0 = cam.y, t0 = performance.now();
	const z = zoom = { z: z0 };
	S = size;
	for (const c of cells.values()) place(c);
	glide = null;
	let over = false;
	const end = () => {
		if (over || zoom !== z) return;
		over = true;
		zoom = null;
		if (x !== null) { cam.x = x; cam.y = y; }
		if (done) done();
		update();
		ui();
		saveCamSoon();
	};
	const step = () => {
		if (over || zoom !== z) return;
		const u = Math.min(1, (performance.now() - t0) / ZOOM_MS), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
		z.z = Math.pow(z0, 1 - e);
		if (x !== null) { cam.x = x0 + (x - x0) * e; cam.y = y0 + (y - y0) * e; }
		update();
		if (u < 1) requestAnimationFrame(step); else end();
	};
	requestAnimationFrame(step);
	setTimeout(end, ZOOM_MS + 150);
	placeTag();
}

// look: the picked initial alone and large, as a share link opens it (?i=…&look). It moves to the
// middle and grows while the rest are pushed out and fade; the URL is its share link, so back
// zooms out to the field again, round it.
async function enterLook(c, { push = true } = {}) {
	if (solo || !c || !c.P) return;
	if (push) {
		const url = location.pathname + '?i=' + await shareCode(shown(c.P)) + '&look';
		if (solo || pickedCell() !== c) return;
		saveCam();
		history.pushState({ cam: { ...cam }, depth: depth() + 1, look: c.key }, '', url);
		setReach(depth());
	}
	count('look', shown(c.P));
	closeLeaf();
	hoverOff();
	stopPlays();
	solo = true;
	soloKey = picked = c.key;
	for (const x of [...cells.values()]) {
		if (x === c) continue;
		if (!x.el.classList.contains('shown')) { drop(x); continue; }
		x.state = 'leaving';
		// fading as long as they're being pushed out
		x.el.style.transitionDelay = '0ms';
		x.el.style.transitionDuration = Math.round(ZOOM_MS * 0.8) + 'ms, .45s';
		x.el.classList.add('gone');
	}
	// drawn again at the large size, in place of the scaled-up one
	c.swap = true;
	if (c.state === 'shown') c.state = 'stale';
	zoomTo(c.x, c.y, soloSize(), () => {
		// the rest kept as small pictures, to come straight back on the way out
		for (const x of [...cells.values()]) if (x !== c) { if (x.P && !inking.has(x.el)) stow(x); drop(x); }
	});
	ui();
}

// out of the large view (or a share link's) into the field round it: the usual size, the URL
// without ?i=, the initial staying in the middle as the view zooms out, and the ink spreading out
// from it into the rest. url: false when the browser has already changed it (back); fill: false
// when a new field is about to be bred from it
function leaveSolo({ url = true, fill = true } = {}) {
	if (!solo) return;
	solo = false;
	if (url) history.replaceState(history.state, '', location.pathname + hashOf(gen));
	stopPlays();
	for (const x of [...cells.values()]) if (x.state === 'leaving') drop(x);
	const c = cells.get(soloKey);
	zoomTo(null, null, cellSize());
	if (fill) startWave(...(c ? [c.x, c.y] : pos(0, 0)));
	ui();
	update();
}
// more like this: in the field, a new field bred from it; from the large view, back out into the
// field round it, which is its own already if it was bred from it, or else a new one
function moreLike(c) {
	if (!solo) return breed(c);
	const kin = c === rootCell();
	leaveSolo({ fill: kin });
	if (!kin) breed(c);
	else { count('more', shown(c.P)); if (teach) teach.did('breed'); }
}

// --- the field --------------------------------------------------------------

// every initial renders at the full cell size and is shown at its own size s
function place(c) {
	const w = c.s * S;
	Object.assign(c.el.style, { left: c.x * S - w / 2 + 'px', top: c.y * S - w / 2 + 'px', width: w + 'px', height: w + 'px', transform: leanOf(c) });
}

// The picked initial gets room for its tag: its neighbours lean out of its way, LAYOUT.lean for the
// ones touching it and less further out, shrinking a little so they crowd the next ring no more
// than they have to. Only a transform: they keep their places in the field.
const LEAN_IN = 1.2, LEAN_OUT = 3.2, SHRINK = 0.12;
let leaning = null; // the cell the others lean away from
function leanOf(c) {
	const p = leaning;
	if (!p || c === p) return '';
	const dx = c.x - p.x, dy = c.y - p.y, d = Math.hypot(dx, dy);
	const f = Math.max(0, Math.min(1, (LEAN_OUT - d) / (LEAN_OUT - LEAN_IN)));
	if (!f) return '';
	const m = LAYOUT.lean * f * S / d;
	return `translate(${(dx * m).toFixed(1)}px, ${(dy * m).toFixed(1)}px) scale(${(1 - SHRINK * f).toFixed(3)})`;
}
function lean(again = false) {
	const p = pickedCell() || null;
	if (p === leaning && !again) return;
	leaning = p;
	for (const x of cells.values()) x.el.style.transform = leanOf(x);
	for (const p of plays.values()) p.el.style.transform = p.c.el.style.transform;
}

function add(q, r) {
	const [x, y, s] = spot(q, r);
	const el = document.createElement('canvas');
	el.className = 'cap';
	el.dataset.key = q + ',' + r;
	const c = { q, r, key: q + ',' + r, x, y, s, el, P: null, state: 'pending' };
	place(c);
	world.append(el);
	cells.set(c.key, c);
	const k = stowed.get(c.key);
	if (k && k.gen === gen && k.letter === letter) unstow(c, k);
	return c;
}

function drop(c) { const p = plays.get(c); if (p) stopPlay(p); inking.drop(c.el); c.el.remove(); cells.delete(c.key); }

// Only the initials on screen, and a margin round it, keep their canvases. One drawn that goes
// further off (OFF) is kept as a small WebP of itself instead, and drawn from that if the view comes
// back: no new render, and no ink, since it was seen already. Past STOWED of those the oldest are
// forgotten and drawn again. The picked one stays.
const stowed = new Map(); // 'q,r' -> { blob, P, gen, letter }
function stow(c) {
	const k = { P: c.P, gen, letter };
	c.el.toBlob((blob) => {
		if (!blob || k.gen !== gen || k.letter !== letter) return;
		stowed.delete(c.key);
		stowed.set(c.key, { ...k, blob });
		if (stowed.size > STOWED) stowed.delete(stowed.keys().next().value);
	}, 'image/webp', 0.95);
}
async function unstow(c, k) {
	c.state = 'unstowing';
	c.P = k.P;
	let bm = null;
	try { bm = await createImageBitmap(k.blob); } catch { }
	if (cells.get(c.key) !== c) { if (bm) bm.close(); return; }
	if (!bm) { c.state = 'pending'; stowed.delete(c.key); painters.pump(); return; }
	const size = bm.width;
	c.el.width = c.el.height = size;
	c.el.getContext('2d').drawImage(bm, 0, 0);
	bm.close();
	c.el.classList.add('shown');
	c.state = size === Math.round(S * DPR) ? 'shown' : 'stale';
	if (c.key === picked && uiFor !== c && !leafEl) ui();
}
function trim(v) {
	for (const c of [...cells.values()]) {
		if (c.key === picked) continue;
		if (c.state === 'pending' && !c.el.classList.contains('shown') && !near(c, v, AHEAD + 1)) { drop(c); continue; }
		if (near(c, v, OFF)) continue;
		if (c.state === 'shown' && c.P && !c.el.classList.contains('gone') && !inking.has(c.el)) stow(c);
		drop(c);
	}
}

let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; update(); }); };
// (?test times it)
function update() { return TL ? timed('update', updateNow)() : updateNow(); }
function updateNow() {
	if (!painters) return; // still booting
	const z = zoom ? zoom.z : 1, tx = innerWidth / 2 - cam.x * S * z, ty = innerHeight / 2 - cam.y * S * z;
	world.style.transform = `translate3d(${tx}px, ${ty}px, 0)` + (zoom ? ` scale(${z})` : '');
	paper.style.transform = `translate3d(${mod(tx, TILE)}px, ${mod(ty, TILE)}px, 0)`;
	const v = view();
	const m = AHEAD;
	if (solo) { if (!cells.has(soloKey)) add(...soloKey.split(',').map(Number)); }
	else for (let r = Math.floor((v.y0 - m) / PY); r <= Math.ceil((v.y1 + m) / PY); r++) {
		for (let q = Math.floor((v.x0 - m) / PX - r / 2); q <= Math.ceil((v.x1 + m) / PX - r / 2); q++) {
			if (!cells.has(q + ',' + r)) add(q, r);
		}
	}
	// (while zooming, the ones on their way out keep their canvases till they've gone)
	if (!zoom) trim(v);
	// the picked cell may come into being after it was picked (a reload, back): its neighbours lean
	// and its tag shows once it has an initial
	const pc = pickedCell();
	if (pc && pc.P && !leafEl && (tag.hidden || uiFor !== pc)) ui();
	painters.pump();
	if (teach) teach.tick();
}

// a new generation. `keep` (the clicked cell) stays as it is; the rest fade, rippling out from
// `from`, and the new initials appear in their places as they're rendered. The root only says where
// the ink comes from (startWave starts from the middle of the screen when it's off screen).
function setGen(g, { keep = null, from = null } = {}) {
	stopPlays(keep);
	closeLeaf();
	gen = g;
	stowed.clear();
	picked = g.root ? g.root.q + ',' + g.root.r : null;
	if (g.root) startWave(...pos(g.root.q, g.root.r)); else startWave();
	field = new Field(g, fonts);
	const old = cells;
	cells = new Map();
	const now = performance.now();
	for (const c of old.values()) {
		if (c === keep) { cells.set(c.key, c); continue; }
		const delay = from ? Math.min(600, hexDist(c.q - from[0], c.r - from[1]) * 45) : 0;
		inking.drop(c.el);
		if (!c.el.classList.contains('shown')) { c.el.remove(); continue; }
		c.el.style.transitionDelay = delay + 'ms';
		c.el.classList.add('gone');
		leaving.set(c.key, now + delay + 300);
		setTimeout(() => c.el.remove(), delay + 450);
	}
	for (const [k, t] of leaving) if (t < now) leaving.delete(k);
	ui();
	update();
}

// the URL holds the generation, then after a ~ the letter if one was typed, then after another
// the pinned parts
const hashOf = g => '#' + encodeGen(g) + (letter || (g.pins && g.pins.length) ? '~' + (letter || '') : '') + (g.pins && g.pins.length ? '~' + g.pins.join('.') : '');
function readHash() {
	const [g, l, p] = location.hash.slice(1).split('~');
	const dg = decodeGen(g || '');
	if (dg) dg.pins = (p || '').split('.').filter(Boolean);
	return { g: dg, l: /^[A-Z]$/.test(l || '') ? l : null };
}

const sameP = (a, b) => Object.keys(DEFAULTS).every(k => a[k] === b[k]);
const depth = () => (history.state && history.state.depth) || 0;
// how deep this tab's history goes past where it is now, for the forward arrow: a new field cuts
// off what was forward of it
let reach = 0;
try { reach = +sessionStorage.getItem('scion:reach') || 0; } catch { }
function setReach(n) { reach = n; try { sessionStorage.setItem('scion:reach', String(n)); } catch { } }
function saveCam() { history.replaceState({ ...history.state, cam: { ...cam } }, '', solo || (albumOf && albumOf.link) ? location.pathname + location.search + (albumOf && albumOf.link ? location.hash : '') : hashOf(gen)); }
let saveT = 0;
const saveCamSoon = () => { clearTimeout(saveT); saveT = setTimeout(saveCam, 400); };

function go(g, opts = {}) {
	// blown-up letters are parked (breed.js): one saved or edited while they weren't comes back as cut
	if (g.root && !BLOW_UP && g.root.P.lBlob > 0) g = { ...g, root: { ...g.root, P: { ...g.root.P, lBlob: 0 } } };
	saveCam();
	history.pushState({ cam: { ...cam }, depth: depth() + 1 }, '', hashOf(g));
	setReach(depth());
	setGen(g, opts);
}
// vary: breed from it (varying the root again gives it new children). Pins carry on.
function breed(c) { if (teach) teach.did('breed'); count('more', shown(c.P)); go({ seed: newSeed(), root: { q: c.q, r: c.r, P: shown(c.P) }, pins: gen.pins || [] }, { keep: c, from: [c.q, c.r] }); }
const centreCell = () => { const r = Math.round(cam.y / PY), q = Math.round(cam.x / PX - r / 2); return [q, r]; };
// a fresh field puts an initial in the middle of the screen, and the stain starts from it
function wildField() {
	if (solo) leaveSolo();
	const [q, r] = centreCell();
	[cam.x, cam.y] = base(q, r).slice(0, 2);
	go({ seed: newSeed(), root: null }, { from: [q, r] });
}
// the name, top left: a fresh field, as on arriving (nothing open, no letter typed)
function freshField() {
	if (!$('#context').hidden) closeContext();
	letter = null;
	wildField();
}
// a saved initial planted in the middle of the screen, breeding outward
function plant(P) {
	if (solo) leaveSolo({ fill: false });
	const [q, r] = centreCell();
	[cam.x, cam.y] = pos(q, r);
	go({ seed: newSeed(), root: { q, r, P } }, { from: [q, r] });
}

addEventListener('popstate', (e) => {
	setReach(Math.max(reach, depth()));
	// the collection page: back puts it away (and does what was asked of it), forward brings it back
	if (albumOf && !(e.state && e.state.album)) {
		const then = afterAlbum;
		afterAlbum = null;
		// opening one goes straight to it; only going back gathers them up
		if (then || !albumOf.mine) { hideAlbum(); if (then) then(); } else gatherBack();
		return;
	}
	if (!albumOf && e.state && e.state.album) { openAlbum(null, { push: false }); return; }
	// back out of the large view: it zooms out round the initial, in the field it was in; forward
	// into it again zooms in, or, if the initial is gone from here, the page opens on it
	const looking = new URLSearchParams(location.search).has('i');
	if (solo && !looking) {
		leaveSolo({ url: false });
		if (location.hash === hashOf(gen)) return;
	} else if (!solo && looking) {
		const c = e.state && e.state.look && cells.get(e.state.look);
		if (c && c.P) enterLook(c, { push: false }); else location.reload();
		return;
	}
	const { g: dg, l } = readHash();
	const g = dg || { seed: newSeed(), root: null };
	if (e.state && e.state.cam) { Object.assign(cam, e.state.cam); [cam.x, cam.y] = pos(...centreCell()); }
	if (l !== letter) { letter = l; restale(); }
	let keep = null, from = null;
	if (g.root) {
		from = [g.root.q, g.root.r];
		const c = cells.get(g.root.q + ',' + g.root.r);
		if (c && c.P && (c.state === 'shown' || c.state === 'stale') && sameP(shown(c.P), shown(g.root.P))) keep = c;
	}
	setGen(g, { keep, from });
});

// --- the letter -------------------------------------------------------------

// every initial on screen redraws in place with the new letter; the old one shows until it does
function restale() {
	stowed.clear();
	const v = view();
	for (const c of cells.values()) if (c.state !== 'inflight') c.state = near(c, v) ? 'pending' : 'stale';
	stopPlays();
}
function setLetter(L) {
	if (L === letter) return;
	letter = L;
	if (L && teach) teach.did('letter');
	if (L) count('letter', L);
	const c = pickedCell() || rootCell();
	if (c && near(c, view(), 0)) startWave(c.x, c.y); else startWave();
	restale();
	history.replaceState(history.state, '', hashOf(gen));
	ui();
	update();
}

// --- growth on hover ----------------------------------------------------------

// what grows: ornament, filigree, texture, and the fills that grow over a shape (frost, mosaic,
// a wash...); a bare letter in a frame has nothing to animate
const animates = P => P.orn !== 'none' || P.tKind !== 'none' || P.lFil !== 'none' ||
	(P.lFill === 'pattern' && SHAPE_FILLS.has(P.lPattern)) || (P.frame !== 'none' && SHAPE_FILLS.has(P.fPattern));
const ease = u => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, u)));

// n frames of P growing in, rendered a few ahead in the pool and handed to onFrame in order
async function growFrames(P, size, n, onFrame, { clear = false, tag = null, quality = QUALITY, budget = 8000 } = {}) {
	const jobs = [], ahead = poolSize() + 2;
	const want = i => { if (i < n && !jobs[i]) jobs[i] = painters.run({ P, size, quality, budget, clear, time: ease(i / (n - 1)) }, tag); };
	for (let i = 0; i < ahead; i++) want(i);
	for (let i = 0; i < n; i++) {
		want(i + ahead);
		const r = await jobs[i];
		jobs[i] = null;
		if (!r) return false;
		const more = await onFrame(r.bitmap, i);
		r.bitmap.close();
		if (more === false) return false;
	}
	return true;
}

// resting on an initial replays it growing in, over the cell. Once its first frame is up it plays to
// the end whether or not the pointer stays, and picking one plays it at once (or lets it finish).
// Grown with the cell's own budget, the last frame is the still itself, so the copy then fades into
// it unseen. Leaving before the first frame calls it off.
let hov = null; // the cell the pointer rests on
const plays = new Map(); // cell -> its replay
const HOVER_FRAMES = 22, HOVER_FPS = 15;
function hoverOn(c) {
	if (hov && hov.c === c) return;
	hoverOff();
	const h = hov = { c, played: false };
	if (!c.P || !animates(shown(c.P)) || plays.has(c)) return;
	h.timer = setTimeout(() => { if (hov === h) { h.played = true; play(c); } }, 150);
}
function hoverOff() {
	if (!hov) return;
	clearTimeout(hov.timer);
	const p = plays.get(hov.c);
	if (p && !p.el.isConnected && !p.sure) stopPlay(p);
	hov = null;
}
function stopPlay(p) {
	p.dead = true;
	if (plays.get(p.c) === p) plays.delete(p.c);
	painters.cancel(p.tag);
	p.c.el.classList.remove('under');
	if (p.el.isConnected) { const el = p.el; el.classList.add('fading'); setTimeout(() => el.remove(), 260); }
}
// a new letter, a new generation, a resize: every replay stops, but for `keep`'s
function stopPlays(keep = null) {
	hoverOff();
	for (const p of [...plays.values()]) if (p.c !== keep) stopPlay(p);
}
async function play(c, sure = false) {
	if (!c.P || !animates(shown(c.P)) || plays.has(c)) return;
	const size = c.el.width, el = document.createElement('canvas');
	const p = { c, el, sure, tag: 'hover' + (++ids), dead: false };
	plays.set(c, p);
	el.className = 'cap shown grow';
	el.width = el.height = size;
	for (const k of ['left', 'top', 'width', 'height', 'transform']) el.style[k] = c.el.style[k];
	const x = el.getContext('2d');
	let t0 = 0;
	await growFrames(shown(c.P), size, HOVER_FRAMES, async (bitmap, i) => {
		if (p.dead) return false;
		// the frames are inks over clear paper: hide the finished still under them, or it shows through
		if (i === 0) { world.append(el); c.el.classList.add('under'); t0 = performance.now(); }
		const wait = t0 + i * 1000 / HOVER_FPS - performance.now();
		if (wait > 0) await new Promise(r => setTimeout(r, wait));
		if (p.dead) return false;
		x.clearRect(0, 0, size, size);
		x.drawImage(bitmap, 0, 0);
	}, { clear: true, tag: p.tag, budget: BUDGET });
	if (!p.dead) stopPlay(p);
}

// --- input ------------------------------------------------------------------

let drag = null, glide = null;
fieldEl.addEventListener('pointerdown', (e) => {
	if (e.button !== 0 || drag) return;
	glide = null;
	drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, moved: false, trail: [[performance.now(), e.clientX, e.clientY]] };
	fieldEl.setPointerCapture(e.pointerId);
});
fieldEl.addEventListener('pointermove', (e) => {
	if (!drag) {
		if (e.pointerType !== 'mouse') return;
		const el = document.elementFromPoint(e.clientX, e.clientY);
		const c = el && el.dataset.key ? cells.get(el.dataset.key) : null;
		if (c && c.el === el && c.state === 'shown' && !c.el.classList.contains('gone')) hoverOn(c);
		else if (!(el && el.classList.contains('grow'))) hoverOff();
		return;
	}
	if (e.pointerId !== drag.id) return;
	if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 5) { drag.moved = true; fieldEl.classList.add('dragging'); hoverOff(); leaveSolo(); }
	if (drag.moved) { cam.x -= (e.clientX - drag.x) / S; cam.y -= (e.clientY - drag.y) / S; schedule(); }
	drag.x = e.clientX; drag.y = e.clientY;
	const t = performance.now();
	drag.trail.push([t, e.clientX, e.clientY]);
	while (drag.trail.length > 2 && t - drag.trail[0][0] > 90) drag.trail.shift();
});
fieldEl.addEventListener('pointerleave', () => { if (!drag) hoverOff(); });
function release(e) {
	if (!drag || e.pointerId !== drag.id) return;
	const d = drag;
	drag = null;
	fieldEl.classList.remove('dragging');
	if (!d.moved) { if (e.type === 'pointerup') tap(e); return; }
	if (teach) teach.did('drag');
	const [t0, x0, y0] = d.trail[0], t = performance.now(), last = d.trail[d.trail.length - 1][0];
	// at most a few px a ms: a jump in one event (some tablets, a synthetic drag) isn't a flick
	const vx = (d.x - x0) / (t - t0), vy = (d.y - y0) / (t - t0), k = Math.min(1, 4 / Math.hypot(vx, vy));
	if (t - last < 60 && t > t0) startGlide(vx * k, vy * k);
	saveCamSoon();
}
fieldEl.addEventListener('pointerup', release);
fieldEl.addEventListener('pointercancel', release);

function tap(e) {
	// a page laid round the initial closes on any click
	if (leafEl) { closeLeaf(); return; }
	// the growing copy lies over the cell; look through it
	const els = document.elementsFromPoint(e.clientX, e.clientY);
	const el = els.find(x => x.dataset && x.dataset.key);
	const c = el ? cells.get(el.dataset.key) : null;
	const ok = c && c.el === el && c.P && (c.state === 'shown' || c.state === 'stale' || c.el.classList.contains('shown'));
	// in the large view, the paper round the initial goes back (to the field it was opened from),
	// if there is one; a share link's stays as it is
	if (solo && !(ok && c.key === soloKey)) { if ((history.state && history.state.look) || cameFrom) history.back(); return; }
	// a second click soon after, in the same spot (a double click, or a double tap), asks for more
	// like the first one's initial, though picking it may have slid it out from under the pointer
	const now = performance.now(), l = lastTap;
	const first = l && now - l.t < 380 && Math.hypot(e.clientX - l.x, e.clientY - l.y) < 14 && cells.get(l.key);
	lastTap = ok && !first ? { key: c.key, t: now, x: e.clientX, y: e.clientY } : null;
	if (first && first.P) { pick(first); moreLike(first); return; }
	pick(ok ? c : null);
}
let lastTap = null;

// a flick keeps going a little after the finger lifts
function startGlide(vx, vy) {
	const g = glide = {};
	let last = performance.now();
	const step = (t) => {
		if (glide !== g) return;
		const dt = Math.min(50, t - last);
		last = t;
		cam.x -= vx * dt / S; cam.y -= vy * dt / S;
		const k = Math.exp(-dt / 220);
		vx *= k; vy *= k;
		update();
		if (Math.hypot(vx, vy) > 0.02) requestAnimationFrame(step);
		else { glide = null; saveCamSoon(); }
	};
	requestAnimationFrame(step);
}

fieldEl.addEventListener('wheel', (e) => {
	e.preventDefault();
	if (e.ctrlKey) return;
	const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
	glide = null;
	hoverOff();
	leaveSolo();
	if (teach) teach.did('drag');
	cam.x += e.deltaX * k / S; cam.y += e.deltaY * k / S;
	schedule();
	saveCamSoon();
}, { passive: false });

addEventListener('keydown', (e) => {
	const cmd = e.metaKey || e.ctrlKey, k = e.key;
	if (e.target.closest && e.target.closest('input, textarea')) return;
	if ((cmd && k.toLowerCase() === 'z' && !e.shiftKey) || k === 'Backspace') { e.preventDefault(); if (depth() > 0) history.back(); }
	else if (cmd && k.toLowerCase() === 'z' && e.shiftKey) { e.preventDefault(); if (depth() < reach) history.forward(); }
	else if (albumOf) { if (k === 'Escape' || k === 'Backspace') { e.preventDefault(); fromAlbum(); } }
	else if (k === 'Escape') { if (!$('#context').hidden) closeContext(); else if (leafEl) closeLeaf(); else if (picked) pick(null); else setLetter(null); }
	else if (!cmd && !e.altKey && /^[a-z]$/i.test(k)) setLetter(k.toUpperCase());
	else if (!cmd && k === ' ') { e.preventDefault(); wildField(); }
});

addEventListener('resize', () => {
	const s = solo ? soloSize() : cellSize();
	if (s !== S && !zoom) {
		S = s;
		stopPlays();
		closeLeaf();
		for (const c of cells.values()) {
			place(c);
			if (c.state === 'shown' && Math.abs(c.el.width - S * DPR) > S * DPR * 0.2) c.state = 'stale';
		}
		placeTag();
	}
	schedule();
});

// --- the bar, the tag, the collection ---------------------------------------------

// the paper texture is always on now (it had a switch in the bar)
const paperOn = true;

const rootCell = () => gen.root && cells.get(gen.root.q + ',' + gen.root.r);
// Clicking an initial picks it (its key): its tag comes up round it, and varying it is a button on
// the tag. A new generation picks its root; clicking the paper lets go.
let picked = null;
const pickedCell = () => picked && cells.get(picked);
function pick(c) {
	const k = c ? c.key : null;
	if (k === picked) return;
	picked = k;
	if (c && c.P) count('pick', shown(c.P));
	if (k && canAge()) setTimeout(loadContext, 300);
	// picked, it plays through: one already going finishes, and one the pointer hasn't played yet
	// starts now
	const p = c && plays.get(c), here = c && hov && hov.c === c;
	if (p) p.sure = true;
	else if (c && !(here && hov.played)) {
		if (here) { clearTimeout(hov.timer); hov.played = true; }
		play(c, true);
	}
	// its scraps come out from under it, again for each one picked
	if (k) for (const el of [tag, tools]) { el.classList.remove('arrive'); void el.offsetWidth; el.classList.add('arrive'); }
	ui();
}

// the tag's hand-inked icons (icons.js), redrawn in another ink when their state changes
const INK = '#2b2824';
function icon(el, name, color) {
	const size = el.closest('.small') || el.classList.contains('word') ? 18 : 24;
	const cv = drawIcon(name, size, { color, seed: name.length * 3 + 1 });
	// the scrap's own paper is a canvas too (torn.js): only the icon gets replaced
	const old = el.querySelector('canvas:not(.sheet-bg)');
	if (old) old.replaceWith(cv); else el.prepend(cv);
}
// share is on orange construction paper
const SHARE_PAPER = '#ec7f35';
const isShare = el => el.dataset.icon === 'share';

// the picked initial's tag: save and more like this under it, everything else it can do in a row
// above it, in the room its neighbours leave (or round the root, its children)
const tag = $('#tag'), tools = $('#tools');
for (const el of [tag, tools]) el.addEventListener('pointerdown', e => e.stopPropagation());
const scrapPapers = [];
function placeTag() {
	const c = pickedCell();
	tag.hidden = tools.hidden = !c || !!leafEl || !!zoom;
	if (tag.hidden) return;
	$('#look').hidden = solo;
	// a scrap first seen at no size has no paper yet
	for (const [el, p] of scrapPapers) if (!el.querySelector('.sheet-bg') && el.offsetWidth) p.redraw();
	tag.style.left = c.x * S - tag.offsetWidth / 2 + 'px';
	tag.style.top = (c.y + c.s / 2) * S + 12 + 'px';
	tools.style.left = c.x * S - tools.offsetWidth / 2 + 'px';
	tools.style.top = (c.y - c.s / 2) * S - 10 - tools.offsetHeight + 'px';
}

// what the lesson (lesson.js) points at first, in the world's px: an initial near the middle with
// room to its left (the same one while it stays on screen)
let aimed = null;
function aim(room) {
	const v = view();
	const ok = c => c && cells.get(c.key) === c && c.state === 'shown' && !c.el.classList.contains('gone') && !inking.has(c.el) &&
		near(c, v, -c.s / 2) && (c.x - c.s / 2 - cam.x) * S + innerWidth / 2 > room;
	if (!ok(aimed)) {
		aimed = null;
		let best = Infinity;
		for (const c of cells.values()) if (ok(c)) { const d = Math.hypot(c.x - cam.x, c.y - cam.y); if (d < best) { best = d; aimed = c; } }
	}
	return aimed && { x: (aimed.x - aimed.s / 2) * S, y: aimed.y * S };
}

// saved initials: a small collection kept in this browser (as their differences from the
// defaults), laid in a row along the foot, newest first. Click one to plant it and breed from it.
let saved = [];
try { saved = JSON.parse(store.get('scion:saved') || '[]'); } catch { saved = []; }
const keyOf = P => keyHash(P);
const isSaved = P => saved.some(s => s.key === keyOf(P));
// a small picture of it, kept with the save, so the collection never has to render it again
function thumbOf(src) {
	if (!src || !src.width) return null;
	const n = Math.round(60 * 2), cv = document.createElement('canvas');
	cv.width = cv.height = n;
	cv.getContext('2d').drawImage(src, 0, 0, n, n);
	try { return cv.toDataURL('image/webp', 0.85); } catch { return null; }
}
function toggleSave(P, from = null) {
	const had = isSaved(P);
	count(had ? 'unsave' : 'save', P);
	if (!had && teach) teach.did('save');
	if (had) saved = saved.filter(s => s.key !== keyOf(P));
	else saved.unshift({ key: keyOf(P), d: diff(P), at: Date.now(), thumb: thumbOf(from) });
	store.set('scion:saved', JSON.stringify(saved));
	fillCollection(!had && from ? { key: keyOf(P), from } : null);
	ui();
}
const thumbs = new Map(); // key -> canvas, rendered once
function fillCollection(arrive = null) {
	const box = $('#collection'), list = box.querySelector('.items');
	box.hidden = !saved.length;
	list.replaceChildren();
	hideItemTag(true);
	for (const s of saved) {
		const P = { ...DEFAULTS, ...s.d };
		const item = document.createElement('div');
		item.className = 'item';
		item.dataset.key = s.key;
		let cv = thumbs.get(s.key);
		if (!cv) {
			cv = document.createElement('canvas');
			thumbs.set(s.key, cv);
			const size = Math.round(60 * DPR);
			cv.width = cv.height = size;
			if (s.thumb) {
				const im = new Image();
				im.onload = () => cv.getContext('2d').drawImage(im, 0, 0, size, size);
				im.src = s.thumb;
			} else {
				// saved before thumbnails were kept: rendered once the field has nothing else to do, then kept
				painters.later({ P, size, quality: 0.5, budget: 2500, clear: true }, 'collect').then(r => {
					if (!r) return;
					cv.getContext('2d').drawImage(r.bitmap, 0, 0);
					r.bitmap.close();
					const e = saved.find(x => x.key === s.key);
					if (e && !e.thumb) { e.thumb = thumbOf(cv); store.set('scion:saved', JSON.stringify(saved)); }
				});
			}
		}
		item.onclick = () => plant(P);
		item.onpointerenter = (e) => { if (e.pointerType === 'mouse') showItemTag(item, P); };
		item.onpointerleave = () => hideItemTag();
		item.append(cv);
		list.append(item);
		if (arrive && arrive.key === s.key) requestAnimationFrame(() => flyIn(arrive.from, item));
	}
}
// Resting on one in the collection: its download and share on scraps above it, and a scrap at its
// corner to let it go. One of each, moved to whichever it's on; they stay while the pointer is on
// them, or while a download is going.
const itemTag = document.createElement('nav'), letGo = document.createElement('button');
itemTag.className = 'tag itemtag';
itemTag.hidden = letGo.hidden = true;
itemTag.innerHTML = '<div class="row"><button class="scrap small" data-icon="png" aria-label="download"></button><button class="scrap small" data-icon="share" aria-label="share"></button></div>';
letGo.className = 'letgo';
letGo.textContent = '×';
letGo.setAttribute('aria-label', 'let it go');
document.body.append(itemTag, letGo);
paperize(letGo, { color: '#fbf8f1', edges: { top: 'torn', right: 'torn', bottom: 'torn', left: 'torn' }, seed: 41, fibres: 0.3 });
let itemOf = null, itemHide = 0;
function showItemTag(item, P) {
	if (itemTag.querySelector('.busy')) return;
	clearTimeout(itemHide);
	itemOf = { item, P };
	const fresh = itemTag.hidden;
	itemTag.hidden = letGo.hidden = false;
	const r = item.getBoundingClientRect(), box = $('#collection').getBoundingClientRect();
	itemTag.style.left = Math.round(Math.max(6, Math.min(innerWidth - itemTag.offsetWidth - 6, r.left + r.width / 2 - itemTag.offsetWidth / 2))) + 'px';
	itemTag.style.top = Math.round(box.top - itemTag.offsetHeight - 4) + 'px';
	letGo.style.left = Math.round(r.right - letGo.offsetWidth / 2 - 2) + 'px';
	letGo.style.top = Math.round(r.top - letGo.offsetHeight / 2 + 2) + 'px';
	if (fresh) { itemTag.classList.remove('arrive'); void itemTag.offsetWidth; itemTag.classList.add('arrive'); }
}
function hideItemTag(now = false) {
	clearTimeout(itemHide);
	const go = () => { if (itemTag.querySelector('.busy')) return; itemTag.hidden = letGo.hidden = true; itemOf = null; };
	if (now) go(); else itemHide = setTimeout(go, 260);
}
for (const el of [itemTag, letGo]) {
	el.addEventListener('pointerenter', () => clearTimeout(itemHide));
	el.addEventListener('pointerleave', () => hideItemTag());
}
const [itemDownload, itemShare] = itemTag.querySelectorAll('.scrap');
itemDownload.onclick = () => itemOf && busy(itemDownload, async say => {
	const { P } = itemOf;
	count('download', P);
	download(await pack(P, say), fileName(P) + '.zip');
});
itemShare.onclick = () => { if (itemOf) { count('share', itemOf.P); sendLink(itemShare, 'i', itemOf.P); } };
letGo.onclick = () => { if (itemOf) toggleSave(itemOf.P); };

// a copy of the initial flies from the field into the collection
function flyIn(src, item) {
	const a = src.getBoundingClientRect(), b = item.querySelector('canvas').getBoundingClientRect();
	if (!a.width || !b.width) return;
	const ghost = document.createElement('canvas');
	ghost.width = src.width; ghost.height = src.height;
	ghost.getContext('2d').drawImage(src, 0, 0);
	ghost.className = 'flying';
	Object.assign(ghost.style, { left: a.left + 'px', top: a.top + 'px', width: a.width + 'px', height: a.height + 'px' });
	document.body.append(ghost);
	item.classList.add('arriving');
	requestAnimationFrame(() => requestAnimationFrame(() => {
		ghost.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${b.width / a.width})`;
	}));
	const land = () => { ghost.remove(); item.classList.remove('arriving'); };
	ghost.addEventListener('transitionend', land, { once: true });
	setTimeout(land, 1200);
}

// --- the collection, all at once ---------------------------------------------

// The collection as a page of its own, over the field: every saved initial, larger, as it is in the
// field. Click one to open it (in the middle, with more like it round it); × lets it go. Download
// them all as one zip, or share all: a link that carries the whole collection and opens as this
// page for whoever it's sent to, with a scrap to keep them. Back, Escape or the paper round them
// puts it away.
const album = $('#album'), albumPaper = $('#album-paper');
let albumOf = null;   // { Ps, mine, link (the link it came by, for a sent one), pushed (back puts it away) }
let afterAlbum = null; // what to do once back has put it away
function openAlbum(sent = null, { push = true } = {}) {
	if (albumOf) return;
	const mine = !sent, Ps = mine ? saved.map(s => ({ ...DEFAULTS, ...s.d })) : sent.Ps;
	if (!Ps.length) return;
	albumOf = { Ps, mine, link: sent && sent.link, pushed: push };
	if (push) {
		saveCam();
		history.pushState({ ...history.state, cam: { ...cam }, depth: depth() + 1, album: true }, '', location.href);
		setReach(depth());
	}
	if (mine && teach) teach.did('collection');
	closeLeaf();
	hoverOff();
	albumPaper.style.backgroundImage = paper.style.backgroundImage;
	album.querySelector('.title').textContent = mine ? 'your collection' : 'a collection';
	const keep = $('#album-keep');
	keep.hidden = mine;
	keep.disabled = false;
	words(keep).nodeValue = 'bookmark all';
	album.hidden = false;
	album.scrollTop = 0;
	fillAlbum();
	void album.offsetWidth;
	document.body.classList.add('album');
	ui();
}
function fillAlbum() {
	const grid = album.querySelector('.grid'), { Ps, mine } = albumOf;
	painters.cancel('album');
	album.querySelector('.n').textContent = Ps.length + (Ps.length === 1 ? ' initial' : ' initials');
	grid.replaceChildren();
	const ones = Ps.map(P => {
		const one = document.createElement('div'), cv = document.createElement('canvas');
		one.className = 'one';
		// its small picture at once, the one in the row, then drawn at this size
		const th = mine && thumbs.get(keyOf(P));
		if (th) { cv.width = cv.height = th.width; cv.getContext('2d').drawImage(th, 0, 0); }
		one.dataset.key = keyOf(P);
		one.append(cv);
		one.onclick = (e) => { e.stopPropagation(); fromAlbum(() => plant(P)); };
		if (mine) {
			const x = document.createElement('button');
			x.textContent = '×';
			x.setAttribute('aria-label', 'let it go');
			x.onclick = (e) => {
				e.stopPropagation();
				toggleSave(P);
				albumOf.Ps = albumOf.Ps.filter(q => q !== P);
				one.remove();
				if (!albumOf.Ps.length) fromAlbum();
				else album.querySelector('.n').textContent = albumOf.Ps.length + (albumOf.Ps.length === 1 ? ' initial' : ' initials');
			};
			one.append(x);
		}
		grid.append(one);
		if (mine) paperize(one.querySelector('button'), { color: '#fbf8f1', edges: { top: 'torn', right: 'torn', bottom: 'torn', left: 'torn' }, seed: 41 + grid.children.length, fibres: 0.3 });
		return [one, cv, P];
	});
	if (mine) spreadOut();
	// as large as the page lays them out
	requestAnimationFrame(() => {
		for (const [one, cv, P] of ones) {
			const size = Math.round(one.clientWidth * DPR);
			if (!size) continue;
			painters.run({ P, size, quality: QUALITY, budget: BUDGET, clear: true }, 'album').then(r => {
				if (!r) return;
				cv.width = cv.height = size;
				cv.getContext('2d').drawImage(r.bitmap, 0, 0);
				cv.dataset.drawn = 1;
				r.bitmap.close();
			});
		}
	});
}
// Opening and closing, after Rotation Camera's roll: the row along the foot spreads out into the
// page, each initial flying from its place in the row to its place on the page, a moment after
// the one before, on one gently damped spring, leaning a little on the way, while the paper fades
// in by itself behind them. Closing, they gather back the same way, last first.
const settle = t => {
	if (t >= 1) return 1;
	const z = 0.82, w = 9, d = w * Math.sqrt(1 - z * z);
	return 1 - Math.exp(-z * w * t) * (Math.cos(d * t) + z * w / d * Math.sin(d * t));
};
const stillness = matchMedia('(prefers-reduced-motion: reduce)');
// the initials on screen, each with how far it is from its place in the row
function flyers() {
	const list = $('#collection .items'), box = list.getBoundingClientRect(), out = [];
	const items = new Map([...list.children].map(el => [el.dataset.key, el]));
	for (const one of album.querySelectorAll('.one')) {
		const r = one.getBoundingClientRect(), item = items.get(one.dataset.key);
		if (!item || r.bottom < 0 || r.top > innerHeight) continue;
		const q = item.getBoundingClientRect(), half = q.width / 2;
		// one scrolled out of the row leaves from its end
		const x = Math.max(box.left + half, Math.min(box.right - half, q.left + half)), y = q.top + q.height / 2;
		out.push({ el: one.querySelector('canvas'), item, dx: x - (r.left + r.width / 2), dy: y - (r.top + r.height / 2), s: q.width / r.width, lean: (hash(one.dataset.key, 'lean') % 13 - 6) * 1.2 });
	}
	return out;
}
let flight = null;
function fly(items, { ms, gap, back = false, done = null }) {
	const me = flight = { back }, t0 = performance.now();
	// k: how far it is from its place on the page, 1 in the row
	const pose = (it, k) => {
		it.el.k = k;
		it.el.style.transform = `translate(${(it.dx * k).toFixed(2)}px, ${(it.dy * k).toFixed(2)}px) rotate(${(it.lean * Math.sin(Math.PI * k)).toFixed(3)}deg) scale(${(1 + (it.s - 1) * k).toFixed(4)})`;
	};
	album.classList.add('flying');
	// (closing while they're still opening, each goes back from where it's got to)
	for (const it of items) { it.from = back ? it.el.k || 0 : 1; pose(it, it.from); it.item.classList.add('away'); }
	const land = () => {
		if (flight !== me) return;
		flight = null;
		album.classList.remove('flying');
		if (!back) for (const it of items) { it.el.k = 0; it.el.style.transform = ''; it.item.classList.remove('away'); }
		if (done) done();
	};
	const frame = (now) => {
		if (flight !== me) return;
		let going = false;
		items.forEach((it, n) => {
			const t = (now - t0 - Math.min(n, 14) * gap) / ms, e = settle(Math.max(0, t));
			if (t < 1) going = true;
			pose(it, back ? it.from + (1 - it.from) * e : 1 - e);
		});
		if (going) requestAnimationFrame(frame); else land();
	};
	requestAnimationFrame(frame);
	// (a tab in the background gets no frames)
	setTimeout(land, ms + 14 * gap + 300);
}
function spreadOut() {
	if (stillness.matches) return;
	fly(flyers(), { ms: 500, gap: 14 });
}
function gatherBack() {
	const items = flyers().reverse();
	if (stillness.matches || !items.length) { hideAlbum(); return; }
	album.classList.add('gathering');
	document.body.classList.remove('album');
	fly(items, { ms: 450, gap: 10, back: true, done: hideAlbum });
}
// put it away: by going back, if it was opened here, and then `then`; a sent one (the page opened
// on it) is put away where it is
function fromAlbum(then = null) {
	if (!albumOf || (flight && flight.back)) return;
	if (albumOf.pushed) { afterAlbum = then; history.back(); return; }
	if (albumOf.mine && !then) gatherBack(); else hideAlbum();
	history.replaceState(history.state, '', location.pathname + hashOf(gen));
	if (then) then();
}
// a scrap's words (its text, among its paper and icon)
const words = el => [...el.childNodes].find(n => n.nodeType === 3 && n.nodeValue.trim());
function hideAlbum() {
	painters.cancel('album');
	flight = null;
	albumOf = null;
	album.hidden = true;
	album.classList.remove('flying', 'gathering');
	for (const item of $('#collection .items').children) item.classList.remove('away');
	album.querySelector('.grid').replaceChildren();
	document.body.classList.remove('album');
	ui();
}
album.addEventListener('click', (e) => { if (!e.target.closest('header, .one')) fromAlbum(); });
$('#collection .mark').onclick = () => openAlbum();
$('#album-keep').onclick = () => {
	if (!albumOf || albumOf.mine) return;
	// in their order, the first first
	for (const P of [...albumOf.Ps].reverse()) if (!isSaved(P)) saved.unshift({ key: keyOf(P), d: diff(P), at: Date.now(), thumb: null });
	store.set('scion:saved', JSON.stringify(saved));
	fillCollection();
	const keep = $('#album-keep');
	keep.disabled = true;
	words(keep).nodeValue = 'bookmarked';
};
$('#album-share').onclick = () => { if (albumOf) sendLink($('#album-share'), 'c', albumOf.Ps); };
$('#album-download').onclick = () => albumOf && busy($('#album-download'), async say => {
	const Ps = albumOf.Ps;
	download(await packAll(Ps, say), `initialis-collection-${Ps.length}.zip`);
});

let uiFor = null; // the picked cell ui() last saw with its initial
function ui() {
	const c = pickedCell(), P = c && c.P && shown(c.P), isRoot = c && c === rootCell();
	uiFor = P ? c : null;
	$('#hint').textContent = NO_GL ? 'this browser can’t draw them: they need WebGL2 off-screen (current Chrome, Firefox or Safari 17+)' : '';
	for (const [b, off] of [[$('#back'), depth() === 0 && !(solo && cameFrom)], [$('#fwd'), depth() >= reach]]) { b.classList.toggle('off', off); b.disabled = off; }
	if (P) {
		const on = isSaved(P);
		if ($('#save').classList.contains('on') !== on) { $('#save').classList.toggle('on', on); icon($('#save'), on ? 'saved' : 'save', INK); }
		retip($('#save'), on ? 'bookmarked' : 'bookmark');
		$('#pins').textContent = (isRoot && gen.pins && gen.pins.length) ? 'pinned: ' + gen.pins.filter(p => p !== 'ink').map(p => ({ letter: 'letter', frame: 'ground', orn: 'ornament', tex: 'texture', colour: 'colour' })[p]).join(', ') : '';
	}
	document.body.classList.toggle('flat', !paperOn);
	lean();
	placeTag();
	if (teach) teach.tick();
}
$('#back').onclick = () => { if (depth() > 0 || (solo && cameFrom)) history.back(); };
// if the browser had nothing forward after all, forward stops offering it
$('#fwd').onclick = () => {
	if (depth() >= reach) return;
	const d = depth();
	history.forward();
	setTimeout(() => { if (depth() === d) { setReach(d); ui(); } }, 500);
};
$('#save').onclick = () => { const c = pickedCell(); if (c) toggleSave(shown(c.P), c.el); };
$('#vary').onclick = () => { const c = pickedCell(); if (c && c.P) moreLike(c); };
$('#look').onclick = () => enterLook(pickedCell());
// the name: a fresh field (a modified click opens one in a new tab)
$('#name').onclick = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); if (albumOf) fromAlbum(freshField); else freshField(); };
// share: a link that opens on just this initial (?i=, its settings). On a phone, the share sheet;
// otherwise it's copied, and the scrap says so
$('#share').onclick = async () => {
	const c = pickedCell();
	if (!c || !c.P) return;
	count('share', shown(c.P));
	if (teach) teach.did('share');
	sendLink($('#share'), 'i', shown(c.P));
};

// A share link, for one initial (k "i") or a collection ("c", a list). Short on the site itself: an
// id (a hash of the settings, so the same initial always gets the same link) that the site keeps the
// settings under (functions/api/s.js). Anywhere it can't (offline, the site not answering, a copy
// with no server) the link carries everything itself: ?i=z.… for one, #c=z.… for a collection
// (after the #, so it never reaches a server and can be as long as it needs).
const KEEPS = /(^|\.)initialis\.azlen\.me$|\.initialis-6k5\.pages\.dev$/.test(location.hostname) || (TEST && Q.has('short'));
async function longLink(k, x) {
	return location.origin + location.pathname + (k === 'i' ? '?i=' + await shareCode(x) : '#c=' + await collectionCode(x));
}
function linkFor(k, x) {
	const body = shareBody(k, x), short = location.origin + location.pathname + '?' + k + '=' + shareId(k, body);
	if (!KEEPS || !navigator.onLine) return { now: null, url: longLink(k, x) };
	const kept = fetch('/api/s', { method: 'POST', body: JSON.stringify({ k, d: JSON.parse(body) }), keepalive: true })
		.then(r => r.ok ? r.json() : null).then(j => j && j.id === shareId(k, body)).catch(() => false);
	const late = new Promise(done => setTimeout(() => done(false), 3000));
	return { now: short, url: Promise.race([kept, late]).then(ok => ok ? short : longLink(k, x)) };
}
// On a phone, the share sheet, opened while the tap still counts (the short link at once, the site
// taking it meanwhile). Otherwise copied, on a slip under the scrap: the clipboard takes the link as
// a promise, so it's whichever one the site settles on.
async function sendLink(btn, k, x) {
	const note = say(btn), link = linkFor(k, x);
	if (matchMedia('(hover: none)').matches && navigator.share) {
		try { await navigator.share({ title: 'INITIĀLIS', url: link.now || await link.url }); return; }
		catch (e) { if (e.name === 'AbortError') return; }
	}
	try {
		if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) await navigator.clipboard.write([new ClipboardItem({ 'text/plain': link.url.then(u => new Blob([u], { type: 'text/plain' })) })]);
		else await navigator.clipboard.writeText(await link.url);
		note('link copied');
	} catch {
		const url = await link.url;
		try { await navigator.clipboard.writeText(url); note('link copied'); }
		catch { note('couldn’t copy it'); window.prompt('A link', url); }
	}
	setTimeout(() => note(''), 1800);
}

const fileName = P => `drop-cap-${P.text}-${hash(JSON.stringify(P)).toString(36)}`;
function download(blob, name) {
	const a = document.createElement('a');
	a.href = URL.createObjectURL(blob);
	a.download = name;
	a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
// a button that shows progress while its job runs
async function busy(btn, job) {
	if (btn.classList.contains('busy')) return;
	btn.classList.add('busy');
	const note = say(btn);
	try { await job(note); }
	catch (e) { console.warn(e); note('failed'); await new Promise(r => setTimeout(r, 1500)); }
	note('');
	btn.classList.remove('busy');
}
// a small note under a scrap
// a slip of paper under a scrap, for what it has to say; '' puts it away
function say(btn) {
	let n = btn.querySelector('.note');
	if (!n) { n = document.createElement('i'); n.className = 'note'; n.hidden = true; n.append(document.createElement('span')); btn.append(n); }
	const words = n.lastChild;
	return t => {
		words.textContent = t;
		n.hidden = !t;
		if (t && !n.paper) n.paper = paperize(n, { color: '#fbf8f1', edges: { top: 'torn', right: 'torn', bottom: 'torn', left: 'deckle' }, seed: 93 + btn.id.length, fibres: 0.3 });
	};
}

// the same geometry as the cell (same quality), printed large on its own paper
async function bigPNG(P, size = 2400) {
	const res = await painters.run({ P, size, quality: QUALITY, budget: 8000, once: true });
	if (!res) return null;
	const cv = document.createElement('canvas');
	cv.width = cv.height = size;
	cv.getContext('2d').drawImage(res.bitmap, 0, 0);
	res.bitmap.close();
	return new Promise(done => cv.toBlob(done, 'image/png'));
}

// growing in, then held for a moment: an animated WebP at 720 px on a transparent ground (a GIF at
// 600 on its paper where the browser can't make WebP), an MP4 at 1080 on its paper
const GROW_S = 2.4, HOLD_S = 1.5;
// The ink's grain leaves its alpha noisy, which WebP keeps losslessly: in 16 steps instead of 256 it
// takes half the room (about the GIF's), with no difference to see.
async function makeWebP(P, say, { size = 720, fps = 20, q = 0.85, levels = 16 } = {}) {
	const n = Math.round(GROW_S * fps);
	const cv = new OffscreenCanvas(size, size), x = cv.getContext('2d', { willReadFrequently: !!levels }), frames = [];
	const ok = await growFrames(P, size, n, async (bitmap, i) => {
		x.clearRect(0, 0, size, size);
		x.drawImage(bitmap, 0, 0);
		if (levels) {
			const im = x.getImageData(0, 0, size, size), d = im.data, k = (levels - 1) / 255;
			for (let j = 3; j < d.length; j += 4) d[j] = Math.round(Math.round(d[j] * k) / k);
			x.putImageData(im, 0, 0);
		}
		const still = await (await cv.convertToBlob({ type: 'image/webp', quality: q })).arrayBuffer();
		frames.push({ parts: imageChunks(still), ms: i === n - 1 ? HOLD_S * 1000 : Math.round(1000 / fps) });
		say(`${i + 1}/${n}`);
	}, { clear: true });
	if (!ok) throw new Error('a frame failed');
	return animatedWebP(frames, size, size);
}
// (Safari hands back a PNG; a canvas with no context would throw, and read as no)
const canWebP = async () => { try { const cv = new OffscreenCanvas(2, 2); cv.getContext('2d'); return (await cv.convertToBlob({ type: 'image/webp' })).type === 'image/webp'; } catch { return false; } };
// The browser encodes stills only, so the animation is put together here, after the WebP container
// spec: the stills' image chunks (alpha, then the picture) each wrapped in a frame (ANMF) that
// replaces the one before, after a header (VP8X: alpha, animated) and the loop (ANIM: forever).
const le = (v, n) => Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 255);
const fourcc = s => [...s].map(c => c.charCodeAt(0));
function cat(arrs) { const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0)); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }
const riffChunk = (id, body) => cat([new Uint8Array([...fourcc(id), ...le(body.length, 4)]), body, new Uint8Array(body.length & 1)]);
function imageChunks(buf) {
	const b = new Uint8Array(buf), parts = [];
	for (let o = 12; o + 8 <= b.length;) {
		const id = String.fromCharCode(...b.subarray(o, o + 4)), n = (b[o + 4] | b[o + 5] << 8 | b[o + 6] << 16 | b[o + 7] << 24) >>> 0, end = o + 8 + n + (n & 1);
		if (id === 'ALPH' || id === 'VP8 ' || id === 'VP8L') parts.push(b.subarray(o, end));
		o = end;
	}
	return parts;
}
function animatedWebP(frames, w, h) {
	const size = [...le(w - 1, 3), ...le(h - 1, 3)];
	const body = cat([new Uint8Array(fourcc('WEBP')),
		riffChunk('VP8X', new Uint8Array([0x12, 0, 0, 0, ...size])),
		riffChunk('ANIM', new Uint8Array(6)),
		...frames.map(f => riffChunk('ANMF', cat([new Uint8Array([0, 0, 0, 0, 0, 0, ...size, ...le(f.ms, 3), 0b10]), ...f.parts])))]);
	return new Blob([new Uint8Array([...fourcc('RIFF'), ...le(body.length, 4)]), body], { type: 'image/webp' });
}
async function makeGif(P, say) {
	const size = 600, fps = 15, n = Math.round(GROW_S * fps);
	const cv = new OffscreenCanvas(size, size), x = cv.getContext('2d', { willReadFrequently: true });
	// one palette for the whole loop, from the finished picture, so colours don't flicker
	const end = await painters.run({ P, size, quality: QUALITY, budget: 8000 });
	if (!end) throw new Error('render failed');
	x.drawImage(end.bitmap, 0, 0); end.bitmap.close();
	const palette = quantize(x.getImageData(0, 0, size, size).data, 256, { format: 'rgb444' });
	const enc = GIFEncoder();
	const ok = await growFrames(P, size, n, (bitmap, i) => {
		x.drawImage(bitmap, 0, 0);
		enc.writeFrame(applyPalette(x.getImageData(0, 0, size, size).data, palette, 'rgb444'), size, size, { palette, delay: i === n - 1 ? HOLD_S * 1000 : Math.round(1000 / fps) });
		say(`${i + 1}/${n}`);
	});
	if (!ok) throw new Error('a frame failed');
	enc.finish();
	return new Blob([enc.bytes()], { type: 'image/gif' });
}
async function makeMp4(P, say) {
	const size = 1080, fps = 30, n = Math.round(GROW_S * fps), hold = Math.round(HOLD_S * fps);
	let cfg = null;
	for (const codec of ['avc1.640028', 'avc1.4d0028', 'avc1.42e028']) {
		const c = { codec, width: size, height: size, bitrate: 14e6, framerate: fps };
		try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch { }
	}
	if (!cfg) throw new Error('no H.264 encoder here');
	const target = new ArrayBufferTarget();
	const muxer = new Muxer({ target, video: { codec: 'avc', width: size, height: size }, fastStart: 'in-memory' });
	let failed = null, f = 0;
	const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failed = e; } });
	enc.configure(cfg);
	const ok = await growFrames(P, size, n, async (bitmap, i) => {
		for (let h = 0; h < (i === n - 1 ? hold : 1); h++, f++) {
			const vf = new VideoFrame(bitmap, { timestamp: Math.round(f * 1e6 / fps), duration: Math.round(1e6 / fps) });
			enc.encode(vf, { keyFrame: f % (fps * 2) === 0 });
			vf.close();
		}
		if (enc.encodeQueueSize > 20) await enc.flush();
		if (failed) throw failed;
		say(`${i + 1}/${n}`);
	});
	if (!ok) throw new Error('a frame failed');
	await enc.flush();
	enc.close();
	muxer.finalize();
	return new Blob([target.buffer], { type: 'video/mp4' });
}

// download: one zip for the initial. The initial alone on a transparent ground (the ink without its
// paper, to lay on anything) at four sizes, printed on its own paper, an animated WebP (also
// transparent) and an MP4 of it growing in when it grows, and its settings with a link that opens
// it here again.
const SIZES = [2400, 1200, 600, 256];
async function pack(P, say) {
	const name = fileName(P), files = [], png = cv => new Promise(done => cv.toBlob(done, 'image/png'));
	say('inking…');
	const res = await painters.run({ P, size: SIZES[0], quality: QUALITY, budget: 8000, once: true, clear: true });
	if (!res) throw new Error('render failed');
	let cv = document.createElement('canvas');
	cv.width = cv.height = SIZES[0];
	cv.getContext('2d').drawImage(res.bitmap, 0, 0);
	res.bitmap.close();
	// each size from the one before, so the small ones keep their fine lines
	for (const n of SIZES) {
		if (n !== cv.width) {
			const next = document.createElement('canvas');
			next.width = next.height = n;
			const x = next.getContext('2d');
			x.imageSmoothingQuality = 'high';
			x.drawImage(cv, 0, 0, n, n);
			cv = next;
		}
		files.push({ name: `${name}/${name}-${n}.png`, data: await png(cv) });
	}
	say('on paper…');
	files.push({ name: `${name}/${name}-on-paper-2400.png`, data: await bigPNG(P) });
	const grows = animates(P);
	if (grows) {
		if (await canWebP()) files.push({ name: `${name}/${name}-growing.webp`, data: await makeWebP(P, t => say('webp ' + t)) });
		else files.push({ name: `${name}/${name}-growing.gif`, data: await makeGif(P, t => say('gif ' + t)) });
		if (typeof VideoEncoder !== 'undefined') {
			try { files.push({ name: `${name}/${name}-growing.mp4`, data: await makeMp4(P, t => say('mp4 ' + t)) }); }
			catch (e) { console.warn(e); }
		}
	}
	const face = (fonts.find(f => f.id === P.font) || {}).name || P.font;
	// its own field: this initial in the middle with its children round it
	const link = location.origin + location.pathname + '#' + encodeGen({ seed: gen.seed, root: { q: 0, r: 0, P } });
	files.push({ name: `${name}/${name}.json`, data: JSON.stringify({ letter: P.text, font: P.font, link, params: diff(P) }, null, '\t') + '\n' });
	const what = { png: 'on a transparent ground', 'on-paper-2400.png': '2400 px, printed on its paper', webp: '720 px, growing in on a transparent ground, then holding (an animated WebP)', gif: '600 px, growing in on its paper, then holding', mp4: '1080 px, growing in on its paper, then holding', json: 'its settings' };
	const listed = files.map(f => f.name.split('/')[1]), w = Math.max(...listed.map(n => n.length)) + 3;
	files.push({ name: `${name}/README.txt`, data: [
		`Drop cap ${P.text}, set in ${face}.`, '',
		...listed.map(n => n.padEnd(w) + (n.endsWith('on-paper-2400.png') ? what['on-paper-2400.png'] : n.endsWith('.png') ? `${n.match(/-(\d+)\.png$/)[1]} px, ${what.png}` : what[n.split('.').pop()])),
		'', 'Open it again, with more like it round it:', link, '',
	].join('\n') });
	say('packing…');
	return zip(files);
}
// download all: one zip for the collection. Each initial on a transparent ground at 1200 px, all of
// them together on their papers in one picture, and their settings, with a link to each and to the
// whole collection. (No animations: for many initials they'd take minutes; each one's own download
// has them.)
async function packAll(Ps, say) {
	const dir = `initialis-collection-${Ps.length}`, files = [], list = [];
	const cols = Math.min(4, Math.ceil(Math.sqrt(Ps.length))), rows = Math.ceil(Ps.length / cols), cell = 600, gap = 48;
	const sheet = new OffscreenCanvas(cols * cell + (cols + 1) * gap, rows * cell + (rows + 1) * gap), sx = sheet.getContext('2d');
	sx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#f3efe6';
	sx.fillRect(0, 0, sheet.width, sheet.height);
	for (let i = 0; i < Ps.length; i++) {
		say(`${i + 1}/${Ps.length}`);
		const P = Ps[i], name = fileName(P);
		const [alone, on] = await Promise.all([
			painters.run({ P, size: 1200, quality: QUALITY, budget: 8000, once: true, clear: true }),
			painters.run({ P, size: cell, quality: QUALITY, budget: 8000 }),
		]);
		if (alone) {
			const cv = new OffscreenCanvas(1200, 1200);
			cv.getContext('2d').drawImage(alone.bitmap, 0, 0);
			alone.bitmap.close();
			files.push({ name: `${dir}/${name}.png`, data: await cv.convertToBlob({ type: 'image/png' }) });
		}
		if (on) { sx.drawImage(on.bitmap, gap + (i % cols) * (cell + gap), gap + Math.floor(i / cols) * (cell + gap)); on.bitmap.close(); }
		list.push({ letter: P.text, font: P.font, file: alone ? name + '.png' : null, link: await linkFor('i', P).url, params: diff(P) });
	}
	say('packing…');
	const link = await linkFor('c', Ps).url;
	files.push({ name: `${dir}/all-on-paper.png`, data: await sheet.convertToBlob({ type: 'image/png' }) });
	files.push({ name: `${dir}/collection.json`, data: JSON.stringify({ link, initials: list }, null, '\t') + '\n' });
	files.push({ name: `${dir}/README.txt`, data: [
		`${Ps.length} drop caps from INITIĀLIS.`, '',
		...[...list.filter(x => x.file).map(x => [x.file, x.letter + ', 1200 px, on a transparent ground']),
			['all-on-paper.png', 'all of them, each printed on its paper'], ['collection.json', 'their settings, and a link to each']]
			.map(([f, what], _, all) => f.padEnd(Math.max(...all.map(a => a[0].length)) + 3) + what),
		'', 'Open the collection again:', link, '',
	].join('\n') });
	return zip(files);
}
$('#download').onclick = () => pickedCell() && busy($('#download'), async say => {
	const P = shown(pickedCell().P);
	count('download', P);
	download(await pack(P, say), fileName(P) + '.zip');
});

// in context, flat: the opening page (render/data/paragraphs.json in ET Book) in a box, for
// browsers without WebGPU
async function showContext(P) {
	const box = $('#context');
	box.hidden = false;
	box.innerHTML = '<p>setting the page…</p>';
	const h = Math.round(Math.min(innerHeight - 32, 1100)), w = Math.round(Math.min(innerWidth - 32, h * 0.72));
	const ch = /^[A-Z]/.test(P.text) ? P.text[0] : 'A';
	const r = await painters.run({ P, size: Math.round(h * DPR), w: Math.round(w * DPR), page: ch, k: 1, measure: 420, quality: QUALITY, budget: 8000, once: true }, 'context');
	if (box.hidden) { if (r) r.bitmap.close(); return; }
	if (!r) { box.innerHTML = '<p>that page failed to set</p>'; return; }
	const cv = document.createElement('canvas');
	cv.width = r.bitmap.width; cv.height = r.bitmap.height;
	cv.style.width = w + 'px'; cv.style.height = h + 'px';
	cv.getContext('bitmaprenderer').transferFromImageBitmap(r.bitmap);
	box.replaceChildren(cv);
}
function closeContext() { $('#context').hidden = true; $('#context').replaceChildren(); painters.cancel('context'); }
$('#context').onclick = closeContext;

// in context: an aged sheet across the whole screen (context.js), its text set round the initial
// where it sits, the other initials showing faintly through it, and the initial itself laid on top
// as crisp as in the field. Any click goes back to the field.
let leafEl = null, leafTicket = 0;
// In context's code (the page setter, opentype.js, the WebGPU ageing: about 290 KB) loads when
// it's first wanted, not before the field: fetched quietly once an initial is picked, so the click
// still finds it ready
const canAge = () => !!navigator.gpu;
let contextMod = null;
const loadContext = () => contextMod || (contextMod = import('./context.js?v=a8136959').catch(e => { contextMod = null; throw e; }));
async function showLeaf() {
	// a share link's lone initial is set on its page at the field's size
	leaveSolo();
	const c = pickedCell();
	if (!c) return;
	if (leafEl) { closeLeaf(); return; }
	if (c.P) count('context', shown(c.P));
	if (teach) teach.did('context');
	if (!canAge()) { showContext(shown(c.P)); return; }
	const t = ++leafTicket, note = say($('#incontext'));
	stopPlays();
	note('setting…');
	try {
		// the view eases so the initial sits up and to the left, with room for the page beside and below
		// it; the page is set for where things will be while the camera moves
		const W = innerWidth, H = innerHeight, side = c.s * S;
		const sx = Math.max(32, Math.min(W * 0.24, W - side - 760)), sy = Math.max(140, H * 0.26);
		const to = { x: c.x - (sx + side / 2 - W / 2) / S, y: c.y - (sy + side / 2 - H / 2) / S };
		const at = (o) => ({ x: (o.x - o.s / 2 - to.x) * S + W / 2, y: (o.y - o.s / 2 - to.y) * S + H / 2, s: o.s * S });
		const ghosts = [...cells.values()].filter(o => o !== c && o.el.classList.contains('shown') && !o.el.classList.contains('gone'))
			.map(o => ({ src: o.el, ...at(o) })).filter(g => g.x < W && g.y < H && g.x + g.s > 0 && g.y + g.s > 0);
		const glide = glideTo(to.x, to.y);
		const { sheetAround } = await loadContext();
		const res = await sheetAround({
			P: shown(c.P), box: at(c), w: W, h: H, ghosts,
			paint: (P, px) => painters.run({ P, size: px, quality: QUALITY, budget: 8000, once: true }, 'context').then(x => x && x.bitmap),
		});
		await glide;
		const r = c.el.getBoundingClientRect();
		if (t !== leafTicket || !res || pickedCell() !== c) return;
		if (TEST) window.__leafRes = { S: res.S, lines: res.lines, indents: res.indents };
		const el = leafEl = document.createElement('div');
		el.id = 'sheet';
		res.canvas.className = 'aged';
		const cap = document.createElement('canvas');
		cap.width = c.el.width; cap.height = c.el.height;
		cap.getContext('2d').drawImage(c.el, 0, 0);
		cap.className = 'initial';
		Object.assign(cap.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
		el.append(res.canvas, cap);
		el.addEventListener('pointerdown', (e) => { e.stopPropagation(); closeLeaf(); });
		el.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
		document.body.append(el);
		requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('shown')));
		placeTag();
	} catch (e) {
		console.warn(e);
		if (t === leafTicket) showContext(shown(c.P));
	} finally { note(''); }
}
// the camera eased to a point, in about half a second (a timer finishes it if frames stall)
function glideTo(x, y, ms = 520) {
	glide = null;
	return new Promise(done => {
		const x0 = cam.x, y0 = cam.y, t0 = performance.now();
		let over = false;
		const end = () => { if (over) return; over = true; cam.x = x; cam.y = y; update(); saveCamSoon(); done(); };
		const step = () => {
			if (over) return;
			const u = Math.min(1, (performance.now() - t0) / ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
			cam.x = x0 + (x - x0) * e; cam.y = y0 + (y - y0) * e;
			update();
			if (u < 1) requestAnimationFrame(step); else end();
		};
		requestAnimationFrame(step);
		setTimeout(end, ms + 150);
	});
}
function closeLeaf() {
	leafTicket++;
	if (!leafEl) return;
	const el = leafEl;
	leafEl = null;
	el.classList.remove('shown');
	setTimeout(() => el.remove(), 500);
	placeTag();
}
$('#incontext').onclick = () => showLeaf();


// the paper is made in a worker (paper-worker.js) so the page stays free for the first initials;
// paperCanvas, for the test sheets, is made from what comes back
let paperCanvas = null;
function makePaper() {
	const w = new Worker(new URL('./paper-worker.js?v=a8136959', import.meta.url), { type: 'module' });
	w.onmessage = ({ data: blob }) => {
		paper.style.backgroundImage = `url(${URL.createObjectURL(blob)})`;
		if (!album.hidden) albumPaper.style.backgroundImage = paper.style.backgroundImage;
		if (TEST) createImageBitmap(blob).then(b => { paperCanvas = b; });
	};
	w.postMessage({ css: TILE, dpr: DPR });
}

// --- boot -------------------------------------------------------------------

async function boot() {
	const [list, kept] = await Promise.all([
		fontList(),
		fetch('render/data/kept.json').then(r => r.ok ? r.json() : []).catch(() => []),
	]);
	fonts = fieldFonts(list);
	setKept(kept);
	const { g: dg, l } = readHash();
	const shared = solo ? await decodeInitial(Q.get('i')) : null;
	if (solo && !shared) { solo = false; S = cellSize(); }
	const g = shared ? { seed: newSeed(), root: { q: 0, r: 0, P: shared } } : dg || { seed: newSeed(), root: null };
	letter = shared ? null : l;
	count('visit');
	if (shared) count(Q.has('look') ? 'look' : 'open', shared);
	const st = history.state || {};
	if (st.cam) Object.assign(cam, st.cam);
	else if (g.root) [cam.x, cam.y] = pos(g.root.q, g.root.r);
	else [cam.x, cam.y] = base(0, 0).slice(0, 2);
	// a view that opens sits exactly on one initial (a restored camera may be anywhere)
	[cam.x, cam.y] = pos(...centreCell());
	gen = g;
	picked = g.root ? g.root.q + ',' + g.root.r : null;
	// a collection sent as a link (?c=<id>, or #c=z.… with it all in the link) opens as its page,
	// over a fresh field, once the field is up
	const sent = Q.get('c') || (location.hash.startsWith('#c=') ? location.hash.slice(3) : null);
	history.replaceState({ cam: { ...cam }, depth: st.depth || 0 }, '', location.pathname + location.search + (solo ? '' : sent ? location.hash : hashOf(g)));
	// a fresh visit has nothing forward of it, whatever this tab remembers from before; a reload or
	// coming back keeps what was there
	const nav = performance.getEntriesByType('navigation')[0];
	if (!nav || nav.type === 'navigate') setReach(depth());
	field = new Field(g, fonts);
	preroll = performance.now() + PREROLL;
	if (g.root) { const [rx, ry] = pos(g.root.q, g.root.r); startWave(rx, ry); } else startWave();
	painters = new Painters(poolSize(), next);
	world.append(tools, tag);
	paperize($('#bar'), { color: '#fbf8f1', edges: { top: 'cut', right: 'torn', bottom: 'torn', left: 'cut' }, seed: 11 });
	// the arrows stay under the name, however tall what's in the bar makes it
	new ResizeObserver(() => { $('#nav').style.top = $('#bar').getBoundingClientRect().bottom + 8 + 'px'; }).observe($('#bar'));
	// each thing the tag does on its own scrap, a little askew
	document.querySelectorAll('.tag .scrap').forEach((el, i) => {
		if (el.dataset.icon) icon(el, el.dataset.icon, INK);
		if (isShare(el) && el.classList.contains('word')) el.querySelector('canvas:not(.sheet-bg)').replaceWith(drawShare(18, { color: INK }));
		el.style.setProperty('--tilt', ((hash(i, 'tilt') % 9) - 4) * 0.8 + 'deg');
		const edges = ['torn', 'deckle', 'torn', 'torn'];
		scrapPapers.push([el, paperize(el, { color: isShare(el) ? SHARE_PAPER : i % 3 === 1 ? '#f7f1e3' : '#fbf8f1', edges: { top: edges[i % 4], right: edges[(i + 1) % 4], bottom: edges[(i + 2) % 4], left: edges[(i + 3) % 4] }, seed: 60 + i, fibres: 0.4 })]);
	});
	document.querySelectorAll('#nav .scrap').forEach((el, i) => {
		icon(el, el.dataset.icon, INK);
		el.style.setProperty('--tilt', (i ? 1.4 : -1.1) + 'deg');
		paperize(el, { color: '#fbf8f1', edges: { top: 'torn', right: i ? 'deckle' : 'torn', bottom: 'torn', left: i ? 'torn' : 'deckle' }, seed: 70 + i, fibres: 0.4 });
	});
	paperize($('#collection'), { color: '#f8f4ea', edges: { top: 'torn', right: 'torn', bottom: 'cut', left: 'torn' }, seed: 37 });
	$('#collection .mark').append(drawIcon('saved', 25, { color: '#857d70', seed: 5 }));
	paperize($('#corner a'), { color: '#1f1c1a', edges: { top: 'cut', right: 'cut', bottom: 'torn', left: 'cut' }, seed: 83, fibres: 0.7 });
	$('#corner a').append(drawIcon('github', 30, { color: '#f6f1e7', seed: 9 }));
	if (!NO_GL) teach = lesson({ store, world, aim, picked: () => picked, saved: () => saved.length, quiet: () => !!albumOf,
		// the picked initial to the middle, if it or its scraps are partly off screen
		centre: () => {
			const c = pickedCell();
			if (!c) return;
			const out = [c.el, tag, tools].filter(el => !el.hidden).map(el => el.getBoundingClientRect()).some(r => r.left < 12 || r.top < 12 || r.right > innerWidth - 12 || r.bottom > innerHeight - 12);
			if (out) glideTo(c.x, c.y);
		},
		busy: () => [tag, tools].filter(el => !el.hidden).map(el => el.getBoundingClientRect()).concat(pickedCell() ? [pickedCell().el.getBoundingClientRect()] : []) });
	ui();
	fillCollection();
	update();
	setTimeout(makePaper, 50);
	if (sent) {
		const Ps = isShareId(sent) ? await fetchShared('c', sent) : await decodeCollection(sent);
		if (Ps && Ps.length) openAlbum({ Ps, link: location.href }, { push: false });
		else history.replaceState(history.state, '', location.pathname + hashOf(gen));
	}
}


boot();
