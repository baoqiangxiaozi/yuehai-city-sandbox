'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const THREE = require('../vendor/three.min.js');
require('../landmarks/inline-loader.js');
const integration = require('../src/yuehai.refined.js'), load = require('./generic-fixture');
const dir = path.join(__dirname, '../landmarks');
const assetDir = path.join(dir, 'assets');
const files = fs.readdirSync(assetDir).filter(n => n.endsWith('.inline.json')).sort();
const datasets = files.map(n => JSON.parse(fs.readFileSync(path.join(assetDir, n))));
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
let checks = 0;
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
function check(n, f) { f(); checks++; console.log('PASS', n); }
function decode(b64, Type) {
  const b = Buffer.from(b64, 'base64');
  return new Type(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}
function meshY(mesh) {
  const pos = decode(mesh.position, Float32Array);
  let min = Infinity, max = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { min = Math.min(min, pos[i]); max = Math.max(max, pos[i]); }
  return [min, max];
}

check('every inline asset is finite, matches the manifest, and the GLB has no external images', () => {
  assert.ok(files.length >= 40, files.length);
  files.forEach((name, j) => {
    const d = datasets[j];
    const stem = name.replace(/\.inline\.json$/, '');
    assert.equal(d.format, 'yuehai-inline-mesh-v1');
    let triangles = 0;
    for (const m of d.meshes) {
      const pos = decode(m.position, Float32Array);
      const ix = decode(m.index, m.indexType === 'uint16' ? Uint16Array : Uint32Array);
      assert.equal(pos.length % 3, 0);
      assert.equal(ix.length % 3, 0);
      assert.ok(pos.every(Number.isFinite));
      assert.ok(ix.every(i => i < pos.length / 3));
      triangles += ix.length / 3;
    }
    const row = manifest.find(r => (r.file || r.id) === stem);
    assert.ok(row, stem);
    assert.equal(triangles, row.triangles);
    const glb = fs.readFileSync(path.join(assetDir, stem + '.glb'));
    assert.equal(glb.readUInt32LE(8), glb.length);
    const n = glb.readUInt32LE(12), g = JSON.parse(glb.subarray(20, 20 + n));
    assert.ok(!g.images?.length);
    assert.ok(g.buffers.every(b => !b.uri));
    assert.ok(!g.extensionsRequired?.length);
    assert.equal(g.meshes.reduce((sum, m) => sum + m.primitives.reduce((n, p) => n + g.accessors[p.indices].count / 3, 0), 0), triangles);
    assert.ok(fs.existsSync(path.join(assetDir, stem + '.blend')));
  });
});

check('Tencent rebuild keeps OSM heights and the three framed links', () => {
  const d = datasets.find(x => x.metadata.id === 'tencent-binhai');
  const names = d.meshes.map(m => m.name);
  for (const link of ['Culture_link', 'Health_link', 'Knowledge_link']) {
    assert.ok(names.some(n => n === link || n.startsWith(link + '.')), link);
  }
  assert.ok(!names.some(n => /truss|podium/i.test(n)));
  const south = d.metadata.members.find(m => m.name === '南塔');
  const north = d.metadata.members.find(m => m.name === '北塔');
  close(south.height, 245.8);
  close(north.height, 194.8);
  const culture = meshY(d.meshes.find(m => m.name === 'Culture_link' || m.name.startsWith('Culture_link.')));
  const knowledge = meshY(d.meshes.find(m => m.name === 'Knowledge_link' || m.name.startsWith('Knowledge_link.')));
  assert.ok(culture[0] > 15, culture);
  assert.ok(knowledge[1] < north.height + 3, knowledge);
  assert.ok(knowledge[0] > culture[1]);
});

const fixture = load();
const source = fs.readFileSync(path.join(__dirname, '../src/yuehai.js'), 'utf8');
const env = new THREE.CubeTexture();
const context = {
  THREE, window: { YuehaiRefined: integration },
  $: id => {
    assert.equal(id, 'landmark-assets');
    return { textContent: JSON.stringify(datasets) };
  },
  buildingsGroup: fixture.buildingsGroup, currentCityEnv: env, BUILD_Y: .09,
  TENCENT_LANDMARK: fixture.DATA.landmarks.find(l => l.id === 'tencent-binhai'),
  refinedLandmarks: null, crTowerGroup: null
};
const declStart = source.indexOf('const landmarkPickSets = {');
const declEnd = source.indexOf('};', declStart) + 2;
for (const m of source.slice(declStart, declEnd).matchAll(/: (\w+)/g)) context[m[1]] = [];
vm.createContext(context);
const instStart = source.indexOf('(function installBlenderLandmarks()');
const instEnd = source.indexOf('})();', instStart) + 5;
vm.runInContext(source.slice(declStart, declEnd) + '\n' + source.slice(instStart, instEnd), context);
const policy = context.refinedLandmarks;

check('installer loads every asset, drops the old builders, and fills every pick list', () => {
  assert.ok(!source.includes('(function buildChinaResourcesTower()'));
  assert.ok(!source.includes('(function buildTencentSeafrontTowers()'));
  assert.ok(!source.includes('(function buildShenzhenBayMixC() {\n  const'));
  assert.ok(source.includes('Replaced by the Blender asset loaded in installBlenderLandmarks.'));
  assert.equal(policy.assets.length, datasets.length);
  const ids = new Set(datasets.map(d => d.metadata.id));
  const idToArr = {};
  for (const m of source.slice(declStart, declEnd).matchAll(/'([^']+)': (\w+)/g)) idToArr[m[1]] = m[2];
  for (const id of ids) assert.ok(context[idToArr[id]].length > 0, id);
  assert.equal(context.crTowerGroup, policy.assets.find(a => a.metadata.id === 'china-resources').group);
  for (const a of policy.assets) {
    assert.equal(a.group.parent, fixture.buildingsGroup);
    assert.equal(a.group.rotation.x, 0);
    assert.equal(a.group.rotation.y, 0);
    assert.equal(a.group.rotation.z, 0);
    assert.ok(a.group.children.some(m => m.visible));
    assert.ok(a.nightMeshes.every(m => !m.visible));
  }
  assert.ok(source.indexOf('installBlenderLandmarks()') < source.indexOf('Object.entries(landmarkPickSets)'));
});

check('OSM indices stay skipped and each asset is scaled once from its origin', () => {
  policy.assets.forEach((a, j) => {
    const m = datasets[j].metadata;
    assert.equal(a.metadata.id, m.id);
    close(a.group.position.x, m.originRaw[0] * .058);
    close(a.group.position.z, m.originRaw[1] * .058);
    close(a.group.position.y, .09);
    close(a.group.scale.x, .058); close(a.group.scale.y, .112); close(a.group.scale.z, .058);
    for (const id of m.baselineBuildingIndices || []) assert.ok(!fixture.buildingFaceRanges.some(r => r[2] === id), id);
  });
  const cr = datasets.find(d => d.metadata.id === 'china-resources');
  const p = fixture.DATA.buildings[423].p;
  close(cr.metadata.originRaw[0], p.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0) / (p.length / 2));
  close(cr.metadata.originRaw[1], p.filter((_, i) => i % 2 === 1).reduce((a, b) => a + b, 0) / (p.length / 2));
  fixture.buildingsGroup.updateMatrixWorld(true);
  for (const row of manifest) {
    if (row.zMax == null) continue;
    const a = policy.assets.find(x => x.metadata.id === row.id && Math.abs(x.metadata.originRaw[0] - row.originRaw[0]) < 1e-6);
    const bb = new THREE.Box3().setFromObject(a.group);
    close(bb.min.y, .09 + row.zMin * .112, 1e-3);
    close(bb.max.y, .09 + row.zMax * .112, 1e-3);
  }
});

