'use strict';

/**
 * Relatórios: JSON (integração), Markdown (leitura rápida) e HTML único
 * (o que se manda para o cliente, abre offline e imprime).
 */

const { brl, pct, mesLabel } = require('./util.cjs');

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const CATEGORIA_LABEL = {
  economia: 'Economia',
  risco: 'Risco',
  qualidade: 'Qualidade do dado',
  informativo: 'Informativo',
};

const SEVERIDADE_LABEL = { alta: 'Alta', media: 'Média', baixa: 'Baixa', info: 'Info' };

const CONFIANCA_LABEL = { alta: 'alta', media: 'média', baixa: 'baixa' };

function resumoMarkdown(result) {
  const { meta, resumo, cobertura } = result;
  const periodo = meta.periodo
    ? `${mesLabel(meta.periodo.de)} a ${mesLabel(meta.periodo.ate)} (${meta.periodo.competencias} competências)`
    : '—';

  const linhas = [];
  linhas.push(`# Diagnóstico de faturas de energia — ${meta.cliente}`);
  linhas.push('');
  linhas.push(`**Período:** ${periodo}  `);
  linhas.push(`**Faturas analisadas:** ${meta.faturas} · **UCs:** ${meta.ucs} · **Distribuidoras:** ${meta.distribuidoras.join(', ') || '—'}  `);
  linhas.push(`**Gerado em:** ${new Date(meta.geradoEm).toLocaleString('pt-BR')}`);
  linhas.push('');
  linhas.push('## Resumo');
  linhas.push('');
  linhas.push('| Indicador | Valor |');
  linhas.push('|---|---|');
  linhas.push(`| Achados | ${resumo.achados} |`);
  linhas.push(`| Economia confirmada (confiança alta) | ${brl(resumo.economia_confirmada)} |`);
  linhas.push(`| Economia potencial (confiança média) | ${brl(resumo.economia_potencial)} |`);
  linhas.push(`| A auditar (confiança baixa) | ${brl(resumo.para_auditar)} |`);
  linhas.push(`| Economia total estimada | ${brl(resumo.economia_total_estimada)} |`);
  linhas.push(`| Risco identificado | ${brl(resumo.risco_identificado)} |`);
  linhas.push(`| Achados com valor | ${resumo.achados_com_valor} |`);
  linhas.push(`| Achados sem valor (requerem dado extra) | ${resumo.achados_sem_valor} |`);
  linhas.push('');
  linhas.push('## Achados');
  linhas.push('');

  for (const a of result.achados) {
    linhas.push(`### ${a.titulo}`);
    linhas.push('');
    linhas.push(`- **Categoria:** ${CATEGORIA_LABEL[a.categoria] || a.categoria} · **Severidade:** ${SEVERIDADE_LABEL[a.severidade] || a.severidade} · **Confiança:** ${CONFIANCA_LABEL[a.confianca] || a.confianca}`);
    if (Number.isFinite(a.valor_estimado)) linhas.push(`- **Valor estimado:** ${brl(a.valor_estimado)}`);
    if (a.escopo.competencias?.length) linhas.push(`- **Competências:** ${a.escopo.competencias.map(mesLabel).join(', ')}`);
    linhas.push(`- **O que é:** ${a.descricao}`);
    linhas.push(`- **O que fazer:** ${a.recomendacao}`);
    if (a.requer?.length) linhas.push(`- **Para fechar o número:** ${a.requer.join('; ')}`);
    if (a.evidencias?.length) {
      linhas.push('- **Evidências:**');
      for (const e of a.evidencias.slice(0, 8)) {
        const alvo = [e.propriedade || e.uc, e.competencia].filter(Boolean).join(' · ');
        linhas.push(`  - ${alvo ? alvo + ' — ' : ''}${e.texto || (Number.isFinite(e.valor) ? brl(e.valor) : '')}`);
      }
    }
    linhas.push('');
  }

  linhas.push('## Cobertura das regras');
  linhas.push('');
  linhas.push('| Regra | Status | Achados | Observação |');
  linhas.push('|---|---|---|---|');
  for (const c of cobertura) {
    linhas.push(`| ${c.nome} | ${c.status} | ${c.achados} | ${c.motivo || ''} |`);
  }
  linhas.push('');
  linhas.push('> Valores estimados são indicativos. Economia só deve ser prometida após auditoria da fatura linha a linha.');
  linhas.push('');

  return linhas.join('\n');
}

