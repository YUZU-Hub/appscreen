// Three.js 3D Renderer for iPhone mockups

let threeRenderer = null;
let threeScene = null;
let threeCamera = null;
let phoneModel = null;
let phonePivot = null;  // Pivot group for rotation around screen center
let screenMesh = null;
let customScreenPlane = null;
let orbitControls = null;
let isThreeJSInitialized = false;
let phoneModelLoaded = false;
let phoneModelLoading = false;
let phoneModelLoadGeneration = 0;

// Screen texture for the screenshot
let screenTexture = null;

// Store original model scale
let baseModelScale = 1;

// Store base position offset to keep model centered after screen alignment
let basePositionOffset = { x: 0, y: 0, z: 0 };

// Current device model: the resolved deviceConfigs key ('iphone',
// 'iphone-duo-inner', ...) and the UI device type it came from ('iphone',
// 'iphone-duo'). They differ for devices with several 3D variants.
let currentDeviceModel = 'iphone';
let currentDeviceUiType = 'iphone';

// Cache for loaded phone models (for rendering different devices in side previews)
let phoneModelCache = {};  // { configKey: { model, pivot, screenPlane, baseScale, loaded } }

// iPhone Duo real-world dimensions (Apple tech specs), in millimetres — the
// procedural model is built in these units. "Portrait" is how the app presents
// each display: the outer cover display is natively portrait, the inner one is
// natively landscape and gets turned 90° (hinge/crease runs horizontally).
const DUO_SPEC = {
    closed: { w: 84.1, h: 117.8, d: 11.3 },
    open: { w: 164.6, h: 117.8, d: 5.2 },
    outerScreen: { w: 1398 / 460 * 25.4, h: 2034 / 460 * 25.4 },  // 77.19 x 112.31
    innerScreen: { w: 1878 / 430 * 25.4, h: 2670 / 430 * 25.4 },  // 110.93 x 157.72 (portrait)
    halfT: 5.2,         // each half is as thick as the open device
    hingeGap: 0.3,      // seam between the halves when open
    cornerR: 11,        // device corner radius on the free edges
    hingeCornerR: 1.2,  // corner radius on the hinge side of each half
    frameBevel: 1.0,    // rounded titanium edge
    spineRx: 2.0        // how far the closed hinge spine reaches in from the edge
};
DUO_SPEC.halfW = (DUO_SPEC.open.w - DUO_SPEC.hingeGap) / 2;
DUO_SPEC.closedGap = DUO_SPEC.closed.d - 2 * DUO_SPEC.halfT;
// Screen corner radius = device corner radius minus the (uniform) display border
DUO_SPEC.outerScreenR = DUO_SPEC.cornerR - (DUO_SPEC.closed.h - DUO_SPEC.outerScreen.h) / 2;
DUO_SPEC.innerScreenR = DUO_SPEC.cornerR - (DUO_SPEC.open.w - DUO_SPEC.innerScreen.h) / 2;
DUO_SPEC.screenLift = 0.05;  // screen overlay sits this far in front of the glass

// Device-specific configurations, keyed by config key. `uiType` is the device
// type the UI stores in screenshot.device3D. A config has either `modelPath`
// (GLB) or `build()` (procedural, returns a THREE.Object3D).
const deviceConfigs = {
    iphone: {
        uiType: 'iphone',
        modelPath: 'models/iphone-15-pro-max.glb',
        aspectRatio: 1290 / 2796,
        screenHeightFactor: 0.826,
        screenOffset: { x: 0.027, y: 0.745, z: 0.098 },
        positionOffsetFactor: 0.81,
        cornerRadiusFactor: 0.16,
        modelRotation: { x: 0, y: 0, z: 0 }  // No correction needed
    },
    // iPhone Duo, open: the 7.6" inner display, shown in portrait.
    // Built in mm with the screen centre at (0, 0, screenOffset.z).
    'iphone-duo-inner': {
        uiType: 'iphone-duo',
        build: () => buildIPhoneDuoModel('inner'),
        aspectRatio: 2007 / 2853,
        screenHeightFactor: DUO_SPEC.innerScreen.h / 4.3,
        screenOffset: { x: 0, y: 0, z: DUO_SPEC.halfT / 2 + DUO_SPEC.screenLift },
        cornerRadiusFactor: DUO_SPEC.innerScreenR / DUO_SPEC.innerScreen.w,
        modelRotation: { x: 0, y: 0, z: 0 }
    },
    // iPhone Duo, closed: the 5.4" outer cover display.
    'iphone-duo-outer': {
        uiType: 'iphone-duo',
        build: () => buildIPhoneDuoModel('outer'),
        aspectRatio: 1398 / 2034,
        screenHeightFactor: DUO_SPEC.outerScreen.h / 4.3,
        screenOffset: { x: 0, y: 0, z: DUO_SPEC.closed.d / 2 + DUO_SPEC.screenLift },
        cornerRadiusFactor: DUO_SPEC.outerScreenR / DUO_SPEC.outerScreen.w,
        modelRotation: { x: 0, y: 0, z: 0 }
    }
};

// Map a UI device type (screenshot.device3D) to a deviceConfigs key.
// 'iphone-duo' picks the inner/outer display from duoDisplayVariant(ss)
// (app.js); the removed 'samsung' and anything unknown fall back to the iPhone.
function resolve3DConfigKey(deviceType, ss) {
    if (deviceType === 'iphone-duo') {
        let variant = 'inner';
        if (typeof duoDisplayVariant === 'function') {
            try {
                if (duoDisplayVariant(ss) === 'outer') variant = 'outer';
            } catch (e) { /* keep the default */ }
        }
        return 'iphone-duo-' + variant;
    }
    if (deviceType && deviceConfigs[deviceType]) return deviceType;  // already a config key
    return 'iphone';
}

// Map a UI device type or config key to the UI device type (the key of
// frameColorPresets). Legacy/unknown types become 'iphone'.
function normalize3DDeviceType(deviceType) {
    if (deviceType === 'iphone-duo') return deviceType;
    return deviceConfigs[deviceType]?.uiType || 'iphone';
}

// Frame color presets per device (real device colors)
// Using var so it's accessible from app.js
var frameColorPresets = {
    iphone: [
        { id: 'natural', label: 'Natural Titanium', swatch: '#9d927f',
          materials: { backpanel: '#9d927f', metalframe: '#5f5950', gray: '#221f1b' } },
        { id: 'blue', label: 'Blue Titanium', swatch: '#3d4d5c',
          materials: { backpanel: '#394d5f', metalframe: '#3a4553', gray: '#1a1f24' } },
        { id: 'white', label: 'White Titanium', swatch: '#e3ddd4',
          materials: { backpanel: '#e3ddd4', metalframe: '#c4bdb4', gray: '#2a2825' } },
        { id: 'black', label: 'Black Titanium', swatch: '#3a3632',
          materials: { backpanel: '#3a3632', metalframe: '#2a2725', gray: '#1a1918' } },
        { id: 'desert', label: 'Desert Titanium', swatch: '#c4a882',
          materials: { backpanel: '#c4a882', metalframe: '#8a7560', gray: '#2a2218' } },
        { id: 'deep-purple', label: 'Deep Purple', swatch: '#5b4a6e',
          materials: { backpanel: '#5b4a6e', metalframe: '#3d3348', gray: '#1e1825' } },
        { id: 'gold', label: 'Gold', swatch: '#e3c8a0',
          materials: { backpanel: '#e3c8a0', metalframe: '#c9a96e', gray: '#2a2418' } },
        { id: 'red', label: 'Product Red', swatch: '#c1272d',
          materials: { backpanel: '#c1272d', metalframe: '#8a1c20', gray: '#1a0a0a' } },
    ],
    // Keys are the material names of the procedural model (buildIPhoneDuoModel)
    'iphone-duo': [
        { id: 'night-sky', label: 'Night Sky', swatch: '#23272f',
          materials: { frame: '#1b1f27', spine: '#1b1f27', buttons: '#1b1f27', lensring: '#14171d',
                       backpanel: '#04060a', plateau: '#06080d' } },
        { id: 'star-white', label: 'Star White', swatch: '#e6e1d8',
          materials: { frame: '#8e887d', spine: '#8e887d', buttons: '#8e887d', lensring: '#7d776c',
                       backpanel: '#8f8a80', plateau: '#958f85' } },
    ]
};

