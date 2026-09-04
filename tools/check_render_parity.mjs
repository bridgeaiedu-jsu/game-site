/* 두 슬롯의 ★렌더된 치수 대조 게이트 · worker(238) · 2026-09-04 · 티켓 T0904-higher-lower
 *
 * 왜 이 도구가 따로 있나 — master(236) 가 밖에서 심은 우회 ③이 뚫었기 때문이다.
 *   verify_higherlower.js 9-A 는 `.hl-cur` 로 시작하며 width/height/font-size/transform/scale 을
 *   선언하는 규칙을 훑는다. 그런데 `.hl-cur .hl-dots i{zoom:1.3}` 은 요소를 실제로 1.3배로
 *   그리면서도 그 목록에 없어 ★rc=0 으로 통과했다. 근인은 명확하다:
 *     ★선언 이름 훑기는 대리물이고, 계약은 ★렌더된 치수다.
 *   금지 목록은 원리적으로 못 닫는다(zoom·padding·border-width·aspect-ratio·inline-size…
 *   계속 는다). 그래서 이 도구는 목록을 늘리는 대신 ★실브라우저가 실제로 세운 치수를 잰다 —
 *   어떤 CSS 수단이든 한 번에 걸린다.
 *
 * 계약 (이 한 문장이 판정의 단일 기준이다)
 *   **같은 값을 두 슬롯에 그렸을 때, 값 그림의 ★칠해지는 말단 요소가 두 슬롯에서 같은 치수로
 *   그려져야 한다.** 종류마다 요소 하나를 골라 재면 '담는 상자'만 보고 '눈이 읽는 것'을 놓친다 —
 *   border-box 에서 겉 상자가 같아도 안쪽이 줄면 채움이 짧아진다(master 236 이 뚫은 자리).
 *   그래서 고르지 않고 하위 요소를 전수로 훑되, ★판정은 말단(자식이 없는 요소)으로 한다.
 *   컨테이너는 칸 폭에 맞춰 줄을 접는 배치 산물이라(좁은 칸에서 점 12개가 두 줄이 된다)
 *   잉크를 바꾸지 않는다 — 지우지 않고 '관측' 줄로 남겨 사람이 보게 한다.
 *   ★못 보는 것과 그 배당(정직 고지 · 2026-09-04 master 236 이 밖에서 심어 확인)
 *     · 가상 요소(::before) — getBoundingClientRect 가 별도 노드로 못 보므로 이 층의 사각이다.
 *       ★그 자리는 verify_higherlower.js 9-A 의 ★선언 훑기가 담당한다(실측: ::before 로 현재
 *       막대를 늘리자 이 게이트는 rc=0, 9-A 는 rc=1 이었다). 두 층을 나눈 설계의 배당이지
 *       우연이 아니다 — 한 층이면 뚫렸다. 그래서 선언 훑기를 지우지 않는다.
 *     · 컨테이너 간격(gap) — 두 층 다 못 본다. ★판정하지 않기로 한 잔여 위험이고,
 *       그 판단은 아래 'cur-dots-gap' 음성 대조군에 박제해 두었다(사유는 그 주석에).
 *   예외는 하나뿐이다 — 숫자(.hl-num)는 길이로 견주는 것이 아니라 ★읽는 값이라 글자 크기
 *   강조를 허용한다. 그 예외는 ★양성 대조군으로도 쓴다: 숫자가 실제로 달라야 이 잣대가
 *   '차이를 볼 수 있다'는 것이 증명된다(안 그러면 전부 같다는 초록이 공허하다).
 *
 * 층 분리 — 선언 훑기(verify 9-A)는 지우지 않는다
 *   그쪽은 브라우저 없이 도는 ★값싼 조기 경보이고, 이쪽은 느리지만 ★계약 자체를 재는 잣대다.
 *   둘은 층이 다르므로 한 도구에 얹지 않는다(하나에 두 계약을 얹으면 그것이 다음 라운드의 병이 된다).
 *
 * 어떻게 재나
 *   Chrome 을 headless 로 띄우고 CDP(Node 22 의 전역 WebSocket)로 붙어, 제품 자신의 경로로
 *   그 종류의 판을 연 뒤(자유 모드 버튼을 눌러 씨앗이 그 종류를 고를 때까지) 두 슬롯에
 *   ★같은 값을 제품의 valueHtml 로 그려 넣고 getBoundingClientRect 를 읽는다.
 *   두 요소가 ★같은 페이지 안에 있으므로 확대율·dpr 은 서로 상쇄된다.
 *
 * ★두 게임을 잰다(2026-09-04 T0904-howmany 에서 확장) — 잣대는 하나이고 계약이 둘이다:
 *   --game higher-lower (기본) · 두 슬롯이 같은 자로 그리는가
 *   --game how-many      · 판 전체에서 도형이 같은 치수로 그려지고,
 *                          ★개수 순서와 ★잉크 넓이 순서가 어긋나지 않는가
 *   --game together      · 한 화면을 반으로 가른 두 자리가 ★같은 판인가(2026-09-05 T0905)
 *   계약들은 한 함수에 얹지 않는다 — 게임마다 재는 것과 판정이 다르다.
 *
 * ★같이 한판(together)의 계약 — 다섯을 각각 판정한다
 *   ①두 절반의 ★누르는 면(버튼)이 같은 치수로 그려진다. 이 게임에서 버튼은 '값 그림'이 아니라
 *     ★손이 닿는 면이라, 한쪽이 크면 그쪽이 유리하다. 그래서 판정 대상은 말단이 아니라 버튼이다.
 *   ②두 사람이 ★손을 대는 면이 중심선에서 같은 거리에 있다(같은 손 거리에서 시작한다).
 *     ★판정은 담는 절반(.tg-half)이 아니라 ★눌리는 면(.tg-press)의 중심으로 한다.
 *     실측(2026-09-05 · master 236 이 밖에서 심어 확인): `.tg-top .tg-press{margin-bottom:120px}`
 *     을 넣어도 절반의 중심은 ★꿈쩍도 안 한다 — 절반은 격자가 잡아 주어 언제나 대칭이고,
 *     움직인 것은 그 안의 버튼이다. 절반으로 재던 판은 18·60·120px 을 전부 통과시켰다
 *     (허용 오차가 아니라 ★미측정이었다). 어제 higher-lower 에서 담는 상자(wrap)를 재고
 *     채움(fill)을 안 재서 뚫린 것과 ★같은 자리이며, 이름만 다른 요소로 다시 온 것이다.
 *     ⇒ 이 계열은 판정을 ★사람이 만지는 말단(누르는 면 · 그 안의 글자)으로 내려야 닫힌다.
 *     ★같은 계열은 층마다 다시 난다 — 절반에서 났고 누르는 면에서 났으면 ★글자에서도 난다.
 *     실제로 났다(master 236 · 같은 날): `.tg-top .tg-lbl{position:relative;top:-12px}` 은
 *     누르는 면이 제자리라 ②를 통과하고, 크기가 그대로라 ⑤도 통과했다 — 크기만 보고 ★자리를
 *     안 봤기 때문이다. 그래서 자리 대조를 ★세 층으로 함께 한다:
 *       ②   누르는 면의 중심선 거리(사람이 손을 대는 면)
 *       ②-b 담는 절반의 중심선 거리(격자가 깨지는 것도 결함이다)
 *       ②-c 대응 글자의 중심선 거리(사람이 눈을 두는 자리)
 *     세 층을 한 번에 닫아 이 계열을 끝낸다 — 한 층만 닫으면 다음에 다른 이름으로 다시 난다.
 *     ★위쪽 절반이 180도 돌아 있어도 '중심선에서의 거리' 로 재면 두 자리가 맞바로 견줘진다
 *     (회전은 축 정렬이고 대칭이라 대응 요소의 거리가 같아야 한다 — 아래 실측이 그 전제다).
 *   ③신호는 ★하나이고, 그 중심이 중심선 위·판 가로 가운데에 있다. 절반마다 따로 그리면 두 그림이
 *     다른 순간에 서고 그 차이가 승패가 된다 — 그래서 '몇 개인가'를 실브라우저에서 센다.
 *   ④★회전이 치수를 보존한다. 위쪽 절반은 180도 돌아 있다. 축 정렬 회전이라 렌더된 폭·높이가
 *     보존된다는 것은 ★가정이므로, 회전을 켠 채와 끈 채 ★두 조합으로 실측해 대조한다
 *     (보존되지 않으면 ①의 대조 자체가 성립하지 않는다 — 전제를 검사로 세운다).
 *   ⑤두 절반의 대응 글자(이름·점수·문구)가 ★같은 크기로 그려진다. 신호가 서는 프레임에 두
 *     문구가 함께 바뀌므로 한쪽 글자만 크면 그쪽이 먼저 알아챈다.
 *     ★판정은 ★렌더된 글자 상자로 한다 — computed font-size 로 재면 안 된다(대리물이다).
 *     실측(2026-09-05): `.tg-half.tg-top{zoom:1.12}` 아래에서 getComputedStyle 의 fontSize 는
 *     양쪽 다 11.52px 로 ★같았는데 렌더된 상자는 16 대 17, 35.2 대 39.4 로 달랐다. 버튼 자신은
 *     width:100%/height:100% 라 줄어든 좌표계에 맞춰 같은 치수로 서므로 ①도 조용했다 —
 *     ★이 우회를 잡는 자리는 오직 '글자 상자'뿐이다(뮤테이션 top-half-zoom 이 이 자리를 짊어진다).
 *   ★판정의 분리(정직 고지): 낱말이 ★같은 짝은 폭·높이를 함께 판정하고, 낱말이 ★다른 짝
 *     (아래쪽/위쪽 · 나/페이스메이커)은 ★높이만 판정하고 폭은 관측으로만 남긴다 — 글자가 다르면
 *     폭이 다른 것이 옳기 때문이다. 낱말이 같은지는 ★측정 시점에 실제로 읽어 확인한다.
 *   ★잰 국면을 못박는다: 대기(wait) 국면에서만 잰다. 국면이 바뀌면 두 자리의 문구가 갈라질 수
 *     있어(연출 구간은 이긴 쪽과 잃은 쪽이 다른 말을 한다) ⑤의 전제가 흔들린다 — 전제를
 *     가정하지 않고 ★국면을 확인한 뒤 재고, 아니면 판정 불가로 올린다.
 *   ★잰 시점: ★판을 시작한 뒤에 잰다 — 판이 도는 동안에만(body.tg-running) 머리줄·광고·본문이
 *     접혀 두 절반이 같은 크기가 된다. 시작 전 화면을 재면 잰 것이 제품의 판이 아니다.
 *
 * 사용법:
 *   node tools/check_render_parity.mjs [--game <이름>] [--html <경로>] [--mutate <이름>] [--list-mutations] [--selftest]
 * 종료코드:
 *   0 = 두 슬롯의 자가 같다(하위 요소 전수 · 숫자 예외는 실제로 달랐다 = 잣대가 살아 있다)
 *   1 = 미달(자가 갈라졌다)
 *   2 = 판정 불가(크롬 없음·구동 실패·종류 도달 실패·측정 불가) — ★통과로 세지 않는다
 */
