import * as THREE from 'three';
import { KTX2Loader } from './vendor/loaders/KTX2Loader.js';

/* =====================================================================
   SETTINGS — the numbers you are most likely to tweak
   ===================================================================== */

// Text that appears while scrolling. `from` / `to` are scroll progress (0–1).
const CAPTIONS = [
  { from: 0.00, to: 0.20, text: 'Above the clouds', sub: 'Placeholder line one' },
  { from: 0.26, to: 0.50, text: 'Coming down through the sky', sub: 'Placeholder line two' },
  { from: 0.56, to: 0.80, text: 'The city comes into view', sub: 'Placeholder line three' },
];

const HERO_SCROLL_VH = 110;     // scrolling it takes to slide the hero away
const SCROLL_LENGTH_VH = 368;   // how much "scrolling" the cloud fly-through takes
const MOBILE_SCROLL_FACTOR = 0.7;
const MOBILE_WIDTH = 768;

const FOV_DESKTOP = 30;
const FOV_MOBILE = 40;

const MAP_Z = -40;              // the map sits this far from the camera
const MAP_ZOOM_END = 1.45;      // how much the map grows as you descend
const MAP_OVERSCAN = 1.15;      // extra map around the edges so camera tilt never shows a gap
const HAZE_START = 0.42;        // blue haze over the map at the top, clears as you descend
const HAZE_COLOR = new THREE.Color(0x9fcdf2);
const SKY_COLOR = new THREE.Color(0xcfe6f8);

const SHADOW_BASE = 0.15;       // cloud shadow strength on the map while flying
const SHADOW_END = 0.5;         // …and once you have landed
const SHADOW_SPEED = 0.05;      // how fast the shadows slide sideways
const SHADOW_TILING = 2.4;

const TILT = 0.035;             // camera tilt (radians) from mouse / phone tilt

/* ---------- cloud atlas: where each cloud sits in the 2048 grid ---------- */
const ATLAS = 2048;
const rect = (x, y, w, h) => ({
  offset: [x / ATLAS, 1 - (y + h) / ATLAS],
  scale: [w / ATLAS, h / ATLAS],
  aspect: w / h,
});

const CLOUD_SPRITES = [
  rect(0, 0, 1019, 570),
  rect(1028, 0, 1020, 569),
  rect(0, 584, 973, 377),
  rect(928, 1076, 1120, 411),
  rect(0, 1487, 973, 515),
  rect(1053, 1497, 995, 505),
];
const SHADOW_SPRITE = { x: 1170, y: 581, w: 878, h: 483 };

/* ---------- cloud depth layers: far layers hold bigger clouds ---------- */
const LAYERS = [
  { z: -1.5, count: 1,  scaleMin: 1.5, scaleMax: 2.6 },
  { z: -3,   count: 3,  scaleMin: 2.2, scaleMax: 3.8 },
  { z: -5,   count: 5,  scaleMin: 2.8, scaleMax: 5 },
  { z: -7,   count: 8,  scaleMin: 3.6, scaleMax: 6.2 },
  { z: -9.5, count: 12, scaleMin: 4.4, scaleMax: 7.4 },
  { z: -12,  count: 24, scaleMin: 5.2, scaleMax: 8.6 },
  { z: -15,  count: 26, scaleMin: 6,   scaleMax: 9.8 },
  { z: -18,  count: 27, scaleMin: 7,   scaleMax: 11 },
  { z: -21,  count: 27, scaleMin: 8,   scaleMax: 12.5 },
  { z: -24,  count: 25, scaleMin: 9,   scaleMax: 14 },
  { z: -27.5, count: 22, scaleMin: 10, scaleMax: 15.5 },
  { z: -31,  count: 18, scaleMin: 11,  scaleMax: 17 },
  { z: -34,  count: 15, scaleMin: 12,  scaleMax: 18.5 },
  { z: -37,  count: 12, scaleMin: 13,  scaleMax: 20 },
  { z: -40,  count: 10, scaleMin: 14,  scaleMax: 21.5 },
  { z: -43,  count: 8,  scaleMin: 15,  scaleMax: 23 },
  { z: -46,  count: 6,  scaleMin: 16,  scaleMax: 24.5 },
];

