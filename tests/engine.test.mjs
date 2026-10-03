// Scenario tests for the rules engine. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, fromV2, toV2 } from '../mockups/engine.js';
import { buildTree, FACETS, PRESETS } from '../mockups/facets.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = p => JSON.parse(readFileSync(join(root, p), 'utf8'));
const bundle = {
  ui: load('schema/video_settings_ui_schema_Version4.json'),
  deps: load('schema/video_settings.dependencies_Version3.json'),
  providers: load('schema/upscaling_providers.json'),
  insights: load('schema/insights_rules.json'),
};
const v2 = load('input/raw_settings_config.json');
const rig = id => load(`fixtures/rigs/${id}.json`);

function run(id, pending = [], context) {
  const facts = rig(id);
  const base = fromV2(v2, facts, bundle);
  return evaluate({ bundle, facts, base, pending, context, disclosure: 'expert' });
}
const visibleOptions = (vm, path) => vm.fields[path].options.filter(o => o.status !== 'hidden').map(o => o.value);

test('coverage: every v2 setting maps to a v4 field or a capability output', () => {
  const v2schema = load('schema/video_settings.schema_Version2.json');
  const leaves = [];
  const walk = (node, prefix) => {
    for (const [k, n] of Object.entries(node.properties ?? {})) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (n.type === 'object' && n.properties) walk(n, p); else leaves.push(p);
    }
  };
  walk(v2schema, '');
  const covered = new Set(bundle.ui.capabilityOutputs);
  for (const [p, f] of Object.entries(bundle.ui.fields)) {
    covered.add(p);
    if (f.v2?.path) covered.add(f.v2.path);
    for (const s of f.v2?.from ?? []) covered.add(s);
  }
  covered.add('major_version');
  const missing = leaves.filter(l => !covered.has(l));
  assert.deepEqual(missing, []);
});

test('every dependency/insight path resolves to a field', () => {
  const fields = bundle.ui.fields;
  for (const r of bundle.deps.rules) {
    assert.ok(fields[r.controller], `controller ${r.controller}`);
    for (const e of r.effects) for (const t of e.targets) assert.ok(fields[t], `${r.id} target ${t}`);
  }
  for (const g of bundle.deps.presetGroups) {
    assert.ok(fields[g.parent], g.parent);
    for (const table of Object.values(g.presets)) for (const c of Object.keys(table)) assert.ok(fields[c], `${g.parent} child ${c}`);
  }
  for (const r of bundle.insights.rules) for (const p of Object.keys(r.action?.changes ?? {})) assert.ok(fields[p], `${r.id} ${p}`);
});

test('R14/A6: provider list differs per rig', () => {
  const ups = id => visibleOptions(run(id), 'graphics.upscaling.provider');
  assert.deepEqual(ups('rtx5080-single'), ['off', 'dlss', 'fsr31', 'xess']);
  assert.deepEqual(ups('rx6800-single'), ['off', 'fsr31', 'xess']);
  assert.deepEqual(ups('rx9070-triple'), ['off', 'fsr4', 'fsr31', 'xess']);
  assert.deepEqual(ups('arc-b580-dualccd'), ['off', 'fsr31', 'xess']);
  const arc = run('arc-b580-dualccd').fields['graphics.upscaling.provider'].options.find(o => o.value === 'xess');
  assert.equal(arc.tag, 'Recommended');
  const rtx = run('rtx5080-single').fields['graphics.upscaling.provider'].options;
  assert.equal(rtx.find(o => o.value === 'dlss').tag, 'Recommended');
  assert.equal(rtx.find(o => o.value === 'fsr31').tag, 'Also works');
});

test('R1: DLSS hidden on AMD and listed as unavailable', () => {
  const vm = run('rx9070-triple');
  assert.equal(vm.fields['graphics.upscaling.provider'].options.find(o => o.value === 'dlss').status, 'hidden');
  assert.ok(vm.unavailable.some(u => u.label.includes('NVIDIA DLSS')));
});

