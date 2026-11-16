'use strict';

/**
 * Variação anormal do custo por kWh da própria UC.
 *
 * Por que não comparar com outras UCs: o valor da fatura inclui demanda
 * contratada, iluminação pública e tributos. Uma granja em MT pode pagar
 * R$ 12/kWh e uma casa em BT R$ 0,70/kWh sem nenhum erro. Comparar entre
 * UCs gera falso positivo em escala.
 *
 * A comparação válida é a UC com ela mesma ao longo do tempo: se o mix de
 * cobrança é estável, um salto de custo por kWh é sinal real.
 *
 * Mesmo assim o número é um proxy — por isso a confiança é baixa e o achado
 * entra em "a auditar", não em economia confirmada.
 */

const { achado, agruparPorUc, nomeDoGrupo } = require('../finding.cjs');
const { brl, mesLabel, median, round2 } = require('../util.cjs');

const MIN_MESES = 4;
const MIN_KWH = 500;
const LIMITE_ALTA = 1.5;
const LIMITE_BAIXA = 0.5;
const CAP_FATURA = 0.20;   // estimativa nunca passa de 20% da fatura
const SANIDADE = 5;        // acima de 5x a mediana da própria UC é erro de dado

module.exports = {
  id: 'tarifa',
  nome: 'Variação do custo por kWh da UC',
  categoria: 'economia',
  requer: ['kwh', 'valor'],
  avaliar(ctx) {
    const altos = [];
    const baixos = [];
    const suspeitos = [];

    for (const [uc, lista] of agruparPorUc(ctx.faturas)) {
      const validos = lista.filter(f => f.kwh >= MIN_KWH && Number.isFinite(f.valor) && f.valor > 0);
      if (validos.length < MIN_MESES) continue;

      const mediana = median(validos.map(f => f.valor / f.kwh));
      if (!mediana || mediana <= 0) continue;

      for (const f of validos) {
        const custo = f.valor / f.kwh;
        const razao = custo / mediana;
        if (razao > SANIDADE) { suspeitos.push({ f, custo, mediana, razao }); continue; }
        if (razao >= LIMITE_ALTA) altos.push({ f, custo, mediana, razao, economia: Math.min((custo - mediana) * f.kwh, f.valor * CAP_FATURA) });
        else if (razao <= LIMITE_BAIXA) baixos.push({ f, custo, mediana, razao });
      }
    }

    const saida = [];

    if (altos.length) {
      const porUc = new Map();
      for (const item of altos) {
        const k = item.f.uc || item.f.propriedade;
        if (!porUc.has(k)) porUc.set(k, []);
        porUc.get(k).push(item);
      }

      let total = 0;
      const evidencias = [];
      for (const [, itens] of porUc) {
        const subtotal = itens.reduce((s, it) => s + it.economia, 0);
        total += subtotal;
        const pior = [...itens].sort((a, b) => b.razao - a.razao)[0];
        evidencias.push({
          uc: pior.f.uc,
          propriedade: nomeDoGrupo(itens.map(i => i.f)),
          competencia: mesLabel(pior.f.competencia),
          ocorrencias: itens.length,
          valor: round2(subtotal),
          texto: `${brl(pior.custo)}/kWh vs mediana da própria UC ${brl(pior.mediana)}/kWh (${pior.razao.toFixed(1)}x)`,
        });
      }

      saida.push(achado({
        categoria: 'economia',
        severidade: 'media',
        confianca: 'baixa',
        titulo: 'Meses com custo por kWh fora do padrão da própria UC',
        descricao: `${altos.length} fatura(s) com custo por kWh pelo menos ${LIMITE_ALTA}x acima da mediana histórica da mesma UC. ` +
          'Pode ser demanda, tributo, bandeira, erro de leitura ou mudança de operação. ' +
          'O R$/kWh é um proxy: inclui demanda e encargos, não só energia.',
        valor_estimado: round2(total),
        competencias: [...new Set(altos.map(x => x.f.competencia))].sort(),
        evidencias: evidencias.sort((a, b) => (b.valor || 0) - (a.valor || 0)).slice(0, 12),
        recomendacao: 'Auditar linha a linha as UCs do topo antes de falar em economia. ' +
          'Confirmar com a distribuidora e comparar com o histórico de demanda.',
        requer: ['itens detalhados da fatura para separar energia de demanda'],
      }));
    }

    if (baixos.length) {
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'baixa',
        confianca: 'media',
        titulo: 'Meses com custo por kWh muito abaixo do padrão da UC',
        descricao: `${baixos.length} fatura(s) com custo por kWh abaixo de ${LIMITE_BAIXA}x a mediana da própria UC. ` +
          'Em geral é compensação de geração ou leitura parcial.',
        valor_estimado: null,
        competencias: [...new Set(baixos.map(x => x.f.competencia))].sort(),
        evidencias: baixos.slice(0, 12).map(({ f, custo, mediana }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: `${brl(custo)}/kWh vs mediana ${brl(mediana)}/kWh`,
        })),
        recomendacao: 'Conferir se é UC com geração distribuída e se a compensação foi aplicada corretamente.',
      }));
    }

    if (suspeitos.length) {
      saida.push(achado({
        categoria: 'qualidade',
        severidade: 'baixa',
        confianca: 'alta',
        titulo: 'Custo por kWh implausível (possível erro de dado)',
        descricao: `${suspeitos.length} fatura(s) com custo por kWh mais de ${SANIDADE}x a mediana da própria UC. ` +
          'Antes de diagnosticar, é preciso confirmar consumo e valor — normalmente é rateio, leitura parcial ou PDF de outra competência.',
        valor_estimado: null,
        competencias: [...new Set(suspeitos.map(x => x.f.competencia))].sort(),
        evidencias: suspeitos.slice(0, 12).map(({ f, custo, mediana, razao }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: f.valor,
          texto: `${brl(custo)}/kWh vs mediana ${brl(mediana)}/kWh (${razao.toFixed(1)}x)`,
        })),
        recomendacao: 'Conferir o PDF e o rateio da UC antes de usar esse mês em qualquer cálculo.',
      }));
    }

    return saida;
  },
};