const CLOUD = {
  spreadX: 0.55,        // how wide clouds spread, per unit of depth
  spreadY: 0.42,
  travel: 30,           // how far the clouds come toward you over the full scroll
  startPush: 6,         // everything starts this much further away
  wrapPad: 6,           // loop is (depth + this) wide on each side — always wider than the screen
  driftSpeed: 1.2,      // sideways drift, units per second
  driftBoost: 3,        // extra drift while scrolling fast
  velocityEase: 0.08,
  parallax: 0.08,       // far clouds drift slower
  edgeFade: 0.35,
  endFadeFrom: 0.9,     // all clouds fade out over the last 10% of the scroll
  nearFadeStart: -2,    // fade out just before hitting the camera
  nearFadeEnd: -0.3,
  farFadeStart: -62,    // fade in from far away
  farFadeEnd: -10,
  bobAmp: [0.2, 0.6],
  bobFreq: [0.25, 0.7],
};

/* =====================================================================
   HELPERS
   ===================================================================== */
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => t * t * (3 - 2 * t);
const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
const rand = (a, b) => a + Math.random() * (b - a);
const isMobile = () => window.innerWidth <= MOBILE_WIDTH;

/* =====================================================================
   CLOUD LAYER
   A fixed set of flat cloud cards. Nothing is ever spawned or removed:
   sideways position is computed with modulo from one drift counter, so
   the sky can never empty out. Forward motion comes from scroll progress.
   ===================================================================== */
const CLOUD_VERT = /* glsl */ `
  attribute float aOpacity;
  varying float vOpacity;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vOpacity = aOpacity;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */ `
  precision mediump float;
  uniform sampler2D uTexture;
  uniform vec2 uTexOffset;
  uniform vec2 uTexScale;
  varying float vOpacity;
  varying vec2 vUv;
  void main() {
    // crop the big atlas down to this one cloud
    vec2 atlasUv = vUv * uTexScale + uTexOffset;
    vec4 c = texture2D(uTexture, atlasUv);   // premultiplied (see softenAtlas)

    // feather the card's own border so a hard rectangle edge can never show
    float border = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x)
                 * smoothstep(0.0, 0.08, vUv.y) * smoothstep(1.0, 0.92, vUv.y);
    float a = c.a * vOpacity * border;

    // un-premultiply for the colour conversion, then premultiply again for blending
    gl_FragColor = vec4(c.rgb / max(c.a, 0.0001), a);
    #include <colorspace_fragment>
    gl_FragColor.rgb *= gl_FragColor.a;
  }
`;

/* ---------------------------------------------------------------------
   softenAtlas
   The KTX2 file has a single mip level, and compressed textures can't
   build mipmaps themselves. Without mipmaps, small far-away clouds
   sample only a few pixels each, which makes grainy, jagged edges.
   Fix: copy the atlas once into a normal GPU texture, premultiplying
   alpha on the way (stops dark/bright fringes around the soft edges),
   then build a full mipmap chain from it.
   --------------------------------------------------------------------- */
function softenAtlas(renderer, source) {
  const w = source.image?.width || source.mipmaps?.[0]?.width || 1024;
  const h = source.image?.height || source.mipmaps?.[0]?.height || 1024;

  const target = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,       // 8-bit sRGB storage: no banding in soft greys
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  target.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: { uTex: { value: source } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec2 vUv;
        void main(){
          vec4 c = texture2D(uTex, vUv);
          gl_FragColor = vec4(c.rgb * c.a, c.a);
        }`,
      blending: THREE.NoBlending,
      depthTest: false,
      depthWrite: false,
    }),
  );
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();

  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setRenderTarget(target);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, cam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);

  quad.geometry.dispose();
  quad.material.dispose();
  return target.texture;
}

