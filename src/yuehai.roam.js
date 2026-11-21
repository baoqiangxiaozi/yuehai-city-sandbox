/* First-person free roaming. No pointer lock, no collision/terrain physics. */
(function (root) {
  'use strict';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const CODES = new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight']);
  // THREE camera at yaw=0 faces -Z. Normalize diagonals and ignore pitch for movement.
  function step(pos, yaw, forward, right, boost, dt, plan, bounds) {
    const n = Math.hypot(forward, right);
    const distance = 12 * plan * (boost ? 4 : 1) * clamp(Number.isFinite(dt) ? dt : 0, 0, .05);
    if (!n) return { x: pos.x, z: pos.z, boundary: false };
    const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) / n * distance;
    const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) / n * distance;
    const x = clamp(pos.x + dx, bounds.minX, bounds.maxX);
    const z = clamp(pos.z + dz, bounds.minZ, bounds.maxZ);
    return { x, z, boundary: x !== pos.x + dx || z !== pos.z + dz };
  }
  function create(o) {
    const { canvas, camera, hud, pad, status } = o;
    const doc = o.document || document, win = o.window || window;
    const keys = new Set(), touches = new Map();
    let active = false, drag = null, yaw = 0, pitch = 0, spawn = null;
    function clearLook() {
      const id = drag && drag.id;
      drag = null;
      canvas.classList.remove('is-grabbing');
      if (id != null && canvas.hasPointerCapture && canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    }
    function clearInput() { keys.clear(); touches.clear(); clearLook(); }
    function updateView() {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      camera.position.y = o.eyeY;
    }
    function reset() {
      if (!active || !spawn) return;
      clearInput();
      camera.position.set(spawn.x, o.eyeY, spawn.z);
      yaw = spawn.yaw; pitch = 0;
      updateView(); status.textContent = '已复位 · 拖动画面转向';
    }
    function enter() {
      if (active) return;
      // Validate the actual built scene at road samples before switching cameras.
      spawn = o.getSpawn();
      if (!spawn) { o.onUnavailable(); return; }
      o.onEnter();
      active = true;
      hud.hidden = false; pad.hidden = false;
      doc.body.classList.add('is-roaming');
      reset();
      o.exitButton.focus({ preventScroll: true });
    }
    function exit(overview) {
      if (!active) return;
      clearInput(); active = false;
      hud.hidden = true; pad.hidden = true;
      doc.body.classList.remove('is-roaming');
      o.onExit(!!overview);
      o.entryButton.focus({ preventScroll: true });
    }
    function update(dt) {
      if (!active) return;
      if (doc.hidden) { clearInput(); return; }
      const dirs = new Set(touches.values());
      const f = Number(keys.has('KeyW') || keys.has('ArrowUp') || dirs.has('forward')) - Number(keys.has('KeyS') || keys.has('ArrowDown') || dirs.has('back'));
      const r = Number(keys.has('KeyD') || keys.has('ArrowRight') || dirs.has('right')) - Number(keys.has('KeyA') || keys.has('ArrowLeft') || dirs.has('left'));
      const pos = step(camera.position, yaw, f, r, keys.has('ShiftLeft') || keys.has('ShiftRight'), dt, o.plan, o.bounds);
      camera.position.x = pos.x; camera.position.z = pos.z;
      updateView();
      status.textContent = pos.boundary ? '已到地图边界 · R 复位 / 返回总览' : drag ? '拖动转向中' : '自由漫游 · 拖动画面转向';
      o.onMove(camera.position);
    }
    function editable(el) { return el && (['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.isContentEditable); }
    win.addEventListener('keydown', (e) => {
      if (!active) return;
      if (e.code === 'Escape' || e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation(); exit(false); return;
      }
      if (editable(e.target)) { clearInput(); return; }
      if (!CODES.has(e.code) && e.code !== 'KeyR') return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.code === 'KeyR') { if (!e.repeat) reset(); return; }
      // A held key must be released/re-pressed after blur/reset before movement resumes.
      if (!e.repeat || keys.has(e.code)) keys.add(e.code);
    }, true);
    win.addEventListener('keyup', (e) => {
      keys.delete(e.code);
      if (active && CODES.has(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
    win.addEventListener('blur', clearInput);
    doc.addEventListener('visibilitychange', clearInput);
    doc.addEventListener('focusin', (e) => { if (active && editable(e.target)) clearInput(); });
    canvas.addEventListener('pointerdown', (e) => {
      if (!active || e.button !== 0 || drag) return;
      e.preventDefault();
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* window up/cancel still clears */ }
      canvas.classList.add('is-grabbing');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!active || !drag || e.pointerId !== drag.id) return;
      // Cap one event's motion to avoid a huge turn on focus/edge transitions.
      const dx = clamp(e.clientX - drag.x, -150, 150), dy = clamp(e.clientY - drag.y, -150, 150);
      drag.x = e.clientX; drag.y = e.clientY;
      yaw -= dx * .003;
      yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      pitch = clamp(pitch - dy * .003, -1.25, 1.25);
      updateView();
    });
    function endPointer(e) {
      touches.delete(e.pointerId);
      if (drag && drag.id === e.pointerId) clearLook();
    }
    win.addEventListener('pointerup', endPointer);
    win.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('lostpointercapture', endPointer);
    pad.querySelectorAll('[data-roam-dir]').forEach((button) => {
      button.addEventListener('pointerdown', (e) => {
        if (!active || e.button !== 0) return;
        e.preventDefault(); touches.set(e.pointerId, button.dataset.roamDir);
        try { button.setPointerCapture(e.pointerId); } catch (_) { /* window up/cancel fallback */ }
      });
      button.addEventListener('lostpointercapture', endPointer);
    });
    o.entryButton.addEventListener('click', enter);
    o.exitButton.addEventListener('click', () => exit(false));
    o.overviewButton.addEventListener('click', () => exit(true));
    o.resetButton.addEventListener('click', reset);
    return { enter, exit, update, reset, clearInput, get active() { return active; } };
  }
  const api = { step, create };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.YuehaiRoam = api;
})(typeof window !== 'undefined' ? window : globalThis);
