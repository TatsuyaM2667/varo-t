/**
 * /admin: usage of the free plan, traffic, and live rooms. Static HTML; the
 * data comes from /admin/api with the ADMIN_TOKEN as a bearer token (kept in
 * this browser's localStorage after the first entry).
 */
export const ADMIN_HTML = /* html */ `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>HALCYON LINE 管理</title>
<style>
  :root {
    --bg: #0d1117; --panel: #161b22; --line: #2a313c; --fg: #e9e6df; --dim: #8b949e;
    --ok: #3fb950; --warn: #e3b341; --bad: #f85149; --atk: #ffb648; --def: #4fd1ff;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 system-ui, "Noto Sans JP", sans-serif; }
  header { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; padding: 20px 24px 8px; }
  h1 { margin: 0; font-size: 20px; letter-spacing: .12em; }
  h1 span { color: var(--atk); }
  h2 { font-size: 13px; letter-spacing: .15em; color: var(--dim); margin: 0 0 12px; font-weight: 600; }
  main { padding: 8px 24px 40px; display: grid; gap: 16px; grid-template-columns: repeat(12, 1fr); max-width: 1280px; }
  section { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; grid-column: span 12; min-width: 0; }
  .half { grid-column: span 6; }
  @media (max-width: 860px) { .half { grid-column: span 12; } main, header { padding-left: 16px; padding-right: 16px; } }
  .meta { color: var(--dim); font-size: 12px; }
  .gauge { margin: 6px 0 14px; }
  .gauge .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .gauge b { font-size: 26px; font-variant-numeric: tabular-nums; }
  .bar { height: 12px; background: #0b0f14; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-top: 6px; }
  .bar i { display: block; height: 100%; background: var(--ok); transition: width .4s; }
  .bar i.warn { background: var(--warn); } .bar i.bad { background: var(--bad); }
  .tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
  .tile { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; }
  .tile b { display: block; font-size: 20px; font-variant-numeric: tabular-nums; }
  .tile span { color: var(--dim); font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--dim); font-weight: 600; font-size: 12px; }
  td.n, th.n { text-align: right; }
  .scroll { overflow-x: auto; }
  .tag { display: inline-block; font-size: 11px; padding: 0 6px; border: 1px solid var(--line); border-radius: 4px; margin-left: 4px; color: var(--dim); }
  .tag.p2p { color: var(--ok); border-color: var(--ok); } .tag.relay { color: var(--warn); border-color: var(--warn); }
  .tag.game { color: var(--atk); border-color: var(--atk); }
  .t0 { color: var(--atk); } .t1 { color: var(--def); }
  .empty { color: var(--dim); padding: 8px 0; }
  svg text { fill: var(--dim); font-size: 10px; }
  .login { max-width: 420px; margin: 12vh auto; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
  .login input { width: 100%; padding: 10px; margin: 12px 0; background: #0b0f14; color: var(--fg); border: 1px solid var(--line); border-radius: 6px; font: inherit; }
  button { background: var(--atk); color: #1a1104; border: 0; border-radius: 6px; padding: 9px 16px; font: inherit; font-weight: 700; cursor: pointer; }
  button.ghost { background: transparent; color: var(--dim); border: 1px solid var(--line); font-weight: 400; padding: 4px 10px; }
  .err { color: var(--bad); }
  .note { color: var(--dim); font-size: 12px; margin-top: 10px; }
  a { color: var(--def); }
</style>
</head>
<body>
<div id="login" class="login" hidden>
  <h1>HALCYON <span>LINE</span> 管理</h1>
  <p class="meta">管理パスワード（ADMIN_TOKEN）を入力してください。このブラウザに保存されます。</p>
  <input id="tok" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
  <button id="go">表示</button> <span id="lerr" class="err"></span>
</div>
<div id="app" hidden>
  <header>
    <h1>HALCYON <span>LINE</span> 管理</h1>
    <span class="meta" id="updated"></span>
    <span style="flex:1"></span>
    <label class="meta"><input type="checkbox" id="auto" checked> 15秒ごとに更新</label>
    <button class="ghost" id="refresh">更新</button>
    <button class="ghost" id="logout">ログアウト</button>
  </header>
  <main>
    <section class="half">
      <h2>今日の無料枠（推定）</h2>
      <div class="gauge"><div class="row"><span>Durable Objects リクエスト</span><b id="doReq">—</b></div><div class="bar"><i id="doBar"></i></div></div>
      <div class="gauge"><div class="row"><span>Worker リクエスト</span><b id="wReq">—</b></div><div class="bar"><i id="wBar"></i></div></div>
      <div class="meta" id="reset"></div>
      <div class="note">上限を超えると、その日は接続できなくなるだけで課金はされません（Free プラン）。WebSocket の受信メッセージは 20 通で 1 リクエスト。直接通信（P2P）のプレイヤー間の入力は数えられません。</div>
    </section>
    <section class="half">
      <h2>今日の通信</h2>
      <div class="tiles" id="tiles"></div>
    </section>
    <section>
      <h2>過去24時間（推定 DO リクエスト / 時）</h2>
      <div class="scroll"><svg id="chart" width="100%" height="160" role="img" aria-label="hourly requests"></svg></div>
    </section>
    <section>
      <h2>稼働中のルーム</h2>
      <div class="scroll" id="rooms"></div>
    </section>
    <section>
      <h2>過去7日間</h2>
      <div class="scroll" id="days"></div>
      <div class="note">数値は中継サーバが自分で数えた推定値です。正確な値は <a href="https://dash.cloudflare.com/?to=/:account/workers/services/view/halcyon-relay/production/metrics" target="_blank" rel="noopener">Cloudflare ダッシュボード</a> で確認できます。日付は UTC（日本時間 9:00 に切り替わり）。</div>
    </section>
  </main>
</div>
<script>
const KEY = 'halcyon.admin.token';
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n || 0).toLocaleString('ja-JP');
const bytes = (n) => n >= 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' MB' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' KB' : (n || 0) + ' B';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const est = (u) => ({ doRequests: u.connects + Math.ceil(u.msgsIn / 20) + u.reports + u.adminCalls, workerRequests: u.connects + u.adminCalls * 2 });
const STAGES = ['バザール', 'テラス', '製鉄所'];
let timer = 0;

function token() { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } }
function setToken(t) { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} }

function showLogin(msg) {
  $('app').hidden = true; $('login').hidden = false; $('lerr').textContent = msg || '';
  clearInterval(timer);
}

async function load() {
  const t = token();
  if (!t) return showLogin();
  let res;
  try { res = await fetch('/admin/api', { headers: { Authorization: 'Bearer ' + t }, cache: 'no-store' }); }
  catch { $('updated').textContent = '取得に失敗しました（ネットワーク）'; return; }
  if (res.status === 401) { setToken(''); return showLogin('パスワードが違います'); }
  if (!res.ok) { showLogin(await res.text()); return; }
  render(await res.json());
  $('login').hidden = true; $('app').hidden = false;
}

function gauge(valId, barId, used, limit) {
  const pct = Math.min(100, used / limit * 100);
  $(valId).textContent = fmt(used) + ' / ' + fmt(limit) + '（' + pct.toFixed(1) + '%）';
  const bar = $(barId); bar.style.width = pct + '%';
  bar.className = pct >= 90 ? 'bad' : pct >= 70 ? 'warn' : '';
}

function render(s) {
  $('updated').textContent = '最終更新 ' + new Date(s.now).toLocaleTimeString('ja-JP');
  gauge('doReq', 'doBar', s.estimate.doRequests, s.limits.doRequests);
  gauge('wReq', 'wBar', s.estimate.workerRequests, s.limits.workerRequests);
  const left = s.nextReset - s.now;
  $('reset').textContent = 'リセットまで ' + Math.floor(left / 3600000) + ' 時間 ' + Math.floor(left / 60000) % 60 + ' 分（' + new Date(s.nextReset).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' }) + '）';
  const u = s.today;
  const players = s.live.reduce((n, r) => n + r.players.length, 0);
  const tiles = [
    [fmt(s.live.length), '稼働中のルーム'], [fmt(players), '接続中のプレイヤー'], [fmt(u.peakPlayers), '同時接続の最大'],
    [fmt(u.matches), '試合数'], [fmt(u.connects), 'WebSocket 接続'], [fmt(u.msgsIn), '受信メッセージ'],
    [fmt(u.msgsOut), '送信メッセージ'], [bytes(u.bytesIn), '受信量'], [bytes(u.bytesOut), '送信量'],
  ];
  $('tiles').innerHTML = tiles.map(([v, l]) => '<div class="tile"><b>' + v + '</b><span>' + l + '</span></div>').join('');
  chart(s.hours);
  rooms(s.live, s.now);
  days(s.days, s.limits);
}

function chart(hours) {
  const svg = $('chart');
  const W = Math.max(480, svg.clientWidth || 800), H = 160, padB = 22, padT = 10, padL = 36;
  const vals = hours.map((h) => est(h.usage).doRequests);
  const max = Math.max(10, ...vals);
  const bw = (W - padL) / vals.length;
  let out = '';
  for (const f of [0, 0.5, 1]) {
    const y = padT + (H - padB - padT) * (1 - f);
    out += '<line x1="' + padL + '" x2="' + W + '" y1="' + y + '" y2="' + y + '" stroke="#2a313c"/><text x="' + (padL - 6) + '" y="' + (y + 3) + '" text-anchor="end">' + fmt(Math.round(max * f)) + '</text>';
  }
  vals.forEach((v, i) => {
    const h = (H - padB - padT) * v / max;
    const x = padL + i * bw + 2;
    out += '<rect x="' + x + '" y="' + (H - padB - h) + '" width="' + Math.max(1, bw - 4) + '" height="' + h + '" rx="2" fill="#4fd1ff"><title>' + hours[i].hour + ':00 UTC — ' + fmt(v) + '</title></rect>';
    if (i % 3 === 0) {
      const jst = (Number(hours[i].hour.slice(-2)) + 9) % 24;
      out += '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + jst + '時</text>';
    }
  });
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = out;
}

function rooms(live, now) {
  if (!live.length) { $('rooms').innerHTML = '<div class="empty">稼働中のルームはありません</div>'; return; }
  const rows = live.map((r) => {
    const mode = r.config.mode === 'versus' ? '対戦' : '協力';
    const ps = r.players.map((p) => {
      const others = r.players.filter((o) => o.slot !== p.slot);
      const direct = others.filter((o) => p.p2p.includes(o.slot) || o.p2p.includes(p.slot)).length;
      const link = others.length ? '<span class="tag ' + (direct === others.length ? 'p2p' : 'relay') + '">直接 ' + direct + '/' + others.length + '</span>' : '';
      return '<div><span class="t' + p.team + '">●</span> ' + esc(p.name) + link + ' <span class="meta">' + (p.rtt ? p.rtt + ' ms' : '') + '</span></div>';
    }).join('');
    const mins = Math.round((now - r.since) / 60000);
    return '<tr><td><b>' + esc(r.code) + '</b></td><td>' + (r.state === 'game' ? '<span class="tag game">試合中</span>' : '<span class="tag">ロビー</span>') + '</td><td>' + mode + ' · ' + (STAGES[r.config.stage] || '') + '</td><td>' + ps + '</td>'
      + '<td class="n">' + fmt(r.traffic.msgsIn) + '</td><td class="n">' + bytes(r.traffic.bytesIn + r.traffic.bytesOut) + '</td><td class="n">' + mins + ' 分</td></tr>';
  }).join('');
  $('rooms').innerHTML = '<table><thead><tr><th>コード</th><th>状態</th><th>モード</th><th>プレイヤー（直接通信の相手数・遅延）</th><th class="n">受信msg</th><th class="n">通信量</th><th class="n">経過</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function days(list, limits) {
  const rows = list.map((d) => {
    const e = est(d.usage);
    return '<tr><td>' + d.day + '</td><td class="n">' + fmt(e.doRequests) + '</td><td class="n">' + (e.doRequests / limits.doRequests * 100).toFixed(1) + '%</td><td class="n">' + fmt(d.usage.matches) + '</td><td class="n">' + fmt(d.usage.connects) + '</td><td class="n">' + fmt(d.usage.msgsIn) + '</td><td class="n">' + bytes(d.usage.bytesIn + d.usage.bytesOut) + '</td><td class="n">' + fmt(d.usage.peakPlayers) + '</td></tr>';
  }).join('');
  $('days').innerHTML = '<table><thead><tr><th>日付 (UTC)</th><th class="n">推定 DO リクエスト</th><th class="n">無料枠</th><th class="n">試合</th><th class="n">接続</th><th class="n">受信msg</th><th class="n">通信量</th><th class="n">同時最大</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

$('go').onclick = () => { setToken($('tok').value.trim()); load(); };
$('tok').onkeydown = (e) => { if (e.key === 'Enter') $('go').click(); };
$('refresh').onclick = load;
$('logout').onclick = () => { setToken(''); showLogin(); };
// each refresh costs a couple of requests: skip while the tab is hidden
const tick = () => { if (!document.hidden) load(); };
$('auto').onchange = () => { clearInterval(timer); if ($('auto').checked) timer = setInterval(tick, 15000); };
timer = setInterval(tick, 15000);
load();
</script>
</body>
</html>`;