class CloudLayer {
  constructor(texture, sprites, fov, aspect) {
    this.group = new THREE.Group();
    this.tanHalfFov = Math.tan((fov * Math.PI) / 360);
    this.aspect = aspect;
    this.drift = 5 * CLOUD.driftSpeed;
    this.lastProgress = 0;
    this.velocity = 0;
    this.time = 0;

    this.geometry = new THREE.PlaneGeometry(1, 1);
    this.clouds = [];
    const perSprite = sprites.map(() => []);

    for (const layer of LAYERS) {
      for (let i = 0; i < layer.count; i++) {
        const spriteIdx = Math.floor(Math.random() * sprites.length);
        const z = layer.z + (Math.random() - 0.5) * 2;
        const depth = Math.abs(z);
        const size = rand(layer.scaleMin, layer.scaleMax);
        this.clouds.push({
          baseX: (Math.random() * 2 - 1) * CLOUD.spreadX * depth,
          baseY: (Math.random() * 2 - 1) * CLOUD.spreadY * depth,
          baseZ: z,
          scaleX: size,
          scaleY: size / sprites[spriteIdx].aspect,
          rotZ: (Math.random() - 0.5) * 0.5,
          bobPhase: Math.random() * Math.PI * 2,
          bobFreq: rand(...CLOUD.bobFreq),
          bobAmp: rand(...CLOUD.bobAmp),
          wrapHalf: depth + CLOUD.wrapPad,
          parallax: 1 / (depth * CLOUD.parallax + 1),
          spriteIdx,
          instanceIdx: -1,
        });
        perSprite[spriteIdx].push(this.clouds.length - 1);
      }
    }

    // one instanced mesh per cloud picture — 6 draw calls for ~250 clouds
    this.meshes = [];
    sprites.forEach((sprite, s) => {
      const ids = perSprite[s];
      if (!ids.length) { this.meshes.push(null); return; }

      const geo = new THREE.InstancedBufferGeometry();
      geo.index = this.geometry.index;
      geo.attributes.position = this.geometry.attributes.position;
      geo.attributes.uv = this.geometry.attributes.uv;
      const opacity = new THREE.InstancedBufferAttribute(new Float32Array(ids.length).fill(1), 1);
      opacity.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aOpacity', opacity);

      const material = new THREE.ShaderMaterial({
        vertexShader: CLOUD_VERT,
        fragmentShader: CLOUD_FRAG,
        uniforms: {
          uTexture: { value: texture },
          uTexOffset: { value: new THREE.Vector2(...sprite.offset) },
          uTexScale: { value: new THREE.Vector2(...sprite.scale) },
        },
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.InstancedMesh(geo, material, ids.length);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = 10;
      ids.forEach((cloudIdx, i) => { this.clouds[cloudIdx].instanceIdx = i; });
      this.group.add(mesh);
      this.meshes.push({ mesh, opacity });
    });

    this._pos = new THREE.Vector3();
    this._quat = new THREE.Quaternion();
    this._scale = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._euler = new THREE.Euler();
  }

  resize(fov, aspect) {
    this.tanHalfFov = Math.tan((fov * Math.PI) / 360);
    this.aspect = aspect;
  }

  update(dt, progress) {
    const p = clamp(progress, 0, 1);

    // scrolling fast makes the clouds drift faster for a moment
    const rawVelocity = dt > 0 ? (p - this.lastProgress) / dt : 0;
    this.lastProgress = p;
    this.velocity = lerp(this.velocity, rawVelocity, CLOUD.velocityEase);
    this.drift += (CLOUD.driftSpeed + this.velocity * CLOUD.driftBoost) * dt;
    this.time += dt;

    const forward = smooth(p) * CLOUD.travel;
    const endFade = p > CLOUD.endFadeFrom ? 1 - (p - CLOUD.endFadeFrom) / (1 - CLOUD.endFadeFrom) : 1;
    const endFade2 = endFade * endFade;

    for (const c of this.clouds) {
      const bob = c.bobAmp * Math.sin(this.time * c.bobFreq + c.bobPhase);
      const z = c.baseZ - CLOUD.startPush + forward + bob;

      // sideways: wrap with modulo so the cloud loops forever, off screen
      const range = c.wrapHalf * 2;
      const x = ((((c.baseX + this.drift * c.parallax + c.wrapHalf) % range) + range) % range) - c.wrapHalf;
      const y = c.baseY;

      // fade in from far away, fade out just before the camera
      let depthFade;
      if (z >= CLOUD.nearFadeEnd) depthFade = 0;
      else if (z >= CLOUD.nearFadeStart) depthFade = (CLOUD.nearFadeEnd - z) / (CLOUD.nearFadeEnd - CLOUD.nearFadeStart);
      else if (z <= CLOUD.farFadeStart) depthFade = 0;
      else if (z <= CLOUD.farFadeEnd) depthFade = (z - CLOUD.farFadeStart) / (CLOUD.farFadeEnd - CLOUD.farFadeStart);
      else depthFade = 1;

      // fade near the screen edges so the wrap is never seen
      const halfH = this.tanHalfFov * Math.max(0.5, Math.abs(z));
      const halfW = halfH * this.aspect;
      const padW = halfW * CLOUD.edgeFade;
      const padH = halfH * CLOUD.edgeFade;
      const edge =
        clamp((halfW + padW - Math.abs(x)) / padW, 0, 1) *
        clamp((halfH + padH - Math.abs(y)) / padH, 0, 1);

      this._pos.set(x, y, z);
      this._euler.set(0, 0, c.rotZ);
      this._quat.setFromEuler(this._euler);
      this._scale.set(c.scaleX, c.scaleY, 1);
      this._mat.compose(this._pos, this._quat, this._scale);

      const g = this.meshes[c.spriteIdx];
      g.mesh.setMatrixAt(c.instanceIdx, this._mat);
      g.opacity.array[c.instanceIdx] = edge * depthFade * endFade2;
    }

    for (const g of this.meshes) {
      if (!g) continue;
      g.mesh.instanceMatrix.needsUpdate = true;
      g.opacity.needsUpdate = true;
    }
  }
}

/* =====================================================================
   MAP (your city image) with drifting cloud shadows and a blue haze
   ===================================================================== */
const MAP_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const MAP_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D uMap;
  uniform sampler2D uShadowMap;
  uniform vec2 uShadowOffset;
  uniform vec2 uShadowTiling;
  uniform vec2 uShadowAtlasOffset;
  uniform vec2 uShadowAtlasScale;
  uniform float uShadowStrength;
  uniform float uHaze;
  uniform vec3 uHazeColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    vec4 m = texture2D(uMap, vUv);

    // repeat the blurry shadow tile from the atlas across the whole map
    vec2 tiled = fract(vUv * uShadowTiling + uShadowOffset);
    vec3 cloudRgb = texture2D(uShadowMap, tiled * uShadowAtlasScale + uShadowAtlasOffset).rgb;
    // the texture is read in linear light; go back to display values so white stays white
    float density = 1.0 - dot(pow(cloudRgb, vec3(1.0 / 2.2)), vec3(0.299, 0.587, 0.114));
    density = smoothstep(0.04, 1.0, density);
    m.rgb *= 1.0 - density * uShadowStrength;

    m.rgb = mix(m.rgb, uHazeColor, uHaze);
    gl_FragColor = vec4(m.rgb, uOpacity);
    #include <colorspace_fragment>
  }
`;

class CityMap {
  constructor(mapTexture, cloudsTexture) {
    this.aspect = mapTexture.image.width / mapTexture.image.height;
    const texel = 0.5 / (cloudsTexture.image?.width || 1024);
    const s = SHADOW_SPRITE;
    const tileAspect = s.w / s.h;

    this.uniforms = {
      uMap: { value: mapTexture },
      uShadowMap: { value: cloudsTexture },
      uShadowOffset: { value: new THREE.Vector2(0, 0) },
      // keep the shadow tile's own proportions on the wide map
      uShadowTiling: { value: new THREE.Vector2(SHADOW_TILING, (SHADOW_TILING * tileAspect) / this.aspect) },
      uShadowAtlasOffset: { value: new THREE.Vector2(s.x / ATLAS + texel, 1 - (s.y + s.h) / ATLAS + texel) },
      uShadowAtlasScale: { value: new THREE.Vector2(s.w / ATLAS - 2 * texel, s.h / ATLAS - 2 * texel) },
      uShadowStrength: { value: 0 },
      uHaze: { value: HAZE_START },
      uHazeColor: { value: HAZE_COLOR },
      uOpacity: { value: 0 },
    };

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.ShaderMaterial({
        vertexShader: MAP_VERT,
        fragmentShader: MAP_FRAG,
        uniforms: this.uniforms,
        transparent: true,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.mesh.renderOrder = 0;

    this.group = new THREE.Group();
    this.group.position.set(0, 0, MAP_Z);
    this.group.add(this.mesh);
    this.reveal = 0;
  }

  // size the plane so the image always covers the screen
  resize(camera) {
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * Math.abs(MAP_Z);
    const halfW = halfH * camera.aspect;
    let w, h;
    if (this.aspect > camera.aspect) { h = halfH * 2; w = h * this.aspect; }
    else { w = halfW * 2; h = w / this.aspect; }
    this.mesh.scale.set(w * MAP_OVERSCAN, h * MAP_OVERSCAN, 1);
  }

  update(dt, progress) {
    const e = smooth(clamp(progress, 0, 1));
    this.group.scale.setScalar(lerp(1, MAP_ZOOM_END, e));

    this.reveal = Math.min(1, this.reveal + dt / 3.5);          // slow fade-in on load
    this.uniforms.uOpacity.value = smooth(this.reveal);
    this.uniforms.uHaze.value = HAZE_START * (1 - e);
    this.uniforms.uShadowStrength.value = lerp(SHADOW_BASE, SHADOW_END, smoothstep(0.8, 1, progress));

    const o = this.uniforms.uShadowOffset.value;
    o.x = (o.x - dt * SHADOW_SPEED + 1) % 1;
  }
}

/* =====================================================================
   FAKE SCROLL
   The page never scrolls. Wheel, touch and keys push a target number,
   and the real position eases toward it every frame.
   ===================================================================== */
class ScrollManager {
  constructor() {
    this.pos = 0;
    this.target = 0;
    this.progress = 0;
    this.smoothSpeed = -Math.log(1 - 0.075) * 60;   // same feel at 60Hz and 120Hz
    this.resize();

    window.addEventListener('wheel', (e) => {
      e.preventDefault();
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 33;                 // lines → pixels
      else if (e.deltaMode === 2) d *= window.innerHeight;
      this.add(clamp(d * 1.2, -500, 500));            // cap hard flicks
    }, { passive: false });

    let lastY = null;
    window.addEventListener('touchstart', (e) => { lastY = e.touches[0].clientY; }, { passive: true });
    window.addEventListener('touchmove', (e) => {
      e.preventDefault();
      const y = e.touches[0].clientY;
      if (lastY !== null) this.add(clamp((lastY - y) * 2.6, -500, 500));   // fingers move less than wheels
      lastY = y;
    }, { passive: false });
    window.addEventListener('touchend', () => { lastY = null; }, { passive: true });

    window.addEventListener('keydown', (e) => {
      const step = window.innerHeight * 0.35;
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.add(step); }
      else if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); this.add(-step); }
      else if (e.key === 'Home') this.target = 0;
      else if (e.key === 'End') this.target = this.total;
    });
  }

  add(delta) {
    this.target = clamp(this.target + delta, 0, this.total);
  }

  // Two stages, like the original site: the hero first, then the clouds.
  resize() {
    // a hidden or minimised tab can report a ~0 height; ignore it so the position isn't lost
    if (window.innerHeight < 50 && this.total) return;
    const keep = this.total ? this.target / this.total : 0;
    const keepPos = this.total ? this.pos / this.total : 0;
    const unit = (window.innerHeight / 100) * (isMobile() ? MOBILE_SCROLL_FACTOR : 1);
    this.heroLength = HERO_SCROLL_VH * unit;
    this.cloudLength = SCROLL_LENGTH_VH * unit;
    this.total = this.heroLength + this.cloudLength;
    this.target = keep * this.total;
    this.pos = keepPos * this.total;
    this._split();
  }

  // jump straight to a point in the cloud stage (0–1)
  jump(cloudProgress) {
    this.target = this.pos = this.heroLength + clamp(cloudProgress, 0, 1) * this.cloudLength;
    this._split();
  }

  _split() {
    this.heroProgress = clamp(this.pos / this.heroLength, 0, 1);
    this.progress = clamp((this.pos - this.heroLength) / this.cloudLength, 0, 1);
    this.overall = this.pos / this.total;
  }

  update(dt) {
    const k = 1 - Math.exp(-this.smoothSpeed * dt);
    this.pos = lerp(this.pos, this.target, k);
    if (Math.abs(this.pos - this.target) < 0.5) this.pos = this.target;
    this._split();
  }
}

/* =====================================================================
   CAMERA RIG — slight tilt from the mouse (desktop) or the phone's gyro
   ===================================================================== */
class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.inputX = 0;
    this.inputY = 0;
    this.x = 0;
    this.y = 0;

    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      this.inputX = (e.clientX / window.innerWidth) * 2 - 1;
      this.inputY = (e.clientY / window.innerHeight) * 2 - 1;
    });

    // Android gives tilt data straight away; iOS needs a permission tap first.
    let betaRef = null, gammaRef = null;
    const onTilt = (e) => {
      if (e.beta === null || e.gamma === null) return;
      if (betaRef === null) { betaRef = e.beta; gammaRef = e.gamma; }
      this.inputX = clamp((e.gamma - gammaRef) / 25, -1, 1);
      this.inputY = clamp((e.beta - betaRef) / 25, -1, 1);
      betaRef += (e.beta - betaRef) * 0.01;      // slowly re-centre on how the phone is held
      gammaRef += (e.gamma - gammaRef) * 0.01;
    };
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === 'function') {
      window.addEventListener('touchend', () => {
        DOE.requestPermission().then((r) => {
          if (r === 'granted') window.addEventListener('deviceorientation', onTilt);
        }).catch(() => {});
      }, { once: true });
    } else if (DOE) {
      window.addEventListener('deviceorientation', onTilt);
    }
  }

  update(dt) {
    const k = 1 - Math.exp(-3 * dt);
    this.x = lerp(this.x, this.inputX, k);
    this.y = lerp(this.y, this.inputY, k);
    this.camera.rotation.set(-this.y * TILT, -this.x * TILT, 0);
  }
}

/* =====================================================================
   CAPTIONS + small UI
   ===================================================================== */
class Captions {
  constructor(root, items) {
    this.items = items.map((item) => {
      const el = document.createElement('p');
      el.className = 'caption';
      el.textContent = item.text;
      if (item.sub) {
        const sub = document.createElement('small');
        sub.textContent = item.sub;
        el.appendChild(sub);
      }
      root.appendChild(el);
      return { ...item, el };
    });
  }

  update(progress) {
    for (const c of this.items) {
      const span = c.to - c.from;
      const t = (progress - c.from) / span;          // 0 → 1 across the caption's life
      const fade = 0.22;
      let o = 0;
      if (t >= 0 && t <= 1) o = Math.min(1, t / fade, (1 - t) / fade);
      if (c.from <= 0 && t >= 0 && t < fade) o = 1;  // the first caption is visible from the start
      // text grows slightly as if it were flying past with the clouds
      const s = lerp(0.9, 1.14, clamp(t, 0, 1));
      c.el.style.opacity = smooth(clamp(o, 0, 1)).toFixed(3);
      c.el.style.transform = `scale(${s.toFixed(4)})`;
    }
  }
}

/* =====================================================================
   BOOT
   ===================================================================== */
const canvas = document.getElementById('scene');
const loaderEl = document.getElementById('loader');
const hintEl = document.getElementById('hint');
const progressEl = document.querySelector('#progress b');

/* ---------- hero: slides up with a little depth between its layers ---------- */
const hero = {
  root: document.getElementById('hero'),
  content: document.querySelector('.hero__content'),
  last: -1,
};

function updateHero(t) {
  if (Math.abs(t - hero.last) < 0.0001) return;
  hero.last = t;
  const e = t * t * (3 - 2 * t);
  const h = hero.root.offsetHeight;

  // The whole section lifts away as one piece. The background photo, headline
  // and cut-out stay locked together: the cut-out is only there to put the
  // headline behind the rider and station, so it must line up with the photo.
  hero.root.style.transform = `translate3d(0, ${(-e * (h + 2)).toFixed(1)}px, 0)`;
  hero.content.style.opacity = (1 - clamp(t / 0.35, 0, 1)).toFixed(3);
  hero.root.style.visibility = t >= 1 ? 'hidden' : 'visible';
}

// menu: show the orange brackets on the item that was clicked
document.querySelectorAll('.nav__item').forEach((item, i, all) => {
  item.addEventListener('click', (ev) => {
    ev.preventDefault();
    all.forEach((other) => { other.classList.remove('is-active'); other.removeAttribute('aria-current'); });
    item.classList.add('is-active');
    item.setAttribute('aria-current', 'page');
  });
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(SKY_COLOR, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(
  isMobile() ? FOV_MOBILE : FOV_DESKTOP,
  window.innerWidth / window.innerHeight,
  0.1,
  200,
);
camera.position.set(0, 0, 0);

const scroll = new ScrollManager();
const rig = new CameraRig(camera);
const captions = new Captions(document.getElementById('captions'), CAPTIONS);

let clouds = null;
let cityMap = null;

function loadTextures() {
  const ktx2 = new KTX2Loader().setTranscoderPath('./vendor/basis/').detectSupport(renderer);
  const cloudsFile = './assets/clouds.ktx2';
  return Promise.all([
    ktx2.loadAsync(cloudsFile),
    new THREE.TextureLoader().loadAsync('./assets/map.webp'),
  ]).then(([cloudsTex, mapTex]) => {
    ktx2.dispose();
    cloudsTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.colorSpace = THREE.SRGBColorSpace;
    mapTex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    return { cloudsTex, mapTex };
  });
}

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.fov = isMobile() ? FOV_MOBILE : FOV_DESKTOP;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  scroll.resize();
  if (clouds) clouds.resize(camera.fov, camera.aspect);
  if (cityMap) cityMap.resize(camera);
}
window.addEventListener('resize', resize);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  scroll.update(dt);
  const p = scroll.progress;

  rig.update(dt);
  cityMap.update(dt, p);
  clouds.update(dt, p);
  captions.update(p);

  updateHero(scroll.heroProgress);
  hintEl.style.opacity = scroll.heroProgress < 1 || p > 0.02 ? 0 : 1;
  progressEl.style.transform = `scaleY(${scroll.overall.toFixed(4)})`;

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

loadTextures()
  .then(({ cloudsTex, mapTex }) => {
    cityMap = new CityMap(mapTex, cloudsTex);
    cityMap.resize(camera);
    scene.add(cityMap.group);

    // flying clouds use a smoothed, mipmapped copy; map shadows keep the original
    clouds = new CloudLayer(softenAtlas(renderer, cloudsTex), CLOUD_SPRITES, camera.fov, camera.aspect);
    scene.add(clouds.group);

    // handy for checking a spot: open the page with ?p=0.5 to start halfway
    const startAt = parseFloat(new URLSearchParams(location.search).get('p'));
    if (!Number.isNaN(startAt)) scroll.jump(startAt);

    loaderEl.classList.add('done');
    last = performance.now();
    requestAnimationFrame(frame);
  })
  .catch((err) => {
    console.error(err);
    loaderEl.classList.add('error');
    loaderEl.textContent =
      location.protocol === 'file:'
        ? 'This page needs a local server. Run "node serve.mjs" in this folder, then open http://localhost:5173'
        : 'Could not load the scene. Check the browser console for details.';
  });
