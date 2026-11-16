'use strict';

/**
 * Demanda, ultrapassagem e demanda complementar.
 *
 * Só roda com os itens da fatura (`fatura.itens[]`), produzidos pelo extrator.
 *
 * Três leituras, com confianças diferentes:
 *
 * 1. Ultrapassagem explícita — a distribuidora cobrou "ultrapassagem".
 *    É economia de confiança alta: o número está na fatura.
 *
 * 2. Demanda complementar — cobrança atípica e de valor alto. NÃO é possível
 *    afirmar que é erro: em GDI ela pode ser legítima. Entra como "a auditar",
 *    com confiança baixa e recomendação de confirmar com a distribuidora.
 *
 * 3. Demanda contratada acima do medido — só quando NÃO há demanda
 *    complementar (senão ela explica a diferença). Aí a economia é estimada
 *    pelo preço unitário da demanda na própria fatura.
 *
 * Faturas com extração não reconciliada (`extracao.confiavel === false`)
 * ficam de fora — melhor não diagnosticar do que diagnosticar errado.
 */

const { achado } = require('../finding.cjs');
const { brl, mesLabel, round2 } = require('../util.cjs');

const utilizavel = f => Array.isArray(f.itens) && f.itens.length > 0 && f.extracao?.confiavel !== false;

module.exports = {
  id: 'demanda',
  nome: 'Demanda, ultrapassagem e enquadramento',
  categoria: 'economia',
  requer: ['itens'],
  avaliar(ctx) {
    const faturas = ctx.faturas.filter(utilizavel);
    if (!faturas.length) return [];

    const saida = [];

    // 1. ultrapassagem explícita
    const ultrapassagens = [];
    for (const f of faturas) {
      for (const item of f.itens) {
        if (!/ultrapass/i.test(item.descricao)) continue;
        if (!Number.isFinite(item.valor) || item.valor <= 0) continue;
        ultrapassagens.push({ f, item });
      }
    }

    if (ultrapassagens.length) {
      const total = round2(ultrapassagens.reduce((s, x) => s + x.item.valor, 0));
      saida.push(achado({
        categoria: 'economia',
        severidade: 'alta',
        confianca: 'alta',
        titulo: 'Ultrapassagem de demanda contratada',
        descricao: `${ultrapassagens.length} cobrança(s) de ultrapassagem. A distribuidora cobra a diferença ` +
          'com penalidade — é a economia mais direta de capturar.',
        valor_estimado: total,
        competencias: [...new Set(ultrapassagens.map(x => x.f.competencia))].sort(),
        evidencias: ultrapassagens.slice(0, 12).map(({ f, item }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: item.valor,
          texto: `${item.descricao} · ${item.quantidade ?? '—'} ${item.unidade || ''} · ${brl(item.valor)}`,
        })),
        recomendacao: 'Redimensionar a demanda contratada com base nos últimos 12 meses e revisar o contrato.',
      }));
    }

    // 2. demanda complementar — a auditar
    const complementares = [];
    for (const f of faturas) {
      for (const item of f.itens) {
        if (!/demanda\s+complementar/i.test(item.descricao)) continue;
        if (!Number.isFinite(item.valor) || item.valor <= 0) continue;
        complementares.push({ f, item });
      }
    }

    if (complementares.length) {
      const total = round2(complementares.reduce((s, x) => s + x.item.valor, 0));
      saida.push(achado({
        categoria: 'economia',
        severidade: 'alta',
        confianca: 'baixa',
        titulo: 'Demanda complementar cobrada',
        descricao: `${complementares.length} cobrança(s) de demanda complementar, somando ${brl(total)}. ` +
          'É uma cobrança atípica e de valor alto. Em geração distribuída pode ser legítima; ' +
          'só a distribuidora confirma a composição. Não tratar como economia antes da auditoria.',
        valor_estimado: total,
        competencias: [...new Set(complementares.map(x => x.f.competencia))].sort(),
        evidencias: complementares.slice(0, 12).map(({ f, item }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: item.valor,
          texto: `${item.descricao} · ${item.quantidade} ${item.unidade} × ${brl(item.valor_unitario)}`,
        })),
        recomendacao: 'Pedir à distribuidora a memória de cálculo da demanda complementar. ' +
          'Comparar com a demanda medida e com o contrato de geração antes de projetar qualquer economia.',
        requer: ['memória de cálculo da distribuidora'],
      }));
    }

    // 3. demanda contratada acima do medido (sem complementar)
    const desequilibrio = [];
    for (const f of faturas) {
      const d = f.extracao?.demanda || {};
      if (!(d.contratada > 0) || !(d.medida > 0)) continue;
      if (d.complementar > 0) continue;
      if (d.medida >= d.contratada * 0.7) continue;

      const itemDemanda = f.itens.find(i => i.tipo === 'demanda' && /USD|TUSD/i.test(i.descricao) && i.valor_unitario > 0);
      const preco = itemDemanda?.valor_unitario || null;
      const economia = preco ? (d.contratada - d.medida) * preco : null;
      desequilibrio.push({ f, d, preco, economia });
    }

    if (desequilibrio.length) {
      const total = desequilibrio.reduce((s, x) => s + (x.economia || 0), 0);
      saida.push(achado({
        categoria: 'economia',
        severidade: 'media',
        confianca: total > 0 ? 'media' : 'baixa',
        titulo: 'Demanda contratada acima do necessário',
        descricao: `${desequilibrio.length} fatura(s) com demanda medida abaixo de 70% da contratada. ` +
          'Você paga por demanda que não usa.',
        valor_estimado: total > 0 ? round2(total) : null,
        competencias: [...new Set(desequilibrio.map(x => x.f.competencia))].sort(),
        evidencias: desequilibrio.slice(0, 12).map(({ f, d, preco, economia }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: economia ? round2(economia) : null,
          texto: `contratada ${d.contratada} kW · medida ${d.medida} kW` +
            (preco ? ` · ${brl(preco)}/kW` : ' · preço do kW não encontrado'),
        })),
        recomendacao: 'Simular redução da demanda contratada com a distribuidora antes do próximo ciclo. ' +
          'Confirmar que a demanda medida não é atípica.',
        requer: total > 0 ? [] : ['preço unitário da demanda na fatura'],
      }));
    }

    return saida;
  },
};
