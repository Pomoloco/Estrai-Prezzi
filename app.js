// ========= UTIL =========
const $ = s => document.querySelector(s);
const log = (...a) => { const el = $('#log'); el.textContent += a.join(' ') + '\n'; el.scrollTop = el.scrollHeight; };
const setErr = (msg) => { const e = $('#error'); if(!msg){e.hidden=true; e.textContent='';} else {e.hidden=false; e.textContent=msg;} };
const setProg = (p) => { $('#progress span').style.width = `${Math.max(0,Math.min(1,p))*100}%`; };

// ========= TESSERACT v2 CONFIG (Safari iOS safe) =========
const paths = {
  workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@2.1.5/dist/worker.min.js',
  corePath:   'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js',
  // langPath base cambia tra best/fast
  langBase:   {
    best: 'https://tessdata.projectnaptha.com/4.0.0_best',
    fast: 'https://tessdata.projectnaptha.com/4.0.0_fast'
  }
};

// stato
let worker = null;
let lastBlob = null;

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
  try{
    await worker.load();
    await worker.loadLanguage('ita+eng');
    await worker.initialize('ita+eng');
    log('OCR: initialized api');
    return worker;
  }catch(err){
    setErr('Errore inizializzazione OCR.\n' + (err?.message || err));
    log('INIT ERROR:', err);
    throw err;
  }
}

function fileToBlob(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onerror = () => rej(r.error);
    r.onload = () => res(new Blob([r.result]));
    r.readAsArrayBuffer(file);
  });
}

// ========= OCR =========
async function runOCR(file, {model, psm, numericPass}) {
  setErr('');
  setProg(0);
  $('#raw').value = '';
  $('#outTable tbody').innerHTML = '';
  $('#csvBtn').disabled = true;

  try {
    const w = await getWorker(model);
    const cfg = { 'tessedit_pageseg_mode': parseInt(psm,10) || 4 };
    // Blob per evitare problemi WebKit con URL.createObjectURL in contesto worker
    // Se arriva un File, usalo direttamente. Se è Blob, wrappalo in File.
let inputFile;
if (file instanceof File) {
  inputFile = file;
} else {
  const blob = await fileToBlob(file);
  inputFile = new File([blob], 'input.png', { type: file.type || 'image/png' });
}
log('PROCESS', inputFile.name, inputFile.type);

const r1 = await w.recognize(inputFile, { tessjs_create_hocr: '0', ...cfg });
    const text1 = (r1 && r1.data && r1.data.text) ? r1.data.text : '';
    $('#raw').value = text1;

    let finalText = text1;

    if (numericPass) {
      log('Numeric pass ON…');
      try {
        const r2 = await w.recognize(lastBlob, {
          ...cfg,
          // whitelist numerico; non forza solo cifre, ma aiuta i numeri
          'tessedit_char_whitelist': '0123456789.,',
          'classify_bln_numeric_mode': '1'
        });
        const text2 = r2?.data?.text || '';
        // Strategy semplice: se text2 contiene numeri con meno errori, li preferiamo
        // Qui ci limitiamo a tenere r2 come riferimento numerico accanto a r1
        // (parser potrà usare entrambi per estrarre prezzi/IVA).
        finalText = mergeNumeric(text1, text2);
      } catch(npErr) {
        // Non bloccare Safari: logga e continua con il testo principale
        log('NUMERIC PASS ERROR (ignored):', npErr?.message || npErr);
      }
    }

    // parsing basilare (non forzato): riempie tabella solo se trova pattern
    const rows = window.parseDescrPrezziIva(finalText);
    renderRows(rows);

  } catch (err) {
    setErr('Errore: ' + (err?.message || err));
    log('FATAL', err?.stack || err);
  } finally {
    setProg(1);
  }
}

function mergeNumeric(t1, t2){
  // placeholder semplice: restituisce il testo con riga a fianco per confronto
  if(!t2 || t2.trim()==='') return t1;
  return t1 + '\n\n---[NUMERIC PASS]---\n' + t2;
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
  // demo leggera incorporata (string → Blob) per non avere fetch esterne
  const demoBase64 = (
    // 1x1 PNG bianco minimale con due parole (per test pipeline)
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNk+M8ABgADmBzq4GqVvQAAAABJRU5ErkJggg=='
  );
  const demoBlob = b64ToBlob(demoBase64, 'image/png');
  const demoFile = new File([demoBlob], 'demo.png', {type:'image/png'});
  await runOCR(demoFile, {
    model: $('#model').value,
    psm: $('#psm').value,
    numericPass: $('#numericPass').checked
  });
});

function b64ToBlob(b64, type='application/octet-stream'){
  const bin = atob(b64); const len = bin.length;
  const arr = new Uint8Array(len);
  for (let i=0;i<len;i++) arr[i]=bin.charCodeAt(i);
  return new Blob([arr], {type});
}

function renderRows(rows){
  const tb = $('#outTable tbody');
  tb.innerHTML = '';
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
