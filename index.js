// src/host/runtime.ts
import { mkdir as mkdir4, readFile as readFile4, writeFile as writeFile2, access } from "node:fs/promises";
import { dirname as dirname3, join as join3, resolve as resolve2 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";

// src/host/store.ts
import { mkdir, readFile, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
function emptyStateV2() {
  return { version: 2, revision: 0, repositories: [], worktrees: [], sessions: [], directions: [], forkEdges: [] };
}
function newId() {
  return randomUUID();
}
function deepFreeze(value) {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
var StateSchemaError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "StateSchemaError";
  }
};
var RevisionConflictError = class extends Error {
  constructor(expected, actual) {
    super(`revision conflict: expected ${expected}, actual ${actual}`);
    this.name = "RevisionConflictError";
  }
};
var isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
var isString = (value) => typeof value === "string";
function requireString(value, field) {
  if (!isString(value)) throw new StateSchemaError(`${field} must be a string`);
  return value;
}
function optionalBoolean(value, field) {
  if (value === void 0) return void 0;
  if (typeof value !== "boolean") throw new StateSchemaError(`${field} must be boolean`);
  return value;
}
function optionalString(value, field) {
  if (value === void 0 || value === null) return null;
  return requireString(value, field);
}
function validateRepo(value, i) {
  if (!isRecord(value)) throw new StateSchemaError(`repositories[${i}] must be an object`);
  return {
    id: requireString(value.id, `repositories[${i}].id`),
    canonicalCommonDir: requireString(value.canonicalCommonDir, `repositories[${i}].canonicalCommonDir`),
    primaryWorktreeId: requireString(value.primaryWorktreeId, `repositories[${i}].primaryWorktreeId`),
    ...value.identityVerified === void 0 ? {} : { identityVerified: optionalBoolean(value.identityVerified, "identityVerified") }
  };
}
function validateWorktree(value, i) {
  if (!isRecord(value)) throw new StateSchemaError(`worktrees[${i}] must be an object`);
  const managedBy = value.managedBy;
  if (managedBy !== "branchman" && managedBy !== "external") {
    throw new StateSchemaError(`worktrees[${i}].managedBy must be branchman|external`);
  }
  return {
    id: requireString(value.id, `worktrees[${i}].id`),
    repoId: requireString(value.repoId, `worktrees[${i}].repoId`),
    canonicalPath: requireString(value.canonicalPath, `worktrees[${i}].canonicalPath`),
    branchRef: optionalString(value.branchRef, `worktrees[${i}].branchRef`),
    managedBy,
    ...value.present === void 0 ? {} : { present: optionalBoolean(value.present, "present") }
  };
}
function validateSession(value, i) {
  if (!isRecord(value)) throw new StateSchemaError(`sessions[${i}] must be an object`);
  const sessionPresence = value.presence;
  if (sessionPresence !== "live" && sessionPresence !== "persisted" && sessionPresence !== "missing" && sessionPresence !== "unknown") {
    throw new StateSchemaError(`sessions[${i}].presence must be live|persisted|missing|unknown`);
  }
  if (typeof value.archived !== "boolean") throw new StateSchemaError(`sessions[${i}].archived must be a boolean`);
  return {
    sessionId: requireString(value.sessionId, `sessions[${i}].sessionId`),
    worktreeId: optionalString(value.worktreeId, `sessions[${i}].worktreeId`),
    presence: sessionPresence,
    archived: value.archived
  };
}
function validateDirection(value, i) {
  if (!isRecord(value)) throw new StateSchemaError(`directions[${i}] must be an object`);
  const state = value.state;
  if (!["creating", "ready", "conflicted", "recovery-required", "removed"].includes(state)) {
    throw new StateSchemaError(`directions[${i}].state must be a known direction state`);
  }
  return {
    id: requireString(value.id, `directions[${i}].id`),
    repoId: requireString(value.repoId, `directions[${i}].repoId`),
    worktreeId: requireString(value.worktreeId, `directions[${i}].worktreeId`),
    displayName: requireString(value.displayName, `directions[${i}].displayName`),
    primarySessionId: optionalString(value.primarySessionId, `directions[${i}].primarySessionId`),
    baseOid: requireString(value.baseOid, `directions[${i}].baseOid`),
    upstreamRef: optionalString(value.upstreamRef, `directions[${i}].upstreamRef`),
    integrationTargetWorktreeId: requireString(value.integrationTargetWorktreeId, `directions[${i}].integrationTargetWorktreeId`),
    state,
    ...value.brief === void 0 ? {} : { brief: requireString(value.brief, "brief") },
    ...value.summary === void 0 ? {} : { summary: requireString(value.summary, "summary") },
    ...value.recoveryReasons === void 0 ? {} : { recoveryReasons: (() => {
      if (!Array.isArray(value.recoveryReasons)) throw new StateSchemaError("recoveryReasons must be an array");
      return value.recoveryReasons.map((v) => requireString(v, "recoveryReasons"));
    })() },
    ...value.workspaceId === void 0 ? {} : { workspaceId: optionalString(value.workspaceId, "workspaceId") },
    ...value.createdAt === void 0 ? {} : { createdAt: requireString(value.createdAt, "createdAt") },
    ...value.updatedAt === void 0 ? {} : { updatedAt: requireString(value.updatedAt, "updatedAt") },
    ...value.mergedAt === void 0 ? {} : { mergedAt: optionalString(value.mergedAt, "mergedAt") }
  };
}
function validateForkEdge(value, i) {
  if (!isRecord(value)) throw new StateSchemaError(`forkEdges[${i}] must be an object`);
  const boundarySeq = value.boundarySeq;
  const inheritedEventCount = value.inheritedEventCount;
  if (boundarySeq !== null && (!Number.isSafeInteger(boundarySeq) || boundarySeq < 0)) throw new StateSchemaError(`forkEdges[${i}].boundarySeq must be a non-negative integer or null`);
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) throw new StateSchemaError(`forkEdges[${i}].inheritedEventCount must be a non-negative integer`);
  return {
    id: requireString(value.id, `forkEdges[${i}].id`),
    sourceSessionId: requireString(value.sourceSessionId, `forkEdges[${i}].sourceSessionId`),
    targetSessionId: requireString(value.targetSessionId, `forkEdges[${i}].targetSessionId`),
    boundarySeq,
    boundaryMessageId: optionalString(value.boundaryMessageId, `forkEdges[${i}].boundaryMessageId`),
    inheritedEventCount,
    operationId: optionalString(value.operationId, `forkEdges[${i}].operationId`)
  };
}
function validateStateV2(raw) {
  if (!isRecord(raw)) throw new StateSchemaError("state must be an object");
  if (raw.version !== 2) throw new StateSchemaError("state.version must be 2");
  if (!Number.isInteger(raw.revision) || raw.revision < 0) {
    throw new StateSchemaError("state.revision must be a non-negative integer");
  }
  const arr = (field) => {
    const value = raw[field];
    if (!Array.isArray(value)) throw new StateSchemaError(`state.${field} must be an array`);
    return value;
  };
  const repositories = arr("repositories").map((v, i) => validateRepo(v, i));
  const worktrees = arr("worktrees").map((v, i) => validateWorktree(v, i));
  const sessions = arr("sessions").map((v, i) => validateSession(v, i));
  const directions = arr("directions").map((v, i) => validateDirection(v, i));
  const forkEdges = arr("forkEdges").map((v, i) => validateForkEdge(v, i));
  const uniqueIds = /* @__PURE__ */ new Set();
  for (const entity of [...repositories, ...worktrees, ...sessions, ...directions, ...forkEdges]) {
    const id = "id" in entity ? entity.id : void 0;
    if (id !== void 0) {
      if (uniqueIds.has(id)) throw new StateSchemaError(`duplicate entity id "${id}"`);
      uniqueIds.add(id);
    }
  }
  const repos = new Map(repositories.map((r) => [r.id, r]));
  const trees = new Map(worktrees.map((w) => [w.id, w]));
  const sessionIds = /* @__PURE__ */ new Set();
  for (const s of sessions) {
    if (sessionIds.has(s.sessionId)) throw new StateSchemaError(`duplicate sessionId ${s.sessionId}`);
    sessionIds.add(s.sessionId);
    if (s.worktreeId !== null && !trees.has(s.worktreeId)) throw new StateSchemaError(`session ${s.sessionId} has no worktree`);
  }
  for (const r of repositories) if (trees.get(r.primaryWorktreeId)?.repoId !== r.id) throw new StateSchemaError(`repository ${r.id} has no primary worktree`);
  for (const w of worktrees) if (!repos.has(w.repoId)) throw new StateSchemaError(`worktree ${w.id} has no repository`);
  for (const d of directions) {
    if (!repos.has(d.repoId) || trees.get(d.worktreeId)?.repoId !== d.repoId || trees.get(d.integrationTargetWorktreeId)?.repoId !== d.repoId) throw new StateSchemaError(`direction ${d.id} has unresolved repository/worktree references`);
    if (d.primarySessionId !== null && !sessionIds.has(d.primarySessionId)) throw new StateSchemaError(`direction ${d.id} has no session`);
  }
  for (const edge of forkEdges) if (!sessionIds.has(edge.sourceSessionId) || !sessionIds.has(edge.targetSessionId)) throw new StateSchemaError(`fork edge ${edge.id} has unresolved sessions`);
  return deepFreeze({
    version: 2,
    revision: raw.revision,
    repositories,
    worktrees,
    sessions,
    directions,
    forkEdges
  });
}
var StateStore = class {
  #dataFile;
  #state = deepFreeze(emptyStateV2());
  #writeSeq = 0;
  #writeChain = Promise.resolve();
  #commitChain = Promise.resolve();
  #ready;
  constructor(dataFile) {
    if (typeof dataFile !== "string" || dataFile.length === 0) {
      throw new Error("branchman: state.dataFile must be a non-empty path");
    }
    this.#dataFile = dataFile;
    this.#ready = this.#load();
  }
  async #load() {
    await mkdir(dirname(this.#dataFile), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.#dataFile, "utf8"));
      this.#state = validateStateV2(parsed);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await this.#persist(this.#state);
    }
  }
  async ready() {
    await this.#ready;
  }
  /** Current committed state (a frozen snapshot). */
  read() {
    return this.#state;
  }
  /**
   * Commit `next` iff the current revision equals `expectedRevision`. Returns
   * the new revision. On a revision mismatch it throws RevisionConflictError;
   * on a failed write the old file AND old in-memory snapshot are preserved.
   */
  async commit(expectedRevision, next) {
    await this.#ready;
    const validated = validateStateV2(next);
    const commit = async () => {
      if (this.#state.revision !== expectedRevision) {
        throw new RevisionConflictError(expectedRevision, this.#state.revision);
      }
      const committed = deepFreeze({ ...validated, revision: expectedRevision + 1 });
      await this.#persist(committed);
      this.#state = committed;
      return committed.revision;
    };
    const queued = this.#commitChain.then(commit, commit);
    this.#commitChain = queued.then(() => void 0, () => void 0);
    return queued;
  }
  async #persist(state) {
    const write = async () => {
      await mkdir(dirname(this.#dataFile), { recursive: true });
      const seq = this.#writeSeq += 1;
      const tmp = `${this.#dataFile}.${process.pid}.${seq}.tmp`;
      try {
        const handle = await open(tmp, "wx");
        try {
          await handle.writeFile(JSON.stringify(state, null, 2), "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tmp, this.#dataFile);
      } catch (error) {
        try {
          await rm(tmp, { force: true });
        } catch {
        }
        throw error;
      }
    };
    const queued = this.#writeChain.then(write, write);
    this.#writeChain = queued.then(() => void 0, () => void 0);
    await queued;
  }
};

// src/host/migrate-v1.ts
import { createHash } from "node:crypto";

// src/domain/paths.ts
var SEP = /[\\/]+/g;
function normalizeWindowsPath(input) {
  const s = String(input ?? "");
  const trimmed = s.replace(SEP, "/").replace(/\/+$/, "");
  return trimmed.toLowerCase();
}
function normalizePath(input) {
  const s = String(input ?? "");
  if (/^(?:[a-z]:|\\\\|\/\/)/i.test(s)) return normalizeWindowsPath(s);
  const trimmed = s.replace(/\/+/g, "/").replace(/\/+$/, "");
  return trimmed || (s.startsWith("/") ? "/" : "");
}
function isInside(root, candidate) {
  const r = normalizePath(root);
  const c = normalizePath(candidate);
  if (r === "" || c === "") return false;
  if (c === r) return true;
  return c.startsWith(r === "/" ? "/" : `${r}/`);
}
function samePath(a, b) {
  return normalizePath(a) === normalizePath(b);
}

// src/host/migrate-v1.ts
var MigrationError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "MigrationError";
  }
};
var isRecord2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function legacyRepoKey(node) {
  const explicit = String(node.root ?? "").replace(/[\\/]+$/, "");
  if (explicit !== "") return normalizePath(explicit);
  const cwd = String(node.cwd ?? "");
  const at = cwd.search(/[\\/]\.branches(?:[\\/]|$)/);
  const root = at > 0 ? cwd.slice(0, at) : cwd;
  const key = normalizePath(root);
  return key === "" ? null : key;
}
function migrateV1(raw) {
  if (!isRecord2(raw)) throw new MigrationError("v1 tree must be an object");
  if (raw.version !== 1) throw new MigrationError(`unsupported tree version: ${String(raw.version)}`);
  if (!Array.isArray(raw.nodes)) throw new MigrationError("v1 tree.nodes must be an array");
  const nodes = raw.nodes.map((value, i) => {
    if (!isRecord2(value)) throw new MigrationError(`v1 tree.nodes[${i}] must be an object`);
    const name = String(value.name ?? "").trim();
    if (name === "") throw new MigrationError(`v1 tree.nodes[${i}].name must be non-empty`);
    return {
      name,
      parentName: typeof value.parentName === "string" ? value.parentName : null,
      root: typeof value.root === "string" ? value.root : null,
      cwd: typeof value.cwd === "string" ? value.cwd : null,
      branch: typeof value.branch === "string" ? value.branch : null,
      parentSessionId: typeof value.parentSessionId === "string" ? value.parentSessionId : null,
      sessionId: typeof value.sessionId === "string" ? value.sessionId : null,
      status: typeof value.status === "string" ? value.status : null,
      droppedAt: typeof value.droppedAt === "string" ? value.droppedAt : null,
      mergedAt: typeof value.mergedAt === "string" ? value.mergedAt : null,
      brief: typeof value.brief === "string" ? value.brief : "",
      inheritedEvents: Number.isSafeInteger(value.inheritedEvents) && value.inheritedEvents >= 0 ? value.inheritedEvents : 0,
      preview: typeof value.preview === "string" ? value.preview : "",
      workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : void 0,
      createdAt: typeof value.createdAt === "string" ? value.createdAt : void 0,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : void 0
    };
  });
  const sourceHash = createHash("sha256").update(JSON.stringify(raw)).digest("hex");
  const unresolved = [];
  const primaryTrees = [];
  const repoByKey = /* @__PURE__ */ new Map();
  const repoIdOf = (key) => {
    let repo = repoByKey.get(key);
    if (repo === void 0) {
      repo = { id: newId(), canonicalCommonDir: key, primaryWorktreeId: newId(), identityVerified: false };
      repoByKey.set(key, repo);
      primaryTrees.push({ id: repo.primaryWorktreeId, repoId: repo.id, canonicalPath: key, branchRef: null, managedBy: "external" });
    }
    return repo.id;
  };
  const directions = [];
  const sessions = [];
  const forkEdges = [];
  const worktrees = [];
  const nodeId = /* @__PURE__ */ new Map();
  const idKeyOf = (node) => {
    const repoKey = legacyRepoKey(node) ?? "(no-repo)";
    return `${repoKey}\0${node.name}`;
  };
  for (const node of nodes) {
    if (!nodeId.has(idKeyOf(node))) nodeId.set(idKeyOf(node), newId());
  }
  for (const node of nodes) {
    const repoKey = legacyRepoKey(node);
    if (repoKey === null) {
      unresolved.push({ legacyName: node.name, repoKey, reason: "no root/cwd to derive a repository" });
      continue;
    }
    const repoId = repoIdOf(repoKey);
    const isDropped = node.status === "dropped" || node.droppedAt != null;
    const worktreeId = newId();
    const primarySessionId = typeof node.sessionId === "string" && node.sessionId !== "" ? node.sessionId : null;
    const directionId = nodeId.get(idKeyOf(node)) ?? newId();
    {
      worktrees.push({
        id: worktreeId,
        repoId,
        canonicalPath: normalizePath(String(node.cwd ?? node.root ?? "")),
        branchRef: typeof node.branch === "string" ? node.branch : null,
        managedBy: "branchman",
        present: !isDropped
      });
    }
    directions.push({
      id: directionId,
      repoId,
      worktreeId,
      displayName: node.name,
      primarySessionId,
      // baseOid is unknown from v1 (the old file never stored it); the
      // direction is created in a recovery state until operations re-resolve it.
      baseOid: "",
      upstreamRef: null,
      integrationTargetWorktreeId: repoByKey.get(repoKey)?.primaryWorktreeId ?? "",
      state: isDropped ? "removed" : "recovery-required",
      brief: node.brief ?? "",
      summary: node.preview ?? "",
      ...node.workspaceId ? { workspaceId: node.workspaceId } : {},
      ...node.createdAt ? { createdAt: node.createdAt } : {},
      ...node.updatedAt ? { updatedAt: node.updatedAt } : {},
      mergedAt: node.mergedAt ?? null
    });
    if (primarySessionId !== null) {
      sessions.push({
        sessionId: primarySessionId,
        worktreeId,
        presence: "unknown",
        archived: false
      });
    }
  }
  for (const node of nodes) {
    if (node.parentSessionId != null && node.parentSessionId !== "" && node.sessionId != null && node.sessionId !== "") {
      if (!sessions.some((s) => s.sessionId === node.parentSessionId)) sessions.push({ sessionId: node.parentSessionId, worktreeId: null, presence: "unknown", archived: false });
      if (!sessions.some((s) => s.sessionId === node.sessionId)) continue;
      forkEdges.push({
        id: newId(),
        sourceSessionId: node.parentSessionId,
        targetSessionId: node.sessionId,
        boundarySeq: null,
        boundaryMessageId: null,
        inheritedEventCount: node.inheritedEvents ?? 0,
        operationId: null
      });
    }
  }
  const state = {
    version: 2,
    revision: 0,
    repositories: [...repoByKey.values()].map((r) => ({ ...r })),
    worktrees: [...primaryTrees, ...worktrees],
    sessions,
    directions,
    forkEdges
  };
  const directionIdByNameRepo = /* @__PURE__ */ new Map();
  for (const node of nodes) {
    const dirId = nodeId.get(idKeyOf(node));
    if (dirId !== void 0) directionIdByNameRepo.set(idKeyOf(node), dirId);
  }
  for (const node of nodes) {
    if (node.parentName == null || node.parentName === "") continue;
    const parentKey = `${legacyRepoKey(node) ?? "(no-repo)"}\0${node.parentName}`;
    const target = directionIdByNameRepo.get(parentKey);
    if (target === void 0 || target === "") {
      unresolved.push({ legacyName: node.name, repoKey: legacyRepoKey(node), reason: `parentName "${node.parentName}" not found in its repo` });
    }
    const visited = /* @__PURE__ */ new Set([idKeyOf(node)]);
    let parent = node.parentName;
    while (parent) {
      const key = `${legacyRepoKey(node) ?? "(no-repo)"}\0${parent}`;
      if (visited.has(key)) {
        unresolved.push({ legacyName: node.name, repoKey: legacyRepoKey(node), reason: "parentName cycle" });
        break;
      }
      visited.add(key);
      parent = nodes.find((n) => idKeyOf(n) === key)?.parentName;
    }
  }
  for (const node of nodes) {
    const direction = directions.find((d) => d.id === nodeId.get(idKeyOf(node)));
    if (!direction) continue;
    const issues = unresolved.filter((i) => i.legacyName === node.name && i.repoKey === legacyRepoKey(node));
    direction.recoveryReasons = issues.map((i) => i.reason);
    if (node.parentName && issues.length === 0) {
      const parentId = directionIdByNameRepo.get(`${legacyRepoKey(node)}\0${node.parentName}`);
      const parent = directions.find((d) => d.id === parentId);
      if (parent) direction.integrationTargetWorktreeId = parent.worktreeId;
    }
  }
  validateStateV2(state);
  return {
    sourceHash,
    inputNodeCount: nodes.length,
    outputDirectionCount: directions.length,
    unresolved,
    state
  };
}

// src/host/git-adapter.ts
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
var GitError = class extends Error {
  kind;
  code;
  stderr;
  constructor(kind, message, code = null, stderr = "") {
    super(message);
    this.name = "GitError";
    this.kind = kind;
    this.code = code;
    this.stderr = stderr;
  }
};
function execGitRunner(gitPath) {
  return {
    run(args, options) {
      const opts = options ?? { cwd: process.cwd() };
      return new Promise((resolve3, reject) => {
        execFile(
          gitPath,
          args,
          {
            cwd: opts.cwd,
            windowsHide: true,
            maxBuffer: opts.maxBuffer ?? 8 * 1024 * 1024,
            timeout: opts.timeoutMs ?? 15e3,
            signal: opts.signal
          },
          (error, stdout, stderr) => {
            if (error === null) {
              resolve3({ stdout: String(stdout), stderr: String(stderr) });
              return;
            }
            const code = typeof error.code === "number" ? error.code : null;
            const rawStderr = String(stderr ?? "");
            const rawMessage = String(error.message ?? "");
            let kind = "io";
            if (error.killed === true) kind = "timeout";
            else if (opts.signal?.aborted === true) kind = "cancelled";
            else if (code === 128) kind = "not-repo";
            else kind = "io";
            reject(new GitError(kind, rawMessage.slice(0, 300), code, rawStderr.slice(0, 2e3)));
          }
        );
      });
    }
  };
}
var GitAdapter = class {
  #runner;
  #cwd;
  constructor(runner, cwd) {
    this.#runner = runner;
    this.#cwd = cwd;
  }
  /**
   * Resolve the git identity of the repository containing `cwd`.
   *
   * - worktree top level comes from `rev-parse --show-toplevel`;
   * - common dir comes from `rev-parse --path-format=absolute --git-common-dir`
   *   (absolute even inside a linked worktree, where `.git` is a file);
   * - HEAD oid from `rev-parse HEAD`;
   * - branch ref from `symbolic-ref --quiet --short HEAD`, null when detached.
   */
  async identify() {
    const worktreePath = await this.#text(["rev-parse", "--show-toplevel"]);
    const commonDir = await this.#text(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    const headOid = await this.#text(["rev-parse", "HEAD"]);
    const branchRef = await this.#optionalText(["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return {
      commonDir: normalizePath(await realpath(commonDir)),
      worktreePath: normalizePath(await realpath(worktreePath)),
      headOid,
      branchRef
    };
  }
  async #text(args) {
    const { stdout } = await this.#runner.run(args, { cwd: this.#cwd });
    const value = stdout.trim();
    if (value === "") throw new GitError("unknown", `git ${args[0]} produced no output`, null, "");
    return value;
  }
  async #optionalText(args) {
    try {
      const { stdout } = await this.#runner.run(args, { cwd: this.#cwd });
      const value = stdout.trim();
      return value === "" ? null : value;
    } catch (error) {
      if (error instanceof GitError && error.code === 1) return null;
      throw error;
    }
  }
};

