# Tarefas — Motor de Diagnóstico de Energia

## Feito (v0.2)

- [x] Pacote standalone, sem caminho ou cliente embutido.
- [x] Modelo canônico + adaptadores: `dados-cubi.json`, array JSON e CSV.
- [x] Enriquecimento por base detalhada (`--faturas-geral`) para energia injetada.
- [x] 7 regras: encargos, reativo, tarifa, consumo, solar, demanda, integridade.
- [x] Cobertura explícita: regra sem dado aparece como `pulada`, nunca inventa achado.
- [x] Três caixas de valor: confirmada (alta), potencial (média), a auditar (baixa).
- [x] Relatório JSON, Markdown e HTML único (offline, imprime).
- [x] Teste de fumaça em `test/run.cjs`.
- [x] **Extrator Copel DANF3E por coordenadas x/y**, com validação contra o total.
- [x] **Regra de demanda ativa**: ultrapassagem, demanda complementar e demanda superdimensionada.
- [x] Encargos usam o valor exato da linha quando o item foi extraído (não mais 2%).
- [x] Fatura com extração não reconciliada é marcada `confiavel: false` e sai do diagnóstico de demanda.
- [x] Rodado na base real: 761 faturas/223 UCs (painel) e 30 PDFs Copel nativos (29 reconciliados).

## Próximo (ordem sugerida)

1. **OCR das 89 faturas digitalizadas da Copel** — é o maior ganho de cobertura (30 → 119 faturas).
2. **Créditos de página separada** — `SALDO DE CREDITOS` e `DEV.CORR. MONETARIA` (caso Saudade) para fechar a reconciliação.
3. **Extratores Celesc e Equatorial** — mesma interface, parser próprio.
4. **Enquadramento tarifário** — comparar modalidade com perfil de consumo.
5. **Configuração por cliente** — `clientes/<slug>.json` com tarifa de referência, apelidos de UC e regras ativas.
6. **Anonimizador** — base de demonstração sem nome de propriedade, UC ou nota.
7. **Integração com o painel** — o painel consome `diagnostico.json` e mostra a aba "Diagnóstico".

## Decisões tomadas

- **R$/kWh é comparado com a própria UC**, não com pares. Comparar UCs de portes diferentes gerou R$ 2,5 mi de falso positivo na primeira calibração.
- **Estimativa de consumo usa tarifa de referência configurável** (`--tarifa-kwh`, padrão R$ 0,55), não o R$/kWh da fatura — que inclui demanda e distorce.
- **Nenhuma economia é "confirmada" sem valor de linha.** Reativo e juros sem item ficam sem número até o extrator existir.
- **Duplicidade exige mesmo valor + (mesma nota ou mesmo consumo)**, e ignora UC vazia e valor zero.
- **Extração por coordenadas**, não por ordem de texto: o texto achatado embaralha colunas em parte das faturas.
- **Demanda complementar entra como "a auditar"**, não como economia: em GDI pode ser legítima e só a distribuidora confirma.
- **Fatura não reconciliada não gera diagnóstico de demanda.** Melhor não diagnosticar do que diagnosticar errado.
