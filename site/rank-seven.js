/* Read a content-addressed, lossless projection of one public rank-seven batch. */
(() => {
  "use strict";
  let cached;
  async function fetchBatch(url, expected) {
    const response = await fetch(url);
    if (!response.ok) throw Error("The rank-seven batch could not be loaded (HTTP " + response.status + ").");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const actual = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
    if (actual !== expected) throw Error("The rank-seven batch failed its SHA-256 check.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const data = await new Response(stream).json();
    if (data.v !== 2) throw Error("Unrecognized rank-seven record encoding.");
    return data;
  }
  function records(data, polyId, url) {
    const polytope = data.p.find(p => p.polytope_id === polyId);
    if (!polytope) throw Error("This batch has no record for " + polyId + ".");
    const actions = new Map(data.a.filter(a => a.polytope_id === polyId).map(a => [a.involution_id, a]));
    const families = new Map(), geometry = data.keys.map(() => new Map());
    function familyFields(slot) {
      if (families.has(slot)) return families.get(slot);
      const fields = {};
      data.famKeys.forEach((key, i) => {
        const v = data.famValues[i][data.fam[slot][i]];
        fields[key] = key === "fixed_loci" && v !== null ? v.map(id => data.components[id]) : v;
      });
      families.set(slot, fields);
      return fields;
    }
    function geometryField(i, slot) {
      if (geometry[i].has(slot)) return geometry[i].get(slot);
      const encoded = data.vals[i][slot], terms = data.terms[i];
      let at = 0;
      const value = terms === null ? encoded : encoded.map(change => terms[at += change]);
      geometry[i].set(slot, value);
      return value;
    }
    const triangulations = [];
    for (const [tid, values, pattern] of data.t) {
      if (!tid.startsWith(polyId + "_")) continue;
      const triangulation = {triangulation_id:tid, polytope_id:polyId};
      data.keys.forEach((key, i) => {triangulation[key] = geometryField(i, values[i]);});
      const [sheet, pos] = data.patterns[pattern], [labels, columns] = data.sheets[sheet];
      const involutions = [], seen = new Set(), sectors = [], coefficients = {};
      labels.forEach((name, i) => {
        const [f, c] = columns[i];
        const fields = familyFields(Array.isArray(f) ? f[pos] : f);
        const actionId = polyId + "_" + name;
        const familyId = tid + "_" + name + (fields.polynomial_parity === 1 ? "_Pplus" : "_Pminus");
        if (!seen.has(actionId)) {
          if (!actions.has(actionId)) throw Error("Missing parent involution " + actionId);
          involutions.push(actions.get(actionId));
          seen.add(actionId);
        }
        sectors.push({orientifold_id:familyId, triangulation_id:tid, involution_id:actionId, ...fields});
        const idx = Array.isArray(c) ? c[pos] : c;
        if (idx >= 0) coefficients[familyId] = {orientifold_id:familyId, ...data.coef[idx]};
      });
      triangulations.push({id:tid, triangulation, involutions, sectors, coefficients});
    }
    return {polytope, triangulations, source_url:String(url)};
  }
  window.readRankSevenBatch = async function(url, hash, rank, polyId) {
    if (rank !== 7) throw Error("Unexpected rank for this batch.");
    const key = String(url) + "#" + hash;
    if (cached?.key !== key) {
      const pending = fetchBatch(url, hash);
      cached = {key, pending};
      pending.catch(() => {if (cached?.pending === pending) cached = undefined;});
    }
    return records(await cached.pending, polyId, url);
  };
})();
