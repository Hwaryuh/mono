import { buildServer } from "./server.ts";

// 프로세스 진입점. server.ts는 buildServer만 export한다 - 테스트도 이 파일을 거치지 않고
// buildServer를 직접 불러 app.inject로 검증한다(listen 없이).
const port = Number(process.env.PORT ?? 4174);
buildServer().listen({ port, host: "127.0.0.1" })
  .then((address) => console.log(`mono api listening on ${address}`))
  .catch((error) => { console.error(error); process.exit(1); });
