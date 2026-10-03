// Main menu page logic: mockups/main-menu.html (and the archived ai-slop/main-menu.html).
// Each page supplies its own markup and stylesheet; this module only needs the element ids
// (rig, rigdesc, disc, toGame, toExplorer, rigstrip, health, search, nav, center, ledger, ledCount,
// inspector, inspTag, back, export, fstat, applySum, applyBtn, revertAll, layer).
import { evaluate, fromV2, toV2, estimate, TIER_LABEL } from './engine.js';
import { loadAll } from './data.js';
import { renderCard, renderLedger, renderInspector, estTiles, tierBadge, esc, enc, dec, fmt, cssId } from './ui.js';

const { bundle, v2, rigs, rigIds } = await loadAll();
const params = new URLSearchParams(location.search);
const S = {
  rigId: rigIds.includes(params.get('rig')) ? params.get('rig') : rigIds[0],
  disclosure: params.get('detail') ?? 'advanced',
  group: params.get('group') ?? 'system',
  pending: [], focus: null, hover: null, search: '',
};
let base, facts, vm;
const $ = id => document.getElementById(id);
const DISC = { basic: 0, advanced: 1, expert: 2 };

function loadRig(id) {
  S.rigId = id; facts = rigs[id];
  // Load-time evaluation: R12 adjustments become part of what is applied, and are listed under "Adjusted for this PC".
  const vm0 = evaluate({ bundle, facts, base: fromV2(v2, facts, bundle) });
  base = vm0.cfg;
  S.loadAdjustments = vm0.ledger.system;
  S.pending = []; S.focus = null; S.hover = null;
}

function setValue(path, value) {
  S.pending = S.pending.filter(p => p.path !== path);
  if (value !== base[path]) S.pending.push({ path, value });
  S.focus = path;
  render();
}

function compute() {
  vm = evaluate({ bundle, facts, base, pending: S.pending, context: { session: 'menu', online: false }, disclosure: S.disclosure });
}

// ---------- rendering ----------
function render() {
  compute();
  renderDev(); renderHeader(); renderNav(); renderCenter(); renderRight(); renderFooter();
}

function renderDev() {
  $('rig').innerHTML = rigIds.map(id => `<option value="${id}" ${id === S.rigId ? 'selected' : ''}>${esc(rigs[id].label)}</option>`).join('');
  $('rigdesc').textContent = facts.description;
  $('disc').innerHTML = ['basic', 'advanced', 'expert'].map(d => `<button class="${d === S.disclosure ? 'on' : ''}" data-disc="${d}">${d}</button>`).join('');
  withQuery($('toGame'), `rig=${S.rigId}`);
  withQuery($('toExplorer'), `rig=${S.rigId}&detail=${S.disclosure}`);
}

// Keeps the link's own path (it differs per page) and replaces only the query.
function withQuery(a, query) {
  const u = new URL(a.getAttribute('href'), location.href);
  u.search = query;
  a.href = u.href;
}

function renderHeader() {
  const d = vm.der;
  $('rigstrip').innerHTML = `
    <span class="pill"><span class="ms">memory</span>${esc(facts.gpu.name)} · ${facts.gpu.vramGB} GB</span>
    <span class="pill"><span class="ms">${d.scope === 'hmd' ? 'eyeglasses' : d.scope === 'triple' ? 'view_week' : 'monitor'}</span>${esc(d.outputLabel)}</span>
    <span class="pill"><span class="ms">speed</span>${vm.est.presentedFps} fps est.</span>`;
  const worst = vm.insights.some(i => i.severity === 'critical') ? 'critical' : vm.insights.some(i => i.severity === 'warn') ? 'warn' : 'ok';
  const n = vm.insights.length;
  $('health').className = `pill health ${worst}`;
  $('health').innerHTML = `<span class="ms">${worst === 'ok' ? 'check_circle' : 'health_and_safety'}</span>${n ? `${n} insight${n > 1 ? 's' : ''}` : 'Healthy'}`;
}

function groupStats(gid) {
  const fs = Object.values(vm.fields).filter(f => f.group === gid);
  const visible = fs.filter(f => f.visible && !f.disclosureHidden);
  return { fs, visible };
}

function pendingByGroup() {
  const counts = {};
  for (const e of vm.ledger.entries) {
    for (const p of [e.path, ...e.children.map(c => c.path)]) {
      const g = bundle.ui.fields[p]?.group; if (g) counts[g] = (counts[g] ?? 0) + 1;
    }
  }
  return counts;
}

