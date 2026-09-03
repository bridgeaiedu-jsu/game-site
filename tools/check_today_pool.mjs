/* 오늘의 한판 — 후보 풀 점검 게이트 (2026-09-03 · T0903-today)
 *
 * 왜 만들었나 — 조용한 제외를 금지하기 위해서다
 *   선정 규칙(3종 중 최소 1종 maxMinutes<=N · 합<=M)은 어떤 게임을 **영원히** 후보에서
 *   빼 버릴 수 있다. 지금은 sudoku 가 그렇다 — 상한 15분이라 가장 짧은 둘을 붙여도 합이
 *   12분을 넘는다. 그런데 그 사실은 ★801일 시뮬레이션을 돌려야 드러났다. 규칙의 귀결이
 *   사람 눈에 안 보이는 것이 문제다.
 *   ⇒ 이 도구는 **매번 계산해서 찍는다.** 목록을 문서·주석에 손으로 적으면 게임이 늘거나
 *   maxMinutes 가 바뀌는 순간 거짓이 되기 때문이다.
 *
 * ★설계 원칙 1 — 규칙 상수를 이 파일에 갖지 않는다
 *   fastMax·sumMax·n 을 여기에 박으면 이 도구는 계약이 아니라 자기 상수를 증명하게 된다.
 *   그래서 제품(today/index.html)의 인라인 스크립트를 꺼내 window.__td.const().PICK 에서
 *   읽는다. 제품이 규칙을 바꾸면 이 도구의 판정도 함께 바뀐다.
 *
 * ★설계 원칙 2 — 못 읽은 자리는 통과로 세지 않는다
 *   제품 스크립트·games.json·규칙 상수 중 하나라도 못 읽으면 '위반 0'이 아니라 **판정 불가**다.
 *   (tools/check_home_sync.mjs · tools/check_privacy_storage.py 와 같은 계약)
 *
 * 규칙 (지적마다 [규칙id] 가 붙는다)
 *   [pool-any]        규칙을 만족하는 3종 조합이 하나라도 있다(0이면 그날부터 대체 규칙만 돈다)
 *   [pool-fast]       maxMinutes<=fastMax 인 게임이 하나 이상 있다(없으면 어떤 조합도 성립하지 않는다)
 *   [pool-maxminutes] daily 게임 전부가 숫자 maxMinutes 를 갖는다(없으면 그 게임은 조용히 후보에서 빠진다)
 *
 * ★이 도구가 하지 않는 것(정직한 한계)
 *   · 영구 제외 자체를 미달로 세지 않는다. 제외는 규칙의 정당한 귀결일 수 있다(오너·master 판단).
 *     이 도구의 일은 **그 목록을 눈에 보이게 만드는 것**이지 옳고 그름을 정하는 것이 아니다.
 *   · 날짜별로 실제 무엇이 뽑히는지는 재지 않는다(그건 시뮬레이션의 몫이다).
 *
 * 사용: node tools/check_today_pool.mjs [저장소 경로]
 * 종료코드: 0 통과 · 1 미달 · 2 판정 불가
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : '.';
const HTML = path.join(ROOT, 'today', 'index.html');
const GAMES = path.join(ROOT, 'games.json');
const indet = msg => { console.error('‽ 판정 불가 — ' + msg); process.exit(2); };

let RAW, LIST;
try { RAW = fs.readFileSync(HTML, 'utf8'); } catch { indet('허브를 읽지 못했다: ' + HTML); }
try { LIST = JSON.parse(fs.readFileSync(GAMES, 'utf8')); } catch { indet('games.json 을 읽지 못했다: ' + GAMES); }
if (!Array.isArray(LIST)) indet('games.json 이 배열이 아니다');

/* 규칙 상수는 제품에서 읽는다 — 이 파일에 박지 않는다(설계 원칙 1). */
let SRC = null;
{
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(RAW))){
    if (/\bsrc=/.test(m[1])) continue;
    if (m[2].includes('window.__td')){ SRC = m[2]; break; }
  }
}
if (!SRC) indet('허브 스크립트(window.__td 를 여는 인라인 <script>)를 찾지 못했다');

const el = () => ({ textContent:'', innerHTML:'', hidden:false, dataset:{}, style:{},
  classList:{ add(){}, remove(){} }, set onclick(_v){}, get onclick(){ return null; },
  appendChild(){}, remove(){}, select(){} });
