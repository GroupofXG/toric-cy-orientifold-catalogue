"use strict";
(() => {
  const $ = id => document.getElementById(id);
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const opt = (value, label) => new Option(label, String(value));
  const number = value => Number.isSafeInteger(value) ? value.toLocaleString("en-US") : "—";
  const compare = new Intl.Collator("en", {numeric:true}).compare;
  const labelId = row => String(row.involution_id ?? row.invol_id);
  const sectorId = row => row.orientifold_id ?? row.sector_id;
  const sign = n => n === 1 ? "+1" : n === -1 ? "−1" : n ?? "unavailable";
  let ranks = [], dataRoot = new URL("data/", document.baseURI);
  let routeNumber = 0, view = null, latestIndex = null, lastPoly = null, urls = [];

  async function json(url, description) {
    const response = await fetch(url);
    if (response.status === 404) throw Error(description + " is absent from this edition.");
    if (!response.ok) throw Error(description + " could not be loaded (HTTP " + response.status + ").");
    try { return await response.json(); }
    catch { throw Error(description + " did not return valid JSON."); }
  }
  function status(message = "", error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
  }
  function disclosure(title, object) {
    const box = el("details");
    box.append(el("summary", title));
    box.addEventListener("toggle", () => {
      if (box.open && !box.querySelector("pre")) box.append(el("pre", JSON.stringify(object, null, 2)));
    });
    return box;
  }
  function download(label, url, filename) {
    const a = el("a", label); a.href = url; a.download = filename; return a;
  }
  function objectLink(label, value, filename) {
    const a = el("a", label); a.href = "#"; a.download = filename;
    a.addEventListener("click", () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2) + "\n"], {type:"application/json"}));
      a.href = url; urls.push(url);
    });
    return a;
  }
  function fields(caption, control) {
    const label = el("label",caption); label.append(control); return label;
  }
  function shortPoly(input,h) {
    const match = input.trim().toUpperCase().match(/^(?:P(\d+)_)?([KN]?)(\d+)$/);
    if (!match) throw Error("Enter a catalogue ID such as P2_5, P1_K0, or its local identifier.");
    if (match[1] && Number(match[1]) !== h) throw Error("The polytope ID and the selected Hodge number disagree.");
    return match[2] + match[3].replace(/^0+(?=\d)/,"");
  }
  function lookupId(input,h) {
    const value=input.trim();
    const parsed=value.match(/^P(\d+)_([KN]?\d+)(?:_(TX?\d+))?(?:_([RI]\d+)(?:_(Pplus|Pminus))?)?$/i);
    if (!parsed) return [h,shortPoly(value,h)];
    const rank=Number(parsed[1]), p=shortPoly(parsed[2],rank), prefix="P"+rank+"_"+p;
    const tri=parsed[3] && prefix+"_"+parsed[3].toUpperCase();
    const action=parsed[4] && prefix+"_"+parsed[4].toUpperCase();
    const parity=parsed[5] && (parsed[5].toLowerCase()==="pplus" ? "Pplus" : "Pminus");
    return [rank,p,tri,action,parity];
  }
  function viewURL(h,p,t,i,s) {
    const url = new URL(location.href); url.search = ""; url.hash = "";
    url.searchParams.set("h", h);
    for (const [name,v] of Object.entries({p,t,i,s})) if (v != null && v !== "") url.searchParams.set(name, v);
    return url;
  }
  function navigate(h,p,t,i,s) {
    history.pushState(null, "", viewURL(h,p,t,i,s));
    route();
  }
  function polyLink(h, id) {
    const a = el("a","P"+h+"_"+id);
    a.href = viewURL(h,id);
    return a;
  }
  function browse(rank, ids, selected) {
    const target = $("browse"); target.replaceChildren();
    if (!Array.isArray(ids) || !ids.length) return;
    const box = el("details"), body = el("div");
    box.append(el("summary","Browse " + number(ids.length) + " polytope IDs"), body);
    target.append(box);
    let sorted;
    box.addEventListener("toggle", () => {
      if (!box.open || sorted) return;
      sorted = ids.map(String).sort(compare);
      const size = 60, nav = el("select"), list = el("div", null,"chips");
      for (let j=0;j<sorted.length;j+=size) {
        const end = Math.min(j+size, sorted.length)-1;
        nav.add(opt(j,sorted[j] + " – " + sorted[end]));
      }
      const index = sorted.indexOf(String(selected));
      nav.value = String(index < 0 ? 0 : Math.floor(index/size)*size);
      const show = () => list.replaceChildren(...sorted.slice(+nav.value,+nav.value+size).map(id=>polyLink(rank.value,id)));
      if (sorted.length>size) body.append(fields("ID range",nav));
      body.append(list); nav.addEventListener("change",show); show();
    });
  }
  function catalogueIndex(rank) {
    const url = new URL(rank.batch_index,dataRoot).href;
    if (latestIndex?.url !== url) {
      const pending = json(url,"Batch index for h¹,¹ = "+rank.value);
      latestIndex = {url,pending};
      pending.catch(() => { if(latestIndex?.pending===pending) latestIndex=null; });
    }
    return latestIndex.pending;
  }
  async function getPoly(rank,p,index) {
    const key=rank.value+"/"+p;
    if (lastPoly?.key===key) return lastPoly;
    const full = "P"+rank.value+"_"+p;
    if (index) {
      const slug=index.polytopes[p], batch=index.batches[slug];
      if (slug == null) throw Error(full+" is absent from this edition.");
      if (!batch) throw Error("The catalogue index is missing the batch entry for "+full+".");
      const url=new URL(batch.file,dataRoot);
      if (rank.format === "packed7-v1") {
        const record=await window.readRankSevenBatch(url.href,batch.sha256,rank.value,full);
        const volume = batch.download_url || (batch.bulk_file && rank.bulk_url.replace("/tag/","/download/") + "/" + batch.bulk_file);
        return {key,record,browserFile:url,bulk:rank.bulk_url,volume,batchName:slug};
      }
      const record=await window.readCatalogueBatch(url.href,batch.sha256,rank.value,full);
      return {key,record,zip:url};
    }
    const base=new URL("h"+rank.value+"/p"+p+"/",dataRoot);
    return {key,base,record:await json(new URL("index.json",base),full)};
  }
  function fixedRows(rows) {
    if (rows == null) return el("p","Fixed-locus data unavailable.");
    if (!rows.length) return el("p","Empty fixed set.");
    const frame=el("div",null,"scroll"), table=el("table"), head=table.createTHead().insertRow();
    for (const title of ["Locus","O-plane","Zero coordinates","Equations","Euler","Point count"]) head.append(el("th",title));
    const body=table.createTBody();
    for (const row of rows) {
      const tr=body.insertRow();
      const values=[row.label,row.type,row.zero_coordinates?.map(i=>"x"+i).join(", "),row.equations?.join(", "),row.euler,row.point_count];
      for (const value of values) tr.append(el("td", value == null || value==="" ? "—" : String(value)));
    }
    frame.append(table); return frame;
  }
  const reader = window.catalogueRecords;
  function sectionTitle(id,text) {
    const title=el("h3",text);
    title.id="record-"+id;
    return title;
  }
  function family(row,coefficients,poly) {
    const box=el("div",null,"sector");
    const title=el("h4","Polynomial parity "+sign(row.polynomial_parity));
    box.append(title,el("div",sectorId(row),"meta"),reader.nav());
    const facts=reader.list();
    reader.label(facts,"Ω parity",sign(row.omega_parity));
    reader.label(facts,"Generic smoothness",row.smoothness ?? "No verdict");
    reader.label(facts,"Fixed-set Euler χ",row.euler_fixed);
    box.append(facts,reader.hodge(row,poly),el("h4","Fixed loci on X"),fixedRows(row.fixed_loci),reader.polynomials(row.polynomials));
    if (coefficients != null) box.append(reader.coefficients(coefficients),disclosure("Coefficient definitions",coefficients));
    box.append(disclosure("Full eigenfamily record",row));
    return box;
  }
  function selectAction(h,p,tri,entry,requested,parity,area,poly) {
    const invols=entry.involutions, families=entry.sectors ?? entry.orientifolds;
    if (!Array.isArray(invols) || !Array.isArray(families)) throw Error("The FRST record lacks its action or family table.");
    const label=entry.triangulation.triangulation_id;
    area.append(reader.triangulation(entry.triangulation),disclosure("Triangulation data · "+label,entry.triangulation));
    area.append(objectLink("Download FRST and linked records (JSON)",{triangulation:entry.triangulation,involutions:invols,orientifolds:families,coefficients:entry.coefficients ?? {}},label+".json"));
    area.append(sectionTitle("involution","Involution"));
    if (!invols.length) { area.append(el("p","No involutions recorded on this triangulation.")); return; }
    const control=el("select"); control.id="action"; 
    for (const row of invols) control.add(opt(labelId(row),labelId(row)+" · "+(row.type ?? "involution")));
    const id=requested ?? labelId(invols[0]);
    const active=invols.find(r=>labelId(r)===id);
    control.value=id;
    control.addEventListener("change",()=>navigate(h,p,tri,control.value));
    area.append(fields("Involution",control));
    if (!active) throw Error(id+" is absent from this triangulation.");
    area.append(reader.involution(active),disclosure("Involution data",active),sectionTitle("eigenfamilies","Eigenfamilies"));
    const records=families.filter(r=>labelId(r)===id).sort((a,b)=>b.polynomial_parity-a.polynomial_parity);
    if (!records.length) area.append(el("p","No eigenfamilies recorded for this involution on this triangulation."));
    let selected;
    for (const row of records) {
      const box=family(row,entry.coefficients?.[sectorId(row)],poly);
      const suffix=sectorId(row).split("_").pop();
      const permalink=el("a","Link to eigenfamily");
      permalink.href=viewURL(h,p,tri,id,suffix);
      box.append(permalink);
      area.append(box);
      if (suffix===parity) selected=box;
    }
    if (parity) {
      if (!selected) throw Error(parity+" is absent for this triangulation and involution.");
      selected.dataset.selected=""; selected.tabIndex=-1; selected.focus({preventScroll:true}); selected.scrollIntoView({block:"start"});
    }
  }
  async function showPoly(h,p,loaded,params,seq) {
    const {record,zip,base,browserFile,bulk,volume,batchName}=loaded, full=record.polytope.polytope_id;
    const result=$("result");
    result.append(el("h2",full),sectionTitle("polytope","Polytope"),reader.polytope(record.polytope),disclosure("Polytope data",record.polytope));
    if (zip) result.append(download("Download source batch (ZIP)",zip.href,zip.pathname.split("/").pop()));
    if (browserFile) {
      result.append(download("Download this browser data file (.gz)",browserFile.href,browserFile.pathname.split("/").pop()));
      if (volume) {
        const a=el("a","Original four tables · " + volume.split("/").pop()); a.href=volume;
        result.append(" · ", a, el("p","Source inside this archive: batches/" + batchName + ".zip","meta"));
      } else if (bulk) { const a=el("a","Original four-table archives"); a.href=bulk; result.append(" · ",a); }
    }
    const all=record.triangulations;
    if (!all.length) { result.append(el("p","No triangulations recorded for this polytope.")); return; }
    const toc=reader.nav();
    result.firstElementChild.after(toc);
    result.append(sectionTitle("triangulation","Triangulation"));
    const control=el("select"); control.id="tri";
    for (const tri of all) control.add(opt(tri.id,tri.id));
    const action=params.get("i");
    const first=action && !params.has("t") ? all.find(tri=>tri.involutions?.some(row=>labelId(row)===action)) : null;
    const entryId=String(params.get("t") ?? first?.id ?? all[0].id);
    const picked=all.find(tri=>String(tri.id)===entryId || String(tri.id)===full+"_T"+entryId);
    control.value=picked ? String(picked.id) : "";
    control.addEventListener("change",()=>navigate(h,p,control.value));
    result.append(fields("FRST ("+number(all.length)+")",control));
    if (!picked) throw Error("Triangulation "+entryId+" is absent from "+full+".");
    let entry=picked;
    if (!picked.triangulation) {
      const url=new URL(picked.file,base).href;
      if (view?.url!==url) view={url,record:await json(url,"Triangulation "+entryId)};
      entry=view.record;
    }
    if (seq!==routeNumber) return;
    selectAction(h,p,String(picked.id),entry,action,params.get("s"),result,record.polytope);
  }
  async function route() {
    const seq=++routeNumber, params=new URLSearchParams(location.search);
    const h=Number(params.get("h") ?? ranks[0]?.value), rank=ranks.find(r=>r.value===h);
    $("result").replaceChildren(); $("browse").replaceChildren();
    for (const u of urls) URL.revokeObjectURL(u);
    urls=[]; status();
    if (!rank) {status("This Hodge number is absent from the available data.",true); return;}
    $("rank").value=h; $("pid").value=params.get("p") ?? "";
    try {
      const index=rank.batch_index ? await catalogueIndex(rank) : null;
      if (seq!==routeNumber) return;
      const ids=index ? Object.keys(index.polytopes) : rank.polytope_ids;
      browse(rank,ids,params.get("p"));
      if (!params.has("p")) return;
      const p=shortPoly(params.get("p"),h);
      status("Loading P"+h+"_"+p+"…");
      const loaded=await getPoly(rank,p,index);
      if (seq!==routeNumber) return;
      lastPoly=loaded;
      await showPoly(h,p,loaded,params,seq);
      if (seq===routeNumber) status();
    } catch (error) { if (seq===routeNumber) status(error.message,true); }
  }
  async function start() {
    if (location.protocol==="file:") throw Error("Open this catalogue through a local HTTP server to load the data files.");
    const url=new URL("manifest.json",dataRoot), manifest=await json(url,"Catalogue manifest");
    if (manifest.data_base_url) dataRoot=new URL(manifest.data_base_url.replace(/\/?$/,"/"),url);
    ranks=manifest.h11;
    if (!Array.isArray(ranks) || !ranks.length) throw Error("The catalogue manifest has no available Hodge ranks.");
    $("edition").textContent=[manifest.version,manifest.status].filter(v=>typeof v==="string" && v).join(" · ");
    if (manifest.download_base) $("counts").closest("table").tHead.rows[0].append(el("th","Bulk data"));
    for (const r of ranks) {
      $("rank").add(opt(r.value,r.value));
      const tr=$("counts").insertRow(), th=el("th"); th.scope="row";
      const a=el("a",r.value); a.href=viewURL(r.value); th.append(a); tr.append(th);
      for (const val of [r.polytopes,r.triangulations,r.involutions,r.sectors]) tr.append(el("td",number(val)));
      if (manifest.download_base) {
        const cell=tr.insertCell();
        if (r.bulk_url) {
          const a=el("a","Four-table archive parts"); a.href=r.bulk_url; cell.append(a);
        } else {
          const file=r.bulk_file ?? "h11-"+r.value+"-four-tables.zip";
          const base=new URL(manifest.download_base.replace(/\/?$/,"/"),document.baseURI);
          cell.append(download("Four tables (ZIP)",new URL(file,base).href,file));
        }
      }
    }
    const foot=$("counts").closest("table").createTFoot().insertRow(), total=el("th","Total"); total.scope="row"; foot.append(total);
    for (const key of ["polytopes","triangulations","involutions","sectors"]) {
      const sum=ranks.reduce((count,r)=>count+r[key],0);
      foot.insertCell().textContent=number(sum);
    }
    if (manifest.download_base) foot.insertCell();
    if (manifest.sample?.polytope!=null) {
      const h=Number(manifest.sample.h11), p=shortPoly(String(manifest.sample.polytope),h);
      const a=polyLink(h,p); a.textContent="Example record · "+a.textContent;
      $("lookup-form").after(a);
    }
    $("rank").addEventListener("change",()=>navigate($("rank").value));
    $("lookup-form").addEventListener("submit",event=>{
      event.preventDefault();
      try { navigate(...lookupId($("pid").value,Number($("rank").value))); }
      catch (error) {status(error.message,true);}
    });
    document.addEventListener("click", event => {
      const link = event.target.closest("a[href]");
      if (!link || link.hasAttribute("download") || link.hasAttribute("data-search-record") || link.target || event.button !== 0 ||
          event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || url.pathname !== location.pathname || !url.search || url.hash || url.searchParams.has("search")) return;
      event.preventDefault();
      history.pushState(null, "", url);
      route();
    });
    window.addEventListener("popstate",route);
    await route();
  }
  start().catch(error=>status(error.message,true));
})();
