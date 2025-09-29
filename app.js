// ===== Helpers =====
const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

function toNumberEU(str) {
  if (str == null) return null;
  const s = String(str).trim().replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return isFinite(n) ? n : null;
}
function fmtEUR(n) {
  if (n == null || !isFinite(n)) return "";
  return n.toLocaleString('it-IT', { style:'currency', currency:'EUR' });
}
function autoTable(el, data) {
  if (!data || !data.length) { el.innerHTML = "<p class='hint'>Nessun dato.</p>"; return; }
  const cols = Object.keys(data[0]);
  const thead = "<thead><tr>" + cols.map(c=>`<th>${c}</th>`).join("") + "</tr></thead>";
  const tbody = "<tbody>" + data.map(r=>"<tr>"+cols.map(c=>`<td>${r[c] ?? ""}</td>`).join("")+"</tr>").join("") + "</tbody>";
  el.innerHTML = `<table>${thead}${tbody}</table>`;
}

// ===== PDF.js setup =====
pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

// Rebuild lines grouping text items by Y coordinate (tolleranza semplice)
async function extractTextLinesFromPDF(file) {
  const arrayBuf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
  const linesAll = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const linesMap = new Map();
    for (const item of content.items) {
      const ts = item.transform;
      const y = Math.round(ts[5]);         // coord Y
      const x = ts[4];                     // coord X
      const arr = linesMap.get(y) || [];
      arr.push({ x, s: item.str });
      linesMap.set(y, arr);
    }
    const ys = Array.from(linesMap.keys()).sort((a,b)=>b-a); // top -> bottom
    for (const y of ys) {
      const parts = linesMap.get(y).sort((a,b)=>a.x-b.x).map(o=>o.s);
      const txt = parts.join(" ").replace(/\s+/g, " ").trim();
      if (txt) linesAll.push(txt);
    }
  }
  return linesAll;
}