'use strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const GAME = argOf('--game', 'higher-lower');
if (GAME !== 'higher-lower' && GAME !== 'how-many' && GAME !== 'together'){
  console.error('알 수 없는 게임: ' + GAME + ' (higher-lower | how-many | together)');
  process.exit(2);
}
const HTML = path.resolve(argOf('--html', path.join(__dirname, '..', GAME, 'index.html')));
const MUTATION = argOf('--mutate', null);

/* ---------------------------------------------------------------- 뮤테이션
   ★master(236) 가 밖에서 심어 준 우회를 그대로 가져다 쓴다. zoom 이 이 도구의 존재 이유다. */
const MUTATIONS_HL = {
  'cur-dots-zoom': {
    why: '지금 칸의 점에만 zoom 을 건다(선언 훑기가 못 보던 바로 그 수단)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-dots i{zoom:1.3}\n  .sr-only{'
  },
  'cur-circle-scale': {
    why: '지금 칸의 원에만 transform:scale 을 건다',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-circ{transform:scale(1.3)}\n  .sr-only{'
  },
  'cur-bar-border': {
    why: '지금 칸의 막대 트랙에만 border 를 건다(겉 상자는 같은데 안쪽이 줄어 채움이 짧아진다)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-barwrap{border:5px solid var(--mark)}\n  .sr-only{'
  },
  /* ★음성 대조군 · 이것은 ★붉으면 안 된다.
     전역 box-sizing:border-box 라 인라인 width:v px 가 바깥 상자를 고정하고 padding 은 안으로
     먹는다 — 원의 겉지름이 그대로라 착시가 없다. master(236) 가 우회 후보로 심었다가 스스로
     취소한 건이고, 통과시키는 것이 옳다. 붉어야 할 것만 시험하면 반대 방향(오탐)이 열린 채로
     초록이 된다. */
  'cur-circle-padding': {
    expect: 'quiet',
    why: '지금 칸의 원에 padding 을 건다(border-box 라 겉지름 불변 · ★통과가 옳다)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-circ{padding:6px}\n  .sr-only{'
  },
  /* ★음성 대조군(2) · 잔여 위험을 ★박제한다.
     `.hl-cur .hl-dots{gap:...}` 은 이 게이트도 선언 층도 못 잡는다(master 236 실측).
     ★넣지 않기로 한 판단의 근거: 점의 크기·개수·잉크 총량이 그대로이고 배치만 벌어진다.
     흩어진 배열을 더 많다고 느끼는 효과는 실재하지만, 막대 길이·잉크 넓이처럼 ★순서를
     뒤집는 강도가 아니고 점은 셀 수도 있다. 게이트에 넣으려면 '간격 속성'이라는 또 다른
     ★금지 목록을 들이거나 무대를 전 종류 균등 격자로 바꿔야 하는데, 앞엣것은 우리가 방금
     진단한 병이고 뒤엣것은 이 티켓 밖의 설계 변경이다.
     ★그래서 산문 대신 이 대조군으로 남긴다: 잔여 위험이 '조용하기로 한 것' 임을 못박고,
     전제(잉크·개수 불변)가 깨져 말단이 흔들리는 날에는 자기시험이 붉어 재판단을 강제한다. */
  'cur-dots-gap': {
    expect: 'quiet',
    why: '지금 칸의 점 간격만 벌린다(잉크·개수 불변 · ★판정하지 않기로 한 잔여 위험)',
    from: '  .sr-only{',
    to:   '  .hl-cur .hl-dots{gap:20px}\n  .sr-only{'
  },
  'bar-track-uneven': {
    why: '막대 판의 균등 격자를 도로 벌린다(트랙 폭이 갈라진다)',
    from: '  .hl-stage.hl-even{grid-template-columns:1fr 1fr}',
    to:   '  .hl-stage.hl-even{grid-template-columns:1fr 1.6fr}'
  }
};

/* ---------------------------------------------------------------- 몇 개였지 뮤테이션
   ★이 게임의 계약은 둘이다 — ①판 전체에서 도형이 같은 치수로 그려진다
   ②개수 순서와 잉크 넓이 순서가 어긋나지 않는다. 도형 크기를 흔드는 CSS 수단은
   계속 늘어나므로(zoom·scale·nth-child·padding…) 목록을 늘리지 않고 ★렌더된 치수를 잰다. */
const MUTATIONS_HM = {
  'dots-uneven-size': {
    why: '셋째 도형마다 지름을 키운다(한 판 안에서 도형 크기가 섞인다)',
    from: '  .sr-only{',
    to:   '  .hm-dot:nth-child(3n){width:9%}\n  .sr-only{'
  },
  'dots-scaled-odd': {
    why: '홀수 번째 도형만 확대한다(transform 은 선언 훑기가 못 보던 수단이다)',
    from: '  .sr-only{',
    to:   '  .hm-dot:nth-child(odd){transform:translate(-50%,-50%) scale(1.4)}\n  .sr-only{'
  },
  'late-dots-shrunk': {
    why: '열세 번째부터 도형을 줄인다(개수는 느는데 잉크는 안 늘어 순서가 어긋난다)',
    from: '  .sr-only{',
    to:   '  .hm-dot:nth-child(n+13){width:1%}\n  .sr-only{'
  },
  'dot-zoom-all': {
    why: '모든 도형에 함께 zoom 을 건다(크기 일치·잉크 순서는 지켜지므로 이 게이트는 조용해야 하고, 겹침 여유가 줄어드는 것은 verify_howmany.js 의 겹침 검사가 잡을 자리다)',
    expect: 'quiet',
    from: '  .sr-only{',
    to:   '  .hm-dot{zoom:1.02}\n  .sr-only{'
  },
  'dot-padding': {
    /* ★음성 대조군 · border-box 라 겉지름이 그대로다(안쪽만 먹는다) · 통과가 옳다 */
    expect: 'quiet',
    why: '도형에 padding 을 건다(border-box 라 겉지름 불변 · ★통과가 옳다)',
    from: '  .sr-only{',
    to:   '  .hm-dot{padding:2px}\n  .sr-only{'
  },
  'dot-color-changed': {
    /* ★음성 대조군 · 색은 이 게이트의 계약이 아니다 */
    expect: 'quiet',
    why: '도형 색만 바꾼다(치수·개수 불변 · ★통과가 옳다)',
    from: 'background:var(--mark);transform:translate(-50%,-50%)}',
    to:   'background:var(--sig-ink);transform:translate(-50%,-50%)}'
  }
};

/* ---------------------------------------------------------------- 같이 한판 뮤테이션
   ★이 게임의 계약은 '두 자리가 같은 판인가' 다. 크기·자리·신호·글자 어느 쪽으로도 기울 수 있어
   금지 목록으로는 못 닫는다 — 그래서 여기서도 ★렌더된 치수를 잰다.
   ★음성 대조군을 처음부터 넣는다(붉어야 할 것만 시험하면 반대 방향인 오탐이 열린 채로 초록이 된다). */
const MUTATIONS_TG = {
  'rows-uneven': {
    why: '판의 두 줄 비율을 벌린다(아래쪽 자리가 더 커진다 · 치수와 중심선 거리가 함께 갈라진다)',
    from: 'grid-template-rows:1fr 1fr;gap:10px}',
    to:   'grid-template-rows:1fr 1.4fr;gap:10px}'
  },
  'top-half-zoom': {
    why: '위쪽 절반에만 zoom 을 건다(선언 훑기가 못 보던 수단 · 누르는 면이 커진다)',
    from: '  .sr-only{',
    to:   '  .tg-half.tg-top{zoom:1.12}\n  .sr-only{'
  },
  'top-half-inset': {
    why: '위쪽 절반만 좌우로 밀어 넣는다(누르는 면이 좁아진다)',
    from: '  .sr-only{',
    to:   '  .tg-half.tg-top{padding:0 18px}\n  .sr-only{'
  },
  /* ★master(236) 가 밖에서 심어 뚫은 우회 — 그대로 가져다 쓴다.
     ★작은 값(18px)에서도 걸려야 한다(큰 값만 잡히면 그 사이가 통째로 사각이다). */
  'press-margin-shift': {
    why: '위쪽 누르는 면만 위로 민다(담는 절반은 꿈쩍도 안 한다 · 절반으로 재면 못 본다)',
    from: '  .sr-only{',
    to:   '  .tg-top .tg-press{margin-bottom:18px}\n  .sr-only{'
  },
  /* ★master(236) 가 심은 셋째 겹 — 누르는 면은 제자리인데 그 안의 글자만 밀린다.
     ②(누르는 면)도 ⑤(크기)도 조용했던 자리라 ★②-c(글자의 자리)가 이것을 짊어진다. */
  'label-shift': {
    why: '위쪽 문구만 12px 위로 민다(누르는 면은 제자리 · 크기도 그대로 · 자리만 다르다)',
    from: '  .sr-only{',
    to:   '  .tg-top .tg-lbl{position:relative;top:-12px}\n  .sr-only{'
  },
  'signal-off-center': {
    why: '신호를 중심선에서 내린다(한쪽 사람에게 더 가까워진다)',
    from: '  .sr-only{',
    to:   '  .tg-signal{top:56%}\n  .sr-only{'
  },
  'signal-doubled': {
    why: '신호를 절반마다 하나씩 둔다(둘이 서로 다른 순간에 설 수 있는 바로 그 설계)',
    from: '<div class="tg-signal" id="signal" aria-hidden="true"></div>',
    to:   '<div class="tg-signal" id="signal" aria-hidden="true"></div>\n    <div class="tg-signal" aria-hidden="true"></div>'
  },
  'top-label-bigger': {
    why: '위쪽 문구만 크게 만든다(신호가 서는 프레임에 그쪽이 먼저 알아챈다)',
    from: '  .sr-only{',
    to:   '  #lbl1{font-size:1.9rem}\n  .sr-only{'
  },
  /* ★음성 대조군 · 색은 이 게이트의 계약이 아니다(모양이 말한다) · 통과가 옳다 */
  'signal-color-changed': {
    expect: 'quiet',
    why: '신호 색만 바꾼다(치수·자리·개수 불변 · ★통과가 옳다)',
    from: 'r="46" fill="var(--go)"',
    to:   'r="46" fill="var(--sig-ink)"'
  },
  /* ★음성 대조군(2) · outline 은 배치를 바꾸지 않는다(상자 밖에 그려진다) · 통과가 옳다.
     칠만 바뀌는 변경에 붉으면 이 게이트는 못 쓴다 — 오탐 방향을 함께 못박는다. */
  'press-outline': {
    expect: 'quiet',
    why: '두 버튼에 outline 을 두른다(배치 밖에 그려져 치수 불변 · ★통과가 옳다)',
    from: '  .sr-only{',
    to:   '  .tg-press{outline:6px solid var(--sig)}\n  .sr-only{'
  }
};
const MUTATIONS = GAME === 'how-many' ? MUTATIONS_HM : (GAME === 'together' ? MUTATIONS_TG : MUTATIONS_HL);

if (argv.includes('--list-mutations')){
  for (const [k, v] of Object.entries(MUTATIONS)) console.log(k + '\t' + v.why);
  process.exit(0);
}

const die = (code, msg) => { console.error(msg); process.exit(code); };

/* ---------------------------------------------------------------- 크롬 찾기 */
function findChrome(){
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  ].filter(Boolean);
  for (const c of cands) { try { if (fs.existsSync(c)) return c; } catch(_){} }
  return null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((res, rej) => {
  http.get(url, r => { let b = ''; r.on('data', c => b += c); r.on('end', () => { try { res(JSON.parse(b)); } catch(e){ rej(e); } }); })
      .on('error', rej);
});

/* ---------------------------------------------------------------- 페이지에서 잴 것
   ★같은 값을 두 슬롯에 그리고 잰다. 값이 다르면 그림도 다른 것이 당연해 자를 못 가른다. */
const PROBE = `(async () => {
  const d = document, w = window;
  const rect = el => { if (!el) return null; const r = el.getBoundingClientRect();
                       return { w: +r.width.toFixed(3), h: +r.height.toFixed(3) }; };
  /* ★값 그림의 ★하위 요소를 전수로 훑는다. 종류마다 요소 하나를 골라 재면 '담는 상자'만
     보고 '눈이 읽는 것'을 놓친다 — border-box 에서 겉 상자가 같아도 안쪽이 줄면 채움이 짧아진다
     (master 236 이 .hl-cur .hl-barwrap{border:5px} 로 뚫은 자리다). 고르지 않으면 안 놓친다.
     ★슬롯 자신(#prevVal/#curVal)은 뺀다 — 칸 높이(min-height)는 설계상 다르고 그림의 자가 아니다. */
  const walk = root => [...root.querySelectorAll('*')].map(el => ({
    tag: el.tagName.toLowerCase(),
    cls: el.getAttribute('class') || '',
    leaf: el.children.length === 0,     /* ★칠해지는 말단인가 · 눈이 실제로 읽는 것이다 */
    ...rect(el)
  }));
  const out = { kinds: {}, errors: [] };
  const KINDS = w.__hl.const().KINDS;
  const PROBE_VALUE = { number: 42, bar: 60, dots: 12, circle: 60 };
  for (const kind of KINDS){
    let reached = false;
    for (let t = 0; t < 600; t++){
      d.getElementById('start').classList.add('show');
      d.getElementById('btnStart').click();
      if (w.__hl.state().kind === kind){ reached = true; break; }
    }
    if (!reached){ out.errors.push('종류 ' + kind + ' 에 도달하지 못했다'); continue; }
    const v = PROBE_VALUE[kind];
    if (v === undefined){ out.errors.push('종류 ' + kind + ' 의 표본 값이 없다'); continue; }
    /* ★두 슬롯에 제품 자신의 valueHtml 로 ★같은 값을 그린다 */
    d.getElementById('prevVal').innerHTML = w.__hl.valueHtml(kind, v);
    d.getElementById('curVal').innerHTML = w.__hl.valueHtml(kind, v);
    /* 레이아웃이 확정되게 강제로 한 번 읽는다 */
    void d.body.offsetHeight;
    const prevEls = walk(d.getElementById('prevVal'));
    const curEls  = walk(d.getElementById('curVal'));
    if (!prevEls.length || !curEls.length){ out.errors.push('종류 ' + kind + ' 의 값 그림 요소를 찾지 못했다'); continue; }
    /* ★같은 값을 같은 함수로 그렸으니 두 쪽의 요소 구조가 같아야 한다.
       다르면 사과와 오렌지를 견주는 것이라 ★판정 불가로 올린다(통과가 아니다). */
    const shape = a => a.map(e => e.tag + '.' + e.cls).join('|');
    if (shape(prevEls) !== shape(curEls)){
      out.errors.push('종류 ' + kind + ' 의 두 슬롯 요소 구조가 다르다: ' + shape(prevEls) + ' vs ' + shape(curEls));
      continue;
    }
    out.kinds[kind] = { value: v, even: w.__hl.stageEven(), n: prevEls.length,
                        els: prevEls.map((e, i) => ({ tag: e.tag, cls: e.cls, leaf: e.leaf,
                                                      prev: { w: e.w, h: e.h },
                                                      cur:  { w: curEls[i].w, h: curEls[i].h } })) };
  }
  out.dpr = w.devicePixelRatio;
  return JSON.stringify(out);
})()`;

/* ---------------------------------------------------------------- CDP 로 한 번 재기 */
async function measure(htmlPath){
  const chrome = findChrome();
  if (!chrome) return { fatal: '크롬 계열 브라우저를 찾지 못했다(CHROME_PATH 로 지정할 수 있다)' };
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), GAME + '-parity-'));
  const url = pathToFileURL(htmlPath).href;
  const child = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking', '--mute-audio',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--allow-file-access-from-files', url
  ], { stdio: 'ignore' });
  /* ★고아를 남기지 않는다 — 어떤 경로로 끝나든 죽인다 */
  const kill = () => { try { child.kill('SIGKILL'); } catch(_){}
                       if (process.platform === 'win32' && child.pid){
                         try { spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch(_){}
                       } };
  process.on('exit', kill);
  try {
    /* DevToolsActivePort 파일에서 실제 포트를 읽는다(포트 0 = 크롬이 고른다) */
    const portFile = path.join(profile, 'DevToolsActivePort');
    let port = null;
    for (let t = 0; t < 100 && port === null; t++){
      await sleep(100);
      try { const l = fs.readFileSync(portFile, 'utf8').split('\n'); if (l[0]) port = Number(l[0].trim()); } catch(_){}
    }
    if (!port) return { fatal: '크롬 디버깅 포트를 얻지 못했다(기동 실패)' };

    let target = null;
    for (let t = 0; t < 60 && !target; t++){
      await sleep(100);
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find(x => x.type === 'page' && x.webSocketDebuggerUrl); } catch(_){}
    }
    if (!target) return { fatal: '크롬 페이지 대상을 찾지 못했다' };

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); setTimeout(() => rej(new Error('ws timeout')), 10000); })
      .catch(e => { throw new Error('CDP 접속 실패: ' + e.message); });
    let id = 0;
    const pending = new Map();
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch(_){ return; }
      if (m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
    };
    const send = (method, params) => new Promise((res, rej) => {
      const myId = ++id;
      pending.set(myId, res);
      ws.send(JSON.stringify({ id: myId, method, params }));
      setTimeout(() => { if (pending.has(myId)){ pending.delete(myId); rej(new Error(method + ' 응답 없음')); } }, 30000);
    });
    const evaluate = async expr => {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.result && r.result.exceptionDetails) throw new Error('페이지 예외: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
      return r.result && r.result.result ? r.result.result.value : undefined;
    };

    /* 페이지가 뜨고 관측 창구가 설 때까지 기다린다 */
    const WINDOW_NAME = GAME === 'how-many' ? '__hm' : (GAME === 'together' ? '__tg' : '__hl');
    let ready = false;
    for (let t = 0; t < 100 && !ready; t++){
      await sleep(100);
      try { ready = await evaluate('document.readyState === "complete" && !!window.' + WINDOW_NAME); } catch(_){}
    }
    if (!ready) return { fatal: '페이지가 뜨지 않았거나 관측 창구(' + WINDOW_NAME + ')가 서지 않았다' };

    if (GAME === 'how-many' || GAME === 'together'){
      const res = GAME === 'how-many' ? await measureHowMany(evaluate) : await measureTogether(evaluate);
      try { ws.close(); } catch(_){}
      return res;
    }
    const raw = await evaluate(PROBE);
    try { ws.close(); } catch(_){}
    if (!raw) return { fatal: '측정 결과를 받지 못했다' };
    return JSON.parse(raw);
  } catch (e){
    return { fatal: String(e && e.message ? e.message : e) };
  } finally {
    kill();
    /* ★크롬이 죽는 데 잠깐 걸려 첫 삭제는 잠금에 막힌다(실측: 임시 프로필 2개가 남았다).
       프로세스는 죽었으니 위험은 없지만 쓰레기를 남기지 않는다 — 짧게 물러서서 몇 번 더 시도한다. */
    for (let t = 0; t < 5; t++){
      try { fs.rmSync(profile, { recursive: true, force: true }); break; }
      catch(_){ await sleep(200); }
    }
  }
}

