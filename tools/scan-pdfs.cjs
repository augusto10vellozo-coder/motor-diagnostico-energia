#!/usr/bin/env node
'use strict';

/**
 * Utilitário de desenvolvimento: mede quanto texto nativo cada PDF tem.
 *   node tools/scan-pdfs.cjs <pasta> [limite]
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const raiz = process.argv[2];
const limite = Number(process.argv[3] || 40);

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  if (!raiz) {
    console.error('Uso: node tools/scan-pdfs.cjs <pasta> [limite]');
    process.exit(1);
  }
  const arquivos = walk(raiz).slice(0, limite);
  for (const arquivo of arquivos) {
    let chars = 0;
    try {
      const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(arquivo)) });
      const r = await parser.getText();
      await parser.destroy();
      chars = (r.text || '').length;
    } catch (e) {
      chars = -1;
    }
    console.log(String(chars).padStart(7), path.basename(arquivo));
  }
})().catch(e => { console.error(e); process.exit(1); });
