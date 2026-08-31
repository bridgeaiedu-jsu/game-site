# tools/ — 이 사이트를 기계로 검사하는 도구

눈으로 훑어서 놓치는 것(색 대비·색차, 트레이 색 배정, 낱말 게임의 규약 준수)을 계산으로
판정한다. 전부 **읽기 전용**이다 — 대상 파일을 고치지 않는다. 고의 결함(뮤테이션)은 임시
사본에만 주입한다.

- 기준 커밋: `d460a92` (adsense site code · sw cache v17)
- 출처: `pack/round/evidence/theme-light-2026-08-23/`, `pack/round/evidence/word-hanpango-2026-08-23/`
  (라운드 증거는 그 라운드의 기록이라 불변 — 여기 있는 것은 사본이다)
- 실행 위치: **저장소 루트**. 아래 예시 경로는 모두 루트 기준 상대경로다.
- 필요한 것: `python3`, `node` (실측 환경 — Python 3.12.10 · Node v22.17.1)

공통 종료코드: `0` = 전부 통과 · `1` = 미달 있음 · `2` = 검사를 세울 수 없음(설정·하네스 오류).
`2` 는 "통과/불통과를 판정하지 못했다"는 뜻이라, 자동 호출자는 `1` 과 절대 섞어 쓰면 안 된다.

---

## check_rainbow.py — 무지개 팔레트 결정론 검사

블록 낙하·블록 퍼즐·2048 세 페이지의 색을 계산으로 판정한다. 합격선은 셋이다:
테두리 대 바탕 **3:1** 이상, 타일 위 글자 대 채움 **4.5:1** 이상, 이웃한 색끼리
CIEDE2000 색차 **10** 이상. (채움 대 바탕 대비는 재서 표에 남기되 판정에는 쓰지 않는다 —
선명한 채움을 허용하고 바탕과의 구별은 어두운 테두리가 맡는 것이 R2 설계다.)
7색 토큰(`--r1`~`--r7`, `--r1-edge`~`--r7-edge`)이 세 파일에 모두 있고 값이 같은지,
색 값이 토큰 밖(스타일 규칙·스크립트)에 박혀 있지 않은지도 본다.

```sh
python3 tools/check_rainbow.py .                       # 저장소 루트를 대상으로
python3 tools/check_rainbow.py . --json rainbow.json   # 측정값을 파일로
python3 tools/check_rainbow.py . --inject 2048/index.html:--r3-edge=#fef08a   # 검출력 확인
```
마지막 줄은 고의로 테두리를 밝혀 **FAIL 이 나와야 정상**이다(검사기가 살아 있는지 보는 법).

## verify_puzzle_tray.js — 블록 퍼즐 트레이 색 검증

배포되는 `block-puzzle/index.html` 안의 `<script>` 를 **그대로 꺼내** 최소 DOM 스텁 위에서
돌리고 실제 `refillTray()` 를 호출한다(사본을 만들어 재지 않는다). 트레이 한 벌의 세 조각
색이 항상 서로 다른가, 7색이 모두 쓰이는가, 색을 정하는 것이 난수가 아니라 조각 종류인가를 본다.

```sh
node tools/verify_puzzle_tray.js --html block-puzzle/index.html
node tools/verify_puzzle_tray.js --html block-puzzle/index.html --rounds 20000
node tools/verify_puzzle_tray.js --html block-puzzle/index.html --mutate no-dedup   # 검출력 확인
```
`--baseline <바뀌기 전 파일>` 을 주면 같은 난수 흐름에서 **뽑히는 모양 순서가 하나도
달라지지 않았는지**까지 대조한다(색만 바꾸고 게임 로직은 건드리지 않았음을 증명할 때).

## verify_word.js — 오늘의 낱말 검증

`word/index.html` 의 성공 기준 ①~⑧ 을 기계로 확인한다. 공유 저장소 하나 위에 여러 '탭'을
띄우고, Web Locks 를 모의해 임계구역·비교-교환(CAS)을 실제로 밟고, 가짜 시계로 날짜를 넘겨
일일 결정성·만료를 본다. 채점(빈칸 특례·중복 자모 풀), 정답 순서 무중복, 공유 문자열의 정답
누설, 오버레이 4개의 inert·초점 복귀, 출처·라이선스 링크 자리까지 정적·동적으로 함께 본다.

```sh
node tools/verify_word.js                                  # 기본 대상 = 이 저장소의 word/index.html
node tools/verify_word.js --html word/index.html
node tools/verify_word.js --mutate w-no-cas                # 검출력 확인(임시 사본에만 주입)
```

## verify_nonogram.js — 노노그램 판 검증 (답이 하나뿐인가)

