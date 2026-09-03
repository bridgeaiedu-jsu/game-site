/* 오늘의 한판 — 같은 날 재구축 동일성 게이트 (2026-09-04 · T0904-today-net)
 *
 * 무엇을 재는가
 *   [sameday-ids] 같은 날에 몇 번을 다시 지어도 오늘의 3종이 같다.
 *
 * 왜 저장소 안에 있나
 *   이 검사는 원래 `_round/evidence/` 에 있었다. 그 자리에 있으면 이 세션이 끝나는 순간
 *   아무도 부르지 않는다 — 배포 체크리스트를 돌려도 이 축은 보이지 않는다.
 *   ★게이트는 어디에 있느냐가 그 수명을 정한다. 그래서 tools/ 로 들여 DEPLOY.md 에 등재한다.
 *
 * ★무엇이 이 계약을 지키는가 (검사가 겨냥하는 자리)
 *   '같은 날이면 같은 3종' 을 지키는 것은 rebuildForDay 의 같은날 가드가 **아니다**.
 *   가드는 중복 연산과 재할당을 피할 뿐이고, 계약을 지키는 것은 pickThree 의 **날짜 결정론**이다
 *   (씨앗을 dayKey 에서만 뽑고 난수는 그 씨앗의 mulberry32 로만 굴린다).
 *   그래서 이 검사를 붉게 만들려면 결정론을 망가뜨려야 한다. ★다만 가드가 앞에 서 있으면
 *   그 뮤테이션이 관측되지 않으므로(아래 한계 절), 붉히는 뮤테이션은 ★가드 제거와 짝지어 넣는다.
 *
 * ★이 도구가 못 보는 것(정직한 한계)
 *   · 레이아웃·실브라우저 동작을 보지 않는다. DOM 스텁 위에서 window.__td 만 두드린다.
 *   · 날짜가 바뀌었을 때의 재구축은 여기서 재지 않는다 — 그것은 check_today_midnight.mjs 다.
 *   · ★같은날 가드가 앞에서 막는 동안 이 창구로는 결정론을 관측할 수 없다(자기시험으로 실측했다).
 *     가드가 있으면 pickThree 가 다시 돌지 않으므로 씨앗을 망가뜨려도 산출이 그대로다 —
 *     즉 이 검사가 지금 붙잡고 있는 것은 '관측되는 값이 안정하다' 이고, 그것을 만드는 것은
 *     상황에 따라 가드이거나 결정론이다. 그래서 결정론 뮤테이션은 ★가드 제거와 짝지어야
 *     붉어진다(아래 MUTATIONS 의 조합 항목). 걸러지는 길마다 짝을 세우는 것이 규율이다.
 *
 * 사용:
 *   node tools/check_today_sameday.mjs [저장소 경로]
 *   node tools/check_today_sameday.mjs [저장소 경로] --selftest
 * 종료코드: 0 통과 · 1 미달 · 2 판정 불가(대상을 못 읽음·못 실행함)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const ROOT = ARGV.find(a => !a.startsWith('-')) || '.';
const REPEAT = 6;                                  /* 같은 날에 다시 여는 흐름을 몇 번 돌릴 것인가 */

function indet(msg){ console.error('‽ 판정 불가 — ' + msg); process.exit(2); }

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
  return { SRC, LIST, html };
}

const el = () => ({ textContent:'', innerHTML:'', hidden:false, dataset:{}, style:{}, onclick:null,
  classList:{ add(){}, remove(){} }, appendChild(){}, remove(){}, select(){} });

