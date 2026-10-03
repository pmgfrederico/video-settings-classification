// Tests for the review-comment log (mockups/comments.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load, save, add, edit, remove, threads, merge, toTree, fromExport, groupOf, crumbs, STORE_KEY } from '../mockups/comments.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = { ui: JSON.parse(readFileSync(join(root, 'schema/video_settings_ui_schema_Version4.json'), 'utf8')) };
const at = n => new Date(Date.UTC(2026, 9, 3, 12, 0, n));
const ctx = { rig: 'test', detail: 'expert', page: 'mockups/main-menu.html' };
const memory = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
const ids = log => log.entries.map(e => e.id).sort();

function sample() {
  const log = { v: 1, entries: [] };
  const a = add(log, { target: 'field:display.mode', kind: 'rule', text: 'VR should hide triple options', author: 'pf', ctx }, at(1));
  const b = add(log, { target: 'section:performance/upscaling', kind: 'suggestion', text: 'Order providers by vendor', ctx }, at(2));
  const c = add(log, { target: 'group:display', kind: 'question', text: 'Is HDR here or in Image?', ctx }, at(3));
  const d = add(log, { target: 'group:system', kind: 'bug', text: 'Driver version truncated', ctx }, at(4));
  return { log, a, b, c, d };
}

test('edits form a chain: the latest version is shown, older ones stay in history', () => {
  const { log, a } = sample();
  const a2 = edit(log, a.id, { kind: 'rule', text: 'VR hides triple and monitor options', author: 'pf', ctx }, at(10));
  const a3 = edit(log, a2.id, { kind: 'suggestion', text: 'VR hides triple options; keep monitor', author: 'pf', ctx }, at(11));
  const [c] = threads(log).get('field:display.mode');
  assert.equal(c.id, a3.id);
  assert.equal(c.text, 'VR hides triple options; keep monitor');
  assert.equal(c.created, a.ts);
  assert.deepEqual(c.history.map(h => h.id), [a2.id, a.id]);
  assert.equal(log.entries.length, 6, 'nothing is rewritten');
});

test('a tombstone hides the comment, but the export keeps it so imports carry the deletion', () => {
  const { log, b } = sample();
  remove(log, b.id, { ctx }, at(20));
  assert.equal(threads(log).has('section:performance/upscaling'), false);
  const [c] = threads(log, { withDeleted: true }).get('section:performance/upscaling');
  assert.equal(c.deleted, true);
  assert.equal(c.history[0].text, 'Order providers by vendor');
  assert.equal(toTree(log, bundle).meta.count, 3);
});

test('merge adds only unknown ids and does not depend on order', () => {
  const { log } = sample();
  const other = { v: 1, entries: [] };
  add(other, { target: 'field:display.mode', kind: 'bug', text: 'Label wraps', ctx }, at(0));
  const x = structuredClone(log), y = structuredClone(other);
  assert.equal(merge(x, other.entries), 1);
  assert.equal(merge(x, other.entries), 0, 'importing the same file twice adds nothing');
  assert.equal(merge(y, log.entries), 4);
  assert.deepEqual(ids(x), ids(y));
  assert.deepEqual(x.entries.map(e => e.ts), [...x.entries.map(e => e.ts)].sort(), 'sorted by time');
});

test('toTree follows the navigation and puts unknown targets under orphans', () => {
  const { log } = sample();
  add(log, { target: 'field:no.such.field', kind: 'rule', text: 'stale', ctx }, at(30));
  const tree = toTree(log, bundle, at(40));
  assert.equal(tree.meta.format, 'vsc-comments');
  assert.equal(tree.meta.count, 5);
  const g = id => tree.groups.find(x => x.id === id);
  assert.deepEqual(tree.groups.map(x => x.id), ['system', 'display', 'performance'], 'only groups with comments, in nav order');
  assert.equal(g('system').comments[0].text, 'Driver version truncated');
  assert.equal(g('display').comments[0].kind, 'question');
  const mode = g('display').sections.find(s => s.id === 'mode');
  assert.deepEqual(mode.fields.map(f => f.path), ['display.mode']);
  assert.equal(mode.fields[0].label, bundle.ui.fields['display.mode'].label);
  const up = g('performance').sections.find(s => s.id === 'upscaling');
  assert.equal(up.comments[0].text, 'Order providers by vendor');
  assert.deepEqual(up.fields, []);
  assert.deepEqual(tree.orphans.map(o => o.target), ['field:no.such.field']);
});

test('fromExport(toTree(log)) gives back every entry, including history and tombstones', () => {
  const { log, a, c } = sample();
  edit(log, a.id, { kind: 'rule', text: 'v2', ctx }, at(10));
  remove(log, c.id, {}, at(11));
  const doc = JSON.parse(JSON.stringify(toTree(log, bundle)));
  const back = fromExport(doc);
  assert.deepEqual(back.map(e => e.id).sort(), ids(log));
  const fresh = { v: 1, entries: [] };
  merge(fresh, back);
  assert.deepEqual(threads(fresh), threads(log));
});

test('storage: round-trips, and survives missing, corrupt or throwing storage', () => {
  const s = memory();
  const { log } = sample();
  assert.equal(save(s, log), true);
  assert.deepEqual(load(s), log);
  s.setItem(STORE_KEY, '{not json');
  assert.deepEqual(load(s), { v: 1, entries: [] });
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.deepEqual(load(broken), { v: 1, entries: [] });
  assert.equal(save(broken, log), false);
  assert.deepEqual(load(undefined), { v: 1, entries: [] });
});

test('targets resolve to their nav group and a readable path', () => {
  assert.equal(groupOf('field:display.mode', bundle), 'display');
  assert.equal(groupOf('section:performance/upscaling', bundle), 'performance');
  assert.equal(groupOf('group:system', bundle), 'system');
  assert.equal(groupOf('field:no.such.field', bundle), null);
  assert.deepEqual(crumbs('group:system', bundle), ['System & health']);
  assert.equal(crumbs('field:display.mode', bundle).length, 3);
});