// Store original material colors for the current model
let originalMaterialColors = {};

// Find a preset by id for a device, falling back to the device's first preset
// (a screenshot may carry another device's color id, e.g. after a device switch)
function findFrameColorPreset(presetId, deviceType) {
    const presets = frameColorPresets[normalize3DDeviceType(deviceType)];
    if (!presets || !presets.length) return null;
    return presets.find(p => p.id === presetId) || presets[0];
}

// Recolor the meshes of a model whose material names appear in the preset
function applyFrameColorPreset(model, preset) {
    model.traverse((child) => {
        if (child.isMesh && child.material) {
            const matName = (child.material.name || '').toLowerCase();
            if (preset.materials[matName]) {
                child.material.color.set(preset.materials[matName]);
            }
        }
    });
}

// Apply a frame color preset to the phone model
function setPhoneFrameColor(presetId, deviceType) {
    if (!phoneModel) return;

    const preset = findFrameColorPreset(presetId, deviceType || currentDeviceUiType);
    if (!preset) return;

    applyFrameColorPreset(phoneModel, preset);
    requestThreeJSRender();
}

// Apply frame color to a cached model (for side previews). deviceType is a
// config key or a UI type (resolved against ss).
function setCachedModelFrameColor(presetId, deviceType, ss) {
    const cached = phoneModelCache[resolve3DConfigKey(deviceType, ss)];
    if (!cached?.loaded) return;

    const preset = findFrameColorPreset(presetId, deviceType);
    if (!preset) return;

    applyFrameColorPreset(cached.model, preset);
}

// ===== Procedural iPhone Duo model =====

// Shared studio environment map so the procedural titanium and glass get
// reflections (metals render near-black under direct lights alone). Built once
// per renderer with PMREM from a painted equirectangular "photo studio".
let duoEnvMap = null;
let duoEnvMapRenderer = null;

function getDuoEnvMap() {
    if (!threeRenderer || typeof THREE.PMREMGenerator !== 'function') return null;
    if (duoEnvMap && duoEnvMapRenderer === threeRenderer) return duoEnvMap;

    const w = 512, h = 256;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Dim studio: lighter ceiling, dark floor
    const base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, '#6a6a6e');
    base.addColorStop(0.45, '#232326');
    base.addColorStop(0.55, '#141416');
    base.addColorStop(1, '#060607');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // Soft boxes. Equirect u: 0.25 = -Z (behind the device), 0.5 = +X,
    // 0.75 = +Z (camera side), 0/1 = -X. Kept off the +Z horizon so the black
    // front glass stays black when viewed head-on.
    const softbox = (u, v, bw, bh, alpha) => {
        const x = u * w, y = v * h;
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(bw, bh) / 2);
        g.addColorStop(0, `rgba(255,255,255,${alpha})`);
        g.addColorStop(0.6, `rgba(255,255,255,${alpha * 0.55})`);
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(bw / Math.max(bw, bh), bh / Math.max(bw, bh));
        ctx.translate(-x, -y);
        ctx.fillStyle = g;
        ctx.fillRect(x - Math.max(bw, bh) / 2, y - Math.max(bw, bh) / 2, Math.max(bw, bh), Math.max(bw, bh));
        ctx.restore();
    };
    softbox(0.62, 0.18, 170, 60, 1.0);   // key: upper front-right
    softbox(0.90, 0.30, 110, 70, 0.7);   // fill: upper front-left
    softbox(0.50, 0.45, 40, 150, 0.9);   // strip right (+X)
    softbox(0.00, 0.45, 40, 150, 0.6);   // strip left (-X), wraps
    softbox(1.00, 0.45, 40, 150, 0.6);
    softbox(0.25, 0.25, 160, 70, 0.6);   // behind, for the back of the device
    softbox(0.50, 0.03, 512, 30, 0.8);   // ceiling

    const tex = new THREE.CanvasTexture(canvas);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.encoding = THREE.sRGBEncoding;

    const pmrem = new THREE.PMREMGenerator(threeRenderer);
    duoEnvMap = pmrem.fromEquirectangular(tex).texture;
    pmrem.dispose();
    tex.dispose();
    duoEnvMapRenderer = threeRenderer;
    return duoEnvMap;
}

// Shared texture for the inner display's crease: a faint light/dark/light band
let duoCreaseTexture = null;

function getDuoCreaseTexture() {
    if (duoCreaseTexture) return duoCreaseTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 4;
    const ctx = canvas.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.07)');
    g.addColorStop(0.5, 'rgba(0,0,0,0.10)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.07)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 4);
    duoCreaseTexture = new THREE.CanvasTexture(canvas);
    return duoCreaseTexture;
}

// Rounded rectangle shape centred on the origin. r is a radius or per-corner
// radii { tl, tr, br, bl }.
function duoRoundedRectShape(w, h, r) {
    const R = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
    const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    const s = new THREE.Shape();
    s.moveTo(x0 + R.bl, y0);
    s.lineTo(x1 - R.br, y0);
    if (R.br > 0) s.absarc(x1 - R.br, y0 + R.br, R.br, -Math.PI / 2, 0, false);
    s.lineTo(x1, y1 - R.tr);
    if (R.tr > 0) s.absarc(x1 - R.tr, y1 - R.tr, R.tr, 0, Math.PI / 2, false);
    s.lineTo(x0 + R.tl, y1);
    if (R.tl > 0) s.absarc(x0 + R.tl, y1 - R.tl, R.tl, Math.PI / 2, Math.PI, false);
    s.lineTo(x0, y0 + R.bl);
    if (R.bl > 0) s.absarc(x0 + R.bl, y0 + R.bl, R.bl, Math.PI, Math.PI * 1.5, false);
    return s;
}

// Smooth the normals of a (non-indexed) geometry across edges sharper than
// creaseDeg degrees, so bevels and rounded corners shade smoothly while flat
// faces keep crisp edges. ExtrudeGeometry otherwise comes out faceted.
function duoSmoothNormals(geometry, creaseDeg) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.attributes.position;
    const n = pos.count;
    const faceN = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
        a.fromBufferAttribute(pos, i);
        b.fromBufferAttribute(pos, i + 1);
        c.fromBufferAttribute(pos, i + 2);
        c.sub(b);
        a.sub(b);
        c.cross(a).normalize();
        for (let k = 0; k < 3; k++) {
            faceN[(i + k) * 3] = c.x;
            faceN[(i + k) * 3 + 1] = c.y;
            faceN[(i + k) * 3 + 2] = c.z;
        }
    }
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
        const key = Math.round(pos.getX(i) * 1000) + ',' + Math.round(pos.getY(i) * 1000) + ',' + Math.round(pos.getZ(i) * 1000);
        let list = buckets.get(key);
        if (!list) buckets.set(key, list = []);
        list.push(i);
    }
    const cosT = Math.cos((creaseDeg || 40) * Math.PI / 180);
    const normals = new Float32Array(n * 3);
    buckets.forEach((list) => {
        list.forEach((i) => {
            let x = 0, y = 0, z = 0;
            const ix = faceN[i * 3], iy = faceN[i * 3 + 1], iz = faceN[i * 3 + 2];
            list.forEach((j) => {
                const jx = faceN[j * 3], jy = faceN[j * 3 + 1], jz = faceN[j * 3 + 2];
                if (ix * jx + iy * jy + iz * jz >= cosT) { x += jx; y += jy; z += jz; }
            });
            const len = Math.hypot(x, y, z) || 1;
            normals[i * 3] = x / len;
            normals[i * 3 + 1] = y / len;
            normals[i * 3 + 2] = z / len;
        });
    });
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geo;
}

