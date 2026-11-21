/* Ordinary-building detail LOD. Additive, deterministic, cached chunk meshes.
 * OSM masses, original facade shader/window instances and pick meshes stay intact.
 * Details are procedural illustrations, NOT surveyed architecture.
 */
(function(root) {
  'use strict';
  const SETTINGS = { chunkMeters:160, nearEnter:180, nearExit:240, midEnter:600, midExit:720, intervalMs:250 };
  function levelFor(previous, distanceMeters, s=SETTINGS) {
    if (previous === 2 && distanceMeters <= s.nearExit) return 2;
    if (distanceMeters <= s.nearEnter) return 2;
    if (previous > 0 && distanceMeters <= s.midExit) return 1;
    return distanceMeters <= s.midEnter ? 1 : 0;
  }
  function distanceToBounds(p,b) {
    return Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minY-p.y,0,p.y-b.maxY),Math.max(b.minZ-p.z,0,p.z-b.maxZ));
  }
  function inside(x,z,ring) {
    let hit=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
    }
    return hit;
  }
  function build(o) {
    const T=o.THREE, P=o.plan, H=o.heightScale, base=o.baseY;
    const settings={...SETTINGS,...o.settings};
    const rootGroup=new T.Group(); rootGroup.name='ordinary-procedural-lod';
    const chunks=new Map();
    const counts={buildings:0,baseBands:0,entrances:0,windowFrames:0,newRoofUnits:0,reusedRoofBuildings:0};
    const template=new T.BoxGeometry(1,1,1).toNonIndexed();
    const cube=template.attributes.position.array;
    const colors={stone:[.21,.23,.20],trim:[.40,.43,.40],glass:[.045,.09,.10],roof:[.25,.28,.25],vent:[.10,.12,.11]};
    function tri(c,a,b,d,color) {
      c.p.push(...a,...b,...d);
      for(let i=0;i<3;i++)c.c.push(...color);
    }
    // Box axes: U along facade, N outward. Center-height convention.
    function box(c,x,y,z,sx,sy,sz,ux,uz,nx,nz,color) {
      for(let i=0;i<cube.length;i+=3) {
        const a=cube[i]*sx,b=cube[i+1]*sy,d=cube[i+2]*sz;
        c.p.push(x+ux*a+nx*d,y+b,z+uz*a+nz*d);c.c.push(...color);
      }
    }
    function frame(c,w) {
      const nx=Math.sin(w.yaw),nz=Math.cos(w.yaw),ux=nz,uz=-nx;
      const x=w.x+nx*.06,z=w.z+nz*.06,halfW=w.w/2,halfH=w.h/2,t=Math.min(.012,w.w/5,w.h/5);
      function quad(a,b,d,e) {
        function v(p){return[x+ux*p[0],w.y+p[1],z+uz*p[0]];}
        tri(c,v(a),v(b),v(d),colors.trim);tri(c,v(a),v(d),v(e),colors.trim);
      }
      quad([-halfW,-halfH],[-halfW+t,-halfH],[-halfW+t,halfH],[-halfW,halfH]);
      quad([halfW-t,-halfH],[halfW,-halfH],[halfW,halfH],[halfW-t,halfH]);
      quad([-halfW+t,-halfH],[halfW-t,-halfH],[halfW-t,-halfH+t],[-halfW+t,-halfH+t]);
      quad([-halfW+t,halfH-t],[halfW-t,halfH-t],[halfW-t,halfH],[-halfW+t,halfH]);
    }
    for(const b of o.buildings) {
      if(b.ring.length<3)continue;
      counts.buildings++;
      const key=`${Math.floor(b.cx/(P*settings.chunkMeters))}:${Math.floor(b.cz/(P*settings.chunkMeters))}`;
      let c=chunks.get(key);
      if(!c) {
        c={key,level:0,ids:[],near:{p:[],c:[]},mid:{p:[],c:[]},bounds:{minX:Infinity,maxX:-Infinity,minZ:Infinity,maxZ:-Infinity,minY:base,maxY:base}};
        chunks.set(key,c);
      }
      c.ids.push(b.index);
      for(const [x,z] of b.ring){c.bounds.minX=Math.min(c.bounds.minX,x-.2);c.bounds.maxX=Math.max(c.bounds.maxX,x+.2);c.bounds.minZ=Math.min(c.bounds.minZ,z-.2);c.bounds.maxZ=Math.max(c.bounds.maxZ,z+.2);}
      c.bounds.maxY=Math.max(c.bounds.maxY,base+b.height+1);
      // Reuse exact old roof triangles rather than leaving a duplicate global roof.
      if(b.roofPositions.length) {
        c.mid.p.push(...b.roofPositions);c.mid.c.push(...b.roofColors);counts.reusedRoofBuildings++;
      }
      const edges=[];
      for(let i=0;i<b.ring.length;i++) {
        const a=b.ring[i],d=b.ring[(i+1)%b.ring.length],dx=d[0]-a[0],dz=d[1]-a[1],len=Math.hypot(dx,dz);
        if(len<6*P)continue;
        const mx=(a[0]+d[0])/2,mz=(a[1]+d[1])/2,ux=dx/len,uz=dz/len;
        let nx=-uz,nz=ux;
        if((mx-b.cx)*nx+(mz-b.cz)*nz<0){nx=-nx;nz=-nz;}
        // Concave boundaries: choose only genuinely outward-facing entrance edges.
        if(inside(mx+nx*.11,mz+nz*.11,b.ring))continue;
        edges.push({mx,mz,ux,uz,nx,nz,len});
      }
      edges.sort((a,b)=>b.len-a.len);
      for(const e of edges.slice(0,2)) {
        box(c.near,e.mx+e.nx*.09,base+.18*H,e.mz+e.nz*.09,e.len*.94,.36*H,.02,e.ux,e.uz,e.nx,e.nz,colors.stone);
        counts.baseBands++;
      }
      const e=edges[0],doorH=Math.min(2.6*H,b.height*.72);
      if(e && doorH>.16) {
        const x=e.mx+e.nx*.10,z=e.mz+e.nz*.10,w=Math.min(1.8*P,e.len*.26),y=base+doorH/2;
        box(c.near,x,y,z,w,doorH,.018,e.ux,e.uz,e.nx,e.nz,colors.glass);
        for(const side of [-1,1])box(c.near,x+e.ux*(w/2+.008)*side,y,z+e.uz*(w/2+.008)*side,.016,doorH+.02,.025,e.ux,e.uz,e.nx,e.nz,colors.trim);
        box(c.near,x,base+doorH+.016,z,w+.06,.032,.08,e.ux,e.uz,e.nx,e.nz,colors.trim);
        // Canopy slab and a shallow step, not a new podium/mass.
        box(c.near,x+e.nx*.025,base+doorH+.07,z+e.nz*.025,w+.10,.025,.12,e.ux,e.uz,e.nx,e.nz,colors.stone);
        box(c.near,x,base+.012,z,w+.06,.024,.09,e.ux,e.uz,e.nx,e.nz,colors.stone);
        counts.entrances++;
      }
      // Decorate at most four EXISTING lit-panel positions; no duplicate panes/lights.
      const windows=b.windows;
      for(let k=0;k<Math.min(4,windows.length);k++) {
        const w=windows[Math.floor(k*windows.length/Math.min(4,windows.length))];
        frame(c.near,w);counts.windowFrames++;
      }
      // Add one restrained rooftop unit only on roofs with NO existing equipment.
      const rw=2.2*P,rd=1.4*P;
      if(!b.roofPositions.length && inside(b.cx,b.cz,b.ring) && [[-1,-1],[-1,1],[1,-1],[1,1]].every(([x,z])=>inside(b.cx+x*rw*.6,b.cz+z*rd*.6,b.ring))) {
        const y=base+b.height+.45*H;
        box(c.near,b.cx,y,b.cz,rw,.9*H,rd,1,0,0,1,colors.roof);
        for(let k=-1;k<=1;k++)box(c.near,b.cx+k*rw*.25,y+.5*H,b.cz,.012,.012,rd*.8,1,0,0,1,colors.vent);
        counts.newRoofUnits++;
      }
    }
    template.dispose();
    const nearMaterial=new T.MeshStandardMaterial({vertexColors:true,roughness:.8,metalness:.12,side:T.DoubleSide,envMapIntensity:.25});
    const allMeshes=[];
    function mesh(arr,mat,name,shadow) {
      if(!arr.p.length)return null;
      const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(arr.p,3));geo.setAttribute('color',new T.Float32BufferAttribute(arr.c,3));geo.computeVertexNormals();geo.computeBoundingSphere();
      const m=new T.Mesh(geo,mat);m.name=name;m.visible=false;m.castShadow=shadow;m.receiveShadow=true;m.frustumCulled=true;
      // Hidden detail geometry still participates in the entry-point safety probe.
      m.userData.roamSpawnCheck=true;allMeshes.push(m);rootGroup.add(m);return m;
    }
    for(const c of chunks.values()) {
      c.midMesh=mesh(c.mid,o.roofMaterial,`ordinary-mid-${c.key}`,true);
      c.nearMesh=mesh(c.near,nearMaterial,`ordinary-near-${c.key}`,false);
      c.midTriangles=c.mid.p.length/9;c.nearTriangles=c.near.p.length/9;
      delete c.mid;delete c.near;
    }
    let last=-Infinity,updates=0;
    function update(position,now,force=false) {
      if(!force && now-last<settings.intervalMs)return false;
      last=now;updates++;
      for(const c of chunks.values()) {
        c.distanceMeters=distanceToBounds(position,c.bounds)/P;
        c.level=levelFor(c.level,c.distanceMeters,settings);
        if(c.midMesh)c.midMesh.visible=c.level>=1;
        if(c.nearMesh)c.nearMesh.visible=c.level===2;
      }
      return true;
    }
    function stats() {
      let near=0,mid=0,far=0,activeTriangles=0,activeMeshes=0,totalNear=0,totalMid=0,bytes=0;
      for(const c of chunks.values()) {
        if(c.level===2)near++;else if(c.level===1)mid++;else far++;
        totalNear+=c.nearTriangles;totalMid+=c.midTriangles;
        if(c.level>=1 && c.midMesh){activeTriangles+=c.midTriangles;activeMeshes++;}
        if(c.level===2 && c.nearMesh){activeTriangles+=c.nearTriangles;activeMeshes++;}
      }
      for(const m of allMeshes)for(const a of Object.values(m.geometry.attributes))bytes+=a.array.byteLength;
      return {...counts,chunks:chunks.size,nearChunks:near,midChunks:mid,farChunks:far,nearTriangles:totalNear,reusedMidTriangles:totalMid,cachedAttributeBytes:bytes,activeTriangleUpperBound:activeTriangles,activeMeshUpperBound:activeMeshes,updates,settings:{...settings},note:'Additional detail only; draw-call/triangle upper bounds exclude base city, frustum culling and shadow passes. Not FPS.'};
    }
    return {group:rootGroup,update,stats,debugChunks:()=>Array.from(chunks.values()).map(c=>({key:c.key,level:c.level,distanceMeters:c.distanceMeters,ids:c.ids.slice(),bounds:{...c.bounds},nearTriangles:c.nearTriangles,midTriangles:c.midTriangles}))};
  }
  const api={SETTINGS,levelFor,distanceToBounds,inside,build};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.YuehaiBuildingLOD=api;
})(typeof window!=='undefined'?window:globalThis);
