'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const THREE=require('../vendor/three.min.js');require('../landmarks/inline-loader.js');
const integration=require('../src/yuehai.refined.js'),load=require('./generic-fixture');
const dir=path.join(__dirname,'../landmarks');
const files=['tencent-binhai','china-resources'];
const datasets=files.map(id=>JSON.parse(fs.readFileSync(path.join(dir,'assets',id+'.inline.json'))));
const manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json')));
let checks=0;const close=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
function check(n,f){f();checks++;console.log('PASS',n);}
check('all inline attributes finite, aligned and index ranges valid; GLB counts/resources',()=>{
 datasets.forEach((d,j)=>{
  assert.equal(d.format,'yuehai-inline-mesh-v1');let triangles=0;
  for(const m of d.meshes) {
   const bytes=s=>{const b=Buffer.from(s,'base64');return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};
   const pos=new Float32Array(bytes(m.position));const ix=m.indexType==='uint16'?new Uint16Array(bytes(m.index)):new Uint32Array(bytes(m.index));
   assert.equal(pos.length%3,0);assert.equal(ix.length%3,0);assert.ok(pos.every(Number.isFinite));assert.ok(ix.every(i=>i<pos.length/3));triangles+=ix.length/3;
  }
  assert.equal(triangles,manifest[j].triangles);
  const glb=fs.readFileSync(path.join(dir,'assets',files[j]+'.glb'));assert.equal(glb.readUInt32LE(8),glb.length);
  const n=glb.readUInt32LE(12),g=JSON.parse(glb.subarray(20,20+n));assert.ok(!g.images?.length);assert.ok(g.buffers.every(b=>!b.uri));assert.ok(!g.extensionsRequired?.length);
  assert.equal(g.meshes.reduce((sum,m)=>sum+m.primitives.reduce((n,p)=>n+g.accessors[p.indices].count/3,0),0),triangles);
 });
});
const fixture=load();const source=fs.readFileSync(path.join(__dirname,'../src/yuehai.js'),'utf8');
const env=new THREE.CubeTexture();
const context={THREE,window:{YuehaiRefined:integration},$:id=>({textContent:JSON.stringify(datasets[id==='landmark-tencent'?0:1])}),buildingsGroup:fixture.buildingsGroup,currentCityEnv:env,BUILD_Y:.09,TENCENT_LANDMARK:fixture.DATA.landmarks.find(l=>l.id==='tencent-binhai'),refinedLandmarks:null,crPickMeshes:[],tencentPickMeshes:[],crTowerGroup:null};
vm.createContext(context);const a=source.indexOf('(function installBlenderLandmarks()'),b=source.indexOf('// ── 深圳湾万象城',a);vm.runInContext(source.slice(a,b),context);
const policy=context.refinedLandmarks;
check('actual app installer replaces both legacy builders and registers pick targets',()=>{
 assert.ok(!source.includes('(function buildChinaResourcesTower()'));assert.ok(!source.includes('(function buildTencentSeafrontTowers()'));
 assert.equal(policy.assets.length,2);assert.equal(context.tencentPickMeshes.length,6);assert.equal(context.crPickMeshes.length,6);assert.equal(context.crTowerGroup,policy.assets[1].group);
 for(const a of policy.assets){assert.equal(a.group.parent,fixture.buildingsGroup);assert.equal(a.group.children.length,7);assert.equal(a.group.children.filter(m=>m.visible).length,6);assert.equal(a.group.rotation.x,0);assert.equal(a.group.rotation.y,0);assert.equal(a.group.rotation.z,0);}
 assert.ok(source.indexOf('installBlenderLandmarks()')<source.indexOf('for (const m of crPickMeshes)'));
});
check('original height, OSM skip IDs and exact-once scale/origin',()=>{
 policy.assets.forEach((a,j)=>{
  const m=datasets[j].metadata;close(a.group.position.x,m.originRaw[0]*.058);close(a.group.position.z,m.originRaw[1]*.058);close(a.group.position.y,.09);
  close(a.group.scale.x,.058);close(a.group.scale.y,.112);close(a.group.scale.z,.058);
  for(const id of m.baselineBuildingIndices)assert.ok(!fixture.buildingFaceRanges.some(r=>r[2]===id));
 });
 close(datasets[0].metadata.buildings[0].height,fixture.DATA.buildings[602].height);close(datasets[0].metadata.buildings[1].height,fixture.DATA.buildings[603].height);close(datasets[1].metadata.heightM,fixture.DATA.buildings[423].height);
 const p=fixture.DATA.buildings[423].p;close(datasets[1].metadata.originRaw[0],p.filter((_,i)=>i%2===0).reduce((a,b)=>a+b,0)/(p.length/2));
 close(datasets[1].metadata.originRaw[1],p.filter((_,i)=>i%2===1).reduce((a,b)=>a+b,0)/(p.length/2));
 fixture.buildingsGroup.updateMatrixWorld(true);
 policy.assets.forEach((a,j)=>{const bb=new THREE.Box3().setFromObject(a.group);const h=j===0?245.8:392.5;close(bb.min.y,.09);close(bb.max.y,.09+h*.112,1e-5);});
});
check('r128 raycast carries existing landmark IDs; bodies are within spawn-probe tree',()=>{
 for(const a of policy.assets) {
  const bb=new THREE.Box3().setFromObject(a.group),center=bb.getCenter(new THREE.Vector3());
  const ray=new THREE.Raycaster(new THREE.Vector3(center.x,500,center.z),new THREE.Vector3(0,-1,0),0,600);
  const hits=ray.intersectObjects(a.pickMeshes,false);assert.ok(hits.length>0);assert.equal(hits[0].object.userData.customLandmarkId,a.metadata.id);
  assert.ok(fixture.buildingsGroup.children.includes(a.group));
 }
 assert.ok(source.includes('collect(buildingsGroup)'));
});
check('actual screen picker respects hidden parent layers and retains landmark ID',()=>{
 const box=new THREE.Box3().setFromObject(policy.assets[0].group),center=box.getCenter(new THREE.Vector3());
 const cam=new THREE.PerspectiveCamera(38,1,.015,1800);cam.position.set(center.x,100,center.z);cam.lookAt(center);cam.updateMatrixWorld(true);
 Object.assign(context,{canvas:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})},camera:cam,pointerNdc:new THREE.Vector2(),raycaster:new THREE.Raycaster(),
 buildingsMesh:fixture.buildingsMesh,roadMesh:null,markerPickables:[...context.crPickMeshes,...context.tencentPickMeshes],buildingFaceRanges:fixture.buildingFaceRanges,roadFaceRanges:[],carRoutes:[]});
 const a=source.indexOf('function pickScreen('),b=source.indexOf('function handleTap(',a);vm.runInContext(source.slice(a,b),context);
 assert.equal(context.pickScreen(50,50).id,'tencent-binhai');fixture.buildingsGroup.visible=false;assert.equal(context.pickScreen(50,50),null);fixture.buildingsGroup.visible=true;
});
check('night fades and explicit layer-off remove both independent light batches',()=>{
 policy.setNight(1);for(const a of policy.assets){assert.ok(a.nightMeshes.every(m=>m.visible));close(a.materials.night.opacity,1);}
 policy.setNight(.25);for(const a of policy.assets)close(a.materials.night.opacity,.25);
 policy.setNight(1,false);for(const a of policy.assets){assert.ok(a.nightMeshes.every(m=>!m.visible));close(a.materials.night.opacity,0);}
 assert.ok(source.includes('refinedLandmarks.setNight(lightPower,state.layers.night)'));assert.ok(source.includes('refinedLandmarks.setNight(0)'));
});
check('high / medium / low environment changes include both glass variants',()=>{
 const env2=new THREE.CubeTexture();policy.setEnvironment(env2,'all');for(const a of policy.assets)for(const m of Object.values(a.materials))assert.equal(m.envMap,env2);
 policy.setEnvironment(env,'glass');for(const a of policy.assets)for(const [key,m]of Object.entries(a.materials))assert.equal(m.envMap,key.startsWith('glass')?env:null);
 policy.setEnvironment(env,'none');for(const a of policy.assets)for(const m of Object.values(a.materials))assert.equal(m.envMap,null);
 for(const a of policy.assets){close(a.materials.glass.metalness,.56);close(a.materials.glass.roughness,.24);assert.ok(a.materials.glass.userData.blenderRefined);}
 assert.ok(source.includes('if (m.userData && m.userData.blenderRefined) continue;'));
});
check('building layer inheritance hides whole refined assets without global-world remnants',()=>{
 fixture.buildingsGroup.visible=false;for(const a of policy.assets)assert.equal(a.group.parent.visible,false);fixture.buildingsGroup.visible=true;
 assert.ok(!fixture.buildingsGroup.children.some(g=>g.name==='china-resources-tower'||g.name==='tencent-seafront-towers'));
});
console.log('LANDMARK COUNTS',JSON.stringify(policy.stats(),null,2));
console.log(`${checks} independent asset/app integration groups passed; no browser/WebGL QA.`);
