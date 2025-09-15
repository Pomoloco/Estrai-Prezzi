(function(){
  const PRICE_RE=/(?:€\s*)?(\d{1,3}(?:[.\s]\d{3})*(?:[.,]\d{2})|\d+[.,]\d{2})(?!\d)/g;
  const VAT_RE=/\b(?:iva\s*[:\-]?\s*)?(0?4(?:[.,]0)?|0?5(?:[.,]0)?|10(?:[.,]0)?|22(?:[.,]0)?)\s*%?\b/i;

  function normPrice(s){
    if(!s) return null;
    let x=String(s).replace(/[€\s]/g,'');
    if(x.includes('.')&&x.includes(',')) x=x.replace(/\./g,'').replace(',', '.');
    else if(x.includes(',')) x=x.replace(',', '.');
    const n=parseFloat(x);
    return Number.isFinite(n)?n:null;
  }
  function normVat(tok){
    if(!tok) return null;
    const n=parseInt(String(tok).replace(/[^\d]/g,''),10);
    const v=n%100;
    return [4,5,10,22].includes(v)?v:null;
  }
  function findAll(re,str){
    const out=[]; re.lastIndex=0; let m;
    while((m=re.exec(str))!==null){ out.push({i:m.index,raw:m[0],val:m[1]||m[0]}); }
    re.lastIndex=0; return out;
  }
  function isNoise(l){
    const low=l.toLowerCase();
    if(low.length<6) return true;
    if(/\b(totale|imponibile|imposta|documento|iban|annotazioni|firma|vettore|destinatario|saldo|trasporto|legenda|codici iva)\b/i.test(low)) return true;
    return false;
  }
  function detectSupplier(t){
    t=t.toLowerCase();
    if(t.includes('bianchin')) return 'BIANCHIN';
    if(t.includes('pittoni')) return 'PITTONI';
    if(t.includes('berica') && t.includes('funghi')) return 'BERICA_FUNGHI';
    if(t.includes('orofruit')) return 'OROFRUIT';
    return null;
  }

  function parseProducts(fullText){
    const supplier=detectSupplier(fullText);
    const lines=fullText.split(/\r?\n/).map(s=>s.replace(/\s{2,}/g,' ').trim()).filter(Boolean);
    const items=[];
    for(const line of lines){
      if(isNoise(line)) continue;
      if(!/\d/.test(line)) continue;

      const vatToks=findAll(VAT_RE,line);
      const lastVat=vatToks.length?vatToks[vatToks.length-1]:null;
      const vatVal=lastVat?normVat(lastVat.val):null;

      const prices=findAll(PRICE_RE,line).map(p=>({...p,num:normPrice(p.val)}));
      if(!prices.length) continue;

      let chosen=prices[prices.length-1];
      const leftOfVat=lastVat?prices.filter(p=>p.i<lastVat.i):prices;

      if(supplier==='BIANCHIN'){
        if(leftOfVat.length) chosen=leftOfVat[leftOfVat.length-1];
      } else if(supplier==='OROFRUIT'){
        if(leftOfVat.length) chosen=leftOfVat.sort((a,b)=>a.num-b.num)[0];
      } else if(supplier==='PITTONI'){
        if(lastVat&&leftOfVat.length){
          leftOfVat.sort((a,b)=>Math.abs(lastVat.i-a.i)-Math.abs(lastVat.i-b.i));
          chosen=leftOfVat[0];
        }
      } else if(supplier==='BERICA_FUNGHI'){
        if(leftOfVat.length) chosen=leftOfVat[leftOfVat.length-1];
      } else {
        if(lastVat&&leftOfVat.length){
          leftOfVat.sort((a,b)=>Math.abs(lastVat.i-a.i)-Math.abs(lastVat.i-b.i));
          chosen=leftOfVat[0];
        }
      }

      let name=line.slice(0, chosen.i).trim();
      name=name.replace(/\b(art\.?|cod\.?|lotto|iso|cal|cat|colli?|lordo|tara|netto|kg|ct|pz|u\.?m\.?|p\.?\s*lordo\/?pz|p\.?\s*netto|uom)\b.*$/i,' ')
               .replace(/[|•·\-–—]+/g,' ')
               .replace(/\s{2,}/g,' ')
               .trim();
      if(!name || name.length<3) continue;

      items.push({ name, price: chosen.num, vat: vatVal });
    }

    const map=new Map();
    for(const it of items){
      map.set(`${it.name.toLowerCase()}|${it.vat??''}`, it);
    }
    return [...map.values()];
  }

  window.__estrai_parseProducts = parseProducts;
})();
