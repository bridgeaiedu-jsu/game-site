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
4. `sitemap.xml` 에 `<url><loc>https://hanpango.com/<게임id>/</loc>…</url>` 을 추가한다.
5. ★루트 `index.html` 도 반드시 함께 고친다 — 게임 정보가 **3곳**에 중복되어 있고 셋의 내용이 같아야 한다.
   - [ ] `games.json` (평소 화면에 쓰이는 원본 데이터)
   - [ ] `index.html` 의 `FALLBACK` 배열 (games.json 을 못 읽을 때 쓰는 대비책)
   - [ ] `index.html` 의 `<noscript>` 목록 (자바스크립트가 꺼진 브라우저·크롤러가 보는 화면)
   세 곳 중 하나라도 빠뜨리면 어떤 방문자에게는 옛 정보가 보인다. 반드시 체크리스트로 확인할 것.
