// Video settings rules engine — the executable form of docs/01-taxonomy-and-rules.md.
// Pure functions only (no DOM), so the same module runs in the mockups and in Node tests.
//
//   evaluate({ bundle, facts, base, pending, context, disclosure }) -> view model
//
// bundle   = { ui, deps, providers, insights }   (schema/*.json)
// facts    = a rig fixture (fixtures/rigs/*.json)  — layer 1
// base     = flat v4 config (fromV2(...))           — what is applied right now
// pending  = ordered [{ path, value }]              — user changes not yet committed
// context  = { session: 'menu' | 'session.paused' | 'session.live', online: bool }

export const TIER_ORDER = { 3: 0, 2: 1, 1: 2, R: 3 };
export const TIER_LABEL = { 3: 'Live', 2: 'Quick reload', 1: 'Rebuild', R: 'Restart' };
const DISCLOSURE_RANK = { basic: 0, advanced: 1, expert: 2 };

// ---------------------------------------------------------------------------
// Paths and conditions
// ---------------------------------------------------------------------------
export function getPath(obj, path) {
  let cur = obj;
  for (const key of path.split('.')) {
    if (cur == null) return undefined;
    cur = key === 'length' && Array.isArray(cur) ? cur.length : cur[key];
  }
  return cur;
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  let cur = obj;
  for (const k of keys.slice(0, -1)) cur = cur[k] ??= {};
  cur[keys.at(-1)] = value;
}

// Resolve a namespaced ref: cfg:<v4 path> | facts:<path> | der:<key> | est:<key> | ctx:<key>
function resolveRef(ref, env) {
  const i = ref.indexOf(':');
  const ns = ref.slice(0, i), path = ref.slice(i + 1);
  switch (ns) {
    case 'cfg': return env.cfg[path];
    case 'facts': return getPath(env.facts, path);
    case 'der': return env.der?.[path];
    case 'est': return env.est?.[path];
    case 'ctx': return env.context?.[path];
    default: throw new Error(`Unknown ref namespace in ${ref}`);
  }
}

export function test(cond, env) {
  if (!cond) return true;
  if (cond.all) return cond.all.every(c => test(c, env));
  if (cond.any) return cond.any.some(c => test(c, env));
  if (cond.not) return !test(cond.not, env);
  const v = resolveRef(cond.ref, env);
  if ('eq' in cond) return v === cond.eq || (cond.eq === null && v == null);
  if ('neq' in cond) return cond.neq === null ? v != null : v !== cond.neq;
  if ('in' in cond) return cond.in.includes(v);
  if ('nin' in cond) return !cond.nin.includes(v);
  if ('gt' in cond) return v > cond.gt;
  if ('gte' in cond) return v >= cond.gte;
  if ('lt' in cond) return v < cond.lt;
  if ('lte' in cond) return v <= cond.lte;
  return Boolean(v);
}

export function interpolate(text, env) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{([a-z]+:[^}]+)\}/g, (_, ref) => {
    const v = resolveRef(ref, env);
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(1);
    return v ?? '—';
  });
}

// ---------------------------------------------------------------------------
// v2 <-> v4 config mapping
// ---------------------------------------------------------------------------
const REFLEX_V2 = { Reflex_Off: 'off', Reflex_On: 'reflex', Reflex_OnPlusBoost: 'reflex_boost' };
const FG_V2 = { FrameGeneration_Off: 'off', FrameGeneration_DLSS: 'dlss_fg', FrameGeneration_FSR: 'fsr_fg' };

export function fromV2(v2raw, facts, bundle) {
  const v2 = structuredClone(v2raw);
  for (const [p, val] of Object.entries(facts.configOverrides ?? {})) setPath(v2, p, val);
  const { ui, providers } = bundle;
  const cfg = {};
  for (const [path, f] of Object.entries(ui.fields)) {
    if (f.v2?.path) cfg[path] = getPath(v2, f.v2.path);
  }
  const d = v2.display, g = v2.graphics;
  cfg['display.mode'] = d.is_stereo ? 'vr' : d.is_triple ? 'triple' : 'single';
  cfg['display.monitor'] = d.monitor;
  cfg['display.resolution'] = `${d.window_width}x${d.window_height}`;
  cfg['display.window_mode'] = d.is_fullscreen ? 'fullscreen' : d.is_maximized ? 'borderless' : 'windowed';
  const mon = monitorFor(facts, d.monitor);
  const nativeRatio = mon ? reduceRatio(mon.width, mon.height) : null;
  const ratio = `${d.aspect_ratio_x}:${d.aspect_ratio_y}`;
  cfg['display.aspect_ratio'] = ratio === nativeRatio ? 'auto' : ratio;
  cfg['display.render_resolution'] = null;

  // Upscaling: v2 mode + per-vendor preset -> provider / mode / scale
  const up = g.upscaling;
  let provider = 'off', modeId = null, custom = null;
  if (up.mode === 'Upscaling_DLSS') {
    provider = 'dlss';
    modeId = providerMode(providers, 'dlss', up.dlss_preset);
    custom = up.dlss_custom_val || null;
  } else if (up.mode === 'Upscaling_FSR') {
    provider = facts.sdk?.fsr4?.supported ? 'fsr4' : 'fsr31';
    modeId = providerMode(providers, provider, up.fsr_preset);
    custom = up.fsr_custom_val || null;
  }
  cfg['graphics.upscaling.provider'] = provider;
  cfg['graphics.upscaling.mode'] = modeId ?? 'quality';
  cfg['graphics.upscaling.custom_scale'] = custom ?? 0.75;
  cfg['graphics.upscaling.dlss_model'] = 'default';
  cfg['graphics.frame_generation.provider'] = FG_V2[g.frame_generation.mode] ?? 'off';
  cfg['graphics.frame_generation.multiplier'] = g.frame_generation.multiplier;
  cfg['graphics.latency.mode'] = REFLEX_V2[g.reflex] ?? 'off';
  return cfg;
}

