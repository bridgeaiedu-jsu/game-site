/* push_gen.mjs — 「밀어서 정리」 판 생성기 (★생성기가 곧 게임이다)
 *
 * ★이 파일이 생성기의 ★유일한 정의처다. 제품(/push/index.html)은 이 코드를 그대로 품고,
 * 검사기가 ★두 사본이 같은지 대조한다 — 두 곳에 따로 적으면 그때부터 서로 다른 게임이 된다.
 *
 * ★핵심 설계: ★역방향 생성 + ★역방향 너비우선탐색(BFS).
 *   해답 배치(상자가 전부 목표 위)에서 ★거꾸로 당기며 BFS 하면,
 *   만나는 모든 상태의 ★깊이가 곧 ★그 판을 풀 때 필요한 ★최소 밀기 수다
 *   (당기기는 밀기의 역연산이고, 도달 가능성은 정규화된 상태에서 대칭이다).
 *   ⇒ 판을 만들면서 ★최소 수를 동시에 안다. 나중에 풀이기를 따로 돌릴 필요가 없다.
 *   ⇒ ★해가 없는 판이 원리적으로 안 나온다(해답에서 거꾸로 왔으므로 돌아가는 길이 늘 있다).
 *      ★그래도 믿지 않고 ★전방 BFS 로 따로 재서 대조한다(cross-check.mjs).
 *
 * ★난수 계약(bomb 과 동일):
 *   - ★선굴림: 난수는 ★판을 짤 때 전부 굴린다. 플레이 중 난수 소비 0.
 *   - ★시간 기반 분기 0: 여기서 Date/performance 를 읽지 않는다.
 *   - 같은 씨앗은 같은 판을 준다.
 *
 * 좌표: 인덱스 i = y * W + x. 벽은 바깥 테두리 + 내부 벽 몇 개.
 */

export const CFG = {
  W: 8,            /* 전체 폭(테두리 포함) */
  H: 8,            /* 전체 높이(테두리 포함) */
  BOX_MIN: 2,      /* 상자 수를 ★씨앗이 고른다(2~3) — 난이도 '칸' 대신 ★분포를 넓히는 방법 */
  BOX_MAX: 3,      /* ★상한을 계약으로 잠근다 — 상자 4·방 9x9 는 40씨앗도 120초에 못 끝냈다(실측) */
  INNER_WALL_MAX: 4,
  MIN_PUSHES: 10,  /* 이보다 쉬우면 버린다 */
  MAX_PUSHES: 40,  /* 이보다 어려우면 버린다(한 판 길이 상한) */
  SEED_TRIES: 16,  /* ★날짜 하나에 허용하는 ★결정론 재시도 횟수(시간 기반 재시도 금지).
                      ★8 → 16(2026-09-06 master 판정): 실패율 p=0.332 에서 p^8x731 ≈ 0.11일/2년은
                      '약 18년에 하루' 라 ★운에 기대는 값이었다. p^16 이면 사실상 0 이고,
                      비용은 최악 16x43ms ≈ 0.7초인데 ★그 경로는 거의 가지 않는다.
                      ★예비 판 가지는 그대로 둔다 — 하네스가 계속 밟아야 검사가 산다. */
  ROUNDS: 1,       /* ★한 판에 묶는 작은 판 수 — ★미측정. 사람이 재기 전에는 1 이다(★상수 하나로만 존재) */
};

/* ── 씨앗 난수 (mulberry32) — 같은 씨앗 같은 수열 ───────────────────── */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (rng, arr) => arr[Math.floor(rng() * arr.length) % arr.length];

