import { describe, expect, it } from "vitest";
import { extractFromHtml } from "@/modules/research/providers/official-site";

describe("extração de página oficial", () => {
  const html = `<html><head>
    <meta property="og:title" content="Câmera IP VIP 1230 B G5 &amp; PoE">
    <meta property="og:image" content="/sites/default/files/vip-1230-b-g5.png">
    <script type="application/ld+json">{"@type":"Product","name":"VIP 1230 B G5","brand":{"name":"Intelbras"},"model":"VIP 1230 B G5","image":["https://backend.intelbras.com/a.jpg"]}</script>
    </head><body>
    <img src="/logo.svg"><img src="/files/vip-1230-b-g5-lado.jpg" alt="VIP 1230 B G5 lateral"><img src="/files/outra.jpg" alt="Outro produto">
    <a href="/files/datasheet-vip-1230-b-g5.pdf">Datasheet</a><a href="/files/manual.pdf?v=2">Manual do usuário</a><a href="/sobre">Sobre</a>
    <script>alert(1)</script></body></html>`;
  const x = extractFromHtml(html, "https://www.intelbras.com/pt-br/vip-1230", "VIP 1230 B G5");
  it("imagens: og, JSON-LD e <img> do modelo; ignora logo e outros", () => {
    expect(x.images).toEqual([
      "https://www.intelbras.com/sites/default/files/vip-1230-b-g5.png",
      "https://backend.intelbras.com/a.jpg",
      "https://www.intelbras.com/files/vip-1230-b-g5-lado.jpg",
    ]);
  });
  it("PDFs com rótulo e campos estruturados", () => {
    expect(x.docs.map((d) => d.label)).toEqual(["Datasheet", "Manual do usuário"]);
    expect(x.fields).toMatchObject({ manufacturer: "Intelbras", model: "VIP 1230 B G5" });
  });
});
