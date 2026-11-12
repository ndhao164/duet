/**
 * Duet Dashboard Sidecar Backend (read-only).
 *
 * Reads Antigravity's native swarm board & member transcripts in real time:
 *   - <appData>/brain/<coordinatorConv>/.system_generated/swarm/members.json
 *   - <appData>/brain/<coordinatorConv>/.system_generated/swarm/board.jsonl
 *   - <appData>/brain/<memberConv>/.system_generated/logs/transcript.jsonl
 *   - <appData>/brain/<subagentConv>/.system_generated/logs/transcript.jsonl
 *
 * Surfaces Lead Coder(s), live parallel Subagent fan-out trees, touched files,
 * and structured Argon Reviewer findings ([BLOCKER], [MAJOR], [NIT], [APPROVED]).
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ID_RE = /^[0-9a-f-]{8,}$/i;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const ROLE_WORKER_RE = /^(?:narrator|monitor)(?:-\d+)?$/i;

const STATIC_FILES = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

// ---------------------------------------------------------------------------
// AppData & Swarm Directory Resolution
// ---------------------------------------------------------------------------

function safeReaddir(p) {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}

function statOf(p) {
  try {
    const s = statSync(p);
    return { mtime: s.mtimeMs, size: s.size };
  } catch {
    return { mtime: 0, size: -1 };
  }
}

function findAppDataDirs() {
  const dataDir = process.env.ANTIGRAVITY_EXECUTABLE_DATA_DIR;
  if (dataDir) {
    for (let d = dataDir; d !== dirname(d); d = dirname(d)) {
      if (basename(d) !== 'sidecar_data') continue;
      const appData = dirname(d);
      return existsSync(join(appData, 'brain')) ? [appData] : [];
    }
    return [];
  }
  const root = join(homedir(), '.gemini');
  return safeReaddir(root)
    .sort()
    .map((n) => join(root, n))
    .filter((c) => existsSync(join(c, 'brain')));
}

const swarmDir = (appData, conv) => join(appData, 'brain', conv, '.system_generated', 'swarm');
const transcriptPath = (appData, conv) => join(appData, 'brain', conv, '.system_generated', 'logs', 'transcript.jsonl');

const fileCache = new Map();
function readCached(p, maxBytes = 8 * 1024 * 1024) {
  const s = statOf(p);
  if (s.size < 0 || s.size > maxBytes) return { text: null, ...s };
  const key = `${s.mtime}:${s.size}`;
  const hit = fileCache.get(p);
  if (hit && hit.key === key) return { text: hit.text, ...s };
  try {
    const text = readFileSync(p, 'utf-8');
    if (fileCache.size > 400) fileCache.clear();
    fileCache.set(p, { key, text });
    return { text, ...s };
  } catch {
    return { text: null, ...s };
  }
}

function parseRoster(text) {
  try {
    const r = JSON.parse(text);
    if (!r || typeof r !== 'object') return null;
    return {
      title: String(r.title || ''),
      members: r.members && typeof r.members === 'object' ? r.members : {},
    };
  } catch {
    return null;
  }
}

function parseBoard(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line);
      if (m && typeof m === 'object') out.push(m);
    } catch {
      // Ignore torn trailing line while being written.
    }
  }
  return out;
}

const ROSTER_SCAN_TTL_MS = 2500;
let cachedSwarms = { builtAt: 0, list: [] };

function listSwarmDirs() {
  const now = Date.now();
  if (now - cachedSwarms.builtAt < ROSTER_SCAN_TTL_MS) return cachedSwarms.list;
  const list = [];
  const seen = new Set();
  for (const appData of findAppDataDirs()) {
    for (const id of safeReaddir(join(appData, 'brain'))) {
      if (seen.has(id)) continue;
      if (existsSync(join(swarmDir(appData, id), 'members.json'))) {
        seen.add(id);
        list.push({ appData, id });
      }
    }
  }
  cachedSwarms = { builtAt: now, list };
  return list;
}

function resolveSwarm(conv) {
  if (!conv || !ID_RE.test(conv)) return { appData: null, swarm: null, viewer: null };
  for (const appData of findAppDataDirs()) {
    if (existsSync(join(swarmDir(appData, conv), 'members.json'))) {
      return { appData, swarm: conv, viewer: 'coordinator' };
    }
  }
  for (const { appData, id } of listSwarmDirs()) {
    const { text } = readCached(join(swarmDir(appData, id), 'members.json'));
    const roster = text ? parseRoster(text) : null;
    if (!roster) continue;
    for (const [name, m] of Object.entries(roster.members)) {
      if (m?.conversation_id === conv) return { appData, swarm: id, viewer: name };
    }
  }
  return { appData: null, swarm: null, viewer: null };
}

// ---------------------------------------------------------------------------
// Transcript & Subagent Tree Extraction
// ---------------------------------------------------------------------------

function unquote(v) {
  if (typeof v !== 'string') return v == null ? '' : String(v);
  const s = v.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    try {
      return String(JSON.parse(s));
    } catch {
      return s.slice(1, -1);
    }
  }
  return s;
}

function oneLine(s, maxLen = 96) {
  const out = String(s || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return out.length > maxLen ? `${out.slice(0, maxLen - 1).trimEnd()}…` : out;
}

function toFileUri(rawPath) {
  const clean = unquote(rawPath).trim();
  if (!clean) return null;
  try {
    return pathToFileURL(clean).href;
  } catch {
    return null;
  }
}

const BOARD_TOOLS = {
  swarm_wait: 'Waiting on swarm board',
  read_board: 'Reading swarm board',
  post_message: 'Posting update to board',
};

function describeToolCall(tc) {
  const name = tc?.name || '';
  if (!name) return '';
  if (BOARD_TOOLS[name]) return BOARD_TOOLS[name];
  const args = tc.args && typeof tc.args === 'object' ? tc.args : {};
  if (name === 'invoke_subagent') {
    const role = unquote(args.Role) || unquote(args.TypeName) || 'subagent';
    return oneLine(`Spawn subagent: ${role}`);
  }
  const summary = unquote(args.toolSummary) || unquote(args.toolAction);
  if (summary) return oneLine(summary);
  const p = unquote(args.Path || args.AbsolutePath || args.TargetFile);
  if (p) {
    const verb = { read_file: 'Read', write_file: 'Write', edit_file: 'Edit' }[name];
    if (verb) return `${verb} ${basename(p)}`;
  }
  return name;
}

function thinkingHeading(thinking) {
  if (typeof thinking !== 'string') return '';
  const hs = [...thinking.matchAll(/(?:^|\n)\s*\*\*([^*\n]{3,96})\*\*\s*(?=\n|$)/g)];
  return hs.length ? oneLine(hs[hs.length - 1][1]) : '';
}

function parseSteps(text) {
  const steps = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const s = JSON.parse(line);
      if (s && typeof s === 'object') steps.push(s);
    } catch {
      // Ignore torn line.
    }
  }
  return steps;
}

function isTurnIdle(steps) {
  if (!steps.length) return false;
  // Walk back to the newest PLANNER_RESPONSE
  let plannerIdx = -1;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].type === 'USER_INPUT') return false;
    if (steps[i].type === 'PLANNER_RESPONSE') {
      plannerIdx = i;
      break;
    }
  }
  if (plannerIdx < 0) return false;
  const planner = steps[plannerIdx];
  const calls = Array.isArray(planner.tool_calls) ? planner.tool_calls : [];
  if (calls.length === 0) {
    return plannerIdx === steps.length - 1 && planner.status === 'DONE';
  }
  const waitIdx = calls.findIndex((c) => c?.name === 'swarm_wait');
  if (waitIdx >= 0) {
    const resStep = steps[plannerIdx + 1 + waitIdx];
    return Boolean(resStep && resStep.status === 'DONE');
  }
  return false;
}

const txCache = new Map();

function inspectConversation(appData, conv, depth = 0) {
  if (!appData || !conv || !ID_RE.test(conv)) {
    return { key: '-', steps: 0, idle: true, activity: '', activityKind: '', files: [], subagents: [], error: '' };
  }
  const p = transcriptPath(appData, conv);
  const { text, mtime, size } = readCached(p, 6 * 1024 * 1024);
  if (text == null) {
    return { key: 'none', steps: 0, idle: false, activity: '', activityKind: '', files: [], subagents: [], error: '' };
  }
  // Cache key includes child transcripts only at depth 0 after resolving children below
  const baseKey = `${mtime}:${size}:${depth}`;
  const cached = txCache.get(p);
  let parsed = cached && cached.baseKey === baseKey ? cached.data : null;

  if (!parsed) {
    const steps = parseSteps(text);
    const stepCount = steps.length
      ? Math.max(steps.length, Number.isFinite(steps[steps.length - 1].step_index) ? steps[steps.length - 1].step_index + 1 : 0)
      : 0;

    let activity = '';
    let activityKind = '';
    let error = '';

    const last = steps[steps.length - 1];
    if (last && (last.type === 'ERROR_MESSAGE' || last.status === 'ERROR')) {
      error = oneLine(last.error || last.content || 'Step failed', 140);
    }

    for (let i = steps.length - 1; i >= 0; i--) {
      const st = steps[i];
      if (st.type === 'USER_INPUT') break;
      if (st.type !== 'PLANNER_RESPONSE') continue;
      const calls = Array.isArray(st.tool_calls) ? st.tool_calls : [];
      if (calls.some((tc) => tc?.name === 'swarm_wait')) break;
      const labeled = calls.map(describeToolCall).filter(Boolean).pop() || '';
      const heading = thinkingHeading(st.thinking);
      if (labeled) {
        activity = labeled;
        activityKind = 'tool';
        break;
      }
      if (heading) {
        activity = heading;
        activityKind = 'thinking';
        break;
      }
    }

    const fileMap = new Map();
    const rawSubs = [];

    for (let i = 0; i < steps.length; i++) {
      const st = steps[i];
      if (st.type !== 'PLANNER_RESPONSE' || !Array.isArray(st.tool_calls)) continue;
      st.tool_calls.forEach((tc, callOffset) => {
        const name = tc?.name || '';
        const args = tc?.args && typeof tc.args === 'object' ? tc.args : {};
        if (name === 'write_file' || name === 'edit_file') {
          const rawPath = unquote(args.Path || args.TargetFile || args.AbsolutePath);
          if (rawPath && !rawPath.includes('.gemini\\antigravity\\brain') && !rawPath.includes('.gemini/antigravity/brain')) {
            fileMap.set(rawPath, {
              name: basename(rawPath),
              path: rawPath,
              uri: toFileUri(rawPath),
              op: name === 'write_file' ? 'created' : 'edited',
            });
          }
        } else if (name === 'invoke_subagent' && depth === 0) {
          const resStep = steps[i + 1 + callOffset];
          const resContent = String(resStep?.content || '');
          const uuidMatch = resContent.match(UUID_RE);
          rawSubs.push({
            index: rawSubs.length + 1,
            role: oneLine(unquote(args.Role) || unquote(args.TypeName) || `Subagent ${rawSubs.length + 1}`, 64),
            typeName: unquote(args.TypeName) || 'self',
            workspace: unquote(args.Workspace) || 'inherit',
            prompt: oneLine(unquote(args.Prompt), 140),
            conversationId: uuidMatch ? uuidMatch[0] : null,
            resultStatus: String(resStep?.status || 'RUNNING'),
          });
        }
      });
    }

    parsed = {
      steps: stepCount,
      idle: isTurnIdle(steps),
      activity,
      activityKind,
      error,
      files: [...fileMap.values()],
      rawSubs,
    };
    if (txCache.size > 300) txCache.clear();
    txCache.set(p, { baseKey, data: parsed });
  }

  // Hydrate live child subagent transcripts if depth === 0
  let subKeyParts = [baseKey];
  const mergedFiles = new Map(parsed.files.map((f) => [f.path, f]));
  const subagents = (parsed.rawSubs || []).map((sub) => {
    if (!sub.conversationId) {
      return {
        ...sub,
        status: sub.resultStatus === 'ERROR' ? 'error' : sub.resultStatus === 'DONE' ? 'done' : 'working',
        steps: 0,
        activity: sub.prompt,
        files: [],
      };
    }
    const child = inspectConversation(appData, sub.conversationId, 1);
    subKeyParts.push(`${sub.conversationId}:${child.key}`);
    for (const f of child.files) {
      if (!mergedFiles.has(f.path)) mergedFiles.set(f.path, f);
    }
    const isDone = child.idle && child.steps > 0;
    const status = child.error ? 'error' : isDone ? 'done' : 'working';
    return {
      index: sub.index,
      role: sub.role,
      typeName: sub.typeName,
      workspace: sub.workspace,
      prompt: sub.prompt,
      conversationId: sub.conversationId,
      status,
      steps: child.steps,
      activity: child.activity || sub.prompt,
      files: child.files.slice(0, 8),
    };
  });

  return {
    key: subKeyParts.join('|'),
    steps: parsed.steps,
    idle: parsed.idle,
    activity: parsed.activity,
    activityKind: parsed.activityKind,
    error: parsed.error,
    files: [...mergedFiles.values()],
    subagents,
  };
}

// ---------------------------------------------------------------------------
// Member Classification & Findings Extraction
// ---------------------------------------------------------------------------

function prettyModel(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'Inherited model';
  const map = {
    'gemini-4-carbon-high': 'Gemini 4 Carbon (High)',
    'gemini-4-carbon-medium': 'Gemini 4 Carbon (Medium)',
    'gemini-4-carbon-low': 'Gemini 4 Carbon (Low)',
    'gemini-4-argon-high': 'Gemini 4 Argon (High)',
    'gemini-4-argon-medium': 'Gemini 4 Argon (Medium)',
    'gemini-4-argon-low': 'Gemini 4 Argon (Low)',
  };
  return map[s.toLowerCase()] || s;
}

function classifyLane(name, m) {
  const n = String(name || '').toLowerCase();
  const role = String(m?.role || '').toLowerCase();
  const model = String(m?.model || '').toLowerCase();
  if (n === 'coordinator' || role === 'coordinator') return 'coordinator';
  if (ROLE_WORKER_RE.test(n) || (role && role !== 'worker')) return 'system';
  if (/review|verif|audit|qa|critic|argon/.test(n)) return 'reviewer';
  if (/coder|author|build|dev|impl|backend|frontend|ui|api|carbon/.test(n)) return 'coder';
  if (model.includes('argon')) return 'reviewer';
  return 'coder';
}

function mentionsIn(text) {
  const set = new Set();
  for (const m of String(text || '').matchAll(/(?:^|[^a-zA-Z0-9_-])@([a-zA-Z0-9][a-zA-Z0-9_-]*)/g)) {
    set.add(m[1].toLowerCase());
  }
  return [...set];
}

const SEVERITY_LINE_RE = /^\s*(?:@[a-zA-Z0-9_-]+[\s,:;-]*)*(?:[-*•]|\d+[.)])?\s*\*{0,2}\[(BLOCKER|MAJOR|NIT|MINOR|APPROVED)\]\*{0,2}\s*:?\s*(.+)$/gim;

function extractFindings(messages, reviewerNames) {
  const findings = [];
  let latestApprovalSeq = 0;

  for (const msg of messages) {
    const sender = String(msg.agent || '');
    const isReviewer = reviewerNames.has(sender.toLowerCase());
    if (!isReviewer) continue;

    const text = String(msg.text || '');
    const seq = Number(msg.seq) || 0;
    const mentions = mentionsIn(text);
    let matchedLine = false;

    for (const match of text.matchAll(SEVERITY_LINE_RE)) {
      matchedLine = true;
      const rawKind = match[1].toUpperCase();
      const severity = rawKind === 'MINOR' ? 'NIT' : rawKind;
      if (severity === 'APPROVED') latestApprovalSeq = Math.max(latestApprovalSeq, seq);
      findings.push({
        id: `${seq}-${findings.length}`,
        seq,
        reviewer: sender,
        severity,
        summary: oneLine(match[2], 180),
        mentions,
        time: msg.time || '',
      });
    }

    if (!matchedLine && /\[APPROVED\]|\bLGTM\b/i.test(text)) {
      latestApprovalSeq = Math.max(latestApprovalSeq, seq);
      findings.push({
        id: `${seq}-${findings.length}`,
        seq,
        reviewer: sender,
        severity: 'APPROVED',
        summary: oneLine(text.replace(/\[APPROVED\]/gi, ''), 180) || 'All reviewed slices passed verification.',
        mentions,
        time: msg.time || '',
      });
    }
  }

  for (const f of findings) {
    f.resolved = f.severity !== 'APPROVED' && latestApprovalSeq > f.seq;
  }

  return { findings, approved: latestApprovalSeq > 0 };
}

function buildDuetSnapshot(appData, swarmId, viewer) {
  const dir = swarmDir(appData, swarmId);
  const rosterRaw = readCached(join(dir, 'members.json'));
  const boardRaw = readCached(join(dir, 'board.jsonl'));
  const roster = parseRoster(rosterRaw.text) || { title: '', members: {} };
  const rawMessages = parseBoard(boardRaw.text);

  const coders = [];
  const reviewers = [];
  const reviewerNames = new Set();
  const etagParts = [`${rosterRaw.mtime}:${rosterRaw.size}`, `${boardRaw.mtime}:${boardRaw.size}`];

  for (const [name, m] of Object.entries(roster.members)) {
    const lane = classifyLane(name, m);
    if (lane === 'coordinator' || lane === 'system') continue;
    const convId = m?.conversation_id || null;
    const tx = inspectConversation(appData, convId, 0);
    etagParts.push(`${name}:${m?.killed ? 1 : 0}:${tx.key}`);

    const activeSubagents = tx.subagents.filter((s) => s.status === 'working').length;
    const memberStatus = m?.killed
      ? 'killed'
      : tx.steps === 0
      ? 'waiting'
      : !tx.idle || activeSubagents > 0
      ? 'working'
      : 'waiting';

    const item = {
      name,
      lane,
      conversationId: convId,
      model: prettyModel(m?.model),
      rawModel: String(m?.model || ''),
      workspace: String(m?.workspace || 'inherit'),
      status: memberStatus,
      steps: tx.steps,
      activity: tx.activity || (memberStatus === 'waiting' ? 'Standing by on board' : 'Starting turn…'),
      activityKind: tx.activityKind,
      error: tx.error,
      files: tx.files,
      subagents: tx.subagents,
    };

    if (lane === 'reviewer') {
      reviewers.push(item);
      reviewerNames.add(name.toLowerCase());
    } else {
      coders.push(item);
    }
  }

  const messages = rawMessages.map((m) => ({
    seq: Number(m.seq) || 0,
    agent: String(m.agent || ''),
    text: String(m.text || ''),
    time: String(m.time || ''),
    mentions: mentionsIn(m.text),
  }));

  const { findings, approved } = extractFindings(messages, reviewerNames);

  // Handoff metrics
  const coderSet = new Set(coders.map((c) => c.name.toLowerCase()));
  let slicesSent = 0;
  let feedbackRounds = 0;
  for (const m of messages) {
    const sender = m.agent.toLowerCase();
    if (coderSet.has(sender) && m.mentions.some((x) => reviewerNames.has(x))) slicesSent++;
    if (reviewerNames.has(sender) && m.mentions.some((x) => coderSet.has(x))) feedbackRounds++;
  }

  const allFilesMap = new Map();
  let totalSubagents = 0;
  let activeSubagents = 0;
  for (const c of coders) {
    totalSubagents += c.subagents.length;
    activeSubagents += c.subagents.filter((s) => s.status === 'working').length;
    for (const f of c.files) {
      if (!allFilesMap.has(f.path)) allFilesMap.set(f.path, f);
    }
  }

  const openIssues = findings.filter((f) => f.severity !== 'APPROVED' && !f.resolved);
  const anyCoderWorking = coders.some((c) => c.status === 'working');
  const anyReviewerWorking = reviewers.some((r) => r.status === 'working');

  let phase = 'idle';
  if (approved && openIssues.length === 0 && !anyCoderWorking && !anyReviewerWorking) {
    phase = 'approved';
  } else if (anyReviewerWorking) {
    phase = 'reviewing';
  } else if (openIssues.length > 0 && anyCoderWorking) {
    phase = 'fixing';
  } else if (anyCoderWorking) {
    phase = 'building';
  } else if (slicesSent > 0 && !approved) {
    phase = 'reviewing';
  }

  return {
    etag: etagParts.join('|'),
    swarm: swarmId,
    viewer,
    title: roster.title || 'Duet Session',
    phase,
    coders,
    reviewers,
    files: [...allFilesMap.values()],
    findings,
    messages,
    stats: {
      totalSubagents,
      activeSubagents,
      filesTouched: allFilesMap.size,
      slicesSent,
      feedbackRounds,
      blockers: openIssues.filter((f) => f.severity === 'BLOCKER').length,
      majors: openIssues.filter((f) => f.severity === 'MAJOR').length,
      nits: openIssues.filter((f) => f.severity === 'NIT').length,
      approvedCount: findings.filter((f) => f.severity === 'APPROVED').length,
    },
  };
}

// ---------------------------------------------------------------------------
// Sidecar Server Wiring (Antigravity sidecar_sdk + Standalone HTTP Fallback)
// ---------------------------------------------------------------------------

function handleDuetQuery(query, defaultConvId = '') {
  const conv = String(query?.conversationId || defaultConvId || process.env.ANTIGRAVITY_CONVERSATION_ID || '');
  if (!conv || !ID_RE.test(conv)) {
    return { conversationId: conv || null, swarm: null };
  }
  const { appData, swarm, viewer } = resolveSwarm(conv);
  if (!swarm) {
    return { conversationId: conv, swarm: null };
  }
  const snap = buildDuetSnapshot(appData, swarm, viewer);
  const fullEtag = `${swarm}|${viewer || ''}|${snap.etag}`;
  if (query?.etag && query.etag === fullEtag) {
    return { conversationId: conv, swarm, unchanged: true, etag: fullEtag };
  }
  return { conversationId: conv, ...snap, etag: fullEtag };
}

let sdk = null;
try {
  sdk = await import('sidecar_sdk');
} catch {
  sdk = null;
}

if (sdk?.SidecarApp) {
  const { SidecarApp, Response } = sdk;
  const app = new SidecarApp();

  app.page('/', () => readFileSync(join(__dirname, 'index.html'), 'utf-8'));

  for (const [route, [file, contentType]] of Object.entries(STATIC_FILES)) {
    app.api(route, () => new Response(readFileSync(join(__dirname, file), 'utf-8'), { contentType }), 'GET');
  }

  app.api('/api/duet', (data) => handleDuetQuery(data, app.config?.conversationId), 'GET');

  app.run();
} else {
  const port = Number(process.env.ANTIGRAVITY_SIDECAR_WEB_PORT || process.env.PORT || 4791);
  const srv = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://localhost:${port}`);
    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(readFileSync(join(__dirname, 'index.html'), 'utf-8'));
      return;
    }
    if (STATIC_FILES[url.pathname]) {
      const [file, contentType] = STATIC_FILES[url.pathname];
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(readFileSync(join(__dirname, file), 'utf-8'));
      return;
    }
    if (url.pathname === '/api/duet') {
      const query = Object.fromEntries(url.searchParams.entries());
      const payload = handleDuetQuery(query);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(payload));
      return;
    }
    res.writeHead(404);
    res.end('Not found');
  });
  srv.listen(port, '127.0.0.1', () => {
    console.log(`[duet_dashboard] standalone server listening on http://127.0.0.1:${port}`);
  });
}
