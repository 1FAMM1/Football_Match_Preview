// Modelo v1: processo de Poisson com taxa por minuto ajustada ao que se passa no jogo.
// Tudo aqui é heurístico: ajusta os números e valida com dados reais antes de confiar.

const BASE = { home: 0.0165, away: 0.0125 }; // golos/minuto (≈ 2,6 golos por jogo, com vantagem da casa)
const K = 30;            // "minutos de confiança" no prior; quanto maior, mais lento a reagir ao jogo
const RECENT_WINDOW = 10; // minutos para medir a pressão recente
const RECENT_WEIGHT = 0.3;

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// Se a API der xG usa-o; senão estima a partir dos remates.
function proxyXg(s) {
  if (s.xg != null) return s.xg;
  const off = Math.max(s.shots - s.shotsOn, 0);
  return 0.03 * off + 0.10 * s.shotsOn;
}

function lambda(side, snap, history) {
  const other = side === 'home' ? 'away' : 'home';
  const s = snap[side], o = snap[other];
  const m = Math.max(snap.minute, 1);

  // 1) prior + observado (shrinkage)
  const w = m / (m + K);
  let lam = (1 - w) * BASE[side] + w * (proxyXg(s) / m);

  // 2) pressão recente
  const past = [...history].reverse().find(h => h.minute <= m - RECENT_WINDOW);
  if (past) {
    const span = m - past.minute;
    const rec = (proxyXg(s) - proxyXg(past[side])) / span;
    lam = (1 - RECENT_WEIGHT) * lam + RECENT_WEIGHT * Math.max(rec, 0);
  }

  // 3) estado do marcador: quem perde arrisca mais
  const diff = snap.goals[side] - snap.goals[other];
  lam *= clamp(1 - 0.08 * diff, 0.7, 1.3);

  // 4) cartões vermelhos
  lam *= Math.pow(0.75, s.reds) * Math.pow(1.2, o.reds);

  return Math.max(lam, 0.002);
}

function compute(snap, history) {
  const lh = lambda('home', snap, history);
  const la = lambda('away', snap, history);
  const remaining = Math.max(95 - snap.minute, 3); // inclui um desconto médio
  const pNone = Math.exp(-(lh + la) * remaining);
  const pAny = 1 - pNone;
  return {
    lambdaHome: lh,
    lambdaAway: la,
    remaining,
    home: (lh / (lh + la)) * pAny,
    away: (la / (lh + la)) * pAny,
    none: pNone,
  };
}

module.exports = { compute };
