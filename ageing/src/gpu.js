// WebGPU: the leaf's textures (ink coverage with mips, the ghost texts, the initial's colour, the
// ink's signed distance field), the arrival maps and geometry, and the one compose pass.

import { COMPOSE_WGSL, MIP_WGSL, JFA_WGSL, GEO } from './shader.js?v=a8136959';
import { PAGE_W, PAGE_H, TEXT_X, MM } from './page.js?v=a8136959';
import { EFFECTS, packFx } from './effects.js?v=a8136959';
import { FIELD_S } from './fields.js?v=a8136959';

export const PRINT_S = 3;     // ink coverage texels per unit
export const GHOST_S = 1.5;   // back-of-leaf / facing page texels per unit
export const SDF_S = 1.5;     // distance field texels per unit

const U_FLOATS = (11 + 64) * 4;
const GROUNDS = [[0.56, 0.56, 0.54], [0.17, 0.17, 0.165], [0.95, 0.95, 0.94]];

function mipCount(w, h) { return Math.floor(Math.log2(Math.max(w, h))) + 1; }

export class Renderer {
	static async create(canvas) {
		if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
		const adapter = await navigator.gpu.requestAdapter();
		const device = await adapter.requestDevice({ requiredLimits: { maxTextureDimension2D: Math.min(16384, adapter.limits.maxTextureDimension2D) } });
		return new Renderer(device, canvas);
	}

