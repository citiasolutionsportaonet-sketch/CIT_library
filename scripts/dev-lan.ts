// Desenvolvimento acessível por outros Macs na rede confiável. Somente dev.
import { main, run } from "./lib/common";

main(async () => {
  if (process.env.NODE_ENV === "production" || process.env.CIT_ENV === "production") throw new Error("dev:lan não deve rodar em produção.");
  const port = process.env.PORT || "3000";
  console.log(`Abrindo em 0.0.0.0:${port}. Use a URL configurada em APP_ORIGIN (${process.env.APP_ORIGIN}) em todos os Macs.`);
  await run("npx", ["next", "dev", "-H", "0.0.0.0", "-p", port]);
});
