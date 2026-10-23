/**
 * Headless physics benchmark (no DOM, no rendering):
 *   npm run bench:sim
 * Simulates a long session at an aggressive arrival rate and reports step
 * cost, grain counts and bounds violations, to check that cost stays flat.
 */
import { scoreToRadius } from '../shared/impact/radius';
import { createParticle } from '../src/simulation/Particle';
import { PhysicsEngine, DEFAULT_PHYSICS } from '../src/simulation/PhysicsEngine';

const W = Number(process.env.W ?? 1920);
const H = Number(process.env.H ?? 1080);
const MINUTES = Number(process.env.MINUTES ?? 60);
const RATE = Number(process.env.RATE ?? 3); // grains per simulated second (live news is far slower)
const dt = 1 / 60;

const engine = new PhysicsEngine(W, H, { ...DEFAULT_PHYSICS });
engine.setMaxRadius(scoreToRadius(100));

// Score distribution skewed low, as in real data: most news is small.
const randScore = () => Math.min(100, Math.round(-Math.log(1 - Math.random()) * 22));

let acc = 0;
let violations = 0;
const samples: number[] = [];
const report: string[] = [];
const totalFrames = MINUTES * 60 * 60;
const t0 = performance.now();
for (let f = 0; f < totalFrames; f++) {
  acc += RATE * dt;
  while (acc >= 1 && engine.canAcceptActive()) {
    acc--;
    const s = randScore();
    const r = scoreToRadius(s);
    engine.add(createParticle({ eventId: `e${f}`, x: r + Math.random() * (W - 2 * r), y: -r, r, impact: s, critical: s >= 80, bornAt: engine.time, vy: 30 }));
  }
  const a = performance.now();
  engine.step(dt);
  samples.push(performance.now() - a);
  if (f % 600 === 0) {
    for (const p of engine.actives) if (p.x < p.r - 0.5 || p.x > W - p.r + 0.5 || p.y > H + 1) violations++;
  }
  if (f > 0 && f % (60 * 60 * 10) === 0) {
    const recent = samples.slice(-3600).sort((x, y) => x - y);
    report.push(
      `  t=${String(f / 3600).padStart(3)} min  step avg ${(recent.reduce((s, x) => s + x, 0) / recent.length).toFixed(3)} ms  p95 ${recent[Math.floor(recent.length * 0.95)].toFixed(3)} ms  ativos ${engine.actives.length}  depositados ${engine.staticCount}  removidos ${engine.removedCount}  leito ${Math.round(engine.bedHeightPx)} px`,
    );
  }
}
const sorted = samples.sort((x, y) => x - y);
console.log(`Simulação: ${W}×${H}, ${MINUTES} min simulados, ${RATE} grãos/s, wall ${((performance.now() - t0) / 1000).toFixed(1)} s`);
console.log(report.join('\n'));
console.log(`step: média ${(sorted.reduce((s, x) => s + x, 0) / sorted.length).toFixed(3)} ms · p95 ${sorted[Math.floor(sorted.length * 0.95)].toFixed(3)} ms · p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(3)} ms · máx ${sorted[sorted.length - 1].toFixed(2)} ms`);
console.log(`violações de limites: ${violations} · memória heap ${(process.memoryUsage().heapUsed / 1e6).toFixed(1)} MB`);
