// The page, composed per pixel. Everything here is a function of the page point p (units, y
// down, the spine on the left): the sheet's outline and holes, its relief, the paper's colour
// with every stain in it, then the ink with every way it has worn, then light.
//
// Stains and ink are mixed subtractively: paper colour × ink transmission. Ink is carried as
// absorbance (1 − transmission per channel) so it can be blurred, smeared, eroded and faded.

import { FX_WGSL } from './effects.js?v=a8136959';

export const GEO = { coffee: 0, grease: 32, folds: 44, crumple: 56, tape: 152, rust: 158, prints: 166, tear: 174, smudge: 270, size: 280 };

const HEAD = /* wgsl */ `
struct Uni {
  view: vec4f,     // page x, y at pixel (0,0); px per unit; units per px
  res: vec4f,      // canvas w, h; age; time
  page: vec4f,     // W, H; print texels per unit; sdf texels per unit
  ink: vec4f,      // ink rgb; ghost texels per unit
  light: vec4f,    // direction to the light xyz; relief strength
  ground: vec4f,   // ground rgb; what shows through holes (0 ground, 1 the next page)
  cap: vec4f,      // drop cap box x, y, size; 1 when it is a rendered initial
  counts0: vec4f,  // coffee, grease, folds, crumple
  counts1: vec4f,  // tape, rust, prints, tear points
  counts2: vec4f,  // smudges, tear kind, field texels per unit, cap texels per unit
  text: vec4f,     // text block x, measure, a full page's first line, 0
  fx: array<vec4f, 64>,
}
@group(0) @binding(0) var<uniform> U: Uni;
@group(0) @binding(1) var<storage, read> geo: array<vec4f>;
@group(0) @binding(2) var sLin: sampler;
@group(0) @binding(3) var printTex: texture_2d<f32>;
@group(0) @binding(4) var capTex: texture_2d<f32>;
@group(0) @binding(5) var ghostTex: texture_2d<f32>;
@group(0) @binding(6) var sdfTex: texture_2d<f32>;
@group(0) @binding(7) var fieldTex: texture_2d<f32>;

${FX_WGSL}
const MM: f32 = 5.65;
const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;
const G_COFFEE: u32 = ${GEO.coffee}u;
const G_GREASE: u32 = ${GEO.grease}u;
const G_FOLDS: u32 = ${GEO.folds}u;
const G_CRUMPLE: u32 = ${GEO.crumple}u;
const G_TAPE: u32 = ${GEO.tape}u;
const G_RUST: u32 = ${GEO.rust}u;
const G_PRINTS: u32 = ${GEO.prints}u;
const G_TEAR: u32 = ${GEO.tear}u;
const G_SMUDGE: u32 = ${GEO.smudge}u;
`;

const LIB = /* wgsl */ `
fn fxA(i: u32) -> vec4f { return U.fx[i * 2u]; }
fn fxB(i: u32) -> vec4f { return U.fx[i * 2u + 1u]; }
fn on(i: u32) -> bool { return U.fx[i * 2u].x > 0.0005; }
fn seedOff(s: f32) -> vec2f { return vec2f(fract(s * 0.6180339) * 731.0 + 17.0, fract(s * 0.4142135) * 593.0 + 41.0); }

fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
fn sat(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
fn rot2(a: f32) -> mat2x2f { let c = cos(a); let s = sin(a); return mat2x2f(c, s, -s, c); }

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.x, p.y, p.x) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
// gradient noise, about −1..1
fn gnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let a = dot(hash22(i) * 2.0 - 1.0, f);
  let b = dot(hash22(i + vec2f(1.0, 0.0)) * 2.0 - 1.0, f - vec2f(1.0, 0.0));
  let c = dot(hash22(i + vec2f(0.0, 1.0)) * 2.0 - 1.0, f - vec2f(0.0, 1.0));
  let d = dot(hash22(i + vec2f(1.0, 1.0)) * 2.0 - 1.0, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.6;
}
// value noise, 0..1
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x), mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
const FBM_R = mat2x2f(0.8, 0.6, -0.6, 0.8);
fn fbm(p: vec2f, oct: i32) -> f32 {
  var s = 0.0;
  var a = 0.5;
  var q = p;
  for (var i = 0; i < oct; i++) {
    s += a * gnoise(q);
    q = FBM_R * q * 2.03 + vec2f(17.1, 9.2);
    a *= 0.5;
  }
  return s;
}
// F1, F2 and the nearest cell's hash
fn worley(p: vec2f) -> vec3f {
  let i = floor(p);
  let f = p - i;
  var f1 = 8.0;
  var f2 = 8.0;
  var id = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let g = vec2f(f32(x), f32(y));
      let o = hash22(i + g);
      let d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; id = hash12(i + g + vec2f(0.37, 0.71)); }
      else if (d < f2) { f2 = d; }
    }
  }
  return vec3f(f1, f2, id);
}
// 1 when a feature of this size (units) spans a few pixels, 0 when it's sub-pixel
fn detail(size: f32) -> f32 { return ss(0.7, 2.2, size / U.view.w); }
// coverage of a hard edge at signed distance d (units, positive outside)
fn edge(d: f32) -> f32 { return sat(0.5 - d / max(U.view.w, 0.08)); }

fn sdBox(p: vec2f, c: vec2f, h: vec2f, r: f32) -> f32 {
  let q = abs(p - c) - h + vec2f(r);
  return length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
}
fn sdSeg(p: vec2f, a: vec2f, b: vec2f) -> f32 {
  let pa = p - a;
  let ba = b - a;
  let h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-6));
  return length(pa - ba * h);
}
// stadium (a pill) along x, half length hl, radius r
fn sdStadium(p: vec2f, hl: f32, r: f32) -> f32 {
  let q = vec2f(max(abs(p.x) - hl, 0.0), p.y);
  return length(q) - r;
}

// page textures
fn lodFor(texelsPerUnit: f32) -> f32 { return max(log2(texelsPerUnit * U.view.w), 0.0); }
fn covAt(q: vec2f, lod: f32) -> f32 { return textureSampleLevel(printTex, sLin, q / U.page.xy, lod).r; }
fn sdfAt(q: vec2f) -> f32 { return textureSampleLevel(sdfTex, sLin, q / U.page.xy, 0.0).r; }
fn ghostAt(q: vec2f, lod: f32) -> vec2f { return textureSampleLevel(ghostTex, sLin, q / U.page.xy, lod).rg; }
fn fieldAt(q: vec2f) -> vec4f { return textureSampleLevel(fieldTex, sLin, q / U.page.xy, 0.0); }
fn inCap(q: vec2f) -> bool {
  return U.cap.w > 0.5 && q.x >= U.cap.x && q.y >= U.cap.y && q.x <= U.cap.x + U.cap.z && q.y <= U.cap.y + U.cap.z;
}
// ink absorbance as printed (before anything happened to it)
fn inkRaw(q: vec2f, lod: f32) -> vec3f {
  if (inCap(q)) {
    let uv = (q - U.cap.xy) / U.cap.z;
    let l = max(log2(U.counts2.w * U.view.w), 0.0) + max(lod - lodFor(U.page.z), 0.0);
    let cap = vec3f(1.0) - textureSampleLevel(capTex, sLin, uv, l).rgb;
    // cap.w 2: text set close round the initial's shape runs into its box, and prints there too
    if (U.cap.w > 1.5) { return max(cap, covAt(q, lod) * (vec3f(1.0) - U.ink.rgb)); }
    return cap;
  }
  return covAt(q, lod) * (vec3f(1.0) - U.ink.rgb);
}
fn inkAbsColor() -> vec3f { return vec3f(1.0) - U.ink.rgb; }
`;

