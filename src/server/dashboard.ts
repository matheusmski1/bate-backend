export const DASHBOARD_HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Batinho · Mesa de Controle</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bowlby+One&family=Caveat:wght@600&family=Fredoka:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --cream: #f0e3c0; --paper: #fff5d1; --ink: #1a0e08; --ink-60: rgba(26,14,8,.6); --ink-35: rgba(26,14,8,.32);
    --red: #d63232; --red-deep: #8b1a1a; --gold: #ffb81c; --green: #4a7c4f; --teal: #2c8a9c; --silver: #cdbf9a;
    --hard: 5px 5px 0 var(--ink); --hard-sm: 3px 3px 0 var(--ink);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; color: var(--ink); font-family: 'Fredoka', system-ui, sans-serif; font-weight: 500;
    background-color: var(--cream);
    background-image: radial-gradient(circle at center, rgba(26,14,8,.05) 1.2px, transparent 1.3px);
    background-size: 20px 20px;
  }
  .wrap { max-width: 1280px; margin: 0 auto; padding: 22px 26px 60px; }

  header { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 26px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 46px; height: 46px; border-radius: 14px; background: var(--gold); border: 2.5px solid var(--ink);
    box-shadow: var(--hard-sm); display: grid; place-items: center; font-size: 24px; transform: rotate(-4deg);
  }
  h1 { font-family: 'Bowlby One', sans-serif; font-weight: 400; font-size: 26px; margin: 0; letter-spacing: .5px; }
  h1 .sub { display: block; font-family: 'Caveat', cursive; font-size: 17px; color: var(--red-deep); transform: rotate(-2deg); margin-top: -4px; }
  header .right { margin-left: auto; display: flex; align-items: center; gap: 12px; }
  button {
    font-family: 'Fredoka', sans-serif; font-weight: 600; font-size: 13px; cursor: pointer;
    background: var(--paper); color: var(--ink); border: 2.5px solid var(--ink); border-radius: 10px;
    padding: 8px 14px; box-shadow: var(--hard-sm); transition: transform .12s ease, box-shadow .12s ease; min-height: 40px;
  }
  button:hover { transform: translate(-1px,-1px); box-shadow: 4px 4px 0 var(--ink); }
  button:active { transform: translate(2px,2px); box-shadow: 1px 1px 0 var(--ink); }
  button:focus-visible { outline: 3px solid var(--gold); outline-offset: 2px; }
  .live {
    display: flex; align-items: center; gap: 8px; background: var(--red); color: #fff7e6;
    border: 2.5px solid var(--ink); border-radius: 10px; padding: 8px 14px; box-shadow: var(--hard-sm);
    font-weight: 700; font-size: 13px; letter-spacing: .5px;
  }
  .live .dot { width: 9px; height: 9px; border-radius: 50%; background: #fff7e6; }
  @media (prefers-reduced-motion: no-preference) { .live .dot { animation: blink 1.3s steps(1) infinite; } }
  @keyframes blink { 50% { opacity: .25; } }

  .kpis { display: grid; grid-template-columns: repeat(6, 1fr); gap: 14px; margin-bottom: 30px; }
  .kpi { background: var(--paper); border: 2.5px solid var(--ink); border-radius: 16px; box-shadow: var(--hard); padding: 14px 16px; position: relative; overflow: hidden; }
  .kpi .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .6px; color: var(--ink-60); }
  .kpi .num { font-family: 'Bowlby One', sans-serif; font-weight: 400; font-size: 30px; line-height: 1.1; margin-top: 6px; font-variant-numeric: tabular-nums; }
  .kpi .num small { font-family: 'Fredoka'; font-size: 13px; font-weight: 500; color: var(--ink-60); }
  .kpi.accent-red { background: var(--red); color: #fff7e6; } .kpi.accent-red .label, .kpi.accent-red .num small { color: rgba(255,247,230,.75); }
  .kpi.accent-gold { background: var(--gold); }
  .spark { width: 100%; height: 26px; margin-top: 6px; display: block; }

  .section-title { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; }
  .section-title h2 { font-family: 'Bowlby One', sans-serif; font-weight: 400; font-size: 18px; margin: 0; letter-spacing: .5px; }
  .section-title .rule { flex: 1; height: 3px; background: var(--ink); border-radius: 2px; }
  .section-title .count { background: var(--ink); color: var(--paper); font-weight: 700; font-size: 13px; border-radius: 8px; padding: 3px 10px; }

  .rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(310px, 1fr)); gap: 16px; margin-bottom: 36px; }
  .room { background: var(--paper); border: 2.5px solid var(--ink); border-radius: 16px; box-shadow: var(--hard); padding: 14px; }
  .room.paused { opacity: .7; }
  .room-top { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 12px; }
  .room-name { font-weight: 700; font-size: 16px; line-height: 1.2; }
  .room-id { font-family: 'Caveat', cursive; font-size: 15px; color: var(--ink-60); }
  .badge { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; border: 2px solid var(--ink); border-radius: 999px; padding: 3px 9px; white-space: nowrap; }
  .room-meta { margin-left: auto; text-align: right; }
  .room-meta .rnd { font-size: 11px; color: var(--ink-60); font-weight: 600; }
  .room-meta .timer { font-family: 'Bowlby One'; font-size: 17px; font-variant-numeric: tabular-nums; }
  .players { display: flex; flex-direction: column; gap: 7px; }
  .pl { display: flex; align-items: center; gap: 10px; padding: 6px; border-radius: 10px; border: 2px solid transparent; }
  .pl.turn { border-color: var(--ink); background: #fff; box-shadow: var(--hard-sm); }
  .pl.off { opacity: .5; }
  .ava { width: 30px; height: 30px; border-radius: 9px; border: 2px solid var(--ink); display: grid; place-items: center; font-family: 'Bowlby One'; font-size: 13px; color: var(--ink); flex-shrink: 0; }
  .pl .pname { font-weight: 600; font-size: 14px; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: flex; align-items: center; gap: 6px; }
  .conn { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .conn.on { background: var(--green); } .conn.off { background: var(--silver); }
  .pl .score { font-family: 'Bowlby One'; font-size: 15px; font-variant-numeric: tabular-nums; }
  .pl .vez { font-size: 10px; font-weight: 700; color: var(--red-deep); text-transform: uppercase; }
  .room-foot { display: flex; align-items: center; gap: 10px; margin-top: 11px; padding-top: 10px; border-top: 2px dashed var(--ink-35); font-size: 12px; color: var(--ink-60); }
  .turnbar { flex: 1; height: 8px; border: 2px solid var(--ink); border-radius: 999px; overflow: hidden; background: var(--cream); }
  .turnbar > span { display: block; height: 100%; background: var(--green); }
  .turnbar.low > span { background: var(--red); }

  table { width: 100%; border-collapse: separate; border-spacing: 0; background: var(--paper); border: 2.5px solid var(--ink); border-radius: 16px; box-shadow: var(--hard); overflow: hidden; }
  th, td { text-align: right; padding: 10px 16px; font-variant-numeric: tabular-nums; font-size: 14px; }
  th { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: var(--ink-60); border-bottom: 2.5px solid var(--ink); background: var(--cream); }
  td:first-child, th:first-child { text-align: left; font-variant-numeric: normal; font-weight: 700; }
  tbody tr + tr td { border-top: 2px dashed var(--ink-35); }
  .ms.ok { color: var(--green); } .ms.warn { color: #b07d00; } .ms.bad { color: var(--red); font-weight: 700; }
  .err.has { color: var(--red); font-weight: 700; }
  .empty { grid-column: 1/-1; text-align: center; padding: 40px; color: var(--ink-60); font-family: 'Caveat'; font-size: 22px; }
  .legend { color: var(--ink-60); font-size: 12px; margin-top: 14px; }
  .legend b { color: var(--ink); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <div class="logo">🐿️</div>
      <h1>BATINHO<span class="sub">mesa de controle</span></h1>
    </div>
    <div class="right">
      <button id="pause" aria-pressed="false">⏸ Pausar</button>
      <span class="live"><span class="dot" id="dot"></span><span id="status">CONECTANDO…</span></span>
    </div>
  </header>

  <div class="kpis">
    <div class="kpi accent-gold"><div class="label">Salas ativas</div><div class="num" id="rooms">—</div></div>
    <div class="kpi"><div class="label">Jogadores</div><div class="num" id="players">—</div></div>
    <div class="kpi accent-red">
      <div class="label">Eventos/s</div><div class="num" id="eps">—</div>
      <svg class="spark" id="spark" viewBox="0 0 100 26" preserveAspectRatio="none" role="img" aria-label="tendencia de eventos por segundo">
        <polyline id="sparkline" fill="none" stroke="#fff7e6" stroke-width="2" vector-effect="non-scaling-stroke" points="" />
      </svg>
    </div>
    <div class="kpi"><div class="label">Rodada média</div><div class="num" id="avground">—</div></div>
    <div class="kpi"><div class="label">Broadcasts</div><div class="num" id="bcast">—</div></div>
    <div class="kpi"><div class="label">No ar há</div><div class="num" id="uptime">—</div></div>
  </div>

  <div class="section-title">
    <h2>SALAS AO VIVO</h2>
    <span class="rule"></span>
    <span class="count" id="roomcount">0</span>
  </div>
  <div class="rooms" id="roomgrid"><div class="empty">acendendo o boteco…</div></div>

  <div class="section-title">
    <h2>EVENTOS</h2>
    <span class="rule"></span>
  </div>
  <table>
    <thead><tr><th>Evento</th><th>Total</th><th>Erros</th><th>p50</th><th>p95</th><th>max</th></tr></thead>
    <tbody id="rows"><tr><td colspan="6" class="empty" style="font-family:Fredoka;font-size:14px">aguardando…</td></tr></tbody>
  </table>
  <p class="legend">Atualiza a cada 1s · <code>GET /health/dashboard</code> · p95 acima de <b>200ms</b> = <span class="ms bad">● alto</span> · perto = <span class="ms warn">▲ atenção</span></p>
</div>

<script>
  var BUDGET = 200, TURN_REF = 60;
  var prevTotal = null, prevAt = null, paused = false;
  var epsHistory = [];
  var PHASES = {
    'waiting': ['aguardando', '#cdbf9a'], 'initial-peek': ['espiada', '#2c8a9c'],
    'playing': ['jogando', '#4a7c4f'], 'effect-pending': ['efeito', '#ffb81c'],
    'bate-called': ['BATE!', '#d63232'], 'round-end': ['fim rodada', '#ffb81c'], 'match-end': ['fim jogo', '#1a0e08']
  };
  var AVA = ['#ffb81c', '#d63232', '#4a7c4f', '#2c8a9c', '#8b1a1a', '#b07d00'];

  function fmtClock(sec) {
    if (sec < 0) sec = 0;
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function fmtUptime(s) { return s < 60 ? s + 's' : s < 3600 ? Math.floor(s/60)+'m '+(s%60)+'s' : Math.floor(s/3600)+'h '+Math.floor((s%3600)/60)+'m'; }
  function esc(t) { return String(t).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function avaColor(name) { var h = 0; for (var i=0;i<name.length;i++) h = name.charCodeAt(i) + ((h<<5)-h); return AVA[Math.abs(h) % AVA.length]; }
  function statusClass(ms) { return ms === 0 ? '' : ms < BUDGET/2 ? 'ok' : ms < BUDGET ? 'warn' : 'bad'; }
  function statusMark(ms) { return ms < BUDGET ? (ms >= BUDGET/2 ? '▲ ' : '') : '● '; }

  function renderSpark() {
    if (epsHistory.length < 2) return;
    var max = Math.max.apply(null, epsHistory.concat([1])), n = epsHistory.length, pts = [];
    for (var i=0;i<n;i++) { pts.push(((i/(n-1))*100).toFixed(1) + ',' + (26 - (epsHistory[i]/max)*24 - 1).toFixed(1)); }
    document.getElementById('sparkline').setAttribute('points', pts.join(' '));
  }

  function renderRoom(r, now) {
    var ph = PHASES[r.phase] || [r.phase, '#cdbf9a'];
    var elapsed = r.roundStartedAt ? Math.floor((now - r.roundStartedAt)/1000) : null;
    var remain = r.turnDeadlineAt ? Math.max(0, Math.round((r.turnDeadlineAt - now)/1000)) : null;
    var pct = remain !== null ? Math.min(100, (remain/TURN_REF)*100) : 0;
    var players = r.players.map(function(p) {
      var ini = (p.name || '?').trim().charAt(0).toUpperCase() || '?';
      return '<div class="pl' + (p.isTurn ? ' turn' : '') + (p.connected ? '' : ' off') + '">' +
        '<div class="ava" style="background:' + avaColor(p.name||'?') + '">' + esc(ini) + '</div>' +
        '<div class="pname"><span class="conn ' + (p.connected ? 'on' : 'off') + '"></span>' + esc(p.name||'?') +
          (p.isTurn ? ' <span class="vez">● vez</span>' : '') + '</div>' +
        '<div class="score">' + p.score + '</div></div>';
    }).join('');
    return '<div class="room' + (r.paused ? ' paused' : '') + '">' +
      '<div class="room-top">' +
        '<div><div class="room-name">' + esc(r.name) + '</div><div class="room-id">#' + esc(r.roomId) + '</div></div>' +
        '<div class="room-meta"><div class="rnd">RODADA ' + r.roundNumber + '</div>' +
          '<div class="timer">' + (elapsed !== null ? fmtClock(elapsed) : '—') + '</div></div>' +
      '</div>' +
      '<div style="margin-bottom:10px"><span class="badge" style="background:' + ph[1] + ';color:' + (r.phase==='match-end'||r.phase==='initial-peek'||r.phase==='playing'||r.phase==='bate-called' ? '#fff7e6':'#1a0e08') + '">' + ph[0] + (r.paused ? ' · pausado':'') + '</span></div>' +
      '<div class="players">' + players + '</div>' +
      '<div class="room-foot">' +
        (remain !== null
          ? '<span>turno</span><div class="turnbar' + (remain<=10?' low':'') + '"><span style="width:' + pct + '%"></span></div><b style="color:var(--ink)">' + remain + 's</b>'
          : '<span>' + r.players.length + '/' + r.maxPlayers + ' jogadores</span>') +
        (r.spectators ? '<span>· 👁 ' + r.spectators + '</span>' : '') +
      '</div></div>';
  }

  document.getElementById('pause').addEventListener('click', function() {
    paused = !paused;
    var b = document.getElementById('pause');
    b.textContent = paused ? '▶ Retomar' : '⏸ Pausar';
    b.setAttribute('aria-pressed', String(paused));
    document.getElementById('status').textContent = paused ? 'PAUSADO' : 'AO VIVO';
  });

  async function tick() {
    if (paused) return;
    try {
      var r = await fetch('/health/dashboard', { cache: 'no-store' });
      var m = await r.json();
      var now = Date.now();
      document.getElementById('status').textContent = 'AO VIVO';
      document.getElementById('dot').style.background = '#fff7e6';
      document.getElementById('rooms').textContent = (m.totals && m.totals.rooms) || 0;
      document.getElementById('players').textContent = (m.totals && m.totals.players) || 0;
      document.getElementById('avground').innerHTML = (m.rounds && m.rounds.avgSec ? m.rounds.avgSec : 0) + ' <small>s</small>';
      document.getElementById('bcast').textContent = (m.broadcasts || 0).toLocaleString('pt-BR');
      document.getElementById('uptime').textContent = fmtUptime(m.uptimeSec || 0);

      var total = Object.values(m.events || {}).reduce(function(a,e){ return a + e.count; }, 0);
      var eps = 0;
      if (prevTotal !== null && now > prevAt) eps = Math.max(0, Math.round((total - prevTotal) / ((now - prevAt)/1000)));
      prevTotal = total; prevAt = now;
      document.getElementById('eps').innerHTML = eps + ' <small>ev/s</small>';
      epsHistory.push(eps); if (epsHistory.length > 60) epsHistory.shift(); renderSpark();

      var rooms = m.rooms || [];
      document.getElementById('roomcount').textContent = (m.totals && m.totals.rooms) || rooms.length;
      var grid = document.getElementById('roomgrid');
      grid.innerHTML = rooms.length
        ? rooms.map(function(rm){ return renderRoom(rm, now); }).join('')
        : '<div class="empty">nenhuma mesa aberta — bora jogar um Bate?</div>';

      var entries = Object.entries(m.events || {}).sort(function(a,b){ return b[1].count - a[1].count; });
      var tb = document.getElementById('rows');
      tb.innerHTML = entries.length ? entries.map(function(e){ var n=e[0], v=e[1];
        return '<tr><td>' + n + '</td><td>' + v.count.toLocaleString('pt-BR') + '</td>' +
          '<td class="err' + (v.errors?' has':'') + '">' + v.errors + '</td>' +
          '<td class="ms ' + statusClass(v.p50) + '">' + v.p50 + '</td>' +
          '<td class="ms ' + statusClass(v.p95) + '">' + statusMark(v.p95) + v.p95 + '</td>' +
          '<td class="ms ' + statusClass(v.max) + '">' + v.max + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty" style="font-family:Fredoka;font-size:14px">nenhum evento ainda</td></tr>';
    } catch (err) {
      document.getElementById('status').textContent = 'OFFLINE';
      document.getElementById('dot').style.background = '#1a0e08';
    }
  }
  tick();
  setInterval(tick, 1000);
</script>
</body>
</html>`
