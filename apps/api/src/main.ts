import { buildServer } from "./server.ts";

// 프로세스 진입점. server.ts는 buildServer만 export한다 - 테스트도 이 파일을 거치지 않고
// buildServer를 직접 불러 app.inject로 검증한다(listen 없이).
// 4175: 임베드 Rust 서버(apps/desktop/src-tauri/src/api)가 4174를 점유하고 아직 포팅 안 된
// 라우트를 이 프로세스로 프록시한다. Rust 이관이 끝나면 이 앱은 통째로 삭제된다.
const port = Number(process.env.PORT ?? 4175);
buildServer().listen({ port, host: "127.0.0.1" })
  .then((address) => console.log(`mono api listening on ${address}`))
  .catch((error) => { console.error(error); process.exit(1); });
