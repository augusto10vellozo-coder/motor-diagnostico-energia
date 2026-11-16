'use strict';

/**
 * Consumo fora do padrão da própria UC.
 *
 * Compara cada mês com a mediana histórica da UC. Pega vazamento, equipamento
 * ligado sem necessidade, erro de leitura e mudança de operação.
 * Exige pelo menos 3 meses com kWh para ter uma base minimamente confiável.
 */

const { achado, agruparPorUc } = require('../finding.cjs');
const { brl, mesLabel, median, round2 } = require('../util.cjs');

const MIN_MESES = 3;
const MIN_KWH = 100;
const LIMITE_ALTA = 1.6;
const LIMITE_BAIXA = 0.5;
const MIN_DELTA_KWH = 200;

module.exports = {
  id: 'consumo',
  nome: 'Consumo fora do padrão',
  categoria: 'economia',
  requer: ['kwh', 'valor'],
  avaliar(ctx) {
    const aumentos = [];
    const quedas = [];

    for (const [uc, lista] of agruparPorUc(ctx.faturas)) {
      const validos = lista.filter(f => f.kwh && f.kwh >= MIN_KWH);
      if (validos.length < MIN_MESES) continue;

      const base = median(validos.map(f => f.kwh));
      if (!base || base <= 0) continue;

      for (const f of validos) {
        const delta = f.kwh - base;
        if (Math.abs(delta) < MIN_DELTA_KWH) continue;
        const razao = f.kwh / base;
        if (razao >= LIMITE_ALTA) aumentos.push({ f, base, delta, razao });
        else if (razao <= LIMITE_BAIXA) quedas.push({ f, base, delta, razao });
      }
    }

    const saida = [];

    if (aumentos.length) {
      let total = 0;
      for (const { f, delta } of aumentos) {
        total += delta * ctx.tarifaKwh;
      }

      saida.push(achado({
        categoria: 'economia',
        severidade: 'media',
        confianca: 'media',
        titulo: 'Meses com consumo muito acima do padrão da UC',
        descricao: `${aumentos.length} fatura(s) com consumo pelo menos ${LIMITE_ALTA}x acima da mediana histórica da própria UC. ` +
          'Pode ser vazamento, equipamento novo, falha de medição ou mudança de operação. ' +
          `Estimativa pela tarifa de referência de ${brl(ctx.tarifaKwh)}/kWh.`,
        valor_estimado: total ? round2(total) : null,
        competencias: [...new Set(aumentos.map(x => x.f.competencia))].sort(),
        evidencias: aumentos
          .sort((a, b) => b.delta - a.delta)
          .slice(0, 12)
          .map(({ f, base, delta, razao }) => ({
            uc: f.uc,
            propriedade: f.propriedade,
            competencia: mesLabel(f.competencia),
            valor: f.valor,
            texto: `${Math.round(f.kwh)} kWh vs mediana ${Math.round(base)} kWh (${razao.toFixed(1)}x, +${Math.round(delta)} kWh)`,
          })),
        recomendacao: 'Investigar as UCs do topo: histórico de manutenção, equipamentos e leitura do medidor. ' +
          'Confirmar antes de tratar como economia.',
      }));
    }

    if (quedas.length) {
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'baixa',
        confianca: 'media',
        titulo: 'Meses com consumo muito abaixo do padrão da UC',
        descricao: `${quedas.length} fatura(s) com consumo abaixo de ${LIMITE_BAIXA}x a mediana da UC. ` +
          'Pode ser leitura estimada, medidor com defeito ou UC desativada.',
        valor_estimado: null,
        competencias: [...new Set(quedas.map(x => x.f.competencia))].sort(),
        evidencias: quedas.slice(0, 12).map(({ f, base, razao }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: `${Math.round(f.kwh)} kWh vs mediana ${Math.round(base)} kWh (${razao.toFixed(1)}x)`,
        })),
        recomendacao: 'Conferir se a leitura foi real ou estimada e se a UC está ativa.',
      }));
    }

    return saida;
  },
};