async function boot(SRC, LIST){
  const els = new Map(), listeners = new Map(), store = new Map();
  const sb = {
    console: { log(){}, error(){}, warn(){} },
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
  for (let i = 0; i < 20; i++) await Promise.resolve();     /* boot() 의 await 를 흘려보낸다 */
  return { sb, els, listeners };
}

/* 한 번 판정한다. { rc, runs } 를 돌려준다(rc 2 는 판정 불가). */
async function judge(root, quiet){
  const t = readTarget(root);
  if (t.err) return { rc: 2, why: t.err };
  let ctx;
  try { ctx = await boot(t.SRC, t.LIST); }
  catch (e) { return { rc: 2, why: '허브 스크립트를 실행하지 못했다: ' + e.message }; }
  const td = ctx.sb.window.__td;
  if (!td || typeof td.view !== 'function') return { rc: 2, why: 'window.__td.view 를 찾지 못했다' };
  const v0 = td.view();
  if (!v0 || !Array.isArray(v0.ids) || v0.ids.length === 0) return { rc: 2, why: 'view() 가 오늘의 3종을 주지 않았다' };
  const runs = [v0.ids.join(',')];
  for (let i = 0; i < REPEAT - 1; i++){
    for (const fn of (ctx.listeners.get('visibilitychange') || [])) fn();   /* 탭으로 돌아온다 */
    const btn = ctx.els.get('btnRefresh');
    if (btn && typeof btn.onclick === 'function') btn.onclick();            /* '다시 읽기' 를 누른다 */
    const v = td.view();
    runs.push(v && Array.isArray(v.ids) ? v.ids.join(',') : '(없음)');
  }
  const seen = [...new Set(runs)];
  const ok = seen.length === 1;
  if (!quiet){
    console.log('오늘의 한판 같은날 동일성 게이트 — 대상 ' + path.resolve(root));
    console.log(`  · 같은 날에 ${runs.length}회 다시 지었다(visibilitychange + '다시 읽기' 각 ${REPEAT - 1}회)`);
    console.log('  · 관측된 3종: ' + seen.join(' | '));
    console.log(`  ${ok ? '✓' : '✗'} [sameday-ids] 같은 날에는 몇 번을 다시 지어도 같은 3종이다 — 서로 다른 값 ${seen.length}개`);
    console.log(`결과: 통과 ${ok ? 1 : 0} · 미달 ${ok ? 0 : 1} · 판정 불가 0`);
  }
  return { rc: ok ? 0 : 1, runs, seen };
}

/* ── 자기시험 ────────────────────────────────────────────────────────────────
   ★여섯 뮤테이션이 세 가지를 함께 보여 준다:
     ①붉어야 하는 짝 둘 — 가드를 걷고 결정론을 망가뜨리면 같은 날에도 판이 갈린다(rc=1).
     ②초록이어야 하는 대조군 셋 — 가드만 걷어도 초록이고(결정론이 지킨다),
       결정론만 망가뜨려도 초록이다(가드가 앞에서 막아 ★관측되지 않는다 · 공허 확인).
     ③판정 불가 하나 — 관측 창구가 없으면 통과가 아니라 rc=2 다.
   ★①과 ②를 함께 두는 이유: 붉음만 보이면 무엇이 계약을 지키는지 알 수 없고,
   초록만 보이면 이 검사가 무엇을 잡는지 알 수 없다. */
const rmGuard = t => t.replace('  if (state && state.day === day) return false;', '  /* 가드 제거(뮤테이션) */');
const seedNotDate = t => t.replace("const rng = mulberry32(hashStr('hanpango-today-' + dayStr));",
                                   "const rng = mulberry32(hashStr('hanpango-today-' + dayStr + (globalThis.__mut = (globalThis.__mut|0) + 1)));");
const rngUnseeded = t => t.replace("  const rng = mulberry32(hashStr('hanpango-today-' + dayStr));",
                                   "  const rng = Math.random;");

const MUTATIONS = {
  /* ★붉어야 하는 짝 — 가드가 앞을 막지 않는 상태에서 결정론을 망가뜨린다. */
  'seed-not-from-date+guard-removed': {
    why: '가드를 걷고 씨앗을 날짜 아닌 것에서 뽑는다 — 같은 날에도 판이 갈려야 한다',
    expect: 1, apply: t => seedNotDate(rmGuard(t)),
  },
  'rng-unseeded+guard-removed': {
    why: '가드를 걷고 난수원을 시드 없는 Math.random 으로 바꾼다 — 같은 날에도 판이 갈려야 한다',
    expect: 1, apply: t => rngUnseeded(rmGuard(t)),
  },
  /* ★초록이어야 하는 대조군 — 무엇이 무엇을 지키는지 이 셋이 가른다. */
  'guard-removed': {
    why: '가드만 지운다 — 계약을 지키는 것은 가드가 아니라 결정론이므로 여전히 초록이어야 한다',
    expect: 0, apply: rmGuard,
  },
  'seed-not-from-date': {
    why: '★공허 확인 — 씨앗만 망가뜨린다. 가드가 앞에서 막아 pickThree 가 다시 돌지 않으므로 관측되지 않는다',
    expect: 0, apply: seedNotDate,
  },
  'rng-unseeded': {
    why: '★공허 확인 — 난수원만 바꾼다. 같은 이유로 이 창구에서는 관측되지 않는다',
    expect: 0, apply: rngUnseeded,
  },
  'window-removed': {
    why: '관측 창구를 없앤다 — 통과가 아니라 판정 불가여야 한다',
    expect: 2, apply: t => t.replace('window.__td = {', 'window.__NOPE = {'),
  },
};

function stage(root, mutate){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'today-sameday-'));
  fs.mkdirSync(path.join(dir, 'today'));
  const src = fs.readFileSync(path.join(root, 'today', 'index.html'), 'utf8');
  const out = mutate(src);
  if (out === src) return { dir, injected: false };          /* 앵커 노후화 — 통과로 세지 않는다 */
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
if (r.rc === 2) indet(r.why);
process.exit(r.rc);
