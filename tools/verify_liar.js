/* 라이어 게임(/liar/) 검증기 — 2026-09-26 · 37번째 게임(오너 선택 · 「여럿이」 분류 넷째)
 *
 * ★이 검사는 제품보다 ★먼저 쓰였다. 제품이 없는 동안에는 rc=2(판정 불가)다 — 통과로 세지 않는다.
 *   탐지력은 `--selftest` 로 따로 증명한다.
 *
 * 이 게임의 약속은 셋이다.
 *   ⓐ ★라이어는 정확히 한 명이고, 기본 모드의 라이어는 ★제시어를 볼 수 없다.
 *   ⓑ 제시어는 ★누르고 있는 동안만 보이고, 손을 떼면 ★화면에서 지워진다(가리는 것이 아니라 비운다).
 *      폰이 손에서 손으로 건너가는 게임이라, 남은 글자는 곧 다음 사람의 엿보기다.
 *   ⓒ 라이어가 지목되면 ★같은 주제 여덟 개 가운데서 제시어를 고르는 역전 기회가 있고, 판정은 화면이 한다.
 *
 * 재는 계약
 *   ① 제시어 표: 주제 8개 이상 · 주제마다 40개 이상 · 한국어는 한글(과 띄어쓰기)만 ·
 *      ★주제 안·주제 사이 겹침 0(한국어·영어 각각) · 빈 칸 0
 *   ② 판 짜기는 순수하다 — 같은 씨앗이면 같은 판 · 난수 호출 0 · 시각 읽기 0
 *   ③ 라이어·첫 발언자는 인원 안에 있고, 8명 판을 400번 짜면 ★모든 자리가 한 번 이상 라이어가 된다
 *   ④ 기본 모드: 라이어 카드에 ★제시어가 없다 · 시민 카드에는 있다
 *   ⑤ 바보 모드: 라이어도 낱말을 받는다 — ★제시어와 다르고 같은 주제다 · 화면에 「라이어」라는 말이 없다
 *   ⑥ 역전 보기: 여덟 개 · 겹침 0 · ★제시어 포함 · 전부 같은 주제
 *   ⑦ 최근에 나온 낱말(기기 저장)은 ★다시 뽑지 않는다
 *   ⑧ 화면 흐름(스텁 DOM): 누르기 전 빈칸 → 누르면 보임 → ★떼면 글자가 비워짐 · 화면이 숨으면 비워짐
 *   ⑨ ★한 번도 보지 않고는 「확인」을 누를 수 없다 · 넘긴 뒤에는 앞사람 카드로 돌아갈 수 없다
 *   ⑩ 지목: 시민을 지목하면 라이어 승(도망) · 라이어를 지목하면 역전 기회 → 맞히면 라이어 승(역전)
 *      · 틀리면 시민 승
 *   ⑪ 판 하나를 끝까지 도는 동안 네트워크 요청 0
 *   ⑫ 인원 단추는 3~8 · 한국어·영어 문구 키가 대칭
 *
 * ★못 보는 것(정직 고지): 낱말이 정말 모두가 아는 말인지, 상표·실존 인물이 아닌지는 사람이 검수한다.
 *   이 검사는 ★겹침·모양·짝이 맞는지까지만 본다. 360px 넘침은 실브라우저에서 따로 잰다.
 *
 * 사용법: node tools/verify_liar.js [--html <경로>] [--selftest] [--list-mutations]
 * 종료코드: 0 통과 · 1 미달 · 2 판정 불가
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ARGV = process.argv.slice(2);
const has = f => ARGV.includes(f);
const valOf = (f, d) => { const i = ARGV.indexOf(f); return i >= 0 && ARGV[i + 1] ? ARGV[i + 1] : d; };
const ROOT = path.resolve(__dirname, '..');
const HTML = path.resolve(valOf('--html', path.join(ROOT, 'liar', 'index.html')));

let pass = 0, fail = 0, indetMsg = null;
const lines = [];
function ok(name, cond, extra){
  if (cond) { pass++; lines.push('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; lines.push('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
  return !!cond;
}
function indet(msg){ indetMsg = msg; }

/* ───────── DOM 스텁 (단어 다리 검증기와 같은 골격) ───────── */
function makeEl(id, doc, tag){
  const el = {
    id: id || '', tagName: String(tag || 'div').toUpperCase(), children: [], parent: null,
    dataset: {}, style: {}, _classes: new Set(), _attrs: {}, _on: {}, _text: '', _html: '',
    hidden: false, disabled: false, value: '', scrollIntoView(){},
  };
  el.classList = {
    add: c => el._classes.add(c), remove: c => el._classes.delete(c),
    contains: c => el._classes.has(c),
    toggle: (c, on) => { if (on === undefined) el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c);
                         else if (on) el._classes.add(c); else el._classes.delete(c); }
  };
  el.setAttribute = (k, v) => { el._attrs[k] = String(v); };
  el.getAttribute = k => (k in el._attrs ? el._attrs[k] : null);
  el.removeAttribute = k => { delete el._attrs[k]; };
  el.hasAttribute = k => k in el._attrs;
  el.addEventListener = (t, fn) => { (el._on[t] = el._on[t] || []).push(fn); };
  el.removeEventListener = t => { delete el._on[t]; };
  el.appendChild = c => { el.children.push(c); c.parent = el; return c; };
  el.append = (...cs) => { for (const c of cs) el.appendChild(c); };
  el.remove = () => { if (el.parent) el.parent.children = el.parent.children.filter(x => x !== el); };
  el._descend = () => { const out = []; (function walk(n){ for (const c of n.children){ out.push(c); walk(c); } })(el); return out; };
  el.querySelectorAll = sel => el._descend().filter(c => matchesSel(c, sel));
  el.querySelector = sel => el.querySelectorAll(sel)[0] || null;
  el.closest = sel => { let n = el; while (n){ if (matchesSel(n, sel)) return n; n = n.parent; } return null; };
  el.matches = sel => matchesSel(el, sel);
  el.focus = () => { doc.activeElement = el; };
  el.blur = () => {};
  el.getBoundingClientRect = () => ({ width: 40, height: 40, top: 0, left: 0, right: 40, bottom: 40 });
  el.dispatch = (type, ev) => {
    const fns = (el._on[type] || []).slice();
    const on = el['on' + type];
    if (typeof on === 'function') fns.push(on);
    const e = Object.assign({ type, target: el, currentTarget: el, timeStamp: 1000,
                              preventDefault(){}, stopPropagation(){} }, ev || {});
    for (const fn of fns) fn(e);
    return fns.length;
  };
  Object.defineProperty(el, 'textContent', { get(){ return el._text; }, set(v){ el._text = String(v); el.children.length = 0; } });
  Object.defineProperty(el, 'innerHTML', { get(){ return el._html; }, set(v){ el._html = String(v); if (v === '') el.children.length = 0; } });
  Object.defineProperty(el, 'className', {
    get(){ return [...el._classes].join(' '); },
    set(v){ el._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  });
  return el;
}
function matchesSel(el, sel){
  if (!sel) return false;
  for (const part of String(sel).split(',')){
    const s = part.trim();
    if (!s) continue;
    if (s === el.tagName.toLowerCase()) return true;
    if (s === '[data-i18n]' && el.dataset.i18n !== undefined) return true;
    if (s.startsWith('.') && el._classes.has(s.slice(1))) return true;
    if (s.startsWith('#') && el.id === s.slice(1)) return true;
  }
  return false;
}
function makeStore(seed){
  const m = new Map(Object.entries(seed || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); },
           removeItem: k => { m.delete(k); }, clear: () => m.clear(), _dump: () => Object.fromEntries(m) };
}
function inlineScript(raw){
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, best = null;
  while ((m = re.exec(raw))){
    if (/\bsrc=/.test(m[1])) continue;
    if (!/window\.__liar/.test(m[2])) continue;
    if (!best || m[2].length > best.length) best = m[2];
  }
  return best;
}
function boot(src, opts){
  opts = opts || {};
  const localStorage = opts.store || makeStore(opts.seedStore);
  const els = new Map();
  const docOn = {};
  const doc = {
    documentElement: null, body: null, activeElement: null, hidden: false, visibilityState: 'visible', title: '',
    readyState: 'complete',
    getElementById: id => { if (!els.has(id)) els.set(id, makeEl(id, doc)); return els.get(id); },
    querySelectorAll: sel => [...els.values()].filter(e => matchesSel(e, sel))
      .concat([...els.values()].flatMap(e => e._descend().filter(c => matchesSel(c, sel)))),
    querySelector: sel => doc.querySelectorAll(sel)[0] || null,
    createElement: t => makeEl('new_' + t, doc, t),
    createDocumentFragment: () => makeEl('frag', doc, 'fragment'),
    addEventListener: (t, fn) => { (docOn[t] = docOn[t] || []).push(fn); },
    removeEventListener: () => {},
    _fire: (t) => { for (const fn of (docOn[t] || [])) fn({ type: t, preventDefault(){} }); }
  };
  doc.documentElement = makeEl('html', doc);
  doc.body = makeEl('body', doc, 'body');
  let rngCalls = 0, fetchCalls = 0, seedCounter = 0;
  const sandbox = {
    document: doc, localStorage, Date, Math: Object.create(Math),
    console: { log(){}, warn(){}, error(){} },
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    navigator: { language: opts.lang === 'en' ? 'en-US' : 'ko-KR', vibrate: () => true },
    matchMedia: () => ({ matches: false, addEventListener(){}, removeEventListener(){} }),
    performance: { now: () => 1000 },
    location: { href: 'https://hanpango.com/liar/', pathname: '/liar/' },
    addEventListener(){}, removeEventListener(){},
    HTMLElement: function(){}, KeyboardEvent: function(){}, PointerEvent: function(){},
    /* ★씨앗은 판마다 달라야 흐름 검사가 여러 판을 본다 — crypto 를 흉내 내되 결정론으로 */
    crypto: { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = (0x9E3779B1 * (++seedCounter + (opts.seedBase || 0))) >>> 0; return a; } },
    fetch: () => { fetchCalls++; return Promise.reject(new Error('no network in harness')); }
  };
  sandbox.Math.random = () => { rngCalls++; return 0.4242424242; };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  let err = null;
  try { vm.createContext(sandbox); new vm.Script(src, { filename: 'liar.js' }).runInContext(sandbox); }
  catch (e) { err = e; }
  return { sandbox, doc, localStorage, err, api: sandbox.__liar,
           rngCalls: () => rngCalls, fetchCalls: () => fetchCalls, $: id => doc.getElementById(id) };
}

