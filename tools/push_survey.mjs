/* push_survey.mjs — ★생성기 첫 관문: 씨앗 전수로 난이도 분포를 잰다.
 *
 * ★왜 이것이 UI 보다 먼저인가: 소코반 계열은 ★판 생성기가 곧 게임이다. 분포가 나쁘면
 * (다 쉽거나 다 어렵거나 못 푸는 판이 섞이면) 화면을 아무리 잘 만들어도 게임이 없다.
 *
 * ★두 계기로 따로 잰다:
 *   ① 역방향 BFS 깊이 — 생성기가 판을 만들며 함께 낸 ★최소 밀기 수.
 *   ② ★전방 BFS 풀이기 — 시작 판에서 해답까지 ★따로 푼 최소 밀기 수(이 파일에 ★독립으로 짰다).
 *   두 값이 다르면 그 자리에서 ★멈춘다(rc=2). ★같은 계기로 두 번 재는 것은 대조가 아니다.
 *
 * 종료코드: 0 = 분포를 냈고 대조도 맞았다 · 1 = ★막힌 판·데드락 등 미달이 있다
 *          · 2 = ★두 계기가 갈렸다(판정 불가 — 못 쟀으면 틀렸다고 말할 수 없다)
 */
import { CFG, generate, render, cornerDeadlock } from './push_gen.mjs';
import { solveMinPushes } from './push_solver.mjs';   /* ★독립 계기 — 파일을 갈라 두었다 */

const pad = (v, n) => String(v).padEnd(n);
const padS = (v, n) => String(v).padStart(n);
const N = Number(process.argv[2] || 1000);
const SAMPLE = Number(process.argv[3] || 60);        /* 전방 BFS 로 대조할 표본 수 */

/* ★설정 실험용 덮어쓰기 — 기본값은 push_gen.mjs 의 CFG 다.
   환경변수로만 바꾼다(제품 코드에 실험값이 새지 않게). */
const cfg = { ...CFG };
for (const k of ['W', 'H', 'BOXES', 'INNER_WALL_MAX', 'MIN_PUSHES', 'MAX_PUSHES']) {
  const v = process.env['PUSH_' + k];
  if (v !== undefined) cfg[k] = Number(v);
}

const t0 = Date.now();
const made = [], failed = new Map();
for (let seed = 1; seed <= N; seed++) {
  const b = generate(seed, cfg);
  if (!b.ok) { failed.set(b.why, (failed.get(b.why) || 0) + 1); continue; }
  made.push(b);
}
const genMs = Date.now() - t0;

/* ── 미달 셋을 ★따로 센다(합치지 않는다) ─────────────────────────── */
let startDeadlock = 0, unsolved = 0, mismatch = 0;
const mismatchRows = [];
for (const b of made) if (cornerDeadlock(b.wall, b.boxes, b.goals, cfg)) startDeadlock++;

const step = Math.max(1, Math.floor(made.length / SAMPLE));
const checked = [];
const t1 = Date.now();
for (let i = 0; i < made.length; i += step) {
  const b = made[i];
  const fwd = solveMinPushes(b.wall, b.boxes, b.player, b.goals, cfg);
  checked.push({ seed: b.seed, rev: b.minPushes, fwd });
  if (fwd < 0) unsolved++;
  else if (fwd !== b.minPushes) { mismatch++; mismatchRows.push({ seed: b.seed, rev: b.minPushes, fwd }); }
}
const chkMs = Date.now() - t1;

/* ── 분포 표 ───────────────────────────────────────────────────────── */
const hist = new Map();
for (const b of made) hist.set(b.minPushes, (hist.get(b.minPushes) || 0) + 1);
const depths = made.map(b => b.minPushes).sort((a, b) => a - b);
const q = p => depths.length ? depths[Math.min(depths.length - 1, Math.floor(p * depths.length))] : 0;

console.log('==== 「밀어서 정리」 생성기 전수 조사 ====');
console.log('씨앗 %d개 · 판 %d개 생성 · 버린 씨앗 %d개 · 생성 시간 %dms (판당 %sms)',
  N, made.length, N - made.length, genMs, (genMs / Math.max(1, made.length)).toFixed(1));
console.log('설정: 방 %dx%d · 상자 %d~%d(씨앗이 고른다) · 내부벽 최대 %d · 난이도 띠 %d~%d 밀기',
  cfg.W, cfg.H, cfg.BOX_MIN, cfg.BOX_MAX, cfg.INNER_WALL_MAX, cfg.MIN_PUSHES, cfg.MAX_PUSHES);
if (failed.size) {
  console.log('★버린 이유(합치지 않고 따로 센다):');
  for (const [why, n] of [...failed].sort((a, b) => b[1] - a[1])) console.log('    ' + pad(why, 30) + n);
}
console.log('');
console.log('최소 밀기 수 분포 (역방향 BFS 깊이 = 정확한 최소값):');
console.log('  ' + pad('밀기', 8) + pad('판 수', 8) + '막대');
for (const d of [...hist.keys()].sort((a, b) => a - b)) {
  const n = hist.get(d);
  console.log('  ' + pad(d, 8) + pad(n, 8) + '#'.repeat(Math.max(1, Math.round(n / Math.max(1, made.length) * 200))));
}
console.log('  중앙값 %d · 25%% %d · 75%% %d · 최소 %d · 최대 %d',
  q(0.5), q(0.25), q(0.75), depths[0] || 0, depths[depths.length - 1] || 0);
const byBox = new Map();
for (const b of made) byBox.set(b.nBoxes, (byBox.get(b.nBoxes) || 0) + 1);
console.log('상자 수 분포: ' + [...byBox.keys()].sort().map(k => k + '개 ' + byBox.get(k) + '판').join(' · '));
console.log('');
console.log('==== ★미달 셋 — 따로 센다 ====');
console.log('  ① ★막힌 판(전방 BFS 가 해를 못 찾음)       ' + padS(unsolved, 4) + ' / 대조 ' + checked.length + '판');
console.log('  ② ★시작 데드락(구석에 박힌 상자)           ' + padS(startDeadlock, 4) + ' / 생성 ' + made.length + '판');
console.log('  ③ ★두 계기 불일치(역 깊이 != 전 깊이)      ' + padS(mismatch, 4) + ' / 대조 ' + checked.length + '판');
for (const r of mismatchRows.slice(0, 10)) console.log('      씨앗 %d: 역 %d vs 전 %d', r.seed, r.rev, r.fwd);
console.log('  대조 시간 %dms · 표본 간격 %d(씨앗 %d개마다 1판)', chkMs, step, step);
console.log('');
console.log('★예시 판 3개(사람이 읽는 형식 · # 벽 · $ 상자 · . 목표 · * 목표 위 상자 · @ 사람):');
for (const b of made.slice(0, 3)) {
  console.log('  — 씨앗 %d · 최소 %d밀기 · 탐색 상태 %d개', b.seed, b.minPushes, b.statesSeen);
  console.log(render(b, cfg).split('\n').map(s => '    ' + s).join('\n'));
}

if (mismatch) { console.error('★판정 불가 — 두 계기가 갈렸다. 분포를 근거로 쓸 수 없다.'); process.exit(2); }
if (unsolved || startDeadlock) { console.error('★미달 — 막힌 판 또는 시작 데드락이 있다.'); process.exit(1); }
process.exit(0);