// Rounded slab: a w x h rounded rectangle (outer size incl. bevel) extruded to
// `depth` along Z, centred on the origin, with a rounded edge of size `bevel`.
function duoSlab(w, h, depth, r, bevel, material, curveSegments) {
    const R = typeof r === 'number' ? { tl: r, tr: r, br: r, bl: r } : r;
    const b = Math.max(0, Math.min(bevel, depth / 2 - 0.01, w / 2 - 0.01, h / 2 - 0.01));
    const inset = (v) => Math.max(0, v - b);
    const shape = duoRoundedRectShape(w - 2 * b, h - 2 * b,
        { tl: inset(R.tl), tr: inset(R.tr), br: inset(R.br), bl: inset(R.bl) });
    const core = depth - 2 * b;
    let geo = new THREE.ExtrudeGeometry(shape, {
        depth: core,
        bevelEnabled: b > 0,
        bevelThickness: b,
        bevelSize: b,
        bevelSegments: 3,
        curveSegments: curveSegments || 8
    });
    geo.translate(0, 0, -core / 2);
    geo = duoSmoothNormals(geo, 35);
    return new THREE.Mesh(geo, material);
}

// Flat rounded-rect panel (zero thickness) facing +Z
function duoPanel(w, h, r, material) {
    const geo = new THREE.ShapeGeometry(duoRoundedRectShape(w, h, r), 10);
    return new THREE.Mesh(geo, material);
}

// Cylinder whose axis runs along Z (lenses, flash, rings)
function duoDisc(radius, height, material, segments) {
    const geo = new THREE.CylinderGeometry(radius, radius, height, segments || 40);
    geo.rotateX(Math.PI / 2);
    return new THREE.Mesh(geo, material);
}

// Fresh material set for one model instance (instances never share materials,
// so recoloring a cached side-preview model can't bleed into the main one).
// Names are what frameColorPresets['iphone-duo'] keys on.
function duoMaterials() {
    const env = getDuoEnvMap();
    const finish = frameColorPresets['iphone-duo'][0].materials;
    const make = (name, color, metalness, roughness, envMapIntensity) => {
        const m = new THREE.MeshStandardMaterial({
            color, metalness, roughness, envMap: env, envMapIntensity: envMapIntensity ?? 1
        });
        m.name = name;
        return m;
    };
    return {
        frame: make('frame', finish.frame, 0.85, 0.3, 1.2),
        spine: make('spine', finish.spine, 0.85, 0.38, 1.1),
        buttons: make('buttons', finish.buttons, 0.85, 0.28, 1.2),
        lensring: make('lensring', finish.lensring, 0.85, 0.25, 1.2),
        backpanel: make('backpanel', finish.backpanel, 0.0, 0.6, 0.3),    // frosted glass
        plateau: make('plateau', finish.plateau, 0.0, 0.12, 1.0),         // polished glass
        glass: make('glass', '#020203', 0.0, 0.06, 0.9),
        display: make('display', '#000000', 0.0, 0.04, 0.7),
        seam: make('seam', '#050506', 0.3, 0.6, 0.3),
        lens: make('lens', '#030405', 0.3, 0.05, 1.0),
        lensinner: make('lensinner', '#141a2c', 0.6, 0.2, 1.0),
        flash: make('flash', '#6f6a5c', 0.0, 0.35, 0.4),
        mic: make('mic', '#000000', 0.0, 0.8, 0.2)
    };
}

// One half of the book: titanium frame with glass on both faces, in a local
// frame where the hinge edge is at x = -halfW/2, the free edge at +halfW/2,
// the outer face at -Z and the inner (folding-display) face at +Z.
//   kind 'camera': frosted back glass, camera plateau, side/volume buttons
//   kind 'cover':  black glass carrying the outer cover display
//   opts.innerPanel: black glass on the inner face (closed model only; the open
//                    model puts one glass across both halves instead)
//   opts.coverShiftX: offset of the cover display toward the hinge, so it is
//                     centred on the whole closed device (spine included)
function duoBuildHalf(kind, mats, opts) {
    const S = DUO_SPEC;
    const w = S.halfW, h = S.open.h, t = S.halfT, b = S.frameBevel;
    const group = new THREE.Group();
    const radii = { tl: S.hingeCornerR, bl: S.hingeCornerR, tr: S.cornerR, br: S.cornerR };
    const insetRadii = (d) => ({ tl: Math.max(0.2, radii.tl - d), bl: Math.max(0.2, radii.bl - d),
                                 tr: radii.tr - d, br: radii.br - d });

    // Titanium frame body (the glass panels make up the remaining thickness)
    const glassT = 0.3, embed = 0.05;
    const bodyT = t - 2 * (glassT - embed);
    group.add(duoSlab(w, h, bodyT, radii, b, mats.frame, 10));

    // Glass panels sit on the flat part of the faces, just inside the bevel
    const gi = b + 0.1;
    const panelZ = bodyT / 2 + glassT / 2 - embed;
    const outerMat = kind === 'camera' ? mats.backpanel : mats.glass;
    const outer = duoSlab(w - 2 * gi, h - 2 * gi, glassT, insetRadii(gi), 0.12, outerMat, 10);
    outer.position.z = -panelZ;
    group.add(outer);
    if (opts.innerPanel) {
        const inner = duoSlab(w - 2 * gi, h - 2 * gi, glassT, insetRadii(gi), 0.12, mats.glass, 10);
        inner.position.z = panelZ;
        group.add(inner);
    }

    if (kind === 'cover') {
        // Cover display (switched off): a deeper black under the glass,
        // portrait like the closed device
        const disp = duoPanel(S.outerScreen.w, S.outerScreen.h, S.outerScreenR, mats.display);
        disp.rotation.y = Math.PI;  // face -Z
        disp.position.set(opts.coverShiftX || 0, 0, -(t / 2 + 0.01));
        group.add(disp);
        return group;
    }

    // Camera plateau: polished glass pill near the free edge, top, with the
    // 48MP Fusion + 48MP Ultra Wide lenses stacked vertically, flash and mic.
    const pW = 16, pH = 32, pT = 1.1, pR = 8;
    const px = w / 2 - b - 3.2 - pW / 2;
    const py = h / 2 - b - 3.2 - pH / 2;
    const backZ = -t / 2;
    const plateau = duoSlab(pW, pH, pT, pR, 0.45, mats.plateau, 14);
    plateau.position.set(px, py, backZ - pT / 2 + 0.05);
    group.add(plateau);
    const plateauZ = backZ - pT + 0.05;
    [pH / 4, -pH / 4].forEach((ly) => {
        const ring = duoDisc(6.0, 1.3, mats.lensring, 40);
        ring.position.set(px, py + ly, plateauZ - 0.65);
        group.add(ring);
        const glass = duoDisc(5.1, 0.2, mats.lens, 40);
        glass.position.set(px, py + ly, plateauZ - 1.35);
        group.add(glass);
        const elem = duoDisc(2.4, 0.1, mats.lensinner, 28);
        elem.position.set(px, py + ly, plateauZ - 1.42);
        group.add(elem);
    });
    // Flash beside the pill, mic below it
    const flash = duoDisc(2.2, 0.25, mats.flash, 28);
    flash.position.set(px - pW / 2 - 4.2, py + pH / 4, backZ - 0.1);
    group.add(flash);
    const mic = duoDisc(0.55, 0.1, mats.mic, 12);
    mic.position.set(px - pW / 2 - 4.2, py - pH / 4, backZ - 0.03);
    group.add(mic);

    // Buttons on the titanium frame: side button (Touch ID) and Camera
    // Control on the free edge, volume up/down on the top edge.
    const btnT = 2.2, btnP = 0.55;
    const side = duoSlab(btnP * 2, 19, btnT, 0.5, 0.45, mats.buttons, 6);
    side.position.set(w / 2, h / 2 - 32, 0);
    group.add(side);
    const camCtl = duoSlab(btnP * 2, 12, btnT, 0.5, 0.45, mats.buttons, 6);
    camCtl.position.set(w / 2, -h / 2 + 34, 0);
    group.add(camCtl);
    [-w / 2 + 18, -w / 2 + 31].forEach((vx) => {
        const vol = duoSlab(10, btnP * 2, btnT, 0.5, 0.45, mats.buttons, 6);
        vol.position.set(vx, h / 2, 0);
        group.add(vol);
    });
    return group;
}

