import { describe, expect, it } from "vitest";
import { proposeBrand, proposeCategory } from "@/modules/catalog/category-rules";

describe("classificação proposta", () => {
  it.each([
    ["Câmera Bullet VIP 1230 B G5, 2MP", "Segurança eletrônica > CFTV > Câmeras"],
    ["GRAVADOR DIG VID INVU 91128 M4 IAX FT", "Segurança eletrônica > CFTV > Gravadores e armazenamento"],
    ["STORAGE VIDEO SVS 9148 D FT", "Segurança eletrônica > CFTV > Gravadores e armazenamento"],
    ["LICENCA SOFTWARE INC EAD 5000 SW-INC-EADE-5K", "Software e licenças > Licenças"],
    ["24 meses | Wide Voice | Ramal Enterprise", "Serviços e assinaturas > Assinaturas"],
    ["UPS TRIFASICO TORRE DNB 120KVA-3PH-220V-TT-TW-BE", "Energia > Nobreaks e UPS"],
    ["BATERIA P/DRONE DJI MATRICE 3D SERIES", "Drones e acessórios"],
    ["FECHADURA DIGITAL SMART DE SOBREPOR MFR 1001", "Segurança eletrônica > Controle de acesso"],
    ["MODULO INTELIGENTE DE PORTARIA MIP 1000 IP", "Segurança eletrônica > Controle de acesso"],
    ["SWITCH GERENCIAVEL SC 5530-48Y-8H S/FAN S/FONTE", "Redes e telecom > Switches"],
    ["Caixa de Terminação Óptica Cordoalha XFC", "Redes e telecom > Fibra óptica"],
    ["Telefone c/Fio TOK FACIL PRETO", "Redes e telecom > Telefonia"],
    ["CENTRAL TELEFONICA 32RA 8TA 60R IP 20T UNNITI 3000", "Redes e telecom > Telefonia"],
    ["ACIONADOR MANUAL CONVENCIONAL AMC 466", "Segurança eletrônica > Incêndio"],
    ["SENSOR PASSIVO IVP 3000 PET", "Segurança eletrônica > Alarmes e sensores"],
    ["ACIONADOR DE CORTINAS SMART IAC 110", "Automação residencial"],
    ["EXPOSITOR ARAMADO BALCAO DE ENERGIA PEQUENO", "Materiais de PDV"],
    ["CABO U/UTP CAT.6 305M AZ CM IG6CMAZ", "Redes e telecom > Cabeamento estruturado"],
    ["VHD 3220 D FC+ - CÂMERA DOME, FULL COLOR INTELIGENTE", "Segurança eletrônica > CFTV > Câmeras"],
    ["Interruptor Sensor de Presença p/Iluminação ESPI 360 PT", "Automação residencial"],
    ["TOMADA SIMPLES 10A SMART WI-FI ETS 2002 BRANCO", "Automação residencial"],
    ["Lâmpada LED Wi-Fi Smart EWS 410", "Automação residencial"],
    ["Protetor Eletrônico C/ 4 TOMADAS EPE 1004", "Energia > Proteção elétrica"],
    ["LICENCAS 5 RAMAIS IP CIP 92200", "Software e licenças > Licenças"],
    ["ADAPTADOR ELETRICO BRANCO 2 TOMADAS 2 USB", "Acessórios e informática"],
  ])("%s", (name, cat) => expect(proposeCategory(name)).toBe(cat));
  it("sem regra → null (vai para revisão)", () => expect(proposeCategory("XYZ 123")).toBeNull());
  it("marca só quando citada", () => {
    expect(proposeBrand("ADAPTADOR INTELBRAS USB A/C ADI20")).toBe("Intelbras");
    expect(proposeBrand("BATERIA P/DRONE DJI MATRICE")).toBe("DJI");
    expect(proposeBrand("Câmera Bullet VIP 1230 B G5")).toBeNull();
  });
});
