// Facet grouping for the explorer — pure functions over the engine's view model (no DOM).
//
//   buildTree(vm, bundle, levels) -> { name, count, children: [...] }   (d3.hierarchy-ready)
//
// Every field becomes one leaf. Each entry in `levels` is a FACETS key; a field's value for that
// facet picks its branch. Single-valued facets only, so a field appears exactly once in the tree.
import { TIER_LABEL } from './engine.js';

const SCOPE_NAME = { single: 'Single screen', triple: 'Triple screen', hmd: 'VR' };

// Status: what the player sees for this field right now, on this rig.
export const STATUS = {
  editable: { label: 'Editable', order: 0 },
  locked: { label: 'Locked by dependency', order: 1 },
  blocked: { label: 'Needs Windows fix', order: 2 },
  readOnly: { label: 'Read-only here', order: 3 },
  derived: { label: 'Calculated', order: 4 },
  hidden: { label: 'Hidden', order: 5 },
};
export const statusOf = f => (f.visible ? f.state : 'hidden');

const TIER_ORDER = ['3', '2', '1', 'R', 'dynamic', 'none'];
const DISC_ORDER = ['basic', 'advanced', 'expert'];

// key -> { label, get(field, ctx) -> branch label, order?(ctx) -> branch labels in display order }
export const FACETS = {
  tier: {
    label: 'Apply tier (cost)',
    get: f => f.tier == null ? 'No apply cost' : f.tier === 'dynamic' ? 'Tier varies' : TIER_LABEL[f.tier],
    order: () => TIER_ORDER.map(t => t === 'none' ? 'No apply cost' : t === 'dynamic' ? 'Tier varies' : TIER_LABEL[t]),
  },
  group: {
    label: 'Group',
    get: (f, { bundle }) => bundle.ui.groups.find(g => g.id === f.group)?.label ?? f.group,
    order: ({ bundle }) => bundle.ui.groups.map(g => g.label),
  },
  section: {
    label: 'Section',
    get: (f, { bundle }) => bundle.ui.groups.find(g => g.id === f.group)?.sections.find(s => s.id === f.section)?.label ?? f.section,
    order: ({ bundle }) => bundle.ui.groups.flatMap(g => g.sections.map(s => s.label)),
  },
  status: {
    label: 'Status on this PC',
    get: f => STATUS[statusOf(f)].label,
    order: () => Object.values(STATUS).map(s => s.label),
  },
  cause: {
    label: 'Why (cause)',
    get: (f, { vm, bundle }) => {
      const s = statusOf(f);
      if (s === 'locked') return `Controlled by ${bundle.ui.fields[f.controller]?.label ?? f.controller}`;
      if (s === 'hidden') {
        if (f.hiddenKind === 'scope') return `Not used in ${SCOPE_NAME[vm.der.scope] ?? vm.der.scope}`;
        if (f.hiddenKind === 'hw') return `Not supported: ${f.reason ?? 'hardware'}`;
        if (f.hiddenKind === 'conditional') return 'Only shown when relevant';
        return 'Hidden by a dependency';
      }
      if (s === 'blocked' || s === 'readOnly') return f.reason ?? 'Unknown';
      if (s === 'derived') return 'Calculated from other settings';
      if (f.coupled) return `Coupled to ${bundle.ui.fields[f.coupled.controller]?.label ?? f.coupled.controller}`;
      return 'Free to change';
    },
  },
  visibility: {
    label: 'Shown in the menu now',
    get: f => !f.visible ? 'Hidden by rules' : f.disclosureHidden ? 'Behind a higher detail level' : 'Shown',
    order: () => ['Shown', 'Behind a higher detail level', 'Hidden by rules'],
  },
  disclosure: {
    label: 'Detail level',
    get: f => f.disclosure[0].toUpperCase() + f.disclosure.slice(1),
    order: () => DISC_ORDER.map(d => d[0].toUpperCase() + d.slice(1)),
  },
  role: {
    label: 'Dependency role',
    get: f => ({ independent: 'Independent', controller: 'Controller', dependent: 'Dependent', derived: 'Derived', coupled: 'Coupled' }[f.role] ?? f.role),
    order: () => ['Controller', 'Dependent', 'Coupled', 'Independent', 'Derived'],
  },
  change: {
    label: 'Change state',
    get: f => f.pending ? 'Pending (user)' : f.implied ? 'Auto (implied)' : 'Unchanged',
    order: () => ['Pending (user)', 'Auto (implied)', 'Unchanged'],
  },
  engineSupport: {
    label: 'Engine support',
    get: f => f.engineSupport === 'proposed' ? 'v4 proposal' : 'Shipping (v2)',
    order: () => ['Shipping (v2)', 'v4 proposal'],
  },
  preview: {
    label: 'Preview kind',
    get: f => f.preview ?? 'none',
  },
};

export const PRESETS = [
  { id: 'cost', label: 'What does it cost?', levels: ['tier', 'group'] },
  { id: 'why', label: 'Why is it locked or hidden?', levels: ['status', 'cause'] },
  { id: 'detail', label: 'What does each detail level add?', levels: ['disclosure', 'group'] },
  { id: 'structure', label: 'Menu structure', levels: ['group', 'section'] },
  { id: 'roles', label: 'Who controls whom?', levels: ['role', 'group'] },
];

export function buildTree(vm, bundle, levels, rootName = 'All settings') {
  const ctx = { vm, bundle };
  const fields = Object.values(vm.fields);
  const nest = (items, depth) => {
    if (depth === levels.length) {
      return items.map(f => ({ name: f.label, path: f.path, field: f, count: 1 }));
    }
    const facet = FACETS[levels[depth]];
    const buckets = new Map();
    for (const f of items) {
      const k = facet.get(f, ctx);
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(f);
    }
    const order = facet.order?.(ctx) ?? [];
    const rank = k => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
    return [...buckets.entries()]
      .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
      .map(([name, list]) => ({ name, facet: levels[depth], count: list.length, children: nest(list, depth + 1) }));
  };
  return { name: rootName, count: fields.length, children: nest(fields, 0) };
}
