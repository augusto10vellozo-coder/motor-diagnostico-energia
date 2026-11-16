'use strict';

const regras = [
  require('./encargos.cjs'),
  require('./reativo.cjs'),
  require('./tarifa.cjs'),
  require('./consumo.cjs'),
  require('./solar.cjs'),
  require('./demanda.cjs'),
  require('./integridade.cjs'),
];

module.exports = regras;
