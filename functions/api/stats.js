/* 공개 카운터 — 집계 조회. GET /api/stats
 *
 * 응답: { day, visits:{today,total}, plays:{ <게임>:{today,total} } }
 * 오늘(한국 시간 기준)과 누적을 한 번의 질의로 함께 낸다.
 *
 * Cache-Control: public, max-age=60 — 화면의 숫자는 1분 늦어도 된다. 그만큼 D1 을 덜 두드린다.
 * CORS 헤더는 두지 않는다 — 이 사이트 자신만 읽으면 되므로 동일 출처로 충분하다.
 */

/* 게임 목록은 여기서 갖지 않는다 — `functions/_games.js` 하나가 런타임 출처다.
   (예전에는 hit.js·stats.js 가 각자 목록을 들고 있어, 새 게임을 한쪽에만 적으면
    그 게임의 기록이 조용히 사라졌다.) */
import { GAMES } from '../_games.js';

let tableReady = false;
async function ensureTable(db){
  if (tableReady) return;
  await db.prepare(
    'CREATE TABLE IF NOT EXISTS hits (day TEXT, kind TEXT, game TEXT, n INTEGER, PRIMARY KEY(day, kind, game))'
  ).run();
  tableReady = true;
}

function kstDay(now){
  const t = new Date(now.getTime() + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
}

export async function onRequest(context){
  const { request, env } = context;
  if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });

  const day = kstDay(new Date());
  const out = { day, visits: { today: 0, total: 0 }, plays: {} };
  for (const g of GAMES) out.plays[g] = { today: 0, total: 0 };   /* 기록이 없어도 칸은 있다 */

  try {
    await ensureTable(env.DB);
    /* 오늘치와 누적을 한 번에 — 오늘은 같은 SUM 안에서 날짜로 골라 더한다. */
    const res = await env.DB.prepare(
      'SELECT kind, game, SUM(n) AS total, SUM(CASE WHEN day = ? THEN n ELSE 0 END) AS today ' +
      'FROM hits GROUP BY kind, game'
    ).bind(day).all();
    for (const r of (res && res.results) || []){
      const today = Number(r.today) || 0, total = Number(r.total) || 0;
      if (r.kind === 'visit') { out.visits.today += today; out.visits.total += total; }
      else if (r.kind === 'play' && out.plays[r.game]) { out.plays[r.game] = { today, total }; }
    }
  } catch (e) {
    return new Response(null, { status: 500 });
  }

  return new Response(JSON.stringify(out), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60' }
  });
}
