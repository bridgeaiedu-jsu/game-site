/* 공개 카운터 — /js/hp-stats.js 단위 시험
 *
 * 브라우저 없이 본다. 파일을 그대로 vm 에 올리고 최소 스텁(navigator·sessionStorage·fetch·
 * document)을 붙여, 무엇을 어디로 보내고 화면의 어떤 자리를 채우는지 읽는다.
 * 사본을 만들어 재지 않는다.
 *
 * 사용법: node tools/counter/test_client.mjs [저장소 경로]
 * 종료코드: 0 = 전부 PASS · 1 = FAIL 있음
 */
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const ROOT = process.argv[2] || '.';
const SRC = fs.readFileSync(path.resolve(ROOT, 'js/hp-stats.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (n, c, d) => { if (c){ pass++; console.log('  PASS  ' + n); }
                          else { fail++; console.log('  FAIL  ' + n + (d ? ' — ' + d : '')); } };

/* data-hp 요소 한 개 흉내 — closest 는 없다고 답한다(줄 조상이 없으면 자기 자신을 감춘다). */
const makeEl = attr => ({ textContent: '', hidden: false,
  getAttribute: k => (k === 'data-hp' ? attr : null), closest: () => null });

function makeCtx(opts){
  const calls = { beacon: [], fetch: [] }, store = {};
  const ctx = { console, calls };
  ctx.window = ctx;                       /* 브라우저에서는 window 가 곧 전역이다 */
  ctx.navigator = opts.beacon
    ? { sendBeacon(url, blob){ calls.beacon.push({ url, blob }); return opts.beaconOk !== false; } }
    : {};
  ctx.Blob = function(parts, o){ this.parts = parts; this.type = o && o.type; };
  ctx.sessionStorage = opts.noStorage
    ? { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); } }
    : { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = v; } };
  ctx.fetch = (url, init) => { calls.fetch.push({ url, init });
    return opts.statsFail ? Promise.reject(new Error('down'))
                          : Promise.resolve({ ok: true, json: () => Promise.resolve(opts.statsBody) }); };
  ctx.document = { readyState: 'complete', addEventListener(){}, querySelectorAll: () => opts.nodes || [] };
  return vm.createContext(ctx);
}
const run = ctx => vm.runInContext(SRC, ctx);
const tick = () => new Promise(r => setImmediate(r));

console.log('== hpHit ==');
{
  const ctx = makeCtx({ beacon: true }); run(ctx);
  ctx.hpHit('visit');
  ok('visit → sendBeacon 우선(fetch 안 씀)', ctx.calls.beacon.length === 1 && ctx.calls.fetch.length === 0);
  ok('보내는 곳은 /api/hit', ctx.calls.beacon[0].url === '/api/hit', ctx.calls.beacon[0].url);
  ok('본문은 {"type":"visit"}', ctx.calls.beacon[0].blob.parts[0] === '{"type":"visit"}',
     ctx.calls.beacon[0].blob.parts[0]);
  ctx.hpHit('visit'); ctx.hpHit('visit');
  ok('방문은 한 세션에 한 번만', ctx.calls.beacon.length === 1, String(ctx.calls.beacon.length));
  ctx.hpHit('play', '2048');
  ok('play 는 부를 때마다 보낸다',
     ctx.calls.beacon.length === 2 && ctx.calls.beacon[1].blob.parts[0] === '{"type":"play","game":"2048"}',
     ctx.calls.beacon[1].blob.parts[0]);
  ctx.hpHit('play');
  ok('game 없는 play 는 보내지 않는다', ctx.calls.beacon.length === 2, String(ctx.calls.beacon.length));
}
{
  const ctx = makeCtx({ beacon: true, beaconOk: false }); run(ctx);
  ctx.hpHit('play', 'word');
  ok('sendBeacon 이 거절하면 fetch keepalive 로 물러선다',
     ctx.calls.fetch.length === 1 && ctx.calls.fetch[0].init.keepalive === true
     && ctx.calls.fetch[0].init.method === 'POST',
     JSON.stringify(ctx.calls.fetch[0] && ctx.calls.fetch[0].init));
}
{
  const ctx = makeCtx({ beacon: false }); run(ctx);
  ctx.hpHit('play', 'word');
  ok('sendBeacon 자체가 없는 브라우저에서도 나간다', ctx.calls.fetch.length === 1);
}
{
  const ctx = makeCtx({ beacon: true, noStorage: true }); run(ctx);
  ctx.hpHit('visit');
  ok('sessionStorage 가 막혀도 예외 없이 보낸다', ctx.calls.beacon.length === 1);
}

console.log('\n== hpStats ==');
{
  const a = makeEl('visits.today'), b = makeEl('visits.total'),
        c = makeEl('plays.2048.today'), d = makeEl('plays.chess.today');
  const ctx = makeCtx({ beacon: true, nodes: [a, b, c, d],
    statsBody: { day: '2026-08-25', visits: { today: 1234, total: 5678901 }, plays: { '2048': { today: 12, total: 34 } } } });
  run(ctx); await tick(); await tick();
  ok('/api/stats 를 부른다', ctx.calls.fetch.some(f => f.url === '/api/stats'));
  ok('천 단위 콤마 (1234 → 1,234)', a.textContent === '1,234', a.textContent);
  ok('큰 수도 콤마 (5678901 → 5,678,901)', b.textContent === '5,678,901', b.textContent);
  ok('중첩 경로 plays.2048.today 를 찾아 들어간다', c.textContent === '12', c.textContent);
  ok('응답에 없는 값은 그 자리를 감춘다', d.hidden === true && d.textContent === '', String(d.hidden));
  ok('채운 자리는 감추지 않는다', a.hidden === false && c.hidden === false);
}
{
  const a = makeEl('visits.today');
  const ctx = makeCtx({ beacon: true, nodes: [a], statsFail: true });
  run(ctx); await tick(); await tick();
  ok('조회가 실패하면 그 자리를 감춘다', a.hidden === true, String(a.hidden));
  ok('조회가 실패해도 예외를 밖으로 던지지 않는다', true);
}

console.log('\n==== hp-stats.js 단위 시험: PASS ' + pass + ' · FAIL ' + fail + ' ====');
process.exit(fail ? 1 : 0);
