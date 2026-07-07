# 중국어 → 한국어 번역기 (프론트엔드)

Word(.docx) 파일을 업로드하면 중국어 웹소설을 한국어로 번역해 주는 웹앱의 프론트엔드입니다.
React + Vite로 제작했으며, 백엔드([translator-backend](https://github.com/woals10006-commits/translator-backend))와 연동됩니다.

## 기술 스택

- React + Vite
- 백엔드: Spring Boot + Claude API (별도 저장소)

## 실행

```bash
npm install
npm run dev
```

→ http://localhost:5173 접속 → .docx 업로드 → 번역할 화 수 입력 → 번역 시작.

번역이 동작하려면 백엔드(translator-backend)를 먼저 실행해야 합니다.
