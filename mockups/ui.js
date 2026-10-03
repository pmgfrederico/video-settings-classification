// Shared renderers for setting cards, the change ledger and the inspector.
// Interaction is wired by the pages through event delegation on these data attributes:
//   data-set="<path>" data-value="<json>"   choose an option / toggle
//   data-slider="<path>"                     range input (input = preview, change = commit)
//   data-select="<path>"                     <select>
//   data-focus="<path>"                      focus the inspector on a field
//   data-goto="<path>"                       navigate to a field (its group) and focus it
//   data-revert="<path>"                     drop a pending change
//   data-hover="<path>" + data-value         hover preview for option readouts (R13)
import { TIER_LABEL, estimate } from './engine.js';

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const enc = v => encodeURIComponent(JSON.stringify(v));
export const dec = s => JSON.parse(decodeURIComponent(s));
const DISC = { basic: 0, advanced: 1, expert: 2 };

const TIER_ICON = { 3: 'bolt', 2: 'autorenew', 1: 'restart_alt', R: 'power_settings_new' };
const TIER_HELP = {
  3: 'Applies instantly (shader constants only). Safe to tune while driving.',
  2: 'Feature reload or resource reallocation. Brief hitch; possible while paused.',
  1: 'Rebuilds the render pipeline (swapchain/PSOs/samplers). Main menu only.',
  R: 'Requires restarting the game.',
};
export function tierBadge(tier) {
  if (tier == null || tier === 'dynamic') return tier === 'dynamic' ? '<span class="badge b-lock" title="Cost depends on which settings the preset changes">Tier varies</span>' : '';
  return `<span class="badge b-t${tier}" title="${esc(TIER_HELP[tier])}"><span class="ms">${TIER_ICON[tier]}</span>${TIER_LABEL[tier]}</span>`;
}
export const tierHelp = t => TIER_HELP[t] ?? '';

export function fmt(path, value, ctx) {
  const f = ctx.bundle.ui.fields[path];
  if (value === undefined || value === null) return '—';
  const opts = ctx.vm?.fields[path]?.options ?? f?.options;
  const o = opts?.find(x => x.value === value);
  if (o) return o.short && f?.control === 'provider' ? o.short : o.label;
  if (path === 'graphics.upscaling.mode') {
    const m = ctx.bundle.providers.upscaling.flatMap(p => p.modes).find(x => x.id === value);
    if (m) return m.label;
  }
  if (f?.control === 'provider') {
    const p = Object.values(ctx.bundle.providers).flat().find(x => x?.id === value);
    if (p) return p.short ?? p.label;
  }
  if (typeof value === 'boolean') return value ? 'On' : 'Off';
  if (typeof value === 'number') {
    const u = f?.range?.unit;
    const n = Number.isInteger(value) ? value : Math.abs(value) < 10 ? value.toFixed(2) : value.toFixed(1);
    if (u === 'EV') return `${value > 0 ? '+' : ''}${Number(value).toFixed(2)} EV`;
    if (u === '%') return `${n}%`;
    if (u === '×') return `${n}×`;
    if (u === '°') return `${n}°`;
    return u ? `${n} ${u}` : String(n);
  }
  if (path === 'display.resolution') return String(value).replace('x', '×');
  return String(value).replace(/^[A-Za-z]+_/, '');
}

// ---------------------------------------------------------------------------
// Setting card
// ---------------------------------------------------------------------------
export function renderCard(f, ctx) {
  const { bundle, vm, focus, disclosure = 'advanced' } = ctx;
  const disabled = !['editable'].includes(f.state);
  const cls = ['card', `st-${f.state}`, f.pending ? 'is-pending' : '', !f.pending && f.implied ? 'is-implied' : '', focus === f.path ? 'is-focus' : '', ['provider', 'chips', 'readout'].includes(f.control) ? 'wide' : ''].join(' ');
  const badges = [];
  if (f.pending) badges.push('<span class="badge b-pending">Pending</span>');
  else if (f.implied) badges.push(`<span class="badge b-implied" title="${esc(f.implied.cause.reason)}"><span class="ms">auto_mode</span>Auto</span>`);
  if (f.state === 'locked') badges.push('<span class="badge b-lock"><span class="ms">lock</span>Locked</span>');
  if (f.state === 'blocked') badges.push('<span class="badge b-warn"><span class="ms">warning</span>Needs fix</span>');
  if (f.state === 'readOnly') badges.push('<span class="badge b-ro"><span class="ms">visibility</span>Read-only</span>');
  if (f.state !== 'derived') badges.push(tierBadge(f.tier));
  const proposed = f.engineSupport === 'proposed' ? '<span class="badge b-proposed" title="Not in today\'s v2 config — introduced by the v4 provider abstraction">v4 proposal</span>' : '';

  return `<div class="${cls}" id="card-${cssId(f.path)}" data-focus="${f.path}">
    <div class="card-head">
      <div><div class="card-label">${esc(f.label)} ${proposed}</div>${f.help ? `<div class="card-help">${esc(f.help)}</div>` : ''}</div>
      <div class="badges">${badges.join('')}</div>
    </div>
    <div class="ctl">${renderControl(f, disabled, ctx)}</div>
    ${f.readouts?.length && f.control !== 'readout' ? `<div class="readouts">${f.readouts.map(r => `<div class="readout ${r.tone === 'warn' ? 'warn' : ''}">${esc(r.text)}</div>`).join('')}</div>` : ''}
    ${renderReason(f, ctx)}
  </div>`;
}

