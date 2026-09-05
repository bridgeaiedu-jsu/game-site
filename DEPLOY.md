# game-site — 배포·검색 등록·수익화 가이드

> 이 폴더가 사이트 루트다. 게임은 `block-puzzle/index.html` 하나로 완결된다.
> 포털(`index.html`)은 2번째 게임이 생길 때 만든다.

## 0. 로컬 테스트
```
cd "C:\Users\USER\Desktop\AI-Works\Agent workflow\game-site"
python -m http.server 8765
# 브라우저: http://127.0.0.1:8765/block-puzzle/
# 모바일 뷰포트 하네스: http://127.0.0.1:8765/_mobile-test.html
```

## 0. 현재 호스팅 = Cloudflare Pages (2026-08-23 이전 완료 · Vercel 프로젝트 삭제됨)

- 프로젝트 `hanpango` · GitHub `bridgeaiedu-jsu/game-site` main 푸시 = 자동 배포 · 빌드 없음
- 도메인: `CNAME @ hanpango.pages.dev` · `CNAME www hanpango.pages.dev`(프록시) · Redirect Rule 'www → root' 301 · Email Address Obfuscation OFF
- 아래 §1~§2의 Vercel 절차는 **역사 기록**이다 — 새로 따라 하지 않는다.

## 1. (구) Vercel 배포 (GitHub 연동 방식 — 재배포 자동)
1. GitHub에 저장소 생성: `gh repo create game-site --public --source . --push`
   (계정 bridgeaiedu-jsu 로그인 상태 확인됨)
2. https://vercel.com → **Sign Up / Log in with GitHub**
3. **Add New… → Project** → `game-site` 저장소 Import
4. Framework Preset: **Other** · Root Directory: `./` · Build Command: 비움 · Output Directory: 비움 → **Deploy**
5. 발급 URL 예: `https://game-site-xxxx.vercel.app/block-puzzle/`
6. 이후 `git push` 할 때마다 자동 재배포

### 독자 도메인(광고 승인에 사실상 필수)
- 구매처: 가비아 / 호스팅케이알 / Cloudflare Registrar(가장 저렴·갱신가 고정)
- Vercel 프로젝트 → **Settings → Domains → Add** → 안내된 A/CNAME 레코드를 도메인 DNS에 등록
- 도메인 확정 후 `block-puzzle/index.html`의 `<link rel="canonical">`과 `og:image` 경로를 실제 주소로 교체

## 2. Google Search Console
1. https://search.google.com/search-console → **속성 추가**
2. **도메인** 유형 선택(하위 경로 전부 포함) → DNS TXT 레코드 등록으로 소유 확인
   - Vercel 기본 도메인만 쓸 땐 **URL 접두어** 유형 → HTML 태그 방식: `<meta name="google-site-verification" content="…">`를 `index.html` `<head>`에 추가
3. **Sitemaps** 메뉴 → `sitemap.xml` 제출 (아래 파일 생성 후)
4. **URL 검사** → 게임 URL 입력 → **색인 생성 요청**

`sitemap.xml` (루트에 생성):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://hanpango.com/block-puzzle/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>
</urlset>
```
`robots.txt` (루트):
```
User-agent: *
Allow: /
Sitemap: https://hanpango.com/sitemap.xml
```

## 3. 네이버 서치어드바이저
1. https://searchadvisor.naver.com → 네이버 로그인 → **웹마스터 도구 → 사이트 등록**
2. 소유 확인: **HTML 태그** 방식 → `<meta name="naver-site-verification" content="…">`를 `<head>`에 추가 → 재배포 → 확인
3. **요청 → 사이트맵 제출**: `https://hanpango.com/sitemap.xml`
4. **요청 → 웹 페이지 수집**: 게임 URL 직접 요청
5. 검증 → **robots.txt** 확인

