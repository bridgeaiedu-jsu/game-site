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
