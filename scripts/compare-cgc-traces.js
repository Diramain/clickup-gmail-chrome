#!/usr/bin/env node
const fs = require('fs');
const readline = require('readline');

const MAX_LINE_BYTES = 64 * 1024;
const WINDOW_MS = 5000;
const ACTION_MAP = { 'tab-updated': 'tabs.onUpdated', 'tab-activated': 'tabs.onActivated', 'tab-removed': 'tabs.onRemoved', 'window-focus': 'windows.onFocusChanged', 'window-removed': 'windows.onRemoved' };
const ALLOWED_KEYS = new Set(['schemaVersion', 'source', 'sequence', 'timestamp', 'captureRef', 'event', 'tabRef', 'windowRef', 'taskRef', 'urlRef', 'originCategory', 'routeCategory', 'hasQuery', 'hasFragment', 'action', 'outcome', 'reason', 'errorCategory', 'guard']);
const SOURCES = new Set(['extension-main', 'session-observer']);
const EVENTS = new Set(['listener', 'navigation', 'index', 'guard', 'decision', 'attempt', 'result', 'diagnostic', 'capture']);
const ORIGINS = new Set(['clickup', 'gmail', 'meet', 'extension', 'other', 'invalid', 'none']);
const ROUTES = new Set(['task-direct', 'inbox-notification', 'inbox-general', 'kanban-or-list', 'home', 'gmail', 'meet', 'extension-page', 'other', 'invalid', 'none']);
const ACTIONS = new Set(['none', 'start', 'stop', 'switch', 'tabs.onUpdated', 'tabs.onActivated', 'tabs.onRemoved', 'windows.onFocusChanged', 'windows.onRemoved', 'timer-poll', 'focused-evaluation', 'last-task-view-exit', 'recording-started', 'recording-stopped', 'recording-continuity', 'tab-created', 'tab-updated', 'tab-activated', 'tab-removed', 'window-focus', 'window-removed', 'flush', 'compare', 'diagnostic_enabled', 'diagnostic_disabled', 'auth_state', 'authorization_mode', 'api_request', 'api_response', 'workspace_selection', 'task_validation', 'timer_poll', 'timer_transition']);
const OUTCOMES = new Set(['received', 'queued', 'skipped', 'none', 'attempted', 'stopped', 'started', 'switched', 'stale', 'invalid-task', 'failure', 'success', 'running', 'same-task-tab-open', 'stopped-after-focus-change', 'armed', 'disarmed', 'overflow', 'limit', 'permission-error', 'page-closed', 'manual-stop', 'scheduled-stop', 'closed', 'index-hit', 'index-miss', 'reconnected', 'in-flight']);
const REASONS = new Set(['direct', 'inbox-notification', 'inbox', 'clickup-other', 'outside-clickup', 'disabled', 'auto-stop-disabled', 'auto-start-disabled', 'running-task-unknown', 'closed-task-unknown', 'closed-different-task', 'same-task', 'different-task', 'timer-already-running', 'last-task-tab-closed', 'last-task-view-left', 'meet-priority', 'manual', 'manually-stopped', 'scheduled-1800', 'page-close', 'writer-limit', 'writer-overflow', 'writer-error', 'permission-error', 'service-worker-restart', 'unknown']);
const ERRORS = new Set(['unauthorized', 'not-found', 'rate-limited', 'server-error', 'permission-error', 'limit', 'unknown']);
const GUARDS = new Set(['auth', 'meet-priority', 'settings', 'focused-snapshot', 'team', 'api', 'running-task', 'manual-suppression', 'still-focused', 'last-view', 'writer', 'schema', 'none']);

function usage() { console.error('Usage: node scripts/compare-cgc-traces.js <main.jsonl> <sidecar.jsonl>'); process.exit(2); }

async function* parseJsonl(file, expectedSource) {
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error(`not_file:${expectedSource}`);
  let lineNumber = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8', highWaterMark: MAX_LINE_BYTES }), crlfDelay: Infinity });
  for await (const line of rl) {
    lineNumber += 1;
    if (!line) continue;
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new Error(`line_too_large:${expectedSource}:${lineNumber}`);
    if (!assertNoRaw(line)) throw new Error(`raw_data_detected:${expectedSource}:${lineNumber}`);
    const normalized = normalize(JSON.parse(line), expectedSource);
    if (!normalized) throw new Error(`schema_invalid:${expectedSource}:${lineNumber}`);
    yield normalized;
  }
}

async function readJsonl(file, expectedSource) {
  const events = [];
  for await (const event of parseJsonl(file, expectedSource)) events.push(event);
  return events.sort(orderEvents);
}