export const cssId = p => p.replace(/\./g, '-');

function renderReason(f, ctx) {
  const ctlLabel = f.controller ? ctx.bundle.ui.fields[f.controller]?.label : null;
  const goto = ctlLabel ? ` · Controlled by <button class="linkish" data-goto="${f.controller}">${esc(ctlLabel)}</button>` : '';
  if (f.state === 'locked') return `<div class="reason"><span class="ms">lock</span><span>${esc(f.reason)}${goto}</span></div>`;
  if (f.state === 'blocked') return `<div class="reason blocked"><span class="ms">warning</span><span>${esc(f.reason)}${f.fix ? ` <a class="fix" href="${esc(f.fix.url)}">${esc(f.fix.label)}</a>${f.fix.note ? ` · ${esc(f.fix.note)}` : ''}` : ''}</span></div>`;
  if (f.state === 'readOnly') return `<div class="reason"><span class="ms">visibility</span><span>${esc(f.reason)}</span></div>`;
  if (f.coupled) {
    const c = ctx.bundle.ui.fields[f.coupled.controller]?.label;
    return `<div class="reason"><span class="ms">link</span><span>${esc(f.coupled.reason)} · Coupled to <button class="linkish" data-goto="${f.coupled.controller}">${esc(c)}</button></span></div>`;
  }
  if (!f.pending && f.implied) return `<div class="reason implied"><span class="ms">auto_mode</span><span>${esc(f.implied.cause.reason)}</span></div>`;
  return '';
}

function renderControl(f, disabled, ctx) {
  const dis = disabled ? 'disabled' : '';
  const { disclosure = 'advanced' } = ctx;
  const opts = (f.options ?? []).filter(o => o.status !== 'hidden' && !(o.disclosure && DISC[o.disclosure] > DISC[disclosure] && o.value !== f.value));
  switch (f.control) {
    case 'provider':
      return `<div class="tiles">${opts.map(o => providerTile(f, o, disabled)).join('')}</div>`;
    case 'chips':
      return `<div class="chips">${opts.map(o => {
        const od = disabled || o.status !== 'ok';
        const sub = o.readouts?.[0]?.text ?? o.reason ?? '';
        return `<button class="chip ${o.value === f.value ? 'on' : ''}" ${od ? 'disabled' : ''} data-set="${f.path}" data-value="${enc(o.value)}" data-hover="${f.path}" title="${esc([o.note, o.delta?.text, o.reason].filter(Boolean).join(' · '))}">
          <span class="chip-label">${esc(o.label)}${o.engineSupport === 'proposed' ? ' <span class="badge b-proposed">v4</span>' : ''}</span>
          ${sub ? `<span class="chip-sub">${esc(sub)}</span>` : ''}</button>`;
      }).join('')}</div>`;
    case 'segmented':
      if (opts.length > 6) return selectCtl(f, opts, dis);
      return `<div class="seg">${opts.map(o => {
        const od = disabled || o.status !== 'ok';
        return `<button class="${o.value === f.value ? 'on' : ''}" ${od ? 'disabled' : ''} data-set="${f.path}" data-value="${enc(o.value)}" data-hover="${f.path}" title="${esc([o.delta?.text, o.reason].filter(Boolean).join(' · '))}">${esc(o.label)}</button>`;
      }).join('')}</div>`;
    case 'select':
      return selectCtl(f, opts, dis);
    case 'slider': {
      const r = f.range ?? { min: 0, max: 1, step: 0.01 };
      return `<div class="slider"><input type="range" data-slider="${f.path}" min="${r.min}" max="${r.max}" step="${r.step ?? 'any'}" value="${f.value ?? r.min}" ${dis}><output>${esc(fmt(f.path, f.value, ctx))}</output></div>`;
    }
    case 'toggle':
      return `<div class="toggle-row"><button class="toggle ${f.value ? 'on' : ''}" role="switch" aria-checked="${!!f.value}" ${dis} data-set="${f.path}" data-value="${enc(!f.value)}"></button><span>${f.value ? 'On' : 'Off'}</span></div>`;
    case 'readout':
      return `<div class="pipeline">${(f.readouts ?? []).map(r => `<div>${esc(r.text)}</div>`).join('')}</div>`;
    default:
      return `<span class="mono">${esc(fmt(f.path, f.value, ctx))}</span>`;
  }
}