function providerMode(providers, providerId, v2preset) {
  const p = providers.upscaling.find(x => x.id === providerId);
  return p?.modes.find(m => m.v2 === v2preset)?.id ?? null;
}

// Export: write the v4 values back into a copy of the v2 document (what the engine reads today).
export function toV2(cfg, v2raw, bundle) {
  const v2 = structuredClone(v2raw);
  for (const [path, f] of Object.entries(bundle.ui.fields)) {
    if (f.v2?.path && cfg[path] !== undefined) setPath(v2, f.v2.path, cfg[path]);
  }
  const [w, h] = String(cfg['display.resolution']).split('x').map(Number);
  Object.assign(v2.display, {
    window_width: w, window_height: h, monitor: cfg['display.monitor'],
    is_triple: cfg['display.mode'] === 'triple', is_stereo: cfg['display.mode'] === 'vr',
    is_fullscreen: cfg['display.window_mode'] === 'fullscreen', is_maximized: cfg['display.window_mode'] === 'borderless',
  });
  const prov = bundle.providers.upscaling.find(p => p.id === cfg['graphics.upscaling.provider']);
  if (prov?.v2) {
    v2.graphics.upscaling.mode = prov.v2.mode;
    const m = prov.modes.find(x => x.id === cfg['graphics.upscaling.mode']);
    if (m?.v2) setPath(v2, prov.v2.presetField, m.v2);
    if (cfg['graphics.upscaling.mode'] === 'custom') setPath(v2, prov.v2.customField, cfg['graphics.upscaling.custom_scale']);
  } else if (cfg['graphics.upscaling.provider'] === 'off') {
    v2.graphics.upscaling.mode = 'Upscaling_Off';
  }
  const fg = bundle.providers.frameGeneration.find(p => p.id === cfg['graphics.frame_generation.provider']);
  v2.graphics.frame_generation.mode = fg?.v2?.mode ?? 'FrameGeneration_Off';
  const lat = bundle.providers.latency.find(p => p.id === cfg['graphics.latency.mode']);
  v2.graphics.reflex = lat?.v2 ?? 'Reflex_Off';
  return v2;
}

// ---------------------------------------------------------------------------
// Derived values (layer 2 helpers)
// ---------------------------------------------------------------------------
function gcd(a, b) { return b ? gcd(b, a % b) : a; }
function reduceRatio(w, h) { const g = gcd(w, h); const r = `${w / g}:${h / g}`; return r === '8:5' ? '16:10' : r === '64:27' || r === '43:18' ? '21:9' : r; }
function monitorFor(facts, id) {
  const mons = facts.display?.monitors ?? [];
  return mons.find(m => m.id === id) ?? mons.find(m => m.primary) ?? mons[0];
}
const even = n => Math.max(2, Math.round(n / 2) * 2);
const SS_FACTOR = { Supersampling_Off: 1, Supersampling_1x5: 1.5, Supersampling_2x: 2, Supersampling_4x: 4 };
const FG_MULT = { FrameGeneration_2x: 2, FrameGeneration_3x: 3, FrameGeneration_4x: 4 };
const fmtRes = (w, h) => `${w}×${h}`;
const round1 = n => Math.round(n * 10) / 10;

export function upscaler(bundle, id) { return bundle.providers.upscaling.find(p => p.id === id); }

function upscaleScale(cfg, bundle) {
  const prov = upscaler(bundle, cfg['graphics.upscaling.provider']);
  if (!prov || prov.id === 'off') return 1;
  if (cfg['graphics.upscaling.mode'] === 'custom') return cfg['graphics.upscaling.custom_scale'];
  return prov.modes.find(m => m.id === cfg['graphics.upscaling.mode'])?.scale ?? 1;
}

