#!/usr/bin/env node
'use strict';

/**
 * Extrai faturas de PDF para o formato do motor.
 *
 *   node extrair.cjs --pasta <dir> --out faturas-copel.json
 *   node extrair.cjs --pasta <dir> --distribuidora copel --limite 50
 *
 * Gera:
 *   - <out>            array de faturas no modelo canônico (com itens)
 *   - <out>.falhas.json  PDFs que não puderam ser lidos
 */

const fs = require('fs');
const path = require('path');
const copel = require('./src/extratores/copel.cjs');

function args() {
  const a = process.argv.slice(2);
  const get = (nome, padrao) => {
    const i = a.indexOf('--' + nome);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  return { get };
}

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.pdf$/i.test(e.name)) out.push(p);
  }
  return out;
}

function motivosDoTexto(texto) {
  const t = String(texto || '').toUpperCase();
  const motivos = [];
  if (/MULTA POR ATRASO|MULTA DE 2%|MULTA POR ATRASO NO PAGAMENTO/.test(t)) motivos.push('multa por atraso');
  if (/JUROS|ACRÉSCIMO MORATÓRIO|ACRESCIMO MORATORIO/.test(t)) motivos.push('juros/acréscimo');
  if (/ENERGIA REAT EXCED|DEMANDA REATIVA EXCED/.test(t)) motivos.push('reativo excedente');
  if (/BANDEIRA AMARELA/.test(t)) motivos.push('bandeira amarela');
  if (/BANDEIRA VERMELHA/.test(t)) motivos.push('bandeira vermelha');
  return motivos;
}

function nomePropriedade(arquivo) {
  return path.basename(arquivo, '.pdf')
    .replace(/\s*-\s*\d{6,}\s*$/, '')
    .replace(/_/g, ' ')
    .trim();
}

async function main() {
  const { get } = args();
  const pasta = get('pasta');
  if (!pasta) {
    console.error('Uso: node extrair.cjs --pasta <dir> --out <arquivo.json> [--distribuidora copel] [--limite N]');
    process.exit(1);
  }

  const limite = Number(get('limite', 0)) || Infinity;
  const saida = path.resolve(get('out', 'saida/faturas-extraidas.json'));
  const arquivos = walk(path.resolve(pasta)).slice(0, limite);

  const faturas = [];
  const falhas = [];
  let semTexto = 0;

  for (const arquivo of arquivos) {
    let texto = '';
    let linhas = [];
    try {
      const lido = await copel.lerPdf(fs.readFileSync(arquivo));
      texto = lido.texto;
      linhas = lido.linhas;
    } catch (e) {
      const protegido = /password/i.test(e.message);
      falhas.push({ arquivo, motivo: protegido ? 'PDF protegido por senha' : `PDF ilegível: ${e.message}` });
      continue;
    }

    if (texto.replace(/\s/g, '').length < 200) {
      semTexto++;
      falhas.push({ arquivo, motivo: 'PDF sem texto nativo (digitalizado ou print de e-mail)' });
      continue;
    }

    if (!copel.detectar(texto)) {
      falhas.push({ arquivo, motivo: 'distribuidora não reconhecida' });
      continue;
    }

    const r = copel.extrairDeLinhas(linhas, texto);
    if (r.erro || !r.itens.length) {
      falhas.push({ arquivo, motivo: r.erro || 'nenhum item extraído', diagnostico: r.diagnostico });
      continue;
    }

    faturas.push({
      mes: r.competencia,
      d: r.distribuidora,
      p: nomePropriedade(arquivo),
      uc: r.uc || (path.basename(arquivo).match(/(\d{6,})\s*\.pdf$/i) || [])[1] || '',
      val: r.total,
      kwh: r.kwh,
      injetada: r.injetada,
      v: r.vencimento,
      s: 'ENTREGUE',
      motivos: motivosDoTexto(texto),
      itens: r.itens,
      arquivo: path.basename(arquivo),
      caminho: arquivo.replace(/\\/g, '/'),
      extracao: {
        somaItens: r.somaItens,
        divergencia: r.divergencia,
        confiavel: r.total != null && Math.abs(r.divergencia || 0) <= 0.05,
        demanda: r.demanda,
        reativoKvarh: r.reativoKvarh,
        alertas: r.alertas,
      },
    });
  }

  fs.mkdirSync(path.dirname(saida), { recursive: true });
  fs.writeFileSync(saida, JSON.stringify(faturas, null, 2), 'utf8');
  fs.writeFileSync(saida.replace(/\.json$/i, '') + '.falhas.json', JSON.stringify(falhas, null, 2), 'utf8');

  const comItens = faturas.filter(f => f.itens.length).length;
  const reconciliadas = faturas.filter(f => Math.abs(f.extracao.divergencia || 0) <= 0.05).length;
  const comDemanda = faturas.filter(f => f.extracao.demanda && f.extracao.demanda.contratada != null).length;

  console.log('');
  console.log(`PDFs encontrados: ${arquivos.length}`);
  console.log(`Extraídas: ${faturas.length} (${comItens} com itens)`);
  console.log(`Reconciliadas com o total: ${reconciliadas}/${faturas.length}`);
  console.log(`Com demanda contratada: ${comDemanda}`);
  console.log(`Sem texto nativo: ${semTexto}`);
  console.log(`Falhas: ${falhas.length}`);
  console.log('');
  console.log(`Faturas: ${saida}`);
  console.log(`Falhas:  ${saida.replace(/\.json$/i, '')}.falhas.json`);

  if (falhas.length) {
    console.log('');
    console.log('Primeiras falhas:');
    for (const f of falhas.slice(0, 8)) {
      console.log(`  - ${path.basename(f.arquivo)} — ${f.motivo}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
