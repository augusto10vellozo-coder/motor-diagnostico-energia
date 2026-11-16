'use strict';

const { ucKey, norm } = require('./util.cjs');

/**
 * Contrato de um achado. Todo achado precisa ser explicável:
 * de onde veio, quanto vale, qual a confiança e o que fazer.
 */
function achado({
  categoria = 'informativo',   // economia | risco | qualidade | informativo
  severidade = 'info',         // alta | media | baixa | info
  confianca = 'media',         // alta | media | baixa
  titulo,
  descricao = '',
  valor_estimado = null,
  uc = null,
  propriedade = null,
  competencias = [],
  evidencias = [],
  recomendacao = '',
  requer = [],
}) {
  return {
    categoria,
    severidade,
    confianca,
    titulo,
    descricao,
    valor_estimado: Number.isFinite(valor_estimado) ? Math.round(valor_estimado * 100) / 100 : null,
    escopo: { uc: uc || null, propriedade: propriedade || null, competencias },
    evidencias,
    recomendacao,
    requer,
  };
}

/** Agrupa faturas por UC. Sem UC, usa a propriedade — nunca junta tudo num balde só. */
function agruparPorUc(faturas) {
  const mapa = new Map();
  for (const f of faturas) {
    const k = f.uc && /\d/.test(f.uc)
      ? ucKey(f.uc)
      : (f.propriedade ? `p:${norm(f.propriedade)}` : `id:${f.id}`);
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k).push(f);
  }
  return mapa;
}

function nomeDoGrupo(lista) {
  const contagem = new Map();
  for (const f of lista) {
    if (!f.propriedade) continue;
    contagem.set(f.propriedade, (contagem.get(f.propriedade) || 0) + 1);
  }
  return [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '';
}

module.exports = { achado, agruparPorUc, nomeDoGrupo };
