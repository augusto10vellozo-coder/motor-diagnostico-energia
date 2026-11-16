'use strict';

/**
 * Motor de diagnóstico.
 *
 * Entrada: faturas no modelo canônico (ver normalize.cjs).
 * Saída: achados priorizados + cobertura das regras.
 *
 * Princípio: nunca inventar diagnóstico. Regra sem dado aparece como "pulada",
 * e todo achado carrega confiança e a evidência que o sustenta.
 */

const regras = require('./rules/index.cjs');
const { ucKey, median, round2, mesLabel } = require('./util.cjs');

const PESO_SEVERIDADE = { alta: 4, media: 3, baixa: 2, info: 1 };

function buildContext(faturas, opts = {}) {
  const porUc = new Map();
  for (const f of faturas) {
    const k = f.uc ? ucKey(f.uc) : `sem-uc:${f.id}`;
    if (!porUc.has(k)) porUc.set(k, []);
    porUc.get(k).push(f);
  }

  const tarifaRef = new Map();
  const porDistMes = new Map();
  for (const f of faturas) {
    if (!f.kwh || !Number.isFinite(f.valor) || f.valor <= 0) continue;
    const k = `${f.distribuidora}|${f.competencia}`;
    if (!porDistMes.has(k)) porDistMes.set(k, []);
    porDistMes.get(k).push(f.valor / f.kwh);
  }
  for (const [k, valores] of porDistMes) tarifaRef.set(k, median(valores));

  const tarifaUc = new Map();
  for (const [uc, lista] of porUc) {
    const valores = lista
      .filter(f => f.kwh && Number.isFinite(f.valor) && f.valor > 0)
      .map(f => f.valor / f.kwh);
    const m = median(valores);
    if (m) tarifaUc.set(uc, m);
  }

  const tem = {
    kwh: faturas.some(f => f.kwh > 0),
    valor: faturas.some(f => Number.isFinite(f.valor) && f.valor > 0),
    injetada: faturas.some(f => f.injetada > 0),
    itens: faturas.some(f => Array.isArray(f.itens) && f.itens.length > 0),
  };

  const tarifaKwh = Number(opts.tarifaKwh) > 0 ? Number(opts.tarifaKwh) : 0.55;

  return { faturas, porUc, tarifaRef, tarifaUc, tem, tarifaKwh, opts };
}

function meta(faturas, opts) {
  const competencias = [...new Set(faturas.map(f => f.competencia).filter(Boolean))].sort();
  const ucs = new Set(faturas.map(f => ucKey(f.uc)).filter(Boolean));
  const distribuidoras = [...new Set(faturas.map(f => f.distribuidora).filter(Boolean))].sort();
  const comKwh = faturas.filter(f => f.kwh > 0).length;
  const comValor = faturas.filter(f => Number.isFinite(f.valor) && f.valor > 0).length;

  return {
    cliente: opts.cliente || faturas[0]?.cliente || 'cliente',
    geradoEm: new Date().toISOString(),
    fonte: opts.fonte || '',
    faturas: faturas.length,
    ucs: ucs.size,
    distribuidoras,
    periodo: competencias.length
      ? { de: competencias[0], ate: competencias[competencias.length - 1], competencias: competencias.length }
      : null,
    coberturaDados: {
      comValor,
      comKwh,
      comKwhPct: faturas.length ? comKwh / faturas.length : 0,
      comInjetada: faturas.filter(f => f.injetada > 0).length,
      comItens: faturas.filter(f => Array.isArray(f.itens) && f.itens.length).length,
    },
  };
}

function resumir(achados) {
  const economia = achados.filter(a => a.categoria === 'economia');
  const risco = achados.filter(a => a.categoria === 'risco');
  const comValor = arr => arr.filter(a => Number.isFinite(a.valor_estimado) && a.valor_estimado > 0);
  const soma = arr => round2(arr.reduce((s, a) => s + a.valor_estimado, 0));

  const economiaConfirmada = comValor(economia.filter(a => a.confianca === 'alta'));
  const economiaPotencial = comValor(economia.filter(a => a.confianca === 'media'));
  const paraAuditar = comValor(economia.filter(a => a.confianca === 'baixa'));

  const porCategoria = {};
  for (const a of achados) porCategoria[a.categoria] = (porCategoria[a.categoria] || 0) + 1;

  const porSeveridade = {};
  for (const a of achados) porSeveridade[a.severidade] = (porSeveridade[a.severidade] || 0) + 1;

  const porRegra = {};
  for (const a of achados) {
    if (!porRegra[a.regra]) porRegra[a.regra] = { nome: a.regra_nome, achados: 0, valor: 0 };
    porRegra[a.regra].achados++;
    if (Number.isFinite(a.valor_estimado)) porRegra[a.regra].valor += a.valor_estimado;
  }
  for (const r of Object.values(porRegra)) r.valor = round2(r.valor);

  return {
    achados: achados.length,
    economia_confirmada: soma(economiaConfirmada),
    economia_potencial: soma(economiaPotencial),
    para_auditar: soma(paraAuditar),
    economia_total_estimada: soma([...economiaConfirmada, ...economiaPotencial, ...paraAuditar]),
    risco_identificado: soma(comValor(risco)),
    achados_com_valor: comValor(achados).length,
    achados_sem_valor: achados.filter(a => !Number.isFinite(a.valor_estimado)).length,
    porCategoria,
    porSeveridade,
    porRegra,
  };
}

function run(faturas, opts = {}) {
  const ctx = buildContext(faturas, opts);
  const achados = [];
  const cobertura = [];

  for (const regra of regras) {
    const faltando = (regra.requer || []).filter(k => !ctx.tem[k]);
    if (faltando.length) {
      cobertura.push({
        id: regra.id,
        nome: regra.nome,
        status: 'pulada',
        motivo: `sem dado suficiente: ${faltando.join(', ')}`,
        achados: 0,
      });
      continue;
    }

    try {
      const saida = regra.avaliar(ctx, opts) || [];
      for (const a of saida) {
        achados.push({
          ...a,
          regra: regra.id,
          regra_nome: regra.nome,
        });
      }
      cobertura.push({ id: regra.id, nome: regra.nome, status: 'avaliada', achados: saida.length });
    } catch (e) {
      cobertura.push({
        id: regra.id,
        nome: regra.nome,
        status: 'erro',
        motivo: e.message,
        achados: 0,
      });
    }
  }

  achados.sort((a, b) => {
    const va = Number.isFinite(a.valor_estimado) ? a.valor_estimado : -1;
    const vb = Number.isFinite(b.valor_estimado) ? b.valor_estimado : -1;
    if (vb !== va) return vb - va;
    return (PESO_SEVERIDADE[b.severidade] || 0) - (PESO_SEVERIDADE[a.severidade] || 0);
  });

  return {
    meta: meta(faturas, opts),
    cobertura,
    resumo: resumir(achados),
    achados,
  };
}

module.exports = { run, buildContext, resumir, regras, mesLabel };