const PAPER = /* wgsl */ `
// ── the sheet's outline ─────────────────────────────────────────────────────────────────────
struct Sheet {
  d: f32,        // signed distance to the sheet's outline (units, positive = no paper)
  rim: f32,      // the fresh white core along a tear
  fray: f32,     // loose fibres beyond the edge (0..1 coverage)
  char_: f32,    // charred band
  scorch: f32,   // brown scorch
  flap: f32,     // 1 on a folded-over corner (the back of the leaf)
  q: vec2f,      // where on the leaf this pixel shows
  shade: f32,    // shadow cast by a flap
  worm: f32,     // 1 inside a worm groove (not through)
  wormRim: f32,  // frass stain around tunnels
  open: f32,     // 1 where a dog-ear left the corner open (shows what's under)
}

fn tearSd(p: vec2f) -> vec2f {
  // returns (signed distance, 1 when near the white-core side)
  let n = u32(U.counts1.w);
  let kind = U.counts2.y;
  if (n < 2u) { return vec2f(1e5, 0.0); }
  var dmin = 1e5;
  var inside = false;
  var side = 0.0;
  var wid = 0.0;
  for (var i = 0u; i + 1u < n; i++) {
    let a = geo[G_TEAR + i];
    let b = geo[G_TEAR + i + 1u];
    let pa = p - a.xy;
    let ba = b.xy - a.xy;
    let h = sat(dot(pa, ba) / max(dot(ba, ba), 1e-6));
    let d = length(pa - ba * h);
    if (d < dmin) { dmin = d; side = ba.x * pa.y - ba.y * pa.x; wid = mix(a.z, b.z, h); }
    // crossing number for the closed kinds
    if (kind < 0.5 || kind > 1.5) {
      if ((a.y > p.y) != (b.y > p.y)) {
        let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
        if (p.x < x) { inside = !inside; }
      }
    }
  }
  if (kind > 0.5 && kind < 1.5) {
    // a split: an open crack, its width tapering to the tip
    return vec2f(wid - dmin, select(0.0, 1.0, side > 0.0));
  }
  // close the polygon (last → first)
  let a = geo[G_TEAR + n - 1u];
  let b = geo[G_TEAR];
  if ((a.y > p.y) != (b.y > p.y)) {
    let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
    if (p.x < x) { inside = !inside; }
  }
  return vec2f(select(-dmin, dmin, inside), 1.0);
}

fn dogearGeom() -> vec4f {
  // the fold line: a point on it and its normal (pointing to the corner)
  let a = fxA(FX_DOGEAR);
  let b = fxB(FX_DOGEAR);
  let W = U.page.x;
  let H = U.page.y;
  let s = a.x * 42.0 * MM;
  let r = hash22(vec2f(a.w, 3.1)) - 0.5;
  let s1 = s * (1.0 + 0.5 * r.x);
  let s2 = s * (1.0 - 0.4 * r.y);
  var p1 = vec2f(W - s1, 0.0);
  var p2 = vec2f(W, s2);
  if (a.y > 0.5) { p1 = vec2f(W - s1, H); p2 = vec2f(W, H - s2); }
  let t = normalize(p2 - p1);
  var n = vec2f(t.y, -t.x);
  let corner = select(vec2f(W, 0.0), vec2f(W, H), a.y > 0.5);
  if (dot(corner - p1, n) < 0.0) { n = -n; }
  return vec4f(p1, n);
}

fn outline(p: vec2f) -> f32 {
  let W = U.page.x;
  let H = U.page.y;
  var r = 0.0;
  var chip = 0.0;
  if (on(FX_EDGES)) {
    let a = fxA(FX_EDGES);
    let so = seedOff(fxB(FX_EDGES).x);
    let e = a.x;
    r = e * a.z * 7.0 * MM;
    let d0 = sdBox(p, vec2f(W, H) * 0.5, vec2f(W, H) * 0.5, r);
    if (d0 > -12.0 * MM) {
      let n1 = fbm(p / (5.0 * MM) + so, 3);
      let n2 = gnoise(p / (1.3 * MM) + so * 1.7);
      let n3 = gnoise(p / (0.4 * MM) + so * 2.3);
      chip = e * a.y * (max(0.0, n1 + 0.1) * 3.2 * MM + max(0.0, n2) * 0.9 * MM) + e * 0.25 * MM * (n3 * 0.5 + 0.5);
    }
  }
  return sdBox(p, vec2f(W, H) * 0.5, vec2f(W, H) * 0.5, r) + chip;
}

fn scorchDist(p: vec2f) -> f32 {
  let W = U.page.x;
  let H = U.page.y;
  let k = fxA(FX_SCORCH).y;
  var d = W - p.x;
  if (k > 0.5 && k < 1.5) { d = H - p.y; }
  else if (k > 1.5 && k < 2.5) { d = p.y; }
  else if (k > 2.5) { d = length((p - vec2f(W, H)) * vec2f(1.0, 0.85)) - 4.0 * MM; }
  let so = seedOff(fxA(FX_SCORCH).z);
  return d + 16.0 * MM * fbm(p / (28.0 * MM) + so, 3) + 4.0 * MM * fbm(p / (6.0 * MM) + so * 1.3, 3) + 1.2 * MM * gnoise(p / (1.4 * MM));
}

fn sheet(p: vec2f) -> Sheet {
  var s: Sheet;
  s.d = outline(p);
  s.rim = 0.0;
  s.fray = 0.0;
  s.char_ = 0.0;
  s.scorch = 0.0;
  s.flap = 0.0;
  s.q = p;
  s.shade = 0.0;
  s.worm = 0.0;
  s.wormRim = 0.0;
  s.open = 0.0;

  // fibres frayed out past a worn edge
  if (on(FX_EDGES) && s.d > -0.5 * MM && s.d < 2.0 * MM) {
    let a = fxA(FX_EDGES);
    let len = (0.25 + 1.4 * a.w) * MM * a.x;
    var f = 0.0;
    for (var i = 0; i < 3; i++) {
      let q = rot2(f32(i) * 1.1 + 0.3) * p;
      let n = abs(gnoise(vec2f(q.x / (0.05 * MM), q.y / (0.9 * MM)) + vec2f(f32(i) * 13.0, 0.0)));
      f = max(f, 1.0 - ss(0.0, 0.22, n));
    }
    s.fray = f * sat(1.0 - s.d / max(len, 0.01)) * step(0.0, s.d) * mix(0.35, 1.0, detail(0.3 * MM));
  }

  // a tear
  if (on(FX_TEAR)) {
    let t = tearSd(p);
    let a = fxA(FX_TEAR);
    let so = seedOff(fxA(FX_TEAR).w);
    if (t.x > -4.0 * MM) {
      // the white core shows on one side of a split, all along a missing piece
      let w = (0.35 + 1.3 * vnoise(p / (3.0 * MM) + so)) * MM * a.z;
      s.rim = max(s.rim, (1.0 - ss(w * 0.85, w, -t.x)) * step(t.x, 0.0) * t.y);
      // fibres pulled out across the gap
      let n = abs(gnoise(rot2(0.6) * p * vec2f(1.0 / (0.05 * MM), 1.0 / (0.7 * MM))));
      s.fray = max(s.fray, (1.0 - ss(0.0, 0.25, n)) * sat(1.0 - t.x / (0.9 * MM)) * step(0.0, t.x) * mix(0.3, 1.0, detail(0.25 * MM)));
    }
    s.d = max(s.d, t.x);
  }

  // burnt away
  if (on(FX_SCORCH)) {
    let e = fxA(FX_SCORCH).x;
    let x = scorchDist(p) - e * 48.0 * MM;
    s.d = max(s.d, -x);
    s.char_ = 1.0 - ss(0.8 * MM, 2.8 * MM, x + 0.8 * MM * gnoise(p / (0.6 * MM)));
    s.scorch = exp(-max(x, 0.0) / (7.0 * MM)) * ss(-0.5, 0.5, e * 40.0);
  }

  // worm tunnels: holes right through, or grooves that only grazed this leaf
  if (on(FX_WORMS)) {
    let e = fxA(FX_WORMS).x;
    let so = seedOff(fxA(FX_WORMS).w);
    let j = vec2f(gnoise(p / (0.9 * MM) + so), gnoise(p / (0.9 * MM) + so + 5.0)) * 0.35 * MM
          + vec2f(gnoise(p / (0.35 * MM) + so), gnoise(p / (0.35 * MM) + so + 2.0)) * 0.22 * MM;
    let f = fieldAt(p + j).b;
    let t = e * 1.02 - f;
    if (f < 0.995) {
      let through = ss(-0.15, 0.1, gnoise(p / (9.0 * MM) + so * 0.7) + 0.25);
      let cut = ss(-0.004, 0.004, t);
      s.d = max(s.d, mix(s.d, 0.5 * MM, cut * through));
      s.worm = cut * (1.0 - through);
    }
    // frass stain around the tunnel
    let ring = fieldAt(p + j * 2.0 + vec2f(0.35 * MM, 0.0)).b;
    s.wormRim = sat((e * 1.02 - ring) * 30.0) * (1.0 - s.worm);
  }

  // rust's holes: staple legs, a pin's two pricks
  if (on(FX_RUST)) {
    let n = u32(U.counts1.y);
    for (var i = 0u; i < n; i++) {
      let g = geo[G_RUST + i * 2u + 1u];
      if (g.w > 0.5) {
        let a = geo[G_RUST + i * 2u];
        s.d = max(s.d, -(min(length(p - a.xy), length(p - a.zw)) - 0.32 * MM));
      }
    }
  }

  // a dog-ear: the corner folded over onto the page
  if (on(FX_DOGEAR) && fxA(FX_DOGEAR).z < 0.5) {
    let g = dogearGeom();
    let n = g.zw;
    let dl = dot(p - g.xy, n);
    if (dl > 0.0) {
      s.open = edge(-dl);
      s.shade = 0.3 * exp(-dl / (2.5 * MM));
    } else {
      let r = p - 2.0 * dl * n;     // the point of the leaf that now lies here
      let dr = outline(r);
      if (dr < 0.0) {
        s.flap = edge(dr);
        s.q = r;
      } else {
        // is the flap between this point and the light?
        let pl = p + normalize(U.light.xy) * 1.4 * MM;
        let dl2 = dot(pl - g.xy, n);
        let r2 = pl - 2.0 * dl2 * n;
        let dr2 = outline(r2);
        s.shade = select(0.0, 0.32 * edge(dr2) * (1.0 - edge(-dr * 0.4)), dl2 < 0.0) + exp(-dr / (0.5 * MM)) * 0.12;
      }
    }
  }
  return s;
}

// ── relief ──────────────────────────────────────────────────────────────────────────────────
fn crease(d: f32, w: f32, D: f32) -> f32 {
  let x = sqrt(d * d + w * w);
  return D * tanh(x / D);
}
fn height(p: vec2f) -> f32 {
  var h = 0.0;
  if (on(FX_FOLDS)) {
    let n = u32(U.counts0.z);
    for (var i = 0u; i < n; i++) {
      let o = geo[G_FOLDS + i * 2u];
      let k = geo[G_FOLDS + i * 2u + 1u];
      let d = dot(p - o.xy, o.zw);
      h += k.x * k.y * fxA(FX_FOLDS).x * 1.6 * crease(d, 0.22 * MM, 120.0 * MM);
    }
  }
  if (on(FX_CRUMPLE)) {
    let a = fxA(FX_CRUMPLE);
    let n = u32(U.counts0.w);
    for (var i = 0u; i < n; i++) {
      let s = geo[G_CRUMPLE + i * 2u];
      let k = geo[G_CRUMPLE + i * 2u + 1u];
      let ba = s.zw - s.xy;
      let L = length(ba);
      let t = dot(p - s.xy, ba) / (L * L);
      let d = (ba.x * (p.y - s.y) - ba.y * (p.x - s.x)) / L;
      let win = ss(-0.05, 0.12, t) * ss(1.05, 0.7, t);
      h += k.x * k.y * a.x * crease(d, 0.15 * MM, k.z) * win;
    }
    let so = seedOff(fxA(FX_CRUMPLE).w);
    let f = a.z * a.x;
    if (f > 0.0) {
      let r = 1.0 - abs(gnoise(p / (7.0 * MM) + so));
      let r2 = 1.0 - abs(gnoise(rot2(1.1) * p / (3.0 * MM) + so));
      h += f * (r * r * r * 0.16 + r2 * r2 * r2 * 0.06) * MM;
    }
  }
  if (on(FX_COCKLE)) {
    let a = fxA(FX_COCKLE);
    let so = seedOff(a.w);
    let lam = (8.0 + 20.0 * a.y) * MM;
    var wet = 1.0;
    if (on(FX_WATER)) { wet = 0.25 + 0.75 * ss(0.0, 0.3, fxA(FX_WATER).x); }
    // unevenness: the waves bend and change size across the sheet and die away in places, instead
    // of running in even rows along the grain
    var q = vec2f(p.x / lam, p.y / (lam * 2.6));
    var amp = 1.0;
    if (a.z > 0.0) {
      let big = p / (lam * 4.5);
      q += a.z * 1.4 * vec2f(fbm(big + so + vec2f(17.0, 3.0), 2), fbm(big + so + vec2f(5.0, 29.0), 2));
      q *= 1.0 + a.z * 0.5 * fbm(p / (lam * 9.0) + so + vec2f(23.0, 61.0), 2);
      amp = mix(1.0, ss(-0.25, 0.3, fbm(p / (lam * 6.0) + so + vec2f(41.0, 11.0), 2)), a.z);
    }
    h += a.x * wet * 0.5 * MM * amp * fbm(q + so, 3);
  }
  if (on(FX_DOGEAR) && fxA(FX_DOGEAR).z > 0.5) {
    let g = dogearGeom();
    let dl = dot(p - g.xy, g.zw);
    h += fxA(FX_DOGEAR).x * 0.05 * crease(max(dl, 0.0), 0.15 * MM, 200.0 * MM);
  }
  return h;
}

// ── colour ──────────────────────────────────────────────────────────────────────────────────
fn ramp6(t: f32, c0: vec3f, c1: vec3f, c2: vec3f, c3: vec3f, c4: vec3f, c5: vec3f) -> vec3f {
  let x = clamp(t, 0.0, 1.35) / 0.27;
  var c = mix(c0, c1, sat(x));
  c = mix(c, c2, sat(x - 1.0));
  c = mix(c, c3, sat(x - 2.0));
  c = mix(c, c4, sat(x - 3.0));
  return mix(c, c5, sat(x - 4.0));
}
fn toneColor(t: f32, warm: f32) -> vec3f {
  let w = vec3f(1.0);
  let buff = ramp6(t, w, vec3f(0.962, 0.952, 0.925), vec3f(0.918, 0.896, 0.843), vec3f(0.852, 0.818, 0.744), vec3f(0.765, 0.72, 0.63), vec3f(0.64, 0.59, 0.49));
  let straw = ramp6(t, w, vec3f(0.972, 0.944, 0.872), vec3f(0.935, 0.872, 0.737), vec3f(0.872, 0.774, 0.596), vec3f(0.78, 0.645, 0.447), vec3f(0.63, 0.48, 0.31));
  let brown = ramp6(t, w, vec3f(0.975, 0.93, 0.82), vec3f(0.94, 0.835, 0.64), vec3f(0.87, 0.71, 0.49), vec3f(0.77, 0.58, 0.36), vec3f(0.6, 0.42, 0.25));
  return select(mix(straw, brown, warm * 2.0 - 1.0), mix(buff, straw, warm * 2.0), warm < 0.5);
}

// where the page browned at the edges of the closed book (the spine edge is sheltered)
fn edgeDist(p: vec2f) -> f32 {
  return min(min(U.page.x - p.x, p.y), min(U.page.y - p.y, p.x * 3.0 + 6.0 * MM));
}

// what lay on the page: x = sheltered (a bookmark), y = acid stain, z = its outline, w = transferred print
fn leafShape(l: vec2f, L: f32) -> vec2f {
  let u = l.x / L;
  let w = L * 0.31 * pow(max(sin(PI * sat(u)), 0.0), 0.62) * (1.0 - 0.32 * sat(u));
  let teeth = 0.7 * MM * abs(fract(u * 30.0) - 0.5);
  var d = max(abs(l.y) - w + teeth, max(-l.x, l.x - L));
  let stem = max(abs(l.y + 0.03 * l.x * l.x / L) - 0.45 * MM, max(l.x, -l.x - L * 0.2));
  d = min(d, stem);
  let side = abs(fract((l.x - abs(l.y) * 0.85) / (L * 0.1)) - 0.5) * L * 0.1;
  return vec2f(d, min(abs(l.y), side));
}
fn fernShape(l: vec2f, L: f32) -> vec2f {
  var d = max(abs(l.y + 0.05 * l.x * l.x / L) - 0.5 * MM, max(-l.x + L * 0.05, l.x - L));
  var vein = abs(l.y);
  for (var k = 0; k < 22; k++) {
    let fk = f32(k);
    let x = L * (0.1 + 0.86 * fk / 22.0);
    let sgn = select(-1.0, 1.0, (k & 1) == 0);
    let len = L * 0.2 * (1.0 - 0.85 * fk / 22.0) + 1.5 * MM;
    let ang = sgn * (0.9 + 0.2 * fk / 22.0);
    let base = vec2f(x, -0.05 * x * x / L);
    let q = rot2(-ang) * (l - base);
    let e = vec2f(len * 0.5, len * 0.16 + 0.6 * MM);
    let c = q - vec2f(len * 0.5, 0.0);
    let de = (length(c / e) - 1.0) * min(e.x, e.y);
    d = min(d, de);
    vein = min(vein, abs(c.y) + max(abs(c.x) - e.x, 0.0));
  }
  return vec2f(d, vein);
}
fn ghostShape(p: vec2f) -> vec4f {
  let a = fxA(FX_GHOST);
  let kind = a.y;
  let size = a.z;
  let sd = fxA(FX_GHOST).w;
  let r = hash22(vec2f(sd, 1.7));
  let r2 = hash22(vec2f(sd, 8.3));
  let W = U.page.x;
  let H = U.page.y;
  var o = vec4f(0.0);
  if (kind < 0.5) {
    // a bookmark slip from the top edge down into the text
    let w = (14.0 + 26.0 * size) * MM;
    let len = H * (0.45 + 0.4 * r.y);
    let c = vec2f(W * (0.2 + 0.55 * r.x), len * 0.5 - 20.0 * MM);
    let q = rot2((r2.x - 0.5) * 0.08) * (p - c);
    let d = sdBox(q, vec2f(0.0), vec2f(w * 0.5, len * 0.5 + 20.0 * MM), 0.0) + 0.3 * MM * gnoise(p / (2.0 * MM));
    o.x = 1.0 - ss(-0.4 * MM, 0.4 * MM, d);
    o.z = exp(-abs(d) / (0.6 * MM)) * 0.6;
  } else if (kind < 1.5) {
    // a newspaper clipping: an acid oblong carrying its print across, mirrored
    let w = (40.0 + 45.0 * size) * MM;
    let h = w * (1.15 + 0.4 * r2.y);
    let c = vec2f(W * (0.3 + 0.4 * r.x), H * (0.3 + 0.4 * r.y));
    let q = rot2((r2.x - 0.5) * 0.12) * (p - c);
    let d = sdBox(q, vec2f(0.0), vec2f(w, h) * 0.5, 0.0) + 0.25 * MM * gnoise(p / (1.5 * MM));
    let inside = 1.0 - ss(-0.3 * MM, 0.3 * MM, d);
    o.y = inside * (0.55 + 0.45 * ss(-0.4, 0.6, fbm(q / (14.0 * MM) + 3.0, 3)));
    o.z = exp(-abs(d) / (0.9 * MM)) * 0.9 + inside * exp(d / (3.0 * MM)) * 0.4;
    // two columns of small type, borrowed from the leaf's back
    let u = (q + vec2f(w, h) * 0.5) / vec2f(w, h);
    let col = select(0.0, 1.0, u.x > 0.5);
    let ux = fract(u.x * 2.0);
    let gutter = ss(0.0, 0.04, ux) * ss(1.0, 0.96, ux) * ss(0.0, 0.03, u.y) * ss(1.0, 0.97, u.y);
    let tq = vec2f(U.text.x + ux * U.text.y, U.text.z + 20.0 + (u.y * h / 1.7) + col * 380.0);
    o.w = inside * gutter * ghostAt(tq, lodFor(U.ink.w) + 0.6).r;
  } else {
    // a pressed leaf or a fern frond
    let L = select((40.0 + 60.0 * size) * MM, (60.0 + 90.0 * size) * MM, kind > 2.5);
    let c = vec2f(W * (0.18 + 0.4 * r.x), H * (0.2 + 0.5 * r.y));
    let q = rot2(-(0.4 + 1.2 * r2.x)) * (p - c);
    var sh = leafShape(q, L);
    if (kind > 2.5) { sh = fernShape(q, L); }
    let d = sh.x + 0.25 * MM * gnoise(p / (1.2 * MM));
    let inside = 1.0 - ss(-0.25 * MM, 0.25 * MM, d);
    o.y = inside * (0.45 + 0.35 * ss(-0.5, 0.7, fbm(q / (9.0 * MM) + 7.0, 3))) * (1.0 + 0.6 * exp(-sh.y / (0.4 * MM)));
    o.z = inside * exp(d / (0.9 * MM)) * 0.8;
  }
  return o;
}

fn fingerprint(p: vec2f, g0: vec4f, g1: vec4f) -> f32 {
  var q = rot2(-g1.x) * (p - g0.xy);
  let e = length(q / g0.zw);
  if (e > 1.15) { return 0.0; }
  let w = vec2f(gnoise(q / (2.5 * MM) + g0.xy), gnoise(q / (2.5 * MM) + g0.yx)) * 0.6 * MM;
  q += w;
  var phase = 0.0;
  let kind = g1.y;
  if (kind < 0.34) { phase = length(q * vec2f(1.0, 0.82)); }                                        // whorl
  else if (kind < 0.67) { phase = length(q - vec2f(0.0, g0.w * 0.25)) + 0.35 * q.y; }               // loop
  else { phase = q.y - 2.2 * MM * exp(-q.x * q.x / (40.0 * MM * MM)); }                              // arch
  let ridge = 0.5 + 0.5 * cos(phase / (0.47 * MM) * TAU);
  let k = detail(0.47 * MM);
  let r = mix(0.5, ss(0.35, 0.85, ridge), k);
  let press = (1.0 - ss(0.55, 1.05, e)) * g1.z * (0.55 + 0.45 * ss(-0.4, 0.5, gnoise(q / (4.0 * MM) + g0.yx)));
  return r * press;
}

fn speck(p: vec2f, cell: f32, prob: f32, rmin: f32, rmax: f32, so: vec2f) -> f32 {
  let c = floor(p / cell);
  var best = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let id = c + vec2f(f32(x), f32(y));
      let h = hash12(id + so);
      if (h < prob) {
        let o = (id + hash22(id + so * 1.3)) * cell;
        let r = mix(rmin, rmax, hash12(id + so * 2.1));
        let q = p - o;
        let d = length(q * vec2f(1.0, 1.0 + 0.6 * hash12(id + 3.3))) - r;
        best = max(best, sat(0.5 - d / max(U.view.w, 0.05)) * min(1.0, r * 2.0 / max(U.view.w, 0.05) + 0.25));
      }
    }
  }
  return best;
}

// Foxing, analytic so it holds up at any zoom: three layers of spots on hashed grids (specks,
// spots, rare blots). Each spot is born at a time, grows to its size, and has an irregular edge;
// some get a dark core (bullseyes), some stay diffuse and lacy (snowflakes). Clusters come from a
// slow density field, plus a lean toward the edges.
fn foxDensity(q: vec2f, so: vec2f, cluster: f32) -> f32 {
  let n = ss(0.05, 0.55, fbm(q / (38.0 * MM) + so, 3));
  let de = edgeDist(q) / (U.page.x * 0.5);
  return mix(1.0, n * 3.2, cluster) * (1.0 + 0.9 * (1.0 - sat(de * 1.5)));
}
fn foxLayer(q: vec2f, cell: f32, prob: f32, rmin: f32, rmax: f32, so: vec2f, T: f32, coreK: f32, cluster: f32) -> vec2f {
  let c = floor(q / cell);
  var body = 0.0;
  var core = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let id = c + vec2f(f32(x), f32(y));
      let pos = (id + 0.15 + 0.7 * hash22(id + so * 1.31)) * cell;
      let h = hash12(id + so);
      if (h > prob * foxDensity(pos, so, cluster)) { continue; }
      let birth = pow(hash12(id + so * 2.13), 0.8) * 0.85;
      let grow = sat((T - birth) / 0.3);
      if (grow <= 0.0) { continue; }
      let r = mix(rmin, rmax, pow(hash12(id + so * 3.71), 2.5)) * pow(grow, 0.5);
      let v = q - pos;
      let kind = hash12(id + so * 5.3);              // < 0.35 snowflake, else bullseye-ish
      let wob = r * (0.22 + 0.35 * step(kind, 0.35)) * gnoise(v / max(r * 0.55, 0.05) + id * 1.7);
      let d = length(v) + wob;
      if (d > r * 1.3) { continue; }
      let s = sat(1.0 - d / r);
      var b = ss(0.0, 0.55, s) * mix(0.5, 1.0, grow);
      if (kind < 0.35) {
        b *= mix(1.0, ss(-0.25, 0.3, gnoise(v / max(r * 0.18, 0.04) + id) + s * 0.5), detail(r * 0.2));
      } else {
        let cr = ss(0.62, 0.9, s) * coreK * step(0.5, hash12(id + 9.1)) * grow;
        core = max(core, cr);
        // a faint ring where the spot stopped spreading
        b = max(b, exp(-abs(s - 0.08) / 0.06) * 0.35 * step(0.75, kind) * grow);
      }
      body = max(body, b);
    }
  }
  return vec2f(body, core);
}
fn foxing(q: vec2f) -> vec2f {
  let a = fxA(FX_FOXING);
  let b = fxB(FX_FOXING);
  let so = seedOff(b.z);
  let T = a.x * 1.05;
  let n = a.y;
  let sz = a.z;
  let cl = b.x;
  var o = foxLayer(q, 1.7 * MM, 0.06 + 0.5 * n, 0.09 * MM, (0.3 + 0.6 * sz) * MM, so, T, a.w, cl) * vec2f(0.75, 0.9);
  o = max(o, foxLayer(q, 6.0 * MM, 0.05 + 0.6 * n, (0.35 + 0.4 * sz) * MM, (0.8 + 2.2 * sz) * MM, so + 3.3, T, a.w, cl) * vec2f(0.68, 0.85));
  o = max(o, foxLayer(q, 26.0 * MM, 0.02 + 0.2 * n * sz, (1.5 + 2.0 * sz) * MM, (2.5 + 6.0 * sz) * MM, so + 7.7, T, a.w * 0.6, cl) * vec2f(0.55, 0.6));
  return o;
}

// The paper's colour at q (no ink): returns rgb, and in w how much it lets the back show through
struct PaperOut { c: vec3f, show: f32, wet: f32, sun: f32 }
fn paperColor(q: vec2f, p: vec2f, back: bool) -> PaperOut {
  var o: PaperOut;
  o.show = 1.0;
  o.wet = 0.0;
  o.sun = 0.0;
  let W = U.page.x;
  let H = U.page.y;

  // stock: a white, the cloud of fibres, laid and chain lines
  let st = fxA(FX_STOCK);
  var c = mix(vec3f(1.0), select(vec3f(0.975, 0.985, 1.0), vec3f(1.0, 0.985, 0.955), st.w > 0.0), abs(st.w));
  let form = fbm(q / (3.2 * MM), 3) * 0.65 + gnoise(q / (0.9 * MM)) * 0.35 * detail(0.5 * MM);
  c *= 1.0 + st.y * 0.035 * form;
  if (st.z > 0.0) {
    let k = detail(0.9 * MM);
    let laid = (0.5 + 0.5 * sin((q.y + 0.25 * MM * gnoise(q / (6.0 * MM))) / (0.95 * MM) * TAU)) * k + 0.5 * (1.0 - k);
    let cx = abs(fract((q.x + 3.0 * MM) / (25.0 * MM)) - 0.5) * 25.0 * MM;
    let chain = exp(-cx * cx / (0.5 * MM * MM)) + 0.35 * exp(-cx * cx / (9.0 * MM * MM));
    c *= 1.0 - st.z * (0.022 * laid + 0.03 * chain);
  }

  // what lay on it
  var ghost = vec4f(0.0);
  if (on(FX_GHOST)) { ghost = ghostShape(q); }

  // yellowing
  var t = 0.0;
  var warm = 0.5;
  if (on(FX_TONE)) {
    let a = fxA(FX_TONE);
    let b = fxB(FX_TONE);
    let so = seedOff(b.y);
    warm = a.y;
    let e = a.x;
    let de = edgeDist(q);
    let bw = (2.0 + b.x * 16.0) * MM * (1.0 + 0.45 * fbm(q / (22.0 * MM) + so, 3));
    let edgeT = a.w * (exp(-de / bw) * 0.75 + exp(-de / (1.2 * MM)) * 0.35);
    let mott = a.z * (fbm(q / (28.0 * MM) + so, 4) * 0.8 + fbm(q / (5.0 * MM) + so * 1.7, 3) * 0.35);
    t = e * (0.72 + mott) + e * edgeT * 0.8;
    if (back) { t *= 1.05; }
  }
  if (on(FX_GHOST) && fxA(FX_GHOST).y < 0.5) {
    let eg = fxA(FX_GHOST).x;
    t = t * (1.0 - 0.8 * ghost.x * eg) + eg * 0.38 * (1.0 - ghost.x) + ghost.z * eg * 0.3;
    o.sun = (1.0 - ghost.x) * eg;
  }
  if (t > 0.0) {
    c *= toneColor(t, warm);
  }

  // an acid shadow: clipping or leaf
  if (on(FX_GHOST) && fxA(FX_GHOST).y > 0.5) {
    let e = fxA(FX_GHOST).x;
    let leafy = fxA(FX_GHOST).y > 1.5;
    let body = select(vec3f(0.84, 0.7, 0.5), vec3f(0.76, 0.6, 0.38), leafy);
    let rim = select(vec3f(0.7, 0.55, 0.36), vec3f(0.56, 0.38, 0.2), leafy);
    c *= mix(vec3f(1.0), body, sat(ghost.y * e * 0.95));
    c *= mix(vec3f(1.0), rim, sat(ghost.z * e * 0.75));
    c *= mix(vec3f(1.0), vec3f(0.62, 0.5, 0.36), ghost.w * e * 0.55);
  }

  // offset: the facing page, mirrored, brown
  if (on(FX_OFFSET) && !back) {
    let a = fxA(FX_OFFSET);
    let g = ghostAt(q, lodFor(U.ink.w) + a.y * 2.5).g;
    let patchy = 0.6 + 0.4 * ss(-0.5, 0.6, fbm(q / (40.0 * MM) + 5.0, 3));
    c *= mix(vec3f(1.0), mix(vec3f(0.55, 0.55, 0.56), vec3f(0.72, 0.6, 0.42), a.z), sat(g * a.x * 0.42 * patchy));
  }

  // foxing
  if (on(FX_FOXING)) {
    let f = foxing(q);
    let b = fxB(FX_FOXING);
    let hue = b.y;
    let halo = mix(vec3f(0.86, 0.74, 0.58), vec3f(0.9, 0.68, 0.45), hue);
    let dark = mix(vec3f(0.5, 0.38, 0.27), vec3f(0.55, 0.3, 0.15), hue);
    c *= mix(vec3f(1.0), halo, sat(f.x));
    c *= mix(vec3f(1.0), dark, sat(f.y));
  }

  // water: tide lines where each wetting stopped
  if (on(FX_WATER)) {
    let a = fxA(FX_WATER);
    let b = fxB(FX_WATER);
    let so = seedOff(b.y);
    let src = a.y;
    var d0 = H - q.y;
    var reach = a.x * H * 0.72;
    if (src > 0.5 && src < 1.5) { d0 = length((q - vec2f(W, H)) * vec2f(1.0, 0.9)); reach = a.x * H * 0.8; }
    else if (src > 1.5 && src < 2.5) { d0 = q.y; }
    else if (src > 2.5 && src < 3.5) { d0 = W - q.x; reach = a.x * W * 0.85; }
    else if (src > 3.5) {
      let c0 = vec2f(W * (0.3 + 0.4 * hash12(so)), H * (0.25 + 0.5 * hash12(so + 1.0)));
      let v = q - c0;
      d0 = length(v) * (1.0 + 0.25 * sin(atan2(v.y, v.x) * 3.0 + so.x));
      reach = a.x * 70.0 * MM;
    }
    let d = d0 + 0.09 * reach * fbm(q / (32.0 * MM) + so, 4) + 2.2 * MM * fbm(q / (6.0 * MM) + so * 1.3, 3) + 0.5 * MM * gnoise(q / (1.1 * MM) + so);
    let x = reach - d;
    let dark = 0.35 + 0.65 * a.w;
    if (x > -2.0 * MM) {
      o.wet = ss(-0.3 * MM, 1.5 * MM, x);
      // the latest front: a sharp dark line, fading inward
      let front = edge(-x) * exp(-max(x, 0.0) / (0.55 * MM));
      var tide = front;
      // older fronts inside it
      let n = i32(round(a.z * 3.0));
      for (var k = 0; k < n; k++) {
        let fk = 0.5 + 0.15 * f32(k) + 0.08 * hash12(so + f32(k));
        let dk = d0 * 1.0 + 0.09 * reach * fbm(q / (32.0 * MM) + so + f32(k + 1) * 3.7, 4) + 2.0 * MM * fbm(q / (6.0 * MM) + so * 1.3 + f32(k) * 1.9, 3);
        let xk = reach * fk - dk;
        tide = max(tide, edge(-xk) * exp(-max(xk, 0.0) / (0.45 * MM)) * (0.55 + 0.1 * f32(k)) * o.wet);
      }
      let wash = o.wet * (0.35 + 0.25 * fbm(q / (12.0 * MM) + so, 3));
      c *= mix(vec3f(1.0), vec3f(0.95, 0.9, 0.8), wash * dark);
      c *= mix(vec3f(1.0), vec3f(0.6, 0.43, 0.26), tide * dark * 0.8);
    }
  }

  // coffee rings and splashes
  if (on(FX_COFFEE)) {
    let e = fxA(FX_COFFEE).x;
    let n = u32(U.counts0.x);
    var st2 = 0.0;
    for (var i = 0u; i < n; i++) {
      let g0 = geo[G_COFFEE + i * 2u];
      let g1 = geo[G_COFFEE + i * 2u + 1u];
      let v = q - g0.xy;
      let ang = atan2(v.y, v.x);
      let r = length(v) + 0.5 * MM * gnoise(vec2f(ang * 3.0, g0.x)) + 0.18 * MM * gnoise(v / (1.2 * MM));
      let x = g0.z - r;
      if (x > -1.0 * MM && x < g0.z) {
        var arc = 1.0;
        if (g1.y < 0.99) {
          let fa = fract((ang - g1.x) / TAU);
          arc = ss(0.0, 0.06, fa) * ss(g1.y, g1.y - 0.1, fa) + 0.12;
        }
        let rim = edge(-x) * (exp(-max(x, 0.0) / g0.w) * 0.8 + 0.1);
        let fill = select(0.0, 0.35 * edge(-x), g1.w > 0.5);
        st2 = max(st2, (rim + fill) * arc * g1.z);
      }
    }
    c *= mix(vec3f(1.0), vec3f(0.55, 0.37, 0.22), sat(st2 * e * 0.62));
  }

  // grease: the paper goes glassy
  if (on(FX_GREASE)) {
    let e = fxA(FX_GREASE).x;
    let n = u32(U.counts0.y);
    var g = 0.0;
    for (var i = 0u; i < n; i++) {
      let g0 = geo[G_GREASE + i * 2u];
      let r = length(q - g0.xy) + g0.z * 0.22 * fbm((q - g0.xy) / (g0.z * 0.6) + g0.xy, 3);
      g = max(g, ss(g0.z, g0.z * 0.75, r) * g0.w);
    }
    g *= e;
    c *= mix(vec3f(1.0), vec3f(0.8, 0.77, 0.66), g * 0.7);
    o.show += g * 4.0;
  }

  // mould
  if (on(FX_MOULD)) {
    let a = fxA(FX_MOULD);
    let so = seedOff(fxB(FX_MOULD).x);
    let j = vec2f(fbm(q / (4.0 * MM) + so, 3), fbm(q / (4.0 * MM) + so + 4.0, 3)) * 3.2 * MM;
    let f = fieldAt(q + j).g;
    let d = a.x * 1.02 - f;
    if (d > -0.08) {
      var col = vec3f(0.42, 0.47, 0.37);
      var dot_ = vec3f(0.2, 0.23, 0.17);
      var halo = vec3f(0.9, 0.88, 0.74);
      if (a.y > 0.5 && a.y < 1.5) { col = vec3f(0.24, 0.23, 0.21); dot_ = vec3f(0.08, 0.08, 0.07); halo = vec3f(0.88, 0.85, 0.78); }
      else if (a.y > 1.5) { col = vec3f(0.7, 0.45, 0.52); dot_ = vec3f(0.42, 0.2, 0.3); halo = vec3f(0.94, 0.84, 0.82); }
      let dens = ss(0.0, 0.22, d);
      let fuzz = ss(-0.2, 0.5, gnoise(rot2(atan2(j.y, j.x)) * q / vec2f(0.08 * MM, 0.6 * MM) + so) + dens * 1.4);
      let k = detail(0.15 * MM);
      let spores = mix(dens * 0.3, step(1.0 - dens * 0.6, vnoise(q / (0.13 * MM) + so)), k);
      c *= mix(vec3f(1.0), halo, ss(-0.08, 0.0, d) * 0.6);
      c *= mix(vec3f(1.0), col, dens * fuzz * 0.32);
      let sp3 = speck(q + j * 0.3, 0.9 * MM, dens * 0.5, 0.1 * MM, 0.36 * MM, so + 2.0);
      c *= mix(vec3f(1.0), mix(col, dot_, 0.6), sp3 * 0.7);
      let sp2 = mix(dens * 0.2, step(1.0 - dens * 0.4, vnoise(q / (0.07 * MM) + so * 1.3)), detail(0.08 * MM));
      c *= mix(vec3f(1.0), dot_, sat(spores * dens * 0.55 + sp2 * 0.4));
    }
  }

  // rust from metal that touched it
  if (on(FX_RUST)) {
    let e = fxA(FX_RUST).x;
    let so = seedOff(fxA(FX_RUST).z);
    let n = u32(U.counts1.y);
    var dw = 1e5;
    for (var i = 0u; i < n; i++) {
      let a = geo[G_RUST + i * 2u];
      let g = geo[G_RUST + i * 2u + 1u];
      if (g.w < 0.5) {
        // a paper clip: two nested loops of wire
        let l = rot2(-g.x) * (q - a.xy);
        let outer = abs(sdStadium(l, a.z * 0.5 - a.w * 0.5, a.w * 0.5));
        let inner = abs(sdStadium(l - vec2f(a.z * 0.12, 0.0), a.z * 0.36 - a.w * 0.3, a.w * 0.3));
        dw = min(dw, min(outer, inner));
      } else {
        dw = min(dw, sdSeg(q, a.xy, a.zw));
      }
    }
    let mott = ss(-0.35, 0.45, fbm(q / (2.2 * MM) + so, 3));
    let blot = ss(0.0, 0.6, fbm(q / (6.0 * MM) + so * 1.7, 2) + 0.25);
    let core = exp(-dw / (0.45 * MM)) * mott * blot;
    let halo = exp(-dw / ((1.0 + 2.2 * vnoise(q / (5.0 * MM) + so)) * MM)) * (0.4 + 0.6 * mott) * blot;
    c *= mix(vec3f(1.0), vec3f(0.82, 0.55, 0.3), sat(halo * e * 0.8));
    c *= mix(vec3f(1.0), vec3f(0.5, 0.25, 0.1), sat(core * e * 0.9));
  }

  // handling: grime and fingerprints at the corner you lift
  if (on(FX_THUMB)) {
    let a = fxA(FX_THUMB);
    let so = seedOff(a.w);
    let e = a.x;
    var g = 0.0;
    let lower = exp(-length((q - vec2f(W, H)) * vec2f(1.0, 0.75)) / (24.0 * MM));
    let upper = exp(-length((q - vec2f(W, 0.0)) * vec2f(1.0, 0.75)) / (24.0 * MM));
    if (a.y < 0.5) { g = lower; } else if (a.y < 1.5) { g = upper; } else { g = max(lower, upper); }
    g *= 0.55 + 0.45 * ss(-0.5, 0.6, fbm(q / (9.0 * MM) + so, 3));
    c *= mix(vec3f(1.0), vec3f(0.8, 0.76, 0.69), sat(g * e * 0.7));
    let n = u32(U.counts1.z);
    var fp = 0.0;
    for (var i = 0u; i < n; i++) {
      fp = max(fp, fingerprint(q, geo[G_PRINTS + i * 2u], geo[G_PRINTS + i * 2u + 1u]));
    }
    c *= mix(vec3f(1.0), vec3f(0.62, 0.58, 0.52), sat(fp * e * a.z * 0.5));
  }

  // dust: the top edge of the book block, specks
  if (on(FX_DUST)) {
    let a = fxA(FX_DUST);
    let so = seedOff(a.w);
    let e = a.x;
    let dt = q.y + 1.5 * MM * fbm(q / (8.0 * MM) + so, 2);
    let top = (exp(-max(dt, 0.0) / ((0.8 + 2.0 * a.y) * MM)) * 0.8 + exp(-max(dt, 0.0) / (14.0 * MM)) * 0.25) * a.y;
    let side = exp(-(W - q.x) / (1.5 * MM)) * 0.3 * a.y;
    c *= mix(vec3f(1.0), vec3f(0.7, 0.68, 0.64), sat((top + side) * e));
    let sp = speck(q, 2.2 * MM, a.z * e * 0.35, 0.04 * MM, 0.16 * MM, so);
    let fly = speck(q, 9.0 * MM, a.z * e * 0.12, 0.15 * MM, 0.32 * MM, so + 3.0);
    c *= 1.0 - sp * 0.6;
    c *= mix(vec3f(1.0), vec3f(0.3, 0.22, 0.16), fly * 0.9);
  }

  // the creases of a fold get rubbed and grimy
  if (on(FX_FOLDS)) {
    let a = fxA(FX_FOLDS);
    let n = u32(U.counts0.z);
    var g = 0.0;
    for (var i = 0u; i < n; i++) {
      let o2 = geo[G_FOLDS + i * 2u];
      let d = abs(dot(q - o2.xy, o2.zw) + 0.12 * MM * gnoise(q / (1.5 * MM) + o2.xy));
      let wob = 0.6 + 0.4 * ss(-0.4, 0.5, gnoise(q / (4.0 * MM) + o2.yx));
      g = max(g, (exp(-d / (0.3 * MM)) * wob + 0.35 * exp(-d / (2.5 * MM))));
    }
    c *= mix(vec3f(1.0), vec3f(0.7, 0.65, 0.57), sat(g * a.x * (0.25 + a.z) * 0.55));
  }

  // a dog-ear's corner browns where it stuck out of the book
  if (on(FX_DOGEAR) && fxA(FX_DOGEAR).z > 0.5) {
    let g = dogearGeom();
    let dl = dot(q - g.xy, g.zw);
    let a = fxA(FX_DOGEAR);
    c *= mix(vec3f(1.0), vec3f(0.92, 0.88, 0.8), ss(0.0, 2.0 * MM, dl) * 0.6);
    c *= mix(vec3f(1.0), vec3f(0.8, 0.77, 0.72), exp(-abs(dl) / (0.3 * MM)) * 0.6);
  }

  // old sticky tape
  if (on(FX_TAPE)) {
    let e = fxA(FX_TAPE).x;
    let n = u32(U.counts1.x);
    for (var i = 0u; i < n; i++) {
      let g0 = geo[G_TAPE + i * 2u];
      let g1 = geo[G_TAPE + i * 2u + 1u];
      let l = rot2(-g0.z) * (q - g0.xy);
      let endJag = 0.6 * MM * abs(fract(l.y / (1.1 * MM)) - 0.5);
      let d = max(abs(l.x) - g0.w * 0.5 + endJag, abs(l.y) - g1.x * 0.5);
      let inside = edge(d);
      if (inside > 0.0) {
        let age = sat((e - g1.y) / max(1.0 - g1.y, 0.1));
        let film = 1.0 - ss(0.62, 0.95, age + 0.25 * gnoise(l / (5.0 * MM) + g0.xy));
        let amber = mix(vec3f(0.985, 0.975, 0.94), vec3f(0.92, 0.79, 0.56), ss(0.05, 0.7, age));
        let edgeD = exp(-(g1.x * 0.5 - abs(l.y)) / (0.6 * MM));
        let glue = mix(vec3f(0.92, 0.82, 0.6), vec3f(0.7, 0.5, 0.28), ss(0.4, 1.0, age));
        var tc = mix(glue, amber, film);
        tc *= mix(vec3f(1.0), vec3f(0.8, 0.62, 0.4), edgeD * age * 0.7);
        let crinkle = film * age * (1.0 - ss(0.0, 0.1, abs(gnoise(rot2(0.3 * gnoise(l / (9.0 * MM))) * l / vec2f(5.0 * MM, 1.4 * MM) + g0.xy)))) * ss(0.2, 0.7, vnoise(l / (6.0 * MM) + g0.yx)) * detail(0.3 * MM);
        tc *= 1.0 + crinkle * 0.12;
        c = mix(c, c * tc, inside);
      }
    }
  }

  // scorch
  if (on(FX_SCORCH)) {
    let e = fxA(FX_SCORCH).x;
    let x = scorchDist(q) - e * 48.0 * MM;
    let s = exp(-max(x, 0.0) / (6.5 * MM)) * ss(0.0, 0.05, e);
    c *= mix(vec3f(1.0), vec3f(0.62, 0.42, 0.22), sat(s * 0.95));
    c *= mix(vec3f(1.0), vec3f(0.3, 0.2, 0.12), sat(exp(-max(x, 0.0) / (1.8 * MM)) * 0.85 * ss(0.0, 0.05, e)));
    let soot = ss(-0.1, 0.6, fbm(q / (14.0 * MM) + 2.0, 3)) * exp(-max(x, 0.0) / (22.0 * MM));
    c *= mix(vec3f(1.0), vec3f(0.6, 0.6, 0.6), soot * e * 0.4);
  }

  o.c = c;
  // how much the back shows: thinner as it ages, glassier where wet or oily
  return o;
}

// The next page, glimpsed through holes: plainer paper in the leaf's shadow, its text unmirrored
fn underPage(p: vec2f) -> vec3f {
  var t = 0.0;
  var warm = 0.5;
  if (on(FX_TONE)) { t = fxA(FX_TONE).x * 0.9; warm = fxA(FX_TONE).y; }
  var c = toneColor(t, warm) * 0.72;
  let m = vec2f(2.0 * U.text.x + U.text.y - p.x, p.y);
  let g = ghostAt(m, lodFor(U.ink.w)).g;
  c *= vec3f(1.0) - g * 0.85 * inkAbsColor();
  return c;
}
`;

