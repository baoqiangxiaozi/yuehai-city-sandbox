/* Three.js r128-compatible; no GLTFLoader, external requests or dependencies.
 * Include this file once, embed .inline.json as a JS object, then call
 * const asset = YuehaiLandmarks.create(THREE, DATA, {envMap: currentCityEnv});
 * buildingsGroup.add(asset.group); asset.setNight(amount); // 0..1
 * Do NOT scale the vertices again: root already applies PLAN/HS.
 */
(function(root) {
  'use strict';
  function typed(b64, Type) {
    var raw = atob(b64), bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Type(bytes.buffer);
  }
  function create(THREE, data, options) {
    options = options || {};
    if (data.format !== 'yuehai-inline-mesh-v1') throw new Error('Unsupported landmark geometry format');
    var group = new THREE.Group(), materials = {}, nightMeshes = [], pickMeshes = [];
    group.name = data.metadata.id + '-blender-refined';
    var origin = data.metadata.originRaw, scale = data.metadata.scale;
    group.position.set(origin[0] * scale[0], options.buildY == null ? .09 : options.buildY, origin[1] * scale[2]);
    group.scale.set(scale[0], scale[1], scale[2]);
    group.userData.customLandmarkId = data.metadata.id;
    Object.keys(data.materials).forEach(function(key) {
      var spec = data.materials[key];
      var mat = new THREE.MeshStandardMaterial({color: spec.color, metalness: spec.metalness, roughness: spec.roughness, envMap: options.envMap || null, envMapIntensity: 1});
      mat.name = data.metadata.id + '-' + key;
      mat.userData.surface = (key === 'metal' || key === 'bronze') ? 'metal' : key;
      // Opaque on both sides. Inverted winding was culling the wall and leaving
      // only the mullion cage, which reads as a see-through frame. This is not
      // the night-window layer and it does not turn the glass into a void.
      if (key === 'glass' || key === 'glass_alt' || key === 'white') {
        mat.side = THREE.DoubleSide;
        mat.transparent = false;
        mat.opacity = 1;
        mat.depthWrite = true;
      }
      if (spec.night) {
        mat.emissive = new THREE.Color(0xffbf72); mat.emissiveIntensity = 1.5;
        mat.transparent = true; mat.opacity = 0; mat.depthWrite = false;
      }
      materials[key] = mat;
    });
    var parts = data.meshes;
    // Seven material batches by default: fewer draws, same triangles/vertex normals.
    // Set mergeByMaterial:false to preserve every semantic node as a mesh.
    if (options.mergeByMaterial !== false) {
      var buckets = {};
      parts.forEach(function(part) {(buckets[part.material] || (buckets[part.material] = [])).push(part);});
      parts = Object.keys(buckets).map(function(key) {
        var list = buckets[key], p = [], n = [], ix = [], offset = 0;
        list.forEach(function(part) {
          var pp = typed(part.position, Float32Array), nn = typed(part.normal, part.normalType === 'int8' ? Int8Array : Float32Array);
          var ii = typed(part.index, part.indexType === 'uint16' ? Uint16Array : Uint32Array);
          for(var i=0;i<pp.length;i++) p.push(pp[i]);
          for(var j=0;j<nn.length;j++) n.push(part.normalType === 'int8' ? nn[j] : Math.round(nn[j]*127));
          for(var k=0;k<ii.length;k++) ix.push(ii[k]+offset);
          offset += pp.length/3;
        });
        return {name: key+' • '+list.map(function(x){return x.name;}).join(', '),material:key,night:key==='night',
          p:new Float32Array(p),n:new Int8Array(n),ix:new Uint32Array(ix)};
      });
    }
    parts.forEach(function(part) {
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(part.p || typed(part.position, Float32Array), 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(part.n || typed(part.normal, part.normalType === 'int8' ? Int8Array : Float32Array), 3, !!part.n || part.normalType === 'int8'));
      geo.setIndex(new THREE.BufferAttribute(part.ix || typed(part.index, part.indexType === 'uint16' ? Uint16Array : Uint32Array), 1));
      geo.computeBoundingBox(); geo.computeBoundingSphere();
      var mesh = new THREE.Mesh(geo, materials[part.material]); mesh.name = part.name;
      mesh.userData.customLandmarkId = data.metadata.id;
      mesh.userData.landmarkAssetRole = part.name;
      mesh.castShadow = !part.night; mesh.receiveShadow = !part.night;
      group.add(mesh);
      if (part.night) { mesh.visible = false; nightMeshes.push(mesh); }
      else pickMeshes.push(mesh);
    });
    function setNight(power) {
      power = Math.max(0, Math.min(1, power));
      if (materials.night) {materials.night.opacity = power; materials.night.emissiveIntensity = 1.5 + power;}
      nightMeshes.forEach(function(mesh) {mesh.visible = power > .001;});
    }
    return {group: group, materials: materials, nightMeshes: nightMeshes, pickMeshes: pickMeshes, setNight: setNight};
  }
  root.YuehaiLandmarks = {create: create};
})(typeof window !== 'undefined' ? window : globalThis);
