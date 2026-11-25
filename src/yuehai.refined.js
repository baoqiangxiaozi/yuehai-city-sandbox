/* Integration policy for offline Blender landmark batches (Three.js r128). */
(function(root){
  'use strict';
  function create(THREE,datasets,o) {
    const loader=o.loader||root.YuehaiLandmarks;
    const assets=datasets.map(data=>{
      const a=loader.create(THREE,data,{envMap:o.envMap,buildY:o.buildY});
      a.metadata=data.metadata;
      // Do not let the legacy all-scene material pass overwrite authored PBR values.
      for(const m of Object.values(a.materials))m.userData.blenderRefined=true;
      o.parent.add(a.group);return a;
    });
    function setNight(power,enabled=true){for(const a of assets)a.setNight(enabled?power:0);}
    function setEnvironment(env,mode){
      for(const a of assets)for(const [key,mat]of Object.entries(a.materials)) {
        const want=mode==='all'||(mode==='glass'&&key.startsWith('glass'));
        const next=want?env:null;
        if(!!mat.envMap!==!!next)mat.needsUpdate=true;
        mat.envMap=next;
        // glass_tower is the pale Tencent shaft. A full-strength city reflection
        // pulls that face back toward black. Other glass keeps the darker look.
        mat.envMapIntensity=key==='glass_tower'?0.12:key.startsWith('glass')?1.2:(key==='metal'||key==='bronze')?1:.25;
      }
    }
    function stats(){return assets.map(a=>({id:a.metadata.id,originRaw:a.metadata.originRaw.slice(),scale:a.group.scale.toArray(),meshCount:a.group.children.length,
      visibleMeshes:a.group.children.filter(m=>m.visible).length,pickMeshes:a.pickMeshes.length,
      triangles:a.group.children.reduce((n,m)=>n+(m.geometry.index?m.geometry.index.count:m.geometry.attributes.position.count)/3,0)}));}
    return {assets,setNight,setEnvironment,stats};
  }
  const api={create};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.YuehaiRefined=api;
})(typeof window!=='undefined'?window:globalThis);