/* ---------------------------------------------------------------- 몇 개였지 측정
   ★한 evaluate 안에서 실시간 수십 초를 기다리지 않는다 — CDP 가 먼저 끊긴다.
     노출이 흐르는 것은 제품의 타이머에 맡기고, Node 쪽에서 짧게 여러 번 물어본다.
   ★상태를 밖에서 밀어 넣지 않는다 — 자유 모드 버튼을 누르고 보기를 진짜 입력 사건으로 누른다. */
async function measureHowMany(evaluate){
  const out = { rounds: [], errors: [], dpr: await evaluate('devicePixelRatio') };
  await evaluate("document.getElementById('btnStart').click(), 1");
  for (let r = 0; r < 8; r++){
    /* 도형이 보이는 국면을 잡는다(제품이 스스로 그 국면에 든다) */
    let seen = null;
    for (let t = 0; t < 60 && !seen; t++){
      const raw = await evaluate(`(() => {
        const st = window.__hm.state();
        if (st.phase !== 'show') return '';
        const dots = [...document.querySelectorAll('#stage .hm-dot')].map(d => {
          const b = d.getBoundingClientRect();
          return { w: +b.width.toFixed(3), h: +b.height.toFixed(3) };
        });
        return JSON.stringify({ round: st.round, n: window.__hm.planNow().rounds[st.round].n, dots });
      })()`);
      if (raw) seen = JSON.parse(raw);
      else await sleep(80);
    }
    if (!seen){ out.errors.push('라운드 ' + (r + 1) + ' 의 노출 국면을 못 잡았다'); return out; }
    if (seen.dots.length !== seen.n){
      out.errors.push('라운드 ' + (r + 1) + ' 에서 그려진 도형 ' + seen.dots.length + '개 != 개수 ' + seen.n);
      return out;
    }
    out.rounds.push(seen);
    /* 보기가 열리기를 기다렸다가 진짜 입력 사건으로 하나 누른다 */
    let asked = false;
    for (let t = 0; t < 60 && !asked; t++){
      asked = await evaluate("window.__hm.state().phase === 'ask'");
      if (!asked) await sleep(80);
    }
    if (!asked){ out.errors.push('라운드 ' + (r + 1) + ' 에서 보기가 열리지 않았다'); return out; }
    if (r < 7){
      await evaluate("document.getElementById('ans0').dispatchEvent(new PointerEvent('pointerdown', { button: 0, bubbles: true })), 1");
    }
  }
  return out;
}