export function derive(cfg, facts, bundle) {
  const mode = cfg['display.mode'];
  const scope = mode === 'vr' ? 'hmd' : mode === 'triple' ? 'triple' : 'single';
  const mon = monitorFor(facts, cfg['display.monitor']);
  let outW, outH, views = 1, refreshHz, vrr, outputLabel;
  if (scope === 'hmd') {
    const pd = (cfg['vr.pixel_density'] ?? 100) / 100;
    outW = even(facts.vr.perEyeWidth * pd); outH = even(facts.vr.perEyeHeight * pd); views = 2;
    refreshHz = facts.vr.refreshHz; vrr = false;
    outputLabel = `2 × ${fmtRes(outW, outH)} per eye @ ${refreshHz} Hz`;
  } else if (scope === 'triple') {
    outW = mon.width * 3; outH = mon.height; refreshHz = mon.refreshHz; vrr = !!mon.vrr;
    outputLabel = `3 × ${fmtRes(mon.width, mon.height)} = ${fmtRes(outW, outH)} @ ${refreshHz} Hz`;
  } else {
    const [w, h] = String(cfg['display.resolution']).split('x').map(Number);
    outW = w || mon.width; outH = h || mon.height; refreshHz = mon.refreshHz; vrr = !!mon.vrr;
    outputLabel = `${fmtRes(outW, outH)} @ ${refreshHz} Hz${vrr ? ' · VRR' : ''}`;
  }
  const prov = upscaler(bundle, cfg['graphics.upscaling.provider']);
  const upScale = upscaleScale(cfg, bundle);
  const ss = prov && prov.id !== 'off' ? 1 : (SS_FACTOR[cfg['display.supersampling']] ?? 1);
  const renderScale = prov && prov.id !== 'off' ? upScale : ss;
  const renderW = even(outW * renderScale), renderH = even(outH * renderScale);

  const fgProv = bundle.providers.frameGeneration.find(p => p.id === cfg['graphics.frame_generation.provider']);
  const fgMaxMultiplier = fgProv?.maxMultiplierRef ? (getPath(facts, fgProv.maxMultiplierRef.slice(6)) ?? 2) : 0;

  // Recommended upscaler (A6): first provider in the vendor list that this GPU supports
  const env0 = { cfg, facts };
  const recList = bundle.providers.recommendation.upscaling[facts.gpu.vendor] ?? [];
  const recommended = recList.map(id => upscaler(bundle, id)).find(p => p && test(p.requires, env0)) ?? null;

  // Triple geometry: per-screen horizontal FOV equals the ideal side-screen angle
  const tw = cfg['display.triple_screen.width'], td = cfg['display.triple_screen.distance'];
  const perScreenFov = tw && td ? (2 * Math.atan(tw / 2 / td) * 180) / Math.PI : null;
  const tripleRecommendedAngle = perScreenFov ? round1(perScreenFov) : null;

  const cap = cfg['display.frame_rate_limit.gameplay_frame_rate_limit'];
  return {
    scope, monitor: mon, outW, outH, views, refreshHz, vrr, hdrDisplay: scope !== 'hmd' && !!mon?.hdr, outputLabel,
    upscalerFamily: prov?.family ?? 'none', upscalerLabel: prov?.short ?? prov?.label ?? 'Off',
    upScale, renderScale, renderW, renderH, ssFactor: ss,
    fgMultiplier: fgProv && fgProv.id !== 'off' ? (FG_MULT[cfg['graphics.frame_generation.multiplier']] ?? 2) : 1,
    fgMaxMultiplier,
    recommendedUpscaler: recommended?.id ?? null,
    recommendedUpscalerLabel: recommended?.short ?? recommended?.label ?? null,
    activeUpscalerLabel: prov?.short ?? prov?.label,
    usingRecommendedUpscaler: !recommended || recommended.id === prov?.id,
    capOverRefresh: cap > refreshHz,
    suggestedCap: Math.max(30, Math.floor(refreshHz) - 3),
    perScreenFov, tripleRecommendedAngle,
    tripleTotalFov: perScreenFov ? round1(perScreenFov * 3) : null,
    tripleAngleDelta: perScreenFov != null ? Math.abs(cfg['display.triple_screen.screen_angle'] - perScreenFov) : 0,
  };
}

