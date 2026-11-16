'use strict';

/** Teste de fumaça: roda o motor num fixture e confere os achados esperados. */

const assert = require('assert');
const { run } = require('../src/engine.cjs');
const { canonico } = require('../src/normalize.cjs');

const hoje = '2026-11-05';

function fatura(p) {
  return canonico({
    mes: p.mes,
    d: p.d || 'COPEL/DCELT',
    p: p.p,
    uc: p.uc,
    val: p.val,
    kwh: p.kwh,
    v: p.v,
    s: p.s || 'ENTREGUE',
    motivos: p.motivos || [],
    injetada: p.injetada,
    nota: p.nota,
  }, 0, { cliente: 'Teste' });
}

const faturas = [
  // UC A: consumo normal, depois um pico de 2,5x
  fatura({ mes: '2026-07', p: 'UC A', uc: '111', val: 700, kwh: 1000, v: '10/08/2026' }),
  fatura({ mes: '2026-08', p: 'UC A', uc: '111', val: 770, kwh: 1100, v: '10/09/2026' }),
  fatura({ mes: '2026-09', p: 'UC A', uc: '111', val: 1750, kwh: 2500, v: '10/10/2026', motivos: ['reativo excedente'] }),
  // UC B: estável, com multa
  fatura({ mes: '2026-07', p: 'UC B', uc: '222', val: 250, kwh: 500, v: '10/08/2026' }),
  fatura({ mes: '2026-08', p: 'UC B', uc: '222', val: 260, kwh: 520, v: '10/09/2026', motivos: ['multa por atraso'] }),
  fatura({ mes: '2026-09', p: 'UC B', uc: '222', val: 240, kwh: 480, v: '10/10/2026' }),
  // duplicidade: mesma UC, mesma competência, mesmo valor
  fatura({ mes: '2026-09', p: 'UC B', uc: '222', val: 240, kwh: 480, v: '10/10/2026', nota: '999' }),
  // pendente de entrega, vencida
  fatura({ mes: '2026-10', p: 'UC C', uc: '333', val: 300, kwh: 600, v: '10/10/2026', s: 'ESPERADA' }),
];

const result = run(faturas, { cliente: 'Teste', hoje });

const porRegra = id => result.achados.filter(a => a.regra === id);

assert.strictEqual(result.meta.faturas, 8, 'deve ler 8 faturas');
assert.strictEqual(result.meta.ucs, 3, 'deve identificar 3 UCs');

assert(porRegra('reativo').length >= 1, 'deve achar reativo excedente');
assert(porRegra('consumo').length >= 1, 'deve achar consumo fora do padrão');
assert(porRegra('encargos').length >= 1, 'deve achar multa nos encargos');
assert(porRegra('integridade').length >= 2, 'deve achar duplicidade e pendência');

const dup = porRegra('integridade').find(a => /duplicada/i.test(a.titulo));
assert(dup, 'deve achar fatura duplicada');
assert(dup.valor_estimado === 240, 'duplicidade deve valer 240');

const pendente = porRegra('integridade').find(a => /não recebidas/i.test(a.titulo));
assert(pendente, 'deve achar fatura não recebida');
assert.strictEqual(pendente.severidade, 'alta', 'pendência vencida é severidade alta');

const cobertura = Object.fromEntries(result.cobertura.map(c => [c.id, c]));
assert.strictEqual(cobertura.demanda.status, 'pulada', 'demanda deve ser pulada sem itens');
assert.strictEqual(cobertura.consumo.status, 'avaliada', 'consumo deve rodar');

assert(Number.isFinite(result.resumo.economia_potencial), 'resumo deve ter economia potencial');

console.log('OK — %d achados, economia potencial %s', result.resumo.achados, result.resumo.economia_potencial);
