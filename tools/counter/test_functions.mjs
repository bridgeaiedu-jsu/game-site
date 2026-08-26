/* 공개 카운터 — Pages Functions 단위 시험
 *
 * D1 은 최소 stub 으로 둔다. 실제 데이터베이스 없이도 확인할 수 있는 것을 확인한다:
 * **던지는 쿼리 문자열**과 **응답 코드**, 그리고 입력을 거르는 규칙이다.
 * 대상 파일을 그대로 import 한다 — 사본을 만들어 재지 않는다.
 *
 * 사용법: node tools/counter/test_functions.mjs [저장소 경로]
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음
 */
import fs from 'fs';
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

/* ★게임 목록의 단일 출처는 루트 `games.json` 이다. 런타임은 `functions/_games.js` 를 보므로,
   둘이 어긋나지 않는지부터 확인한다 — 어긋난 채로 아래를 계속 재면 무엇을 재고 있는지 모른다. */
const IDS = JSON.parse(fs.readFileSync(path.resolve(ROOT, 'games.json'), 'utf8')).map(g => g.id);
const { GAMES } = await load('functions/_games.js');
const src = f => fs.readFileSync(path.resolve(ROOT, f), 'utf8');
/* 목록에 **없는** 이름 — 화이트리스트가 거르는지 볼 때 쓴다. 목록에서 골라 내므로,
   언젠가 그 이름이 진짜 게임이 되어도 시험이 저절로 다른 이름으로 옮겨 간다. */
const OUTSIDER = ['chess', 'not-a-game'].find(n => IDS.indexOf(n) < 0);

console.log('== 게임 목록 단일 출처 ==');
ok('games.json 에서 id 를 읽었다 (' + IDS.length + '개)',
   IDS.length > 0 && IDS.every(x => typeof x === 'string' && x), JSON.stringify(IDS));
ok('games.json 의 id 에 중복이 없다', new Set(IDS).size === IDS.length, IDS.join(','));
ok('functions/_games.js 의 GAMES 가 games.json 의 id 배열과 순서까지 같다',
   Array.isArray(GAMES) && GAMES.length === IDS.length && GAMES.every((g, i) => g === IDS[i]),
   '_games.js=[' + GAMES + '] · games.json=[' + IDS + ']');
for (const t of ['functions/api/hit.js', 'functions/api/stats.js'])
  ok(t + ' 는 목록을 스스로 들고 있지 않다',
     /import\s*\{[^}]*\bGAMES\b[^}]*\}\s*from\s*'\.\.\/_games\.js'/.test(src(t))
     && !/const\s+GAMES\s*=\s*\[/.test(src(t)), t);

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
/* games.json 에 있는 게임이 하나도 빠짐없이 같은 관문을 지나는지 본다 — 화이트리스트에
   넣는 것을 잊으면 그 게임의 판수가 조용히 400 으로 버려진다(게임은 멀쩡히 돌아가므로
   눈으로는 안 잡힌다). 목록을 여기 옮겨 적지 않고 games.json 에서 받아 돈다. */