function renderNav() {
  const counts = pendingByGroup();
  const worst = vm.insights.some(i => i.severity === 'critical') ? 'var(--rebuild)' : vm.insights.some(i => i.severity === 'warn') ? 'var(--warn)' : vm.insights.length ? 'var(--info)' : 'var(--live)';
  let html = `<button class="nav-i ${S.group === 'system' && !S.search ? 'on' : ''}" data-group="system"><span class="ms">health_and_safety</span>System &amp; health<span class="sev" style="background:${worst}"></span></button>
    <div class="nav-h">Settings</div>`;
  for (const g of bundle.ui.groups) {
    const { visible } = groupStats(g.id);
    if (!visible.length) continue; // R7: groups with nothing applicable disappear
    html += `<button class="nav-i ${S.group === g.id && !S.search ? 'on' : ''}" data-group="${g.id}"><span class="ms">${g.icon}</span>${esc(g.label)}${counts[g.id] ? `<span class="cnt">${counts[g.id]}</span>` : ''}</button>`;
  }
  html += `<div class="disc"><div class="nav-h">Legend</div>
    <div style="display:flex;flex-direction:column;gap:5px">${tierBadge(3)}${tierBadge(2)}${tierBadge(1)}
    <span class="badge b-implied"><span class="ms">auto_mode</span>Auto (implied)</span><span class="badge b-lock"><span class="ms">lock</span>Locked by dependency</span><span class="badge b-warn"><span class="ms">warning</span>Needs Windows fix</span><span class="badge b-proposed">v4 proposal</span></div></div>`;
  $('nav').innerHTML = html;
}

// A page can set window.cardIcon = field => icon name to give setting cards a header icon.
const ctx = () => ({ bundle, vm, focus: S.focus, disclosure: S.disclosure, icon: window.cardIcon });

function renderCenter() {
  const el = $('center');
  const top = el.scrollTop;
  if (S.search) el.innerHTML = renderSearch();
  else if (S.group === 'system') el.innerHTML = renderSystem();
  else el.innerHTML = renderGroup(S.group);
  el.scrollTop = top;
}

function renderGroup(gid) {
  const g = bundle.ui.groups.find(x => x.id === gid);
  const { fs } = groupStats(gid);
  const byScope = fs.filter(f => !f.visible && f.hiddenKind === 'scope').length;
  const byHw = fs.filter(f => !f.visible && f.hiddenKind === 'hw').length;
  const byDisc = fs.filter(f => f.visible && f.disclosureHidden).length;
  const notes = [];
  if (byScope) notes.push(`<span class="badge b-also">${byScope} hidden: not used in ${esc(scopeName())}</span>`);
  if (byHw) notes.push(`<span class="badge b-also">${byHw} hidden: not supported by this PC</span>`);
  if (byDisc) notes.push(`<span class="badge b-also">${byDisc} more at a higher detail level</span>`);
  let html = `<div class="group-h"><h1>${esc(g.label)}</h1></div><div class="ctxnote">${notes.join('') || '<span class="note">Showing everything that applies to this PC.</span>'}</div>`;
  for (const s of g.sections) {
    const cards = fs.filter(f => f.section === s.id && f.visible && !f.disclosureHidden);
    if (!cards.length) continue;
    const why = s.id === 'triple' ? 'shown because Display mode = Triple' : s.id === 'vr' || s.id === 'vrcomfort' ? 'shown because Display mode = VR' : '';
    html += `<div class="sec"><div class="sec-h"><h2>${esc(s.label)}</h2>${why ? `<span class="why">${why}</span>` : ''}</div><div class="cards">${cards.map(f => renderCard(f, ctx())).join('')}</div></div>`;
  }
  return html;
}

function scopeName() { return { single: 'Single screen', triple: 'Triple screen', hmd: 'VR' }[vm.der.scope]; }

