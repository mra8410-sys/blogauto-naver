# Naver Blog Automator

Codex 기반 Naver Blog 자동 글쓰기/발행 데스크톱 앱입니다.

## 흐름

1. 계정과 카테고리, 검색 키워드, 발행 목적을 등록합니다.
2. Research/Title Agent가 현재 쓸 수 있는 주제와 제목을 검증합니다.
3. Writer Agent가 본문과 이미지 프롬프트를 작성합니다.
4. Image Worker가 Codex 이미지 생성을 실행하고 앱이 파일로 저장합니다.
5. Chrome 세션을 이용해 Naver Blog 글쓰기 화면에 입력 후 발행합니다.

## 실행

```bash
npm install
npm start
```

검사:

```bash
npm run check
```

빌드:

```bash
npm run dist
```

## 로컬 데이터

계정, 비밀번호, 카테고리, 작업 로그, 브라우저 세션, 생성 이미지, 빌드 exe는 `runtime/` 또는 `dist/`에 저장되며 Git에 올리지 않습니다.

## 주요 파일

- `src/main.js`: Electron main process와 작업 오케스트레이션
- `src/lib/codexRunner.js`: Research/Writer/Image Worker 실행
- `src/lib/naverPublisher.js`: Naver 로그인, 글쓰기, 발행 자동화
- `src/lib/accountStore.js`: 계정/카테고리 저장 구조
- `src/renderer/`: 데스크톱 UI