const INK = /* wgsl */ `
// ── ink ─────────────────────────────────────────────────────────────────────────────────────
// the coverage as it came off the press
fn pressed(q: vec2f, lod: f32) -> vec3f {
  var ink = inkRaw(q, lod);
  if (!on(FX_PRESS)) { return ink; }
  let a = fxA(FX_PRESS);
  let b = fxB(FX_PRESS);
  let so = seedOff(b.y);
  let e = a.x;
  let sdf = sdfAt(q);
  // rough edges: threshold a softened copy against noise
  if (a.w > 0.0 && sdf < 1.5 && !inCap(q)) {
    let cb = covAt(q, max(lod, 1.4));
    let n = gnoise(q / (0.32 * MM) + so) * 0.6 + gnoise(q / (0.11 * MM) + so) * 0.4 * detail(0.1 * MM);
    let w = 0.06 + 0.5 * U.view.w * U.page.z * 0.12;
    let c = ss(0.5 - w, 0.5 + w, cb + a.w * e * 0.38 * n);
    ink = mix(ink, c * inkAbsColor(), sat(a.w * e * 1.5) * detail(0.12 * MM));
  }
  // uneven inking, and paper showing through the solids
  let patchy = ss(-0.3, 0.6, fbm(q / (11.0 * MM) + so, 3));
  let salt = step(1.0 - 0.35 * a.y, vnoise(q / (0.09 * MM) + so)) * detail(0.08 * MM);
  ink *= 1.0 - e * a.y * (patchy * 0.5 + salt * 0.35);
  // squash: ink pressed out to the letters' edges, their middles lighter
  let depth = -sdf;
  let rimK = ss(1.0, 0.0, abs(depth - 0.25)) ;
  ink *= 1.0 + e * a.z * (rimK * 0.25 - ss(0.4, 1.4, depth) * 0.3);
  ink += e * a.z * 0.22 * exp(-max(sdf, 0.0) / 0.35) * step(0.0, sdf) * inkAbsColor() * detail(0.2 * MM);
  // broken sorts: bits missing from letter edges
  let brk = step(1.0 - b.x * 0.22, vnoise(q / (1.1 * MM) + so * 1.9));
  ink *= 1.0 - brk * e * ss(1.6, 0.3, depth);
  return ink;
}

struct InkOut { a: vec3f, holes: f32, halo: f32 }

fn inkAt(q: vec2f, wet: f32, sun: f32) -> InkOut {
  var o: InkOut;
  o.holes = 0.0;
  o.halo = 0.0;
  let lod = lodFor(U.page.z);
  var ink = pressed(q, lod);
  let sdf = sdfAt(q);
  let depth = -sdf;

  // smudges: ink dragged by a finger
  if (on(FX_SMUDGE)) {
    let n = u32(U.counts2.x);
    let e = fxA(FX_SMUDGE).x;
    for (var i = 0u; i < n; i++) {
      let g0 = geo[G_SMUDGE + i * 2u];
      let g1 = geo[G_SMUDGE + i * 2u + 1u];
      let dir = vec2f(cos(g1.x), sin(g1.x));
      let l = vec2f(dot(q - g0.xy, dir), dot(q - g0.xy, vec2f(-dir.y, dir.x)));
      let m = ss(1.0, 0.55, length(vec2f(l.x / g0.z, l.y / g0.w))) * g1.y * e;
      if (m > 0.0) {
        var sm = vec3f(0.0);
        var wsum = 0.0;
        for (var k = 1; k <= 14; k++) {
          let s = f32(k) / 14.0;
          let w = (1.0 - s) * (1.0 - s);
          sm += inkRaw(q - dir * s * g0.z * 0.9, lod + 1.5) * w;
          wsum += w;
        }
        let ridges = mix(0.75, 0.55 + 0.45 * sin(l.y / (0.46 * MM) * TAU + 2.0 * gnoise(l / (3.0 * MM))), detail(0.46 * MM));
        ink = ink * (1.0 - 0.45 * m) + sm / wsum * 3.0 * m * ridges;
      }
    }
  }

  // running: streaks hanging under each line
  if (on(FX_RUN)) {
    let a = fxA(FX_RUN);
    let so = seedOff(a.w);
    let wetK = select(1.0, wet, on(FX_WATER));
    if (wetK > 0.01) {
      let ang = (a.z - 0.5) * 1.6 + PI * 0.5;
      let dir = vec2f(cos(ang), sin(ang));
      let L = (2.0 + 22.0 * a.y) * MM * a.x;
      let across = dot(q, vec2f(-dir.y, dir.x));
      let lane = vnoise(vec2f(across / (1.1 * MM), so.x));
      let region = ss(-0.25, 0.45, fbm(q / (16.0 * MM) + so, 2) + 0.15);
      let Ll = L * (0.25 + 0.75 * lane * lane) * region;
      var r = vec3f(0.0);
      let jit = hash12(q * 7.13 + so);
      for (var k = 0; k < 20; k++) {
        let s = (f32(k) + jit) / 20.0;
        let side = vec2f(-dir.y, dir.x) * gnoise(vec2f(across / (2.0 * MM), s * 3.0) + so) * 0.35 * MM * s;
        r += inkRaw(q - dir * s * Ll - side, lod + 1.0 + s * 1.5) * (1.0 - s);
      }
      ink = ink * (1.0 - 0.25 * a.x * wetK * region) + r / 10.0 * 0.75 * wetK;
    }
  }

  // feathering: wicked out along the fibres
  var bleed = 0.0;
  if (on(FX_FEATHER)) { bleed = fxA(FX_FEATHER).x; }
  if (on(FX_WATER)) { bleed = max(bleed, wet * fxB(FX_WATER).x * fxA(FX_WATER).x); }
  if (bleed > 0.0) {
    let reach = (0.08 + select(0.4, fxA(FX_FEATHER).y, on(FX_FEATHER)) * 0.55) * MM * bleed;
    var hair = 0.0;
    for (var i = 0; i < 4; i++) {
      let r = rot2(f32(i) * 0.79 + 0.4 + 0.3 * gnoise(q / (2.0 * MM) + f32(i))) * q;
      let n = abs(gnoise(vec2f(r.x / (0.09 * MM), r.y / (0.7 * MM)) + vec2f(f32(i) * 7.0, 0.0)));
      let len = ss(0.0, 0.4, gnoise(vec2f(r.x / (0.3 * MM), r.y / (0.35 * MM)) + f32(i) * 3.0));
      hair = max(hair, (1.0 - ss(0.0, 0.18, n)) * len);
    }
    hair = mix(0.25, hair, detail(0.09 * MM));
    let hk = select(0.6, fxA(FX_FEATHER).z, on(FX_FEATHER));
    let near = exp(-max(sdf, 0.0) / max(reach * 0.35, 0.03));
    let far = exp(-max(sdf, 0.0) / max(reach * 1.6, 0.05)) * hair;
    let halo = step(0.0, sdf) * mix(near * 0.5, max(near * 0.4, far * 1.3), hk);
    ink = max(ink, inkRaw(q, lod + 0.6 + bleed) * bleed * 0.4);
    ink += inkAbsColor() * halo * 0.55 * ss(0.0, 0.3, bleed);
  }

  // rubbed away
  if (on(FX_RUB)) {
    let a = fxA(FX_RUB);
    let so = seedOff(a.z);
    var m = a.x * mix(0.7, ss(-0.2, 0.55, fbm(q / (13.0 * MM) + so, 3) + 0.15), a.y);
    // hands at the corners, the creases of folds
    m += a.x * 0.6 * exp(-length(q - vec2f(U.page.x, U.page.y)) / (30.0 * MM));
    if (on(FX_FOLDS)) {
      let n = u32(U.counts0.z);
      for (var i = 0u; i < n; i++) {
        let o2 = geo[G_FOLDS + i * 2u];
        m += fxA(FX_FOLDS).z * exp(-abs(dot(q - o2.xy, o2.zw)) / (1.2 * MM));
      }
    }
    let n = vnoise(q / (0.45 * MM) + so) * 0.55 + vnoise(q / (0.16 * MM) + so * 1.3) * 0.45;
    let keep = ss(m * 1.1 - 0.12, m * 1.1 + 0.08, n * 0.8 + clamp(depth, 0.0, 2.0) * 0.12);
    ink *= mix(1.0 - m * 0.55, (0.12 + 0.88 * keep) * (1.0 - 0.25 * m), detail(0.16 * MM));
  } else if (on(FX_FOLDS)) {
    let n = u32(U.counts0.z);
    var m = 0.0;
    for (var i = 0u; i < n; i++) {
      let o2 = geo[G_FOLDS + i * 2u];
      m = max(m, exp(-abs(dot(q - o2.xy, o2.zw) + 0.2 * MM * gnoise(q / MM)) / (0.5 * MM)));
    }
    ink *= 1.0 - m * fxA(FX_FOLDS).z * fxA(FX_FOLDS).x * 0.85;
  }

  // flaking: the film crazes and lifts
  if (on(FX_FLAKE)) {
    let a = fxA(FX_FLAKE);
    let so = seedOff(a.z);
    let w = worley(q / ((0.12 + 0.7 * a.y) * MM) + so);
    let lost = step(w.z, a.x * 0.45) * ss(0.05, 0.3, depth + 0.1);
    let craze = (1.0 - ss(0.0, 0.08, w.y - w.x)) * ss(0.0, 0.3, a.x) * detail(0.2 * MM);
    ink *= (1.0 - lost * 0.88) * (1.0 - craze * 0.7);
  }

  // iron gall burn: brown halos, cracks, holes
  if (on(FX_CORRODE)) {
    let a = fxA(FX_CORRODE);
    let so = seedOff(a.w);
    let e = a.x;
    let hr = (0.12 + 0.6 * a.y) * MM * (0.7 + 0.6 * vnoise(q / (1.5 * MM) + so));
    let x = max(sdf, 0.0) + 0.12 * MM * gnoise(q / (0.25 * MM) + so);
    o.halo = (ss(hr, hr * 0.6, x) * 0.75 + exp(-x / (hr * 2.5)) * 0.3) * e * (0.3 + 0.7 * a.y);
    ink *= vec3f(1.0) - e * vec3f(0.5, 0.28, 0.05);
    let w = worley(q / (0.45 * MM) + so);
    let crack = (1.0 - ss(0.0, 0.07, w.y - w.x)) * ss(0.35, 0.7, e) * ss(0.1, 0.5, depth) * detail(0.15 * MM);
    ink *= 1.0 - crack * 0.85;
    o.holes = step(w.z, a.z * ss(0.55, 1.0, e) * 0.9) * ss(0.15, 0.4, depth);
  }

  // fading
  if (on(FX_FADE)) {
    let a = fxA(FX_FADE);
    var rate = vec3f(0.52, 0.38, 0.16);                         // iron gall: browns
    if (a.y > 0.5 && a.y < 1.5) { rate = vec3f(0.62, 0.22, 0.55); }  // aniline: violet
    else if (a.y > 1.5 && a.y < 2.5) { rate = vec3f(0.55, 0.55, 0.52); } // lamp black: greys
    else if (a.y > 2.5) { rate = vec3f(0.18, 0.4, 0.62); }       // blue-black
    if (inCap(q)) { rate = vec3f(0.6, 0.55, 0.5); }
    var e = a.x * (1.0 + a.z * fbm(q / (25.0 * MM) + 3.0, 3) * 0.9);
    e += sun * a.x * 0.5;
    e = sat(e);
    ink *= vec3f(1.0) - e * rate;
  }

  // a little of the paper's tooth in the ink
  ink *= 0.95 + 0.05 * gnoise(q / (0.5 * MM)) * detail(0.4 * MM);
  o.a = max(ink, vec3f(0.0));
  return o;
}
`;

