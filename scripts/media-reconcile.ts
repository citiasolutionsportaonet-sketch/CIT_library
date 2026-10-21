// Reconciliação banco x disco. Padrão: somente lista (--dry-run).
// Com --apply, após a carência (--grace-hours, padrão 24):
//   - remove arquivos e registros de assets PENDING/FAILED/DELETING sem vínculo;
//   - remove arquivos órfãos (sem asset) e temporários antigos.
// Assets READY sem arquivo são apenas reportados (exigem restauração).
import fs from "node:fs/promises";
import path from "node:path";
import { getDb } from "@/server/db";
import { writeTx } from "@/server/maintenance";
import { getStorage } from "@/server/storage";
import { arg, flag, main } from "./lib/common";

main(async () => {
  const apply = flag("apply");
  const graceH = Number(arg("grace-hours") ?? 24);
  const cutoff = new Date(Date.now() - graceH * 3600_000);
  const db = getDb();
  const storage = await getStorage();
  const report = { readyMissing: [] as string[], staleAssets: [] as string[], orphanFiles: [] as string[], staleTmp: [] as string[] };

  const assets = await db.mediaAsset.findMany({ select: { id: true, storageKey: true, state: true, updatedAt: true, _count: { select: { products: true } } } });
  const known = new Set<string>();
  for (const a of assets) {
    known.add(a.storageKey);
    if (a.state === "READY") {
      for (const v of ["display", "thumb"]) if (!(await storage.stat(`${a.storageKey}/${v}.webp`))) report.readyMissing.push(`${a.id} (${v})`);
    } else if (a._count.products === 0 && a.updatedAt < cutoff) {
      report.staleAssets.push(a.id);
      if (apply) {
        await writeTx(async (tx) => {
          const still = await tx.productMedia.count({ where: { mediaId: a.id } });
          if (still === 0) await tx.mediaAsset.delete({ where: { id: a.id } });
        });
        for (const v of ["display", "thumb"]) await storage.delete(`${a.storageKey}/${v}.webp`);
      }
    }
  }
  for await (const key of storage.list()) {
    const prefix = key.split("/").slice(0, -1).join("/");
    if (!known.has(prefix)) {
      const st = await fs.stat(path.join(storage.root, key));
      if (st.mtime < cutoff) {
        report.orphanFiles.push(key);
        if (apply) await storage.delete(key);
      }
    }
  }
  for (const f of await fs.readdir(storage.tmpDir).catch(() => [] as string[])) {
    const full = path.join(storage.tmpDir, f);
    const st = await fs.lstat(full);
    if (st.mtime < cutoff) {
      report.staleTmp.push(f);
      if (apply) await fs.rm(full, { force: true });
    }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", graceHours: graceH, ...report }, null, 2));
  if (report.readyMissing.length) process.exitCode = 2;
});
