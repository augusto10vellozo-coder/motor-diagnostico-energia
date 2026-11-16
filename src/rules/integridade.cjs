'use strict';

/**
 * Integridade da base: duplicidade, faturas não entregues, vencimento fora da
 * competência e faturas sem consumo.
 *
 * São achados de qualidade/risco — não entram na conta de economia, mas são o
 * que sustenta a confiança do cliente no diagnóstico.
 */

const { achado } = require('../finding.cjs');
const { brl, mesLabel, diffMonths, round2 } = require('../util.cjs');

function duplicidades(ctx) {
  const grupos = new Map();
  for (const f of ctx.faturas) {
    if (!Number.isFinite(f.valor) || f.valor <= 0) continue;
    const chaveUc = f.uc ? f.uc.replace(/\D/g, '').replace(/^0+/, '') : f.propriedade.trim().toLowerCase();
    if (!chaveUc) continue;
    const k = `${chaveUc}|${f.competencia}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(f);
  }

  const achados = [];
  for (const [, lista] of grupos) {
    if (lista.length < 2) continue;

    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        const mesmoValor = Math.abs(a.valor - b.valor) < 0.01;
        const mesmaNota = a.bruto && b.bruto && a.bruto.nota && a.bruto.nota === b.bruto.nota && a.bruto.nota !== '—';
        const mesmoKwh = a.kwh != null && b.kwh != null && Math.abs(a.kwh - b.kwh) < 1;
        if (!mesmoValor) continue;
        // mesmo valor só vira duplicidade se a nota ou o consumo também batem
        if (!mesmaNota && !mesmoKwh) continue;
        achados.push({
          uc: a.uc || b.uc,
          propriedade: a.propriedade || b.propriedade,
          competencia: a.competencia,
          valor: a.valor,
          motivo: mesmaNota ? 'mesma nota fiscal' : 'mesmo valor e mesmo consumo',
        });
      }
    }
  }
  return achados;
}

module.exports = {
  id: 'integridade',
  nome: 'Integridade da base',
  categoria: 'qualidade',
  requer: [],
  avaliar(ctx) {
    const saida = [];

    // 1. duplicidade
    const dups = duplicidades(ctx);
    if (dups.length) {
      const total = round2(dups.reduce((s, d) => s + (Number.isFinite(d.valor) ? d.valor : 0), 0));
      saida.push(achado({
        categoria: 'risco',
        severidade: 'alta',
        confianca: 'alta',
        titulo: 'Possível fatura duplicada',
        descricao: `${dups.length} par(es) de faturas com mesmo valor ou mesma nota na mesma UC e competência. ` +
          'Se confirmado, é pagamento em duplicidade.',
        valor_estimado: total || null,
        competencias: [...new Set(dups.map(d => d.competencia))].sort(),
        evidencias: dups.slice(0, 12).map(d => ({
          uc: d.uc,
          propriedade: d.propriedade,
          competencia: mesLabel(d.competencia),
          valor: d.valor,
          texto: `${d.motivo} · ${Number.isFinite(d.valor) ? brl(d.valor) : '—'}`,
        })),
        recomendacao: 'Conferir nota fiscal e comprovante antes de pagar. Se pago em duplicidade, pedir restituição.',
      }));
    }

    // 2. faturas não entregues
    const hoje = ctx.opts.hoje || new Date().toISOString().slice(0, 10);
    const pendentes = ctx.faturas.filter(f => /ESPERAD|PENDENT/.test(f.status));
    if (pendentes.length) {
      const vencidas = pendentes.filter(f => f.vencimento && f.vencimento < hoje);
      saida.push(achado({
        categoria: 'risco',
        severidade: vencidas.length ? 'alta' : 'media',
        confianca: 'alta',
        titulo: 'Faturas ainda não recebidas',
        descricao: `${pendentes.length} fatura(s) marcada(s) como esperada/pendente` +
          (vencidas.length ? `, sendo ${vencidas.length} com vencimento já passado.` : '.'),
        valor_estimado: null,
        competencias: [...new Set(pendentes.map(f => f.competencia))].sort(),
        evidencias: pendentes.slice(0, 12).map(f => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: f.vencimento ? `vence ${f.vencimento}` : 'sem vencimento',
        })),
        recomendacao: 'Buscar 2ª via no portal da distribuidora e confirmar se há débito em aberto.',
      }));
    }

    // 3. vencimento fora da janela da competência
    const fora = [];
    for (const f of ctx.faturas) {
      if (!f.vencimento || !f.competencia) continue;
      const mesVenc = f.vencimento.slice(0, 7);
      const diff = diffMonths(mesVenc, f.competencia);
      if (diff < 0 || diff > 2) fora.push({ f, diff });
    }
    if (fora.length) {
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'baixa',
        confianca: 'alta',
        titulo: 'Vencimento fora da janela esperada',
        descricao: `${fora.length} fatura(s) com vencimento fora do intervalo normal (competência a competência + 2 meses). ` +
          'Pode ser parcela, reemissão ou erro de cadastro.',
        valor_estimado: null,
        competencias: [...new Set(fora.map(x => x.f.competencia))].sort(),
        evidencias: fora.slice(0, 12).map(({ f, diff }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: `vence ${f.vencimento} (${diff} mês(es) de diferença)`,
        })),
        recomendacao: 'Conferir se é parcela de acordo ou fatura reemitida.',
      }));
    }

    // 4. faturas sem consumo
    const semKwh = ctx.faturas.filter(f => !f.kwh && Number.isFinite(f.valor) && f.valor > 0);
    if (semKwh.length) {
      const porDist = new Map();
      for (const f of semKwh) porDist.set(f.distribuidora || '—', (porDist.get(f.distribuidora || '—') || 0) + 1);
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'info',
        confianca: 'alta',
        titulo: 'Faturas sem consumo identificado',
        descricao: `${semKwh.length} fatura(s) com valor mas sem kWh. Sem consumo, não é possível avaliar tarifa, consumo fora do padrão nem geração.`,
        valor_estimado: null,
        competencias: [...new Set(semKwh.map(f => f.competencia))].sort(),
        evidencias: [...porDist.entries()].map(([dist, n]) => ({ texto: `${dist}: ${n} fatura(s)` })),
        recomendacao: 'Reprocessar os PDFs com OCR ou extrair a linha de consumo no portal da distribuidora.',
        requer: ['kWh por fatura'],
      }));
    }

    // 5. extração de itens não reconciliada
    const divergentes = ctx.faturas.filter(f => f.extracao && f.extracao.confiavel === false);
    if (divergentes.length) {
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'media',
        confianca: 'alta',
        titulo: 'Extração de itens não reconciliada',
        descricao: `${divergentes.length} fatura(s) com extração incompleta: total não identificado ou soma dos itens diferente do total. ` +
          'Essas faturas ficam fora do diagnóstico de demanda até revisão.',
        valor_estimado: null,
        competencias: [...new Set(divergentes.map(f => f.competencia))].sort(),
        evidencias: divergentes.slice(0, 12).map(f => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: f.valor == null
            ? `total não identificado · itens ${brl(f.extracao.somaItens)}`
            : `total ${brl(f.valor)} · itens ${brl(f.extracao.somaItens)} · diferença ${brl(f.extracao.divergencia)}`,
        })),
        recomendacao: 'Conferir as páginas de crédito e resumo do PDF e completar a extração.',
      }));
    }

    return saida;
  },
};
