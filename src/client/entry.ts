import { pan, zoomAt, fit, type Camera, type DragStart } from './camera.js';
import { buildGraph } from '../domain/graph.js';
import { selectLabel, isBoilerplateTitle } from './session-store.js';

declare const window: any, document: any, ResizeObserver: any;
type Row = { id: string; sessionId: string | null; directionId: string | null; parentSessionId: string | null; repoId: string | null;
  label: string; cwd: string | null; archived: boolean; presence: string; state: string; brief: string; displayName: string };
export function overviewRows(data: any, catalogue: any = {}): Row[] {
  const directions = new Map(data.directions.map((d: any) => [d.id, d]));
  const rows: Row[] = data.sessions.map((s: any) => {
    const d: any = directions.get(s.directionId), host = catalogue.byId?.[s.sessionId];
    const authoritativeTitle = typeof host?.title === 'string' && (!isBoilerplateTitle(host.title) || s.label?.source === 'user') ? host.title : null;
    const label = selectLabel({ userTitle: authoritativeTitle ?? (s.label?.source === 'user' ? s.label.text : null), hostTitle: s.label?.source === 'host' ? s.label.text : null, brief: d?.brief,
      summary: s.label?.source === 'summary' ? s.label.text : null, sessionId: s.sessionId });
    return { id: s.sessionId, sessionId: s.sessionId, directionId: d?.id ?? null, parentSessionId: s.parentSessionId, repoId: s.repoId,
      label: label?.text ?? s.sessionId, cwd: s.cwd, archived: s.archived, presence: s.presence, state: d?.state ?? 'session', brief: d?.brief ?? '', displayName: d?.displayName ?? '' };
  });
  for (const d of data.directions) if (!rows.some(r => r.directionId === d.id)) rows.push({ id: `direction:${d.id}`, sessionId: d.primarySessionId, directionId: d.id, parentSessionId: null, repoId: d.repoId,
    label: d.displayName, displayName: d.displayName, cwd: data.worktrees.find((w: any) => w.id === d.worktreeId)?.canonicalPath ?? null, archived: false, presence: 'unknown', state: d.state, brief: d.brief ?? '' });
  return rows;
}
export function layoutRows(rows: Row[]) {
  const ids = new Set(rows.map(r => r.id));
  const graph = buildGraph(rows.map(r => ({ id: r.id, kind: r.directionId ? 'direction' as const : 'session' as const })),
    rows.filter(r => r.parentSessionId && ids.has(r.parentSessionId)).map(r => ({ id: `edge:${r.id}`, sourceId: r.parentSessionId!, targetId: r.id })));
  const cyclic = new Set(graph.issues.filter(i => i.code === 'cycle').flatMap(i => i.ids)), byId = new Map(rows.map(r => [r.id, r]));
  const depths = new Map<string, number>();
  for (const row of rows) {
    let current = row, depth = 0, seen = new Set<string>();
    while (current.parentSessionId && byId.has(current.parentSessionId) && !cyclic.has(current.id) && !seen.has(current.id)) {
      seen.add(current.id); depth++; current = byId.get(current.parentSessionId)!;
    }
    depths.set(row.id, Math.min(depth, 12));
  }
  const positions = new Map(rows.map((r, i) => [r.id, { x: (depths.get(r.id) ?? 0) * 300 + 18, y: i * 90 + 18 }]));
  return { positions, graph, width: Math.max(320, ...[...positions.values()].map(p => p.x + 278)), height: Math.max(120, rows.length * 90 + 18) };
}
const zh: Record<string, string> = {
  title: '走向总览', fork: '创建走向', close: '关闭', list: '列表', graph: '关系图', search: '搜索会话、走向、路径', refresh: '刷新', open: '打开会话', fit: '适应画布', more: '显示更多',
  name: '走向名称', brief: '交接说明', inherit: '继承此处已完成的对话', blank: '从空对话开始', carry: '携带当前未提交文件', create: '创建并打开', creating: '正在创建…',
  noSource: '请先打开一个会话', source: '源会话', operations: '操作记录', recover: '继续恢复', merge: '合入父工作树', sync: '同步父工作树', remove: '移除已合入走向', unarchive: '取消归档',
  empty: '没有匹配项', archived: '已归档', current: '当前会话', all: '所有仓库', details: '详情', noSelection: '选择会话查看详情', loading: '加载中…', failed: '加载失败', retry: '重试',
  missing: '会话确实缺失', unknown: '会话状态未确认', pending: '需要恢复', saved: '已创建；会话打开失败，可从总览重新打开', conflict: '存在冲突，请在工作树中处理后重新检查',
  manual: '此操作需要检查工作树及日志后处理', check: '检查工作树', zoomIn: '放大', zoomOut: '缩小', show: '已显示', total: '总计', revision: '版本', confirmation: '确认执行',
};
const en: Record<string, string> = {
  title: 'Directions', fork: 'New direction', close: 'Close', list: 'List', graph: 'Graph', search: 'Search conversations, directions or paths', refresh: 'Refresh', open: 'Open conversation', fit: 'Fit canvas', more: 'Show more',
  name: 'Direction name', brief: 'Handoff notes', inherit: 'Inherit completed conversation at this point', blank: 'Start with an empty conversation', carry: 'Carry uncommitted files', create: 'Create and open', creating: 'Creating…',
  noSource: 'Open a conversation first', source: 'Source conversation', operations: 'Operations', recover: 'Resume recovery', merge: 'Merge into parent worktree', sync: 'Sync parent worktree', remove: 'Remove integrated direction', unarchive: 'Unarchive',
  empty: 'No matches', archived: 'Archived', current: 'Current conversation', all: 'All repositories', details: 'Details', noSelection: 'Select a conversation', loading: 'Loading…', failed: 'Failed to load', retry: 'Retry',
  missing: 'Conversation missing', unknown: 'Presence unknown', pending: 'Recovery required', saved: 'Created; opening failed. Open it from Directions.', conflict: 'Resolve worktree conflicts before checking again', manual: 'Inspect the worktree and operation journal',
  check: 'Check worktrees', zoomIn: 'Zoom in', zoomOut: 'Zoom out', show: 'Showing', total: 'Total', revision: 'Revision', confirmation: 'Confirm action',
};
const CSS = `
.bm-backdrop{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.32);display:grid;place-items:center;padding:18px;box-sizing:border-box}.bm-panel{box-sizing:border-box;max-width:100%}
.bm-panel{width:min(1120px,96vw);height:min(780px,94vh);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l3,#8888);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#202124);box-shadow:0 18px 70px #0004;font:14px/1.5 system-ui}
.bm-head,.bm-toolbar,.bm-foot{padding:12px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l3,#8886)}
.bm-head h2{font-size:18px;margin:0;flex:1}.bm-panel button,.bm-panel input,.bm-panel select,.bm-panel textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l3,#8888);border-radius:7px;padding:7px 10px}
.bm-panel button{cursor:pointer}.bm-panel button:disabled{opacity:.5;cursor:default}.bm-panel button[aria-pressed=true],.bm-row[aria-selected=true]{border-color:#4285cf;background:var(--dsw-alias-interactive-bg-active,#4386cc18)}
.bm-panel :focus-visible{outline:2px solid #4285cf;outline-offset:2px}.bm-toolbar input{flex:1;min-width:160px}.bm-body{display:flex;flex:1;min-height:0}.bm-list{flex:1;overflow:auto;padding:10px;min-width:0}.bm-row{width:100%;display:flex;text-align:left;flex-direction:column;margin-bottom:6px;gap:3px}.bm-line{display:flex;gap:8px;align-items:center;max-width:100%}.bm-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.bm-muted{font-size:12px;opacity:.7;word-break:break-word}.bm-chip{font-size:11px;border:1px solid #8886;border-radius:5px;padding:0 5px}.bm-detail{width:290px;overflow:auto;border-left:1px solid #8886;padding:16px;display:flex;flex-direction:column;gap:9px}.bm-detail h3{margin:0;word-break:break-word}.bm-canvas{flex:1;min-width:0;position:relative;overflow:hidden;touch-action:none;background:var(--dsw-alias-bg-module-platform,#80808008)}.bm-canvas svg{width:100%;height:100%;user-select:none}.bm-canvas rect{fill:var(--dsw-alias-bg-layer-1,#fff);stroke:#8888}.bm-canvas text{fill:var(--dsw-alias-label-primary,#202124)}.bm-canvas path{stroke:#8889;fill:none}.bm-canvas g[role=button]{cursor:pointer}.bm-canvas g[aria-selected=true] rect{stroke:#4285cf;stroke-width:2}.bm-error{color:var(--dsw-alias-state-warn-label,#c34242);padding:8px 18px;word-break:break-word}.bm-foot{border-top:1px solid #8886;border-bottom:0}.bm-operations{max-height:130px;overflow:auto;padding:6px 18px;border-top:1px solid #8886}.bm-operation{display:flex;gap:8px;align-items:center;padding:5px 0}.bm-operation code{font-size:11px}.bm-form{height:auto;width:min(540px,95vw)}.bm-fields{padding:18px;display:flex;flex-direction:column;gap:12px}.bm-fields label{display:flex;flex-direction:column;gap:5px}.bm-fields textarea{min-height:90px;resize:vertical}.bm-fields .bm-check{flex-direction:row;align-items:center}.bm-action{border:0;background:transparent;color:inherit;cursor:pointer;padding:4px 7px;border-radius:5px}.bm-action:hover{background:#8882}@media(max-width:760px){.bm-detail{width:210px}.bm-toolbar{padding:8px}.bm-panel{height:94vh}}@media(max-width:540px){.bm-body{flex-direction:column}.bm-detail{width:auto;max-height:180px;border-left:0;border-top:1px solid #8886}.bm-head,.bm-foot{padding:8px 12px}}
`;
export function createClient(React: any) {
  const h = React.createElement;
  const deps: any = { sessions: null, open: null, locale: null };
  let view: any = null, bound: any = null;
  const watchers = new Set<() => void>();
  const setView = (next: any) => { view = next; watchers.forEach(fn => fn()); };
  const tx = (key: string) => { try { const result = bound?.(key); if (typeof result === 'string' && result !== key && !result.endsWith(`.${key}`)) return result; } catch {} return (String(deps.locale?.locale ?? document.documentElement.lang ?? 'zh').startsWith('en') ? en : zh)[key] ?? key; };
  const cat = () => deps.sessions?.list?.getSnapshot?.() ?? {};
  function useCatalogue() {
    React.useSyncExternalStore((f: any) => deps.locale?.subscribe?.(f) ?? (() => {}), () => deps.locale?.getSnapshot?.().active ?? 'zh', () => 'zh');
    const store = deps.sessions?.list;
    const snapshot = React.useSyncExternalStore((f: any) => store?.subscribe?.(f) ?? (() => {}), cat, cat);
    return React.useMemo(() => ({ ...snapshot, current: (Object.values(snapshot.byId ?? {}) as any[]).find((s: any) => (s.retainedBy?.mainView ?? 0) > 0)?.id }), [snapshot]);
  }
  const useView = () => React.useSyncExternalStore((f: any) => { watchers.add(f); return () => watchers.delete(f); }, () => view, () => view);
  async function api(path: string, body?: any, signal?: any) {
    const response = await fetch(`/branchman/api/${path}`, { ...(body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), signal });
    const payload: any = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
    if (payload.protocolVersion !== 2 || payload.schemaVersion !== 2) throw new Error('Branchman protocol mismatch; restart the app');
    return payload.data;
  }
  async function open(id: string) {
    if (!deps.open) throw new Error('session opening service unavailable');
    for (let n = 0; n < 6; n++) {
      if (cat().byId?.[id]) { await deps.open(id); return; }
      await deps.sessions.refresh?.(); await new Promise(resolve => setTimeout(resolve, 120));
    }
    throw new Error('new conversation is not available in the client catalogue');
  }
  class Boundary extends React.Component {
    state = { error: null as any };
    static getDerivedStateFromError(error: any) { return { error }; }
    render() { return this.state.error ? h('div', { className: 'bm-backdrop' }, h('section', { className: 'bm-panel bm-form' }, h('div', { className: 'bm-error', role: 'alert' }, String(this.state.error.message)), h('button', { onClick: () => setView(null) }, tx('close')))) : this.props.children; }
  }
  function Dialog({ children, title, form = false }: any) {
    const ref = React.useRef(null);
    React.useEffect(() => {
      const before = document.activeElement;
      ref.current?.querySelector('input,button,[tabindex="0"]')?.focus();
      const keydown = (event: any) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setView(null); }
        if (event.key === 'Tab') {
          const focusables = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter((el: any) => el.getClientRects().length);
          const at = focusables.indexOf(document.activeElement), next = at < 0 ? (event.shiftKey ? focusables.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
          event.preventDefault(); event.stopPropagation(); focusables[next]?.focus();
        }
      };
      document.addEventListener('keydown', keydown, true);
      return () => { document.removeEventListener('keydown', keydown, true); if (before?.isConnected) before.focus?.(); };
    }, []);
    return h('div', { className: 'bm-backdrop' }, h('section', { ref, className: `bm-panel${form ? ' bm-form' : ''}`, role: 'dialog', 'aria-modal': true, 'aria-label': title },
      h('header', { className: 'bm-head' }, h('h2', null, title), h('button', { type: 'button', onClick: () => setView(null), 'aria-label': tx('close') }, '×')), children));
  }
  function Fork({ props }: any) {
    const catalogue = useCatalogue(), id = props?.sessionId ?? catalogue.current;
    const source = catalogue.byId?.[id];
    const [name, setName] = React.useState(''), [brief, setBrief] = React.useState(''), [history, setHistory] = React.useState('inherit'), [carry, setCarry] = React.useState(true);
    const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''), [operation, setOperation] = React.useState(null);
    const request = React.useRef(null), alive = React.useRef(true);
    React.useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const submit = async (event: any) => {
      event.preventDefault(); if (!id || !source?.cwd || busy) return;
      setBusy(true); setError('');
      const body = { sourceSessionId: id, sourceCwd: source.cwd, displayName: name.trim(), brief, history, codeSource: { kind: 'source-head', carryChanges: carry }, ...(props?.messageId ? { messageId: props.messageId } : {}) };
      // Keep the id for retry after a transport failure; a changed body gets a new id.
      const digest = JSON.stringify(body);
      if (!request.current || request.current.digest !== digest) request.current = { digest, id: window.crypto.randomUUID() };
      try {
        const result = await api('fork', { ...body, requestId: request.current.id });
        if (!alive.current) return; setOperation(result);
        if (result.state !== 'succeeded') { setError(result.code ?? tx('pending')); return; }
        const data = await api(`tree?currentSessionId=${encodeURIComponent(id)}`), dir = data.directions.find((d: any) => d.id === result.directionId);
        try { await open(dir.primarySessionId); if (alive.current) setView(null); }
        catch { if (alive.current) setError(tx('saved')); }
      } catch (e) { if (alive.current) setError(String((e as Error).message)); }
      finally { if (alive.current) setBusy(false); }
    };
    return h(Dialog, { title: tx('fork'), form: true }, h('form', { onSubmit: submit },
      h('div', { className: 'bm-fields' }, h('div', { className: 'bm-muted' }, source?.displayTitle ?? id ?? tx('noSource')),
        h('label', null, tx('name'), h('input', { value: name, maxLength: 120, required: true, disabled: busy, onChange: (e: any) => setName(e.target.value) })),
        h('label', null, tx('brief'), h('textarea', { value: brief, maxLength: 8000, disabled: busy, onChange: (e: any) => setBrief(e.target.value) })),
        h('label', null, tx('source'), h('select', { value: history, disabled: busy, onChange: (e: any) => setHistory(e.target.value) }, h('option', { value: 'inherit' }, tx('inherit')), h('option', { value: 'blank' }, tx('blank')))),
        h('label', { className: 'bm-check' }, h('input', { type: 'checkbox', checked: carry, disabled: busy, onChange: (e: any) => setCarry(e.target.checked) }), tx('carry'))),
      error && h('div', { className: 'bm-error', role: 'alert' }, error),
      operation && h('div', { className: 'bm-fields' }, h('code', null, operation.operationId), h('button', { type: 'button', onClick: () => setView({ kind: 'overview', props }) }, tx('operations'))),
      h('footer', { className: 'bm-foot' }, h('button', { type: 'submit', disabled: busy || !source?.cwd || !name.trim() || !!operation }, busy ? tx('creating') : tx('create')))));
  }
  function Graph({ rows, selected, select }: any) {
    const layout = React.useMemo(() => layoutRows(rows), [rows]);
    const [element, setElement] = React.useState(null), [size, setSize] = React.useState({ w: 800, h: 400 }), [camera, setCamera] = React.useState({ x: 10, y: 10, k: 1 });
    const cam = React.useRef(camera), drag = React.useRef(null), initialized = React.useRef(false);
    cam.current = camera;
    const doFit = () => { setCamera(fit(layout.width, layout.height, size.w, size.h)); initialized.current = true; };
    React.useEffect(() => {
      if (!element) return;
      const resize = () => { const rect = element.getBoundingClientRect(); setSize({ w: rect.width, h: rect.height }); };
      const observer = new ResizeObserver(resize); observer.observe(element); resize();
      const wheel = (event: any) => { event.preventDefault(); const box = element.getBoundingClientRect(); setCamera(zoomAt(cam.current, Math.exp(-event.deltaY * 0.0015), event.clientX - box.left, event.clientY - box.top)); };
      element.addEventListener('wheel', wheel, { passive: false });
      return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
    }, [element]);
    React.useEffect(() => { if (!initialized.current && rows.length && size.w > 0 && size.h > 0) doFit(); }, [rows.length, size.w, size.h]);
    const down = (e: any) => {
      if (e.button !== 0 || e.target.closest('[role="button"]')) return;
      element.setPointerCapture(e.pointerId); drag.current = { pointerStartX: e.clientX, pointerStartY: e.clientY, cameraStartX: cam.current.x, cameraStartY: cam.current.y, k: cam.current.k } satisfies DragStart;
    };
    const key = (e: any) => {
      if (e.key === '+' || e.key === '=') { e.preventDefault(); setCamera(zoomAt(cam.current, 1.2, size.w / 2, size.h / 2)); }
      else if (e.key === '-') { e.preventDefault(); setCamera(zoomAt(cam.current, 1 / 1.2, size.w / 2, size.h / 2)); }
      else if (e.key.toLowerCase() === 'f') { e.preventDefault(); doFit(); }
      else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) { e.preventDefault(); setCamera({ ...cam.current, x: cam.current.x + (e.key === 'ArrowLeft' ? 40 : e.key === 'ArrowRight' ? -40 : 0), y: cam.current.y + (e.key === 'ArrowUp' ? 40 : e.key === 'ArrowDown' ? -40 : 0) }); }
    };
    return h('div', { className: 'bm-canvas', ref: setElement, tabIndex: 0, 'aria-label': tx('graph'), onKeyDown: key, onPointerDown: down,
      onPointerMove: (e: any) => { if (drag.current) setCamera(pan(drag.current, e.clientX, e.clientY)); }, onPointerUp: () => { drag.current = null; }, onLostPointerCapture: () => { drag.current = null; } },
      h('svg', { viewBox: `0 0 ${size.w} ${size.h}`, 'data-camera': JSON.stringify(camera) }, h('g', { transform: `translate(${camera.x} ${camera.y}) scale(${camera.k})` },
        layout.graph.edges.map((edge: any) => { const a = layout.positions.get(edge.sourceId)!, b = layout.positions.get(edge.targetId)!; return h('path', { key: edge.id, d: `M${a.x + 264} ${a.y + 32} C${a.x + 290} ${a.y + 32},${b.x - 24} ${b.y + 32},${b.x} ${b.y + 32}` }); }),
        rows.map((row: Row) => { const p = layout.positions.get(row.id)!; return h('g', { key: row.id, role: 'button', tabIndex: 0, 'aria-label': row.label, 'aria-selected': row.id === selected, transform: `translate(${p.x} ${p.y})`, onClick: () => select(row.id), onKeyDown: (e: any) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); select(row.id); } } },
          h('rect', { width: 264, height: 68, rx: 9 }), h('text', { x: 12, y: 25, fontSize: 13 }, row.label.slice(0, 28)), h('text', { x: 12, y: 48, fontSize: 11, opacity: 0.7 }, `${row.displayName || row.state}${row.archived ? ` · ${tx('archived')}` : ''}`)); }))),
      h('div', { style: { position: 'absolute', bottom: 10, left: 10, display: 'flex', gap: 6 } },
        h('button', { onClick: () => setCamera(zoomAt(cam.current, 1.2, size.w / 2, size.h / 2)), 'aria-label': tx('zoomIn') }, '+'),
        h('button', { onClick: () => setCamera(zoomAt(cam.current, 1 / 1.2, size.w / 2, size.h / 2)), 'aria-label': tx('zoomOut') }, '−'), h('button', { onClick: doFit }, tx('fit'))));
  }
  function Overview({ props }: any) {
    const catalogue = useCatalogue(), current = props?.sessionId ?? catalogue.current;
    const [data, setData] = React.useState(null), [error, setError] = React.useState(''), [mode, setMode] = React.useState('list'), [search, setSearch] = React.useState(''), [repo, setRepo] = React.useState(''), [limit, setLimit] = React.useState(80), [selected, setSelected] = React.useState(current), [busy, setBusy] = React.useState(false), [confirm, setConfirm] = React.useState(null);
    const alive = React.useRef(true), controller = React.useRef(null), revision = React.useRef(-1), flight = React.useRef(null);
    const load = () => {
      if (flight.current) return flight.current;
      const abort = new AbortController(); controller.current = abort;
      const work = api(`tree?currentSessionId=${encodeURIComponent(current ?? '')}`, undefined, abort.signal).then(result => {
        if (alive.current && result.revision >= revision.current) { revision.current = result.revision; setData(result); setError(result.corpusError ?? ''); }
      }).catch(e => { if (alive.current && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (flight.current === work) flight.current = null; });
      flight.current = work; return work;
    };
    React.useEffect(() => { alive.current = true; void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000); return () => { alive.current = false; clearInterval(timer); controller.current?.abort(); }; }, [current]);
    const rows = React.useMemo(() => data ? overviewRows(data, catalogue) : [], [data, catalogue]);
    const matching = rows.filter((r: Row) => (!repo || r.repoId === repo) && `${r.label} ${r.displayName} ${r.cwd} ${r.brief}`.toLowerCase().includes(search.toLowerCase()));
    // Current conversation remains near the top; every match is accessible via pagination.
    const ordered = [...matching].sort((a: Row, b: Row) => Number(b.id === current) - Number(a.id === current));
    const visible = ordered.slice(0, limit), row = rows.find((r: Row) => r.id === selected);
    const doAction = async (kind: string, id: string) => {
      setBusy(true); setError('');
      try { const result = await api(kind, kind === 'recover' ? { operationId: id } : { directionId: id, requestId: window.crypto.randomUUID() });
        if (result.state && !['succeeded','ready'].includes(result.state)) throw new Error(result.code ?? tx('pending')); await load();
      } catch (e) { if (alive.current) { setError((e as Error).message); await load(); } } finally { if (alive.current) setBusy(false); }
    };
    const button = (kind: string, label = kind) => h('button', { disabled: busy, onClick: () => setConfirm({ kind, id: row.directionId }) }, tx(label));
    return h(Dialog, { title: tx('title') },
      h('div', { className: 'bm-toolbar' }, h('input', { placeholder: tx('search'), 'aria-label': tx('search'), value: search, onChange: (e: any) => { setSearch(e.target.value); setLimit(80); } }),
        h('select', { value: repo, 'aria-label': tx('all'), onChange: (e: any) => { setRepo(e.target.value); setLimit(80); } }, h('option', { value: '' }, tx('all')), ...(data?.repositories ?? []).map((r: any) => h('option', { value: r.id, key: r.id }, data.worktrees.find((w: any) => w.id === r.primaryWorktreeId)?.canonicalPath))),
        ...['list', 'graph'].map(kind => h('button', { key: kind, 'aria-pressed': mode === kind, onClick: () => setMode(kind) }, tx(kind)))),
      error && h('div', { className: 'bm-error', role: 'alert' }, error),
      h('div', { className: 'bm-body' }, mode === 'graph' ? h(Graph, { rows: visible, selected, select: setSelected }) : h('div', { className: 'bm-list', role: 'listbox', 'aria-label': tx('title') },
        !data ? tx('loading') : !matching.length ? tx('empty') : visible.map((r: Row) => h('button', { key: r.id, className: 'bm-row', role: 'option', 'aria-selected': selected === r.id, onClick: () => setSelected(r.id) },
          h('span', { className: 'bm-line' }, h('strong', { className: 'bm-label' }, r.label), r.id === current && h('span', { className: 'bm-chip' }, tx('current')), r.archived && h('span', { className: 'bm-chip' }, tx('archived')), h('span', { className: 'bm-chip' }, r.state)),
          r.displayName && h('span', { className: 'bm-muted' }, r.displayName), h('span', { className: 'bm-muted' }, r.cwd))),
        matching.length > limit && h('button', { onClick: () => setLimit(limit + 80) }, tx('more'))),
      h('aside', { className: 'bm-detail', 'aria-label': tx('details') }, row ? h(React.Fragment, null, h('h3', null, row.label), row.displayName && h('strong', null, row.displayName), h('div', { className: 'bm-muted' }, row.cwd), h('div', null, row.brief),
        h('div', { className: 'bm-muted' }, row.state), row.presence === 'missing' && h('div', { role: 'status' }, tx('missing')), row.presence === 'unknown' && h('div', { role: 'status' }, tx('unknown')),
        h('button', { disabled: !row.sessionId || row.archived || row.presence === 'missing', onClick: async () => { try { await open(row.sessionId); setView(null); } catch (e) { setError((e as Error).message); } } }, tx('open')),
        h('button', { disabled: !row.sessionId || !row.cwd || row.state === 'removed', onClick: () => setView({ kind: 'fork', props: { sessionId: row.sessionId } }) }, tx('fork')),
        row.archived && row.directionId && h('button', { disabled: busy, onClick: () => void doAction('unarchive', row.directionId) }, tx('unarchive')),
        row.directionId && row.state === 'ready' && h(React.Fragment, null, button('merge'), button('sync'), button('remove')),
        ['conflicted','recovery-required'].includes(row.state) && h(React.Fragment, null, h('div', {role:'status'}, row.state === 'conflicted' ? tx('conflict') : tx('pending')), h('button', {disabled:busy,onClick:()=>void doAction('check',row.directionId)},tx('check')))) : tx('noSelection'))),
      confirm && h('div', { className: 'bm-foot' }, h('span', null, tx(confirm.kind)), h('button', { disabled: busy, onClick: () => { const action = confirm; setConfirm(null); void doAction(action.kind, action.id); } }, tx('confirmation')), h('button', { onClick: () => setConfirm(null) }, tx('close'))),
      data?.operations?.length > 0 && h('details', { className: 'bm-operations', open: data.operations.some((o: any) => o.state === 'recovery-required') }, h('summary', null, `${tx('operations')} (${data.operations.length})`), ...data.operations.slice(-30).reverse().map((o: any) => h('div', { className: 'bm-operation', key: o.id }, h('code', { title: o.id }, o.id.slice(0, 8)), h('span', null, `${o.kind} · ${o.state} · ${o.phase}`), o.errorCode && h('span', { className: 'bm-muted' }, o.errorCode),
        ['failed', 'recovery-required'].includes(o.state) && (o.kind === 'fork' ? h('button', { disabled: busy, onClick: () => void doAction('recover', o.id) }, tx('recover')) : h('span', { className: 'bm-muted' }, tx('manual')))))),
      h('footer', { className: 'bm-foot' }, h('span', { className: 'bm-muted' }, `${tx('show')} ${visible.length} / ${matching.length} · ${tx('total')} ${rows.length} · ${tx('revision')} ${data?.revision ?? '—'}`),
        mode === 'graph' && matching.length > limit && h('button', { onClick: () => setLimit(limit + 80) }, tx('more')), h('button', { disabled: busy, onClick: load }, tx('refresh')), h('button', { onClick: () => setView({ kind: 'fork', props }) }, tx('fork'))));
  }
  const Overlay = () => { const active = useView(); return active && h(Boundary, { key: active.kind }, active.kind === 'fork' ? h(Fork, { props: active.props }) : h(Overview, { props: active.props })); };
  const Action = ({ kind, props }: any) => { useCatalogue(); const label = tx(kind === 'fork' ? 'fork' : 'title'); return h('button', { type: 'button', className: 'bm-action', onClick: () => setView({ kind, props }), title: label, 'aria-label':label }, kind === 'fork' ? '⑂' : tx('title')); };
  return {
    inject: ['slots', 'sessions'],
    apply(ctx: any) {
      deps.sessions = ctx.sessions;
      ctx.effect(() => { const style = document.createElement('style'); style.textContent = CSS; document.head.append(style); return () => { style.remove(); setView(null); deps.sessions = null; deps.open = null; bound = null; }; }, 'branchman.styles');
      for (const name of ['locale', 'uiWorkspace']) {
        const fiber = ctx.inject([name], (child: any) => {
          const service = child[name];
          if (name === 'locale') { deps.locale = service; const unregister = service.register('dsh-branchman-v2', { zh, en }); child.effect(() => unregister, 'branchman.client.locale-dictionaries'); bound = service.bind('dsh-branchman-v2'); }
          else { deps.workspace = service; deps.open = (id: string) => service.openSession(id); }
          child.effect(() => () => { if (name === 'locale' && deps.locale === service) { deps.locale = null; bound = null; } else if (name === 'uiWorkspace' && deps.workspace === service) { deps.workspace = null; deps.open = null; } }, `branchman.client.${name}`);
        });
        ctx.effect(() => () => fiber?.dispose?.(), `branchman.client.optional.${name}`);
      }
      const register = (slot: string, id: string, component: any) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id, order: 60 }, component));
      register('conversation.chat.assistant-actions', 'branchman-fork-v2', (props: any) => h(Action, { kind: 'fork', props }));
      register('conversation.chat.assistant-actions', 'branchman-overview-v2', (props: any) => h(Action, { kind: 'overview', props }));
      register('conversation.composer.dock', 'branchman-dock-v2', (props: any) => h(Action, { kind: 'overview', props }));
      // The new-session screen does not render conversation-scoped slots yet.
      register('sidebar.footer.action', 'branchman-global-v2', () => h(Action, { kind: 'overview' }));
      register('shell.overlay', 'branchman-overlay-v2', Overlay);
    },
    __test: { overviewRows, layoutRows },
  };
}

// The only browser dependency is the host's existing React module.
window.__ModuleLoader__.load({ id: 'dsh-branchman', factory: (require: any) => createClient(require('react')) });
