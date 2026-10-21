// Worker persistente (fila PostgreSQL). Execute em processo separado:
//   npm run worker            (contínuo)
//   npm run worker -- --once  (processa o que houver e sai; útil em testes)
import "dotenv/config";
import { runWorker } from "@/server/jobs/worker";

runWorker({ once: process.argv.includes("--once") }).then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
