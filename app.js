(function(){
  const $=s=>document.querySelector(s);
  const file=$('#file'), pick=$('#pick'), demo=$('#demo'), cancel=$('#cancel'), csvBtn=$('#csv');
  const modelSel=$('#model'), psmSel=$('#psm'), numericPass=$('#numericPass');
  const status=$('#status'), bar=$('#bar'), raw=$('#raw'), logBox=$('#log'), tbody=document.querySelector('#tbl tbody');
  let worker=null, abort=false, rows=[];

  pick.onclick=()=>file.click();
  cancel.onclick=async()=>{ abort=true; try{ if(worker){ await worker.terminate(); worker=null; log('Worker terminated'); } }catch(_){ } setStatus('Annullato.'); enable(); };
  demo.onclick=()=>{ clearAll(); const demo=`Bianchin srl\nDESCRIZIONE DELLA MERCE ...\nMELONI JOLLY mancin 6 ... 1,600 ... 4\nMELE GRANNY SMITH ... 1,850 ... 4\nFINOCCHIO blue ... 0,600 ... 4`; raw.value=demo; appendItems(window.__estrai_parseProducts(demo)); finalize(); };
  file.onchange=async()=>{ const files=[...file.files]; if(!files.length) return; clearAll(); disable(); try{ await ensureWorker(); await process(files); finalize(); } catch(e){ setStatus('Errore: '+(e.message||e)); log('FATAL',e); } enable(); };
  csvBtn.onclick=()=>{ if(!rows.length) return; const header=['Descrizione','Prezzo','IVA']; const body=rows.map(r=>[r.name,(r.price??0).toFixed(2).replace('.',','),r.vat??'']); const csv=[header,...body].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8;'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='prezzi_iva.csv'; a.click(); URL.revokeObjectURL(url); };

  function log(){ const line=[...arguments].map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' '); logBox.textContent+=line+'\n'; console.log.apply(console,arguments); }
  function setStatus(t){ status.textContent=t; }
  function disable(){ document.querySelectorAll('button,input[type=file],select,input[type=checkbox]').forEach(el=>{ if(el!==cancel) el.disabled=true; }); }
  function enable(){ document.querySelectorAll('button,input[type=file],select,input[type=checkbox]').forEach(el=>el.disabled=false); }
  function clearAll(){ rows=[]; tbody.innerHTML=''; raw.value=''; logBox.textContent=''; setStatus('Pronto.'); bar.value=0; }

  async function ensureWorker(){
    if(worker) return worker;
    const model=modelSel.value;
    const langPath = model==='best'
      ? 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_best@4.1.0'
      : 'https://cdn.jsdelivr.net/gh/tesseract-ocr/tessdata_fast@4.1.0';
    log('Create worker v2 … model=',model,' psm=',psmSel.value);
    worker=Tesseract.createWorker({
      workerPath:'https://cdn.jsdelivr.net/npm/tesseract.js@2/dist/worker.min.js',
      corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@2.2.0/tesseract-core.wasm.js',
      langPath,
      logger:m=>{ if(m&&m.status){ if(typeof m.progress==='number'){ bar.value=Math.round(m.progress*100); } log('OCR:',m.status,m.progress||''); } }
    });
    await worker.load(); await worker.loadLanguage('ita+eng'); await worker.initialize('ita+eng');
    return worker;
  }
  async function recreateWorker(){ try{ if(worker){ await worker.terminate(); } }catch(_){ } worker=null; await ensureWorker(); }

  async function process(files){
    for(const f of files){
      if(abort) break;
      setStatus('Elaboro: '+f.name);
      if(f.type==='application/pdf' || f.name.toLowerCase().endsWith('.pdf')){ await processPdf(f); }
      else if(f.type.startsWith('image/')){ await processImage(f); }
      else{ log('Skip file non supportato:', f.name); }
    }
  }

  async function processPdf(file){
    const ab=await file.arrayBuffer();
    const pdf=await pdfjsLib.getDocument({data:ab}).promise;
    log('PDF pages', pdf.numPages);
    for(let p=1;p<=pdf.numPages;p++){
      const page=await pdf.getPage(p);
      const viewport=page.getViewport({scale:1.8});
      const canvas=document.createElement('canvas');
      const ctx=canvas.getContext('2d',{alpha:false});
      canvas.width=viewport.width; canvas.height=viewport.height;
      await page.render({canvasContext:ctx,viewport}).promise;
      await recognizeFull(canvas, `${file.name} [pag ${p}/${pdf.numPages}]`);
      canvas.width=canvas.height=0;
    }
  }

  async function processImage(file){
    const url=await new Promise(res=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.readAsDataURL(file); });
    const img=await loadImage(url);
    const maxDim=2200;
    const s=Math.min(1, maxDim/Math.max(img.naturalWidth,img.naturalHeight));
    const w=Math.round(img.naturalWidth*s), h=Math.round(img.naturalHeight*s);
    const canvas=document.createElement('canvas'); const ctx=canvas.getContext('2d',{alpha:false});
    canvas.width=w; canvas.height=h;
    ctx.imageSmoothingEnabled=true; ctx.imageSmoothingQuality='high';
    ctx.drawImage(img,0,0,w,h);
    autoContrastGray(ctx,w,h);
    await recognizeFull(canvas, file.name);
    canvas.width=canvas.height=0;
  }

  function autoContrastGray(ctx,w,h){
    const im=ctx.getImageData(0,0,w,h), d=im.data; let mn=255,mx=0;
    for(let i=0;i<d.length;i+=4){ const g=(0.299*d[i]+0.587*d[i+1]+0.114*d[i+2])|0; d[i]=d[i+1]=d[i+2]=g; if(g<mn)mn=g; if(g>mx)mx=g; }
    const range=Math.max(1,mx-mn);
    for(let i=0;i<d.length;i+=4){ const g=(d[i]-mn)*255/range; d[i]=d[i+1]=d[i+2]=g; }
    ctx.putImageData(im,0,0);
  }

  async function recognizeFull(canvas,label){
    const psm=parseInt(psmSel.value,10)||4;
    const img=canvas.toDataURL('image/jpeg',0.95);
    const cfg={ tessedit_pageseg_mode:psm, preserve_interword_spaces:'1', user_defined_dpi:'300' };
    setStatus('OCR (testo) '+label); const text1=(await worker.recognize(img,undefined,cfg)).data.text||'';
    const cleaned=postfix(text1.trim());
    raw.value += cleaned + "\n";
    appendItems(window.__estrai_parseProducts(cleaned));

    if(numericPass.checked){
      const cfgNum={ tessedit_pageseg_mode:psm, preserve_interword_spaces:'1', user_defined_dpi:'300', tessedit_char_whitelist:'0123456789.,%/-' };
      setStatus('OCR (numerico) '+label); const text2=(await worker.recognize(img,undefined,cfgNum)).data.text||'';
      const cleaned2=postfix(text2.trim());
      raw.value += cleaned2 + "\n";
      const extra=window.__estrai_parseProducts(cleaned2);
      mergeNumericOnly(extra);
    }
  }

  function postfix(t){
    return t
      .replace(/(\d)\.(\d{3})([^\d]|$)/g,'$1$2$3')
      .replace(/(\d+),(?=\s)/g,'$1,00')
      .replace(/([^\d])0O([^\d])/g,'$100$2')
      .replace(/(?<=\d)[lI](?=\d)/g,'1');
  }

  function mergeNumericOnly(arr){
    for(const it of arr){
      const key=it.name.toLowerCase();
      const target=rows.find(r=>r.name.toLowerCase().split(/\s+/)[0]===key.split(/\s+/)[0]);
      if(target){
        if(target.price==null && it.price!=null) target.price=it.price;
        if(target.vat==null && it.vat!=null) target.vat=it.vat;
      }
    }
    repaint();
  }

  function appendItems(items){ items.forEach(it=>rows.push(it)); repaint(); }
  function repaint(){
    tbody.innerHTML='';
    rows.forEach((r,i)=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${i+1}</td><td>${escapeHtml(r.name)}</td><td>${r.price!=null?(r.price.toFixed(2)):''}</td><td>${r.vat!=null?r.vat:''}</td>`;
      tbody.appendChild(tr);
    });
  }
  function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;'); }

  function finalize(){ if(!rows.length) setStatus('Fatto. Nessuna riga trovata: verifica il testo OCR grezzo e prova con PSM=6.'); else setStatus(`Fatto. Righe prodotti: ${rows.length}`); }
  function loadImage(url){ return new Promise((res,rej)=>{ const im=new Image(); im.onload=()=>res(im); im.onerror=rej; im.src=url; }); }
})();
