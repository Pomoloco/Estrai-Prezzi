// ========= UTIL =========
const $ = s => document.querySelector(s);
const log = (...a) => { const el = $('#log'); el.textContent += a.join(' ') + '\n'; el.scrollTop = el.scrollHeight; };
const setErr = (msg) => { const e = $('#error'); if(!msg){e.hidden=true; e.textContent='';} else {e.hidden=false; e.textContent=msg;} };
const setProg = (p) => { $('#progress span').style.width = `${Math.max(0,Math.min(1,p))*100}%`; };

// ========= TESSERACT v2 CONFIG (Safari iOS safe) =========
const paths = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js',
  corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js',
  langBase:   {
    best: 'https://tessdata.projectnaptha.com/4.0.0_best',
    fast: 'https://tessdata.projectnaptha.com/4.0.0_fast'
  }
};

let worker = null;

// ========= WORKER =========
async function getWorker(model='best') {
  if (worker) return worker;
  log('Create worker v2 … model=', model);
  worker = Tesseract.createWorker({
    workerPath: paths.workerPath,
    corePath: paths.corePath,
    langPath: paths.langBase[model] || paths.langBase.best,
    logger: m => {
      if (m.status === 'recognizing text' && m.progress!=null) setProg(m.progress);
      if (m.status) log('OCR:', m.status, m.progress ?? '');
    }
  });
  await worker.load();
  await worker.loadLanguage('ita+eng');
  await worker.initialize('ita+eng');
  log('OCR: initialized api');
  return worker;
}

// ========= IMAGE PRE-PROCESS =========
// Riduce dimensione e converte in PNG: evita out-of-memory in WASM su iPhone.
async function preprocessImage(file, maxDim = 2000) {
  if (!(file instanceof File)) return file;

  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;

  const scale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, w, h);

  // PNG 0.92 qualità non è usata per PNG ma lasciamo default
  const blob = await new Promise(res => canvas.toBlob(res, 'image/png', 0.92));
  const outFile = new File([blob], (file.name || 'input') + '.png', { type: 'image/png' });
  log('Preprocess:', file.name, '→', outFile.name, `(${w}x${h})`);
  return outFile;
}

// ========= OCR RUN WITH FALLBACK =========
async function runWithWorker(inputFile, cfg){
  const w = await getWorker($('#model').value);
  return w.recognize(inputFile, { tessjs_create_hocr: '0', ...cfg });
}

async function runNoWorker(inputFile, cfg){
  log('Fallback: single-thread (no worker)…');
  return Tesseract.recognize(inputFile, 'ita+eng', {
    corePath: paths.corePath,
    langPath: paths.langBase[$('#model').value] || paths.langBase.best,
    workerPath: paths.workerPath, // ignorato in no-worker
    ...cfg,
    logger: m => {
      if (m.status === 'recognizing text' && m.progress!=null) setProg(m.progress);
      if (m.status) log('OCR(no-worker):', m.status, m.progress ?? '');
    }
  });
}

// ========= OCR =========
async function runOCR(file, {model, psm, numericPass}) {
  try {
    setErr(''); setProg(0);
    $('#raw').value = '';
    $('#outTable tbody').innerHTML = '';
    $('#csvBtn').disabled = true;

    // 1) Preprocess immagine
    let inputFile;
    if (file instanceof File) inputFile = file;
    else inputFile = new File([file], 'input.jpg', {type: 'image/jpeg'});

    inputFile = await preprocessImage(inputFile, 2000);

    const cfg = { 'tessedit_pageseg_mode': parseInt(psm,10) || 4 };

    log('PROCESS', inputFile.name, inputFile.type);

    // 2) Prova con worker
    let result;
    try {
      result = await runWithWorker(inputFile, cfg);
    } catch (err) {
      log('Worker OCR error:', err?.message || err);
      // 3) Fallback automatico
      result = await runNoWorker(inputFile, cfg);
    }

    const text1 = result?.data?.text || '';
    $('#raw').value = text1;

    // Parser base: popola tabella se trova prezzi/iva
    const rows = window.parseDescrPrezziIva(text1);
    renderRows(rows);

  } catch (err) {
    setErr('Errore: ' + (err?.message || err));
    log('FATAL', err?.stack || err);
  } finally {
    setProg(1);
  }
}

// ========= UI =========
$('#goBtn').addEventListener('click', async () => {
  const file = $('#file').files?.[0];
  if(!file){ setErr('Seleziona un file immagine o PDF.'); return;}
  await runOCR(file, {
    model: $('#model').value,
    psm: $('#psm').value,
    numericPass: $('#numericPass').checked
  });
});

$('#demoBtn').addEventListener('click', async () => {
  // Demo minima (pixel) per test pipeline
  const demoBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNk+M8ABgADmBzq4GqVvQAAAABJRU5ErkJggg==';
  const bin = atob(demoBase64); const arr = new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
  const demoFile = new File([new Blob([arr],{type:'image/png'})], 'demo.png', {type:'image/png'});
  await runOCR(demoFile, { model: $('#model').value, psm: $('#psm').value, numericPass: $('#numericPass').checked });
});

function renderRows(rows){
  const tb = $('#outTable tbody'); tb.innerHTML = '';
  rows.forEach((r,i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${i+1}</td><td>${escapeHtml(r.desc)}</td><td>${r.prezzo ?? ''}</td><td>${r.iva ?? ''}</td>`;
    tb.appendChild(tr);
  });
  $('#csvBtn').disabled = rows.length===0;
}

$('#csvBtn').addEventListener('click', ()=>{
  const rows = [...document.querySelectorAll('#outTable tbody tr')].map(tr=>{
    const tds = tr.querySelectorAll('td');
    return [tds[1].textContent, tds[2].textContent, tds[3].textContent];
  });
  const csv = 'Descrizione,Prezzo (€),IVA (%)\n' + rows.map(r=>r.map(s=>`"${s.replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'estrai-prezzi.csv'; a.click();
});

function escapeHtml(s){return (s??'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));}
