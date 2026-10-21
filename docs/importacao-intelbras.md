# Importação da tabela do distribuidor

Executada em 21/10/2026 com `imports/iot valores.xlsx` (fora do Git), lote `afcf6b0a…`.

| Item | Valor |
|---|---|
| Linhas | 2.971 (códigos de 7 dígitos, todos únicos) |
| Produtos criados | 2.971, todos **rascunho**, sem marca (fabricante "a validar") |
| Custos registrados | 2.088 (soma R$ 20.649.083,7557, conferida com a planilha) |
| Custo zero → ausente | 883 (sem entrada de preço; aparecem "sem custo") |
| Descrições > 200 caracteres | 131: nome resumido + texto completo em Descrição |
| Custos > R$ 100 mil | 51 (licenças, storages, nobreaks) — sinalizados, mantidos |
| Vigência do custo | 21/10/2026 00:00 (America/Sao_Paulo) |

Fluxo: envio → prévia (nada gravado) → confirmação com vigência → worker aplica linha a linha (idempotente; reenvio do mesmo arquivo bloqueado sem justificativa). Mesmo serviço pela tela **Importações** ou `npm run import:catalog`.

Planilha `CIT_Library_lote_01_imagens.xlsx`: o "Catalogo CIT" só tem dados nas colunas A–C (iguais à tabela). Foram importadas as abas de pesquisa piloto: 14 ofertas (todas páginas de busca → fora da mediana), 6 imagens, 5 páginas oficiais, 5 links de documentação e 5 modelos sugeridos — tudo como **candidato preliminar**.

Pendente: perfil de mapeamento configurável na tela, CSV e homologação de outros layouts.
