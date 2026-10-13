const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const application = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
function slice(start, end) {
  const first = application.indexOf(start);
  const last = application.indexOf(end, first);
  assert.ok(first >= 0 && last > first);
  return application.slice(first, last);
}

class Node {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.attributes = {};
    this.className = '';
    this.classList = {
      contains: name => this.className.split(' ').includes(name),
      add: name => { this.className += ` ${name}`; },
    };
    this.bounds = {top: 0, bottom: 600, height: 600};
  }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener() {}
  getBoundingClientRect() { return this.bounds; }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.classList.contains(selector.slice(1)) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
}

function harness(storage = new Map()) {
  const frames = [];
  let renders = 0;
  const context = vm.createContext({
    document: {
      visibilityState: 'visible',
      hasFocus: () => true,
      querySelector: () => null,
      createElement: () => new Node(),
    },
    window: {
      localStorage: {
        get length() { return storage.size; },
        key: index => [...storage.keys()][index] ?? null,
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: key => storage.delete(key),
      },
      requestAnimationFrame: callback => frames.push(callback),
    },
    elements: {
      messages: new Node(), sidebar: new Node(), sessionsUnreadCount: new Node(), sessionsButton: new Node(),
    },
    state: {
      username: 'alice', namespace: 'default', consoleView: 'sessions',
      sessions: [], selected: null, currentView: {historyLoaded: true},
      sectionAssignments: new Set(),
    },
    renderSessions: () => { renders++; },
    sessionDisplayStatus: () => 'Idle',
    createSessionTimestamp: () => new Node(),
    providerLabel: provider => provider,
    createPullRequestLink: () => null,
  });
  vm.runInContext(slice('const completionReadPrefix', 'function moveChildren'), context);
  vm.runInContext(slice('function viewingSession', 'function notifySessions'), context);
  vm.runInContext(slice('function createSessionListItem', 'function sessionActionsTarget'), context);
  return Object.assign(context, {storage, renders: () => renders, flush: () => frames.splice(0).forEach(callback => callback())});
}

function completion(id = 'result-1', type = 'TurnCompleted', overrides = {}) {
  return {
    name: 'session', namespace: 'default', uid: 'uid-1', provider: 'codex',
    lastNotification: {id, type}, ...overrides,
  };
}

function showResult(h, session, id = session.lastNotification.id) {
  h.state.selected = session;
  h.state.sessions = [session];
  const divider = new Node();
  divider.className = 'turn-divider';
  divider.dataset.notificationId = id;
  divider.bounds = {top: 300, bottom: 310, height: 10};
  h.elements.messages.children = [divider];
  return divider;
}

{
  const h = harness();
  assert.equal(h.hasUnreadCompletion(completion()), true);
  assert.equal(h.hasUnreadCompletion(completion('failed', 'TurnFailed')), true);
  assert.equal(h.hasUnreadCompletion(completion('input', 'InputRequested')), false);
  assert.equal(h.hasUnreadCompletion(completion('reset', 'TurnCompleted', {resetting: true})), false);
  assert.equal(h.hasUnreadCompletion(completion('none', 'TurnCompleted', {lastNotification: undefined})), false);
  for (const [type, label] of [['TurnCompleted', 'Completed · Unread'], ['TurnFailed', 'Failed · Unread']]) {
    const row = h.createSessionListItem(completion(type, type));
    assert.equal(row.classList.contains('unread'), true);
    assert.equal(row.querySelectorAll('.session-unread-label')[0].textContent, label);
    assert.equal(row.querySelectorAll('.session-unread-dot')[0].attributes['aria-hidden'], 'true');
    assert.equal(row.querySelectorAll('.phase-dot')[0].className, 'phase-dot idle');
  }
  h.state.sessions = [completion(), completion('failed', 'TurnFailed'), completion('input', 'InputRequested')];
  h.renderUnreadCount();
  assert.equal(h.elements.sessionsUnreadCount.textContent, '2');
  assert.equal(h.elements.sessionsUnreadCount.hidden, false);
  assert.equal(h.elements.sessionsButton.attributes['aria-label'], 'Sessions, 2 unread results in default');
  h.state.sessions = [completion()];
  h.renderUnreadCount();
  assert.equal(h.elements.sessionsButton.attributes['aria-label'], 'Sessions, 1 unread result in default');
  h.state.sessions = [];
  h.renderUnreadCount();
  assert.equal(h.elements.sessionsUnreadCount.hidden, true);
}

