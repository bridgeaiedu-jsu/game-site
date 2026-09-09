/* 하루 경계 = KST 게이트 (2026-09-09 · T0909-daily-kst)
 *
 * 무엇을 재는가
 *   [kst-shape]      일일 도전 보유 게임 ★전수의 dayKey 가 KST(UTC+9) 부품에서 나온다 — 로컬형 잔존 0건.
 *   [no-derive]      회차(dailyNo)가 ★키와 같은 부품(kstParts)에서 파생된다 — 키와 #N 이 다른 날을 가리키지 않는다.
 *   [prev-utc]       prevDayKey 가 ★키 문자열의 UTC 산술이다 — 로컬 new Date(y,m,d) 경유는 UTC+9 초과 시간대에서 이틀 전을 준다.
 *   [pin-save]       일일 저장이 ★시작 시점에 못박은 값(runDay/chalDate)을 쓴다 — 판 도중 경계를 넘어도 다음 날 기록을 먹지 않는다.
 *   [streak-migrate] 스트릭 보유 게임 전수가 ★구 로컬 키 1회 정규화를 갖는다(관용은 스트릭에만).
 *   [done-strict]    완료 잠금(dailyDoneToday 계열)에는 ★관용이 없다 — 있으면 KST 로 넘어간 날의 판이 잠겨 하루를 잃는다.
 *   [kst-dynamic]    ★실행 판정: 각 게임의 dayKey/dailyNo 를 ★TZ 를 강제한 자식 프로세스에서 실제로 불러
 *                    KST 경계 전후 순간의 답을 대조한다(정적 표기가 아니라 ★행동을 잰다).
 *   [migrate-dynamic] ★실행 판정: 구 로컬 키가 든 저장소를 주고 정규화가 실제로 일어나는지 본다.
 *
 * 왜 TZ 를 강제하는가
 *   경계 계약은 ★기계의 시간대와 무관해야 성립한다. 검사 기계가 마침 KST 면 로컬과 KST 가 같아져
 *   어떤 코드를 넣어도 통과한다(공허). 그래서 동적 판정은 TZ=UTC 로 고정한 ★자식 프로세스에서 돈다.
 *
 * 사용법:  node tools/check_daily_boundary.mjs [저장소 경로]
 *          node tools/check_daily_boundary.mjs [저장소 경로] --child-dynamic   (내부용 · 직접 부르지 마라)
 * 종료코드: 0 = 전부 통과 · 1 = 미달 · 2 = ★판정 불가(대상을 못 읽음 — 통과로 세지 않는다)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : '.');
const CHILD = process.argv.includes('--child-dynamic');

const KST = 9 * 3600000;
const say = [];
let fail = 0;
const note = (ok, id, msg) => { say.push(`  ${ok ? '✓' : '✗'} [${id}] ${msg}`); if (!ok) fail++; };
const indet = (why) => { console.log(`판정 불가: ${why}`); process.exit(2); };

/* ── 대상 수집 ─────────────────────────────────────────────── */
function gamesOf(root){
  const out = [];
  for (const name of fs.readdirSync(root, { withFileTypes: true })){
    if (!name.isDirectory()) continue;
    const p = path.join(root, name.name, 'index.html');
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    if (!/function dayKey|function dayKeyKST|function todayKey/.test(src)) continue;
    out.push({ game: name.name, file: p, src });
  }
  return out.sort((a, b) => a.game.localeCompare(b.game));
}

const ALL = gamesOf(ROOT);
if (ALL.length < 20) indet(`경계를 가진 게임을 ${ALL.length}개밖에 못 찾았다(20+ 이어야 한다) — 대상 경로가 맞나`);