function html(result) {
  const { meta, resumo, cobertura, achados } = result;
  const periodo = meta.periodo
    ? `${mesLabel(meta.periodo.de)} a ${mesLabel(meta.periodo.ate)}`
    : '—';

  const cardAchado = a => `
    <article class="finding sev-${esc(a.severidade)}">
      <header>
        <div class="tags">
          <span class="tag cat-${esc(a.categoria)}">${esc(CATEGORIA_LABEL[a.categoria] || a.categoria)}</span>
          <span class="tag">Severidade ${esc(SEVERIDADE_LABEL[a.severidade] || a.severidade)}</span>
          <span class="tag">Confiança ${esc(CONFIANCA_LABEL[a.confianca] || a.confianca)}</span>
        </div>
        ${Number.isFinite(a.valor_estimado) ? `<strong class="value">${esc(brl(a.valor_estimado))}</strong>` : '<span class="value muted">sem valor estimado</span>'}
      </header>
      <h3>${esc(a.titulo)}</h3>
      <p>${esc(a.descricao)}</p>
      <p class="action"><strong>O que fazer:</strong> ${esc(a.recomendacao)}</p>
      ${a.requer?.length ? `<p class="req"><strong>Para fechar o número:</strong> ${esc(a.requer.join('; '))}</p>` : ''}
      ${a.evidencias?.length ? `<details><summary>Evidências (${a.evidencias.length})</summary><ul>${a.evidencias.slice(0, 12).map(e => `<li>${esc([e.propriedade || e.uc, e.competencia].filter(Boolean).join(' · '))}${e.propriedade || e.uc ? ' — ' : ''}${esc(e.texto || (Number.isFinite(e.valor) ? brl(e.valor) : ''))}</li>`).join('')}</ul></details>` : ''}
    </article>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Diagnóstico de faturas de energia — ${esc(meta.cliente)}</title>
<style>
  :root{
    --bg:#f6f7f9; --card:#fff; --ink:#16181d; --muted:#6b7280; --line:#e5e7eb;
    --brand:#0f766e; --brand-soft:#ccfbf1;
    --alta:#b91c1c; --alta-bg:#fef2f2; --media:#b45309; --media-bg:#fffbeb;
    --baixa:#1d4ed8; --baixa-bg:#eff6ff; --info:#475569; --info-bg:#f1f5f9;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1040px;margin:0 auto;padding:32px 20px 64px}
  header.top{background:linear-gradient(135deg,#0f766e,#115e59);color:#fff;border-radius:16px;padding:28px 30px;margin-bottom:24px}
  header.top h1{margin:0 0 6px;font-size:24px;letter-spacing:-.02em}
  header.top p{margin:0;opacity:.9;font-size:14px}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin:0 0 28px}
  .kpi{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  .kpi span{display:block;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
  .kpi strong{display:block;font-size:22px;margin-top:6px;letter-spacing:-.02em}
  h2{font-size:18px;margin:32px 0 12px;letter-spacing:-.01em}
  .finding{background:var(--card);border:1px solid var(--line);border-left:4px solid var(--info);border-radius:12px;padding:18px 20px;margin-bottom:14px}
  .finding.sev-alta{border-left-color:var(--alta)}
  .finding.sev-media{border-left-color:var(--media)}
  .finding.sev-baixa{border-left-color:var(--baixa)}
  .finding header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
  .finding h3{margin:10px 0 6px;font-size:16px}
  .finding p{margin:6px 0;color:#374151}
  .finding .action{color:#111827}
  .finding .req{color:var(--muted);font-size:13px}
  .tags{display:flex;gap:6px;flex-wrap:wrap}
  .tag{background:var(--info-bg);color:var(--info);border-radius:999px;padding:3px 10px;font-size:11px;font-weight:600;letter-spacing:.02em}
  .tag.cat-economia{background:var(--brand-soft);color:#0f766e}
  .tag.cat-risco{background:var(--alta-bg);color:var(--alta)}
  .value{font-size:18px;white-space:nowrap}
  .value.muted{font-size:13px;font-weight:500;color:var(--muted)}
  details{margin-top:10px}
  summary{cursor:pointer;color:var(--brand);font-size:13px;font-weight:600}
  ul{margin:8px 0 0;padding-left:20px;color:#374151;font-size:13px}
  table{width:100%;border-collapse:collapse;background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;font-size:13px}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line)}
  th{background:#f9fafb;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  tr:last-child td{border-bottom:none}
  .status-avaliada{color:#0f766e;font-weight:600}
  .status-pulada{color:var(--muted)}
  .status-erro{color:var(--alta);font-weight:600}
  footer{margin-top:32px;color:var(--muted);font-size:12px;border-top:1px solid var(--line);padding-top:16px}
  @media print{body{background:#fff}.wrap{max-width:none;padding:0}header.top{background:#0f766e !important;-webkit-print-color-adjust:exact;print-color-adjust:exact}.finding{break-inside:avoid}}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <h1>Diagnóstico de faturas de energia</h1>
    <p><strong>${esc(meta.cliente)}</strong> · ${esc(periodo)} · ${meta.faturas} faturas · ${meta.ucs} UCs</p>
  </header>

  <section class="kpis">
    <div class="kpi"><span>Achados</span><strong>${resumo.achados}</strong></div>
    <div class="kpi"><span>Economia confirmada</span><strong>${esc(brl(resumo.economia_confirmada))}</strong></div>
    <div class="kpi"><span>Potencial (média)</span><strong>${esc(brl(resumo.economia_potencial))}</strong></div>
    <div class="kpi"><span>A auditar (baixa)</span><strong>${esc(brl(resumo.para_auditar))}</strong></div>
    <div class="kpi"><span>Risco identificado</span><strong>${esc(brl(resumo.risco_identificado))}</strong></div>
    <div class="kpi"><span>Cobertura de consumo</span><strong>${esc(pct(meta.coberturaDados.comKwhPct, 0))}</strong></div>
  </section>

  <h2>Achados</h2>
  ${achados.length ? achados.map(cardAchado).join('\n') : '<p>Nenhum achado com as regras atuais.</p>'}

  <h2>Cobertura das regras</h2>
  <table>
    <thead><tr><th>Regra</th><th>Status</th><th>Achados</th><th>Observação</th></tr></thead>
    <tbody>
      ${cobertura.map(c => `<tr><td>${esc(c.nome)}</td><td class="status-${esc(c.status)}">${esc(c.status)}</td><td>${c.achados}</td><td>${esc(c.motivo || '')}</td></tr>`).join('')}
    </tbody>
  </table>

  <footer>
    <p>Gerado em ${esc(new Date(meta.geradoEm).toLocaleString('pt-BR'))}. Valores estimados são indicativos e servem para priorizar a auditoria.</p>
    <p>Economia só deve ser prometida após conferência da fatura linha a linha e validação com a distribuidora.</p>
  </footer>
</div>
</body>
</html>`;
}

function toJson(result) {
  return JSON.stringify(result, null, 2);
}

module.exports = { toJson, toMarkdown: resumoMarkdown, toHtml: html };
