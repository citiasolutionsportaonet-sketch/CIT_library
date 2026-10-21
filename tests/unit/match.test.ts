import { describe, expect, it } from "vitest";
import { guessModel, imageMatchesModel, scoreOffer } from "@/modules/research/match";

describe("modelo sugerido", () => {
  it.each([
    ["Câmera Bullet VIP 1230 B G5, 2MP (Full HD), Lente fixa 3.6 mm", "VIP 1230 B G5"],
    ["MODULO INTELIGENTE DE PORTARIA MIP 1000 IP", "MIP 1000 IP"],
    ["FECHADURA DIGITAL SMART DE SOBREPOR MFR 1001", "MFR 1001"],
    ["Telefone Com Fio TC 60 ID Preto", "TC 60 ID"],
    ["Acionador Abertura Infravermelho BT 4001", "BT 4001"],
    ["Câmera Dome VIP 3240 D IA G2, 2MP (Full HD), Lente", "VIP 3240 D IA G2"],
    ["Vídeo Porteiro Externo XPE 3101 IP", "XPE 3101 IP"],
    ["EXPOSITOR SENSOR ESPI 180E", "ESPI 180E"],
    ["BATERIA P/RADIO COMUNICADOR BP4008 (4000MAH)", "BP4008"],
    ["Conversor Automático AC/DC 24V 5A EFM 2405 G2", "EFM 2405 G2"],
    ["MODULO OPS MSO 7008 I5 G2 COM 8GB RAM, PROCESSADOR", "MSO 7008 I5 G2"],
    ["UPS TRIFASICO TORRE DNB 120KVA-3PH-220V-TT-TW-BE", "DNB 120KVA-3PH-220V-TT-TW-BE"],
    ["SWITCH GERENCIAVEL SC 5530-48Y-8H S/FAN S/FONTE", "SC 5530-48Y-8H"],
  ])("%s → %s", (d, m) => expect(guessModel(d)).toBe(m));
  it("sem dígitos não sugere", () => expect(guessModel("Telefone c/Fio TOK FACIL PRETO")).toBeNull());
  it("categoria de cabo e frase não viram modelo", () => {
    expect(guessModel("PATCH CORD IMPACT GIGA U/UTP 4P CAT.6 AMARELO 0,5M")).toBeNull();
    expect(guessModel("LIC 36M W V RML ESSENT MAIOR QUE 30 RML")).toBeNull();
  });
  it("serviço com só números de quantidade não vira modelo", () => expect(guessModel("LIC 36M WIDE VOICE RML STARTER 2 A 5 RML")).toBeNull());
});

describe("correspondência de oferta", () => {
  const p = { model: "VIP 1230 B G5", description: "", brand: "Intelbras" };
  it("aceita anúncio exato, novo e com marca", () => {
    const r = scoreOffer("Câmera IP Intelbras VIP 1230 B G5 Bullet Full HD PoE", p, "NEW");
    expect(r.accept).toBe(true);
    expect(r.score).toBe(100);
  });
  it("não aceita modelo diferente (G4 x G5)", () => {
    expect(scoreOffer("Câmera Intelbras VIP 1230 B G4", p, "NEW").accept).toBe(false);
  });
  it("não aceita kit, usado ou sem marca", () => {
    expect(scoreOffer("Kit 4 Câmeras Intelbras VIP 1230 B G5", p, "NEW").accept).toBe(false);
    expect(scoreOffer("Intelbras VIP 1230 B G5", p, "USED").accept).toBe(false);
    expect(scoreOffer("Câmera VIP 1230 B G5", p, "NEW").accept).toBe(false);
  });
  it("sem modelo conhecido vai para revisão", () => {
    expect(scoreOffer("Telefone", { model: null, description: "Telefone c/Fio TOK FACIL PRETO", brand: null }, "NEW").accept).toBe(false);
  });
});

describe("imagem × modelo", () => {
  it("aceita quando os termos numéricos aparecem", () => {
    expect(imageMatchesModel("VIP 1230 B G5", ["Câmera VIP 1230 B G5", null, "https://backend.intelbras.com/x.png"])).toBe(true);
    expect(imageMatchesModel("VIP 1230 B G5", [null, null, "https://backend.intelbras.com/files/2024-10/vip-1230-b-g5-frente.png"])).toBe(true);
    expect(imageMatchesModel("MIP 1000 IP", [null, null, "https://backend.intelbras.com/files/MIP%201000%20IP.jpg"])).toBe(true);
  });
  it("recusa modelo vizinho e modelo ausente", () => {
    expect(imageMatchesModel("VIP 1230 B G5", ["VIP 1230 B G4"])).toBe(false);
    expect(imageMatchesModel("VIP 1230 B G5", ["Câmera Intelbras"])).toBe(false);
    expect(imageMatchesModel(null, ["VIP 1230"])).toBe(false);
  });
});