/* ── 방 만들기 ──────────────────────────────────────────────────────── */
function makeRoom(rng, cfg) {
  const { W, H } = cfg;
  const wall = new Uint8Array(W * H);
  for (let x = 0; x < W; x++) { wall[x] = 1; wall[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { wall[y * W] = 1; wall[y * W + W - 1] = 1; }

  const inner = [];
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) inner.push(y * W + x);

  const nWalls = Math.floor(rng() * (cfg.INNER_WALL_MAX + 1));
  for (let k = 0; k < nWalls; k++) {
    const c = pick(rng, inner);
    if (wall[c]) continue;
    wall[c] = 1;
    if (!connected(wall, cfg)) wall[c] = 0;   /* 방을 끊는 벽은 물린다 */
  }
  return wall;
}

function floors(wall) {
  const out = [];
  for (let i = 0; i < wall.length; i++) if (!wall[i]) out.push(i);
  return out;
}

function connected(wall, cfg) {
  const f = floors(wall);
  if (f.length < 12) return false;
  const seen = new Set([f[0]]);
  const st = [f[0]];
  const { W } = cfg;
  while (st.length) {
    const c = st.pop();
    for (const d of [-1, 1, -W, W]) {
      const n = c + d;
      if (!wall[n] && !seen.has(n)) { seen.add(n); st.push(n); }
    }
  }
  return seen.size === f.length;
}

/* ── 플레이어가 갈 수 있는 칸 + ★정규화 대표값 ──────────────────────
   소코반의 상태는 (상자 배치, 플레이어 위치)지만, 플레이어가 상자를 안 밀고
   돌아다니는 것은 판을 바꾸지 않는다. 그래서 ★플레이어가 닿는 영역의 ★최솟값 하나로
   대표시킨다 — 이걸 안 하면 같은 판을 수십 번 다시 세게 된다. */
function reach(wall, boxSet, from, W) {
  const seen = new Set([from]);
  const st = [from];
  let min = from;
  while (st.length) {
    const c = st.pop();
    if (c < min) min = c;
    for (const d of [-1, 1, -W, W]) {
      const n = c + d;
      if (wall[n] || boxSet.has(n) || seen.has(n)) continue;
      seen.add(n); st.push(n);
    }
  }
  return { seen, rep: min };
}

const keyOf = (boxes, rep) => boxes.join(',') + '|' + rep;

/* ── ★역방향 BFS — 해답에서 거꾸로 당기며 모든 판과 ★최소 밀기 수를 얻는다 ──
   당기기 한 번 = 플레이어가 상자 반대편 칸에 서서 뒤로 물러나며 상자를 끌어오는 것.
   전방의 '밀기' 와 정확히 역연산이라, 여기서 잰 깊이가 ★최소 밀기 수다. */
export function reverseBfs(wall, goals, cfg, limitStates = 60000) {
  const { W } = cfg;
  const startBoxes = goals.slice().sort((a, b) => a - b);
  const out = [];                  /* {boxes, playerRep, depth} */
  const seen = new Set();
  const q = [];

  /* 해답 상태에서 플레이어가 설 수 있는 모든 영역을 시작점으로 넣는다 */
  const boxSet0 = new Set(startBoxes);
  for (const f of floors(wall)) {
    if (boxSet0.has(f)) continue;
    const { rep } = reach(wall, boxSet0, f, W);
    const k = keyOf(startBoxes, rep);
    if (seen.has(k)) continue;
    seen.add(k);
    q.push({ boxes: startBoxes, rep, depth: 0 });
  }

  let head = 0;
  while (head < q.length && seen.size < limitStates) {
    const cur = q[head++];
    out.push(cur);
    const boxSet = new Set(cur.boxes);
    const { seen: area } = reach(wall, boxSet, cur.rep, W);

    for (const b of cur.boxes) {
      for (const d of [-1, 1, -W, W]) {
        /* 상자를 d 방향으로 ★당기려면: 플레이어가 b+d 에 서 있어야 하고(그 칸이 비어야 하고),
           물러날 칸 b+2d 도 비어야 한다. 그러면 상자는 b → b+d 로 온다. */
        const stand = b + d, back = b + 2 * d;
        if (wall[stand] || boxSet.has(stand)) continue;
        if (wall[back] || boxSet.has(back)) continue;
        if (!area.has(stand)) continue;              /* 플레이어가 거기까지 못 간다 */
        const nb = cur.boxes.filter(x => x !== b).concat(stand).sort((p, q2) => p - q2);
        const nSet = new Set(nb);
        const { rep } = reach(wall, nSet, back, W);
        const k = keyOf(nb, rep);
        if (seen.has(k)) continue;
        seen.add(k);
        q.push({ boxes: nb, rep, depth: cur.depth + 1 });
      }
    }
  }
  return { states: out, exhausted: head >= q.length, seenCount: seen.size };
}

/* ── 시작 데드락 판정(독립 계기) ────────────────────────────────────
   ★해가 있는지와 별개로, "이 상자는 이미 못 움직인다" 를 ★따로 잰다.
   구석에 박힌 상자(두 직교 방향이 벽)가 목표 위가 아니면 그 판은 이미 죽었다. */
export function cornerDeadlock(wall, boxes, goals, cfg) {
  const { W } = cfg;
  const goalSet = new Set(goals);
  for (const b of boxes) {
    if (goalSet.has(b)) continue;
    const up = wall[b - W], dn = wall[b + W], lf = wall[b - 1], rt = wall[b + 1];
    if ((up && lf) || (up && rt) || (dn && lf) || (dn && rt)) return true;
  }
  return false;
}

/* ── 판 하나 만들기 ─────────────────────────────────────────────────
   반환: null 이면 이 씨앗에서는 조건에 맞는 판을 못 만들었다(이유를 함께 준다). */
export function generate(seed, cfg = CFG) {
  const rng = makeRng(seed);
  const wall = makeRoom(rng, cfg);
  const f = floors(wall);
  const nBoxes = cfg.BOX_MIN + Math.floor(rng() * (cfg.BOX_MAX - cfg.BOX_MIN + 1));
  if (f.length < nBoxes + 4) return { ok: false, why: '바닥이 좁다' };

  /* 목표 칸 — 구석은 피한다(구석 목표는 판을 시시하게 만든다) */
  const cand = f.filter(c => !cornerDeadlock(wall, [c], [], cfg));
  if (cand.length < nBoxes) return { ok: false, why: '목표 자리가 모자라다' };
  const goals = [];
  while (goals.length < nBoxes) {
    const c = pick(rng, cand);
    if (!goals.includes(c)) goals.push(c);
  }
  goals.sort((a, b) => a - b);

  const { states, exhausted, seenCount } = reverseBfs(wall, goals, cfg);
  const band = states.filter(s => s.depth >= cfg.MIN_PUSHES && s.depth <= cfg.MAX_PUSHES
                                  && !cornerDeadlock(wall, s.boxes, goals, cfg));
  if (!band.length) return { ok: false, why: '난이도 띠에 드는 판이 없다', maxDepth: states.length ? states[states.length - 1].depth : 0 };

  /* 띠 안에서 ★가장 깊은 것을 고른다(같은 깊이가 여럿이면 난수로 하나) */
  const maxD = band.reduce((m, s) => Math.max(m, s.depth), 0);
  const top = band.filter(s => s.depth === maxD);
  const chosen = top[Math.floor(rng() * top.length) % top.length];

  /* 플레이어 시작 칸 — 대표값이 아니라 ★실제 칸 하나를 고정해서 낸다 */
  const boxSet = new Set(chosen.boxes);
  const playerCells = [...reach(wall, boxSet, chosen.rep, cfg.W).seen].sort((a, b) => a - b);
  const player = playerCells[Math.floor(rng() * playerCells.length) % playerCells.length];

  return {
    ok: true, seed, wall, goals, nBoxes,
    boxes: chosen.boxes, player,
    minPushes: chosen.depth,
    statesSeen: seenCount, exhausted,
  };
}

/* ── 판을 글로 옮기기(사람이 읽고 검사기가 재는 형식) ───────────────── */
export function render(board, cfg = CFG) {
  const { W, H } = cfg;
  const goalSet = new Set(board.goals), boxSet = new Set(board.boxes);
  const rows = [];
  for (let y = 0; y < H; y++) {
    let line = '';
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (board.wall[i]) line += '#';
      else if (boxSet.has(i)) line += goalSet.has(i) ? '*' : '$';
      else if (i === board.player) line += goalSet.has(i) ? '+' : '@';
      else line += goalSet.has(i) ? '.' : ' ';
    }
    rows.push(line);
  }
  return rows.join('\n');
}

