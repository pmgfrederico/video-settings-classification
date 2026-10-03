// Review comments on the mockup: notes about rules, suggestions, questions and bugs, attached to a
// group (nav tab), a section or a field, kept in this browser and exported following the navigation.
//
// Targets:  group:<group id>   section:<group id>/<section id>   field:<field path>
// Storage:  localStorage['vsc.comments.v1'] = { v: 1, entries: Entry[] }, an append-only log.
// Entry:    { id, target, ts, kind, text, author, ctx: { rig, detail, page }, supersedes?, deleted? }
//           An edit appends an entry that supersedes the previous version; a delete appends a
//           tombstone (deleted: true). Nothing is rewritten, so imports merge by id.
import { esc } from './ui.js';

export const STORE_KEY = 'vsc.comments.v1';
export const AUTHOR_KEY = 'vsc.comments.author';
export const KINDS = ['rule', 'suggestion', 'question', 'bug'];
const KIND_ICON = { rule: 'rule', suggestion: 'lightbulb', question: 'help', bug: 'bug_report' };
const SYSTEM_GROUP = { id: 'system', label: 'System & health', sections: [] };
const SCHEMA = 'video_settings_ui_schema_Version4';

// ---------------------------------------------------------------------------
// Log (pure, no DOM)
// ---------------------------------------------------------------------------
const empty = () => ({ v: 1, entries: [] });
const uuid = () => globalThis.crypto?.randomUUID?.() ?? `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const isEntry = e => e && typeof e.id === 'string' && typeof e.target === 'string' && typeof e.ts === 'string';

export function load(storage) {
  try {
    const log = JSON.parse(storage?.getItem(STORE_KEY) ?? 'null');
    return log?.v === 1 && Array.isArray(log.entries) ? { v: 1, entries: log.entries.filter(isEntry) } : empty();
  } catch { return empty(); }
}
export function save(storage, log) {
  try { storage.setItem(STORE_KEY, JSON.stringify(log)); return true; } catch { return false; }
}

function append(log, entry, now) {
  const e = Object.fromEntries(Object.entries({ id: uuid(), ts: (now ?? new Date()).toISOString(), ...entry }).filter(([, v]) => v !== undefined));
  log.entries.push(e);
  return e;
}
export const add = (log, { target, kind, text, author, ctx }, now) =>
  append(log, { target, kind, text, author: author || undefined, ctx }, now);
export function edit(log, id, { kind, text, author, ctx }, now) {
  const prev = log.entries.find(e => e.id === id);
  if (!prev) return null;
  return append(log, { target: prev.target, kind, text, author: author || undefined, ctx, supersedes: id }, now);
}
export function remove(log, id, { author, ctx } = {}, now) {
  const prev = log.entries.find(e => e.id === id);
  if (!prev) return null;
  return append(log, { target: prev.target, deleted: true, author: author || undefined, ctx, supersedes: id }, now);
}

// Latest version of every comment chain, grouped by target. Each comment carries `created` (the
// first version's time) and `history` (older versions, newest first). Deleted chains are left out
// unless withDeleted is set (the export keeps them so an import can carry the deletion).
export function threads(log, { withDeleted = false } = {}) {
  const byId = new Map(log.entries.map(e => [e.id, e]));
  const superseded = new Set(log.entries.map(e => e.supersedes).filter(Boolean));
  const out = new Map();
  for (const head of log.entries) {
    if (superseded.has(head.id) || (head.deleted && !withDeleted)) continue;
    const history = [];
    for (let p = byId.get(head.supersedes); p; p = byId.get(p.supersedes)) history.push(p);
    const c = { ...head, created: (history.at(-1) ?? head).ts, history };
    if (!out.has(head.target)) out.set(head.target, []);
    out.get(head.target).push(c);
  }
  for (const list of out.values()) list.sort((a, b) => a.created.localeCompare(b.created));
  return out;
}

export function merge(log, entries) {
  const have = new Set(log.entries.map(e => e.id));
  let added = 0;
  for (const e of entries) {
    if (!isEntry(e) || have.has(e.id)) continue;
    log.entries.push(e); have.add(e.id); added++;
  }
  log.entries.sort((a, b) => a.ts.localeCompare(b.ts));
  return added;
}

// Which nav group a target belongs to (for counts on the nav items).
export function groupOf(target, bundle) {
  const [type, rest] = splitTarget(target);
  if (type === 'group') return rest;
  if (type === 'section') return rest.split('/')[0];
  if (type === 'field') return bundle.ui.fields[rest]?.group ?? null;
  return null;
}
const splitTarget = t => { const i = t.indexOf(':'); return [t.slice(0, i), t.slice(i + 1)]; };

// Human-readable path to a target: [group label, section label, field label].
export function crumbs(target, bundle) {
  const [type, rest] = splitTarget(target);
  const groups = [SYSTEM_GROUP, ...bundle.ui.groups];
  const g = id => groups.find(x => x.id === id);
  if (type === 'group') return [g(rest)?.label ?? rest];
  if (type === 'section') { const [gid, sid] = rest.split('/'); return [g(gid)?.label ?? gid, g(gid)?.sections.find(s => s.id === sid)?.label ?? sid]; }
  const f = bundle.ui.fields[rest];
  if (!f) return [rest];
  return [g(f.group)?.label ?? f.group, g(f.group)?.sections.find(s => s.id === f.section)?.label ?? f.section, f.label];
}

// Export document: comments nested as group → section → field, following the mock's navigation.
// Every schema node is walked (not the DOM), so comments on fields hidden for the current rig or
// detail level are included. Targets that are not in the schema any more land in `orphans`.
export function toTree(log, bundle, now) {
  const thr = threads(log, { withDeleted: true });
  const used = new Set();
  const take = t => { used.add(t); return (thr.get(t) ?? []).map(exportComment); };
  const fieldsOf = (gid, sid) => Object.entries(bundle.ui.fields).filter(([, f]) => f.group === gid && f.section === sid);
  const groups = [];
  for (const g of [SYSTEM_GROUP, ...bundle.ui.groups]) {
    const sections = [];
    for (const s of g.sections) {
      const fields = fieldsOf(g.id, s.id).map(([path, f]) => ({ path, label: f.label, comments: take(`field:${path}`) })).filter(f => f.comments.length);
      const comments = take(`section:${g.id}/${s.id}`);
      if (comments.length || fields.length) sections.push({ id: s.id, label: s.label, comments, fields });
    }
    const comments = take(`group:${g.id}`);
    if (comments.length || sections.length) groups.push({ id: g.id, label: g.label, comments, sections });
  }
  const orphans = [...thr.keys()].filter(t => !used.has(t)).map(t => ({ target: t, comments: thr.get(t).map(exportComment) }));
  const count = [...thr.values()].flat().filter(c => !c.deleted).length;
  return { meta: { format: 'vsc-comments', v: 1, exportedAt: (now ?? new Date()).toISOString(), schema: SCHEMA, count }, groups, orphans };
}
const exportComment = ({ created, history, ...head }) => ({ ...head, created, history });

// Inverse of toTree: every object that looks like an entry, including the versions in `history`.
export function fromExport(doc) {
  const out = [];
  const walk = v => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== 'object') return;
    if (isEntry(v)) { const { created, history, ...e } = v; out.push(e); walk(history); return; }
    Object.values(v).forEach(walk);
  };
  walk(doc);
  return out;
}

// ---------------------------------------------------------------------------
// Page controller (DOM)
// ---------------------------------------------------------------------------
// opts: { bundle, storage, layer, toast(html), context() → { rig, detail, page },
//         onChange() after any change, navigate(target) to show a target on the page }
export function createComments({ bundle, storage, layer, toast, context, onChange, navigate }) {
  const log = load(storage);
  let thr = threads(log);
  const readAuthor = () => { try { return storage.getItem(AUTHOR_KEY) ?? ''; } catch { return ''; } };
  const writeAuthor = a => { try { storage.setItem(AUTHOR_KEY, a); } catch {} };
  const changed = () => {
    thr = threads(log);
    if (!save(storage, log)) toast('<span class="ms">warning</span>Could not save comments in this browser');
    onChange();
  };
  const close = () => { layer.innerHTML = ''; layer.onclick = null; };
  const total = () => [...thr.values()].reduce((n, l) => n + l.length, 0);
  const count = target => thr.get(target)?.length ?? 0;
  const groupCount = gid => [...thr].filter(([t]) => groupOf(t, bundle) === gid).reduce((n, [, l]) => n + l.length, 0);

  const button = target => {
    const n = count(target);
    return `<button class="cmt-btn${n ? ' has' : ''}" data-comment="${esc(target)}" title="${n ? `${n} comment${n > 1 ? 's' : ''}` : 'Add a comment'}"><span class="ms">${n ? 'chat' : 'add_comment'}</span>${n || ''}</button>`;
  };

  const when = ts => new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const kindChip = k => `<span class="cmt-kind k-${esc(k)}"><span class="ms">${KIND_ICON[k] ?? 'chat'}</span>${esc(k)}</span>`;
  const version = (e, label) => `<div class="cmt-ver"><div class="cmt-meta">${kindChip(e.kind)}<span>${esc(label)} ${esc(when(e.ts))}</span>${e.author ? `<span>· ${esc(e.author)}</span>` : ''}</div><div class="cmt-text">${esc(e.text)}</div></div>`;

  // ----- one target's thread -----
  function openThread(target) {
    const st = { editing: null, kind: 'suggestion', text: '', open: new Set() };
    const draw = () => {
      const list = thr.get(target) ?? [];
      const path = crumbs(target, bundle);
      const items = list.map(c => `<div class="cmt">
        <div class="cmt-meta">${kindChip(c.kind)}<span>${esc(c.author || 'Anonymous')}</span><span>· ${esc(when(c.ts))}</span>
          ${c.history.length ? `<button class="linkish" data-cmt-hist="${esc(c.id)}">edited ×${c.history.length}</button>` : ''}
          <span class="cmt-actions"><button class="icon-btn" data-cmt-edit="${esc(c.id)}" title="Edit"><span class="ms">edit</span></button><button class="icon-btn" data-cmt-del="${esc(c.id)}" title="Delete"><span class="ms">delete</span></button></span></div>
        <div class="cmt-text">${esc(c.text)}</div>
        ${st.open.has(c.id) ? `<div class="cmt-hist">${c.history.map(h => version(h, 'Earlier version ·')).join('')}</div>` : ''}
      </div>`).join('');
      layer.innerHTML = `<div class="overlay"><div class="modal cmt-modal" role="dialog" aria-label="Comments">
        <div class="cmt-crumb">${path.map((p, i) => i === path.length - 1 ? `<b>${esc(p)}</b>` : `${esc(p)} <span class="ms">chevron_right</span>`).join(' ')}<span class="cmt-key">${esc(target)}</span></div>
        <h3>Comments</h3>
        <div class="cmt-list">${items || '<div class="note">No comments yet. What rule or change would you suggest here?</div>'}</div>
        <div class="cmt-form">
          <div class="seg cmt-kinds">${KINDS.map(k => `<button class="${k === st.kind ? 'on' : ''}" data-cmt-kind="${k}"><span class="ms">${KIND_ICON[k]}</span>${k}</button>`).join('')}</div>
          <textarea id="cmt-text" rows="4" placeholder="${st.editing ? 'Edit the comment' : 'Describe the rule, suggestion, question or bug'}">${esc(st.text)}</textarea>
          <div class="cmt-row"><input id="cmt-author" placeholder="Your name (optional)" value="${esc(readAuthor())}">
            <span class="cmt-hint">Ctrl+Enter to save</span>
            ${st.editing ? '<button class="btn" data-cmt-cancel>Cancel edit</button>' : '<button class="btn" data-cmt-close>Close</button>'}
            <button class="btn btn-primary" data-cmt-save>${st.editing ? 'Save edit' : 'Add comment'}</button></div>
        </div></div></div>`;
      const ta = layer.querySelector('#cmt-text');
      ta.oninput = () => { st.text = ta.value; };
      ta.onkeydown = e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } };
      layer.querySelector('#cmt-author').oninput = e => writeAuthor(e.target.value.trim());
      ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    };
    const submit = () => {
      const text = st.text.trim();
      if (!text) return layer.querySelector('#cmt-text').focus();
      const author = layer.querySelector('#cmt-author').value.trim();
      writeAuthor(author);
      if (st.editing) edit(log, st.editing, { kind: st.kind, text, author, ctx: context() });
      else add(log, { target, kind: st.kind, text, author, ctx: context() });
      Object.assign(st, { editing: null, text: '' });
      changed(); draw();
    };
    layer.onclick = e => {
      if (e.target.classList.contains('overlay') || e.target.closest('[data-cmt-close]')) return close();
      const t = e.target.closest('[data-cmt-kind],[data-cmt-save],[data-cmt-cancel],[data-cmt-edit],[data-cmt-del],[data-cmt-hist]');
      if (!t) return;
      const d = t.dataset;
      if (d.cmtKind) { st.kind = d.cmtKind; return draw(); }
      if ('cmtSave' in d) return submit();
      if ('cmtCancel' in d) { Object.assign(st, { editing: null, text: '' }); return draw(); }
      if (d.cmtHist) { st.open.has(d.cmtHist) ? st.open.delete(d.cmtHist) : st.open.add(d.cmtHist); return draw(); }
      const c = thr.get(target)?.find(x => x.id === (d.cmtEdit ?? d.cmtDel));
      if (!c) return;
      if (d.cmtEdit) { Object.assign(st, { editing: c.id, kind: c.kind, text: c.text }); return draw(); }
      if (d.cmtDel) { remove(log, c.id, { author: readAuthor(), ctx: context() }); if (st.editing === c.id) Object.assign(st, { editing: null, text: '' }); changed(); draw(); toast('<span class="ms">delete</span>Comment deleted'); }
    };
    draw();
  }

  // ----- collection panel (devbar) -----
  let yamlLib;
  const yaml = () => (yamlLib ??= import('https://cdn.jsdelivr.net/npm/js-yaml@4.1.0/+esm').then(m => m.default ?? m));
  async function serialize(fmt) {
    const doc = toTree(log, bundle);
    if (fmt === 'yaml') return (await yaml()).dump(doc, { lineWidth: 120, noRefs: true, skipInvalid: true });
    return JSON.stringify(doc, null, 2);
  }

  function openPanel() {
    const st = { view: 'tree', confirmClear: false, text: '' };
    const fmt = () => (st.view === 'yaml' ? 'yaml' : 'json');
    const row = (target, label, level) => {
      const list = thr.get(target) ?? [];
      return list.length ? `<li class="cmt-node l${level}"><button class="cmt-go" data-cmt-go="${esc(target)}"><span>${esc(label)}</span><span class="cmt-n">${list.length}</span></button>
        <ul class="cmt-items">${list.map(c => `<li>${kindChip(c.kind)}<span class="cmt-snip">${esc(c.text)}</span><span class="cmt-by">${esc(c.author || 'Anonymous')} · ${esc(when(c.ts))}${c.history.length ? ` · edited ×${c.history.length}` : ''}</span></li>`).join('')}</ul></li>` : '';
    };
    const tree = () => {
      const doc = toTree(log, bundle);
      if (!doc.meta.count) return '<div class="note">No comments yet. Use the <span class="ms">add_comment</span> buttons on groups, sections and settings to add one.</div>';
      const live = t => (thr.get(t)?.length ?? 0) > 0;
      const groupsHtml = doc.groups.map(g => {
        const secs = g.sections.map(s => {
          const fields = s.fields.filter(f => live(`field:${f.path}`)).map(f => row(`field:${f.path}`, f.label, 3)).join('');
          const own = row(`section:${g.id}/${s.id}`, s.label, 2);
          return fields || own ? `<li class="cmt-sec"><div class="cmt-h2">${esc(s.label)}</div><ul>${own}${fields}</ul></li>` : '';
        }).join('');
        const own = row(`group:${g.id}`, g.label, 1);
        return secs || own ? `<li class="cmt-grp"><div class="cmt-h1">${esc(g.label)}</div><ul>${own}${secs}</ul></li>` : '';
      }).join('');
      const orphans = doc.orphans.filter(o => live(o.target)).map(o => row(o.target, o.target, 1)).join('');
      return `<ul class="cmt-tree">${groupsHtml}${orphans ? `<li class="cmt-grp"><div class="cmt-h1">Not in the schema any more</div><ul>${orphans}</ul></li>` : ''}</ul>`;
    };
    const draw = () => {
      const n = total();
      layer.innerHTML = `<div class="overlay"><div class="modal cmt-panel" role="dialog" aria-label="Review comments">
        <h3>Review comments <span class="badge">${n}</span></h3>
        <p>Kept in this browser. Export them to hand over, or import a file from another reviewer: comments are merged, nothing is overwritten.</p>
        <div class="cmt-toolbar">
          <div class="seg">${[['tree', 'Overview'], ['json', 'JSON'], ['yaml', 'YAML']].map(([v, l]) => `<button class="${st.view === v ? 'on' : ''}" data-cmt-view="${v}">${l}</button>`).join('')}</div>
          <span class="cmt-sp"></span>
          <button class="btn" data-cmt-copy ${n ? '' : 'disabled'}><span class="ms">content_copy</span>Copy ${fmt().toUpperCase()}</button>
          <button class="btn" data-cmt-dl ${n ? '' : 'disabled'}><span class="ms">download</span>Download ${fmt().toUpperCase()}</button>
          <button class="btn" data-cmt-import><span class="ms">upload</span>Import</button>
          <input type="file" id="cmt-file" accept=".json,.yaml,.yml,application/json,text/yaml" hidden>
        </div>
        <div class="cmt-body">${st.view === 'tree' ? tree() : `<pre class="diff">${esc(st.text)}</pre>`}</div>
        <div class="cmt-foot">
          <button class="btn cmt-danger" data-cmt-clear ${n || log.entries.length ? '' : 'disabled'}>${st.confirmClear ? 'Click again to delete every comment' : '<span class="ms">delete_sweep</span>Clear all'}</button>
          <span class="cmt-sp"></span><button class="btn" data-cmt-close>Close</button>
        </div></div></div>`;
      layer.querySelector('#cmt-file').onchange = e => importFile(e.target.files[0]);
    };
    const refresh = async () => {
      if (st.view !== 'tree') {
        try { st.text = await serialize(st.view); } catch { st.text = 'Could not load the YAML library (needs network access). Use JSON instead.'; }
      }
      draw();
    };
    async function importFile(file) {
      if (!file) return;
      const raw = await file.text();
      let doc;
      try { doc = JSON.parse(raw); } catch {
        try { doc = (await yaml()).load(raw); } catch { return toast('<span class="ms">error</span>Not a JSON or YAML file'); }
      }
      const entries = fromExport(doc);
      if (!entries.length) return toast('<span class="ms">info</span>No comments found in that file');
      const added = merge(log, entries);
      changed(); refresh();
      toast(`<span class="ms">check_circle</span>${added ? `${added} entr${added === 1 ? 'y' : 'ies'} imported` : 'Nothing new: all comments were already here'}`, 1800);
    }
    layer.onclick = async e => {
      if (e.target.classList.contains('overlay') || e.target.closest('[data-cmt-close]')) return close();
      const t = e.target.closest('[data-cmt-view],[data-cmt-copy],[data-cmt-dl],[data-cmt-import],[data-cmt-clear],[data-cmt-go]');
      if (!t) return;
      const d = t.dataset;
      if (!('cmtClear' in d)) st.confirmClear = false;
      if (d.cmtView) { st.view = d.cmtView; return refresh(); }
      if (d.cmtGo) { close(); navigate(d.cmtGo); return openThread(d.cmtGo); }
      if ('cmtImport' in d) return layer.querySelector('#cmt-file').click();
      if ('cmtCopy' in d) {
        try { await navigator.clipboard.writeText(await serialize(fmt())); toast('<span class="ms">content_copy</span>Copied to the clipboard'); }
        catch { toast('<span class="ms">error</span>Could not copy (clipboard blocked)'); }
        return;
      }
      if ('cmtDl' in d) {
        const f = fmt(), stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
        const url = URL.createObjectURL(new Blob([await serialize(f)], { type: f === 'yaml' ? 'text/yaml' : 'application/json' }));
        const a = Object.assign(document.createElement('a'), { href: url, download: `comments-${stamp}.${f}` });
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return;
      }
      if ('cmtClear' in d) {
        if (!st.confirmClear) { st.confirmClear = true; return draw(); }
        log.entries.length = 0; st.confirmClear = false;
        changed(); refresh(); toast('<span class="ms">delete_sweep</span>All comments cleared');
      }
    };
    refresh();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && layer.querySelector('.cmt-modal,.cmt-panel')) close(); });

  return { button, count, groupCount, total, openThread, openPanel, get log() { return log; } };
}
