/* 공개 카운터 클라이언트 — 방문·판수를 보내고, 화면의 숫자를 채운다.
 *
 * 두 가지만 한다.
 *   window.hpHit(type, game)  한 번 셈해 달라고 알린다(응답을 기다리지 않는다)
 *   window.hpStats()          /api/stats 를 받아 data-hp 속성이 붙은 요소를 채운다
 *
 * ★게임에 영향을 주지 않는다. 이 파일이 통째로 실패해도(차단·오프라인·서버 오류) 게임은
 *   그대로 돌아가고, 채우지 못한 숫자 자리는 조용히 감춘다 — 빈칸이나 '0' 이 남으면
 *   고장 난 화면처럼 보인다.
 */
(() => {
'use strict';

const HIT = '/api/hit';
const STATS = '/api/stats';

/* 보내고 잊는다. sendBeacon 은 페이지를 떠나는 중에도 확실히 나가고 응답을 기다리지 않는다.
   막혔거나 없는 브라우저에서는 keepalive fetch 로 물러선다. 둘 다 실패해도 조용히 넘어간다. */
function send(payload){
  const body = JSON.stringify(payload);
  try {
    if (navigator.sendBeacon){
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(HIT, blob)) return;
    }
  } catch (e){ /* 아래로 물러선다 */ }
  try {
    fetch(HIT, { method: 'POST', body, keepalive: true,
                 headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch (e){ /* 여기서 끝 — 셈 하나 놓치는 것이 게임보다 중하지 않다 */ }
}

window.hpHit = function hpHit(type, game){
  try {
    if (type === 'visit'){
      /* 방문은 한 세션에 한 번만 센다 — 새로고침·페이지 이동마다 세면 방문이 아니라 조회가 된다.
         sessionStorage 를 못 쓰는 환경(사생활 모드 등)에서는 그냥 보낸다. */
      try { if (sessionStorage.getItem('hp.visit')) return; sessionStorage.setItem('hp.visit', '1'); }
      catch (e){ /* 저장을 못 해도 셈은 보낸다 */ }
      send({ type: 'visit' });
      return;
    }
    if (type === 'play' && game) send({ type: 'play', game });
  } catch (e){ /* 절대 밖으로 던지지 않는다 */ }
};

/* 'visits.today' 같은 점 표기로 응답 안을 찾아 들어간다. */
function pick(obj, path){
  let cur = obj;
  for (const key of String(path).split('.')){
    if (cur == null || typeof cur !== 'object' || !(key in cur)) return null;
    cur = cur[key];
  }
  return typeof cur === 'number' ? cur : null;
}

const comma = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

window.hpStats = function hpStats(){
  const nodes = document.querySelectorAll('[data-hp]');
  if (!nodes.length) return;
  fetch(STATS, { headers: { Accept: 'application/json' } })
    .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    .then(data => {
      for (const el of nodes){
        const v = pick(data, el.getAttribute('data-hp'));
        if (v === null){ hide(el); continue; }
        el.textContent = comma(v);
        show(el);
      }
    })
    .catch(() => { for (const el of nodes) hide(el); });
};

/* 숫자를 못 채우면 그 숫자가 들어갈 줄 전체를 감춘다 — '오늘 방문 · 누적' 처럼 알맹이 빠진
   문장이 남지 않도록, data-hp-line 이 가리키는 조상을 감춘다(없으면 자기 자신). */
const lineOf = el => el.closest('[data-hp-line]') || el;
function hide(el){ const l = lineOf(el); l.hidden = true; }
function show(el){ const l = lineOf(el); l.hidden = false; }

/* 화면이 준비되면 한 번 채운다 — 페이지마다 따로 부르지 않아도 되게. */
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', window.hpStats);
else window.hpStats();
})();