const MAIN = /* wgsl */ `
struct VOut { @builtin(position) pos: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  return o;
}

fn groundAt(p: vec2f, d: f32) -> vec3f {
  // the sheet's shadow on the table, from its real outline
  let sh = exp(-max(d, 0.0) / (3.0 * MM)) * 0.36;
  return U.ground.rgb * (1.0 - sh);
}

fn shade(p: vec2f) -> vec3f {
  let W = U.page.x;
  let H = U.page.y;
  let s = sheet(p);
  var bg = groundAt(p, s.d);
  if (U.ground.w > 0.5 && p.x > 0.0 && p.y > 0.0 && p.x < W && p.y < H) { bg = underPage(p); }
  // a dog-ear opens the corner onto the next page
  var under = bg;
  if (s.open > 0.0 && p.x > 0.0 && p.y > 0.0 && p.x < W && p.y < H) {
    under = mix(bg, underPage(p), s.open);
  }

  var alpha = edge(s.d);
  let fray = s.fray;
  if (alpha <= 0.0 && fray <= 0.0 && s.flap <= 0.0) { return under; }

  let back = s.flap > 0.5;
  let q = s.q;
  let pc = paperColor(q, p, back);
  var c = pc.c;

  // ink
  var holes = 0.0;
  if (!back) {
    let ink = inkAt(q, pc.wet, pc.sun);
    holes = ink.holes;
    c *= mix(vec3f(1.0), vec3f(0.74, 0.58, 0.4), sat(ink.halo * 0.7));
    // show-through: the back of the leaf, mirrored and soft
    if (on(FX_SHOW)) {
      let a = fxA(FX_SHOW);
      let g = ghostAt(q, lodFor(U.ink.w) + 0.8 + a.y * 2.2).r;
      c *= vec3f(1.0) - g * sat(a.x * 0.3 * pc.show) * vec3f(0.62, 0.62, 0.6);
    } else if (pc.show > 1.0) {
      let g = ghostAt(q, lodFor(U.ink.w) + 1.4).r;
      c *= vec3f(1.0) - g * sat(0.08 * (pc.show - 1.0)) * vec3f(0.62, 0.62, 0.6);
    }
    c *= clamp(vec3f(1.0) - ink.a, vec3f(0.0), vec3f(1.0));
  } else {
    // the back of the leaf, on the folded corner: its own text, read the right way round
    let g = ghostAt(q, lodFor(U.ink.w)).r;
    c *= vec3f(1.0) - g * inkAbsColor() * 0.92;
    let thr = covAt(vec2f(2.0 * U.text.x + U.text.y - q.x, q.y), lodFor(U.page.z) + 1.5);
    c *= 1.0 - thr * 0.06;
  }

  // a worm's groove: a shallow channel, darker
  if (s.worm > 0.0) {
    let frass = mix(0.5, step(0.55, vnoise(p / (0.12 * MM))), detail(0.1 * MM));
    c *= mix(vec3f(1.0), mix(vec3f(0.62, 0.5, 0.36), vec3f(0.45, 0.34, 0.24), frass), s.worm * 0.8);
  }
  c *= mix(vec3f(1.0), vec3f(0.7, 0.56, 0.4), s.wormRim * 0.55 * (1.0 - s.worm));

  // relief and light
  let ex = max(U.view.w * 0.7, 0.25);
  let h0 = height(p);
  let n = normalize(vec3f(-(height(p + vec2f(ex, 0.0)) - h0) / ex, -(height(p + vec2f(0.0, ex)) - h0) / ex, 1.0));
  let L = U.light.xyz;
  let lit = dot(n, L) / L.z;
  c *= max(1.0 + (lit - 1.0) * U.light.w * 2.0, 0.2);

  // the white core along a fresh tear
  if (s.rim > 0.0) {
    let core = vec3f(0.985, 0.98, 0.965) * (0.96 + 0.04 * gnoise(p / (0.3 * MM)));
    c = mix(c, core, s.rim * 0.9);
  }
  // char at a burnt edge
  if (s.char_ > 0.0) {
    let ash = 0.06 + 0.12 * ss(0.2, 0.8, vnoise(p / (0.5 * MM))) * ss(0.3, 1.0, s.char_);
    c = mix(c, vec3f(ash * 1.05, ash, ash * 0.95), s.char_);
  }
  // the folded corner sits on the page: its shadow
  c *= 1.0 - s.shade;
  if (back) {
    let crease = exp(-abs(dot(p - dogearGeom().xy, dogearGeom().zw)) / (0.5 * MM));
    c *= 1.0 + crease * 0.08;
  }
  under *= 1.0 - s.shade * 0.8;

  // holes eaten by the ink
  alpha *= 1.0 - holes;
  // the edge of a hole nearest the light shades what's under it
  if (alpha < 0.999) {
    let s2 = sheet(p + normalize(U.light.xy) * 0.9 * MM);
    under *= 1.0 - 0.6 * edge(s2.d) * (1.0 - alpha);
  }
  let paper = mix(under, c, alpha);
  // loose fibres past the edge
  let fc = mix(c, vec3f(0.97, 0.96, 0.94), 0.5);
  return mix(paper, fc, fray * (1.0 - alpha) * 0.85);
}

@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let p = U.view.xy + v.pos.xy * U.view.w;
  let c = shade(p);
  // to display (sRGB-ish), with a whisper of dither
  let d = (hash12(v.pos.xy + U.res.w) - 0.5) / 255.0;
  return vec4f(pow(max(c, vec3f(0.0)), vec3f(1.0)) + d, 1.0);
}
`;

