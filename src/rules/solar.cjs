'use strict';

/**
 * Geração distribuída: sinal de que a compensação não está chegando na fatura.
 *
 * Regra conservadora: só dispara quando existe energia injetada e o custo por
 * kWh da UC continua no nível (ou acima) dos pares. Confiança baixa de
 * propósito — é um alerta para auditar, não uma conclusão.
 */

const { achado } = require('../finding.cjs');
const { brl, mesLabel, round2 } = require('../util.cjs');

module.exports = {
  id: 'solar',
  nome: 'Geração distribuída e compensação',
  categoria: 'economia',
  requer: ['injetada', 'kwh', 'valor'],
  avaliar(ctx) {
    const comGeracao = ctx.faturas.filter(f => f.injetada > 0);
    if (!comGeracao.length) return [];

    const suspeitas = [];
    for (const f of comGeracao) {
      if (!f.kwh || !Number.isFinite(f.valor) || f.valor <= 0) continue;
      const ref = ctx.tarifaRef.get(`${f.distribuidora}|${f.competencia}`);
      if (!ref) continue;
      const custo = f.valor / f.kwh;
      if (custo >= ref * 0.95) suspeitas.push({ f, ref, custo });
    }

    const saida = [];

    if (suspeitas.length) {
      const total = round2(suspeitas.reduce((s, x) => s + x.f.injetada * x.ref, 0));
      saida.push(achado({
        categoria: 'economia',
        severidade: 'alta',
        confianca: 'baixa',
        titulo: 'Geração injetada sem redução aparente na fatura',
        descricao: `${suspeitas.length} fatura(s) de UC com energia injetada mantiveram custo por kWh no nível dos pares. ` +
          'Pode ser crédito não aplicado, rateio entre UCs ou leitura de geração fora do ciclo.',
        valor_estimado: total,
        competencias: [...new Set(suspeitas.map(x => x.f.competencia))].sort(),
        evidencias: suspeitas.slice(0, 12).map(({ f, ref, custo }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: `${Math.round(f.injetada)} kWh injetados · ${brl(custo)}/kWh vs ${brl(ref)}/kWh`,
        })),
        recomendacao: 'Conferir o extrato de compensação e se os créditos estão sendo alocados na UC correta.',
        requer: ['extrato de compensação da distribuidora'],
      }));
    }

    const excedente = comGeracao.filter(f => f.kwh && f.injetada > f.kwh);
    if (excedente.length) {
      saida.push(achado({
        categoria: 'informativo',
        severidade: 'info',
        confianca: 'alta',
        titulo: 'UCs gerando mais do que consomem',
        descricao: `${excedente.length} fatura(s) com energia injetada maior que o consumo. O excedente vira crédito e expira em 60 meses.`,
        valor_estimado: null,
        competencias: [...new Set(excedente.map(f => f.competencia))].sort(),
        evidencias: excedente.slice(0, 12).map(f => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          texto: `${Math.round(f.injetada)} kWh injetados · ${Math.round(f.kwh)} kWh consumidos`,
        })),
        recomendacao: 'Acompanhar o saldo de créditos para não perder geração por vencimento.',
      }));
    }

    return saida;
  },
};
