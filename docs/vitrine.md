# Vitrine e visão do banco

O menu **Vitrine** abre `/<organização>/vitrine` após o login. A tela consulta os dados da organização e oferece busca, categorias, marcas, filtro de fotos, ordenação, paginação e acesso ao detalhe de cada produto. A aba **Visão do banco** mostra totais, preenchimento dos cadastros e os registros da página atual.

Essa apresentação exibe somente preço de venda. Custos, markup, notas internas, contas, credenciais e conexões do banco não integram o formato de dados da vitrine. Os indicadores consideram produtos não arquivados. “Sem foto” significa que a foto de capa não foi cadastrada; não são criadas fotos de produtos. As fotografias exibidas são as já existentes na biblioteca.

## Abrir a prévia sem instalar o sistema

1. Baixe `telas/catalogo-distribuidora.zip` pelo GitHub.
2. Extraia o ZIP e abra `catalogo.html` no navegador.
3. Use busca, categorias, filtros e detalhes. Clique em **Visão do banco** para ver os indicadores e a tabela.

O arquivo é autocontido: inclui estilo, interação e as fotos já cadastradas na amostra, sem buscar recursos externos. Mostra uma amostra de 24 produtos; os indicadores representam a biblioteca na data da exportação. Não é uma conexão ao banco e não grava alterações. O catálogo completo e o cadastro manual de fotos continuam disponíveis no sistema autenticado. Alterações no banco aparecem na consulta autenticada; a prévia precisa ser exportada novamente.

## Atualizar o HTML

Prepare um JSON público conforme `src/modules/showcase/schema.ts`. Revise os produtos e os valores que serão publicados, pois o repositório é público. Inclua apenas fotos existentes, embutidas como `data:image/webp;base64,...` (JPEG e PNG também são aceitos).

```bash
node --import tsx scripts/export-showcase.tsx --input var/amostra-publica.json --output telas/catalogo.html
```

Use Node 22 conforme `.nvmrc`. O exportador não lê o banco, `.env` ou diretórios de mídia. Valida a entrada, remove campos desconhecidos e serializa os valores como texto para impedir injeção de scripts. O JSON de preparação deve ficar em `var/`, fora do Git. Depois, atualize o ZIP e as capturas de tela.
