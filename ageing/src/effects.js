// Every way a page can age, as data. Each effect has an amount (0 = off) and up to seven more
// knobs; they pack into two vec4s per effect in the shader's uniforms (slot 0 = amount, then the
// params in order). `ages`: the amount is scaled by the master age, so dragging age from 0 to 1
// grows the effect in. Effects without it (how the page was printed) hold still.
//
// Selects pack as their option index. `seed` knobs reroll where things land.

export const GROUPS = [
	['paper', 'Paper'],
	['stains', 'Stains'],
	['handling', 'Handling'],
	['damage', 'Damage'],
	['ink', 'Ink'],
];

const r = (k, label, min, max, def, step = 0.01) => ({ k, label, type: 'range', min, max, def, step });
const sel = (k, label, options, def = 0) => ({ k, label, type: 'select', options, def });
const seed = { k: 'seed', label: 'seed', type: 'seed', def: 1 };

export const EFFECTS = [
	// ── paper ───────────────────────────────────────────────────────────────────────────────
	{ id: 'stock', group: 'paper', name: 'stock', note: 'The sheet itself: its white, the cloud of fibres, the laid and chain lines of a mould-made sheet.', ages: false, amount: 1,
		params: [r('fibre', 'formation', 0, 1, 0.35), r('laid', 'laid lines', 0, 1, 0), r('warm', 'white', -1, 1, 0)] },
	{ id: 'tone', group: 'paper', name: 'yellowing', note: 'Acid in the pulp browns the whole sheet: cream, straw, ochre, tan. Uneven, darker where the air got in.', ages: true, amount: 0,
		params: [r('warm', 'warmth', 0, 1, 0.5), r('mottle', 'mottle', 0, 1, 0.35), r('edge', 'edge browning', 0, 1, 0.5), r('band', 'edge band', 0, 1, 0.35), seed] },
	{ id: 'ghost', group: 'paper', name: 'ghost', note: 'Something lay on the page for decades: a bookmark kept it pale, a clipping or a pressed leaf left an acid shadow.', ages: true, amount: 0,
		params: [sel('shape', 'what', ['bookmark', 'clipping', 'pressed leaf', 'fern']), r('size', 'size', 0, 1, 0.5), seed] },
	{ id: 'show', group: 'paper', name: 'show-through', note: 'The paper thins and goes translucent; the back of the leaf reads through, mirrored and soft.', ages: true, amount: 0,
		params: [r('soft', 'softness', 0, 1, 0.4)] },
	{ id: 'offset', group: 'paper', name: 'offset', note: 'The facing page printed itself onto this one, a brown mirrored ghost, over years pressed shut.', ages: true, amount: 0,
		params: [r('soft', 'softness', 0, 1, 0.3), r('warm', 'brown', 0, 1, 0.6)] },

	// ── stains ──────────────────────────────────────────────────────────────────────────────
	{ id: 'foxing', group: 'stains', name: 'foxing', note: 'Rust-brown spots, fungal and iron: bullseyes with dark cores, diffuse snowflakes, clustered in patches.', ages: true, amount: 0,
		params: [r('count', 'count', 0, 1, 0.5), r('size', 'size', 0, 1, 0.4), r('core', 'cores', 0, 1, 0.5), r('cluster', 'clustering', 0, 1, 0.6), r('hue', 'hue', 0, 1, 0.4), seed] },
	{ id: 'water', group: 'stains', name: 'water', note: 'The page got wet and dried, more than once: tide lines where the front stopped, cockling, ink that let go.', ages: true, amount: 0,
		params: [sel('from', 'from', ['bottom', 'corner', 'top', 'fore-edge', 'a spill']), r('rings', 'tide lines', 0, 1, 0.5), r('dark', 'darkness', 0, 1, 0.5), r('bleed', 'ink bleeds', 0, 1, 0.5), seed] },
	{ id: 'coffee', group: 'stains', name: 'coffee', note: 'A cup set down on the open book: a ring with a dark rim where the coffee dried, splashes, a second try.', ages: true, amount: 0,
		params: [r('count', 'rings', 0, 1, 0.3), r('size', 'size', 0, 1, 0.5), r('splash', 'splashes', 0, 1, 0.4), seed] },
	{ id: 'grease', group: 'stains', name: 'grease', note: 'Oil turns paper translucent: dark glassy spots where the back of the leaf shows through.', ages: true, amount: 0,
		params: [r('count', 'spots', 0, 1, 0.3), r('size', 'size', 0, 1, 0.5), seed] },
	{ id: 'mould', group: 'stains', name: 'mould', note: 'Colonies from a damp shelf: dense speckled cores, fuzzy fringes, a stained halo.', ages: true, amount: 0,
		params: [sel('kind', 'kind', ['grey-green', 'black', 'rose']), r('count', 'colonies', 0, 1, 0.4), r('size', 'size', 0, 1, 0.5), seed] },
	{ id: 'rust', group: 'stains', name: 'rust', note: 'A paper clip, a pair of staples, a pin: the metal is gone, its rust stays.', ages: true, amount: 0,
		params: [sel('kind', 'what', ['paper clip', 'staples', 'pin']), seed] },
	{ id: 'tape', group: 'stains', name: 'tape', note: 'Old sticky tape: clear, then amber, then the film falls off and leaves a brown oblong of glue.', ages: true, amount: 0,
		params: [r('count', 'strips', 0, 1, 0.3), seed] },

	// ── handling ────────────────────────────────────────────────────────────────────────────
	{ id: 'thumb', group: 'handling', name: 'thumbing', note: 'Years of turning: grime and fingerprints at the corner where the page is lifted.', ages: true, amount: 0,
		params: [sel('corner', 'corner', ['lower', 'upper', 'both']), r('prints', 'fingerprints', 0, 1, 0.5), seed] },
	{ id: 'dust', group: 'handling', name: 'dust', note: 'Dust settled on the top edge of the closed book; specks, fly specks, a stray hair.', ages: true, amount: 0,
		params: [r('top', 'top edge', 0, 1, 0.6), r('specks', 'specks', 0, 1, 0.5), seed] },
	{ id: 'folds', group: 'handling', name: 'folds', note: 'Folded like a letter: panels that catch the light differently, creases rubbed and grimy.', ages: false, amount: 0,
		params: [sel('pattern', 'folded in', ['half', 'thirds', 'quarters', 'sixths']), r('wear', 'crease wear', 0, 1, 0.5), seed] },
	{ id: 'crumple', group: 'handling', name: 'crumple', note: 'Balled up and smoothed out again: a web of creases.', ages: false, amount: 0,
		params: [r('count', 'creases', 0, 1, 0.5), r('fine', 'fine wrinkles', 0, 1, 0.4), seed] },
	{ id: 'cockle', group: 'handling', name: 'cockling', note: 'Damp and dry again: the sheet goes wavy along its grain.', ages: true, amount: 0,
		params: [r('scale', 'wave', 0, 1, 0.5), r('vary', 'unevenness', 0, 1, 0), seed] },
	{ id: 'dogear', group: 'handling', name: 'dog-ear', note: 'A corner turned down to keep the place.', ages: false, amount: 0,
		params: [sel('corner', 'corner', ['upper', 'lower']), sel('state', 'state', ['folded', 'unfolded']), seed] },

	// ── damage ──────────────────────────────────────────────────────────────────────────────
	{ id: 'edges', group: 'damage', name: 'worn edges', note: 'The edges soften, chip and fray; the corners round off.', ages: true, amount: 0,
		params: [r('chips', 'chips', 0, 1, 0.5), r('round', 'round corners', 0, 1, 0.5), r('fray', 'fray', 0, 1, 0.5), seed] },
	{ id: 'tear', group: 'damage', name: 'tear', note: 'Torn: a corner gone, or a split from the edge. A fresh tear shows the white core of old paper.', ages: false, amount: 0,
		params: [sel('kind', 'kind', ['corner gone', 'split', 'edge bite']), r('white', 'white edge', 0, 1, 0.6), seed] },
	{ id: 'worms', group: 'damage', name: 'bookworm', note: 'Beetle larvae tunnelled through the book: wandering galleries, round exit holes.', ages: true, amount: 0,
		params: [r('count', 'tunnels', 0, 1, 0.4), r('holes', 'exit holes', 0, 1, 0.3), seed] },
	{ id: 'scorch', group: 'damage', name: 'scorch', note: 'Burnt at one edge: ash, a black curl of char, brown scorch fading into the page.', ages: true, amount: 0,
		params: [sel('edge', 'edge', ['fore-edge', 'bottom', 'top', 'corner']), seed] },

	// ── ink ─────────────────────────────────────────────────────────────────────────────────
	{ id: 'press', group: 'ink', name: 'impression', note: 'How it was printed: uneven inking, ink squashed to the letter edges, worn and broken type.', ages: false, amount: 0,
		params: [r('uneven', 'uneven', 0, 1, 0.5), r('squash', 'squash', 0, 1, 0.5), r('rough', 'rough edges', 0, 1, 0.5), r('broken', 'broken sorts', 0, 1, 0.3), seed] },
	{ id: 'fade', group: 'ink', name: 'fading', note: 'Ink loses its black. Iron gall goes brown, aniline goes violet, lamp black only greys.', ages: true, amount: 0,
		params: [sel('ink', 'ink', ['iron gall', 'aniline', 'lamp black', 'blue-black']), r('uneven', 'uneven', 0, 1, 0.4)] },
	{ id: 'rub', group: 'ink', name: 'rubbed', note: 'Ink worn away by hands and other pages: patchy, thin strokes first, worst at corners and folds.', ages: true, amount: 0,
		params: [r('patch', 'patchiness', 0, 1, 0.5), seed] },
	{ id: 'smudge', group: 'ink', name: 'smudge', note: 'Wet ink dragged by a finger: smears with the ridges of the skin in them.', ages: false, amount: 0,
		params: [r('count', 'smudges', 0, 1, 0.3), r('angle', 'direction', 0, 1, 0.1), seed] },
	{ id: 'feather', group: 'ink', name: 'feathering', note: 'Ink wicks out along the fibres into a fuzzy halo; the letters fatten.', ages: true, amount: 0,
		params: [r('reach', 'reach', 0, 1, 0.4), r('hair', 'fibres', 0, 1, 0.6)] },
	{ id: 'run', group: 'ink', name: 'running', note: 'Water-soluble ink ran: streaks dripping down from each line.', ages: true, amount: 0,
		params: [r('length', 'length', 0, 1, 0.5), r('angle', 'direction', 0, 1, 0.5), seed] },
	{ id: 'corrode', group: 'ink', name: 'ink burn', note: 'Iron gall eats its paper: brown halos, then cracks, then the letters fall out as holes.', ages: true, amount: 0,
		params: [r('halo', 'halo', 0, 1, 0.5), r('holes', 'holes', 0, 1, 0.5), seed] },
	{ id: 'flake', group: 'ink', name: 'flaking', note: 'A thick ink film crazes and lifts off in flakes.', ages: true, amount: 0,
		params: [r('size', 'flake size', 0, 1, 0.4), seed] },
];