function renderSearch() {
  const q = S.search.toLowerCase();
  const hits = Object.values(vm.fields).filter(f => (f.label + ' ' + (f.help ?? '') + ' ' + f.path).toLowerCase().includes(q));
  const shown = hits.filter(f => f.visible);
  const hidden = hits.filter(f => !f.visible && f.hiddenKind !== 'conditional');
  return `<div class="group-h"><h1>Search</h1></div><div class="ctxnote">${shown.length} result${shown.length === 1 ? '' : 's'} for “${esc(S.search)}”</div>
    <div class="cards">${shown.map(f => renderCard(f, ctx())).join('')}</div>
    ${hidden.length ? `<div class="sec" style="margin-top:18px"><div class="sec-h"><h2>Not shown on this PC</h2></div>${hidden.map(f => `<div class="more"><b>${esc(f.label)}</b> — ${esc(f.hiddenKind === 'scope' ? `only used in ${bundle.ui.fields[f.path].scope.join('/')} mode` : f.reason ?? 'not applicable')}</div>`).join('')}</div>` : ''}`;
}

function renderSystem() {
  const d = vm.der, os = facts.os, cpu = facts.cpu;
  const cpuBits = [`${cpu.cores}C/${cpu.threads}T`];
  if (cpu.ccds === 2) cpuBits.push('dual-CCD'); if (cpu.x3dCcd != null) cpuBits.push(`3D V-Cache on CCD${cpu.x3dCcd}`); if (cpu.hybrid) cpuBits.push(`${cpu.hybrid.pCores}P + ${cpu.hybrid.eCores}E`);
  const checks = [];
  const c = (state, t, v, desc) => checks.push({ state, t, v, desc });
  const needsHags = facts.sdk.dlss_g?.supported;
  c(os.hags ? 'ok' : needsHags ? 'warn' : 'info', 'Hardware-accelerated GPU scheduling', os.hags ? 'On' : 'Off', needsHags ? 'Required for DLSS Frame Generation.' : 'Not required by any frame-generation technology on this GPU.');
  c(d.vrr ? 'ok' : 'info', 'Variable refresh rate', d.vrr ? `On · up to ${d.refreshHz} Hz` : 'Off / not available', 'Lets the display follow the game\'s frame rate. Affects V-Sync and frame-cap advice.');
  if (d.hdrDisplay || os.autoHdr) c(os.autoHdr ? 'info' : 'ok', 'Windows Auto HDR', os.autoHdr ? 'On' : 'Off', os.autoHdr ? 'Windows converts this game\'s SDR output to HDR. Exposure previews may look different.' : 'Game output stays SDR.');
  c(os.gameMode ? 'ok' : (cpu.hybrid || cpu.ccds === 2) ? 'warn' : 'info', 'Game Mode', os.gameMode ? 'On' : 'Off', cpu.ccds === 2 ? 'Needed on dual-CCD X3D CPUs to keep game threads on the cache CCD.' : cpu.hybrid ? 'Helps keep game threads on P-cores.' : 'Gives the game scheduling priority.');
  c(os.windowedOptimizations ? 'ok' : 'info', 'Optimizations for windowed games', os.windowedOptimizations ? 'On' : 'Off', 'Gives borderless mode flip-model latency.');
  c(os.powerSource === 'ac' ? 'ok' : 'warn', 'Power', os.powerSource === 'ac' ? `AC · ${os.powerPlan}` : `Battery · ${os.powerPlan}`, os.powerSource === 'ac' ? 'Full power available.' : 'CPU and GPU are power-limited.');
  if (cpu.ccds === 2 && cpu.x3dCcd != null) c(cpu.gameThreadsOnCacheCcd ? 'ok' : 'warn', 'Thread affinity (X3D)', cpu.gameThreadsOnCacheCcd ? 'Cache CCD' : 'Non-cache CCD', 'Sampled scheduling of the game\'s main threads.');
  const icon = { ok: ['check_circle', 'ok-c'], warn: ['warning', 'warn-c'], info: ['info', 'info-c'] };

  const concepts = [['Upscaling', 'graphics.upscaling.provider'], ['Frame generation', 'graphics.frame_generation.provider'], ['Latency reduction', 'graphics.latency.mode']];
  const techRows = concepts.map(([label, path]) => {
    const f = vm.fields[path];
    const cells = (f.options ?? []).filter(o => o.value !== 'off').map(o => {
      const active = o.value === f.value;
      const s = o.status === 'hidden' ? ['none', 'Not supported', 'dim-c'] : o.status === 'blocked' ? ['', 'Blocked · fixable', 'warn-c'] : o.status === 'locked' ? ['', o.reason, 'dim-c'] : active ? ['active', 'Active', 'ok-c'] : [o.tag === 'Recommended' ? '' : '', o.tag ?? 'Available', o.tag === 'Recommended' ? 'ok-c' : 'info-c'];
      return `<span class="tstat ${s[0]}" ${o.status !== 'hidden' ? `data-goto="${path}" style="cursor:pointer"` : ''}><span class="n">${esc(o.short ?? o.label)}</span><span class="s ${s[2]}">${esc(s[1])}</span></span>`;
    }).join('');
    return `<tr><td>${label}</td><td>${cells}</td></tr>`;
  }).join('');

  const sevIcon = { critical: ['error', 'crit-c'], warn: ['warning', 'warn-c'], info: ['lightbulb', 'info-c'] };
  const insights = vm.insights.map((i, n) => `<div class="ins"><span class="ms ${sevIcon[i.severity][1]}">${sevIcon[i.severity][0]}</span>
    <div><div class="t">${esc(i.title)}</div><div class="d">${esc(i.detail)}</div></div>
    <div>${i.action ? i.action.type === 'link' ? `<a class="btn" href="${esc(i.action.url)}">${esc(i.action.label)}</a>` : `<button class="btn" data-insight="${n}">${esc(i.action.label)}</button>` : ''}</div></div>`).join('');

  return `<div class="group-h"><h1>System &amp; health</h1></div>
    <div class="ctxnote">What the game detected on this PC, and what that means for the settings it offers.</div>
    <div class="sys-grid">
      <div class="box"><h3><span class="ms">memory</span>Graphics</h3><div class="rig-name">${esc(facts.gpu.name)}</div><div class="rig-sub">${esc(facts.gpu.arch)} · ${facts.gpu.vramGB} GB VRAM · driver ${esc(facts.gpu.driver)}<br>DXR ${esc(facts.gpu.dxr)} · ${facts.gpu.mobile ? 'Laptop GPU' : 'Desktop GPU'} · ${facts.telemetry.gpuTempC} °C · ${facts.telemetry.gpuUtil}% util</div></div>
      <div class="box"><h3><span class="ms">monitor</span>Display</h3><div class="rig-name">${esc(d.outputLabel)}</div><div class="rig-sub">${facts.display.monitors.map(m => `${esc(m.name)} · ${m.width}×${m.height} @ ${m.refreshHz} Hz${m.vrr ? ' · VRR' : ''}${m.hdr ? ' · HDR' : ''}`).join('<br>')}${facts.vr?.connected ? `<br>${esc(facts.vr.hmd)} via ${esc(facts.vr.runtime)} · ${facts.vr.refreshHz} Hz` : ''}</div></div>
      <div class="box"><h3><span class="ms">developer_board</span>Processor</h3><div class="rig-name">${esc(cpu.name)}</div><div class="rig-sub">${cpuBits.join(' · ')}</div></div>
    </div>
    <div class="sec"><div class="sec-h"><h2>Active pipeline</h2><span class="why">what's running now, including pending changes</span></div>
      <div class="box"><div class="pipeline">${vm.fields['display.render_resolution'].readouts.map(r => `<div>${esc(r.text)}</div>`).join('')}</div><div style="margin-top:12px">${estTiles(vm.est)}</div></div></div>
    <div class="sec"><div class="sec-h"><h2>Insights</h2><span class="why">${vm.insights.length} for this PC</span></div><div class="box">${insights || '<div class="note">Nothing to flag. Settings and system look healthy.</div>'}</div></div>
    <div class="sec"><div class="sec-h"><h2>Technologies on this PC</h2><span class="why">vendor features grouped by what they do</span></div>
      <div class="box"><table class="tech"><thead><tr><th>Concept</th><th>Providers</th></tr></thead><tbody>${techRows}</tbody></table></div></div>
    <div class="sec"><div class="sec-h"><h2>Windows &amp; CPU checks</h2></div><div class="box">${checks.map(k => `<div class="check"><span class="ms ${icon[k.state][1]}">${icon[k.state][0]}</span><div><div class="t">${esc(k.t)}</div><div class="d">${esc(k.desc)}</div></div><div class="v">${esc(k.v)}</div></div>`).join('')}</div></div>
    <details class="unav"><summary>Not available on this PC (${vm.unavailable.length})</summary><ul>${vm.unavailable.map(u => `<li><b>${esc(u.label)}</b> <span>— ${esc(u.reason)}</span></li>`).join('')}</ul></details>`;
}

