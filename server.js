// Requer Node 18+ (usa fetch nativo). Sem dependências externas.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { compute } = require('./model');

const KEY = process.env.API_FOOTBALL_KEY;          // se vazio, corre em modo demo
const MAX_FIXTURES = +process.env.MAX_FIXTURES || 3; // limita pedidos à API
const POLL_MS = (+process.env.POLL_SECONDS || 60) * 1000;
const LEAGUE_IDS = process.env.LEAGUE_IDS || 'all'; // ex.: "94-39" (Liga Portugal, Premier League)
const PORT = +process.env.PORT || 3000;

const matches = new Map(); // id -> { meta, snap, history, probs }

function update(id, meta, snap) {
  const entry = matches.get(id) || { meta, history: [] };
  entry.meta = meta;
  entry.snap = snap;
  entry.probs = compute(snap, entry.history);
  const last = entry.history[entry.history.length - 1];
  if (!last || last.minute !== snap.minute) {
    entry.history.push({ minute: snap.minute, home: { ...snap.home }, away: { ...snap.away } });
  }
  matches.set(id, entry);
}

// ---------- API-Football ----------
async function api(p) {
  const r = await fetch('https://v3.football.api-sports.io' + p, { headers: { 'x-apisports-key': KEY } });
  if (!r.ok) throw new Error('API ' + r.status);
  const j = await r.json();
  return j.response;
}

function stat(teamStats, type) {
  const v = (teamStats?.statistics || []).find(s => s.type === type)?.value;
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

async function pollLive() {
  try {
    const fixtures = (await api('/fixtures?live=' + LEAGUE_IDS))
      .filter(f => f.fixture.status.elapsed != null)
      .slice(0, MAX_FIXTURES);
    const seen = new Set();
    for (const f of fixtures) {
      const id = f.fixture.id;
      seen.add(id);
      const stats = await api('/fixtures/statistics?fixture=' + id);
      const hs = stats.find(s => s.team.id === f.teams.home.id);
      const as = stats.find(s => s.team.id === f.teams.away.id);
      const side = t => ({
        shots: stat(t, 'Total Shots') ?? 0,
        shotsOn: stat(t, 'Shots on Goal') ?? 0,
        xg: stat(t, 'expected_goals'),
        reds: stat(t, 'Red Cards') ?? 0,
      });
      update(id,
        { home: f.teams.home.name, away: f.teams.away.name, league: f.league.name },
        { minute: f.fixture.status.elapsed, goals: { home: f.goals.home ?? 0, away: f.goals.away ?? 0 }, home: side(hs), away: side(as) });
    }
    for (const id of matches.keys()) if (!seen.has(id)) matches.delete(id);
    console.log(new Date().toISOString(), 'jogos ao vivo:', seen.size);
  } catch (e) {
    console.error('Erro no polling:', e.message);
  }
}

// ---------- Modo demo ----------
function startDemo() {
  console.log('Sem API_FOOTBALL_KEY: a correr em modo DEMO (jogo simulado).');
  const sim = {
    minute: 1, goals: { home: 0, away: 0 },
    home: { shots: 0, shotsOn: 0, xg: null, reds: 0 },
    away: { shots: 0, shotsOn: 0, xg: null, reds: 0 },
  };
  const meta = { home: 'Equipa Casa (demo)', away: 'Equipa Fora (demo)', league: 'Simulação' };
  update('demo', meta, sim);
  setInterval(() => {
    if (sim.minute >= 90) return;
    sim.minute += 1;
    for (const side of ['home', 'away']) {
      const bias = side === 'home' ? 1.2 : 0.9;
      if (Math.random() < 0.13 * bias) {
        sim[side].shots += 1;
        if (Math.random() < 0.35) {
          sim[side].shotsOn += 1;
          if (Math.random() < 0.3) sim.goals[side] += 1;
        }
      }
      if (Math.random() < 0.0015) sim[side].reds += 1;
    }
    update('demo', meta, JSON.parse(JSON.stringify(sim)));
  }, 2000);
}

// ---------- HTTP ----------
http.createServer((req, res) => {
  if (req.url === '/api/matches') {
    const out = [...matches.entries()].map(([id, m]) => ({ id, ...m.meta, ...m.snap, probs: m.probs }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ demo: !KEY, matches: out }));
  }
  const file = path.join(__dirname, 'public', 'index.html');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log('http://localhost:' + PORT));

if (KEY) { pollLive(); setInterval(pollLive, POLL_MS); } else { startDemo(); }
