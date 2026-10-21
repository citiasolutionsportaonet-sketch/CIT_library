// Autoriza o app do Mercado Livre e grava as credenciais SEM exibi-las.
//   npm run ml:auth
// 1) pede Client ID e Client Secret (oculto) e grava no .env;
// 2) mostra o link de autorização; você aprova e cola a URL de retorno;
// 3) troca o código por tokens, guarda o refresh token no banco e testa a busca.
import fs from "node:fs";
import { saveMlRefreshToken, searchMl } from "@/modules/research/providers/mercadolivre";
import { ask, askHidden, main } from "./lib/common";

function setEnv(key: string, value: string) {
  const file = ".env";
  const text = fs.readFileSync(file, "utf8");
  const line = `${key}=${value}`;
  const next = new RegExp(`^${key}=.*$`, "m").test(text) ? text.replace(new RegExp(`^${key}=.*$`, "m"), line) : `${text.trimEnd()}\n${line}\n`;
  fs.writeFileSync(file, next, { mode: 0o600 });
  process.env[key] = value;
}

main(async () => {
  console.log("Mercado Livre · autorização do app (nada secreto será exibido)\n");
  const clientId = (await ask(`Client ID (App ID)${process.env.ML_CLIENT_ID ? " [Enter mantém o atual]" : ""}: `)) || process.env.ML_CLIENT_ID || "";
  if (!/^\d{6,20}$/.test(clientId)) throw new Error("Client ID deve ser numérico.");
  const secret = (await askHidden(`Client Secret${process.env.ML_CLIENT_SECRET ? " [Enter mantém o atual]" : ""}: `)) || process.env.ML_CLIENT_SECRET || "";
  if (secret.length < 10) throw new Error("Client Secret inválido.");
  const redirect = (await ask(`Redirect URI exatamente como cadastrada no app${process.env.ML_REDIRECT_URI ? ` [${process.env.ML_REDIRECT_URI}]` : ""}: `)) || process.env.ML_REDIRECT_URI || "";
  if (!/^https:\/\//.test(redirect)) throw new Error("A Redirect URI precisa começar com https://");
  setEnv("ML_CLIENT_ID", clientId);
  setEnv("ML_CLIENT_SECRET", secret);
  setEnv("ML_REDIRECT_URI", redirect);

  const authUrl = `https://auth.mercadolivre.com.br/authorization?${new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect })}`;
  console.log(`\n1) Abra no navegador (logado na conta do Mercado Livre) e autorize:\n\n${authUrl}\n`);
  console.log("2) Você será levado para a Redirect URI. A página pode até dar erro — tudo bem.");
  const back = await ask("3) Copie a URL inteira da barra de endereço e cole aqui: ");
  const code = new URL(back.trim()).searchParams.get("code");
  if (!code) throw new Error("A URL colada não contém ?code=…");

  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: secret, code, redirect_uri: redirect }),
  });
  if (!res.ok) throw new Error(`Troca do código falhou (HTTP ${res.status}). O código vale poucos minutos e uma única vez: rode de novo.`);
  const j = (await res.json()) as { access_token: string; refresh_token?: string; scope?: string };
  if (!j.refresh_token) throw new Error("O Mercado Livre não devolveu refresh token. No app, habilite o escopo offline_access e rode de novo.");
  await saveMlRefreshToken(j.refresh_token);
  console.log("\n✔ Autorizado. Refresh token guardado no banco (renovado automaticamente).");

  const test = await searchMl("intelbras vip 1230 b g5", 3);
  if (test.ok) {
    const d = (await test.json()) as { results?: { title: string; price: number }[] };
    console.log(`✔ Busca de teste OK: ${d.results?.length ?? 0} resultado(s). Ex.: ${d.results?.[0]?.title ?? "—"} — R$ ${d.results?.[0]?.price ?? "—"}`);
  } else {
    console.log(`✖ A busca respondeu HTTP ${test.status}. A autorização funcionou, mas o Mercado Livre não liberou a busca para este app (relatos de 403 desde 2025). Veja docs/pesquisa.md.`);
  }
  console.log("\nReinicie o app e o worker para carregar as novas variáveis.");
});