function renderRight() {
  const n = vm.ledger.changeCount;
  $('ledCount').innerHTML = n ? `<span class="badge b-pending">${n}</span>` : '';
  const baseEst = estimate(evaluate({ bundle, facts, base, pending: [] }).cfg, facts, bundle);
  $('ledger').innerHTML = renderLedger(vm, ctx(), { baseEst, system: [...S.loadAdjustments, ...vm.ledger.system] });
  $('inspector').innerHTML = renderInspector(vm, S.focus, S.hover, ctx());
  $('inspTag').textContent = S.focus ?? '';
}

function renderFooter() {
  const t = vm.ledger.applyTier, n = vm.ledger.changeCount;
  const staged = vm.ledger.entries.some(e => e.tier !== 3 || e.children.some(c => c.tier !== 3));
  const cost = { 1: 'renderer rebuild (~2 s)', 2: 'quick reload (<1 s)', 3: 'already live', R: 'restart' }[t];
  $('applySum').innerHTML = n ? `<b>${n} change${n > 1 ? 's' : ''}</b><br>${tierBadge(t)} ${cost}` : 'No pending changes';
  $('applyBtn').disabled = !n;
  $('applyBtn').textContent = staged ? 'Apply changes' : n ? 'Keep changes' : 'Apply';
  $('fstat').innerHTML = `<span>${esc(facts.gpu.name)}</span><span>•</span><span>VRAM ≈ ${vm.est.vramGB} / ${facts.gpu.vramGB} GB</span><span>•</span><span>${facts.telemetry.gpuTempC} °C</span><span>•</span><span>${vm.est.presentedFps} fps est.</span>`;
}