// ---------------------------------------------------------------------------
// Performance estimates (clearly labelled "est." in the UI)
// ---------------------------------------------------------------------------
export function estimate(cfg, facts, bundle, der = derive(cfg, facts, bundle)) {
  const t = facts.telemetry;
  let gpuQ = 1, cpuQ = 1, vramGB = t.baseVramGB;
  const renderMP = (der.renderW * der.renderH * der.views) / 1e6;
  const outMP = (der.outW * der.outH * der.views) / 1e6;
  for (const [path, f] of Object.entries(bundle.ui.fields)) {
    const c = f.cost; if (!c) continue;
    const v = cfg[path];
    if (c.gpu?.[v] != null) gpuQ *= c.gpu[v];
    if (c.cpu?.[v] != null) cpuQ *= c.cpu[v];
    if (c.vramGB?.[v] != null) vramGB += c.vramGB[v];
    if (c.vramPerMP?.[v] != null) vramGB += c.vramPerMP[v] * renderMP;
    if (c.cpuPerUnit != null && typeof v === 'number') cpuQ *= 1 + (v - c.ref) * c.cpuPerUnit;
  }
  const prov = upscaler(bundle, cfg['graphics.upscaling.provider']);
  let upCost = 0;
  if (prov && prov.id !== 'off') {
    const perK = prov.id === 'xess' && facts.sdk?.xess?.path === 'dp4a' ? prov.costMsAt4KDp4a : prov.costMsAt4K;
    upCost = (perK ?? 0.8) * (outMP / 8.29);
  }
  const fgOn = der.fgMultiplier > 1;
  let gpuMs = t.gpuFixedMs + t.gpuMsPerMP * renderMP * gpuQ + upCost;
  if (fgOn) gpuMs *= 1.1;
  let cpuMs = t.cpuMs * cpuQ * (der.scope === 'triple' ? 1.15 : der.scope === 'hmd' ? 1.2 : 1);
  if (facts.os?.powerSource === 'battery') { gpuMs *= 1.6; cpuMs *= 1.35; }
  vramGB += renderMP * 0.06 + (fgOn ? outMP * 0.035 * der.fgMultiplier : 0) + (prov && prov.id !== 'off' ? outMP * 0.03 : 0);

  const frameMs = Math.max(gpuMs, cpuMs);
  let renderedFps = 1000 / frameMs;
  const capLimit = cfg['display.frame_rate_limit.gameplay_frame_rate_limit'] ?? 1000;
  const vsyncLimit = cfg['display.v_sync'] === 'On' || der.scope === 'hmd' ? der.refreshHz : Infinity;
  let presentedFps = Math.min(renderedFps * der.fgMultiplier, capLimit, vsyncLimit);
  const capped = presentedFps < renderedFps * der.fgMultiplier - 0.5;
  renderedFps = Math.min(renderedFps, presentedFps / der.fgMultiplier);
  const lat = bundle.providers.latency.find(p => p.id === cfg['graphics.latency.mode']) ?? bundle.providers.latency[0];
  const renderFrame = 1000 / renderedFps;
  const pcLatency = renderFrame * lat.queueFactor + (fgOn ? renderFrame : 0) + (cfg['display.v_sync'] === 'On' ? renderFrame : 0) + 3;
  return {
    gpuMs: round1(gpuMs), cpuMs: round1(cpuMs), bound: cpuMs > gpuMs * 1.05 ? 'cpu' : 'gpu',
    renderedFps: Math.round(renderedFps), presentedFps: Math.round(presentedFps), capped,
    pcLatencyMs: Math.round(pcLatency), vramGB: round1(vramGB), vramRatio: vramGB / facts.gpu.vramGB,
    renderMP: round1(renderMP),
  };
}

// ---------------------------------------------------------------------------
// Readouts (facet F11, rule R13)
// ---------------------------------------------------------------------------
function withValue(cfg, path, value) { return { ...cfg, [path]: value }; }

export function deltaReadout(cfg, path, value, facts, bundle) {
  if (cfg[path] === value) return null;
  const a = estimate(cfg, facts, bundle), b = estimate(withValue(cfg, path, value), facts, bundle);
  const parts = [];
  const dg = round1(b.gpuMs - a.gpuMs), dc = round1(b.cpuMs - a.cpuMs), dv = round1(b.vramGB - a.vramGB);
  if (Math.abs(dg) >= 0.1) parts.push(`${dg > 0 ? '+' : ''}${dg} ms GPU`);
  if (Math.abs(dc) >= 0.1) parts.push(`${dc > 0 ? '+' : ''}${dc} ms CPU`);
  if (Math.abs(dv) >= 0.1) parts.push(`${dv > 0 ? '+' : ''}${dv} GB VRAM`);
  if (b.presentedFps !== a.presentedFps) parts.push(`${b.presentedFps} fps`);
  return parts.length ? { text: parts.join(' · ') + ' (est.)', tone: dg > 0 || dc > 0 || dv > 0 ? 'cost' : 'gain' } : null;
}

