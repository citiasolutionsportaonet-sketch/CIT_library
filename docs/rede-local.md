# Acesso por outro Mac na mesma rede

## Escolha um Mac servidor
Só ele roda app, PostgreSQL e guarda fotos. Os outros usam apenas o navegador. Nunca rode dois servidores com catálogos diferentes.

## 1. Descubra o endereço do servidor
```bash
networksetup -listallhardwareports
ipconfig getifaddr en0
```
`en0` é exemplo (Wi-Fi costuma ser en0 em MacBooks; confira a lista). Prefira **reservar o IP no roteador** ou usar o nome `.local` do Mac (Ajustes → Geral → Compartilhamento → "Nome do host local", ex.: `cit-servidor.local`).

## 2. Configure a URL canônica no `.env`
Use **o mesmo endereço em todos os Macs**, inclusive no próprio servidor (cookies são por host):
```dotenv
BETTER_AUTH_URL=http://cit-servidor.local:3000
APP_ORIGIN=http://cit-servidor.local:3000
TRUSTED_ORIGINS=http://cit-servidor.local:3000
DEV_ALLOWED_ORIGINS=cit-servidor.local
```

## 3. Suba ouvindo na rede
- Desenvolvimento: `npm run dev:lan`
- Produção local: `npm run build && HOST=0.0.0.0 npm start`

Reinicie após mudar o `.env`. Na primeira vez o macOS pergunta se aceita conexões de entrada para `node`: permita.

## 4. No segundo Mac
Abra `http://cit-servidor.local:3000` e entre com a conta criada por convite.
Se não abrir: confira se estão na mesma rede, se o roteador não isola clientes ("isolamento de AP"), e teste `ping cit-servidor.local`.

## Limites de segurança
- HTTP na rede local é **apenas para teste em rede confiável**: senha e cookie trafegam sem criptografia. Não exponha a porta no roteador.
- PostgreSQL fica preso a `127.0.0.1`; outros Macs nunca acessam o banco.
- Para uso contínuo com dados reais: HTTPS com proxy (ex.: Caddy) e certificado confiável nos Macs; troque as três URLs para `https://` (cookies passam a ser `Secure` automaticamente). Esse procedimento ainda **não** foi montado — pendência registrada em docs/status.md.
- Impeça o repouso do servidor durante o uso (Ajustes → Bateria/Energia).

## Trocar o Mac servidor
Pare o app, `npm run backup`, transfira a pasta do backup por canal seguro, instale as mesmas versões, `npm run restore`, ajuste as URLs, teste login/produto/foto e só então troque o endereço. Nunca grave nos dois ao mesmo tempo.

## Desenvolver em dois Macs
Código via Git remoto privado (ou `git bundle`). Cada Mac tem seu próprio `.env`, banco e mídia. Nunca copie `node_modules`, volume Docker, `.env` ou banco em execução.