test('R13: DLSS Quality at 4K reads 2560×1440', () => {
  const vm = run('rtx5080-single', [{ path: 'graphics.upscaling.provider', value: 'dlss' }, { path: 'graphics.upscaling.mode', value: 'quality' }]);
  const q = vm.fields['graphics.upscaling.mode'].options.find(o => o.value === 'quality');
  assert.match(q.readouts[0].text, /2560×1440 → 3840×2160/);
});

test('R4: MFG 4x only on the RTX 50 rig', () => {
  const pend = [{ path: 'graphics.upscaling.provider', value: 'dlss' }, { path: 'graphics.frame_generation.provider', value: 'dlss_fg' }];
  assert.deepEqual(visibleOptions(run('rtx5080-single', pend), 'graphics.frame_generation.multiplier'), ['FrameGeneration_2x', 'FrameGeneration_3x', 'FrameGeneration_4x']);
  assert.deepEqual(visibleOptions(run('rtx4060-laptop-battery', pend), 'graphics.frame_generation.multiplier'), ['FrameGeneration_2x']);
});

test('R2: DLSS FG blocked by HAGS with a fix on the VR rig', () => {
  const vm = run('rtx4070-vr-openxr');
  const o = vm.fields['graphics.frame_generation.provider'].options.find(x => x.value === 'dlss_fg');
  assert.equal(o.status, 'blocked');
  assert.match(o.fix.url, /^ms-settings:/);
  assert.ok(vm.insights.some(i => i.id === 'hags_blocks_dlss_fg'));
});

test('R7: triple geometry only visible on the triple rig', () => {
  assert.equal(run('rtx5080-single').fields['display.triple_screen.screen_angle'].visible, false);
  assert.equal(run('rx9070-triple').fields['display.triple_screen.screen_angle'].visible, true);
  assert.equal(run('rx9070-triple').fields['display.resolution'].visible, false);
});

test('R5: turning FG on forces Reflex and adds an implied ledger child', () => {
  const vm = run('rtx5080-single', [{ path: 'graphics.upscaling.provider', value: 'dlss' }, { path: 'graphics.frame_generation.provider', value: 'dlss_fg' }]);
  assert.equal(vm.cfg['graphics.latency.mode'], 'reflex');
  const fg = vm.ledger.entries.find(e => e.path === 'graphics.frame_generation.provider');
  assert.ok(fg.children.some(c => c.path === 'graphics.latency.mode' && c.to === 'reflex'));
  const lat = vm.fields['graphics.latency.mode'];
  assert.equal(lat.options.find(o => o.value === 'off').status, 'locked');
});

test('MSAA stays editable and keeps its saved value with an upscaler active', () => {
  const vm = run('rtx5080-single', [{ path: 'graphics.upscaling.provider', value: 'dlss' }]);
  assert.equal(vm.fields['graphics.msaa'].state, 'editable');
  assert.equal(vm.cfg['graphics.msaa'], 'MSAA_4x');
  assert.ok(!vm.ledger.system.some(s => s.path === 'graphics.msaa'));
});

test('R12: switching upscaler away from DLSS drops DLSS FG as an implied child', () => {
  const vm = run('rtx5080-single', [
    { path: 'graphics.upscaling.provider', value: 'dlss' },
    { path: 'graphics.frame_generation.provider', value: 'dlss_fg' },
    { path: 'graphics.upscaling.provider', value: 'xess' },
  ].filter((p, i, a) => a.findLastIndex(q => q.path === p.path) === i));
  assert.equal(vm.cfg['graphics.frame_generation.provider'], 'off');
});

test('R6: preset cascade and flip to Custom', () => {
  const vm = run('rtx5080-single', [{ path: 'graphics.overallGraphics', value: 'videoOptionLow' }]);
  assert.equal(vm.cfg['graphics.viewDistance.quality'], 'ViewDistanceQuality_Low');
  assert.equal(vm.cfg['graphics.viewDistance.overallDistance'], 2000);
  const e = vm.ledger.entries[0];
  assert.equal(e.tier, 1, 'dynamic tier = max of children (textures are T1)');
  const vm2 = run('rtx5080-single', [{ path: 'graphics.overallGraphics', value: 'videoOptionHigh' }, { path: 'graphics.viewDistance.treeDistance', value: 4000 }]);
  assert.equal(vm2.cfg['graphics.viewDistance.quality'], 'ViewDistanceQuality_Custom');
  assert.equal(vm2.cfg['graphics.overallGraphics'], 'videoOptionCustom');
});