check('raycast keeps the landmark id and the mesh sits in the building layer', () => {
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3(), N = new THREE.Vector3(), M = new THREE.Vector3();
  for (const a of policy.assets) {
    const mesh = a.pickMeshes[0];
    mesh.updateMatrixWorld(true);
    const pos = mesh.geometry.attributes.position, ix = mesh.geometry.index;
    let hit = null;
    for (let t = 0; t < ix.count / 3 && !hit; t += Math.max(1, Math.floor(ix.count / 3 / 12))) {
      const i = t * 3;
      A.fromBufferAttribute(pos, ix.getX(i)).applyMatrix4(mesh.matrixWorld);
      B.fromBufferAttribute(pos, ix.getX(i + 1)).applyMatrix4(mesh.matrixWorld);
      C.fromBufferAttribute(pos, ix.getX(i + 2)).applyMatrix4(mesh.matrixWorld);
      N.crossVectors(B.clone().sub(A), C.clone().sub(A));
      if (N.lengthSq() < 1e-12) continue;
      N.normalize();
      M.copy(A).add(B).add(C).multiplyScalar(1 / 3);
      const ray = new THREE.Raycaster(M.clone().addScaledVector(N, 2), N.clone().multiplyScalar(-1), 0, 6);
      hit = ray.intersectObjects(a.pickMeshes, false)[0];
    }
    assert.ok(hit, a.metadata.id);
    assert.equal(hit.object.userData.customLandmarkId, a.metadata.id);
    assert.ok(fixture.buildingsGroup.children.includes(a.group));
  }
  assert.ok(!source.includes('YuehaiRoam'));
  assert.ok(!source.includes('enterRoam'));
});

