/* 공개 카운터 — Pages Functions 단위 시험
 *
 * D1 은 최소 stub 으로 둔다. 실제 데이터베이스 없이도 확인할 수 있는 것을 확인한다:
 * **던지는 쿼리 문자열**과 **응답 코드**, 그리고 입력을 거르는 규칙이다.
 * 대상 파일을 그대로 import 한다 — 사본을 만들어 재지 않는다.
 *
 * 사용법: node tools/counter/test_functions.mjs [저장소 경로]
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음
 */
import { pathToFileURL } from 'url';
import path from 'path';

const ROOT = process.argv[2] || '.';
/* 시험 파일이 functions/ 안에 있으면 Cloudflare Pages 가 그것까지 라우트로 삼는다.
   그래서 파일은 tools/ 에 두고 대상만 가리킨다. */
const load = f => import(pathToFileURL(path.resolve(ROOT, f)).href);
const { onRequest: hit } = await load('functions/api/hit.js');
const { onRequest: stats } = await load('functions/api/stats.js');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c){ pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

/* 최소 D1 stub — 던진 SQL 과 바인딩을 기록만 한다. */
function makeDB(rows = [], opts = {}){
  const log = [];
  return { log, prepare(sql){
    return { sql, _b: [],
      bind(...a){ this._b = a; return this; },
      async run(){ log.push({ sql, bind: this._b }); if (opts.throwOnRun) throw new Error('boom'); return { success: true }; },
      async all(){ log.push({ sql, bind: this._b }); if (opts.throwOnAll) throw new Error('boom'); return { results: rows }; } };
  } };
}
const req = (method, body, headers = { Origin: 'https://hanpango.com' }) =>
  new Request('https://hanpango.com/api/hit', { method, body, headers });

console.log('== hit.js ==');
{
  const db = makeDB();
  const r = await hit({ request: req('POST', JSON.stringify({ type: 'visit' })), env: { DB: db } });
  ok('visit → 204', r.status === 204, String(r.status));
  ok('CREATE TABLE IF NOT EXISTS 를 던진다',
     !!db.log.find(q => q.sql.indexOf('CREATE TABLE IF NOT EXISTS hits') === 0));
  const up = db.log.find(q => q.sql.indexOf('INSERT INTO hits') === 0);
  ok('UPSERT 쿼리 문자열이 규약대로다',
     !!up && up.sql.includes('ON CONFLICT(day, kind, game) DO UPDATE SET n = n + 1'), up && up.sql);
  ok('visit 은 game 을 빈 문자열로 박는다', !!up && up.bind[1] === 'visit' && up.bind[2] === '',
     JSON.stringify(up && up.bind));
  ok('day 는 YYYY-MM-DD 꼴이다', !!up && /^\d{4}-\d{2}-\d{2}$/.test(up.bind[0]), up && up.bind[0]);
}
{
  const db = makeDB();
  const r = await hit({ request: req('POST', JSON.stringify({ type: 'play', game: '2048' })), env: { DB: db } });
  const up = db.log.find(q => q.sql.indexOf('INSERT INTO hits') === 0);
  ok('play + 화이트리스트 게임 → 204', r.status === 204 && up.bind[2] === '2048', String(r.status));
}
for (const [name, body, want] of [
  ['play 인데 game 없음', JSON.stringify({ type: 'play' }), 400],
  ['목록에 없는 game',    JSON.stringify({ type: 'play', game: 'chess' }), 400],
  ['모르는 type',         JSON.stringify({ type: 'ad_click' }), 400],
  ['JSON 이 아님',        '{{{', 400],
  ['본문 256B 초과',      JSON.stringify({ type: 'visit', pad: 'x'.repeat(300) }), 413],
]){
  const r = await hit({ request: req('POST', body), env: { DB: makeDB() } });
  ok(name + ' → ' + want, r.status === want, String(r.status));
}
{
  const g = async (h, b = JSON.stringify({ type: 'visit' }), m = 'POST', db = makeDB()) =>
    (await hit({ request: req(m, b, h), env: { DB: db } })).status;
  ok('POST 아님 → 405', await g({ Origin: 'https://hanpango.com' }, null, 'GET') === 405);
  ok('다른 사이트 Origin → 403', await g({ Origin: 'https://evil.example.com' }) === 403);
  ok('Origin 없고 Referer 가 우리 → 204', await g({ Referer: 'https://hanpango.com/word/' }) === 204);
  ok('Origin·Referer 둘 다 없음 → 403', await g({}) === 403);
  ok('D1 예외 → 500 · 본문 없음',
     await g({ Origin: 'https://hanpango.com' }, JSON.stringify({ type: 'visit' }), 'POST',
             makeDB([], { throwOnRun: true })) === 500);
}

console.log('\n== stats.js ==');
{
  const rows = [
    { kind: 'visit', game: '',      total: 30, today: 4 },
    { kind: 'play',  game: '2048',  total: 12, today: 3 },
    { kind: 'play',  game: 'word',  total:  7, today: 0 },
    { kind: 'play',  game: 'chess', total: 99, today: 9 },   /* 표에 낀 모르는 게임 */
  ];
  const db = makeDB(rows);
  const r = await stats({ request: new Request('https://hanpango.com/api/stats'), env: { DB: db } });
  ok('GET → 200', r.status === 200, String(r.status));
  ok('Cache-Control: public, max-age=60',
     r.headers.get('Cache-Control') === 'public, max-age=60', r.headers.get('Cache-Control'));
  ok('CORS 헤더 없음(동일 출처)', !r.headers.get('Access-Control-Allow-Origin'));
  const q = db.log.find(x => x.sql.indexOf('SELECT') === 0);
  ok('SUM 집계 쿼리를 던진다',
     !!q && q.sql.includes('SUM(n) AS total')
         && q.sql.includes('SUM(CASE WHEN day = ? THEN n ELSE 0 END) AS today')
         && q.sql.includes('GROUP BY kind, game'), q && q.sql);
  const j = await r.json();
  ok('visits 집계', j.visits.today === 4 && j.visits.total === 30, JSON.stringify(j.visits));
  ok('plays 집계', j.plays['2048'].today === 3 && j.plays['2048'].total === 12, JSON.stringify(j.plays['2048']));
  ok('기록 없는 게임도 0 으로 칸이 있다',
     j.plays['block-drop'].today === 0 && j.plays['block-puzzle'].total === 0, JSON.stringify(j.plays));
  ok('목록에 없는 게임은 응답에 넣지 않는다', !('chess' in j.plays), JSON.stringify(Object.keys(j.plays)));
  ok('day 는 YYYY-MM-DD 꼴이다', /^\d{4}-\d{2}-\d{2}$/.test(j.day), j.day);
}
{
  const r = await stats({ request: new Request('https://hanpango.com/api/stats', { method: 'POST' }), env: { DB: makeDB() } });
  ok('GET 아님 → 405', r.status === 405, String(r.status));
  const r2 = await stats({ request: new Request('https://hanpango.com/api/stats'), env: { DB: makeDB([], { throwOnAll: true }) } });
  ok('D1 예외 → 500', r2.status === 500, String(r2.status));
}

console.log('\n==== functions 단위 시험: PASS ' + pass + ' · FAIL ' + fail + ' ====');
process.exit(fail ? 1 : 0);