`nonogram/index.html` 의 `<script>` 를 그대로 꺼내 최소 DOM 스텁 위에서 돌리고, 실제
`makePuzzle()` 로 판형×난이도 6조합의 판을 만들어 본다. 보는 것은 일곱 가지다 —
①단서가 그 판의 해에서 뽑은 단서와 일치하는가 ②그 단서를 만족하는 답이 **정확히 하나**인가
③빈 줄이 없고 단서 개수가 판형별 상한을 넘지 않는가 ④어려움 판이 왕복 추론 횟수 조건을
지키는가 ⑤같은 seed 가 같은 판을 내는가·오늘의 도전 seed 가 날짜만으로 정해지는가
⑥배포 파일이 플레이 중 난수를 당기지 않는가(정적 대조) ⑦검증기 자신이 답 둘인 판을
'2' 로 세는가.

★②의 답 개수는 게임이 판을 고를 때 쓴 줄 추론기가 아니라 **방법이 겹치지 않는 별도
탐색**(가로줄 완성 배치 나열 + 세로줄 앞부분 가지치기)으로 센다. 같은 방법으로 두 번 재면
자기채점이라 증거가 되지 못한다.

```sh
node tools/verify_nonogram.js --html nonogram/index.html               # seed 60개 × 6조합 = 360판
node tools/verify_nonogram.js --html nonogram/index.html --seeds 20
node tools/verify_nonogram.js --html nonogram/index.html --mutate no-unique-gate   # 검출력 확인
```
뮤테이션은 `no-unique-gate`(유일해 관문 제거) · `no-hard-gate`(난이도 관문 제거) ·
`no-clue-cap`(단서 개수 상한 제거) 셋이며, 셋 다 rc=1(FAIL)이 나와야 정상이다.
앵커가 나와야 할 곳 수와 다르면 rc=2 로 멈춘다(앵커 노후화를 통과로 접지 않는다).

## verify_tensec.js — 10초 감각 검증 (시간을 재는 법과 감추는 법)

`tensec/index.html` 의 인라인 스크립트를 그대로 꺼내 최소 DOM 스텁 위에서 돌리고, 제품이 실제로
듣는 입력 사건(`pointerdown`·`keydown`)으로 판을 두드린다. 시험용 뒷문은 제품에 두지 않는다 —
배포본의 `window.__ts` 는 읽기 전용 창구다.

이 게임에는 다른 게임에 없는 두 가지 약속이 있고, 검사의 무게는 거기에 실려 있다.

**① 잰 시간이 기기 사정에 흔들리지 않는가.** 시계를 검사기가 쥐고 **같은 두 도장**을 주되 그
사이의 사정을 다섯 가지로 다르게 만든다 — 조용한 기기 · 밀린 콜백 500회 · 탭이 뒤에 가려짐 ·
시계가 잘게 흐름 · 타이머 폭주. 다섯 결과가 하나라도 어긋나면 FAIL 이다. 덧붙여
`requestAnimationFrame`·`setInterval` 호출 수가 0 인지 직접 센다.

**② 재는 동안 화면이 시간을 알려 주지 않는가.** '흐른 시간이 안 보인다' 로 좁게 잡지 않고
**화면이 시계와 아예 무관하다** 로 잡는다: 시작 도장과 흐른 시간을 바꿔 가며 다섯 상황을 만들고,
누른 직후와 (재는 도중 언어를 바꿔) 다시 그린 뒤의 화면 두 장을 모두 대조한다. 여기에
'재는 동안 시계를 읽은 횟수 0' · '걸린 타이머 0' · 재는 동안 모든 움직임을 끄는 CSS 빗장의
실재까지 함께 본다.

그 밖에 정확도 산식(기획안 예시 9.87초 → 오차 0.13초 · 98.7%), 날짜 seed 결정성(120일 전수),
입력 동등성(손가락·Space·Enter·키 반복·창이 떠 있을 때), 기록·스트릭, 저장 키와 방침 등재,
ko·en 문안 키 짝, 색 토큰, 외부 요청 0, 동작 줄이기 덮개까지 본다.

```sh
node tools/verify_tensec.js                          # 대조군은 rc=0
node tools/verify_tensec.js --html tensec/index.html
node tools/verify_tensec.js --list-mutations
node tools/verify_tensec.js --mutate m-frame-clock    # 검출력 확인(임시 사본에만 주입)
```
뮤테이션을 걸면 **'지목한 검사가 잡았는가'** 까지 도구가 스스로 판정한다 — 지목한 검사가 아예
돌지 않았으면(앵커 노후화) rc=2 로 멈춘다. 무임승차를 인정하지 않기 위해서다.

## run_mutations_tensec.py — 위 검증기의 검출력 검산

