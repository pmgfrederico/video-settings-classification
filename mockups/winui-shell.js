// Shared by the WinUI pages (main-menu.html, in-game.html). A classic script, loaded in <head>:
// it applies the saved theme before first paint, defines the SettingsCard icons, and fills the
// mockup bar's theme switch (#theme) once the page has loaded.

// Theme override for the mockup (System / Light / Dark). Remembered per browser when storage is available.
try { const t = localStorage.getItem('winui-theme'); if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t; } catch {}

// SettingsCard header icons, one per section (the schema has group icons only). Read by ui.js renderCard via ctx.icon.
window.cardIcon = f => ({
  mode: 'display_settings', monitor: 'monitor', triple: 'view_week', vr: 'eyeglasses',
  resolution: 'aspect_ratio', upscaling: 'auto_fix_high', framegen: 'animation', latency: 'timer', pacing: 'speed',
  preset: 'tune', aa: 'deblur', textures: 'texture',
  distance: 'straighten', lod: 'filter_hdr', lighting: 'light_mode', reflections: 'flare', atmosphere: 'cloud', vegetation: 'park',
  mirrors: 'flip', vehicle: 'directions_car', visibility: 'visibility', cockpit: 'speed',
  grading: 'palette', camera: 'videocam', vrcomfort: 'self_improvement',
})[f.section] ?? 'settings';

addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('theme');
  if (!el) return;
  const draw = () => {
    const cur = document.documentElement.dataset.theme ?? 'system';
    el.innerHTML = ['system', 'light', 'dark'].map(t => `<button class="${t === cur ? 'on' : ''}" data-theme-pick="${t}">${t}</button>`).join('');
  };
  el.addEventListener('click', e => {
    const t = e.target.closest('[data-theme-pick]')?.dataset.themePick;
    if (!t) return;
    if (t === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
    try { localStorage.setItem('winui-theme', t); } catch {}
    draw();
  });
  draw();
});
