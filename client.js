"use strict";
(() => {
  // src/client/camera.ts
  var CAMERA_MIN_K = 0.2;
  var CAMERA_MAX_K = 2.5;
  var clampK = (k) => {
    if (!Number.isFinite(k)) return 1;
    return Math.max(CAMERA_MIN_K, Math.min(CAMERA_MAX_K, k));
  };
  function finiteCamera(camera) {
    const x = Number.isFinite(camera.x) ? camera.x : 0;
    const y = Number.isFinite(camera.y) ? camera.y : 0;
    const k = clampK(camera.k);
    return { x, y, k };
  }
  function pan(start, pointerX, pointerY) {
    if (!Number.isFinite(pointerX) || !Number.isFinite(pointerY)) return { x: start.cameraStartX, y: start.cameraStartY, k: start.k };
    return finiteCamera({
      x: start.cameraStartX + (pointerX - start.pointerStartX),
      y: start.cameraStartY + (pointerY - start.pointerStartY),
      k: start.k
    });
  }
  function zoomAt(camera, factor, px, py) {
    if (!Number.isFinite(factor) || factor <= 0) return finiteCamera(camera);
    const k = clampK(camera.k * factor);
    const scale = k / camera.k;
    return finiteCamera({
      k,
      x: px - (px - camera.x) * scale,
      y: py - (py - camera.y) * scale
    });
  }
  function fit(width, height, vw, vh, maxK = 1.15) {
    const w = Math.max(1, Number.isFinite(width) ? width : 1);
    const h = Math.max(1, Number.isFinite(height) ? height : 1);
    const vpW = Math.max(1, Number.isFinite(vw) ? vw : 1);
    const vpH = Math.max(1, Number.isFinite(vh) ? vh : 1);
    const k = clampK(Math.min(maxK, Math.min((vpW - 24) / w, (vpH - 24) / h)));
    return finiteCamera({ k, x: (vpW - w * k) / 2, y: (vpH - h * k) / 2 });
  }

  // src/domain/graph.ts
  function buildGraph(nodes, edges) {
    const byId = /* @__PURE__ */ new Map();
    const issues = [];
    const duplicateIds = /* @__PURE__ */ new Set();
    for (const node of nodes) {
      if (byId.has(node.id)) duplicateIds.add(node.id);
      byId.set(node.id, node);
    }
    if (duplicateIds.size > 0) {
      issues.push({ code: "duplicate-id", ids: [...duplicateIds] });
    }
    const validEdges = [];
    const orphans = [];
    for (const edge of edges) {
      if (byId.has(edge.sourceId) && byId.has(edge.targetId)) {
        validEdges.push(edge);
      } else {
        orphans.push(edge.id);
      }
    }
    if (orphans.length > 0) {
      issues.push({ code: "orphan", ids: orphans });
    }
    const cycleNodes = findCycleNodes(nodes.map((n) => n.id), validEdges);
    if (cycleNodes.size > 0) {
      issues.push({ code: "cycle", ids: [...cycleNodes] });
    }
    return { nodes, edges: validEdges, issues };
  }
  function findCycleNodes(nodeIds, edges) {
    const WHITE = 0, GREY = 1, BLACK = 2;
    const color = /* @__PURE__ */ new Map();
    const adj = /* @__PURE__ */ new Map();
    for (const id of nodeIds) {
      color.set(id, WHITE);
      adj.set(id, []);
    }
    for (const edge of edges) {
      adj.get(edge.sourceId)?.push(edge.targetId);
    }
    const onCycle = /* @__PURE__ */ new Set();
    for (const start of nodeIds) {
      if (color.get(start) !== WHITE) continue;
      const path = [];
      const pathIndex = /* @__PURE__ */ new Map();
      const frames = [];
      color.set(start, GREY);
      path.push(start);
      pathIndex.set(start, 0);
      frames.push({ node: start, next: 0 });
      while (frames.length > 0) {
        const frame = frames[frames.length - 1];
        if (frame === void 0) break;
        const targets = adj.get(frame.node) ?? [];
        if (frame.next < targets.length) {
          const next = targets[frame.next] ?? frame.node;
          frame.next += 1;
          const nextColor = color.get(next);
          if (nextColor === GREY) {
            const from = pathIndex.get(next) ?? 0;
            for (let k = from; k < path.length; k += 1) {
              const onPath = path[k];
              if (onPath !== void 0) onCycle.add(onPath);
            }
          } else if (nextColor === WHITE) {
            color.set(next, GREY);
            pathIndex.set(next, path.length);
            path.push(next);
            frames.push({ node: next, next: 0 });
          }
        } else {
          color.set(frame.node, BLACK);
          pathIndex.delete(frame.node);
          path.pop();
          frames.pop();
        }
      }
    }
    return onCycle;
  }

  // src/client/forest.ts
  function buildForest(rows) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const graph = buildGraph(
      rows.map((r) => ({ id: r.id, kind: r.directionId ? "direction" : "session" })),
      rows.filter((r) => r.parentSessionId && byId.has(r.parentSessionId)).map((r) => ({ id: `edge:${r.id}`, sourceId: r.parentSessionId, targetId: r.id }))
    );
    const cyclic = new Set(graph.issues.filter((i) => i.code === "cycle").flatMap((i) => i.ids));
    const parent = /* @__PURE__ */ new Map(), children = /* @__PURE__ */ new Map();
    for (const row of rows) {
      const candidate = row.parentSessionId ? byId.get(row.parentSessionId) : void 0;
      const crossRepo = candidate?.repoId && row.repoId && candidate.repoId !== row.repoId;
      parent.set(row.id, candidate && !crossRepo && !cyclic.has(row.id) ? candidate.id : null);
      children.set(row.id, []);
    }
    for (const [id, p] of parent) if (p) children.get(p).push(id);
    const compare = (a, b) => (byId.get(a)?.createdAt ?? 0) - (byId.get(b)?.createdAt ?? 0) || a.localeCompare(b);
    for (const ids of children.values()) ids.sort(compare);
    const roots = rows.filter((r) => !parent.get(r.id)).map((r) => r.id).sort((a, b) => {
      const ra = byId.get(a), rb = byId.get(b);
      return String(ra.repoId ?? ra.cwd ?? "").localeCompare(String(rb.repoId ?? rb.cwd ?? "")) || compare(a, b);
    });
    const ordered = [], depth = /* @__PURE__ */ new Map(), rootOf = /* @__PURE__ */ new Map();
    for (const root of roots) {
      const stack = [{ id: root, level: 0 }];
      while (stack.length) {
        const item = stack.pop();
        ordered.push(byId.get(item.id));
        depth.set(item.id, item.level);
        rootOf.set(item.id, root);
        for (const id of [...children.get(item.id)].reverse()) stack.push({ id, level: item.level + 1 });
      }
    }
    return {
      byId,
      parent,
      children,
      roots,
      ordered,
      depth,
      rootOf,
      graph: { ...graph, edges: graph.edges.filter((e) => parent.get(e.targetId) === e.sourceId) }
    };
  }
  function selectForestRows(forest, matches, limit, collapsed = /* @__PURE__ */ new Set(), reveal = false) {
    const included = /* @__PURE__ */ new Set();
    for (const row of matches.slice(0, limit)) {
      let id = row.id;
      while (id && !included.has(id)) {
        included.add(id);
        id = forest.parent.get(id) ?? null;
      }
    }
    return forest.ordered.filter((row) => {
      if (!included.has(row.id)) return false;
      if (reveal) return true;
      let p = forest.parent.get(row.id);
      while (p) {
        if (collapsed.has(p)) return false;
        p = forest.parent.get(p);
      }
      return true;
    });
  }
  function layoutRows(rows) {
    const forest = buildForest(rows), positions = /* @__PURE__ */ new Map();
    const groups = [];
    const spans = /* @__PURE__ */ new Map();
    for (const row of [...forest.ordered].reverse()) spans.set(row.id, Math.max(1, forest.children.get(row.id).reduce((sum, id) => sum + spans.get(id), 0)));
    for (const rootId of forest.roots) {
      const ids = forest.ordered.filter((r) => forest.rootOf.get(r.id) === rootId).map((r) => r.id);
      const maxDepth = Math.max(0, ...ids.map((id) => forest.depth.get(id)));
      groups.push({ rootId, ids, x: 0, y: 0, width: maxDepth * 312 + 300, height: spans.get(rootId) * 88 + 58 });
    }
    const shelfWidth = Math.max(960, ...groups.map((g) => g.width));
    let x = 18, y = 18, shelfHeight = 0;
    for (const group of groups) {
      if (x > 18 && x + group.width > shelfWidth + 18) {
        x = 18;
        y += shelfHeight + 26;
        shelfHeight = 0;
      }
      group.x = x;
      group.y = y;
      x += group.width + 24;
      shelfHeight = Math.max(shelfHeight, group.height);
      const stack = [{ id: group.rootId, start: 0 }];
      while (stack.length) {
        const { id, start } = stack.pop();
        positions.set(id, { x: group.x + 18 + forest.depth.get(id) * 312, y: group.y + 44 + (start + (spans.get(id) - 1) / 2) * 88 });
        let next = start;
        for (const child of forest.children.get(id)) {
          stack.push({ id: child, start: next });
          next += spans.get(child);
        }
      }
    }
    return { ...forest, positions, groups, width: Math.max(320, ...groups.map((g) => g.x + g.width + 18)), height: Math.max(120, y + shelfHeight + 18) };
  }

  // src/client/session-store.ts
  var BOILERPLATE_TITLE_RE = /^\s*reference attachments for (?:the )?goal objective\.?(?:\s*\(\d+\))?\s*$/i;
  var clean = (value) => {
    if (typeof value !== "string") return null;
    const text = value.trim();
    return text === "" ? null : text;
  };
  function isBoilerplateTitle(title) {
    return BOILERPLATE_TITLE_RE.test(title);
  }
  function selectLabel(inputs) {
    const userTitle = clean(inputs.userTitle);
    if (userTitle !== null) return { text: userTitle.slice(0, 120), source: "user" };
    const hostTitle = clean(inputs.hostTitle);
    if (hostTitle !== null && !isBoilerplateTitle(hostTitle)) {
      return { text: hostTitle.slice(0, 120), source: "host" };
    }
    const brief = clean(inputs.brief);
    if (brief !== null) return { text: brief.slice(0, 120), source: "brief" };
    const summary = clean(inputs.summary);
    if (summary !== null) return { text: summary.slice(0, 120), source: "summary" };
    const sessionId = clean(inputs.sessionId);
    if (sessionId !== null) return { text: sessionId, source: "id" };
    return null;
  }

  // src/client/entry.ts
  var shortText = (text, budget = 34) => {
    let out = "", width = 0;
    for (const ch of text) {
      width += ch.charCodeAt(0) > 127 ? 2 : 1;
      if (width > budget) return out + "\u2026";
      out += ch;
    }
    return out;
  };
  function overviewRows(data, catalogue = {}) {
    const directions = new Map(data.directions.map((d) => [d.id, d]));
    const rows = data.sessions.map((s) => {
      const d = directions.get(s.directionId), host = catalogue.byId?.[s.sessionId];
      const authoritativeTitle = typeof host?.title === "string" && (!isBoilerplateTitle(host.title) || s.label?.source === "user") ? host.title : null;
      const label = selectLabel({
        userTitle: authoritativeTitle ?? (s.label?.source === "user" ? s.label.text : null),
        hostTitle: s.label?.source === "host" ? s.label.text : null,
        brief: d?.brief,
        summary: s.label?.source === "summary" ? s.label.text : null,
        sessionId: s.sessionId
      });
      return {
        id: s.sessionId,
        sessionId: s.sessionId,
        directionId: d?.id ?? null,
        parentSessionId: s.parentSessionId,
        repoId: s.repoId ?? d?.repoId ?? null,
        createdAt: s.createdAt,
        label: label?.text ?? s.sessionId,
        cwd: s.cwd,
        archived: s.archived,
        presence: s.presence,
        state: d?.state ?? "session",
        brief: d?.brief ?? "",
        displayName: d?.displayName ?? ""
      };
    });
    for (const d of data.directions) if (!rows.some((r) => r.directionId === d.id)) rows.push({
      id: `direction:${d.id}`,
      sessionId: d.primarySessionId,
      directionId: d.id,
      parentSessionId: null,
      repoId: d.repoId,
      label: d.displayName,
      displayName: d.displayName,
      cwd: data.worktrees.find((w) => w.id === d.worktreeId)?.canonicalPath ?? null,
      archived: false,
      presence: "unknown",
      state: d.state,
      brief: d.brief ?? ""
    });
    return rows;
  }
  var zh = {
    title: "\u8D70\u5411\u603B\u89C8",
    fork: "\u521B\u5EFA\u8D70\u5411",
    close: "\u5173\u95ED",
    list: "\u5217\u8868",
    graph: "\u5173\u7CFB\u56FE",
    search: "\u641C\u7D22\u4F1A\u8BDD\u3001\u8D70\u5411\u3001\u8DEF\u5F84",
    refresh: "\u5237\u65B0",
    open: "\u6253\u5F00\u4F1A\u8BDD",
    fit: "\u9002\u5E94\u753B\u5E03",
    more: "\u663E\u793A\u66F4\u591A",
    name: "\u8D70\u5411\u540D\u79F0",
    brief: "\u4EA4\u63A5\u8BF4\u660E",
    inherit: "\u7EE7\u627F\u6B64\u5904\u5DF2\u5B8C\u6210\u7684\u5BF9\u8BDD",
    blank: "\u4ECE\u7A7A\u5BF9\u8BDD\u5F00\u59CB",
    carry: "\u643A\u5E26\u5F53\u524D\u672A\u63D0\u4EA4\u6587\u4EF6",
    create: "\u521B\u5EFA\u5E76\u6253\u5F00",
    creating: "\u6B63\u5728\u521B\u5EFA\u2026",
    noSource: "\u8BF7\u5148\u6253\u5F00\u4E00\u4E2A\u4F1A\u8BDD",
    source: "\u6E90\u4F1A\u8BDD",
    operations: "\u64CD\u4F5C\u8BB0\u5F55",
    recover: "\u7EE7\u7EED\u6062\u590D",
    merge: "\u5408\u5165\u7236\u5DE5\u4F5C\u6811",
    sync: "\u540C\u6B65\u7236\u5DE5\u4F5C\u6811",
    remove: "\u79FB\u9664\u5DF2\u5408\u5165\u8D70\u5411",
    unarchive: "\u53D6\u6D88\u5F52\u6863",
    empty: "\u6CA1\u6709\u5339\u914D\u9879",
    archived: "\u5DF2\u5F52\u6863",
    current: "\u5F53\u524D\u4F1A\u8BDD",
    all: "\u6240\u6709\u4ED3\u5E93",
    details: "\u8BE6\u60C5",
    noSelection: "\u9009\u62E9\u4F1A\u8BDD\u67E5\u770B\u8BE6\u60C5",
    loading: "\u52A0\u8F7D\u4E2D\u2026",
    failed: "\u52A0\u8F7D\u5931\u8D25",
    retry: "\u91CD\u8BD5",
    missing: "\u4F1A\u8BDD\u786E\u5B9E\u7F3A\u5931",
    unknown: "\u4F1A\u8BDD\u72B6\u6001\u672A\u786E\u8BA4",
    pending: "\u9700\u8981\u6062\u590D",
    saved: "\u5DF2\u521B\u5EFA\uFF1B\u4F1A\u8BDD\u6253\u5F00\u5931\u8D25\uFF0C\u53EF\u4ECE\u603B\u89C8\u91CD\u65B0\u6253\u5F00",
    conflict: "\u5B58\u5728\u51B2\u7A81\uFF0C\u8BF7\u5728\u5DE5\u4F5C\u6811\u4E2D\u5904\u7406\u540E\u91CD\u65B0\u68C0\u67E5",
    manual: "\u6B64\u64CD\u4F5C\u9700\u8981\u68C0\u67E5\u5DE5\u4F5C\u6811\u53CA\u65E5\u5FD7\u540E\u5904\u7406",
    check: "\u68C0\u67E5\u5DE5\u4F5C\u6811",
    zoomIn: "\u653E\u5927",
    zoomOut: "\u7F29\u5C0F",
    show: "\u5DF2\u663E\u793A",
    total: "\u603B\u8BA1",
    revision: "\u7248\u672C",
    confirmation: "\u786E\u8BA4\u6267\u884C",
    roots: "\u5168\u90E8\u4E3B\u6811",
    root: "\u4E3B\u6811",
    branch: "\u5206\u652F",
    conversations: "\u4F1A\u8BDD",
    collapse: "\u6536\u8D77\u5206\u652F",
    expand: "\u5C55\u5F00\u5206\u652F",
    expandAll: "\u5C55\u5F00\u5168\u90E8",
    collapseAll: "\u6536\u8D77\u5168\u90E8",
    parent: "\u7236\u4F1A\u8BDD",
    location: "\u6240\u5C5E\u4E3B\u6811",
    focus: "\u5B9A\u4F4D\u9009\u4E2D",
    graphHelp: "\u4E3B\u6811\u72EC\u7ACB\u5206\u533A \xB7 \u62D6\u52A8\u753B\u5E03\u67E5\u770B \xB7 \u53EF\u7B5B\u9009\u5355\u68F5\u4E3B\u6811",
    session: "\u666E\u901A\u4F1A\u8BDD",
    ready: "\u53EF\u7528",
    removed: "\u5DF2\u79FB\u9664",
    creatingState: "\u6B63\u5728\u521B\u5EFA",
    "recovery-required": "\u9700\u8981\u6062\u590D",
    conflicted: "\u5B58\u5728\u51B2\u7A81",
    missingParent: "\u539F\u7236\u4F1A\u8BDD\u5DF2\u5220\u9664\u6216\u4E0D\u53EF\u7528"
  };
  var en = {
    title: "Directions",
    fork: "New direction",
    close: "Close",
    list: "List",
    graph: "Graph",
    search: "Search conversations, directions or paths",
    refresh: "Refresh",
    open: "Open conversation",
    fit: "Fit canvas",
    more: "Show more",
    name: "Direction name",
    brief: "Handoff notes",
    inherit: "Inherit completed conversation at this point",
    blank: "Start with an empty conversation",
    carry: "Carry uncommitted files",
    create: "Create and open",
    creating: "Creating\u2026",
    noSource: "Open a conversation first",
    source: "Source conversation",
    operations: "Operations",
    recover: "Resume recovery",
    merge: "Merge into parent worktree",
    sync: "Sync parent worktree",
    remove: "Remove integrated direction",
    unarchive: "Unarchive",
    empty: "No matches",
    archived: "Archived",
    current: "Current conversation",
    all: "All repositories",
    details: "Details",
    noSelection: "Select a conversation",
    loading: "Loading\u2026",
    failed: "Failed to load",
    retry: "Retry",
    missing: "Conversation missing",
    unknown: "Presence unknown",
    pending: "Recovery required",
    saved: "Created; opening failed. Open it from Directions.",
    conflict: "Resolve worktree conflicts before checking again",
    manual: "Inspect the worktree and operation journal",
    check: "Check worktrees",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    show: "Showing",
    total: "Total",
    revision: "Revision",
    confirmation: "Confirm action",
    roots: "All main trees",
    root: "Main tree",
    branch: "Branch",
    conversations: "conversations",
    collapse: "Collapse branches",
    expand: "Expand branches",
    expandAll: "Expand all",
    collapseAll: "Collapse all",
    parent: "Parent conversation",
    location: "Main tree",
    focus: "Focus selected",
    graphHelp: "Separate main trees \xB7 Drag to pan \xB7 Select one main tree to focus",
    session: "Conversation",
    ready: "Ready",
    removed: "Removed",
    creatingState: "Creating",
    "recovery-required": "Recovery required",
    conflicted: "Conflicted",
    missingParent: "Original parent deleted or unavailable"
  };
  var CSS = `
.bm-toolbar select{width:185px;max-width:100%;min-width:0}.bm-toolbar input{min-width:180px}.bm-graph-help{position:absolute;top:8px;left:10px;right:10px;pointer-events:none;font-size:12px;opacity:.65;background:var(--dsw-alias-bg-module-platform,#f5f6f7);padding:4px 7px;border-radius:5px}
.bm-tree-group{border:1px solid var(--dsw-alias-border-l3,#8885);border-radius:10px;margin-bottom:14px;padding:8px;background:var(--dsw-alias-bg-layer-1,#fff)}.bm-group-head{padding:3px 6px 8px;display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #8883;margin-bottom:7px}.bm-tree-item{display:flex;align-items:stretch;gap:5px;position:relative;margin-left:calc(var(--bm-depth,0)*22px)}.bm-tree-item[data-depth]:not([data-depth="0"]){border-left:2px solid #4285cf44;padding-left:6px}.bm-tree-item .bm-row{min-width:0;flex:1}.bm-tree-item .bm-toggle{width:25px;padding:0;flex:none;border:0;background:transparent;align-self:flex-start;height:35px}.bm-tree-item .bm-leaf{width:25px;flex:none;text-align:center;padding-top:8px;color:#4285cf}.bm-root-row .bm-label{font-size:14px}.bm-root-row{border-left:3px solid #4285cf!important}.bm-detail-path{padding:9px;border-radius:8px;background:#8080800b;border:1px solid #8883;display:flex;flex-direction:column;gap:5px}.bm-detail-path button{text-align:left;font-size:12px}.bm-canvas .bm-tree-card{fill:var(--dsw-alias-bg-module-platform,#80808007);stroke:#4285cf55;stroke-width:1}.bm-canvas .bm-edge{stroke:#4285cf88;stroke-width:1.6}.bm-canvas .bm-tree-caption{font-weight:600}.bm-canvas .bm-node-kind{fill:#4285cf}.bm-canvas .bm-graph-toggle{fill:#4285cf;cursor:pointer}
.bm-backdrop{position:fixed;inset:0;z-index:100;background:rgba(0,0,0,.32);display:grid;place-items:center;padding:18px;box-sizing:border-box}.bm-panel{box-sizing:border-box;max-width:100%}
.bm-panel{width:min(1120px,96vw);height:min(780px,94vh);display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--dsw-alias-border-l3,#8888);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#202124);box-shadow:0 18px 70px #0004;font:14px/1.5 system-ui}
.bm-head,.bm-toolbar,.bm-foot{padding:12px 18px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--dsw-alias-border-l3,#8886)}
.bm-head h2{font-size:18px;margin:0;flex:1}.bm-panel button,.bm-panel input,.bm-panel select,.bm-panel textarea{font:inherit;color:inherit;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-l3,#8888);border-radius:7px;padding:7px 10px}
.bm-panel button{cursor:pointer}.bm-panel button:disabled{opacity:.5;cursor:default}.bm-panel button[aria-pressed=true],.bm-row[aria-selected=true]{border-color:#4285cf;background:var(--dsw-alias-interactive-bg-active,#4386cc18)}
.bm-panel :focus-visible{outline:2px solid #4285cf;outline-offset:2px}.bm-toolbar input{flex:1;min-width:160px}.bm-body{display:flex;flex:1;min-height:0}.bm-list{flex:1;overflow:auto;padding:10px;min-width:0}.bm-row{width:100%;display:flex;text-align:left;flex-direction:column;margin-bottom:6px;gap:3px}.bm-line{display:flex;gap:8px;align-items:center;max-width:100%}.bm-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.bm-muted{font-size:12px;opacity:.7;word-break:break-word}.bm-chip{font-size:11px;border:1px solid #8886;border-radius:5px;padding:0 5px}.bm-detail{width:290px;overflow:auto;border-left:1px solid #8886;padding:16px;display:flex;flex-direction:column;gap:9px}.bm-detail h3{margin:0;word-break:break-word}.bm-canvas{flex:1;min-width:0;position:relative;overflow:hidden;touch-action:none;background:var(--dsw-alias-bg-module-platform,#80808008)}.bm-canvas svg{width:100%;height:100%;user-select:none}.bm-canvas rect{fill:var(--dsw-alias-bg-layer-1,#fff);stroke:#8888}.bm-canvas text{fill:var(--dsw-alias-label-primary,#202124)}.bm-canvas path{stroke:#8889;fill:none}.bm-canvas g[role=button]{cursor:pointer}.bm-canvas g[aria-selected=true] rect{stroke:#4285cf;stroke-width:2}.bm-error{color:var(--dsw-alias-state-warn-label,#c34242);padding:8px 18px;word-break:break-word}.bm-foot{border-top:1px solid #8886;border-bottom:0}.bm-operations{max-height:130px;overflow:auto;padding:6px 18px;border-top:1px solid #8886}.bm-operation{display:flex;gap:8px;align-items:center;padding:5px 0}.bm-operation code{font-size:11px}.bm-form{height:auto;width:min(540px,95vw)}.bm-fields{padding:18px;display:flex;flex-direction:column;gap:12px}.bm-fields label{display:flex;flex-direction:column;gap:5px}.bm-fields textarea{min-height:90px;resize:vertical}.bm-fields .bm-check{flex-direction:row;align-items:center}.bm-action{border:0;background:transparent;color:inherit;cursor:pointer;padding:4px 7px;border-radius:5px}.bm-action:hover{background:#8882}@media(max-width:760px){.bm-detail{width:210px}.bm-toolbar{padding:8px}.bm-panel{height:94vh}}@media(max-width:540px){.bm-body{flex-direction:column}.bm-detail{width:auto;max-height:180px;border-left:0;border-top:1px solid #8886}.bm-head,.bm-foot{padding:8px 12px}}
`;
  function createClient(React) {
    const h = React.createElement;
    const deps = { sessions: null, open: null, locale: null };
    let view = null, bound = null;
    const watchers = /* @__PURE__ */ new Set();
    const setView = (next) => {
      view = next;
      watchers.forEach((fn) => fn());
    };
    const tx = (key) => {
      try {
        const result = bound?.(key);
        if (typeof result === "string" && result !== key && !result.endsWith(`.${key}`)) return result;
      } catch {
      }
      return (String(deps.locale?.locale ?? document.documentElement.lang ?? "zh").startsWith("en") ? en : zh)[key] ?? key;
    };
    const cat = () => deps.sessions?.list?.getSnapshot?.() ?? {};
    function useCatalogue() {
      React.useSyncExternalStore((f) => deps.locale?.subscribe?.(f) ?? (() => {
      }), () => deps.locale?.getSnapshot?.().active ?? "zh", () => "zh");
      const store = deps.sessions?.list;
      const snapshot = React.useSyncExternalStore((f) => store?.subscribe?.(f) ?? (() => {
      }), cat, cat);
      return React.useMemo(() => ({ ...snapshot, current: Object.values(snapshot.byId ?? {}).find((s) => (s.retainedBy?.mainView ?? 0) > 0)?.id }), [snapshot]);
    }
    const useView = () => React.useSyncExternalStore((f) => {
      watchers.add(f);
      return () => watchers.delete(f);
    }, () => view, () => view);
    async function api(path, body, signal) {
      const response = await fetch(`/branchman/api/${path}`, { ...body === void 0 ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, signal });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message ?? `HTTP ${response.status}`);
      if (payload.protocolVersion !== 2 || payload.schemaVersion !== 2) throw new Error("Branchman protocol mismatch; restart the app");
      return payload.data;
    }
    async function open(id) {
      if (!deps.open) throw new Error("session opening service unavailable");
      for (let n = 0; n < 6; n++) {
        if (cat().byId?.[id]) {
          await deps.open(id);
          return;
        }
        await deps.sessions.refresh?.();
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      throw new Error("new conversation is not available in the client catalogue");
    }
    class Boundary extends React.Component {
      state = { error: null };
      static getDerivedStateFromError(error) {
        return { error };
      }
      render() {
        return this.state.error ? h("div", { className: "bm-backdrop" }, h("section", { className: "bm-panel bm-form" }, h("div", { className: "bm-error", role: "alert" }, String(this.state.error.message)), h("button", { onClick: () => setView(null) }, tx("close")))) : this.props.children;
      }
    }
    function Dialog({ children, title, form = false }) {
      const ref = React.useRef(null);
      React.useEffect(() => {
        const before = document.activeElement;
        ref.current?.querySelector('input,button,[tabindex="0"]')?.focus();
        const keydown = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setView(null);
          }
          if (event.key === "Tab") {
            const focusables = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter((el) => el.getClientRects().length);
            const at = focusables.indexOf(document.activeElement), next = at < 0 ? event.shiftKey ? focusables.length - 1 : 0 : (at + (event.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
            event.preventDefault();
            event.stopPropagation();
            focusables[next]?.focus();
          }
        };
        document.addEventListener("keydown", keydown, true);
        return () => {
          document.removeEventListener("keydown", keydown, true);
          if (before?.isConnected) before.focus?.();
        };
      }, []);
      return h("div", { className: "bm-backdrop" }, h(
        "section",
        { ref, className: `bm-panel${form ? " bm-form" : ""}`, role: "dialog", "aria-modal": true, "aria-label": title },
        h("header", { className: "bm-head" }, h("h2", null, title), h("button", { type: "button", onClick: () => setView(null), "aria-label": tx("close") }, "\xD7")),
        children
      ));
    }
    function Fork({ props }) {
      const catalogue = useCatalogue(), id = props?.sessionId ?? catalogue.current;
      const source = catalogue.byId?.[id];
      const [name, setName] = React.useState(""), [brief, setBrief] = React.useState(""), [history, setHistory] = React.useState("inherit"), [carry, setCarry] = React.useState(true);
      const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(""), [operation, setOperation] = React.useState(null);
      const request = React.useRef(null), alive = React.useRef(true);
      React.useEffect(() => {
        alive.current = true;
        return () => {
          alive.current = false;
        };
      }, []);
      const submit = async (event) => {
        event.preventDefault();
        if (!id || !source?.cwd || busy) return;
        setBusy(true);
        setError("");
        const body = { sourceSessionId: id, sourceCwd: source.cwd, displayName: name.trim(), brief, history, codeSource: { kind: "source-head", carryChanges: carry }, ...props?.messageId ? { messageId: props.messageId } : {} };
        const digest = JSON.stringify(body);
        if (!request.current || request.current.digest !== digest) request.current = { digest, id: window.crypto.randomUUID() };
        try {
          const result = await api("fork", { ...body, requestId: request.current.id });
          if (!alive.current) return;
          setOperation(result);
          if (result.state !== "succeeded") {
            setError(result.code ?? tx("pending"));
            return;
          }
          const data = await api(`tree?currentSessionId=${encodeURIComponent(id)}`), dir = data.directions.find((d) => d.id === result.directionId);
          try {
            await open(dir.primarySessionId);
            if (alive.current) setView(null);
          } catch {
            if (alive.current) setError(tx("saved"));
          }
        } catch (e) {
          if (alive.current) setError(String(e.message));
        } finally {
          if (alive.current) setBusy(false);
        }
      };
      return h(Dialog, { title: tx("fork"), form: true }, h(
        "form",
        { onSubmit: submit },
        h(
          "div",
          { className: "bm-fields" },
          h("div", { className: "bm-muted" }, source?.displayTitle ?? id ?? tx("noSource")),
          h("label", null, tx("name"), h("input", { value: name, maxLength: 120, required: true, disabled: busy, onChange: (e) => setName(e.target.value) })),
          h("label", null, tx("brief"), h("textarea", { value: brief, maxLength: 8e3, disabled: busy, onChange: (e) => setBrief(e.target.value) })),
          h("label", null, tx("source"), h("select", { value: history, disabled: busy, onChange: (e) => setHistory(e.target.value) }, h("option", { value: "inherit" }, tx("inherit")), h("option", { value: "blank" }, tx("blank")))),
          h("label", { className: "bm-check" }, h("input", { type: "checkbox", checked: carry, disabled: busy, onChange: (e) => setCarry(e.target.checked) }), tx("carry"))
        ),
        error && h("div", { className: "bm-error", role: "alert" }, error),
        operation && h("div", { className: "bm-fields" }, h("code", null, operation.operationId), h("button", { type: "button", onClick: () => setView({ kind: "overview", props }) }, tx("operations"))),
        h("footer", { className: "bm-foot" }, h("button", { type: "submit", disabled: busy || !source?.cwd || !name.trim() || !!operation }, busy ? tx("creating") : tx("create")))
      ));
    }
    function Graph({ rows, selected, select, forest, collapsed, toggle }) {
      const layout = React.useMemo(() => layoutRows(rows), [rows]);
      const [element, setElement] = React.useState(null), [size, setSize] = React.useState({ w: 800, h: 400 }), [camera, setCamera] = React.useState({ x: 10, y: 10, k: 1 });
      const cam = React.useRef(camera), drag = React.useRef(null), initialized = React.useRef(false);
      cam.current = camera;
      const doFit = () => {
        setCamera(fit(layout.width, layout.height, size.w, size.h));
        initialized.current = true;
      };
      const focusSelected = () => {
        const p = layout.positions.get(selected);
        if (p) {
          setCamera({ k: 1, x: size.w / 2 - p.x - 132, y: size.h / 2 - p.y - 34 });
          initialized.current = true;
        }
      };
      React.useEffect(() => {
        if (!element) return;
        const resize = () => {
          const rect = element.getBoundingClientRect();
          setSize({ w: rect.width, h: rect.height });
        };
        const observer = new ResizeObserver(resize);
        observer.observe(element);
        resize();
        const wheel = (event) => {
          event.preventDefault();
          const box = element.getBoundingClientRect();
          setCamera(zoomAt(cam.current, Math.exp(-event.deltaY * 15e-4), event.clientX - box.left, event.clientY - box.top));
        };
        element.addEventListener("wheel", wheel, { passive: false });
        return () => {
          observer.disconnect();
          element.removeEventListener("wheel", wheel);
        };
      }, [element]);
      React.useEffect(() => {
        if (!initialized.current && rows.length && size.w > 0 && size.h > 0) {
          const fitted = fit(layout.width, layout.height, size.w, size.h);
          setCamera(fitted.k >= 0.72 ? fitted : { k: 0.72, x: 12, y: 38 });
          initialized.current = true;
        }
      }, [rows.length, size.w, size.h]);
      const down = (e) => {
        if (e.button !== 0 || e.target.closest('[role="button"]')) return;
        element.setPointerCapture(e.pointerId);
        drag.current = { pointerStartX: e.clientX, pointerStartY: e.clientY, cameraStartX: cam.current.x, cameraStartY: cam.current.y, k: cam.current.k };
      };
      const key = (e) => {
        if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          setCamera(zoomAt(cam.current, 1.2, size.w / 2, size.h / 2));
        } else if (e.key === "-") {
          e.preventDefault();
          setCamera(zoomAt(cam.current, 1 / 1.2, size.w / 2, size.h / 2));
        } else if (e.key.toLowerCase() === "f") {
          e.preventDefault();
          doFit();
        } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
          e.preventDefault();
          setCamera({ ...cam.current, x: cam.current.x + (e.key === "ArrowLeft" ? 40 : e.key === "ArrowRight" ? -40 : 0), y: cam.current.y + (e.key === "ArrowUp" ? 40 : e.key === "ArrowDown" ? -40 : 0) });
        }
      };
      return h(
        "div",
        {
          className: "bm-canvas",
          ref: setElement,
          tabIndex: 0,
          "aria-label": tx("graph"),
          onKeyDown: key,
          onPointerDown: down,
          onPointerMove: (e) => {
            if (drag.current) setCamera(pan(drag.current, e.clientX, e.clientY));
          },
          onPointerUp: () => {
            drag.current = null;
          },
          onLostPointerCapture: () => {
            drag.current = null;
          }
        },
        h("svg", { viewBox: `0 0 ${size.w} ${size.h}`, "data-camera": JSON.stringify(camera) }, h(
          "g",
          { transform: `translate(${camera.x} ${camera.y}) scale(${camera.k})` },
          layout.groups.map((group) => h("g", { key: `group:${group.rootId}`, "data-tree-root": group.rootId }, h("rect", { className: "bm-tree-card", x: group.x, y: group.y, width: group.width, height: group.height, rx: 12 }), h("text", { className: "bm-tree-caption", x: group.x + 16, y: group.y + 25, fontSize: 12 }, `${tx("root")} \xB7 ${shortText(layout.byId.get(group.rootId)?.label ?? "", 30)} \xB7 ${group.ids.length}`))),
          layout.graph.edges.map((edge) => {
            const a = layout.positions.get(edge.sourceId), b = layout.positions.get(edge.targetId);
            return h("path", { key: edge.id, className: "bm-edge", "data-tree-root": layout.rootOf.get(edge.sourceId), d: `M${a.x + 264} ${a.y + 34} C${a.x + 288} ${a.y + 34},${b.x - 24} ${b.y + 34},${b.x} ${b.y + 34}` });
          }),
          rows.map((row) => {
            const p = layout.positions.get(row.id), hasChildren = forest.children.get(row.id)?.length > 0;
            return h(
              "g",
              { key: row.id, role: "button", tabIndex: 0, "aria-label": row.label, "aria-selected": row.id === selected, "data-session-id": row.id, transform: `translate(${p.x} ${p.y})`, onClick: () => select(row.id), onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  select(row.id);
                }
              } },
              h("title", null, `${row.label}
${row.cwd ?? ""}`),
              h("rect", { width: 264, height: 68, rx: 9 }),
              h("text", { x: 12, y: 24, fontSize: 13 }, shortText(row.label)),
              h("text", { x: 12, y: 49, fontSize: 11, opacity: 0.7 }, shortText(`${forest.depth.get(row.id) ? tx("branch") : tx("root")} \xB7 ${row.displayName || tx(row.state)}${row.archived ? ` \xB7 ${tx("archived")}` : ""}`)),
              hasChildren && h("g", { role: "button", tabIndex: 0, className: "bm-graph-toggle", "aria-label": `${tx(collapsed.has(row.id) ? "expand" : "collapse")} ${row.label}`, "aria-expanded": !collapsed.has(row.id), onClick: (e) => {
                e.stopPropagation();
                toggle(row.id);
              }, onKeyDown: (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  e.stopPropagation();
                  toggle(row.id);
                }
              } }, h("rect", { x: 237, y: 37, width: 22, height: 24, rx: 4 }), h("text", { x: 243, y: 53, fontSize: 14 }, collapsed.has(row.id) ? "+" : "\u2212"))
            );
          })
        )),
        h("div", { className: "bm-graph-help" }, tx("graphHelp")),
        h(
          "div",
          { style: { position: "absolute", bottom: 10, left: 10, display: "flex", gap: 6 } },
          h("button", { onClick: () => setCamera(zoomAt(cam.current, 1.2, size.w / 2, size.h / 2)), "aria-label": tx("zoomIn") }, "+"),
          h("button", { onClick: () => setCamera(zoomAt(cam.current, 1 / 1.2, size.w / 2, size.h / 2)), "aria-label": tx("zoomOut") }, "\u2212"),
          h("button", { onClick: doFit }, tx("fit")),
          h("button", { onClick: focusSelected, disabled: !layout.positions.has(selected) }, tx("focus"))
        )
      );
    }
    function Overview({ props }) {
      const catalogue = useCatalogue(), current = props?.sessionId ?? catalogue.current;
      const [data, setData] = React.useState(null), [error, setError] = React.useState(""), [mode, setMode] = React.useState("list"), [search, setSearch] = React.useState(""), [repo, setRepo] = React.useState(""), [limit, setLimit] = React.useState(80), [selected, setSelected] = React.useState(current), [busy, setBusy] = React.useState(false), [confirm, setConfirm] = React.useState(null);
      const [root, setRoot] = React.useState(""), [collapsed, setCollapsed] = React.useState(/* @__PURE__ */ new Set()), [showDetails, setShowDetails] = React.useState(false);
      const toggle = (id) => setCollapsed((before) => {
        const next = new Set(before);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
      });
      const alive = React.useRef(true), controller = React.useRef(null), revision = React.useRef(-1), flight = React.useRef(null);
      const load = () => {
        if (flight.current) return flight.current;
        const abort = new AbortController();
        controller.current = abort;
        const work = api(`tree?currentSessionId=${encodeURIComponent(current ?? "")}`, void 0, abort.signal).then((result) => {
          if (alive.current && result.revision >= revision.current) {
            revision.current = result.revision;
            setData(result);
            setError(result.corpusError ?? "");
          }
        }).catch((e) => {
          if (alive.current && e.name !== "AbortError") setError(e.message);
        }).finally(() => {
          if (flight.current === work) flight.current = null;
        });
        flight.current = work;
        return work;
      };
      React.useEffect(() => {
        alive.current = true;
        void load();
        const timer = setInterval(() => {
          if (!document.hidden) void load();
        }, 5e3);
        return () => {
          alive.current = false;
          clearInterval(timer);
          controller.current?.abort();
        };
      }, [current]);
      const rows = React.useMemo(() => data ? overviewRows(data, catalogue) : [], [data, catalogue]);
      const forest = React.useMemo(() => buildForest(rows), [rows]);
      const matching = forest.ordered.filter((r) => (!repo || r.repoId === repo || forest.byId.get(forest.rootOf.get(r.id))?.repoId === repo) && (!root || forest.rootOf.get(r.id) === root) && `${r.label} ${r.displayName} ${r.cwd} ${r.brief}`.toLowerCase().includes(search.toLowerCase()));
      const visible = selectForestRows(forest, matching, limit, collapsed, !!search), row = rows.find((r) => r.id === selected);
      const visibleForest = buildForest(visible), rootRow = row && forest.byId.get(forest.rootOf.get(row.id)), parentRow = row && forest.byId.get(forest.parent.get(row.id));
      const doAction = async (kind, id) => {
        setBusy(true);
        setError("");
        try {
          const result = await api(kind, kind === "recover" ? { operationId: id } : { directionId: id, requestId: window.crypto.randomUUID() });
          if (result.state && !["succeeded", "ready"].includes(result.state)) throw new Error(result.code ?? tx("pending"));
          await load();
        } catch (e) {
          if (alive.current) {
            setError(e.message);
            await load();
          }
        } finally {
          if (alive.current) setBusy(false);
        }
      };
      const button = (kind, label = kind) => h("button", { disabled: busy, onClick: () => setConfirm({ kind, id: row.directionId }) }, tx(label));
      return h(
        Dialog,
        { title: tx("title") },
        h(
          "div",
          { className: "bm-toolbar" },
          h("input", { placeholder: tx("search"), "aria-label": tx("search"), value: search, onChange: (e) => {
            setSearch(e.target.value);
            setLimit(80);
          } }),
          h("select", { value: repo, "aria-label": tx("all"), onChange: (e) => {
            setRepo(e.target.value);
            setRoot("");
            setLimit(80);
          } }, h("option", { value: "" }, tx("all")), ...(data?.repositories ?? []).map((r) => h("option", { value: r.id, key: r.id }, data.worktrees.find((w) => w.id === r.primaryWorktreeId)?.canonicalPath))),
          h("select", { value: root, "aria-label": tx("roots"), onChange: (e) => {
            setRoot(e.target.value);
            setLimit(80);
          } }, h("option", { value: "" }, tx("roots")), ...forest.roots.filter((id) => !repo || forest.byId.get(id)?.repoId === repo).map((id) => h("option", { key: id, value: id }, forest.byId.get(id)?.label))),
          ...["list", "graph"].map((kind) => h("button", { key: kind, "aria-pressed": mode === kind, onClick: () => setMode(kind) }, tx(kind))),
          h("button", { onClick: () => setCollapsed(new Set(forest.ordered.filter((r) => forest.children.get(r.id).length).map((r) => r.id))) }, tx("collapseAll")),
          h("button", { onClick: () => setCollapsed(/* @__PURE__ */ new Set()) }, tx("expandAll")),
          mode === "graph" && h("button", { "aria-pressed": showDetails, onClick: () => setShowDetails(!showDetails) }, tx("details"))
        ),
        error && h("div", { className: "bm-error", role: "alert" }, error),
        h(
          "div",
          { className: "bm-body" },
          mode === "graph" ? h(Graph, { key: root || "all", rows: visible, selected, select: setSelected, forest, collapsed, toggle }) : h(
            "div",
            { className: "bm-list", role: "tree", "aria-label": tx("title") },
            !data ? tx("loading") : !matching.length ? tx("empty") : visibleForest.roots.map((rootId) => h(
              "section",
              { key: rootId, className: "bm-tree-group", "data-tree-root": rootId },
              h("div", { className: "bm-group-head" }, h("span", { className: "bm-muted" }, forest.byId.get(rootId)?.cwd), h("span", { className: "bm-chip" }, tx("root"))),
              ...visible.filter((r) => forest.rootOf.get(r.id) === rootId).map((r) => {
                const depth = forest.depth.get(r.id) ?? 0, children = forest.children.get(r.id)?.length > 0;
                return h(
                  "div",
                  { key: r.id, className: "bm-tree-item", style: { "--bm-depth": Math.min(depth, 8) }, "data-depth": depth },
                  children ? h("button", { className: "bm-toggle", "aria-label": `${tx(collapsed.has(r.id) ? "expand" : "collapse")} ${r.label}`, "aria-expanded": !collapsed.has(r.id), onClick: () => toggle(r.id) }, collapsed.has(r.id) ? "\u25B8" : "\u25BE") : h("span", { className: "bm-leaf", "aria-hidden": true }, depth ? "\u2514" : "\u25CF"),
                  h(
                    "button",
                    { className: `bm-row${depth ? "" : " bm-root-row"}`, role: "treeitem", "aria-level": depth + 1, ...children ? { "aria-expanded": !collapsed.has(r.id) } : {}, "aria-selected": selected === r.id, onClick: () => setSelected(r.id) },
                    h("span", { className: "bm-line" }, h("strong", { className: "bm-label" }, r.label), r.id === current && h("span", { className: "bm-chip" }, tx("current")), r.archived && h("span", { className: "bm-chip" }, tx("archived"))),
                    h("span", { className: "bm-muted" }, `${depth ? tx("branch") : tx("root")} \xB7 ${r.displayName ? r.displayName + " \xB7 " : ""}${tx(r.state)}`),
                    h("span", { className: "bm-muted" }, r.cwd)
                  )
                );
              })
            )),
            matching.length > limit && h("button", { onClick: () => setLimit(limit + 80) }, tx("more"))
          ),
          (mode === "list" || showDetails) && h("aside", { className: "bm-detail", "aria-label": tx("details") }, row ? h(
            React.Fragment,
            null,
            h("h3", null, row.label),
            row.displayName && h("strong", null, row.displayName),
            h("div", { className: "bm-muted" }, row.cwd),
            h("div", null, row.brief),
            h("div", { className: "bm-detail-path" }, h("span", { className: "bm-muted" }, tx("location")), h("button", { onClick: () => {
              setSelected(rootRow.id);
              setRoot(rootRow.id);
            } }, rootRow?.label), parentRow && h(React.Fragment, null, h("span", { className: "bm-muted" }, tx("parent")), h("button", { onClick: () => setSelected(parentRow.id) }, parentRow.label)), !parentRow && row.parentSessionId && h("span", { className: "bm-muted" }, tx("missingParent"))),
            h("div", { className: "bm-muted" }, tx(row.state)),
            row.presence === "missing" && h("div", { role: "status" }, tx("missing")),
            row.presence === "unknown" && h("div", { role: "status" }, tx("unknown")),
            h("button", { disabled: !row.sessionId || row.archived || row.presence === "missing", onClick: async () => {
              try {
                await open(row.sessionId);
                setView(null);
              } catch (e) {
                setError(e.message);
              }
            } }, tx("open")),
            h("button", { disabled: !row.sessionId || !row.cwd || row.state === "removed", onClick: () => setView({ kind: "fork", props: { sessionId: row.sessionId } }) }, tx("fork")),
            row.archived && row.directionId && h("button", { disabled: busy, onClick: () => void doAction("unarchive", row.directionId) }, tx("unarchive")),
            row.directionId && row.state === "ready" && h(React.Fragment, null, button("merge"), button("sync"), button("remove")),
            ["conflicted", "recovery-required"].includes(row.state) && h(React.Fragment, null, h("div", { role: "status" }, row.state === "conflicted" ? tx("conflict") : tx("pending")), h("button", { disabled: busy, onClick: () => void doAction("check", row.directionId) }, tx("check")))
          ) : tx("noSelection"))
        ),
        confirm && h("div", { className: "bm-foot" }, h("span", null, tx(confirm.kind)), h("button", { disabled: busy, onClick: () => {
          const action = confirm;
          setConfirm(null);
          void doAction(action.kind, action.id);
        } }, tx("confirmation")), h("button", { onClick: () => setConfirm(null) }, tx("close"))),
        data?.operations?.length > 0 && h("details", { className: "bm-operations", open: data.operations.some((o) => o.state === "recovery-required") }, h("summary", null, `${tx("operations")} (${data.operations.length})`), ...data.operations.slice(-30).reverse().map((o) => h(
          "div",
          { className: "bm-operation", key: o.id },
          h("code", { title: o.id }, o.id.slice(0, 8)),
          h("span", null, `${o.kind} \xB7 ${o.state} \xB7 ${o.phase}`),
          o.errorCode && h("span", { className: "bm-muted" }, o.errorCode),
          ["failed", "recovery-required"].includes(o.state) && (o.kind === "fork" ? h("button", { disabled: busy, onClick: () => void doAction("recover", o.id) }, tx("recover")) : h("span", { className: "bm-muted" }, tx("manual")))
        ))),
        h(
          "footer",
          { className: "bm-foot" },
          h("span", { className: "bm-muted" }, `${tx("show")} ${visible.length} / ${matching.length} \xB7 ${tx("total")} ${rows.length} \xB7 ${tx("revision")} ${data?.revision ?? "\u2014"}`),
          mode === "graph" && matching.length > limit && h("button", { onClick: () => setLimit(limit + 80) }, tx("more")),
          h("button", { disabled: busy, onClick: load }, tx("refresh")),
          h("button", { onClick: () => setView({ kind: "fork", props }) }, tx("fork"))
        )
      );
    }
    const Overlay = () => {
      const active = useView();
      return active && h(Boundary, { key: active.kind }, active.kind === "fork" ? h(Fork, { props: active.props }) : h(Overview, { props: active.props }));
    };
    const Action = ({ kind, props }) => {
      useCatalogue();
      const label = tx(kind === "fork" ? "fork" : "title");
      return h("button", { type: "button", className: "bm-action", onClick: () => setView({ kind, props }), title: label, "aria-label": label }, kind === "fork" ? "\u2442" : tx("title"));
    };
    return {
      inject: ["slots", "sessions"],
      apply(ctx) {
        deps.sessions = ctx.sessions;
        ctx.effect(() => {
          const style = document.createElement("style");
          style.textContent = CSS;
          document.head.append(style);
          return () => {
            style.remove();
            setView(null);
            deps.sessions = null;
            deps.open = null;
            bound = null;
          };
        }, "branchman.styles");
        for (const name of ["locale", "uiWorkspace"]) {
          const fiber = ctx.inject([name], (child) => {
            const service = child[name];
            if (name === "locale") {
              deps.locale = service;
              const unregister = service.register("dsh-branchman-v2", { zh, en });
              child.effect(() => unregister, "branchman.client.locale-dictionaries");
              bound = service.bind("dsh-branchman-v2");
            } else {
              deps.workspace = service;
              deps.open = (id) => service.openSession(id);
            }
            child.effect(() => () => {
              if (name === "locale" && deps.locale === service) {
                deps.locale = null;
                bound = null;
              } else if (name === "uiWorkspace" && deps.workspace === service) {
                deps.workspace = null;
                deps.open = null;
              }
            }, `branchman.client.${name}`);
          });
          ctx.effect(() => () => fiber?.dispose?.(), `branchman.client.optional.${name}`);
        }
        const register = (slot, id, component) => ctx.slots.inject(slot, () => ctx.slots.register({ name: slot, id, order: 60 }, component));
        register("conversation.chat.assistant-actions", "branchman-fork-v2", (props) => h(Action, { kind: "fork", props }));
        register("conversation.chat.assistant-actions", "branchman-overview-v2", (props) => h(Action, { kind: "overview", props }));
        register("conversation.composer.dock", "branchman-dock-v2", (props) => h(Action, { kind: "overview", props }));
        register("sidebar.footer.action", "branchman-global-v2", () => h(Action, { kind: "overview" }));
        register("shell.overlay", "branchman-overlay-v2", Overlay);
      },
      __test: { overviewRows, layoutRows, buildForest, selectForestRows }
    };
  }
  window.__ModuleLoader__.load({ id: "dsh-branchman", factory: (require2) => createClient(require2("react")) });
})();
