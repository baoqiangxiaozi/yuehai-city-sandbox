/* ============================================================
   YUEHAI · 山海之间的科技城
   Single-file Three.js city sandbox.
   Data: OpenStreetMap (ODbL), already projected into
   data/yuehai-osm.json (the original projection script is not in
   this package). Visuals are generated procedurally in the browser.
   Three.js r128 is vendored and inlined by scripts/build_page.py.
   ============================================================ */
(function () {
'use strict';

const $ = (id) => document.getElementById(id);
const boot = $('boot');
const bootStatus = $('bootStatus');
const bootError = $('bootError');

function fatal(message) {
  window.__YUEHAI_BOOTED__ = true;
  if (window.__YUEHAI_BOOT_DEADLINE__) {
    clearTimeout(window.__YUEHAI_BOOT_DEADLINE__);
    window.__YUEHAI_BOOT_DEADLINE__ = 0;
  }
  boot.classList.remove('is-done');
  bootError.classList.remove('hidden');
  bootError.textContent = message;
  bootStatus.textContent = '无法启动城市沙盘';
}

if (!window.THREE) {
  fatal('Three.js 未能载入。请打开本包构建出的单文件 index.html，无需访问外部网络。');
  return;
}

let DATA;
try {
  DATA = JSON.parse($('osm-data').textContent);
} catch (err) {
  fatal('OSM 数据解析失败：' + err.message);
  return;
}

const META = DATA.meta;
const PLAN = 0.058;                 // metres → sandbox units
const HS = 0.112;                   // vertical exaggeration (metres → units)
const LAND_X = 162;
const LAND_NORTH = -158;
const LAND_SOUTH = 166;
const COAST_BASE = 137.0;
const BUILD_Y = 0.09;
const ROAD_Y = 0.13;
const SEA_Y = 0.20;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const wx = (x) => x * PLAN;
const wz = (z) => z * PLAN;
const wh = (h) => h * HS;

const COLORS = {
  gold: 0xd8ba82,
  goldBright: 0xf2d9a5,
  cream: 0xf3ecdc,
  jade: 0x77c7b0,
  teal: 0x5ed7c4,
  warm: 0xf0b873,
  land: 0x19271f,
  landSide: 0x0a140f,
  bed: 0x080d0a,
  roadBase: 0x171d18,
  sand: 0xa99c7d,
  grass: 0x223c2c,
  waterDeep: 0x071b20,
  waterShallow: 0x154a4a,
  glassA: '#272c2f',
  glassB: '#24292c',
  glassC: '#2b3033',
  resi: '#322f26',
  retail: '#3b3327',
  civic: '#2b352d',
  industrial: '#262f29',
  other: '#29322b',
  structure: '#252a25'
};

// ── renderer / scene ─────────────────────────────────────────
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance'
  });
} catch (err) {
  fatal('WebGL 初始化失败：' + err.message);
  return;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x050b08, 1);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a1611, 0.0028);

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.6, 1800);
camera.position.set(128, 178, 268);

const world = new THREE.Group();
scene.add(world);
const nightGroup = new THREE.Group();
const metroGroup = new THREE.Group();
const trafficGroup = new THREE.Group();
const signalGroup = new THREE.Group();
const parkingGroup = new THREE.Group();
const landmarkGroup = new THREE.Group();
world.add(nightGroup, metroGroup, trafficGroup, signalGroup, parkingGroup, landmarkGroup);

// ── tiny deterministic random ─────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261028);
function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// ── state ─────────────────────────────────────────────────────
const state = {
  hour: 8.166,
  playing: true,
  speed: 1,
  weather: 'clear',
  camera: 'free',
  nightBoost: 1,
  lightMode: 'auto',
  quality: 'high',
  qualityAuto: true,
  immersive: false,
  selectedLandmark: null,
  selectedBuilding: null,
  selectedRoad: null,
  followLandmarkId: 'tencent-binhai',
  cardNotice: '',
  cardNoticeUntil: 0,
  layers: {
    buildings: true,
    roads: true,
    metro: true,
    traffic: true,
    congestion: true,
    signals: true,
    night: true,
    parking: false,
    labels: true
  },
  signalTime: 0,
  lastMinuteShown: -1,
  rainEnabled: false
};

// ── procedural environment: Canvas sky + skyline silhouettes, no HDR ──
const ENV_PALETTES = {
  day:   { top: '#1d4f70', horizon: '#bdd5df', ground: '#1a2225', block: '#10191c', sun: 'rgba(255,241,205,.85)' },
  dusk:  { top: '#293149', horizon: '#d98f68', ground: '#1a1b1e', block: '#101418', sun: 'rgba(255,177,112,.95)' },
  night: { top: '#040a16', horizon: '#17243a', ground: '#07090b', block: '#060b10', sun: 'rgba(154,180,216,.22)' }
};
function envFaceTexture(kind, face) {
  const p = ENV_PALETTES[kind] || ENV_PALETTES.day;
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const horizon = Math.round(size * .58);
  const grad = ctx.createLinearGradient(0, 0, 0, size);
  if (face === 2) {
    grad.addColorStop(0, p.top);
    grad.addColorStop(.68, p.horizon);
    grad.addColorStop(1, p.horizon);
  } else if (face === 3) {
    grad.addColorStop(0, p.ground);
    grad.addColorStop(1, '#050708');
  } else {
    grad.addColorStop(0, p.top);
    grad.addColorStop(.50, p.horizon);
    grad.addColorStop(.58, p.horizon);
    grad.addColorStop(.70, p.ground);
    grad.addColorStop(1, '#080b0d');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  // Procedural cloud bands.
  if (face !== 3) {
    ctx.save();
    ctx.globalAlpha = kind === 'night' ? .045 : .16;
    ctx.fillStyle = kind === 'dusk' ? '#ffe4c9' : '#f1f5f2';
    for (let k = 0; k < 9; k++) {
      const x = ((k * 53 + face * 31) % size);
      const y = 42 + ((k * 19 + face * 13) % 74);
      ctx.beginPath();
      ctx.ellipse(x, y, 22 + (k % 3) * 13, 5 + (k % 2) * 3, .06, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Dark city blocks at the horizon give glass real opposite-building shapes.
  if (face !== 2 && face !== 3) {
    let x = -18;
    let seed = face * 17.7 + (kind === 'day' ? 2.1 : kind === 'dusk' ? 7.4 : 11.8);
    const hash = (n) => fract(Math.sin(n * 127.1 + seed * 311.7) * 43758.5453);
    while (x < size + 10) {
      const w = 8 + hash(x * .07) * 24;
      const h = 9 + hash(x * .11 + 2) * 54;
      ctx.fillStyle = p.block;
      ctx.fillRect(x, horizon - h, w, h + 2);
      if (kind !== 'night' && hash(x * .09 + 9) > .55) {
        ctx.fillStyle = 'rgba(220,204,166,.16)';
        for (let wy = horizon - h + 7; wy < horizon - 4; wy += 9)
          for (let wx = x + 4; wx < x + w - 4; wx += 8) ctx.fillRect(wx, wy, 1.4, 2.2);
      }
      x += w + 3 + hash(x * .13 + 4) * 12;
    }
  }

  // Sun / moon glow and a soft horizon band.
  if (face !== 2 && face !== 3) {
    const sx = face === 0 ? size * .74 : face === 4 ? size * .30 : size * .54;
    const sy = horizon - (kind === 'night' ? 28 : 15);
    const rg = ctx.createRadialGradient(sx, sy, 0, sx, sy, size * .42);
    rg.addColorStop(0, p.sun);
    rg.addColorStop(.12, kind === 'dusk' ? 'rgba(255,183,120,.32)' : 'rgba(255,245,220,.14)');
    rg.addColorStop(1, 'rgba(255,160,90,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.fillStyle = kind === 'night' ? 'rgba(90,120,155,.10)' : 'rgba(232,239,226,.10)';
  ctx.fillRect(0, horizon - 1, size, 2);
  return c;
}
function makeEnvCube(kind) {
  const faces = [];
  for (let i = 0; i < 6; i++) faces.push(envFaceTexture(kind, i));
  const tex = new THREE.CubeTexture(faces);
  tex.mapping = THREE.CubeReflectionMapping;
  tex.encoding = THREE.sRGBEncoding;
  tex.needsUpdate = true;
  return tex;
}
function fract(v) { return v - Math.floor(v); }
const cityEnvMaps = {
  day: makeEnvCube('day'),
  dusk: makeEnvCube('dusk'),
  night: makeEnvCube('night')
};
let currentEnvKey = 'day';
let currentCityEnv = cityEnvMaps.day;
function envKeyForHour(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 16.5) return 'day';
  if (h >= 16.5 && h < 19.6) return 'dusk';
  return 'night';
}
function updateEnvForTime(hour) {
  const key = envKeyForHour(hour);
  if (key === currentEnvKey) return;
  currentEnvKey = key;
  currentCityEnv = cityEnvMaps[key];
  if (typeof refreshEnvReflection === 'function') refreshEnvReflection();
}

// Public hand-off points for external simulation control. weatherFactor is
// set from the five weather modes and multiplies vehicle target speed, target
// vehicle count and generation rate. isNight uses sunset+30m / sunrise-30m.
window.weatherFactor = (typeof window.weatherFactor === 'number' && isFinite(window.weatherFactor))
  ? Math.max(0, window.weatherFactor)
  : 1.0;
window.isNight = false;
window.setYuehaiWeatherFactor = (value) => {
  const n = Number(value);
  window.weatherFactor = (isFinite(n) && n >= 0) ? clamp(n, 0, 2) : 1;
  return window.weatherFactor;
};

const SUNRISE = 6.5;
const SUNSET = 18.5;
const NIGHT_START = 19.0;
const NIGHT_END = 6.0;
function computeIsNight(hour) {
  return hour >= NIGHT_START || hour < NIGHT_END;
}

// environment is eased toward the target values every frame
const env = {
  day: 0.6,
  night: 0.4,
  twilight: 0,
  rain: 0,
  cloud: 0,
  fog: 0.0028,
  sunStrength: 0.7,
  ambient: 0.8,
  lightPower: 0,
  wet: 0,
  horizon: new THREE.Color(0x65766b),
  top: new THREE.Color(0x162a25),
  sunColor: new THREE.Color(0xffe4b1),
  ground: new THREE.Color(0x19271f)
};
const weatherState = {
  name: 'clear',
  rain: 0,
  cloud: 0.08,
  fog: 0.0023,
  sun: 1.0,
  speed: 1.0,
  exposure: 1.05,
  wet: 0,
  rainDrops: 0,
  activeDrops: 0
};
// Transition targets are eased over roughly two seconds in updateEnvironment.
const WEATHER = {
  clear:  { name: '晴朗', rain: 0.00, cloud: 0.06, fog: 0.00135, sun: 1.00, factor: 1.00, wet: 0.00, rainDrops: 0, label: 'CLEAR · 晴朗' },
  cloudy: { name: '多云', rain: 0.00, cloud: 0.46, fog: 0.00170, sun: 0.80, factor: 0.98, wet: 0.00, rainDrops: 0, label: 'CLOUDY · 多云' },
  rain:   { name: '小雨', rain: 0.38, cloud: 0.72, fog: 0.00240, sun: 0.42, factor: 0.85, wet: 0.58, rainDrops: 2000, label: 'LIGHT RAIN · 小雨' },
  storm:  { name: '暴雨', rain: 1.00, cloud: 0.94, fog: 0.00300, sun: 0.24, factor: 0.60, wet: 1.00, rainDrops: 8000, label: 'STORM · 暴雨' },
  fog:    { name: '雾天', rain: 0.00, cloud: 0.34, fog: 0.00450, sun: 0.32, factor: 0.75, wet: 0.16, rainDrops: 0, label: 'FOG · 雾天' }
};

/* Building input normalisation. OSM rows use short keys; hand-written rows can
   use the long spellings or an x/z/w/d rectangle and still feed windows,
   landmark light outlines, labels and the traffic graph. */
(function normalizeBuildings() {
  if (!Array.isArray(DATA.buildings)) DATA.buildings = [];
  const typeAlias = { office: 'commercial', apartment: 'residential', house: 'residential', school: 'civic', university: 'civic', shop: 'retail', industrial: 'industrial', structure: 'structure' };
  DATA.buildings = DATA.buildings.map((b, i) => {
    const out = Object.assign({}, b);
    const rawP = b.p || b.points || b.polygon || b.footprint;
    if (Array.isArray(rawP) && rawP.length) {
      if (Array.isArray(rawP[0])) {
        const flat = [];
        for (const p of rawP) { flat.push(Number(p[0]) || 0, Number(p[1]) || 0); }
        out.p = flat;
      } else out.p = rawP.slice();
    } else if (Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.w || b.d)) {
      const hw = (Number(b.w) || 14) * .5, hd = (Number(b.d) || 14) * .5;
      out.p = [b.x - hw, b.z - hd, b.x + hw, b.z - hd, b.x + hw, b.z + hd, b.x - hw, b.z + hd];
    } else {
      out.p = [];
    }
    if (!Number.isFinite(out.height)) {
      out.height = Number.isFinite(b.h) ? b.h : (Number.isFinite(b.levels) ? b.levels * 3.2 : 12);
    }
    out.t = typeAlias[b.t || b.type || b.kind] || b.t || b.type || b.kind || 'other';
    out.n = out.n || b.name || '';
    out._index = i;
    return out;
  });
})();

// China Resources Headquarters ("Spring Bamboo" / 春笋) is present in the OSM
// footprint set but has no landmark record. Promote it to a landmark and give
// it a bespoke tapered glass model instead of the generic extruded prism.
const CR_BUILDING_INDEX = DATA.buildings.findIndex(b => b && /中国华润大厦|华润大厦|春笋/.test(b.n || ''));
const CR_LANDMARK_ID = 'china-resources';
let CR_CENTER_RAW = null;
if (CR_BUILDING_INDEX >= 0) {
  const b = DATA.buildings[CR_BUILDING_INDEX];
  const pts = b.p || [];
  const xs = pts.filter((_, i) => i % 2 === 0);
  const zs = pts.filter((_, i) => i % 2 === 1);
  if (xs.length && zs.length) {
    const cx = xs.reduce((s, v) => s + v, 0) / xs.length;
    const cz = zs.reduce((s, v) => s + v, 0) / zs.length;
    CR_CENTER_RAW = { x: cx, z: cz };
    if (!DATA.landmarks.some(l => l.id === CR_LANDMARK_ID)) {
      DATA.landmarks.push({
        id: CR_LANDMARK_ID,
        name: '中国华润大厦',
        en: 'China Resources Headquarters',
        x: cx, z: cz,
        buildings: [CR_BUILDING_INDEX],
        source: 'osm',
        note: '后海“春笋”：392.5 米高的锥形玻璃塔楼，细密竖向鳍片与收尖轮廓。',
        year: '2018'
      });
    }
  }
}

// Tencent Seafront Towers: replace both generic OSM prisms with one bespoke
// twin-tower model. The landmark and the two building indices are the single
// source of truth for position and height.
const TENCENT_LANDMARK = DATA.landmarks.find(l => l.id === 'tencent-binhai') || null;
const TENCENT_LANDMARK_ID = 'tencent-binhai';
const TENCENT_BUILDING_INDICES = new Set(TENCENT_LANDMARK ? (TENCENT_LANDMARK.buildings || []) : [602, 603]);
const BAIDU_SKIP = new Set([462, 463]);
const SOFTWARE_SKIP = new Set([404, 405, 406, 407, 408, 425, 426, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437]);

// Shenzhen Bay One (T7 + T2/T4/T5/T6/T8) is a single OSM-recorded group, but
// the export has no landmark for it yet. Add one anchored on T7 so the six
// bespoke towers keep a label/card instead of disappearing with the generic
// prisms. All tower heights and footprints still come from DATA.buildings.
const SBO_LANDMARK_ID = 'shenzhen-bay-one';
const SBO_T7_INDEX = 476;
const SBO_OTHER_INDICES = [477, 478, 479, 486, 487];
const SBO_TOWER_INDICES = [476, ...SBO_OTHER_INDICES];
const SBO_PODIUM_INDICES = [480, 481, 482, 483];
const SBO_SKIP_INDICES = new Set([...SBO_TOWER_INDICES, ...SBO_PODIUM_INDICES]);

// OSM 542/543: Shenzhen Bay Sports Center, replaced by one Spring Cocoon shell.
const COCOON_INDICES = [542, 543];
const COCOON_LANDMARK_ID = 'spring-cocoon';
const COCOON_SKIP_INDICES = new Set(COCOON_INDICES);
if (!DATA.landmarks.some(l => l.id === COCOON_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: COCOON_LANDMARK_ID,
    name: '深圳湾体育中心 · 春茧',
    en: 'Shenzhen Bay Sports Center',
    x: 1727.0,
    z: -58.0,
    buildings: COCOON_INDICES.slice(),
    source: 'osm',
    note: '体育馆 + 游泳馆合并为一张连续茧形壳；OSM 没有独立体育场看台轮廓，本轮不虚构看台。',
    year: ''
  });
}

// Shenzhen Bay Port area (east of Dongbin Rd, west of Wanghai Rd, z≤1980).
const PORT_LANDMARK_ID = 'szbay-port';
const PORT_SKIP_INDICES = new Set([190,191,192,193,194,195,196,197,198,760,264,265]);
if (!DATA.landmarks.some(l => l.id === PORT_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: PORT_LANDMARK_ID, name: '深圳湾口岸',
    en: 'Shenzhen Bay Port', x: 1820, z: 1760,
    buildings: [190, 191, 192, 193, 194, 195, 196, 197, 198, 760, 264, 265],
    source: 'osm',
    note: '旅检大楼 + 查验通道雨棚 + 海关楼 + 深圳湾大桥引桥；引桥到数据南界 z=2320 收口，不虚构香港侧斜拉塔。',
    year: ''
  });
}

// OSM 634: Excellence Houhai Center, 210 m / 46F, east of Lenovo.
const EXCELLENCE_INDEX = 634;
const EXCELLENCE_LANDMARK_ID = 'excellence-houhai';
const EXCELLENCE_SKIP_INDICES = new Set([EXCELLENCE_INDEX]);
if (!DATA.landmarks.some(l => l.id === EXCELLENCE_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: EXCELLENCE_LANDMARK_ID,
    name: '卓越·后海中心',
    en: 'Excellence Houhai Center',
    x: 1164.0, z: -168.0,
    buildings: [EXCELLENCE_INDEX],
    source: 'osm',
    note: '210 m 板式塔；塔楼相对裙房错动 6 m，银色竖肋随高度扭转 2.5 m，南面 4–18F 绿化边庭；无塔冠字牌。',
    year: ''
  });
}

// SZU campus bulk set (演会中心 2404 excluded).
const CAMPUS_SKIP_INDICES = new Set();
for (let ci = 0; ci < DATA.buildings.length; ci++) {
  if (ci === 2404) continue;
  const cb = DATA.buildings[ci]; if (!cb.p) continue;
  const xs = cb.p.filter((_, i) => i % 2 === 0), zs = cb.p.filter((_, i) => i % 2 === 1);
  const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cz = zs.reduce((a, v) => a + v, 0) / zs.length;
  if (((cx - 400) / 410) ** 2 + ((cz + 1400) / 450) ** 2 < 1) CAMPUS_SKIP_INDICES.add(ci);
}

// OSM 654: Youxian Information Transmission Tower, 89.6 m / 28F.
const YOUXIAN_INDEX = 654;
const YOUXIAN_LANDMARK_ID = 'youxian-tower';
const YOUXIAN_SKIP = new Set([YOUXIAN_INDEX]);
if (!DATA.landmarks.some(l => l.id === YOUXIAN_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: YOUXIAN_LANDMARK_ID, name: '有线信息传输大厦',
    en: 'Youxian Information Transmission Tower', x: 565, z: -405,
    buildings: [YOUXIAN_INDEX], source: 'osm',
    note: '89.6 m/28F 窄板塔；2.4 m 长面分格、短面金属带；创投街段南侧填充。',
    year: ''
  });
}

// OSM 443: Microsoft Ketong Tower, 99.6 m / 25F.
const KETONG_INDEX = 443;
const KETONG_LANDMARK_ID = 'ketong-tower';
const KETONG_SKIP = new Set([KETONG_INDEX]);
if (!DATA.landmarks.some(l => l.id === KETONG_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: KETONG_LANDMARK_ID, name: '微软科通大厦',
    en: 'Microsoft Ketong Tower', x: 884, z: -1013,
    buildings: [KETONG_INDEX], source: 'osm',
    note: '99.6 m/25F 近正方塔；3×3 m 方格网、低冠盒、3F 裙房；无微软标识。',
    year: ''
  });
}

// OSM 780: BUPT Technology Tower, 100 m / 23F.
const BUPT_INDEX = 780;
const BUPT_LANDMARK_ID = 'bupt-tower';
const BUPT_SKIP = new Set([BUPT_INDEX]);
if (!DATA.landmarks.some(l => l.id === BUPT_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: BUPT_LANDMARK_ID, name: '北邮科技大厦',
    en: 'BUPT Technology Tower', x: 1618, z: -1595,
    buildings: [BUPT_INDEX], source: 'osm',
    note: '100 m/23F 窄板塔；与彩讯同 55×33 轮廓、同 2.7 m 节奏；亮度与冠部压一档。',
    year: ''
  });
}

// OSM 779: Caixun Technology Tower, 160 m / 32F.
const CAIXUN_INDEX = 779;
const CAIXUN_LANDMARK_ID = 'caixun-tower';
const CAIXUN_SKIP = new Set([CAIXUN_INDEX]);
if (!DATA.landmarks.some(l => l.id === CAIXUN_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: CAIXUN_LANDMARK_ID, name: '彩讯科技大厦',
    en: 'Caixun Technology Tower', x: 1504, z: -1592,
    buildings: [CAIXUN_INDEX], source: 'osm',
    note: '160 m/32F 窄板塔；长面 2.7 m 竖分格、短面金属实带；科苑南路东侧街墙。',
    year: ''
  });
}

// All residential buildings not already bespoke.
const RESIDENTIAL_SKIP = new Set();
{
  const lm = new Set();
  for (const l of DATA.landmarks) for (const bi of (l.buildings || [])) lm.add(bi);
  for (let bi = 0; bi < DATA.buildings.length; bi++) {
    const b = DATA.buildings[bi];
    if (!b || b.t !== 'residential') continue;
    if (bi === 2404 || lm.has(bi) || CAMPUS_SKIP_INDICES.has(bi)) continue;
    RESIDENTIAL_SKIP.add(bi);
  }
}

// OSM 10/1175/1488: LXS office twin + Shenzhen Bay Residence.
const LITE3_INDICES = [10, 1175, 1488];
const LITE3_SKIP = new Set(LITE3_INDICES);
if (!DATA.landmarks.some(l => l.id === 'lite3')) {
  DATA.landmarks.push({ id: 'lite3', name: '留学生创业大厦 / 深圳湾公馆', en: 'LXS / Shenzhen Bay Residence', x: 1596, z: -1525, buildings: LITE3_INDICES.slice(), source: 'osm', note: '两栋留学生创业办公塔 + 深圳湾公馆住宅塔。', year: '' });
}

// OSM 401: Yihua Fintech Tower, 147 m / 31F.
const YIHUA_INDEX = 401;
const YIHUA_LANDMARK_ID = 'yihua-tower';
const YIHUA_SKIP = new Set([YIHUA_INDEX]);
if (!DATA.landmarks.some(l => l.id === YIHUA_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: YIHUA_LANDMARK_ID, name: '怡化金融科技大厦',
    en: 'Yihua Fintech Tower', x: 447, z: -788,
    buildings: [YIHUA_INDEX], source: 'osm',
    note: '147 m/31F 板塔；南立面用真竖框疏密构成抽象 YH 纹样；LOW-E 玻璃与稀疏夜景。',
    year: '2014'
  });
}

// OSM 1232: China Overseas Building, 100 m / 21F.
const CHINA_OVERSEAS_INDEX = 1232;
const CHINA_OVERSEAS_LANDMARK_ID = 'china-overseas';
const CHINA_OVERSEAS_SKIP = new Set([CHINA_OVERSEAS_INDEX]);
if (!DATA.landmarks.some(l => l.id === CHINA_OVERSEAS_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: CHINA_OVERSEAS_LANDMARK_ID, name: '中国海外大厦',
    en: 'China Overseas Building', x: 1008, z: 437,
    buildings: [CHINA_OVERSEAS_INDEX], source: 'osm',
    note: '100 m/21F 叠石塔；5 个石层交替进退、真凹缝、石材肋+玻璃带；南/西深遮阳。',
    year: ''
  });
}

// OSM 1257/1256: Tsinghua Research / Bay Innovation twin towers.
const TSINGHUA_INDICES = [1257, 1256];
const TSINGHUA_LANDMARK_ID = 'tsinghua-research';
const TSINGHUA_SKIP = new Set(TSINGHUA_INDICES);
if (!DATA.landmarks.some(l => l.id === TSINGHUA_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: TSINGHUA_LANDMARK_ID, name: '深圳清华大学研究院新大楼',
    en: 'Tsinghua Research / Bay Innovation', x: 1150, z: -1215,
    buildings: TSINGHUA_INDICES.slice(), source: 'osm',
    note: '102.4 m 双塔、3–5 层桁架连体、首层架空、西侧三级实验室裙房。',
    year: '2023'
  });
}

// OSM 658/657/659/660/661: Shenzhen Bay Innovation Center; 1173 is a connector anchor.
const INNOVATION_INDICES = [658, 657, 659, 660, 661, 1173];
const INNOVATION_LANDMARK_ID = 'innovation-center';
const INNOVATION_SKIP = new Set(INNOVATION_INDICES);
if (!DATA.landmarks.some(l => l.id === INNOVATION_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: INNOVATION_LANDMARK_ID, name: '深圳湾创新科技中心',
    en: 'Shenzhen Bay Innovation Center', x: 1550, z: -1210,
    buildings: [658, 657, 659, 660, 661], source: 'osm',
    note: 'A 311 m/B 247 m 双塔 + 两道空中连体 + 峡谷裙房 + 3 栋公寓；1173 按高位连廊锚处置。',
    year: ''
  });
}

// OSM 1258/1259: east extension of the Venture street wall.
const EASTWALL_INDICES = [1258, 1259];
const EASTWALL_LANDMARK_ID = 'venture-east-wall';
const EASTWALL_SKIP = new Set(EASTWALL_INDICES);
if (!DATA.landmarks.some(l => l.id === EASTWALL_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: EASTWALL_LANDMARK_ID, name: '创投东延街段',
    en: 'Venture East Street Wall', x: 917, z: -560,
    buildings: EASTWALL_INDICES.slice(), source: 'osm',
    note: '1258 广晟科创 100 m、1259 高技术示范按官方 149.9 m；干净准精模街墙。',
    year: ''
  });
}

// OSM 403/409/402/424: four neighbors flanking Venture Capital Tower.
const VENTURE_NEIGHBOR_INDICES = [403, 409, 402, 424];
const VENTURE_NEIGHBOR_LANDMARK_ID = 'venture-neighbors';
const VENTURE_NEIGHBOR_SKIP = new Set(VENTURE_NEIGHBOR_INDICES);
if (!DATA.landmarks.some(l => l.id === VENTURE_NEIGHBOR_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: VENTURE_NEIGHBOR_LANDMARK_ID, name: '创投两侧四栋准精模',
    en: 'Venture Neighbors', x: 650, z: -560,
    buildings: VENTURE_NEIGHBOR_INDICES.slice(), source: 'osm',
    note: '三诺 403、A8 409、赛西 402、盈峰 424；创投 630 本体不动。',
    year: ''
  });
}

// OSM 782: Xunlei Tower, 119 m / 29F, 66×36 m slab.
const XUNLEI_INDEX = 782;
const XUNLEI_LANDMARK_ID = 'xunlei-tower';
const XUNLEI_SKIP_INDICES = new Set([XUNLEI_INDEX]);
if (!DATA.landmarks.some(l => l.id === XUNLEI_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: XUNLEI_LANDMARK_ID, name: '迅雷大厦',
    en: 'Xunlei Tower', x: 1506, z: -1654,
    buildings: [XUNLEI_INDEX], source: 'osm',
    note: '119 m/29F 窄长板塔；长立面 1.8 m 竖肋、两端金属实面、15F 避难环带、错台冠部。',
    year: ''
  });
}

// OSM 619: Hisense South Building, 160 m / 30F.
const HISENSE_INDEX = 619;
const HISENSE_LANDMARK_ID = 'hisense-south';
const HISENSE_SKIP_INDICES = new Set([HISENSE_INDEX]);
if (!DATA.landmarks.some(l => l.id === HISENSE_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: HISENSE_LANDMARK_ID, name: '海信南方大厦',
    en: 'Hisense South Building', x: 882, z: 537,
    buildings: [HISENSE_INDEX], source: 'osm',
    note: '160 m/30F 厚重总部塔；1.2 m 宽石材竖肋 @6 m、8 层石材横带、石材冠带；3F 东南裙房。',
    year: ''
  });
}

// OSM 1675: ByteDance Houhai Center, 150 m / 32F.
const BYTEDANCE_INDEX = 1675;
const BYTEDANCE_LANDMARK_ID = 'bytedance-houhai';
const BYTEDANCE_SKIP_INDICES = new Set([BYTEDANCE_INDEX]);
if (!DATA.landmarks.some(l => l.id === BYTEDANCE_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: BYTEDANCE_LANDMARK_ID, name: '深圳字节跳动后海中心',
    en: 'ByteDance Houhai Center', x: 977, z: 564,
    buildings: [BYTEDANCE_INDEX], source: 'osm',
    note: '150 m/32F 方正圆角玻璃塔；3 m 方格网、16F 外挑环带、封闭冠盒；3F 围合裙房与内庭院；无字牌。',
    year: ''
  });
}

// OSM 902/638/637/899/897/895/635: Haide 3rd north office row.
const OFFICEWALL_INDICES = [902, 638, 637, 899, 897, 895, 635];
const OFFICEWALL_LANDMARK_ID = 'haide-office-wall';
const OFFICEWALL_SKIP = new Set(OFFICEWALL_INDICES);
if (!DATA.landmarks.some(l => l.id === OFFICEWALL_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: OFFICEWALL_LANDMARK_ID, name: '海德三道北侧办公组团',
    en: 'Haide 3rd North Office Row', x: 1184, z: -197,
    buildings: OFFICEWALL_INDICES.slice(), source: 'osm',
    note: '7 栋准精模街墙：圆角平面、横竖分格、10 层环带、女儿墙/屋顶设备/冠带、3 层裙楼与招牌带；工行四柱门廊。',
    year: ''
  });
}

// OSM 630: Shenzhen Bay Venture Capital Tower, 202.4 m / 44F.
const VENTURE_INDEX = 630;
const VENTURE_LANDMARK_ID = 'venture-capital';
const VENTURE_SKIP_INDICES = new Set([VENTURE_INDEX]);
if (!DATA.landmarks.some(l => l.id === VENTURE_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: VENTURE_LANDMARK_ID, name: '深圳湾创业投资大厦',
    en: 'Shenzhen Bay Venture Capital Tower', x: 641, z: -548,
    buildings: [VENTURE_INDEX], source: 'osm',
    note: '202.4 m/44F 近方形玻璃塔；1.6 m 竖肋、22F 环带、三级冠框；3F 裙房与大堂。',
    year: ''
  });
}

// OSM 450: Rongchao High-Tech Joint HQ, 230 m / 54F.
const RONCHAO_INDEX = 450;
const RONCHAO_LANDMARK_ID = 'rongchao-hq';
const RONCHAO_SKIP_INDICES = new Set([RONCHAO_INDEX]);
if (!DATA.landmarks.some(l => l.id === RONCHAO_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: RONCHAO_LANDMARK_ID, name: '荣超高新区联合总部大厦',
    en: 'Rongchao High-Tech Joint HQ', x: 1183, z: -879,
    buildings: [RONCHAO_INDEX], source: 'osm',
    note: '230 m/54F 方形圆角板塔；东/南横板+12°竖斜板遮阳，北/西仅横板；避难层环带与冠带；无字牌。',
    year: ''
  });
}

// OSM 620/605: CNOOC twin towers, 210 m / 45F each.
const CNOOC_INDICES = [620, 605];
const CNOOC_LANDMARK_ID = 'cnooc-twins';
const CNOOC_SKIP_INDICES = new Set(CNOOC_INDICES);
if (!DATA.landmarks.some(l => l.id === CNOOC_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: CNOOC_LANDMARK_ID, name: '中海油大厦 A/B 座',
    en: 'CNOOC Twin Towers', x: 769, z: 560,
    buildings: CNOOC_INDICES.slice(), source: 'osm',
    note: '双塔 210 m/45F；拉长六边形平面、弧线收分、海浪飘带裙房；冠线双塔同亮。',
    year: ''
  });
}

// OSM 633/631: Aerospace Science & Technology Plaza A/B.
const AEROSPACE_INDICES = [633, 631];
const AEROSPACE_LANDMARK_ID = 'aerospace-plaza';
const AEROSPACE_SKIP_INDICES = new Set(AEROSPACE_INDICES);
if (!DATA.landmarks.some(l => l.id === AEROSPACE_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: AEROSPACE_LANDMARK_ID, name: '航天科技广场 A/B 座',
    en: 'Aerospace Science & Technology Plaza', x: 1064.5, z: -231.5,
    buildings: AEROSPACE_INDICES.slice(), source: 'osm',
    note: 'A 232.1 m/50F，B 130 m/31F；圆角玻璃双塔 + 六层共享裙房；横向/竖向遮阳格栅。',
    year: ''
  });
}

// OSM 896: Shenzhen Capital Plaza, 261.3 m / 55F crystal tower.
const CAPITAL_INDEX = 896;
const CAPITAL_LANDMARK_ID = 'capital-plaza';
const CAPITAL_SKIP_INDICES = new Set([CAPITAL_INDEX]);
if (!DATA.landmarks.some(l => l.id === CAPITAL_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: CAPITAL_LANDMARK_ID, name: '深创投广场',
    en: 'Shenzhen Capital Plaza', x: 1391, z: -121,
    buildings: [CAPITAL_INDEX], source: 'osm',
    note: '261.3 m / 55 层方塔；折叠钻石幕墙、旋转裙房、冠部隐光；无字牌。',
    year: ''
  });
}

// OSM 1541: Hytera Global Headquarters, 258 m / 43F.
const HYTERA_INDEX = 1541;
const HYTERA_LANDMARK_ID = 'hytera-hq';
const HYTERA_SKIP_INDICES = new Set([HYTERA_INDEX]);
if (!DATA.landmarks.some(l => l.id === HYTERA_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: HYTERA_LANDMARK_ID, name: '海能达全球总部大厦',
    en: 'Hytera Global Headquarters', x: 757, z: 1089,
    buildings: [HYTERA_INDEX], source: 'osm',
    note: '258 m / 43 层长板塔；核心筒西偏、东西长立面三角桁架、悬浮裙楼、向东斜切冠部；无字牌。',
    year: ''
  });
}

// OSM 2404 Shenzhen University Performance Center; OSM height 3.2 m is damaged.
const SZU_INDEX = 2404;
const SZU_LANDMARK_ID = 'szu-performance';
const SZU_SKIP_INDICES = new Set([SZU_INDEX]);
if (DATA.buildings[SZU_INDEX]) {
  const b = DATA.buildings[SZU_INDEX];
  b._osmHeight = b.height;
  b.height = 24.0;
  if (!DATA.landmarks.some(l => l.id === SZU_LANDMARK_ID)) {
    DATA.landmarks.push({
      id: SZU_LANDMARK_ID, name: '深圳大学演会中心',
      en: 'SZU Performance Center', x: 259.15, z: -1802.42,
      buildings: [SZU_INDEX], source: 'osm',
      note: '索引 2404 数据高度 3.2 米系损坏数据，本次按 24 米建模，需用户核对。',
      year: ''
    });
  }
}

// OSM 118 Poly Theatre + 117 Poly Cultural Plaza, one shared complex.
const POLY_INDICES = [118, 117];
const POLY_LANDMARK_ID = 'poly-complex';
const POLY_SKIP_INDICES = new Set(POLY_INDICES);
if (!DATA.landmarks.some(l => l.id === POLY_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: POLY_LANDMARK_ID,
    name: '深圳保利剧院 · 保利文化广场',
    en: 'Poly Theatre / Cultural Plaza',
    x: 694.0, z: 67.0,
    buildings: POLY_INDICES.slice(),
    source: 'osm',
    note: '剧院全精模 + 文化广场准精模；共享前广场，剧院与广场同属一个综合体。',
    year: ''
  });
}

// OSM 119 / 121: Coastal City East + West, two low 25.6 m retail blocks.
const COASTAL_INDICES = [119, 121];
const COASTAL_LANDMARK_ID = 'coastal-city';
const COASTAL_SKIP_INDICES = new Set(COASTAL_INDICES);
if (!DATA.landmarks.some(l => l.id === COASTAL_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: COASTAL_LANDMARK_ID,
    name: '海岸城东座 · 西座',
    en: 'Coastal City East / West',
    x: 565.5, z: -101.0,
    buildings: COASTAL_INDICES.slice(),
    source: 'osm',
    note: '8 层 / 25.6 m 商业体量；双座、屋顶连桥、退台裙楼，按数据高度建模，不私自加高。',
    year: ''
  });
}

// OSM 422 / 670: neighbours of China Resources Tower, NOT CR headquarters.
const NEIGHBOUR_INDICES = [422, 670];
const NEIGHBOUR_LANDMARK_ID = 'cr-neighbours';
const NEIGHBOUR_SKIP_INDICES = new Set(NEIGHBOUR_INDICES);
if (!DATA.landmarks.some(l => l.id === NEIGHBOUR_LANDMARK_ID)) {
  DATA.landmarks.push({
    id: NEIGHBOUR_LANDMARK_ID,
    name: '春笋邻里 · 万家大厦 / 宝格丽',
    en: 'CR Neighbours',
    x: 1435.5, z: 180.0,
    buildings: NEIGHBOUR_INDICES.slice(),
    source: 'osm',
    note: '春笋邻里楼，不是华润总部本部建筑；高度/反射/亮度均低于春笋。',
    year: ''
  });
}

// OSM buildings[1670] "深圳小米大厦": 41.6 m / 13 F / 66×97 m.
const XIAOMI_INDEX = 1670;
const XIAOMI_LANDMARK_ID = 'xiaomi-shenzhen';
const XIAOMI_SKIP_INDICES = new Set([XIAOMI_INDEX]);
if (DATA.buildings[XIAOMI_INDEX] && !DATA.landmarks.some(l => l.id === XIAOMI_LANDMARK_ID)) {
  const b = DATA.buildings[XIAOMI_INDEX];
  const p0 = b.p || [];
  const xs = p0.filter((_, i) => i % 2 === 0);
  const zs = p0.filter((_, i) => i % 2 === 1);
  if (xs.length && zs.length) {
    DATA.landmarks.push({
      id: XIAOMI_LANDMARK_ID,
      name: '深圳小米大厦',
      en: 'Xiaomi Shenzhen Headquarters',
      x: xs.reduce((s, v) => s + v, 0) / xs.length,
      z: zs.reduce((s, v) => s + v, 0) / zs.length,
      buildings: [XIAOMI_INDEX],
      source: 'osm',
      note: '小米魔方：4 层架空圆角裙房 + LED 环幕 + 悬浮方格塔楼；低矮体量，不另加塔冠。',
      year: ''
    });
  }
}

// OSM buildings[880] is the unnamed circular commercial tower west of Lenovo.
// The photo/position check identifies it as Dajia; use the official 273 m / 57
// floors for the model, keep the 314 m / 62 F data in the report. Do NOT touch
// 892, which is a different tower and not this group.
const DAJIA_INDEX = 880;
const DAJIA_LANDMARK_ID = 'dajia';
const DAJIA_SKIP_INDICES = new Set([DAJIA_INDEX]);
if (DATA.buildings[DAJIA_INDEX]) {
  const b = DATA.buildings[DAJIA_INDEX];
  b._osmHeight = b.height;
  b._osmLevels = b.levels;
  b.height = 273.0;
  b.levels = 57;
  b.n = '大家财险总部大厦';
  const p0 = b.p || [];
  const xs = p0.filter((_, i) => i % 2 === 0);
  const zs = p0.filter((_, i) => i % 2 === 1);
  if (!DATA.landmarks.some(l => l.id === DAJIA_LANDMARK_ID) && xs.length && zs.length) {
    DATA.landmarks.push({
      id: DAJIA_LANDMARK_ID,
      name: '大家财险总部大厦',
      en: 'Dajia Insurance Headquarters',
      x: xs.reduce((s, v) => s + v, 0) / xs.length,
      z: zs.reduce((s, v) => s + v, 0) / zs.length,
      buildings: [DAJIA_INDEX],
      source: 'osm',
      note: '圆柱沙漏塔；OSM 数据 314 m/62 层，官方口径 273 m/57 层，模型按官方高度；配套 C11 附楼在 OSM 中无对应记录，本轮不做。',
      year: ''
    });
  }
}

// OSM buildings[421] is "瑞府", the Andaz / Ruifu mixed tower just east of the
// Spring Bamboo. Rename it to the hotel identity and anchor a landmark on the
// OSM centroid; height/footprint remain untouched.
const ANDAZ_INDEX = 421;
const ANDAZ_LANDMARK_ID = 'andaz';
const ANDAZ_SKIP_INDICES = new Set([ANDAZ_INDEX]);
const LENOVO_LANDMARK_ID = 'lenovo-houhai';
const LENOVO_INDICES = [878, 879];
const LENOVO_SKIP_INDICES = new Set(LENOVO_INDICES);
if (!DATA.landmarks.some(l => l.id === LENOVO_LANDMARK_ID)) {
  const a = DATA.buildings[878], b = DATA.buildings[879];
  if (a && b && a.p && b.p) {
    const ax = a.p.filter((_, i) => i % 2 === 0).reduce((s, v) => s + v, 0) / (a.p.length / 2);
    const az = a.p.filter((_, i) => i % 2 === 1).reduce((s, v) => s + v, 0) / (a.p.length / 2);
    const bx = b.p.filter((_, i) => i % 2 === 0).reduce((s, v) => s + v, 0) / (b.p.length / 2);
    const bz = b.p.filter((_, i) => i % 2 === 1).reduce((s, v) => s + v, 0) / (b.p.length / 2);
    DATA.landmarks.push({
      id: LENOVO_LANDMARK_ID,
      name: '联想后海中心',
      en: 'Lenovo Houhai Center',
      x: (ax + bx) / 2, z: (az + bz) / 2,
      buildings: LENOVO_INDICES.slice(),
      source: 'osm',
      note: 'A 座 203.5 m / 42 层，B 座 132.7 m / 28 层，两层商业裙楼连接；本轮保留卓越后海中心不动。',
      year: ''
    });
  }
}

if (DATA.buildings[ANDAZ_INDEX]) {
  const b = DATA.buildings[ANDAZ_INDEX];
  b.n = '安达仕';
  const p = b.p || [];
  const xs = p.filter((_, i) => i % 2 === 0);
  const zs = p.filter((_, i) => i % 2 === 1);
  if (!DATA.landmarks.some(l => l.id === ANDAZ_LANDMARK_ID) && xs.length && zs.length) {
    DATA.landmarks.push({
      id: ANDAZ_LANDMARK_ID,
      name: '深圳湾安达仕',
      en: 'ANDAZ Shenzhen Bay',
      x: xs.reduce((s, v) => s + v, 0) / xs.length,
      z: zs.reduce((s, v) => s + v, 0) / zs.length,
      buildings: [ANDAZ_INDEX],
      source: 'osm',
      note: '低区为深圳湾安达仕酒店，上部为瑞府府邸；春笋东侧约 90 米的直板混合塔。',
      year: ''
    });
  }
}
if (!DATA.landmarks.some(l => l.id === SBO_LANDMARK_ID)) {
  const t7b = DATA.buildings[SBO_T7_INDEX];
  const t7p = t7b && t7b.p ? t7b.p : [];
  const t7xs = t7p.filter((_, i) => i % 2 === 0);
  const t7zs = t7p.filter((_, i) => i % 2 === 1);
  if (t7xs.length && t7zs.length) {
    DATA.landmarks.push({
      id: SBO_LANDMARK_ID,
      name: '深圳湾一号',
      en: 'Shenzhen Bay One',
      x: t7xs.reduce((s, v) => s + v, 0) / t7xs.length,
      z: t7zs.reduce((s, v) => s + v, 0) / t7zs.length,
      buildings: SBO_TOWER_INDICES.slice(),
      source: 'osm',
      note: 'T7 主塔与 T2/T4/T5/T6/T8 组成的滨海住宅组团，裙楼连接六塔。',
      year: ''
    });
  }
}



bootStatus.textContent = '正在搭建山、海与城市底座…';

// ── camera controls (lightweight inline OrbitControls) ───────
// The vendored Three.js r128 build is a single file (no examples/jsm),
// so the orbiting / panning / zooming controller is implemented inline
// with the same gesture semantics as OrbitControls (left drag, wheel,
// right drag, pinch).
class OrbitControls {
  constructor(cam, element) {
    this.camera = cam;
    this.dom = element;
    this.target = new THREE.Vector3(15, 4, 45);
    this.targetGoal = this.target.clone();
    this.theta = 0.50;
    this.phi = 1.00;
    this.radius = 360;
    this.thetaGoal = this.theta;
    this.phiGoal = this.phi;
    this.radiusGoal = this.radius;
    this.autoRotate = false;
    this.autoSpeed = 0.065;
    this.autoPauseAt = 0;
    this.dragging = false;
    this.mode = null;
    this.pointers = new Map();
    this.down = null;
    this.lastPinch = 0;
    this.initial = { theta: 0.50, phi: 1.00, radius: 360, target: new THREE.Vector3(15, 4, 45) };
    this.enabled = true;
    this.onTap = null;
    this._bind();
  }
  _bind() {
    const dom = this.dom;
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('pointerdown', (e) => this._down(e));
    dom.addEventListener('pointermove', (e) => this._move(e));
    dom.addEventListener('pointerup', (e) => this._up(e));
    dom.addEventListener('pointercancel', (e) => this._up(e));
    dom.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.enabled) return;
      const f = Math.pow(1.0018, e.deltaY);
      this.radiusGoal = clamp(this.radiusGoal * f, 58, 620);
    }, { passive: false });
  }
  _down(e) {
    if (!this.enabled) return;
    this.dom.setPointerCapture && this.dom.setPointerCapture(e.pointerId);
    this.autoPauseAt = performance.now() + 3000;
    if (this.pointers.size === 0) this.cancelFlight();
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.dragging = true;
      this.mode = (e.button === 2 || e.button === 1 || e.shiftKey) ? 'pan' : 'rotate';
      this.down = { x: e.clientX, y: e.clientY, moved: 0 };
      this.dom.classList.add('is-grabbing');
    } else if (this.pointers.size === 2) {
      this.mode = 'pinch';
      this.lastPinch = this._pinchDistance();
    }
  }
  _pinchDistance() {
    const p = Array.from(this.pointers.values());
    return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
  }
  _move(e) {
    if (!this.enabled) return;
    if (!this.pointers.has(e.pointerId)) return;
    this.autoPauseAt = performance.now() + 3000;
    const prev = this.pointers.get(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.mode === 'pinch' && this.pointers.size >= 2) {
      const d = this._pinchDistance();
      if (this.lastPinch > 0) this.radiusGoal = clamp(this.radiusGoal * (this.lastPinch / d), 58, 620);
      this.lastPinch = d;
      return;
    }
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.abs(dx) + Math.abs(dy) > 1 && this.down) this.down.moved += Math.abs(dx) + Math.abs(dy);
    if (this.mode === 'rotate') {
      this.thetaGoal -= dx * 0.0047;
      this.phiGoal = clamp(this.phiGoal - dy * 0.0036, 0.19, 1.37);
    } else if (this.mode === 'pan') {
      const scale = this.radius * 0.0019;
      const c = Math.cos(this.thetaGoal), s = Math.sin(this.thetaGoal);
      this.targetGoal.x += (-c * dx + s * dy) * scale;
      this.targetGoal.z += (s * dx + c * dy) * scale;
      this.targetGoal.x = clamp(this.targetGoal.x, -168, 168);
      this.targetGoal.z = clamp(this.targetGoal.z, -145, 195);
    }
  }
  _up(e) {
    if (!this.enabled) return;
    const wasMoved = this.down ? this.down.moved : 0;
    const tap = this.down && wasMoved < 6 && e.button === 0;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.mode = null;
      this.dom.classList.remove('is-grabbing');
      this.down = null;
      if (tap && typeof this.onTap === 'function') this.onTap(e.clientX, e.clientY);
    } else if (this.pointers.size === 1) {
      this.mode = 'rotate';
      this.lastPinch = 0;
    }
  }
  focus(x, y, z, radius) {
    if (!this.enabled) return;
    this.targetGoal.set(x, y, z);
    this.radiusGoal = clamp(radius || 128, 58, 330);
    this.phiGoal = clamp(0.99, 0.25, 1.25);
    this.autoRotate = true;
    this.autoSpeed = 0.045;
  }
  cancelFlight() {
    this.thetaGoal = this.theta;
    this.phiGoal = this.phi;
    this.radiusGoal = this.radius;
    this.targetGoal.copy(this.target);
  }
  reset() {
    this.thetaGoal = this.initial.theta;
    this.phiGoal = this.initial.phi;
    this.radiusGoal = this.initial.radius;
    this.targetGoal.copy(this.initial.target);
    this.autoRotate = false;
  }
  update(dt) {
    if (!this.enabled) return;
    if (this.autoRotate && !this.dragging && performance.now() > this.autoPauseAt) this.thetaGoal += this.autoSpeed * dt;
    const k = 1 - Math.exp(-dt * 10);
    this.theta += (this.thetaGoal - this.theta) * k;
    this.phi += (this.phiGoal - this.phi) * k;
    this.radius += (this.radiusGoal - this.radius) * (1 - Math.exp(-dt * 8));
    this.target.lerp(this.targetGoal, 1 - Math.exp(-dt * 7));
    const sp = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sp * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}
const controls = new OrbitControls(camera, canvas);
// Only one controller owns camera motion at a time. Roaming uses meters * PLAN
// on X/Z and 1.7 m * HS for the eye offset above a fixed road-height floor.
let roamSnapshot = null;
const roam = window.YuehaiRoam.create({
  canvas, camera, plan: PLAN, eyeY: ROAD_Y + .02 + 1.7 * HS,
  bounds: { minX: -2500 * PLAN, maxX: 2500 * PLAN, minZ: -2500 * PLAN, maxZ: 2300 * PLAN },
  hud: $('roamHud'), pad: $('roamPad'), status: $('roamStatus'),
  entryButton: $('enterRoam'), exitButton: $('roamExit'),
  overviewButton: $('roamOverview'), resetButton: $('roamReset'),
  getSpawn: findRoamSpawn,
  onUnavailable: () => showCardNotice('暂未找到安全道路起点，请返回总览后重试。', 6000),
  onEnter: () => {
    roamSnapshot = {
      mode: state.camera, target: controls.target.clone(),
      theta: controls.theta, phi: controls.phi, radius: controls.radius,
      autoRotate: controls.autoRotate, autoSpeed: controls.autoSpeed,
      near: camera.near, fov: camera.fov
    };
    for (const id of controls.pointers.keys()) {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    controls.pointers.clear(); controls.down = null; controls.dragging = false; controls.mode = null;
    canvas.classList.remove('is-grabbing', 'is-hovering');
    controls.enabled = false; controls.autoRotate = false;
    state.camera = 'roam';
    setImmersive(false);
    $('tooltip').classList.remove('is-visible');
    camera.near = .015; camera.fov = 65; camera.updateProjectionMatrix();
    document.querySelectorAll('#cameraSeg button').forEach(b => b.classList.remove('is-active'));
    $('enterRoam').setAttribute('aria-pressed', 'true');
  },
  onMove: (pos) => { controls.target.set(pos.x, 0, pos.z); }, // shadow focus, not orbital motion
  onExit: (overview) => {
    const saved = roamSnapshot;
    controls.enabled = true;
    camera.near = saved.near; camera.fov = saved.fov; camera.updateProjectionMatrix();
    controls.autoPauseAt = 0;
    if (overview) {
      controls.reset();
      state.camera = 'free';
    } else {
      controls.thetaGoal = saved.theta; controls.phiGoal = saved.phi;
      controls.radiusGoal = saved.radius; controls.targetGoal.copy(saved.target);
      controls.autoRotate = saved.autoRotate; controls.autoSpeed = saved.autoSpeed;
      state.camera = saved.mode;
    }
    controls.theta = controls.thetaGoal; controls.phi = controls.phiGoal;
    controls.radius = controls.radiusGoal; controls.target.copy(controls.targetGoal);
    controls.update(0);
    document.querySelectorAll('#cameraSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.camera === state.camera));
    $('enterRoam').setAttribute('aria-pressed', 'false');
    updateLabels();
  }
});

function findRoamSpawn() {
  // Try road centerline samples near Keyuan South Road first. No external data.
  // Avoid OSM footprints AND actual visible bespoke geometry (e.g. podiums).
  const candidates = [];
  for (const road of DATA.roads) {
    if (!['primary','secondary','tertiary','residential'].includes(road.c)) continue;
    const pts = road.p || [];
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const [ax, az, bx, bz] = pts.slice(i, i + 4);
      if (Math.hypot(bx - ax, bz - az) < 25) continue;
      const x = (ax + bx) / 2, z = (az + bz) / 2;
      if (x < -2450 || x > 2450 || z < -2450 || z > 2200) continue;
      candidates.push({ x: wx(x), z: wz(z), yaw: Math.atan2(-(bx - ax), -(bz - az)), score: Math.hypot(x - 1460, z + 450) });
    }
  }
  candidates.sort((a,b) => a.score - b.score);
  scene.updateMatrixWorld(true);
  const meshes = [];
  // Check hidden building layer too: entering roam must not spawn inside it.
  function collect(obj) {
    for (const child of obj.children) {
      if (!child.visible && !child.userData.roamSpawnCheck) continue;
      if (child.isMesh) meshes.push(child);
      collect(child);
    }
  }
  collect(buildingsGroup);
  const probe = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0,-1,0), 0, 600);
  function inFootprint(x, z, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 2; i < polygon.length; j = i, i += 2) {
      const ax = polygon[i], az = polygon[i + 1], bx = polygon[j], bz = polygon[j + 1];
      if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
    }
    return inside;
  }
  // A small 5-point safety buffer at the start only; movement has NO collision.
  const offsets = [[0,0],[.17,0],[-.17,0],[0,.17],[0,-.17]];
  for (const c of candidates.slice(0, 120)) {
    let occupied = false;
    for (const [dx,dz] of offsets) {
      const x = c.x + dx, z = c.z + dz;
      if (DATA.buildings.some(b => inFootprint(x / PLAN, z / PLAN, b.p || []))) { occupied = true; break; }
      probe.ray.origin.set(x, 500, z);
      if (probe.intersectObjects(meshes, false).some(h => h.point.y >= BUILD_Y)) { occupied = true; break; }
    }
    if (!occupied) return c;
  }
  return null;
}

// ── lights ───────────────────────────────────────────────────
const hemi = new THREE.HemisphereLight(0x9bb9aa, 0x1a2418, 0.55);
scene.add(hemi);
const ambient = new THREE.AmbientLight(0x514f3d, 0.08);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffe1b1, 1.2);
sun.position.set(190, 250, 90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -350;
sun.shadow.camera.right = 350;
sun.shadow.camera.top = 350;
sun.shadow.camera.bottom = -350;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 1400;
sun.shadow.bias = -0.00022;
sun.shadow.normalBias = .018;
sun.target.position.set(0, 0, -16);
scene.add(sun.target);
scene.add(sun);
const moon = new THREE.DirectionalLight(0xa8bde0, 0);
moon.position.set(-160, 180, -80);
moon.castShadow = false;
moon.visible = false;
moon.target.position.set(0, 0, -16);
scene.add(moon.target);
scene.add(moon);
const SHADOW_EXTENT = 350;
const SUN_DISTANCE = 650;
const shadowFocus = new THREE.Vector3();
const shadowRight = new THREE.Vector3();
const shadowUp = new THREE.Vector3();
const shadowForward = new THREE.Vector3();
const shadowSnapped = new THREE.Vector3();

// ── sky dome & stars ─────────────────────────────────────────
const skyUniforms = {
  uTop: { value: new THREE.Color(0x203933) },
  uHorizon: { value: new THREE.Color(0x9b9f89) },
  uSunDir: { value: new THREE.Vector3(0.4, 0.5, 0.2) },
  uSunColor: { value: new THREE.Color(0xffdfad) },
  uSunStrength: { value: 0.7 },
  uCloud: { value: 0.1 },
  uNight: { value: 0 }
};
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(760, 32, 20),
  new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    toneMapped: false,
    vertexShader: `
      varying vec3 vDir;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = normalize(wp.xyz - cameraPosition);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uTop;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uSunStrength;
      uniform float uCloud;
      uniform float uNight;
      void main(){
        vec3 d = normalize(vDir);
        float up = clamp(d.y, -0.15, 1.0);
        float t = smoothstep(-0.04, 0.78, up);
        vec3 col = mix(uHorizon, uTop, t);
        col += uHorizon * pow(max(0.0, 1.0 - abs(up) * 2.2), 5.0) * 0.12;
        float sunDot = max(dot(d, normalize(uSunDir)), 0.0);
        float disc = pow(sunDot, 950.0) * 2.6;
        float halo = pow(sunDot, 18.0) * 0.16;
        col += uSunColor * (disc + halo) * uSunStrength;
        float horizonGlow = pow(max(0.0, 1.0 - abs(up) * 3.1), 4.0);
        col += vec3(.17, .095, .045) * horizonGlow * uNight * .85;
        float haze = (1.0 - smoothstep(-0.02, 0.28, up)) * 0.055 * uCloud;
        col = mix(col, uHorizon * 0.82, haze);
        gl_FragColor = vec4(col, 1.0);
      }
    `
  })
);
sky.frustumCulled = false;
sky.renderOrder = -100;
scene.add(sky);

const starGeo = new THREE.BufferGeometry();
{
  const n = 900;
  const pos = new Float32Array(n * 3);
  const sr = mulberry32(7729);
  for (let i = 0; i < n; i++) {
    const theta = sr() * TAU;
    const y = 0.05 + sr() * 0.92;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(theta) * r * 690;
    pos[i * 3 + 1] = y * 690;
    pos[i * 3 + 2] = Math.sin(theta) * r * 690;
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
}
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
  color: 0xdce9df, size: 1.35, sizeAttenuation: true, transparent: true,
  opacity: 0, depthWrite: false, fog: false, blending: THREE.AdditiveBlending
}));
stars.renderOrder = -90;
scene.add(stars);

// ── geometry helpers ────────────────────────────────────────
function pushTriangle(arr, a, b, c) {
  arr.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}
function addFootprintTop(positions, colors, ring, y, color) {
  // ring: [ [x,z], ... ] ; returns number of triangles pushed
  const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
  let faces = [];
  try { faces = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { faces = []; }
  if (!faces.length) {
    // fallback bounding rectangle
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    const r = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]];
    pushTriangle(positions, [r[0][0], y, r[0][1]], [r[1][0], y, r[1][1]], [r[2][0], y, r[2][1]]);
    pushTriangle(positions, [r[0][0], y, r[0][1]], [r[2][0], y, r[2][1]], [r[3][0], y, r[3][1]]);
    for (let i = 0; i < 6; i++) colors.push(color.r, color.g, color.b);
    return 2;
  }
  let count = 0;
  for (const f of faces) {
    let a = ring[f[0]], b = ring[f[1]], c = ring[f[2]];
    const crossY = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (crossY > 0) { const t = b; b = c; c = t; }
    positions.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
    for (let i = 0; i < 3; i++) colors.push(color.r, color.g, color.b);
    count++;
  }
  return count;
}
function addPrism(positions, colors, ring, height, sideColor, roofColor, bottom) {
  const y0 = bottom || 0;
  const y1 = y0 + height;
  const baseCount = positions.length / 3;
  const n = ring.length;
  // sides
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dark = sideColor.clone().multiplyScalar(0.82);
    // a0, b0, b1 / a0, b1, a1
    positions.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1]);
    colors.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, sideColor.r, sideColor.g, sideColor.b);
    positions.push(a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
    colors.push(dark.r, dark.g, dark.b, sideColor.r, sideColor.g, sideColor.b, sideColor.r, sideColor.g, sideColor.b);
  }
  const sideTriangles = n * 2;
  addFootprintTop(positions, colors, ring, y1, roofColor);
  const topTriangles = positions.length / 3 / 3 - baseCount / 3 - sideTriangles;
  return { startFace: baseCount / 3, endFace: positions.length / 9, topTriangles };
}
function addBoxToArrays(positions, colors, x, y, z, sx, sy, sz, color, rotY) {
  const c = Math.cos(rotY || 0), s = Math.sin(rotY || 0);
  const pts = [[-sx/2, 0, -sz/2], [sx/2, 0, -sz/2], [sx/2, 0, sz/2], [-sx/2, 0, sz/2]];
  const p = pts.map(([a,b,c2]) => [x + a*c + c2*s, y + b, z - a*s + c2*c]);
  const top = p.map(v => [v[0], y + sy, v[2]]);
  const faceColor = color;
  const dark = color.clone().multiplyScalar(0.72);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    pushTriangle(positions, p[i], p[j], top[j]); colors.push(dark.r,dark.g,dark.b,dark.r,dark.g,dark.b,faceColor.r,faceColor.g,faceColor.b);
    pushTriangle(positions, p[i], top[j], top[i]); colors.push(dark.r,dark.g,dark.b,faceColor.r,faceColor.g,faceColor.b,faceColor.r,faceColor.g,faceColor.b);
  }
  pushTriangle(positions, top[0], top[1], top[2]); colors.push(faceColor.r,faceColor.g,faceColor.b,faceColor.r,faceColor.g,faceColor.b,faceColor.r,faceColor.g,faceColor.b);
  pushTriangle(positions, top[0], top[2], top[3]); colors.push(faceColor.r,faceColor.g,faceColor.b,faceColor.r,faceColor.g,faceColor.b,faceColor.r,faceColor.g,faceColor.b);
}
function flatPointsToVectors(flat, scale=PLAN) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i] * scale, flat[i + 1] * scale]);
  return out;
}
function pathLengthWorld(points) {
  let L = 0; const cum = [0];
  for (let i = 1; i < points.length; i++) {
    L += Math.hypot(points[i][0] - points[i-1][0], points[i][1] - points[i-1][1]);
    cum.push(L);
  }
  return { length: L, cumulative: cum };
}

bootStatus.textContent = '正在铺陈海湾与海岸绿带…';

// ── land, sea & coast belt ───────────────────────────────────
const landTopMat = new THREE.MeshStandardMaterial({ color: COLORS.land, roughness: .94, metalness: .02, envMapIntensity: .25 });
const landSideMat = new THREE.MeshStandardMaterial({ color: COLORS.landSide, roughness: .96, metalness: .02, envMapIntensity: .25 });
const landGeo = new THREE.BoxGeometry(LAND_X * 2, 7.5, LAND_SOUTH - LAND_NORTH);
const land = new THREE.Mesh(landGeo, [landSideMat, landSideMat, landTopMat, landSideMat, landSideMat, landSideMat]);
land.position.set(0, -3.75, (LAND_SOUTH + LAND_NORTH) / 2);
land.receiveShadow = true;
world.add(land);

// subtle urban ground grid
{
  const positions = [], colors = [];
  const c = new THREE.Color(0x6b7b68);
  const step = 18;
  for (let x = -LAND_X + 12; x < LAND_X; x += step) {
    positions.push(x, 0.035, LAND_NORTH + 4, x, 0.035, LAND_SOUTH - 4);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let z = LAND_NORTH + 12; z < LAND_SOUTH; z += step) {
    positions.push(-LAND_X + 4, 0.035, z, LAND_X - 4, 0.035, z);
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .055, depthWrite: false }));
  world.add(lines);
}

// coastline definition
function coastZ(x) {
  return COAST_BASE + Math.sin(x * 0.039 + 0.3) * 1.15 + Math.sin(x * 0.097 + 1.8) * 0.55 + Math.sin(x * 0.016 - 1.1) * 1.2;
}
const coastPoints = [];
for (let x = -176; x <= 176; x += 2.5) coastPoints.push([x, coastZ(x)]);
// green belt & promenade strip
function addStrip(positions, colors, left, right, y, color) {
  for (let i = 0; i < left.length - 1; i++) {
    const a = left[i], b = left[i+1], c = right[i+1], d = right[i];
    pushTriangle(positions, [a[0],y,a[1]], [d[0],y,d[1]], [c[0],y,c[1]]);
    pushTriangle(positions, [a[0],y,a[1]], [c[0],y,c[1]], [b[0],y,b[1]]);
    for (let k=0;k<6;k++) colors.push(color.r,color.g,color.b);
  }
}
{
  const p = [], c = [];
  const grass = new THREE.Color(0x213c2b);
  const inner = coastPoints.map(([x,z]) => [x, z - 11.5]);
  const mid = coastPoints.map(([x,z]) => [x, z - 6.3]);
  const walk = coastPoints.map(([x,z]) => [x, z - 3.7]);
  const sand = coastPoints.map(([x,z]) => [x, z - 0.2]);
  addStrip(p, c, inner, mid, 0.055, grass);
  addStrip(p, c, mid, walk, 0.064, new THREE.Color(0x20372a));
  addStrip(p, c, walk, sand, 0.072, new THREE.Color(0xa59677));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: .01, envMapIntensity: .25 }));
  mesh.receiveShadow = true;
  world.add(mesh);
  // gold promenade edge
  const edgeGeo = new THREE.BufferGeometry().setFromPoints(walk.map(([x,z]) => new THREE.Vector3(x, .13, z)));
  world.add(new THREE.Line(edgeGeo, new THREE.LineBasicMaterial({ color: 0xd0b986, transparent: true, opacity: .36, depthWrite: false })));
}

// water shader
const waterUniforms = {
  uTime: { value: 0 },
  uDay: { value: 1 },
  uNight: { value: 0 },
  uLightPower: { value: 0 },
  uFogColor: { value: new THREE.Color(0x0a1611) },
  uSunColor: { value: new THREE.Color(0xffe1b1) },
  uSunDir: { value: new THREE.Vector3(0.4, .5, .2) }
};
const waterShape = new THREE.Shape();
waterShape.moveTo(-360, -560);
for (const [x, z] of coastPoints) waterShape.lineTo(x, -(z - 0.7));
waterShape.lineTo(360, -560);
waterShape.closePath();
const waterGeo = new THREE.ShapeGeometry(waterShape);
const waterMat = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: false,
  fog: false,
  vertexShader: `
    uniform float uTime;
    varying vec3 vWorld;
    varying vec3 vView;
    void main(){
      vec3 p = position;
      p.z += sin(p.x * .14 + uTime * .7) * .12 + sin(p.y * .19 - uTime * .5) * .08;
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vWorld = wp.xyz;
      vView = cameraPosition - wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uDay;
    uniform float uNight;
    uniform float uLightPower;
    uniform vec3 uFogColor;
    uniform vec3 uSunColor;
    uniform vec3 uSunDir;
    varying vec3 vWorld;
    varying vec3 vView;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
    void main(){
      vec2 p = vWorld.xz;
      float t = uTime;
      float w1 = sin(p.x * .065 + t * .30 + sin(p.y * .12) * 1.4);
      float w2 = sin(p.y * .095 - t * .22 + sin(p.x * .08) * 1.2);
      float w3 = sin((p.x + p.y) * .035 + t * .12);
      float ripple = (w1 + w2 + w3) / 3.0;
      float bands = smoothstep(.70, .98, sin(p.x * .05 + p.y * .10 + ripple * 5.0 + t * .22) * .5 + .5);
      vec3 deep = vec3(.016, .13, .16);
      vec3 shallow = vec3(.045, .34, .33);
      float depthMix = smoothstep(132.0, 238.0, vWorld.z);
      vec3 col = mix(shallow, deep, depthMix * .78);
      col += vec3(.02, .085, .085) * ripple;
      col += uSunColor * bands * (.07 + uDay * .15);
      float streak = smoothstep(.82, 1.0, sin(p.x * .018 + p.y * .21 + t * .1) * .5 + .5);
      float nearShore = smoothstep(128.0, 152.0, vWorld.z) * (1.0 - smoothstep(198.0, 252.0, vWorld.z));
      float cityReflection = pow(max(0.0, sin(p.x * .17 + sin(p.y * .045 + t * .08) * 2.2)), 7.0);
      float tealReflection = pow(max(0.0, sin(p.x * .09 - p.y * .07 + t * .03)), 4.0);
      float lp = uNight * uLightPower;
      col += vec3(.46, .245, .09) * streak * lp * .62 * smoothstep(146.0, 230.0, vWorld.z);
      col += vec3(.37, .19, .065) * cityReflection * lp * nearShore * 1.15;
      col += vec3(.075, .30, .25) * tealReflection * lp * .16;
      float fresnel = pow(1.0 - clamp(abs(normalize(vView).y), 0., 1.), 2.0);
      col += vec3(.075,.13,.13) * fresnel * (.25 + uDay * .2);
      float dist = length(vView);
      float fogFactor = 1.0 - exp(-pow(dist * 0.00125, 2.0));
      col = mix(col, uFogColor, clamp(fogFactor, 0., .86));
      gl_FragColor = vec4(col, 1.0);
    }
  `
});
const water = new THREE.Mesh(waterGeo, waterMat);
water.rotation.x = -Math.PI / 2;
water.position.set(0, SEA_Y, 0);
water.receiveShadow = false;
world.add(water);
// make the water follow the coast line visually: a foam ribbon at the boundary
{
  const pts = coastPoints.map(([x,z]) => new THREE.Vector3(x, SEA_Y + .045, z + .15));
  const foam = new THREE.Line(ptsGeometry(pts), new THREE.LineBasicMaterial({ color: 0xcad9c7, transparent: true, opacity: .34, depthWrite: false }));
  world.add(foam);
  const pts2 = coastPoints.map(([x,z]) => new THREE.Vector3(x, SEA_Y + .04, z - 1.1));
  world.add(new THREE.Line(ptsGeometry(pts2), new THREE.LineBasicMaterial({ color: 0x9ec6b9, transparent: true, opacity: .16, depthWrite: false })));
}
function ptsGeometry(pts) {
  return new THREE.BufferGeometry().setFromPoints(pts);
}
// faint bay name
{
  const el = document.createElement('div');
  el.className = 'water-label';
  el.innerHTML = '<span>深 圳 湾</span><em>SHENZHEN BAY</em>';
  $('labels').appendChild(el);
  window.__bayLabel = el;
}
function updateBayLabel() {
  const el = window.__bayLabel;
  if (!el) return;
  const p = projectToScreen(18, SEA_Y + .3, 172);
  if (!p || !state.layers.labels) { el.style.opacity = '0'; return; }
  el.style.opacity = '1';
  el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
}

// far headlands, low-poly
// The data district is intentionally presented as a floating diorama, so no
// invented mountain range is drawn over it. A low distant ridge would obscure
// the OSM skyline more than it helps.

// water features from OSM (ponds & river polygons)
bootStatus.textContent = '正在注水：河、湖与湿地…';
const osmWaterGroup = new THREE.Group();
{
  const mat = new THREE.MeshStandardMaterial({ color: 0x1b5b56, roughness: .22, metalness: .2, transparent: true, opacity: .88, side: THREE.DoubleSide });
  // polygon rings are re-wound per triangle below so lighting stays upward

  for (const f of DATA.water) {
    const ring = flatPointsToVectors(f.points);
    if (ring.length < 3) continue;
    const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
    const faces = THREE.ShapeUtils.triangulateShape(contour, []);
    if (!faces.length) continue;
    const pos = [];
    for (const face of faces) {
      for (const idx of face) pos.push(ring[idx][0], 0.11, ring[idx][1]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = false;
    osmWaterGroup.add(mesh);
  }
  world.add(osmWaterGroup);
}

// coast trees
bootStatus.textContent = '正在种下海岸林木…';
const treeGroup = new THREE.Group();
{
  const trunkGeo = new THREE.CylinderGeometry(.11, .17, 1, 5);
  const crownGeo = new THREE.IcosahedronGeometry(.88, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4f4737, roughness: 1, envMapIntensity: .2, flatShading: true });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0x456947, roughness: 1, envMapIntensity: .2, flatShading: true });
  const positions = [];
  const r = mulberry32(8901);
  for (let i = 0; i < 190; i++) {
    const x = -165 + r() * 330;
    const z = coastZ(x) - 3.2 - r() * 13;
    const s = .55 + r() * .75;
    positions.push([x, .12, z, s, r()]);
  }
  // green pockets in the city, intentionally sparse and only on empty-looking margins
  for (let i = 0; i < 42; i++) {
    const x = -150 + r() * 300;
    const z = -148 + r() * 260;
    positions.push([x, .12, z, .45 + r() * .5, r()]);
  }
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, positions.length);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, positions.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < positions.length; i++) {
    const [x, y, z, s, rv] = positions[i];
    dummy.position.set(x, y + .45 * s, z);
    dummy.scale.set(s, s, s);
    dummy.rotation.set(0, rv * TAU, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + (0.9 + rv * .6) * s, z);
    dummy.scale.set(s * (1 + rv * .5), s * (1.2 + rv * .5), s * (1 + rv * .5));
    dummy.rotation.set(0, rv * 6.2, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    col.setHSL(.25 + rv * .08, .22 + rv * .12, .20 + rv * .08);
    crowns.setColorAt(i, col);
  }
  crowns.instanceColor.needsUpdate = true;
  trunks.castShadow = true; trunks.receiveShadow = true;
  crowns.castShadow = true; crowns.receiveShadow = true;
  trunks.frustumCulled = false; crowns.frustumCulled = false;
  treeGroup.add(trunks, crowns);
  world.add(treeGroup);
}

// ── buildings ────────────────────────────────────────────────
bootStatus.textContent = '正在从 OSM 轮廓挤出 ' + DATA.buildings.length.toLocaleString('zh-CN') + ' 栋建筑…';
const buildingsGroup = new THREE.Group();
const windowsGroup = new THREE.Group();
const roofDetailGroup = new THREE.Group();
let buildingsMesh = null;
const buildingFaceRanges = []; // [startFace, endFace, buildingIndex]
let windowGlowMaterial = null;
let windowMesh = null;
let windowGlowTexture = null;
let windowHaloMesh = null;
let windowHaloMaterial = null;
let windowHaloTexture = null;
const windowInstances = [];
const ordinaryDetailRecords = [];
let ordinaryLOD = null;
let refinedLandmarks = null;
let windowLastUpdate = 0;
let roofDetailMaterial = null;
let glassMesh = null;
let glassMaterial = null;
let landmarkGlassMesh = null;
let landmarkGlassMaterial = null;
const landmarkGlassUniforms = {
  uTop: { value: new THREE.Color(0x8bb6d2) },
  uHorizon: { value: new THREE.Color(0xc7dce3) },
  uSunColor: { value: new THREE.Color(0xffe4bb) },
  uSunDir: { value: new THREE.Vector3(.4, .5, -.2) },
  uNight: { value: 0 },
  uLightPower: { value: 0 },
  uOccupancy: { value: .55 },
  uEnvMap: { value: currentCityEnv },
  uEnvAmount: { value: 1 },
  uFogColor: { value: new THREE.Color(0x0a1611) },
  uFogDensity: { value: .00135 }
};
let crownMesh = null;
let crownMaterial = null;
let crownSegmentCount = 0;
let crTowerGroup = null;
let crTowerMaterial = null;
let crTowerUniforms = null;
let crLobbyMaterial = null;
let crLobbyGlassMaterial = null;
const crPickMeshes = [];
const tencentPickMeshes = [];
const mixcPickMeshes = [];
const sboPickMeshes = [];
const andazPickMeshes = [];
const lenovoPickMeshes = [];
const dajiaPickMeshes = [];
const xiaomiPickMeshes = [];
const cocoonPickMeshes = [];
const neighbourPickMeshes = [];
const coastalPickMeshes = [];
const polyPickMeshes = [];
const excellencePickMeshes = [];
const portPickMeshes = [];
const szuPickMeshes = [];
const hyteraPickMeshes = [];
const capitalPickMeshes = [];
const aerospacePickMeshes = [];
const cnoocPickMeshes = [];
const rongchaoPickMeshes = [];
const venturePickMeshes = [];
const officeWallPickMeshes = [];
const bytedancePickMeshes = [];
const hisensePickMeshes = [];
const xunleiPickMeshes = [];
const ventureNeighborPickMeshes = [];
const eastWallPickMeshes = [];
const innovationPickMeshes = [];
const tsinghuaPickMeshes = [];
const chinaOverseasPickMeshes = [];
const yihuaPickMeshes = [];
const lite3PickMeshes = [];
const residentialPickMeshes = [];
const caixunPickMeshes = [];
const buptPickMeshes = [];
const ketongPickMeshes = [];
const youxianPickMeshes = [];
const baiduPickMeshes = [];
const softwarePickMeshes = [];
const tencentHqPickMeshes = [];
const campusPickMeshes = [];
const landmarkPickSets = {
  'china-resources': crPickMeshes, 'tencent-binhai': tencentPickMeshes, 'mixc': mixcPickMeshes,
  'shenzhen-bay-one': sboPickMeshes, 'andaz': andazPickMeshes, 'lenovo-houhai': lenovoPickMeshes,
  'dajia': dajiaPickMeshes, 'xiaomi-shenzhen': xiaomiPickMeshes, 'spring-cocoon': cocoonPickMeshes,
  'cr-neighbours': neighbourPickMeshes, 'coastal-city': coastalPickMeshes, 'poly-complex': polyPickMeshes,
  'excellence-houhai': excellencePickMeshes, 'szbay-port': portPickMeshes, 'szu-performance': szuPickMeshes,
  'hytera-hq': hyteraPickMeshes, 'capital-plaza': capitalPickMeshes, 'aerospace-plaza': aerospacePickMeshes,
  'cnooc-twins': cnoocPickMeshes, 'rongchao-hq': rongchaoPickMeshes, 'venture-capital': venturePickMeshes,
  'haide-office-wall': officeWallPickMeshes, 'bytedance-houhai': bytedancePickMeshes,
  'hisense-south': hisensePickMeshes, 'xunlei-tower': xunleiPickMeshes,
  'venture-neighbors': ventureNeighborPickMeshes, 'venture-east-wall': eastWallPickMeshes,
  'innovation-center': innovationPickMeshes, 'tsinghua-research': tsinghuaPickMeshes,
  'china-overseas': chinaOverseasPickMeshes, 'yihua-tower': yihuaPickMeshes, 'lite3': lite3PickMeshes,
  'caixun-tower': caixunPickMeshes, 'bupt-tower': buptPickMeshes, 'ketong-tower': ketongPickMeshes,
  'youxian-tower': youxianPickMeshes, 'baidu-intl': baiduPickMeshes, 'software-base': softwarePickMeshes,
  'tencent-hq': tencentHqPickMeshes
};
let tencentGlassMaterial = null;
let tencentNightMaterial = null;
let mixcGlassMaterial = null;
let mixcNightMaterial = null;
let sboT7GlassMaterial = null;
let sboOtherGlassMaterial = null;
let sboNightMaterial = null;
let andazGlassMaterial = null;
let andazSignMaterial = null;
let andazNightMaterial = null;
let lenovoGlassMaterial = null;
let lenovoSignMaterial = null;
let lenovoNightMaterial = null;
let dajiaGlassMaterial = null;
let dajiaNightMaterial = null;
let xiaomiGlassMaterial = null;
let xiaomiLedMaterial = null;
let xiaomiSignMaterial = null;
let xiaomiNightMaterial = null;
let cocoonShellMaterial = null;
let cocoonGlassMaterial = null;
let cocoonNightMaterial = null;
let neighbourGlassMaterial = null;
let neighbourNightMaterial = null;
let coastalNightMaterial = null;
let polyInnerGlassMaterial = null;
let polyPlazaGlassMaterial = null;
let polyNightMaterial = null;
let excellenceGlassMaterial = null;
let excellenceNightMaterial = null;
let portNightMaterial = null;
let szuGlassMaterial = null;
let szuNightMaterial = null;
let hyteraGlassMaterial = null;
let hyteraNightMaterial = null;
let capitalGlassMaterial = null;
let capitalNightMaterial = null;
let aerospaceGlassMaterials = [];
let aerospacePodiumGlassMaterial = null;
let aerospaceNightMaterial = null;
let cnoocGlassMaterial = null;
let cnoocNightMaterial = null;
let rongchaoGlassMaterial = null;
let rongchaoNightMaterial = null;
let ventureGlassMaterial = null;
let ventureNightMaterial = null;
let officeWallMats = [];
let officeWallNight = null;
let bytedanceGlassMaterial = null;
let bytedanceNightMaterial = null;
let hisenseGlassMaterial = null;
let hisenseNightMaterial = null;
let xunleiGlassMaterial = null;
let xunleiNightMaterial = null;
let ventureNeighborMats = [];
let neighborsNightMaterial = null;
let ventureNeighborsLedMaterial = null;
let eastWallMats = [];
let eastWallNight = null;
let innovationTowerMats = [];
let innovationApartmentMats = [];
let innovationNightMaterial = null;
let nightReskinMats = [];
let tsinghuaGlassMaterial = null;
let tsinghuaNightMaterial = null;
let chinaOverseasGlassMaterial = null;
let chinaOverseasNightMaterial = null;
let yihuaGlassMaterial = null;
let yihuaNightMaterial = null;
let lxsGlassA = null;
let lxsGlassB = null;
let lxsNight = null;
let szResGlass = null;
let szResNight = null;
let residentialWindowMats = [];
let caixunGlassMaterial = null;
let caixunNightMaterial = null;
let buptGlassMaterial = null;
let buptNightMaterial = null;
let ketongGlassMaterial = null;
let ketongNightMaterial = null;
let youxianGlassMaterial = null;
let youxianNightMaterial = null;
let campusWindowMaterial = null;
const glassUniforms = {
  uTop: { value: new THREE.Color(0x8bb6d2) },
  uHorizon: { value: new THREE.Color(0xc7dce3) },
  uSunColor: { value: new THREE.Color(0xffe4bb) },
  uSunDir: { value: new THREE.Vector3(.4, .5, -.2) },
  uNight: { value: 0 },
  uFogColor: { value: new THREE.Color(0x0a1611) },
  uFogDensity: { value: .00135 }
};
const landingGlowGeometry = [];
const landmarkBuildingMap = new Map();
for (const lm of DATA.landmarks) {
  for (const bi of lm.buildings || []) {
    if (!landmarkBuildingMap.has(bi)) landmarkBuildingMap.set(bi, lm.id);
  }
}

// Soft interior-window texture: warm floor-to-ceiling light, a dark mullion,
// intermittent blind shadows and a soft edge. The additive instance colour
// still supplies warm/cool tint and per-window brightness.
function makeWindowDetailTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 2, 0, 62);
  grad.addColorStop(0, 'rgba(255,255,255,.96)');
  grad.addColorStop(.55, 'rgba(255,250,236,.90)');
  grad.addColorStop(1, 'rgba(255,231,196,.58)');
  g.fillStyle = grad;
  g.fillRect(5, 4, 54, 56);
  // cut a thin central mullion and blind slats out of the alpha mask
  g.globalCompositeOperation = 'destination-out';
  g.fillStyle = 'rgba(0,0,0,.62)';
  g.fillRect(31.2, 4, 1.6, 56);
  for (let y = 13; y < 46; y += 7) {
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(5, y, 54, 1.2);
  }
  g.fillStyle = 'rgba(0,0,0,.8)';
  g.fillRect(5, 57, 54, 3);
  g.globalCompositeOperation = 'source-over';
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}
function makeWindowHaloTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,230,192,.75)');
  grad.addColorStop(.42, 'rgba(255,196,120,.26)');
  grad.addColorStop(1, 'rgba(255,180,100,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return tex;
}

(function buildBuildings() {
  const positions = [];
  const colors = [];
  const detailPos = [];
  const detailCol = [];
  const glassPos = [];
  const glassCol = [];
  const lmGlassPos = [];
  const lmGlassCol = [];
  const crownPos = [];
  const glassWhite = new THREE.Color(0xffffff);
  let structuredWindows = 0;
  const STRUCTURED_BUDGET = 16000;
  const WINDOW_HARD_CAP = 26000;
  const LANDMARK_GLASS_IDS = new Set(['tencent-binhai', 'baidu-intl', 'software-base']);
  const typeColors = {
    commercial: new THREE.Color(COLORS.glassA),
    residential: new THREE.Color(COLORS.resi),
    retail: new THREE.Color(COLORS.retail),
    civic: new THREE.Color(COLORS.civic),
    industrial: new THREE.Color(COLORS.industrial),
    other: new THREE.Color(COLORS.other),
    structure: new THREE.Color(COLORS.structure)
  };
  const typeRoof = {
    commercial: new THREE.Color(0x1d2c27),
    residential: new THREE.Color(0x2c2b23),
    retail: new THREE.Color(0x352f24),
    civic: new THREE.Color(0x293329),
    industrial: new THREE.Color(0x252f29),
    other: new THREE.Color(0x29302a),
    structure: new THREE.Color(0x252a25)
  };
  const r = mulberry32(61234);
  for (let bi = 0; bi < DATA.buildings.length; bi++) {
    if (bi === CR_BUILDING_INDEX || TENCENT_BUILDING_INDICES.has(bi) || SBO_SKIP_INDICES.has(bi) || ANDAZ_SKIP_INDICES.has(bi) || LENOVO_SKIP_INDICES.has(bi) || DAJIA_SKIP_INDICES.has(bi) || XIAOMI_SKIP_INDICES.has(bi) || COCOON_SKIP_INDICES.has(bi) || NEIGHBOUR_SKIP_INDICES.has(bi) || COASTAL_SKIP_INDICES.has(bi) || POLY_SKIP_INDICES.has(bi) || EXCELLENCE_SKIP_INDICES.has(bi) || PORT_SKIP_INDICES.has(bi) || SZU_SKIP_INDICES.has(bi) || HYTERA_SKIP_INDICES.has(bi) || CAPITAL_SKIP_INDICES.has(bi) || AEROSPACE_SKIP_INDICES.has(bi) || CNOOC_SKIP_INDICES.has(bi) || RONCHAO_SKIP_INDICES.has(bi) || VENTURE_SKIP_INDICES.has(bi) || OFFICEWALL_SKIP.has(bi) || BYTEDANCE_SKIP_INDICES.has(bi) || HISENSE_SKIP_INDICES.has(bi) || XUNLEI_SKIP_INDICES.has(bi) || VENTURE_NEIGHBOR_SKIP.has(bi) || EASTWALL_SKIP.has(bi) || INNOVATION_SKIP.has(bi) || TSINGHUA_SKIP.has(bi) || CHINA_OVERSEAS_SKIP.has(bi) || YIHUA_SKIP.has(bi) || CAIXUN_SKIP.has(bi) || BUPT_SKIP.has(bi) || KETONG_SKIP.has(bi) || YOUXIAN_SKIP.has(bi) || LITE3_SKIP.has(bi) || BAIDU_SKIP.has(bi) || SOFTWARE_SKIP.has(bi)) continue; // bespoke landmarks below
    const b = DATA.buildings[bi];
    const ring = flatPointsToVectors(b.p);
    if (ring.length < 3) continue;
    const color = (typeColors[b.t] || typeColors.other).clone();
    color.offsetHSL(0, 0, (r() - .5) * .055);
    const roof = (typeRoof[b.t] || typeRoof.other).clone().offsetHSL(0, 0, (r() - .5) * .03);
    const height = Math.max(.38, wh(b.height));
    const bcx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const bcz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const lmFocus = landmarkBuildingMap.has(bi) && LANDMARK_GLASS_IDS.has(landmarkBuildingMap.get(bi));
    const detailStart = detailPos.length, windowStart = windowInstances.length;
    const startFace = positions.length / 9;
    addPrism(positions, colors, ring, height, color, roof, BUILD_Y);
    const endFace = positions.length / 9;
    buildingFaceRanges.push([startFace, endFace, bi]);

    // Roof equipment / antennas give the skyline a little grain. Keep it cheap.
    const top = BUILD_Y + height;
    if (height > 7 || r() > .72) {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      const spawnAntenna = b.height > 110 && r() > .52;
      if (spawnAntenna) {
        addBoxToArrays(detailPos, detailCol, cx, top, cz, .18 + r() * .18, 1.1 + r() * 3.6, .18 + r() * .18, new THREE.Color(0x3b4239), 0);
      } else if (b.t === 'commercial' || b.t === 'retail') {
        addBoxToArrays(detailPos, detailCol, cx + (r() - .5) * 1.2, top, cz + (r() - .5) * 1.2, .5 + r() * 1.2, .25 + r() * .7, .5 + r() * 1.2, new THREE.Color(0x2a332c), r() * TAU);
      }
    }

    // Lit windows: a small set of quads on visible facades. Works for any
    // normalized building type (OSM or hand-written), not just known types.
    // The named landmark towers use the bespoke glass/interior façade below.
    if (!lmFocus && height > .9 && b.t !== 'structure' && r() < .88) {
      let edgeCount = 0;
      const maxEdges = height > 5 ? 3 : 2;
      for (let e = 0; e < ring.length && edgeCount < maxEdges; e++) {
        if (r() > (height > 5 ? .58 : .44)) continue;
        const a = ring[e], d = ring[(e + 1) % ring.length];
        const ex = d[0] - a[0], ez = d[1] - a[1];
        const elen = Math.hypot(ex, ez);
        if (elen < .9) continue;
        const mx = (a[0] + d[0]) / 2, mz = (a[1] + d[1]) / 2;
        let nx = -ez / elen, nz = ex / elen;
        const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
        if ((mx - cx) * nx + (mz - cz) * nz < 0) { nx = -nx; nz = -nz; }
        const w = Math.min(elen * (.28 + r() * .28), .95 + r() * 1.1);
        const ux = ex / elen, uz = ez / elen;
        const ox = mx + nx * .04, oz = mz + nz * .04;
        const nWin = 2 + Math.floor(r() * (height > 5 ? 4 : 2));
        for (let wi = 0; wi < nWin; wi++) {
          const wy = BUILD_Y + 1.1 + r() * Math.max(.4, height - 1.8);
          const ww = Math.min(w, .8);
          const whgt = .23 + r() * .52;
          const warm = r() > .30;
          const cl = warm ? new THREE.Color(0xffc079) : new THREE.Color(0xc4e4ff);
          const strength = .7 + r() * .75;
          // One instance = one lit facade panel. This makes OSM footprints and
          // hand-written footprints behave identically.
          windowInstances.push({
            x: ox, y: wy + whgt * .5, z: oz,
            yaw: Math.atan2(nx, nz),
            w: ww * 2, h: whgt,
            color: cl,
            seed: r(),
            type: b.t || 'other',
            brightness: strength * .8,
            lit: false
          });
        }
        edgeCount++;
      }
    }

    // Commercial / civic towers get an additional structured curtain-wall
    // grid. The existing random panels remain as interior variation, while
    // this grid gives the skyline its dense, architectural pixel rhythm.
    if (!lmFocus && height > 3.15 && b.t !== 'structure' && r() < .82 && structuredWindows < STRUCTURED_BUDGET) {
      const edges = [];
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], d = ring[(e + 1) % ring.length];
        const ex = d[0] - a[0], ez = d[1] - a[1];
        const elen = Math.hypot(ex, ez);
        if (elen < .72) continue;
        let nx = -ez / elen, nz = ex / elen;
        const mx = (a[0] + d[0]) * .5, mz = (a[1] + d[1]) * .5;
        if ((mx - bcx) * nx + (mz - bcz) * nz < 0) { nx = -nx; nz = -nz; }
        edges.push({ elen, ux: ex / elen, uz: ez / elen, nx, nz, mx, mz });
      }
      edges.sort((a, b) => b.elen - a.elen);
      const rows = clamp(Math.floor((height - 1.2) / .52), 3, 9);
      const faces = Math.min(2, edges.length);
      for (let fi = 0; fi < faces && structuredWindows < STRUCTURED_BUDGET; fi++) {
        const ed = edges[fi];
        const cols = clamp(Math.floor(ed.elen / .8), 1, 3);
        const usable = Math.min(ed.elen * .74, cols * .78);
        for (let row = 0; row < rows && structuredWindows < STRUCTURED_BUDGET; row++) {
          const wy = BUILD_Y + 1.05 + (row + .5) * (height - 1.35) / rows;
          for (let col = 0; col < cols; col++) {
            if (windowInstances.length >= WINDOW_HARD_CAP) break;
            const u = (col + .5) / cols - .5;
            const ww = Math.min(.34, usable / cols * .50);
            const hgt = .22 + r() * .08;
            const ox = ed.mx + ed.ux * u * usable + ed.nx * .045;
            const oz = ed.mz + ed.uz * u * usable + ed.nz * .045;
            const warm = r() > .28;
            const cl = warm ? new THREE.Color(0xffc079) : new THREE.Color(0xc4e4ff);
            windowInstances.push({
              x: ox, y: wy, z: oz,
              yaw: Math.atan2(ed.nx, ed.nz),
              w: ww * 2, h: hgt,
              color: cl, seed: r(), type: b.t || 'other',
              brightness: (.52 + r() * .5) * .75,
              lit: false
            });
            structuredWindows++;
          }
          // Landmark towers get a wide, low-intensity interior floor ribbon
          // behind the glass, producing a richer “lit office floor” glow than
          // the small pane grid alone.
          if (lmFocus && windowInstances.length < WINDOW_HARD_CAP) {
            const ribbonW = Math.min(ed.elen * .84, usable * .98);
            const warm = r() > .18;
            windowInstances.push({
              x: ed.mx + ed.nx * .045,
              y: wy,
              z: ed.mz + ed.nz * .045,
              yaw: Math.atan2(ed.nx, ed.nz),
              w: ribbonW, h: .17,
              color: warm ? new THREE.Color(0xffd4a0) : new THREE.Color(0xd8ecff),
              seed: r(), type: b.t || 'other',
              brightness: 1.02,
              lit: false
            });
          }
        }
      }
    }

    // Glass shell: selected towers and civic/retail blocks get a thin
    // view-dependent curtain wall just outside the opaque body. Windows sit
    // behind it, so the facade reads as lit interiors behind glass.
    // Named landmark towers are handled by the bespoke glass façade below.
    if (!lmFocus && (b.t === 'commercial' || b.t === 'retail' || b.t === 'civic' || height > 3.8)) {
      const expanded = ring.map((p) => {
        const dx = p[0] - bcx, dz = p[1] - bcz;
        const len = Math.hypot(dx, dz) || 1;
        return [p[0] + dx / len * .075, p[1] + dz / len * .075];
      });
      addPrism(glassPos, glassCol, expanded, height, glassWhite, glassWhite, BUILD_Y);
    }
    if (lmFocus) {
      const expanded = ring.map((p) => {
        const dx = p[0] - bcx, dz = p[1] - bcz;
        const len = Math.hypot(dx, dz) || 1;
        return [p[0] + dx / len * .085, p[1] + dz / len * .085];
      });
      addPrism(lmGlassPos, lmGlassCol, expanded, height, glassWhite, glassWhite, BUILD_Y);
    }

    // Thin crown line at the top of a small set of landmark-scale towers.
    // One merged line batch for the whole skyline.
    if (height > 8.0 && (b.t === 'commercial' || b.t === 'retail' || b.t === 'civic')) {
      addLoopSegments(crownPos, ring, BUILD_Y + height + .10);
    }
    // Preserve base prism, face IDs, RNG sequence, glass and lit panels exactly.
    // Ordinary roof triangles are moved, not copied, into distance-controlled chunks.
    if (!landmarkBuildingMap.has(bi) && b.t !== 'structure') {
      ordinaryDetailRecords.push({index:bi,ring,cx:bcx,cz:bcz,height,
        windows:windowInstances.slice(windowStart),
        roofPositions:detailPos.splice(detailStart),roofColors:detailCol.splice(detailStart)});
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: .85, metalness: 0, envMapIntensity: .25,
    flatShading: true, color: 0xffffff, side: THREE.DoubleSide
  });
  buildingsMesh = new THREE.Mesh(geo, mat);
  buildingsMesh.castShadow = true;
  buildingsMesh.receiveShadow = true;
  buildingsMesh.frustumCulled = false;
  buildingsMesh.userData.pickBuildings = true;
  buildingsGroup.add(buildingsMesh);

  // Glass curtain-wall shell. The shader reflects the current sky, adds a
  // fine floor/mullion grid and a faint night-time city glow. It is drawn
  // after the window light layer so the windows read as interiors behind glass.
  if (glassPos.length) {
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(glassPos, 3));
    gg.computeVertexNormals();
    glassMaterial = new THREE.ShaderMaterial({
      uniforms: glassUniforms,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      toneMapped: false,
      vertexShader: `
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform vec3 uFogColor;
        uniform float uNight;
        uniform float uFogDensity;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main(){
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewDir);
          float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.25);
          float hMix = clamp((vWorld.y - .06) / 30.0, 0.0, 1.0);
          vec3 sky = mix(uHorizon, uTop, smoothstep(0.0, 1.0, hMix));
          vec3 col = mix(vec3(.034, .037, .040), sky, .35 + fres * .60);
          float glint = pow(max(dot(reflect(-v, n), normalize(uSunDir)), 0.0), 22.0);
          col += uSunColor * glint * (.20 + fres * .32) * (1.0 - uNight * .7);
          col += vec3(.12, .075, .035) * uNight * (1.0 - hMix) * .30;
          float facadeCoord = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
          float ff = fract(vWorld.y / .52);
          float floorLine = 1.0 - smoothstep(0.0, .10, min(ff, 1.0 - ff));
          float mf = fract(facadeCoord / .74);
          float mull = 1.0 - smoothstep(0.0, .075, min(mf, 1.0 - mf));
          float lines = max(floorLine, mull * .9);
          col = mix(col, col * .58, lines);
          float alpha = .13 + fres * .34 + lines * .05;
          float fogFactor = 1.0 - exp(-pow(length(cameraPosition - vWorld) * uFogDensity * 1.35, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, .88));
          gl_FragColor = vec4(col, alpha);
        }
      `
    });
    // Real PBR curtain wall: metalness/roughness are fixed, reflections come
    // from the procedural sky + skyline environment cube (or are disabled in
    // the low quality preset).
    glassMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x343b3f,
      metalness: .9,
      roughness: .10,
      envMap: currentCityEnv,
      envMapIntensity: 1.2,
      clearcoat: 0.0,
      transparent: true,
      opacity: .46,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true
    });
    glassMaterial.name = 'glass-curtain-pbr';
    glassMesh = new THREE.Mesh(gg, glassMaterial);
    glassMesh.renderOrder = 3;
    glassMesh.castShadow = false;
    glassMesh.receiveShadow = true;
    glassMesh.frustumCulled = false;
    buildingsGroup.add(glassMesh);
  }

  // Named landmark towers (Tencent, Baidu, Software Base) get a bespoke
  // opaque glass façade with procedural interior floor bands. Their generic
  // window quads are skipped so this becomes the actual architectural skin.
  if (lmGlassPos.length) {
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(lmGlassPos, 3));
    lg.computeVertexNormals();
    landmarkGlassMaterial = new THREE.ShaderMaterial({
      uniforms: landmarkGlassUniforms,
      transparent: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      vertexShader: `
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vNormalW = normalize(mat3(modelMatrix) * normal);
          vViewDir = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        uniform vec3 uSunColor;
        uniform vec3 uSunDir;
        uniform float uNight;
        uniform float uLightPower;
        uniform float uOccupancy;
        uniform samplerCube uEnvMap;
        uniform float uEnvAmount;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        varying vec3 vWorld;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        float hash21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
        void main(){
          vec3 n = normalize(vNormalW);
          vec3 v = normalize(vViewDir);
          float fres = pow(1.0 - clamp(abs(dot(n, v)), 0.0, 1.0), 2.2);
          vec3 sky = mix(uHorizon, uTop, .72);
          vec3 col = mix(vec3(.020, .023, .026), sky, .13 + fres * .36);
          vec3 envRef = textureCube(uEnvMap, reflect(-v, n)).rgb;
          col = mix(col, envRef * vec3(.52, .55, .57), (.10 + fres * .20) * uEnvAmount);
          float glint = pow(max(dot(reflect(-v, n), normalize(uSunDir)), 0.0), 24.0);
          col += uSunColor * glint * (.22 + fres * .30) * (1.0 - uNight * .7);
          float side = 1.0 - smoothstep(.58, .82, abs(n.y));
          float facadeCoord = abs(n.x) > abs(n.z) ? vWorld.z : vWorld.x;
          float finCoord = facadeCoord / .48;
          float floorCoord = vWorld.y / .56;
          float finFrac = fract(finCoord);
          float floorFrac = fract(floorCoord);
          float finLine = 1.0 - smoothstep(0.0, .075, min(finFrac, 1.0 - finFrac));
          float floorLine = 1.0 - smoothstep(0.0, .095, min(floorFrac, 1.0 - floorFrac));
          float pane = (1.0 - smoothstep(.18, .34, min(finFrac, 1.0 - finFrac))) * (1.0 - smoothstep(.14, .30, min(floorFrac, 1.0 - floorFrac)));
          float floorIdx = floor(floorCoord);
          float bayIdx = floor(finCoord);
          float floorHash = hash21(vec2(floorIdx, 6.1));
          float floorLit = step(1.0 - clamp(uOccupancy * 1.08, 0.0, .84), floorHash);
          float mechanical = step(.88, hash21(vec2(floor(floorIdx * .39), 9.2)));
          float cellLit = step(.10 + .34 * floorHash, hash21(vec2(bayIdx, floorIdx) + 2.3));
          float lit = floorLit * cellLit * (1.0 - mechanical) * side;
          vec3 warm = vec3(1.0, .72, .38);
          vec3 cool = vec3(.58, .80, 1.0);
          vec3 interior = mix(warm, cool, step(.82, hash21(vec2(bayIdx + 3.0, floorIdx + 7.0))));
          float ceiling = smoothstep(.05, .55, floorFrac);
          col += interior * lit * pane * uLightPower * (.45 + hash21(vec2(bayIdx, floorIdx) + 5.0) * .55) * (.64 + ceiling * .36) * (.60 + uNight * .44);
          col *= 1.0 - floorLine * .25;
          col *= 1.0 - finLine * .22;
          col += vec3(.27, .29, .30) * finLine * side * .072;
          float fogFactor = 1.0 - exp(-pow(length(cameraPosition - vWorld) * uFogDensity * 1.35, 2.0));
          col = mix(col, uFogColor, clamp(fogFactor, 0.0, .86));
          gl_FragColor = vec4(col, 1.0);
        }
      `
    });
    landmarkGlassMesh = new THREE.Mesh(lg, landmarkGlassMaterial);
    landmarkGlassMesh.renderOrder = 2;
    landmarkGlassMesh.castShadow = false;
    landmarkGlassMesh.receiveShadow = false;
    landmarkGlassMesh.frustumCulled = false;
    buildingsGroup.add(landmarkGlassMesh);
  }

  // windows: one InstancedMesh, one dynamic draw call. Every window has its
  // own deterministic seed so dusk and late-night switch-off stagger naturally.
  const wg = new THREE.PlaneGeometry(1, 1);
  windowGlowTexture = makeWindowDetailTexture();
  windowGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, map: windowGlowTexture, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    toneMapped: false, fog: true
  });
  windowMesh = new THREE.InstancedMesh(wg, windowGlowMaterial, Math.max(1, windowInstances.length));
  windowMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  windowMesh.frustumCulled = false;
  windowMesh.renderOrder = 2;
  windowHaloTexture = makeWindowHaloTexture();
  windowHaloMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff, map: windowHaloTexture, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    toneMapped: false, fog: true
  });
  windowHaloMesh = new THREE.InstancedMesh(wg, windowHaloMaterial, Math.max(1, windowInstances.length));
  windowHaloMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  windowHaloMesh.frustumCulled = false;
  windowHaloMesh.renderOrder = 1;
  const wDummy = new THREE.Object3D();
  const initialWinColor = new THREE.Color(0x000000);
  for (let i = 0; i < windowInstances.length; i++) {
    const wi = windowInstances[i];
    wDummy.position.set(wi.x, wi.y, wi.z);
    wDummy.rotation.set(0, wi.yaw, 0);
    wDummy.scale.set(wi.w, wi.h, 1);
    wDummy.updateMatrix();
    windowMesh.setMatrixAt(i, wDummy.matrix);
    windowMesh.setColorAt(i, initialWinColor);
    wDummy.scale.set(wi.w * 1.45, wi.h * 1.65, 1);
    wDummy.updateMatrix();
    windowHaloMesh.setMatrixAt(i, wDummy.matrix);
    windowHaloMesh.setColorAt(i, initialWinColor);
  }
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  if (windowHaloMesh.instanceColor) windowHaloMesh.instanceColor.needsUpdate = true;
  windowMesh.instanceMatrix.needsUpdate = true;
  windowHaloMesh.instanceMatrix.needsUpdate = true;
  windowMesh.visible = false;
  windowHaloMesh.visible = false;
  windowsGroup.add(windowHaloMesh, windowMesh);
  nightGroup.add(windowsGroup);

  // Skyline crowns: one merged additive line batch for all tall roofs.
  if (crownPos.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(crownPos, 3));
    crownMaterial = new THREE.LineBasicMaterial({
      color: 0xcfe0a6, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true
    });
    crownMesh = new THREE.LineSegments(cg, crownMaterial);
    crownMesh.renderOrder = 7;
    crownMesh.frustumCulled = false;
    crownSegmentCount = crownPos.length / 6;
    nightGroup.add(crownMesh);
  }

  // roof details
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(detailPos, 3));
  dg.setAttribute('color', new THREE.Float32BufferAttribute(detailCol, 3));
  dg.computeVertexNormals();
  roofDetailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .85, metalness: 0, envMapIntensity: .25, flatShading: true });
  const dm = new THREE.Mesh(dg, roofDetailMaterial);
  dm.castShadow = true;
  dm.receiveShadow = true;
  dm.frustumCulled = false;
  roofDetailGroup.add(dm);
  buildingsGroup.add(roofDetailGroup);
})();

world.add(buildingsGroup);
ordinaryLOD = window.YuehaiBuildingLOD.build({THREE,plan:PLAN,heightScale:HS,baseY:BUILD_Y,
  buildings:ordinaryDetailRecords,roofMaterial:roofDetailMaterial});
buildingsGroup.add(ordinaryLOD.group);
ordinaryLOD.update(camera.position,performance.now(),true);
// Geometry is now cached in chunk buffers; drop the temporary per-building builders.
ordinaryDetailRecords.length=0;
if (window.__BOOT_DEBUG__) console.log('buildings', DATA.buildings.length, 'faces', buildingFaceRanges.length, 'windows', windowInstances.length);

// ── bespoke China Resources Headquarters / 春笋 ─────────────────
// Image reference: a deep-gray tapered glass “bamboo shoot” with dense
// vertical fins, horizontal technical bands and V-shaped base supports.
// ── bespoke China Resources Headquarters / 春笋 ───────────────
// Elliptical, continuously tapered shaft; 56 real fins; slanted crown
// facing Shenzhen Bay (SSW); four-storey stone podium and stepped base.
// ── bespoke China Resources Headquarters / 春笋 ───────────────
// Image reference: a deep-gray tapered glass "bamboo shoot" with dense
// vertical fins, horizontal technical bands and V-shaped base supports.
// Entire old CR/Tencent builders are replaced, not overlaid. Preserve skip IDs above.
(function installBlenderLandmarks() {
  const datasets = JSON.parse($('landmark-assets').textContent);
  refinedLandmarks = window.YuehaiRefined.create(THREE, datasets, {
    parent: buildingsGroup, envMap: currentCityEnv, buildY: BUILD_Y});
  for (const asset of refinedLandmarks.assets) {
    const arr = landmarkPickSets[asset.metadata.id];
    if (arr) arr.push(...asset.pickMeshes);
    if (asset.metadata.id === 'china-resources') crTowerGroup = asset.group;
  }
  const stats = refinedLandmarks.stats();
  window.__LANDMARK_ASSETS__ = stats;
  const tencent = stats.find(s => s.id === 'tencent-binhai');
  const cr = stats.find(s => s.id === 'china-resources');
  window.__TENCENT__ = Object.assign({}, tencent, {
    landmark: TENCENT_LANDMARK,
    source: 'Blender 5.0.1 rebuild; OSM heights 245.8/194.8 kept; three links approximate'
  });
  window.__CR__ = Object.assign({}, cr, {
    source: 'Blender 5.0.1 asset kept; not regenerated this round'
  });
})();

// ── 深圳湾万象城 · 示意精模（OSM 暂无轮廓） ─────────────────
// The massing is invented around the landmark anchor (1441.3, 544.6);
// it is explicitly NOT an OSM footprint. The label and card keep that note.
(function buildShenzhenBayMixC() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();


// ── 深圳湾一号 · T7 主塔 + T2/T4/T5/T6/T8 组团 ───────────────
(function buildShenzhenBayOne() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();


// ── 瑞府 / 深圳湾安达仕塔楼：直板混合塔 ─────────────────────
// OSM buildings[421] "瑞府": 246.0 m / 58 floors, centroid ~(1613, 240).
// Low ~45% is the Andaz hotel, upper ~55% the Ruifu residences (approximate).
// ── 瑞府 / 深圳湾安达仕塔楼：直板混合塔 ─────────────────────
// OSM buildings[421] "瑞府": 246.0 m / 58 floors, centroid ~(1613, 240).
// Low ~45% is the Andaz hotel, upper ~55% the Ruifu residences (approximate).
(function buildAndazTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 联想后海中心 A/B 座 ───────────────────────────────────────
(function buildLenovoHouhai() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();


// ── 大家财险总部大厦 · 圆柱沙漏主楼 ───────────────────────────
// OSM 880: unnamed circular commercial tower, data 314 m / 62 F. The model
// follows the official 273 m / 57 F, declared in the report; position/plan
// remain the OSM data. The C11 annex has no matching OSM record and is omitted.
// ── 大家财险总部大厦 · 圆柱沙漏主楼 ───────────────────────────
// OSM 880: unnamed circular commercial tower, data 314 m / 62 F. The model
// follows the official 273 m / 57 F, declared in the report; position/plan
// remain the OSM data. The C11 annex has no matching OSM record and is omitted.
(function buildDajiaTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳小米大厦 / 小米魔方 ─────────────────────────────────
// OSM 1670: 41.6 m, 13 F, 66×97 m. Low-rise podium with open ground floor,
// continuous LED band around rounded corners, floating gridded cube, mi sign.
(function buildXiaomiTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();


// ── 深圳湾体育中心「春茧」 ───────────────────────────────────
// OSM 542/543 are replaced by one continuous cocoon shell (40 m) over both
// halls. No generic boxes are left to poke through the shell.
(function buildSpringCocoon() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();


// ── 春笋邻里楼准精模：万家大厦 + 宝格丽 ───────────────────────
// These are neighbours of China Resources Tower, NOT the CR headquarters.
(function buildCrNeighbours() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 海岸城东座 + 西座 ─────────────────────────────────────────
// Two 25.6 m / 8F commercial blocks with real vertical grooves, a roof bridge,
// stepped retail podiums and a pedestrian street between them.
(function buildCoastalCity() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳保利剧院（全精模）+ 保利文化广场（准精模） ─────────────
(function buildPolyComplex() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 卓越·后海中心 ─────────────────────────────────────────────
// 210 m / 46F plate tower, offset on a 3F podium, twisting silver fins,
// south 4–18F green atrium, stepped crown. No invented signage.
(function buildExcellenceHouhai() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳湾口岸 + 引桥 ─────────────────────────────────────────
(function buildShenzhenBayPort() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 闭合/同变换修复：海岸城、保利、深圳湾口岸 ─────────────────
(function repairClosedVolumes() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳大学演会中心 ─────────────────────────────────────────
// 2404: damaged OSM height 3.2 m. Built at 24 m by explicit user override.
(function buildSzuPerformance() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 海能达全球总部大厦 ───────────────────────────────────────
// 1541: 258 m / 43F / 50×96 m, plate tower, offset core, floating podium.
(function buildHyteraTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深创投广场 ───────────────────────────────────────────────
// 1541-like crystal: folded diamond facade, rotating podium, 261.3 m.
(function buildCapitalPlaza() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 航天科技广场 A/B 座 ─────────────────────────────────────
// 633 A: 232.1 m / 50F, 631 B: 130 m / 31F, shared 6F podium.
(function buildAerospacePlaza() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 中海油大厦 A/B 双子塔 ─────────────────────────────────────
(function buildCnoocTwinTowers() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 荣超高新区联合总部大厦 ───────────────────────────────────
// 450: 230 m / 54F, 87×69 m, clean shaded-glass tower.
(function buildRongchaoTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳湾创业投资大厦 ───────────────────────────────────────
// 630: 202.4 m / 44F / 60×58 m, vertical-fin glass tower.
(function buildVentureTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 海德三道北侧办公组团（7 栋准精模） ───────────────────────
(function buildHaideOfficeWall() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳字节跳动后海中心 ─────────────────────────────────────
// 1675: 150 m / 32F / 65×62 m, precise square tech tower.
(function buildByteDanceTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 海信南方大厦 ─────────────────────────────────────────────
// 619: 160 m / 30F / 82×70 m, stone-rib + glass headquarters.
(function buildHisenseSouth() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 迅雷大厦 ─────────────────────────────────────────────────
// 782: 119 m / 29F / 66×36 m, narrow slab tower.
(function buildXunleiTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 创投两侧四栋准精模：三诺 / A8 / 赛西 / 盈峰 ──────────────
(function buildVentureNeighbors() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 创投东延街段：1258 / 1259 两栋准精模 ────────────────────
(function buildVentureEastWall() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳湾创新科技中心 · 修正版 ──────────────────────────────
(function buildInnovationCenter() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 夜景逐立面重贴：每面独立 Canvas，格子物理尺寸恒定 ──────
(function buildTsinghuaResearch() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();
// ── 中国海外大厦（中海地产后海总部） ────────────────────────
(function buildChinaOverseas() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 怡化金融科技大厦 ─────────────────────────────────────────
(function buildYihuaTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 彩讯科技大厦 ─────────────────────────────────────────────
(function buildCaixunTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 北邮科技大厦 ─────────────────────────────────────────────
(function buildBuptTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 微软科通大厦 ─────────────────────────────────────────────
(function buildKetongTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 有线信息传输大厦 ────────────────────────────────────────
(function buildYouxianTower() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深大校园统一类型化（墙面主导） ─────────────────────────
(function buildSzuCampus() {
  if (true) return; // reverted: restore original campus generic buildings
  const g = new THREE.Group(); g.name = 'szu-campus';
  g.position.set(wx(400), BUILD_Y, wz(-1400)); g.scale.set(PLAN, HS, PLAN);
  const WALL = [], WALLI = [], BASE = [], BASEI = [], TRIM = [], TRIMI = [], FAC = [], FACI = [], FAUV = [], ENT = [], ENTI = [], GREEN = [], GREENI = [];
  function box(p, ix, cx, cy, cz, sx, sy, sz) {
    const b = p.length / 3;
    for (const yy of [cy - sy / 2, cy + sy / 2]) for (const [xx, zz] of [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]) p.push(cx + xx, yy, cz + zz);
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; ix.push(b + i, b + 4 + i, b + j, b + j, b + 4 + i, b + 4 + j); }
    ix.push(b, b + 2, b + 1, b, b + 3, b + 2); ix.push(b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
  }
  function quad(p, ix, uv, a, b, c, d, u0, v0, u1, v1) {
    const q = p.length / 3; p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]); uv.push(u0, v0, u1, v0, u1, v1, u0, v1); ix.push(q, q + 1, q + 2, q, q + 2, q + 3);
  }
  const campus = [];
  for (let bi = 0; bi < DATA.buildings.length; bi++) {
    if (bi === 2404) continue;
    const b = DATA.buildings[bi]; if (!b.p) continue;
    const xs = b.p.filter((_, i) => i % 2 === 0), zs = b.p.filter((_, i) => i % 2 === 1);
    const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cz = zs.reduce((a, v) => a + v, 0) / zs.length;
    if (((cx - 400) / 410) ** 2 + ((cz + 1400) / 450) ** 2 >= 1) continue;
    const w = Math.max(8, Math.max(...xs) - Math.min(...xs)), d = Math.max(8, Math.max(...zs) - Math.min(...zs));
    const h = b.height || (b.levels || 3) * 3.4;
    const name = b.n || '';
    let type = 'teaching';
    if (/斋|宿舍|公寓|轩|阁/.test(name)) type = 'dorm';
    else if (/体育|运动/.test(name)) type = 'sports';
    else if (/图书馆|学院|教学楼|办公楼|创业园/.test(name)) type = 'public';
    const poly = bi === 17 ? b.p.reduce((arr, v, i) => { if (i % 2 === 0) arr.push([v - cx, b.p[i + 1] - cz]); return arr; }, []) : null;
    campus.push({ bi, cx: cx - 400, cz: cz + 1400, w, d, h, type, name, poly });
  }
  function facadeFace(cx, cz, h, floors, pts) {
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 1) continue;
      const u = len / (1.8 * 4), v = floors / 8;
      quad(FAC, FACI, FAUV,
        [cx + a[0], 1.8, cz + a[1]], [cx + b[0], 1.8, cz + b[1]],
        [cx + b[0], h, cz + b[1]], [cx + a[0], h, cz + a[1]], 0, 0, u, v);
    }
  }
  for (const b of campus) {
    const cx = b.cx, cz = b.cz, w = b.w, d = b.d, h = b.h, floors = Math.max(2, Math.min(12, Math.round(h / 3.4)));
    if (b.poly) {
      // S-shaped building: preserve polygon prism, wall + top cap.
      const n = b.poly.length, base = WALL.length / 3;
      for (const [px, pz] of b.poly) WALL.push(cx + px, 1.8, cz + pz);
      for (const [px, pz] of b.poly) WALL.push(cx + px, h, cz + pz);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; WALLI.push(base + i, base + n + i, base + j, base + j, base + n + i, base + n + j); }
      const cap = WALL.length / 3; WALL.push(cx, h, cz); for (let i = 0; i < n; i++) WALLI.push(cap, base + n + i, base + n + (i + 1) % n);
      const bas = BASE.length / 3; for (const [px, pz] of b.poly) BASE.push(cx + px, 0, cz + pz); for (const [px, pz] of b.poly) BASE.push(cx + px, 1.8, cz + pz);
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; BASEI.push(bas + i, bas + n + i, bas + j, bas + j, bas + n + i, bas + n + j); }
      facadeFace(cx, cz, h, floors, b.poly);
      box(TRIM, TRIMI, cx, h + .15, cz, w + .4, .3, d + .4);
    } else {
      box(BASE, BASEI, cx, .9, cz, w + 1.2, 1.8, d + 1.2);
      box(WALL, WALLI, cx, 1.8 + (h - 1.8) / 2, cz, w, h - 1.8, d);
      box(TRIM, TRIMI, cx, h + .15, cz, w + .5, .3, d + .5);
      facadeFace(cx, cz, h, floors, [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]);
    }
    if (b.type === 'teaching') for (let f = 1; f < floors; f++) box(TRIM, TRIMI, cx, f / floors * h + .5, cz + d / 2 + .25, w + .5, .10, .10);
    if (b.type === 'dorm') for (let f = 1; f < floors; f++) box(TRIM, TRIMI, cx, f / floors * h + .4, cz + d / 2 + .55, w + 1.0, .12, .9);
    if (b.type === 'public') {
      const ew = Math.min(12, w - 4), eh = Math.min(10, h * .45);
      box(ENT, ENTI, cx, 1.8 + eh / 2 - .9, cz + d / 2 + .8, ew, eh, 1.4);
      box(TRIM, TRIMI, cx, h + .55, cz + d / 2 + .2, w, .3, .8);
    }
    box(GREEN, GREENI, cx, .03, cz, w + 5, .08, d + 5);
  }
  // One shared facade image: 8 floor modules × 4 bays; wall 65%, window 35%.
  const fw = 256, fh = 128, bayW = 64, floorH = 16;
  const fc = document.createElement('canvas'); fc.width = fw; fc.height = fh; const fx = fc.getContext('2d');
  fx.fillStyle = '#e9e6de'; fx.fillRect(0, 0, fw, fh);
  const nc = document.createElement('canvas'); nc.width = fw; nc.height = fh; const nx = nc.getContext('2d'); nx.fillStyle = '#000'; nx.fillRect(0, 0, fw, fh);
  for (let row = 0; row < 8; row++) {
    const y0 = row * floorH + 10, y1 = y0 + 5.6;
    for (let q = 0; q < 4; q++) {
      fx.fillStyle = '#2c3540'; fx.fillRect(q * bayW + 2, y0, bayW - 4, 5.6);
      fx.fillStyle = '#d8d5cc'; fx.fillRect(q * bayW + 1, row * floorH + 1, 1.2, floorH - 2);
      if ((row * 7 + q) % 5 === 0 || row === 2 || row === 6) continue;
      if (((row * 13 + q * 7) % 100) < 22) { nx.fillStyle = q % 4 === 0 ? '#cfe4ff' : '#ffd9a0'; nx.fillRect(q * bayW + 4, y0 + 1, bayW - 8, 4); }
    }
  }
  const facadeTex = new THREE.CanvasTexture(fc); facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  const nightTex = new THREE.CanvasTexture(nc); nightTex.wrapS = nightTex.wrapT = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshStandardMaterial({ map: facadeTex, color: 0xffffff, metalness: 0, roughness: .9, envMapIntensity: .12 });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x8f918a, metalness: 0, roughness: .92 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xbab9b0, metalness: 0, roughness: .85 });
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x294b32, metalness: 0, roughness: 1 });
  const entMat = new THREE.MeshPhysicalMaterial({ color: 0x536363, metalness: .15, roughness: .25, transparent: true, opacity: .62, side: THREE.DoubleSide });
  const facadeMat = new THREE.MeshStandardMaterial({ map: facadeTex, metalness: 0, roughness: .9, emissive: 0xffd9a0, emissiveMap: nightTex, emissiveIntensity: 0, side: THREE.DoubleSide });
  campusWindowMaterial = facadeMat;
  const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(WALL, 3)); wallGeo.setIndex(WALLI); wallGeo.computeVertexNormals();
  const baseGeo = new THREE.BufferGeometry(); baseGeo.setAttribute('position', new THREE.Float32BufferAttribute(BASE, 3)); baseGeo.setIndex(BASEI); baseGeo.computeVertexNormals();
  const trimGeo = new THREE.BufferGeometry(); trimGeo.setAttribute('position', new THREE.Float32BufferAttribute(TRIM, 3)); trimGeo.setIndex(TRIMI); trimGeo.computeVertexNormals();
  const facGeo = new THREE.BufferGeometry(); facGeo.setAttribute('position', new THREE.Float32BufferAttribute(FAC, 3)); facGeo.setAttribute('uv', new THREE.Float32BufferAttribute(FAUV, 2)); facGeo.setIndex(FACI); facGeo.computeVertexNormals();
  const entGeo = new THREE.BufferGeometry(); entGeo.setAttribute('position', new THREE.Float32BufferAttribute(ENT, 3)); entGeo.setIndex(ENTI); entGeo.computeVertexNormals();
  const grGeo = new THREE.BufferGeometry(); grGeo.setAttribute('position', new THREE.Float32BufferAttribute(GREEN, 3)); grGeo.setIndex(GREENI); grGeo.computeVertexNormals();
  const wall = new THREE.Mesh(wallGeo, wallMat); wall.castShadow = true; g.add(wall);
  const base = new THREE.Mesh(baseGeo, baseMat); base.castShadow = true; g.add(base);
  const trim = new THREE.Mesh(trimGeo, trimMat); g.add(trim);
  const fac = new THREE.Mesh(facGeo, facadeMat); fac.renderOrder = 2; g.add(fac);
  const ent = new THREE.Mesh(entGeo, entMat); g.add(ent);
  const grn = new THREE.Mesh(grGeo, greenMat); g.add(grn);
  buildingsGroup.add(g);
  const tri = q => Math.round(q.index ? q.index.count / 3 : q.attributes.position.count / 3);
  const types = { teaching: 0, dorm: 0, public: 0, sports: 0 };
  for (const b of campus) types[b.type]++;
  window.__SZU_CAMPUS__ = { count: campus.length, types, indices: campus.map(b => b.bi), sBuilding: 17, triangles: tri(wallGeo) + tri(baseGeo) + tri(trimGeo) + tri(facGeo) + tri(entGeo) + tri(grGeo), drawCalls: 6, litRatio: .19, wallRatio: .65, windowRatio: .35, touched2404: false };
})();

// ── 留学生创业大厦一期/二期 + 深圳湾公馆 ───────────────────
(function buildLiteThree() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 全城住宅类型化（共用模板，不覆盖精模） ─────────────────
(function buildCityResidential() {
  if (true) return; // reverted: restore original residential buildings
  const g = new THREE.Group(); g.name = 'city-residential';
  g.position.set(0, BUILD_Y, 0); g.scale.set(PLAN, HS, PLAN);
  const P = [], PI = [], C = [], GROUND = [], GROUNDI = [], GC = [], TC = [], TRIM = [], TRIMI = [], WIN = [[], [], [], []], WINI = [[], [], [], []], WINUV = [[], [], [], []];
  const schemes = [[0xded5c5, 0x8f7966], [0xe4ddcf, 0x8a8173], [0xd9d1c4, 0x806f61], [0xe8e1d2, 0x8c7765]];
  function box(p, ix, col, cx, cy, cz, sx, sy, sz, color) {
    const b = p.length / 3, c = new THREE.Color(color);
    for (const yy of [cy - sy / 2, cy + sy / 2]) for (const [xx, zz] of [[-sx / 2, -sz / 2], [sx / 2, -sz / 2], [sx / 2, sz / 2], [-sx / 2, sz / 2]]) { p.push(cx + xx, yy, cz + zz); col.push(c.r, c.g, c.b); }
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; ix.push(b + i, b + 4 + i, b + j, b + j, b + 4 + i, b + 4 + j); }
    ix.push(b, b + 2, b + 1, b, b + 3, b + 2); ix.push(b + 4, b + 5, b + 6, b + 4, b + 6, b + 7);
  }
  function quad(p, ix, uv, face, cx, cz, w, d, h, floors) {
    const u = (face < 2 ? w : d) / (1.8 * 4), v = floors / 8;
    const c0 = face === 0 ? [cx - w / 2, cz - d / 2] : face === 1 ? [cx - w / 2, cz + d / 2] : face === 2 ? [cx + w / 2, cz - d / 2] : [cx - w / 2, cz + d / 2];
    const pts = face < 2 ? [[cx - w / 2, cz + (face === 0 ? -d / 2 : d / 2)], [cx + w / 2, cz + (face === 0 ? -d / 2 : d / 2)]] : [[cx + (face === 2 ? w / 2 : -w / 2), cz - d / 2], [cx + (face === 2 ? w / 2 : -w / 2), cz + d / 2]];
    const b = p.length / 3; p.push(pts[0][0], 0, pts[0][1], pts[1][0], 0, pts[1][1], pts[1][0], h, pts[1][1], pts[0][0], h, pts[0][1]); uv.push(0, 0, u, 0, u, v, 0, v); ix.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  let count = 0, named = { weilan: 0, xiandai: 0, nanguang: 0 }, point = 0, slab = 0;
  const boxAt = (cx, cz, w, d, h, scheme) => {
    box(P, PI, C, cx, h / 2, cz, w, h, d, schemes[scheme][0]);
    box(P, PI, C, cx, h + .2, cz, w + .3, .4, d + .3, schemes[scheme][1]);
    box(P, PI, C, cx + w * .22, h + .9, cz - d * .2, Math.min(8, w * .3), 1.4, Math.min(6, d * .3), schemes[scheme][1]);
    box(GROUND, GROUNDI, GC, cx, .02, cz, w + 4, .05, d + 4, 0x6f7a68);
  };
  for (let bi = 0; bi < DATA.buildings.length; bi++) {
    const b = DATA.buildings[bi]; if (!b || b.t !== 'residential' || !b.p) continue;
    if (bi === 2404 || (typeof CAMPUS_SKIP_INDICES !== 'undefined' && CAMPUS_SKIP_INDICES.has(bi))) continue;
    if (typeof DATA.landmarks !== 'undefined' && DATA.landmarks.some(l => (l.buildings || []).includes(bi))) continue;
    const xs = b.p.filter((_, i) => i % 2 === 0), zs = b.p.filter((_, i) => i % 2 === 1);
    const cx = xs.reduce((a, v) => a + v, 0) / xs.length, cz = zs.reduce((a, v) => a + v, 0) / zs.length;
    const w = Math.max(7, Math.max(...xs) - Math.min(...xs)), d = Math.max(7, Math.max(...zs) - Math.min(...zs));
    const h = b.height || (b.levels || 8) * 3.1, name = b.n || '';
    const scheme = (Math.abs(Math.round(cx * 7 + cz * 11)) + (name ? name.charCodeAt(0) : 0)) % 4;
    const ratio = w / d, isSlab = ratio >= 1.6, isPoint = !isSlab && h >= 60;
    if (isSlab) slab++; else point++;
    if (name.includes('蔚蓝海岸')) named.weilan++;
    if (name.includes('现代城华庭')) named.xiandai++;
    if (name.includes('南光城市花园')) named.nanguang++;
    boxAt(cx, cz, w, d, h, scheme);
    const floors = Math.max(2, Math.min(60, Math.round(h / 3.1)));
    for (let face = 0; face < 4; face++) quad(WIN[face], WINI[face], WINUV[face], face, cx, cz, w, d, h, floors);
    // Point towers: one thin balcony line per floor on the long face.
    if (isPoint) {
      const alongZ = d >= w, proj = 1.1;
      for (let f = 1; f < floors; f++) {
        const y = f * h / floors;
        if (alongZ) box(P, PI, C, cx + w / 2 + proj / 2, y, cz, proj, .25, d * .9, schemes[scheme][1]);
        else box(P, PI, C, cx, y, cz + d / 2 + proj / 2, w * .9, .25, proj, schemes[scheme][1]);
      }
    }
    if (isSlab) {
      const alongX = w >= d;
      for (let f = 1; f < floors; f++) { const y = f * h / floors; if (alongX) box(P, PI, C, cx, y, cz + d / 2 + .55, w * .9, .22, 1.1, schemes[scheme][1]); else box(P, PI, C, cx + w / 2 + .55, y, cz, 1.1, .22, d * .9, schemes[scheme][1]); }
      for (let x = -w / 2 + 15; x < w / 2; x += 15) box(P, PI, C, cx + x, h / 2, cz + d / 2 + .03, 2.5, h, .18, schemes[scheme][1]);
    }
    if ((name.includes('蔚蓝') || name.includes('现代城') || name.includes('南光')) && floors > 3) {
      box(TRIM, TRIMI, TC, cx, 4.5, cz + d / 2 + 1.2, Math.min(20, w * .5), .18, 3.0, 0xb3ada0);
    }
    count++;
  }
  const r = 3, res = 3;
  function facadeTex(seed) {
    const day = document.createElement('canvas'); day.width = 256; day.height = 256;
    const night = document.createElement('canvas'); night.width = 256; night.height = 256;
    const dx = day.getContext('2d'), nx = night.getContext('2d');
    dx.clearRect(0, 0, 256, 256); nx.clearRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) for (let q = 0; q < 4; q++) {
      dx.fillStyle = '#2c3540'; dx.fillRect(q * 64 + 8, row * 32 + 9, 48, 15);
      dx.fillStyle = 'rgba(216,213,204,.7)'; dx.fillRect(q * 64 + 7, row * 32 + 8, 1.5, 17);
      const h = Math.sin(row * 19.1 + q * 7.7 + seed) * 43758.5453; const rnd = (h - Math.floor(h));
      if (rnd < .22 || row === 2 || row === 6) continue;
      const cold = rnd < .022; const b = .45 + rnd * .30;
      nx.fillStyle = cold ? `rgb(${Math.round(207*b)},${Math.round(228*b)},${Math.round(255*b)})` : `rgb(${Math.round(255*b)},${Math.round(217*b)},${Math.round(160*b)})`;
      nx.fillRect(q * 64 + 12, row * 32 + 12, 40, 9);
    }
    return { day: new THREE.CanvasTexture(day), night: new THREE.CanvasTexture(night) };
  }
  const mats = [];
  for (let f = 0; f < 4; f++) {
    const tx = facadeTex(f * .31);
    const m = new THREE.MeshStandardMaterial({ map: tx.day, transparent: true, alphaTest: .05, metalness: .15, roughness: .55, emissive: 0xffd9a0, emissiveMap: tx.night, emissiveIntensity: 0, side: THREE.DoubleSide });
    mats.push(m);
  }
  const wallGeo = new THREE.BufferGeometry(); wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); wallGeo.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); wallGeo.setIndex(PI); wallGeo.computeVertexNormals();
  const wallMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: .85 });
  const wall = new THREE.Mesh(wallGeo, wallMat); wall.castShadow = true; g.add(wall);
  for (let f = 0; f < 4; f++) {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(WIN[f], 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(WINUV[f], 2)); geo.setIndex(WINI[f]); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mats[f]); m.renderOrder = 2; g.add(m);
  }
  const greenMat = new THREE.MeshStandardMaterial({ color: 0x364b35, metalness: 0, roughness: .95 });
  const grGeo = new THREE.BufferGeometry(); grGeo.setAttribute('position', new THREE.Float32BufferAttribute(GROUND, 3)); grGeo.setIndex(GROUNDI); grGeo.computeVertexNormals();
  g.add(new THREE.Mesh(grGeo, greenMat));
  const trimGeo = new THREE.BufferGeometry(); trimGeo.setAttribute('position', new THREE.Float32BufferAttribute(TRIM, 3)); trimGeo.setIndex(TRIMI); trimGeo.computeVertexNormals();
  const trim = new THREE.Mesh(trimGeo, new THREE.MeshStandardMaterial({ color: 0xb3ada0, metalness: 0, roughness: .85 })); g.add(trim);
  buildingsGroup.add(g);
  residentialWindowMats = mats;
  window.__RESIDENTIAL__ = { count, point, slab, named, drawCalls: 7, triangles: 0, wall: 'vertex-color walls', windows: '4 shared face templates', balcony: 'geometry for all point/slab' };
})();

(function remapNightFacades() {
  // Replaced by the Blender asset loaded in installBlenderLandmarks.
})();

// ── 深圳清华大学研究院 / 湾区创新大厦 双塔 ─────────────────


// ── fake contact shadows for the low quality preset ────────────
let fakeAOMesh = null;
{
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(0,0,0,.62)');
  grad.addColorStop(.55, 'rgba(0,0,0,.34)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const mat = new THREE.MeshBasicMaterial({
    map: tex, transparent: true, opacity: .34, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, fog: true, color: 0x000000
  });
  fakeAOMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, Math.max(1, DATA.buildings.length));
  fakeAOMesh.frustumCulled = false;
  fakeAOMesh.renderOrder = 1;
  const dummy = new THREE.Object3D();
  for (let i = 0; i < DATA.buildings.length; i++) {
    const ring = flatPointsToVectors(DATA.buildings[i].p || []);
    if (ring.length < 3) { dummy.scale.set(0, 0, 0); dummy.updateMatrix(); fakeAOMesh.setMatrixAt(i, dummy.matrix); continue; }
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    dummy.position.set((minX + maxX) / 2, .028, (minZ + maxZ) / 2);
    dummy.rotation.set(-Math.PI / 2, 0, 0);
    dummy.scale.set(Math.max(.5, (maxX - minX) * 1.18), Math.max(.5, (maxZ - minZ) * 1.18), 1);
    dummy.updateMatrix();
    fakeAOMesh.setMatrixAt(i, dummy.matrix);
  }
  fakeAOMesh.instanceMatrix.needsUpdate = true;
  fakeAOMesh.visible = false;
  world.add(fakeAOMesh);
}

// Deterministic per-window light schedule. Office windows start switching off
// after 22:00; homes after 23:00; both leave only a sparse late-night set.
function windowOccupancy(type, hour) {
  const h = hour;
  if (type === 'commercial' || type === 'retail') {
    if (h < 5.5) return .055;
    if (h < 7.5) return lerp(.08, .52, smooth(5.5, 7.5, h));
    if (h < 18.5) return .90;
    if (h < 22) return lerp(.90, .78, smooth(18.5, 22, h));
    return lerp(.78, .055, smooth(22, 24, h));
  }
  if (type === 'residential') {
    if (h < 1.5) return lerp(.52, .22, smooth(0, 1.5, h));
    if (h < 5.5) return .13;
    if (h < 7.5) return lerp(.13, .34, smooth(5.5, 7.5, h));
    if (h < 17) return .18;
    if (h < 19.5) return lerp(.32, .90, smooth(17, 19.5, h));
    if (h < 23) return .91;
    return lerp(.91, .52, smooth(23, 24, h));
  }
  if (h < 5.5) return .08;
  if (h < 18) return .28;
  if (h < 22) return lerp(.38, .70, smooth(18, 22, h));
  return lerp(.70, .08, smooth(22, 24, h));
}
function windowHash(a, b) {
  const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453123;
  return v - Math.floor(v);
}
const tmpWindowColor = new THREE.Color();
const tmpHaloColor = new THREE.Color();
function updateWindowLights(force) {
  if (!windowMesh || !windowInstances.length) return;
  const targetPower = lightingPower();
  if (targetPower <= .01) {
    windowMesh.visible = false;
    if (windowHaloMesh) windowHaloMesh.visible = false;
    if (windowGlowMaterial) windowGlowMaterial.opacity = 0;
    if (windowHaloMaterial) windowHaloMaterial.opacity = 0;
    return;
  }
  const power = env.lightPower;
  if (power <= .004) {
    windowMesh.visible = false;
    if (windowHaloMesh) windowHaloMesh.visible = false;
    if (windowGlowMaterial) windowGlowMaterial.opacity = 0;
    if (windowHaloMaterial) windowHaloMaterial.opacity = 0;
    return;
  }
  windowMesh.visible = true;
  if (windowGlowMaterial) windowGlowMaterial.opacity = .62 * power;
  if (windowHaloMesh) windowHaloMesh.visible = true;
  if (windowHaloMaterial) windowHaloMaterial.opacity = .075 * power;
  const now = performance.now();
  if (!force && now - windowLastUpdate < 720) return;
  windowLastUpdate = now;
  const tick = Math.floor(now / 720);
  for (let i = 0; i < windowInstances.length; i++) {
    const wi = windowInstances[i];
    const occ = windowOccupancy(wi.type, state.hour);
    let lit = wi.seed < occ;
    // Small, infrequent random blinks make the facade feel inhabited without
    // turning the whole skyline into a strobe.
    if (windowHash(wi.seed * 91.7, tick * 1.31) < .028) lit = !lit;
    const brightness = lit ? wi.brightness * (.78 + windowHash(wi.seed, tick * .73) * .34) : 0;
    tmpWindowColor.copy(wi.color).multiplyScalar(brightness);
    windowMesh.setColorAt(i, tmpWindowColor);
    tmpHaloColor.copy(wi.color).multiplyScalar(lit ? brightness * .9 : 0);
    windowHaloMesh.setColorAt(i, tmpHaloColor);
  }
  if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
  if (windowHaloMesh.instanceColor) windowHaloMesh.instanceColor.needsUpdate = true;
}

// ── roads: OSM polylines become low-poly ribbons ────────────
bootStatus.textContent = '正在铺设 ' + DATA.roads.length.toLocaleString('zh-CN') + ' 段街道与主路…';
const roadsGroup = new THREE.Group();
const congestionGroup = new THREE.Group();
const roadFaceRanges = [];
let roadMesh = null;
let roadMaterial = null;
let roadBedMaterial = null;
let congestionMesh = null;
const roadBaseColor = new THREE.Color(0x1c211c);
const roadColorsByClass = {
  trunk: new THREE.Color(0x34332c),
  primary: new THREE.Color(0x2e2e27),
  secondary: new THREE.Color(0x262923),
  tertiary: new THREE.Color(0x202520),
  residential: new THREE.Color(0x1b201b),
  trunk_link: new THREE.Color(0x272821),
  primary_link: new THREE.Color(0x25261f),
  secondary_link: new THREE.Color(0x21251f),
  tertiary_link: new THREE.Color(0x20241e)
};
const roadDefaultWidth = { trunk: 27, primary: 21, secondary: 15, tertiary: 11, residential: 7, trunk_link: 12, primary_link: 10, secondary_link: 8, tertiary_link: 7 };
const roadWidthFrac = { trunk: 0.55, primary: 0.5, secondary: 0.5, tertiary: 0.5, residential: 0.55, trunk_link: 0.5, primary_link: 0.5, secondary_link: 0.5, tertiary_link: 0.5 };
const carRoutes = [];
const trafficNodes = new Map();
const trafficGraph = new Map();
let edgeCount = 0;
const signalRoutes = [];

function roadWidthMeters(r) {
  const lanes = r.l || 0;
  if (lanes > 0) {
    return clamp(lanes * 3.35, (roadDefaultWidth[r.c] || 8) * .48, (roadDefaultWidth[r.c] || 12) * 1.35);
  }
  return roadDefaultWidth[r.c] || 8;
}
function addRoadQuad(pos, col, a, b, halfWidth, color, y) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || .0001;
  const ex = dx / L, ez = dz / L;
  const nx = -ez * halfWidth, nz = ex * halfWidth;
  const ax = a[0] - ex * halfWidth * .65, az = a[1] - ez * halfWidth * .65;
  const bx = b[0] + ex * halfWidth * .65, bz = b[1] + ez * halfWidth * .65;
  const p1 = [ax + nx, y, az + nz], p2 = [ax - nx, y, az - nz], p3 = [bx - nx, y, bz - nz], p4 = [bx + nx, y, bz + nz];
  pushTriangle(pos, p1, p2, p3); pushTriangle(pos, p1, p3, p4);
  for (let i = 0; i < 6; i++) col.push(color.r, color.g, color.b);
}

(function buildRoads() {
  const pos = [], col = [], bedPos = [], bedCol = [], centrePos = [];
  const congPos = [], congCol = [];
  const baseColor = new THREE.Color(0x0c120e);
  const cCol = new THREE.Color(0xc5b582);
  const initialCongestion = new THREE.Color(0x69bd8d);
  const r = mulberry32(4491);
  for (let i = 0; i < DATA.roads.length; i++) {
    const road = DATA.roads[i];
    const pts = flatPointsToVectors(road.p);
    if (pts.length < 2) continue;
    const widthM = roadWidthMeters(road);
    const width = Math.max(.34, widthM * PLAN * (roadWidthFrac[road.c] || .48) * 2.0);
    const roadColor = (roadColorsByClass[road.c] || roadBaseColor).clone();
    roadColor.offsetHSL(0, 0, (r() - .5) * .03);
    const elev = .005 + (road.c === 'trunk' ? .008 : road.c === 'primary' ? .006 : road.c === 'secondary' ? .004 : .002);
    const y = ROAD_Y + elev;
    const start = pos.length / 3;
    const faceStart = pos.length / 9;
    const congestionStart = congPos.length / 3;
    for (let s = 0; s < pts.length - 1; s++) {
      addRoadQuad(pos, col, pts[s], pts[s + 1], width * .5, roadColor, y);
      addRoadQuad(bedPos, bedCol, pts[s], pts[s + 1], width * .5 + .32, baseColor, ROAD_Y - .012);
      // Wide, semi-transparent live congestion strip on top of the asphalt.
      addRoadQuad(congPos, congCol, pts[s], pts[s + 1], width * .70, initialCongestion, y + .075);
    }
    const end = pos.length / 3;
    const faceEnd = pos.length / 9;
    roadFaceRanges.push([faceStart, faceEnd, i]);
    const route = {
      idx: i, name: road.n || '', cls: road.c, points: pts, width,
      vertexStart: start, vertexEnd: end,
      congestionStart, congestionEnd: congPos.length / 3,
      baseColor: roadColor, trafficOffset: r(),
      importance: ({trunk: 1, primary: .86, secondary: .67, tertiary: .48, residential: .27, trunk_link: .55, primary_link: .48, secondary_link: .35, tertiary_link: .25}[road.c] || .2),
      raw: road
    };
    carRoutes.push(route);
    // dashed centre line for bigger roads so the topology is legible
    if (road.c === 'trunk' || road.c === 'primary' || road.c === 'secondary') {
      for (let s = 0; s < pts.length - 1; s++) {
        const a = pts[s], b = pts[s + 1];
        const segL = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const step = 1.5, dash = .72;
        for (let d = 0; d < segL; d += step) {
          const t0 = d / segL, t1 = Math.min(1, (d + dash) / segL);
          centrePos.push(a[0] + (b[0]-a[0])*t0, y + .022, a[1] + (b[1]-a[1])*t0);
          centrePos.push(a[0] + (b[0]-a[0])*t1, y + .022, a[1] + (b[1]-a[1])*t1);
        }
      }
    }
  }
  const bedGeo = new THREE.BufferGeometry();
  bedGeo.setAttribute('position', new THREE.Float32BufferAttribute(bedPos, 3));
  bedGeo.setAttribute('color', new THREE.Float32BufferAttribute(bedCol, 3));
  const bedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, metalness: .01, envMapIntensity: .25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  roadBedMaterial = bedMat;
  const bed = new THREE.Mesh(bedGeo, bedMat);
  bed.receiveShadow = true;
  roadsGroup.add(bed);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .83, metalness: .03, envMapIntensity: .25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  roadMaterial = mat;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  roadsGroup.add(mesh);
  roadMesh = mesh;
  roadsGroup.userData.colorAttr = geo.getAttribute('color');
  roadsGroup.userData.roadColorArray = col;
  roadsGroup.userData.roadRoutes = carRoutes;

  const congGeo = new THREE.BufferGeometry();
  congGeo.setAttribute('position', new THREE.Float32BufferAttribute(congPos, 3));
  congGeo.setAttribute('color', new THREE.Float32BufferAttribute(congCol, 3));
  const congMat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: .78, depthWrite: false,
    side: THREE.DoubleSide, toneMapped: false, blending: THREE.NormalBlending,
    polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
  });
  congestionMesh = new THREE.Mesh(congGeo, congMat);
  congestionMesh.renderOrder = 5;
  congestionMesh.frustumCulled = false;
  congestionGroup.add(congestionMesh);
  congestionGroup.userData.colorAttr = congGeo.getAttribute('color');
  congestionGroup.userData.routes = carRoutes;

  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(centrePos, 3));
  const cl = new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: 0xc4b381, transparent: true, opacity: .20, depthWrite: false }));
  cl.renderOrder = 4;
  roadsGroup.add(cl);
})();
world.add(roadsGroup);
world.add(congestionGroup);
congestionGroup.visible = true;

// road graph. Endpoints are snapped to a 0.9-unit lattice, enough to stitch
// OSM way splits without gluing parallel carriageways that are far apart.
const NODE_SNAP = 0.9;
function nodeKeyOf(x, z) {
  return Math.round(x / NODE_SNAP) + ':' + Math.round(z / NODE_SNAP);
}
function nodeCoordOf(key) {
  const p = key.split(':');
  return [Number(p[0]) * NODE_SNAP, Number(p[1]) * NODE_SNAP];
}
for (let i = 0; i < carRoutes.length; i++) {
  const rt = carRoutes[i];
  const a = rt.points[0], b = rt.points[rt.points.length - 1];
  const ka = nodeKeyOf(a[0], a[1]), kb = nodeKeyOf(b[0], b[1]);
  rt.startNode = ka; rt.endNode = kb;
  if (!trafficNodes.has(ka)) trafficNodes.set(ka, { key: ka, x: a[0], z: a[1], edges: [] });
  if (!trafficNodes.has(kb)) trafficNodes.set(kb, { key: kb, x: b[0], z: b[1], edges: [] });
  trafficNodes.get(ka).edges.push({ route: i, dir: 1 });
  trafficNodes.get(kb).edges.push({ route: i, dir: -1 });
  edgeCount++;
}
// cache lengths & cumulative distances along every road for car motion
for (const rt of carRoutes) {
  const L = pathLengthWorld(rt.points);
  rt.length = L.length;
  rt.cumulative = L.cumulative;
  rt.weight = Math.max(.12, L.length * rt.importance);
}
$('roadGraphLabel').textContent = 'NODES ' + trafficNodes.size.toLocaleString('en-US') + ' · EDGES ' + edgeCount.toLocaleString('en-US');

// optional road name sprites, generated from canvas (no texture files)
function makeCanvasSprite(lines, opts) {
  const o = opts || {};
  const w = o.width || 512, h = o.height || 160;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (o.panel) {
    const r = 16, x = 3, y = 3, ww = w - 6, hh = h - 6;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + ww - r, y); ctx.quadraticCurveTo(x + ww, y, x + ww, y + r);
    ctx.lineTo(x + ww, y + hh - r); ctx.quadraticCurveTo(x + ww, y + hh, x + ww - r, y + hh);
    ctx.lineTo(x + r, y + hh); ctx.quadraticCurveTo(x, y + hh, x, y + hh - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
    ctx.fillStyle = o.panel; ctx.fill();
    ctx.strokeStyle = o.border || 'rgba(226,202,153,.4)'; ctx.lineWidth = 2; ctx.stroke();
  }
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const line of lines) {
    if (line.divider) {
      ctx.strokeStyle = o.dividers || 'rgba(226,202,153,.3)';
      ctx.beginPath(); ctx.moveTo(w * .12, line.y); ctx.lineTo(w * .88, line.y); ctx.stroke();
      continue;
    }
    ctx.font = line.font || o.font || '500 42px "PingFang SC","Microsoft YaHei",sans-serif';
    ctx.fillStyle = line.color || o.color || 'rgba(238,230,213,.92)';
    if (line.letter) {
      ctx.save(); ctx.fillText(line.text, w / 2, line.y); ctx.restore();
    } else {
      ctx.fillText(line.text, w / 2, line.y);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: o.opacity ?? .9, fog: true });
  const sp = new THREE.Sprite(mat);
  if (o.scale) sp.scale.set(o.scale[0], o.scale[1], 1);
  return sp;
}

const roadLabelsGroup = new THREE.Group();
{
  const wanted = ['科苑南路', '滨海大道', '后海大道', '南海大道', '东滨路', '学府路', '白石路', '沙河西路', '海德三道', '高新南九道'];
  const byName = new Map();
  for (const rt of carRoutes) {
    if (!rt.name) continue;
    if (!wanted.includes(rt.name)) continue;
    if (!byName.has(rt.name) || rt.length > byName.get(rt.name).length) byName.set(rt.name, rt);
  }
  for (const [name, rt] of byName) {
    const total = rt.length;
    let target = total * (.37 + (hashString(name) - .5) * .26);
    let acc = 0, pos = rt.points[0];
    for (let i = 1; i < rt.points.length; i++) {
      const seg = Math.hypot(rt.points[i][0] - rt.points[i-1][0], rt.points[i][1] - rt.points[i-1][1]);
      if (acc + seg >= target) { const t = (target - acc) / seg; pos = [rt.points[i-1][0] + (rt.points[i][0]-rt.points[i-1][0])*t, rt.points[i-1][1] + (rt.points[i][1]-rt.points[i-1][1])*t]; break; }
      acc += seg;
    }
    const sp = makeCanvasSprite([
              { text: name, y: 81, font: '500 44px "Songti SC","STSong","Microsoft YaHei",serif', color: 'rgba(237,226,205,.84)' }
    ], { panel: 'rgba(5,15,10,.64)', border: 'rgba(226,202,153,.22)', scale: [12.8, 4.0], opacity: .82 });
    sp.position.set(pos[0], 1.65, pos[1]);
    sp.renderOrder = 5;
    roadLabelsGroup.add(sp);
  }
  roadsGroup.add(roadLabelsGroup);
}

// ── traffic-signal state ─────────────────────────────────────
const SIGNAL_CYCLE = 16;
const signalWorld = DATA.signals.map(([x, z], i) => ({
  x: wx(x), z: wz(z), offset: (hashString('sig' + i) * 16 + i * 1.31) % 16, idx: i
}));
function sigPhaseAt(s, seconds) {
  return (seconds + s.offset) % SIGNAL_CYCLE;
}
function nsGreen(p) { return p < 6.2; }
function ewGreen(p) { return p > 7.4 && p < 14.4; }
function nsAmber(p) { return p >= 6.2 && p < 7.0; }
function ewAmber(p) { return p >= 14.4 && p < 15.2; }

// signal posts & heads
const signalsVisual = new THREE.Group();
{
  const postGeo = new THREE.CylinderGeometry(.05, .07, 1.15, 5);
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3d4239, roughness: .8 });
  const posts = new THREE.InstancedMesh(postGeo, postMat, signalWorld.length);
  const headGeo = new THREE.BoxGeometry(.28, .32, .22);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x121915, roughness: .65 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, signalWorld.length);
  const d = new THREE.Object3D();
  signalWorld.forEach((s, i) => {
    d.position.set(s.x, .62, s.z); d.rotation.set(0, 0, 0); d.scale.set(1, 1, 1); d.updateMatrix(); posts.setMatrixAt(i, d.matrix);
    d.position.set(s.x, 1.23, s.z); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
  });
  signalsVisual.add(posts, heads);
  signalsVisual.userData.posts = posts;
}
const signalLightGeo = new THREE.BufferGeometry();
const signalLightPos = new Float32Array(signalWorld.length * 2 * 3);
const signalLightCol = new Float32Array(signalWorld.length * 2 * 3);
signalWorld.forEach((s, i) => {
  const base = i * 6;
  // two tiny bulbs offset along north/south and east/west
  signalLightPos[base] = s.x; signalLightPos[base + 1] = 1.27; signalLightPos[base + 2] = s.z + .26;
  signalLightPos[base + 3] = s.x + .26; signalLightPos[base + 4] = 1.27; signalLightPos[base + 5] = s.z;
  signalLightCol.fill(0, base, base + 6);
});
signalLightGeo.setAttribute('position', new THREE.BufferAttribute(signalLightPos, 3));
signalLightGeo.setAttribute('color', new THREE.BufferAttribute(signalLightCol, 3));
const glowTexture = (() => {
  const c = document.createElement('canvas'); c.width = 96; c.height = 96;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(48, 48, 1, 48, 48, 48);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(.18, 'rgba(255,255,255,.85)');
  grd.addColorStop(.45, 'rgba(255,255,255,.24)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 96, 96);
  const t = new THREE.CanvasTexture(c); t.minFilter = THREE.LinearFilter; return t;
})();
const signalLights = new THREE.Points(signalLightGeo, new THREE.PointsMaterial({
  size: 6.7, map: glowTexture, vertexColors: true, transparent: true, depthWrite: false,
  blending: THREE.AdditiveBlending, sizeAttenuation: true, opacity: .95, fog: true
}));
signalsVisual.add(signalLights);
signalGroup.add(signalsVisual);
world.add(signalGroup);
const signalRedNS = new Uint8Array(signalWorld.length);
const signalRedEW = new Uint8Array(signalWorld.length);
let signalsAccum = 0;
function updateSignalLights(dt, force) {
  signalsAccum += dt;
  if (!force && signalsAccum < .16) return;
  signalsAccum = 0;
  const attr = signalLightGeo.getAttribute('color');
  for (let i = 0; i < signalWorld.length; i++) {
    const p = sigPhaseAt(signalWorld[i], state.signalTime);
    const ns = nsGreen(p) ? 'g' : nsAmber(p) ? 'a' : 'r';
    const ew = ewGreen(p) ? 'g' : ewAmber(p) ? 'a' : 'r';
    signalRedNS[i] = ns === 'r' ? 1 : 0;
    signalRedEW[i] = ew === 'r' ? 1 : 0;
    const base = i * 6;
    const g = [0.28, 1.0, .52], a = [1.0, .65, .16], rr = [1.0, .18, .10];
    const writeVertex = (pos, c, dim) => {
      attr.array[pos] = c[0] * dim; attr.array[pos+1] = c[1] * dim; attr.array[pos+2] = c[2] * dim;
    };
    const nsColor = ns === 'g' ? g : ns === 'a' ? a : rr;
    const ewColor = ew === 'g' ? g : ew === 'a' ? a : rr;
    writeVertex(base, nsColor, 1);
    writeVertex(base + 3, ewColor, 1);
    if (ns !== 'r') { // emphasise the active axis without hiding the other lamp
      attr.array[base+3] *= .55; attr.array[base+4] *= .55; attr.array[base+5] *= .55;
    }
    if (ew !== 'r') {
      attr.array[base] *= .55; attr.array[base+1] *= .55; attr.array[base+2] *= .55;
    }
  }
  attr.needsUpdate = true;
}

// ── traffic cars ─────────────────────────────────────────────
bootStatus.textContent = '正在唤醒道路上的车流…';
const MAX_CARS = 760;
const carColors = [0xf2ead7, 0xe9dcc2, 0xcfb37b, 0x9fb9a7, 0x7f9187, 0xc0785c, 0xd5c5a3, 0x5e847e];
const carGeo = new THREE.BoxGeometry(.48, .27, 1.05);
const carMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, toneMapped: false });
const cars = new THREE.InstancedMesh(carGeo, carMat, MAX_CARS);
cars.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
cars.frustumCulled = false;
cars.count = 0;
const carPalette = carColors.map(h => new THREE.Color(h));
for (let i = 0; i < MAX_CARS; i++) cars.setColorAt(i, carPalette[i % carPalette.length]);
cars.instanceColor.needsUpdate = true;
trafficGroup.add(cars);
world.add(trafficGroup);

const carData = [];
const rngCars = mulberry32(67521);
function randomRouteByWeight() {
  let total = 0;
  for (const rt of carRoutes) total += rt.weight;
  let v = rngCars() * total;
  for (const rt of carRoutes) { v -= rt.weight; if (v <= 0) return carRoutes.indexOf(rt); }
  return Math.floor(rngCars() * carRoutes.length);
}
function initCar(i) {
  const roadIdx = randomRouteByWeight();
  const rt = carRoutes[roadIdx];
  if (!rt || rt.length < .5) return null;
    return {
    roadIdx, dir: rngCars() > .5 ? 1 : -1, s: rngCars() * rt.length,
    lane: (rngCars() * 2 - 1) * rt.width * .26,
    speed: 1 + rngCars() * .25, currentSpeed: .8, stopped: false,
    scale: .8 + rngCars() * .42
  };
}
function respawnCar(car) {
  const n = initCar(0);
  car.roadIdx = n.roadIdx; car.dir = n.dir; car.s = n.s; car.lane = n.lane; car.speed = n.speed; car.scale = n.scale; car.currentSpeed = .6;
}
for (let i = 0; i < MAX_CARS; i++) carData.push(initCar(i));
function sampleRoute(rt, s) {
  s = clamp(s, 0, rt.length);
  const cum = rt.cumulative;
  let lo = 0, hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = rt.points[lo], b = rt.points[hi];
  const seg = Math.max(1e-5, cum[hi] - cum[lo]);
  const t = clamp((s - cum[lo]) / seg, 0, 1);
  const dx = (b[0] - a[0]) / seg, dz = (b[1] - a[1]) / seg;
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz };
}
function nextRoad(car) {
  const rt = carRoutes[car.roadIdx];
  const node = car.dir > 0 ? rt.endNode : rt.startNode;
  const nodeObj = trafficNodes.get(node);
  if (!nodeObj || nodeObj.edges.length === 0) { respawnCar(car); return; }
  let options = nodeObj.edges.filter(e => e.route !== car.roadIdx);
  if (!options.length) options = nodeObj.edges;
  const e = options[Math.floor(rngCars() * options.length)];
  const nr = carRoutes[e.route];
  if (!nr || nr.length < .5) { respawnCar(car); return; }
  // orient the new route so that the car starts at this node
  const a = nr.points[0], b = nr.points[nr.points.length - 1];
  const disA = (a[0] - nodeObj.x) ** 2 + (a[1] - nodeObj.z) ** 2;
  const disB = (b[0] - nodeObj.x) ** 2 + (b[1] - nodeObj.z) ** 2;
  car.roadIdx = e.route;
  if (disA <= disB) { car.dir = 1; car.s = 0; }
  else { car.dir = -1; car.s = nr.length; }
  car.lane = (rngCars() * 2 - 1) * nr.width * .26;
}
const dummyCar = new THREE.Object3D();
const carPos = new THREE.Vector3();
let activeCars = 320;
let targetCars = 300;
function updateCars(dt, sim) {
  if (!state.layers.traffic) return;
  const speedFactor = weatherState.speed * (0.66 + (1 - sim.peak) * .55);
  const desired = Math.round(clamp(70 + sim.peak * 510 + sim.active * 120, 55, MAX_CARS));
  targetCars = desired;
  activeCars = activeCars < targetCars ? Math.min(targetCars, activeCars + Math.max(2, Math.round(dt * 150))) : Math.max(targetCars, activeCars - Math.max(2, Math.round(dt * 80)));
  for (let i = 0; i < activeCars; i++) {
    const car = carData[i];
    if (!car) continue;
    let rt = carRoutes[car.roadIdx];
    if (!rt) { respawnCar(car); rt = carRoutes[car.roadIdx]; }
    const sample = sampleRoute(rt, car.s);
    // stop if approaching a red light
    let mustStop = false;
    for (let si = 0; si < signalWorld.length; si++) {
      const sig = signalWorld[si];
      const rx = sig.x - sample.x, rz = sig.z - sample.z;
      const along = rx * sample.dx + rz * sample.dz;
      if (along > .2 && along < 3.0) {
        const lateral = Math.abs(rx * sample.dz - rz * sample.dx);
        if (lateral < Math.max(.55, rt.width * .65)) {
          const horizontal = Math.abs(sample.dx) > Math.abs(sample.dz);
          const red = horizontal ? signalRedEW[si] : signalRedNS[si];
          if (red) { mustStop = true; break; }
        }
      }
    }
    const targetSpeed = mustStop ? 0 : (1.15 * speedFactor * car.speed + .10);
    car.currentSpeed = lerp(car.currentSpeed, targetSpeed, Math.min(1, dt * (mustStop ? 7 : 3.4)));
    car.s += car.dir * car.currentSpeed * dt;
    if (car.s > rt.length) { nextRoad(car); }
    else if (car.s < 0) { nextRoad(car); }
    const cur = sampleRoute(routesForCar(car), car.s);
    // lane offset
    const nx = -cur.dz, nz = cur.dx;
    dummyCar.position.set(cur.x + nx * car.lane, .37, cur.z + nz * car.lane);
    dummyCar.rotation.set(0, Math.atan2(cur.dx, cur.dz), 0);
    dummyCar.scale.set(car.scale, car.scale, car.scale);
    dummyCar.updateMatrix();
    cars.setMatrixAt(i, dummyCar.matrix);
  }
  cars.count = activeCars;
  cars.instanceMatrix.needsUpdate = true;
}
function routesForCar(car) { return carRoutes[car.roadIdx]; }

function updateSignalVisibility() {
  signalGroup.visible = state.layers.signals;
  if (signalGroup.visible) updateSignalLights(0, true);
}

// ═══════════════════════════════════════════════════════════════════
//  CITY TRAFFIC V2
//  OSM ways → graph edges (lanes / speed-limit / length) → fixed-step
//  car-following + signal queues. The visual road geometry above is kept.
// ═══════════════════════════════════════════════════════════════════
bootStatus.textContent = '正在构建路网图与跟车模型…';
(function clearTrafficPlaceholders() {
  while (signalGroup.children.length) signalGroup.remove(signalGroup.children[0]);
  while (trafficGroup.children.length) trafficGroup.remove(trafficGroup.children[0]);
})();

// A main-road policy for the seven names requested by the brief. OSM in this
// export contains Nanhai / Shahe West / Dongbin / Houhai / Keyuan South and
// Binhai (trunk), while Beihuan / Shennan / Liuxian are simply not in the
// exported extent. Trunk-class ways are treated as arterials as well.
const MAIN_ROAD_RE = /北环大道|南海大道|沙河西路|东滨路|深南大道|后海大道|科苑/;
const TX_DEFAULTS = {
  trunk:       { lanes: 6, speed: 80 },
  primary:     { lanes: 4, speed: 60 },
  secondary:   { lanes: 3, speed: 40 },
  tertiary:    { lanes: 2, speed: 30 },
  residential: { lanes: 2, speed: 20 },
  trunk_link:  { lanes: 2, speed: 40 },
  primary_link:{ lanes: 2, speed: 35 },
  secondary_link:{ lanes: 1, speed: 30 },
  tertiary_link:{ lanes: 1, speed: 25 }
};
const txNodes = Array.from(trafficNodes.values());
txNodes.forEach((n, i) => { n.txIndex = i; n.signal = null; });

// Attraction points for directional commuter flow.
const officeTargets = DATA.landmarks
  .filter(l => ['tencent-binhai', 'baidu-intl', 'software-base', 'tech-park'].includes(l.id))
  .map(l => ({ x: wx(l.x), z: wz(l.z) }));
const residentialTargets = (() => {
  // Cluster large residential footprint centroids, plus metro station mouths.
  const bins = new Map();
  for (const b of DATA.buildings) {
    if (b.t !== 'residential') continue;
    const pts = flatPointsToVectors(b.p);
    if (!pts.length) continue;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const k = Math.round(cx / 14) + ':' + Math.round(cz / 14);
    if (!bins.has(k)) bins.set(k, { x: 0, z: 0, n: 0 });
    const v = bins.get(k); v.x += cx; v.z += cz; v.n++;
  }
  const top = Array.from(bins.values()).sort((a, b) => b.n - a.n).slice(0, 8)
    .map(v => ({ x: v.x / v.n, z: v.z / v.n }));
  for (const st of DATA.stations) top.push({ x: wx(st.x), z: wz(st.z) });
  return top.length ? top : [{ x: 0, z: 0 }];
})();
function minTargetDistance(x, z, targets) {
  let best = Infinity;
  for (const t of targets) best = Math.min(best, (t.x - x) ** 2 + (t.z - z) ** 2);
  return Math.sqrt(best);
}
for (const n of txNodes) {
  n.officeDist = minTargetDistance(n.x, n.z, officeTargets);
  n.residentialDist = minTargetDistance(n.x, n.z, residentialTargets);
}

const txEdges = [];
let txTotalLength = 0;
carRoutes.forEach((rt, idx) => {
  if (!rt || rt.points.length < 2 || !(rt.length > 0.05)) return;
  const raw = rt.raw || {};
  const main = MAIN_ROAD_RE.test(rt.name) || rt.cls === 'trunk';
  const arterial = rt.cls === 'trunk' || rt.cls === 'primary';
  const clsDefaults = TX_DEFAULTS[rt.cls] || TX_DEFAULTS.tertiary;
  const lanesTotal = clamp(Math.round(Number(raw.l) || clsDefaults.lanes || 2), 1, 12);
  let speedLimit = Number(raw.s) || clsDefaults.speed || 30;
  if (main) speedLimit = Math.max(speedLimit, 60);
  speedLimit = clamp(speedLimit, 15, 100);
  const laneCount = clamp(Math.ceil(lanesTotal / 2), 1, 3);
  const hLength = Math.hypot(rt.points[1][0] - rt.points[0][0], rt.points[1][1] - rt.points[0][1]);
  const tLength = Math.hypot(
    rt.points[rt.points.length - 1][0] - rt.points[rt.points.length - 2][0],
    rt.points[rt.points.length - 1][1] - rt.points[rt.points.length - 2][1]
  );
  const hStart = hLength > 1e-6 ? {
    x: (rt.points[1][0] - rt.points[0][0]) / hLength,
    z: (rt.points[1][1] - rt.points[0][1]) / hLength
  } : { x: 1, z: 0 };
  const hEnd = tLength > 1e-6 ? {
    x: (rt.points[rt.points.length - 1][0] - rt.points[rt.points.length - 2][0]) / tLength,
    z: (rt.points[rt.points.length - 1][1] - rt.points[rt.points.length - 2][1]) / tLength
  } : hStart;
  const axisFrom = (h) => Math.abs(h.x) >= Math.abs(h.z) ? 'EW' : 'NS';
  const trafficWeight = main ? 9.5 : (rt.cls === 'trunk' ? 5.6 : rt.cls === 'primary' ? 3.1 : rt.cls === 'secondary' ? 2.0 : rt.cls === 'tertiary' ? 1.1 : rt.cls === 'residential' ? .55 : .8);
  const spawnWeight = main ? 3.4 : (arterial ? 1.55 : .72);
  const edge = {
    id: txEdges.length,
    route: rt,
    name: rt.name || '',
    cls: rt.cls,
    main,
    arterial,
    lanesTotal,
    laneCount,
    speedLimit,
    length: rt.length,
    width: rt.width,
    startNode: trafficNodes.get(rt.startNode),
    endNode: trafficNodes.get(rt.endNode),
    axisByDir: { 1: axisFrom(hEnd), '-1': axisFrom({ x: -hStart.x, z: -hStart.z }) },
    trafficWeight,
    spawnWeight,
    jitter: .84 + hashString((rt.name || '') + ':' + idx) * .32,
    avgSpeedKmh: speedLimit,
    freedom: 1,
    targetFreedom: 1,
    visualFreedom: .92,
    modelSpeedKmh: speedLimit,
    targetSpeedWorld: speedLimit * 1,
    lastCars: 0,
    lastMeasuredKmh: 0
  };
  edge.index = edge.id;
  rt.txEdge = edge;
  txEdges.push(edge);
  txTotalLength += edge.length;
});
txEdges.forEach(e => {
  if (!e.startNode || !e.endNode) return;
  if (!e.startNode.outgoing) e.startNode.outgoing = [];
  if (!e.endNode.outgoing) e.endNode.outgoing = [];
});
for (const n of txNodes) {
  const out = [];
  const seen = new Set();
  for (const inc of n.edges) {
    const edge = txEdges.find(e => e.route === carRoutes[inc.route]);
    if (!edge) continue;
    let dir;
    if (edge.startNode === n) dir = 1;
    else if (edge.endNode === n) dir = -1;
    else continue;
    const key = edge.id + ':' + dir;
    if (!seen.has(key)) { seen.add(key); out.push({ edge, dir }); }
  }
  n.outgoing = out;
  n.edgesCount = out.length;
}

// Map the existing OSM signal candidates onto the nearest graph node.
const txSignals = [];
const usedSignalNodes = new Set();
DATA.signals.forEach(([sx, sz], i) => {
  const wx0 = sx * PLAN, wz0 = sz * PLAN;
  let best = null, bestD = Infinity;
  for (const n of txNodes) {
    const d = (n.x - wx0) ** 2 + (n.z - wz0) ** 2;
    if (d < bestD) { bestD = d; best = n; }
  }
  if (!best || bestD > 36 || usedSignalNodes.has(best)) return;
  usedSignalNodes.add(best);
  const sig = {
    index: txSignals.length,
    node: best,
    offset: hashString('sig:' + nKey(best.key) + ':' + i) * 63,
    ns: 'red',
    ew: 'green'
  };
  best.signal = sig;
  txSignals.push(sig);
});
function nKey(k) { return String(k); }
const TX_SIGNAL_CYCLE = 63;
function signalPhase(clock, sig) { return (clock + sig.offset) % TX_SIGNAL_CYCLE; }
function signalStateForAxis(phase, axis) {
  if (axis === 'NS') {
    if (phase < 30) return 'green';
    if (phase < 33) return 'yellow';
    return 'red';
  }
  if (phase >= 33 && phase < 60) return 'green';
  if (phase >= 60) return 'yellow';
  return 'red';
}
function computeSignalStates() {
  for (const s of txSignals) {
    const phase = signalPhase(trafficSim.clock, s);
    s.ns = signalStateForAxis(phase, 'NS');
    s.ew = signalStateForAxis(phase, 'EW');
  }
}
// Traffic-light poles / heads / two bulbs.
const txSignalPositions = [];
let txSignalBulbMesh = null;
let txSignalGlow = null;
let txSignalGlowGeo = null;
(function buildTrafficSignals() {
  const n = txSignals.length;
  if (!n) return;
  const poleGeo = new THREE.CylinderGeometry(.045, .075, 1.6, 5);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x3b4038, roughness: .8 });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, n);
  const headGeo = new THREE.BoxGeometry(.28, .26, .2);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x101611, roughness: .7 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, n);
  const bulbGeo = new THREE.SphereGeometry(.09, 6, 4);
  const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  txSignalBulbMesh = new THREE.InstancedMesh(bulbGeo, bulbMat, n * 2);
  const d = new THREE.Object3D();
  const glowPositions = new Float32Array(n * 3);
  const glowColors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const s = txSignals[i];
    const x = s.node.x + .19, z = s.node.z - .19;
    txSignalPositions.push([x, z]);
    d.position.set(x, .8, z); d.scale.set(1, 1, 1); d.rotation.set(0, 0, 0); d.updateMatrix(); poles.setMatrixAt(i, d.matrix);
    d.position.set(x, 1.56, z); d.updateMatrix(); heads.setMatrixAt(i, d.matrix);
    for (let b = 0; b < 2; b++) {
      const bx = x + (b === 0 ? -.1 : .1);
      d.position.set(bx, 1.61, z); d.updateMatrix();
      txSignalBulbMesh.setMatrixAt(i * 2 + b, d.matrix);
    }
    // One larger additive halo per junction, coloured by the active phase.
    // (Two overlapping halos washed out to white at typical camera distance.)
    glowPositions[i * 3] = x;
    glowPositions[i * 3 + 1] = 1.9;
    glowPositions[i * 3 + 2] = z;
    glowColors[i * 3] = .2; glowColors[i * 3 + 1] = 1; glowColors[i * 3 + 2] = .3;
  }
  poles.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  txSignalBulbMesh.instanceMatrix.needsUpdate = true;
  for (let i = 0; i < n * 2; i++) txSignalBulbMesh.setColorAt(i, new THREE.Color(0x29d26c));
  txSignalBulbMesh.instanceColor.needsUpdate = true;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(glowPositions, 3));
  g.setAttribute('color', new THREE.BufferAttribute(glowColors, 3));
  txSignalGlowGeo = g;
  txSignalGlow = new THREE.Points(g, new THREE.PointsMaterial({
    size: 11.5, map: glowTexture, vertexColors: true, transparent: true, opacity: .95,
    depthWrite: false, blending: THREE.NormalBlending, sizeAttenuation: true, fog: true
  }));  txSignalGlow.renderOrder = 4;
  signalGroup.add(poles, heads, txSignalBulbMesh, txSignalGlow);
})();
const txSignalColor = { green: new THREE.Color(0x34e372), yellow: new THREE.Color(0xffbd38), red: new THREE.Color(0xff3e2b) };
let txSignalVisualAccum = 0;
function updateTrafficSignalVisuals(dt, force) {
  txSignalVisualAccum += dt;
  if (!force && txSignalVisualAccum < .12) return;
  txSignalVisualAccum = 0;
  if (!txSignalBulbMesh || !txSignalGlowGeo) return;
  const attr = txSignalGlowGeo.getAttribute('color');
  for (let i = 0; i < txSignals.length; i++) {
    const s = txSignals[i];
    const nsC = txSignalColor[s.ns], ewC = txSignalColor[s.ew];
    txSignalBulbMesh.setColorAt(i * 2, nsC);
    txSignalBulbMesh.setColorAt(i * 2 + 1, ewC);
    // A single halo per junction shows which approach currently has priority.
    const active = s.ns !== 'red' ? nsC : ewC;
    attr.array[i * 3] = active.r; attr.array[i * 3 + 1] = active.g; attr.array[i * 3 + 2] = active.b;
  }
  if (txSignalBulbMesh.instanceColor) txSignalBulbMesh.instanceColor.needsUpdate = true;
  attr.needsUpdate = true;
}

// Heavy visual pool. Vehicles follow graph edges and never belong to more
// than one lane queue at a time.
const TX_MAX_VEHICLES = 1500;
const TX_BASE_ACTIVE = 1200;
const TX_BASE_GENERATION = 380; // vehicle generation rate at demand=1 (per sim second)
const TX_KMH_TO_WORLD = PLAN * 2.0 / 3.6;
const TX_FIXED_STEP = 1 / 30;
const TX_MIN_GAP = .13;
const TX_ACCEL = 2.8;
const TX_BRAKE = 7.0;
const txFleetGeo = new THREE.BoxGeometry(1, 1, 1);
const txFleetMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true, toneMapped: false });
const txFleet = new THREE.InstancedMesh(txFleetGeo, txFleetMat, TX_MAX_VEHICLES);
txFleet.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
txFleet.frustumCulled = false;
txFleet.count = TX_MAX_VEHICLES;
const zeroMatrix = new THREE.Matrix4().makeScale(0.00001, 0.00001, 0.00001);
for (let i = 0; i < TX_MAX_VEHICLES; i++) txFleet.setMatrixAt(i, zeroMatrix);
txFleet.instanceMatrix.needsUpdate = true;
for (let i = 0; i < TX_MAX_VEHICLES; i++) txFleet.setColorAt(i, new THREE.Color(0xffffff));
txFleet.instanceColor.needsUpdate = true;
trafficGroup.add(txFleet);
// Small emissive beads for headlights and tail lights. Instanced, like the
// cars themselves; never real point lights.
const txCarLightGroup = new THREE.Group();
txCarLightGroup.visible = false;
const txHeadGeo = new THREE.SphereGeometry(.072, 5, 4);
const txHeadMat = new THREE.MeshBasicMaterial({ color: 0xffedbd, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true });
const txTailGeo = new THREE.SphereGeometry(.055, 5, 4);
const txTailMat = new THREE.MeshBasicMaterial({ color: 0xff2f22, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true });
const txHeadLights = new THREE.InstancedMesh(txHeadGeo, txHeadMat, TX_MAX_VEHICLES * 2);
const txTailLights = new THREE.InstancedMesh(txTailGeo, txTailMat, TX_MAX_VEHICLES * 2);
txHeadLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
txTailLights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
txHeadLights.frustumCulled = false;
txTailLights.frustumCulled = false;
for (let i = 0; i < TX_MAX_VEHICLES * 2; i++) {
  txHeadLights.setMatrixAt(i, zeroMatrix);
  txTailLights.setMatrixAt(i, zeroMatrix);
}
txHeadLights.instanceMatrix.needsUpdate = true;
txTailLights.instanceMatrix.needsUpdate = true;
txCarLightGroup.add(txHeadLights, txTailLights);
trafficGroup.add(txCarLightGroup);
const TX_CAR_COLORS = [0xe0c691, 0xb54b3c, 0x3f726a, 0xb2823f, 0x4f6582, 0x8e6c52, 0x8fa99b, 0xc9bda7, 0x6d4b69, 0x9b9f9f];
const TX_BUS_COLORS = [0xbad84f, 0xd2e664, 0xa5c847];
const txRandom = mulberry32(77441);
const txVehicles = [];
const txActive = [];
const txFreeSlots = [];
const txLaneKey = (edgeId, dir, lane) => edgeId * 8 + (dir > 0 ? 0 : 4) + lane;
const txDummy = new THREE.Object3D();
const txVec = new THREE.Vector3();
let txActiveCount = 0;
let txSpawnBudget = 0;
let txDespawnBudget = 0;
let txStatsAccum = 0;
let txCongestionAccum = 0;
const txStats = {
  vehicles: 0,
  avgSpeed: 0,
  congestion: 0,
  congested: 0,
  avgFreedom: 1,
  demand: 0,
  generationRate: 0
};
const trafficSim = {
  clock: 0,
  demand: 0,
  demandTarget: 0,
  seeded: false,
  initialized: false,
  accumulator: 0,
  lastStats: txStats
};

function txDemandAt(hour) {
  // Piecewise-linear demand curve from the brief.
  const pts = [
    [0, .10], [6.5, .10], [8.5, 1.00], [11, .50], [12, .55],
    [15, .60], [18.5, 1.10], [21, .40], [24, .15]
  ];
  if (hour <= 0) return .10;
  for (let i = 0; i < pts.length - 1; i++) {
    const [h0, v0] = pts[i], [h1, v1] = pts[i + 1];
    if (hour >= h0 && hour <= h1) {
      const t = (hour - h0) / (h1 - h0 || 1);
      return v0 + (v1 - v0) * t;
    }
  }
  return .15;
}
function txWeatherFactor() {
  const v = Number(window.weatherFactor);
  return (isFinite(v) && v >= 0) ? clamp(v, 0, 2) : 1;
}
function txMorningWeight(hour) {
  return smooth(6.9, 7.7, hour) * (1 - smooth(9.4, 10.3, hour));
}
function txEveningWeight(hour) {
  return smooth(16.9, 17.7, hour) * (1 - smooth(19.4, 20.3, hour));
}
function txLaneCountCap(edge) {
  return Math.max(1, Math.min(edge.laneCount || 1, 3));
}
function txLaneOffset(edge, lane) {
  const gap = clamp(edge.width * .31, .17, .33);
  return gap * (lane + .52);
}
function txNetworkCapacity() {
  return TX_MAX_VEHICLES;
}
function txChooseWeighted(items, value) {
  let total = 0;
  for (const it of items) total += Math.max(0, it.weight);
  if (total <= 0) return items.length ? items[0] : null;
  let v = value * total;
  for (const it of items) {
    v -= Math.max(0, it.weight);
    if (v <= 0) return it;
  }
  return items[items.length - 1];
}
function txDirToward(nodeA, nodeB) {
  // Direction to traverse edge (stored start->end) from A towards B.
  return nodeA === nodeB ? 1 : 1;
}
function txPotentialBias(fromNode, toNode, dir) {
  const m = txMorningWeight(state.hour);
  const e = txEveningWeight(state.hour);
  let bias = 1;
  if (m > .01) {
    const deltaOffice = fromNode.officeDist - toNode.officeDist;
    bias *= 1 + m * clamp(deltaOffice / 28, -.5, 1.2) * 1.8;
    if (deltaOffice > 0) bias *= 1 + m * .35;
  }
  if (e > .01) {
    const deltaRes = fromNode.residentialDist - toNode.residentialDist;
    bias *= 1 + e * clamp(deltaRes / 28, -.5, 1.2) * 1.8;
  }
  return clamp(bias, .14, 4.5);
}
function txCanEnterLane(edge, dir, lane, entryPos, car, heads, extra) {
  const key = txLaneKey(edge.id, dir, lane);
  const head = heads.get(key);
  const extraHead = extra && extra.get(key);
  let pos = Infinity, otherLen = 0;
  if (head) { pos = head.pos; otherLen = head.len; }
  if (extraHead && extraHead.pos < pos) { pos = extraHead.pos; otherLen = extraHead.len; }
  if (pos === Infinity) return true;
  const required = (car.len + otherLen) * .5 + TX_MIN_GAP + .08;
  return pos - entryPos >= required;
}
function txMakeVehicle(slot) {
  return {
    slot, active: false, edge: null, dir: 1, lane: 0, pos: 0, speed: 0,
    len: .8, wid: .3, hgt: .18, type: 'car', color: 0xe6ddca,
    waitTransfers: false, listIndex: -1, targetSpeed: 0
  };
}
for (let i = 0; i < TX_MAX_VEHICLES; i++) txVehicles.push(txMakeVehicle(i));
for (let i = TX_MAX_VEHICLES - 1; i >= 0; i--) txFreeSlots.push(i);
const txSpawnCumulative = [];
{
  let acc = 0;
  for (const e of txEdges) { acc += e.spawnWeight; txSpawnCumulative.push(acc); }
}
function txPickSpawnEdge(rv) {
  if (!txEdges.length) return null;
  const total = txSpawnCumulative[txSpawnCumulative.length - 1] || 1;
  const target = rv * total;
  let lo = 0, hi = txSpawnCumulative.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (txSpawnCumulative[mid] < target) lo = mid + 1; else hi = mid;
  }
  return txEdges[lo];
}
function txBuildLaneHeads() {
  const heads = new Map();
  for (const car of txActive) {
    const key = txLaneKey(car.edge.id, car.dir, car.lane);
    const prev = heads.get(key);
    if (!prev || car.pos < prev.pos) heads.set(key, { pos: car.pos, len: car.len, car });
  }
  return heads;
}
function txLanePositions() {
  const m = new Map();
  for (const car of txActive) {
    const key = txLaneKey(car.edge.id, car.dir, car.lane);
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(car.pos);
  }
  return m;
}
function txSpawnOne(occupancy) {
  if (!txFreeSlots.length) return false;
  const rv = txRandom();
  let edge = txPickSpawnEdge(rv);
  if (!edge) return false;
  let dir = txRandom() > .5 ? 1 : -1;
  const morning = txMorningWeight(state.hour), evening = txEveningWeight(state.hour);
  if (txRandom() < .8 && (morning > .04 || evening > .04) && edge.startNode && edge.endNode) {
    // Directional demand: spawn heading toward the office cluster in the
    // morning, and toward residential / metro clusters in the evening.
    const useOffice = morning >= evening;
    const dStart = useOffice ? edge.startNode.officeDist : edge.startNode.residentialDist;
    const dEnd = useOffice ? edge.endNode.officeDist : edge.endNode.residentialDist;
    if (Math.abs(dStart - dEnd) > .25) dir = dEnd < dStart ? 1 : -1;
  }
  const lanes = txLaneCountCap(edge);
  const lane = Math.floor(txRandom() * lanes);
  const carLen = .8;
  const minPos = carLen * .5 + .12;
  const maxPos = edge.length - carLen * .5 - .12;
  if (maxPos <= minPos) return false;
  const key = txLaneKey(edge.id, dir, lane);
  const positions = occupancy.get(key) || [];
  let pos = -1;
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = minPos + txRandom() * (maxPos - minPos);
    let ok = true;
    for (const p of positions) {
      if (Math.abs(p - candidate) < carLen + .75) { ok = false; break; }
    }
    if (ok) { pos = candidate; break; }
  }
  if (pos < 0) return false;
  const slot = txFreeSlots.pop();
  const car = txVehicles[slot];
  const isBus = txRandom() < .045;
  car.active = true;
  car.edge = edge;
  car.dir = dir;
  car.lane = lane;
  car.pos = pos;
  car.speed = edge.targetSpeedWorld * (isBus ? .62 : .72);
  car.targetSpeed = edge.targetSpeedWorld * (isBus ? .78 : 1);
  car.len = isBus ? 1.18 : .8;
  car.wid = isBus ? .38 : .3;
  car.hgt = isBus ? .29 : .2;
  car.type = isBus ? 'bus' : 'car';
  car.waitTransfers = false;
  const palette = isBus ? TX_BUS_COLORS : TX_CAR_COLORS;
  car.color = palette[Math.floor(txRandom() * palette.length)];
  car.listIndex = txActive.length;
  txActive.push(car);
  if (!occupancy.has(key)) occupancy.set(key, []);
  occupancy.get(key).push(pos);
  txFleet.setColorAt(slot, txNewColor(car.color));
  txFleet.instanceColor.needsUpdate = true;
  return true;
}
const txTmpColor = new THREE.Color();
function txNewColor(hex) { return new THREE.Color(hex); }
function txSeedFleet() {
  const wf = txWeatherFactor();
  const demand = txDemandAt(state.hour) * wf;
  const desired = Math.round(clamp(TX_BASE_ACTIVE * demand, 80, TX_MAX_VEHICLES));
  trafficSim.demand = demand;
  trafficSim.demandTarget = demand;
  txUpdateEdgeTargets(demand);
  const occupancy = new Map();
  let attempts = 0;
  while (txActive.length < desired && attempts < desired * 4 && txFreeSlots.length) {
    txSpawnOne(occupancy);
    attempts++;
  }
  trafficSim.seeded = true;
  txActiveCount = txActive.length;
  txUpdateAllVehicleMatrices();
}

function txUpdateEdgeTargets(demand) {
  const load = clamp(demand / 1.0, 0, 1.16);
  const wf = txWeatherFactor();
  for (const edge of txEdges) {
    const slowClass = edge.main ? .72 : (edge.arterial ? .47 : .29);
    let factor = 1 - load * slowClass * edge.jitter;
    factor = clamp(factor, .18, .985);
    edge.targetFactor = factor;
    edge.modelSpeedKmh = edge.speedLimit * factor * wf;
    edge.targetSpeedWorld = edge.modelSpeedKmh * TX_KMH_TO_WORLD;
  }
}

function txUpdateAllVehicleMatrices() {
  // Build instance matrices for active vehicles. Called once at startup and
  // then every rendered frame; the fixed physics owns the positions.
  for (const car of txActive) txSetVehicleMatrix(car);
  txFleet.instanceMatrix.needsUpdate = true;
  txHeadLights.instanceMatrix.needsUpdate = true;
  txTailLights.instanceMatrix.needsUpdate = true;
}
const txLightDummy = new THREE.Object3D();
function txSetLightPair(car, hx, hz, nx, nz, cx, cy, cz) {
  const front = car.len * .49, side = car.wid * .34;
  for (let s = 0; s < 2; s++) {
    const sign = s === 0 ? -1 : 1;
    const bx = cx + hx * front + nx * side * sign;
    const bz = cz + hz * front + nz * side * sign;
    txLightDummy.position.set(bx, cy, bz);
    txLightDummy.scale.setScalar(1);
    txLightDummy.updateMatrix();
    txHeadLights.setMatrixAt(car.slot * 2 + s, txLightDummy.matrix);
    const rx = cx - hx * front + nx * side * sign;
    const rz = cz - hz * front + nz * side * sign;
    txLightDummy.position.set(rx, cy, rz);
    txLightDummy.updateMatrix();
    txTailLights.setMatrixAt(car.slot * 2 + s, txLightDummy.matrix);
  }
}
function txSetVehicleMatrix(car) {
  const edge = car.edge;
  const s = car.dir > 0 ? car.pos : edge.length - car.pos;
  const p = sampleRoute(edge.route, clamp(s, 0, edge.length));
  const hx = p.dx * (car.dir > 0 ? 1 : -1);
  const hz = p.dz * (car.dir > 0 ? 1 : -1);
  const nx = -hz, nz = hx;
  const off = txLaneOffset(edge, car.lane);
  const cx = p.x + nx * off, cz = p.z + nz * off;
  const cy = .33 + car.hgt * .5;
  txDummy.position.set(cx, cy, cz);
  txDummy.rotation.set(0, Math.atan2(hx, hz), 0);
  txDummy.scale.set(car.wid, car.hgt, car.len);
  txDummy.updateMatrix();
  txFleet.setMatrixAt(car.slot, txDummy.matrix);
  txSetLightPair(car, hx, hz, nx, nz, cx, .33 + car.hgt * .32, cz);
}
function txSetVehicleZero(car) {
  txFleet.setMatrixAt(car.slot, zeroMatrix);
  txHeadLights.setMatrixAt(car.slot * 2, zeroMatrix);
  txHeadLights.setMatrixAt(car.slot * 2 + 1, zeroMatrix);
  txTailLights.setMatrixAt(car.slot * 2, zeroMatrix);
  txTailLights.setMatrixAt(car.slot * 2 + 1, zeroMatrix);
}

function txRemoveVehicleAt(index) {
  const car = txActive[index];
  if (!car) return;
  car.active = false;
  const last = txActive.pop();
  if (last && last !== car) {
    txActive[index] = last;
    last.listIndex = index;
  }
  txSetVehicleZero(car);
  txFreeSlots.push(car.slot);
  car.edge = null;
  car.listIndex = -1;
  txFleet.instanceMatrix.needsUpdate = true;
  txHeadLights.instanceMatrix.needsUpdate = true;
  txTailLights.instanceMatrix.needsUpdate = true;
}

// Step 1 of the fixed tick: queues, car-following, signals.
function txStepQueues(dt) {
  const laneGroups = new Map();
  for (const car of txActive) {
    const key = txLaneKey(car.edge.id, car.dir, car.lane);
    let group = laneGroups.get(key);
    if (!group) { group = []; laneGroups.set(key, group); }
    group.push(car);
  }
  for (const group of laneGroups.values()) {
    group.sort((a, b) => b.pos - a.pos);
    let leader = null;
    for (const car of group) {
      const edge = car.edge;
      const destNode = car.dir > 0 ? edge.endNode : edge.startNode;
      const sig = destNode && destNode.signal;
      let stopDist = Infinity;
      let redApproach = false;
      if (sig) {
        const phase = signalPhase(trafficSim.clock, sig);
        const state = signalStateForAxis(phase, edge.axisByDir[car.dir]);
        const stopCenter = edge.length - car.len * .5 - .34;
        if (state !== 'green' && car.pos <= stopCenter + .02) {
          stopDist = stopCenter;
          redApproach = true;
        }
      }
      let desired = edge.targetSpeedWorld * (car.type === 'bus' ? .78 : 1);
      let leaderGap = Infinity;
      if (leader) {
        leaderGap = leader.pos - car.pos - (leader.len + car.len) * .5;
        if (leaderGap < .24) desired = Math.min(desired, Math.max(0, leaderGap - TX_MIN_GAP) * 3.2);
        else desired = Math.min(desired, Math.max(0, leaderGap - TX_MIN_GAP) * 2.3 + .1);
      }
      if (redApproach) {
        const d = Math.max(0, stopDist - car.pos);
        desired = Math.min(desired, Math.sqrt(d * 2 * 4.5) * .9);
      }
      if (car.waitTransfers) desired = 0;
      car.targetSpeed = desired;
      const dv = desired - car.speed;
      const accel = dv >= 0 ? TX_ACCEL : TX_BRAKE;
      car.speed += clamp(dv, -accel * dt, accel * dt);
      if (car.speed < 0) car.speed = 0;
      let targetPos = car.pos + car.speed * dt;
      if (leader) {
        const maxPos = leader.pos - (leader.len + car.len) * .5 - TX_MIN_GAP;
        if (targetPos > maxPos) {
          targetPos = maxPos;
          car.speed = 0;
        }
      }
      if (redApproach) {
        if (targetPos > stopDist) { targetPos = stopDist; car.speed = 0; }
      }
      if (targetPos > edge.length) { targetPos = edge.length; }
      if (targetPos < 0) targetPos = 0;
      car.pos = targetPos;
      car.waitTransfers = false;
      leader = car;
    }
  }
}

function txOutgoingOptions(car) {
  const edge = car.edge;
  const node = car.dir > 0 ? edge.endNode : edge.startNode;
  if (!node) return { node: null, options: [] };
  const options = [];
  for (const out of node.outgoing) {
    if (!out || !out.edge) continue;
    if (out.edge === edge && node.outgoing.length > 1) continue; // avoid immediate U-turn
    const dest = out.dir > 0 ? out.edge.endNode : out.edge.startNode;
    const base = out.edge.trafficWeight * txPotentialBias(node, dest, out.dir);
    options.push({ edge: out.edge, dir: out.dir, weight: base });
  }
  if (!options.length) {
    // dead-end: permit a U-turn if that is the only option
    for (const out of node.outgoing) options.push({ edge: out.edge, dir: out.dir, weight: out.edge.trafficWeight });
  }
  return { node, options };
}
function txTransferVehicles() {
  // Heads are measured in oriented-edge coordinates. We update them as cars
  // are merged into a new lane, so two cars may never enter at the same place.
  const heads = txBuildLaneHeads();
  const extraHeads = new Map();
  const pending = [];
  for (const car of txActive) {
    if (car.pos >= car.edge.length - .015) pending.push(car);
  }
  if (!pending.length) return;
  for (const car of pending) {
    const { node, options } = txOutgoingOptions(car);
    if (!node || !options.length) { car.waitTransfers = true; continue; }
    const phase = node.signal ? signalPhase(trafficSim.clock, node.signal) : null;
    // If this car is still before the stop line and the signal is red/yellow,
    // the queue step has already stopped it. If it reached the node, it may
    // clear the intersection; transfer policy only enforces entry space.
    const laneCandidates = [];
    for (const opt of options) {
      const lanes = txLaneCountCap(opt.edge);
      for (let lane = 0; lane < lanes; lane++) {
        // favour the rightmost lane lightly; all lanes are legal
        laneCandidates.push({
          edge: opt.edge, dir: opt.dir, lane,
          weight: opt.weight * (1 - lane * .08)
        });
      }
    }
    let moved = false;
    for (let attempt = 0; attempt < 6 && !moved; attempt++) {
      const chosen = txChooseWeighted(laneCandidates, txRandom());
      if (!chosen) break;
      const entryPos = car.len * .5 + .1;
      if (!txCanEnterLane(chosen.edge, chosen.dir, chosen.lane, entryPos, car, heads, extraHeads)) continue;
      car.edge = chosen.edge;
      car.dir = chosen.dir;
      car.lane = chosen.lane;
      car.pos = entryPos;
      car.speed = Math.min(car.speed, chosen.edge.targetSpeedWorld * .88);
      car.targetSpeed = chosen.edge.targetSpeedWorld;
      car.waitTransfers = false;
      const key = txLaneKey(chosen.edge.id, chosen.dir, chosen.lane);
      const prev = extraHeads.get(key);
      if (!prev || entryPos < prev.pos) extraHeads.set(key, { pos: entryPos, len: car.len, car });
      moved = true;
    }
    if (!moved) car.waitTransfers = true;
  }
}
function txUpdateDemandAndFleet(dt) {
  const wf = txWeatherFactor();
  const targetDemand = txDemandAt(state.hour) * wf;
  const tau = .92;
  trafficSim.demand += (targetDemand - trafficSim.demand) * (1 - Math.exp(-dt / tau));
  trafficSim.demandTarget = targetDemand;
  txUpdateEdgeTargets(trafficSim.demand);
  const desired = Math.round(clamp(TX_BASE_ACTIVE * trafficSim.demand, 70, TX_MAX_VEHICLES));
  txActiveCount = txActive.length;
  // Generation is explicitly base rate × time factor × weatherFactor.
  const genRate = TX_BASE_GENERATION * trafficSim.demand;
  txSpawnBudget += genRate * dt;
  if (txActive.length < desired) {
    let spawned = 0;
    const occupancy = txLanePositions();
    while (txSpawnBudget >= 1 && txActive.length < desired && spawned < 16) {
      if (txSpawnOne(occupancy)) {
        txSpawnBudget -= 1;
        spawned++;
      } else {
        // no free spot in this pass; don't burn the entire budget forever
        txSpawnBudget = Math.min(txSpawnBudget, .9);
        break;
      }
    }
    if (spawned === 0) txSpawnBudget = Math.min(txSpawnBudget, .9);
  } else if (txActive.length > desired) {
    // Density changes are eased by demand, and removal is rate-limited to
    // avoid an instant empty network.
    const removalRate = 460 + Math.min(620, Math.abs(txActive.length - desired) * 1.15);
    txDespawnBudget += removalRate * dt;
    while (txDespawnBudget >= 1 && txActive.length > desired) {
      txRemoveVehicleAt(txActive.length - 1);
      txDespawnBudget -= 1;
    }
  } else {
    txSpawnBudget = Math.min(txSpawnBudget, 1.2);
  }
  txActiveCount = txActive.length;
}
function txFixedStep(dt) {
  trafficSim.clock += dt;
  computeSignalStates();
  txUpdateDemandAndFleet(dt);
  txStepQueues(dt);
  txTransferVehicles();
  // Matrices are written once per rendered frame in txRenderFleet().
  // Keep per-edge target colour current even between dashboard ticks. This is
  // the model's free-flow congestion field; measured speeds refine it below.
  const load = clamp(trafficSim.demand / 1.0, 0, 1.16);
  for (const edge of txEdges) {
    if (!edge.lastCars) edge.targetFreedom = clamp(edge.targetFactor, .05, 1);
  }
}
function txUpdateCongestionColors(dt) {
  if (!state.layers.congestion) return;
  txCongestionAccum += dt;
  if (txCongestionAccum < .1) return;
  const step = Math.min(.1, txCongestionAccum);
  txCongestionAccum = 0;
  const attr = congestionGroup.userData.colorAttr;
  const baseAttr = roadsGroup.userData.colorAttr;
  if (!attr || !baseAttr) return;
  const k = 1 - Math.exp(-step * 2.4);
  for (const edge of txEdges) {
    edge.visualFreedom += (edge.targetFreedom - edge.visualFreedom) * k;
    const f = edge.visualFreedom;
    if (f <= .4) txTmpColor.copy(CONGESTION_RED).lerp(CONGESTION_AMBER, clamp(f / .4, 0, 1));
    else if (f <= .7) txTmpColor.copy(CONGESTION_AMBER).lerp(CONGESTION_YELLOW, (f - .4) / .3);
    else txTmpColor.copy(CONGESTION_YELLOW).lerp(CONGESTION_GREEN, smooth(.7, 1, f));
    const start = edge.route.congestionStart;
    const end = edge.route.congestionEnd;
    for (let v = start; v < end; v++) {
      attr.array[v * 3] = txTmpColor.r;
      attr.array[v * 3 + 1] = txTmpColor.g;
      attr.array[v * 3 + 2] = txTmpColor.b;
    }
    // A softer tint on the asphalt helps the ribbon read at the full-city
    // camera distance where a 1-unit strip is only a couple of pixels wide.
    txBaseColor.copy(edge.route.baseColor).lerp(txTmpColor, .30);
    const bs = edge.route.vertexStart;
    const be = edge.route.vertexEnd;
    for (let v = bs; v < be; v++) {
      baseAttr.array[v * 3] = txBaseColor.r;
      baseAttr.array[v * 3 + 1] = txBaseColor.g;
      baseAttr.array[v * 3 + 2] = txBaseColor.b;
    }
  }
  attr.needsUpdate = true;
  baseAttr.needsUpdate = true;
}
const CONGESTION_RED = new THREE.Color(0xe14d32);
const txBaseColor = new THREE.Color();
const txTmpColorForLegend = new THREE.Color();
const CONGESTION_AMBER = new THREE.Color(0xd98545);
const CONGESTION_YELLOW = new THREE.Color(0xe7c45b);
const CONGESTION_GREEN = new THREE.Color(0x67ce96);
function txCongestionWord(f) {
  if (f < .4) return '拥堵';
  if (f <= .7) return '缓行';
  return '通畅';
}
function txRefreshStats() {
  const sums = new Map();
  for (const car of txActive) {
    let s = sums.get(car.edge.id);
    if (!s) { s = { sum: 0, n: 0 }; sums.set(car.edge.id, s); }
    s.sum += car.speed / TX_KMH_TO_WORLD;
    s.n++;
  }
  let weightedSpeed = 0, weightedFreedom = 0, totalLen = 0, congested = 0;
  for (const edge of txEdges) {
    const s = sums.get(edge.id);
    const measured = s && s.n ? s.sum / s.n : null;
    const model = edge.modelSpeedKmh;
    const avg = measured === null ? model : measured * .68 + model * .32;
    edge.avgSpeedKmh = avg;
    edge.freedom = clamp(avg / edge.speedLimit, 0, 1);
    edge.targetFreedom = edge.freedom;
    edge.lastCars = s ? s.n : 0;
    edge.lastMeasuredKmh = measured || 0;
    weightedSpeed += avg * edge.length;
    weightedFreedom += edge.freedom * edge.length;
    totalLen += edge.length;
    if (edge.freedom < .4) congested++;
  }
  const avgSpeed = totalLen ? weightedSpeed / totalLen : 0;
  const avgFreedom = totalLen ? weightedFreedom / totalLen : 1;
  // 0 = free-flow, 10 = near gridlock. The 16.2 factor preserves the
  // requested >6 peak reading while remaining a direct freedom transform.
  const congestion = clamp((1 - avgFreedom) * 16.2, 0, 10);
  txStats.vehicles = txActive.length;
  txStats.avgSpeed = avgSpeed;
  txStats.congestion = congestion;
  txStats.congested = congested;
  txStats.avgFreedom = avgFreedom;
  txStats.demand = trafficSim.demand;
  txStats.generationRate = TX_BASE_GENERATION * trafficSim.demand;
  return txStats;
}
function txRenderFleet() {
  if (!state.layers.traffic) return;
  for (const car of txActive) txSetVehicleMatrix(car);
  txFleet.instanceMatrix.needsUpdate = true;
  txHeadLights.instanceMatrix.needsUpdate = true;
  txTailLights.instanceMatrix.needsUpdate = true;
}
txSeedFleet();
computeSignalStates();
updateTrafficSignalVisuals(0, true);
trafficSim.initialized = true;
$('roadGraphLabel').textContent = 'NODES ' + txNodes.length.toLocaleString('en-US') + ' · EDGES ' + txEdges.length.toLocaleString('en-US') + ' · SIGNALS ' + txSignals.length;

// ── metro: lines 2 & 13 ─────────────────────────────────────
bootStatus.textContent = '正在点亮地铁 2 / 13 号线…';
const metroCurves = [];
const metroTrainMeshes = [];
const metroStationMeshes = [];
{
  const lineDirections = {};
  for (const line of DATA.subway) {
    const lineNo = line.line;
    lineDirections[lineNo] = { color: new THREE.Color(line.color), longest: null, longestLength: 0 };
    for (const flat of line.paths) {
      const pts = flatPointsToVectors(flat).map(([x,z]) => new THREE.Vector3(x, 2.15, z));
      if (pts.length < 2) continue;
      // remove accidental duplicated points
      const clean = [pts[0]];
      for (let i = 1; i < pts.length; i++) if (pts[i].distanceToSquared(clean[clean.length-1]) > .0004) clean.push(pts[i]);
      if (clean.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(clean, false, 'catmullrom', .2);
      const length = curve.getLength();
      if (length > lineDirections[lineNo].longestLength) { lineDirections[lineNo].longest = curve; lineDirections[lineNo].longestLength = length; }
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(12, Math.floor(length * 1.5)), .10, 5, false),
        new THREE.MeshBasicMaterial({ color: line.color, toneMapped: false, fog: true })
      );
      tube.renderOrder = 3;
      metroGroup.add(tube);
      const halo = new THREE.Mesh(
        new THREE.TubeGeometry(curve, Math.max(12, Math.floor(length * 1.5)), .34, 5, false),
        new THREE.MeshBasicMaterial({ color: line.color, transparent: true, opacity: .13, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
      );
      halo.renderOrder = 3;
      metroGroup.add(halo);
    }
  }
  for (const lineNo of ['2', '13']) {
    const ld = lineDirections[lineNo];
    if (!ld || !ld.longest) continue;
    const color = new THREE.Color(lineNo === '2' ? 0x66e1ce : 0xf0bd7c);
    metroCurves.push({ line: lineNo, curve: ld.longest, length: ld.longestLength, color });
    for (let t = 0; t < 2; t++) {
      const train = new THREE.Mesh(
        new THREE.BoxGeometry(.38, .35, 1.18),
        new THREE.MeshBasicMaterial({ color, toneMapped: false, fog: true })
      );
      train.renderOrder = 4;
      metroGroup.add(train);
      metroTrainMeshes.push({ mesh: train, curve: ld.longest, offset: t * .47 + (lineNo === '2' ? .08 : .19), speed: 0.0065 + (lineNo === '13' ? .001 : 0) });
    }
  }
  for (const st of DATA.stations) {
    const color = new THREE.Color(st.lines.includes('2') && st.lines.includes('13') ? 0xf1d79d : st.lines.includes('2') ? 0x69e5d3 : 0xf0bd7c);
    const x = wx(st.x), z = wz(st.z);
    const group = new THREE.Group();
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.1, .25, 12), new THREE.MeshStandardMaterial({ color: 0x18261f, roughness: .85, metalness: 0, envMapIntensity: .25 }));
    base.position.y = .23;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.7, 2.2, 24), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .45, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .4;
    group.add(ring);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(.36, 8, 6), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    dot.position.y = .9; group.add(dot);
    group.position.set(x, 0, z);
    group.userData.station = st;
    metroGroup.add(group);
    metroStationMeshes.push({ group, st });
  }
}
world.add(metroGroup);

world.add(metroGroup);

// ── night illumination: street lamps, landmark outlines, 6 point lights ──
let streetLampGroup = null;
let streetLampBulbMaterial = null;
let streetLampHaloMaterial = null;
let streetLampPoleMaterial = null;
let beaconMaterial = null;
let landmarkOutlineMaterial = null;
let landmarkGlowMaterial = null;
const nightPointLights = [];
let streetLampCount = 0;
{
  // Lamps are instanced: two draw calls for poles + bulbs, one point cloud for
  // halos. Positions follow named / important roads at an even spacing.
  const lampPositions = [];
  for (const rt of carRoutes) {
    if (!rt.name && rt.importance < .45) continue;
    if (rt.importance < .36) continue;
    const step = rt.importance > .65 ? 4.0 : 6.4;
    const n = Math.floor(rt.length / step);
    for (let k = 0; k < n; k++) {
      const p = sampleRoute(rt, (k + .5) * step);
      if (!p) continue;
      const nx = -p.dz, nz = p.dx;
      const side = k % 2 ? 1 : -1;
      const off = rt.width * .62 + .18;
      lampPositions.push({ x: p.x + nx * off * side, z: p.z + nz * off * side, tall: rt.importance > .65 });
    }
  }
  streetLampCount = lampPositions.length;
  if (streetLampCount) {
    streetLampGroup = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(.026, .046, 1.18, 4);
    streetLampPoleMaterial = new THREE.MeshStandardMaterial({ color: 0x323931, roughness: .35, metalness: .85, envMapIntensity: 1.0, transparent: true, opacity: 0 });
    streetLampPoleMaterial.userData.surface = 'metal';
    const poles = new THREE.InstancedMesh(poleGeo, streetLampPoleMaterial, streetLampCount);
    const bulbGeo = new THREE.SphereGeometry(.075, 5, 4);
    streetLampBulbMaterial = new THREE.MeshBasicMaterial({ color: 0xffdda0, transparent: true, opacity: 0, toneMapped: false, fog: true });
    const bulbs = new THREE.InstancedMesh(bulbGeo, streetLampBulbMaterial, streetLampCount);
    const haloPos = new Float32Array(streetLampCount * 3);
    const haloCol = new Float32Array(streetLampCount * 3);
    const d = new THREE.Object3D();
    const warm = new THREE.Color(0xffc879), cool = new THREE.Color(0xc9efe0);
    for (let i = 0; i < streetLampCount; i++) {
      const p = lampPositions[i];
      const h = p.tall ? 1.38 : 1.14;
      d.position.set(p.x, h * .5, p.z); d.scale.set(1, 1, 1); d.rotation.set(0, 0, 0); d.updateMatrix();
      poles.setMatrixAt(i, d.matrix);
      d.position.set(p.x, h, p.z); d.updateMatrix();
      bulbs.setMatrixAt(i, d.matrix);
      const c = i % 9 === 0 ? cool : warm;
      haloPos[i * 3] = p.x; haloPos[i * 3 + 1] = h; haloPos[i * 3 + 2] = p.z;
      haloCol[i * 3] = c.r; haloCol[i * 3 + 1] = c.g; haloCol[i * 3 + 2] = c.b;
    }
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    poles.castShadow = true;
    poles.receiveShadow = true;
    poles.frustumCulled = false;
    streetLampGroup.add(poles, bulbs);
    const hg = new THREE.BufferGeometry();
    hg.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
    hg.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
    streetLampHaloMaterial = new THREE.PointsMaterial({
      size: 6.2, map: glowTexture, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: true
    });
    streetLampGroup.add(new THREE.Points(hg, streetLampHaloMaterial));
    streetLampGroup.visible = false;
    nightGroup.add(streetLampGroup);
  }

  // Street furniture: a handful of bus shelters along the major routes. The
  // shelters are one merged, vertex-coloured mesh and cast real shadows.
  if (lampPositions.length > 40) {
    const bp = [], bc = [];
    const metal = new THREE.Color(0x3d4648);
    const roofCol = new THREE.Color(0x596366);
    const nStops = Math.min(18, Math.max(8, Math.floor(streetLampCount / 110)));
    const stride = Math.max(1, Math.floor(streetLampCount / nStops));
    for (let i = 0; i < nStops; i++) {
      const p = lampPositions[(i * stride + 23) % lampPositions.length];
      if (!p) continue;
      const rot = (i % 2 ? .35 : -.25);
      const x = p.x + (i % 3 - 1) * .45;
      const z = p.z + (i % 2 ? .55 : -.55);
      addBoxToArrays(bp, bc, x, .02, z, 1.55, 2.0, .08, metal, rot);
      addBoxToArrays(bp, bc, x, 2.02, z, 1.85, .10, .86, roofCol, rot);
      addBoxToArrays(bp, bc, x - .72, .02, z + .30, .07, 2.0, .07, metal, rot);
      addBoxToArrays(bp, bc, x + .72, .02, z + .30, .07, 2.0, .07, metal, rot);
    }
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
    bg.computeVertexNormals();
    const busMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .85, envMapIntensity: 1.0 });
    busMat.userData.surface = 'metal';
    const busMesh = new THREE.Mesh(bg, busMat);
    busMesh.castShadow = true;
    busMesh.receiveShadow = true;
    busMesh.frustumCulled = false;
    world.add(busMesh);
  }

  // Tower beacons on the thirty tallest roofs.
  const tallest = DATA.buildings.map((b, i) => ({ b, i, h: b.height || 0 })).sort((a, b) => b.h - a.h).slice(0, 30);
  const bpos = [], bcol = [];
  for (const item of tallest) {
    const ring = flatPointsToVectors(item.b.p || []);
    if (!ring.length) continue;
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const y = BUILD_Y + wh(item.b.height || 0) + .7;
    bpos.push(cx, y, cz);
    bcol.push(1, .18, .10);
  }
  if (bpos.length) {
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bpos, 3));
    bg.setAttribute('color', new THREE.Float32BufferAttribute(bcol, 3));
    beaconMaterial = new THREE.PointsMaterial({
      size: 3.6, map: glowTexture, vertexColors: true, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false
    });
    const beacons = new THREE.Points(bg, beaconMaterial);
    beacons.renderOrder = 4;
    nightGroup.add(beacons);
  }

  // Roof + base outlines for landmark buildings (OSM footprints or normalized
  // hand-written footprints alike).
  const outlinePos = [];
  const outlineGlowPos = [];
  const outlined = new Set();
  for (const lm of DATA.landmarks) {
    for (const bi of (lm.buildings || [])) {
      if (outlined.has(bi)) continue;
      if (bi === CR_BUILDING_INDEX || TENCENT_BUILDING_INDICES.has(bi) || SBO_SKIP_INDICES.has(bi) || ANDAZ_SKIP_INDICES.has(bi) || LENOVO_SKIP_INDICES.has(bi) || DAJIA_SKIP_INDICES.has(bi) || XIAOMI_SKIP_INDICES.has(bi) || COCOON_SKIP_INDICES.has(bi) || NEIGHBOUR_SKIP_INDICES.has(bi) || COASTAL_SKIP_INDICES.has(bi) || POLY_SKIP_INDICES.has(bi) || EXCELLENCE_SKIP_INDICES.has(bi) || PORT_SKIP_INDICES.has(bi) || SZU_SKIP_INDICES.has(bi) || HYTERA_SKIP_INDICES.has(bi) || CAPITAL_SKIP_INDICES.has(bi) || AEROSPACE_SKIP_INDICES.has(bi) || CNOOC_SKIP_INDICES.has(bi) || RONCHAO_SKIP_INDICES.has(bi) || VENTURE_SKIP_INDICES.has(bi) || OFFICEWALL_SKIP.has(bi) || BYTEDANCE_SKIP_INDICES.has(bi) || HISENSE_SKIP_INDICES.has(bi) || XUNLEI_SKIP_INDICES.has(bi) || VENTURE_NEIGHBOR_SKIP.has(bi) || EASTWALL_SKIP.has(bi) || INNOVATION_SKIP.has(bi) || TSINGHUA_SKIP.has(bi) || CHINA_OVERSEAS_SKIP.has(bi) || YIHUA_SKIP.has(bi) || CAIXUN_SKIP.has(bi) || BUPT_SKIP.has(bi) || KETONG_SKIP.has(bi) || YOUXIAN_SKIP.has(bi) || LITE3_SKIP.has(bi) || BAIDU_SKIP.has(bi) || SOFTWARE_SKIP.has(bi)) continue; // bespoke towers have their own crowns/bands
      outlined.add(bi);
      const b = DATA.buildings[bi];
      if (!b) continue;
      const ring = flatPointsToVectors(b.p || []);
      if (ring.length < 3) continue;
      const top = BUILD_Y + Math.max(.38, wh(b.height || 12)) + .12;
      const base = BUILD_Y + .15;
      for (let e = 0; e < ring.length; e++) {
        const a = ring[e], d = ring[(e + 1) % ring.length];
        outlinePos.push(a[0], top, a[1], d[0], top, d[1]);
        outlinePos.push(a[0], base, a[1], d[0], base, d[1]);
        if (e % 2 === 0) outlineGlowPos.push(a[0], top + .04, a[1]);
      }
      // a few vertical corner strokes to read as an edge-lit tower
      const step = Math.max(1, Math.floor(ring.length / 4));
      for (let e = 0; e < ring.length; e += step) {
        outlinePos.push(ring[e][0], base, ring[e][1], ring[e][0], top, ring[e][1]);
      }
    }
  }
  if (outlinePos.length) {
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.Float32BufferAttribute(outlinePos, 3));
    landmarkOutlineMaterial = new THREE.LineBasicMaterial({ color: 0xffd58c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: true });
    const outline = new THREE.LineSegments(og, landmarkOutlineMaterial);
    outline.renderOrder = 7;
    nightGroup.add(outline);
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(outlineGlowPos, 3));
    landmarkGlowMaterial = new THREE.PointsMaterial({ size: 4.4, map: glowTexture, color: 0xffd79a, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false, fog: true });
    const glow = new THREE.Points(gg, landmarkGlowMaterial);
    glow.renderOrder = 8;
    nightGroup.add(glow);
  }

  // Only seven real point lights in the whole city: four landmark crowns and
  // three important intersections. Everything else is emissive geometry.
  const specs = [];
  for (const id of ['tencent-binhai', 'baidu-intl', 'software-base', 'china-resources']) {
    const lm = DATA.landmarks.find(l => l.id === id && (l.buildings || []).length);
    if (lm) {
      let mh = 0;
      for (const bi of lm.buildings) mh = Math.max(mh, (DATA.buildings[bi] && DATA.buildings[bi].height) || 0);
      specs.push({ x: wx(lm.x), z: wz(lm.z), y: Math.max(6, wh(mh) * .55), color: 0xffd49a, base: 1.15, dist: 32 });
    }
  }
  const signalOrder = txSignals.slice().sort((a, b) => (b.node.outgoing.length - a.node.outgoing.length));
  for (let i = 0; i < Math.min(3, signalOrder.length); i++) {
    const n = signalOrder[i].node;
    specs.push({ x: n.x, z: n.z, y: 3.2, color: 0xffc57a, base: .72, dist: 20 });
  }
  for (const s of specs.slice(0, 7)) {
    const pl = new THREE.PointLight(s.color, 0, s.dist, 2);
    pl.position.set(s.x, s.y, s.z);
    pl.castShadow = false;
    nightGroup.add(pl);
    nightPointLights.push({ light: pl, base: s.base });
  }
}

// ── landmark labels / supplemental anchors ───────────────────
bootStatus.textContent = '正在装订地标索引…';
const LANDMARK_COPY = {
  'china-resources': {
    desc: '中国华润大厦位于后海中心区，因锥形收尖的轮廓被称为“春笋”。本轮 Blender 外观精修保留 392.5 米原高度，增加 56→28 外柱、三角冠部、退让门厅和独立夜灯。构件与门窗为设计示意，非测绘模型。',
    tag: '后海 · 春笋',
    type: '总部办公',
    offset: 7
  },
  'tencent-binhai': {
    desc: '本轮 Blender 外观精修保留原双塔高度与朝向，重做折面幕墙、三条玻璃连廊、门式框架和塔脚入口；未叠加旧大裙楼。构件及连廊层位为参考资料下的设计示意，非测绘模型。',
    tag: '企业总部 · 后海',
    type: '总部办公',
    offset: 5.5
  },
  'baidu-intl': {
    desc: '百度国际大厦由东西双塔组成，以空中连廊连接，是科技园南片区具有代表性的研发办公总部。',
    tag: '研发总部 · 科苑',
    type: '研发办公',
    offset: 5
  },
  'software-base': {
    desc: '深圳市软件产业基地，由多栋研发楼与共享配套组成，街区尺度紧凑，是粤海软件与信息服务产业的重要载体。',
    tag: '产业园 · 科苑南',
    type: '产业园区',
    offset: 5
  },
  'szu': {
    desc: '深圳大学粤海校区位于大南山北麓、后海湾畔。校园中的教学楼、图书馆、宿舍与林荫绿地，让高密度城市获得一段缓慢的呼吸。',
    tag: '校园 · 后海湾',
    type: '高等教育',
    offset: 4
  },
  'tech-park': {
    desc: '科技园片区是深圳创新密度最高的街区之一，研发楼、企业总部、孵化器与人才公寓在这里高度混合。',
    tag: '片区 · 科技园',
    type: '产业片区',
    offset: 4,
    approx: true
  },
  'tencent-hq': {
    desc: '腾讯大厦位于科技园片区，是腾讯早期总部所在地。本次 OSM 导出范围没有包含它的建筑轮廓，因此以金色锚点示意其方位。',
    tag: '城市记忆 · 科技园',
    type: '总部办公',
    offset: 4,
    approx: true
  },
  'innovation-center': {
    desc: '深圳湾创新科技中心：A 311 m/B 247 m 双塔、两道空中连体、峡谷裙房、3 栋公寓；1173 按高位连廊锚处置。',
    tag: '综合体 · 高新南',
    type: '综合体',
    offset: 4
  },
  'venture-east-wall': {
    desc: '创投东延街段：1258 广晟科创 100 m/23F、1259 高技术示范按官方 149.9 m/34F；干净准精模，东端两级收分。',
    tag: '办公街墙 · 高新南',
    type: '办公组团',
    offset: 4
  },
  'venture-neighbors': {
    desc: '创投两侧四栋准精模：三诺 403 重底座+釉面盒、A8 409 八块折面琴键+LED、赛西 402、盈峰 424；创投本体不动。',
    tag: '办公街段 · 高新南',
    type: '办公组团',
    offset: 4
  },
  'xunlei-tower': {
    desc: '迅雷大厦：119 m/29F 窄长板塔；长立面 1.8 m 竖肋、两端金属实面、15F 避难环带、错台冠部；3F 南向大堂裙房。',
    tag: '科技办公 · 高新',
    type: '科技办公',
    offset: 4
  },
  'hisense-south': {
    desc: '海信南方大厦：160 m/30F 厚重总部塔；1.2 m 宽石材竖肋 @6 m、8 层石材横带、石材冠带、屋顶设备盒；3F 东南裙房与南向大堂。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'bytedance-houhai': {
    desc: '深圳字节跳动后海中心：150 m/32F 方正圆角玻璃塔；3 m 方格网、16F 外挑环带、封闭冠盒；3F 围合裙房、内庭院与东向大堂；无字牌。',
    tag: '科技总部 · 后海',
    type: '科技办公',
    offset: 4
  },
  'haide-office-wall': {
    desc: '海德三道北侧办公组团：7 栋准精模街墙，圆角平面、横竖分格、10 层环带、女儿墙/屋顶设备/冠带、3 层裙楼；工行四柱门廊与大堂。',
    tag: '办公街墙 · 后海',
    type: '办公组团',
    offset: 4
  },
  'venture-capital': {
    desc: '深圳湾创业投资大厦：202.4 m/44F 近方形玻璃塔；1.6 m 竖肋、22F 避难环带、三级冠框；3 层裙房、两层通高大堂与 6 m 雨棚。',
    tag: '总部 · 高新南',
    type: '总部办公',
    offset: 4
  },
  'rongchao-hq': {
    desc: '荣超高新区联合总部大厦：230 m/54F 方形圆角玻璃塔；东/南横板+12°竖斜板遮阳，北/西仅横板；1/3、2/3 避难层环带；4 层裙房与学府路大堂。',
    tag: '总部 · 高新南',
    type: '总部办公',
    offset: 4
  },
  'cnooc-twins': {
    desc: '中海油大厦 A/B 双子塔：210 m 拉长六边形塔、弧线收分、银色竖肋与 9 层环带；海浪飘带裙房跨路，架空广场/镜面水池；双塔冠线同亮。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'aerospace-plaza': {
    desc: '航天科技广场 A/B 座：232.1 m 与 130 m 双圆角玻璃塔，横向每层遮阳板 + 长边竖向斜板；六层共享裙房、屋顶花园、A 座冠带夜光；无字牌。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'capital-plaza': {
    desc: '深创投广场：261.3 m 方塔，折叠钻石幕墙（±0.35 m 真折面、0.8 m 金属棱线）；冠部南北渐宽、东西渐收；旋转 10° 的暗香槟裙房；无字牌。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'hytera-hq': {
    desc: '海能达全球总部大厦：258 m 长板塔，核心筒西偏；东西长立面三角钢桁架、悬浮 9 m 裙楼、向东斜切冠部与夜间冠带；无字牌。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'szu-performance': {
    desc: '深圳大学演会中心：圆形石材基座 + 大跨浅弧壳屋盖 + 径向真肋 + 弧形玻璃门厅/大台阶；OSM 高度 3.2m 为损坏数据，模型按 24m，需用户核对。',
    tag: '校园 · 场馆',
    type: '演会中心',
    offset: 4
  },
  'szbay-port': {
    desc: '深圳湾口岸：旅检大楼 + 北侧通长雨棚、双组查验通道薄壳雨棚、海关楼、前广场与围界；深圳湾大桥引桥从查验区南缘爬升出海，到数据南界 z=2320 收口，不虚构香港侧斜拉塔。',
    tag: '口岸 · 深圳湾',
    type: '口岸基础设施',
    offset: 4
  },
  'excellence-houhai': {
    desc: '卓越·后海中心：210 m 板式塔，圆角深蓝玻璃；塔楼相对 3 层裙房错动 6 m；四立面银色竖肋每 10 层分段、随高度横移 2.5 m；南面 4–18F 绿化边庭；两级退台塔冠，无字牌。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'poly-complex': {
    desc: '深圳保利剧院 + 保利文化广场：倾斜蛋形银灰网壳 + 真菱形网格 + 深青内胆玻璃；北侧剧场石盒；南侧共享前广场与三级台阶。广场为三块低矮体量，玻璃反射与亮度低剧院一档。',
    tag: '剧院 · 文化广场',
    type: '文化综合体',
    offset: 4
  },
  'coastal-city': {
    desc: '海岸城东座 / 西座：两座 8 层 25.6 m 商业体、真实内凹竖槽、屋顶玻璃连桥、两级退台商业裙楼、屋顶花园与步行街。高度严格按数据，不私自加高。',
    tag: '商业 · 海岸城',
    type: '商业综合体',
    offset: 4
  },
  'cr-neighbours': {
    desc: '春笋邻里组团：万家大厦（145 m）与宝格丽（153.7 m）。圆角玻璃塔、10 层环带、真女儿墙/屋顶设备、商业裙楼与围合绿化基座；宝格丽上部南/西面有 0.9 m 外挑阳台与栏杆。两栋都不是华润总部。',
    tag: '春笋邻里 · 后海',
    type: '办公 / 酒店住宅',
    offset: 4
  },
  'spring-cocoon': {
    desc: '深圳湾体育中心“春茧”：体育馆与游泳馆合并在一张连续茧形壳下，乳白膜面、±40°编织格栅、鞍部双峰；南侧主入口有顺壳雨棚，周边是台阶广场与草坪。',
    tag: '大运场馆 · 深圳湾',
    type: '体育中心',
    offset: 4
  },
  'xiaomi-shenzhen': {
    desc: '小米深圳总部“魔方”：圆角方盒裙房、贯通圆角转角的 LED 环幕、架空首层与悬浮方格玻璃盒；低矮体量，塔冠东南角只有 mi 标志，没有额外字牌。',
    tag: '总部 · 后海',
    type: '总部办公',
    offset: 4
  },
  'dajia': {
    desc: '大家财险总部大厦主楼：圆形平面的白色竖肋沙漏塔，腰部中段收细、顶部微外张；OSM 数据 314 m/62 层，模型按官方 273 m/57 层。配套 C11 附楼在 OSM 无对应记录，本轮不做。',
    tag: '圆柱塔 · 后海',
    type: '总部办公',
    offset: 4
  },
  'lenovo-houhai': {
    desc: '联想后海中心 A/B 座：A 座 203.5 m、42 层，B 座 132.7 m、28 层。东西长边密排银白竖肋，A 座上部西南角有矩形切角缺口，南面塔冠设红底白字 Lenovo 联想字牌。',
    tag: '双塔 · 后海',
    type: '总部办公',
    offset: 4
  },
  'andaz': {
    desc: '春笋东侧的直板混合塔：低区约 45% 为深圳湾安达仕酒店（ANDAZ），上部约 55% 为瑞府府邸。塔冠南、东两面为 ANDAZ 发光字牌。',
    tag: '酒店 + 府邸 · 深圳湾',
    type: '混合塔楼',
    offset: 4
  },
  'mixc': {
    desc: '深圳湾万象城连接后海商圈与滨海休闲带，是深圳湾片区重要的商业综合体。本次 OSM 导出中暂无该建筑的轮廓；下方体量是按公开体量做的示意精模，金色锚点仅示意方位。',
    tag: '示意模型 · OSM 暂无轮廓',
    type: '商业综合体',
    offset: 4,
    approx: true
  }
};
const landmarkData = new Map();
const landmarkLabelsEl = $('labels');
const stationLabelsEl = $('stationLabels');
const labelButtons = new Map();
const markerPickables = [];
// Label hierarchy registry. Tier 1 can survive the whole-city view; tier 2
// appears only near district scale; tier 3 is reveal-on-hover/selection.
const LABEL_TIER1 = ['中国华润大厦', '华润大厦', '腾讯滨海大厦', '深圳湾创新科技中心', '深圳湾体育中心', '春茧', '深圳湾万象城', '深圳湾口岸', '深创投广场', '深创投', '百度国际大厦', '深圳湾一号', '深圳保利剧院', '大家财险', '卓越后海中心', '卓越·后海中心', '字节跳动后海中心', '深圳字节跳动后海中心', '清华大学研究院', '联想后海中心', '深圳小米大厦'];
const LABEL_TIER2 = ['中国海外大厦', '海能达', '中海油', '深圳湾创业投资大厦', '怡化', '彩讯', '海信南方', '迅雷大厦', '微软科通', '北邮科技', '芒果网', '天虹', '来福士', '留学生', '深圳湾公馆', '海岸城', '后海汇', '航天科技广场', '荣超高新', '有线信息传输', '三诺智慧', 'A8音乐', '赛西科技', '盈峰大厦'];
const LABEL_NEAR_DIST = 185;
function labelTierOf(lm) {
  const n = lm.name || '';
  if (LABEL_TIER1.some(k => n.includes(k))) return 1;
  if (LABEL_TIER2.some(k => n.includes(k))) return 2;
  return 3;
}
const labelDensity = (() => {
  try { const v = localStorage.getItem('yuehai.labelDensity'); return ['minimal', 'standard', 'all'].includes(v) ? v : 'standard'; }
  catch (e) { return 'standard'; }
})();
state.labelDensity = labelDensity;
const hoverBuildingChip = document.createElement('button');
hoverBuildingChip.type = 'button';
hoverBuildingChip.className = 'landmark-label tier-3 is-temp';
hoverBuildingChip.innerHTML = '<span class="pin"></span><span></span>';
hoverBuildingChip.style.display = 'none';
landmarkLabelsEl.appendChild(hoverBuildingChip);
let hoverLabelId = null;
let hoverBuildingIdx = null;
hoverBuildingChip.addEventListener('click', () => { const bi = state.selectedBuilding ?? hoverBuildingIdx; if (bi != null) showBuilding(bi); });
// Blender landmark meshes are the pick targets. The arrays are filled by
// installBlenderLandmarks, which runs before this loop.
for (const [id, arr] of Object.entries(landmarkPickSets)) {
  for (const m of arr) {
    m.userData.customLandmarkId = id;
    markerPickables.push(m);
  }
}
const approxMarkers = new Map();
const labelAnchors = new Map();
const selectedGroup = new THREE.Group();
landmarkGroup.add(selectedGroup);

for (const lm of DATA.landmarks) {
  const copy = LANDMARK_COPY[lm.id] || { desc: lm.note || '', tag: 'OSM 地标', type: '地标', offset: 4 };
  const bs = lm.buildings || [];
  let maxH = 0;
  for (const bi of bs) {
    const b = DATA.buildings[bi];
    if (b && b.height > maxH) maxH = b.height;
  }
  const ax = wx(lm.x), az = wz(lm.z);
  const approx = lm.source === 'approx';
  const labelY = approx ? 6.4 : Math.max(3.5, wh(maxH) + 3.5 + (copy.offset || 0));
  const label = document.createElement('button');
  label.type = 'button';
  label.className = 'landmark-label tier-' + labelTierOf(lm);
  label.dataset.landmark = lm.id;
  label.dataset.tier = String(labelTierOf(lm));
  label.innerHTML = `<span class="pin"></span><span>${lm.name}</span>${approx ? `<span class="approx">${lm.id === 'mixc' ? '示意模型 · OSM 暂无轮廓' : '近似'}</span>` : ''}`;
  label.title = approx ? '近似锚点 · 点击查看说明' : '点击查看地标';
  label.addEventListener('click', (e) => {
    e.stopPropagation();
    showLandmark(lm.id);
  });
  landmarkLabelsEl.appendChild(label);
  labelButtons.set(lm.id, label);
  labelAnchors.set(lm.id, new THREE.Vector3(ax, labelY, az));
  landmarkData.set(lm.id, { ...lm, copy, maxH, approx, x: ax, z: az, labelY });

  if (approx) {
    const group = new THREE.Group();
    group.position.set(ax, 0, az);
    const beamMat = new THREE.MeshBasicMaterial({ color: 0xdfbb7c, transparent: true, opacity: .22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(.09, .28, 5.2, 6, 1, true), beamMat);
    beam.position.y = 2.6;
    group.add(beam);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(.48, 0), new THREE.MeshBasicMaterial({ color: 0xf3d79f, toneMapped: false }));
    gem.position.y = 5.4;
    group.add(gem);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.1, 1.45, 24), new THREE.MeshBasicMaterial({ color: 0xe0bc83, transparent: true, opacity: .52, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = .2;
    group.add(ring);
    const pick = new THREE.Mesh(new THREE.SphereGeometry(2.8, 8, 6), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    pick.position.y = 2.7;
    pick.userData.landmarkId = lm.id;
    group.add(pick);
    markerPickables.push(pick);
    approxMarkers.set(lm.id, group);
    landmarkGroup.add(group);
  }
}
const stationLabelMap = [];
for (const st of DATA.stations) {
  const d = document.createElement('div');
  d.className = 'station-label';
  d.innerHTML = `<span class="m">M</span>${st.name.replace(/站$/, '')} <span style="opacity:.62">${st.lines.join('/')}</span>`;
  stationLabelsEl.appendChild(d);
  stationLabelMap.push({ el: d, x: wx(st.x), y: 3.6, z: wz(st.z) });
}

// ── parking ──────────────────────────────────────────────────
const PARKING_LOTS = [
  { id: 'tencent', name: '腾讯滨海大厦停车库', short: '腾讯滨海', cap: 980, lm: 'tencent-binhai', profile: 'office', offset: [5, 7], bias: .105 },
  { id: 'software', name: '软件产业基地停车楼', short: '软件基地', cap: 1280, lm: 'software-base', profile: 'office', offset: [-9, 5], bias: .035 },
  { id: 'baidu', name: '百度国际大厦停车场', short: '百度国际', cap: 760, lm: 'baidu-intl', profile: 'office', offset: [6, 6], bias: .02 },
  { id: 'mixc', name: '深圳湾万象城停车场', short: '深圳湾万象城', cap: 2680, lm: 'mixc', profile: 'mall', offset: [-8, 5], bias: .02 },
  { id: 'port', name: '深圳湾口岸接驳停车区', short: '深圳湾口岸', cap: 1460, lm: null, profile: 'port', offset: [0, 0], x: 1915, z: 1568, bias: -.03 }];
const parkingBoards = new Map();
let parkingLastUpdate = 0;
const parkingPanel = $('parkingPanel');
const parkingList = $('parkingList');
function parkingStatus(ratio) {
  if (ratio > .33) return { label: '充足', cls: 'ok', color: '#7bd6a8' };
  if (ratio > .145) return { label: '适中', cls: 'mid', color: '#e0ba6f' };
  return { label: '紧张', cls: 'low', color: '#e08b73' };
}
function parkingAt(hour, profile) {
  const office = smooth(7.3, 9.1, hour) * (1 - smooth(17.4, 19.8, hour));
  const mall = smooth(10, 13, hour) * .34 + (1 - smooth(21.3, 23.3, hour)) * .16 + smooth(17.2, 20.2, hour) * .38;
  if (profile === 'office') return clamp(.23 + office * .66 + (hour > 18 ? -.08 : 0), .10, .94);
  if (profile === 'mall') return clamp(.30 + mall * .43 - office * .05, .2, .94);
  return clamp(.48 + smooth(7, 10, hour) * .16 + (1 - smooth(18, 22, hour)) * .07, .22, .9);
}
function buildParking() {
  const lmMap = new Map(DATA.landmarks.map(l => [l.id, l]));
  for (const lot of PARKING_LOTS) {
    let x = wx(lot.x !== undefined ? lot.x : (lmMap.get(lot.lm)?.x || 0));
    let z = wz(lot.z !== undefined ? lot.z : (lmMap.get(lot.lm)?.z || 0));
    x += lot.offset[0];
    z += lot.offset[1];
    lot.wx = x; lot.wz = z;
    const c = document.createElement('canvas'); c.width = 512; c.height = 164;
    const tex = new THREE.CanvasTexture(c); tex.minFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true, opacity: .95 });
    const spr = new THREE.Sprite(mat);
    spr.scale.set(5.6, 1.8, 1);
    spr.position.set(x, 3.2, z);
    spr.userData.lot = lot;
    parkingGroup.add(spr);
    parkingBoards.set(lot.id, { canvas: c, ctx: c.getContext('2d'), tex, sprite: spr, last: -1 });
  }
  parkingGroup.visible = false;
  for (const lot of PARKING_LOTS) {
    const row = document.createElement('div');
    row.className = 'parking-row';
    row.innerHTML = `<div class="parking-line"><span class="parking-name">${lot.name}</span><span class="parking-num"><b>—</b> / ${lot.cap.toLocaleString('en-US')}</span></div><div class="parking-bar"><div class="parking-fill"></div></div>`;
    row.dataset.lot = lot.id;
    parkingList.appendChild(row);
  }
}
function drawParkingBoard(lot, free, ratio, status) {
  const board = parkingBoards.get(lot.id);
  if (!board) return;
  const ctx = board.ctx, c = board.canvas;
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.save();
  const r = 13;
  ctx.beginPath();
  ctx.moveTo(8 + r, 8); ctx.lineTo(c.width - 8 - r, 8); ctx.quadraticCurveTo(c.width - 8, 8, c.width - 8, 8 + r);
  ctx.lineTo(c.width - 8, c.height - 8 - r); ctx.quadraticCurveTo(c.width - 8, c.height - 8, c.width - 8 - r, c.height - 8);
  ctx.lineTo(8 + r, c.height - 8); ctx.quadraticCurveTo(8, c.height - 8, 8, c.height - 8 - r);
  ctx.lineTo(8, 8 + r); ctx.quadraticCurveTo(8, 8, 8 + r, 8); ctx.closePath();
  ctx.fillStyle = 'rgba(5,18,12,.92)'; ctx.fill();
  ctx.strokeStyle = 'rgba(216,190,137,.4)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = status.color;
  ctx.fillRect(8, 38, 7, c.height - 76);
  ctx.fillStyle = 'rgba(233,227,215,.55)'; ctx.font = '500 21px "PingFang SC","Microsoft YaHei",sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(lot.short, 36, 41);
  ctx.fillStyle = status.color; ctx.beginPath(); ctx.arc(38, 94, 22, 0, TAU); ctx.fill();
  ctx.fillStyle = '#0c1810'; ctx.font = '700 28px "Arial",sans-serif'; ctx.textAlign = 'center'; ctx.fillText('P', 38, 96);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(233,227,215,.9)'; ctx.font = '500 43px "SFMono-Regular",Consolas,monospace';
  ctx.fillText(String(free), 80, 98);
  ctx.fillStyle = 'rgba(233,227,215,.46)'; ctx.font = '500 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText('空余车位 / ' + lot.cap.toLocaleString('en-US'), 80, 132);
  ctx.textAlign = 'right';
  ctx.fillStyle = status.color; ctx.font = '600 18px "PingFang SC","Microsoft YaHei",sans-serif';
  ctx.fillText(status.label, c.width - 24, 40);
  ctx.restore();
  board.tex.needsUpdate = true;
}
function updateParking(force) {
  const now = performance.now();
  if (!force && now - parkingLastUpdate < 1000) return;
  parkingLastUpdate = now;
  const lmMap = new Map(DATA.landmarks.map(l => [l.id, l]));
  for (const lot of PARKING_LOTS) {
    const occ = clamp(parkingAt(state.hour, lot.profile) + (lot.bias || 0), .05, .98);
    const free = Math.max(0, Math.round(lot.cap * (1 - occ)));
    const ratio = free / lot.cap;
    const status = parkingStatus(ratio);
    lot.free = free; lot.ratio = ratio; lot.status = status;
    const row = parkingList.querySelector(`[data-lot="${lot.id}"]`);
    if (row) {
      row.querySelector('.parking-num').innerHTML = `<b class="${status.cls}">${free.toLocaleString('en-US')}</b> / ${lot.cap.toLocaleString('en-US')}`;
      const fill = row.querySelector('.parking-fill');
      fill.style.width = Math.round(ratio * 100) + '%';
      fill.style.background = status.cls === 'ok' ? 'linear-gradient(90deg,#4faf82,#a2d7aa)' : status.cls === 'mid' ? 'linear-gradient(90deg,#b49152,#e0c47c)' : 'linear-gradient(90deg,#a55440,#d58d73)';
    }
    const b = parkingBoards.get(lot.id);
    if (b && (force || Math.round(free / 5) !== b.last)) {
      b.last = Math.round(free / 5);
      drawParkingBoard(lot, free, ratio, status);
    }
  }
  $('parkingUpdated').textContent = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

// ── environment & weather ────────────────────────────────────
const ENV_DAY_TOP = new THREE.Color(0x88b4d0);
const ENV_DAY_HORIZON = new THREE.Color(0xd8dfdc);
const ENV_NIGHT_TOP = new THREE.Color(0x030b18);
const ENV_NIGHT_HORIZON = new THREE.Color(0x09162a);
const ENV_DUSK = new THREE.Color(0xf0a078);
const ENV_WEATHER_GREY = new THREE.Color(0x8c999b);
const ENV_WEATHER_HORIZON = new THREE.Color(0xb8c1c1);
const SKY_STOPS = [
  [0.0, 0x030b18, 0x071526],
  [4.5, 0x040f1e, 0x0a1a2b],
  [5.6, 0x0c1d30, 0x1c2b3b],
  [6.5, 0x4e6886, 0xf1a57e],
  [7.4, 0x79a1bf, 0xc6d7dd],
  [12.0, 0x8bb6d2, 0xc7dce3],
  [16.5, 0x83abc6, 0xd4d4c8],
  [18.0, 0x657c98, 0xe8b79a],
  [18.5, 0x465b79, 0xf09a79],
  [19.0, 0x1a2b44, 0x44485b],
  [19.6, 0x081427, 0x101d32],
  [24.0, 0x030b18, 0x071526]
].map(([h, top, horizon]) => [h, new THREE.Color(top), new THREE.Color(horizon)]);
const targetTop = new THREE.Color();
const targetHorizon = new THREE.Color();
const tmpSkyTop = new THREE.Color();
const tmpSkyHorizon = new THREE.Color();
const tmpColor = new THREE.Color();
const targetSun = new THREE.Color(0xffe2b3);
const tmpFogTop = new THREE.Color(0x8c999b);
const tmpFogHorizon = new THREE.Color(0xbac2c2);
const tmpFogColor = new THREE.Color();
const WET_BED_TINT = new THREE.Color(0x465153);
const STORM_FOG_COLOR = new THREE.Color(0x465457);
const FOG_WEATHER_COLOR = new THREE.Color(0x5c696c);
const WET_BAND_TINT = new THREE.Color(0x526164);
const WET_ROAD_TINT = new THREE.Color(0x4f5d60);
const rainState = { drops: 8000, init: false, geo: null, positions: null, mat: null, data: [], mesh: null };
let cloudMesh = null;
const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xc4cbc3, emissive: 0x3f4a46, emissiveIntensity: .35, transparent: true, opacity: 0, depthWrite: false, roughness: 1, flatShading: true });
{
  const puff = new THREE.IcosahedronGeometry(1, 1);
  const count = 30;
  cloudMesh = new THREE.InstancedMesh(puff, cloudMaterial, count);
  const d = new THREE.Object3D();
  const r = mulberry32(3112);
  cloudMesh.userData.puffs = [];
  for (let i = 0; i < count; i++) {
    const angle = r() * TAU;
    const low = i < 9;
    const radius = low ? 72 + r() * 155 : 180 + r() * 170;
    cloudMesh.userData.puffs.push({
      x: Math.cos(angle) * radius,
      y: low ? 54 + r() * 42 : 104 + r() * 58,
      z: Math.sin(angle) * radius + (low ? 24 : 10),
      sx: low ? 13 + r() * 18 : 11 + r() * 19,
      sy: low ? 4 + r() * 5 : 4 + r() * 6,
      sz: low ? 9 + r() * 13 : 8 + r() * 12,
      drift: .16 + r() * .22
    });
  }
  world.add(cloudMesh);
  // 8,000 line elements in one draw call; the draw range follows weather and
  // the mesh follows the camera so rain always surrounds the visible frame.
  const pos = new Float32Array(rainState.drops * 6);
  rainState.data = [];
  for (let i = 0; i < rainState.drops; i++) {
    rainState.data.push({
      x: (r() - .5) * 440, y: r() * 160, z: (r() - .5) * 440,
      len: .38 + r() * 1.15, spd: 30 + r() * 38
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xb8d0d3, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const rain = new THREE.LineSegments(geo, mat);
  rain.frustumCulled = false;
  rain.renderOrder = 6;
  rain.visible = false;
  rainState.geo = geo; rainState.positions = pos; rainState.mat = mat; rainState.mesh = rain;
  world.add(rain);
}
// ── quality presets: particles / shadows / reflections ──
const QUALITY_PRESETS = {
  low:    { label: '流畅', pixel: .82, shadows: false, shadowMap: 512,  env: 'none',  rain: 2200, clouds: 12, lights: 2 },
  medium: { label: '均衡', pixel: 1.25, shadows: true,  shadowMap: 1024, env: 'glass', rain: 5000, clouds: 20, lights: 4 },
  high:   { label: '精美', pixel: 1.75, shadows: true,  shadowMap: 2048, env: 'all',   rain: 8000, clouds: 30, lights: 7 }
};
let rainQualityCap = 8000;
let qualityLightLimit = 6;
const qualityRuntime = { lowRun: 0, fps: 60, cooldownUntil: 0, frames: 0, accum: 0 };

function setShadowMapSize(size) {
  if (!sun || !sun.shadow) return;
  if (sun.shadow.mapSize.x === size && sun.shadow.mapSize.y === size && sun.shadow.map) return;
  sun.shadow.mapSize.set(size, size);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
  sun.shadow.camera.updateProjectionMatrix();
  renderer.shadowMap.needsUpdate = true;
}

function refreshEnvReflection() {
  const p = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.high;
  if (refinedLandmarks) refinedLandmarks.setEnvironment(currentCityEnv,p.env);
  scene.environment = p.env === 'all' ? currentCityEnv : null;
  if (glassMaterial) {
    const want = p.env !== 'none';
    if (!!glassMaterial.envMap !== want) glassMaterial.needsUpdate = true;
    glassMaterial.envMap = want ? currentCityEnv : null;
    glassMaterial.envMapIntensity = 1.2;
  }
  if (landmarkGlassUniforms) {
    landmarkGlassUniforms.uEnvMap.value = currentCityEnv;
    landmarkGlassUniforms.uEnvAmount.value = p.env === 'none' ? 0 : 1;
  }
  if (crTowerUniforms) {
    crTowerUniforms.uEnvMap.value = currentCityEnv;
    crTowerUniforms.uEnvAmount.value = p.env === 'none' ? 0 : 1;
  }
  if (tencentGlassMaterial) {
    const want = p.env !== 'none';
    if (!!tencentGlassMaterial.envMap !== want) tencentGlassMaterial.needsUpdate = true;
    tencentGlassMaterial.envMap = want ? currentCityEnv : null;
    tencentGlassMaterial.envMapIntensity = 1.2;
  }
  for (const mat of [crTowerMaterial, crLobbyGlassMaterial]) {
    if (!mat || !mat.isMeshStandardMaterial) continue;
    const want = p.env !== 'none';
    if (!!mat.envMap !== want) mat.needsUpdate = true;
    mat.envMap = want ? currentCityEnv : null;
    mat.envMapIntensity = 1.25;
  }
  for (const [mat, intensity] of [[mixcGlassMaterial, 1.15], [sboT7GlassMaterial, 1.3], [sboOtherGlassMaterial, 1.3], [andazGlassMaterial, 1.15], [lenovoGlassMaterial, 1.2], [dajiaGlassMaterial, 1.15], [xiaomiGlassMaterial, 1.1], [cocoonGlassMaterial, 1.0], [neighbourGlassMaterial, 1.2], [polyInnerGlassMaterial, 1.2], [polyPlazaGlassMaterial, .9], [excellenceGlassMaterial, 1.2], [szuGlassMaterial, 1.05], [hyteraGlassMaterial, 1.2], [capitalGlassMaterial, 1.3], [aerospacePodiumGlassMaterial, 1.15], [cnoocGlassMaterial, 1.2], [rongchaoGlassMaterial, 1.2], [ventureGlassMaterial, 1.15], [bytedanceGlassMaterial, 1.2]]) {
    if (!mat) continue;
    const want = p.env !== 'none';
    if (!!mat.envMap !== want) mat.needsUpdate = true;
    mat.envMap = want ? currentCityEnv : null;
    mat.envMapIntensity = intensity;
  }
  if (fakeAOMesh) fakeAOMesh.visible = !p.shadows;
}

function applyQuality(q, silent) {
  const preset = QUALITY_PRESETS[q] ? q : 'high';
  state.quality = preset;
  const p = QUALITY_PRESETS[preset];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixel));
  renderer.shadowMap.enabled = p.shadows;
  sun.castShadow = p.shadows;
  if (p.shadows) setShadowMapSize(p.shadowMap);
  else {
    sun.shadow.mapSize.set(512, 512);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
    sun.shadow.camera.updateProjectionMatrix();
  }
  renderer.shadowMap.needsUpdate = true;
  refreshEnvReflection();
  rainQualityCap = p.rain;
  qualityLightLimit = p.lights;
  if (cloudMesh) cloudMesh.count = Math.min(p.clouds, cloudMesh.userData.puffs.length);
  if (typeof updateQualityUI === 'function') updateQualityUI();
  if (typeof updateEnvironment === 'function') updateEnvironment(0);
}
function setQuality(q, silent) {
  if (q === 'auto') {
    state.qualityAuto = true;
    applyQuality('high', true);
  } else {
    state.qualityAuto = false;
    applyQuality(q, silent);
  }
  qualityRuntime.lowRun = 0;
  if (typeof updateQualityUI === 'function') updateQualityUI();
  if (typeof showCardNotice === 'function' && !silent) {
    showCardNotice('画质切换 · ' + (state.qualityAuto ? '自动' : QUALITY_PRESETS[state.quality].label), 3600);
  }
}
function monitorFPS(dt) {
  if (!started) return;
  qualityRuntime.accum += dt;
  qualityRuntime.frames++;
  if (qualityRuntime.accum < 1) return;
  const fps = qualityRuntime.frames / qualityRuntime.accum;
  qualityRuntime.fps = fps;
  qualityRuntime.frames = 0;
  qualityRuntime.accum = 0;
  const now = performance.now();
  if (fps < 30) qualityRuntime.lowRun++;
  else qualityRuntime.lowRun = 0;
  if (state.qualityAuto && qualityRuntime.lowRun >= 3 && now > qualityRuntime.cooldownUntil) {
    qualityRuntime.lowRun = 0;
    qualityRuntime.cooldownUntil = now + 7000;
    if (state.quality !== 'low') {
      const next = state.quality === 'high' ? 'medium' : 'low';
      applyQuality(next, true);
      if (typeof showCardNotice === 'function') showCardNotice('帧率偏低 · 画质已降至' + QUALITY_PRESETS[next].label, 6200);
    }
  }
  if (typeof updateQualityNote === 'function') updateQualityNote();
}
let lastStatsUpdate = 0;
let lastRoadColorUpdate = 0;
let simNow = { peak: .2, active: .2, flow: 0, congestion: 1, metro: 0, work: 0 };
let displaySecondCounter = 0;
let lightningTimer = 4;
let flash = 0;

const sunDir = new THREE.Vector3();
const moonDir = new THREE.Vector3();
const sunKeyDir = new THREE.Vector3();
const shadowWorldUp = new THREE.Vector3(0, 1, 0);
function updateSunShadow(keyDir) {
  if (!sun || !sun.shadow || !controls) return;
  const mapSize = sun.shadow.mapSize.x || 2048;
  const texel = (SHADOW_EXTENT * 2) / mapSize;
  shadowFocus.copy(controls.target);
  shadowFocus.y = 0;
  shadowForward.copy(keyDir).normalize().multiplyScalar(-1);
  if (Math.abs(shadowForward.y) < .001) shadowForward.y = -.001;
  shadowRight.crossVectors(shadowWorldUp, shadowForward);
  if (shadowRight.lengthSq() < 1e-6) shadowRight.set(1, 0, 0);
  shadowRight.normalize();
  shadowUp.crossVectors(shadowForward, shadowRight).normalize();
  const lx = shadowFocus.dot(shadowRight);
  const ly = shadowFocus.dot(shadowUp);
  const sx = Math.round(lx / texel) * texel;
  const sy = Math.round(ly / texel) * texel;
  shadowSnapped.copy(shadowFocus).addScaledVector(shadowRight, sx - lx).addScaledVector(shadowUp, sy - ly);
  sun.target.position.copy(shadowSnapped);
  sun.position.copy(shadowSnapped).addScaledVector(keyDir, SUN_DISTANCE);
  sun.target.updateMatrixWorld();
  sun.shadow.camera.updateProjectionMatrix();
}
function computeLight(hour) {
  // Sunrise 06:30, sunset 18:30. The directional light follows this arc; the
  // separate moon light fades in as the sun drops below the horizon.
  const t = (hour - SUNRISE) / (SUNSET - SUNRISE);
  const angle = t * Math.PI;
  const sy = Math.sin(angle);
  const sx = Math.cos(angle);
  const day = smooth(-.06, .24, sy);
  const night = 1 - smooth(-.12, .05, sy);
  const twilight = Math.max(0, 1 - Math.abs(sy) / .20);
  const noon = smooth(.5, .95, sy);
  return { day, night, twilight, noon, sy, sx };
}
function autoLightPower(hour) {
  const evening = smooth(18.35, 19.35, hour);
  const morning = 1 - smooth(5.55, 6.35, hour);
  return clamp(Math.max(evening, morning), 0, 1);
}
function lightingPower() {
  if (!state.layers.night || state.lightMode === 'off') return 0;
  if (state.lightMode === 'on') return 1;
  return autoLightPower(state.hour);
}
function sampleSkyColors(hour, topOut, horizonOut) {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < SKY_STOPS.length - 1 && h >= SKY_STOPS[i + 1][0]) i++;
  const a = SKY_STOPS[i];
  const b = SKY_STOPS[Math.min(i + 1, SKY_STOPS.length - 1)];
  const span = Math.max(.0001, b[0] - a[0]);
  const k = clamp((h - a[0]) / span, 0, 1);
  topOut.copy(a[1]).lerp(b[1], k);
  horizonOut.copy(a[2]).lerp(b[2], k);
}
function updateEnvironment(dt) {
  const targetW = WEATHER[state.weather];
  const weatherEase = 1 - Math.exp(-dt * 1.85);
  weatherState.rain = lerp(weatherState.rain, targetW.rain, weatherEase);
  weatherState.cloud = lerp(weatherState.cloud, targetW.cloud, weatherEase);
  weatherState.fog = lerp(weatherState.fog, targetW.fog, weatherEase);
  weatherState.sun = lerp(weatherState.sun, targetW.sun, weatherEase);
  weatherState.wet = lerp(weatherState.wet, targetW.wet, weatherEase);
  weatherState.rainDrops = lerp(weatherState.rainDrops, targetW.rainDrops, weatherEase);
  const light = computeLight(state.hour);
  sunDir.set(light.sx, light.sy, -0.36).normalize();
  moonDir.set(-light.sx * .78, Math.max(.10, -light.sy * .78) + .18, -.18).normalize();
  const snap = dt <= .0001;
  const ease = snap ? 1 : 1 - Math.exp(-dt * 2.3);
  env.day = ease === 1 ? light.day : lerp(env.day, light.day, ease);
  env.night = ease === 1 ? light.night : lerp(env.night, light.night, ease);
  env.twilight = ease === 1 ? light.twilight : lerp(env.twilight, light.twilight, ease);
  env.lightPower = snap ? lightingPower() : lerp(env.lightPower, lightingPower(), 1 - Math.exp(-dt * 4.2));
  env.wet = snap ? weatherState.wet : lerp(env.wet, weatherState.wet, 1 - Math.exp(-dt * 1.8));
  const day = env.day, night = env.night, wxL = weatherState;
  const lightPower = env.lightPower;
  updateEnvForTime(state.hour);

  // Sky + horizon palette: night deep blue, dawn/dusk orange-pink, day pale
  // blue, then weather haze blended in over ~2 seconds.
  sampleSkyColors(state.hour, tmpSkyTop, tmpSkyHorizon);
  const haze = clamp((wxL.cloud - .05) * .20 + (wxL.fog - .0012) / .0052 * .36, 0, .62);
  const fogBright = (.30 + day * .70) * (1 - wxL.rain * .18);
  tmpFogTop.copy(ENV_WEATHER_GREY).multiplyScalar(fogBright);
  tmpFogHorizon.copy(ENV_WEATHER_HORIZON).multiplyScalar(fogBright);
  targetTop.copy(tmpSkyTop).lerp(tmpFogTop, haze * .54);
  targetHorizon.copy(tmpSkyHorizon).lerp(tmpFogHorizon, haze * .66);
  env.top.lerp(targetTop, snap ? 1 : 1 - Math.exp(-dt * 1.9));
  env.horizon.lerp(targetHorizon, snap ? 1 : 1 - Math.exp(-dt * 1.9));
  skyUniforms.uTop.value.copy(env.top);
  skyUniforms.uHorizon.value.copy(env.horizon);
  skyUniforms.uSunDir.value.copy(sunDir);
  skyUniforms.uSunColor.value.copy(targetSun);
  skyUniforms.uSunStrength.value = day * wxL.sun * .95 + night * .06;
  skyUniforms.uCloud.value = wxL.cloud;
  skyUniforms.uNight.value = night;
  sky.position.copy(camera.position);
  stars.position.copy(camera.position);
  stars.material.opacity = night * (1 - wxL.cloud * .86) * .92;
  stars.rotation.y += dt * .003;

  // Fog: every weather transition changes the density and colour gradually.
  const desiredFog = wxL.fog * (1 + night * .12);
  scene.fog.density = snap ? desiredFog : lerp(scene.fog.density, desiredFog, 1 - Math.exp(-dt * 1.65));
  tmpFogColor.copy(env.horizon).multiplyScalar(lerp(.40, .66, day));
  if (wxL.rain > .22) tmpFogColor.lerp(STORM_FOG_COLOR, smooth(.22, 1, wxL.rain) * .42);
  if (wxL.fog > .0026) tmpFogColor.lerp(FOG_WEATHER_COLOR, smooth(.0026, .0045, wxL.fog) * .34);
  scene.fog.color.copy(tmpFogColor);

  // One shadow-casting key light: the sun by day, a weak blue moon at night.
  // The same directional light keeps the shadow map and only changes angle,
  // colour and intensity, so there is never a second shadow caster.
  targetSun.set(0xffe5bb)
    .lerp(new THREE.Color(0xffb178), clamp(env.twilight * 1.15, 0, 1))
    .lerp(new THREE.Color(0xa9c4e2), night * .82);
  const nightBlend = smooth(.35, .72, night);
  sunKeyDir.copy(sunDir).lerp(moonDir, nightBlend).normalize();
  sun.color.copy(targetSun);
  moon.color.set(0xa8bde0);
  const sunInt = Math.pow(clamp(Math.max(0, light.sy + .05), 0, 1), .55) * 2.25 * wxL.sun;
  const keyInt = lerp(sunInt, .20, nightBlend);
  sun.intensity = snap ? keyInt : lerp(sun.intensity, keyInt, 1 - Math.exp(-dt * 2.5));
  moon.intensity = 0;
  updateSunShadow(sunKeyDir);
  hemi.intensity = snap ? (.11 + day * .48) * (.62 + wxL.sun * .42) : lerp(hemi.intensity, (.11 + day * .48) * (.62 + wxL.sun * .42), 1 - Math.exp(-dt * 2));
  hemi.color.copy(env.horizon).lerp(new THREE.Color(0x84a990), .28);
  hemi.groundColor.copy(env.ground);
  ambient.intensity = snap ? .045 + day * .055 : lerp(ambient.intensity, .045 + day * .055, 1 - Math.exp(-dt * 2));
  renderer.toneMappingExposure = 1.05;

  // Wet asphalt gets darker and glossier; road reflections are faked with a
  // low roughness + metalness response to the sun / point lights.
  if (roadMaterial) {
    roadMaterial.color.setHex(0xffffff).lerp(WET_ROAD_TINT, env.wet * .92);
    roadMaterial.roughness = lerp(.83, .25, env.wet);
    roadMaterial.metalness = lerp(.03, .39, env.wet);
  }
  if (roadBedMaterial) {
    roadBedMaterial.color.setHex(0xffffff).lerp(WET_BED_TINT, env.wet * .7);
    roadBedMaterial.roughness = lerp(.96, .5, env.wet);
  }
  if (congestionMesh) {
    congestionMesh.material.color.setHex(0xffffff).lerp(WET_BAND_TINT, env.wet * .7);
    congestionMesh.material.opacity = .78 - env.wet * .30;
  }

  waterUniforms.uTime.value += dt;
  waterUniforms.uDay.value = day;
  waterUniforms.uNight.value = night;
  waterUniforms.uLightPower.value = lightPower;
  waterUniforms.uFogColor.value.copy(scene.fog.color);
  waterUniforms.uSunColor.value.copy(targetSun);
  waterUniforms.uSunDir.value.copy(sunDir);
  // Glass curtain wall reflects the same sky and fog, and warms slightly at
  // the base at night to suggest a lit city behind the façade.
  glassUniforms.uTop.value.copy(env.top);
  glassUniforms.uHorizon.value.copy(env.horizon);
  glassUniforms.uSunColor.value.copy(targetSun);
  glassUniforms.uSunDir.value.copy(sunKeyDir);
  glassUniforms.uNight.value = night;
  glassUniforms.uFogColor.value.copy(scene.fog.color);
  glassUniforms.uFogDensity.value = scene.fog.density;
  if (landmarkGlassUniforms) {
    landmarkGlassUniforms.uTop.value.copy(env.top);
    landmarkGlassUniforms.uHorizon.value.copy(env.horizon);
    landmarkGlassUniforms.uSunColor.value.copy(targetSun);
    landmarkGlassUniforms.uSunDir.value.copy(sunKeyDir);
    landmarkGlassUniforms.uNight.value = night;
    landmarkGlassUniforms.uLightPower.value = lightPower;
    landmarkGlassUniforms.uOccupancy.value = clamp(windowOccupancy('commercial', state.hour) * .78, 0, .76);
    landmarkGlassUniforms.uFogColor.value.copy(scene.fog.color);
    landmarkGlassUniforms.uFogDensity.value = scene.fog.density;
  }
  if (crTowerUniforms) {
    crTowerUniforms.uTop.value.copy(env.top);
    crTowerUniforms.uHorizon.value.copy(env.horizon);
    crTowerUniforms.uSunColor.value.copy(targetSun);
    crTowerUniforms.uSunDir.value.copy(sunKeyDir);
    crTowerUniforms.uNight.value = night;
    crTowerUniforms.uLightPower.value = lightPower;
    crTowerUniforms.uOccupancy.value = clamp(windowOccupancy('commercial', state.hour) * .72, 0, .78);
    crTowerUniforms.uFogColor.value.copy(scene.fog.color);
    crTowerUniforms.uFogDensity.value = scene.fog.density;
  }
  if (refinedLandmarks) refinedLandmarks.setNight(lightPower,state.layers.night);
  if (crLobbyMaterial) crLobbyMaterial.opacity = lightPower * .62;
  if (tencentNightMaterial) tencentNightMaterial.opacity = state.layers.night ? Math.max(.55, lightPower * .85) : 0;
  if (tencentGlassMaterial) tencentGlassMaterial.emissiveIntensity = state.layers.night ? Math.max(.55, lightPower * .82) : 0;
  if (mixcNightMaterial) mixcNightMaterial.opacity = state.layers.night ? lightPower * .92 : 0;
  if (sboNightMaterial) sboNightMaterial.opacity = state.layers.night ? lightPower * .94 : 0;
  if (sboOtherGlassMaterial) sboOtherGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .95 : 0;
  if (sboT7GlassMaterial) sboT7GlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .78 : 0;
  if (andazNightMaterial) andazNightMaterial.opacity = state.layers.night ? lightPower * .95 : 0;
  if (andazGlassMaterial) andazGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .9 : 0;
  if (andazSignMaterial) andazSignMaterial.emissiveIntensity = .5 + (state.layers.night ? lightPower * 1.6 : 0);
  if (lenovoNightMaterial) lenovoNightMaterial.opacity = state.layers.night ? lightPower * .95 : 0;
  if (lenovoGlassMaterial) lenovoGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .88 : 0;
  if (lenovoSignMaterial) lenovoSignMaterial.emissiveIntensity = .8 + (state.layers.night ? lightPower * 1.7 : 0);
  if (dajiaNightMaterial) dajiaNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (dajiaGlassMaterial) dajiaGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (xiaomiGlassMaterial) xiaomiGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .65 : 0;
  if (xiaomiLedMaterial) xiaomiLedMaterial.emissiveIntensity = state.layers.night ? lightPower * .42 : 0;
  if (xiaomiNightMaterial) xiaomiNightMaterial.opacity = state.layers.night ? lightPower * .95 : 0;
  if (xiaomiSignMaterial) xiaomiSignMaterial.emissiveIntensity = .25 + (state.layers.night ? lightPower * 1.35 : 0);
  if (cocoonShellMaterial) cocoonShellMaterial.emissiveIntensity = state.layers.night ? 1.55 : 0;
  if (cocoonNightMaterial) cocoonNightMaterial.opacity = state.layers.night ? .98 : 0;
  if (cocoonGlassMaterial) cocoonGlassMaterial.emissiveIntensity = state.layers.night ? .32 : 0;
  if (neighbourNightMaterial) neighbourNightMaterial.opacity = state.layers.night ? .88 : 0;
  if (coastalNightMaterial) coastalNightMaterial.opacity = state.layers.night ? .9 : 0;
  if (polyInnerGlassMaterial) polyInnerGlassMaterial.emissiveIntensity = state.layers.night ? .82 : 0;
  if (polyNightMaterial) polyNightMaterial.opacity = state.layers.night ? .9 : 0;
  if (excellenceGlassMaterial) excellenceGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (excellenceNightMaterial) excellenceNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (portNightMaterial) portNightMaterial.opacity = state.layers.night ? .9 : 0;
  if (szuNightMaterial) szuNightMaterial.opacity = state.layers.night ? .9 : 0;
  if (hyteraGlassMaterial) hyteraGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (hyteraNightMaterial) hyteraNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (capitalGlassMaterial) capitalGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (capitalNightMaterial) capitalNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  for (const m of aerospaceGlassMaterials) m.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (aerospaceNightMaterial) aerospaceNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (cnoocGlassMaterial) cnoocGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (cnoocNightMaterial) cnoocNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (rongchaoGlassMaterial) rongchaoGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (rongchaoNightMaterial) rongchaoNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (ventureGlassMaterial) ventureGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (ventureNightMaterial) ventureNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  for (const m of officeWallMats) m.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (officeWallNight) officeWallNight.opacity = state.layers.night ? lightPower * .85 : 0;
  if (bytedanceGlassMaterial) bytedanceGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (bytedanceNightMaterial) bytedanceNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (hisenseGlassMaterial) hisenseGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (hisenseNightMaterial) hisenseNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  if (xunleiGlassMaterial) xunleiGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * 1.0 : 0;
  if (xunleiNightMaterial) xunleiNightMaterial.opacity = state.layers.night ? lightPower * .9 : 0;
  for (const m of ventureNeighborMats) m.emissiveIntensity = state.layers.night ? lightPower * .85 : 0;
  if (neighborsNightMaterial) neighborsNightMaterial.opacity = state.layers.night ? lightPower * .72 : 0;
  if (ventureNeighborsLedMaterial) ventureNeighborsLedMaterial.opacity = state.layers.night ? lightPower * .7 : 0;
  for (const m of eastWallMats) m.emissiveIntensity = state.layers.night ? lightPower * .85 : 0;
  if (eastWallNight) eastWallNight.opacity = state.layers.night ? lightPower * .72 : 0;
  innovationTowerMats.forEach((m, i) => { m.emissiveIntensity = state.layers.night ? lightPower * [1.0, .9, .72][i % 3] : 0; });
  for (const m of innovationApartmentMats) m.emissiveIntensity = state.layers.night ? lightPower * .85 : 0;
  if (innovationNightMaterial) innovationNightMaterial.opacity = state.layers.night ? lightPower * .55 : 0;
  if (tsinghuaNightMaterial) tsinghuaNightMaterial.opacity = state.layers.night ? lightPower * .65 : 0;
  if (chinaOverseasGlassMaterial) chinaOverseasGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (chinaOverseasNightMaterial) chinaOverseasNightMaterial.opacity = state.layers.night ? lightPower * .55 : 0;
  if (yihuaGlassMaterial) yihuaGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (yihuaNightMaterial) yihuaNightMaterial.opacity = state.layers.night ? lightPower * .55 : 0;
  if (caixunGlassMaterial) caixunGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (caixunNightMaterial) caixunNightMaterial.opacity = state.layers.night ? lightPower * .55 : 0;
  if (buptGlassMaterial) buptGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .72 : 0;
  if (buptNightMaterial) buptNightMaterial.opacity = state.layers.night ? lightPower * .42 : 0;
  if (ketongGlassMaterial) ketongGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (ketongNightMaterial) ketongNightMaterial.opacity = state.layers.night ? lightPower * .55 : 0;
  if (youxianGlassMaterial) youxianGlassMaterial.emissiveIntensity = state.layers.night ? lightPower * .75 : 0;
  if (youxianNightMaterial) youxianNightMaterial.opacity = state.layers.night ? lightPower * .45 : 0;
  if (lxsNight) lxsNight.opacity = state.layers.night ? lightPower * .55 : 0;
  if (szResNight) szResNight.opacity = state.layers.night ? lightPower * .5 : 0;
  for (const m of residentialWindowMats) m.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  if (campusWindowMaterial) campusWindowMaterial.emissiveIntensity = state.layers.night ? lightPower * .8 : 0;
  for (const m of nightReskinMats) m.emissiveIntensity = state.layers.night ? lightPower * (m.userData.reskinFactor || 1) : 0;

  // Window, street, landmark and car lights all follow the same light power.
  // A layer-off or lighting-off state makes every emissive element disappear.
  nightGroup.visible = state.layers.night;
  if (windowGlowMaterial) windowGlowMaterial.opacity = .94 * lightPower;
  if (streetLampGroup) streetLampGroup.visible = lightPower > .012 && state.layers.night;
  if (streetLampBulbMaterial) streetLampBulbMaterial.opacity = lightPower * .96;
  if (streetLampHaloMaterial) streetLampHaloMaterial.opacity = lightPower * .68;
  if (streetLampPoleMaterial) streetLampPoleMaterial.opacity = lightPower * .8;
  if (beaconMaterial) beaconMaterial.opacity = lightPower * (1 - wxL.cloud * .55) * (.35 + .32 * (Math.sin(state.signalTime * 2.2) * .5 + .5));
  if (landmarkOutlineMaterial) landmarkOutlineMaterial.opacity = lightPower * (.74 + .12 * Math.sin(state.signalTime * 1.7));
  if (landmarkGlowMaterial) landmarkGlowMaterial.opacity = lightPower * (.54 + .18 * Math.sin(state.signalTime * 1.4 + 1));
  if (crownMaterial) crownMaterial.opacity = lightPower * (1 - wxL.cloud * .25) * (.12 + .025 * Math.sin(state.signalTime * 1.2));
  for (let i = 0; i < nightPointLights.length; i++) {
    const item = nightPointLights[i];
    item.light.intensity = (i < qualityLightLimit ? lightPower * item.base : 0);
    item.light.visible = state.layers.night && lightPower > .02;
  }
  if (typeof txHeadLights !== 'undefined') {
    txCarLightGroup.visible = lightPower > .015 && state.layers.traffic;
    txHeadMat.opacity = lightPower * .92;
    txTailMat.opacity = lightPower * .95;
  }
  updateWindowLights(false);

  // Clouds and rain.
  cloudMaterial.opacity = wxL.cloud * .64;
  cloudMaterial.emissiveIntensity = .10 + day * .32;
  cloudMaterial.color.setHex(0xc4cbc3).lerp(new THREE.Color(0x273631), night * .80);
  if (cloudMesh) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cloudMesh.count; i++) {
      const p = cloudMesh.userData.puffs[i];
      p.x += p.drift * dt * (1 + wxL.rain * .85);
      if (p.x > 320) p.x = -320;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.set(p.sx, p.sy, p.sz);
      dummy.rotation.set(0, i * .17, 0);
      dummy.updateMatrix();
      cloudMesh.setMatrixAt(i, dummy.matrix);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
    cloudMesh.visible = wxL.cloud > .12;
  }
  weatherState.activeDrops = lerp(weatherState.activeDrops, Math.min(wxL.rainDrops, rainQualityCap), 1 - Math.exp(-dt * (targetW.rainDrops === 0 ? 4.6 : 1.9)));
  const activeRain = Math.floor(weatherState.activeDrops);
  if (rainState.mesh) {
    rainState.mesh.position.set(camera.position.x, 0, camera.position.z);
    rainState.mesh.visible = activeRain > 3;
    rainState.mat.opacity = clamp(wxL.rain * 1.15, 0, .84);
    if (activeRain > 3) updateRain(dt, activeRain);
    else rainState.geo.setDrawRange(0, 0);
  }
  $('rainOverlay').style.opacity = String(wxL.rain * .72);
  if (state.weather === 'storm') {
    lightningTimer -= dt;
    if (lightningTimer <= 0) {
      lightningTimer = 5 + Math.random() * 9;
      flash = 1;
      setTimeout(() => { flash = Math.max(flash, .62); }, 110);
    }
  }
  flash *= Math.exp(-dt * 7.5);
  $('flashOverlay').style.opacity = String(flash * .20 * (state.quality === 'low' ? .6 : 1));

  updateTrafficSignalVisuals(dt, false);
  updateParking(false);
  updateLabels();
}
function forceLightsOff() {
  if (refinedLandmarks) refinedLandmarks.setNight(0);
  env.lightPower = 0;
  if (windowMesh) windowMesh.visible = false;
  if (windowHaloMesh) windowHaloMesh.visible = false;
  if (windowGlowMaterial) windowGlowMaterial.opacity = 0;
  if (windowHaloMaterial) windowHaloMaterial.opacity = 0;
  if (streetLampGroup) streetLampGroup.visible = false;
  if (streetLampBulbMaterial) streetLampBulbMaterial.opacity = 0;
  if (streetLampHaloMaterial) streetLampHaloMaterial.opacity = 0;
  if (streetLampPoleMaterial) streetLampPoleMaterial.opacity = 0;
  if (beaconMaterial) beaconMaterial.opacity = 0;
  if (landmarkOutlineMaterial) landmarkOutlineMaterial.opacity = 0;
  if (landmarkGlowMaterial) landmarkGlowMaterial.opacity = 0;
  if (crownMaterial) crownMaterial.opacity = 0;
  if (crTowerUniforms) crTowerUniforms.uLightPower.value = 0;
  if (crLobbyMaterial) crLobbyMaterial.opacity = 0;
  if (mixcNightMaterial) mixcNightMaterial.opacity = 0;
  if (sboNightMaterial) sboNightMaterial.opacity = 0;
  if (sboOtherGlassMaterial) sboOtherGlassMaterial.emissiveIntensity = 0;
  if (sboT7GlassMaterial) sboT7GlassMaterial.emissiveIntensity = 0;
  if (andazNightMaterial) andazNightMaterial.opacity = 0;
  if (andazGlassMaterial) andazGlassMaterial.emissiveIntensity = 0;
  if (andazSignMaterial) andazSignMaterial.emissiveIntensity = .5;
  if (lenovoNightMaterial) lenovoNightMaterial.opacity = 0;
  if (lenovoGlassMaterial) lenovoGlassMaterial.emissiveIntensity = 0;
  if (lenovoSignMaterial) lenovoSignMaterial.emissiveIntensity = .8;
  if (dajiaNightMaterial) dajiaNightMaterial.opacity = 0;
  if (dajiaGlassMaterial) dajiaGlassMaterial.emissiveIntensity = 0;
  if (xiaomiGlassMaterial) xiaomiGlassMaterial.emissiveIntensity = 0;
  if (xiaomiLedMaterial) xiaomiLedMaterial.emissiveIntensity = 0;
  if (xiaomiNightMaterial) xiaomiNightMaterial.opacity = 0;
  if (xiaomiSignMaterial) xiaomiSignMaterial.emissiveIntensity = .25;
  if (cocoonShellMaterial) cocoonShellMaterial.emissiveIntensity = 0;
  if (cocoonNightMaterial) cocoonNightMaterial.opacity = 0;
  if (cocoonGlassMaterial) cocoonGlassMaterial.emissiveIntensity = 0;
  if (neighbourNightMaterial) neighbourNightMaterial.opacity = 0;
  if (coastalNightMaterial) coastalNightMaterial.opacity = 0;
  if (polyInnerGlassMaterial) polyInnerGlassMaterial.emissiveIntensity = 0;
  if (polyNightMaterial) polyNightMaterial.opacity = 0;
  if (excellenceGlassMaterial) excellenceGlassMaterial.emissiveIntensity = 0;
  if (excellenceNightMaterial) excellenceNightMaterial.opacity = 0;
  if (portNightMaterial) portNightMaterial.opacity = 0;
  if (szuNightMaterial) szuNightMaterial.opacity = 0;
  if (hyteraGlassMaterial) hyteraGlassMaterial.emissiveIntensity = 0;
  if (hyteraNightMaterial) hyteraNightMaterial.opacity = 0;
  if (capitalGlassMaterial) capitalGlassMaterial.emissiveIntensity = 0;
  if (capitalNightMaterial) capitalNightMaterial.opacity = 0;
  for (const m of aerospaceGlassMaterials) m.emissiveIntensity = 0;
  if (aerospaceNightMaterial) aerospaceNightMaterial.opacity = 0;
  if (cnoocGlassMaterial) cnoocGlassMaterial.emissiveIntensity = 0;
  if (cnoocNightMaterial) cnoocNightMaterial.opacity = 0;
  if (rongchaoGlassMaterial) rongchaoGlassMaterial.emissiveIntensity = 0;
  if (rongchaoNightMaterial) rongchaoNightMaterial.opacity = 0;
  if (ventureGlassMaterial) ventureGlassMaterial.emissiveIntensity = 0;
  if (ventureNightMaterial) ventureNightMaterial.opacity = 0;
  for (const m of officeWallMats) m.emissiveIntensity = 0;
  if (officeWallNight) officeWallNight.opacity = 0;
  if (bytedanceGlassMaterial) bytedanceGlassMaterial.emissiveIntensity = 0;
  if (bytedanceNightMaterial) bytedanceNightMaterial.opacity = 0;
  if (hisenseGlassMaterial) hisenseGlassMaterial.emissiveIntensity = 0;
  if (hisenseNightMaterial) hisenseNightMaterial.opacity = 0;
  if (xunleiGlassMaterial) xunleiGlassMaterial.emissiveIntensity = 0;
  if (xunleiNightMaterial) xunleiNightMaterial.opacity = 0;
  for (const m of ventureNeighborMats) m.emissiveIntensity = 0;
  if (neighborsNightMaterial) neighborsNightMaterial.opacity = 0;
  if (ventureNeighborsLedMaterial) ventureNeighborsLedMaterial.opacity = 0;
  for (const m of eastWallMats) m.emissiveIntensity = 0;
  if (eastWallNight) eastWallNight.opacity = 0;
  for (const m of innovationTowerMats) m.emissiveIntensity = 0;
  for (const m of innovationApartmentMats) m.emissiveIntensity = 0;
  if (innovationNightMaterial) innovationNightMaterial.opacity = 0;
  if (tsinghuaNightMaterial) tsinghuaNightMaterial.opacity = 0;
  if (chinaOverseasGlassMaterial) chinaOverseasGlassMaterial.emissiveIntensity = 0;
  if (chinaOverseasNightMaterial) chinaOverseasNightMaterial.opacity = 0;
  if (yihuaGlassMaterial) yihuaGlassMaterial.emissiveIntensity = 0;
  if (yihuaNightMaterial) yihuaNightMaterial.opacity = 0;
  if (caixunGlassMaterial) caixunGlassMaterial.emissiveIntensity = 0;
  if (caixunNightMaterial) caixunNightMaterial.opacity = 0;
  if (buptGlassMaterial) buptGlassMaterial.emissiveIntensity = 0;
  if (buptNightMaterial) buptNightMaterial.opacity = 0;
  if (ketongGlassMaterial) ketongGlassMaterial.emissiveIntensity = 0;
  if (ketongNightMaterial) ketongNightMaterial.opacity = 0;
  if (youxianGlassMaterial) youxianGlassMaterial.emissiveIntensity = 0;
  if (youxianNightMaterial) youxianNightMaterial.opacity = 0;
  if (lxsNight) lxsNight.opacity = 0;
  if (szResNight) szResNight.opacity = 0;
  for (const m of residentialWindowMats) m.emissiveIntensity = 0;
  if (campusWindowMaterial) campusWindowMaterial.emissiveIntensity = 0;
  for (const m of nightReskinMats) m.emissiveIntensity = 0;
  if (landmarkGlassUniforms) landmarkGlassUniforms.uLightPower.value = 0;
  for (const item of nightPointLights) { item.light.intensity = 0; item.light.visible = false; }
  if (typeof txCarLightGroup !== 'undefined') {
    txCarLightGroup.visible = false;
    txHeadMat.opacity = 0;
    txTailMat.opacity = 0;
  }
  waterUniforms.uLightPower.value = 0;
}
function updateRain(dt, active) {
  const pos = rainState.positions;
  const storm = smooth(.55, 1, weatherState.rain);
  const wind = 1.1 + storm * 3.3;
  const speedMul = 1 + storm * .85;
  for (let i = 0; i < active; i++) {
    const d = rainState.data[i];
    d.y -= d.spd * dt * speedMul;
    d.x += wind * dt * 1.25;
    if (d.y < -1 || d.x > 235) {
      d.y = 110 + Math.random() * 70;
      d.x = -220 + Math.random() * 440;
      d.z = -220 + Math.random() * 440;
    }
    const idx = i * 6;
    pos[idx] = d.x; pos[idx + 1] = d.y; pos[idx + 2] = d.z;
    pos[idx + 3] = d.x - wind * .055; pos[idx + 4] = d.y - d.len * (1.4 + storm); pos[idx + 5] = d.z;
  }
  rainState.geo.setDrawRange(0, active * 2);
  rainState.geo.getAttribute('position').needsUpdate = true;
}

// ── simulation data ───────────────────────────────────────────
const PERIODS = [
  [0, 5.7, '深夜', '夜间值守 · 路网清空'],
  [5.7, 7.5, '清晨', '通勤开始 · 东向车流上涨'],
  [7.5, 9.5, '早高峰', '通勤峰值 · 主干道承压'],
  [9.5, 11.5, '上午平峰', '园区在岗率上升'],
  [11.5, 13.6, '午间', '短途出行 · 商圈活跃'],
  [13.6, 17.3, '下午平峰', '园区运转平稳'],
  [17.3, 19.6, '晚高峰', '下班车流 · 后海方向密集'],
  [19.6, 22.2, '夜间', '商圈灯光 · 车流回落'],
  [22.2, 24.01, '深夜', '城市低耗运转']
];
function periodFor(hour) {
  for (const p of PERIODS) if (hour >= p[0] && hour < p[1]) return p;
  return PERIODS[0];
}
function bell(hour, center, width) {
  let d = Math.abs(hour - center);
  d = Math.min(d, 24 - d);
  return Math.exp(-(d * d) / (2 * width * width));
}
function computeSimulation(hour) {
  const morning = bell(hour, 8.42, .78);
  const evening = bell(hour, 18.38, .94);
  const peak = clamp(Math.max(morning, evening), 0, 1);
  const active = smooth(7.4, 9.2, hour) * (1 - smooth(17.3, 19.5, hour));
  const lunch = smooth(11, 13, hour) * (1 - smooth(13.6, 15, hour));
  const night = smooth(21.5, 24, hour) + (1 - smooth(0, 5.8, hour));
  const clear = 1 - weatherState.rain * .34 - weatherState.cloud * .08;
  const flow = Math.round((5400 + peak * 15200 + active * 1800 + lunch * 900) * clear);
  const rainPenalty = weatherState.rain > .7 ? .38 : weatherState.rain > .25 ? .16 : 0;
  const congestion = clamp(0.92 + peak * 1.25 + weatherState.cloud * .09 + rainPenalty + active * .11 + night * -.24, .72, 2.96);
  const metro = (0.52 + peak * 3.63 + active * .94 + lunch * .22) * (1 - weatherState.rain * .07);
  const work = (0.55 + active * 19.9 + peak * 1.0 - night * 1.4) * (1 + weatherState.cloud * .012);
  return { morning, evening, peak, active, night, flow, congestion, metro, work };
}
function congestionWord(v) {
  if (v > 2.1) return { label: '严重拥堵', cls: '' };
  if (v > 1.55) return { label: '拥堵', cls: '' };
  if (v > 1.12) return { label: '缓行', cls: '' };
  return { label: '畅通', cls: '' };
}
function trafficHint(sim, period, weather) {
  if (weather === 'storm') return '暴雨影响：滨海大道、科苑南路限速通行，建议减少非必要出行。';
  if (weather === 'rain') return '小雨路面湿滑：后海大道与学府路车距增大，地铁 2 号线更稳妥。';
  if (weather === 'fog') return '雾天能见度下降：滨海大道保持车距，信号灯优先放行主干路。';
  if (state.hour >= 7.3 && state.hour <= 9.6) return '早高峰：科苑南路、后海大道车流上升，建议优先选择地铁 2 / 13 号线。';
  if (state.hour >= 17.2 && state.hour <= 19.8) return '晚高峰：滨海大道东行与后海大道压力较大，建议错峰离场。';
  if (state.hour >= 21.5 || state.hour < 6) return '夜间：主干路网整体畅通，园区周边进入低耗运转。';
  return '平峰：南海大道、学府路运行平稳，信号绿波带正常。';
}
function weatherLabel() { return WEATHER[state.weather].label; }

// ── selection & camera focus ─────────────────────────────────
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
let followTarget = null;
let hoverPickClock = 0;
let tooltip = $('tooltip');

function clearSelectionHighlight() {
  while (selectedGroup.children.length) {
    const obj = selectedGroup.children.pop();
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose()); else obj.material.dispose();
    }
  }
}
function addLoopSegments(arr, ring, y) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    arr.push(a[0], y, a[1], b[0], y, b[1]);
  }
}
function highlightBuildings(indices, anchor, approximate) {
  clearSelectionHighlight();
  const pos = [];
  const tall = [];
  for (const bi of indices) {
    const b = DATA.buildings[bi];
    if (!b) continue;
    const ring = flatPointsToVectors(b.p);
    if (!ring.length) continue;
    const y = BUILD_Y + wh(b.height);
    addLoopSegments(pos, ring, y + .11);
    addLoopSegments(pos, ring, BUILD_Y + .12);
    if (b.height > 65) {
      const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
      const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      // a faint vertical edge from the roof centre
      pos.push(cx, BUILD_Y + .12, cz, cx, y + .11, cz);
      tall.push([cx, y, cz]);
    }
  }
  if (pos.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xf2d8a3, transparent: true, opacity: .82, depthWrite: false, depthTest: true });
    const line = new THREE.LineSegments(g, mat);
    line.renderOrder = 8;
    selectedGroup.add(line);
  }
  if (anchor) {
    const ringGeo = new THREE.RingGeometry(2.4, 3.0, 32);
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xf0cc8c, transparent: true, opacity: .58, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(anchor.x, BUILD_Y + .14, anchor.z);
    ring.renderOrder = 8;
    selectedGroup.add(ring);
    if (approximate) {
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(.12, .3, 9, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xf0cc8c, transparent: true, opacity: .14, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      beam.position.set(anchor.x, 4.6, anchor.z);
      selectedGroup.add(beam);
    }
  }
}
function focusOnPoint(x, z, y, radius) {
  controls.focus(x, y || 4, z, radius || 120);
}
function showLandmark(id) {
  const lm = landmarkData.get(id);
  if (!lm) return;
  state.selectedLandmark = id;
  state.selectedBuilding = null;
  state.selectedRoad = null;
  state.followLandmarkId = id;
  const followSel = $('followSelect');
  if (followSel) followSel.value = id;
  updateMomentCard();
  followTarget = { type: 'landmark', id, x: lm.x, z: lm.z, y: Math.max(3, wh(lm.maxH) * .48) };
  const copy = lm.copy;
  $('placeKicker').textContent = lm.approx ? 'SUPPLEMENTAL LANDMARK / 近似锚点' : 'LANDMARK / OSM 地标';
  const badge = $('placeSourceBadge');
  badge.textContent = lm.approx ? 'APPROX' : 'OSM';
  badge.className = 'badge' + (lm.approx ? ' approx' : '');
  $('placeName').textContent = lm.name;
  $('placeEn').textContent = lm.en || 'YUEHAI LANDMARK';
  $('placeDesc').textContent = copy.desc || lm.note || '';
  $('placeNote').textContent = copy.tag ? copy.tag + ' · ' + (lm.approx ? '该点位为示意锚点，非 OSM 建筑轮廓。' : '建筑轮廓来自 OpenStreetMap。') : (lm.note || '');
  const bs = lm.buildings || [];
  $('statLabelA').textContent = 'OSM 轮廓';
  $('placeStatA').textContent = bs.length ? bs.length + ' 栋' : '—';
  $('statLabelB').textContent = '最高建筑';
  $('placeStatB').textContent = lm.maxH ? Math.round(lm.maxH) + ' m' : '—';
  $('statLabelC').textContent = '类型';
  $('placeStatC').textContent = copy.type || '地标';
  $('followPlace').textContent = '镜头跟随';
  $('placeCard').classList.add('is-visible');
  $('followPlace').dataset.kind = 'landmark';
  $('followPlace').dataset.id = id;
  for (const [lid, el] of labelButtons) el.classList.toggle('is-selected', lid === id);
  highlightBuildings(bs, { x: lm.x, z: lm.z }, lm.approx);
  if (id === CR_LANDMARK_ID) {
    // The tower is a bespoke tapered mesh, not an OSM footprint prism; mark
    // it with a gold ground halo instead of a rectangular footprint outline.
    clearSelectionHighlight();
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(3.1, 3.55, 48),
      new THREE.MeshBasicMaterial({ color: 0xf0cc8c, transparent: true, opacity: .72, side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(lm.x, BUILD_Y + .24, lm.z);
    ring.renderOrder = 8;
    selectedGroup.add(ring);
  }
  if (state.camera === 'follow') focusOnPoint(lm.x, lm.z, Math.max(4, wh(lm.maxH) * .45), 112);
}
function showBuilding(bi) {
  const b = DATA.buildings[bi];
  if (!b) return;
  const typeNames = { commercial: '商业 / 办公', residential: '居住', retail: '商业零售', civic: '公共 / 校园', industrial: '产业 / 工业', structure: '构筑物', other: '综合' };
  state.selectedBuilding = bi;
  state.selectedLandmark = landmarkBuildingMap.get(bi) || null;
  state.selectedRoad = null;
  updateMomentCard();
  const lm = state.selectedLandmark ? landmarkData.get(state.selectedLandmark) : null;
  if (lm) { showLandmark(lm.id); return; }
  const ring = flatPointsToVectors(b.p);
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  followTarget = { type: 'building', idx: bi, x: cx, z: cz, y: wh(b.height) * .45 };
  $('placeKicker').textContent = 'BUILDING / OSM 建筑';
  const badge = $('placeSourceBadge'); badge.textContent = 'OSM'; badge.className = 'badge';
  $('placeName').textContent = b.n || '未命名建筑';
  $('placeEn').textContent = (b.t || 'building').toUpperCase() + ' · FOOTPRINT';
  $('placeDesc').textContent = `这是一栋约 ${Math.round(b.height)} 米高的${typeNames[b.t] || '城市建筑'}。它的平面轮廓来自 OpenStreetMap，高度优先读取实测记录；没有高度时按建筑层数换算，再缺省则按 3–8 层随机估算。`;
  $('placeNote').textContent = 'OSM 建筑轮廓 · 低多边形重新挤出 · 点击空白处取消选择';
  $('statLabelA').textContent = '高度';
  $('placeStatA').textContent = Math.round(b.height) + ' m';
  $('statLabelB').textContent = '层数';
  $('placeStatB').textContent = b.levels ? Math.round(b.levels) + ' 层' : '—';
  $('statLabelC').textContent = '类别';
  $('placeStatC').textContent = typeNames[b.t] || '建筑';
  $('followPlace').textContent = '镜头定位';
  $('followPlace').dataset.kind = 'building';
  $('followPlace').dataset.id = bi;
  $('placeCard').classList.add('is-visible');
  for (const el of labelButtons.values()) el.classList.remove('is-selected');
  highlightBuildings([bi], { x: cx, z: cz }, false);
  if (state.camera === 'follow') focusOnPoint(cx, cz, wh(b.height) * .45, 95);
}
function closeCard() {
  $('placeCard').classList.remove('is-visible');
  state.selectedLandmark = null;
  state.selectedBuilding = null;
  state.selectedRoad = null;
  clearSelectionHighlight();
  for (const el of labelButtons.values()) el.classList.remove('is-selected');
  updateMomentCard();
}
function showRoadInfo(edgeId) {
  const edge = txEdgeById.get(edgeId);
  if (!edge) return;
  // Close a landmark/building card, then present the road slice in the
  // lower-left persistent information card.
  $('placeCard').classList.remove('is-visible');
  state.selectedLandmark = null;
  state.selectedBuilding = null;
  clearSelectionHighlight();
  for (const el of labelButtons.values()) el.classList.remove('is-selected');
  state.selectedRoad = edgeId;
  updateMomentCard();
}
function pickScreen(x, y) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((x - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((y - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointerNdc, camera);
  // r128 raycasting does not skip hidden ancestors by itself. Keep layer-off
  // landmarks / buildings from remaining selectable as invisible geometry.
  const targets = [buildingsMesh, roadMesh, ...markerPickables].filter(obj => {
    if (!obj) return false;
    for (let node = obj; node; node = node.parent) if (!node.visible) return false;
    return true;
  });
  const hits = raycaster.intersectObjects(targets, false);
  if (!hits.length) return null;
  const hit = hits[0];
  if (hit.object.userData.customLandmarkId) return { kind: 'landmark', id: hit.object.userData.customLandmarkId };
  if (hit.object.userData.landmarkId) return { kind: 'approx', id: hit.object.userData.landmarkId };
  if (hit.object === buildingsMesh) {
    const f = hit.faceIndex;
    let lo = 0, hi = buildingFaceRanges.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = buildingFaceRanges[mid];
      if (f < r[0]) hi = mid - 1;
      else if (f >= r[1]) lo = mid + 1;
      else { found = r[2]; break; }
    }
    if (found >= 0) return { kind: 'building', idx: found, point: hit.point };
  }
  if (hit.object === roadMesh) {
    const f = hit.faceIndex;
    let lo = 0, hi = roadFaceRanges.length - 1, found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = roadFaceRanges[mid];
      if (f < r[0]) hi = mid - 1;
      else if (f >= r[1]) lo = mid + 1;
      else { found = r[2]; break; }
    }
    if (found >= 0) {
      const rt = carRoutes[found];
      if (rt && rt.txEdge) return { kind: 'road', edgeId: rt.txEdge.id, point: hit.point };
    }
  }
  return null;
}
function handleTap(x, y) {
  if (roam.active) return;
  const pick = pickScreen(x, y);
  hoverLabelId = null; hoverBuildingIdx = null;
  if (pick && (pick.kind === 'landmark' || pick.kind === 'approx')) hoverLabelId = pick.id;
  if (pick && pick.kind === 'building') { const hm = landmarkBuildingMap.get(pick.idx); if (hm) hoverLabelId = hm; else hoverBuildingIdx = pick.idx; }
  if (!pick) { closeCard(); return; }
  if (pick.kind === 'approx') showLandmark(pick.id);
  else if (pick.kind === 'landmark') showLandmark(pick.id);
  else if (pick.kind === 'building') {
    const lm = landmarkBuildingMap.get(pick.idx);
    if (lm) showLandmark(lm); else showBuilding(pick.idx);
  } else if (pick.kind === 'road') {
    showRoadInfo(pick.edgeId);
  }
}
controls.onTap = handleTap;
function handleHover(x, y) {
  if (roam.active) return;
  if (controls.dragging) { tooltip.classList.remove('is-visible'); canvas.classList.remove('is-hovering'); return; }
  const pick = pickScreen(x, y);
  hoverLabelId = null; hoverBuildingIdx = null;
  if (pick && (pick.kind === 'landmark' || pick.kind === 'approx')) hoverLabelId = pick.id;
  if (pick && pick.kind === 'building') { const hm = landmarkBuildingMap.get(pick.idx); if (hm) hoverLabelId = hm; else hoverBuildingIdx = pick.idx; }
  if (!pick) {
    tooltip.classList.remove('is-visible');
    canvas.classList.remove('is-hovering');
    hoverLabelId = null; hoverBuildingIdx = null; updateLabels();
    return;
  }
  let text = '';
  if (pick.kind === 'approx') {
    const lm = landmarkData.get(pick.id);
    text = (lm ? lm.name : '地标') + ' · 近似锚点';
  } else if (pick.kind === 'landmark') {
    const lm = landmarkData.get(pick.id);
    text = (lm ? lm.name : '地标') + ' · 地标建筑';
  } else if (pick.kind === 'building') {
    const lm = landmarkBuildingMap.get(pick.idx);
    const b = DATA.buildings[pick.idx];
    text = lm ? (landmarkData.get(lm)?.name || '地标') : ((b.n || '城市建筑') + ' · ' + Math.round(b.height) + ' m');
  } else if (pick.kind === 'road') {
    const edge = txEdgeById.get(pick.edgeId);
    if (edge) {
      const lvl = trafficLevelFor(edge);
      text = (edge.name || '未命名支路') + ' · 模拟 ' + edge.avgSpeedKmh.toFixed(1) + ' km/h · ' + lvl.label;
    }
  }
  tooltip.textContent = text + '  ·  点击查看';
  tooltip.style.left = Math.min(window.innerWidth - 180, x + 14) + 'px';
  tooltip.style.top = Math.max(10, y - 28) + 'px';
  tooltip.classList.add('is-visible');
  canvas.classList.add('is-hovering');
}
let lastHoverTime = 0;
canvas.addEventListener('pointermove', (e) => {
  if (e.buttons) return;
  const now = performance.now();
  if (now - lastHoverTime < 80) return;
  lastHoverTime = now;
  handleHover(e.clientX, e.clientY);
});
canvas.addEventListener('pointerleave', () => {
  tooltip.classList.remove('is-visible');
  canvas.classList.remove('is-hovering');
  hoverLabelId = null; hoverBuildingIdx = null; updateLabels();
});

// ── labels projection ───────────────────────────────────────
const tmpVec = new THREE.Vector3();
let labelFrame = 0;
function projectToScreen(x, y, z) {
  tmpVec.set(x, y, z).project(camera);
  if (tmpVec.z > 1 || tmpVec.z < -1 || tmpVec.x < -1.15 || tmpVec.x > 1.15 || tmpVec.y < -1.1 || tmpVec.y > 1.12) return null;
  return { x: (tmpVec.x * .5 + .5) * window.innerWidth, y: (-tmpVec.y * .5 + .5) * window.innerHeight };
}
function hideLabel(el) {
  el.classList.remove('is-visible');
  el.style.opacity = '0';
  el.style.visibility = 'visible';
  el.style.pointerEvents = 'none';
}
function placeLabel(el, x, y) {
  el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  el.classList.add('is-visible');
  el.style.opacity = '1';
  el.style.visibility = 'visible';
  el.style.pointerEvents = 'auto';
}
function updateLabels() {
  labelFrame++;
  if (labelFrame % 2) return;
  const show = state.layers.labels;
  landmarkLabelsEl.style.display = show ? '' : 'none';
  stationLabelsEl.style.display = show && state.layers.metro ? '' : 'none';
  updateBayLabel();
  for (const el of labelButtons.values()) hideLabel(el);
  hideLabel(hoverBuildingChip);
  hoverBuildingChip.style.display = 'none';
  if (!show) return;
  const items = [];
  const cx = window.innerWidth * .5, cy = window.innerHeight * .5;
  const density = state.labelDensity || 'standard';
  for (const [id, lm] of landmarkData) {
    const el = labelButtons.get(id);
    if (!el) continue;
    if (!state.layers.buildings && !lm.approx) continue;
    const forced = id === state.selectedLandmark || id === hoverLabelId;
    const tier = labelTierOf(lm);
    const dist = camera.position.distanceTo(new THREE.Vector3(lm.x, lm.labelY, lm.z));
    if (!forced) {
      if (density === 'minimal' && tier !== 1) continue;
      if (density === 'standard' && tier === 3) continue;
      if (density === 'standard' && tier === 2 && dist > LABEL_NEAR_DIST) continue;
    }
    const p = projectToScreen(lm.x, lm.labelY, lm.z);
    if (!p) continue;
    el.classList.toggle('is-far', tier === 1 && dist > 260);
    const w = Math.min(180, el.offsetWidth || (Array.from(lm.name).length * 13 + 42)), h = 23;
    items.push({ el, x: p.x, y: p.y, w, h, id, tier, forced, center: Math.hypot(p.x - cx, p.y - cy), dist, name: lm.name });
  }
  // Selected/hovered non-landmark building: an unconditional temporary chip.
  if (state.selectedBuilding != null || hoverBuildingIdx != null) {
    const bi = state.selectedBuilding ?? hoverBuildingIdx;
    const b = DATA.buildings[bi];
    if (b && !landmarkBuildingMap.get(bi)) {
      const xs = b.p.filter((_, i) => i % 2 === 0), zs = b.p.filter((_, i) => i % 2 === 1);
      const bx = xs.reduce((a, v) => a + v, 0) / xs.length, bz = zs.reduce((a, v) => a + v, 0) / zs.length;
      const p = projectToScreen(wx(bx), Math.max(3.5, wh((b.height || 30) * .66)), wz(bz));
      if (p) {
        hoverBuildingChip.style.display = 'block';
        hoverBuildingChip.dataset.landmark = '';
        hoverBuildingChip.querySelector('span:last-child').textContent = b.n || '城市建筑';
        hoverBuildingChip.classList.add('is-forced');
        items.push({ el: hoverBuildingChip, x: p.x, y: p.y, w: 150, h: 23, id: '__building__' + bi, tier: 0, forced: true, center: 0, dist: 0, name: b.n || '城市建筑' });
      }
    }
  }
  items.sort((a, b) => (a.forced === b.forced ? 0 : a.forced ? -1 : 1) || (density === 'all' ? (a.center - b.center) : (a.tier - b.tier || a.center - b.center)) || a.dist - b.dist);
  const placed = [];
  let autoCount = 0;
  for (const item of items) {
    if (!item.forced) {
      if (autoCount >= 14) { hideLabel(item.el); continue; }
      const box = { l: item.x - item.w / 2, r: item.x + item.w / 2, t: item.y - item.h, b: item.y };
      let blocked = false;
      for (const p of placed) {
        const ix = Math.max(0, Math.min(box.r, p.r) - Math.max(box.l, p.l));
        const iy = Math.max(0, Math.min(box.b, p.b) - Math.max(box.t, p.t));
        const inter = ix * iy, area = Math.min((box.r - box.l) * (box.b - box.t), (p.r - p.l) * (p.b - p.t));
        if (area > 0 && inter / area > .40) { blocked = true; break; }
      }
      if (blocked) { hideLabel(item.el); continue; }
      autoCount++;
    }
    placeLabel(item.el, item.x, item.y);
    placed.push({ l: item.x - item.w / 2, r: item.x + item.w / 2, t: item.y - item.h, b: item.y });
  }
  if (state.layers.metro) {
    for (const item of stationLabelMap) {
      const p = projectToScreen(item.x, item.y, item.z);
      if (!p) { hideLabel(item.el); continue; }
      const nw = Math.min(120, item.el.offsetWidth || 72), nh = 17;
      const overlap = placed.some(r => {
        const ix = Math.max(0, Math.min(p.x + nw/2, r.r) - Math.max(p.x - nw/2, r.l));
        const iy = Math.max(0, Math.min(p.y + nh/2, r.b) - Math.max(p.y - nh/2, r.t));
        const inter = ix * iy, area = Math.min(nw * nh, (r.r - r.l) * (r.b - r.t));
        return area > 0 && inter / area > .40;
      });
      if (overlap || p.y < 75 || p.y > window.innerHeight - 120) hideLabel(item.el);
      else placeLabel(item.el, p.x, p.y);
    }
  }
}
function setCameraMode(mode, silent) {
  if (mode === 'roam') { roam.enter(); return; }
  if (!['free', 'orbit', 'follow'].includes(mode)) return;
  if (roam.active) roam.exit(false);
  state.camera = mode;
  controls.autoPauseAt = 0;
  document.querySelectorAll('#cameraSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.camera === mode));
  if (mode === 'free') {
    controls.autoRotate = false;
  } else if (mode === 'orbit') {
    controls.autoRotate = true;
    controls.autoSpeed = .055;
    controls.targetGoal.set(15, 4, 45);
    controls.phiGoal = clamp(controls.phiGoal, .75, 1.15);
    controls.radiusGoal = 360;
  } else if (mode === 'follow') {
    controls.autoRotate = true;
    controls.autoSpeed = .032;
    let lm = landmarkData.get(state.followLandmarkId);
    if (!lm) lm = landmarkData.get(state.selectedLandmark) || landmarkData.get('tencent-binhai');
    if (lm) {
      state.followLandmarkId = lm.id;
      state.selectedLandmark = state.selectedLandmark || lm.id;
      if (dom.followSelect) dom.followSelect.value = lm.id;
      followTarget = { type: 'landmark', id: lm.id, x: lm.x, z: lm.z, y: Math.max(4, wh(lm.maxH) * .45) };
      controls.focus(lm.x, followTarget.y, lm.z, 112);
    } else {
      controls.autoRotate = false;
      state.camera = 'orbit';
    }
  }
  if (silent) return;
  updateMomentCard();
}

// ── UI wiring ────────────────────────────────────────────────
const dom = {
  statVehicles: $('statVehicles'), statAvgSpeed: $('statAvgSpeed'),
  statCongestion: $('statCongestion'), statCongested: $('statCongested'),
  trendVehicles: $('trendVehicles'), trendAvgSpeed: $('trendAvgSpeed'),
  trendCongestion: $('trendCongestion'), trendCongested: $('trendCongested'),
  metricVehicles: $('metricVehicles'), metricAvgSpeed: $('metricAvgSpeed'),
  metricCongestion: $('metricCongestion'), metricCongested: $('metricCongested'),
  clockReadout: $('clockReadout'), worldTime: $('worldTime'), momentTime: $('momentTime'),
  momentKicker: $('momentKicker'), momentPeriod: $('momentPeriod'), momentRoad: $('momentRoad'),
  momentWeather: $('momentWeather'), momentSignal: $('momentSignal'), momentClear: $('momentClear'),
  momentMeta: $('momentMeta'),
  momentCard: document.querySelector('.moment-card'),
  periodTiny: $('periodTiny'), sunMessage: $('sunMessage'),
  timeRange: $('timeRange'), worldRange: $('worldRange'),
  playBtn: $('playBtn'), speedGroup: $('speedGroup'),
  dayNightSeg: $('dayNightSeg'), lightModeSeg: $('lightModeSeg'), lightModeNote: $('lightModeNote'),
  qualitySeg: $('qualitySeg'), qualityNote: $('qualityNote'),
  followSelect: $('followSelect'), cameraSeg: $('cameraSeg'),
  immerseBtn: $('immerseBtn'), immerseExit: $('immerseExit')
};
state.scrubbing = false;
[dom.timeRange, dom.worldRange].forEach((range) => {
  range.addEventListener('pointerdown', () => { state.scrubbing = true; });
  range.addEventListener('pointerup', () => { state.scrubbing = false; });
  range.addEventListener('change', () => { state.scrubbing = false; });
});
window.addEventListener('pointerup', () => { state.scrubbing = false; });
function pad(n) { return String(Math.floor(n)).padStart(2, '0'); }
function formatTime(hour) {
  const h = Math.floor(hour) % 24;
  const m = Math.floor((hour % 1) * 60);
  return pad(h) + ':' + pad(m);
}
function formatHourMinute(hour) {
  const h = Math.floor(hour), m = Math.floor((hour - h) * 60);
  return `${pad(h)}:${pad(m)}`;
}
const txEdgeById = new Map(txEdges.map(e => [e.id, e]));
function trafficLevelFor(edge) {
  if (!edge) return { label: '通畅', cls: 'ok' };
  if (edge.freedom < .4) return { label: '拥堵', cls: 'low' };
  if (edge.freedom <= .7) return { label: '缓行', cls: 'mid' };
  return { label: '通畅', cls: 'ok' };
}
function lightStatusText() {
  if (!state.layers.night) return '夜景图层关闭';
  if (state.lightMode === 'off') return '灯光关闭';
  if (state.lightMode === 'on') return '灯光开启';
  return isNightNow() ? '灯光全开 · 自动' : '日间灯光待机';
}
function currentPeriodHint() {
  const h = state.hour;
  const w = state.weather;
  if (w === 'storm') return '暴雨 · 路面湿滑，整体车速下降';
  if (w === 'rain') return '小雨 · 路面湿滑，车流放缓';
  if (w === 'fog') return '雾天 · 能见度下降，远处建筑淡出';
  if (w === 'cloudy') return '多云 · 光照降低，路网运行平稳';
  if (isNightNow()) {
    const lights = state.lightMode === 'off' || !state.layers.night ? '灯光关闭' : '灯光全开';
    if (h >= 21.5 || h < 6) return '夜间 · 车流稀少，' + lights;
    return '入夜 · 晚高峰回落，' + (state.lightMode === 'off' ? '灯光关闭' : '灯光渐亮');
  }
  if (h >= 7.3 && h < 9.6) return '早高峰 · 科苑路方向缓行';
  if (h >= 17.2 && h < 19.0) return '晚高峰 · 通勤车流返程';
  if (h >= 5.7 && h < 7.3) return '清晨 · 通勤车流渐起';
  if (txStats.avgFreedom > .74) return '平峰 · 路网通畅';
  if (txStats.avgFreedom > .55) return '平峰 · 部分路段缓行';
  return '高峰 · 主干道排队缓行';
}
function isNightNow() { return computeIsNight(state.hour); }
function showCardNotice(text, duration) {
  state.cardNotice = text;
  state.cardNoticeUntil = performance.now() + (duration || 5000);
  if (typeof updateMomentCard === 'function') updateMomentCard();
}
function updateLightModeUI() {
  document.querySelectorAll('#lightModeSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.light === state.lightMode));
  if (dom.lightModeNote) {
    const text = state.lightMode === 'auto' ? '自动 · 跟随昼夜与窗灯时刻表'
      : state.lightMode === 'on' ? '开启 · 所有灯组常亮'
      : '关闭 · 仅保留环境光';
    dom.lightModeNote.textContent = text;
  }
}
function updateQualityUI() {
  if (!dom.qualitySeg) return;
  const active = state.qualityAuto ? 'auto' : state.quality;
  document.querySelectorAll('#qualitySeg button').forEach(b => b.classList.toggle('is-active', b.dataset.quality === active));
  updateQualityNote();
}
function updateQualityNote() {
  if (!dom.qualityNote) return;
  const p = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.high;
  const fps = Math.round(qualityRuntime.fps);
  const envText = p.env === 'all' ? '全场景反射' : p.env === 'glass' ? '仅玻璃反射' : '反射关';
  dom.qualityNote.textContent = `${state.qualityAuto ? '自动 · ' : ''}${p.label} · 阴影${p.shadows ? '开 ' + p.shadowMap : '关'} · ${envText} · ${fps} FPS`;
}
function populateFollowSelect() {
  if (!dom.followSelect) return;
  dom.followSelect.innerHTML = '';
  for (const lm of DATA.landmarks) {
    const opt = document.createElement('option');
    opt.value = lm.id;
    opt.textContent = lm.name;
    dom.followSelect.appendChild(opt);
  }
  if (!DATA.landmarks.some(l => l.id === state.followLandmarkId) && DATA.landmarks[0]) {
    state.followLandmarkId = DATA.landmarks[0].id;
  }
  dom.followSelect.value = state.followLandmarkId;
}
function setImmersive(on) {
  if (roam.active && on) return;
  state.immersive = !!on;
  document.body.classList.toggle('is-immersive', state.immersive);
  if (dom.immerseExit) dom.immerseExit.hidden = !state.immersive;
  tooltip.classList.remove('is-visible');
  if (dom.immerseExit) dom.immerseExit.setAttribute('aria-hidden', state.immersive ? 'false' : 'true');
}
function updateMomentCard() {
  if (!dom.momentCard) return;
  dom.momentTime.textContent = formatHourMinute(state.hour);
  dom.momentWeather.textContent = weatherLabel();
  const edge = state.selectedRoad != null ? txEdgeById.get(state.selectedRoad) : null;
  const notice = state.cardNotice && performance.now() < state.cardNoticeUntil ? state.cardNotice : '';
  dom.momentSignal.classList.toggle('is-notice', !!notice);
  if (edge) {
    dom.momentCard.classList.add('is-road');
    if (dom.momentClear) dom.momentClear.hidden = false;
    const lvl = trafficLevelFor(edge);
    dom.momentKicker.textContent = 'ROAD SEGMENT / 路段';
    dom.momentWeather.textContent = `限速 ${edge.speedLimit} · ${edge.lanesTotal} 车道`;
    dom.momentPeriod.textContent = edge.name || '未命名支路';
    dom.momentRoad.innerHTML = `<span class="pill ${lvl.cls}">${lvl.label}</span>模拟均速 ${edge.avgSpeedKmh.toFixed(1)} km/h · 通畅度 ${edge.freedom.toFixed(2)}`;
    dom.momentSignal.textContent = notice || '模拟更新间隔 1s';
    if (dom.momentMeta) dom.momentMeta.textContent = `长度 ${Math.round(edge.length / PLAN)} m · 模拟`;
  } else {
    dom.momentCard.classList.remove('is-road');
    if (dom.momentClear) dom.momentClear.hidden = true;
    const lvl = txStats.congestion >= 6 ? { label: '拥堵', cls: 'low' } : txStats.congestion >= 3 ? { label: '缓行', cls: 'mid' } : { label: '通畅', cls: 'ok' };
    dom.momentKicker.textContent = 'CURRENT PERIOD';
    dom.momentWeather.textContent = weatherLabel();
    dom.momentPeriod.textContent = periodFor(state.hour)[2];
    dom.momentRoad.innerHTML = `<span class="pill ${lvl.cls}">${lvl.label}</span>${currentPeriodHint()}`;
    dom.momentSignal.textContent = notice || (lightStatusText() + ' · 信号联动中');
    if (dom.momentMeta) dom.momentMeta.textContent = '工作日 · 模拟';
  }
}
function updateClockUI() {
  const t = formatHourMinute(state.hour);
  const period = periodFor(state.hour);
  dom.clockReadout.textContent = t;
  dom.worldTime.textContent = t;
  dom.momentTime.textContent = t;
  dom.periodTiny.textContent = period[2] + ' · 需求 ' + (txDemandAt(state.hour) * txWeatherFactor()).toFixed(2) + '×';
  const dayPct = (state.hour / 24) * 100;
  if (!state.scrubbing) {
    dom.timeRange.value = state.hour.toFixed(2);
    dom.worldRange.value = state.hour.toFixed(2);
  }
  dom.timeRange.style.setProperty('--pct', dayPct + '%');
  dom.worldRange.style.setProperty('--pct', dayPct + '%');
  window.isNight = computeIsNight(state.hour);
  document.querySelectorAll('#dayNightSeg button').forEach(b => b.classList.toggle('is-active', (b.dataset.time === '21') === window.isNight));
  const light = computeLight(state.hour);
  const h = state.hour;
  dom.sunMessage.textContent = h >= 19 || h < 5.5 ? '月色 · 城市灯火'
    : h < 6.8 ? '日出 06:30 · 模拟东南风 2 级'
    : h < 11 ? '晨光 · 模拟东南风 2 级'
    : h < 16 ? '日光 · 模拟东南风 3 级'
    : h < 18.8 ? '夕照 · 模拟南风 2 级'
    : '日落 18:30 · 灯火渐起';
  updateMomentCard();
}
function updateMetrics(force) {
  const stats = txRefreshStats();
  simNow = stats;
  dom.statVehicles.textContent = stats.vehicles.toLocaleString('en-US');
  dom.statAvgSpeed.textContent = stats.avgSpeed.toFixed(1);
  dom.statCongestion.textContent = stats.congestion.toFixed(1);
  dom.statCongested.textContent = stats.congested.toLocaleString('en-US');
  dom.trendVehicles.textContent = '需求 ' + (txDemandAt(state.hour) * txWeatherFactor()).toFixed(2) + '×';
  dom.trendAvgSpeed.textContent = WEATHER[state.weather].name + ' · ' + window.weatherFactor.toFixed(2) + '×';
  dom.trendCongestion.textContent = stats.congestion >= 6 ? '拥堵' : stats.congestion >= 3 ? '缓行' : '通畅';
  dom.trendCongested.textContent = '通畅度 < 0.4';
  dom.metricVehicles.classList.toggle('is-hot', stats.vehicles > 900);
  dom.metricCongestion.classList.toggle('is-hot', stats.congestion > 6);
  dom.metricAvgSpeed.classList.toggle('is-hot', stats.avgSpeed < 24);
  document.querySelectorAll('#weatherGrid button').forEach(b => b.classList.toggle('is-active', b.dataset.weather === state.weather));
  updateMomentCard();
  updateParking(false);
  if (force) updateClockUI();
}
function setLightMode(mode) {
  if (!['auto', 'on', 'off'].includes(mode)) return;
  state.lightMode = mode;
  updateLightModeUI();
  if (mode === 'off' || !state.layers.night) forceLightsOff();
  else updateWindowLights(true);
  updateMomentCard();
}
function setTime(hour) {
  state.hour = ((hour % 24) + 24) % 24;
  updateClockUI();
  updateMetrics(false);
  updateEnvironment(0);
}
function togglePlay() {
  state.playing = !state.playing;
  updatePlayUI();
}
function updatePlayUI() {
  const icon = state.playing
    ? '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="3.6" y="2.7" width="3.2" height="10.6" rx=".6"/><rect x="9.2" y="2.7" width="3.2" height="10.6" rx=".6"/></svg>'
    : '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4.5 2.8v10.4l8.5-5.2z"/></svg>';
  dom.playBtn.innerHTML = icon;
  dom.playBtn.classList.toggle('is-playing', state.playing);
  dom.playBtn.setAttribute('aria-label', state.playing ? '暂停时间' : '播放时间');
}
function updateSpeedUI() {
  document.querySelectorAll('#speedGroup button').forEach(b => b.classList.toggle('is-active', Number(b.dataset.speed) === state.speed));
}
function setWeather(w) {
  if (!WEATHER[w]) return;
  state.weather = w;
  window.weatherFactor = WEATHER[w].factor;
  if (w === 'storm') lightningTimer = 1.4;
  document.querySelectorAll('#weatherGrid button').forEach(b => b.classList.toggle('is-active', b.dataset.weather === w));
  // Targets take effect immediately; the visible atmosphere eases over ~2s.
  txUpdateEdgeTargets(trafficSim.demand);
  updateMetrics(true);
  updateMomentCard();
}
function restoreBaseRoadColors() {
  const attr = roadsGroup.userData.colorAttr;
  if (!attr) return;
  for (const edge of txEdges) {
    const c = edge.route.baseColor;
    for (let v = edge.route.vertexStart; v < edge.route.vertexEnd; v++) {
      attr.array[v * 3] = c.r;
      attr.array[v * 3 + 1] = c.g;
      attr.array[v * 3 + 2] = c.b;
    }
  }
  attr.needsUpdate = true;
}
function updateLayerVisibility() {
  const L = state.layers;
  buildingsGroup.visible = L.buildings;
  metroGroup.visible = L.metro;
  roadsGroup.visible = L.roads;
  congestionGroup.visible = L.congestion;
  if (!L.congestion) restoreBaseRoadColors();
  nightGroup.visible = L.night;
  if (!L.night) forceLightsOff();
  signalGroup.visible = L.signals;
  trafficGroup.visible = L.traffic;
  parkingGroup.visible = L.parking;
  parkingPanel.classList.toggle('is-visible', L.parking);
  updateWindowLights(true);
  updateLabels();
  updateMetrics(false);
  updateParking(true);
}

function setLabelDensity(mode, persist) {
  if (!['minimal', 'standard', 'all'].includes(mode)) mode = 'standard';
  state.labelDensity = mode;
  document.querySelectorAll('#labelDensitySeg button').forEach(b => b.classList.toggle('is-active', b.dataset.density === mode));
  if (persist) { try { localStorage.setItem('yuehai.labelDensity', mode); } catch (e) {} }
  updateLabels();
}
document.querySelectorAll('#labelDensitySeg button').forEach(b => {
  b.addEventListener('click', () => setLabelDensity(b.dataset.density, true));
});
setLabelDensity(state.labelDensity || 'standard', false);

document.querySelectorAll('.layer-row input').forEach((input) => {
  input.addEventListener('change', () => {
    const map = { layerBuildings: 'buildings', layerRoads: 'roads', layerMetro: 'metro', layerTraffic: 'traffic', layerCongestion: 'congestion', layerSignals: 'signals', layerNight: 'night', layerParking: 'parking', layerLabels: 'labels' };
    state.layers[map[input.id]] = input.checked;
    updateLayerVisibility();
  });
});
dom.momentClear.addEventListener('click', () => {
  state.selectedRoad = null;
  updateMomentCard();
});
dom.playBtn.addEventListener('click', togglePlay);
document.querySelectorAll('#speedGroup button').forEach(b => b.addEventListener('click', () => {
  state.speed = Number(b.dataset.speed);
  updateSpeedUI();
}));
dom.timeRange.addEventListener('input', () => setTime(Number(dom.timeRange.value)));
dom.worldRange.addEventListener('input', () => setTime(Number(dom.worldRange.value)));
document.querySelectorAll('#dayNightSeg button').forEach(b => b.addEventListener('click', () => {
  const target = Number(b.dataset.time);
  setTime(Number.isFinite(target) ? target : (b.dataset.time === 'night' ? 21 : 12));
}));
document.querySelectorAll('#weatherGrid button').forEach(b => b.addEventListener('click', () => setWeather(b.dataset.weather)));
document.querySelectorAll('#cameraSeg button').forEach(b => b.addEventListener('click', () => setCameraMode(b.dataset.camera)));
document.querySelectorAll('#lightModeSeg button').forEach(b => b.addEventListener('click', () => setLightMode(b.dataset.light)));
document.querySelectorAll('#qualitySeg button').forEach(b => b.addEventListener('click', () => setQuality(b.dataset.quality)));
$('resetCamera').addEventListener('click', () => {
  if (roam.active) roam.exit(true);
  controls.reset();
  controls.autoRotate = false;
  controls.autoPauseAt = 0;
  state.camera = 'free';
  document.querySelectorAll('#cameraSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.camera === 'free'));
});
dom.followSelect.addEventListener('change', () => {
  state.followLandmarkId = dom.followSelect.value;
  setCameraMode('follow');
});
$('placeClose').addEventListener('click', closeCard);
$('closePlace').addEventListener('click', closeCard);
$('followPlace').addEventListener('click', () => {
  if (roam.active) roam.exit(false);
  if (!followTarget) return;
  if (followTarget.type === 'landmark') {
    state.followLandmarkId = followTarget.id;
    dom.followSelect.value = followTarget.id;
    setCameraMode('follow');
  } else {
    state.camera = 'follow';
    document.querySelectorAll('#cameraSeg button').forEach(b => b.classList.toggle('is-active', b.dataset.camera === 'follow'));
    controls.autoRotate = true;
    controls.autoSpeed = .032;
    controls.autoPauseAt = 0;
    controls.focus(followTarget.x, followTarget.type === 'landmark' ? Math.max(4, followTarget.y) : followTarget.y, followTarget.z, 105);
  }
});
$('collapsePanel').addEventListener('click', () => {
  $('worldPanel').classList.add('is-collapsed');
  $('panelTab').classList.add('is-visible');
  syncMobileChrome();
});
$('panelTab').addEventListener('click', () => {
  $('worldPanel').classList.remove('is-collapsed');
  $('panelTab').classList.remove('is-visible');
  syncMobileChrome();
});
function syncMobileChrome() {
  // The old left layer stack has moved into the right world panel, so there is
  // no secondary panel to hide when the mobile drawer opens.
}
canvas.addEventListener('pointerdown', () => { tooltip.classList.remove('is-visible'); });
dom.immerseBtn.addEventListener('click', () => setImmersive(true));
dom.immerseExit.addEventListener('click', () => setImmersive(false));
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && state.immersive) setImmersive(false);
});
window.addEventListener('resize', () => {
  const p = QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, p.pixel));
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  syncMobileChrome();
});

// initial state
document.querySelectorAll('.layer-row input').forEach(input => {
  const map = { layerBuildings: 'buildings', layerRoads: 'roads', layerMetro: 'metro', layerTraffic: 'traffic', layerCongestion: 'congestion', layerSignals: 'signals', layerNight: 'night', layerParking: 'parking', layerLabels: 'labels' };
  state.layers[map[input.id]] = input.checked;
});
if (window.innerWidth < 820) {
  $('worldPanel').classList.add('is-collapsed');
  $('panelTab').classList.add('is-visible');
}
syncMobileChrome();
populateFollowSelect();
updatePlayUI();
updateSpeedUI();
updateLightModeUI();
buildParking();
updateClockUI();
// Fixed PBR split: glass uses its own PhysicalMaterial (metalness .9 /
// roughness .10 / envMapIntensity 1.2). Every other StandardMaterial is
// stone/concrete unless explicitly tagged as metal, so it only receives a
// faint .25 environment response instead of looking like glass.
scene.traverse((obj) => {
  const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
  for (const m of mats) {
    if (!m || !m.isMeshStandardMaterial) continue;
    if (m.userData && m.userData.blenderRefined) continue;
    if (m === glassMaterial || m === tencentGlassMaterial || m === crTowerMaterial || m === crLobbyGlassMaterial) continue;
    if (m === mixcGlassMaterial || m === sboT7GlassMaterial || m === sboOtherGlassMaterial || m === andazGlassMaterial || m === lenovoGlassMaterial || m === dajiaGlassMaterial || m === xiaomiGlassMaterial || m === cocoonGlassMaterial || m === neighbourGlassMaterial) continue;
    if (m.userData && m.userData.surface === 'metal') {
      m.metalness = .85;
      m.roughness = .35;
      m.envMapIntensity = 1.0;
    } else {
      m.envMapIntensity = .25;
    }
  }
});
state.qualityAuto = true;
applyQuality('high', true);
updateQualityUI();
updateMetrics(true);
updateLayerVisibility();
setImmersive(false);
updateWindowLights(true);
$('osmMeta').textContent = `建筑 ${DATA.buildings.length.toLocaleString('en-US')} · 路网 ${DATA.roads.length.toLocaleString('en-US')} · 地铁要素 ${META.counts.input.subway} · 水域 ${DATA.water.length} · 5.0×4.8 km`;
$('brandDataTime').textContent = (META.timestamp || '').slice(0, 10) || '2026-10-28';

// animation loop
let last = performance.now();
let bootTime = 0;
let started = false;
let dashboardAccum = 0;
function animate(now) {
  requestAnimationFrame(animate);
  const realDt = Math.max(.001, (now - last) / 1000);
  const rawDt = Math.min(.25, realDt);
  const dt = Math.min(.06, realDt);
  last = now;
  bootTime += dt;
  if (state.playing) {
    state.hour += rawDt * state.speed / 60;
    if (state.hour >= 24) state.hour -= 24;
    const minute = Math.floor(state.hour * 60);
    if (minute !== state.lastMinuteShown) {
      state.lastMinuteShown = minute;
      updateClockUI();
    }
  }
  // Fixed-step traffic physics. The city-clock multiplier only drives the
  // clock/demand; vehicles always use a stable 30 Hz physical time step. This
  // keeps 60× playback free of tunnelling and overlapping cars.
  trafficSim.accumulator += Math.min(.25, rawDt);
  let steps = 0;
  while (trafficSim.accumulator >= TX_FIXED_STEP && steps < 12) {
    txFixedStep(TX_FIXED_STEP);
    trafficSim.accumulator -= TX_FIXED_STEP;
    steps++;
  }
  if (steps) txRenderFleet();
  txUpdateCongestionColors(dt);
  dashboardAccum += Math.min(.25, rawDt);
  if (dashboardAccum >= 1) {
    dashboardAccum -= 1;
    updateMetrics(false);
  }
  state.signalTime += dt;
  window.isNight = computeIsNight(state.hour);
  updateEnvironment(Math.min(1.5, realDt));
  // trains
  for (const tr of metroTrainMeshes) {
    const t = (state.signalTime * tr.speed + tr.offset) % 1;
    const pos = tr.curve.getPointAt(t);
    tr.mesh.position.copy(pos);
    const ahead = tr.curve.getPointAt(Math.min(.999, t + .002));
    tr.mesh.rotation.y = Math.atan2(ahead.x - pos.x, ahead.z - pos.z);
  }
  if (state.layers.metro) {
    for (const item of metroStationMeshes) {
      const s = 1 + Math.sin(state.signalTime * 1.6 + item.group.position.x * .05) * .045;
      item.group.children[1].scale.setScalar(s);
    }
  }
  if (roam.active) roam.update(dt);
  else controls.update(dt);
  if (ordinaryLOD) ordinaryLOD.update(camera.position,now);
  updateSunShadow(sunKeyDir);
  renderer.render(scene, camera);
  if (!started) {
    started = true;
    window.__YUEHAI_BOOTED__ = true;
    if (window.__YUEHAI_BOOT_DEADLINE__) {
      clearTimeout(window.__YUEHAI_BOOT_DEADLINE__);
      window.__YUEHAI_BOOT_DEADLINE__ = 0;
    }
    setTimeout(() => { boot.classList.add('is-done'); }, Math.max(0, 220 - bootTime * 1000));
  }
  monitorFPS(realDt);
}
// Expose a small debug/test API (also useful for tweaking the sandbox).
window.__YUEHAI__ = {
  DATA, state, scene, camera, controls, renderer, roam,
  ordinaryLOD, refinedLandmarks,
  setTime, setWeather, setCameraMode, setLightMode, setQuality, setImmersive,
  updateEnvironment,
  showLandmark, showBuilding, closeCard, showRoadInfo,
  updateLabels: () => updateLabels(), setLabelDensity: (d) => setLabelDensity(d, true),
  labelStats: () => ({ density: state.labelDensity, visible: [...document.querySelectorAll('.landmark-label')].filter(el => el.classList.contains('is-visible')).length, total: document.querySelectorAll('.landmark-label').length }),
  updateMetrics, updateLayerVisibility, simNow: () => simNow,
  environment: () => ({
    isNight: !!window.isNight,
    weather: state.weather,
    weatherFactor: txWeatherFactor(),
    day: env.day,
    night: env.night,
    twilight: env.twilight,
    lightPower: env.lightPower,
    fogDensity: scene.fog.density,
    rainActive: Math.floor(weatherState.activeDrops),
    rainTarget: Math.round(WEATHER[state.weather].rainDrops),
    wet: env.wet,
    skyTop: '#' + skyUniforms.uTop.value.getHexString(),
    skyHorizon: '#' + skyUniforms.uHorizon.value.getHexString()
  }),
  lights: () => ({
    mode: state.lightMode,
    layer: state.layers.night,
    power: env.lightPower,
    streetLamps: streetLampCount,
    windows: windowInstances.length,
    pointLights: nightPointLights.length,
    carLightsVisible: txCarLightGroup.visible,
    landmarkOutline: landmarkOutlineMaterial ? landmarkOutlineMaterial.opacity : 0,
    waterLightPower: waterUniforms.uLightPower.value
  }),
  windowLightStats: () => {
    if (!windowMesh || !windowMesh.instanceColor) return { total: 0, lit: 0, byType: {} };
    const arr = windowMesh.instanceColor.array;
    let lit = 0;
    const byType = {};
    for (let i = 0; i < windowInstances.length; i++) {
      const b = arr[i * 3] + arr[i * 3 + 1] + arr[i * 3 + 2];
      if (b > .015) {
        lit++;
        const t = windowInstances[i].type;
        byType[t] = (byType[t] || 0) + 1;
      }
    }
    return { total: windowInstances.length, lit, byType };
  },
  quality: () => ({
    level: state.quality,
    auto: state.qualityAuto,
    fps: Math.round(qualityRuntime.fps),
    lowRun: qualityRuntime.lowRun,
    rainCap: rainQualityCap,
    lightLimit: qualityLightLimit,
    shadows: renderer.shadowMap.enabled,
    shadowMap: sun.shadow.mapSize.x,
    env: (QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.high).env,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles
  }),
  lighting: () => ({
    shadows: renderer.shadowMap.enabled,
    shadowMap: sun.shadow.mapSize.x,
    shadowCamera: sun.shadow.camera.right - sun.shadow.camera.left,
    sunIntensity: sun.intensity,
    sunColor: '#' + sun.color.getHexString(),
    sunDir: [sunDir.x, sunDir.y, sunDir.z],
    keyDir: [sunKeyDir.x, sunKeyDir.y, sunKeyDir.z],
    env: (QUALITY_PRESETS[state.quality] || QUALITY_PRESETS.high).env,
    envMap: currentEnvKey,
    exposure: renderer.toneMappingExposure,
    drawCalls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles
  }),
  tencent: () => window.__TENCENT__ || null,
  mixc: () => window.__MIXC__ || null,
  sbo: () => window.__SBO__ || null,
  andaz: () => window.__ANDAZ__ || null,
  lenovo: () => window.__LENOVO__ || null,
  dajia: () => window.__DAJIA__ || null,
  xiaomi: () => window.__XIAOMI__ || null,
  cocoon: () => window.__COCOON__ || null,
  neighbours: () => window.__NEIGHBOURS__ || null,
  coastal: () => window.__COASTAL__ || null,
  poly: () => window.__POLY__ || null,
  excellence: () => window.__EXCELLENCE__ || null,
  port: () => window.__PORT__ || null,
  szu: () => window.__SZU__ || null,
  hytera: () => window.__HYTERA__ || null,
  capital: () => window.__CAPITAL__ || null,
  aerospace: () => window.__AEROSPACE__ || null,
  cnooc: () => window.__CNOOC__ || null,
  rongchao: () => window.__RONCHAO__ || null,
  venture: () => window.__VENTURE__ || null,
  officeWall: () => window.__OFFICEWALL__ || null,
  bytedance: () => window.__BYTEDANCE__ || null,
  hisense: () => window.__HISENSE__ || null,
  xunlei: () => window.__XUNLEI__ || null,
  ventureNeighbors: () => window.__VENTURE_NEIGHBORS__ || null,
  eastWall: () => window.__EASTWALL__ || null,
  innovation: () => window.__INNOVATION__ || null,
  tsinghua: () => window.__TSINGHUA__ || null,
  chinaOverseas: () => window.__CHINA_OVERSEAS__ || null,
  yihua: () => window.__YIHUA__ || null,
  caixun: () => window.__CAIXUN__ || null,
  bupt: () => window.__BUPT__ || null,
  ketong: () => window.__KETONG__ || null,
  youxian: () => window.__YOUXIAN__ || null,
  lite3: () => window.__LITE3__ || null,
  residential: () => null,
  campus: () => null,
  cr: () => window.__CR__ || null,
  traffic: () => ({
    activeVehicles: txActive.length,
    targetVehicles: Math.round(clamp(TX_BASE_ACTIVE * trafficSim.demand, 70, TX_MAX_VEHICLES)),
    demand: trafficSim.demand,
    nodes: txNodes.length,
    edges: txEdges.length,
    signals: txSignals.length,
    weatherFactor: txWeatherFactor(),
    isNight: !!window.isNight
  }),
  trafficStats: () => ({ ...txStats }),
  debugTraffic: () => ({ congestionMesh, congestionGroup, trafficGroup, signalGroup, txFleet, txEdges, txSignals, txActive }),
  trafficValidation: () => {
    // Same directed-lane cars must keep at least half their lengths plus the
    // min gap from the car ahead. Returns violations for easy QA.
    let violations = 0;
    const groups = new Map();
    for (const car of txActive) {
      const k = car.edge.id * 8 + (car.dir > 0 ? 0 : 4) + car.lane;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(car);
    }
    for (const group of groups.values()) {
      group.sort((a, b) => b.pos - a.pos);
      for (let i = 1; i < group.length; i++) {
        const front = group[i - 1], back = group[i];
        if (front.pos - back.pos < (front.len + back.len) * .5 - .01) violations++;
      }
    }
    return { violations, vehicles: txActive.length };
  },
  counts: () => ({ buildings: DATA.buildings.length, roads: DATA.roads.length, signals: txSignals.length, stations: DATA.stations.length })
};
window.addEventListener('error', (e) => {
  if (!boot.classList.contains('is-done')) {
    bootError.classList.remove('hidden');
    bootError.textContent = '运行错误：' + (e.message || '未知错误');
  }
});
requestAnimationFrame(animate);

/*__NEXT__*/
})();
