import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import { getEnv } from "./env";
import { consumeRateLimit } from "./rate-limit";

function createAuth() {
  const env = getEnv();
  const db = getDb();
  return betterAuth({
    appName: "CIT Library",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: env.trustedOrigins,
    database: prismaAdapter(db, { provider: "postgresql" }),
    telemetry: { enabled: false },
    emailAndPassword: {
      enabled: true,
      // Sem matrícula pública: usuários entram por bootstrap ou convite.
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    user: {
      additionalFields: {
        active: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Sem cookie cache: cada requisição valida a sessão no banco, então
      // logout, revogação e desativação valem imediatamente.
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: true,
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
      },
      customStorage: {
        consume: (key, rule) => consumeRateLimit(`ip:${key}`, rule.window, rule.max),
      },
    },
    advanced: {
      useSecureCookies: env.secureCookies,
      database: { generateId: "uuid" },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/" },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/sign-in/email") return;
        const email = String((ctx.body as { email?: unknown })?.email ?? "").trim().toLowerCase();
        if (!email) return;
        // Limite por conta, além do limite por IP do Better Auth.
        const r = await consumeRateLimit(`acct:${email}`, 15 * 60, 10);
        if (!r.allowed) {
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Muitas tentativas. Aguarde alguns minutos e tente novamente.",
          });
        }
      }),
    },
    databaseHooks: {
      session: {
        create: {
          before: async (session) => {
            const user = await db.user.findUnique({ where: { id: session.userId }, select: { active: true } });
            if (!user?.active) return false;
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const g = globalThis as unknown as { citAuth?: Auth };

export function getAuth(): Auth {
  if (!g.citAuth) g.citAuth = createAuth();
  return g.citAuth;
}
