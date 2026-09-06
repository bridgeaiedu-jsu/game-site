/* push_solver.mjs — ★독립 계기: 전방 BFS 풀이기.
 *
 * ★생성기(push_gen.mjs)를 ★부르지 않는다. 밀기 규칙을 ★여기서 다시 적었다.
 * 생성기가 '이 판은 최소 N밀기다' 라고 말하면, 이 파일이 ★반대 방향에서 다시 풀어 그 말을 잰다.
 * ★같은 계기로 두 번 재는 것은 대조가 아니다 — 그래서 코드를 공유하지 않는다.
 */
/* ── ★전방 BFS(독립 계기) — 시작 판에서 해답까지 최소 ★밀기 수 ─────────
   생성기의 역방향 코드를 부르지 않는다. 밀기 규칙을 여기서 다시 적는다. */
export function solveMinPushes(wall, boxes0, player0, goals, cfg, cap = 200000) {
  const { W } = cfg;
  const goalKey = goals.slice().sort((a, b) => a - b).join(',');
  const reachOf = (boxSet, from) => {
    const seen = new Set([from]); const st = [from]; let min = from;
    while (st.length) {
      const c = st.pop(); if (c < min) min = c;
      for (const d of [-1, 1, -W, W]) {
        const n = c + d;
        if (wall[n] || boxSet.has(n) || seen.has(n)) continue;
        seen.add(n); st.push(n);
      }
    }
    return { seen, rep: min };
  };
  const boxes = boxes0.slice().sort((a, b) => a - b);
  const first = reachOf(new Set(boxes), player0);
  if (boxes.join(',') === goalKey) return 0;
  const seen = new Set([boxes.join(',') + '|' + first.rep]);
  let frontier = [{ boxes, rep: first.rep }];
  let depth = 0;
  while (frontier.length && seen.size < cap) {
    depth++;
    const next = [];
    for (const cur of frontier) {
      const boxSet = new Set(cur.boxes);
      const { seen: area } = reachOf(boxSet, cur.rep);
      for (const b of cur.boxes) {
        for (const d of [-1, 1, -W, W]) {
          /* d 방향으로 ★밀려면: 플레이어가 b-d 에 서 있어야 하고 b+d 가 비어야 한다 */
          const stand = b - d, dest = b + d;
          if (wall[dest] || boxSet.has(dest)) continue;
          if (wall[stand] || boxSet.has(stand)) continue;
          if (!area.has(stand)) continue;
          const nb = cur.boxes.filter(x => x !== b).concat(dest).sort((p, q) => p - q);
          const nSet = new Set(nb);
          const { rep } = reachOf(nSet, b);        /* 밀고 나면 플레이어는 상자가 있던 칸에 선다 */
          const k = nb.join(',') + '|' + rep;
          if (seen.has(k)) continue;
          seen.add(k);
          if (nb.join(',') === goalKey) return depth;
          next.push({ boxes: nb, rep });
        }
      }
    }
    frontier = next;
  }
  return -1;                                        /* ★못 풀었다 = 막힌 판(또는 상한 초과) */
}
