'use strict';
// Execute only the actual deterministic generic-building builder with Three.js.
// 2D canvas drawing is stubbed: this validates geometry/data, NOT pixels/WebGL.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const THREE=require('../vendor/three.min.js');
const LOD=require('../src/yuehai.lod.js');
module.exports=function loadGeneric(root=path.join(__dirname,'..')) {
 const source=fs.readFileSync(path.join(root,'src/yuehai.js'),'utf8');
 function between(a,b){const i=source.indexOf(a);if(i<0)throw Error(a);const j=source.indexOf(b,i);if(j<0)throw Error(b);return source.slice(i,j);}
 const DATA=JSON.parse(fs.readFileSync(path.join(root,'data/yuehai-osm.json')));
 const ctx2d=new Proxy({},{get:(_,name)=>String(name).includes('Gradient')?()=>({addColorStop(){}}):()=>{}});
 let captured=[];
 const context={THREE,DATA,window:{YuehaiBuildingLOD:{...LOD,build:o=>{captured=o.buildings.slice();return LOD.build(o);}}},document:{createElement:()=>({width:0,height:0,getContext:()=>ctx2d})},
 world:new THREE.Group(),nightGroup:new THREE.Group(),currentCityEnv:null,performance:{now:()=>0},camera:{position:new THREE.Vector3(128,178,268)},bootStatus:{}};
 vm.createContext(context);
 const pieces=[between('const META = DATA.meta;','// ── renderer / scene'),between('function mulberry32(seed)','// ── state'),
 between('(function normalizeBuildings()','bootStatus.textContent = \'正在搭建'),
 between('function pushTriangle(','function pathLengthWorld('),between('function addLoopSegments(','function highlightBuildings('),
 between('// ── buildings ─','// ── bespoke China Resources Headquarters')];
 vm.runInContext(pieces.join('\n')+'\nglobalThis.fixture={DATA,buildingsGroup,buildingsMesh,glassMesh,landmarkGlassMesh,buildingFaceRanges,windowInstances,windowMesh,windowHaloMesh,roofDetailGroup,ordinaryLOD:typeof ordinaryLOD===\'undefined\'?null:ordinaryLOD,landmarkBuildingMap};',context);
 return {...context.fixture,captured};
};