export const FX = Object.fromEntries(EFFECTS.map((e, i) => [e.id, { ...e, index: i }]));

export function defaultState() {
	const fx = {};
	for (const e of EFFECTS) {
		fx[e.id] = { amount: e.amount };
		for (const p of e.params) fx[e.id][p.k] = p.def;
	}
	return { age: 1, fx, light: 0.5, lightAngle: 0.62, ground: 0, under: 1 };
}

// pack into Float32 slots: 8 per effect
export function packFx(state, out) {
	EFFECTS.forEach((e, i) => {
		const s = state.fx[e.id];
		const a = s.amount * (e.ages ? state.age : 1);
		out[i * 8] = a;
		e.params.forEach((p, j) => {
			let v = s[p.k];
			if (p.type === 'select') v = Math.max(0, p.options.indexOf(v) >= 0 ? p.options.indexOf(v) : +v || 0);
			out[i * 8 + 1 + j] = v;
		});
	});
	return out;
}

// WGSL constants naming each effect's slot: const FX_FOXING = 5u; …
export const FX_WGSL = EFFECTS.map((e, i) => `const FX_${e.id.toUpperCase()}: u32 = ${i}u;`).join('\n') + `\nconst FX_COUNT: u32 = ${EFFECTS.length}u;`;

// ── recipes ─────────────────────────────────────────────────────────────────────────────────
// Partial states: only what differs from clean.
export const RECIPES = {
	'clean': {},
	'attic paperback': { tone: { amount: 0.85, warm: 0.8, mottle: 0.25, edge: 0.8, band: 0.45 }, show: { amount: 0.55 }, dust: { amount: 0.6, top: 0.8, specks: 0.4 }, edges: { amount: 0.35, chips: 0.3, round: 0.4, fray: 0.2 }, foxing: { amount: 0.25, count: 0.3, size: 0.25 } },
	'foxed octavo': { tone: { amount: 0.45, warm: 0.35, mottle: 0.4, edge: 0.4 }, foxing: { amount: 0.9, count: 0.75, size: 0.45, core: 0.6, cluster: 0.7 }, offset: { amount: 0.5 }, press: { amount: 0.6, uneven: 0.5, squash: 0.5, rough: 0.4, broken: 0.25 }, fade: { amount: 0.25, ink: 'lamp black' } },
	'flooded': { tone: { amount: 0.4, warm: 0.5 }, water: { amount: 0.85, from: 'bottom', rings: 0.7, dark: 0.6, bleed: 0.35 }, cockle: { amount: 0.8, scale: 0.5 }, mould: { amount: 0.55, kind: 'grey-green', count: 0.35 }, run: { amount: 0.25, length: 0.35 }, fade: { amount: 0.3, ink: 'lamp black' } },
	'folded letter': { tone: { amount: 0.5, warm: 0.3, mottle: 0.45, edge: 0.6 }, folds: { amount: 0.8, pattern: 'thirds', wear: 0.7 }, fade: { amount: 0.75, ink: 'iron gall', uneven: 0.5 }, corrode: { amount: 0.45, halo: 0.6, holes: 0.3 }, edges: { amount: 0.5, chips: 0.4, round: 0.5, fray: 0.4 }, thumb: { amount: 0.4, prints: 0.3 } },
	'library copy': { tone: { amount: 0.35, warm: 0.6 }, thumb: { amount: 0.85, corner: 'lower', prints: 0.7 }, rub: { amount: 0.45, patch: 0.5 }, tape: { amount: 0.6, count: 0.3 }, tear: { amount: 0.5, kind: 'split' }, coffee: { amount: 0.6, count: 0.3, size: 0.55 }, dogear: { amount: 0.55, state: 'unfolded' } },
	'worm-eaten': { tone: { amount: 0.6, warm: 0.45, mottle: 0.5, edge: 0.6 }, worms: { amount: 0.85, count: 0.5, holes: 0.4 }, edges: { amount: 0.6, chips: 0.6, round: 0.6, fray: 0.5 }, foxing: { amount: 0.4, count: 0.4 }, press: { amount: 0.5 } },
	'scorched': { tone: { amount: 0.5, warm: 0.7, edge: 0.5 }, scorch: { amount: 0.75, edge: 'fore-edge' }, dust: { amount: 0.5, top: 0.3, specks: 0.7 }, crumple: { amount: 0.5, count: 0.5 }, fade: { amount: 0.3, ink: 'lamp black' } },
	'pressed flower': { tone: { amount: 0.4, warm: 0.4, mottle: 0.3 }, ghost: { amount: 0.85, shape: 'pressed leaf', size: 0.6 }, foxing: { amount: 0.35, count: 0.3, cluster: 0.8 }, show: { amount: 0.3 } },
	'the drawer': { tone: { amount: 0.55, warm: 0.6, edge: 0.3 }, rust: { amount: 0.8, kind: 'paper clip' }, crumple: { amount: 0.35, count: 0.35, fine: 0.3 }, ghost: { amount: 0.6, shape: 'clipping', size: 0.55 }, grease: { amount: 0.5, count: 0.25 }, dust: { amount: 0.4 } },
};