function selectCtl(f, opts, dis) {
  return `<select class="sel" data-select="${f.path}" ${dis}>${opts.map(o => `<option value="${enc(o.value)}" ${o.value === f.value ? 'selected' : ''} ${o.status !== 'ok' ? 'disabled' : ''}>${esc(o.label)}${o.status !== 'ok' ? ` — ${esc(o.reason)}` : ''}</option>`).join('')}</select>`;
}

const OFF_TEXT = {
  'graphics.upscaling.provider': 'Native resolution, no reconstruction',
  'graphics.frame_generation.provider': 'Every presented frame is rendered',
  'graphics.latency.mode': 'Default render queue',
};
function providerTile(f, o, cardDisabled) {
  const od = cardDisabled || o.status !== 'ok';
  const tags = [];
  if (o.tag === 'Recommended') tags.push('<span class="badge b-rec">Recommended</span>');
  else if (o.tag === 'Also works') tags.push('<span class="badge b-also">Also works</span>');
  if (o.engineSupport === 'proposed') tags.push('<span class="badge b-proposed">v4</span>');
  let why = '';
  if (o.status === 'blocked') why = `<div class="tile-why"><span class="ms">warning</span> ${esc(o.reason)}${o.fix ? ` <a href="${esc(o.fix.url)}" onclick="event.stopPropagation()">${esc(o.fix.label)}</a>` : ''}</div>`;
  else if (o.status === 'locked') why = `<div class="tile-why dep"><span class="ms">lock</span> ${esc(o.reason)}</div>`;
  const sub = o.note ?? o.summary ?? '';
  return `<button class="tile ${o.value === f.value ? 'on' : ''}" ${od ? 'disabled' : ''} data-set="${f.path}" data-value="${enc(o.value)}" data-hover="${f.path}">
    <div class="tile-top"><span class="tile-label"><span class="dot"></span>${esc(o.label)}</span></div>
    ${tags.length ? `<div class="tile-tags">${tags.join('')}</div>` : ''}
    ${sub && o.value !== 'off' ? `<div class="tile-sub">${esc(sub)}</div>` : o.value === 'off' ? `<div class="tile-sub">${OFF_TEXT[f.path] ?? ''}</div>` : ''}
    ${why}
  </button>`;
}

// ---------------------------------------------------------------------------
// Change ledger (R5, R9)
// ---------------------------------------------------------------------------
const GROUP_ORDER = ['R', 1, 2, 3];
const GROUP_TITLE = { R: 'Needs restart', 1: 'Rebuild on apply', 2: 'Quick reload on apply', 3: 'Applied live · revertible' };