export const COMPOSE_WGSL = HEAD + LIB + PAPER + INK + MAIN;

// ── one-time passes: mips and the signed distance field ─────────────────────────────────────
export const MIP_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u);
  let y = f32(i & 2u);
  o.pos = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
  o.uv = vec2f(x, y);
  return o;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f { return textureSampleLevel(src, smp, v.uv, 0.0); }
`;

// Jump flooding on the coverage: per texel the nearest ink texel and the nearest bare texel,
// then a signed distance in page units (negative inside the ink)
export const JFA_WGSL = /* wgsl */ `
struct P { size: vec2f, step: f32, unitsPerTexel: f32, lod: f32, p1: f32, p2: f32, p3: f32 }
@group(0) @binding(0) var<uniform> prm: P;
@group(0) @binding(1) var srcSeeds: texture_2d<f32>;
@group(0) @binding(2) var dstSeeds: texture_storage_2d<rgba32float, write>;
@group(0) @binding(3) var cov: texture_2d<f32>;
@group(0) @binding(4) var smp: sampler;
@group(0) @binding(5) var outSdf: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8) fn init(@builtin(global_invocation_id) id: vec3u) {
  let s = vec2u(prm.size);
  if (id.x >= s.x || id.y >= s.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / prm.size;
  let c = textureSampleLevel(cov, smp, uv, prm.lod).r;
  let p = vec2f(id.xy);
  let none = vec2f(-1e6);
  // xy: nearest ink, zw: nearest paper
  textureStore(dstSeeds, id.xy, select(vec4f(none, p), vec4f(p, none), c > 0.5));
}

@compute @workgroup_size(8, 8) fn jump(@builtin(global_invocation_id) id: vec3u) {
  let s = vec2i(prm.size);
  if (i32(id.x) >= s.x || i32(id.y) >= s.y) { return; }
  let p = vec2f(id.xy);
  var best = textureLoad(srcSeeds, vec2i(id.xy), 0);
  var dI = distance(p, best.xy);
  var dO = distance(p, best.zw);
  let k = i32(prm.step);
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let q = vec2i(id.xy) + vec2i(x, y) * k;
      if (q.x < 0 || q.y < 0 || q.x >= s.x || q.y >= s.y) { continue; }
      let o = textureLoad(srcSeeds, q, 0);
      let a = distance(p, o.xy);
      if (a < dI) { dI = a; best = vec4f(o.xy, best.zw); }
      let b = distance(p, o.zw);
      if (b < dO) { dO = b; best = vec4f(best.xy, o.zw); }
    }
  }
  textureStore(dstSeeds, id.xy, best);
}

@compute @workgroup_size(8, 8) fn resolve(@builtin(global_invocation_id) id: vec3u) {
  let s = vec2u(prm.size);
  if (id.x >= s.x || id.y >= s.y) { return; }
  let p = vec2f(id.xy);
  let o = textureLoad(srcSeeds, vec2i(id.xy), 0);
  let dI = distance(p, o.xy);
  let dO = distance(p, o.zw);
  // inside: distance to the paper is negative
  let d = select(-(dO - 0.5), dI - 0.5, dO < dI);
  textureStore(outSdf, id.xy, vec4f(clamp(d * prm.unitsPerTexel, -60.0, 60.0), 0.0, 0.0, 1.0));
}
`;