## 4. Google AdSense 신청
전제: 독자 도메인 · 최소 2~3주 운영 · 약간의 트래픽 · 개인정보처리방침 페이지
1. https://adsense.google.com → 사이트 추가 → 발급된 `<script … adsbygoogle.js?client=ca-pub-…>`를
   `index.html` 상단 `ADSENSE (1/3)` 주석 자리에 넣고 재배포
2. 심사(보통 1~2주). 통과 후 **광고 단위 2개** 생성:
   - 디스플레이 · 반응형 → `ADSENSE (2/3)` 상단 배너 div 안에 `<ins class="adsbygoogle">` 삽입
   - 디스플레이 · 300×250 고정 → `ADSENSE (3/3)` 게임오버 카드 안에 삽입
3. 정책 주의: 게임오버 화면 **자동 팝업/전면 광고 금지** · 광고를 "클릭하세요"로 유도 금지 · 광고와 게임 버튼 간격 확보
4. 승인 확률을 높이는 것: `/privacy` 페이지, `/about` 페이지, 게임 2~3개, 각 게임에 설명·팁 텍스트(이미 포함됨)

## 5. 추가 수익화 제안 (우선순위순)
1. **AdSense 대신/병행 — 게임 전용 광고망**: AdSense는 게임 사이트 승인이 까다롭다. *Google Ad Manager + H5 Games Ads*(보상형 광고 = "다시 하기 대신 한 번 더" 버튼)가 캐주얼 게임 ARPU가 훨씬 높다. AdSense 승인 후 같은 계정에서 활성화 가능.
2. **게임 포털 확장이 곧 수익 확장**: 광고 수익 = 페이지뷰 × 체류시간. 게임 5개 + 포털 첫 화면(오늘의 게임·최고 점수)이 있으면 세션당 2~3판으로 늘어난다. 2번째 게임부터 `index.html` 포털을 만든다.
3. **공유 루프 강화**: 현재 "점수 공유"가 있음. 여기에 *일일 도전(seed 고정 — 모두 같은 블록 순서)* 을 넣으면 Wordle식 공유가 생긴다. 트래픽 비용 0.
4. **PWA 홈 화면 추가**: `manifest.json` + 서비스워커 1개 파일 → 재방문율 상승(AdSense 승인에도 긍정).
5. **후원 버튼(즉시 가능)**: 토스 익명송금 링크 / Buy Me a Coffee를 게임오버 카드 하단에. 승인 불필요.
6. **유료 해금(나중)**: 광고 제거 ₩1,900 같은 단일 결제 — 토스페이먼츠/포트원 + Vercel Serverless Function 필요. 트래픽이 생긴 뒤.

## 6. 측정
- Google Analytics 4(또는 Vercel Analytics) 태그를 `<head>`에 추가 — 판당 시간·재시작률이 핵심 지표.
- 목표 지표: 재시작률 50%↑, 평균 세션 3판↑ 이면 광고 수익이 의미 있게 나온다.

## 7. 수익이 통장까지 오는 절차 (AdSense · 한국 거주자 기준)
```
사이트 운영 2~3주 + /privacy 페이지 → AdSense 신청 → 심사 1~2주 → 승인 → 광고 코드 3곳 삽입
→ 잔액 $10: 우편 PIN 발송(2~4주) → PIN 입력 → 잔액 $100(월말 기준) → 다음 달 21일경 은행 송금
```
- 오너가 직접: ①신청(구글 계정·주소) ②**세금 정보 W-8BEN 제출**(미제출 시 30% 원천징수) ③PIN 입력 ④지급 방법 = 은행 송금(전신환): 은행명·SWIFT·계좌번호·영문 예금주 — **외화 수취 가능한 일반 은행 계좌**(카카오/토스뱅크 비권장)
- 세금(방향만 · 세무사 확인 필요): 해외 광고 수익 = 사업소득 · 사업자등록 후 부가세 영세율 신고 · 다음 해 5월 종합소득세 합산
- 대안/병행: H5 Games Ads(보상형), 후원 버튼(토스 익명송금 — 승인 불필요), 유료 광고제거(결제 서버 필요)