const store = new Map();
const sandbox = {
  console: { log(){}, error(){}, warn(){} },
  document: { documentElement:{ lang:'ko' }, title:'', getElementById: el, querySelectorAll: () => [],
              createElement: el, addEventListener(){}, body:{ appendChild(){} }, hidden:false },
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v) => store.set(k,String(v)), removeItem: k => store.delete(k) },
  navigator: { language:'ko-KR' },
  fetch: () => Promise.reject(new Error('no network in gate')),
  setTimeout, clearTimeout,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
try { vm.runInContext(SRC, sandbox, { filename:'today-inline.js' }); }
catch (e) { indet('허브 스크립트를 실행하지 못했다: ' + e.message); }

const td = sandbox.window.__td;
if (!td || typeof td.const !== 'function') indet('window.__td.const 를 찾지 못했다');
const PICK = (td.const() || {}).PICK;
for (const k of ['n', 'fastMax', 'sumMax'])
  if (typeof (PICK || {})[k] !== 'number') indet('규칙 상수 PICK.' + k + ' 를 제품에서 읽지 못했다');

const daily = LIST.filter(g => g && g.daily === true);
if (daily.length === 0) indet('games.json 에 daily 게임이 없다');
const noMax = daily.filter(g => typeof g.maxMinutes !== 'number');
const pool = daily.filter(g => typeof g.maxMinutes === 'number');

/* 조합 전수 — 어떤 조합에도 못 들어가는 게임이 영구 제외다. */
const combos = [];
const idx = pool.map((_, i) => i);
for (let a = 0; a < idx.length; a++)
  for (let b = a + 1; b < idx.length; b++)
    for (let c = b + 1; c < idx.length; c++){
      const t = [pool[a], pool[b], pool[c]];
      if (t.some(g => g.maxMinutes <= PICK.fastMax) && t.reduce((s, g) => s + g.maxMinutes, 0) <= PICK.sumMax)
        combos.push(t);
    }
const reachable = new Set(combos.flat().map(g => g.id));
const excluded = pool.filter(g => !reachable.has(g.id));
const fast = pool.filter(g => g.maxMinutes <= PICK.fastMax);
const total = (n => n * (n-1) * (n-2) / 6)(pool.length);

console.log('오늘의 한판 후보 풀 점검 — 대상 ' + path.resolve(ROOT));
console.log(`  · 규칙(제품에서 읽음): ${PICK.n}종 · 최소 1종 maxMinutes<=${PICK.fastMax} · 합<=${PICK.sumMax}`);
console.log(`  · daily ${daily.length}종 · maxMinutes 있는 것 ${pool.length}종 · 빠른 게임(<=${PICK.fastMax}) ${fast.length}종`);
console.log(`  · 성립하는 ${PICK.n}종 조합 ${combos.length} / 전체 ${total}`);
/* ★영구 제외 목록 — 손으로 적은 것이 아니라 위 조합 전수에서 계산해 찍는다. */
if (excluded.length === 0) console.log('  · 영구 제외 0종 — 모든 daily 게임이 어떤 날에는 뽑힐 수 있다');
else {
  console.log(`  · ★영구 제외 ${excluded.length}종 (규칙의 귀결 — 이 도구는 판정하지 않고 드러내기만 한다):`);
  const sorted = pool.map(g => g.maxMinutes).sort((x, y) => x - y);
  for (const g of excluded){
    const others = pool.filter(x => x.id !== g.id).map(x => x.maxMinutes).sort((x, y) => x - y).slice(0, PICK.n - 1);
    const min = Math.round((g.maxMinutes + others.reduce((s, v) => s + v, 0)) * 100) / 100;
    console.log(`      - ${g.id} (maxMinutes ${g.maxMinutes} · 최소 조합 ${[g.maxMinutes, ...others].join('+')}=${min} > ${PICK.sumMax})`);
  }
  void sorted;
}

let fail = 0;
const say = (ok, id, msg) => { console.log(`  ${ok ? '✓' : '✗'} [${id}] ${msg}`); if (!ok) fail++; };
say(noMax.length === 0, 'pool-maxminutes',
    `daily ${daily.length}종 전부 maxMinutes 숫자를 갖는다 — 없는 것 ${noMax.length}종` + (noMax.length ? ` (${noMax.map(g => g.id).join(', ')})` : ''));
say(fast.length > 0, 'pool-fast', `maxMinutes<=${PICK.fastMax} 인 게임 ${fast.length}종 (0이면 어떤 조합도 성립하지 않는다)`);
say(combos.length > 0, 'pool-any', `성립하는 조합 ${combos.length}개 (0이면 매일 대체 규칙만 돈다)`);
console.log(`결과: 통과 ${3-fail} · 미달 ${fail} · 판정 불가 0`);
process.exit(fail ? 1 : 0);
