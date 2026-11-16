'use strict';

/**
 * Adaptadores de entrada.
 *
 * Toda fonte vira o mesmo modelo canônico — é isso que permite o motor rodar
 * para qualquer cliente, independente de como os dados chegaram.
 *
 * Modelo canônico de fatura:
 * {
 *   id, cliente, distribuidora, uc, propriedade, competencia, vencimento, emissao,
 *   valor, kwh, injetada, motivos[], itens[], status, fonte, bruto
 * }
 */

const { digits, ucKey, toISO } = require('./util.cjs');

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim().replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const pick = (obj, ...chaves) => {
  for (const k of chaves) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return null;
};

function canonico(raw, i, opts = {}) {
  const distribuidora = String(pick(raw, 'distribuidora', 'd', 'fornecedor', 'concessionaria') || '').trim();
  const competencia = String(pick(raw, 'competencia', 'mes', 'mês', 'referencia', 'ref') || '').slice(0, 7);
  const vencimento = toISO(pick(raw, 'vencimento', 'v', 'venc', 'dueDate'));
  const uc = String(pick(raw, 'uc', 'unidade', 'numero_uc', 'num_uc', 'instalacao') || '');
  const valor = num(pick(raw, 'valor', 'val', 'total', 'valor_total'));
  const kwh = num(pick(raw, 'kwh', 'consumo', 'consumo_kwh', 'energia'));
  const injetada = num(pick(raw, 'injetada', 'geracao', 'geração', 'energia_injetada'));

  return {
    id: `${competencia}|${ucKey(uc)}|${i}`,
    cliente: opts.cliente || raw.cliente || 'cliente',
    distribuidora,
    uc,
    propriedade: String(pick(raw, 'propriedade', 'p', 'nome', 'unidade_nome', 'local') || '').trim(),
    competencia,
    vencimento,
    emissao: toISO(pick(raw, 'emissao', 'emissão', 'data_emissao')),
    valor: valor === null ? null : valor,
    kwh: kwh !== null && kwh > 0 ? kwh : null,
    injetada: injetada !== null && injetada > 0 ? injetada : null,
    motivos: Array.isArray(raw.motivos) ? raw.motivos.map(String) : [],
    itens: Array.isArray(raw.itens) ? raw.itens : [],
    status: String(pick(raw, 'status', 's', 'situacao') || '').toUpperCase(),
    fonte: String(pick(raw, 'arquivo', 'fonte', 'caminho', 'file') || ''),
    extracao: raw.extracao || null,
    bruto: raw,
  };
}

/** Formato do painel atual (`dados-cubi.json`): { faturas: [...] }. */
function fromDadosCubi(data, opts = {}) {
  const lista = Array.isArray(data) ? data : (data.faturas || []);
  return lista.map((f, i) => canonico(f, i, opts));
}

/** Array genérico de faturas (ex.: `faturas-geral.json`). */
function fromArray(arr, opts = {}) {
  if (!Array.isArray(arr)) throw new Error('Esperado um array de faturas.');
  return arr.map((f, i) => canonico(f, i, opts));
}

/** CSV com cabeçalho. Detecta `;` ou `,` e aceita os mesmos apelidos do JSON. */
function fromCsv(texto, opts = {}) {
  const linhas = String(texto).replace(/^\ufeff/, '').split(/\r?\n/).filter(l => l.trim());
  if (!linhas.length) return [];

  const sep = (linhas[0].match(/;/g) || []).length >= (linhas[0].match(/,/g) || []).length ? ';' : ',';

  const dividir = linha => {
    const out = [];
    let atual = '', dentro = false;
    for (const ch of linha) {
      if (ch === '"') { dentro = !dentro; continue; }
      if (ch === sep && !dentro) { out.push(atual); atual = ''; continue; }
      atual += ch;
    }
    out.push(atual);
    return out.map(s => s.trim());
  };

  const cabecalho = dividir(linhas[0]);
  return linhas.slice(1).map((linha, i) => {
    const cols = dividir(linha);
    const raw = {};
    cabecalho.forEach((h, j) => { raw[h] = cols[j]; });
    return canonico(raw, i, opts);
  });
}

/**
 * Enriquece as faturas com campos que só existem na base detalhada
 * (ex.: energia injetada), casando por UC + competência.
 */
function enriquecer(faturas, detalhadas) {
  const mapa = new Map();
  for (const d of detalhadas) {
    const chave = `${d.competencia}|${ucKey(d.uc)}`;
    const atual = mapa.get(chave);
    // prefere o registro que tem mais informação
    if (!atual || (!atual.injetada && d.injetada)) mapa.set(chave, d);
  }
  for (const f of faturas) {
    const d = mapa.get(`${f.competencia}|${ucKey(f.uc)}`);
    if (!d) continue;
    if (f.injetada == null && d.injetada != null) f.injetada = d.injetada;
    if (!f.itens.length && d.itens && d.itens.length) f.itens = d.itens;
    if (f.motivos.length === 0 && d.motivos && d.motivos.length) f.motivos = d.motivos;
  }
  return faturas;
}

module.exports = { num, canonico, fromDadosCubi, fromArray, fromCsv, enriquecer, digits };
