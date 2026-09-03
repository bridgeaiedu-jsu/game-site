/* 오늘의 한판 — 자정 재구축·관측 창구 사본 게이트 (2026-09-04 · T0904-today-net)
 *
 * 무엇을 재는가
 *   [midnight]         자정을 넘겨 탭으로 돌아오면(visibilitychange) 날짜·회차가 다시 지어진다.
 *   [midnight-button]  '다시 읽기' 버튼으로도 같은 자리를 지난다(흐름 하나만 고치면 반쪽이다).
 *   [pick-copy]        window.__td.pick() 이 돌려준 원소를 고쳐도 내부 pool 이 오염되지 않는다.
 *   [*-premise/-denominator] 그 전에 전제와 분모를 먼저 못박는다 — 전제가 깨진 표본으로 낸
 *                      초록은 관측이 아니고, 잰 건수가 기대와 다르면 '위반 0' 은 뜻이 없다.
 *
 * 왜 저장소 안에 있나
 *   이 검사는 원래 `_round/evidence/` 에 있었다. 거기 있으면 세션이 끝나는 순간 아무도 부르지
 *   않는다 — 배포 체크리스트를 돌려도 이 두 축은 보이지 않는다.
 *   ★게이트는 어디에 있느냐가 그 수명을 정한다.
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · DOM 스텁 위에서 돈다. 레이아웃·그림·실브라우저 동작은 보지 않는다.
 *   · 자정 예약 타이머(setTimeout)가 실제로 발화하는 것은 재지 않는다 — 시계를 앞으로 돌리는
 *     하네스가 따로 있고(gemini_timer_probe.mjs · ★tools 밖) 그것은 이 게이트의 범위가 아니다.
 *     여기서 잰 것은 사용자 흐름 둘(돌아오기·다시 읽기)이다.
 *
 * 사용:
 *   node tools/check_today_midnight.mjs [저장소 경로] [--days N]      (기본 45 = 91 경계)
 *   node tools/check_today_midnight.mjs [저장소 경로] --selftest
 * 종료코드: 0 통과 · 1 미달 · 2 판정 불가(대상을 못 읽음·못 실행함)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const ROOT = ARGV.find(a => !a.startsWith('-')) || '.';
const dIdx = ARGV.indexOf('--days');
const DAYS = dIdx >= 0 ? Number(ARGV[dIdx + 1]) : 45;
const BDAYS = Math.min(DAYS, 20);                 /* 버튼 흐름은 분모를 따로 밝힌다 */
if (!Number.isFinite(DAYS) || DAYS < 1){ console.error('‽ 판정 불가 — --days 값이 숫자가 아니다'); process.exit(2); }

function readTarget(root){
  const html = path.join(root, 'today', 'index.html');
  const games = path.join(root, 'games.json');
  let RAW, LIST;
  try { RAW = fs.readFileSync(html, 'utf8'); } catch { return { err: '허브를 읽지 못했다: ' + html }; }
  try { LIST = fs.readFileSync(games, 'utf8'); } catch { return { err: 'games.json 을 읽지 못했다: ' + games }; }
  let SRC = null;
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(RAW))){
    if (/\bsrc=/.test(m[1])) continue;
    if (m[2].includes('window.__td')){ SRC = m[2]; break; }
  }
  if (!SRC) return { err: '허브 스크립트(window.__td 를 여는 인라인 <script>)를 찾지 못했다' };
  return { SRC, LIST };
}

const el = () => ({ textContent:'', innerHTML:'', hidden:false, dataset:{}, style:{}, onclick:null,
  classList:{ add(){}, remove(){} }, appendChild(){}, remove(){}, select(){} });

async function load(SRC, LIST, nowMs){
  const els = new Map(), listeners = new Map(), store = new Map();
  let NOW = nowMs;
  class FakeDate extends Date {
    constructor(...a){ if (a.length === 0) super(NOW); else super(...a); }
    static now(){ return NOW; }
  }
  const sb = {
    console: { log(){}, error(){}, warn(){} },
    Date: FakeDate,
    document: { documentElement:{ lang:'ko' }, title:'', hidden:false,
      getElementById: id => { if (!els.has(id)) els.set(id, el()); return els.get(id); },
      querySelectorAll: () => [], createElement: el, body:{ appendChild(){} },
      addEventListener: (t, fn) => { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); } },
    localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k,v) => store.set(k, String(v)),
                    removeItem: k => store.delete(k), get length(){ return store.size; }, key: i => [...store.keys()][i] },
    navigator: { language:'ko-KR' },
    fetch: () => Promise.resolve({ ok:true, json: async () => JSON.parse(LIST) }),
    setTimeout, clearTimeout,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(SRC, sb, { filename: 'today-inline.js' });
  for (let i = 0; i < 20; i++) await Promise.resolve();
  return { sb, els, listeners, setNow: ms => { NOW = ms; },
           fire: t => { for (const fn of (listeners.get(t) || [])) fn(); } };
}

