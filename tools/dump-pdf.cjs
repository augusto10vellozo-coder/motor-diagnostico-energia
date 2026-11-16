#!/usr/bin/env node
'use strict';

/**
 * Utilitário de desenvolvimento: extrai o texto de um PDF e imprime.
 *   node tools/dump-pdf.cjs <arquivo.pdf> [inicio] [fim]
 */

const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const arquivo = process.argv[2];
const inicio = Number(process.argv[3] || 0);
const fim = Number(process.argv[4] || 7000);

(async () => {
  if (!arquivo) {
    console.error('Uso: node tools/dump-pdf.cjs <arquivo.pdf> [inicio] [fim]');
    process.exit(1);
  }
  const buf = fs.readFileSync(arquivo);
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  const r = await parser.getText();
  await parser.destroy();
  const texto = r.text || '';
  console.log(`CARACTERES: ${texto.length}`);
  console.log(texto.slice(inicio, fim));
})().catch(e => { console.error(e); process.exit(1); });