// Build the iPhone Duo in millimetres. variant 'outer' = closed device seen on
// its cover display (hinge spine on the left edge); 'inner' = open device in
// portrait (hinge horizontal across the middle, camera half on top). The model
// origin is the centre of the respective display; its front faces +Z.
function buildIPhoneDuoModel(variant) {
    const S = DUO_SPEC;
    const mats = duoMaterials();
    const root = new THREE.Group();
    root.name = 'iphone-duo-' + variant;

    if (variant === 'outer') {
        const W = S.closed.w, H = S.closed.h, D = S.closed.d;
        const halfX = W / 2 - S.halfW / 2;       // halves sit against the free edge
        const halfZ = S.closedGap / 2 + S.halfT / 2;

        const back = duoBuildHalf('camera', mats, { innerPanel: true });
        back.position.set(halfX, 0, -halfZ);
        root.add(back);

        // Cover half flipped about X: its outer face (cover display) now faces
        // +Z, its hinge edge stays on the left
        const front = duoBuildHalf('cover', mats, { innerPanel: true, coverShiftX: -halfX });
        front.rotation.x = Math.PI;
        front.position.set(halfX, 0, halfZ);
        root.add(front);

        // Dark seam between the closed halves
        const seam = duoSlab(S.halfW - 2.5, H - 2.5, S.closedGap + 0.6, 6, 0, mats.seam, 6);
        seam.position.set(halfX, 0, 0);
        root.add(seam);

        // Hinge spine: rounded titanium cover along the full left edge, with
        // domed ends so the hinge-side corners read rounded
        const capH = 2.0;
        const spine = new THREE.Group();
        const spineGeo = new THREE.CylinderGeometry(1, 1, H - 2 * capH, 40, 1, true);
        spineGeo.scale(S.spineRx, 1, D / 2);
        spine.add(new THREE.Mesh(spineGeo, mats.spine));
        [1, -1].forEach((dir) => {
            const capGeo = new THREE.SphereGeometry(1, 40, 8, 0, Math.PI * 2, 0, Math.PI / 2);
            capGeo.scale(S.spineRx, capH, D / 2);
            const cap = new THREE.Mesh(capGeo, mats.spine);
            cap.position.y = dir * (H / 2 - capH);
            if (dir < 0) cap.rotation.x = Math.PI;
            spine.add(cap);
        });
        spine.position.set(-W / 2 + S.spineRx, 0, 0);
        root.add(spine);
        return root;
    }

    // Open: lay the book out in its native landscape first (cover half left,
    // camera half right, inner display facing +Z), then turn it to portrait.
    const book = new THREE.Group();
    const halfX = S.halfW / 2 + S.hingeGap / 2;

    const camHalf = duoBuildHalf('camera', mats, { innerPanel: false });
    camHalf.position.set(halfX, 0, 0);
    book.add(camHalf);

    // Cover half turned 180° about Z: hinge edge on the right, cover display
    // still on the back
    const coverHalf = duoBuildHalf('cover', mats, { innerPanel: false });
    coverHalf.rotation.z = Math.PI;
    coverHalf.position.set(-halfX, 0, 0);
    book.add(coverHalf);

    // Hinge mechanism visible in the seam from the back
    const hingeGeo = new THREE.CylinderGeometry(1, 1, S.open.h - 6, 24, 1);
    hingeGeo.scale(0.9, 1, 1.9);
    const hinge = new THREE.Mesh(hingeGeo, mats.spine);
    hinge.position.set(0, 0, -S.halfT / 2 + 2.0);
    book.add(hinge);

    // One sheet of black glass across both halves carries the inner display
    const gi = S.frameBevel + 0.1, glassT = 0.3;
    const front = duoSlab(S.open.w - 2 * gi, S.open.h - 2 * gi, glassT, S.cornerR - gi, 0.12, mats.glass, 12);
    front.position.z = S.halfT / 2 - glassT / 2;
    book.add(front);

    // Crease along the hinge, just in front of the screen overlay
    const creaseMat = new THREE.MeshBasicMaterial({
        map: getDuoCreaseTexture(), transparent: true, depthWrite: false
    });
    creaseMat.name = 'crease';
    const crease = new THREE.Mesh(new THREE.PlaneGeometry(3.0, S.innerScreen.w - 1), creaseMat);
    crease.position.z = S.halfT / 2 + S.screenLift + 0.05;
    crease.renderOrder = 2;
    book.add(crease);

    book.rotation.z = Math.PI / 2;  // landscape -> portrait, camera half on top
    root.add(book);
    return root;
}

// ===== Model loading =====

// Get the scene object for a deviceConfigs key. Procedural models are built
// synchronously — onLoad runs before this returns, which lets callers swap a
// variant mid-render — GLBs load asynchronously through GLTFLoader.
function loadDeviceSceneInto(configKey, onLoad, onError, onProgress) {
    const config = deviceConfigs[configKey] || deviceConfigs.iphone;
    if (config.build) {
        let scene;
        try {
            scene = config.build();
        } catch (error) {
            if (onError) onError(error);
            return;
        }
        onLoad(scene);
        return;
    }
    const loader = new THREE.GLTFLoader();
    loader.load(config.modelPath, (gltf) => onLoad(gltf.scene), onProgress, onError);
}

// Promise flavour of loadDeviceSceneInto → Promise<THREE.Object3D>
function loadDeviceScene(configKey) {
    return new Promise((resolve, reject) => loadDeviceSceneInto(configKey, resolve, reject));
}

// Centre and scale a freshly loaded model and hang it in a pivot group so it
// rotates around its screen centre. Note: the centering is overwritten by the
// screen offset, so screenOffset is in the model's own units from its origin.
function prepareDeviceModel(model, config) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // Center the model
    model.position.sub(center);

    // Scale to fit view (3.75 = 2.5 * 1.5 to match 2D scale at 100%)
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 3.75 / maxDim;
    model.scale.setScalar(scale);

    // Offset the model so the screen center is at the pivot's origin
    const screenOffset = config.screenOffset;
    const pivot = new THREE.Group();
    model.position.set(
        -screenOffset.x * scale,
        -screenOffset.y * scale,
        -screenOffset.z * scale
    );
    pivot.add(model);
    return { model, pivot, baseScale: scale };
}

