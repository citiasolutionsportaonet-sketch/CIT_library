// Gera uma prévia offline a partir de um JSON explicitamente preparado para
// publicação. Não acessa o banco nem lê .env, credenciais ou arquivos de mídia.
import fs from "node:fs/promises";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { showcaseSchema } from "../src/modules/showcase/schema";
import { ShowcaseDocument, ShowcaseView } from "../src/modules/showcase/view";

async function main() {
  const get = (name: string) => {
    const i = process.argv.indexOf(`--${name}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const input = get("input");
  if (!input)
    throw new Error("Informe --input JSON_PUBLICO e --output CAMINHO_HTML.");
  // Zod remove campos desconhecidos antes de serializar para o arquivo público.
  const data = showcaseSchema.parse(
    JSON.parse(await fs.readFile(input, "utf8")),
  );
  for (const p of data.products) {
    if (
      p.image &&
      !/^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(p.image)
    )
      throw new Error(
        "As fotos devem estar embutidas em base64; não são aceitas URLs externas ou caminhos privados.",
      );
  }
  data.total = data.products.length;
  data.page = 1;
  data.pageCount = 1;
  data.filters = {
    q: "",
    category: "",
    brand: "",
    photo: false,
    sort: "destaques",
  };
  const css = await fs.readFile("src/modules/showcase/showcase.css", "utf8");
  const script = await fs.readFile("src/modules/showcase/offline.js", "utf8");
  const json = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const html =
    "<!DOCTYPE html>" +
    renderToStaticMarkup(
      <ShowcaseDocument css={css} script={script} json={json}>
        <ShowcaseView data={data} base="catalogo.html" offline />
      </ShowcaseDocument>,
    );
  const output = get("output") ?? "telas/catalogo.html";
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, html);
  console.log(
    `Prévia offline gerada: ${output} (${data.products.length} produtos; custos e usuários excluídos do formato).`,
  );
}
main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