// ---------- apply flow (R9, R10) ----------
function toast(html, ms = 1200) {
  const el = document.createElement('div');
  el.className = 'toast'; el.innerHTML = html; document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}
async function apply() {
  const t = vm.ledger.applyTier;
  const prevBase = base;
  const touchesDisplay = vm.ledger.entries.some(e => e.tier === 1 && [e.path, ...e.children.map(c => c.path)].some(p => p.startsWith('display.') || p.startsWith('vr.')));
  if (t === 1) {
    $('layer').innerHTML = `<div class="overlay"><div class="modal" style="text-align:center"><div class="spinner lg"></div><h3>Rebuilding renderer</h3><p>Recreating swapchain, pipeline states and samplers…</p></div></div>`;
    await new Promise(r => setTimeout(r, 1500));
    $('layer').innerHTML = '';
  } else if (t === 2) {
    toast('<span class="spinner"></span>Reconfiguring features…', 900);
    await new Promise(r => setTimeout(r, 700));
  }
  base = { ...vm.cfg };
  S.pending = []; S.loadAdjustments = [];
  render();
  if (touchesDisplay) keepRevert(prevBase);
  else toast('<span class="ms">check_circle</span>Settings applied', 1400);
}
function keepRevert(prevBase) {
  let left = 15;
  const draw = () => { $('layer').innerHTML = `<div class="overlay"><div class="modal"><h3>Keep these display settings?</h3><p>The display changed. If you can't see this clearly, it reverts automatically.</p><div class="countdown">${left}s</div><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" id="kr-revert">Revert</button><button class="btn btn-primary" id="kr-keep">Keep</button></div></div></div>`; };
  draw();
  const timer = setInterval(() => { left--; if (left <= 0) { done(false); } else draw(); }, 1000);
  const done = keep => { clearInterval(timer); $('layer').innerHTML = ''; if (!keep) { base = prevBase; render(); toast('<span class="ms">undo</span>Reverted to previous display settings'); } else toast('<span class="ms">check_circle</span>Display settings kept'); };
  $('layer').onclick = e => { if (e.target.id === 'kr-keep') done(true); if (e.target.id === 'kr-revert') done(false); };
}
function exportCfg() {
  const orig = toV2(base, v2, bundle), next = toV2(vm.cfg, v2, bundle);
  const diffs = [];
  const walk = (a, b, p) => {
    for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])) {
      const pa = a?.[k], pb = b?.[k], path = p ? `${p}.${k}` : k;
      if (pa && typeof pa === 'object' && !Array.isArray(pa)) walk(pa, pb, path);
      else if (JSON.stringify(pa) !== JSON.stringify(pb)) diffs.push(`${path}: ${JSON.stringify(pa)} → ${JSON.stringify(pb)}`);
    }
  };
  walk(orig, next, '');
  $('layer').innerHTML = `<div class="overlay"><div class="modal" style="width:min(720px,94vw)"><h3>Export (v2 config)</h3><p>Pending changes written back to the format the engine reads today (<span class="mono">toV2</span>).</p><pre class="diff">${esc(diffs.join('\n') || 'No differences from the applied config.')}</pre><div style="display:flex;justify-content:flex-end"><button class="btn" id="exp-close">Close</button></div></div></div>`;
  $('layer').onclick = e => { if (e.target.id === 'exp-close' || e.target.classList.contains('overlay')) $('layer').innerHTML = ''; };
}

