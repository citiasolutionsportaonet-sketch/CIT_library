// Servidor de produção. HOST padrão 127.0.0.1 (somente esta máquina);
// para a rede local use HOST=0.0.0.0 (ver docs/rede-local.md).
import { main, run } from "./lib/common";

main(async () => {
  const host = process.env.HOST || "127.0.0.1";
  const port = process.env.PORT || "3000";
  await run("npx", ["next", "start", "-H", host, "-p", port]);
});