export function applyRecipe(name) {
	const st = defaultState();
	const rec = RECIPES[name] || {};
	for (const [id, v] of Object.entries(rec)) Object.assign(st.fx[id], v);
	return st;
}

// a random but coherent mix: a base of yellowing, then a handful of other things
export function vary(state, rand = Math.random) {
	const st = defaultState();
	st.age = state.age;
	st.light = state.light; st.lightAngle = state.lightAngle; st.ground = state.ground; st.under = state.under;
	st.fx.stock = { ...state.fx.stock };
	const pick = (e) => {
		const s = st.fx[e.id];
		s.amount = 0.25 + 0.75 * rand();
		for (const p of e.params) {
			if (p.type === 'range') s[p.k] = +(p.min + (p.max - p.min) * rand()).toFixed(2);
			else if (p.type === 'select') s[p.k] = p.options[Math.floor(rand() * p.options.length)];
			else s[p.k] = 1 + Math.floor(rand() * 999);
		}
	};
	if (rand() < 0.85) pick(FX.tone);
	const others = EFFECTS.filter(e => e.id !== 'stock' && e.id !== 'tone');
	const n = 2 + Math.floor(rand() * 5);
	for (let i = 0; i < n; i++) pick(others[Math.floor(rand() * others.length)]);
	return st;
}