for (const g of IDS){
  const db = makeDB();
  const r = await hit({ request: req('POST', JSON.stringify({ type: 'play', game: g })), env: { DB: db } });
  const up = db.log.find(q => q.sql.indexOf('INSERT INTO hits') === 0);
  ok('play + ' + g + ' → 204', r.status === 204 && !!up && up.bind[2] === g,
     String(r.status) + ' · ' + JSON.stringify(up && up.bind));
}
for (const [name, body, want] of [
  ['play 인데 game 없음', JSON.stringify({ type: 'play' }), 400],
  ['목록에 없는 game (' + OUTSIDER + ')', JSON.stringify({ type: 'play', game: OUTSIDER }), 400],
  ['모르는 type',         JSON.stringify({ type: 'ad_click' }), 400],
  ['JSON 이 아님',        '{{{', 400],
  ['본문 256B 초과',      JSON.stringify({ type: 'visit', pad: 'x'.repeat(300) }), 413],
]){
  const r = await hit({ request: req('POST', body), env: { DB: makeDB() } });
  ok(name + ' → ' + want, r.status === want, String(r.status));
}
{
  /* ★상한은 바이트로 재야 한다(codex R1 차단 2). 한글은 UTF-8 로 한 글자 3바이트라
     문자열 길이로 재면 상한의 세 배까지 통과한다. */
  const ko = JSON.stringify({ type: 'visit', x: '가'.repeat(100) });
  const utf16 = ko.length, utf8 = new TextEncoder().encode(ko).length;
  const r = await hit({ request: req('POST', ko), env: { DB: makeDB() } });
  ok(`한글 본문(문자 ${utf16} · UTF-8 ${utf8}B) → 413`, r.status === 413, String(r.status));
  ok('문자 길이로는 상한 안이었다(그래서 바이트로 재야 한다)', utf16 <= 256 && utf8 > 256,
     `문자 ${utf16} · 바이트 ${utf8}`);
  /* 이 요청에는 Content-Length 가 없다 — 즉 위 413 은 선검사가 아니라 **읽으면서 끊는**
     스트리밍 경로가 잡아낸 것이다. 두 경로가 각각 확인된다. */
  ok('그 본문에는 Content-Length 가 없다(스트리밍 경로가 잡았다는 뜻)',
     req('POST', ko).headers.get('Content-Length') === null);

  /* Content-Length 가 이미 크다고 말하면 본문을 읽기 전에 끊는다. */
  let read = false;
  const spy = new Request('https://hanpango.com/api/hit', {
    method: 'POST', headers: { Origin: 'https://hanpango.com', 'Content-Length': '1000' },
    body: JSON.stringify({ type: 'visit' }) });
  Object.defineProperty(spy, 'body', { get(){ read = true; return null; } });
  const r2 = await hit({ request: spy, env: { DB: makeDB() } });
  ok('Content-Length 1000 → 413', r2.status === 413, String(r2.status));
  ok('그 판정은 본문을 읽기 전에 난다', read === false, '본문 접근=' + read);

  const r3 = await hit({ request: req('POST', JSON.stringify({ type: 'visit' })), env: { DB: makeDB() } });
  ok('정상 visit 은 그대로 204', r3.status === 204, String(r3.status));
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
  /* 표에는 목록의 첫 게임과 '표에 낀 모르는 게임' 이 함께 있다고 두고, 응답이 목록대로만
     나오는지 본다. 게임 이름은 games.json 에서 받아 쓴다. */
  const G0 = IDS[0];
  const rows = [
    { kind: 'visit', game: '',       total: 30, today: 4 },
    { kind: 'play',  game: G0,       total: 12, today: 3 },
    { kind: 'play',  game: OUTSIDER, total: 99, today: 9 },   /* 표에 낀 모르는 게임 */
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
  ok('plays 집계 (' + G0 + ')', j.plays[G0].today === 3 && j.plays[G0].total === 12, JSON.stringify(j.plays[G0]));
  ok('기록 없는 게임도 0 으로 칸이 있다',
     IDS.slice(1).every(g => j.plays[g] && j.plays[g].today === 0 && j.plays[g].total === 0),
     JSON.stringify(j.plays));
  ok('목록에 없는 게임(' + OUTSIDER + ')은 응답에 넣지 않는다',
     !(OUTSIDER in j.plays), JSON.stringify(Object.keys(j.plays)));
  /* ★hit.js 화이트리스트만 고치고 stats.js 를 잊으면 판수는 쌓이는데 화면에 칸이 없어
     시작 카드의 판수 줄이 영영 hidden 으로 남는다(조용한 고장) — games.json 의 게임이
     하나도 빠짐없이 칸을 갖는지 못박는다. 견주는 것은 '집합' 이다: '2048' 같은 정수꼴
     이름은 자바스크립트가 객체 키 순서를 앞으로 당기므로 순서로는 견줄 수 없다. */
  const slots = Object.keys(j.plays);
  ok('games.json 의 게임 ' + IDS.length + '개가 빠짐없이 칸을 갖는다(기록 0 이어도)',
     slots.length === IDS.length && IDS.every(g => slots.indexOf(g) >= 0), JSON.stringify(slots));
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