function normalize(raw, expectedSource) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (Object.keys(raw).some(key => !ALLOWED_KEYS.has(key))) return null;
  if (raw.schemaVersion !== 1 || !SOURCES.has(raw.source) || raw.source !== expectedSource || !EVENTS.has(raw.event)) return null;
  if (!Number.isSafeInteger(raw.sequence) || raw.sequence < 1 || !Number.isSafeInteger(raw.timestamp) || raw.timestamp < 0) return null;
  if (typeof raw.captureRef !== 'string' || !/^[a-z]+-[a-z0-9-]{1,90}$/i.test(raw.captureRef)) return null;
  const event = { schemaVersion: 1, source: raw.source, sequence: raw.sequence, timestamp: raw.timestamp, captureRef: raw.captureRef, event: raw.event };
  for (const key of ['tabRef', 'windowRef', 'taskRef', 'urlRef']) { if (raw[key] !== undefined) { const prefix = key === 'windowRef' ? 'win' : key.replace('Ref', ''); if (typeof raw[key] !== 'string' || !new RegExp(`^${prefix}-\\d{1,6}$`).test(raw[key])) return null; event[key] = raw[key]; } }
  if (!assignEnum(event, raw, 'originCategory', ORIGINS)) return null;
  if (!assignEnum(event, raw, 'routeCategory', ROUTES)) return null;
  for (const key of ['hasQuery', 'hasFragment']) { if (raw[key] !== undefined) { if (typeof raw[key] !== 'boolean') return null; event[key] = raw[key]; } }
  if (!assignEnum(event, raw, 'action', ACTIONS)) return null;
  if (!assignEnum(event, raw, 'outcome', OUTCOMES)) return null;
  if (!assignEnum(event, raw, 'reason', REASONS)) return null;
  if (!assignEnum(event, raw, 'errorCategory', ERRORS)) return null;
  if (!assignEnum(event, raw, 'guard', GUARDS)) return null;
  return event;
}