// ---------- events ----------
function gotoField(path) {
  const f = vm.fields[path];
  if (!f) return;
  S.search = ''; $('search').value = '';
  if (f.disclosureHidden) S.disclosure = bundle.ui.fields[path].disclosure;
  S.group = f.group; S.focus = path;
  render();
  document.getElementById(`card-${cssId(path)}`)?.scrollIntoView({ block: 'center' });
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-set],[data-goto],[data-revert],[data-group],[data-disc],[data-insight],[data-focus]');
  if (!t) return;
  if (t.dataset.goto) { e.stopPropagation(); return gotoField(t.dataset.goto); }
  if (t.dataset.set) return setValue(t.dataset.set, dec(t.dataset.value));
  if (t.dataset.revert) { S.pending = S.pending.filter(p => p.path !== t.dataset.revert); return render(); }
  if (t.dataset.group) { S.group = t.dataset.group; S.search = ''; $('search').value = ''; $('center').scrollTop = 0; return render(); }
  if (t.dataset.disc) { S.disclosure = t.dataset.disc; return render(); }
  if (t.dataset.insight) {
    const a = vm.insights[Number(t.dataset.insight)].action;
    if (a.type === 'stage') { for (const [p, v] of Object.entries(a.changes)) { S.pending = S.pending.filter(x => x.path !== p); if (v !== base[p]) S.pending.push({ path: p, value: v }); } S.focus = Object.keys(a.changes)[0]; render(); toast('<span class="ms">playlist_add</span>Added to pending changes'); }
    if (a.type === 'focus') gotoField(a.path);
    return;
  }
  if (t.dataset.focus && S.focus !== t.dataset.focus && !e.target.closest('a')) { S.focus = t.dataset.focus; S.hover = null; renderRight(); document.querySelectorAll('.card.is-focus').forEach(c => c.classList.remove('is-focus')); t.classList.add('is-focus'); }
});
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-hover]');
  const next = t ? { path: t.dataset.hover, value: dec(t.dataset.value) } : null;
  if (JSON.stringify(next) === JSON.stringify(S.hover)) return;
  S.hover = next;
  if (next) S.focus = next.path;
  $('inspector').innerHTML = renderInspector(vm, S.focus, S.hover, ctx());
  $('inspTag').textContent = S.focus ?? '';
});
document.addEventListener('input', e => {
  if (e.target.dataset.slider) {
    const path = e.target.dataset.slider;
    e.target.nextElementSibling.textContent = fmt(path, Number(e.target.value), ctx());
  }
  if (e.target.id === 'search') { S.search = e.target.value.trim(); renderNav(); renderCenter(); }
});
document.addEventListener('change', e => {
  if (e.target.dataset.slider) setValue(e.target.dataset.slider, Number(e.target.value));
  if (e.target.dataset.select) setValue(e.target.dataset.select, dec(e.target.value));
  if (e.target.id === 'rig') { loadRig(e.target.value); history.replaceState(null, '', `?rig=${S.rigId}`); render(); }
});
document.addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); $('search').focus(); }
  if (e.key === 'Escape' && document.activeElement.id === 'search') { $('search').value = ''; S.search = ''; renderNav(); renderCenter(); $('search').blur(); }
});
$('applyBtn').onclick = apply;
$('revertAll').onclick = () => { S.pending = []; render(); };
$('export').onclick = exportCfg;
$('back').onclick = () => toast(vm.ledger.changeCount ? 'You have pending changes. Apply or revert them first.' : 'Back to main menu');
$('health').onclick = () => { S.group = 'system'; S.search = ''; render(); };

loadRig(S.rigId);
render();
if (params.get('field')) gotoField(params.get('field'));
window.__mock = { get vm() { return vm; }, S, setValue, gotoField };