for (const [name, hide] of [
  ['background tab', h => { h.document.visibilityState = 'hidden'; }],
  ['unfocused window', h => { h.document.hasFocus = () => false; }],
  ['overview', h => { h.state.consoleView = 'overview'; }],
  ['another conversation view', h => { h.elements.messages.hidden = true; }],
  ['history replay', h => { h.state.replayingHistory = true; }],
  ['history not loaded', h => { h.state.currentView.historyLoaded = false; }],
  ['dialog open', h => { h.document.querySelector = () => ({}); }],
  ['mobile sidebar open', h => { h.elements.sidebar.className = 'open'; }],
  ['result below viewport', (h, divider) => { divider.bounds = {top: 601, bottom: 611, height: 10}; }],
  ['result above viewport', (h, divider) => { divider.bounds = {top: -20, bottom: -10, height: 10}; }],
  ['hidden result', (h, divider) => { divider.bounds = {top: 0, bottom: 0, height: 0}; }],
  ['older result', (h, divider) => { divider.dataset.notificationId = 'older'; }],
]) {
  const h = harness();
  const session = completion();
  const divider = showResult(h, session);
  hide(h, divider);
  h.markVisibleCompletionRead();
  assert.equal(h.hasUnreadCompletion(session), true, name);
  assert.equal(h.storage.has(h.completionReadKey(session, session.lastNotification.id)), false, name);
}

{
  const h = harness();
  const session = completion();
  showResult(h, session);
  h.scheduleCompletionRead();
  h.scheduleCompletionRead();
  h.flush();
  assert.equal(h.hasUnreadCompletion(session), false);
  assert.equal(h.renders(), 1);
  assert.equal(h.createSessionListItem(session).querySelectorAll('.session-unread-label').length, 0);
  assert.equal(harness(h.storage).hasUnreadCompletion(session), false, 'refresh retains receipt');
  assert.equal(h.hasUnreadCompletion(completion('result-2')), true, 'next result is unread');
  assert.equal(h.hasUnreadCompletion(completion('result-1', 'TurnCompleted', {uid: 'uid-2'})), true, 'recreated Session is unread');
  assert.equal(h.hasUnreadCompletion(completion('result-1', 'TurnCompleted', {namespace: 'other'})), true, 'namespace is isolated');
  h.state.username = 'bob';
  assert.equal(h.hasUnreadCompletion(session), true, 'users have separate receipts');
  h.state.username = 'alice';
  h.storage.clear();
  h.syncCompletionRead({key: null});
  assert.equal(h.hasUnreadCompletion(session), true, 'storage clear removes receipts');
}

{
  const h = harness();
  const session = completion();
  showResult(h, session);
  const otherTab = harness(h.storage);
  const newer = completion('result-2');
  showResult(otherTab, newer);
  otherTab.markVisibleCompletionRead();
  h.markVisibleCompletionRead();
  assert.equal(h.storage.size, 2, 'stale tab writes its first receipt without overwriting the newer one');
  assert.equal(h.hasUnreadCompletion(newer), false);
  const rendered = h.renders();
  h.syncCompletionRead({key: h.completionReadKey(newer, newer.lastNotification.id)});
  assert.equal(h.renders(), rendered + 1, 'storage event refreshes the sidebar');
  h.storage.delete(h.completionReadKey(session, session.lastNotification.id));
  assert.equal(h.hasUnreadCompletion(session), false, 'in-memory receipt remains until the storage event arrives');
  h.syncCompletionRead({key: h.completionReadKey(session, session.lastNotification.id)});
  assert.equal(h.hasUnreadCompletion(session), true, 'storage event invalidates the in-memory receipt');
  assert.equal(h.renders(), rendered + 2);
}