// Screen overlay plane for a device (the model's own UV mapping may be wrong,
// so the screenshot is always shown on this plane). Added to the model.
function createScreenPlaneFor(config) {
    const planeHeight = 4.3 * config.screenHeightFactor;
    const planeWidth = planeHeight * config.aspectRatio;

    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    const material = new THREE.MeshBasicMaterial({
        color: 0x111111,
        side: THREE.DoubleSide
    });
    const plane = new THREE.Mesh(geometry, material);

    // Position at the screen center, slightly in front of the glass
    const screenOffset = config.screenOffset;
    plane.position.set(screenOffset.x, screenOffset.y, screenOffset.z);

    // Counter-rotate the screen to cancel out the model's base rotation
    // This keeps the screen facing forward when the pivot applies the base rotation
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    plane.rotation.set(
        -modelRot.x * Math.PI / 180,
        -modelRot.y * Math.PI / 180,
        -modelRot.z * Math.PI / 180
    );
    return plane;
}

// Find the front glass of a GLB model (the largest 'glass' mesh)
function findScreenMesh(model) {
    let best = null, bestArea = 0;
    model.traverse((child) => {
        if (!child.isMesh || (child.material?.name || '').toLowerCase() !== 'glass') return;
        child.geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        child.geometry.boundingBox.getSize(size);
        if (size.x * size.y > bestArea) {
            bestArea = size.x * size.y;
            best = child;
        }
    });
    return best;
}

// Install a loaded model as the main (interactive/export) model
function installMainModel(model, config) {
    const prepared = prepareDeviceModel(model, config);
    phoneModel = prepared.model;
    baseModelScale = prepared.baseScale;
    screenMesh = findScreenMesh(phoneModel);

    if (phonePivot) {
        threeScene.remove(phonePivot);
    }
    phonePivot = prepared.pivot;
    threeScene.add(phonePivot);

    // Create a custom screen plane overlay since the model's UV mapping may be incorrect
    createScreenOverlay();

    phoneModelLoaded = true;

    // Apply settings from state
    if (typeof state !== 'undefined') {
        updateThreeJSBackground();
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
        setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);

        // Apply frame color
        if (ss?.frameColor) {
            setPhoneFrameColor(ss.frameColor, currentDeviceUiType);
        }

        // Apply screenshot texture
        if (state.screenshots.length > 0) {
            updateScreenTexture();
        }

        // Refresh canvas now that model is loaded (needed for side previews too).
        // Not during slide transitions, which suppress it.
        if (typeof updateCanvas === 'function' && !window.suppressSwitchModelUpdate) {
            updateCanvas();
        }
    }
}

// Initialize Three.js scene
function initThreeJS() {
    if (isThreeJSInitialized) return;

    const container = document.getElementById('threejs-container');
    if (!container) return;

    // Create scene with a gradient background color (we'll update this dynamically)
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x667eea); // Default gradient start color

    // Create camera
    const aspect = 400 / 700;
    threeCamera = new THREE.PerspectiveCamera(35, aspect, 0.1, 1000);
    threeCamera.position.set(0, 0, 6);

    // Create renderer - disable antialiasing for faster interactive performance
    // Quality rendering is done at export time with higher resolution
    threeRenderer = new THREE.WebGLRenderer({
        antialias: false,  // Disable for better performance
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
    });
    threeRenderer.setSize(400, 700);
    // Use device pixel ratio of 1 for fastest interactive rendering
    threeRenderer.setPixelRatio(1);
    threeRenderer.outputEncoding = THREE.sRGBEncoding;
    threeRenderer.toneMapping = THREE.NoToneMapping;
    // Disable automatic clearing - we control this manually
    threeRenderer.autoClear = false;

    container.appendChild(threeRenderer.domElement);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    threeScene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(2, 3, 4);
    threeScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, 1, 2);
    threeScene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.3);
    rimLight.position.set(0, -2, -3);
    threeScene.add(rimLight);

    // Add orbit controls (disabled - we use custom drag handling for better performance)
    // orbitControls = new THREE.OrbitControls(threeCamera, threeRenderer.domElement);
    // orbitControls.enableDamping = true;
    // orbitControls.dampingFactor = 0.05;
    // orbitControls.enableZoom = false;
    // orbitControls.enablePan = false;
    // orbitControls.rotateSpeed = 0.5;
    // orbitControls.minPolarAngle = Math.PI / 4;
    // orbitControls.maxPolarAngle = Math.PI * 3 / 4;
    // orbitControls.minAzimuthAngle = -Math.PI / 3;
    // orbitControls.maxAzimuthAngle = Math.PI / 3;

    isThreeJSInitialized = true;

    // Load the phone model - check state for which device to use
    let uiType = 'iphone';
    let ss = null;
    if (typeof state !== 'undefined' && typeof getScreenshotSettings === 'function') {
        ss = getScreenshotSettings();
        if (ss?.device3D) {
            uiType = ss.device3D;
        }
    }
    currentDeviceUiType = normalize3DDeviceType(uiType);
    currentDeviceModel = resolve3DConfigKey(uiType, ss);
    loadPhoneModel();

    // Start animation loop
    animateThreeJS();
}

// Load the phone 3D model based on currentDeviceModel
function loadPhoneModel() {
    if (phoneModelLoading) return; // Prevent double loading
    phoneModelLoading = true;
    const loadGeneration = ++phoneModelLoadGeneration;

    const configKey = deviceConfigs[currentDeviceModel] ? currentDeviceModel : 'iphone';
    const config = deviceConfigs[configKey];

    loadDeviceSceneInto(
        configKey,
        (scene) => {
            if (loadGeneration !== phoneModelLoadGeneration) return;
            phoneModelLoading = false;
            installMainModel(scene, config);
            console.log('Phone model loaded successfully (' + configKey + ')');
        },
        (error) => {
            if (loadGeneration !== phoneModelLoadGeneration) return;
            phoneModelLoading = false;
            console.error('Error loading phone model:', error);
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading phone model... ' + percent + '%');
        }
    );
}

// Switch to a different phone model. deviceType is the UI device type
// (screenshot.device3D); devices with several variants (iPhone Duo inner/outer)
// are resolved against ss (default: the selected screenshot's settings), and
// the model reloads whenever the resolved variant differs from the loaded one.
function switchPhoneModel(deviceType, ss) {
    if (ss === undefined && typeof getScreenshotSettings === 'function' && typeof state !== 'undefined') {
        ss = getScreenshotSettings();
    }
    const uiType = normalize3DDeviceType(deviceType);
    const configKey = resolve3DConfigKey(deviceType, ss);

    // Not initialized yet: initThreeJS resolves the device from state itself
    if (!isThreeJSInitialized || !threeScene) {
        currentDeviceUiType = uiType;
        currentDeviceModel = configKey;
        return;
    }

    // Skip if same device and already loaded or loading
    if (currentDeviceModel === configKey && (phoneModelLoaded || phoneModelLoading)) {
        currentDeviceUiType = uiType;
        return;
    }

    // Update current device type
    currentDeviceModel = configKey;
    currentDeviceUiType = uiType;
    phoneModelLoading = true;
    const loadGeneration = ++phoneModelLoadGeneration;

    // Remove current pivot (which contains the model) from scene
    if (phonePivot && threeScene) {
        threeScene.remove(phonePivot);
        phonePivot.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                child.material?.dispose();
            }
        });
        phonePivot = null;
        phoneModel = null;
    }

    // Clean up screen plane
    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry?.dispose();
        customScreenPlane.material?.dispose();
        customScreenPlane = null;
    }

    screenMesh = null;
    phoneModelLoaded = false;

    // Load new model using the config
    const config = deviceConfigs[configKey];

    loadDeviceSceneInto(
        configKey,
        (scene) => {
            if (loadGeneration !== phoneModelLoadGeneration) return;
            phoneModelLoading = false;
            installMainModel(scene, config);
            console.log(configKey + ' model loaded successfully');
        },
        (error) => {
            if (loadGeneration !== phoneModelLoadGeneration) return;
            phoneModelLoading = false;
            console.error('Error loading ' + configKey + ' model:', error);
        },
        (progress) => {
            const percent = Math.round(progress.loaded / progress.total * 100);
            console.log('Loading ' + configKey + ' model... ' + percent + '%');
        }
    );
}