/* ---------------------------------------------------------------- 같이 한판 측정
   ★한 evaluate 안에서 실시간을 기다리지 않는다 — 판이 시작됐는지는 Node 쪽에서 짧게 여러 번 묻고,
     기하 측정은 ★한 evaluate 안에서 통째로 한다(자바스크립트는 한 줄기라 그 안에서는 제품의
     타이머가 끼어들지 못한다 — 문구가 바뀌는 프레임이 측정 중간에 섞이지 않는다).
   ★상태를 밖에서 밀어 넣지 않는다 — 자유 대전 버튼을 진짜로 눌러 판을 시작한다. */
const TG_GEOM = `(() => {
  const d = document, w = window;
  const R = el => { const r = el.getBoundingClientRect();
    return { w: +r.width.toFixed(3), h: +r.height.toFixed(3),
             cx: +(r.left + r.width / 2).toFixed(3), cy: +(r.top + r.height / 2).toFixed(3),
             top: +r.top.toFixed(3), bottom: +r.bottom.toFixed(3) }; };
  /* ★대리물 · 판정에 쓰지 않는다(zoom 아래에서 렌더와 갈라지는 것을 실측했다) */
  const F = el => +parseFloat(getComputedStyle(el).fontSize).toFixed(3);
  /* 대응하는 글자 요소 — 두 자리에 같은 역할로 놓인 것들 */
  const TEXTS = [['name0','name1'],['score0','score1'],['lbl0','lbl1']];
  const out = { errors: [] };
  const el = id => d.getElementById(id);
  const need = ['board','halfTop','halfBottom','press0','press1','signal'];
  for (const id of need) if (!el(id)){ out.errors.push('요소를 찾지 못했다: #' + id); }
  if (out.errors.length) return JSON.stringify(out);
  const settle = () => { void d.body.offsetHeight; };
  const read = () => ({
    press:  { bottom: R(el('press0')), top: R(el('press1')) },
    half:   { bottom: R(el('halfBottom')), top: R(el('halfTop')) },
    board:  R(el('board')),
    signals: [...d.querySelectorAll('.tg-signal')].map(R),
    fonts:  TEXTS.map(([a, b]) => ({ role: a.replace(/0$/, ''), bottom: F(el(a)), top: F(el(b)) })),
    /* ★판정에 쓰는 자 — 낱말이 같으면 폭·높이 · 다르면 높이만(폭은 관측) */
    textBoxes: TEXTS.map(([a, b]) => ({ role: a.replace(/0$/, ''),
                                        bottom: R(el(a)), top: R(el(b)),
                                        words: [el(a).textContent, el(b).textContent] }))
  });
  settle();
  out.on = read();                       /* ④회전을 켠 채 */
  /* ★회전 유무 두 조합 — 180도가 축 정렬이라 w/h 를 보존한다는 것을 ★가정하지 않고 잰다 */
  const half = el('halfTop');
  const prevT = half.style.transform;
  half.style.transform = 'none'; settle();
  out.off = read();                      /* ④회전을 끈 채 */
  half.style.transform = prevT; settle();
  out.rotatedFlags = w.__tg.rotated();   /* [아래쪽이 돌았나, 위쪽이 돌았나] */
  out.phase = w.__tg.state().phase;      /* ★잰 국면을 기록한다(⑤의 전제) */
  out.signalCountTg = w.__tg.signalCount();
  /* ★양성 대조군 셋 · 판정에 쓰는 자 셋이 각각 ★차이를 볼 수 있음을 증명한다.
     이것이 없으면 '전부 같다'는 초록이 '아무것도 못 재고 있다'와 구별되지 않는다. */
  out.alive = {};
  const p1 = el('press1'), pw = p1.style.width;
  p1.style.width = '60%'; settle();
  out.alive.size = R(p1); p1.style.width = pw; settle();
  const board = el('board'), bp = board.style.paddingTop;
  board.style.paddingTop = '48px'; settle();
  out.alive.shift = { half: { bottom: R(el('halfBottom')), top: R(el('halfTop')) },
                      signal: R(el('signal')) };
  board.style.paddingTop = bp; settle();
  /* ★②의 새 자(누르는 면의 중심)가 살아 있는지 — 뮤테이션과 같은 수단으로 매 실행 증명한다 */
  const pm = p1.style.marginBottom;
  p1.style.marginBottom = '24px'; settle();
  out.alive.press = R(p1); p1.style.marginBottom = pm; settle();
  const l1 = el('lbl1'), lf = l1.style.fontSize;
  l1.style.fontSize = '2.5rem'; settle();
  out.alive.font = F(l1); out.alive.lbl = R(l1); l1.style.fontSize = lf; settle();
  /* ★②-c 의 자(글자의 자리)가 살아 있는지 — 뮤테이션과 같은 수단으로 매 실행 증명한다 */
  const lp = l1.style.position, lt = l1.style.top;
  l1.style.position = 'relative'; l1.style.top = '-16px'; settle();
  out.alive.lblPos = R(l1);
  l1.style.position = lp; l1.style.top = lt; settle();
  /* ★건드린 것을 되돌렸는지 스스로 확인한다 — 되돌리지 못했으면 판정 불가로 올린다 */
  out.after = read();
  out.dpr = w.devicePixelRatio;
  return JSON.stringify(out);
})()`;

