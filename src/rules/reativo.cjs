'use strict';

/**
 * Energia reativa excedente.
 *
 * Quando a UC consome reativo acima do limite (0,92 de fator de potência),
 * a distribuidora cobra por "energia reativa excedente". É dinheiro que volta
 * com correção de fator de potência — banco de capacitores, revisão de motores.
 *
 * O valor da linha não está no dado atual, então o achado é qualitativo:
 * mostra recorrência e UCs afetadas (o argumento de venda).
 */

const { achado } = require('../finding.cjs');
const { mesLabel } = require('../util.cjs');

module.exports = {
  id: 'reativo',
  nome: 'Energia reativa excedente',
  categoria: 'economia',
  requer: [],
  avaliar(ctx) {
    const afetadas = ctx.faturas.filter(f => f.motivos.some(m => /reativ/i.test(m)));
    if (!afetadas.length) return [];

    const porUc = new Map();
    for (const f of afetadas) {
      const k = f.uc || f.propriedade;
      if (!porUc.has(k)) porUc.set(k, []);
      porUc.get(k).push(f);
    }

    const ranking = [...porUc.entries()]
      .map(([uc, lista]) => ({
        uc,
        propriedade: lista[0].propriedade,
        ocorrencias: lista.length,
        meses: [...new Set(lista.map(f => f.competencia))].sort(),
      }))
      .sort((a, b) => b.ocorrencias - a.ocorrencias);

    const meses = [...new Set(afetadas.map(f => f.competencia))].sort();

    return [achado({
      categoria: 'economia',
      severidade: 'alta',
      confianca: 'alta',
      titulo: 'Energia reativa excedente cobrada',
      descricao: `${afetadas.length} fatura(s) em ${ranking.length} UC(s) com cobrança de reativo excedente em ${meses.length} competência(s). ` +
        'É cobrança evitável: indica fator de potência abaixo do limite regulatório.',
      valor_estimado: null,
      competencias: meses,
      evidencias: ranking.slice(0, 12).map(r => ({
        uc: r.uc,
        propriedade: r.propriedade,
        ocorrencias: r.ocorrencias,
        texto: `${r.ocorrencias}x (${r.meses.slice(-3).map(mesLabel).join(', ')}${r.meses.length > 3 ? '…' : ''})`,
      })),
      recomendacao: 'Medir fator de potência nas UCs recorrentes e dimensionar banco de capacitores. ' +
        'O payback costuma ser de poucos meses quando a cobrança é mensal.',
      requer: ['valor da linha de reativo no PDF'],
    })];
  },
};