// Returns [{ text, tone? }] describing what `value` (default: current) means on this rig.
export function readouts(path, value, cfg, facts, bundle) {
  const f = bundle.ui.fields[path];
  const cur = value === undefined ? cfg[path] : value;
  const c = withValue(cfg, path, cur);
  const der = derive(c, facts, bundle);
  const out = [];
  const push = (text, tone) => text && out.push({ text, tone });
  for (const id of f?.readouts ?? []) {
    switch (id) {
      case 'outputResolution': push(`Output ${der.outputLabel}`); break;
      case 'renderResolution': {
        if (der.upscalerFamily === 'none') break;
        push(`${Math.round(der.upScale * 100)}% · renders ${fmtRes(der.renderW, der.renderH)} → ${fmtRes(der.outW, der.outH)}${der.views === 2 ? ' per eye' : ''}`);
        break;
      }
      case 'supersamplingResolution':
        push(der.ssFactor > 1 ? `Renders ${fmtRes(der.renderW, der.renderH)} → ${fmtRes(der.outW, der.outH)}` : `Native ${fmtRes(der.outW, der.outH)}`);
        break;
      case 'pipeline': {
        const e = estimate(c, facts, bundle, der);
        const fg = der.fgMultiplier > 1 ? `FG ${der.fgMultiplier}x` : 'FG off';
        const lat = bundle.providers.latency.find(p => p.id === c['graphics.latency.mode']);
        const up = der.upscalerFamily === 'none' ? (der.ssFactor > 1 ? `SSAA ${der.ssFactor}x` : 'native') : `${der.upscalerLabel} ${modeLabel(c, bundle)}`;
        push(`Render ${fmtRes(der.renderW, der.renderH)} → ${up} → ${fmtRes(der.outW, der.outH)}${der.views === 2 ? ' ×2 eyes' : ''}`);
        push(`${fg} · ${lat && lat.id !== 'off' ? lat.short ?? lat.label : 'Latency reduction off'} · V-Sync ${c['display.v_sync']} · cap ${c['display.frame_rate_limit.gameplay_frame_rate_limit']} fps`);
        push(`≈ ${e.presentedFps} fps presented (${e.renderedFps} rendered) · ${e.pcLatencyMs} ms PC latency · ${e.bound.toUpperCase()}-bound (est.)`);
        break;
      }
      case 'presentedFps': {
        const e = estimate(c, facts, bundle, der);
        push(`≈ ${e.presentedFps} fps presented from ${e.renderedFps} rendered${e.capped ? ' (capped)' : ''} · ${e.pcLatencyMs} ms latency (est.)`);
        break;
      }
      case 'latency': {
        const e = estimate(c, facts, bundle, der);
        push(`≈ ${e.pcLatencyMs} ms PC latency at ${e.renderedFps} rendered fps (est.)`);
        break;
      }
      case 'frameCap': {
        const vrrTxt = der.vrr ? `VRR up to ${der.refreshHz} Hz` : `${der.refreshHz} Hz, no VRR`;
        const over = cur > der.refreshHz;
        push(`${vrrTxt} · ${over ? `${Math.round(cur - der.refreshHz)} fps above refresh` : `${Math.round(der.refreshHz - cur)} fps below refresh`}`, over && der.vrr ? 'warn' : undefined);
        break;
      }
      case 'syncNote':
        push(der.vrr ? 'VRR display: Off + a cap a few fps below refresh gives the lowest latency without tearing' : 'No VRR: On prevents tearing at the cost of latency');
        break;
      case 'vram': {
        const e = estimate(c, facts, bundle, der);
        push(`≈ ${e.vramGB} GB of ${facts.gpu.vramGB} GB VRAM (est.)`, e.vramRatio > 0.92 ? 'warn' : undefined);
        break;
      }
      case 'tripleFov':
        if (der.perScreenFov) push(`Per-screen hFOV ${round1(der.perScreenFov)}° · total ≈ ${der.tripleTotalFov}°`);
        break;
      case 'tripleAngleAdvice':
        if (der.tripleRecommendedAngle != null) push(`Recommended for this geometry ≈ ${der.tripleRecommendedAngle}°`, der.tripleAngleDelta > 5 ? 'warn' : undefined);
        break;
      case 'vrResolution':
        push(`${fmtRes(der.outW, der.outH)} per eye (${Math.round((der.outW * der.outH * 2) / 1e5) / 10} MP total)`);
        break;
      case 'distance': {
        const meters = typeof cur === 'number' ? cur : presetValue(bundle, path, cur, 'graphics.viewDistance.overallDistance');
        if (meters != null) push(`${(meters / 1000).toFixed(1)} km`);
        break;
      }
      case 'exposure': push(`×${Math.pow(2, cur).toFixed(2)} brightness`); break;
      case 'sharpeningPath': {
        const fam = der.upscalerFamily;
        push(fam === 'fsr' ? 'Applied through FSR RCAS' : fam === 'xess' ? 'Applied through XeSS sharpness' : fam === 'dlss' ? 'Global sharpening pass (DLSS has no built-in sharpening)' : 'Global sharpening pass');
        break;
      }
      case 'windowModeNote':
        push(cur === 'fullscreen' ? 'Exclusive output: lowest latency, slower Alt-Tab' : cur === 'borderless' ? (facts.os.windowedOptimizations ? 'Flip-model borderless: near-fullscreen latency' : 'Composited by Windows: adds latency') : 'Composited by Windows');
        break;
      case 'carsCpu': {
        const d = deltaReadout(cfg, path, cur, facts, bundle);
        if (d) push(d.text, d.tone);
        break;
      }
    }
  }
  return out;
}

function modeLabel(cfg, bundle) {
  const prov = upscaler(bundle, cfg['graphics.upscaling.provider']);
  if (cfg['graphics.upscaling.mode'] === 'custom') return `Custom ${Math.round(cfg['graphics.upscaling.custom_scale'] * 100)}%`;
  return prov?.modes.find(m => m.id === cfg['graphics.upscaling.mode'])?.label ?? '';
}

function presetValue(bundle, parent, value, child) {
  return bundle.deps.presetGroups.find(g => g.parent === parent)?.presets?.[value]?.[child];
}