// Re-resolve the current device's variant (e.g. after the output size changed
// from the iPhone Duo outer display to the inner one) and reload if needed
function refresh3DDeviceVariant() {
    if (!isThreeJSInitialized) return;
    switchPhoneModel(currentDeviceUiType);
}

// Load a phone model into the cache (for side preview rendering with different
// devices). deviceType is a config key or a UI type (resolved against ss).
// Procedural models are cached synchronously.
function loadCachedPhoneModel(deviceType, ss) {
    const configKey = resolve3DConfigKey(deviceType, ss);
    const config = deviceConfigs[configKey];

    // Already loaded or loading
    if (phoneModelCache[configKey]?.loaded) {
        return Promise.resolve(phoneModelCache[configKey]);
    }
    if (phoneModelCache[configKey]?.loading) {
        return phoneModelCache[configKey].loadingPromise;
    }

    phoneModelCache[configKey] = { loading: true, loaded: false };

    const loadingPromise = new Promise((resolve, reject) => {
        loadDeviceSceneInto(
            configKey,
            (scene) => {
                const prepared = prepareDeviceModel(scene, config);

                // Create screen plane for this model
                const screenPlane = createScreenPlaneFor(config);
                prepared.model.add(screenPlane);

                phoneModelCache[configKey] = {
                    model: prepared.model,
                    pivot: prepared.pivot,
                    screenPlane: screenPlane,
                    baseScale: prepared.baseScale,
                    loaded: true,
                    loading: false
                };

                console.log('Cached ' + configKey + ' model for side previews');
                resolve(phoneModelCache[configKey]);
            },
            (error) => {
                console.error('Error loading cached ' + configKey + ' model:', error);
                phoneModelCache[configKey] = { loading: false, loaded: false };
                reject(error);
            }
        );
    });
    // A procedural build has already replaced the entry with the loaded one
    if (phoneModelCache[configKey].loading) {
        phoneModelCache[configKey].loadingPromise = loadingPromise;
    }
    return loadingPromise;
}

// Preload all device models for side previews
function preloadAllPhoneModels() {
    const configKeys = Object.keys(deviceConfigs);
    return Promise.all(configKeys.map(key => loadCachedPhoneModel(key).catch(() => null)));
}

// Create a custom screen plane overlay with correct UV mapping
function createScreenOverlay() {
    if (customScreenPlane) {
        if (customScreenPlane.parent) {
            customScreenPlane.parent.remove(customScreenPlane);
        }
        customScreenPlane.geometry.dispose();
        customScreenPlane.material.dispose();
    }

    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    customScreenPlane = createScreenPlaneFor(config);

    // Add directly to phoneModel so it moves with it
    phoneModel.add(customScreenPlane);

    // basePositionOffset is no longer needed since we use pivot-based rotation
    basePositionOffset.y = 0;
}

// Create a rounded corner version of the screenshot
function createRoundedScreenImage(image, cornerRadius) {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');

    // Draw rounded rectangle path
    const w = canvas.width;
    const h = canvas.height;
    const r = cornerRadius;

    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(w - r, 0);
    ctx.quadraticCurveTo(w, 0, w, r);
    ctx.lineTo(w, h - r);
    ctx.quadraticCurveTo(w, h, w - r, h);
    ctx.lineTo(r, h);
    ctx.quadraticCurveTo(0, h, 0, h - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();

    // Clip to rounded rectangle and draw image
    ctx.clip();
    ctx.drawImage(image, 0, 0);

    return canvas;
}

// Update the screen texture with current screenshot
function updateScreenTexture() {
    if (!phoneModel) return;
    if (typeof state === 'undefined' || !state.screenshots.length) return;

    const screenshot = state.screenshots[state.selectedIndex];
    // Use getScreenshotImage() for localized image support
    const screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    if (!screenshot || !screenshotImage) return;

    // Create texture from screenshot
    if (screenTexture) {
        screenTexture.dispose();
    }

    // Create rounded corner version of the image using device-specific corner radius
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const cornerRadius = Math.round(screenshotImage.width * config.cornerRadiusFactor);
    const roundedImage = createRoundedScreenImage(screenshotImage, cornerRadius);

    // Bake the notch / Dynamic Island onto the 3D screen texture so it follows
    // the model (the 2D notch options also apply in 3D).
    const notch = screenshot.screenshot && screenshot.screenshot.frame && screenshot.screenshot.frame.notch;
    if (notch && notch !== 'none' && typeof drawNotchShape === 'function') {
        try {
            const nctx = roundedImage.getContext('2d');
            drawNotchShape(nctx, 0, 0, roundedImage.width, roundedImage.height, cornerRadius, notch);
        } catch (e) { /* ignore */ }
    }

    screenTexture = new THREE.Texture(roundedImage);
    screenTexture.needsUpdate = true;
    screenTexture.encoding = THREE.sRGBEncoding;
    screenTexture.flipY = true;

    // Create a material for the screen with transparency for rounded corners
    const screenMaterial = new THREE.MeshBasicMaterial({
        map: screenTexture,
        side: THREE.FrontSide,
        transparent: true
    });

    // Apply to custom screen plane (preferred)
    if (customScreenPlane) {
        customScreenPlane.material.dispose();
        customScreenPlane.material = screenMaterial;
        console.log('Applied rounded texture to custom screen plane');
    }

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D rotation from sliders (in degrees)
function setThreeJSRotation(rotX, rotY, rotZ) {
    if (!phonePivot) return;

    // Add the device's base model rotation to the user's rotation
    const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };

    console.log('setThreeJSRotation:', currentDeviceModel, 'modelRot:', modelRot, 'user:', rotX, rotY, rotZ);

    // Rotate the pivot (which rotates around the screen center)
    phonePivot.rotation.x = (rotX + modelRot.x) * Math.PI / 180;
    phonePivot.rotation.y = (rotY + modelRot.y) * Math.PI / 180;
    phonePivot.rotation.z = (rotZ + modelRot.z) * Math.PI / 180;

    // Trigger render update
    requestThreeJSRender();
}

// Set 3D scale
function setThreeJSScale(scale) {
    if (!phoneModel) return;

    phoneModel.scale.setScalar(baseModelScale * (scale / 100));

    // Trigger render update
    requestThreeJSRender();
}

// Render on demand instead of continuous animation loop
let renderRequested = false;

function requestThreeJSRender() {
    if (renderRequested) return;
    renderRequested = true;
    requestAnimationFrame(() => {
        renderRequested = false;
        if (threeRenderer && threeScene && threeCamera) {
            threeRenderer.clear();
            threeRenderer.render(threeScene, threeCamera);
        }
    });
}

// Legacy function name for compatibility - now triggers on-demand render
function animateThreeJS() {
    requestThreeJSRender();
}

// Render 3D phone only (with transparent background) to be composited
function renderThreeJSToCanvas(targetCanvas, width, height) {
    if (!threeRenderer || !threeScene || !threeCamera) return;

    // The selected screenshot may now need another variant of a procedural
    // device (e.g. the output size moved from the iPhone Duo outer display to
    // the inner one). Those build synchronously, so swap before rendering.
    if (typeof state !== 'undefined' && typeof getScreenshotSettings === 'function') {
        const cur = getScreenshotSettings();
        const wantKey = resolve3DConfigKey(cur?.device3D || 'iphone', cur);
        if (wantKey !== currentDeviceModel && deviceConfigs[wantKey].build) {
            switchPhoneModel(cur.device3D, cur);
        }
    }
    if (!phonePivot) return;

    const dims = { width: width || 1290, height: height || 2796 };

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = phonePivot.position.clone();
    const originalScale = phonePivot.scale.clone();
    const originalRotation = phonePivot.rotation.clone();

    // Apply position, scale, and rotation from screenshot settings
    if (typeof state !== 'undefined') {
        // Use getScreenshotSettings() helper if available, otherwise fall back to defaults
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (ss) {
            // Scale: use screenshot.scale to adjust model size
            const screenshotScale = ss.scale / 100;
            phonePivot.scale.setScalar(screenshotScale);

            // Position: match 2D behavior where available space depends on (1 - scale)
            // This ensures same percentages look the same in 2D and 3D
            // X uses smaller factor (1.1) since canvas is taller than wide (400x700 aspect)
            const availableSpaceY = (1 - screenshotScale) * 2;
            const availableSpaceX = (1 - screenshotScale) * 0.9;
            const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
            const yOffset = -((ss.y - 50) / 50) * availableSpaceY; // Inverted for 3D
            phonePivot.position.set(
                xOffset + basePositionOffset.x,
                yOffset + basePositionOffset.y,
                basePositionOffset.z
            );

            // Rotation: apply 3D rotation from current screenshot settings + model base rotation
            const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
            const config = deviceConfigs[currentDeviceModel] || deviceConfigs.iphone;
            const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
            phonePivot.rotation.set(
                (rotation3D.x + modelRot.x) * Math.PI / 180,
                (rotation3D.y + modelRot.y) * Math.PI / 180,
                (rotation3D.z + modelRot.z) * Math.PI / 180
            );
        }
    }

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer - render at 2x for supersampled antialiasing
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width * 2, dims.height * 2);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Downscale to target canvas (compositing the 3D phone onto existing content)
    const ctx = targetCanvas.getContext('2d');
    const prevSmoothing = ctx.imageSmoothingEnabled;
    const prevQuality = ctx.imageSmoothingQuality;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);
    ctx.imageSmoothingEnabled = prevSmoothing;
    ctx.imageSmoothingQuality = prevQuality;

    // Restore size, background, and model transforms
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    phonePivot.position.copy(originalPosition);
    phonePivot.scale.copy(originalScale);
    phonePivot.rotation.copy(originalRotation);
}