async function measureTogether(evaluate){
  const out = { errors: [] };
  /* ★판을 시작한 뒤에 잰다 — 판이 도는 동안에만 머리줄·광고가 접혀 두 절반이 같은 크기다 */
  await evaluate("document.getElementById('btnVersus').click(), 1");
  let ready = false;
  for (let t = 0; t < 60 && !ready; t++){
    /* ★대기 국면에서 잰다 — 그 국면에서만 두 자리의 문구가 같은 말을 한다(⑤의 전제) */
    try { ready = await evaluate("window.__tg.running() && window.__tg.state().phase === 'wait'"); } catch(_){}
    if (!ready) await sleep(80);
  }
  if (!ready){ out.errors.push('판이 대기 국면으로 서지 않았다(body.tg-running + phase=wait)'); return out; }
  const raw = await evaluate(TG_GEOM);
  if (!raw){ out.errors.push('측정 결과를 받지 못했다'); return out; }
  const geom = JSON.parse(raw);
  if (geom.errors && geom.errors.length) return { errors: geom.errors };
  return geom;
}

/* ★같이 한판 판정 — 계약 다섯을 각각 판정하고, 어느 쪽이 깨졌는지 이름을 대서 적는다. */
function judgeTogether(res, target){
  const out = [];
  const near = (a, b) => Math.abs(a - b) <= TOL;
  const on = res.on, off = res.off;
  if (!on || !off) return { rc: 2, lines: ['판정 불가 · 측정이 비었다'] };
  out.push('대상 ' + target);
  out.push('devicePixelRatio ' + res.dpr + ' · 허용 오차 ' + TOL + 'px · ★판이 도는 동안(body.tg-running) 잰다');
  out.push('  (관측) 회전 상태 [아래, 위] = ' + JSON.stringify(res.rotatedFlags) + ' · 잰 국면 ' + res.phase);
  if (res.phase !== 'wait') return { rc: 2, lines: out.concat(['판정 불가 · 대기 국면이 아닌 ' + res.phase + ' 에서 쟀다(⑤의 전제가 선다는 보장이 없다)']) };

  /* ①누르는 면의 치수 */
  const pb = on.press.bottom, pt = on.press.top;
  const sizeSame = near(pb.w, pt.w) && near(pb.h, pt.h);
  out.push('  ' + (sizeSame ? '✓' : '✗') + ' ①두 절반의 누르는 면이 같은 치수다 · 아래 ' +
           pb.w + 'x' + pb.h + ' · 위 ' + pt.w + 'x' + pt.h +
           ' · 차이 ' + Math.abs(pb.w - pt.w).toFixed(3) + 'x' + Math.abs(pb.h - pt.h).toFixed(3));

  /* ②중심선에서의 거리 — 중심선은 두 절반 사이의 틈 한가운데다.
     ★판정은 ★눌리는 면으로 한다(담는 절반은 격자가 잡아 주어 언제나 대칭이라 아무것도 못 본다).
     절반의 중심도 ★함께 판정한다 — 격자가 깨지는 것도 결함이기 때문이다. */
  const line = +(((on.half.top.bottom) + (on.half.bottom.top)) / 2).toFixed(3);
  const pdTop = Math.abs(pt.cy - line), pdBot = Math.abs(pb.cy - line);
  const pressSame = near(pdTop, pdBot);
  const hdTop = Math.abs(on.half.top.cy - line), hdBot = Math.abs(on.half.bottom.cy - line);
  const halfSame = near(hdTop, hdBot);
  const distSame = pressSame && halfSame;
  out.push('  ' + (pressSame ? '✓' : '✗') + ' ②두 사람이 ★손을 대는 면이 중심선에서 같은 거리다 · 중심선 y=' + line +
           ' · 위 ' + pdTop.toFixed(3) + ' · 아래 ' + pdBot.toFixed(3) +
           ' · 차이 ' + Math.abs(pdTop - pdBot).toFixed(3));
  out.push('  ' + (halfSame ? '✓' : '✗') + ' ②-b 담는 절반도 중심선에서 같은 거리다(격자) · 위 ' +
           hdTop.toFixed(3) + ' · 아래 ' + hdBot.toFixed(3) + ' · 차이 ' + Math.abs(hdTop - hdBot).toFixed(3) +
           (pressSame && !halfSame ? ' ← 격자가 깨졌다' : '') +
           (!pressSame && halfSame ? ' ← ★절반은 대칭인데 누르는 면이 밀렸다(절반으로만 재면 못 보는 자리)' : ''));

  /* ②-c 대응 글자의 중심선 거리 — 사람이 눈을 두는 자리다.
     ★크기(⑤)와 자리(②-c)는 다른 계약이다. 크기가 같아도 한쪽 글자만 밀려 있으면
     시선이 가는 자리가 달라진다(master 236 이 .tg-top .tg-lbl{top:-12px} 로 뚫은 자리). */
  const textPos = (on.textBoxes || []).map(t => ({
    role: t.role,
    dBottom: +Math.abs(t.bottom.cy - line).toFixed(3),
    dTop: +Math.abs(t.top.cy - line).toFixed(3)
  }));
  const textPosBad = textPos.filter(t => !near(t.dBottom, t.dTop));
  const textPosOk = textPos.length === 3 && textPosBad.length === 0;
  out.push('  ' + (textPosOk ? '✓' : '✗') + ' ②-c 대응 글자가 중심선에서 같은 거리다 · ' +
           textPos.map(t => t.role + ' 아래 ' + t.dBottom + ' · 위 ' + t.dTop).join(' / '));
  for (const t of textPosBad)
    out.push('      ✗ ' + t.role + ' 의 자리가 다르다 · 아래 ' + t.dBottom + ' · 위 ' + t.dTop +
             ' · 차이 ' + Math.abs(t.dBottom - t.dTop).toFixed(3) + 'px(누르는 면은 제자리여도 글자만 밀릴 수 있다)');

  /* ③신호는 하나이고 중심선 위·판 가로 가운데에 있다 */
  const sigs = on.signals || [];
  const oneSignal = sigs.length === 1 && res.signalCountTg === 1;
  const sig = sigs[0] || null;
  const sigOnLine = !!sig && near(sig.cy, line);
  const sigCentered = !!sig && near(sig.cx, on.board.cx);
  const sigOk = oneSignal && sigOnLine && sigCentered;
  out.push('  ' + (sigOk ? '✓' : '✗') + ' ③신호는 하나이고 중심선 위·판 가로 가운데에 있다 · 개수 ' +
           sigs.length + '(창구 ' + res.signalCountTg + ')' +
           (sig ? ' · 중심 (' + sig.cx + ', ' + sig.cy + ') · 판 가로 가운데 ' + on.board.cx +
                  ' · 중심선 ' + line : ' · 신호를 찾지 못했다'));
  if (sig && !sigOnLine) out.push('      ✗ 신호 중심이 중심선에서 ' + Math.abs(sig.cy - line).toFixed(3) + 'px 벗어났다');
  if (sig && !sigCentered) out.push('      ✗ 신호 중심이 판 가로 가운데에서 ' + Math.abs(sig.cx - on.board.cx).toFixed(3) + 'px 벗어났다');

  /* ④회전이 치수를 보존한다 — ①의 전제를 검사로 세운다 */
  const rotPairs = [['위 버튼', on.press.top, off.press.top], ['아래 버튼', on.press.bottom, off.press.bottom],
                    ['위 절반', on.half.top, off.half.top], ['아래 절반', on.half.bottom, off.half.bottom]];
  const rotBad = rotPairs.filter(([, a, b]) => !near(a.w, b.w) || !near(a.h, b.h));
  const rotOk = rotBad.length === 0;
  out.push('  ' + (rotOk ? '✓' : '✗') + ' ④회전이 치수를 보존한다(회전 유·무 두 조합 실측) · 어긋난 자리 ' + rotBad.length + '개');
  for (const [n, a, b] of rotBad) out.push('      ✗ ' + n + ' 회전 ' + a.w + 'x' + a.h + ' · 회전 끔 ' + b.w + 'x' + b.h);

  /* ⑤대응 글자가 같은 크기로 그려진다 — ★렌더된 상자로 판정한다(computed font-size 는 대리물이다).
     낱말이 같은 짝은 폭·높이를, 다른 짝은 높이만 판정한다(낱말이 다르면 폭이 다른 것이 옳다). */
  const boxes = on.textBoxes || [];
  if (boxes.length !== 3) return { rc: 2, lines: out.concat(['판정 불가 · 대응 글자 짝이 ' + boxes.length + '개다(3개여야 한다)']) };
  const textBad = [];
  for (const t of boxes){
    const sameWord = t.words[0] === t.words[1];
    const badH = !near(t.bottom.h, t.top.h);
    const badW = sameWord && !near(t.bottom.w, t.top.w);
    if (badH || badW) textBad.push({ t, sameWord, badH, badW });
  }
  const textOk = textBad.length === 0;
  out.push('  ' + (textOk ? '✓' : '✗') + ' ⑤두 절반의 대응 글자가 같은 크기로 그려진다(★렌더된 상자) · ' +
           boxes.map(t => t.role + ' ' + t.bottom.w + 'x' + t.bottom.h + '/' + t.top.w + 'x' + t.top.h +
                          (t.words[0] === t.words[1] ? ' [같은 낱말 · 폭도 판정]' : ' [다른 낱말 · 높이만 판정]')).join(' · '));
  for (const b of textBad)
    out.push('      ✗ ' + b.t.role + ' 아래 ' + b.t.bottom.w + 'x' + b.t.bottom.h + ' · 위 ' + b.t.top.w + 'x' + b.t.top.h +
             ' · 낱말 ' + JSON.stringify(b.t.words) + ' · ' + [b.badH ? '높이가 다르다' : null, b.badW ? '같은 낱말인데 폭이 다르다' : null].filter(Boolean).join(' / '));
  /* ★대리물은 판정하지 않고 관측으로만 남긴다 — 그리고 렌더와 갈라지면 그 사실을 적는다.
     (zoom 아래에서 이 값은 같은데 상자는 달랐다 · 이것이 이 게이트가 선언을 안 믿는 이유다) */
  for (const f of (on.fonts || [])){
    const t = boxes.find(x => x.role === f.role);
    const rendered = t && (!near(t.bottom.h, t.top.h) || (t.words[0] === t.words[1] && !near(t.bottom.w, t.top.w)));
    out.push('      (관측 · 판정 아님) ' + f.role + ' computed font-size 아래 ' + f.bottom + 'px · 위 ' + f.top + 'px' +
             (near(f.bottom, f.top) && rendered ? ' ← ★선언은 같은데 렌더된 상자는 달랐다(대리물이 못 보는 자리)' : ''));
  }
  for (const t of boxes){
    if (t.words[0] === t.words[1] || near(t.bottom.w, t.top.w)) continue;
    out.push('      (관측) ' + t.role + ' 의 폭이 다르다 · 아래 ' + t.bottom.w + ' · 위 ' + t.top.w +
             ' · 낱말 ' + JSON.stringify(t.words) + ' · 낱말이 달라 폭이 다른 것이 옳다(판정에 넣지 않는다)');
  }

  /* ★되돌림 확인 — 양성 대조군이 판을 오염시킨 채 끝났으면 위의 판정 자체가 못 믿을 것이 된다 */
  const after = res.after;
  const restored = !!after && near(after.press.top.w, on.press.top.w) && near(after.press.top.h, on.press.top.h) &&
                   near(after.press.top.cy, on.press.top.cy) &&
                   near(after.signals[0] ? after.signals[0].cy : -1, sig ? sig.cy : -2) &&
                   near(after.textBoxes[2].top.h, boxes[2].top.h) &&
                   near(after.textBoxes[2].top.cy, boxes[2].top.cy);
  if (!restored) return { rc: 2, lines: out.concat(['판정 불가 · 양성 대조군이 건드린 것을 되돌리지 못했다']) };

  /* ★양성 대조군 셋 · 판정에 쓰는 자가 각각 차이를 볼 수 있다는 증명 */
  const aliveSize = !!res.alive && Math.abs(res.alive.size.w - pt.w) > TOL;
  const shift = res.alive && res.alive.shift;
  const line2 = shift ? (shift.half.top.bottom + shift.half.bottom.top) / 2 : null;
  const aliveShift = !!shift && Math.abs(shift.signal.cy - line2) > TOL;
  const aliveFont = !!res.alive && !!res.alive.lbl && Math.abs(res.alive.lbl.h - boxes[2].top.h) > TOL;
  const alivePress = !!res.alive && !!res.alive.press && Math.abs(res.alive.press.cy - pt.cy) > TOL;
  const aliveLblPos = !!res.alive && !!res.alive.lblPos && Math.abs(res.alive.lblPos.cy - boxes[2].top.cy) > TOL;
  out.push('  [양성 대조군] 치수 자: 위 버튼을 60% 로 줄이자 달라졌는가 ' + (aliveSize ? '그렇다' : '★아니다') +
           ' · 자리 자(신호): 판을 48px 내리자 신호가 중심선에서 벗어났는가 ' + (aliveShift ? '그렇다' : '★아니다') +
           ' · 자리 자(누르는 면): 위 버튼에 margin-bottom:24px 를 주자 중심이 움직였는가 ' + (alivePress ? '그렇다' : '★아니다') +
           ' · 글자 자(크기): 위 문구를 2.5rem 로 키우자 달라졌는가 ' + (aliveFont ? '그렇다' : '★아니다') +
           ' · 글자 자(자리): 위 문구를 16px 올리자 중심이 움직였는가 ' + (aliveLblPos ? '그렇다' : '★아니다'));
  if (!(aliveSize && aliveShift && alivePress && aliveFont && aliveLblPos))
    return { rc: 2, lines: out.concat(['판정 불가 · 잣대가 차이를 못 본다(양성 대조군 실패)']) };

  const broken = [!sizeSame ? '①치수' : null, !pressSame ? '②누르는 면의 중심선 거리' : null, !halfSame ? '②-b 격자 대칭' : null, !textPosOk ? '②-c 글자의 자리' : null, !sigOk ? '③신호' : null,
                  !rotOk ? '④회전 보존' : null, !textOk ? '⑤글자 상자' : null].filter(Boolean);
  if (broken.length) return { rc: 1, lines: out.concat(['미달 · ' + broken.join(' / ') + ' 가 어긋났다']) };
  return { rc: 0, lines: out.concat(['통과 · 두 자리는 세 층(절반·누르는 면·글자) 모두 같은 거리이고, 누르는 면은 같은 치수이며, 신호는 가운데 하나이며, 회전이 치수를 보존하고 글자가 같은 크기로 그려진다']) };
}

