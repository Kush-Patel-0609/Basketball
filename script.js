(function () {
'use strict';

/* ================= Local Storage Helper ================= */
var KEY_GAMES = 'bbteam.games';
var mem = {}, storage = null;
try { var t = '__x'; window.localStorage.setItem(t, t); window.localStorage.removeItem(t); storage = window.localStorage; } catch (e) {}
function sget(k) { try { var v = storage ? storage.getItem(k) : mem[k]; return v ? JSON.parse(v) : null; } catch (e) { return null; } }
function sset(k, v) { var s = JSON.stringify(v); try { if (storage) storage.setItem(k, s); else mem[k] = s; } catch (e) { mem[k] = s; } }
var games = sget(KEY_GAMES) || [];
function persistGamesLocal() { sset(KEY_GAMES, games); }
function nextGameNo() { var mx = 0; games.forEach(function (g) { if (g.no > mx) mx = g.no; }); return mx + 1; }

/* ================= Firebase Config & Detection ================= */
var fbdb = null, matchRef = null, matchId = null, isFbActive = false, connected = false;

function isValidFbConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') return false;
  if (!cfg.apiKey || typeof cfg.apiKey !== 'string' || cfg.apiKey.indexOf('PASTE_') !== -1 || cfg.apiKey.indexOf('YOUR_') !== -1) return false;
  if (!cfg.projectId || typeof cfg.projectId !== 'string' || cfg.projectId.indexOf('PASTE_') !== -1 || cfg.projectId.indexOf('YOUR_') !== -1) return false;
  return true;
}

function getEffectiveFirebaseConfig() {
  try {
    var stored = storage ? storage.getItem('bbteam.firebase_config') : null;
    if (stored) {
      var parsed = JSON.parse(stored);
      if (isValidFbConfig(parsed)) return parsed;
    }
  } catch (e) {}

  if (window.FIREBASE_CONFIG && isValidFbConfig(window.FIREBASE_CONFIG)) {
    return window.FIREBASE_CONFIG;
  }
  return null;
}

function parsePastedFirebaseConfig(str) {
  if (!str) return null;
  str = str.trim();
  try {
    var json = JSON.parse(str);
    if (isValidFbConfig(json)) return json;
  } catch (e) {}

  var obj = {};
  var fields = ['apiKey', 'authDomain', 'databaseURL', 'projectId', 'storageBucket', 'messagingSenderId', 'appId'];
  fields.forEach(function (f) {
    var re = new RegExp('["\']?' + f + '["\']?\\s*:\\s*["\']([^"\'\\n]+)["\']', 'i');
    var m = str.match(re);
    if (m && m[1]) obj[f] = m[1].trim();
  });
  if (isValidFbConfig(obj)) return obj;
  return null;
}

function initFirebase() {
  var cfg = getEffectiveFirebaseConfig();
  if (!cfg) {
    fbdb = null;
    isFbActive = false;
    updateCloudIcon();
    return false;
  }
  try {
    if (typeof firebase === 'undefined') {
      console.warn('Firebase library not loaded from CDN');
      fbdb = null;
      isFbActive = false;
      updateCloudIcon();
      return false;
    }
    if (firebase.apps && firebase.apps.length > 0) {
      fbdb = firebase.app().database();
    } else {
      var app = firebase.initializeApp(cfg);
      fbdb = app.database();
    }
    isFbActive = true;
    updateCloudIcon();
    return true;
  } catch (e) {
    console.warn('Firebase initialization error:', e);
    fbdb = null;
    isFbActive = false;
    updateCloudIcon();
    return false;
  }
}

function updateCloudIcon() {
  var b = $('btn-cloud');
  if (!b) return;
  if (isFbActive) {
    b.className = 'iconbtn cloud-active';
    b.title = 'Cloud sync active (Firebase)';
  } else {
    b.className = 'iconbtn cloud-idle';
    b.title = 'Local mode — click to setup Cloud sync';
  }
}

/* ================= Multi-Tab & Real-time Sync ================= */
// BroadcastChannel for cross-tab sync on same device
var syncChannel = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    syncChannel = new BroadcastChannel('bbteam_realtime_sync');
    syncChannel.onmessage = function (evt) {
      var msg = evt.data;
      if (!msg || !matchId) return;
      if (msg.matchId === matchId) {
        if (msg.type === 'state_update' && msg.cur) {
          cur = msg.cur;
          if (!cur.log) cur.log = [];
          renderAll();
        } else if (msg.type === 'request_state' && cur) {
          syncChannel.postMessage({ type: 'state_update', matchId: matchId, cur: cur });
        }
      }
    };
  }
} catch (e) {}