// ---------------------------------------------------------------------------
// Options (rule R4) — static, from facts, or from the provider matrix (R14)
// ---------------------------------------------------------------------------
function baseOptions(path, f, cfg, facts, bundle, der) {
  const src = f.optionsFrom;
  if (!src) return (f.options ?? []).map(o => ({ ...o }));
  if (src === 'facts.monitors') {
    return facts.display.monitors.map(m => ({ value: m.id, label: `${m.name} · ${m.width}×${m.height} @ ${m.refreshHz} Hz` }));
  }
  if (src === 'facts.resolutions') {
    const mon = der.monitor;
    const seen = new Set();
    return [1, 0.75, 2 / 3, 0.5].map(s => [even(mon.width * s), even(mon.height * s)])
      .filter(([w, h]) => !seen.has(`${w}x${h}`) && seen.add(`${w}x${h}`))
      .map(([w, h], i) => ({ value: `${w}x${h}`, label: `${w}×${h}${i === 0 ? ' (native)' : ''}` }));
  }
  if (src === 'providers.upscaling.modes') {
    const prov = upscaler(bundle, cfg['graphics.upscaling.provider']);
    return (prov?.modes ?? []).map(m => ({ value: m.id, label: m.label, scale: m.scale, disclosure: m.disclosure, engineSupport: m.engineSupport, note: m.note }));
  }
  const list = { 'providers.upscaling': 'upscaling', 'providers.frameGeneration': 'frameGeneration', 'providers.latency': 'latency' }[src];
  const recIds = bundle.providers.recommendation[list]?.[facts.gpu.vendor] ?? [];
  const env = { cfg, facts, der };
  const recommended = recIds.find(id => {
    const p = bundle.providers[list].find(x => x.id === id);
    return p && test(p.requires, env);
  });
  return bundle.providers[list].map(p => {
    const o = { value: p.id, label: p.label, short: p.short, vendor: p.vendor, engineSupport: p.engineSupport, summary: p.summary };
    if (p.requires && !test(p.requires, env)) { o.status = 'hidden'; o.reason = `Not supported by ${facts.gpu.name}`; }
    for (const b of p.blockedBy ?? []) {
      if (o.status !== 'hidden' && test(b.when, env)) { o.status = 'blocked'; o.reason = b.reason; o.fix = b.fix; }
    }
    if (p.id !== 'off') {
      if (p.id === recommended) o.tag = 'Recommended';
      else if (p.vendor !== facts.gpu.vendor && p.crossVendorNote) { o.tag = 'Also works'; o.note = p.crossVendorNote; }
      else if (p.id === 'xess' && facts.sdk?.xess?.path === 'dp4a') { o.tag = 'Also works'; o.note = p.crossVendorNote; }
      else if (recommended) o.tag = 'Also works';
    }
    return o;
  });
}