/* ---------------------------------------------------------------- 판정 */
const TOL = 0.5;                 /* 서브픽셀 허용 오차(px) */
const EXEMPT_KIND = 'number';    /* ★유일한 예외 · 길이가 아니라 읽는 값이다 */

/* ★몇 개였지 판정 — 계약 둘을 각각 판정하고, 어느 쪽이 깨졌는지 이름을 대서 적는다. */
function judgeHowMany(res, target){
  const out = [];
  const rounds = res.rounds || [];
  if (rounds.length !== 8) return { rc: 2, lines: ['판정 불가 · 잰 라운드가 ' + rounds.length + '개다(8개여야 한다)'] };
  out.push('대상 ' + target);
  out.push('devicePixelRatio ' + res.dpr + ' · 허용 오차 ' + TOL + 'px · 여덟 라운드를 실제로 치르며 잰다');
  /* ①판 전체에서 도형이 같은 치수로 그려진다 — 라운드 안에서도, 라운드 사이에서도 */
  const all = [];
  for (const r of rounds) for (const d of r.dots) all.push(d);
  const wMin = Math.min(...all.map(d => d.w)), wMax = Math.max(...all.map(d => d.w));
  const hMin = Math.min(...all.map(d => d.h)), hMax = Math.max(...all.map(d => d.h));
  const sameSize = (wMax - wMin) <= TOL && (hMax - hMin) <= TOL;
  out.push('  ' + (sameSize ? '✓' : '✗') + ' 판 전체에서 도형이 같은 치수로 그려진다 · 도형 ' + all.length +
           '개 · 폭 ' + wMin.toFixed(3) + '~' + wMax.toFixed(3) + ' · 높이 ' + hMin.toFixed(3) + '~' + hMax.toFixed(3));
  /* ②개수 순서와 잉크 넓이 순서가 어긋나지 않는다 — 칠해지는 말단(도형)의 넓이 합으로 잰다 */
  const ink = rounds.map(r => ({ round: r.round + 1, n: r.n,
                                 area: r.dots.reduce((s, d) => s + d.w * d.h, 0) }));
  const inversions = [];
  for (let i = 0; i < ink.length; i++) for (let j = 0; j < ink.length; j++){
    if (ink[i].n < ink[j].n && !(ink[i].area < ink[j].area - TOL)) inversions.push('R' + ink[i].round + '(n=' + ink[i].n + ',잉크=' + ink[i].area.toFixed(1) + ') >= R' + ink[j].round + '(n=' + ink[j].n + ',잉크=' + ink[j].area.toFixed(1) + ')');
  }
  const order = inversions.length === 0;
  out.push('  ' + (order ? '✓' : '✗') + ' 개수 순서와 잉크 넓이 순서가 일치한다 · 뒤집힌 쌍 ' + inversions.length + '개');
  for (const x of inversions.slice(0, 6)) out.push('      ✗ ' + x);
  for (const e of ink) out.push('      (관측) R' + e.round + ' 개수 ' + e.n + ' · 잉크 ' + e.area.toFixed(1) + 'px^2');
  /* ★양성 대조군 · 잣대가 차이를 볼 수 있다는 증명이다. 라운드마다 개수가 다르므로
     잉크도 달라야 한다 — 전부 같게 나오면 아무것도 못 재고 있다는 뜻이다. */
  const spread = Math.max(...ink.map(e => e.area)) - Math.min(...ink.map(e => e.area));
  out.push('  [양성 대조군] 라운드별 잉크가 실제로 달랐는가: ' + (spread > TOL ? '그렇다(잣대가 살아 있다 · 폭 ' + spread.toFixed(1) + 'px^2)' : '★아니다'));
  if (!(spread > TOL)) return { rc: 2, lines: out.concat(['판정 불가 · 잣대가 차이를 못 본다(양성 대조군 실패)']) };
  if (!sameSize || !order) return { rc: 1, lines: out.concat(['미달 · ' + [!sameSize ? '도형 치수가 갈라졌다' : null, !order ? '개수와 잉크의 순서가 어긋났다' : null].filter(Boolean).join(' / ')]) };
  return { rc: 0, lines: out.concat(['통과 · 도형은 판 전체에서 같은 치수로 그려지고 개수 순서와 잉크 순서가 일치한다']) };
}

