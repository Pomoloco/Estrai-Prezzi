// Parser semplice: cerca righe con descrizione + numeri tipici "prezzo" e "iva"
// Miglioreremo per fornitore (Bianchin, Pittoni, Berica, OROFRUIT) quando ci confermi la stabilità OCR.
(function(global){
  function norm(s){ return (s||'').replace(/\u00A0/g,' ').replace(/[^\S\r\n]+/g,' ').trim(); }

  function parse(text){
    const out = [];
    if(!text) return out;

    // Uniamo righe spezzate e filtriamo righe ovviamente non di corpo tabella
    const lines = text.split(/\r?\n/).map(norm).filter(Boolean)
      .filter(l => !/^VIA |^Codice Fiscale|^C\.\s*S\.|^IBAN|^TIPO DOCUMENTO|^DOCUMENTO DI|^PAGATO|^NUMERO DOCUMENTO|^DATA DOC|^TOTALE|^IMBALL|^CAUSALE|^TRASPORTO|^Le merci|^Assolve|^La durata|^Agrumi|^Il pagamento|^L' Azienda/i.test(l));

    // Pattern numeri (prezzi) tipo "1,600" "59,04" ecc. e IVA 4/22
    const rePrezzo = /(\d{1,3}(?:[.,]\d{3})*[.,]\d{2,3}|\d{1,3}[.,]\d{3})\b/;
    const reIva = /\b(4|22|10)\b/;

    for (const l of lines){
      // Trova l'ultimo numero "in stile prezzo" nella riga
      const matches = [...l.matchAll(rePrezzo)].map(m=>m[1]);
      if(matches.length===0) continue;
      const prezzo = matches[matches.length-1];

      // IVA (se presente) alla fine riga
      const ivaMatch = l.match(/(\b4\b|\b22\b|\b10\b)\s*$/);
      const iva = ivaMatch ? ivaMatch[1] : '';

      // Descrizione: inizio riga fino al primo numero plausibile
      const firstNum = l.search(rePrezzo);
      let desc = firstNum>0 ? l.slice(0, firstNum).trim() : l;
      // pulizie tipiche
      desc = desc.replace(/^[\|\-·•\s]+/,'').replace(/\s{2,}/g,' ');

      // scarta righe troppo corte o troppo numeriche
      if(desc.length<3 || /^\d+$/.test(desc)) continue;

      out.push({ desc, prezzo, iva });
    }
    return out;
  }

  global.parseDescrPrezziIva = parse;
})(window);