const pad2 = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;

async function judge(root, quiet){
  const t = readTarget(root);
  if (t.err) return { rc: 2, why: t.err };
  const say = [];
  let fail = 0, indetHit = null;
  const note = (ok, id, msg) => { say.push(`  ${ok ? '✓' : '✗'} [${id}] ${msg}`); if (!ok) fail++; };

  /* 두 사용자 흐름을 각각 다른 분모로 잰다. */
  for (const flow of [{ id:'midnight', days:DAYS, run:(h) => h.fire('visibilitychange') },
                      { id:'midnight-button', days:BDAYS,
                        run:(h) => { const b = h.els.get('btnRefresh'); if (b && typeof b.onclick === 'function') b.onclick(); else throw new Error('버튼 없음'); } }]){
    const base = new Date();
    const bad = [], badPremise = [];
    let measured = 0;
    for (let off = -flow.days; off <= flow.days; off++){
      const d0 = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off);
      const d1 = new Date(base.getFullYear(), base.getMonth(), base.getDate() + off + 1);
      const before = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), 23, 59, 30).getTime();
      const after  = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate(), 0, 0, 30).getTime();
      let h;
      try { h = await load(t.SRC, t.LIST, before); }
      catch (e) { indetHit = '허브 스크립트를 실행하지 못했다: ' + e.message; break; }
      const td = h.sb.window.__td;
      if (!td || typeof td.view !== 'function'){ indetHit = 'window.__td.view 를 찾지 못했다'; break; }
      const v1 = td.view();
      if (!v1 || v1.day !== keyOf(d0)){ badPremise.push(`${keyOf(d0)}→${v1 ? v1.day : 'null'}`); continue; }
      measured++;
      h.setNow(after);
      try { flow.run(h); } catch (e) { bad.push(`${keyOf(d0)}(${e.message})`); continue; }
      const v2 = td.view();
      if (!(v2 && v2.day === keyOf(d1) && v2.no === v1.no + 1)) bad.push(`${keyOf(d0)}→${v2 ? v2.day : 'null'}`);
    }
    if (indetHit) return { rc: 2, why: indetHit };
    const expected = 2 * flow.days + 1;
    note(badPremise.length === 0, flow.id + '-premise',
         `자정 전 관측이 전부 그날이었다 — 어긋난 표본 ${badPremise.length}건` + (badPremise.length ? ` (예: ${badPremise[0]})` : ''));
    note(measured === expected, flow.id + '-denominator', `잰 경계 ${measured} = 기대 분모 ${expected}`);
    note(bad.length === 0, flow.id,
         `자정을 넘긴 뒤 날짜·회차가 다시 지어진 경계 ${measured - bad.length}/${measured}` + (bad.length ? ` · 실패 ${bad.length}건 (예: ${bad[0]})` : ''));
  }

  /* 관측 창구가 사본을 주는가 — 돌려준 원소를 고쳐 본다. */
  {
    let h;
    try { h = await load(t.SRC, t.LIST, Date.now()); }
    catch (e) { return { rc: 2, why: '허브 스크립트를 실행하지 못했다: ' + e.message }; }
    const td = h.sb.window.__td;
    if (!td || typeof td.pick !== 'function') return { rc: 2, why: 'window.__td.pick 을 찾지 못했다' };
    const r1 = td.pick(td.dayKey());
    if (!r1 || !Array.isArray(r1.games) || r1.games.length === 0) return { rc: 2, why: 'pick() 이 게임을 주지 않았다' };
    const victim = r1.games[0];
    const origId = victim.id, origMax = victim.maxMinutes;
    victim.id = 'HACKED'; victim.maxMinutes = 9999;
    const again = td.pick(td.dayKey()).games[0];
    note(again.id === origId && again.maxMinutes === origMax, 'pick-copy',
         `반환 원소를 고친 뒤 다시 불러도 원본 그대로다 — 실측 ${again.id}/${again.maxMinutes} (기대 ${origId}/${origMax})`);
    const v = td.view();
    note(!!v && !v.ids.includes('HACKED'), 'pick-copy-view',
         `내부 상태에 오염이 번지지 않았다 — ids=${v ? v.ids.join(',') : 'null'}`);
  }

  if (!quiet){
    console.log('오늘의 한판 자정·사본 게이트 — 대상 ' + path.resolve(root));
    console.log(`  · 경계 ±${DAYS}일(돌아오기) · ±${BDAYS}일(다시 읽기)`);
    for (const line of say) console.log(line);
    console.log(`결과: 통과 ${say.length - fail} · 미달 ${fail} · 판정 불가 0`);
  }
  return { rc: fail ? 1 : 0 };
}

