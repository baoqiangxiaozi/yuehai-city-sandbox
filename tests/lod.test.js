'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const THREE=require('../vendor/three.min.js');
const {levelFor,distanceToBounds,inside,build}=require('../src/yuehai.lod.js');
const load=require('./generic-fixture');
let checks=0;function check(n,f){f();checks++;console.log('PASS',n);}
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
check('three actual distance levels and hysteresis (meters)',()=>{
 assert.equal(levelFor(0,179),2);assert.equal(levelFor(0,181),1);
 assert.equal(levelFor(2,239),2);assert.equal(levelFor(2,241),1);
 assert.equal(levelFor(0,601),0);assert.equal(levelFor(1,719),1);assert.equal(levelFor(1,721),0);
 assert.equal(levelFor(2,1000),0);assert.equal(levelFor(0,1000),0);
});
check('3D AABB distance and polygon containment',()=>{
 const b={minX:0,maxX:10,minY:0,maxY:20,minZ:0,maxZ:10};
 near(distanceToBounds({x:5,y:10,z:5},b),0);near(distanceToBounds({x:5,y:23,z:14},b),5);
 assert.ok(inside(1,1,[[0,0],[3,0],[3,3],[0,3]]));assert.ok(!inside(5,5,[[0,0],[3,0],[3,3],[0,3]]));
});
const current=load();const lod=current.ordinaryLOD;const stats=lod.stats();
check('actual scene generic coverage and sensible cached geometry budgets',()=>{
 assert.ok(stats.buildings>1500);assert.ok(stats.entrances>1500);assert.ok(stats.nearTriangles<600000);
 assert.ok(stats.windowFrames<=stats.buildings*4);assert.ok(stats.chunks<600);assert.ok(stats.cachedAttributeBytes<80*1024*1024);
 const ids=new Set(current.captured.map(x=>x.index));assert.equal(ids.size,stats.buildings);
 for(const id of ids)assert.ok(!current.landmarkBuildingMap.has(id));
 for(const m of lod.group.children){assert.ok(m.userData.roamSpawnCheck);for(const attr of Object.values(m.geometry.attributes))assert.ok(attr.array.every(Number.isFinite));}
});
check('far-to-near switches real cached geometry, not emissive brightness',()=>{
 lod.update({x:1000,y:1000,z:1000},1000,true);const far=lod.stats();assert.equal(far.activeTriangleUpperBound,0);assert.equal(far.activeMeshUpperBound,0);
 const b=lod.debugChunks()[0].bounds;lod.update({x:(b.minX+b.maxX)/2,y:.34,z:(b.minZ+b.maxZ)/2},1300,true);
 const close=lod.stats();assert.ok(close.nearChunks>0);assert.ok(close.activeTriangleUpperBound>0);assert.ok(close.activeMeshUpperBound>0);
 const attrs=lod.group.children.map(m=>m.geometry.attributes.position.array);
 for(let i=0;i<100;i++)lod.update({x:i*.2,y:.34,z:0},2000+i*260);
 lod.group.children.forEach((m,i)=>assert.equal(m.geometry.attributes.position.array,attrs[i]));
});
check('LOD update throttling and inherited building-layer visibility',()=>{
 const n=lod.stats().updates;assert.equal(lod.update({x:0,y:0,z:0},27741),false);assert.equal(lod.stats().updates,n);
 current.buildingsGroup.visible=false;assert.equal(lod.group.parent,current.buildingsGroup);assert.equal(lod.group.parent.visible,false);current.buildingsGroup.visible=true;
});
const baselineRoot=process.argv[2]||'/workspace/yuehai-sandbox-v3';
if(fs.existsSync(baselineRoot)) {
 const old=load(baselineRoot);
 function hash(mesh){if(!mesh)return null;const h=crypto.createHash('sha256');for(const [n,a]of Object.entries(mesh.geometry.attributes)){h.update(n);h.update(Buffer.from(a.array.buffer,a.array.byteOffset,a.array.byteLength));}return h.digest('hex');}
 check('base prism and glass attributes unchanged from v3, all face IDs retained',()=>{
 assert.equal(hash(current.buildingsMesh),hash(old.buildingsMesh));assert.equal(hash(current.glassMesh),hash(old.glassMesh));assert.equal(hash(current.landmarkGlassMesh),hash(old.landmarkGlassMesh));
 assert.equal(JSON.stringify(current.buildingFaceRanges),JSON.stringify(old.buildingFaceRanges));assert.equal(JSON.stringify(current.DATA),JSON.stringify(old.DATA));
 });
 check('window panels/colors/seeds/transforms unchanged; roofs moved not duplicated',()=>{
 assert.equal(JSON.stringify(current.windowInstances),JSON.stringify(old.windowInstances));assert.equal(hash(current.windowMesh),hash(old.windowMesh));
 let before=0,after=0;for(const m of old.roofDetailGroup.children)before+=m.geometry.attributes.position.count/3;
 for(const m of current.roofDetailGroup.children)after+=m.geometry.attributes.position.count/3;
 assert.equal(before,after+stats.reusedMidTriangles);
 });
 check('actual base raycast / binary face-to-building mapping unchanged',()=>{
 const b=current.captured[0];const ray=new THREE.Raycaster(new THREE.Vector3(b.cx,500,b.cz),new THREE.Vector3(0,-1,0),0,600);
 current.buildingsGroup.updateMatrixWorld(true);old.buildingsGroup.updateMatrixWorld(true);
 const hit=ray.intersectObject(current.buildingsMesh)[0],prev=ray.intersectObject(old.buildingsMesh)[0];assert.ok(hit);assert.equal(hit.faceIndex,prev.faceIndex);
 const find=face=>current.buildingFaceRanges.find(r=>face>=r[0]&&face<r[1])[2];assert.equal(find(hit.faceIndex),b.index);
 });
}
console.log('MEASURED GEOMETRY COUNTS (no WebGL/FPS):',JSON.stringify(stats,null,2));
console.log('EXAMPLE ORDINARY BUILDING:',JSON.stringify({index:current.captured[0].index,centerScene:[current.captured[0].cx,current.captured[0].cz]}));
console.log(`${checks} LOD geometry / logic checks passed. No browser rendering QA.`);