/* 단추 모음(#whoPick 등)에서 data-* 값이 v 인 단추를 눌러 준다 — 위임 처리기를 그대로 탄다 */
function clickIn(H, containerId, attr, v){
  const box = H.$(containerId);
  const btn = box.children.find(c => c.getAttribute(attr) === String(v));
  if (!btn) return false;
  box.dispatch('click', { target: btn });
  return true;
}
function click(H, id){ const el = H.$(id); if (el.disabled) return false; el.dispatch('click'); return true; }
const shown = H => (H.$('revealWord').textContent + ' ' + H.$('revealTopic').textContent).trim();

/* ───────── 검사 ───────── */
function run(htmlPath){
  let raw;
  try { raw = fs.readFileSync(htmlPath, 'utf8'); }
  catch (_) { indet(`제품을 읽지 못했다: ${htmlPath} — 아직 없는 단계라면 정상이다(검사가 제품보다 먼저 쓰였다)`); return; }
  const src = inlineScript(raw);
  if (!src) { indet('window.__liar 를 여는 인라인 스크립트를 못 찾았다'); return; }
  const H = boot(src);
  if (H.err) { indet('제품 스크립트가 하네스에서 실행되지 않았다: ' + H.err.message); return; }
  const A = H.api;
  if (!A || typeof A.plan !== 'function' || typeof A.cardFor !== 'function') { indet('관측 창구 window.__liar.plan/cardFor 가 없다'); return; }
  const TOPICS = A.topics;
  const C = A.consts();

  /* ① 제시어 표 */
  {
    const bad = [];
    if (!Array.isArray(TOPICS) || TOPICS.length < 8) bad.push(`주제 ${TOPICS && TOPICS.length}개`);
    const allKo = new Map(), allEn = new Map();
    let total = 0;
    for (const t of TOPICS || []){
      if (!t.id || !t.ko || !t.en) bad.push(`주제 이름 빈칸 ${t.id}`);
      if (!Array.isArray(t.words) || t.words.length < 40) bad.push(`${t.id} ${t.words && t.words.length}개(40 미만)`);
      for (const w of t.words || []){
        total++;
        if (!Array.isArray(w) || w.length !== 2) { bad.push(`${t.id} 짝 모양`); continue; }
        const [ko, en] = w;
        if (!/^[가-힣]+( [가-힣]+)*$/.test(ko || '')) bad.push(`${t.id} 한글 아님 「${ko}」`);
        if (!en || !/^[A-Za-z][A-Za-z' .&-]*[A-Za-z]$/.test(en)) bad.push(`${t.id} 영어 모양 「${en}」`);
        const kk = ko, ek = String(en).toLowerCase();
        if (allKo.has(kk)) bad.push(`한국어 겹침 「${ko}」 ${allKo.get(kk)}/${t.id}`); else allKo.set(kk, t.id);
        if (allEn.has(ek)) bad.push(`영어 겹침 「${en}」 ${allEn.get(ek)}/${t.id}`); else allEn.set(ek, t.id);
      }
    }
    ok('제시어 표 — 주제 8개 이상 · 주제마다 40개 이상 · 한글만 · 겹침 0(한국어·영어 각각)',
       bad.length === 0, bad.length ? bad.slice(0, 4).join(' · ') : `주제 ${TOPICS.length}개 · 낱말 ${total}개`);
  }

  const tIdx = k => TOPICS.findIndex(t => t.id === k);
  const firstKey = TOPICS[0].id;

  /* ② 순수성 */
  {
    const a = JSON.stringify(A.plan(12345, 5, firstKey, 'basic', []));
    const b = JSON.stringify(A.plan(12345, 5, firstKey, 'basic', []));
    ok('같은 씨앗·같은 설정이면 같은 판이다', a === b);
    const before = H.rngCalls();
    for (let s = 1; s <= 50; s++) A.plan(s, 6, 'mix', 'fool', []);
    ok('판을 짜는 데 Math.random 을 당기지 않는다(씨앗 발생기만 쓴다)', H.rngCalls() === before, `호출 ${H.rngCalls() - before}회`);
    ok('판을 짜는 함수에 시각 읽기가 없다',
       !/Date\s*\.\s*now|new\s+Date\s*\(|performance\s*\.\s*now|Math\s*\.\s*random/.test(String(A.planSrc())));
  }

  /* ③ 라이어·첫 발언자 범위 · 모든 자리가 라이어가 된다 */
  {
    const bad = [];
    for (let n = C.PLAYERS_MIN; n <= C.PLAYERS_MAX; n++){
      for (let s = 1; s <= 300; s++){
        const p = A.plan(s * 7919, n, 'mix', s % 2 ? 'basic' : 'fool', []);
        if (!(p.liar >= 0 && p.liar < n && Number.isInteger(p.liar))) bad.push(`n=${n} liar=${p.liar}`);
        if (!(p.first >= 0 && p.first < n && Number.isInteger(p.first))) bad.push(`n=${n} first=${p.first}`);
      }
    }
    ok('라이어·첫 발언자는 언제나 인원 안의 한 자리다', bad.length === 0, bad.slice(0, 3).join(', '));
    const seats = new Set();
    for (let s = 1; s <= 400; s++) seats.add(A.plan(s * 104729, 8, 'mix', 'basic', []).liar);
    ok('8명 판을 400번 짜면 모든 자리가 한 번 이상 라이어가 된다', seats.size === 8, `라이어가 된 자리 ${seats.size}/8`);
  }

  /* ④⑤ 카드 */
  {
    const bad = [];
    for (let s = 1; s <= 200; s++){
      const n = 3 + (s % 6);
      const p = A.plan(s * 31337, n, 'mix', 'basic', []);
      const T = TOPICS[tIdx(p.topic)];
      for (const lang of ['ko', 'en']){
        const word = T.words[p.wordIdx][lang === 'ko' ? 0 : 1];
        for (let i = 0; i < n; i++){
          const c = A.cardFor(p, i, lang);
          const txt = (c.word || '') + ' ' + (c.topic || '');
          if (i === p.liar){ if (txt.includes(word)) bad.push(`seed ${s} 라이어 카드에 제시어 「${word}」`); }
          else if (c.word !== word) bad.push(`seed ${s} ${i}번 시민 카드 「${c.word}」≠「${word}」`);
        }
      }
    }
    ok('기본 모드: 라이어 카드에는 제시어가 없고, 시민 카드에는 있다', bad.length === 0, bad.slice(0, 2).join(' · '));

    const bad2 = [];
    for (let s = 1; s <= 200; s++){
      const n = 3 + (s % 6);
      const p = A.plan(s * 7127, n, 'mix', 'fool', []);
      const T = TOPICS[tIdx(p.topic)];
      if (!(p.liarWordIdx >= 0 && p.liarWordIdx < T.words.length)) { bad2.push(`seed ${s} 라이어 낱말 없음`); continue; }
      if (p.liarWordIdx === p.wordIdx) bad2.push(`seed ${s} 라이어 낱말 = 제시어`);
      const lc = A.cardFor(p, p.liar, 'ko'), cc = A.cardFor(p, (p.liar + 1) % n, 'ko');
      if (lc.word !== T.words[p.liarWordIdx][0]) bad2.push(`seed ${s} 라이어 카드 「${lc.word}」`);
      if (lc.topic !== cc.topic) bad2.push(`seed ${s} 주제가 다르다`);
      if (/라이어|liar/i.test((lc.word || '') + (lc.topic || '') + (lc.note || ''))) bad2.push(`seed ${s} 바보 모드 라이어 카드에 「라이어」`);
    }
    ok('바보 모드: 라이어도 같은 주제의 다른 낱말을 받고, 카드에 「라이어」라는 말이 없다', bad2.length === 0, bad2.slice(0, 2).join(' · '));
  }

  /* ⑥ 역전 보기 */
  {
    const bad = [];
    for (let s = 1; s <= 200; s++){
      const p = A.plan(s * 6151, 5, 'mix', s % 2 ? 'basic' : 'fool', []);
      const T = TOPICS[tIdx(p.topic)];
      const ch = p.choices;
      if (!Array.isArray(ch) || ch.length !== C.CHOICES) { bad.push(`seed ${s} 보기 ${ch && ch.length}개`); continue; }
      if (new Set(ch).size !== ch.length) bad.push(`seed ${s} 보기 겹침`);
      if (!ch.includes(p.wordIdx)) bad.push(`seed ${s} 보기에 제시어 없음`);
      if (ch.some(i => !(i >= 0 && i < T.words.length))) bad.push(`seed ${s} 주제 밖 보기`);
    }
    ok(`역전 보기는 ${C.CHOICES}개 · 겹침 0 · 제시어 포함 · 전부 같은 주제`, bad.length === 0, bad.slice(0, 3).join(', '));
  }

  /* ⑦ 최근 낱말 */
  {
    const T = TOPICS[0];
    const recent = [];
    for (let i = 0; i < Math.min(C.RECENT_MAX, T.words.length - C.CHOICES); i++) recent.push(T.id + ':' + i);
    const hit = [];
    for (let s = 1; s <= 200; s++){
      const p = A.plan(s * 2749, 4, T.id, 'basic', recent);
      if (recent.includes(T.id + ':' + p.wordIdx)) hit.push(`seed ${s} → ${p.wordIdx}`);
    }
    ok(`최근에 나온 낱말(${recent.length}개)은 다시 뽑지 않는다`, hit.length === 0, hit.slice(0, 3).join(', '));
  }

  /* ⑫-a 인원 단추 */
  {
    const nums = H.$('whoPick').children.map(c => Number(c.getAttribute('data-n')));
    ok('인원 단추는 3~8이다', JSON.stringify(nums) === JSON.stringify([3, 4, 5, 6, 7, 8]), nums.join(','));
  }

  /* ⑧⑨⑩⑪ 화면 흐름 — 5명 · 기본 모드로 한 판을 끝까지 */
  function playRound(H2, mode, accuseLiar, guessRight){
    const out = { steps: [], bad: [] };
    clickIn(H2, 'whoPick', 'data-n', 5);
    clickIn(H2, 'modePick', 'data-m', mode);
    click(H2, 'btnStart');
    let snap = H2.api.snapshot();
    if (snap.phase !== 'pass') { out.bad.push(`시작 뒤 단계 ${snap.phase}`); return out; }
    const pl = H2.api.currentPlan();
    const T = TOPICS[tIdx(pl.topic)];
    const word = T.words[pl.wordIdx][0];
    for (let i = 0; i < 5; i++){
      snap = H2.api.snapshot();
      if (snap.viewer !== i) out.bad.push(`차례 어긋남 ${snap.viewer}≠${i}`);
      if (shown(H2) !== '') out.bad.push(`${i}번: 누르기 전에 글자가 있다 「${shown(H2)}」`);
      if (!H2.$('btnSeen').disabled) out.bad.push(`${i}번: 보기 전인데 확인 단추가 눌린다`);
      if (click(H2, 'btnSeen') && H2.api.snapshot().viewer !== i) out.bad.push(`${i}번: 안 보고 넘어갔다`);
      H2.$('revealBox').dispatch('pointerdown');
      const seen = shown(H2);
      if (!seen) out.bad.push(`${i}번: 눌렀는데 안 보인다`);
      if (mode === 'basic' && i === pl.liar && seen.includes(word)) out.bad.push(`라이어 화면에 제시어 「${word}」`);
      if (i !== pl.liar && !seen.includes(word)) out.bad.push(`${i}번 시민 화면에 제시어가 없다 「${seen}」`);
      if (mode === 'fool' && i === pl.liar && /라이어/.test(seen)) out.bad.push('바보 모드 라이어 화면에 「라이어」');
      H2.$('revealBox').dispatch('pointerup');
      if (shown(H2) !== '') out.bad.push(`${i}번: 손을 뗐는데 글자가 남았다 「${shown(H2)}」`);
      if (i === 2){
        H2.$('revealBox').dispatch('pointerdown');
        H2.doc.hidden = true; H2.doc.visibilityState = 'hidden'; H2.doc._fire('visibilitychange');
        if (shown(H2) !== '') out.bad.push('화면이 숨었는데 글자가 남았다');
        H2.doc.hidden = false; H2.doc.visibilityState = 'visible';
        H2.$('revealBox').dispatch('pointercancel');
      }
      if (!click(H2, 'btnSeen')) out.bad.push(`${i}번: 보고 나서도 확인 단추가 안 눌린다`);
      /* ★앞사람 카드로 돌아가지 않는다 — 넘긴 직후 차례가 한 칸 올랐는지만 본다.
         (다음 사람 카드를 여기서 미리 열어 보면 ★그 사람이 본 것으로 기록되어 다음 차례의 「보기 전」 검사가
          틀어진다 — 2026-09-26 첫 실행에서 검사기 자신이 그 실수를 했다. 카드 내용은 다음 차례에 잰다.) */
      if (i < 4 && H2.api.snapshot().viewer !== i + 1) out.bad.push(`넘긴 뒤 차례가 ${i + 1} 이 아니다`);
    }
    snap = H2.api.snapshot();
    if (snap.phase !== 'talk') { out.bad.push(`모두 본 뒤 단계 ${snap.phase}`); return out; }
    click(H2, 'btnAccuse');
    const target = accuseLiar ? pl.liar : (pl.liar + 1) % 5;
    clickIn(H2, 'accusePick', 'data-n', target + 1);
    click(H2, 'btnAccuseGo');
    snap = H2.api.snapshot();
    out.afterAccuse = snap.phase;
    if (snap.phase === 'guess'){
      const choice = guessRight ? pl.wordIdx : pl.choices.find(i => i !== pl.wordIdx);
      clickIn(H2, 'guessPick', 'data-i', choice);
      snap = H2.api.snapshot();
    }
    out.result = snap.result;
    out.phase = snap.phase;
    return out;
  }

  {
    const H2 = boot(src, { seedBase: 11 });
    const r = playRound(H2, 'basic', true, false);
    const flowBad = r.bad.filter(b => !/확인 단추|안 보고/.test(b));
    const seenBad = r.bad.filter(b => /확인 단추|안 보고/.test(b));
    const releaseBad = flowBad.filter(b => /글자가 남았다|누르기 전에/.test(b));
    const liarBad = flowBad.filter(b => /라이어 화면에 제시어/.test(b));
    const restBad = flowBad.filter(b => !releaseBad.includes(b) && !liarBad.includes(b));
    ok('누르기 전엔 비어 있고, 손을 떼거나 화면이 숨으면 제시어가 지워진다', releaseBad.length === 0, releaseBad.slice(0, 2).join(' · '));
    ok('화면 흐름에서도 기본 모드 라이어는 제시어를 못 본다', liarBad.length === 0, liarBad.join(' · '));
    ok('한 번도 보지 않고는 확인을 누를 수 없다', seenBad.length === 0, seenBad.slice(0, 2).join(' · '));
    ok('다섯 명이 차례로 보고 나면 설명 단계로 가고, 앞사람 카드로 돌아가지 않는다', restBad.length === 0, restBad.slice(0, 2).join(' · '));
    ok('라이어를 지목하면 역전 기회가 오고, 틀리면 시민이 이긴다',
       r.afterAccuse === 'guess' && r.phase === 'over' && r.result === 'caught', `${r.afterAccuse} → ${r.phase}/${r.result}`);
    ok('판 하나를 끝까지 도는 동안 네트워크 요청이 없다', H2.fetchCalls() === 0, `${H2.fetchCalls()}회`);
  }
  {
    const H3 = boot(src, { seedBase: 23 });
    const r = playRound(H3, 'basic', true, true);
    ok('역전 기회에서 제시어를 맞히면 라이어가 이긴다(역전)', r.afterAccuse === 'guess' && r.result === 'guessed', `${r.afterAccuse} → ${r.result}`);
  }
  {
    const H4 = boot(src, { seedBase: 37 });
    const r = playRound(H4, 'basic', false, false);
    ok('시민을 지목하면 역전 기회 없이 라이어가 이긴다(도망)', r.afterAccuse === 'over' && r.result === 'escaped', `${r.afterAccuse} → ${r.result}`);
  }
  {
    const H5 = boot(src, { seedBase: 51 });
    const r = playRound(H5, 'fool', true, false);
    const fb = r.bad.filter(b => /바보|시민 화면/.test(b));
    ok('바보 모드 화면: 라이어 화면에 「라이어」가 없고 시민은 제시어를 본다', fb.length === 0 && r.phase === 'over', fb.slice(0, 2).join(' · '));
  }
  {
    /* 판을 거듭하면 최근 낱말이 기기에 쌓이고, 쌓인 것은 다음 판에서 안 나온다 */
    const H6 = boot(src, { seedBase: 77 });
    const used = [];
    for (let k = 0; k < 6; k++){
      clickIn(H6, 'topicPick', 'data-t', firstKey);
      click(H6, 'btnStart');
      const pl = H6.api.currentPlan();
      used.push(pl.topic + ':' + pl.wordIdx);
      H6.api.abandonForTest ? H6.api.abandonForTest() : click(H6, 'btnQuit');
    }
    const stored = (() => { try { return JSON.parse(H6.localStorage.getItem('lr.recent') || '[]'); } catch (_) { return []; } })();
    ok('판을 거듭하면 나온 낱말이 기기에 쌓이고 겹치지 않는다',
       new Set(used).size === used.length && used.every(u => stored.includes(u)), `나온 ${used.length} · 저장 ${stored.length}`);
  }

  /* ⑫-b 문구 키 대칭 */
  {
    const k = A.i18nKeys();
    const miss = k.ko.filter(x => !k.en.includes(x)).concat(k.en.filter(x => !k.ko.includes(x)));
    ok('한국어·영어 문구 키가 대칭이다', miss.length === 0, miss.slice(0, 5).join(', '));
  }
}

/* ───────── 자기시험 ───────── */
const MUTATIONS = [
  { name: 'liar-sees-word', why: '기본 모드 라이어 카드에 제시어를 넣는다',
    catches: '기본 모드: 라이어 카드에는 제시어가 없고, 시민 카드에는 있다',
    apply: s => s.replace("return { role: 'liar', word: '', topic: tName, note: T('youAreLiar') };",
                          "return { role: 'liar', word: w, topic: tName, note: T('youAreLiar') };") },
  { name: 'fool-same-word', why: '바보 모드 라이어가 제시어를 그대로 받는다',
    catches: '바보 모드: 라이어도 같은 주제의 다른 낱말을 받고, 카드에 「라이어」라는 말이 없다',
    apply: s => s.replace('var liarWordIdx = mode === \'fool\' ? others[Math.floor(rnd() * others.length)] : -1;',
                          'var liarWordIdx = mode === \'fool\' ? wordIdx : -1;') },
  { name: 'choices-miss-answer', why: '역전 보기에 제시어를 넣지 않는다',
    catches: '역전 보기는 8개 · 겹침 0 · 제시어 포함 · 전부 같은 주제',
    apply: s => s.replace('var choices = [wordIdx];', 'var choices = [others[others.length - 1]];') },
  { name: 'release-keeps-text', why: '손을 떼면 글자를 지우지 않고 가리기만 한다',
    catches: '누르기 전엔 비어 있고, 손을 떼거나 화면이 숨으면 제시어가 지워진다',
    apply: s => s.replace("elRevealWord.textContent = ''; elRevealTopic.textContent = '';",
                          "elRevealWord.style.visibility = 'hidden';") },
  { name: 'recent-ignored', why: '최근에 나온 낱말을 거르지 않는다',
    catches: '최근에 나온 낱말(30개)은 다시 뽑지 않는다',
    apply: s => s.replace('if (recentSet.has(T.id + \':\' + i)) continue;', '') },
  { name: 'rng-in-plan', why: '판을 짜는 자리에서 Math.random 을 당긴다',
    catches: '판을 짜는 데 Math.random 을 당기지 않는다(씨앗 발생기만 쓴다)',
    apply: s => s.replace('function plan(seed, players, topicKey, mode, recent){', 'function plan(seed, players, topicKey, mode, recent){ Math.random();') },
  { name: 'liar-fixed-seat', why: '라이어가 늘 1번 자리다',
    catches: '8명 판을 400번 짜면 모든 자리가 한 번 이상 라이어가 된다',
    apply: s => s.replace('var liar = Math.floor(rnd() * players);', 'var liar = 0; rnd();') },
  { name: 'accuse-anyone-guesses', why: '시민을 지목해도 역전 기회를 준다',
    catches: '시민을 지목하면 역전 기회 없이 라이어가 이긴다(도망)',
    apply: s => s.replace('if (state.accused === state.planned.liar){', 'if (true){') },
  { name: 'seen-without-looking', why: '보지 않고도 확인을 누를 수 있다',
    catches: '한 번도 보지 않고는 확인을 누를 수 없다',
    apply: s => s.replace('if (!state.viewed) return;', '').replace("elSeen.disabled = true;", "elSeen.disabled = false;") },
  { name: 'guess-always-wins', why: '역전 기회에서 무엇을 골라도 라이어가 이긴다',
    catches: '라이어를 지목하면 역전 기회가 오고, 틀리면 시민이 이긴다',
    apply: s => s.replace('finish(idx === state.planned.wordIdx ? \'guessed\' : \'caught\');', "finish('guessed');") },
];

function selftest(){
  let raw;
  try { raw = fs.readFileSync(HTML, 'utf8'); }
  catch (_) { console.log('★판정 불가 — 제품이 아직 없어 자기시험을 세울 수 없다'); return 2; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'liar-selftest-'));
  let mism = 0, inject = 0;
  console.log('라이어 게임 검증기 자기시험 — 뮤테이션 ' + MUTATIONS.length + '종');
  for (const mu of MUTATIONS){
    const mutated = mu.apply(raw);
    if (mutated === raw){ inject++; console.log(`  ★주입 실패  ${mu.name} — 앵커를 못 찾았다`); continue; }
    const p = path.join(dir, mu.name + '.html');
    fs.writeFileSync(p, mutated);
    const r = spawnSync(process.execPath, [__filename, '--html', p], { encoding: 'utf8' });
    const caught = r.status === 1 && r.stdout.includes('✗ ' + mu.catches);
    if (caught) console.log(`  ✓ ${mu.name} — ${mu.why} → 「${mu.catches}」가 잡았다`);
    else { mism++; console.log(`  ✗ ${mu.name} — ${mu.why} → 기대한 규칙이 안 잡았다(rc=${r.status})`); }
  }
  console.log(`\n결과: 어긋남 ${mism} · 주입실패 ${inject}`);
  return inject ? 2 : (mism ? 1 : 0);
}

if (has('--list-mutations')){ for (const m of MUTATIONS) console.log(`${m.name}\t${m.why}\t→ ${m.catches}`); process.exit(0); }
if (has('--selftest')) process.exit(selftest());

console.log('라이어 게임 검증기 — ' + path.relative(ROOT, HTML));
run(HTML);
for (const l of lines) console.log(l);
if (indetMsg){ console.log('\n★판정 불가 — ' + indetMsg); process.exit(2); }
console.log(`\n결과: 통과 ${pass} · 미달 ${fail}`);
process.exit(fail ? 1 : 0);
