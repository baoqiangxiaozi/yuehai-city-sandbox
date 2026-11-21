'use strict';
// Pure Node / Three.js math and fake-DOM event tests; no browser automation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const THREE = require('../vendor/three.min.js');
const { step, create } = require('../src/yuehai.roam.js');
const plan = .058, bounds = { minX:-145,maxX:145,minZ:-145,maxZ:133.4 };
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-8, `${a} != ${b}`);
let checks = 0;
function check(name, f) { f(); checks++; console.log('PASS', name); }
check('frame-rate independent 30/60/120Hz', () => {
  const run = n => { let p={x:0,z:0}; for(let i=0;i<n;i++)p=step(p,0,1,0,false,1/n,plan,bounds);return p; };
  close(run(30).z,run(60).z);close(run(60).z,run(120).z);close(run(60).z,-12*plan);
});
check('normalized diagonal, yaw, opposite cancellation and boost', () => {
 const p={x:0,z:0};const a=step(p,0,1,0,false,.04,plan,bounds),b=step(p,0,1,1,false,.04,plan,bounds);
 close(Math.hypot(b.x,b.z),Math.abs(a.z));close(step(p,Math.PI/2,1,0,false,.04,plan,bounds).x,a.z);
 close(step(p,0,1,0,true,.04,plan,bounds).z,4*a.z);close(step(p,0,0,0,false,.04,plan,bounds).z,0);
});
check('delta limits and map boundary', () => {
 close(step({x:0,z:0},0,1,0,false,100,plan,bounds).z,-12*plan*.05);
 close(step({x:0,z:0},0,1,0,false,-1,plan,bounds).z,0);
 close(step({x:0,z:0},0,1,0,false,NaN,plan,bounds).z,0);
 const p=step({x:145,z:133.4},0,-1,1,true,.05,plan,bounds);assert.equal(p.x,145);assert.equal(p.z,133.4);assert.equal(p.boundary,true);
});
class El {
 constructor(){this.listeners={};this.hidden=false;this.tagName='BUTTON';this.dataset={};this.style={};this.children=[];this.captured=new Set();this.classes=new Set();
 this.classList={add:(...xs)=>xs.forEach(x=>this.classes.add(x)),remove:(...xs)=>xs.forEach(x=>this.classes.delete(x)),toggle:(x,y)=>y?this.classes.add(x):this.classes.delete(x)};}
 addEventListener(t,f){(this.listeners[t]??=[]).push(f);}
 emit(t,extra={}){const e={code:'',key:'',button:0,pointerId:1,clientX:0,clientY:0,preventDefault(){this.prevented=true},stopImmediatePropagation(){this.stopped=true},...extra};
 for(const f of this.listeners[t]||[]){f(e);if(e.stopped)break;}return e;}
 querySelectorAll(){return this.children;}
 setPointerCapture(id){this.captured.add(id);}hasPointerCapture(id){return this.captured.has(id);}
 releasePointerCapture(id){this.captured.delete(id);this.emit('lostpointercapture',{pointerId:id});}
 focus(){this.focused=true;}setAttribute(n,v){this[n]=v;}
}
const elems=new Map();const $=id=>{if(!elems.has(id))elems.set(id,new El());return elems.get(id);};
const win=new El(), doc=new El();doc.body=new El();doc.querySelectorAll=()=>[];doc.hidden=false;
const canvas=$('scene');canvas.tagName='CANVAS';
const pad=$('roamPad');pad.children=['forward','back','left','right'].map(dir=>{const e=new El();e.dataset.roamDir=dir;return e;});
const camera=new THREE.PerspectiveCamera(38,1,.6,1800);
const state={camera:'free'};
const scene=new THREE.Scene();const buildingsGroup=new THREE.Group();scene.add(buildingsGroup);
const DATA=JSON.parse(fs.readFileSync(path.join(__dirname,'../data/yuehai-osm.json')));
const context={THREE,window:win,document:doc,canvas,camera,state,scene,buildingsGroup,DATA,PLAN:plan,HS:.112,ROAD_Y:.13,BUILD_Y:.09,wx:x=>x*plan,wz:z=>z*plan,clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),$,performance:{now:()=>1},setImmersive:()=>{},updateLabels:()=>{},showCardNotice:()=>{}};
// Supply browser globals to controller factory without a real DOM/browser.
win.YuehaiRoam={create:o=>create({...o,document:doc,window:win})};
const source=fs.readFileSync(path.join(__dirname,'../src/yuehai.js'),'utf8');
const start=source.indexOf('class OrbitControls {'), end=source.indexOf('// ── lights',start);
vm.createContext(context);vm.runInContext(source.slice(start,end)+'\nglobalThis.test = { controls, roam, findRoamSpawn };',context);
const { controls, roam, findRoamSpawn }=context.test;
controls.update(0);const original=camera.position.clone();
const key=(code,extra={})=>win.emit('keydown',{code,...extra});const up=code=>win.emit('keyup',{code});
check('road start selected; real geometry ray rejects occupied candidate',()=>{
 const spawn=findRoamSpawn();assert.ok(spawn);close(spawn.x,1457.85*plan);close(spawn.z,-456.5*plan);
 const box=new THREE.Mesh(new THREE.BoxGeometry(2,10,2),new THREE.MeshBasicMaterial());box.position.set(spawn.x,5,spawn.z);buildingsGroup.add(box);
 const fallback=findRoamSpawn();assert.ok(fallback);assert.notEqual(fallback.x,spawn.x);buildingsGroup.remove(box);
});
check('hidden ordinary LOD details still block unsafe spawn candidates',()=>{
 const spawn=findRoamSpawn();const box=new THREE.Mesh(new THREE.BoxGeometry(2,10,2),new THREE.MeshBasicMaterial());
 box.position.set(spawn.x,5,spawn.z);box.visible=false;box.userData.roamSpawnCheck=true;buildingsGroup.add(box);
 const next=findRoamSpawn();assert.ok(next);assert.notEqual(next.x,spawn.x);buildingsGroup.remove(box);
});
check('OSM footprint rejects even when no mesh is present',()=>{
 const preferred=findRoamSpawn(),x=preferred.x/plan,z=preferred.z/plan;
 DATA.buildings.push({p:[x-1,z-1,x+1,z-1,x+1,z+1,x-1,z+1]});
 const next=findRoamSpawn();assert.ok(next);assert.notEqual(next.x,preferred.x);DATA.buildings.pop();
});
check('entry takes ownership, changes near/FOV and starts at street height',()=>{
 roam.enter();assert.equal(roam.active,true);assert.equal(state.camera,'roam');assert.equal(controls.enabled,false);assert.equal(camera.near,.015);assert.equal(camera.fov,65);close(camera.position.y,.13+.02+1.7*.112);assert.equal($('roamHud').hidden,false);
});
check('WASD moves, orbit wheel/drag/focus cannot fight camera',()=>{
 const p=camera.position.clone(),g=controls.radiusGoal;key('KeyW');roam.update(.04);up('KeyW');assert.ok(camera.position.distanceTo(p)>0);
 canvas.emit('wheel',{deltaY:100});assert.equal(controls.radiusGoal,g);
 controls.focus(900,900,900,900);assert.equal(controls.autoRotate,false);
 canvas.emit('pointerdown',{clientX:10,clientY:10});canvas.emit('pointermove',{clientX:30,clientY:10});assert.equal(controls.dragging,false);assert.ok(camera.rotation.y!==0);
 canvas.emit('pointercancel');win.emit('pointercancel');
});
check('keyup, blur, repeat-after-blur and visibility stop motion',()=>{
 key('ArrowUp');up('ArrowUp');let p=camera.position.clone();roam.update(.03);close(camera.position.distanceTo(p),0);
 key('KeyW');win.emit('blur');key('KeyW',{repeat:true});p=camera.position.clone();roam.update(.03);close(camera.position.distanceTo(p),0);
 key('KeyW');doc.hidden=true;doc.emit('visibilitychange');roam.update(.03);doc.hidden=false;p=camera.position.clone();roam.update(.03);close(camera.position.distanceTo(p),0);
});
check('touch multi-pointer and pointercancel/lostcapture cleanup',()=>{
 const forward=pad.children[0],right=pad.children[3];forward.emit('pointerdown',{pointerId:3});right.emit('pointerdown',{pointerId:4});let p=camera.position.clone();roam.update(.03);assert.ok(camera.position.distanceTo(p)>0);
 win.emit('pointercancel',{pointerId:3});right.emit('lostpointercapture',{pointerId:4});p=camera.position.clone();roam.update(.03);close(camera.position.distanceTo(p),0);
 canvas.emit('pointerdown',{pointerId:5});canvas.emit('lostpointercapture',{pointerId:5});const rot=camera.rotation.y;canvas.emit('pointermove',{pointerId:5,clientX:300});assert.equal(camera.rotation.y,rot);
});
check('reset clears held keys and uses validated start',()=>{
 key('KeyW');roam.update(.04);key('KeyR');let p=camera.position.clone();close(p.x,findRoamSpawn().x);roam.update(.04);close(camera.position.distanceTo(p),0);up('KeyR');
});
check('Esc exits in one press and restores overview pose / lens / events',()=>{
 key('KeyW');const e=key('Escape');assert.equal(e.stopped,true);assert.equal(roam.active,false);assert.equal(controls.enabled,true);assert.equal(camera.near,.6);assert.equal(camera.fov,38);close(camera.position.distanceTo(original),0);
 roam.update(.04);close(camera.position.distanceTo(original),0);canvas.emit('wheel',{deltaY:50});assert.ok(controls.radiusGoal!==360);controls.reset();
});
check('orbit restore, explicit overview exit and idempotent enter/exit',()=>{
 state.camera='orbit';controls.autoRotate=true;controls.autoSpeed=.055;
 roam.enter();roam.enter();roam.exit(false);assert.equal(state.camera,'orbit');assert.equal(controls.autoRotate,true);close(controls.autoSpeed,.055);
 roam.enter();roam.exit(true);assert.equal(state.camera,'free');assert.equal(controls.autoRotate,false);close(controls.radius,360);roam.exit(true);
});
check('editable keys ignored, focus clears motion, entry/exit buttons work',()=>{
 $('enterRoam').emit('click');let p=camera.position.clone();key('KeyW',{target:{tagName:'INPUT'}});roam.update(.04);close(camera.position.distanceTo(p),0);
 key('KeyW');doc.emit('focusin',{target:{tagName:'SELECT'}});p=camera.position.clone();roam.update(.04);close(camera.position.distanceTo(p),0);
 $('roamExit').emit('click');assert.equal(roam.active,false);$('enterRoam').emit('click');$('roamOverview').emit('click');assert.equal(state.camera,'free');
});


check('no safe spawn leaves overview untouched',()=>{
 const box=new THREE.Mesh(new THREE.BoxGeometry(400,10,400),new THREE.MeshBasicMaterial());box.position.y=5;buildingsGroup.add(box);
 const p=camera.position.clone();roam.enter();assert.equal(roam.active,false);assert.equal(controls.enabled,true);close(camera.position.distanceTo(p),0);buildingsGroup.remove(box);
});

console.log(`${checks} pure logic / fake-DOM integration checks passed (not browser QA).`);
