/* Search the edition's grouped public properties and fetch IDs for one page. */
(() => {
  "use strict";
  const form = document.getElementById("family-search");
  const output = document.getElementById("search-results");
  const status = document.getElementById("search-status");
  const advanced = document.getElementById("advanced-search");
  const rankCache = new Map(), blockCache = new Map();
  const pageSize = 25;
  const planeBits = {O3: 1, O5: 2, O7: 4, O9: 8};
  const label = new Intl.NumberFormat("en-US");
  const base = new URL("./search/", document.baseURI);
  const categorical = {
    rank: ["1", "2", "3", "4", "5", "6"], kind: ["NID", "REF"],
    smooth: ["smooth", "singular", "null"], parity: ["1", "-1"], omega: ["1", "-1"],
    fixed: ["listed", "empty", "unavailable"], finite: ["0", "1"]
  };
  const numeric = ["h21", "h11minus", "h21minus", "euler", "o3"];
  const named = [...Object.keys(categorical), ...numeric, "d3"];
  let request = 0, exportUrl;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  // Compare four times the tadpole with the stored integer Euler number.
  function quadruple(value) {
    const match = /^([+-]?)(\d+)(?:\/(\d+)|\.(\d+))?$/.exec(value);
    if (!match || value.length > 32) throw Error("Enter the D3 tadpole in quarter units, such as 12 or 49/4.");
    const numerator = BigInt(match[2] + (match[4] || "")) * (match[1] === "-" ? -4n : 4n);
    const denominator = match[3] ? BigInt(match[3]) : 10n ** BigInt((match[4] || "").length);
    if (!denominator || numerator % denominator !== 0n || !Number.isSafeInteger(Number(numerator / denominator))) {
      throw Error("Enter the D3 tadpole in quarter units, such as 12 or 49/4.");
    }
    return Number(numerator / denominator);
  }

  function readQuery(params) {
    const filters = {};
    for (const key of named) {
      const value = params.get(key);
      if (!value) continue;
      if (categorical[key] && !categorical[key].includes(value)) throw Error("Unknown selection for " + key + ".");
      if (numeric.includes(key) && (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || (key !== "euler" && Number(value) < 0))) {
        throw Error("The " + key + " filter requires an integer in the field’s range.");
      }
      filters[key] = value;
    }
    const names = (params.get("planes") || "").split(",").filter(Boolean);
    if (names.some(p => !Object.hasOwn(planeBits, p))) throw Error("Choose O3, O5, O7 or O9 for the O-plane filter.");
    filters.planes = names;
    if (filters.d3) filters.fourD3 = quadruple(filters.d3);
    const page = Number(params.get("page") || 1);
    if (!Number.isSafeInteger(page) || page < 1) throw Error("The page number must be a positive integer.");
    return {filters, page};
  }

  function fromForm() {
    const params = new URLSearchParams({search: "1"});
    for (const key of named) {
      const value = form.elements.namedItem(key).value.trim();
      if (value) params.set(key, value);
    }
    const planes = new FormData(form).getAll("plane");
    if (planes.length) params.set("planes", planes.join(","));
    return params;
  }

  function fillForm(filters) {
    for (const key of named) form.elements.namedItem(key).value = filters[key] || "";
    for (const box of form.querySelectorAll("input[name=plane]")) box.checked = filters.planes.includes(box.value);
    if (Array.from(advanced.querySelectorAll("[name]")).some(el => filters[el.name])) advanced.open = true;
  }

  function tell(message, error = false) {
    status.textContent = message;
    status.classList.toggle("error", error);
  }

  function cached(cache, key, load) {
    if (cache.has(key)) return cache.get(key);
    const promise = load();
    cache.set(key, promise);
    promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
    return promise;
  }

  async function readGzip(path) {
    const response = await fetch(new URL(path, base));
    if (!response.ok) throw Error("The search index could not be loaded (HTTP " + response.status + "). Retry the search.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes.buffer; // The HTTP server may already have decoded it.
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).arrayBuffer();
  }

  function getRank(rank) {
    return cached(rankCache, rank, async () => {
      const data = JSON.parse(new TextDecoder().decode(await readGzip("h" + rank + "/groups.json.gz")));
      if (data.version !== 1 || data.rank !== rank || !Array.isArray(data.groups)) throw Error("Incompatible search index.");
      data.col = Object.fromEntries(data.fields.map((name, i) => [name, i]));
      for (const field of ["h21", "finite", "kind", "poly_parity", "omega", "smooth", "planes", "fixed_state", "euler",
                           "o3", "h11_minus", "h21_minus", "count", "start"]) {
        if (!Object.hasOwn(data.col, field)) throw Error("Missing index field: " + field);
      }
      return data;
    });
  }

  function getBlock(rank, number) {
    const key = "h" + rank + "/p" + number + ".bin.gz";
    const block = cached(blockCache, key, async () => new DataView(await readGzip(key)));
    // Retain only a few recently used ID blocks across page changes.
    while (blockCache.size > 32) blockCache.delete(blockCache.keys().next().value);
    return block;
  }

  function localD3Eligible(row, c) {
    const mask = row[c.planes];
    return row[c.smooth] === "smooth" && row[c.omega] === -1 && row[c.fixed_state] === "listed" &&
      mask !== 0 && (mask & ~5) === 0 && Number.isSafeInteger(row[c.euler]);
  }

  function selectGroups(ranks, f) {
    const checks = [];
    for (const [key, column] of Object.entries({kind:"kind", smooth:"smooth", fixed:"fixed_state", parity:"poly_parity",
      omega:"omega", finite:"finite", euler:"euler", o3:"o3", h21:"h21", h11minus:"h11_minus", h21minus:"h21_minus"})) {
      if (f[key] === undefined) continue;
      const value = ["kind","fixed","smooth"].includes(key) ? (f[key] === "null" ? null : f[key]) : Number(f[key]);
      checks.push([column, value]);
    }
    const mask = f.planes.reduce((n, p) => n | planeBits[p], 0), matches = [];
    let count = 0;
    for (const data of ranks) {
      const c = data.col, fields = checks.map(([key, value]) => [c[key], value]);
      for (const row of data.groups) {
        if ((row[c.planes] & mask) !== mask || fields.some(([col, value]) => row[col] !== value)) continue;
        if (f.d3 !== undefined && (!localD3Eligible(row, c) || row[c.euler] !== f.fourD3)) continue;
        matches.push({data, row, first:count});
        count += row[c.count];
      }
    }
    return {matches, count};
  }

  function identify(data, row, view, offset) {
    const c = data.col;
    const packed = view.getFloat64(8 * (offset % data.chunk_size), true);
    if (!Number.isSafeInteger(packed) || packed < 0) throw Error("Invalid family identifier in the search index.");
    const quotient = Math.floor(packed / data.action_stride);
    const triCode = quotient % data.tri_stride;
    const poly = data.polytopes[Math.floor(quotient / data.tri_stride)];
    if (poly == null) throw Error("Missing polytope in the search index.");
    const prefix = "P" + data.rank + "_" + poly;
    const tri = (triCode % 2 ? "TX" : "T") + Math.floor(triCode / 2);
    const action = (row[c.kind] === "REF" ? "R" : "I") + packed % data.action_stride;
    const parity = row[c.poly_parity] === 1 ? "Pplus" : "Pminus";
    const url = new URL("./", document.baseURI);
    url.search = new URLSearchParams({h:data.rank, p:poly, t:prefix+"_"+tri, i:prefix+"_"+action, s:parity});
    return {id:[prefix,tri,action,parity].join("_"), url:url.href};
  }

  async function rowsForPage(matches, begin, end) {
    const tasks = [];
    for (const {data, row, first} of matches) {
      if (first >= end) break;
      const c = data.col, stop = Math.min(end, first + row[c.count]);
      for (let n = Math.max(begin, first); n < stop; n++) {
        const offset = row[c.start] + n - first;
        tasks.push({data, row, offset});
      }
    }
    const rows = [];
    for (let i = 0; i < tasks.length; i += 5) {
      const part = await Promise.all(tasks.slice(i, i + 5).map(async ({data,row,offset}) => {
        const block = await getBlock(data.rank, Math.floor(offset / data.chunk_size));
        return {data,row,...identify(data,row,block,offset)};
      }));
      rows.push(...part);
    }
    return rows;
  }

  function planesText(state, mask) {
    if (state === "empty") return "Empty fixed set";
    if (state === "unavailable") return "Unavailable";
    const names = Object.keys(planeBits).filter(p => mask & planeBits[p]);
    if (mask & 16) names.push("Unassigned");
    return names.join(" + ") || "Unassigned";
  }

  function makeTable(rows) {
    const wrap = node("div", undefined, "scroll"), table = node("table", undefined, "properties-table");
    const columns = ["Eigenfamily", "Hodge pair", "Action", "O-planes", "O3 points", "χ(Fix)", "D3 tadpole¹", "Smoothness"];
    const header = table.createTHead().insertRow();
    for (const title of columns) { const th = node("th",title); th.scope = "col"; header.append(th); }
    const body = table.createTBody();
    const csv = [["orientifold_id","h11","h21","kind","polynomial_parity","omega_parity","smoothness","fixed_state",
      "plane_types","euler_fixed","o3_points","h11_minus","h21_minus","finite_cox","local_d7_L_D3","record_url"]];
    for (const {data,row,id,url} of rows) {
      const c = data.col, tr = body.insertRow(), a = node("a",id,"family-id");
      a.href = url; a.dataset.searchRecord = "";
      const planes = planesText(row[c.fixed_state], row[c.planes]);
      const d3 = localD3Eligible(row,c) ? row[c.euler] / 4 : null;
      const values = [a, "(" + data.rank + ", " + row[c.h21] + ")", row[c.kind], planes, row[c.o3],
        row[c.euler], d3, row[c.smooth] ?? "No verdict"];
      values.forEach((value,i) => {
        const cell = tr.insertCell(); cell.dataset.label = columns[i];
        cell.append(value == null ? "—" : value);
      });
      csv.push([id,data.rank,row[c.h21],row[c.kind],row[c.poly_parity],row[c.omega],row[c.smooth],row[c.fixed_state],
        planes,row[c.euler],row[c.o3],row[c.h11_minus],row[c.h21_minus],row[c.finite],d3,url]);
    }
    wrap.append(table, node("p", "¹ Geometric D3 tadpole for local D7 stacks. A dash indicates that the derivation does not apply or lacks data.", "field-help"));
    const text = csv.map(line => line.map(v => '"' + String(v ?? "").replaceAll('"','""') + '"').join(",")).join("\r\n");
    exportUrl = URL.createObjectURL(new Blob([text+"\r\n"],{type:"text/csv;charset=utf-8"}));
    return wrap;
  }

  function pageURL(page) {
    const url = new URL(location.href); url.hash = "";
    if (page === 1) url.searchParams.delete("page"); else url.searchParams.set("page", page);
    return url;
  }

  function navigate(url) {
    if (new URL(location.href).searchParams.has("p")) { location.assign(url); return; }
    if (location.href !== url.href) history.pushState(null,"",url);
    run(true);
  }

  function pageTools(page, pages) {
    const nav = node("nav",undefined,"result-tools"); nav.setAttribute("aria-label","Search result pages");
    for (const [target, title] of [[page-1,"Previous"],[page+1,"Next"]]) {
      if (target < 1 || target > pages) continue;
      const a = node("a", title); a.href = pageURL(target);
      a.addEventListener("click", e => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        e.preventDefault(); navigate(new URL(a.href));
      });
      nav.append(a);
    }
    if (pages > 1) {
      const jump = node("form"), legend = node("label","Page "), input = node("input"), go = node("button","Go","secondary");
      input.type = "number"; input.min = 1; input.max = pages; input.value = page; input.required = true;
      legend.append(input); jump.append(legend,node("span","of " + label.format(pages),"page-position"),go);
      jump.addEventListener("submit", e => { e.preventDefault(); navigate(pageURL(Number(input.value))); });
      nav.append(jump);
    }
    const download = node("a","Download this page (CSV)","export");
    download.href = exportUrl; download.download = "orientifolds-page-" + page + ".csv"; nav.append(download);
    return nav;
  }

  async function run(scroll = false) {
    const seq = ++request, params = new URLSearchParams(location.search);
    output.replaceChildren();
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = null; tell("");
    if (!params.has("search")) { fillForm({planes:[]}); return; }
    try {
      const {filters, page} = readQuery(params);
      fillForm(filters);
      const numbers = filters.rank ? [Number(filters.rank)] : [1,2,3,4,5,6];
      tell("Loading property index for " + (filters.rank ? "h¹,¹ = " + filters.rank : "all six ranks") + "…");
      const ranks = await Promise.all(numbers.map(getRank));
      if (seq !== request) return;
      const {matches, count} = selectGroups(ranks, filters);
      const pages = Math.max(1, Math.ceil(count / pageSize)), selected = Math.min(pages, page);
      if (page !== selected) history.replaceState(null,"",pageURL(selected));
      const title = node("h3",label.format(count) + (count === 1 ? " matching eigenfamily" : " matching eigenfamilies"));
      title.id = "match-count";
      output.append(title);
      if (scroll) output.scrollIntoView({block:"start"});
      if (!count) { tell("No eigenfamily satisfies all selected properties."); return; }
      const begin = (selected - 1) * pageSize, end = Math.min(count, begin + pageSize);
      tell("Loading catalogue IDs…");
      const rows = await rowsForPage(matches,begin,end);
      if (seq !== request) return;
      const info = node("p", "Showing " + label.format(begin+1) + "–" + label.format(end) + ". ", "search-info");
      const link = node("a", "Link to this search"); link.href = pageURL(selected); info.append(link);
      output.append(info, makeTable(rows), pageTools(selected,pages));
      tell("");
    } catch (e) { if (seq === request) tell(e.message, true); }
  }

  form.addEventListener("submit", event => {
    event.preventDefault();
    const params = fromForm();
    try { readQuery(params); }
    catch (e) { tell(e.message, true); return; }
    const url = new URL("./",document.baseURI); url.search = params;
    navigate(url);
  });
  form.addEventListener("reset", () => {
    if (new URLSearchParams(location.search).has("search")) history.pushState(null,"",new URL("./",document.baseURI));
    request++; output.replaceChildren(); tell(""); advanced.open = false;
    if (exportUrl) URL.revokeObjectURL(exportUrl);
    exportUrl = null;
  });
  window.addEventListener("popstate", () => run());
  run();
})();
