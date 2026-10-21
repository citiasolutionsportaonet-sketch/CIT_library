/* eslint-disable @next/next/no-img-element, @next/next/no-head-element -- Renderização compartilhada com o documento HTML offline. */
import type { ReactNode } from "react";
import type { ShowcaseData } from "./schema";

function ArrowIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5 15 15 5M5 5h10v10"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const integer = (n: number) => new Intl.NumberFormat("pt-BR").format(n);
const currency = (p: string) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(p),
  );
const date = (s: string) =>
  new Date(s).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

export function ProductIcon({ small = false }: { small?: boolean }) {
  return (
    <svg
      width={small ? 22 : 62}
      height={small ? 22 : 62}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="m32 8 24 13v26L32 60 8 47V21L32 8Z"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="m8 21 24 14 24-14M32 35v25M20 15l24 14"
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

export function ShowcaseView({
  data: d,
  base,
  offline = false,
  mode = "catalogo",
}: {
  data: ShowcaseData;
  base: string;
  offline?: boolean;
  mode?: "catalogo" | "dados";
}) {
  const f = d.filters;
  const href = (changes: Record<string, string>) => {
    const p = new URLSearchParams({
      q: f.q,
      categoria: f.category,
      marca: f.brand,
      foto: f.photo ? "1" : "",
      ordem: f.sort,
      modo: mode,
    });
    for (const [k, v] of Object.entries(changes)) p.set(k, v);
    for (const [k, v] of [...p.entries()])
      if (!v || (k === "modo" && v === "catalogo")) p.delete(k);
    return `${base}?${p}`;
  };
  const hero = d.products.find((p) => p.image);
  const hiddenFilters = (except: string[]) =>
    Object.entries({
      q: f.q,
      categoria: f.category,
      marca: f.brand,
      foto: f.photo ? "1" : "",
      ordem: f.sort,
      modo: mode === "dados" ? "dados" : "",
    })
      .filter(([k, v]) => v && !except.includes(k))
      .map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  const tab = (key: string, title: string) => (
    <a
      data-mode={key}
      className={mode === key ? "is-active" : ""}
      href={href({ modo: key })}
    >
      {title}
    </a>
  );
  return (
    <div className="cit-store" data-offline={offline ? "true" : "false"}>
      <div className="store-topline">
        <span>TECNOLOGIA PARA QUEM CONSTRÓI SOLUÇÕES</span>
        <span>
          {offline
            ? "PRÉVIA INTERATIVA · AMOSTRA DO CATÁLOGO"
            : "CATÁLOGO INTERNO · ACESSO AUTENTICADO"}
        </span>
      </div>
      <header className="store-header">
        <div className="store-logo">
          <span className="store-logo-mark">cit</span>
          <span>
            library<small>PRODUTOS & SOLUÇÕES</small>
          </span>
        </div>
        <form className="store-search" action={base} data-search-form>
          {hiddenFilters(["q"])}
          <span aria-hidden="true">⌕</span>
          <input
            name="q"
            type="search"
            defaultValue={f.q}
            placeholder="O que você procura? Busque por produto, modelo ou SKU"
            aria-label="Buscar na vitrine"
            maxLength={120}
          />
          <button type="submit">
            Buscar{" "}
            <span aria-hidden="true">
              <ArrowIcon />
            </span>
          </button>
        </form>
        <div className="store-org">
          <span className="store-online" />
          {d.organization}
          <small>
            {offline
              ? "Amostra disponível offline"
              : "Sua biblioteca de produtos"}
          </small>
        </div>
      </header>
      <nav className="store-nav" aria-label="Visões da vitrine">
        <div>
          {tab("catalogo", "Catálogo de produtos")}
          {tab("dados", "Visão do banco")}
        </div>
        <span className="store-updated">
          Atualizado em {date(d.generatedAt)}
        </span>
      </nav>
      {offline && (
        <div className="store-snapshot">
          Você está navegando em uma amostra de {d.products.length} produtos. Os
          indicadores representam o banco na data da exportação; este arquivo
          não atualiza os dados do sistema.
        </div>
      )}

      <section data-panel="catalogo" hidden={mode !== "catalogo"}>
        <div className="store-hero">
          <div>
            <p className="store-eyebrow">INFORMAÇÃO QUE CONECTA NEGÓCIOS</p>
            <h1>
              Tecnologia certa.
              <br />
              Tudo em um só lugar<span>.</span>
            </h1>
            <p>
              Encontre produtos, compare informações e consulte os preços da sua
              biblioteca de soluções.
            </p>
            <div className="store-hero-bottom">
              <a href="#produtos" className="store-primary">
                Explorar produtos{" "}
                <span>
                  <ArrowIcon />
                </span>
              </a>
              <span>
                <strong>{integer(d.stats.total)}</strong> produtos no catálogo
              </span>
            </div>
          </div>
          <div className="store-hero-art">
            <span className="store-orbit" />
            <div className="store-featured-label">
              EM DESTAQUE{" "}
              <span>
                <ArrowIcon />
              </span>
            </div>
            {hero ? (
              <>
                <div className="store-hero-image">
                  <img src={hero.image!} alt={hero.name} />
                </div>
                <div className="store-featured-name">
                  <small>{hero.category ?? "Produto da biblioteca"}</small>
                  <strong>{hero.model ?? hero.name}</strong>
                </div>
              </>
            ) : (
              <div className="store-hero-placeholder">
                <ProductIcon />
                <strong>Soluções para o seu projeto</strong>
              </div>
            )}
          </div>
        </div>
        <div className="store-benefits">
          <span>
            <b>01</b> Informações centralizadas
          </span>
          <span>
            <b>02</b> Preços para consulta
          </span>
          <span>
            <b>03</b> Fotos e informações do produto
          </span>
          <span>
            <b>04</b> Dados da sua biblioteca
          </span>
        </div>
        <div className="store-body" id="produtos">
          <aside className="store-sidebar">
            <p className="store-eyebrow">ENCONTRE SUA SOLUÇÃO</p>
            <h2>Categorias</h2>
            <a
              data-category=""
              className={!f.category ? "is-active" : ""}
              href={href({ categoria: "" })}
            >
              <span>Todos os produtos</span>
              <b>{integer(d.stats.total)}</b>
            </a>
            {d.categories
              .filter((c) => c.count > 0)
              .map((c) => (
                <a
                  key={c.id}
                  data-category={c.id}
                  className={f.category === c.id ? "is-active" : ""}
                  href={href({ categoria: c.id })}
                >
                  <span>{c.name}</span>
                  <b>{integer(c.count)}</b>
                </a>
              ))}
            <div className="store-filter-box">
              <h3>Refine sua busca</h3>
              <form action={base} data-filter-form>
                {hiddenFilters(["marca", "foto"])}
                <label>
                  Marca
                  <select
                    name="marca"
                    defaultValue={f.brand}
                    aria-label="Marca da vitrine"
                  >
                    <option value="">Todas as marcas</option>
                    {d.brands.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="store-check">
                  <input
                    type="checkbox"
                    name="foto"
                    value="1"
                    defaultChecked={f.photo}
                  />{" "}
                  Apenas com foto
                </label>
                <button className="store-secondary" type="submit">
                  Aplicar filtros
                </button>
              </form>
            </div>
          </aside>
          <div className="store-results">
            <div className="store-results-head">
              <div>
                <p className="store-eyebrow">ESCOLHA. CONHEÇA. COMPARE.</p>
                <h2>Explore o catálogo</h2>
                <p data-results-count>
                  {integer(d.total)} produtos encontrados
                  {offline ? " na amostra" : ""}
                </p>
              </div>
              <form action={base} data-sort-form>
                {hiddenFilters(["ordem"])}
                <label>
                  Ordenar por
                  <select
                    name="ordem"
                    defaultValue={f.sort}
                    aria-label="Ordenação da vitrine"
                  >
                    <option value="destaques">Com fotos primeiro</option>
                    <option value="nome">Nome do produto</option>
                    <option value="recentes">Mais recentes</option>
                  </select>
                </label>
                <button type="submit" className="store-sort-submit">
                  Ordenar
                </button>
              </form>
            </div>
            <div className="store-grid">
              {d.products.map((p) => (
                <article
                  className="store-product"
                  key={p.id}
                  data-product={p.id}
                >
                  <div className="store-product-photo">
                    <span className="store-product-kind">
                      {p.category ?? "A classificar"}
                    </span>
                    {p.image ? (
                      <>
                        <img src={p.image} alt={p.name} loading="lazy" />
                      </>
                    ) : (
                      <div className="store-no-photo">
                        <ProductIcon />
                        <span>Imagem não cadastrada</span>
                      </div>
                    )}
                  </div>
                  <div className="store-product-info">
                    <p className="store-product-brand">
                      {p.brand ?? "MARCA A CONFIRMAR"}
                    </p>
                    <h3>{p.name}</h3>
                    <p className="store-sku">SKU {p.sku}</p>
                    <div className="store-product-bottom">
                      <div>
                        <small>Preço CIT</small>
                        <strong>
                          {p.price ? currency(p.price) : "Sob consulta"}
                        </strong>
                      </div>
                      {offline ? (
                        <button
                          type="button"
                          data-detail={p.id}
                          aria-label={`Ver ${p.name}`}
                        >
                          <ArrowIcon />
                        </button>
                      ) : (
                        <a
                          href={`/${encodeURIComponent(base.split("/")[1])}/produtos/${p.id}`}
                          aria-label={`Ver ${p.name}`}
                        >
                          <ArrowIcon />
                        </a>
                      )}
                    </div>
                    <p className="store-product-status">
                      <span
                        className={p.status === "ACTIVE" ? "is-ready" : ""}
                      />
                      {p.status === "ACTIVE"
                        ? "Cadastro ativo"
                        : "Cadastro em revisão"}
                    </p>
                  </div>
                </article>
              ))}
            </div>
            <p
              className="store-empty"
              data-empty
              hidden={d.products.length > 0}
            >
              Nenhum produto encontrado. Tente outro termo ou remova os filtros.
            </p>
            {!offline && d.pageCount > 1 && (
              <nav
                className="store-pagination"
                aria-label="Paginação da vitrine"
              >
                {d.page > 1 && (
                  <a href={href({ pagina: String(d.page - 1) })}>← Anterior</a>
                )}
                <span>
                  Página {d.page} de {d.pageCount}
                </span>
                {d.page < d.pageCount && (
                  <a href={href({ pagina: String(d.page + 1) })}>Próxima →</a>
                )}
              </nav>
            )}
          </div>
        </div>
      </section>

      <section
        className="store-database"
        data-panel="dados"
        hidden={mode !== "dados"}
      >
        <p className="store-eyebrow">UMA VISÃO CLARA DA SUA BIBLIOTECA</p>
        <h1>
          O banco, em números<span>.</span>
        </h1>
        <p className="store-database-intro">
          Acompanhe o que já está cadastrado e o que ainda precisa ser
          preenchido.
          {offline
            ? " Indicadores registrados na exportação."
            : " Indicadores consultados no banco da sua organização."}
        </p>
        <div className="store-metrics">
          {[
            ["Produtos no catálogo", d.stats.total],
            ["Com preço disponível", d.stats.withPrice],
            ["Com foto de capa", d.stats.withPhoto],
            ["Marcas cadastradas", d.brands.length],
          ].map(([label, value]) => (
            <div className="store-metric" key={label}>
              <small>{label}</small>
              <strong>{integer(Number(value))}</strong>
              <span>
                <ArrowIcon />
              </span>
            </div>
          ))}
        </div>
        <div className="store-data-columns">
          <div className="store-data-card">
            <h2>Qualidade dos cadastros</h2>
            <p>Campos preenchidos nos produtos não arquivados.</p>
            {[
              ["Preço para consulta", d.stats.withPrice],
              ["Foto de capa", d.stats.withPhoto],
              ["Marca informada", d.stats.withBrand],
              ["Modelo informado", d.stats.withModel],
            ].map(([label, value]) => (
              <div className="store-progress" key={label}>
                <div>
                  <span>{label}</span>
                  <b>
                    {integer(Number(value))} / {integer(d.stats.total)}
                  </b>
                </div>
                <div className="store-track">
                  <span
                    style={{
                      width: `${d.stats.total ? Math.round((Number(value) / d.stats.total) * 100) : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="store-data-card store-status-card">
            <span className="store-status-symbol">◉</span>
            <h2>{offline ? "Retrato do banco" : "Banco conectado"}</h2>
            <p>
              {offline
                ? "Esta prévia contém uma amostra de produtos e totais do banco. Nenhuma alteração feita aqui será gravada no sistema."
                : "Os produtos, preços e indicadores desta página vêm do banco da sua organização."}
            </p>
            <dl>
              <div>
                <dt>Cadastros ativos</dt>
                <dd>{integer(d.stats.active)}</dd>
              </div>
              <div>
                <dt>Cadastros em revisão</dt>
                <dd>{integer(d.stats.drafts)}</dd>
              </div>
              <div>
                <dt>Última alteração</dt>
                <dd>{d.updatedAt ? date(d.updatedAt) : "Nenhum cadastro"}</dd>
              </div>
            </dl>
          </div>
        </div>
        <div className="store-data-card store-table-card">
          <div>
            <h2>Os registros por trás da vitrine</h2>
            <p>
              {offline
                ? "Produtos incluídos nesta amostra."
                : "Produtos da página atual, com os mesmos filtros da vitrine."}
            </p>
          </div>
          <div className="store-table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    "Produto / SKU",
                    "Marca",
                    "Categoria",
                    "Preço CIT",
                    "Cadastro",
                  ].map((s) => (
                    <th key={s}>{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.products.map((p) => (
                  <tr data-table-product={p.id} key={p.id}>
                    <td>
                      <strong>{p.name}</strong>
                      <small>{p.sku}</small>
                    </td>
                    <td>{p.brand ?? "A confirmar"}</td>
                    <td>{p.category ?? "Sem categoria"}</td>
                    <td>{p.price ? currency(p.price) : "Sob consulta"}</td>
                    <td>
                      <span className="store-table-badge">
                        {p.status === "ACTIVE" ? "Ativo" : "Em revisão"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {!offline && d.pageCount > 1 && (
          <nav
            className="store-pagination"
            aria-label="Paginação dos registros"
          >
            {d.page > 1 && (
              <a href={href({ pagina: String(d.page - 1) })}>Anterior</a>
            )}
            <span>
              Página {d.page} de {d.pageCount}
            </span>
            {d.page < d.pageCount && (
              <a href={href({ pagina: String(d.page + 1) })}>Próxima</a>
            )}
          </nav>
        )}
      </section>
      <footer className="store-footer">
        <strong>cit library</strong>
        <span>Informação organizada. Decisões melhores.</span>
        <small>
          {offline
            ? "Prévia de consulta · não é uma loja online"
            : "Consulta interna · valores sujeitos à atualização"}
        </small>
      </footer>
      {offline && (
        <dialog className="store-dialog" id="product-dialog">
          <button type="button" data-close aria-label="Fechar detalhes">
            ×
          </button>
          <div data-dialog-image />
          <p className="store-eyebrow" data-dialog-brand />
          <h2 data-dialog-title />
          <p data-dialog-sku />
          <p data-dialog-category />
          <strong data-dialog-price />
        </dialog>
      )}
    </div>
  );
}

export function ShowcaseDocument({
  children,
  css,
  script,
  json,
}: {
  children: ReactNode;
  css: string;
  script: string;
  json: string;
}) {
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"
        />
        <title>CIT Library · Catálogo interativo</title>
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {children}
        <script
          id="showcase-data"
          type="application/json"
          dangerouslySetInnerHTML={{ __html: json }}
        />
        <script dangerouslySetInnerHTML={{ __html: script }} />
      </body>
    </html>
  );
}