// Render 3D for a specific screenshot index (used for side previews)
function renderThreeJSForScreenshot(targetCanvas, width, height, screenshotIndex) {
    if (!threeRenderer || !threeScene || !threeCamera) return;
    if (typeof state === 'undefined' || !state.screenshots[screenshotIndex]) return;

    const screenshot = state.screenshots[screenshotIndex];
    const ss = screenshot.screenshot;
    const dims = { width: width || 1290, height: height || 2796 };

    // Determine which device model (config key) this screenshot uses
    const screenshotDeviceType = normalize3DDeviceType(ss.device3D || 'iphone');
    const configKey = resolve3DConfigKey(ss.device3D || 'iphone', ss);
    const config = deviceConfigs[configKey];

    // Check if this screenshot uses the same device as currently active
    const useCurrentModel = configKey === currentDeviceModel && phonePivot;

    // Get the model to use (either current or from cache)
    let pivotToUse, screenPlaneToUse;

    if (useCurrentModel) {
        // Use the currently loaded model
        pivotToUse = phonePivot;
        screenPlaneToUse = customScreenPlane;
    } else {
        // Use cached model for different device
        let cached = phoneModelCache[configKey];
        if (!cached?.loaded && config.build) {
            // Procedural models cache synchronously - no need to skip a frame
            loadCachedPhoneModel(configKey).catch(() => null);
            cached = phoneModelCache[configKey];
        }
        if (!cached?.loaded) {
            // Model not cached yet - trigger loading and skip this render
            loadCachedPhoneModel(configKey).then(() => {
                // Trigger a re-render once model is loaded
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            }).catch(() => null);
            return;
        }
        pivotToUse = cached.pivot;
        screenPlaneToUse = cached.screenPlane;

        // Add cached pivot to scene temporarily
        threeScene.add(pivotToUse);
    }

    // Store original values
    const originalBackground = threeScene.background;
    const originalPosition = pivotToUse.position.clone();
    const originalScale = pivotToUse.scale.clone();
    const originalRotation = pivotToUse.rotation.clone();

    // Hide the current model if we're using a different one
    if (!useCurrentModel && phonePivot) {
        phonePivot.visible = false;
    }

    // Temporarily update screen texture for this screenshot
    // Use getScreenshotImage() for localized image support
    const screenshotImage = typeof getScreenshotImage === 'function'
        ? getScreenshotImage(screenshot)
        : screenshot?.image;
    const oldMaterial = screenPlaneToUse ? screenPlaneToUse.material : null;
    if (screenshotImage && screenPlaneToUse) {
        const cornerRadius = Math.round(screenshotImage.width * config.cornerRadiusFactor);
        const roundedImage = createRoundedScreenImage(screenshotImage, cornerRadius);
        const newTexture = new THREE.Texture(roundedImage);
        newTexture.needsUpdate = true;
        newTexture.encoding = THREE.sRGBEncoding;
        newTexture.flipY = true;

        const newMaterial = new THREE.MeshBasicMaterial({
            map: newTexture,
            side: THREE.FrontSide,
            transparent: true
        });
        screenPlaneToUse.material = newMaterial;
    }

    // Apply frame color for this screenshot
    const savedMaterialColors = [];
    if (ss.frameColor) {
        if (useCurrentModel) {
            if (phoneModel) {
                phoneModel.traverse((child) => {
                    if (child.isMesh && child.material?.color) {
                        savedMaterialColors.push({ material: child.material, color: child.material.color.clone() });
                    }
                });
            }
            setPhoneFrameColor(ss.frameColor, screenshotDeviceType);
        } else {
            setCachedModelFrameColor(ss.frameColor, configKey);
        }
    } else if (!useCurrentModel && config.build) {
        // Cached procedural models keep the last colors applied to them; reset to the default finish
        setCachedModelFrameColor(null, configKey);
    }

    // Apply rotation for this screenshot + model base rotation
    const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
    const modelRot = config.modelRotation || { x: 0, y: 0, z: 0 };
    pivotToUse.rotation.set(
        (rotation3D.x + modelRot.x) * Math.PI / 180,
        (rotation3D.y + modelRot.y) * Math.PI / 180,
        (rotation3D.z + modelRot.z) * Math.PI / 180
    );

    // Apply scale and position (matching 2D behavior)
    const screenshotScale = ss.scale / 100;
    pivotToUse.scale.setScalar(screenshotScale);
    const availableSpaceY = (1 - screenshotScale) * 2;
    const availableSpaceX = (1 - screenshotScale) * 0.9;
    const xOffset = ((ss.x - 50) / 50) * availableSpaceX;
    const yOffset = -((ss.y - 50) / 50) * availableSpaceY;
    pivotToUse.position.set(
        xOffset + basePositionOffset.x,
        yOffset + basePositionOffset.y,
        basePositionOffset.z
    );

    // Set transparent background for compositing
    threeScene.background = null;
    threeRenderer.setClearColor(0x000000, 0); // Fully transparent clear color

    // Temporarily resize renderer
    const oldSize = { width: 400, height: 700 };
    threeRenderer.setSize(dims.width, dims.height);
    threeCamera.aspect = dims.width / dims.height;
    threeCamera.updateProjectionMatrix();

    // Clear the renderer before drawing (ensures clean transparency)
    threeRenderer.clear();

    // Render with transparency
    threeRenderer.render(threeScene, threeCamera);

    // Draw to target canvas (composite 3D phone onto existing background)
    const ctx = targetCanvas.getContext('2d');
    ctx.drawImage(threeRenderer.domElement, 0, 0, dims.width, dims.height);

    // Restore everything
    threeRenderer.setSize(oldSize.width, oldSize.height);
    threeCamera.aspect = oldSize.width / oldSize.height;
    threeCamera.updateProjectionMatrix();
    threeScene.background = originalBackground;
    pivotToUse.position.copy(originalPosition);
    pivotToUse.scale.copy(originalScale);
    pivotToUse.rotation.copy(originalRotation);

    // Restore original material
    if (oldMaterial && screenPlaneToUse) {
        // Dispose the temporary material
        if (screenPlaneToUse.material !== oldMaterial) {
            screenPlaneToUse.material.map?.dispose();
            screenPlaneToUse.material.dispose();
        }
        screenPlaneToUse.material = oldMaterial;
    }

    // Restore original frame colors on current model if we changed them
    savedMaterialColors.forEach(({ material, color }) => {
        material.color.copy(color);
    });

    // Clean up: remove cached model from scene and restore current model visibility
    if (!useCurrentModel) {
        threeScene.remove(pivotToUse);
        if (phonePivot) {
            phonePivot.visible = true;
        }
    }
}