## 게임 추가 절차 (포털 타일 자동 반영)

1. `<게임id>/index.html` 폴더를 만들어 게임을 넣는다 (정적 1파일 · 외부 의존 0).
2. 같은 폴더에 `thumb.webp` 를 넣는다 (640×640 정사각 · 150KB 이하).
3. 루트 `games.json` 배열에 한 줄(객체 1개)을 추가한다 — `id·path·title{ko,en}·desc{ko,en}·thumb·playtime{ko,en}·daily·released·tags`.
4. ★`functions/_games.js` 의 `GAMES` 배열에 게임 id 를 추가한다 — 공개 카운터(`/api/hit`·`/api/stats`)의
   **런타임 출처는 이 한 곳뿐**이다.
   - [ ] `functions/_games.js` 의 `GAMES` 에 `'<게임id>'` 추가
   예전에는 `functions/api/hit.js` 와 `functions/api/stats.js` 가 각자 목록을 들고 있었다. 한쪽만
   고치면 그 게임의 판수가 400 으로 조용히 버려지거나(hit), 판수는 쌓이는데 시작 화면의 판수 줄이
   영영 안 나타났다(stats). 지금은 두 파일이 `_games.js` 를 들여오므로 손댈 곳은 여기뿐이다.
   빠뜨리면 `node tools/counter/test_functions.mjs .` 이 `games.json` 과 어긋났다며 FAIL 한다.
5. `sitemap.xml` 에 `<url><loc>https://hanpango.com/<게임id>/</loc>…</url>` 을 추가한다.
   ★`<lastmod>` 를 함께 넣는다 — **모든 주소가 그 파일의 마지막 커밋일**(`git log -1 --format=%cs -- <경로>`)이다.
   ★2026-09-05 오너 승인으로 바뀌었다. 전에는 게임 주소만 `games.json` 의 `released` 를 썼는데,
   그 규칙은 **게임 페이지가 출시 때만 바뀐다고 가정**했고 팔레트 라운드가 22종을 전부 바꾸면서 깨졌다.
   규약의 글자보다 규약이 스스로 적은 이유(**검색엔진이 바뀐 글을 알아보는 단서**)를 따른다.
   ★`tools/check_sitemap_lastmod.py` 가 이것을 자동으로 잰다(rc 0/3/2 · 양방향). 손으로 세지 마라.
   (아래 옛 문장은 역사 기록이다) ~~게임 주소는 `games.json` 의 `released` 날짜~~, 루트·about·privacy 는 그 파일의
   마지막 수정일(YYYY-MM-DD)이다. 게임을 추가하면 루트(`/`)도 함께 바뀌므로 루트 `<lastmod>` 도 그날로 올린다
   (검색엔진이 새 글·바뀐 글을 알아보는 단서다 · 2026-08-29 사다리타기 추가 때 전 URL 에 도입).
6. ★루트 `index.html` 도 반드시 함께 고친다 — 게임 정보가 **3곳**에 중복되어 있고 셋의 내용이 같아야 한다.
   - [ ] `games.json` (평소 화면에 쓰이는 원본 데이터)
   - [ ] `index.html` 의 `FALLBACK` 배열 (games.json 을 못 읽을 때 쓰는 대비책)
   - [ ] `index.html` 의 `<noscript>` 목록 (자바스크립트가 꺼진 브라우저·크롤러가 보는 화면)
   세 곳 중 하나라도 빠뜨리면 어떤 방문자에게는 옛 정보가 보인다. 반드시 체크리스트로 확인할 것.

