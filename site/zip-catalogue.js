/* Read the publisher's small, same-origin ZIP and join the Appendix A tables. */
(() => {
  "use strict";
  const text = new TextDecoder("utf-8", {fatal: true});
  const MAX_END_SEARCH = 65557;
  let previous;

  function entries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = offset => view.getUint16(offset, true);
    const u32 = offset => view.getUint32(offset, true);
    let end = bytes.length - 22;
    for (; end >= Math.max(0, bytes.length - MAX_END_SEARCH); --end) {
      if (u32(end) === 0x06054b50 && end + 22 + u16(end + 20) === bytes.length) break;
    }
    if (end < Math.max(0, bytes.length - MAX_END_SEARCH)) throw Error("Invalid ZIP directory.");
    let offset = u32(end + 16);
    const members = new Map();
    for (let i = 0; i < u16(end + 10); ++i) {
      if (u32(offset) !== 0x02014b50) throw Error("Invalid ZIP member.");
      const local = u32(offset + 42);
      if (u32(local) !== 0x04034b50) throw Error("Invalid ZIP header.");
      const start = local + 30 + u16(local + 26) + u16(local + 28);
      const size = u32(offset + 20);
      const name = text.decode(bytes.subarray(offset + 46, offset + 46 + u16(offset + 28)));
      if (members.has(name) || start + size > bytes.length) throw Error("Invalid ZIP member bounds.");
      members.set(name, {method:view.getUint16(offset + 10, true), start, size, length:u32(offset + 24)});
      offset += 46 + u16(offset + 28) + u16(offset + 30) + u16(offset + 32);
    }
    return members;
  }

  async function openBatch(url, expected) {
    const response = await fetch(url);
    if (!response.ok) throw Error("The source batch could not be loaded (HTTP " + response.status + ").");
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const hex = Array.from(digest, b => b.toString(16).padStart(2, "0")).join("");
    if (hex !== expected) throw Error("This batch did not pass its SHA-256 check. Reload the page and try again.");
    return {bytes, members:entries(bytes)};
  }

  async function rows(batch, name) {
    const m = batch.members.get(name);
    if (!m) throw Error("Missing catalogue table: " + name);
    let bytes = batch.bytes.subarray(m.start, m.start + m.size);
    if (m.method === 8) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else if (m.method !== 0) {
      throw Error("Unsupported ZIP compression method.");
    }
    if (bytes.length !== m.length) throw Error("Damaged table: " + name);
    const lines = text.decode(bytes).split("\n");
    if (lines.pop() !== "") throw Error("Incomplete JSON Lines table.");
    return lines;
  }

  function by(rows, key) {
    return new Map(rows.map(row => [row[key], row]));
  }

  async function readCatalogueBatch(url, expected, rank, polyId) {
    if (!previous || previous.url !== String(url) || previous.expected !== expected) {
      const request = openBatch(url, expected);
      previous = {url:String(url), expected, request};
      request.catch(() => { if (previous?.request === request) previous = undefined; });
    }
    const batch = await previous.request;
    const prefix = "h11=" + rank + "/";
    // Every record in these exports starts with its public ID. Filter before parsing large fields.
    function parse(lines, key, idPrefix, exact = false) {
      const marker = '{"' + key + '":"' + idPrefix + (exact ? '"' : "_");
      return lines.filter(line => line.startsWith(marker)).map(line => JSON.parse(line));
    }
    const [p, t, a, f, c] = await Promise.all([
      ...["polytopes","triangulations","involutions","orientifolds"].map(table => rows(batch,prefix+table+".jsonl")),
      rows(batch,"definitions/coefficients.jsonl")
    ]);
    const [polytope] = parse(p,"polytope_id",polyId,true);
    if (!polytope) throw Error("The source batch does not contain " + polyId + ".");
    const fans = parse(t,"triangulation_id",polyId);
    const actions = by(parse(a,"involution_id",polyId),"involution_id");
    const results = by(fans.map(triangulation => ({
      id:triangulation.triangulation_id, triangulation, involutions:[], sectors:[], coefficients:{}
    })),"id");
    const coeffs = by(parse(c,"orientifold_id",polyId),"orientifold_id");
    for (const family of parse(f,"orientifold_id",polyId)) {
      const record = results.get(family.triangulation_id);
      const action = actions.get(family.involution_id);
      if (!record || !action) throw Error("A published family references a missing parent row.");
      if (!record.involutions.includes(action)) record.involutions.push(action);
      record.sectors.push(family);
      if (coeffs.has(family.orientifold_id)) record.coefficients[family.orientifold_id] = coeffs.get(family.orientifold_id);
    }
    return {polytope, triangulations:[...results.values()], source_url:String(url)};
  }
  window.readCatalogueBatch = readCatalogueBatch;
})();