{
  const h = harness();
  const session = completion();
  const older = showResult(h, session, 'older-result');
  const latest = showResult(h, session);
  h.elements.messages.children = [older, latest];
  latest.bounds = {top: 700, bottom: 710, height: 10};
  h.markVisibleCompletionRead();
  assert.equal(h.storage.size, 0, 'scrolling older results does not create receipts');
  latest.bounds = {top: 400, bottom: 410, height: 10};
  const olderKey = h.completionReadKey(session, 'older-result');
  h.storage.set(olderKey, '1');
  const futureKey = h.completionReadKey(session, 'future-result');
  h.storage.set(futureKey, '1');
  h.markVisibleCompletionRead();
  assert.equal(h.hasUnreadCompletion(session), false);
  assert.equal(h.storage.has(olderKey), false, 'known older receipt is pruned');
  assert.equal(h.storage.has(futureKey), true, 'unknown later receipt from another tab survives pruning');
}

{
  const h = harness();
  const session = completion();
  const older = showResult(h, session);
  h.markVisibleCompletionRead();
  const latest = showResult(h, session, 'live-result');
  h.elements.messages.children = [older, latest];
  h.markVisibleCompletionRead();
  assert.equal(h.hasUnreadCompletion(session), false, 'list refresh lag does not restore the older unread marker');
  h.state.selected = completion('live-result');
  h.markVisibleCompletionRead();
  assert.equal(h.storage.size, 1, 'superseded receipt is pruned once the list catches up');
}

{
  const h = harness();
  const session = completion();
  showResult(h, session);
  h.markVisibleCompletionRead();
  const key = h.completionReadKey(session, session.lastNotification.id);
  const otherNamespace = h.completionReadKey({...session, namespace: 'other'}, session.lastNotification.id);
  h.state.username = 'bob';
  const otherUser = h.completionReadKey(session, session.lastNotification.id);
  h.state.username = 'alice';
  for (const key of [otherNamespace, otherUser, 'kelos-console-namespace']) h.storage.set(key, '1');
  h.pruneCompletionReads([session]);
  assert.equal(h.storage.has(key), true, 'current Session receipt is retained');
  h.pruneCompletionReads([{...session, uid: 'replacement'}]);
  assert.equal(h.storage.has(key), false, 'replaced Session receipt is pruned');
  assert.equal(h.hasUnreadCompletion(session), true, 'pruning removes in-memory state too');
  for (const key of [otherNamespace, otherUser, 'kelos-console-namespace']) assert.equal(h.storage.has(key), true);
  showResult(h, session);
  h.markVisibleCompletionRead();
  h.pruneCompletionReads([]);
  assert.equal(h.storage.has(key), false, 'removed Session receipt is pruned');
}

{
  const h = harness();
  const session = completion();
  showResult(h, session, 'live-result');
  h.markVisibleCompletionRead();
  assert.equal(h.hasUnreadCompletion(completion('live-result')), false, 'visible live result is read before the Session list catches up');
  assert.equal(h.hasUnreadCompletion(session), true, 'a different result remains unread');
}

{
  const h = harness();
  h.window.localStorage = {
    getItem() { throw new Error('Storage blocked'); },
    setItem() { throw new Error('Storage blocked'); },
  };
  const session = completion();
  showResult(h, session);
  h.markVisibleCompletionRead();
  assert.equal(h.hasUnreadCompletion(session), false, 'receipt survives in this tab when storage is blocked');
  assert.equal(h.hasUnreadCompletion(completion('later')), true);
}

console.log('Unread completion tests passed');