7. ★`sw.js` 도 함께 고친다 — 오프라인 캐시 목록과 캐시 버전 두 가지다.
   - [ ] `PRECACHE` 배열에 새 게임 경로 **2줄**을 추가한다 — `/<게임id>/`, `/<게임id>/thumb.webp`
         ★`/<게임id>/index.html` 은 **넣지 않는다**. Cloudflare Pages 가 그 주소를 308 로
         되돌려 주어 `cache.addAll` 이 통째로 reject 되고 프리캐시가 전부 실패한다.
         (로컬 `python -m http.server` 는 200 을 주므로 로컬 시험으로는 안 잡힌다.)
   - [ ] `CACHE` 문자열의 버전을 올린다 (예: `hanpango-v1` → `hanpango-v2`)
   버전을 올리지 않으면 이미 방문한 사람의 브라우저가 **옛 캐시를 계속 쓴다** — 새 게임이 안 보인다.
   버전을 올리면 서비스워커가 활성화될 때 구버전 캐시를 스스로 지운다.
8. ★**병합한 나무에서 게이트를 다시 돌린 뒤 push 한다.**
   - [ ] `node tools/check_functions.mjs .` → **rc=0 일 때만** 통과다.
         `rc=1` 은 미달, `rc=2` 는 **판정 불가**(검사할 수 없었던 자리가 있다)다 — 둘 다 배포하지
         않는다. rc=2 는 도구가 못 본 자리를 사유와 함께 적어 주니 그 자리를 사람이 보고
         해소하거나, 못 볼 수밖에 없는 것(예: `.ts` 도입)이면 wrangler 빌드를 관문으로 더해라.
         ★`node:` 모듈은 **Node 에게 직접 물어** 판정한다(module.isBuiltin → 네임스페이스 키).
         없는 모듈(`node:totally-fake-xyz`)은 부수효과·default·named 어느 형태든 미달이고,
         실재하는 이름은 그대로 통과한다. **단 Node 에 있다는 것이 Workers 에서 된다는 뜻은
         아니다** — `node:crypto` 는 호환 날짜 2026-08-04 이후에야 기본 지원된다. Workers
         지원 여부는 Cloudflare 문서와 wrangler 빌드로 따로 확인해라.
         `cloudflare:` 처럼 이 Node 로 확인할 수 없는 접두만 `tools/runtime-module-exports.json`
         대상이고, 목록이 없으면 rc=2 다(tools/README.md 의 R9 절).
         데이터 모듈(`.html`·`.txt`·`.wasm`·`.bin`)의 named import 는
         Pages 계약상 성립하지 않으므로 rc=1 미달이다 — default 로 받아라.
   - [ ] `python3 tools/check_privacy_storage.py .` → 같은 규약(rc=0/1/2)이다.
         ★계산형 멤버 이름(`window[expr]`)을 정적으로 끝까지 접지 못했는데 그 결과로 저장소
         메서드를 부르면 rc=2 다. 그 줄을 정적으로 읽히게 고쳐라(문자열 상수 하나로 적거나
         `window.localStorage` 로 직접 쓴다) — 게이트를 완화하는 것이 답이 아니다.
         ★대괄호가 **멤버 첨자인지 배열 리터럴인지 가릴 수 없을 때**도 rc=2 다(그 안에 저장소
         이름이 있을 때만). 이것은 고장이 아니라 설계다 — 모르는 표기를 '없는 셈' 으로 접으면
         실행되는 저장 호출이 그 틈으로 빠져나간다. 지적문이 어느 줄인지·왜 못 가렸는지 적어
         주니, 그 줄을 흔한 표기로 고쳐 쓰면 된다(`window["localStorage"]` 또는
         `window.localStorage`). 검사기의 표를 넓히는 것은 그다음 선택지다.
   - [ ] `python3 tools/check_source_bytes.py .` → **rc=0 일 때만** 통과다. rc=2 는 **적발(판정 불가)** 이다 — 소스에 눈에 보이지 않는 금지 바이트(0x00 0x07 0x08 0x0b 0x0c 0x1b) · BOM · lone CR 이 섞였다는 뜻이다.
         ★왜 있나: `tools/verify_tensec.js` 870·871 행에 원시 0x08 이 2개 있었다(커밋 `32df830` 이후 계속). 정규식 낱말경계를 쓰려다 셸 heredoc·파이썬 리터럴 층에서
         백슬래시가 먹힌 것인데, 0x08 은 정규식 안에서 **합법이라 문법오류가 나지 않고**
         형제 단언이 초록을 대신 내 주어 **실행 검사로는 영원히 안 잡혔다**. 눈으로만(`cat -A`) 찾을 수 있었고 그것은 재현 가능한 검사가 아니다.
         ★고칠 때 백슬래시를 리터럴로 타이핑하지 마라 — 같은 층을 또 지난다. 문자코드 조립(`chr(92)`)이나 바이트 치환으로 고치고 **쓰고 난 뒤 바이트를 다시 세라**.
         ★검출력은 `--selftest` 로 잰다: 임시 **Git 저장소**에 규칙 **8종**(금지 바이트 6종 + BOM + lone CR)을 각각 주입하고 **CLI 경로 전체를 자식 프로세스로 밟아** rc=2 와 규칙 이름이 지적문에 나오는지 본다(rc=0 확인 · rc=1 검출 실패·규칙 소실 · rc=2 주입 실패·하네스 이상). 옵션 오타(`--selftes`)와 루트 2개 같은 잘못된 호출은 **rc=2 로 거부**한다 — 검사 못 한 것을 통과로 세지 않는다.
         범위는 여기서 닫혀 있다 — 제로폭·혼동 글자까지 넓히지 않는다(이번 사고가 지나온 경로만 막는다).
   - [ ] `node tools/counter/test_functions.mjs .` · `node tools/counter/test_pages.mjs .`
   - [ ] `node tools/check_home_sync.mjs .` → **rc=0 일 때만** 통과다. 대문이 실제 게임 목록과 어긋나면 미달이다(games.json · FALLBACK · noscript · sw.js PRECACHE · /about/ 다섯 자리). rc=2 는 **판정 불가**이며 통과가 아니다.
   - [ ] `node tools/check_precache_cache.mjs . --base origin/main --head HEAD` → **rc=0 일 때만** 통과다.
         ★**인자를 반드시 주라** — 무플래그는 `HEAD^..HEAD`(직전 한 커밋)만 재므로, 여러 커밋을 함께 내보내는 출고에서는 **묻고 싶은 것을 묻지 않는다**.
         재는 계약: 구간에서 프리캐시 대상의 **내용 변경·삭제** 나 **PRECACHE 목록에서 항목 삭제** 가 있었다면, 구간 끝 나무의 `CACHE` 값이 그 모든 변경보다 **나중에** 정해졌고 **과거에 쓴 적 없는 새 값**이어야 한다.
         목록에 항목을 **추가만** 한 것은 의무를 만들지 않는다 — sw.js 가 바뀌어 install 이 돌고 `addAll` 이 망에서 새로 받기 때문이다(2026-09-03 실측).
         rc=2 는 **판정 불가**다(통과가 아니다): 모르는 플래그 · `CACHE`·`PRECACHE` 를 못 읽음 · **base 가 head 의 조상이 아님**(남의 갈래에서 오른 값을 이 구간의 올림으로 셀 위험).
         ★검출력은 `--selftest` 로 잰다(뮤테이션 22종 · 어긋남 0 이 합격선).
   - [ ] `node tools/check_precache_integrity.mjs .` → **rc=0 일 때만** 통과다. `PRECACHE` 항목 하나가 404 나면 `cache.addAll` 이 **통째로 reject** 되어 프리캐시가 조용히 전멸한다.
         규칙 4개: 형태(`precache-url-shape`) · 디렉터리 표기(`precache-dir-form` — `/about` 처럼 후행 슬래시가 빠지면 308 로 addAll 이 깨진다) · 실재(`precache-target-exists`) · 중복(`precache-duplicate`).
   - [ ] `node tools/check_page_assets.mjs .` → **rc=0 일 때만** 통과다. 페이지가 요청시키는 동일 오리진 하위 자원(문서·`/api/`·서비스워커 스크립트 제외)이 `PRECACHE` 에 없으면 미달이다.
         조립되는 경로는 데이터 전개로 **갈음**하고, 못 푸는 조립은 통과가 아니라 **판정 불가**다.
   - [ ] `node tools/check_today_pool.mjs .` → **rc=0 일 때만** 통과다. 「오늘의 한판」 선정 규칙
         (3종 · 최소 1종 `maxMinutes<=N` · 합 `<=M`)이 어떤 게임을 **영원히 후보에서 빼는지**를
         매번 **계산해서 찍는다**. ★목록을 문서·주석에 손으로 적지 마라 — 게임이 늘거나
         `maxMinutes` 가 바뀌면 그 순간 거짓이 된다. 규칙 상수는 이 도구가 갖지 않고
         `today/index.html` 의 `window.__td.const().PICK` 에서 읽는다(제품이 규칙을 바꾸면
         판정도 함께 바뀐다). 영구 제외 자체는 **미달로 세지 않는다** — 규칙의 정당한 귀결일 수
         있고, 이 도구의 일은 그것을 **눈에 보이게** 만드는 것이다. 미달은 셋뿐이다:
         daily 게임에 `maxMinutes` 가 없다 · 빠른 게임이 0종이다 · 성립하는 조합이 0개다.
         제품 스크립트나 규칙 상수를 못 읽으면 **판정 불가(rc=2)** 다.
   - [ ] `node tools/check_today_midnight.mjs .` → **rc=0 일 때만** 통과다. 「오늘의 한판」이
         **자정을 넘겨도 어제 판에 멈추지 않는지**와 **관측 창구가 사본을 주는지**를 잰다.
         사용자 흐름 둘(탭으로 돌아오기 · '다시 읽기')을 **각각 다른 분모로** 세고, 그 전에
         전제(자정 전 관측이 실제로 그날이었다)와 분모 일치를 먼저 단언한다 — 전제가 깨진
         표본으로 낸 초록은 관측이 아니다. `--days N` 으로 경계 수를 늘릴 수 있다(기본 ±45일).
         `--selftest` 는 다섯 뮤테이션으로 **무엇을 잡는지 스스로 보인다**(주입실패는 통과가 아니다).
         ★못 보는 것: 자정 예약 타이머가 실제로 발화하는 것은 재지 않는다(아래 한 줄 참조).
   - [ ] `node tools/check_today_sameday.mjs .` → **rc=0 일 때만** 통과다. **같은 날에는 몇 번을
         다시 지어도 같은 3종**인지 잰다. `--selftest` 는 여섯 뮤테이션으로 ★붉어야 하는 짝(가드를
         걷고 결정론을 망가뜨림)과 ★초록이어야 하는 대조군(가드만 걷음 · 결정론만 망가뜨림)을
         함께 보인다 — 결정론만 망가뜨리면 같은날 가드가 앞에서 막아 **관측되지 않는다**는 것까지
         드러낸다. 붉음만 보이면 무엇이 계약을 지키는지 알 수 없다.
   - (참고 · 체크리스트 항목 아님) `gemini_timer_probe.mjs` 는 자정 예약 타이머를 가상시계로 재는
     하네스인데 **`tools/` 밖에 있다**(리뷰 산출물). 저장소 관례에 맞추는 비용이 달라 아직 들이지
     않았다 — 존재를 알리기 위해 여기 적어 둔다. 그 축은 지금 배포 체크리스트로는 **안 보인다**.
   각 레인(브랜치)에서 초록이었다는 것은 **병합 결과가 초록이라는 뜻이 아니다**. 2026-08-31 에
   노노그램 병합이 `functions/_games.js` 의 `export const GAMES` 를 두 줄로 만들어 Cloudflare
   Pages 빌드가 거부했고, 배포가 통째로 실패해 새 경로만 404 였다. 두 부모는 각자 한 줄이라
   양쪽 레인의 시험은 정직하게 초록이었다 — 손상은 병합 커밋에서 처음 생겼다.
   그러니 검사는 **병합한 나무에서 한 번 더** 돌려야 의미가 있다.
