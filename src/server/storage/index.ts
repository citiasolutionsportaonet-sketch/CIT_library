import "server-only";
import { getEnv } from "../env";
import { LocalStorageProvider } from "./local";
import type { StorageProvider } from "./types";

const g = globalThis as unknown as { citStorage?: Promise<LocalStorageProvider> };

/** Provider configurado (local). Valida diretório e permissão de escrita na primeira chamada. */
export function getStorage(): Promise<LocalStorageProvider & StorageProvider> {
  if (!g.citStorage) {
    g.citStorage = (async () => {
      const p = new LocalStorageProvider(getEnv().mediaRootAbs);
      await p.init();
      return p;
    })().catch((err) => {
      g.citStorage = undefined;
      throw err;
    });
  }
  return g.citStorage;
}

export * from "./types";
