'use strict';

/**
 * Extrator Copel — DANF3E (Documento Auxiliar da NF3E).
 *
 * Estratégia: em vez de confiar na ordem do texto achatado (que embaralha as
 * colunas em algumas faturas), lê os itens de texto com coordenadas x/y e
 * reconstrói a tabela por linha.
 *
 * Cada linha da tabela tem a forma:
 *   [descrição] [unidade] [quantidade] [preço unitário] [valor] [tributos...]
 *
 * A unidade (kWh/kW/UN/kVArh) é a âncora: tudo antes é descrição, os três
 * primeiros números depois são quantidade, preço e valor.
 *
 * Validação: a soma dos valores tem que bater com o total da fatura. Se não
 * bater, o extrator devolve alerta — nunca esconde a divergência.
 */

const num = s => {
  if (s === null || s === undefined) return null;
  const t = String(s).trim().replace(/[^\d,.-]/g, '');
  if (!t) return null;
  const n = Number(t.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const UNIDADE = /^(kWh|kW|kVArh|kVArh-I|UN|kVA|MWh|m3)$/i;
const TOLERANCIA_Y = 2.2;

function detectar(texto) {
  return /DANF3E/i.test(texto) && /Copel\s+Distribui/i.test(texto);
}

function classificar(descricao) {
  const d = descricao.toUpperCase();
  if (/ULTRAPASS/.test(d)) return 'ultrapassagem';
  if (/DEMANDA\s+COMPLEMENTAR/.test(d)) return 'demanda_complementar';
  if (/^DEMANDA/.test(d)) return 'demanda';
  if (/REAT\s*EXCED/.test(d)) return 'reativo';
  if (/INJ/.test(d)) return 'injetada';
  if (/BAND/.test(d)) return 'bandeira';
  if (/MULTA|JUROS|ACRESCIMO|ACRÉSCIMO/.test(d)) return 'encargo';
  if (/ENERGIA|CONSUMO/.test(d)) return 'energia';
  return 'outro';
}

function posto(descricao) {
  const d = descricao.toUpperCase();
  if (/F\s*PONTA|FORA/.test(d)) return 'fora_ponta';
  if (/\bPT\b|\bPONTA\b/.test(d)) return 'ponta';
  return 'unico';
}

/** Lê o PDF com coordenadas. Devolve texto puro + linhas reconstruídas. */
async function lerPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const tarefa = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const doc = await tarefa.promise;
  const linhas = [];
  const textos = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const celulas = tc.items
      .filter(i => typeof i.str === 'string' && i.str.trim())
      .map(i => ({ texto: i.str.trim(), x: i.transform[4], y: i.transform[5] }));

    // agrupa por y (linha visual)
    const ordenadas = [...celulas].sort((a, b) => b.y - a.y || a.x - b.x);
    for (const c of ordenadas) {
      const ultima = linhas[linhas.length - 1];
      if (ultima && Math.abs(ultima.y - c.y) <= TOLERANCIA_Y) ultima.celulas.push(c);
      else linhas.push({ y: c.y, celulas: [c] });
    }
    textos.push(celulas.map(c => c.texto).join(' '));
  }

  await tarefa.destroy();
  for (const l of linhas) l.celulas.sort((a, b) => a.x - b.x);
  return { texto: textos.join('\n'), linhas };
}

/** Constrói os itens a partir das linhas reconstruídas. */
function extrairItens(linhas) {
  const itens = [];

  for (const linha of linhas) {
    const iUnidade = linha.celulas.findIndex(c => UNIDADE.test(c.texto));
    if (iUnidade < 0) continue;

    // a descrição é a célula mais à esquerda antes da unidade
    // (evita ruído como "Segunda Via" que cai na mesma faixa de y)
    const descricao = linha.celulas.slice(0, iUnidade)[0]?.texto?.trim() || '';
    const numeros = linha.celulas.slice(iUnidade + 1).map(c => num(c.texto)).filter(v => v !== null);

    if (!descricao || numeros.length < 2) continue;

    let quantidade;
    let valorUnitario;
    let valor;

    if (numeros.length >= 3) {
      [quantidade, valorUnitario, valor] = numeros;
    } else {
      // linhas de crédito/encargo trazem só quantidade e valor
      quantidade = numeros[0];
      valor = numeros[1];
      valorUnitario = quantidade ? Math.round((valor / quantidade) * 1e6) / 1e6 : null;
    }

    itens.push({
      descricao,
      unidade: linha.celulas[iUnidade].texto,
      quantidade,
      valor_unitario: valorUnitario,
      valor,
      tipo: classificar(descricao),
      posto: posto(descricao),
    });
  }

  return itens;
}