// Storage listener fallback for cross-tab sync
window.addEventListener('storage', function (e) {
  if (matchId && e.key === 'bbteam.match.' + matchId && e.newValue) {
    try {
      var updated = JSON.parse(e.newValue);
      if (updated && updated.home && updated.guest) {
        cur = updated;
        if (!cur.log) cur.log = [];
        renderAll();
      }
    } catch (err) {}
  }
});

/* ================= state ================= */
var cur = null;
var activeSide = 'home';
var currentView = 'landing';
var writeTimer = null;

function $(id) { return document.getElementById(id); }
function h(tag, attrs, kids) {
  var el = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  (kids || []).forEach(function (c) { if (c == null) return; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return el;
}
function initials(name) {
  var parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
function haptic(ms) { try { if (navigator.vibrate) navigator.vibrate(ms || 20); } catch (e) {} }
var toastTimer;
function toast(msg) {
  var el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
}
function fmtClock(sec) { var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
function fmtDate(ts) { var d = new Date(ts); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

function copyToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () {
      toast('Link copied to clipboard');
    }).catch(function () {
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    document.execCommand('copy');
    toast('Link copied to clipboard');
  } catch (e) {
    toast('Could not copy link automatically');
  }
  document.body.removeChild(ta);
}

/* ================= match id + safe routing ================= */
function genMatchId() {
  var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L — easy to read and type
  var s = '';
  for (var i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function urlForMatch(id) {
  try {
    var u = new URL(window.location.href);
    if (window.location.protocol === 'file:') {
      u.search = '';
      u.hash = 'm=' + id;
    } else {
      u.search = '?m=' + id;
      u.hash = '';
    }
    return u.toString();
  } catch (e) {
    return window.location.href.split('?')[0].split('#')[0] + '?m=' + id;
  }
}

function safeUpdateUrl(id) {
  try {
    if (window.location.protocol === 'file:') {
      if (id) window.location.hash = 'm=' + id;
      else if (window.location.hash) window.location.hash = '';
      return;
    }
    var newUrl = id ? urlForMatch(id) : window.location.pathname;
    history.replaceState(null, '', newUrl);
  } catch (e) {
    try {
      if (id) window.location.hash = 'm=' + id;
      else window.location.hash = '';
    } catch (e2) {}
  }
}

function getMatchIdFromUrl() {
  try {
    var p = new URLSearchParams(window.location.search);
    var m = p.get('m');
    if (m) return m.toUpperCase();
    if (window.location.hash) {
      var hStr = window.location.hash.replace(/^#\/?/, '');
      if (hStr.indexOf('m=') !== -1) {
        var hp = new URLSearchParams(hStr);
        m = hp.get('m');
        if (m) return m.toUpperCase();
      } else if (hStr.length === 6 && /^[A-Z0-9]+$/i.test(hStr)) {
        return hStr.toUpperCase();
      }
    }
  } catch (e) {}
  return null;
}

/* ================= setup form ================= */
function buildSetupRows(container, defName) {
  container.textContent = '';
  for (var i = 1; i <= 5; i++) {
    container.appendChild(h('div', { class: 'prow' }, [
      h('span', { class: 'no', text: String(i) }),
      h('input', { type: 'text', maxlength: '14', placeholder: defName + ' ' + i, id: container.id + '-p' + i, autocomplete: 'off' })
    ]));
  }
}
buildSetupRows($('su-home-players'), 'Player');
buildSetupRows($('su-guest-players'), 'Player');

function readSetupPlayers(prefix, fallback) {
  var arr = [];
  for (var i = 1; i <= 5; i++) {
    var el = $(prefix + '-p' + i);
    var v = el ? el.value.trim() : '';
    arr.push(v || (fallback + ' ' + i));
  }
  return arr;
}
function makeTeam(name, playerNames) {
  var players = {}, slots = [];
  playerNames.forEach(function (nm, i) { var id = 'p' + i; players[id] = { name: nm, points: 0 }; slots.push(id); });
  return { name: name, score: 0, slots: slots, players: players, seq: playerNames.length };
}
function newMatch(homeName, homePlayers, guestName, guestPlayers) {
  return {
    no: nextGameNo(),
    home: makeTeam(homeName || 'Home', homePlayers),
    guest: makeTeam(guestName || 'Guest', guestPlayers),
    clock: { elapsed: 0, running: false, startedAt: 0 },
    log: [],
    startedAt: Date.now()
  };
}

/* ================= match creation & start ================= */
$('btn-go-create').addEventListener('click', function () { showView('setup'); });

var btnBackSetup = $('btn-back-setup');
if (btnBackSetup) {
  btnBackSetup.addEventListener('click', function () { showView('landing'); });
}

$('btn-start-match').addEventListener('click', function () {
  var hn = $('su-home-name').value.trim() || 'Home';
  var gn = $('su-guest-name').value.trim() || 'Guest';
  var hp = readSetupPlayers('su-home-players', 'Player');
  var gp = readSetupPlayers('su-guest-players', 'Player');
  
  cur = newMatch(hn, hp, gn, gp);
  matchId = genMatchId();

  // Persist locally
  try {
    if (storage) {
      storage.setItem('bbteam.match.' + matchId, JSON.stringify(cur));
      storage.setItem('bbteam.lastMatchId', matchId);
    }
  } catch (e) {}

  safeUpdateUrl(matchId);

  // If Firebase is active and configured, sync to cloud
  if (isFbActive && fbdb) {
    try {
      matchRef = fbdb.ref('matches/' + matchId);
      matchRef.set(cur).then(function () {
        subscribeFirebaseMatch();
      }).catch(function (err) {
        console.warn('Firebase set failed — continuing in local mode:', err);
        isFbActive = false;
        renderSyncBar();
      });
    } catch (e) {
      console.warn('Firebase error:', e);
      isFbActive = false;
    }
  }

  // Broadcast to other open tabs
  if (syncChannel) {
    try {
      syncChannel.postMessage({ type: 'state_update', matchId: matchId, cur: cur });
    } catch (e) {}
  }

  // Transition to live view immediately
  showView('live');
  $('btn-settings').style.display = '';
  $('btn-invite').style.display = '';
  $('tabbar').style.display = '';
  renderAll();
  renderSyncBar();
  openInviteModal();

  if (!isFbActive) {
    toast('Match started in Local Mode!');
  } else {
    toast('Match started! Cloud sync ready.');
  }
});

/* ================= joining an existing match ================= */
function tryJoin(id) {
  id = id.toUpperCase();
  matchId = id;
  showView('joining');

  // 1. Check local storage first
  var localMatch = null;
  try {
    var stored = storage ? storage.getItem('bbteam.match.' + id) : null;
    if (stored) localMatch = JSON.parse(stored);
  } catch (e) {}

  if (localMatch && localMatch.home && localMatch.guest) {
    cur = localMatch;
    safeUpdateUrl(id);
    showView('live');
    $('btn-settings').style.display = '';
    $('btn-invite').style.display = '';
    $('tabbar').style.display = '';
    renderAll();
    renderSyncBar();
    toast('Joined match ' + id + ' (Local)');
    if (isFbActive && fbdb) {
      matchRef = fbdb.ref('matches/' + id);
      subscribeFirebaseMatch();
    }
    return;
  }

  // 2. If Firebase active, query cloud database
  if (isFbActive && fbdb) {
    matchRef = fbdb.ref('matches/' + id);
    var settled = false;
    var timeout = setTimeout(function () {
      if (!settled) {
        $('joining-title').textContent = 'Still looking…';
        $('joining-text').textContent = 'This is taking longer than usual — check your connection.';
      }
    }, 4000);

    matchRef.once('value').then(function (snap) {
      settled = true; clearTimeout(timeout);
      if (!snap.exists()) {
        showNotFound(id);
        return;
      }
      cur = snap.val();
      if (!cur.log) cur.log = [];
      subscribeFirebaseMatch();
      safeUpdateUrl(id);
      showView('live');
      $('btn-settings').style.display = '';
      $('btn-invite').style.display = '';
      $('tabbar').style.display = '';
      renderAll();
      renderSyncBar();
      toast('Joined the live match');
    }).catch(function (err) {
      settled = true; clearTimeout(timeout);
      console.warn('Firebase query failed:', err);
      showNotFound(id);
    });
    return;
  }

  // 3. Ask open tabs via BroadcastChannel
  if (syncChannel) {
    syncChannel.postMessage({ type: 'request_state', matchId: id });
    setTimeout(function () {
      if (!cur) {
        showNotFound(id);
      }
    }, 1200);
    return;
  }

  showNotFound(id);
}

function showNotFound(id) {
  $('joining-title').textContent = 'Match not found';
  $('joining-text').textContent = 'Match "' + id + '" could not be found. Check the code or start a new match.';
  var container = $('view-joining').querySelector('.landing-card');
  var existingBtn = container.querySelector('.join-fallback-btn');
  if (existingBtn) existingBtn.remove();
  container.appendChild(h('button', {
    class: 'startbtn join-fallback-btn',
    style: 'margin-top:14px;max-width:260px;',
    text: 'Create a new match',
    onclick: function () { safeUpdateUrl(''); showView('setup'); }
  }));
}

function subscribeFirebaseMatch() {
  if (!matchRef) return;
  matchRef.on('value', function (snap) {
    if (!snap.exists()) return;
    cur = snap.val();
    if (!cur.log) cur.log = [];
    renderAll();
  });
  if (fbdb) {
    fbdb.ref('.info/connected').on('value', function (snap) {
      connected = snap.val() === true;
      renderSyncBar();
    });
  }
}

function renderSyncBar() {
  var el = $('syncbar');
  if (!matchId || currentView !== 'live') {
    el.className = 'syncbar';
    el.style.display = 'none';
    return;
  }
  el.style.display = '';
  if (isFbActive) {
    el.className = 'syncbar show ' + (connected ? 'live' : 'solo');
    el.textContent = connected
      ? '🔗 Live Cloud · Code ' + matchId + ' — scores sync instantly'
      : '📡 Reconnecting to Cloud…';
    el.onclick = openFirebaseSettingsModal;
  } else {
    el.className = 'syncbar show local';
    el.innerHTML = '🏠 <b>Local Mode</b> · Code ' + matchId + ' &nbsp;·&nbsp; <span style="text-decoration:underline;">Enable Live Sync ☁️</span>';
    el.onclick = openFirebaseSettingsModal;
  }
}

/* ================= writes ================= */
function commit() {
  if (!cur) return;

  // 1. Local Storage
  try {
    if (storage && matchId) {
      storage.setItem('bbteam.match.' + matchId, JSON.stringify(cur));
    }
  } catch (e) {}

  // 2. BroadcastChannel
  if (syncChannel && matchId) {
    try {
      syncChannel.postMessage({ type: 'state_update', matchId: matchId, cur: cur });
    } catch (e) {}
  }

  // 3. Firebase (debounced)
  if (isFbActive && matchRef) {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(function () {
      matchRef.set(JSON.parse(JSON.stringify(cur))).catch(function (err) {
        console.warn('Cloud sync write failed:', err);
      });
    }, 120);
  }
}

/* ================= clock ================= */
function clockElapsed() {
  if (!cur) return 0;
  return cur.clock.running ? cur.clock.elapsed + Math.floor((Date.now() - cur.clock.startedAt) / 1000) : cur.clock.elapsed;
}
function toggleClock() {
  if (cur.clock.running) { cur.clock.elapsed = clockElapsed(); cur.clock.running = false; }
  else { cur.clock.startedAt = Date.now(); cur.clock.running = true; }
  commit(); renderClock();
}
function resetClock() { cur.clock.elapsed = 0; cur.clock.running = false; commit(); renderClock(); }
function renderClock() {
  $('clock-time').textContent = fmtClock(clockElapsed());
  var b = $('clock-toggle'); b.textContent = cur.clock.running ? 'Pause' : 'Start'; b.classList.toggle('on', cur.clock.running);
}
setInterval(function () { if (cur && cur.clock.running) $('clock-time').textContent = fmtClock(clockElapsed()); }, 500);

/* ================= scoring ================= */
function team(side) { return cur[side]; }
function nm(side) { return team(side).name; }

function addPoint(side, slotIdx, val) {
  var t = team(side), pid = t.slots[slotIdx], p = t.players[pid];
  p.points += val; t.score += val;
  cur.log.push({ id: Date.now() + Math.random(), side: side, pid: pid, delta: val });
  commit(); renderTeamHeader(side); renderRosterList(); flipScore(side); haptic(22);
}
function undoLast() {
  if (!cur.log.length) { toast('Nothing to undo'); return; }
  var e = cur.log.pop();
  var t = team(e.side), p = t.players[e.pid];
  if (p) { p.points -= e.delta; t.score -= e.delta; }
  commit(); renderTeamHeader(e.side); renderRosterList();
  toast('Undid +' + e.delta + ' for ' + (p ? p.name : 'player')); haptic(20);
}
function flipScore(side) { var el = $(side + '-score'); el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); }
function renamePlayer(side, slotIdx, val) {
  var t = team(side), pid = t.slots[slotIdx];
  t.players[pid].name = val.trim() || t.players[pid].name;
  commit();
}
function renameTeam(side, val) {
  team(side).name = val.trim() || nm(side);
  commit(); renderTeamHeader(side); renderRosterHeaderLabels();
}
function doSub(side, slotIdx, newName) {
  var t = team(side); var newId = 'p' + (t.seq++);
  t.players[newId] = { name: newName, points: 0 };
  t.slots[slotIdx] = newId;
  commit(); renderRosterList();
  toast(newName + ' subbed in');
}

/* ================= side switching ================= */
function setActiveSide(side) {
  activeSide = side;
  $('half-home').classList.toggle('active', side === 'home');
  $('half-guest').classList.toggle('active', side === 'guest');
  renderRosterList();
}
$('tap-home').addEventListener('click', function () { setActiveSide('home'); });
$('tap-guest').addEventListener('click', function () { setActiveSide('guest'); });

/* ================= render: header ================= */
function renderTeamHeader(side) { $(side + '-score').textContent = team(side).score; }
function renderRosterHeaderLabels() {
  $('home-name').textContent = nm('home').toUpperCase();
  $('guest-name').textContent = nm('guest').toUpperCase();
}

/* ================= render: roster ================= */
function playerCard(side, slotIdx) {
  var t = team(side), pid = t.slots[slotIdx], p = t.players[pid];
  var nameInput = h('input', {
    class: 'pname', type: 'text', maxlength: '16', value: p.name,
    onchange: function () { renamePlayer(side, slotIdx, this.value); },
    onblur: function () { renamePlayer(side, slotIdx, this.value); this.value = team(side).players[t.slots[slotIdx]].name; }
  });
  var ptsEl = h('div', { class: 'ppts' }, [document.createTextNode('PTS '), h('b', { text: String(p.points) })]);
  return h('div', { class: 'pcard ' + side, id: 'card-' + side + '-' + slotIdx }, [
    h('div', { class: 'avatar', text: initials(p.name) }),
    h('div', { class: 'pmid' }, [nameInput, ptsEl]),
    h('div', { class: 'pright' }, [
      h('button', { class: 'pbtn', text: '+1', 'aria-label': 'Add 1 point', onclick: function () { addPoint(side, slotIdx, 1); } }),
      h('button', { class: 'pbtn', text: '+2', 'aria-label': 'Add 2 points', onclick: function () { addPoint(side, slotIdx, 2); } }),
      h('button', { class: 'pbtn', text: '+3', 'aria-label': 'Add 3 points', onclick: function () { addPoint(side, slotIdx, 3); } }),
      h('button', { class: 'subbtn', text: '⇄', 'aria-label': 'Substitute player', onclick: function () { openSubModal(side, slotIdx); } })
    ])
  ]);
}
function renderRosterList() {
  var box = $('roster');
  box.classList.remove('switching'); void box.offsetWidth; box.classList.add('switching');
  box.textContent = '';
  for (var i = 0; i < 5; i++) box.appendChild(playerCard(activeSide, i));
}

/* ================= modals ================= */
function openModal(title, text, body, actions) {
  var m = $('modal'); m.textContent = '';
  m.appendChild(h('h2', { text: title }));
  if (text) m.appendChild(h('p', { text: text }));
  if (body) m.appendChild(body);
  m.appendChild(h('div', { class: 'm-actions' }, actions.map(function (a) {
    return h('button', { class: 'm-btn ' + (a.cls || ''), text: a.label, onclick: function () { closeModal(); if (a.fn) a.fn(); } });
  })));
  $('modal-overlay').classList.add('show');
}
function closeModal() { $('modal-overlay').classList.remove('show'); }
$('modal-overlay').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

function openSubModal(side, slotIdx) {
  var t = team(side), pid = t.slots[slotIdx], outName = t.players[pid].name;
  var input = h('input', { class: 'tinput', type: 'text', maxlength: '16', placeholder: 'Incoming player name', autocomplete: 'off' });
  openModal('Substitute', outName + ' comes off for ' + nm(side) + '. Who is coming in?', input, [
    { label: 'Confirm substitution', cls: 'primary', fn: function () { var v = input.value.trim(); if (!v) { toast('Enter a name'); return; } doSub(side, slotIdx, v); } },
    { label: 'Cancel' }
  ]);
  setTimeout(function () { input.focus(); }, 80);
}

function openSettings() {
  var hIn = h('input', { class: 'tinput', value: nm('home') });
  var gIn = h('input', { class: 'tinput', value: nm('guest') });
  var body = h('div', null, [
    h('div', { style: 'font-size:.8rem;color:var(--muted);margin-bottom:4px;', text: 'Home team name' }), hIn,
    h('div', { style: 'font-size:.8rem;color:var(--muted);margin:8px 0 4px;', text: 'Guest team name' }), gIn,
    h('div', { style: 'font-size:.8rem;color:var(--muted-2);margin-top:14px;', text: 'This match\u2019s code: ' + matchId })
  ]);
  openModal('Match settings', 'Rename either team. Player names can be edited directly on their card.', body, [
    { label: 'Save', cls: 'primary', fn: function () { renameTeam('home', hIn.value); renameTeam('guest', gIn.value); toast('Team names updated'); } },
    { label: 'Cloud Sync / Firebase Settings', fn: openFirebaseSettingsModal },
    { label: 'Leave & start a brand-new match', cls: 'danger', fn: function () { safeUpdateUrl(''); location.reload(); } },
    { label: 'Cancel' }
  ]);
}

function openInviteModal() {
  var url = urlForMatch(matchId);
  var box = h('div', { class: 'qrbox', id: 'qr-render' });
  var copyBtn = h('button', {
    text: 'Copy link', onclick: function () { copyToClipboard(url); }
  });

  var statusBadge = isFbActive
    ? h('div', { class: 'status-pill online', text: '🟢 Live Cloud Sync Active' })
    : h('div', { class: 'status-pill offline', text: '🏠 Local / Solo Mode' });

  var statusText = isFbActive
    ? h('p', { style: 'font-size:.82rem;color:var(--muted);margin:0 0 10px;', text: 'Anyone opening this link or scanning the code joins and scores live with you.' })
    : h('div', { style: 'margin:0 0 10px;text-align:center;' }, [
        h('p', { style: 'font-size:.82rem;color:var(--muted);margin-bottom:6px;', text: 'Scores are syncing across browser tabs on this device. To sync between 2 phones across the internet, enable Firebase.' }),
        h('button', { class: 'text-btn', style: 'color:var(--home);font-size:.85rem;text-decoration:underline;', text: '⚙️ Configure Firebase Live Sync', onclick: function () { closeModal(); openFirebaseSettingsModal(); } })
      ]);

  var body = h('div', { class: 'qrwrap' }, [
    statusBadge,
    box,
    h('div', { class: 'linkrow' }, [h('span', { text: url }), copyBtn]),
    h('div', { style: 'font-family:var(--num);letter-spacing:3px;font-size:1.1rem;color:var(--muted);margin:4px 0;', text: 'CODE: ' + matchId }),
    statusText
  ]);

  openModal('Invite a friend', 'Have them scan this QR code or send the link or code to open this match.', body, [{ label: 'Done' }]);

  setTimeout(function () {
    if (typeof QRCode === 'function') {
      try {
        box.textContent = '';
        new QRCode(box, { text: url, width: 208, height: 208, colorDark: '#0c0d10', colorLight: '#ffffff' });
      } catch (e) {
        box.textContent = 'QR code preview unavailable — use the link below';
      }
    } else {
      box.textContent = 'QR code library offline — use the link below';
      box.style.cssText += 'color:#0c0d10;font-size:.85rem;text-align:center;padding:16px;';
    }
  }, 30);
}

/* ================= Firebase / Cloud Sync Settings Modal ================= */
function openFirebaseSettingsModal() {
  var effective = getEffectiveFirebaseConfig();
  var isSavedInStorage = false;
  try { isSavedInStorage = !!(storage && storage.getItem('bbteam.firebase_config')); } catch (e) {}

  var statusBadge = effective
    ? h('div', { class: 'status-pill online', text: '🟢 Connected to project: ' + effective.projectId })
    : h('div', { class: 'status-pill offline', text: '⚪ Local Mode (No Firebase connected)' });

  var textarea = h('textarea', {
    class: 'cfg-textarea',
    placeholder: 'Paste your Firebase configuration snippet or JSON here...\nExample:\n{\n  "apiKey": "AIzaSy...",\n  "databaseURL": "https://...-rtdb.firebaseio.com",\n  "projectId": "..."\n}'
  });

  if (isSavedInStorage && effective) {
    try { textarea.value = JSON.stringify(effective, null, 2); } catch (e) {}
  }

  var guide = h('div', { class: 'cfg-guide' }, [
    h('div', { style: 'font-weight:700;color:var(--text);margin-bottom:4px;', text: 'How to get live 2-phone sync (100% free):' }),
    h('ol', null, [
      h('li', null, ['Go to ', h('b', { text: 'console.firebase.google.com' }), ' and create a project.']),
      h('li', null, ['Click the Web icon ', h('code', { text: '</>' }), ' to add a web app and copy the config.']),
      h('li', null, ['Go to ', h('b', { text: 'Realtime Database' }), ', create database, and paste rules from ', h('code', { text: 'database.rules.json' }), '.']),
      h('li', null, ['Paste your config above and tap Save & Connect.'])
    ])
  ]);

  var body = h('div', null, [
    statusBadge,
    h('p', { style: 'font-size:.84rem;color:var(--muted);text-align:left;margin-bottom:6px;', text: 'Paste your Firebase keys below to sync live across devices. (Local matches work without Firebase).' }),
    textarea,
    guide
  ]);

  var actions = [
    {
      label: 'Save & Connect Cloud Sync',
      cls: 'primary',
      fn: function () {
        var raw = textarea.value.trim();
        if (!raw) {
          toast('Please paste your Firebase configuration');
          return;
        }
        var parsed = parsePastedFirebaseConfig(raw);
        if (!parsed) {
          toast('Invalid configuration format — make sure apiKey and projectId are present');
          return;
        }
        try {
          if (storage) storage.setItem('bbteam.firebase_config', JSON.stringify(parsed));
        } catch (e) {}
        
        var ok = initFirebase();
        if (ok) {
          toast('Firebase connected successfully!');
          renderSyncBar();
          // If match is active, sync it to Firebase
          if (cur && matchId) {
            matchRef = fbdb.ref('matches/' + matchId);
            matchRef.set(cur).then(subscribeFirebaseMatch).catch(function () {});
          }
        } else {
          toast('Firebase init failed — check your credentials and internet');
        }
      }
    }
  ];

  if (isSavedInStorage || isFbActive) {
    actions.push({
      label: 'Revert to Local Mode',
      cls: 'danger',
      fn: function () {
        try { if (storage) storage.removeItem('bbteam.firebase_config'); } catch (e) {}
        fbdb = null;
        isFbActive = false;
        updateCloudIcon();
        renderSyncBar();
        toast('Reverted to Local Mode');
      }
    });
  }

  actions.push({ label: 'Close' });

  openModal('Cloud Sync Setup', null, body, actions);
}

/* ================= End Match / History ================= */
function confirmEnd() {
  if (!cur.log.length) { toast('Score a few points before ending the match'); return; }
  var body = h('div', { class: 'm-final' }, [
    h('div', { class: 'home-c' }, [h('div', { class: 'sc', text: String(team('home').score) }), h('div', { class: 'nm', text: nm('home') })]),
    h('div', { class: 'dash', text: '–' }),
    h('div', { class: 'guest-c' }, [h('div', { class: 'sc', text: String(team('guest').score) }), h('div', { class: 'nm', text: nm('guest') })])
  ]);
  var hs = team('home').score, gs = team('guest').score;
  var msg = hs === gs ? 'Scores are level — you can keep playing or save it as a tie.' : (hs > gs ? nm('home') : nm('guest')) + ' is ahead. Saving records the final score on this device.';
  openModal('End Game ' + cur.no + '?', msg, body, [
    { label: 'Save and start Game ' + (cur.no + 1), cls: 'primary', fn: saveMatch },
    { label: 'Keep playing' }
  ]);
}

function rosterSnapshot(side) {
  var t = team(side), out = [];
  for (var pid in t.players) out.push({ name: t.players[pid].name, points: t.players[pid].points });
  out.sort(function (a, b) { return b.points - a.points; });
  return out;
}

function saveMatch() {
  if (cur.clock.running) { cur.clock.elapsed = clockElapsed(); cur.clock.running = false; }
  var rec = {
    no: cur.no, endedAt: Date.now(), duration: cur.clock.elapsed,
    home: { name: nm('home'), score: team('home').score, roster: rosterSnapshot('home') },
    guest: { name: nm('guest'), score: team('guest').score, roster: rosterSnapshot('guest') }
  };
  games.push(rec); persistGamesLocal();
  var hp = team('home').slots.map(function (id) { return team('home').players[id].name; });
  var gp = team('guest').slots.map(function (id) { return team('guest').players[id].name; });
  cur = newMatch(nm('home'), hp, nm('guest'), gp);
  commit(); renderAll(); burst(); haptic(120);
  toast('Game ' + rec.no + ' saved to this device\u2019s History');
}

function confirmDelete(g) {
  openModal('Delete Game ' + g.no + '?', g.home.name + ' ' + g.home.score + ' – ' + g.guest.score + ' ' + g.guest.name + '. This can\u2019t be undone.', null, [
    { label: 'Delete game', cls: 'danger', fn: function () { games = games.filter(function (x) { return !(x.no === g.no && x.endedAt === g.endedAt); }); persistGamesLocal(); renderHistory(); toast('Game ' + g.no + ' deleted'); } },
    { label: 'Cancel' }
  ]);
}

function confirmClearAll() {
  openModal('Clear all history?', 'Every saved game on this device will be removed.', null, [
    { label: 'Clear everything', cls: 'danger', fn: function () { games = []; persistGamesLocal(); renderHistory(); toast('History cleared'); } },
    { label: 'Cancel' }
  ]);
}

function burst() {
  for (var i = 0; i < 16; i++) {
    var ang = Math.random() * Math.PI * 2, dist = 90 + Math.random() * 160;
    var s = h('span', { class: 'spark', style: '--dx:' + Math.round(Math.cos(ang) * dist) + 'px;--dy:' + Math.round(Math.sin(ang) * dist - 40) + 'px;animation-delay:' + Math.round(Math.random() * 100) + 'ms;background:' + (i % 2 ? 'var(--home)' : 'var(--guest)') });
    document.body.appendChild(s); s.addEventListener('animationend', function () { this.remove(); });
  }
}

/* ================= history view ================= */
function gameCard(g, idx) {
  var log = h('div', { class: 'rosterlist' });
  var toggle = h('button', { class: 'mc-toggle', onclick: function () { var open = log.classList.toggle('open'); toggle.classList.toggle('open', open); log.style.display = open ? 'grid' : 'none'; } }, [h('span', { text: 'Player points' }), h('span', { class: 'arrow', text: '▾' })]);
  log.style.display = 'none';
  ['home', 'guest'].forEach(function (side) {
    g[side].roster.forEach(function (p, i) {
      log.appendChild(h('div', { class: 'rl-row' + (i === 0 && p.points > 0 ? ' top' : '') }, [h('span', { class: 'n', text: p.name + ' · ' + g[side].name }), h('span', { class: 'p', text: String(p.points) })]));
    });
  });
  return h('article', { class: 'mcard', style: 'animation-delay:' + Math.min(idx, 8) * 60 + 'ms' }, [
    h('div', { class: 'mc-head' }, [
      h('span', { class: 'mc-no', text: 'Game ' + g.no }),
      h('span', { class: 'mc-date', text: fmtDate(g.endedAt) }),
      h('button', { class: 'mc-del', text: '🗑', onclick: function () { confirmDelete(g); } })
    ]),
    h('div', { class: 'mc-score' }, [
      h('div', { class: 'home-c' }, [h('div', { class: 'sc', text: String(g.home.score) }), h('div', { class: 'nm', text: g.home.name })]),
      h('span', { class: 'mid', text: g.home.score === g.guest.score ? 'TIE' : 'FINAL' }),
      h('div', { class: 'guest-c' }, [h('div', { class: 'sc', text: String(g.guest.score) }), h('div', { class: 'nm', text: g.guest.name })])
    ]),
    toggle, log
  ]);
}

function renderHistory() {
  var sum = $('h-summary'); sum.textContent = '';
  var list = $('h-list'); list.textContent = '';
  if (!games.length) {
    list.appendChild(h('div', { class: 'empty' }, [h('div', { class: 'big', text: '📋' }), h('h3', { text: 'No saved games yet' }), h('p', { text: 'End a match from the Live tab and its final score will show up here.' })]));
    return;
  }
  var topScore = 0, totalPoints = 0;
  games.forEach(function (g) { totalPoints += g.home.score + g.guest.score; topScore = Math.max(topScore, g.home.score, g.guest.score); });
  [[games.length, 'Games saved'], [totalPoints, 'Total points'], [topScore, 'Top team score']].forEach(function (s) { sum.appendChild(h('div', { class: 'stat' }, [h('b', { text: String(s[0]) }), h('span', { text: s[1] })])); });
  games.slice().reverse().forEach(function (g, i) { list.appendChild(gameCard(g, i)); });
  list.appendChild(h('button', { class: 'clear-all', text: 'Clear all history', onclick: confirmClearAll }));
}

/* ================= nav ================= */
function showView(name) {
  currentView = name;
  ['landing', 'joining', 'setup', 'live', 'history'].forEach(function (v) { var el = $('view-' + v); if (el) el.classList.toggle('active', v === name); });
  ['live', 'history'].forEach(function (v) { var t = $('tab-' + v); if (t) t.classList.toggle('active', v === name); });
  window.scrollTo(0, 0);
  if (name === 'history') renderHistory();
  renderSyncBar();
}
Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.addEventListener('click', function () { showView(b.getAttribute('data-view')); }); });

function renderAll() {
  renderRosterHeaderLabels();
  renderTeamHeader('home'); renderTeamHeader('guest');
  renderClock();
  setActiveSide(activeSide);
}

/* ================= wiring ================= */
$('btn-end').addEventListener('click', confirmEnd);
$('btn-discard').addEventListener('click', function () {
  openModal('Reset this match?', 'Score, points and the clock go back to zero for both players. This cannot be undone.', null, [
    { label: 'Reset to 0–0', cls: 'danger', fn: function () {
      var hp = team('home').slots.map(function (id) { return team('home').players[id].name; });
      var gp = team('guest').slots.map(function (id) { return team('guest').players[id].name; });
      cur = newMatch(nm('home'), hp, nm('guest'), gp); commit(); renderAll(); toast('Match reset');
    } },
    { label: 'Cancel' }
  ]);
});
$('btn-undo').addEventListener('click', undoLast);
$('btn-settings').addEventListener('click', openSettings);
$('btn-invite').addEventListener('click', openInviteModal);
$('clock-toggle').addEventListener('click', toggleClock);
$('clock-reset').addEventListener('click', resetClock);

var btnCloud = $('btn-cloud');
if (btnCloud) {
  btnCloud.addEventListener('click', openFirebaseSettingsModal);
}

var btnJoinCode = $('btn-join-code');
var inputJoinCode = $('su-join-code');
if (btnJoinCode && inputJoinCode) {
  btnJoinCode.addEventListener('click', function () {
    var c = inputJoinCode.value.trim().toUpperCase();
    if (!c || c.length !== 6) {
      toast('Please enter a 6-character match code');
      return;
    }
    tryJoin(c);
  });
  inputJoinCode.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') btnJoinCode.click();
  });
}

/* ================= init / routing ================= */
initFirebase();

var idFromUrl = getMatchIdFromUrl();
if (idFromUrl) {
  tryJoin(idFromUrl.toUpperCase());
} else {
  showView('landing');
}
})();