export function renderLedger(vm, ctx, { baseEst, system = vm.ledger.system } = {}) {
  const { entries } = vm.ledger;
  if (!entries.length && !system.length) return '<div class="empty">No changes yet.<br>Every edit appears here before it is applied, with its cost.</div>';
  let html = '';
  for (const t of GROUP_ORDER) {
    const list = entries.filter(e => String(e.tier) === String(t));
    if (!list.length) continue;
    html += `<div class="led-group"><div class="led-group-h"><span>${tierBadge(t)} ${GROUP_TITLE[t]}</span><span>${list.length}</span></div>`;
    for (const e of list) {
      html += `<div class="led">
        <div class="led-top"><span class="lbl" data-goto="${e.path}">${esc(e.label)}</span><button class="icon-btn" title="Revert" data-revert="${e.path}"><span class="ms">undo</span></button></div>
        <div class="led-val">${esc(fmt(e.path, e.from, ctx))} → <b>${esc(fmt(e.path, e.to, ctx))}</b></div>
        ${e.overridden ? `<div class="led-child"><span class="badge b-implied">overridden</span> ${esc(e.overridden.reason)}</div>` : ''}
        ${e.children.map(c => `<div class="led-child"><span class="badge b-implied">auto</span> <b data-goto="${c.path}" style="cursor:pointer">${esc(c.label)}</b>: ${esc(fmt(c.path, c.from, ctx))} → <b>${esc(fmt(c.path, c.to, ctx))}</b> ${tierBadge(c.tier)}<div class="why">${esc(c.cause.reason)}</div></div>`).join('')}
      </div>`;
    }
    html += '</div>';
  }
  if (system.length) {
    html += `<div class="led-group"><div class="led-group-h"><span><span class="ms">memory</span> Adjusted for this PC</span><span>${system.length}</span></div>`;
    for (const s of system) {
      html += `<div class="led led-sys"><div class="led-top"><span class="lbl" data-goto="${s.path}">${esc(s.label)}</span>${tierBadge(s.tier)}</div>
        <div class="led-val">${esc(fmt(s.path, s.from, ctx))} → <b>${esc(fmt(s.path, s.to, ctx))}</b></div><div class="led-child why" style="border:0;margin-left:0;padding-left:0">${esc(s.cause.reason)}</div></div>`;
    }
    html += '</div>';
  }
  if (baseEst && entries.length) {
    const e = vm.est;
    html += `<div class="led-group"><div class="led-group-h"><span>Estimated impact</span></div><div class="metrics">
      ${metric('Presented FPS', `${baseEst.presentedFps} → ${e.presentedFps}`, e.presentedFps - baseEst.presentedFps, true)}
      ${metric('VRAM', `${baseEst.vramGB} → ${e.vramGB} GB`, e.vramGB - baseEst.vramGB, false)}
      ${metric('GPU frame', `${baseEst.gpuMs} → ${e.gpuMs} ms`, e.gpuMs - baseEst.gpuMs, false)}
      ${metric('PC latency', `${baseEst.pcLatencyMs} → ${e.pcLatencyMs} ms`, e.pcLatencyMs - baseEst.pcLatencyMs, false)}
    </div></div>`;
  }
  return html;
}

function metric(k, v, delta, higherIsBetter) {
  const tone = Math.abs(delta) < 0.05 ? '' : (delta > 0) === higherIsBetter ? 'gain' : 'cost';
  return `<div class="metric"><div class="k">${esc(k)}</div><div class="v" style="font-size:12px">${esc(v)}</div>${tone ? `<div class="d ${tone}">${delta > 0 ? '▲' : '▼'} ${Math.abs(Math.round(delta * 10) / 10)}</div>` : ''}</div>`;
}

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------
const SCOPE_LABEL = { general: 'All modes', single: 'Single screen', triple: 'Triple screen', hmd: 'VR headset', cockpit: 'Cockpit (all modes)' };
const PREVIEW_LABEL = { 'live-visual': 'Live visual (HUD tuner)', 'live-geometry': 'Live geometry (HUD tuner)', snapshot: 'A/B snapshot', 'metric-only': 'Metrics only', none: '—' };
const CTX_LABEL = { menu: 'Main menu', 'session.paused': 'Paused', 'session.live': 'Driving (HUD)' };

