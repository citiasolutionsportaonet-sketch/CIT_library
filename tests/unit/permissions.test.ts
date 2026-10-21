import { describe, expect, it } from "vitest";
import { canManageRole, permissionsFor } from "@/server/permissions";

describe("RBAC", () => {
  it("VIEWER só lê catálogo", () => {
    expect([...permissionsFor("VIEWER")]).toEqual(["catalog:read"]);
  });
  it("EDITOR edita produtos mas não membros", () => {
    const p = permissionsFor("EDITOR");
    expect(p.has("products:write")).toBe(true);
    expect(p.has("members:manage")).toBe(false);
    expect(p.has("audit:read")).toBe(false);
  });
  it("ADMIN não gerencia OWNER", () => {
    expect(permissionsFor("ADMIN").has("owner:manage")).toBe(false);
    expect(canManageRole("ADMIN", "OWNER")).toBe(false);
    expect(canManageRole("ADMIN", "EDITOR")).toBe(true);
    expect(canManageRole("EDITOR", "VIEWER")).toBe(false);
    expect(canManageRole("OWNER", "OWNER")).toBe(true);
  });
});