/* ── 자기시험 — 무엇을 잡는지 스스로 보인다 ────────────────────────────────── */
const MUTATIONS = {
  'refresh-without-rebuild': {
    why: 'refresh 가 다시 짓지 않고 그리기만 한다 — 두 흐름 다 붉어야 한다',
    expect: 1,
    apply: t => t.replace('function refresh(){ rebuildForDay(); render(); }', 'function refresh(){ render(); }'),
  },
  'visibility-render-only': {
    why: '돌아오기만 옛 방식으로 되돌린다 — 흐름 하나만 붉어도 게이트는 미달이다',
    expect: 1,
    apply: t => t.replace("if (!document.hidden && state) refresh();", "if (!document.hidden && state) render();"),
  },
  'button-render-only': {
    why: "'다시 읽기' 만 옛 방식으로 되돌린다 — 나머지 흐름이 초록이어도 잡아야 한다",
    expect: 1,
    apply: t => t.replace("$('btnRefresh').onclick = () => refresh();", "$('btnRefresh').onclick = () => render();"),
  },
  'pick-without-copy': {
    why: 'pick 이 사본 대신 원본 참조를 돌려준다 — 창구 주석이 거짓이 되는 자리다',
    expect: 1,
    apply: t => t.replace('  pick: (dayStr, list) => copy(pickThree(dayStr, copy(list || pool || []))),',
                          '  pick: (dayStr, list) => pickThree(dayStr, (list || pool || []).slice()),'),
  },
  'window-removed': {
    why: '관측 창구를 없앤다 — 통과가 아니라 판정 불가여야 한다',
    expect: 2,
    apply: t => t.replace('window.__td = {', 'window.__NOPE = {'),
  },
};

function stage(root, mutate){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-midnight-'));
  fs.mkdirSync(path.join(dir, 'today'));
  const src = fs.readFileSync(path.join(root, 'today', 'index.html'), 'utf8');
  const out = mutate(src);
  if (out === src) return { dir, injected: false };        /* 앵커 노후화 — 통과로 세지 않는다 */
  fs.writeFileSync(path.join(dir, 'today', 'index.html'), out);
  fs.copyFileSync(path.join(root, 'games.json'), path.join(dir, 'games.json'));
  return { dir, injected: true };
}

if (has('--selftest')){
  console.log('자기시험 — 뮤테이션마다 기대한 rc 가 그대로 나오는지 본다(어긋남 0 · 주입실패 0 이 합격선)');
  let bad = 0, setupFail = 0;
  for (const [name, m] of Object.entries(MUTATIONS)){
    const st = stage(ROOT, m.apply);
    if (!st.injected){
      setupFail++;
      console.log(`  ‽ [${name}] 주입 실패(앵커 노후화) — ${m.why}`);
      fs.rmSync(st.dir, { recursive: true, force: true });
      continue;
    }
    let rc;
    try { rc = (await judge(st.dir, true)).rc; }
    finally { fs.rmSync(st.dir, { recursive: true, force: true }); }
    const ok = rc === m.expect;
    if (!ok) bad++;
    console.log(`  ${ok ? '✓' : '✗'} [${name}] rc=${rc} (기대 ${m.expect}) — ${m.why}`);
  }
  console.log(`자기시험 결과: 어긋남 ${bad} · 주입실패 ${setupFail}`);
  process.exit((bad || setupFail) ? 1 : 0);
}

const r = await judge(ROOT, false);
if (r.rc === 2){ console.error('‽ 판정 불가 — ' + r.why); process.exit(2); }
process.exit(r.rc);
