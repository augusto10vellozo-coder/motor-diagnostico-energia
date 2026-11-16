'use strict';

/** Utilidades puras — sem dependência de projeto, caminho ou cliente. */

const digits = s => String(s ?? '').replace(/\D/g, '');
const ucKey = s => digits(s).replace(/^0+/, '');

const norm = s => String(s ?? '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

function median(values) {
  const a = values.filter(v => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function brl(n) {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pct(n, casas = 1) {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: casas })}%`;
}

/** Aceita dd/mm/aaaa ou aaaa-mm-dd e devolve aaaa-mm-dd. */
function toISO(s) {
  if (!s) return null;
  const br = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

const competenciaDe = iso => (iso ? iso.slice(0, 7) : null);

function addMonths(mes, n) {
  const [y, m] = String(mes).split('-').map(Number);
  if (!y || !m) return null;
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

function diffMonths(a, b) {
  const [ya, ma] = String(a).split('-').map(Number);
  const [yb, mb] = String(b).split('-').map(Number);
  return (ya - yb) * 12 + (ma - mb);
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
function mesLabel(mes) {
  const [y, m] = String(mes || '').split('-').map(Number);
  if (!y || !m) return String(mes || '—');
  return `${MESES[m - 1]}/${y}`;
}

module.exports = {
  digits, ucKey, norm, round2, median, brl, pct,
  toISO, competenciaDe, addMonths, diffMonths, mesLabel,
};
