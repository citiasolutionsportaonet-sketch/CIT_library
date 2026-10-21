"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { acceptInvitation } from "@/modules/tenants/service";
import { getAuth } from "@/server/auth";
import { type ActionResult, toErrorResult } from "@/server/errors";
import { getSessionUser } from "@/server/tenant-context";

export async function acceptInviteAction(token: string, form: { name?: string; password?: string; confirm?: string }): Promise<ActionResult<{ redirectTo: string }>> {
  const requestId = randomUUID();
  try {
    if (form.password !== undefined && form.password !== form.confirm) {
      return { ok: false, code: "VALIDATION", message: "As senhas não conferem.", fields: { confirm: "As senhas não conferem." }, requestId };
    }
    const user = await getSessionUser();
    const res = await acceptInvitation(token, { sessionUserId: user?.id ?? null, name: form.name, password: form.password });
    if (res.createdUser && form.password) {
      // Login imediato com a senha recém-definida (cookie via nextCookies).
      await getAuth().api.signInEmail({ body: { email: res.email, password: form.password }, headers: await headers() });
    }
    return { ok: true, data: { redirectTo: `/${res.tenantSlug}/produtos` } };
  } catch (err) {
    return toErrorResult(err, requestId);
  }
}