// ---------------------------------------------------------------------------
// evaluate()
// ---------------------------------------------------------------------------
export function evaluate({ bundle, facts, base, pending = [], context = { session: 'menu', online: false }, disclosure = 'advanced' }) {
  const { ui, deps } = bundle;
  const cfg = { ...base };
  const implied = new Map(); // path -> { path, from, to, cause }
  const userPaths = new Set();
  const presetGroup = Object.fromEntries(deps.presetGroups.map(g => [g.parent, g]));

  const setImplied = (path, to, cause) => {
    if (cfg[path] === to) return false;
    cfg[path] = to;
    const prev = implied.get(path);
    implied.set(path, { path, from: base[path], to, cause: prev?.cause && prev.cause.root === cause.root ? prev.cause : cause });
    return true;
  };

  // R6 — preset cascade (parent -> children) and flip (child -> parent becomes Custom)
  const cascade = (parent, value, root) => {
    const g = presetGroup[parent];
    const table = g?.presets?.[value];
    if (!table) return;
    for (const [child, v] of Object.entries(table)) {
      if (setImplied(child, v, { type: 'preset', controller: parent, root, reason: `Set by ${ui.fields[parent]?.label} preset` })) cascade(child, v, root);
    }
  };
  const flip = (child, root) => {
    const parent = ui.fields[child]?.presetChild;
    if (!parent) return;
    const g = presetGroup[parent];
    if (!g || cfg[parent] === g.customValue) return;
    if (setImplied(parent, g.customValue, { type: 'flip', controller: child, root, reason: `${ui.fields[child].label} was changed, so the preset is now Custom` })) flip(parent, root);
  };

  for (const { path, value } of pending) {
    cfg[path] = value;
    userPaths.add(path);
    implied.delete(path);
    const f = ui.fields[path];
    if (f?.presetParent && value !== presetGroup[path]?.customValue) cascade(path, value, path);
    flip(path, path);
  }

  // Dependency rules to a fixpoint (R3, R5) + option fallbacks (R12)
  let der, ruleHits;
  const rootOf = controller => (userPaths.has(controller) ? controller : implied.get(controller)?.cause.root ?? null);
  for (let pass = 0; pass < 8; pass++) {
    der = derive(cfg, facts, bundle);
    const env = { cfg, facts, der, context };
    ruleHits = deps.rules.filter(r => test(r.when, env));
    let changed = false;
    for (const r of ruleHits) {
      for (const e of r.effects) {
        if (e.action !== 'force') continue;
        for (const t of e.targets) {
          if (e.unlessIn?.includes(cfg[t])) continue;
          if (setImplied(t, e.value, { type: 'rule', rule: r.id, controller: r.controller, root: rootOf(r.controller), reason: e.reason })) changed = true;
        }
      }
    }
    // R12: a current value whose option is no longer offered falls back to the first usable option
    const scopesNow = new Set(['general', 'cockpit', der.scope]);
    for (const [path, f] of Object.entries(ui.fields)) {
      if (!f.optionsFrom && !hasGatedOptions(path, f, deps)) continue;
      if (!f.scope.some(s => scopesNow.has(s))) continue;
      const opts = resolveOptions(path, f, cfg, facts, bundle, der, ruleHits, { cfg, facts, der, context });
      if (!opts.length) continue;
      const cur = opts.find(o => o.value === cfg[path]);
      if (cur && cur.status === 'ok') continue;
      let prevScale = null;
      if (f.optionsFrom === 'providers.upscaling.modes') {
        // The current mode id belongs to the previous provider; find its scale there (prefer the applied provider).
        const order = [base['graphics.upscaling.provider'], ...bundle.providers.upscaling.map(p => p.id)];
        for (const id of order) { const m = upscaler(bundle, id)?.modes.find(x => x.id === cfg[path]); if (m?.scale != null) { prevScale = m.scale; break; } }
      }
      const fallback = pickFallback(opts, cfg[path], prevScale);
      if (fallback == null) continue;
      const controller = cur?.controller ?? (f.optionsFrom === 'providers.upscaling.modes' ? 'graphics.upscaling.provider' : f.optionsFrom === 'facts.resolutions' ? 'display.monitor' : path);
      const root = rootOf(controller) ?? (userPaths.has(path) ? path : null);
      const reason = cur?.reason ?? `"${labelFor(cfg[path], opts, bundle)}" isn't offered for the current ${controller === path ? 'hardware' : ui.fields[controller]?.label ?? 'selection'}`;
      if (setImplied(path, fallback, { type: 'fallback', controller, root, reason })) changed = true;
    }
    if (!changed) break;
  }

  const env = { cfg, facts, der, context };
  const est = estimate(cfg, facts, bundle, der);
  env.est = est;

  // Field view models
  const activeScopes = new Set(['general', 'cockpit', der.scope]);
  const fields = {};
  const unavailable = [];
  for (const [path, f] of Object.entries(ui.fields)) {
    const vm = {
      path, label: f.label, help: f.help, group: f.group, section: f.section, control: f.control, tier: f.tier,
      disclosure: f.disclosure, engineSupport: f.engineSupport, preview: f.preview, impact: f.impact, role: f.role,
      value: cfg[path], baseValue: base[path], visible: true, hiddenKind: null, state: 'editable', reason: null, controller: null, fix: null,
      pending: userPaths.has(path), implied: implied.has(path) ? implied.get(path) : null,
      disclosureHidden: DISCLOSURE_RANK[f.disclosure] > DISCLOSURE_RANK[disclosure],
    };
    if (!f.scope.some(s => activeScopes.has(s))) { vm.visible = false; vm.hiddenKind = 'scope'; }
    if (f.gate?.hw && !test(f.gate.hw, env)) {
      if (vm.visible) unavailable.push({ path, label: f.label, reason: f.gate.hwReason });
      vm.visible = false; vm.hiddenKind = 'hw'; vm.reason = f.gate.hwReason;
    }
    for (const g of f.gate?.os ?? []) if (vm.visible && test(g.when, env)) { vm.state = 'blocked'; vm.reason = g.reason; vm.fix = g.fix; }
    for (const r of ruleHits) for (const e of r.effects) {
      if (!e.targets.includes(path)) continue;
      if (e.action === 'hide' && vm.visible) { vm.visible = false; vm.hiddenKind = e.quiet ? 'conditional' : 'dependency'; }
      if ((e.action === 'lock' || (e.action === 'force' && e.lock !== false && !e.unlessIn)) && vm.state === 'editable') {
        vm.state = 'locked'; vm.reason = e.reason; vm.controller = r.controller; vm.rule = r.id;
      }
      if (e.action === 'force' && e.unlessIn) { vm.coupled = { reason: e.reason, controller: r.controller }; }
    }
    if (f.role === 'derived') vm.state = 'derived';
    if (vm.state === 'editable' && !f.editableIn.includes(context.session)) {
      vm.state = 'readOnly';
      vm.reason = context.session === 'session.live' ? (f.editableIn.includes('session.paused') ? 'Pause to change' : 'Change from the main menu') : 'Change from the main menu';
    }
    if (vm.state === 'editable' && f.policy === 'server-override' && context.online) { vm.state = 'readOnly'; vm.reason = 'Set by the server in online sessions'; }
    if (f.options || f.optionsFrom || hasGatedOptions(path, f, deps)) {
      vm.options = resolveOptions(path, f, cfg, facts, bundle, der, ruleHits, env);
      for (const o of vm.options) {
        if (o.status === 'hidden' && vm.visible && o.value !== 'off') unavailable.push({ path, label: `${f.label}: ${o.label}`, reason: o.reason });
        if (o.status === 'hidden' || o.status === 'blocked' || o.status === 'locked') continue;
        o.readouts = f.readoutInline ? readouts(path, o.value, cfg, facts, bundle) : [];
        if (f.control !== 'provider' && !f.optionsFrom?.startsWith('facts.monitors')) {
          const d = deltaReadout(cfg, path, o.value, facts, bundle);
          if (d) o.delta = d;
        }
      }
    }
    if (f.range) vm.range = f.range;
    vm.readouts = f.readouts ? readouts(path, undefined, cfg, facts, bundle) : [];
    if (f.reclassified) vm.reclassified = f.reclassified;
    fields[path] = vm;
  }

  // Ledger: user changes with implied children, tiered (R5, R9)
  const tierOf = path => {
    const t = ui.fields[path]?.tier;
    if (t !== 'dynamic') return t ?? 3;
    let max = 3;
    for (const im of implied.values()) if (im.cause.root === path && im.path !== path) max = maxTier(max, tierOf(im.path));
    return max;
  };
  const entries = [];
  for (const { path, value } of pending) {
    const overridden = implied.has(path);
    if (!overridden && value === base[path]) continue;
    entries.push({
      path, label: ui.fields[path]?.label ?? path, from: base[path], to: cfg[path], requested: value, tier: tierOf(path), overridden: overridden ? implied.get(path).cause : null,
      children: [...implied.values()].filter(im => im.cause.root === path && im.path !== path && im.to !== im.from)
        .map(im => ({ ...im, label: ui.fields[im.path]?.label ?? im.path, tier: tierOf(im.path) })),
    });
  }
  const system = [...implied.values()].filter(im => !im.cause.root && im.to !== im.from)
    .map(im => ({ ...im, label: ui.fields[im.path]?.label ?? im.path, tier: tierOf(im.path) }));
  let applyTier = null;
  for (const e of entries) { applyTier = maxTier(applyTier, e.tier); for (const c of e.children) applyTier = maxTier(applyTier, c.tier); }
  const changeCount = entries.length + entries.reduce((n, e) => n + e.children.length, 0);

  // Insights (B4)
  const insights = bundle.insights.rules.filter(r => test(r.when, env)).map(r => ({
    id: r.id, severity: r.severity, category: r.category,
    title: interpolate(r.title, env), detail: interpolate(r.detail, env),
    action: r.action ? {
      ...r.action, label: interpolate(r.action.label, env),
      changes: r.action.changes && Object.fromEntries(Object.entries(r.action.changes).map(([k, v]) => {
        const s = interpolate(v, env);
        return [k, typeof v === 'string' && /^\{/.test(v) && !Number.isNaN(Number(s)) ? Number(s) : s];
      })),
    } : null,
  }));

  return { cfg, der, est, fields, ledger: { entries, system, applyTier, changeCount }, insights, unavailable, context };
}

function hasGatedOptions(path, f, deps) {
  return Boolean(f.options?.some(o => o.gate)) || deps.rules.some(r => r.effects.some(e => e.action === 'excludeOptions' && e.targets.includes(path)));
}

function resolveOptions(path, f, cfg, facts, bundle, der, ruleHits, env) {
  const opts = baseOptions(path, f, cfg, facts, bundle, der);
  for (const o of opts) {
    o.status ??= 'ok';
    if (o.gate?.hw && !test(o.gate.hw, env)) { o.status = 'hidden'; o.reason = o.gate.hwReason; }
    for (const g of o.gate?.os ?? []) if (o.status === 'ok' && test(g.when, env)) { o.status = 'blocked'; o.reason = g.reason; o.fix = g.fix; }
    delete o.gate;
  }
  for (const r of ruleHits) for (const e of r.effects) {
    if (e.action !== 'excludeOptions' || !e.targets.includes(path)) continue;
    for (const o of opts) {
      if (!e.options.includes(o.value) || o.status === 'hidden') continue;
      if (e.kind === 'hw') { o.status = 'hidden'; o.reason = interpolate(e.reason, env); }
      else if (o.status === 'ok') { o.status = 'locked'; o.reason = interpolate(e.reason, env); o.controller = r.controller; }
    }
  }
  return opts;
}

function pickFallback(opts, current, prevScale = null) {
  const usable = opts.filter(o => o.status === 'ok' && !(o.disclosure && o.value === 'custom'));
  if (!usable.length) return null;
  // Nearest render scale for upscaler modes, otherwise the first usable option ("off" for providers)
  const scale = opts.find(o => o.value === current)?.scale ?? prevScale;
  if (scale != null) {
    return usable.filter(o => o.scale != null).sort((a, b) => Math.abs(a.scale - scale) - Math.abs(b.scale - scale))[0]?.value ?? usable[0].value;
  }
  if (typeof current === 'string' && /^FrameGeneration_\dx$/.test(current)) return usable.at(-1).value;
  return usable[0].value;
}

function labelFor(value, opts, bundle) {
  return opts.find(o => o.value === value)?.label
    ?? bundle?.providers.upscaling.flatMap(p => p.modes).find(m => m.id === value)?.label
    ?? value;
}

export function maxTier(a, b) {
  if (a == null) return b;
  if (b == null) return a;
  return TIER_ORDER[b] > TIER_ORDER[a] ? b : a;
}
