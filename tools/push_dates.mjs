/* push_dates.mjs — ★잠근 항 검사: "오늘의 판은 ★어떤 날짜에도 존재한다".
 *
 * 날짜 1년치를 전수로 돌려 ①판이 나오는가 ②그 판이 ★정말 풀리는가(★독립 계기 전방 BFS)
 * ③생성기가 말한 최소 수와 ★같은가 ④예비 판을 몇 번 썼는가 를 잰다.
 *
 * ★예비 판 가지를 ★실제로 밟는다: SEED_TRIES 를 1 로 낮춘 하네스 판을 따로 돌린다.
 * ★제품에 훅을 뚫지 않는다 — 상수를 ★밖에서 주입할 뿐이다(제품 코드는 그대로다).
 *
 * 종료코드: 0 = 모든 날짜에 판이 있고 전부 풀리고 두 계기가 일치 · 1 = 미달
 *          · 2 = ★두 계기가 갈렸다(판정 불가)
 */
import { CFG, dailyBoard, FALLBACK_ROWS, FALLBACK_MIN_PUSHES, parseBoard } from './push_gen.mjs';
import { solveMinPushes } from './push_solver.mjs';

const pad = (v, n) => String(v).padEnd(n);
const YEAR = Number(process.argv[2] || 2027);          /* 기본 2027 · 윤년은 따로 준다 */

function datesOf(year) {
  const out = [];
  const d = new Date(Date.UTC(year, 0, 1));
  while (d.getUTCFullYear() === year) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
/* ※ 여기서 Date 를 쓰는 것은 ★검사 도구가 날짜 목록을 만들기 위해서다.
   ★생성기는 날짜 ★문자열만 받는다 — 제품이 시계를 읽는 것과 다르다. */

const dates = datesOf(YEAR);
let missing = 0, unsolved = 0, mismatch = 0, fallbackUsed = 0;
const attemptHist = new Map(), pushHist = new Map(), boxHist = new Map();
const bad = [];

const t0 = Date.now();
for (const ds of dates) {
  const b = dailyBoard(ds);
  if (!b || !b.boxes || !b.boxes.length) { missing++; bad.push([ds, '판 없음']); continue; }
  if (b.usedFallback) fallbackUsed++;
  attemptHist.set(b.attempts, (attemptHist.get(b.attempts) || 0) + 1);
  pushHist.set(b.minPushes, (pushHist.get(b.minPushes) || 0) + 1);
  boxHist.set(b.nBoxes, (boxHist.get(b.nBoxes) || 0) + 1);

  const fwd = solveMinPushes(b.wall, b.boxes, b.player, b.goals, CFG);
  if (fwd < 0) { unsolved++; bad.push([ds, '전방 BFS 가 못 풀었다']); }
  else if (fwd !== b.minPushes) { mismatch++; bad.push([ds, '역 ' + b.minPushes + ' vs 전 ' + fwd]); }
}
const ms = Date.now() - t0;

console.log('==== 잠근 항 검사: 오늘의 판은 ★어떤 날짜에도 존재한다 (%d년 %d일 전수) ====', YEAR, dates.length);
console.log('  ★판이 없는 날            %d', missing);
console.log('  ★못 푸는 판              %d', unsolved);
console.log('  ★두 계기 불일치          %d', mismatch);
console.log('  예비 판을 쓴 날          %d (기본 SEED_TRIES=%d)', fallbackUsed, CFG.SEED_TRIES);
console.log('  걸린 시간 %dms (날짜당 %sms)', ms, (ms / dates.length).toFixed(1));
console.log('');
console.log('  시도 횟수 분포: ' + [...attemptHist.keys()].sort((a, b) => a - b)
  .map(k => k + '회 ' + attemptHist.get(k) + '일').join(' · '));
console.log('  상자 수 분포:   ' + [...boxHist.keys()].sort((a, b) => a - b)
  .map(k => k + '개 ' + boxHist.get(k) + '일').join(' · '));
console.log('  최소 밀기 분포:');
for (const d of [...pushHist.keys()].sort((a, b) => a - b)) {
  console.log('    ' + pad(d, 6) + pad(pushHist.get(d), 6) +
    '#'.repeat(Math.max(1, Math.round(pushHist.get(d) / dates.length * 200))));
}
for (const [ds, why] of bad.slice(0, 10)) console.log('  ★문제 %s: %s', ds, why);

/* ── ★예비 판 가지를 실제로 밟는다(하네스가 상수를 낮춘다) ─────────── */
console.log('');
console.log('==== ★예비 판 가지 — 안 밟히는 가지로 두지 않는다 ====');
const forced = dailyBoard('2027-01-01', { ...CFG, SEED_TRIES: 1, MIN_PUSHES: 9999 });
const fbSolve = solveMinPushes(forced.wall, forced.boxes, forced.player, forced.goals, CFG);
const declared = FALLBACK_MIN_PUSHES;
console.log('  하네스: SEED_TRIES=1 · 띠를 불가능하게(MIN_PUSHES=9999) → 예비 판으로 떨어지는가: %s',
  forced.usedFallback);
console.log('  예비 판을 ★독립 계기로 풀었다: 최소 %d밀기 (소스 선언 %d) · 일치: %s',
  fbSolve, declared, fbSolve === declared);
console.log('  예비 판 모양(소스에 박힌 %d줄):', FALLBACK_ROWS.length);
for (const r of FALLBACK_ROWS) console.log('    ' + r);
const fbParsed = parseBoard(FALLBACK_ROWS, CFG);
console.log('  예비 판 상자 %d · 목표 %d · 사람 위치 %d', fbParsed.boxes.length, fbParsed.goals.length, fbParsed.player);

const fbOk = forced.usedFallback && fbSolve === declared;
if (mismatch || (!fbOk && fbSolve > 0 && fbSolve !== declared)) {
  console.error('★판정 불가 — 두 계기가 갈렸다(예비 판 포함).'); process.exit(2);
}
if (missing || unsolved || !fbOk) {
  console.error('★미달 — 판 없는 날 %d · 못 푸는 판 %d · 예비 판 가지 %s',
    missing, unsolved, fbOk ? 'OK' : '★안 밟혔거나 값이 틀렸다');
  process.exit(1);
}
process.exit(0);