function extrairDeLinhas(linhas, texto) {
  const alertas = [];

  let uc = null;
  let competencia = null;
  let vencimento = null;
  let total = null;

  for (const l of linhas) {
    const t = l.celulas.map(c => c.texto).join(' ');
    if (!uc) {
      const mUc = t.match(/\b0*(\d{12})\b/);
      if (mUc) uc = mUc[1];
    }
    if (!competencia) {
      const m = t.match(/\b(\d{2})\/(\d{4})\s+(\d{2})\/(\d{2})\/(\d{4})\s+R\$\s*([\d.,]+)/);
      if (m) {
        competencia = `${m[2]}-${m[1]}`;
        vencimento = `${m[5]}-${m[4]}-${m[3]}`;
        total = num(m[6]);
      }
    }
  }

  const itens = extrairItens(linhas);
  if (!itens.length) {
    return { distribuidora: 'COPEL/DCELT', uc, competencia, vencimento, total, itens: [], erro: 'tabela de itens não encontrada', alertas };
  }

  const somaItens = Math.round(itens.reduce((s, i) => s + i.valor, 0) * 100) / 100;
  const divergencia = total != null ? Math.round((total - somaItens) * 100) / 100 : null;
  if (divergencia != null && Math.abs(divergencia) > 0.05) {
    alertas.push(`Soma dos itens (${somaItens}) difere do total (${total}) em ${divergencia}.`);
  }

  // resumo de demanda impresso abaixo dos tributos
  const demanda = {};
  for (const l of linhas) {
    const t = l.celulas.map(c => c.texto).join(' ');
    let m;
    if ((m = t.match(/Demanda Todos os Períodos:\s*([\d.,]+)\s*kW/i))) demanda.contratada = num(m[1]);
    if ((m = t.match(/Demanda Fora Ponta\s*([\d.,]+)\s*kW/i))) demanda.foraPonta = num(m[1]);
    if ((m = t.match(/Energia Ponta:\s*([\d.,]+)\s*kWh/i))) demanda.energiaPonta = num(m[1]);
    if ((m = t.match(/Energia Fora Ponta:\s*([\d.,]+)\s*kWh/i))) demanda.energiaForaPonta = num(m[1]);
  }

  const itensDemanda = itens.filter(i => i.tipo === 'demanda' && !/INJETADA|COMPLEMENTAR/i.test(i.descricao));
  const medida = itensDemanda.reduce((s, i) => Math.max(s, i.quantidade || 0), 0);
  if (medida) demanda.medida = medida;

  const complementar = itens.filter(i => i.tipo === 'demanda_complementar');
  if (complementar.length) demanda.complementar = Math.round(complementar.reduce((s, i) => s + i.valor, 0) * 100) / 100;

  const ultrapassagem = itens.filter(i => i.tipo === 'ultrapassagem');
  if (ultrapassagem.length) demanda.ultrapassagem = Math.round(ultrapassagem.reduce((s, i) => s + i.valor, 0) * 100) / 100;

  // consumo: BT usa "ENERGIA ELET CONSUMO"; MT usa as linhas TE (sem USD/TUSD)
  const consumoBt = itens.find(i => /ENERGIA ELET CONSUMO/i.test(i.descricao));
  let kwh = consumoBt ? consumoBt.quantidade : null;
  if (kwh == null) {
    const te = itens.filter(i => i.tipo === 'energia' && /\bTE\b/.test(i.descricao) && !/INJ/.test(i.descricao));
    if (te.length) kwh = te.reduce((s, i) => s + Math.abs(i.quantidade), 0);
  }

  // injetada: TE e TUSD repetem a mesma energia; pega o maior por posto
  const inj = itens.filter(i => i.tipo === 'injetada');
  let injetada = null;
  if (inj.length) {
    const porPosto = new Map();
    for (const i of inj) porPosto.set(i.posto, Math.max(porPosto.get(i.posto) || 0, Math.abs(i.quantidade)));
    injetada = [...porPosto.values()].reduce((s, v) => s + v, 0);
  }

  const reativo = itens.filter(i => i.tipo === 'reativo');
  const reativoKvarh = reativo.length ? reativo.reduce((s, i) => s + Math.abs(i.quantidade), 0) : null;

  return {
    distribuidora: 'COPEL/DCELT',
    uc,
    competencia,
    vencimento,
    total,
    somaItens,
    divergencia,
    kwh,
    injetada,
    reativoKvarh,
    demanda,
    itens,
    alertas,
  };
}

/** Interface principal: recebe o buffer do PDF. */
async function extrairDoPdf(buffer) {
  const { texto, linhas } = await lerPdf(buffer);
  if (!detectar(texto)) {
    return { distribuidora: null, itens: [], erro: 'documento não é DANF3E da Copel' };
  }
  return extrairDeLinhas(linhas, texto);
}

module.exports = {
  id: 'copel',
  nome: 'Copel (DANF3E)',
  detectar,
  lerPdf,
  extrairDoPdf,
  extrairDeLinhas,
  classificar,
  posto,
  num,
};