check('screen picker uses the Tencent mesh and follows the building-layer visibility', () => {
  const asset = policy.assets.find(a => a.metadata.id === 'tencent-binhai');
  const south = asset.metadata.members.find(m => m.name === '南塔');
  const center = new THREE.Vector3(south.cx * .058, .09 + south.height * .112 * .45, south.cz * .058);
  const cam = new THREE.PerspectiveCamera(38, 1, .015, 1800);
  cam.position.set(center.x + 6, center.y + 4, center.z + 10);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  Object.assign(context, {
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) },
    camera: cam, pointerNdc: new THREE.Vector2(), raycaster: new THREE.Raycaster(),
    buildingsMesh: fixture.buildingsMesh, roadMesh: null,
    markerPickables: context.tencentPickMeshes.slice(),
    buildingFaceRanges: fixture.buildingFaceRanges, roadFaceRanges: [], carRoutes: []
  });
  const a = source.indexOf('function pickScreen('), b = source.indexOf('function handleTap(', a);
  vm.runInContext(source.slice(a, b), context);
  assert.equal(context.pickScreen(50, 50).id, 'tencent-binhai');
  fixture.buildingsGroup.visible = false;
  assert.equal(context.pickScreen(50, 50), null);
  fixture.buildingsGroup.visible = true;
});

check('night and environment updates cover the Blender materials', () => {
  policy.setNight(1);
  for (const a of policy.assets) {
    assert.ok(a.nightMeshes.every(m => m.visible));
    if (a.materials.night) close(a.materials.night.opacity, 1);
  }
  policy.setNight(.25);
  for (const a of policy.assets) if (a.materials.night) close(a.materials.night.opacity, .25);
  policy.setNight(1, false);
  for (const a of policy.assets) {
    assert.ok(a.nightMeshes.every(m => !m.visible));
    if (a.materials.night) close(a.materials.night.opacity, 0);
  }
  assert.ok(source.includes('refinedLandmarks.setNight(lightPower,state.layers.night)'));
  const env2 = new THREE.CubeTexture();
  policy.setEnvironment(env2, 'all');
  for (const a of policy.assets) for (const m of Object.values(a.materials)) assert.equal(m.envMap, env2);
  policy.setEnvironment(env, 'glass');
  for (const a of policy.assets) for (const [key, m] of Object.entries(a.materials)) assert.equal(m.envMap, key.startsWith('glass') ? env : null);
  policy.setEnvironment(env, 'none');
  for (const a of policy.assets) for (const m of Object.values(a.materials)) assert.equal(m.envMap, null);
  for (const a of policy.assets) {
    const spec = datasets.find(d => d.metadata.id === a.metadata.id).materials;
    for (const [key, mat] of Object.entries(a.materials)) {
      close(mat.metalness, spec[key].metalness);
      close(mat.roughness, spec[key].roughness);
      assert.equal(mat.userData.blenderRefined, true);
    }
  }
  assert.ok(source.includes('if (m.userData && m.userData.blenderRefined) continue;'));
});

check('hiding the building layer hides the refined assets and the old groups are gone', () => {
  fixture.buildingsGroup.visible = false;
  for (const a of policy.assets) assert.equal(a.group.parent.visible, false);
  fixture.buildingsGroup.visible = true;
  assert.ok(!fixture.buildingsGroup.children.some(g => g.name === 'china-resources-tower' || g.name === 'tencent-seafront-towers' || g.name === 'shenzhen-bay-mixc'));
});

console.log(`${checks} landmark integration groups passed; no browser/WebGL QA.`);
