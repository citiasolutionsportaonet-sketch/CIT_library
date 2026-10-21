// Regras de classificação por palavra-chave (heurística versionada).
// Só PROPÕEM categoria/marca; nada é gravado sem aprovação em lote.
// A primeira regra que casar vence: regras mais específicas vêm antes.
import { normalizeName } from "@/lib/normalize";

export const RULES_VERSION = "2026-10-21.1";

/** Árvore proposta: "Pai > Filho". */
export type CategoryPath = `${string} > ${string}` | string;

type Rule = { category: CategoryPath; any: RegExp };

const R = (category: CategoryPath, pattern: string): Rule => ({ category, any: new RegExp(pattern) });

// Padrões aplicados sobre o nome normalizado (minúsculo, sem acento).
export const CATEGORY_RULES: Rule[] = [
  // Serviços, assinaturas e licenças primeiro (descrições citam produtos)
  R("Serviços e assinaturas > Assinaturas", "^\\d+ meses\\b|\\bassinatura\\b|\\bplano\\b"),
  R("Serviços e assinaturas > Locação", "^locacao\\b"),
  R("Serviços e assinaturas > Serviços", "^servico\\b|\\binstalacao\\b.*\\bservico\\b"),
  R("Software e licenças > Chaves de hardware", "\\bchave de hardware\\b"),
  R("Software e licenças > Licenças", "^lic\\b|^licencas?\\b|\\blicencas?\\b|\\bsoftware\\b|\\bpermanent\\b|^dji terra\\b"),
  // Drones
  R("Drones e acessórios", "\\bdji\\b|\\bdrone\\b|\\bmatrice\\b|\\bmavic\\b"),
  // Incêndio
  R("Segurança eletrônica > Incêndio", "\\bacionador manual\\b|\\bdetector de fumaca\\b|\\bbloco de iluminacao\\b|\\bincendio\\b|\\bsinalizador\\b|\\bdetector de temperatura\\b"),
  // Proteção elétrica e automação antes (descrições citam "tomada", "sensor", "wi-fi")
  R("Energia > Proteção elétrica", "\\bprotetor eletronico\\b|\\bfiltro de linha\\b|\\bdps\\b|\\bregua\\b"),
  R("Automação residencial", "\\binterruptor\\b|\\bzigbee\\b|\\bacionador de cortinas\\b|\\bautomacao\\b|\\bizy\\b|\\bsmart home\\b|\\blampada\\b|\\bsoquete\\b|\\btomada\\b.*\\bsmart\\b|\\bmca \\d"),
  // Controle de acesso e portaria
  R("Segurança eletrônica > Controle de acesso", "\\bcatraca\\b|\\bfechadura\\b|\\bleitor\\b|\\bvideoporteiro\\b|\\bporteiro\\b|\\bportaria\\b|\\bautomatizador\\b|\\bcontrole de acesso\\b|\\btag\\b|\\bcartao (rfid|de proximidade)\\b|\\bacionador (de )?abertura\\b|\\bfechadura\\b|\\bxpe\\b|\\bss \\d|\\bcontrole remoto\\b|\\bcancela\\b|\\bbotoeira\\b"),
  R("Segurança eletrônica > Cerca elétrica", "\\bcerca eletrica\\b|\\belc \\d"),
  R("Segurança eletrônica > CFTV > Câmeras", "\\bcamera\\b|\\bvhd\\b|\\bvip\\b|\\bvipw\\b|\\bvhdm\\b|\\bim\\d\\b|\\bdome\\b|\\bbullet\\b"),
  R("Segurança eletrônica > Alarmes e sensores", "\\bsensor\\b|\\bcentral de alarme\\b|\\balarme\\b|\\bsirene\\b|\\bdetector\\b|\\bamt \\d|\\bivp\\b|\\bteclado\\b"),
  // CFTV
  R("Segurança eletrônica > CFTV > Gravadores e armazenamento", "\\bgravador\\b|\\bstorage\\b|\\bdvr\\b|\\bnvr\\b|\\bmhdx\\b|\\bimhdx\\b|\\binvd\\b|\\binvu\\b|\\bdisco\\b|\\bhd\\b.*\\b(tb|gb)\\b"),
  R("Segurança eletrônica > CFTV > Acessórios de CFTV", "\\bbalun\\b|\\bvb \\d|\\bbnc\\b|\\bcftv\\b|\\bconector conex\\b|\\bcartao micro ?sd\\b"),
  // Redes
  R("Redes e telecom > Fibra óptica", "\\boptic|\\bfibra\\b|\\bxfa\\b|\\bxfc\\b|\\bgpon\\b|\\bonu\\b|\\bolt\\b|\\bdio\\b|\\bcordoalha\\b"),
  R("Redes e telecom > Switches", "\\bswitch\\b"),
  R("Redes e telecom > Roteadores e Wi-Fi", "\\broteador\\b|\\bwi ?-?fi\\b|\\baccess point\\b|\\bap \\d|\\bmesh\\b|\\btwibi\\b|\\bcontrolador de rede\\b|\\bmodem\\b|\\bwc \\d"),
  R("Redes e telecom > Cabeamento estruturado", "\\bpatch\\b|\\brack\\b|\\bcabo\\b|\\bconector\\b|\\bcordao\\b|\\bbandeja\\b|\\bkeystone\\b|\\bguia de cabos\\b|\\bcaixa de terminacao\\b|\\bextensor\\b"),
  R("Redes e telecom > Rádios e antenas", "\\bradio\\b|\\bantena\\b|\\brep \\d|\\bamplificador rf\\b"),
  R("Redes e telecom > Telefonia", "\\btelefone\\b|\\bramal\\b|\\bcentral (telefonica|ip|digital|impacta|coletiva|cp)\\b|\\bcentral\\b.*\\bramais\\b|\\bheadset\\b|\\bata \\d|\\binterface celular\\b|\\bconversor de protocolo\\b|\\bcip \\d|\\bprotetor (de )?microfone\\b|\\bprotetor auricular\\b|\\btubo de voz\\b|\\bcelular fixo\\b|\\bpabx\\b|\\bunniti\\b|\\bimpacta\\b"),
  // Energia
  R("Energia > Nobreaks e UPS", "\\bnobreak\\b|\\bups\\b"),
  R("Energia > Baterias", "\\bbateria\\b"),
  R("Energia > Fontes e inversores", "\\bfonte\\b|\\binversor\\b|\\bestabilizador\\b|\\bcarregador\\b|\\bsolar\\b|\\bmodulo fotovoltaico\\b"),
  // Automação
  // Outros
  R("Materiais de PDV", "\\bexpositor\\b|\\bdisplay de balcao\\b|\\bbanner\\b"),
  R("Acessórios e informática", "\\bmouse\\b|\\bteclado\\b|\\bcartao\\b|\\bpen ?drive\\b|\\badaptador\\b|\\bsuporte\\b|\\bextensao\\b|\\bcaixa\\b|\\bmodulo\\b|\\bplaca\\b|\\bconversor\\b|\\bcontrolador\\b|\\bpainel\\b|\\bestacao\\b|\\bmini\\b"),
];

export function proposeCategory(name: string): CategoryPath | null {
  const n = normalizeName(name);
  for (const r of CATEGORY_RULES) if (r.any.test(n)) return r.category;
  return null;
}

/** Marca só quando o nome a CITA explicitamente (não é inferência). */
const BRANDS: { brand: string; pattern: RegExp }[] = [
  { brand: "Intelbras", pattern: /\bintelbras\b/ },
  { brand: "DJI", pattern: /\bdji\b/ },
  { brand: "Twibi", pattern: /\btwibi\b/ },
  { brand: "Novacomm", pattern: /\bnovacomm\b/ },
  { brand: "Wide Voice", pattern: /\bwide voice\b/ },
];

export function proposeBrand(name: string): string | null {
  const n = normalizeName(name);
  return BRANDS.find((b) => b.pattern.test(n))?.brand ?? null;
}