// src/host/host-adapter.ts
var HostAdapter = class {
  #services;
  #disposed = false;
  #generation = 0;
  constructor(services = {}) {
    this.#services = { ...services };
  }
  /** Replace a service binding; returns a disposer that only clears ITS binding. */
  bind(key, value) {
    this.#assertActive();
    this.#generation++;
    this.#services[key] = value;
    const current = value;
    return () => {
      if (this.#services[key] === current) {
        this.#services[key] = null;
        this.#generation++;
      }
    };
  }
  capabilities() {
    return {
      inheritedFork: this.#services.sessionQuery != null && this.#services.agents != null,
      sessionQuery: this.#services.sessionQuery != null,
      workspaceRegistration: this.#services.workspaceRegistry != null
    };
  }
  /**
   * Run `fn` with a live or prepared observation, releasing the lease exactly
   * once on EVERY exit path — success, thrown error, or cancellation. This is
   * the B05 fix: the old `ensurePreview` observed but never disposed.
   */
  async withObservation(sessionId, fn) {
    this.#assertActive();
    const query = this.#services.sessionQuery;
    if (query == null) throw new Error("branchman: sessionQuery is not available");
    const generation = this.#generation;
    const lease = await query.observeSession(sessionId);
    try {
      this.#assertActive();
      if (generation !== this.#generation) throw new Error("branchman: host services changed during observation");
      const observation = { events: lease.events, cursor: lease.cursor, header: lease.header, projections: lease.projections };
      return await fn(observation);
    } finally {
      lease[Symbol.dispose]();
    }
  }
  /**
   * Resolve a session's presence without conflating "detached from live" with
   * "deleted" (B07). Live is checked first; only when the session is not live
   * do we consult the persisted corpus; a corpus read failure is `unknown`,
   * never `missing`.
   */
  async sessionPresence(sessionId) {
    this.#assertActive();
    const sessions = this.#services.sessions;
    if (sessions != null && typeof sessions.get === "function") {
      if (sessions.get(sessionId) !== void 0) return "live";
    }
    const query = this.#services.sessionQuery;
    if (query == null || typeof query.listSessions !== "function") return "unknown";
    const generation = this.#generation;
    try {
      const records = await query.listSessions();
      if (this.#disposed || generation !== this.#generation) return "unknown";
      for (const record of records) {
        if (record?.header?.id === sessionId) return "persisted";
      }
      return "missing";
    } catch {
      return "unknown";
    }
  }
  async dispose() {
    this.#disposed = true;
    this.#generation++;
    this.#services = {};
  }
  #assertActive() {
    if (this.#disposed) throw new Error("branchman: host adapter is disposed");
  }
};

// src/host/operations.ts
import { mkdir as mkdir2, readdir, readFile as readFile2, rename as rename2, rm as rm2, open as open2 } from "node:fs/promises";
import { join } from "node:path";
function requestDigest(body) {
  const canonical = (v) => Array.isArray(v) ? v.map(canonical) : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, canonical(x)])) : v;
  return JSON.stringify(canonical(body));
}
var IdempotencyConflictError = class extends Error {
  constructor(id) {
    super(`requestId "${id}" was already used with a different body`);
    this.name = "IdempotencyConflictError";
  }
};
var OperationsEngine = class {
  #effects;
  #now;
  #journal;
  #records = /* @__PURE__ */ new Map();
  #byRequest = /* @__PURE__ */ new Map();
  #inflight = /* @__PURE__ */ new Map();
  #queues = /* @__PURE__ */ new Map();
  #ready;
  constructor(effects, now = () => (/* @__PURE__ */ new Date()).toISOString(), options = {}) {
    this.#effects = effects;
    this.#now = now;
    this.#journal = options.journalDirectory;
    this.#ready = this.#load();
  }
  async ready() {
    await this.#ready;
  }
  async #load() {
    if (!this.#journal) return;
    await mkdir2(this.#journal, { recursive: true });
    for (const file of await readdir(this.#journal)) {
      if (!/^[\da-f-]{36}\.json$/i.test(file)) continue;
      const r = JSON.parse(await readFile2(join(this.#journal, file), "utf8"));
      if (typeof r.id !== "string" || file !== `${r.id}.json` || typeof r.requestId !== "string" || !["fork", "merge", "sync", "remove"].includes(r.kind) || !["running", "succeeded", "failed", "recovery-required"].includes(r.state) || !Array.isArray(r.ownedResources) || typeof r.requestDigest !== "string") throw new Error(`invalid operation journal: ${file}`);
      const interrupted = r.state === "running";
      if (interrupted) {
        r.state = "recovery-required";
        r.errorCode = "interrupted";
      }
      if (this.#byRequest.has(r.requestId)) throw new Error(`duplicate requestId in operation journal: ${r.requestId}`);
      this.#records.set(r.id, r);
      this.#byRequest.set(r.requestId, r.id);
      if (interrupted) await this.#save(r);
    }
  }
  async #save(record) {
    if (this.#journal) {
      const dest = join(this.#journal, `${record.id}.json`), tmp = `${dest}.${newId()}.tmp`;
      try {
        const handle = await open2(tmp, "wx");
        try {
          await handle.writeFile(JSON.stringify(record, null, 2));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename2(tmp, dest);
      } catch (error) {
        await rm2(tmp, { force: true }).catch(() => {
        });
        throw error;
      }
    }
    this.#records.set(record.id, structuredClone(record));
    this.#byRequest.set(record.requestId, record.id);
  }
  #enqueue(repoId, work) {
    const prev = this.#queues.get(repoId) ?? Promise.resolve();
    const run = prev.then(work, work);
    const tail = run.then(() => void 0, () => void 0);
    this.#queues.set(repoId, tail);
    void tail.then(() => {
      if (this.#queues.get(repoId) === tail) this.#queues.delete(repoId);
    });
    return run;
  }
  getOperation(id) {
    const r = this.#records.get(id);
    return r ? structuredClone(r) : void 0;
  }
  getByRequestId(id) {
    const key = this.#byRequest.get(id);
    return key ? this.getOperation(key) : void 0;
  }
  list() {
    return [...this.#records.values()].map((r) => structuredClone(r));
  }
  summaries() {
    return [...this.#records.values()].map((r) => ({
      id: r.id,
      kind: r.kind,
      state: r.state,
      phase: r.phase,
      errorCode: r.errorCode?.slice(0, 1e3) ?? null,
      createdAt: r.createdAt,
      directionId: r.directionId ?? null
    })).sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0);
  }
  #result(r) {
    return {
      operationId: r.id,
      directionId: r.directionId ?? null,
      state: r.state,
      phase: r.phase,
      code: r.errorCode,
      retryable: r.state === "failed" || r.state === "recovery-required"
    };
  }
  #reserve(requestId, digest, work) {
    const prior = this.#inflight.get(requestId);
    if (prior) return prior.digest === digest ? prior.promise : Promise.reject(new IdempotencyConflictError(requestId));
    const promise = Promise.resolve().then(work);
    const slot = { digest, promise };
    this.#inflight.set(requestId, slot);
    void promise.then(() => {
      if (this.#inflight.get(requestId) === slot) this.#inflight.delete(requestId);
    }, () => {
      if (this.#inflight.get(requestId) === slot) this.#inflight.delete(requestId);
    });
    return promise;
  }
  fork(request) {
    const snapshot = structuredClone(request), digest = requestDigest({ kind: "fork", request: snapshot });
    return this.#reserve(snapshot.requestId, digest, async () => {
      await this.#ready;
      const prior = this.getByRequestId(snapshot.requestId);
      if (prior) {
        if (prior.requestDigest !== digest) throw new IdempotencyConflictError(snapshot.requestId);
        return this.#result(prior);
      }
      const identity = await this.#effects.identify(snapshot.sourceCwd);
      return this.#enqueue(identity.repoId, async () => {
        const record = {
          id: newId(),
          requestId: snapshot.requestId,
          kind: "fork",
          phase: "plan",
          state: "running",
          ownedResources: [],
          errorCode: null,
          requestDigest: digest,
          createdAt: this.#now(),
          request: snapshot
        };
        const directionId = newId();
        record.plan = {
          repoId: identity.repoId,
          sourcePath: identity.worktreePath,
          headOid: identity.headOid,
          baseOid: snapshot.codeSource.kind === "explicit-commit" ? snapshot.codeSource.oid : identity.headOid,
          directionId,
          worktreeId: newId(),
          branch: `branchman/${directionId}`,
          worktreePath: join(identity.managedRoot ?? identity.worktreePath, ".branches", directionId)
        };
        await this.#save(record);
        return this.#runFork(record);
      });
    });
  }
  async recover(operationId) {
    await this.#ready;
    const record = this.getOperation(operationId);
    if (!record) throw new Error(`unknown operation ${operationId}`);
    if (record.state === "succeeded") return this.#result(record);
    if (record.kind !== "fork" || !record.request || !record.plan) throw new Error(`manual recovery required for ${record.kind}`);
    return this.#reserve(record.requestId, record.requestDigest, () => this.#enqueue(record.plan.repoId, async () => {
      let reconciled = record;
      if (this.#effects.reconcile) reconciled = await this.#effects.reconcile(record);
      else if (record.ownedResources.length > 0) {
        record.state = "recovery-required";
        record.errorCode = "resource-reconciliation-required";
        await this.#save(record);
        return this.#result(record);
      }
      if (reconciled.state === "succeeded") {
        await this.#save(reconciled);
        return this.#result(reconciled);
      }
      return this.#runFork(reconciled);
    }));
  }
  async #runFork(record) {
    const request = record.request, plan = record.plan;
    const phase = async (value) => {
      record.phase = value;
      record.state = "running";
      record.errorCode = null;
      await this.#save(record);
    };
    try {
      if (!record.ownedResources.includes(`worktree:${plan.worktreePath}`)) {
        await phase("capture");
        const captured = await this.#effects.captureChanges?.(structuredClone(record));
        if (captured) {
          record.resolvedBoundary = captured.boundary;
          await this.#save(record);
        }
        await phase("create-worktree");
        await this.#effects.createWorktree(plan.repoId, plan.branch, plan.worktreePath, plan.baseOid);
        record.ownedResources.push(`worktree:${plan.worktreePath}`, `branch:${plan.branch}`);
        await this.#save(record);
      }
      if (!record.child) {
        if (request.codeSource.kind === "source-head" && request.codeSource.carryChanges) {
          await phase("carry");
          const carry = await this.#effects.carryChanges(plan.repoId, plan.worktreePath, structuredClone(record));
          if (carry.failed.length) throw new Error(`carry-incomplete: ${carry.failed.join(", ")}`);
        }
        await phase("create-session");
        record.child = await this.#effects.createChildSession({
          worktreePath: plan.worktreePath,
          sourceSessionId: request.sourceSessionId,
          history: request.history,
          ...request.messageId ? { messageId: request.messageId } : {},
          ...record.resolvedBoundary != null ? { boundarySeq: record.resolvedBoundary } : request.boundarySeq !== void 0 ? { boundarySeq: request.boundarySeq } : {},
          operationId: record.id
        });
        record.ownedResources.push(`session:${record.child.sessionId}`);
        await this.#save(record);
      }
      if (request.history === "inherit" && !record.child.seeded) throw new Error("history-not-inherited");
      await phase("attach-workspace");
      const workspace = await this.#effects.attachWorkspace(plan.worktreePath, request.displayName, record.child.sessionId);
      if (workspace.warning) throw new Error(`workspace-incomplete: ${workspace.warning}`);
      if (workspace.workspaceId) {
        record.workspaceId = workspace.workspaceId;
        record.ownedResources.push(`workspace:${workspace.workspaceId}`);
        await this.#save(record);
      }
      await phase("commit-direction");
      await this.#effects.persistDirection({
        directionId: plan.directionId,
        repoId: plan.repoId,
        worktreeId: plan.worktreeId,
        displayName: request.displayName,
        baseOid: plan.baseOid,
        primarySessionId: record.child.sessionId,
        worktreePath: plan.worktreePath,
        branch: plan.branch,
        brief: request.brief,
        sourceSessionId: request.sourceSessionId,
        ...request.messageId ? { messageId: request.messageId } : {},
        ...record.child.boundary != null ? { boundarySeq: record.child.boundary } : request.boundarySeq !== void 0 ? { boundarySeq: request.boundarySeq } : {},
        inheritedEventCount: record.child.inherited,
        ...record.workspaceId ? { workspaceId: record.workspaceId } : {},
        operationId: record.id
      });
      record.directionId = plan.directionId;
      record.phase = "completed";
      record.state = "succeeded";
      await this.#save(record);
    } catch (error) {
      record.errorCode = error instanceof Error ? error.message : String(error);
      let clean2 = record.ownedResources.length === 0;
      if (!record.child && !["create-session", "attach-workspace", "commit-direction"].includes(record.phase) && record.ownedResources.includes(`worktree:${plan.worktreePath}`)) {
        try {
          await this.#effects.removeWorktree(plan.repoId, plan.worktreePath, plan.branch);
          record.ownedResources = [];
          clean2 = true;
        } catch {
          clean2 = false;
        }
      }
      record.state = clean2 ? "failed" : "recovery-required";
      await this.#save(record);
    }
    return this.#result(record);
  }
  run(kind, requestId, payload, repoId, effect) {
    const digest = requestDigest({ kind, payload });
    return this.#reserve(requestId, digest, async () => {
      await this.#ready;
      const prior = this.getByRequestId(requestId);
      if (prior) {
        if (prior.requestDigest !== digest) throw new IdempotencyConflictError(requestId);
        return this.#result(prior);
      }
      return this.#enqueue(repoId, async () => {
        const record = {
          id: newId(),
          requestId,
          kind,
          phase: kind,
          state: "running",
          ownedResources: [],
          errorCode: null,
          requestDigest: digest,
          createdAt: this.#now()
        };
        await this.#save(record);
        try {
          await effect();
          record.state = "succeeded";
          record.phase = "completed";
        } catch (error) {
          record.state = "recovery-required";
          record.errorCode = error instanceof Error ? error.message : String(error);
        }
        await this.#save(record);
        return this.#result(record);
      });
    });
  }
  async remove(request) {
    const repoId = await this.#effects.directionRepo?.(request.directionId) ?? `direction:${request.directionId}`;
    return this.run("remove", request.requestId, request, repoId, () => this.#effects.removeDirection(repoId, request.directionId, ""));
  }
};