test('R8: context editability', () => {
  const paused = run('rtx5080-single', [], { session: 'session.paused', online: false });
  assert.equal(paused.fields['graphics.textureQuality'].state, 'readOnly');
  assert.equal(paused.fields['graphics.shadow.shadowQuality'].state, 'editable');
  const live = run('rtx5080-single', [], { session: 'session.live', online: false });
  const liveEditable = Object.values(live.fields).filter(f => f.visible && f.state === 'editable').map(f => f.path);
  for (const p of liveEditable) {
    const f = bundle.ui.fields[p];
    assert.ok(f.tier === 3, `${p} must be T3 to be live-editable`);
  }
  assert.ok(liveEditable.includes('graphics.exposureBias'));
  assert.ok(!liveEditable.includes('graphics.viewDistance.quality'));
});

test('VR: FG forced off, HMD fields visible, eye-tracked foveation hidden without eye tracking', () => {
  const vm = run('rtx4070-vr-openxr', [{ path: 'display.mode', value: 'vr' }]);
  assert.equal(vm.fields['vr.pixel_density'].visible, true);
  assert.equal(vm.fields['vr.eye_tracked_foveated_rendering'].hiddenKind, 'hw');
  assert.equal(vm.fields['graphics.frame_generation.provider'].state, 'locked');
});

test('insights fire on the intended rigs', () => {
  const ids = id => run(id).insights.map(i => i.id);
  assert.ok(ids('rtx4060-laptop-battery').includes('vram_over_budget'));
  assert.ok(ids('rtx4060-laptop-battery').includes('on_battery'));
  assert.ok(ids('rx6800-single').includes('cpu_bound'));
  assert.ok(ids('arc-b580-dualccd').includes('dual_ccd_affinity'));
  assert.ok(ids('rtx5080-single').includes('auto_hdr_active'));
  assert.ok(ids('rtx5080-single').includes('better_upscaler_available'));
});

test('toV2 round-trips the provider abstraction', () => {
  const facts = rig('rtx5080-single');
  const vm = run('rtx5080-single', [{ path: 'graphics.upscaling.provider', value: 'dlss' }, { path: 'graphics.upscaling.mode', value: 'performance' }]);
  const out = toV2(vm.cfg, v2, bundle);
  assert.equal(out.graphics.upscaling.mode, 'Upscaling_DLSS');
  assert.equal(out.graphics.upscaling.dlss_preset, 'DLSS_Performance');
  assert.equal(fromV2(out, facts, bundle)['graphics.upscaling.mode'], 'performance');
});

test('explorer: every preset places each field exactly once', () => {
  const vm = run('rx9070-triple');
  const total = Object.keys(vm.fields).length;
  const leaves = n => n.children ? n.children.flatMap(leaves) : [n];
  for (const p of PRESETS) {
    const tree = buildTree(vm, bundle, p.levels);
    const paths = leaves(tree).map(l => l.path);
    assert.equal(paths.length, total, p.id);
    assert.equal(new Set(paths).size, total, p.id);
    assert.equal(tree.children.reduce((a, c) => a + c.count, 0), total, p.id);
  }
  for (const k of Object.keys(FACETS)) assert.equal(leaves(buildTree(vm, bundle, [k])).length, total, k);
});

test('explorer: "why" branches name the controller (supersampling locked by the upscaler)', () => {
  const tree = buildTree(run('rx6800-single'), bundle, ['status', 'cause']);
  const branch = name => tree.children.find(c => c.name === name);
  assert.ok(branch('Hidden'));
  const locked = branch('Locked by dependency').children.find(c => c.name === 'Controlled by Upscaler');
  assert.ok(locked.children.some(l => l.path === 'display.supersampling'));
});
