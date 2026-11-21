"use strict";
window.catalogueRecords = (() => {
  const make = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text != null) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const sub = n => String(n).replace(/\d/g, d => "₀₁₂₃₄₅₆₇₈₉"[d]);
  const sup = n => String(n).replace(/\d/g, d => "⁰¹²³⁴⁵⁶⁷⁸⁹"[d]);
  const indexed = (letter, i) => letter + sub(i);
  const exact = v => v == null ? "Unavailable" : String(v).replace(/^-/, "−");
  const tuple = v => v == null ? "Unavailable" : "(" + v.map(exact).join(", ") + ")";
  const product = (powers, letter) => powers.map((power, i) =>
    !power ? "" : indexed(letter, i) + (power === 1 ? "" : sup(power))).join("") || "1";
  function terms(entries) {
    const terms = [];
    for (const [coefficient, monomial] of entries) {
      if (coefficient === 0) continue;
      let c = String(coefficient), negative = c.startsWith("-");
      if (negative) c = c.slice(1);
      const term = monomial === "1" ? c : c === "1" ? monomial : c + "·" + monomial;
      terms.push((negative ? (terms.length ? " − " : "−") : (terms.length ? " + " : "")) + term);
    }
    return terms.join("") || "0";
  }
  const linear = (vector, letter) => vector == null ? "Unavailable" :
    terms(vector.map((c, i) => [c, indexed(letter, i)]));
  const list = () => make("div", null, "record-fields");
  function label(group, name, value) {
    const line = make("div");
    line.append(make("span", name, "field-name"), make("span", exact(value)));
    group.append(line);
  }
  function heading(parent, title) { parent.append(make("h4", title)); }
  function table(headers, rows, name) {
    const frame = make("div", null, "record-scroll"), t = make("table");
    t.setAttribute("aria-label", name);
    const h = t.createTHead().insertRow();
    for (const header of headers) { const th = make("th", header); th.scope = "col"; h.append(th); }
    const body = t.createTBody();
    for (const row of rows) {
      const tr = body.insertRow();
      for (const value of row) tr.append(make("td", value));
    }
    frame.append(t); return frame;
  }
  function nav() {
    const links = make("nav", null, "record-nav");
    links.setAttribute("aria-label","Linked catalogue tables");
    for (const [id, title] of [["polytope","Polytope"],["triangulation","Triangulation"],["involution","Involution"],["eigenfamilies","Eigenfamilies"]]) {
      const a = make("a", title); a.href = "#record-" + id;
      a.addEventListener("click", e => {
        const target = document.getElementById("record-" + id);
        if (target && !e.metaKey && !e.ctrlKey && !e.shiftKey) {
          e.preventDefault(); target.tabIndex = -1; target.focus({preventScroll:true}); target.scrollIntoView();
        }
      });
      links.append(a);
    }
    return links;
  }
  function polytope(r) {
    const panel = make("div", null, "record-panel"), facts = list();
    label(facts,"Catalogue ID",r.polytope_id); label(facts,"Legacy ID",r.legacy_id);
    label(facts,"h¹¹(X)",r.h11); label(facts,"h²¹(X)",r.h21);
    panel.append(facts);
    heading(panel,"Cox coordinates");
    const weights = r.weights || [], finite = r.finite_actions || [];
    panel.append(table(["Coordinate","Primitive ray",...weights.map((_,i)=>indexed("Q",i)),
      ...finite.map((a,i)=>indexed("g",i)+" (mod "+a.order+")")],
      (r.rays || []).map((ray,i)=>[indexed("x",i),tuple(ray),...weights.map(w=>exact(w[i])),...finite.map(f=>exact(f.exponents[i]))]), "Rays, GLSM weights and finite generator exponents"));
    panel.append(make("p", "Q columns give the GLSM weights. " +
      (finite.length ? "Finite-generator columns give exponents modulo the indicated orders." : "The finite Cox group is trivial."),"record-note"));
    return panel;
  }
  function intersections(parent,title,entries) {
    const panel = make("div", null, "intersection-block");
    heading(panel,title);
    if (!entries?.length) panel.append(make("p",entries == null ? "Unavailable." : "No nonzero entries."));
    else {
      const rows = entries.map(([indices,value]) => {
        const powers = Array(Math.max(...indices)+1).fill(0);
        for (const i of indices) powers[i]++;
        return [product(powers,"J"),exact(value)];
      });
      panel.append(table(["Basis product","Integral"],rows,title));
    }
    parent.append(panel);
  }
  function triangulation(r) {
    const panel = make("div", null, "record-panel");
    const two = make("div", null, "intersection-pair");
    intersections(two,"Triple intersections on X",r.triple_intersections);
    intersections(two,"Quadruple intersections on A",r.ambient_intersections);
    panel.append(two,make("p","Each row gives one symmetric tensor entry in the divisor basis J. Fractions are exact.","record-note"));
    heading(panel,"Divisors");
    const basis = make("p",null,"math-list");
    for (const [i,v] of (r.divisor_basis || []).entries()) basis.append(make("span",indexed("J",i)+" = "+linear(v,"D")));
    panel.append(basis,table(["Divisor","Class in J","h⁰⁰","h¹⁰","h²⁰","h¹¹"],(r.divisor_classes || []).map((row,i)=>
      [indexed("D",i),linear(row,"J"),...Array.from({length:4},(_,j)=>exact(r.divisor_hodge?.[i]?.[j]))]),"Divisor classes and coordinate-divisor Hodge numbers"));
    heading(panel,"Stanley–Reisner generators");
    const sr = make("p",null,"math-list");
    for (const indices of (r.SR || [])) sr.append(make("span",indices.map(i=>indexed("x",i)).join("")));
    if (!sr.childNodes.length) sr.textContent = r.SR == null ? "Unavailable." : "No generators.";
    panel.append(sr); return panel;
  }
  function involution(r) {
    const facts = list();
    label(facts,"Catalogue ID",r.involution_id);
    label(facts,"Action",({divisor_exchange:"Divisor exchange (NID)",reflection:"Coordinate reflection (REF)"})[r.type] ?? r.type);
    if (r.exchanged_pairs) label(facts,"Exchanged pairs",r.exchanged_pairs.map(([a,b])=>indexed("x",a)+" ↔ "+indexed("x",b)).join(", "));
    if (r.flipped_coordinates) label(facts,"Flipped signs",r.flipped_coordinates.map(i=>indexed("x",i)).join(", "));
    if (r.reflection_class) label(facts,"Class in N/2N",tuple(r.reflection_class));
    return facts;
  }
  function hodge(r,poly) {
    const box = make("div",null,"record-hodge");
    heading(box,"Hodge splitting");
    const odd = r.hodge_splitting;
    if (odd) {
      box.append(table(["Cohomology","Even (+)","Odd (−)","Total"],[["H¹¹","h11","h11_minus"],["H²¹","h21","h21_minus"]].map(([name,total,key]) =>
        [name,Number.isInteger(odd[key]) && Number.isInteger(poly[total]) ? poly[total]-odd[key] : "Unavailable",exact(odd[key]),exact(poly[total])]),"Hodge eigenspace dimensions"));
    } else {
      const message = r.smoothness === "singular" ? "Not applicable. The generic hypersurface is singular." :
        r.smoothness == null && (r.euler_fixed != null || r.fixed_loci != null) ? "Undetermined. Generic smoothness is unresolved in this edition." :
        r.smoothness == null ? "Unavailable. This record has no verified smooth hypersurface." : "Unavailable in this record.";
      box.append(make("p",message,"record-note"));
    }
    return box;
  }
  function polynomials(map) {
    const panel = make("div",null,"record-equations");
    heading(panel,"Fixed-locus polynomials");
    const rows = Object.entries(map || {}).map(([name,poly])=>[name,terms(poly.map(([c,v])=>[c,product(v,"x")]))]);
    if (rows.length) panel.append(table(["Name","Cox polynomial"],rows,"Fixed-locus polynomial definitions"));
    else panel.append(make("p",map == null ? "Unavailable." : "No named equations.","record-note"));
    return panel;
  }
  function coefficients(def) {
    const panel = make("div",null,"record-equations"); heading(panel,"Generic coefficients and roots");
    const pairs = Object.entries(def.generic_cox_coefficients || {}).map(([name,v])=>[name,product(v,"x")]);
    if (pairs.length) panel.append(table(["Coefficient","Cox monomial"],pairs,"Generic coefficient definitions"));
    for (const roots of (def.root_sets || [])) {
      const equation = terms(roots.univariate_terms.map(([c,k])=>[c,k===0?"1":k===1?"t":"t"+sup(k)]));
      panel.append(make("p",equation+" = 0"),make("p","Distinct nonzero roots: "+roots.symbols.join(", "),"record-note"));
    }
    return panel;
  }
  return {nav, polytope, triangulation, involution, hodge, polynomials, coefficients, list, label};
})();
