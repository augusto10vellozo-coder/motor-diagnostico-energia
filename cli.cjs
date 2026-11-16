#!/usr/bin/env node
'use strict';

/**
 * CLI do motor de diagnóstico.
 *
 *   node cli.cjs --input dados-cubi.json --cliente "Pluma" --out saida
 *   node cli.cjs --input faturas.csv --cliente "Mercado X"
 *   node cli.cjs --input dados.json --faturas-geral faturas-geral.json
 *
 * Formatos de saída: json, md, html (padrão: os três).
 */

const fs = require('fs');
const path = require('path');
const { run } = require('./src/engine.cjs');
const normalize = require('./src/normalize.cjs');
const report = require('./src/report.cjs');
const { brl, mesLabel } = require('./src/util.cjs');

function args() {
  const a = process.argv.slice(2);
  const get = (nome, padrao) => {
    const i = a.indexOf('--' + nome);
    return i >= 0 && a[i + 1] ? a[i + 1] : padrao;
  };
  const tem = nome => a.includes('--' + nome);
  return { get, tem };
}

function carregar(caminho, opts) {
  const ext = path.extname(caminho).toLowerCase();
  const texto = fs.readFileSync(caminho, 'utf8');

  if (ext === '.csv') return { faturas: normalize.fromCsv(texto, opts), formato: 'csv' };

  const data = JSON.parse(texto);
  if (Array.isArray(data)) return { faturas: normalize.fromArray(data, opts), formato: 'array' };
  if (Array.isArray(data.faturas)) return { faturas: normalize.fromDadosCubi(data, opts), formato: 'dados-cubi' };
  throw new Error('JSON não reconhecido: esperado array de faturas ou objeto com "faturas".');
}

function slug(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cliente';
}

function main() {
  const { get, tem } = args();
  const entrada = get('input');
  if (!entrada) {
    console.error('Uso: node cli.cjs --input <arquivo.json|csv> [--cliente Nome] [--faturas-geral <arquivo>] [--out <pasta>]');
    process.exit(1);
  }

  const cliente = get('cliente', path.basename(entrada, path.extname(entrada)));
  const opts = {
    cliente,
    fonte: entrada,
    hoje: get('hoje', new Date().toISOString().slice(0, 10)),
    tarifaKwh: get('tarifa-kwh', null),
  };

  const { faturas, formato } = carregar(entrada, opts);

  const geral = get('faturas-geral');
  if (geral) {
    const extra = JSON.parse(fs.readFileSync(geral, 'utf8'));
    const detalhadas = Array.isArray(extra) ? normalize.fromArray(extra, opts) : normalize.fromDadosCubi(extra, opts);
    normalize.enriquecer(faturas, detalhadas);
  }

  const result = run(faturas, opts);

  const outDir = path.resolve(get('out', 'saida'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, slug(cliente) + '-diagnostico');
  const formatos = get('formatos', 'json,md,html').split(',').map(s => s.trim()).filter(Boolean);

  if (formatos.includes('json')) fs.writeFileSync(base + '.json', report.toJson(result), 'utf8');
  if (formatos.includes('md')) fs.writeFileSync(base + '.md', report.toMarkdown(result), 'utf8');
  if (formatos.includes('html')) fs.writeFileSync(base + '.html', report.toHtml(result), 'utf8');

  const { meta, resumo, cobertura } = result;
  const periodo = meta.periodo ? `${mesLabel(meta.periodo.de)} a ${mesLabel(meta.periodo.ate)}` : '—';

  console.log('');
  console.log(`Diagnóstico — ${meta.cliente}`);
  console.log(`Entrada: ${formato} · ${meta.faturas} faturas · ${meta.ucs} UCs · ${periodo}`);
  console.log(`Cobertura de consumo: ${Math.round(meta.coberturaDados.comKwhPct * 100)}%`);
  console.log('');
  console.log(`Achados: ${resumo.achados}`);
  console.log(`Economia confirmada: ${brl(resumo.economia_confirmada)}`);
  console.log(`Economia potencial (média): ${brl(resumo.economia_potencial)}`);
  console.log(`A auditar (baixa): ${brl(resumo.para_auditar)}`);
  console.log(`Risco identificado: ${brl(resumo.risco_identificado)}`);
  console.log(`Sem valor estimado (requer dado extra): ${resumo.achados_sem_valor}`);
  console.log('');
  for (const c of cobertura) {
    console.log(`  [${c.status}] ${c.nome}${c.motivo ? ' — ' + c.motivo : ''}`);
  }
  console.log('');
  console.log('Top achados:');
  for (const a of result.achados.slice(0, 8)) {
    const valor = Number.isFinite(a.valor_estimado) ? brl(a.valor_estimado) : 'sem valor';
    console.log(`  - ${a.titulo} (${valor}, ${a.severidade})`);
  }
  console.log('');
  console.log(`Relatórios em: ${outDir}`);
}

try {
  main();
} catch (e) {
  console.error('Erro:', e.message);
  process.exit(1);
}