/* dayKey 를 가진 것 = 통일 대상 · four/push 는 자기 이름을 쓴다 */
const UNIFIED = ALL.filter(g => /function dayKey\(/.test(g.src));
const FOUR = ALL.find(g => g.game === 'four');
const PUSH = ALL.find(g => g.game === 'push');

/* ── 동적 판정(자식 · TZ 고정) ─────────────────────────────── */
function boundaryUnit(src){
  /* 제품 소스에서 ★경계 부품만 그대로 떼어 온다(사본을 새로 쓰지 않는다 — 재작성은 검증이 아니다) */
  const take = (re) => { const m = src.match(re); return m ? m[0] : null; };
  const epoch = take(/const DAILY_EPOCH = [^\n]*/);
  const pad = take(/const pad2 = [^\n]*/);
  const parts = take(/function kstParts\(d\)\{[^\n]*/);
  const key = take(/function dayKey\(d\)\{[^\n]*/);
  const no = take(/function dailyNo\(d\)\{[^\n]*/);
  /* ★한 줄 꼴을 ★먼저 시도한다 — 여러 줄 꼴을 먼저 두면 다음 '}' 까지 삼켜 남의 함수가 딸려 온다(실측) */
  const prev = take(/function prevDayKey\((?:day|key)\)\{[^\n]*\}[^\n]*/)
            || take(/function prevDayKey\((?:day|key)\)\{(?:[^\n]*\n){1,6}?\}/);
  return { epoch, pad, parts, key, no, prev };
}

if (CHILD){
  /* 자식: TZ 가 고정된 채로 실제 호출 결과를 낸다 */
  const rows = [];
  for (const g of UNIFIED){
    const u = boundaryUnit(g.src);
    if (!u.pad || !u.parts || !u.key){ rows.push({ game: g.game, err: '부품 추출 실패' }); continue; }
    const code = [u.epoch || 'const DAILY_EPOCH = Date.UTC(2026,7,23);', u.pad, u.parts, u.key, u.no || '', u.prev || ''].join('\n');
    const ctx = vm.createContext({});
    try { vm.runInContext(code, ctx, { filename: `${g.game}-boundary.js` }); }
    catch (e){ rows.push({ game: g.game, err: '부품 실행 실패: ' + e.message }); continue; }
    const call = (fn, arg) => vm.runInContext(`${fn}(${arg})`, ctx);
    const r = { game: g.game, keys: [], nos: [] };
    for (const ms of [Date.UTC(2026, 8, 1, 14, 59, 59), Date.UTC(2026, 8, 1, 15, 0, 0),
                      Date.UTC(2026, 8, 1, 15, 0, 1), Date.UTC(2026, 7, 22, 15, 0, 0)]){
      try { r.keys.push(call('dayKey', `new Date(${ms})`)); } catch (e){ r.keys.push('ERR:' + e.message); }
      if (u.no){ try { r.nos.push(call('dailyNo', `new Date(${ms})`)); } catch (e){ r.nos.push('ERR'); } }
    }
    if (u.prev){
      try { r.prev = call('prevDayKey', `'2026-09-01'`); } catch (e){ r.prev = 'ERR:' + e.message; }
    }
    rows.push(r);
  }
  /* 정규화(이행) 실행 판정 — 구 로컬 키를 넣고 실제로 옮겨지는지 본다 */
  const mig = [];
  for (const g of UNIFIED){
    if (!/normalizeStreakOnce/.test(g.src)) continue;
    const u = boundaryUnit(g.src);
    const norm = g.src.match(/\(function normalizeStreakOnce\(\)\{[\s\S]*?\}\)\(\);/);
    const keyName = (g.src.match(/const K = '([A-Za-z0-9.]+)';/) || [])[1];
    if (!norm || !u.pad || !u.parts || !u.key || !keyName){ mig.push({ game: g.game, err: '정규화 부품 추출 실패' }); continue; }
    const NOW = Number(process.env.CDB_NOW);
    const SEED = process.env.CDB_SEED;                 /* 구 로컬 키(자식 TZ 기준 '오늘') */
    const store = { [keyName]: JSON.stringify({ last: SEED, n: 7 }) };
    const sandbox = {
      localStorage: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
      },
      Date: class extends Date {
        constructor(...a){ if (!a.length) super(NOW); else super(...a); }
        static now(){ return NOW; }
      },
    };
    const ctx = vm.createContext(sandbox);
    const code = [u.epoch || '', u.pad, u.parts, u.key, u.no || '', u.prev || '', norm[0]].join('\n');
    try { vm.runInContext(code, ctx, { filename: `${g.game}-migrate.js` }); }
    catch (e){ mig.push({ game: g.game, err: '정규화 실행 실패: ' + e.message }); continue; }
    let after = null;
    try { after = JSON.parse(store[keyName]); } catch (_){ }
    mig.push({ game: g.game, key: keyName, after });
  }
  /* ★전제 보고 — 이 자식의 로컬 날짜와 KST 날짜가 실제로 갈렸는가.
     갈리지 않았으면 이행 표본이 성립하지 않는다 — 부모가 통과로 세지 않고 판정 불가로 올린다. */
  const NOWp = Number(process.env.CDB_NOW || Date.now());
  const dl = new Date(NOWp), dk = new Date(NOWp + 9 * 3600000);
  const localKey = `${dl.getFullYear()}-${String(dl.getMonth() + 1).padStart(2, '0')}-${String(dl.getDate()).padStart(2, '0')}`;
  const kstKey = `${dk.getUTCFullYear()}-${String(dk.getUTCMonth() + 1).padStart(2, '0')}-${String(dk.getUTCDate()).padStart(2, '0')}`;
  process.stdout.write(JSON.stringify({ rows, mig, premise: { localKey, kstKey, tz: process.env.TZ || '(미설정)' } }));
  process.exit(0);
}

/* ── 부모: 정적 판정 ───────────────────────────────────────── */
{
  const bad = [];
  for (const g of UNIFIED){
    const line = (g.src.match(/function dayKey\(d\)\{[^\n]*/) || [''])[0];
    const parts = (g.src.match(/function kstParts\(d\)\{[^\n]*/) || [''])[0];
    if (!parts) bad.push(`${g.game}(kstParts 없음)`);
    else if (!/\+ 9\*3600000/.test(parts) || !/getUTCFullYear/.test(parts)) bad.push(`${g.game}(kstParts 가 UTC+9 부품이 아니다)`);
    if (/d\.getFullYear\(\)|d\.getMonth\(\)|d\.getDate\(\)/.test(line)) bad.push(`${g.game}(dayKey 가 로컬 달력을 읽는다)`);
    if (!/kstParts\(d\)/.test(line)) bad.push(`${g.game}(dayKey 가 kstParts 에서 파생되지 않는다)`);
  }
  note(bad.length === 0, 'kst-shape',
       `dayKey 통일 대상 ${UNIFIED.length}종 전수가 KST 부품에서 나온다 — 어긋난 자리 ${bad.length}건` + (bad.length ? ` (${bad.join(' · ')})` : ''));
}
{
  const bad = [];
  for (const g of UNIFIED){
    const m = g.src.match(/function dailyNo\(d\)\{[^\n]*/);
    if (!m) continue;                       /* 회차 개념이 없는 게임(quick-math)은 대상 아님 */
    if (!/kstParts\(d\)/.test(m[0])) bad.push(`${g.game}(회차가 키와 다른 부품에서 나온다)`);
    if (/d\.getFullYear\(\)/.test(m[0])) bad.push(`${g.game}(회차가 로컬 달력을 읽는다)`);
  }
  const have = UNIFIED.filter(g => /function dailyNo\(d\)\{/.test(g.src)).length;
  note(bad.length === 0, 'no-derive',
       `회차 보유 ${have}종이 키와 ★같은 부품에서 파생된다 — 어긋난 자리 ${bad.length}건` + (bad.length ? ` (${bad.join(' · ')})` : ''));
}
{
  const bad = [];
  let n = 0;
  for (const g of ALL){
    if (!/function prevDayKey\(/.test(g.src)) continue;
    n++;
    const seg = g.src.slice(g.src.indexOf('function prevDayKey('), g.src.indexOf('function prevDayKey(') + 420);
    if (/new Date\(\s*y\s*,\s*m\s*-\s*1\s*,\s*d\s*\)/.test(seg)) bad.push(`${g.game}(로컬 new Date(y,m-1,d) 경유)`);
    if (!/Date\.UTC\([^)]*\)\s*-\s*86400000/.test(seg)) bad.push(`${g.game}(UTC 산술이 아니다)`);
  }
  note(bad.length === 0, 'prev-utc',
       `prevDayKey 보유 ${n}종이 키 문자열의 UTC 산술이다 — 어긋난 자리 ${bad.length}건` + (bad.length ? ` (${bad.join(' · ')})` : ''));
}
{
  /* 저장이 시작 시점 값을 쓰는가 — 저장 줄에서 dayKey()/dailyNo() 를 그 자리에서 부르면 안 된다 */
  const bad = [];
  let n = 0;
  for (const g of ALL){
    const lines = g.src.split(/\r?\n/);
    const pinned = /let runDay|let chalDate|var runDay|runDay = /.test(g.src);
    for (const ln of lines){
      if (!/localStorage\.setItem\([^)]*\.daily'|const rec = \{ date:/.test(ln)) continue;
      if (!/date:/.test(ln)) continue;
      n++;
      if (/date: dayKey\(\)/.test(ln) && pinned) bad.push(`${g.game}(저장 시점 dayKey() 호출)`);
      if (/no: dailyNo\(\)/.test(ln) && pinned) bad.push(`${g.game}(저장 시점 dailyNo() 호출)`);
    }
  }
  note(bad.length === 0, 'pin-save',
       `일일 저장 ${n}자리가 시작 시점에 못박은 값을 쓴다 — 저장 시점 호출 ${bad.length}건` + (bad.length ? ` (${[...new Set(bad)].join(' · ')})` : ''));
}
{
  const need = ALL.filter(g => /'[A-Za-z0-9]+\.streak'/.test(g.src));
  const bad = need.filter(g => !/normalizeStreakOnce/.test(g.src)).map(g => g.game);
  const shallow = need.filter(g => /normalizeStreakOnce/.test(g.src) &&
                                   !(/Object\.assign/.test(g.src) && /이관 대상이 아니다/.test(g.src))).map(g => g.game);
  note(bad.length === 0 && shallow.length === 0, 'streak-migrate',
       `스트릭 보유 ${need.length}종 전수가 구 로컬 키 1회 정규화를 갖는다 — 없는 곳 ${bad.length}건 · 얕은 곳 ${shallow.length}건`
       + (bad.length ? ` (${bad.join(' · ')})` : '') + (shallow.length ? ` (얕음: ${shallow.join(' · ')})` : ''));
}
{
  /* 완료 잠금에 관용이 없어야 한다 — done 판정 줄에 legacy/로컬 키가 끼면 하루를 잃는다 */
  const bad = [];
  for (const g of ALL){
    for (const ln of g.src.split(/\r?\n/)){
      if (!/dailyDoneToday|dailyDoneFor|r\.date !== dayKey\(\)|r\.date === dayKey\(\)/.test(ln)) continue;
      if (/legacy|localDayKey|getFullYear/.test(ln)) bad.push(`${g.game}: ${ln.trim().slice(0, 70)}`);
    }
  }
  note(bad.length === 0, 'done-strict',
       `완료 잠금에 관용이 없다(관용은 스트릭에만) — 관용이 낀 자리 ${bad.length}건` + (bad.length ? ` (${bad[0]})` : ''));
}
{
  const okPush = PUSH && /\+ 9\*3600000/.test(PUSH.src) && /getUTCFullYear/.test(PUSH.src);
  const okFour = FOUR && /9 \* 3600 \* 1000/.test(FOUR.src) && /getUTCFullYear/.test(FOUR.src);
  note(!!(okPush && okFour), 'kst-keepers',
       `먼저 KST 였던 두 자리가 그대로 KST 다 — push ${okPush ? 'OK' : '★깨짐'} · four ${okFour ? 'OK' : '★깨짐'}`);
}

/* ── 부모: 동적 판정(자식을 TZ=UTC 로 돌린다) ───────────────── */
{
  const selfPath = fileURLToPath(import.meta.url);
  const runChild = (tz, nowMs, seed) => {
    const r = spawnSync(process.execPath, [selfPath, ROOT, '--child-dynamic'],
                        { env: { ...process.env, TZ: tz, CDB_NOW: String(nowMs), CDB_SEED: seed },
                          encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    if (r.status !== 0) indet(`동적 판정 자식이 실패했다(TZ=${tz} · rc=${r.status}) — ${(r.stderr || '').slice(0, 300)}`);
    try { return JSON.parse(r.stdout); }
    catch (e){ return indet(`동적 판정 자식의 출력을 읽지 못했다(TZ=${tz}): ` + (r.stdout || '').slice(0, 200)); }
  };
  /* ① 경계 판정 — TZ=UTC 고정(계약은 기계 시간대와 무관해야 한다) */
  const payload = runChild('UTC', Date.UTC(2026, 8, 1, 12, 0, 0), '2026-09-01');
  /* ② 이행 판정 — ★관용이 실제로 필요한 시간대는 UTC+9 를 ★넘는 곳이다.
        서쪽에서는 구 로컬 키가 늘 'KST 오늘/어제' 라 옮길 것이 없다(옮길 필요도 없다 — 스트릭이 그대로 이어진다).
        동쪽(+14)에서는 로컬 날짜가 KST 보다 앞서 ★어느 계열도 아닌 키가 생긴다 — 그때 관용이 일한다. */
  const migPayload = runChild('Pacific/Kiritimati', Date.UTC(2026, 8, 1, 12, 0, 0), '2026-09-02');

  const EXPECT_KEYS = ['2026-09-01', '2026-09-02', '2026-09-02', '2026-08-23'];
  const EXPECT_NOS = [10, 11, 11, 1];
  const bad = [], errs = [];
  for (const row of payload.rows){
    if (row.err){ errs.push(`${row.game}(${row.err})`); continue; }
    row.keys.forEach((k, i) => { if (k !== EXPECT_KEYS[i]) bad.push(`${row.game} 표본${i} ${k} (기대 ${EXPECT_KEYS[i]})`); });
    row.nos.forEach((n, i) => { if (n !== EXPECT_NOS[i]) bad.push(`${row.game} 회차${i} ${n} (기대 ${EXPECT_NOS[i]})`); });
    if (row.prev !== undefined && row.prev !== '2026-08-31') bad.push(`${row.game} prevDayKey ${row.prev} (기대 2026-08-31)`);
  }
  if (errs.length) indet(`동적 판정에서 부품을 못 세운 게임 ${errs.length}종: ${errs.join(' · ')}`);
  note(bad.length === 0, 'kst-dynamic',
       `TZ=UTC 자식에서 ${payload.rows.length}종 × (경계 전·경계·경계 후·기준일) 실제 호출 — 어긋난 답 ${bad.length}건`
       + (bad.length ? ` (${bad.slice(0, 2).join(' / ')})` : ''));

  const pr = migPayload.premise || {};
  if (pr.localKey === pr.kstKey)
    indet(`이행 표본이 성립하지 않았다 — 자식(TZ=${pr.tz})의 로컬 날짜와 KST 날짜가 같다(${pr.localKey}). `
          + '관용이 필요한 상황을 만들지 못했으므로 통과로 세지 않는다');
  const mbad = [], merr = [];
  for (const m of migPayload.mig){
    if (m.err){ merr.push(`${m.game}(${m.err})`); continue; }
    if (!m.after || m.after.last !== pr.kstKey || m.after.n !== 7)
      mbad.push(`${m.game} → ${JSON.stringify(m.after)}`);
  }
  if (merr.length) indet(`정규화 동적 판정에서 부품을 못 세운 게임: ${merr.join(' · ')}`);
  if (migPayload.mig.length === 0) indet('정규화를 가진 게임이 하나도 없다 — 표본 미성립(관측 없음은 통과가 아니다)');
  note(mbad.length === 0, 'migrate-dynamic',
       `TZ=${pr.tz}(로컬 ${pr.localKey} ≠ KST ${pr.kstKey} — ★전제 성립)에서 구 로컬 키(${pr.localKey}·n=7)를 준 저장소가 `
       + `${migPayload.mig.length}종 전수에서 KST 오늘(${pr.kstKey})로 1회 이관되고 n 이 보존됐다 — 어긋난 곳 ${mbad.length}건`
       + (mbad.length ? ` (${mbad.slice(0, 2).join(' / ')})` : ''));
}

console.log(`하루 경계 KST 게이트 — 대상 ${ROOT}`);
console.log(say.join('\n'));
console.log(`결과: 통과 ${say.length - fail} · 미달 ${fail} · 판정 불가 0`);
process.exit(fail ? 1 : 0);