방어를 하나씩 지운 사본 19종으로 `verify_tensec.js` 를 돌려 **반드시 붉어지는지** 본다.
탐지의 정의가 엄격하다: `exit 1` **그리고** 지목한 검사가 FAIL 목록에 있고 **그리고** 최종
요약행에 도달했을 때만 탐지다. '주입 실패'(앵커 노후화)는 검출력 저하와 따로 세어 표에 남긴다 —
둘을 뭉뚱그리면 오독을 부른다.

```sh
python3 tools/run_mutations_tensec.py
python3 tools/run_mutations_tensec.py --html tensec/index.html
```
종료코드: `0` 전부 지목 검사로 탐지 + 원본 정상 · `1` 검출력 실패(미탐지·엉뚱탐지) ·
`2` 하네스 비정상(주입 실패·요약행 미도달·원본이 이미 FAIL).

## check_functions.mjs — functions/ 배포 게이트 (SKIP 은 통과가 아니다)

2026-08-31 배포 실패에서 나왔다. 병합이 `functions/_games.js` 에 `export const GAMES` 를 두 줄로
만들었고 Cloudflare Pages 의 wrangler 빌드가 'Multiple exports with the same name GAMES' 로
거부해 배포가 통째로 실패했다(새 경로 `/nonogram/` 만 404 · 라이브는 이전 성공분 유지).

`functions/` **아래 모든 스크립트**를 대상으로, 모듈을 **평가하지 않고 파싱·링크만** 한다
(외부 의존 0 · Node 내장 `vm.SourceTextModule`/`vm.SyntheticModule` 만 쓴다).

### ★R2 (codex R6 지적 반영) — 판정 불가는 rc=2 다
R1 은 앞 단계가 막힌 검사를 SKIP 으로 흘리고 종료코드는 미달 개수만 셌다. 그래서 ①문자열 동적
import 의 대상이 없어도 ②깨진 `.ts` 파일이 있어도 ③route 검사가 예상 밖 오류로 건너뛰어져도
rc=0 이었다 — 배포 관문에서 가장 나쁜 형태(게이트가 있다는 믿음만 주고 실제로는 안 본다)다.
지금은 **검사할 수 없었던 자리를 판정 불가(`‽`)로 올리고 rc=2 로 멈춘다.** 사유는 파일:라인과
함께 남긴다. `check_privacy_storage.py` 와 같은 규약이다:
`rc=0` 미달 0 · `rc=1` 미달 발견 · `rc=2` 판정 불가(하나라도 있으면 통과로 세지 않는다).

### 규칙 — 두 종류를 섞어 설명하지 않는다
`[wrangler]` Pages/Wrangler 가 실제로 거부하거나 못 싣는 것(배포 적합성):
`parse`(중복 export·중복 선언·문법) · `dynamic-import`(동적 import 대상) ·
`import-path`(상대 import 대상 실재) · `module-type`(비JS 모듈 종류) · `link`(가져오는 이름 실재).
`[정책]` 이 저장소가 Wrangler 보다 엄격하게 정한 것: `route-export`(`_` 접두 규약) ·
`bare-import`(외부 패키지 금지 — Wrangler 는 허용한다).

근거로 삼은 공식 문서: Pages 의 `.ts` 지원(pages/functions/typescript/) · 비JS 모듈
(pages/functions/module-support/ — text/binary 는 카테고리로만 적혀 있고 확장자 목록이 닫혀
있지 않다) · Wrangler 번들링(workers/wrangler/bundling/ — 변수형 동적 import 는 기본 설정에서
번들에 못 들어간다).

### 이 도구가 못 보는 것(정직한 한계)
· TypeScript/JSX 를 파싱하지 못한다. Pages 는 지원하므로 `.ts` 가 하나라도 생기면 이 게이트는
  rc=2 로 멈춘다 — 그때는 **wrangler 빌드(dry-run)를 별도 관문으로 세워야 한다.**
· Wrangler 와 '같은 층'(파싱·결합)에서 볼 뿐 같은 해석기가 아니다.

```sh
node tools/check_functions.mjs .                          # 대조군은 rc=0
node tools/check_functions.mjs . --selftest               # 내장 검출력 자기시험(13항목)
node tools/check_functions.mjs . --list-mutations
node tools/check_functions.mjs . --mutate dup-export       # 2026-08-31 실패를 그대로 재현
```
뮤테이션·자기시험은 임시 폴더 사본에만 주입한다(원본 불변). 뮤테이션을 걸면 **'지정 규칙이
잡았고 다른 규칙이 미달로 울지 않았는가'** 까지 도구가 스스로 판정한다 — 의도대로면 rc=1,
못 잡거나 엉뚱한 규칙이 미달로 울면 rc=2 다(무임승차 차단).
자기시험에는 **방어를 지운 변이체**가 들어 있다: 판정 불가를 통과로 세던 R1 의 계산식을 되살린
사본이 rc=0 을 내는지 확인한다. 그 사본이 그대로 rc=2 를 내면 지금의 rc=2 가 이 방어의 산물이
아니라는 뜻이므로 자기시험이 FAIL 한다(공허한 통과 차단).

