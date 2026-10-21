# Motor de pesquisa e enriquecimento

Serviço independente do Claude Code: roda no **worker** (`npm run worker`), lendo a fila no PostgreSQL.

## Como funciona (por produto)
1. **Site oficial** (gratuito): lê páginas oficiais já conhecidas (planilha, links aprovados ou descobertas pela busca). Extrai `og:image`, dados estruturados (JSON-LD), imagens com o modelo no nome e links `.pdf`.
2. **Brave Search API** (pago, `BRAVE_SEARCH_API_KEY`): descobre a página oficial e PDFs restringindo a `RESEARCH_OFFICIAL_DOMAINS`. Não fornece preço.
3. **Mercado Livre API oficial** (`ML_ACCESS_TOKEN` ou app + refresh token): ofertas novas em BRL. **Não validado**: em 2025 houve relatos de 403 em `/sites/MLB/search` mesmo com token.
4. **Verificação**: toda imagem é baixada, tem o tipo conferido pelo conteúdo e é decodificada (mín. 300 px); todo PDF é baixado e conferido (`%PDF-`). Evidências já existentes ainda não conferidas também são verificadas.
5. Tudo vira **candidato**. Imagem só entra na galeria após aprovação, passando pelo mesmo pipeline do upload (reencode, sem EXIF). Máx. 3 imagens por produto.
6. Oferta é aceita automaticamente só com correspondência estrita (todos os termos do modelo, marca, condição nova, sem palavras de kit/peça/compatível). O resto aguarda revisão. Links de página de busca/loja **nunca** entram na mediana.

## Regras de acesso à internet
- robots.txt respeitado por domínio; 5xx no robots = não acessar.
- Bloqueio de IP privado/loopback/metadados (SSRF), inclusive após redirecionamento.
- Limite por domínio (`RESEARCH_HOST_RPM`), tamanho (10 MB imagem, 25 MB PDF) e tempo.
- Bloqueios do site (403, anti-robô) **não são contornados**: o item fica com a nota do bloqueio.

## Fila, orçamento e controle
- Execução = conjunto de produtos + provedores + **teto de chamadas pagas e de custo**. Reserva de orçamento atômica antes de cada chamada; ao estourar, a execução **pausa** sozinha.
- Painel `/cit/pesquisa` ou CLI: iniciar, pausar, retomar, cancelar, reexecutar falhas, percentual de conclusão, erros.
- Limite diário por provedor (`*_DAILY_MAX_CALLS`) e uso por dia em `provider_usage`.
- Jobs com lease de 90 s e heartbeat; worker interrompido → jobs recuperados. Limite/pausa adia sem gastar tentativa.

```bash
npm run research -- --skus 4570045,4570046 --providers official-site --max-calls 0 --max-cost 0 --as email@x
npm run research -- --limit 100 --providers official-site,brave-search --max-calls 120 --max-cost 6 --as email@x
npm run research -- --run <id> --action pause|resume|cancel|retry-failed --as email@x
npm run worker
```

## Limitações conhecidas (21/10/2026)
- As páginas `www.intelbras.com` passaram a responder **403 (anti-robô)** a acessos automatizados deste IP; o CDN `backend.intelbras.com` responde. Sem provedor licenciado ou canal oficial (feed/portal de parceiro), não há como enriquecer em escala a partir do site.
- Sem credencial do Mercado Livre/Brave, **não há pesquisa de preços**.
- Imagens de revendedores exigem confirmação de autorização de uso antes da aprovação.

## Configurar o Mercado Livre (preços)
1. Em https://developers.mercadolivre.com.br → **Minhas aplicações → Criar aplicação**, com a conta do Mercado Livre da empresa.
2. Preencha nome/descrição, **Redirect URI** com uma URL `https://` (ex.: a página da empresa) e marque os escopos de leitura e **offline_access**.
3. Anote o **Client ID** e o **Client Secret** (não envie por chat/e-mail).
4. No servidor: `npm run ml:auth` → informe Client ID, Secret (oculto) e a Redirect URI; abra o link exibido, autorize e cole a URL de retorno. O comando grava o necessário e testa uma busca real.
5. Reinicie app e worker. O refresh token é rotacionado pelo Mercado Livre a cada renovação e fica guardado no banco (`system_state`), não no `.env`.

## Configurar a Brave Search (página oficial e PDFs)
Crie a chave em https://brave.com/search/api (plano Search, exige cartão) e grave sem exibir:
```bash
read -s "K?Chave Brave: " && sed -i '' "s|^BRAVE_SEARCH_API_KEY=.*|BRAVE_SEARCH_API_KEY=$K|" .env && unset K && echo ok
```

## Imagens nos produtos
- **Brave Imagens** (`brave-images`, mesma chave `BRAVE_SEARCH_API_KEY`): 1 chamada por produto **com modelo ou sugestão de modelo**; aceita só imagens hospedadas em domínio oficial (`RESEARCH_IMAGES_OFFICIAL_ONLY=true`, padrão) cujo título/página/arquivo contenha os termos numéricos do modelo (G5 ≠ G4).
- Toda imagem é baixada e verificada antes de virar candidata. CDNs negociam formato; o pipeline usa sempre o formato realmente baixado.
- **Aprovação automática** (opção da execução, `--auto-images` ou caixa no painel): coloca na galeria até 3 imagens **oficiais** verificadas por produto. Imagens de revendedor só por aprovação individual.
- **Em lote, sem custo:** painel → "Colocar imagens oficiais verificadas nos produtos" ou `npm run research -- --approve-official-images --as email`.

Execução sugerida para todo o catálogo (depois de configurar a chave):
```bash
npm run research -- --name "Imagens oficiais" --limit 3000 --providers official-site,brave-images --max-calls 2300 --max-cost 70 --auto-images --as email@x
```
