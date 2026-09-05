/* 대문 카드 색 — ★렌더 검사(대리물이 아니라 그려진 값을 잰다).
 *
 * 왜 이 검사가 따로 있어야 하나
 *   선언이 소스에 있다는 것과 그것이 이긴다는 것은 다르다. `@media` 는 명시도를 올리지 않으므로
 *   같은 선택자끼리는 소스에서 뒤에 오는 쪽이 이긴다. 다크 카드 규칙을 라이트보다 앞에 두면
 *   ★선언은 전부 있는데 다크 모드에서 라이트 색이 그려진다 — 2026-09-05 실제로 그랬다.
 *   선언 훑기(check_palette.py 검사1)는 이 결함을 원리적으로 못 본다.
 *
 *   그리고 이 자리는 두 게이트의 배당 틈이다. check_render_parity.mjs 는 머리말에
 *   "가상요소 ::before 는 getBoundingClientRect 가 못 보므로 선언 훑기가 담당한다" 고 고지했는데,
 *   이번 결함이 바로 ::before 의 배경색이었다. ★그러나 치수와 달리 색은 잴 수 있다 —
 *   getComputedStyle(el, '::before') 는 가상요소를 본다. 사각이 아니라 안 세운 검사였다.
 *
 * 어떻게 테마를 바꾸나
 *   파일을 고쳐 만든 사본이 아니라 ★살아 있는 문서의 CSSOM 에서 다크 @media 의 mediaText 를
 *   'all' 로 바꿔 켠다. 규칙의 자리와 순서가 그대로라 ★진짜 캐스케이드가 그대로 재현된다.
 *   (사본을 만들면 순서가 달라질 수 있어 결함을 놓치거나 없는 결함을 만든다.)
 *
 * 쓰는 법 — 대문을 띄운 탭에서 이 파일 내용을 그대로 평가한다. 결과는 JSON.
 *   ok:false 면 mismatches 에 어느 게임의 어느 테마가 무엇으로 그려졌는지 들어 있다.
 */
(async () => {
  const HEX = (s) => {
    const m = s.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return s;
    return '#' + [1, 2, 3].map(i => (+m[i]).toString(16).padStart(2, '0')).join('');
  };

  // 기대값의 출처는 각 게임 페이지의 :root 다 — 대문 소스를 대문으로 채점하지 않는다.
  const rootTokens = (html) => {
    const pick = (block, name) => (block.match(new RegExp(name + '\\s*:\\s*(#[0-9a-fA-F]{6})')) || [])[1];
    const i = html.indexOf(':root{');
    const light = html.slice(i, html.indexOf('}', i));
    const m = html.search(/@media\s*\(prefers-color-scheme:\s*dark\)/);
    const k = html.indexOf(':root{', m);
    const dark = html.slice(k, html.indexOf('}', k));
    return { light: pick(light, '--sig'), dark: pick(dark, '--sig') };
  };

  const games = await fetch('/games.json').then(r => r.json());
  const want = {};
  for (const g of games) {
    want[g.id] = rootTokens(await fetch(g.path).then(r => r.text()));
  }

  // 다크 @media 를 켜고 끄는 스위치 — 문서를 고치지 않고 조건만 뒤집는다.
  const darkRules = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (r.type === CSSRule.MEDIA_RULE && /prefers-color-scheme:\s*dark/.test(r.conditionText || r.media.mediaText)) {
        darkRules.push({ rule: r, was: r.media.mediaText });
      }
    }
  }
  if (!darkRules.length) return JSON.stringify({ ok: false, reason: '다크 @media 를 못 찾았다 — 판정 불가' });

  const read = () => {
    const out = {};
    for (const a of document.querySelectorAll('#grid a.card[href]')) {
      const id = a.getAttribute('href').replace(/^\/|\/$/g, '');
      out[id] = HEX(getComputedStyle(a, '::before').backgroundColor);
    }
    return out;
  };

  const lightSeen = read();
  darkRules.forEach(d => d.rule.media.mediaText = 'all');
  const darkSeen = read();
  darkRules.forEach(d => d.rule.media.mediaText = d.was);
  const restored = read();

  const bad = [];
  for (const id of Object.keys(want)) {
    if (!(id in lightSeen)) { bad.push(`${id}: 대문에 카드가 없다`); continue; }
    if (lightSeen[id] !== want[id].light) bad.push(`${id} 라이트: 그려진 ${lightSeen[id]} != 기대 ${want[id].light}`);
    if (darkSeen[id] !== want[id].dark) bad.push(`${id} 다크: 그려진 ${darkSeen[id]} != 기대 ${want[id].dark}`);
    if (restored[id] !== lightSeen[id]) bad.push(`${id}: 스위치를 되돌린 뒤 값이 달라졌다(${restored[id]})`);
  }
  return JSON.stringify({ ok: bad.length === 0, checked: Object.keys(want).length, mismatches: bad }, null, 1);
})()