// Data dal nome file o dal testo (es. 10_04_2025 o 10/04/2025)
function guessDocDate(filename, lines) {
  const f = filename.toLowerCase();
  let m = f.match(/(\d{2})[._-](\d{2})[._-](\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  for (const ln of lines) {
    const t = ln.toLowerCase();
    const mm = t.match(/(\d{2})[\/.-](\d{2})[\/.-](\d{4})/);
    if (mm) return `${mm[3]}-${mm[2]}-${mm[1]}`;
  }
  const d = new Date();
  return d.toISOString().slice(0,10);
}

// Estrazione delle righe prodotto via regex (personalizzabile in UI)
function parseRows(lines, rowRegex) {
  const rx = new RegExp(rowRegex);
  const rows = [];
  for (const ln of lines) {
    const m = ln.match(rx);
    if (m) {
      const codice = m[1].trim();
      const descr  = m[2].trim();
      const prezzo = toNumberEU(m[3]);
      rows.push({
        "Codice": codice,
        "Descrizione": descr,
        "Prezzo unitario €": prezzo
      });
    }
  }
  return rows;
}

// ===== Storage (localStorage) =====
const STORE_KEY = "storico_cumulativo_v1";
const IMPORT_LOG = "storico_import_log_v1";

function loadStore(){ try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; } }
function saveStore(arr){ localStorage.setItem(STORE_KEY, JSON.stringify(arr)); }
function loadLog(){ try { return JSON.parse(localStorage.getItem(IMPORT_LOG)) || []; } catch { return []; } }
function saveLog(arr){ localStorage.setItem(IMPORT_LOG, JSON.stringify(arr)); }

// Upsert: mantiene l’ultimo prezzo per Codice
function upsertHistory(rows, meta){
  const store = loadStore();
  const byCode = new Map(store.map(r=>[r.Codice, r]));
  for (const r of rows) {
    byCode.set(r.Codice, {
      "Codice": r.Codice,
      "Descrizione": r.Descrizione,
      "Prezzo unitario €": r["Prezzo unitario €"],
      "IVA %": r["IVA %"] ?? "",       // se non disponibile
      "Data": meta.data,
      "Fornitore": meta.fornitore
    });
  }
  const updated = Array.from(byCode.values()).sort((a,b)=> a.Codice.localeCompare(b.Codice));
  saveStore(updated);
  // per annulla-ultimo
  const log = loadLog();
  log.push({ meta, codes: rows.map(r=>r.Codice) });
  saveLog(log);
  return updated;
}

function undoLastImport(){
  const log = loadLog();
  if (!log.length) return;
  const last = log.pop();
  saveLog(log);
  const store = loadStore().filter(r => !last.codes.includes(r.Codice));
  saveStore(store);
}

// Diff contro snapshot precedente allo (stesso) import
function diffAgainstSnapshot(prevSnapshot, newRows){
  const prevBy = new Map(prevSnapshot.map(r=>[r.Codice, r]));
  const results = [];
  for (const r of newRows) {
    const prev = prevBy.get(r.Codice);
    if (!prev) {
      results.push({
        "Codice": r.Codice, "Descrizione": r.Descrizione,
        "Prezzo precedente €": "", "Prezzo nuovo €": r["Prezzo unitario €"],
        "Differenza €": "", "Differenza %": "", "Indicatore": "🆕"
      });
    } else {
      const p0 = toNumberEU(prev["Prezzo unitario €"]);
      const p1 = toNumberEU(r["Prezzo unitario €"]);
      const diff = p1 - p0;
      if (Math.abs(diff) > 1e-9) {
        const pct = p0 ? (diff / p0) * 100 : "";
        results.push({
          "Codice": r.Codice, "Descrizione": r.Descrizione,
          "Prezzo precedente €": p0, "Prezzo nuovo €": p1,
          "Differenza €": diff, "Differenza %": pct === "" ? "" : pct,
          "Indicatore": diff > 0 ? "🔴" : "🟢"
        });
      }
    }
  }
  // prima le variazioni, poi i nuovi
  return results.sort((a,b)=>{
    const aNew = a.Indicatore === "🆕" ? 1 : 0;
    const bNew = b.Indicatore === "🆕" ? 1 : 0;
    if (aNew !== bNew) return aNew - bNew;
    return (a.Descrizione || "").localeCompare(b.Descrizione || "");
  });
}

// ===== Excel (SheetJS) con auto-fit =====
function autoFitCols(json){
  const cols = Object.keys(json[0] || {});
  const wch = cols.map(h => Math.max(h.length, 8));
  json.forEach(row => cols.forEach((c,i) => {
    const v = row[c] == null ? "" : String(row[c]);
    wch[i] = Math.max(wch[i], v.length);
  }));
  return cols.map((h,i)=>({ wch: wch[i] + 2 }));
}
function exportExcel({ lastDocRows, lastDocMeta, historyRows, deltas }){
  const wb = XLSX.utils.book_new();
  const sheet1 = XLSX.utils.json_to_sheet(lastDocRows);
  const sheet2 = XLSX.utils.json_to_sheet(historyRows);
  const sheet3 = XLSX.utils.json_to_sheet(deltas.map(r=> ({
    ...r,
    "Prezzo precedente €": typeof r["Prezzo precedente €"] === "number" ? r["Prezzo precedente €"].toFixed(2) : r["Prezzo precedente €"],
    "Prezzo nuovo €": typeof r["Prezzo nuovo €"] === "number" ? r["Prezzo nuovo €"].toFixed(2) : r["Prezzo nuovo €"],
    "Differenza €": typeof r["Differenza €"] === "number" ? r["Differenza €"].toFixed(2) : r["Differenza €"],
    "Differenza %": typeof r["Differenza %"] === "number" ? r["Differenza %"].toFixed(2) : r["Differenza %"],
  })));

  sheet1['!cols'] = autoFitCols(lastDocRows);
  sheet2['!cols'] = autoFitCols(historyRows);
  sheet3['!cols'] = autoFitCols(deltas);

  XLSX.utils.book_append_sheet(wb, sheet1, `Nuovo documento ${lastDocMeta.data}`.slice(0,31));
  XLSX.utils.book_append_sheet(wb, sheet2, "Storico aggiornato");
  XLSX.utils.book_append_sheet(wb, sheet3, "Confronto (variaz + nuovi)");

  XLSX.writeFile(wb, `Confronto_Prezzi_${(lastDocMeta.fornitore||'FORNITORE').replace(/\s+/g,'_')}.xlsx`);
}

// ===== Stati interni per export =====
(function patchState(){
  const _upsert = upsertHistory;
  window.__lastDocRows = null;
  window.__lastMeta = null;
  window.__lastDeltas = null;
  window.upsertHistory = function(rows, meta){
    window.__lastDocRows = rows;
    window.__lastMeta = meta;
    return _upsert(rows, meta);
  };
  const _diff = diffAgainstSnapshot;
  window.diffAgainstSnapshot = function(prev, rows){
    const out = _diff(prev, rows);
    window.__lastDeltas = out;
    return out;
  };
})();

// ===== Handlers =====
async function onParse(){
  const input = $("#pdfInput");
  const supplier = ($("#supplier").value || "").trim() || "Fornitore";
  const manualDate = $("#manualDate").value || null;
  const rowRegex = $("#rowRegex").value;

  if (!input.files.length) { alert("Seleziona uno o più PDF."); return; }

  // snapshot history (per confronto corretto)
  const prevSnapshot = loadStore().map(r=>({ ...r }));

  for (const file of input.files) {
    const lines = await extractTextLinesFromPDF(file);
    const rows  = parseRows(lines, rowRegex);
    if (!rows.length) {
      alert(`Nessuna riga prodotto riconosciuta in: ${file.name}\nAdatta la regex in Opzioni avanzate.`);
      continue;
    }
    const dataDoc = manualDate || guessDocDate(file.name, lines);
    // arricchisci (IVA lasciata vuota, se non presente)
    const enriched = rows.map(r => ({ ...r, "IVA %": "", "Data": dataDoc, "Fornitore": supplier }));

    // diff contro snapshot (prima dell’update)
    const deltas = diffAgainstSnapshot(prevSnapshot, enriched);

    // UI: ultimo documento
    $("#lastDocMeta").innerHTML = `<div class="hint">Documento: <b>${file.name}</b> — Fornitore: <b>${supplier}</b> — Data: <b>${dataDoc}</b> — Righe estratte: <b>${enriched.length}</b></div>`;
    autoTable($("#tableLastDoc"), enriched);

    // aggiorna storico (post-diff)
    const updatedHist = upsertHistory(enriched, { data: dataDoc, fornitore: supplier });
    autoTable($("#tableHistory"), updatedHist);

    // confronto
    autoTable($("#tableDelta"), deltas.map(d => ({
      ...d,
      "Prezzo precedente €": typeof d["Prezzo precedente €"] === "number" ? fmtEUR(d["Prezzo precedente €"]) : d["Prezzo precedente €"],
      "Prezzo nuovo €": typeof d["Prezzo nuovo €"] === "number" ? fmtEUR(d["Prezzo nuovo €"]) : d["Prezzo nuovo €"],
      "Differenza €": typeof d["Differenza €"] === "number" ? fmtEUR(d["Differenza €"]) : d["Differenza €"],
      "Differenza %": typeof d["Differenza %"] === "number" ? d["Differenza %"].toFixed(2) + "%" : d["Differenza %"],
    })));
  }
}

function onExport(){
  if (!window.__lastDocRows || !window.__lastMeta) {
    alert("Importa almeno un documento prima di esportare.");
    return;
  }
  exportExcel({
    lastDocRows: window.__lastDocRows,
    lastDocMeta: window.__lastMeta,
    historyRows: loadStore(),
    deltas: window.__lastDeltas || []
  });
}

// ===== Bind =====
$("#btnParse").addEventListener("click", onParse);
$("#btnExportExcel").addEventListener("click", onExport);
$("#btnClearLast").addEventListener("click", ()=>{
  undoLastImport();
  autoTable($("#tableHistory"), loadStore());
  $("#tableDelta").innerHTML="";
});
$("#btnResetAll").addEventListener("click", ()=>{
  if (confirm("Azzerare definitivamente lo storico?")) {
    localStorage.removeItem(STORE_KEY);
    localStorage.removeItem(IMPORT_LOG);
    $("#tableHistory").innerHTML="";
    $("#tableDelta").innerHTML="";
    $("#tableLastDoc").innerHTML="";
    $("#lastDocMeta").innerHTML="";
  }
});