/* ── 글로 적은 판을 읽어 들이기 (예비 판을 ★소스에 박아 두기 위해) ───── */
export function parseBoard(rows, cfg = CFG) {
  /* ★계산형 첨자(rows[0])를 쓰지 않는다 — 개인정보 검사기가 '무슨 키를 다루는지 판정 불가' 로
     떨어진다(2026-09-06 실측 check_privacy_storage rc=2). 구조 분해면 뜻이 그대로다. */
  const [firstRow] = rows;
  const H = rows.length, W = firstRow.length;
  const wall = new Uint8Array(W * H);
  const goals = [], boxes = [];
  let player = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ch = rows[y][x], i = y * W + x;
    if (ch === '#') wall[i] = 1;
    if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
    if (ch === '$' || ch === '*') boxes.push(i);
    if (ch === '@' || ch === '+') player = i;
  }
  return { ok: true, seed: null, wall, goals: goals.sort((a, b) => a - b),
           boxes: boxes.sort((a, b) => a - b), player, nBoxes: boxes.length, W, H };
}

/* ── ★예비 판 — 상한에 닿았을 때 ★실제로 쓰는 판 ─────────────────────
   ★'있을 수 없음' 으로 두지 않는다. 안 밟히는 복구 가지는 ★공허해서, 그 가지를 겨냥한
   뮤테이션이 통과해 버린다(2026-09-06 master 판정). 그래서 ①제품에 ★박아 두고
   ②하네스가 SEED_TRIES 를 1 로 ★낮춰 그 가지를 ★실제로 밟는다(★제품에 훅을 뚫지 않는다).
   이 판은 씨앗 1 이 낸 판을 고정한 것이고, 검사기가 ★풀리는지·최소 수가 맞는지 따로 잰다. */