// src/host/changes.ts
import { mkdir as mkdir3, readFile as readFile3, writeFile, copyFile, lstat, realpath as realpath2, stat, rm as rm3 } from "node:fs/promises";
import { join as join2, dirname as dirname2, resolve, relative, isAbsolute } from "node:path";
import { createHash as createHash2 } from "node:crypto";
var paths = ["--", ".", ":(exclude).branches"];
var sha = (raw) => createHash2("sha256").update(raw).digest("hex");
var ChangeSnapshots = class {
  constructor(git, directory) {
    this.git = git;
    this.directory = directory;
  }
  folder(op) {
    return join2(this.directory, op.id);
  }
  async capture(op) {
    const p = op.plan, root = p.sourcePath, folder = this.folder(op);
    await mkdir3(folder, { recursive: true });
    const head = (await this.git.run(["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
    if (head !== p.headOid) throw new Error("source HEAD changed after planning; submit a new request");
    const status = () => this.git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...paths], { cwd: root });
    const before = (await status()).stdout;
    const patch = join2(folder, "changes.patch");
    await this.git.run(["diff", "--binary", "--no-ext-diff", `--output=${patch}`, p.headOid, ...paths], { cwd: root, timeoutMs: 6e4 });
    const untracked = (await this.git.run(["ls-files", "--others", "--exclude-standard", "-z", ...paths], { cwd: root })).stdout.split("\0").filter(Boolean);
    const tracked = (await this.git.run(["diff", "--name-only", "-z", p.headOid, ...paths], { cwd: root })).stdout.split("\0").filter(Boolean);
    const names = [.../* @__PURE__ */ new Set([...untracked, ...tracked])];
    const files = [];
    for (const name of names) {
      if (isAbsolute(name) || name.split(/[\\/]/).includes("..")) throw new Error("unsafe untracked path");
      const source = resolve(root, name), canonicalRoot = await realpath2(root);
      try {
        await lstat(source);
      } catch (e) {
        if (e.code === "ENOENT" && tracked.includes(name)) continue;
        throw e;
      }
      const canonicalSource = await realpath2(source);
      const rel = relative(canonicalRoot, canonicalSource);
      if (rel.startsWith("..") || isAbsolute(rel) || !(await lstat(source)).isFile()) throw new Error(`unsupported external/symlink file: ${name}`);
      let ancestor = source;
      while (ancestor !== resolve(root)) {
        if ((await lstat(ancestor)).isSymbolicLink()) throw new Error(`symlink requires manual carry: ${name}`);
        ancestor = dirname2(ancestor);
      }
      const dest = join2(folder, "untracked", name);
      await mkdir3(dirname2(dest), { recursive: true });
      await copyFile(source, dest);
      files.push({ path: name, hash: sha(await readFile3(dest)), tracked: tracked.includes(name) });
    }
    if ((await status()).stdout !== before || (await this.git.run(["rev-parse", "HEAD"], { cwd: root })).stdout.trim() !== head) throw new Error("source changed during capture; retry with a new request");
    for (const item of files) if (sha(await readFile3(join2(root, item.path))) !== item.hash) throw new Error("source bytes changed during capture");
    const verificationPatch = join2(folder, "verify.patch");
    try {
      await this.git.run(["diff", "--binary", "--no-ext-diff", `--output=${verificationPatch}`, p.headOid, ...paths], { cwd: root, timeoutMs: 6e4 });
      if (sha(await readFile3(verificationPatch)) !== sha(await readFile3(patch))) throw new Error("source diff changed during capture");
    } finally {
      await rm3(verificationPatch, { force: true });
    }
    await writeFile(join2(folder, "capture.json"), JSON.stringify({ baseOid: head, files, patchHash: sha(await readFile3(patch)) }));
  }
  async carry(op) {
    const folder = this.folder(op), target = op.plan.worktreePath;
    const capture = JSON.parse(await readFile3(join2(folder, "capture.json"), "utf8"));
    const patch = join2(folder, "changes.patch"), raw = await readFile3(patch);
    if (capture.patchHash !== sha(raw)) throw new Error("capture checksum mismatch");
    const marker = join2(folder, "carried.json");
    const targetDiff = async () => {
      const path = join2(folder, "target-verify.patch");
      try {
        await this.git.run(["diff", "--binary", "--no-ext-diff", `--output=${path}`, capture.baseOid, ...paths], { cwd: target });
        return sha(await readFile3(path));
      } finally {
        await rm3(path, { force: true });
      }
    };
    const targetStatus = async () => (await this.git.run(["status", "--porcelain=v1", "-z", "--untracked-files=all", ...paths], { cwd: target })).stdout;
    try {
      const finished2 = JSON.parse(await readFile3(marker, "utf8"));
      if (finished2.version !== 1 || finished2.baseOid !== capture.baseOid || (await this.git.run(["rev-parse", "HEAD"], { cwd: target })).stdout.trim() !== capture.baseOid || finished2.status !== await targetStatus() || finished2.diffHash !== await targetDiff()) throw new Error("carried worktree changed; manual recovery required");
      for (const item of finished2.files) {
        let hash;
        try {
          hash = sha(await readFile3(join2(target, item.path)));
        } catch (e) {
          if (e.code !== "ENOENT") throw e;
          hash = null;
        }
        if (hash !== item.hash) throw new Error("carried worktree changed; manual recovery required");
      }
      return { carried: finished2.files.map((f) => f.path), failed: [] };
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    const dirty = (await this.git.run(["status", "--porcelain=v1", ...paths], { cwd: target })).stdout.trim();
    if (dirty) throw new Error("partial carry detected; manual recovery required");
    if (raw.length) await this.git.run(["apply", "--check", "--binary", patch], { cwd: target });
    for (const item of capture.files) {
      const source = join2(folder, "untracked", item.path);
      if (sha(await readFile3(source)) !== item.hash) throw new Error("untracked capture checksum mismatch");
      if (item.tracked) continue;
      try {
        await stat(join2(target, item.path));
        throw new Error(`untracked target already exists: ${item.path}`);
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    if (raw.length) await this.git.run(["apply", "--binary", patch], { cwd: target });
    for (const item of capture.files) {
      const dest = join2(target, item.path);
      await mkdir3(dirname2(dest), { recursive: true });
      await copyFile(join2(folder, "untracked", item.path), dest);
    }
    const changed = (await this.git.run(["diff", "--name-only", "-z", capture.baseOid, ...paths], { cwd: target })).stdout.split("\0").filter(Boolean);
    const finished = [];
    for (const name of /* @__PURE__ */ new Set([...changed, ...capture.files.map((f) => f.path)])) {
      try {
        finished.push({ path: name, hash: sha(await readFile3(join2(target, name))) });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
        finished.push({ path: name, hash: null });
      }
    }
    await writeFile(marker, JSON.stringify({ version: 1, baseOid: capture.baseOid, diffHash: await targetDiff(), status: await targetStatus(), files: finished }));
    return { carried: [...changed, ...capture.files.map((f) => f.path)], failed: [] };
  }
};

// src/host/session-fork.ts
function latestCompletedPrefixBoundary(events) {
  const end = events.findLastIndex((e) => e.type === "turn/end");
  if (end < 0) return void 0;
  let boundary = events[end].seq;
  for (const next of events.slice(end + 1)) {
    if (next.type === "turn/start" || next.type === "user/message" && next.surfaceOp === "append" || next.type === "agent/inbox/spliced") break;
    boundary = next.seq;
  }
  return boundary;
}
function resolveMessageBoundary(events, messageId) {
  const at = events.findIndex((e) => e?.data?.message?.id === messageId || e?.data?.id === messageId);
  if (at < 0) return void 0;
  const end = events.findIndex((e, i) => i >= at && e.type === "turn/end");
  if (end < 0) return void 0;
  let boundary = events[end].seq;
  for (const next of events.slice(end + 1)) {
    if (next.type === "turn/start" || next.type === "user/message" && next.surfaceOp === "append" || next.type === "agent/inbox/spliced") break;
    boundary = next.seq;
  }
  return boundary;
}
function forkBoundary(events, input) {
  const cut = input.boundarySeq ?? (input.messageId ? resolveMessageBoundary(events, input.messageId) : latestCompletedPrefixBoundary(events));
  if (!Number.isSafeInteger(cut) || events[cut]?.seq !== cut) throw new Error(input.messageId ? "message has no completed fork boundary" : "source has no valid completed fork boundary");
  return cut;
}

// src/host/api.ts
var PROTOCOL_VERSION = 2;
var SCHEMA_VERSION = 2;
var BUILD_ID = "0.3.0";
var ApiValidationError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "ApiValidationError";
    this.code = code;
  }
};
var isRecord3 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function requireString2(value, field) {
  if (typeof value !== "string" || value.trim() === "") throw new ApiValidationError("invalid-argument", `${field} must be a non-empty string`);
  return value;
}
function optionalString2(value, field) {
  if (value === void 0 || value === null) return void 0;
  if (typeof value !== "string") throw new ApiValidationError("invalid-argument", `${field} must be a string`);
  return value;
}
function parseForkRequest(body) {
  if (!isRecord3(body)) throw new ApiValidationError("invalid-argument", "body must be an object");
  const requestId = requireString2(body.requestId, "requestId");
  const sourceSessionId = requireString2(body.sourceSessionId, "sourceSessionId");
  const sourceCwd = requireString2(body.sourceCwd, "sourceCwd");
  const displayName = requireString2(body.displayName, "displayName");
  if (displayName.length > 120 || /[\u0000-\u001f]/.test(displayName)) throw new ApiValidationError("invalid-argument", "displayName exceeds 120 characters or contains control characters");
  if (body.brief !== void 0 && typeof body.brief !== "string") throw new ApiValidationError("invalid-argument", "brief must be a string");
  const brief = typeof body.brief === "string" ? body.brief : "";
  if (brief.length > 8e3) throw new ApiValidationError("invalid-argument", "brief exceeds 8000 characters");
  const messageId = optionalString2(body.messageId, "messageId");
  const boundarySeq = typeof body.boundarySeq === "number" && Number.isSafeInteger(body.boundarySeq) ? body.boundarySeq : void 0;
  if (body.boundarySeq !== void 0 && (boundarySeq === void 0 || boundarySeq < 0)) throw new ApiValidationError("invalid-argument", "boundarySeq must be a non-negative safe integer");
  if (body.history !== void 0 && body.history !== "blank" && body.history !== "inherit") throw new ApiValidationError("invalid-argument", "history must be inherit or blank");
  const history = body.history === "blank" ? "blank" : "inherit";
  const codeSourceRaw = body.codeSource;
  if (!isRecord3(codeSourceRaw)) throw new ApiValidationError("invalid-argument", "codeSource must be an object");
  let codeSource;
  if (codeSourceRaw.kind === "source-head") {
    if (codeSourceRaw.carryChanges !== void 0 && typeof codeSourceRaw.carryChanges !== "boolean") throw new ApiValidationError("invalid-argument", "carryChanges must be boolean");
    codeSource = { kind: "source-head", carryChanges: codeSourceRaw.carryChanges !== false };
  } else if (codeSourceRaw.kind === "explicit-commit") {
    const oid = requireString2(codeSourceRaw.oid, "codeSource.oid");
    codeSource = { kind: "explicit-commit", oid, carryChanges: false };
  } else {
    throw new ApiValidationError("invalid-argument", "codeSource.kind must be source-head | explicit-commit");
  }
  return {
    requestId,
    sourceSessionId,
    sourceCwd,
    ...messageId === void 0 ? {} : { messageId },
    ...boundarySeq === void 0 ? {} : { boundarySeq },
    displayName,
    brief,
    codeSource,
    history
  };
}
function ok(data, revision) {
  return { protocolVersion: PROTOCOL_VERSION, schemaVersion: SCHEMA_VERSION, buildId: BUILD_ID, revision, ok: true, data };
}
function errorEnvelope(error, operationId = null, retryable = false) {
  if (error instanceof ApiValidationError) {
    return {
      protocolVersion: PROTOCOL_VERSION,
      schemaVersion: SCHEMA_VERSION,
      buildId: BUILD_ID,
      ok: false,
      code: error.code,
      message: error.message,
      operationId,
      retryable: false
    };
  }
  const message = error instanceof Error ? error.message : String(error);
  return {
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    buildId: BUILD_ID,
    ok: false,
    code: "internal",
    message,
    operationId,
    retryable
  };
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

// src/host/projection.ts
var GOAL_BOILERPLATE_RE = /^\s*reference attachments for (?:the )?goal objective\.?\s*$/i;
var PREVIEW_MAX = 80;
var flattenText = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
function isTextBlock(block) {
  return typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string";
}
function isUserMessageEvent(event) {
  return event.type === "user/message" && typeof event.data === "object" && event.data !== null;
}
function derivePreview(events) {
  if (!Array.isArray(events)) return null;
  let objective = null;
  let firstHuman = null;
  for (const raw of events) {
    const event = raw;
    if (event.type === "goal/change") {
      const data = event.data ?? {};
      if (data.operation === "clear") {
        objective = null;
        continue;
      }
      const text2 = flattenText(data.goal?.objective);
      if (text2 !== "") objective = text2;
      continue;
    }
    if (firstHuman === null && isUserMessageEvent(event)) {
      if (event.data.source?.kind !== "user") continue;
      const blocks = Array.isArray(event.data.content) ? event.data.content : [];
      const text2 = flattenText(blocks.filter(isTextBlock).map((block) => block.text).join(" "));
      if (text2 === "" || GOAL_BOILERPLATE_RE.test(text2)) continue;
      firstHuman = text2;
    }
    if (objective !== null && firstHuman !== null) break;
  }
  const text = objective ?? firstHuman;
  if (text === null || text === "") return null;
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX - 1)}\u2026` : text;
}

// src/host/runtime.ts
var loadPeer = async (name) => import(name);
var inject = ["webServer", "sessions", "tools"];
var schema;
try {
  const mod = await loadPeer("schemastery");
  schema = mod.default ?? mod;
} catch {
}
var Config = schema?.object({ dataFile: schema.string().default(""), defaultRoot: schema.string().default(""), gitPath: schema.string().default("git") });
var BranchmanRuntime = class {
  constructor(ctx, config, peers) {
    this.ctx = ctx;
    this.config = config;
    this.peers = peers;
    if (!config.dataFile) throw new Error("branchman: dataFile must be configured");
    this.store = new StateStore(config.dataFile);
    this.host = new HostAdapter({ sessions: ctx.sessions });
    this.git = execGitRunner(config.gitPath ?? "git");
    this.changes = new ChangeSnapshots(this.git, join3(dirname3(config.dataFile), "captures"));
    this.operations = new OperationsEngine({
      identify: (cwd) => this.identify(cwd),
      captureChanges: async (op) => {
        this.assertActive();
        if (!this.services.workspaceRegistry || !this.services.agents || !this.services.agentPresets) throw new Error("required host services unavailable");
        const boundary = await this.host.withObservation(op.request.sourceSessionId, async (observation) => {
          if (!samePath(observation.header?.cwd ?? "", op.plan.sourcePath) && !isInside(op.plan.sourcePath, observation.header?.cwd ?? "")) throw new Error("source session cwd does not belong to the planned worktree");
          const preset = await this.services.agentPresets.resolve(observation.projections?.values?.agentPreset ?? observation.header?.agentPreset);
          if (!preset?.id || preset.broken) throw new Error("source agent preset unavailable or broken");
          const model = this.services.agentDefaultModel?.currentSelection?.();
          if (!model?.provider || !model?.model) throw new Error("default model selection unavailable");
          return op.request.history === "inherit" ? forkBoundary(observation.events, op.request) : null;
        });
        const request = op.request;
        if (request.codeSource.kind === "source-head" && request.codeSource.carryChanges) await this.changes.capture(op);
        return { boundary };
      },
      createWorktree: async (repoId, branch, path, base) => {
        this.assertActive();
        const root = this.repoRoot(repoId);
        await this.git.run(["rev-parse", "--verify", `${base}^{commit}`], { cwd: root });
        await this.git.run(["worktree", "add", "-b", branch, path, base], { cwd: root, timeoutMs: 6e4 });
      },
      carryChanges: async (_repo, _path, op) => this.changes.carry(op),
      createChildSession: (input) => this.createChild(input),
      attachWorkspace: (path, name, id) => this.attachWorkspace(path, name, id),
      persistDirection: (input) => this.persistDirection(input),
      removeWorktree: (repo, path, branch) => this.removeWorktree(repo, path, branch),
      removeDirection: (_repo, id) => this.removeDirection(id),
      directionRepo: async (id) => this.direction(id).repoId,
      reconcile: (op) => this.reconcile(op)
    }, void 0, { journalDirectory: join3(dirname3(config.dataFile), "operations") });
  }
  store;
  host;
  git;
  changes;
  operations;
  services = {};
  #writes = Promise.resolve();
  #alive = true;
  #treeFlight;
  #titles = /* @__PURE__ */ new Map();
  #previews = /* @__PURE__ */ new Map();
  #generation = 0;
  assertActive() {
    if (!this.#alive) throw new Error("branchman runtime unloaded");
  }
  bind(name, value) {
    this.assertActive();
    this.services[name] = value;
    this.#generation++;
    const clear = ["sessionQuery", "agents", "workspaceRegistry", "agentDefaultModel"].includes(name) ? this.host.bind(name, value) : () => {
    };
    return () => {
      clear();
      if (this.services[name] === value) {
        delete this.services[name];
        this.#generation++;
      }
    };
  }
  async ready() {
    await this.store.ready();
    await this.operations.ready();
  }
  async dispose() {
    this.#alive = false;
    this.#generation++;
    await this.host.dispose();
    this.#titles.clear();
    this.#previews.clear();
  }
  async update(fn) {
    const work = async () => {
      this.assertActive();
      const old = this.store.read(), next = structuredClone(old);
      fn(next);
      await this.store.commit(old.revision, next);
    };
    const queued = this.#writes.then(work, work);
    this.#writes = queued.then(() => {
    }, () => {
    });
    await queued;
  }
  repoRoot(id) {
    const s = this.store.read(), repo = s.repositories.find((r) => r.id === id), tree = s.worktrees.find((w) => w.id === repo?.primaryWorktreeId);
    if (!repo?.identityVerified || !tree) throw new Error("repository identity needs Git reconciliation");
    return tree.canonicalPath;
  }
  direction(id) {
    const d = this.store.read().directions.find((d2) => d2.id === id);
    if (!d) throw new ApiValidationError("not-found", "directionId not found");
    return d;
  }
  treePath(id) {
    const w = this.store.read().worktrees.find((w2) => w2.id === id);
    if (!w) throw new Error("worktree missing");
    return w.canonicalPath;
  }
  async identify(cwd) {
    this.assertActive();
    const identity = await new GitAdapter(this.git, cwd).identify();
    const porcelain = (await this.git.run(["worktree", "list", "--porcelain"], { cwd: identity.worktreePath })).stdout;
    const paths2 = porcelain.split(/\r?\n\r?\n/).map((block) => {
      const path = /^worktree (.+)$/m.exec(block)?.[1], branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1] ?? null;
      return path ? { path: normalizePath(path), branch } : null;
    }).filter(Boolean);
    const primary = paths2[0];
    if (!primary) throw new Error("git did not identify the primary worktree");
    let repoId = "";
    await this.update((s) => {
      let repo = s.repositories.find((r) => samePath(r.canonicalCommonDir, identity.commonDir));
      if (!repo) repo = s.repositories.find((r) => !r.identityVerified && paths2.some((p) => samePath(this.treePath(r.primaryWorktreeId), p.path)));
      if (!repo) {
        repo = { id: newId(), canonicalCommonDir: identity.commonDir, primaryWorktreeId: newId(), identityVerified: true };
        s.repositories.push(repo);
      }
      repoId = repo.id;
      repo.canonicalCommonDir = identity.commonDir;
      repo.identityVerified = true;
      for (const [i, path] of paths2.entries()) {
        let w = s.worktrees.find((w2) => w2.repoId === repoId && samePath(w2.canonicalPath, path.path));
        if (!w) {
          const planned = this.operations.list().find((op) => op.plan && samePath(op.plan.worktreePath, path.path))?.plan;
          w = { id: i === 0 ? repo.primaryWorktreeId : planned?.worktreeId ?? newId(), repoId, canonicalPath: path.path, branchRef: path.branch, managedBy: planned ? "branchman" : "external", present: true };
          s.worktrees.push(w);
        }
        w.present = true;
        if (w.managedBy === "external") w.branchRef = path.branch;
        if (i === 0) repo.primaryWorktreeId = w.id;
      }
      for (const w of s.worktrees.filter((w2) => w2.repoId === repoId)) if (!paths2.some((p) => samePath(p.path, w.canonicalPath))) w.present = false;
    });
    return { repoId, ...identity, managedRoot: primary.path };
  }
  async source(id) {
    const query = this.services.sessionQuery;
    if (!query?.listSessions) throw new Error("sessionQuery unavailable");
    const record = (await query.listSessions()).find((r) => r.header.id === id);
    if (!record) throw new ApiValidationError("not-found", "source session not found");
    return record;
  }
  async fork(body) {
    const request = parseForkRequest(body);
    if (request.codeSource.kind === "source-head" && this.operations.getByRequestId(request.requestId)) return this.operations.fork(request);
    const source = await this.source(request.sourceSessionId);
    if (!samePath(source.header.cwd ?? "", request.sourceCwd)) throw new ApiValidationError("invalid-source", "sourceCwd differs from the source session");
    if (request.codeSource.kind === "explicit-commit") {
      if (!/^[0-9a-f]{7,64}$/i.test(request.codeSource.oid)) throw new ApiValidationError("invalid-argument", "explicit commit must be an OID");
      request.codeSource.oid = (await this.git.run(["rev-parse", "--verify", `${request.codeSource.oid}^{commit}`], { cwd: request.sourceCwd })).stdout.trim();
    }
    return this.operations.fork(request);
  }
  async createChild(input) {
    this.assertActive();
    const generation = this.#generation;
    const id = `session-${input.operationId}`, agents = this.services.agents;
    if (!agents?.create || !input.operationId) throw new Error("agent creation capability unavailable");
    const existing = await this.services.sessionQuery.listSessions();
    const found = existing.find((r) => r.header.id === id);
    if (found) {
      if (!samePath(found.header.cwd ?? "", input.worktreePath) || found.header.parentSession !== input.sourceSessionId) throw new Error("child identity conflict");
      return { sessionId: id, seeded: !!found.header.isSeeded, inherited: this.operations.getOperation(input.operationId)?.child?.inherited ?? 0 };
    }
    return this.host.withObservation(input.sourceSessionId, async (observation) => {
      const boundary = input.history === "inherit" ? forkBoundary(observation.events, input) : null;
      const presetId = observation.projections?.values?.agentPreset ?? observation.header?.agentPreset;
      const presets = this.services.agentPresets;
      if (!presets?.resolve || !presets?.mount) throw new Error("source agent preset cannot be composed");
      const resolved = await presets.resolve(presetId);
      if (!resolved?.id || resolved.broken) throw new Error("source agent preset unavailable or broken");
      const preset = resolved.id;
      const composition = { agentPreset: preset, setup: async (agentCtx) => {
        await presets.mount(agentCtx, preset);
      } };
      const selection = this.services.agentDefaultModel?.currentSelection?.();
      if (!selection?.provider || !selection?.model) throw new Error("default model selection unavailable");
      this.assertActive();
      if (generation !== this.#generation) throw new Error("host bindings changed before child creation");
      await agents.create({
        sessionId: id,
        ...boundary === null ? {} : { seed: this.peers.buildForkSeed(observation.events, boundary), inheritedEventCount: boundary + 1 },
        meta: { cwd: input.worktreePath, parentSession: input.sourceSessionId, ...boundary === null ? {} : { isSeeded: true }, ...composition.agentPreset ? { agentPreset: composition.agentPreset } : {} },
        agentOptions: { provider: selection.provider, model: selection.model },
        ...composition.setup ? { setup: composition.setup } : {}
      });
      return { sessionId: id, seeded: boundary !== null, inherited: boundary === null ? 0 : boundary + 1, boundary };
    });
  }
  async attachWorkspace(path, name, sessionId) {
    this.assertActive();
    const registry = this.services.workspaceRegistry;
    if (!registry?.create) throw new Error("workspaceRegistry unavailable");
    const workspace = await registry.create(path, `\u8D70\u5411 ${name}`);
    if (!workspace?.id || !workspace.attachSession) throw new Error("workspace attachment unavailable");
    if (sessionId) await workspace.attachSession(sessionId);
    return { workspaceId: String(workspace.id) };
  }
  async persistDirection(input) {
    const op = this.operations.getOperation(input.operationId);
    await this.update((s) => {
      if (s.directions.some((d) => d.id === input.directionId)) return;
      const repo = s.repositories.find((r) => r.id === input.repoId);
      const sourceTree = s.worktrees.find((w) => samePath(w.canonicalPath, op.plan.sourcePath) && w.repoId === input.repoId);
      if (!s.worktrees.some((w) => w.id === input.worktreeId)) s.worktrees.push({ id: input.worktreeId, repoId: input.repoId, canonicalPath: normalizePath(input.worktreePath), branchRef: input.branch, managedBy: "branchman", present: true });
      for (const id of [input.sourceSessionId, input.primarySessionId]) if (id && !s.sessions.some((x) => x.sessionId === id)) s.sessions.push({ sessionId: id, worktreeId: id === input.primarySessionId ? input.worktreeId : sourceTree?.id ?? null, presence: "persisted", archived: false });
      s.directions.push({
        id: input.directionId,
        repoId: input.repoId,
        worktreeId: input.worktreeId,
        displayName: input.displayName,
        primarySessionId: input.primarySessionId,
        baseOid: input.baseOid,
        upstreamRef: sourceTree?.branchRef ?? null,
        integrationTargetWorktreeId: sourceTree?.id ?? repo.primaryWorktreeId,
        state: "ready",
        brief: input.brief ?? "",
        workspaceId: input.workspaceId ?? null,
        createdAt: (/* @__PURE__ */ new Date()).toISOString()
      });
      if (input.sourceSessionId && input.primarySessionId) s.forkEdges.push({
        id: newId(),
        sourceSessionId: input.sourceSessionId,
        targetSessionId: input.primarySessionId,
        boundarySeq: input.boundarySeq ?? null,
        boundaryMessageId: input.messageId ?? null,
        inheritedEventCount: input.inheritedEventCount ?? 0,
        operationId: input.operationId ?? null
      });
    });
  }
  async reconcile(op) {
    this.assertActive();
    const p = op.plan;
    await this.identify(p.sourcePath);
    const root = this.repoRoot(p.repoId);
    const list = (await this.git.run(["worktree", "list", "--porcelain"], { cwd: root })).stdout;
    const block = list.split(/\r?\n\r?\n/).find((b) => samePath(/^worktree (.+)$/m.exec(b)?.[1] ?? "", p.worktreePath));
    if (block) {
      if (!block.includes(`branch refs/heads/${p.branch}`)) throw new Error("planned path belongs to another branch");
      if (!op.ownedResources.includes(`worktree:${p.worktreePath}`)) op.ownedResources.push(`worktree:${p.worktreePath}`, `branch:${p.branch}`);
    } else if (op.ownedResources.includes(`worktree:${p.worktreePath}`)) throw new Error("owned worktree is missing; manual recovery required");
    const childId = `session-${op.id}`, corpus = await this.services.sessionQuery.listSessions();
    const child = corpus.find((r) => r.header.id === childId);
    if (child) {
      if (!block || !samePath(child.header.cwd ?? "", p.worktreePath) || child.header.parentSession !== op.request.sourceSessionId) throw new Error("child/worktree reconciliation conflict");
      if (op.request.history === "inherit" && op.child?.inherited === void 0 && op.resolvedBoundary == null) throw new Error("child inheritance boundary cannot be confirmed");
      const inherited = op.child?.inherited ?? (op.resolvedBoundary != null ? op.resolvedBoundary + 1 : 0);
      op.child = { sessionId: childId, seeded: !!child.header.isSeeded, inherited, boundary: inherited ? inherited - 1 : null };
      if (!op.ownedResources.includes(`session:${childId}`)) op.ownedResources.push(`session:${childId}`);
    }
    if (this.store.read().directions.some((d) => d.id === p.directionId)) {
      op.directionId = p.directionId;
      op.state = "succeeded";
      op.phase = "completed";
      op.errorCode = null;
    }
    return op;
  }
  async clean(path) {
    const dirty = (await this.git.run(["status", "--porcelain=v1", "--untracked-files=all", "--", ".", ":(exclude).branches"], { cwd: path })).stdout.trim();
    if (dirty) throw new Error(`worktree contains uncommitted changes: ${path}`);
  }
  async removeWorktree(repoId, path, branch) {
    const root = this.repoRoot(repoId), identity = await new GitAdapter(this.git, path).identify();
    const repo = this.store.read().repositories.find((r) => r.id === repoId);
    if (!samePath(identity.commonDir, repo.canonicalCommonDir) || identity.branchRef !== branch || samePath(path, root)) throw new Error("worktree ownership mismatch");
    await this.clean(path);
    const ahead = (await this.git.run(["rev-list", `${root === path ? "HEAD" : (await this.git.run(["rev-parse", "HEAD"], { cwd: root })).stdout.trim()}..${identity.headOid}`], { cwd: root })).stdout.trim();
    if (ahead) throw new Error("worktree has commits not integrated into the primary worktree");
    await this.git.run(["worktree", "remove", path], { cwd: root, timeoutMs: 6e4 });
    await this.git.run(["branch", "-d", branch], { cwd: root });
  }
  async removeDirection(id) {
    const d = this.direction(id);
    if (d.state === "removed") return;
    const expected = this.store.read().worktrees.find((w2) => w2.id === d.worktreeId);
    const actual = await new GitAdapter(this.git, expected.canonicalPath).identify();
    if (!samePath(actual.worktreePath, expected.canonicalPath) || actual.branchRef !== expected.branchRef) throw new Error("worktree ownership changed; removal refused");
    await this.identify(expected.canonicalPath);
    const w = this.store.read().worktrees.find((w2) => w2.id === d.worktreeId);
    if (w.managedBy !== "branchman" || !w.branchRef) throw new Error("external worktrees cannot be removed");
    await this.removeWorktree(d.repoId, w.canonicalPath, w.branchRef);
    await this.update((s) => {
      s.directions.find((x) => x.id === id).state = "removed";
      s.worktrees.find((x) => x.id === d.worktreeId).present = false;
    });
  }
  async integration(kind, requestId, id) {
    const d = this.direction(id);
    if (d.state !== "ready") throw new Error("direction needs reconciliation before integration");
    const source = this.treePath(d.worktreeId), target = this.treePath(d.integrationTargetWorktreeId);
    return this.operations.run(kind, requestId, { directionId: id }, d.repoId, async () => {
      this.assertActive();
      const state = this.store.read(), repo = state.repositories.find((r) => r.id === d.repoId);
      if (!repo.identityVerified) throw new Error("repository identity needs Git reconciliation");
      for (const worktreeId of [d.worktreeId, d.integrationTargetWorktreeId]) {
        const expected = state.worktrees.find((w) => w.id === worktreeId);
        const actual = await new GitAdapter(this.git, expected.canonicalPath).identify();
        if (!samePath(actual.worktreePath, expected.canonicalPath) || !samePath(actual.commonDir, repo.canonicalCommonDir) || actual.branchRef !== expected.branchRef) throw new Error("integration worktree identity changed; reconcile before retry");
      }
      await this.clean(source);
      await this.clean(target);
      const path = kind === "merge" ? target : source, from = kind === "merge" ? source : target;
      const oid = (await this.git.run(["rev-parse", "HEAD"], { cwd: from })).stdout.trim();
      try {
        await this.git.run(["merge", "--no-edit", oid], { cwd: path, timeoutMs: 6e4 });
      } catch (e) {
        const conflicts = (await this.git.run(["ls-files", "-u"], { cwd: path })).stdout.trim();
        if (conflicts) await this.update((s) => {
          s.directions.find((x) => x.id === id).state = "conflicted";
        });
        throw e;
      }
      await this.update((s) => {
        const dir = s.directions.find((x) => x.id === id);
        dir.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
        if (kind === "merge") dir.mergedAt = dir.updatedAt;
      });
    });
  }
  async unarchive(id) {
    const d = this.direction(id);
    if (!d.primarySessionId) throw new Error("direction has no session");
    await this.attachWorkspace(this.treePath(d.worktreeId), d.displayName, d.primarySessionId);
    await this.services.workspaceRegistry.unarchiveSession(d.primarySessionId);
    return { directionId: id, sessionId: d.primarySessionId };
  }
  async checkDirection(id) {
    const d = this.direction(id);
    if (d.state === "removed") throw new Error("removed directions cannot be reactivated");
    if (d.recoveryReasons?.length) throw new Error(`legacy references need repair: ${d.recoveryReasons.join("; ")}`);
    const expected = this.store.read().worktrees.find((w) => w.id === d.worktreeId);
    const identity = await new GitAdapter(this.git, expected.canonicalPath).identify();
    if (!samePath(identity.worktreePath, expected.canonicalPath) || identity.branchRef !== expected.branchRef) throw new Error("direction worktree identity mismatch");
    const resolved = await this.identify(expected.canonicalPath);
    if (resolved.repoId !== d.repoId) throw new Error("legacy repository references need repair");
    const parent = this.store.read().worktrees.find((w) => w.id === d.integrationTargetWorktreeId);
    const parentIdentity = await new GitAdapter(this.git, parent.canonicalPath).identify();
    if (!samePath(parentIdentity.commonDir, identity.commonDir) || !samePath(parentIdentity.worktreePath, parent.canonicalPath) || parentIdentity.branchRef !== parent.branchRef) throw new Error("parent worktree identity mismatch");
    await this.clean(expected.canonicalPath);
    await this.clean(parent.canonicalPath);
    for (const path of [expected.canonicalPath, parent.canonicalPath]) {
      const merging = (await this.git.run(["rev-parse", "--git-path", "MERGE_HEAD"], { cwd: path })).stdout.trim();
      try {
        await access(resolve2(path, merging));
        throw new Error("unfinished Git merge requires completion or abort");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    await this.update((s) => {
      const direction = s.directions.find((x) => x.id === id);
      direction.state = "ready";
      direction.upstreamRef = parent.branchRef;
    });
    return { directionId: id, state: "ready", baseOidKnown: !!d.baseOid };
  }
  tree(currentSessionId) {
    if (this.#treeFlight) return this.#treeFlight;
    const flight = this.readTree(currentSessionId).finally(() => {
      if (this.#treeFlight === flight) this.#treeFlight = void 0;
    });
    this.#treeFlight = flight;
    return flight;
  }
  async readTree(currentSessionId) {
    this.assertActive();
    const generation = this.#generation, s = this.store.read();
    const query = this.services.sessionQuery;
    let corpus = [], corpusError = null;
    try {
      if (!query?.listSessions) throw new Error("sessionQuery unavailable");
      corpus = await query.listSessions();
    } catch (e) {
      corpusError = String(e.message);
    }
    const ids = /* @__PURE__ */ new Set([...s.sessions.map((x) => x.sessionId), ...corpus.map((x) => x.header.id), ...currentSessionId ? [currentSessionId] : []]);
    const now = Date.now(), toRead = [...ids].filter((id) => id === currentSessionId || !this.#titles.has(id) || now - this.#titles.get(id).at > 6e4).sort((a, b) => Number(b === currentSessionId) - Number(a === currentSessionId)).slice(0, 64);
    if (query?.readTitleSnapshots && toRead.length) {
      try {
        const titles = await query.readTitleSnapshots(toRead);
        for (const t of titles) this.#titles.set(t.sessionId, { value: t.status === "fulfilled" ? t.value.title : void 0, at: now });
      } catch {
        for (const id of toRead) this.#titles.set(id, { value: void 0, at: now });
      }
    }
    this.assertActive();
    if (generation !== this.#generation) throw new Error("host services changed during tree read");
    const archived = new Set(this.services.workspaceRegistry?.archivedSessionIds ?? []);
    const corpusById = new Map(corpus.map((x) => [x.header.id, x])), linksById = new Map(s.sessions.map((x) => [x.sessionId, x])), directionsBySession = new Map(s.directions.map((d) => [d.primarySessionId, d]));
    if (query?.observeSession) {
      const missing = [...ids].filter((id) => {
        const d = directionsBySession.get(id), title = this.#titles.get(id)?.value;
        const label = selectLabel({ userTitle: title?.source?.kind === "user" ? title.title : null, hostTitle: title?.title, brief: d?.brief, summary: d?.summary, sessionId: id });
        const cached = this.#previews.get(id);
        return label?.source === "id" && (!cached || now - cached.at > 6e4) && corpusById.has(id);
      }).sort((a, b) => Number(b === currentSessionId) - Number(a === currentSessionId)).slice(0, 2);
      await Promise.all(missing.map(async (id) => {
        try {
          const text = await this.host.withObservation(id, (o) => derivePreview(o.events));
          this.#previews.set(id, { text, at: now });
        } catch {
          this.#previews.set(id, { text: null, at: now });
        }
      }));
      this.assertActive();
      if (generation !== this.#generation) throw new Error("host services changed during preview read");
    }
    const sessions = [...ids].map((id) => {
      const record = corpusById.get(id), link = linksById.get(id), direction = directionsBySession.get(id);
      const title = this.#titles.get(id)?.value, live = this.ctx.sessions.get(id), cwd = record?.header.cwd ?? (link?.worktreeId ? this.treePath(link.worktreeId) : null);
      const w = s.worktrees.find((w2) => w2.present !== false && cwd && samePath(w2.canonicalPath, cwd));
      const label = selectLabel({
        userTitle: title?.source?.kind === "user" ? title.title : null,
        hostTitle: live?.title?.title ?? title?.title,
        brief: direction?.brief,
        summary: direction?.summary || this.#previews.get(id)?.text,
        sessionId: id
      });
      return {
        sessionId: id,
        cwd,
        repoId: w?.repoId ?? null,
        worktreeId: w?.id ?? null,
        directionId: direction?.id ?? null,
        parentSessionId: record?.header.parentSession ?? s.forkEdges.find((e) => e.targetSessionId === id)?.sourceSessionId ?? null,
        presence: live ? "live" : record ? "persisted" : corpusError ? "unknown" : "missing",
        archived: archived.has(id),
        label,
        createdAt: record?.header.createdAt ?? null
      };
    });
    return { ...s, sessions, operations: this.operations.summaries(), capabilities: this.host.capabilities(), corpusError };
  }
  async status(id) {
    const d = this.direction(id), cwd = this.treePath(d.worktreeId);
    return {
      directionId: id,
      status: (await this.git.run(["status", "--short"], { cwd })).stdout,
      branch: (await new GitAdapter(this.git, cwd).identify()).branchRef
    };
  }
};
async function migrateIfNeeded(dataFile) {
  const legacy = dataFile.replace(/tree-v2\.json$/, "tree.json");
  if (legacy === dataFile) return;
  try {
    await access(dataFile);
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let raw;
  try {
    raw = JSON.parse(await readFile4(legacy, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return;
    throw e;
  }
  const report = migrateV1(raw);
  await mkdir4(dirname3(dataFile), { recursive: true });
  await writeFile2(dataFile, JSON.stringify(report.state, null, 2), { flag: "wx" });
  await writeFile2(join3(dirname3(dataFile), "migration-report.json"), JSON.stringify({ ...report, state: void 0 }, null, 2));
}
var localRequest = (req) => {
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return false;
    return true;
  } catch {
    return false;
  }
};
async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const raw = Buffer.from(chunk);
    size += raw.length;
    if (size > 64 * 1024) throw new ApiValidationError("body-too-large", "body exceeds 64KiB");
    chunks.push(raw);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiValidationError("invalid-json", "invalid JSON body");
  }
}
function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}
async function apply(ctx, config) {
  if (!config?.dataFile) throw new Error("branchman: dataFile must be configured");
  const file = resolve2(config.dataFile.replace(/tree\.json$/, "tree-v2.json"));
  await migrateIfNeeded(file);
  const sessionPeer = await loadPeer("@deepseek-ai/dsh-session/fork");
  const toolsPeer = await loadPeer("@deepseek-ai/dsh-tools");
  const runtime = new BranchmanRuntime(ctx, { ...config, dataFile: file }, { buildForkSeed: sessionPeer.buildForkSeed, defineTool: toolsPeer.defineTool });
  await runtime.ready();
  ctx.effect(() => () => {
    void runtime.dispose();
  }, "branchman.runtime");
  for (const service of ["sessionQuery", "agents", "agentDefaultModel", "workspaceRegistry", "agentPresets"]) {
    const fiber = ctx.inject([service], (child) => {
      const dispose = runtime.bind(service, child[service]);
      child.effect(() => dispose, `branchman.${service}`);
    });
    ctx.effect(() => () => fiber?.dispose?.(), `branchman.optional.${service}`);
  }
  const action = async (path, body) => {
    if (path === "fork") return runtime.fork(body);
    if (path === "recover") {
      if (typeof body.operationId !== "string") throw new ApiValidationError("invalid-argument", "operationId required");
      return runtime.operations.recover(body.operationId);
    }
    if (typeof body.directionId !== "string") throw new ApiValidationError("invalid-argument", "directionId required");
    if (path === "unarchive") return runtime.unarchive(body.directionId);
    if (path === "check") return runtime.checkDirection(body.directionId);
    if (typeof body.requestId !== "string" || !body.requestId.trim()) throw new ApiValidationError("invalid-argument", "requestId required");
    if (path === "remove" || path === "drop") return runtime.operations.remove(body);
    if (path === "merge" || path === "sync") return runtime.integration(path, body.requestId, body.directionId);
    throw new ApiValidationError("not-found", "unknown endpoint");
  };
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/branchman/api", handler: async (req, res) => {
    if (!localRequest(req)) return send(res, 403, errorEnvelope(new ApiValidationError("forbidden", "request origin rejected")));
    try {
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname.split("/").at(-1);
      let result;
      if (req.method === "GET" && path === "tree") result = await runtime.tree(url.searchParams.get("currentSessionId") ?? void 0);
      else if (req.method === "GET" && path === "status") result = await runtime.status(url.searchParams.get("directionId") ?? "");
      else if (req.method === "GET" && path === "operations") result = runtime.operations.list();
      else if (req.method === "POST") result = await action(path, await readBody(req));
      else throw new ApiValidationError("not-found", "endpoint not found");
      send(res, 200, ok(result, runtime.store.read().revision));
    } catch (e) {
      send(res, e instanceof IdempotencyConflictError ? 409 : e instanceof ApiValidationError ? e.code === "not-found" ? 404 : 400 : 500, errorEnvelope(e));
    }
  } }), "branchman.api");
  ctx.effect(() => {
    const disposers = [];
    for (const name of ["fork", "tree", "status", "merge", "sync", "drop", "unarchive", "recover", "check"]) {
      const definition = {
        name: `branch_${name}`,
        description: name === "fork" ? "Create an isolated Git worktree and child session from the current conversation. Explicitly select inherit or blank history. Returns a durable operation status; recovery-required is not success." : `Branchman ${name}: operates on stable directionId/operationId and returns actual operation state.`,
        parameters: name === "tree" ? {} : name === "fork" ? {
          displayName: { type: "string", required: true },
          brief: { type: "string" },
          history: { type: "string", enum: ["inherit", "blank"] },
          carryChanges: { type: "boolean" },
          requestId: { type: "string" },
          messageId: { type: "string" },
          boundarySeq: { type: "number" }
        } : name === "recover" ? { operationId: { type: "string", required: true } } : { directionId: { type: "string", required: true }, requestId: { type: "string" } },
        output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: String(value) }] },
        execute: async (args, exec) => {
          const session = exec?.agent?.session, sessionId = exec?.agent?.sessionId ?? session?.id;
          const body = { ...args, requestId: args?.requestId ?? `tool-${exec?.id ?? randomUUID2()}` };
          let result;
          if (name === "tree") result = await runtime.tree(sessionId);
          else if (name === "status") result = await runtime.status(body.directionId);
          else if (name === "fork") result = await runtime.fork({
            ...body,
            sourceSessionId: sessionId,
            sourceCwd: session?.header?.cwd,
            codeSource: { kind: "source-head", carryChanges: args?.carryChanges !== false },
            history: args?.history ?? "inherit"
          });
          else result = await action(name, body);
          return JSON.stringify(ok(result, runtime.store.read().revision));
        }
      };
      disposers.push(ctx.tools.register(toolsPeer.defineTool(definition)));
    }
    return () => disposers.forEach((d) => d?.());
  }, "branchman.tools");
}
export {
  BranchmanRuntime,
  Config,
  apply,
  inject
};