function assignEnum(event, raw, key, allowed) { if (raw[key] === undefined) return true; if (typeof raw[key] !== 'string' || !allowed.has(raw[key])) return false; event[key] = raw[key]; return true; }
function assertNoRaw(serialized) { return !/(https?:\/\/|chrome-extension:\/\/|[?&][A-Za-z0-9_-]+=|#[A-Za-z0-9_-]+|Authorization|Bearer\s+|cookies?|headers?|@|rawUrl|rawTitle|taskId|TASK-RAW|PRIVATE-TITLE|secret|token|email)/i.test(serialized); }
function orderEvents(a, b) { return a.timestamp - b.timestamp || a.sequence - b.sequence; }

function compare(main, sidecar) {
  const anomalies = [];
  const mainOrdered = [...main].sort(orderEvents);
  const sidecarOrdered = [...sidecar].sort(orderEvents);
  const usedMain = new Set();
  for (const external of sidecarOrdered.filter(event => event.event === 'listener')) {
    const expectedAction = ACTION_MAP[external.action];
    if (!expectedAction) continue;
    const index = mainOrdered.findIndex((candidate, idx) => !usedMain.has(idx) && isCrossSourceMatch(candidate, external, expectedAction));
    if (index >= 0) usedMain.add(index);
    else anomalies.push({ type: 'external_without_internal', at: external.timestamp, action: expectedAction });
  }
  addMainAnomalies(mainOrdered, anomalies);
  anomalies.push(...detectSequenceDiscontinuities(mainOrdered), ...detectSequenceDiscontinuities(sidecarOrdered));
  return { mainEvents: main.length, sidecarEvents: sidecar.length, anomalies };
}

async function compareFiles(mainFile, sidecarFile) {
  const anomalies = [];
  let mainEvents = 0;
  let sidecarEvents = 0;
  const mainCandidates = [];
  const pendingSidecar = [];
  const navWindow = [];
  const lastSeq = new Map();
  for await (const event of mergeStreams(parseJsonl(mainFile, 'extension-main'), parseJsonl(sidecarFile, 'session-observer'))) {
    evictPending(pendingSidecar, event.timestamp, anomalies);
    evictNav(navWindow, event.timestamp, anomalies);
    evictOld(mainCandidates, event.timestamp);
    if (event.source === 'extension-main') {
      mainEvents += 1;
      checkSeq(event, lastSeq, anomalies);
      const pendingIndex = pendingSidecar.findIndex(external => isCrossSourceMatch(event, external, ACTION_MAP[external.action]));
      if (pendingIndex >= 0) pendingSidecar.splice(pendingIndex, 1);
      else if (event.event === 'listener') mainCandidates.push(event);
      if (event.event === 'navigation') navWindow.push(event);
      if (event.event === 'decision') consumeNavigation(navWindow, event);
      addSingleMainAnomaly(event, anomalies);
    } else {
      sidecarEvents += 1;
      checkSeq(event, lastSeq, anomalies);
      const expectedAction = ACTION_MAP[event.action];
      if (!expectedAction || event.event !== 'listener') continue;
      const index = mainCandidates.findIndex(candidate => isCrossSourceMatch(candidate, event, expectedAction));
      if (index >= 0) mainCandidates.splice(index, 1);
      else pendingSidecar.push(event);
    }
  }
  for (const event of pendingSidecar) anomalies.push({ type: 'external_without_internal', at: event.timestamp, action: ACTION_MAP[event.action] || 'none' });
  for (const event of navWindow) anomalies.push({ type: 'navigation_not_processed', at: event.timestamp, routeCategory: event.routeCategory || 'none' });
  return { mainEvents, sidecarEvents, anomalies };
}

async function* mergeStreams(mainStream, sideStream) {
  const main = mainStream[Symbol.asyncIterator]();
  const side = sideStream[Symbol.asyncIterator]();
  let m = await main.next();
  let s = await side.next();
  while (!m.done || !s.done) {
    if (s.done || (!m.done && orderEvents(m.value, s.value) <= 0)) { yield m.value; m = await main.next(); }
    else { yield s.value; s = await side.next(); }
  }
}

function isCrossSourceMatch(candidate, external, expectedAction) { return candidate.event === 'listener' && candidate.action === expectedAction && candidate.timestamp >= external.timestamp && candidate.timestamp - external.timestamp <= WINDOW_MS && sameInformativeRoute(candidate.routeCategory, external.routeCategory); }
function sameInformativeRoute(a, b) { if (!a || !b || a === 'none' || b === 'none' || a === 'other' || b === 'other') return true; return a === b; }
function evictOld(events, now) { while (events.length && now - events[0].timestamp > WINDOW_MS) events.shift(); }
function evictPending(events, now, anomalies) { for (let i = 0; i < events.length;) { if (now - events[i].timestamp > WINDOW_MS) anomalies.push({ type: 'external_without_internal', at: events[i].timestamp, action: ACTION_MAP[events[i].action] || 'none' }), events.splice(i, 1); else i += 1; } }
function evictNav(events, now, anomalies) { for (let i = 0; i < events.length;) { if (now - events[i].timestamp > WINDOW_MS) anomalies.push({ type: 'navigation_not_processed', at: events[i].timestamp, routeCategory: events[i].routeCategory || 'none' }), events.splice(i, 1); else i += 1; } }
function consumeNavigation(navWindow, decision) { const index = navWindow.findIndex(nav => nav.captureRef === decision.captureRef && nav.timestamp <= decision.timestamp && decision.timestamp - nav.timestamp <= WINDOW_MS && sameOptional(nav.tabRef, decision.tabRef) && sameOptional(nav.routeCategory, decision.routeCategory)); if (index >= 0) navWindow.splice(index, 1); }
function sameOptional(left, right) { return !left || !right || left === right; }
function checkSeq(event, lastSeq, anomalies) { const key = `${event.source}:${event.captureRef}`; const last = lastSeq.get(key); if (last !== undefined && event.sequence !== last + 1) anomalies.push({ type: 'sequence_discontinuity', captureRef: event.captureRef, expected: last + 1, got: event.sequence }); lastSeq.set(key, event.sequence); }
function detectSequenceDiscontinuities(events) { const anomalies = []; const last = new Map(); for (const event of events) checkSeq(event, last, anomalies); return anomalies; }
function addSingleMainAnomaly(event, anomalies) {
  if (event.event === 'index' && event.outcome === 'index-miss' && event.reason === 'closed-task-unknown') {
    anomalies.push({ type: 'index_miss', at: event.timestamp, routeCategory: event.routeCategory || 'none' });
  }
  if (event.event === 'decision' && event.action === 'stop' && event.outcome === 'skipped') {
    anomalies.push({ type: 'stop_skipped', at: event.timestamp, reason: event.reason || 'unknown' });
  }
  if (event.event === 'result' && event.outcome === 'failure') {
    anomalies.push({ type: 'api_failure', at: event.timestamp, errorCategory: event.errorCategory || 'unknown' });
  }
}
function addMainAnomalies(events, anomalies) { for (const event of events) addSingleMainAnomaly(event, anomalies); const navs = events.filter(event => event.event === 'navigation'); for (const nav of navs) { if (!events.some(event => event.event === 'decision' && event.timestamp >= nav.timestamp && event.timestamp - nav.timestamp <= WINDOW_MS && sameOptional(event.tabRef, nav.tabRef) && sameOptional(event.routeCategory, nav.routeCategory))) anomalies.push({ type: 'navigation_not_processed', at: nav.timestamp, routeCategory: nav.routeCategory || 'none' }); } }

async function main() { const [, , mainFile, sidecarFile] = process.argv; if (!mainFile || !sidecarFile) usage(); const result = await compareFiles(mainFile, sidecarFile); console.log(JSON.stringify(result, null, 2)); process.exit(result.anomalies.length > 0 ? 1 : 0); }
if (require.main === module) void main().catch((error) => { console.error(error.message || 'compare_failed'); process.exit(1); });
module.exports = { compare, compareFiles, parseJsonl, readJsonl, normalize };