// Show/hide Three.js container
function showThreeJS(show) {
    const container = document.getElementById('threejs-container');
    const canvas = document.getElementById('preview-canvas');

    // In 3D mode, we show the 2D canvas (which composites everything)
    // The Three.js container is hidden but used for rendering
    if (container) {
        container.style.display = 'none'; // Always hidden - we render to 2D canvas
    }
    if (canvas) {
        canvas.style.display = 'block'; // Always visible
    }

    if (show && !isThreeJSInitialized) {
        initThreeJS();
    }

    // Apply current rotation and background
    if (show && typeof state !== 'undefined') {
        updateThreeJSBackground();
        if (phoneModel) {
            const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
            const rotation3D = ss?.rotation3D || { x: 0, y: 0, z: 0 };
            setThreeJSRotation(rotation3D.x, rotation3D.y, rotation3D.z);
            updateScreenTexture();
        }
    }
}

// Get Three.js canvas for export
function getThreeJSCanvas() {
    return threeRenderer ? threeRenderer.domElement : null;
}

// Update Three.js scene background from state
function updateThreeJSBackground() {
    if (!threeScene || typeof state === 'undefined') return;

    // Use getBackground() helper if available, otherwise fall back to defaults
    const bg = typeof getBackground === 'function' ? getBackground() : state.defaults?.background;
    if (!bg) return;

    if (bg.type === 'solid') {
        threeScene.background = new THREE.Color(bg.solid);
    } else if (bg.type === 'gradient') {
        // Use the first gradient color as background (Three.js doesn't support gradients natively)
        const firstStop = bg.gradient.stops[0];
        if (firstStop) {
            threeScene.background = new THREE.Color(firstStop.color);
        }
    } else {
        // For image backgrounds, use a neutral color
        threeScene.background = new THREE.Color(0x1a1a2e);
    }

    // Trigger render update
    requestThreeJSRender();
}

// Cleanup
function disposeThreeJS() {
    phoneModelLoadGeneration++;
    if (screenTexture) {
        screenTexture.dispose();
        screenTexture = null;
    }
    if (threeScene) {
        threeScene.traverse((child) => {
            if (child.isMesh) {
                child.geometry?.dispose();
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach((material) => {
                    if (!material) return;
                    material.map?.dispose();
                    material.dispose();
                });
            }
        });
    }
    if (threeRenderer) {
        threeRenderer.dispose();
        if (threeRenderer.domElement?.parentNode) {
            threeRenderer.domElement.parentNode.removeChild(threeRenderer.domElement);
        }
    }
    threeRenderer = null;
    threeScene = null;
    threeCamera = null;
    phonePivot = null;
    phoneModel = null;
    customScreenPlane = null;
    screenMesh = null;
    // Cached models and the Duo environment map belong to the old renderer
    phoneModelCache = {};
    duoEnvMap = null;
    duoEnvMapRenderer = null;
    isThreeJSInitialized = false;
    phoneModelLoaded = false;
    phoneModelLoading = false;
}

// Interactive rotation/movement for 2D canvas in 3D mode
let isDragging3D = false;
let isAltDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let dragUpdatePending = false;

function getUse3D() {
    if (typeof getScreenshotSettings === 'function') {
        const ss = getScreenshotSettings();
        return ss?.use3D || false;
    }
    return state.defaults?.screenshot?.use3D || false;
}

function setup3DCanvasInteraction() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousedown', (e) => {
        if (typeof state !== 'undefined' && getUse3D()) {
            isDragging3D = true;
            isAltDragging = e.altKey;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            canvas.style.cursor = isAltDragging ? 'move' : 'grabbing';
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging3D || typeof state === 'undefined' || !getUse3D()) return;
        // Don't rotate 3D device while dragging an element
        const wrapper = document.getElementById('canvas-wrapper');
        if (wrapper && wrapper.classList.contains('element-dragging')) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = '';
            return;
        }

        const deltaX = e.clientX - lastMouseX;
        const deltaY = e.clientY - lastMouseY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;

        // Get current screenshot settings
        const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : state.defaults?.screenshot;
        if (!ss) return;

        if (isAltDragging) {
            // Alt+drag: move position (x, y)
            ss.x = Math.max(0, Math.min(100, ss.x + deltaX * 0.2));
            ss.y = Math.max(0, Math.min(100, ss.y + deltaY * 0.2));

            // Update sliders
            document.getElementById('screenshot-x').value = ss.x;
            document.getElementById('screenshot-x-value').textContent = Math.round(ss.x) + '%';
            document.getElementById('screenshot-y').value = ss.y;
            document.getElementById('screenshot-y-value').textContent = Math.round(ss.y) + '%';
        } else {
            // Regular drag: rotate
            if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };

            ss.rotation3D.y = Math.max(-90, Math.min(90, ss.rotation3D.y + deltaX * 0.5));
            ss.rotation3D.x = Math.max(-90, Math.min(90, ss.rotation3D.x + deltaY * 0.5));

            // Update sliders
            document.getElementById('rotation-3d-y').value = ss.rotation3D.y;
            document.getElementById('rotation-3d-y-value').textContent = Math.round(ss.rotation3D.y) + '°';
            document.getElementById('rotation-3d-x').value = ss.rotation3D.x;
            document.getElementById('rotation-3d-x-value').textContent = Math.round(ss.rotation3D.x) + '°';

            // Apply rotation directly to model (fast path - skip full updateCanvas)
            setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
        }

        // Throttle updateCanvas calls using requestAnimationFrame
        if (!dragUpdatePending) {
            dragUpdatePending = true;
            requestAnimationFrame(() => {
                dragUpdatePending = false;
                if (typeof updateCanvas === 'function') {
                    updateCanvas();
                }
            });
        }
    });

    canvas.addEventListener('mouseup', () => {
        if (isDragging3D) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = getUse3D() ? 'grab' : '';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDragging3D) {
            isDragging3D = false;
            isAltDragging = false;
            canvas.style.cursor = '';
        }
    });

    // Change cursor when hovering in 3D mode
    canvas.addEventListener('mouseenter', () => {
        if (typeof state !== 'undefined' && getUse3D()) {
            canvas.style.cursor = 'grab';
        }
    });
}

// Initialize interaction when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup3DCanvasInteraction);
} else {
    setup3DCanvasInteraction();
}
