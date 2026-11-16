'use strict';

/**
 * Encargos acessórios: multa por atraso, juros e bandeiras tarifárias.
 *
 * Quando a fatura tem itens extraídos, usa o VALOR EXATO da linha (confiança
 * alta). Quando só existe o texto do PDF, cai na estimativa de 2% para multa
 * (confiança baixa) — e diz isso no relatório.
 */

const { achado } = require('../finding.cjs');
const { brl, mesLabel, round2 } = require('../util.cjs');

const TIPOS = [
  {
    chave: 'multa por atraso',
    re: /MULTA/i,
    titulo: 'Multa por atraso de pagamento',
    categoria: 'risco',
    severidade: 'alta',
    estimar: f => (f.valor ? f.valor * 0.02 : null),
    descricao: 'Faturas pagas após o vencimento geraram multa. É custo evitável com controle de vencimentos.',
    recomendacao: 'Centralizar vencimentos, antecipar pagamento em 2 dias úteis e ativar alerta D-5.',
  },
  {
    chave: 'juros/acréscimo',
    re: /JUROS|ACRESCIMO|ACRÉSCIMO/i,
    titulo: 'Juros e acréscimo moratório',
    categoria: 'risco',
    severidade: 'alta',
    estimar: () => null,
    descricao: 'Juros cobrados por pagamento em atraso. Costumam acompanhar a multa e crescem com o tempo.',
    recomendacao: 'Mesma ação da multa: controle de vencimento e conciliação semanal.',
  },
  {
    chave: 'bandeira amarela',
    re: /BAND.*AMARELA/i,
    titulo: 'Bandeira tarifária amarela',
    categoria: 'informativo',
    severidade: 'info',
    estimar: () => null,
    descricao: 'Acréscimo legítimo por acionamento de bandeira. Não é erro de cobrança.',
    recomendacao: 'Monitorar; o único caminho de redução é consumo ou geração própria.',
  },
  {
    chave: 'bandeira vermelha',
    re: /BAND.*VERMELHA/i,
    titulo: 'Bandeira tarifária vermelha',
    categoria: 'informativo',
    severidade: 'info',
    estimar: () => null,
    descricao: 'Acréscimo legítimo por acionamento de bandeira vermelha.',
    recomendacao: 'Monitorar; priorizar redução de consumo nos meses de bandeira alta.',
  },
];

const temMotivo = (f, chave) => f.motivos.some(m => m.toLowerCase().includes(chave));
const temItem = (f, re) => (f.itens || []).some(i => re.test(i.descricao));

module.exports = {
  id: 'encargos',
  nome: 'Encargos e bandeiras',
  categoria: 'risco',
  requer: [],
  avaliar(ctx) {
    const saida = [];

    for (const tipo of TIPOS) {
      const afetadas = ctx.faturas.filter(f => temMotivo(f, tipo.chave) || temItem(f, tipo.re));
      if (!afetadas.length) continue;

      // valor exato: soma das linhas extraídas
      const itens = [];
      for (const f of afetadas) {
        for (const item of (f.itens || [])) {
          if (!tipo.re.test(item.descricao)) continue;
          if (!Number.isFinite(item.valor)) continue;
          itens.push({ f, item });
        }
      }

      const exato = itens.length ? round2(itens.reduce((s, x) => s + x.item.valor, 0)) : null;
      const estimado = exato == null && tipo.estimar
        ? round2(afetadas.reduce((s, f) => s + (tipo.estimar(f) || 0), 0))
        : null;
      const valor = tipo.categoria === 'informativo' ? null : (exato ?? (estimado > 0 ? estimado : null));
      const confianca = exato != null ? 'alta' : (estimado > 0 ? 'baixa' : 'alta');
      const meses = [...new Set(afetadas.map(f => f.competencia))].sort();

      const detalheValor = tipo.categoria === 'informativo'
        ? ''
        : (exato != null
          ? `Valor exato das linhas da fatura: ${brl(exato)}.`
          : (estimado > 0 ? `Valor estimado em 2% da fatura (sem item extraído): ${brl(estimado)}.` : ''));

      saida.push(achado({
        categoria: tipo.categoria,
        severidade: tipo.severidade,
        confianca,
        titulo: tipo.titulo,
        descricao: `${tipo.descricao} ${afetadas.length} ocorrência(s) em ${meses.length} competência(s). ${detalheValor}`.trim(),
        valor_estimado: valor,
        competencias: meses,
        evidencias: (itens.length ? itens : afetadas.map(f => ({ f, item: null }))).slice(0, 12).map(({ f, item }) => ({
          uc: f.uc,
          propriedade: f.propriedade,
          competencia: mesLabel(f.competencia),
          valor: item ? item.valor : f.valor,
          texto: item
            ? `${item.descricao} · ${brl(item.valor)}`
            : (f.valor != null ? brl(f.valor) : '—'),
        })),
        recomendacao: tipo.recomendacao,
        requer: exato == null && tipo.estimar && !estimado ? ['valor da linha no PDF'] : [],
      }));
    }

    return saida;
  },
};
