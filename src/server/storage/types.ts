import type { Readable } from "node:stream";

/**
 * Contrato de armazenamento privado. Chaves são geradas pelo servidor.
 * Implementações: LocalStorageProvider (agora); S3 documentado em docs/decisoes.md.
 */
export interface StorageProvider {
  /** Grava de forma atômica (temporário + rename). Sobrescreve a chave. */
  put(key: string, data: Buffer | Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  stat(key: string): Promise<{ size: number } | null>;
  delete(key: string): Promise<void>;
  /** Lista chaves de arquivos sob um prefixo (usado na reconciliação). */
  list(prefix?: string): AsyncIterable<string>;
}

export class StorageNotFoundError extends Error {}