async function runOnce(mutation){
  let target = HTML, tmp = null;
  if (mutation){
    const m = MUTATIONS[mutation];
    if (!m) return { rc: 2, lines: ['알 수 없는 뮤테이션: ' + mutation] };
    const src = fs.readFileSync(HTML, 'utf8');
    const n = src.split(m.from).length - 1;
    if (n !== 1) return { rc: 2, lines: [`뮤테이션 주입 실패(${mutation}) · 앵커가 ${n}회 나타났다(1회여야 한다)`] };
    tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), GAME + '-mut-')), 'index.html');
    fs.writeFileSync(tmp, src.replace(m.from, m.to));
    target = tmp;
  }
  const out = [];
  const res = await measure(target);
  if (tmp) { try { fs.rmSync(path.dirname(tmp), { recursive: true, force: true }); } catch(_){} }
  if (res.fatal) return { rc: 2, lines: ['판정 불가 · ' + res.fatal] };
  if (res.errors && res.errors.length) return { rc: 2, lines: ['판정 불가 · ' + res.errors.join(' / ')] };
  if (GAME === 'how-many') return judgeHowMany(res, target);
  if (GAME === 'together') return judgeTogether(res, target);

  const kinds = Object.keys(res.kinds);
  if (kinds.length < 4) return { rc: 2, lines: [`판정 불가 · 잰 종류가 ${kinds.length}종이다(4종이어야 한다)`] };

  let bad = 0, exemptDiffers = false;
  out.push(`대상 ${target}`);
  out.push(`devicePixelRatio ${res.dpr} · 허용 오차 ${TOL}px · 두 요소가 같은 페이지 안에 있어 확대율은 상쇄된다`);
  for (const k of kinds){
    const e = res.kinds[k];
    /* ★판정은 칠해지는 말단으로 한다 — 컨테이너는 칸 폭에 맞춰 줄을 접는 ★배치 산물이라
       (좁은 칸에서 점 12개가 두 줄이 된다) 잉크를 바꾸지 않는다. 다만 지우지 않고 아래에
       관측 줄로 남긴다 — 사람이 보고 판단할 몫이다. */
    const diff = x => Math.abs(x.prev.w - x.cur.w) > TOL || Math.abs(x.prev.h - x.cur.h) > TOL;
    const leaves = e.els.filter(x => x.leaf);
    const offs = leaves.filter(diff);
    const boxOffs = e.els.filter(x => !x.leaf && diff(x));
    const same = offs.length === 0;
    const show = x => `${x.tag}${x.cls ? '.' + x.cls.split(/\s+/).join('.') : ''} ` +
                      `직전 ${x.prev.w}x${x.prev.h} · 지금 ${x.cur.w}x${x.cur.h}` +
                      ` · 차이 ${Math.abs(x.prev.w - x.cur.w).toFixed(3)}x${Math.abs(x.prev.h - x.cur.h).toFixed(3)}`;
    if (k === EXEMPT_KIND){
      exemptDiffers = !same;
      out.push(`  면제 ${k} 값 ${e.value} · 말단 ${leaves.length}개 대조 → ${same ? '전부 같다' : '다르다(강조 · 읽는 값이라 허용)'}`);
      for (const x of offs) out.push(`      · ${show(x)}`);
      continue;
    }
    out.push(`  ${same ? '✓' : '✗'} ${k} 값 ${e.value} · 하위 요소 ${e.n}개 중 ★말단 ${leaves.length}개로 판정` +
             (same ? ' · 전부 같다' : ` · 어긋난 말단 ${offs.length}개`));
    for (const x of offs) out.push(`      ✗ ${show(x)}`);
    for (const x of boxOffs) out.push(`      (관측) 담는 상자가 다르다 · ${show(x)} · 배치 산물이라 판정에 넣지 않는다`);
    if (!same) bad++;
  }
  /* ★양성 대조군 · 잣대가 차이를 볼 수 있다는 증명이다. 이것이 없으면 '전부 같다' 는 초록이
     '아무것도 못 재고 있다' 와 구별되지 않는다. */
  out.push(`  [양성 대조군] 면제 종류(${EXEMPT_KIND})가 실제로 달랐는가: ${exemptDiffers ? '그렇다(잣대가 살아 있다)' : '★아니다'}`);
  if (!exemptDiffers) return { rc: 2, lines: out.concat(['판정 불가 · 잣대가 차이를 못 본다(양성 대조군 실패)']) };
  if (bad) return { rc: 1, lines: out.concat([`미달 · 두 슬롯의 자가 갈라진 종류 ${bad}종`]) };
  return { rc: 0, lines: out.concat(['통과 · 값 그림의 하위 요소가 전부 두 슬롯에서 같은 치수로 그려진다(숫자 예외)']) };
}