### 기존 counter/test_functions.mjs 와 무엇이 다른가
그 시험은 이 손상을 **못 보는 것이 아니라 '이름 없이' 본다.** 대상 모듈을 진짜 `import()` 하므로
Node 가 파싱 단계에서 SyntaxError 를 던지고 프로세스가 그 자리에서 죽는다(rc=1). 판정이 아니라
추락이라 `PASS n · FAIL m` 요약 줄이 아예 안 찍히고, 하네스 오류와 구별되지 않으며, FAIL 줄을
세는 쪽에는 '실패 0' 으로 보인다. 또 그 시험이 실제로 여는 모듈은 `hit.js`·`stats.js`·`_games.js`
셋뿐이라 functions/ 에 파일이 늘면 범위 밖으로 샌다.

## run_mutations.py — 위 검증기의 검출력 검산

`verify_word.js` 가 **고의 결함을 정말로 잡는지** 를 17종 주입으로 검산한다.
'탐지'의 정의가 엄격하다: `exit 1` **그리고** 지목한 검사가 FAIL 목록에 있고 **그리고**
예외 0 · 최종 요약행 도달. 죽어서 FAIL 이 난 것은 탐지로 세지 않는다.

```sh
python3 tools/run_mutations.py --html word/index.html
python3 tools/run_mutations.py --html word/index.html --verifier <망가뜨린 사본>  # 러너 자기검사
```
러너 자신의 종료코드: `0` = 17종 전부 지목 검사로 탐지 + 원본 정상 · `1` = 검출력 실패
(미탐지·엉뚱탐지) · `2` = 하네스 비정상(예외중단, 판정 요약 미도달/형식 이상/**2줄 이상**,
주입실패, 원본이 이미 FAIL, CLI 사용 오류).

> **최종 요약행은 정확히 1줄이어야 한다.** 요약 형식(`PASS n · FAIL n`) 줄이 두 줄 이상이면
> 어느 줄이 최종 판정인지 고를 수 없으므로 파싱을 인정하지 않고 exit 2 로 떨어뜨린다.
> 앞줄을 집으면 중간 집계를 최종 판정으로 오인해 FAIL 이 든 진짜 최종행을 지나친다.

## counter/ — 공개 카운터(방문·판수) 단위 시험

`functions/api/*` 는 D1 최소 stub 으로(쿼리 문자열·응답 코드), `js/hp-stats.js` 는 vm 위에서,
페이지는 마크업·i18n·발화 짝·인라인 스크립트 문법으로 본다. 브라우저도 D1 도 필요 없다.

```sh
node tools/counter/test_functions.mjs . && node tools/counter/test_client.mjs . && node tools/counter/test_pages.mjs .
```

---

## 기준 커밋 d460a92 에서의 실측 (2026-08-25)

| 도구 | 명령 | 결과 | exit |
|---|---|---|---|
| check_rainbow.py | `python3 tools/check_rainbow.py .` | 판정 검사 232건 · 미달 0 (참고 측정 170건은 판정 제외) | 0 |
| verify_puzzle_tray.js | `node tools/verify_puzzle_tray.js --html block-puzzle/index.html` | PASS 3 · FAIL 0 (트레이 5000벌) | 0 |
| verify_word.js | `node tools/verify_word.js --html word/index.html` | PASS 164 · FAIL 0 | 0 |
| run_mutations.py | `python3 tools/run_mutations.py --html word/index.html` | 원본 정상=True · 탐지 17/17 · 엉뚱탐지 0 · 미탐지 0 · 예외중단 0 · 주입실패 0 | 0 |

검출력(고의 결함이 정말 잡히는가)도 같은 커밋에서 확인했다 — 둘 다 exit 1 로 잡아냈다:
`check_rainbow.py --inject 2048/index.html:--r3-edge=#fef08a` → 미달 3건,
`verify_puzzle_tray.js --mutate no-dedup` → PASS 2 · FAIL 1.
어느 실행도 대상 파일을 바꾸지 않았다(실행 후 작업 트리 무변경 확인).

외부 요청 검사는 `verify_word.js` 상단의 `ALLOWED_EXTERNAL_SCRIPT_HOSTS`(현재 애드센스
호스트 하나)만 예외로 두고, 그 목록 밖의 외부 `script src` 와 `fetch`·`XHR` 은 0 을 요구한다 —
호스트를 늘리려면 그 한 곳을 고쳐야 하므로 늘어난 사실이 디프에 남는다.