	constructor(device, canvas) {
		this.device = device;
		this.canvas = canvas;
		this.ctx = canvas.getContext('webgpu');
		this.format = navigator.gpu.getPreferredCanvasFormat();
		this.ctx.configure({ device, format: this.format, alphaMode: 'opaque' });
		device.lost.then(i => console.error('device lost', i));

		this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
		this.ubuf = device.createBuffer({ size: U_FLOATS * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
		this.gbuf = device.createBuffer({ size: GEO.size * 16, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
		this.u = new Float32Array(U_FLOATS);
		this.counts = {};

		const mod = device.createShaderModule({ code: COMPOSE_WGSL });
		this.module = mod;
		mod.getCompilationInfo().then(info => {
			for (const m of info.messages) if (m.type === 'error') console.error(`compose.wgsl ${m.lineNum}:${m.linePos} ${m.message}`, COMPOSE_WGSL.split('\n')[m.lineNum - 1]);
		});
		this.pipes = {};
		this.pipe(this.format);

		const mipMod = device.createShaderModule({ code: MIP_WGSL });
		this.mipPipes = {};
		this.mipPipe = (fmt) => this.mipPipes[fmt] ||= device.createRenderPipeline({
			layout: 'auto', vertex: { module: mipMod, entryPoint: 'vs' }, fragment: { module: mipMod, entryPoint: 'fs', targets: [{ format: fmt }] }, primitive: { topology: 'triangle-list' },
		});

		const jfa = device.createShaderModule({ code: JFA_WGSL });
		this.jfa = {
			init: device.createComputePipeline({ layout: 'auto', compute: { module: jfa, entryPoint: 'init' } }),
			jump: device.createComputePipeline({ layout: 'auto', compute: { module: jfa, entryPoint: 'jump' } }),
			resolve: device.createComputePipeline({ layout: 'auto', compute: { module: jfa, entryPoint: 'resolve' } }),
		};

		// placeholders until a leaf is set
		this.white = this.tex(1, 1, 'rgba8unorm', 1);
		device.queue.writeTexture({ texture: this.white }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, [1, 1]);
		this.capTex = this.white;
		this.fieldTex = this.tex(Math.round(PAGE_W * FIELD_S), Math.round(PAGE_H * FIELD_S), 'rgba8unorm', 1);
	}

	pipe(fmt) {
		return this.pipes[fmt] ||= this.device.createRenderPipeline({
			layout: 'auto',
			vertex: { module: this.module, entryPoint: 'vs' },
			fragment: { module: this.module, entryPoint: 'fs', targets: [{ format: fmt }] },
			primitive: { topology: 'triangle-list' },
		});
	}

	tex(w, h, format, mips = 1, extra = 0) {
		return this.device.createTexture({
			size: [w, h], format, mipLevelCount: mips,
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | extra,
		});
	}

	upload(source, format, mips) {
		const w = source.width, h = source.height;
		const t = this.tex(w, h, format, mips ? mipCount(w, h) : 1);
		this.device.queue.copyExternalImageToTexture({ source }, { texture: t }, [w, h]);
		if (mips) this.genMips(t, format);
		return t;
	}

	genMips(t, format) {
		const d = this.device, pipe = this.mipPipe(format);
		const enc = d.createCommandEncoder();
		for (let i = 1; i < t.mipLevelCount; i++) {
			const bg = d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
				{ binding: 0, resource: t.createView({ baseMipLevel: i - 1, mipLevelCount: 1 }) },
				{ binding: 1, resource: this.sampler },
			] });
			const pass = enc.beginRenderPass({ colorAttachments: [{ view: t.createView({ baseMipLevel: i, mipLevelCount: 1 }), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] });
			pass.setPipeline(pipe);
			pass.setBindGroup(0, bg);
			pass.draw(3);
			pass.end();
		}
		d.queue.submit([enc.finish()]);
	}

	// recto: canvas at PRINT_S (r = ink), ghosts: canvas at GHOST_S (r back, g facing),
	// cap: { trans: ImageBitmap, box: [x, y, s] } or { box } for a plain capital
	setLeaf({ recto, ghosts, cap }) {
		for (const t of [this.printTex, this.ghostTex, this.sdfTex]) t && t.destroy();
		if (this.capTex !== this.white) this.capTex.destroy();
		this.printTex = this.upload(recto, 'r8unorm', true);
		this.ghostTex = this.upload(ghosts, 'rg8unorm', true);
		this.capTex = cap.trans ? this.upload(cap.trans, 'rgba8unorm', true) : this.white;
		this.cap = cap;
		this.buildSdf();
		this.bind = null;
	}

	buildSdf() {
		const d = this.device;
		const w = Math.round(PAGE_W * SDF_S), h = Math.round(PAGE_H * SDF_S);
		const seeds = [0, 1].map(() => d.createTexture({ size: [w, h], format: 'rgba32float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING }));
		this.sdfTex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
		const prm = (step) => {
			const b = d.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
			d.queue.writeBuffer(b, 0, new Float32Array([w, h, step, 1 / SDF_S, Math.log2(PRINT_S / SDF_S), 0, 0, 0]));
			return b;
		};
		const enc = d.createCommandEncoder();
		const run = (pipe, entries) => {
			const pass = enc.beginComputePass();
			pass.setPipeline(pipe);
			pass.setBindGroup(0, d.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }));
			pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8));
			pass.end();
		};
		const bufs = [];
		const p0 = prm(0); bufs.push(p0);
		run(this.jfa.init, [
			{ binding: 0, resource: { buffer: p0 } },
			{ binding: 2, resource: seeds[0].createView() },
			{ binding: 3, resource: this.printTex.createView() },
			{ binding: 4, resource: this.sampler },
		]);
		let cur = 0;
		const steps = [];
		for (let s = 1 << Math.ceil(Math.log2(Math.max(w, h)) - 1); s >= 1; s >>= 1) steps.push(s);
		steps.push(1);
		for (const s of steps) {
			const b = prm(s); bufs.push(b);
			run(this.jfa.jump, [
				{ binding: 0, resource: { buffer: b } },
				{ binding: 1, resource: seeds[cur].createView() },
				{ binding: 2, resource: seeds[1 - cur].createView() },
			]);
			cur = 1 - cur;
		}
		const pr = prm(0); bufs.push(pr);
		run(this.jfa.resolve, [
			{ binding: 0, resource: { buffer: pr } },
			{ binding: 1, resource: seeds[cur].createView() },
			{ binding: 5, resource: this.sdfTex.createView() },
		]);
		d.queue.submit([enc.finish()]);
		d.queue.onSubmittedWorkDone().then(() => { seeds.forEach(t => t.destroy()); bufs.forEach(b => b.destroy()); });
	}

	setField(canvas) {
		// a sheet of another size needs another field texture
		if (this.fieldTex.width !== canvas.width || this.fieldTex.height !== canvas.height) {
			this.fieldTex.destroy();
			this.fieldTex = this.tex(canvas.width, canvas.height, 'rgba8unorm', 1);
			this.bind = null;
		}
		this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: this.fieldTex }, [canvas.width, canvas.height]);
	}

	setGeo(geo) {
		this.device.queue.writeBuffer(this.gbuf, 0, geo.data);
		this.counts = geo.counts;
	}

	bindGroup(fmt) {
		if (this.bind && this.bind.fmt === fmt) return this.bind.bg;
		const pipe = this.pipe(fmt);
		const bg = this.device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries: [
			{ binding: 0, resource: { buffer: this.ubuf } },
			{ binding: 1, resource: { buffer: this.gbuf } },
			{ binding: 2, resource: this.sampler },
			{ binding: 3, resource: this.printTex.createView() },
			{ binding: 4, resource: this.capTex.createView() },
			{ binding: 5, resource: this.ghostTex.createView() },
			{ binding: 6, resource: this.sdfTex.createView() },
			{ binding: 7, resource: this.fieldTex.createView() },
		] });
		this.bind = { fmt, bg };
		return bg;
	}

	// view: { x, y } page point at the target's top-left, z = target px per unit
	writeUniforms(state, view, w, h, time = 0) {
		const u = this.u, c = this.counts;
		u.set([view.x, view.y, view.z, 1 / view.z], 0);
		u.set([w, h, state.age, time], 4);
		u.set([PAGE_W, PAGE_H, PRINT_S, SDF_S], 8);
		const ink = state.ink || [0.075, 0.068, 0.062];
		u.set([...ink, GHOST_S], 12);
		const az = state.lightAngle * Math.PI * 2, el = 0.55;
		u.set([Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el), state.light], 16);
		u.set([...GROUNDS[state.ground % GROUNDS.length], state.under], 20);
		const box = this.cap ? this.cap.box : [0, 0, 0];
		u.set([box[0], box[1], box[2], this.cap && this.cap.trans ? (this.cap.text ? 2 : 1) : 0], 24);
		u.set([c.coffee || 0, c.grease || 0, c.folds || 0, c.crumple || 0], 28);
		u.set([c.tape || 0, c.rust || 0, c.prints || 0, c.tear || 0], 32);
		const capS = this.cap && this.cap.trans ? this.cap.trans.width / box[2] : 1;
		u.set([c.smudge || 0, c.tearKind || 0, FIELD_S, capS], 36);
		u.set([TEXT_X, 600, 104, 0], 40);
		const fx = new Float32Array(64 * 4);
		packFx(state, fx);
		u.set(fx, 44);
		this.device.queue.writeBuffer(this.ubuf, 0, u);
	}

	draw(state, view, time = 0) {
		const w = this.canvas.width, h = this.canvas.height;
		if (!this.printTex || !w || !h) return;
		this.writeUniforms(state, view, w, h, time);
		const enc = this.device.createCommandEncoder();
		const pass = enc.beginRenderPass({ colorAttachments: [{ view: this.ctx.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
		pass.setPipeline(this.pipe(this.format));
		pass.setBindGroup(0, this.bindGroup(this.format));
		pass.draw(3);
		pass.end();
		this.device.queue.submit([enc.finish()]);
	}

	// render offscreen and read back: → ImageData
	async read(state, view, w, h) {
		const d = this.device;
		const t = d.createTexture({ size: [w, h], format: 'rgba8unorm', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
		this.writeUniforms(state, view, w, h, 0);
		const bpr = Math.ceil(w * 4 / 256) * 256;
		const buf = d.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
		const enc = d.createCommandEncoder();
		const pass = enc.beginRenderPass({ colorAttachments: [{ view: t.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 1] }] });
		pass.setPipeline(this.pipe('rgba8unorm'));
		pass.setBindGroup(0, this.bindGroup('rgba8unorm'));
		pass.draw(3);
		pass.end();
		enc.copyTextureToBuffer({ texture: t }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
		d.queue.submit([enc.finish()]);
		this.bind = null;
		await buf.mapAsync(GPUMapMode.READ);
		const src = new Uint8Array(buf.getMappedRange());
		const out = new Uint8ClampedArray(w * h * 4);
		for (let y = 0; y < h; y++) out.set(src.subarray(y * bpr, y * bpr + w * 4), y * w * 4);
		buf.unmap(); buf.destroy(); t.destroy();
		return new ImageData(out, w, h);
	}
}

export { MM, EFFECTS };
