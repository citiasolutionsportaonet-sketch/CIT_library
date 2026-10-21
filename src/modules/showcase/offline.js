(() => {
  const data = JSON.parse(document.getElementById("showcase-data").textContent);
  const root = document.querySelector(".cit-store");
  const state = { ...data.filters };
  const cards = new Map(
    [...root.querySelectorAll("[data-product]")].map((el) => [
      el.dataset.product,
      el,
    ]),
  );
  const fold = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const money = (value) =>
    value === null
      ? "Sob consulta"
      : new Intl.NumberFormat("pt-BR", {
          style: "currency",
          currency: "BRL",
        }).format(Number(value));

  function filter() {
    const products = data.products.filter(
      (p) =>
        (!state.q ||
          fold([p.name, p.sku, p.model, p.brand].join(" ")).includes(
            fold(state.q),
          )) &&
        (!state.category ||
          (state.category === "none"
            ? !p.categoryId
            : p.categoryId === state.category)) &&
        (!state.brand || p.brandId === state.brand) &&
        (!state.photo || p.image),
    );
    if (state.sort === "nome")
      products.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    if (state.sort === "recentes")
      products.sort(
        (a, b) =>
          Date.parse(b.updatedAt) - Date.parse(a.updatedAt) ||
          a.id.localeCompare(b.id),
      );
    const ids = new Set(products.map((p) => p.id));
    for (const [id, card] of cards) card.hidden = !ids.has(id);
    for (const p of products)
      root.querySelector(".store-grid").append(cards.get(p.id));
    for (const row of root.querySelectorAll("[data-table-product]"))
      row.hidden = !ids.has(row.dataset.tableProduct);
    root.querySelector("[data-results-count]").textContent =
      `${products.length} produtos encontrados na amostra`;
    root.querySelector("[data-empty]").hidden = products.length > 0;
    for (const link of root.querySelectorAll("[data-category]"))
      link.classList.toggle(
        "is-active",
        link.dataset.category === state.category,
      );
  }
  for (const link of root.querySelectorAll("[data-mode]"))
    link.addEventListener("click", (event) => {
      event.preventDefault();
      for (const panel of root.querySelectorAll("[data-panel]"))
        panel.hidden = panel.dataset.panel !== link.dataset.mode;
      for (const tab of root.querySelectorAll("[data-mode]"))
        tab.classList.toggle("is-active", tab === link);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  for (const link of root.querySelectorAll("[data-category]"))
    link.addEventListener("click", (event) => {
      event.preventDefault();
      state.category = link.dataset.category;
      filter();
    });
  root
    .querySelector("[data-search-form]")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      state.q = new FormData(event.target).get("q").trim();
      filter();
      root.querySelector("#produtos").scrollIntoView({ behavior: "smooth" });
    });
  root
    .querySelector("[data-filter-form]")
    .addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.target);
      state.brand = form.get("marca");
      state.photo = form.get("foto") === "1";
      filter();
    });
  root.querySelector("[data-sort-form]").addEventListener("submit", (event) => {
    event.preventDefault();
    state.sort = new FormData(event.target).get("ordem");
    filter();
  });
  const dialog = root.querySelector("#product-dialog");
  for (const button of root.querySelectorAll("[data-detail]"))
    button.addEventListener("click", () => {
      const p = data.products.find((p) => p.id === button.dataset.detail);
      const image = dialog.querySelector("[data-dialog-image]");
      image.replaceChildren();
      if (p.image) {
        const img = document.createElement("img");
        img.src = p.image;
        img.alt = p.name;
        image.append(img);
      } else image.textContent = "Imagem não cadastrada";
      dialog.querySelector("[data-dialog-brand]").textContent =
        p.brand ?? "Marca a confirmar";
      dialog.querySelector("[data-dialog-title]").textContent = p.name;
      dialog.querySelector("[data-dialog-sku]").textContent =
        `SKU ${p.sku}${p.model ? ` · Modelo ${p.model}` : ""}`;
      dialog.querySelector("[data-dialog-category]").textContent =
        p.category ?? "Sem categoria";
      dialog.querySelector("[data-dialog-price]").textContent = money(p.price);
      dialog.showModal();
    });
  dialog
    .querySelector("[data-close]")
    .addEventListener("click", () => dialog.close());
  filter();
})();