export function renderInspector(vm, path, hover, ctx) {
  const { bundle } = ctx;
  if (!path || !vm.fields[path]) {
    return `<div class="insp"><div class="note">Select a setting to see what it does on this PC: its current, pending and effective values, its dependencies, and its estimated cost.</div>
      <div class="sub">This PC now (est.)</div>${estTiles(vm.est)}</div>`;
  }
  const f = vm.fields[path], s = bundle.ui.fields[path];
  const controls = new Set(), controlledBy = new Set();
  for (const r of bundle.deps.rules) {
    if (r.controller === path) r.effects.forEach(e => e.targets.forEach(t => controls.add(t)));
    if (r.effects.some(e => e.targets.includes(path))) controlledBy.add(r.controller);
  }
  for (const g of bundle.deps.presetGroups) {
    if (g.parent === path) for (const table of Object.values(g.presets)) Object.keys(table).forEach(k => controls.add(k));
  }
  if (s.presetChild) controlledBy.add(s.presetChild);
  for (const [p, x] of Object.entries(bundle.ui.fields)) if (x.presetChild === path) controls.add(p);
  const link = p => `<span class="dep-link" data-goto="${p}">${esc(bundle.ui.fields[p]?.label ?? p)}</span>`;

  let hoverHtml = '';
  if (hover && hover.path === path && hover.value !== f.value) {
    const o = f.options?.find(x => x.value === hover.value);
    if (o) {
      const lines = [...(o.readouts ?? []).map(r => r.text), o.delta?.text, o.note, o.summary, o.reason].filter(Boolean);
      hoverHtml = `<div class="sub">If you pick “${esc(o.label)}”</div>${lines.map(l => `<div class="readout">${esc(l)}</div>`).join('') || '<div class="note">No measurable change estimated.</div>'}`;
    }
  }

  return `<div class="insp">
    <h4>${esc(f.label)}</h4>
    ${f.help ? `<div class="note">${esc(f.help)}</div>` : ''}
    <div class="sub">Values</div>
    <dl class="kv">
      <dt>Applied</dt><dd class="mono">${esc(fmt(path, f.baseValue, ctx))}</dd>
      <dt>${f.pending ? 'Pending' : f.implied ? 'Auto' : 'Effective'}</dt><dd class="mono"><b>${esc(fmt(path, f.value, ctx))}</b></dd>
      ${f.implied ? `<dt>Why</dt><dd>${esc(f.implied.cause.reason)}</dd>` : ''}
      ${f.reason ? `<dt>State</dt><dd>${esc(f.reason)}</dd>` : ''}
    </dl>
    ${f.readouts?.length ? `<div class="sub">On this PC</div>${f.readouts.map(r => `<div class="readout ${r.tone === 'warn' ? 'warn' : ''}">${esc(r.text)}</div>`).join('')}` : ''}
    ${hoverHtml}
    <div class="sub">Classification</div>
    <dl class="kv">
      <dt>Apply</dt><dd>${tierBadge(f.tier)} <span class="note">${esc(tierHelp(f.tier))}</span></dd>
      <dt>Editable</dt><dd>${s.editableIn.map(c => CTX_LABEL[c]).join(' · ') || '— (calculated)'}</dd>
      <dt>Scope</dt><dd>${s.scope.map(x => SCOPE_LABEL[x]).join(', ')}</dd>
      <dt>Preview</dt><dd>${PREVIEW_LABEL[s.preview]}</dd>
      <dt>Impact</dt><dd>${s.impact.length ? s.impact.map(i => i.toUpperCase()).join(' · ') : '—'}</dd>
      <dt>Level</dt><dd>${s.disclosure}</dd>
      ${s.policy ? `<dt>Policy</dt><dd>${s.policy === 'server-override' ? 'Server may override online' : 'VR comfort'}</dd>` : ''}
    </dl>
    ${controls.size || controlledBy.size ? `<div class="sub">Dependencies</div>
      ${controlledBy.size ? `<div class="note" style="margin-bottom:4px">Controlled by</div>${[...controlledBy].map(link).join('')}` : ''}
      ${controls.size ? `<div class="note" style="margin:4px 0">Controls</div>${[...controls].filter(p => bundle.ui.fields[p]).slice(0, 14).map(link).join('')}` : ''}` : ''}
    ${s.dx12 || s.reclassified || s.note ? `<div class="sub">Engine notes</div>` : ''}
    ${s.dx12 ? `<div class="note">${esc(s.dx12)}</div>` : ''}
    ${s.reclassified ? `<div class="note" style="margin-top:4px"><b>Reclassified from Tier ${s.reclassified.from}:</b> ${esc(s.reclassified.why)}</div>` : ''}
    ${s.note ? `<div class="note" style="margin-top:4px">${esc(s.note)}</div>` : ''}
    <div class="sub">This PC now (est.)</div>${estTiles(vm.est)}
  </div>`;
}

export function estTiles(e) {
  return `<div class="metrics">
    <div class="metric"><div class="k">Presented</div><div class="v">${e.presentedFps} fps</div></div>
    <div class="metric"><div class="k">Rendered</div><div class="v">${e.renderedFps} fps</div></div>
    <div class="metric"><div class="k">GPU / CPU</div><div class="v">${e.gpuMs} / ${e.cpuMs} ms</div></div>
    <div class="metric"><div class="k">VRAM</div><div class="v" style="${e.vramRatio > 0.92 ? 'color:var(--rebuild)' : ''}">${e.vramGB} GB</div></div>
    <div class="metric"><div class="k">PC latency</div><div class="v">${e.pcLatencyMs} ms</div></div>
    <div class="metric"><div class="k">Bound by</div><div class="v">${e.bound.toUpperCase()}</div></div>
  </div>`;
}

export { estimate };