export const FALLBACK_ROWS = [
  '########',
  '#      #',
  '# #   .#',
  '# $$@  #',
  '# # .  #',
  '# $  # #',
  '#    . #',
  '########',
];
export const FALLBACK_MIN_PUSHES = 13;

/* ── 날짜 → 씨앗 (결정론 · 시계를 읽지 않는다 · 날짜 문자열만 받는다) ─── */
/* ★씨앗 전진 방식을 바꾸려는 사람에게: 날짜 계약의 안전 수치(p^N)는 ★시도끼리 독립임을
   전제로 계산된다. FNV-1a 는 attempt 가 1 늘 때 결과를 크게 흩어 그 전제를 세운다.
   ★seed+1 같은 약한 전진으로 바꾸면 연속 시도가 ★상관되고 p^N 이 안전을 과대평가한다 —
   바꾸려면 push_dates.mjs 의 수치를 ★다시 세우고 판정을 받아라(2026-09-06 master). */
export function seedForDate(dateStr, attempt) {
  /* FNV-1a 32비트 — 날짜와 시도 번호만으로 정해진다. ★시간 기반 재시도가 아니다. */
  let h = 0x811c9dc5;
  const src = dateStr + '#' + attempt;
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ── ★오늘의 판 — 어떤 날짜에도 판이 있어야 한다(잠근 항) ──────────────
   씨앗 하나가 실패하면 ★정해진 규칙으로 다음 씨앗을 만든다(선굴림 안에서 끝난다).
   SEED_TRIES 번 다 실패하면 ★예비 판을 쓴다 — 그래서 ★없는 날이 없다. */
export function dailyBoard(dateStr, cfg = CFG) {
  const tries = Math.max(1, cfg.SEED_TRIES | 0);
  for (let attempt = 0; attempt < tries; attempt++) {
    const b = generate(seedForDate(dateStr, attempt), cfg);
    if (b.ok) return { ...b, dateStr, attempts: attempt + 1, usedFallback: false };
  }
  const fb = parseBoard(FALLBACK_ROWS, cfg);
  return { ...fb, dateStr, attempts: tries, usedFallback: true, minPushes: FALLBACK_MIN_PUSHES };
}