/* ---------------------------------------------------------------- 자기시험 */
async function selftest(){
  const names = Object.keys(MUTATIONS);
  const loud = names.filter(n => MUTATIONS[n].expect !== 'quiet');
  const quiet = names.filter(n => MUTATIONS[n].expect === 'quiet');
  console.log(`[자기시험] 원본은 통과하고, 우회 ${loud.length}종은 붉어야 하며, ` +
              `★음성 대조군 ${quiet.length}종은 조용해야 한다.\n`);
  const base = await runOnce(null);
  console.log(base.lines.join('\n'));
  console.log(`원본 rc=${base.rc}\n`);
  if (base.rc !== 0){ console.log('★원본이 이미 미달·판정불가다 · 검출력을 세울 수 없다'); return 2; }
  const missed = [], falseAlarm = [];
  for (const name of names){
    const wantQuiet = MUTATIONS[name].expect === 'quiet';
    const r = await runOnce(name);
    const good = wantQuiet ? r.rc === 0 : r.rc === 1;
    console.log(`${good ? '✓' : '★'} ${name} rc=${r.rc} ${wantQuiet ? '[음성 대조군 · 조용해야 한다]' : ''} · ${MUTATIONS[name].why}`);
    if (!good){
      (wantQuiet ? falseAlarm : missed).push(name);
      console.log(r.lines.map(l => '    ' + l).join('\n'));
    }
  }
  console.log('');
  if (missed.length){ console.log(`검출력 실패 · 못 잡은 우회 ${missed.length}종: ${missed.join(', ')}`); return 1; }
  if (falseAlarm.length){ console.log(`★오탐 · 조용해야 할 ${falseAlarm.length}종이 붉었다: ${falseAlarm.join(', ')}`); return 1; }
  console.log(`검출력 확인 · 우회 ${loud.length}종 전부 rc=1 로 붉었고, 음성 대조군 ${quiet.length}종은 rc=0 으로 조용했다(원본 rc=0)`);
  return 0;
}

const main = async () => {
  if (argv.includes('--selftest')) process.exit(await selftest());
  const r = await runOnce(MUTATION);
  console.log(r.lines.join('\n'));
  process.exit(r.rc);
};
main().catch(e => die(2, '판정 불가 · ' + (e && e.stack ? e.stack : e)));
