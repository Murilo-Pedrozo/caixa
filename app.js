'use strict';

/* =========================================================================
   MEU CAIXA — controle financeiro pessoal
   Lançamentos: entrada | gasto | invest (guardei / investi)
   Sobrou no mês = entrou − gastos − guardado
   Dados: conta do Claude (privados, db em data/users/<id>/); fora do Claude, neste navegador.
   ========================================================================= */

const MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const GASTO_METHODS = { credito: 'Crédito', debito: 'Débito', pix: 'Pix', dinheiro: 'Dinheiro', vale: 'Vale', boleto: 'Boleto' };
const ENTRADA_METHODS = { conta: 'Na conta / Pix', dinheiro: 'Dinheiro', vale: 'Vale' };

const DEFAULT_CATS = {
  gasto: ['Mercado', 'Alimentação / lanche', 'Gasolina / transporte', 'Faculdade', 'Seguro', 'Contas da casa', 'Celular / internet', 'Streaming', 'Farmácia / saúde', 'Cabelo / beleza', 'Lojas / roupas', 'Lazer / restaurante', 'Academia', 'Presentes', 'Igreja / doações', 'Carro', 'Outros'],
  entrada: ['Salário', 'Bico / dinheiro por fora', 'Vale-alimentação', 'Rendimentos', 'Presente / ajuda', 'Venda', 'Outros'],
  invest: ['Reserva / poupança', 'Renda fixa (CDB, LCI)', 'Tesouro Direto', 'Fundos', 'Ações', 'Internacional', 'Cripto', 'Outros']
};
const INV_KINDS = ['Conta / reserva', 'Renda fixa', 'Fundos', 'Ações', 'Tesouro Direto', 'Internacional', 'Cripto', 'FGTS', 'Outro'];
const TYPE_LABEL = { gasto: 'Gasto', entrada: 'Entrada', invest: 'Guardei / investi', transf: 'Saque / depósito' };
// Onde o dinheiro fica: conta (banco, Pix, débito, boleto, fatura), dinheiro em espécie e vale
const WALLETS = { conta: 'Conta', dinheiro: 'Dinheiro', vale: 'Vale' };
const TRANSF_DIRS = {
  saque: { label: 'Saque', from: 'conta', to: 'dinheiro', hint: 'Tirei da conta e fiquei com o dinheiro na mão' },
  deposito: { label: 'Depósito', from: 'dinheiro', to: 'conta', hint: 'Coloquei dinheiro em espécie na conta' }
};
const VIEWS = ['resumo', 'lancar', 'extrato', 'patrimonio', 'backup'];

const S = {
  tx: [], inv: [], extraCats: { gasto: [], entrada: [], invest: [] },
  month: '', view: 'resumo', mode: 'loading', ready: false, demo: false,
  formType: 'gasto', gastoMethod: 'credito', entradaMethod: 'conta', transfDir: 'saque',
  editing: null, invEditing: null, pendingDel: null, pendingInvDel: null,
  filter: { type: 'all', method: 'all', q: '', period: 'month', from: '', to: '', cat: 'all', min: '', max: '', sort: 'date-desc' },
  // Cartão: dia de fechamento, dia de vencimento e se o gasto conta no mês da fatura
  card: { closing: 27, due: 5, byInvoice: true, updatedAt: '' },
  fixed: [],                                       // gastos fixos (salvos)
  // Saldo inicial: quanto tinha em cada lugar no começo do mês "start"
  wallets: { start: '', conta: 0, dinheiro: 0, vale: 0, updatedAt: '' },
  sim: { ym: '', salary: null, extra: 0, off: new Set() },   // simulação (temporária)
  fc: null
};
let store = null;

// ------------------------------------------------------------------ utilidades
const $ = (id) => document.getElementById(id);
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brl = (n) => BRL.format(Number.isFinite(n) ? n : 0);
const pct = (n) => (Number.isFinite(n) ? n * 100 : 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + '%';
const round2 = (n) => Math.round(n * 100) / 100;
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** Aceita "1.234,56", "1234.56", "R$ 50" */
function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  let s = String(v ?? '').trim().replace(/R\$|\s/g, '');
  if (!s) return 0;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');   // "2.300" = dois mil e trezentos
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
const toInput = (n) => (n ? n.toFixed(2).replace('.', ',') : '');
const moneyTxt = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function compact(n) {
  const a = Math.abs(n);
  if (a >= 1000) return 'R$ ' + (n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil';
  return 'R$ ' + Math.round(n).toLocaleString('pt-BR');
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthTitle(ym) { const [y, m] = ym.split('-').map(Number); return `${MESES[m - 1]} ${y}`; }
function dayTitle(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long' });
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} · ${wd}`;
}
function toast(msg, kind) {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 2600);
}
function showNotice(msg) { const n = $('notice'); n.textContent = msg; n.hidden = !msg; }

// ------------------------------------------------------------------ armazenamento
const LS_KEY = 'meucaixa_v1';

function normalizeCats(c) {
  const out = { gasto: [], entrada: [], invest: [] };
  if (c && typeof c === 'object') {
    for (const k of Object.keys(out)) {
      if (Array.isArray(c[k])) out[k] = c[k].filter((x) => typeof x === 'string' && x.trim()).slice(0, 60);
    }
  }
  return out;
}

/*
  Tudo fica guardado neste aparelho (localStorage).
  Cada registro tem um id único e "updatedAt" (quando foi alterado pela última vez).
  Excluir não apaga o registro: ele vira {id, deleted: true, updatedAt}.
  Assim, ao juntar backups de aparelhos diferentes, vale sempre a versão mais recente
  de cada registro, e algo excluído num aparelho não "volta" ao juntar com outro.
*/
const LS_LAST = 'meucaixa_ultimo_backup';
const LS_DEVICE = 'meucaixa_aparelho';
const nowISO = () => new Date().toISOString();

function loadLocal() {
  let data = null;
  try { data = JSON.parse(localStorage.getItem(LS_KEY)); } catch (e) { data = null; }
  data = data || {};
  S.tx = Array.isArray(data.tx) ? data.tx.filter((x) => x && typeof x.id === 'string') : [];
  S.inv = Array.isArray(data.inv) ? data.inv.filter((x) => x && typeof x.id === 'string') : [];
  S.extraCats = normalizeCats(data.extraCats);
  S.card = normalizeCard(data.card);
  S.wallets = normalizeWallets(data.wallets);
  S.fixed = Array.isArray(data.fixed) ? data.fixed.filter((x) => x && typeof x.id === 'string') : [];
}

function normalizeWallets(w) {
  w = w && typeof w === 'object' ? w : {};
  return {
    start: /^\d{4}-\d{2}$/.test(String(w.start || '')) ? w.start : '',
    conta: round2(parseNum(w.conta)), dinheiro: round2(parseNum(w.dinheiro)), vale: round2(parseNum(w.vale)),
    updatedAt: String(w.updatedAt || '')
  };
}

function normalizeCard(c) {
  const day = (v, def) => { const n = Math.round(parseNum(v)); return n >= 1 && n <= 31 ? n : def; };
  c = c && typeof c === 'object' ? c : {};
  return { closing: day(c.closing, 27), due: day(c.due, 5), byInvoice: c.byInvoice !== false, updatedAt: String(c.updatedAt || '') };
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ tx: S.tx, inv: S.inv, extraCats: S.extraCats, card: S.card, fixed: S.fixed, wallets: S.wallets }));
    return true;
  } catch (e) {
    toast('Não foi possível salvar neste aparelho. Baixe um backup agora.', 'err');
    return false;
  }
}

function upsert(arr, item) {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i >= 0) arr[i] = item; else arr.push(item);
}

function localStore() {
  loadLocal();
  return {
    async putTx(t) { upsert(S.tx, { ...t, updatedAt: nowISO() }); persist(); renderAll(); },
    async delTx(id) { upsert(S.tx, { id, deleted: true, updatedAt: nowISO() }); persist(); renderAll(); },
    async putInv(p) { upsert(S.inv, { ...p, updatedAt: nowISO() }); persist(); renderAll(); },
    async delInv(id) { upsert(S.inv, { id, deleted: true, updatedAt: nowISO() }); persist(); renderAll(); },
    async putCats() { persist(); }
  };
}

/** Junta uma lista recebida com a local: por id, fica a versão com updatedAt mais recente */
function mergeList(local, incoming) {
  const map = new Map(local.map((x) => [x.id, x]));
  const r = { added: 0, updated: 0, removed: 0, same: 0 };
  for (const item of incoming) {
    if (!item || typeof item.id !== 'string' || !item.id) continue;
    const cur = map.get(item.id);
    if (!cur) {
      map.set(item.id, item);
      if (!item.deleted) r.added++;
    } else if (String(item.updatedAt || '') > String(cur.updatedAt || '')) {
      map.set(item.id, item);
      if (item.deleted && !cur.deleted) r.removed++; else r.updated++;
    } else {
      r.same++;
    }
  }
  return { list: [...map.values()], ...r };
}

// ------------------------------------------------------------------ dados de exemplo (não são salvos)
function demoData() {
  const tx = [];
  const inv = [];
  const cur = todayISO().slice(0, 7);
  const w = (i, a) => 1 + 0.12 * Math.sin(i * 1.7 + a);
  for (let i = 0; i < 6; i++) {
    const ym = addMonths(cur, i - 5);
    const d = (day) => `${ym}-${String(day).padStart(2, '0')}`;
    const add = (type, amount, day, cat, desc, method) => tx.push({ id: `demo${i}-${tx.length}`, type, amount: round2(amount), date: d(day), cat, desc, method });
    add('entrada', 2400, 5, 'Salário', 'Empresa', 'conta');
    add('entrada', 450 * w(i, 1), 18, 'Bico / dinheiro por fora', 'Freela de fim de semana', 'dinheiro');
    add('entrada', 680, 5, 'Vale-alimentação', '', 'vale');
    add('gasto', 610 * w(i, 2), 6, 'Mercado', 'Compra do mês', 'vale');
    add('gasto', 600, 10, 'Faculdade', 'Mensalidade', 'boleto');
    add('gasto', 280 * w(i, 3), 12, 'Gasolina / transporte', '', 'credito');
    add('gasto', 40, 8, 'Streaming', '', 'credito');
    add('gasto', 50, 15, 'Celular / internet', 'Plano', 'pix');
    add('gasto', 90 * w(i, 4), 20, 'Farmácia / saúde', '', 'debito');
    add('gasto', 170 * w(i, 5) + (i === 3 ? 520 : 0), 22, 'Lazer / restaurante', i === 3 ? 'Aniversário' : '', 'pix');
    add('gasto', 120 * w(i, 6), 25, 'Lojas / roupas', '', 'credito');
    add('invest', i === 3 ? 100 : 450, 6, 'Renda fixa (CDB, LCI)', 'Aporte do mês', '');
    add('gasto', 35 * w(i, 7), 14, 'Alimentação / lanche', 'Pastel da feira', 'dinheiro');
    add('gasto', 60 * w(i, 8), 23, 'Gasolina / transporte', 'Uber', 'dinheiro');
    if (i % 2 === 0) tx.push({ id: `demo${i}-s`, type: 'transf', amount: 200, date: d(9), cat: '', desc: 'Caixa eletrônico', method: 'saque', from: 'conta', to: 'dinheiro' });
  }
  const p = (name, kind, applied, current, note) => inv.push({ id: 'demo-inv-' + inv.length, name, kind, applied, current, note, updatedAt: todayISO() });
  p('CDB liquidez diária', 'Renda fixa', 3200, 3368.4, 'exemplo');
  p('Tesouro Selic', 'Tesouro Direto', 900, 971.2, 'exemplo');
  p('Fundo multimercado', 'Fundos', 600, 641.9, 'exemplo');
  p('Ações (carteira)', 'Ações', 500, 468.3, 'exemplo');
  p('Bitcoin', 'Cripto', 200, 231.5, 'exemplo');
  p('Reserva na conta', 'Conta / reserva', 1500, 1500, 'exemplo');
  const fixed = [
    { id: 'demo-f1', name: 'Faculdade', amount: 600 },
    { id: 'demo-f2', name: 'Seguro', amount: 120 },
    { id: 'demo-f3', name: 'Academia', amount: 90 }
  ];
  const wallets = { start: addMonths(cur, -5), conta: 900, dinheiro: 120, vale: 0, updatedAt: '' };
  return { tx, inv, fixed, wallets };
}
let DEMO = null;
const live = (arr) => arr.filter((x) => x && !x.deleted);
const src = () => (S.demo ? (DEMO || (DEMO = demoData())) : { tx: live(S.tx), inv: live(S.inv), fixed: live(S.fixed) });

// ------------------------------------------------------------------ cálculos
// ------------------------------------------------------------------ fatura do cartão
const pad2 = (n) => String(n).padStart(2, '0');
const lastDayOf = (y, m) => new Date(y, m, 0).getDate();               // m de 1 a 12
function dateOf(ym, day) { const [y, m] = ym.split('-').map(Number); return `${ym}-${pad2(Math.min(day, lastDayOf(y, m)))}`; }
const fmtBR = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const shortMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MES_CURTO[m - 1]}/${String(y).slice(2)}`; };

/** Em qual fatura (mês do vencimento) cai uma compra feita nesta data */
function invoiceMonth(dateISO) {
  const { closing, due } = S.card;
  const [y, m, d] = String(dateISO).split('-').map(Number);
  if (!y || !m || !d) return String(dateISO).slice(0, 7);
  let closeYm = `${y}-${pad2(m)}`;
  if (d >= Math.min(closing, lastDayOf(y, m))) closeYm = addMonths(closeYm, 1);   // no dia do fechamento ou depois: próxima
  return due > closing ? closeYm : addMonths(closeYm, 1);
}
/** Datas de fechamento e vencimento da fatura que vence no mês dueYm */
function invoiceDates(dueYm) {
  const closeYm = S.card.due > S.card.closing ? dueYm : addMonths(dueYm, -1);
  return { close: dateOf(closeYm, S.card.closing), due: dateOf(dueYm, S.card.due) };
}
const isCredit = (t) => t.type === 'gasto' && t.method === 'credito';

/** Mês em que o lançamento pesa no caixa.
    Crédito: mês em que a fatura vence (parcela 2 = fatura seguinte, e assim por diante). */
function txMonth(t) {
  const dm = String(t.date || '').slice(0, 7);
  if (!isCredit(t)) return dm;
  const k = t.v === 2 ? Math.max(0, (parseNum(t.parcela) || 1) - 1) : 0;   // parcelas novas guardam a data da compra
  const base = S.card.byInvoice ? invoiceMonth(t.date) : dm;
  return addMonths(base, k);
}

const monthTx = (ym) => src().tx.filter((t) => txMonth(t) === ym);

// ------------------------------------------------------------------ conta x dinheiro
const walletCfg = () => (S.demo ? src().wallets : S.wallets);

/** Em qual lugar o lançamento mexe (saque/depósito mexe em dois) */
function walletOf(t) {
  if (t.type === 'transf') return null;
  if (t.method === 'dinheiro') return 'dinheiro';
  if (t.method === 'vale') return 'vale';
  return 'conta';                       // Pix, débito, boleto, fatura do cartão, guardado, recebido na conta
}

/** Quanto o lançamento soma (+) ou tira (−) de um lugar */
function walletDelta(t, w) {
  const a = parseNum(t.amount);
  if (t.type === 'transf') return (t.to === w ? a : 0) - (t.from === w ? a : 0);
  if (walletOf(t) !== w) return 0;
  return t.type === 'entrada' ? a : -a;
}

/** Dia em que o dinheiro realmente sai: no crédito, é o vencimento da fatura */
function effectiveDate(t) {
  if (!isCredit(t)) return t.date;
  const ym = txMonth(t);
  return S.card.byInvoice ? invoiceDates(ym).due : dateOf(ym, Number(String(t.date).slice(8, 10)) || 1);
}

/** Lugares usados: conta e dinheiro sempre; vale só se for usado */
function activeWallets() {
  const cfg = walletCfg();
  const usesVale = cfg.vale || src().tx.some((t) => t.method === 'vale');
  return usesVale ? ['conta', 'dinheiro', 'vale'] : ['conta', 'dinheiro'];
}

/** Resumo de cada lugar no mês ym: quanto tinha, o que entrou e saiu, e quanto sobrou */
function walletReport(ym) {
  const cfg = walletCfg();
  const all = src().tx;
  const list = all.filter((t) => txMonth(t) === ym);
  const today = todayISO();
  const isCur = ym === today.slice(0, 7);
  const hasStart = !!cfg.start && ym >= cfg.start;
  return activeWallets().map((w) => {
    const r = { w, name: WALLETS[w], entrou: 0, gastos: 0, fatura: 0, guardado: 0, transIn: 0, transOut: 0, net: 0, netNow: 0, pendingOut: 0, pendingIn: 0, start: null };
    if (hasStart) {
      r.start = parseNum(cfg[w]) + all
        .filter((t) => { const m = txMonth(t); return m >= cfg.start && m < ym; })
        .reduce((s, t) => s + walletDelta(t, w), 0);
    }
    for (const t of list) {
      const a = parseNum(t.amount);
      const d = walletDelta(t, w);
      if (!d) continue;
      if (t.type === 'transf') { if (d > 0) r.transIn += a; else r.transOut += a; }
      else if (t.type === 'entrada') r.entrou += a;
      else if (t.type === 'invest') r.guardado += a;
      else if (isCredit(t)) r.fatura += a;
      else r.gastos += a;
      r.net += d;
      if (!isCur || effectiveDate(t) <= today) r.netNow += d;
      else if (d < 0) r.pendingOut -= d; else r.pendingIn += d;
    }
    r.end = r.start === null ? null : r.start + r.net;
    r.now = r.start === null ? null : r.start + r.netNow;
    r.isCur = isCur;
    r.isFuture = ym > today.slice(0, 7);
    return r;
  });
}

function sums(list) {
  const s = { entrou: 0, saiu: 0, investiu: 0, byMethod: {}, byCat: {}, inCat: {}, count: list.length, credito: 0 };
  for (const t of list) {
    const a = parseNum(t.amount);
    if (t.type === 'entrada') {
      s.entrou += a;
      s.inCat[t.cat || 'Outros'] = (s.inCat[t.cat || 'Outros'] || 0) + a;
    } else if (t.type === 'gasto') {
      s.saiu += a;
      const m = t.method || 'outro';
      s.byMethod[m] = (s.byMethod[m] || 0) + a;
      s.byCat[t.cat || 'Outros'] = (s.byCat[t.cat || 'Outros'] || 0) + a;
    } else if (t.type === 'invest') {
      s.investiu += a;
    }
  }
  s.sobra = s.entrou - s.saiu - s.investiu;
  return s;
}

function catsFor(type) {
  const base = DEFAULT_CATS[type] || [];
  const extra = (S.extraCats[type] || []).filter((c) => !base.includes(c));
  const used = [...new Set(src().tx.filter((t) => t.type === type && t.cat).map((t) => t.cat))]
    .filter((c) => !base.includes(c) && !extra.includes(c));
  const all = [...base.filter((c) => c !== 'Outros'), ...extra, ...used];
  return [...all, 'Outros'];
}

// ------------------------------------------------------------------ pedaços de tela
function bars(rows, fillCls, total) {
  if (!rows.length) return '<p class="empty">Nada lançado neste mês.</p>';
  const max = Math.max(...rows.map((r) => r.v), 0.01);
  return rows.map((r) => `
    <div>
      <div class="bar-h"><span>${esc(r.k)}</span><b>${brl(r.v)}${total ? `<em>${pct(r.v / total)}</em>` : ''}</b></div>
      <div class="track"><i class="${fillCls}" style="width:${Math.max(1.5, (r.v / max) * 100).toFixed(1)}%"></i></div>
      ${r.note ? `<p class="hint" style="margin-top:4px">${esc(r.note)}</p>` : ''}
    </div>`).join('');
}
const sortRows = (obj, labels) => Object.entries(obj).filter(([, v]) => v > 0)
  .map(([k, v]) => ({ k: labels ? (labels[k] || 'Outro') : k, v })).sort((a, b) => b.v - a.v);

function niceStep(raw) {
  if (!(raw > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

function trendSvg(ym) {
  const months = Array.from({ length: 6 }, (_, i) => addMonths(ym, i - 5));
  const data = months.map((m) => { const s = sums(monthTx(m)); return { m, inn: s.entrou, out: s.saiu, left: s.sobra, n: s.count }; });
  if (!data.some((d) => d.n)) return '<p class="empty">O gráfico aparece quando houver lançamentos.</p>';

  // Desenha na largura real do cartão, para o texto ficar sempre do mesmo tamanho
  const box = $('trend');
  const W = Math.round(Math.max(300, Math.min(1000, (box && box.clientWidth) || 640)));
  const H = W < 480 ? 220 : 260, pl = 62, pr = 10, pt = 14, pb = 30;
  const hi = Math.max(1, ...data.map((d) => Math.max(d.inn, d.out, d.left)));
  const lo = Math.min(0, ...data.map((d) => d.left));
  const step = niceStep((hi - lo) / 4);
  const top = Math.ceil(hi / step) * step;
  const bottom = Math.floor(lo / step) * step;
  const y = (v) => pt + ((top - v) / (top - bottom || 1)) * (H - pt - pb);
  const gw = (W - pl - pr) / 6;
  const bw = Math.min(24, gw * 0.28);

  let g = '';
  for (let v = bottom; v <= top + step / 2; v += step) {
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    g += `<text class="axis" x="${pl - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${esc(compact(v))}</text>`;
  }
  if (bottom < 0) g += `<line class="zero" x1="${pl}" x2="${W - pr}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}"/>`;

  let b = '';
  const pts = [];
  data.forEach((d, i) => {
    const cx = pl + gw * i + gw / 2;
    const y0 = y(0);
    if (d.inn > 0) b += `<rect class="b-in" x="${(cx - bw - 2).toFixed(1)}" y="${y(d.inn).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - y(d.inn)).toFixed(1)}" rx="3"><title>Entrou ${esc(brl(d.inn))}</title></rect>`;
    if (d.out > 0) b += `<rect class="b-out" x="${(cx + 2).toFixed(1)}" y="${y(d.out).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y0 - y(d.out)).toFixed(1)}" rx="3"><title>Gastei ${esc(brl(d.out))}</title></rect>`;
    const [yy, mm] = d.m.split('-').map(Number);
    b += `<text class="axis${d.m === ym ? ' cur' : ''}" x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${MES_CURTO[mm - 1]}${mm === 1 ? '/' + String(yy).slice(2) : ''}</text>`;
    if (d.n) pts.push({ x: cx, y: y(d.left), neg: d.left < 0, v: d.left });
  });
  const line = pts.length > 1 ? `<polyline class="l-left" points="${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}"/>` : '';
  const dots = pts.map((p) => `<circle class="p-left${p.neg ? ' neg' : ''}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4.5"><title>Sobrou ${esc(brl(p.v))}</title></circle>`).join('');

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Entradas, gastos e sobra dos últimos 6 meses">${g}${b}${line}${dots}</svg>`;
}

function txLine(t) {
  if (t.type === 'transf') {
    const d = TRANSF_DIRS[t.method] || { label: 'Transferência', from: t.from, to: t.to };
    return { title: t.desc || d.label, meta: `${d.label} · ${WALLETS[t.from] || ''} → ${WALLETS[t.to] || ''}`, amount: `⇄ ${brl(parseNum(t.amount))}` };
  }
  const isParc = parseNum(t.parcelas) > 1;
  const method = t.type === 'gasto' ? GASTO_METHODS[t.method] : t.type === 'entrada' ? ENTRADA_METHODS[t.method] : '';
  const fat = isCredit(t) && S.card.byInvoice ? `fatura ${shortMonth(txMonth(t))}` : '';
  const bought = isCredit(t) && txMonth(t) !== String(t.date).slice(0, 7) ? `compra ${fmtBR(t.date).slice(0, 5)}` : '';
  const meta = [t.desc ? t.cat : TYPE_LABEL[t.type], method, isParc ? `parcela ${t.parcela}/${t.parcelas}` : '', fat, bought].filter(Boolean).join(' · ');
  const sign = t.type === 'entrada' ? '+' : '−';
  return { title: t.desc || t.cat || TYPE_LABEL[t.type], meta, amount: `${sign} ${brl(parseNum(t.amount))}` };
}

function txRow(t, withActions, showDate) {
  const l = txLine(t);
  if (showDate) l.meta = `${fmtBR(t.date).slice(0, 5)} · ${l.meta}`;
  let extra = '';
  if (withActions) {
    if (S.pendingDel === t.id) {
      const isGroup = t.grupo && parseNum(t.parcelas) > 1;
      extra = `<div class="confirm">Excluir este lançamento?
        <button type="button" class="btn small danger" data-act="del-one" data-id="${esc(t.id)}">${isGroup ? 'Só esta parcela' : 'Excluir'}</button>
        ${isGroup ? `<button type="button" class="btn small danger" data-act="del-group" data-id="${esc(t.id)}">Todas as ${esc(t.parcelas)} parcelas</button>` : ''}
        <button type="button" class="btn small ghost" data-act="del-cancel">Cancelar</button></div>`;
    } else {
      extra = `<div class="tx-act">
        <button type="button" class="btn small ghost" data-act="edit" data-id="${esc(t.id)}">Editar</button>
        <button type="button" class="btn small ghost" data-act="del" data-id="${esc(t.id)}">Excluir</button></div>`;
    }
  }
  return `<div class="tx">
    <div class="tx-main"><b>${esc(l.title)}</b><small>${esc(l.meta)}</small></div>
    <div class="tx-amt ${esc(t.type)}">${esc(l.amount)}</div>${extra}</div>`;
}

// ------------------------------------------------------------------ telas
function renderResumo() {
  const list = monthTx(S.month);
  const s = sums(list);
  const name = monthTitle(S.month);

  $('kIn').textContent = brl(s.entrou);
  const topIn = sortRows(s.inCat).slice(0, 2).map((r) => `${r.k.split(' /')[0]} ${brl(r.v)}`).join(' · ');
  $('kInSub').textContent = topIn || 'nenhuma entrada';
  $('kOut').textContent = brl(s.saiu);
  $('kOutSub').textContent = s.saiu
    ? `${brl(s.byMethod.credito || 0)} ${S.card.byInvoice ? 'da fatura do cartão' : 'no crédito'}`
    : 'nenhum gasto';
  $('kInv').textContent = brl(s.investiu);
  $('kInvSub').textContent = s.entrou && s.investiu ? `${pct(s.investiu / s.entrou)} do que entrou` : 'nada guardado';
  $('kLeft').textContent = brl(s.sobra);
  const wr = walletReport(S.month);
  const wc = wr.find((r) => r.w === 'conta');
  const wd = wr.find((r) => r.w === 'dinheiro');
  $('kLeftSub').textContent = s.count
    ? `conta ${brl(wc.net)} · dinheiro ${brl(wd.net)}`
    : 'entrou − gastos − guardado';
  $('kLeftCard').classList.toggle('neg', s.sobra < -0.004);

  // Aviso principal: saiu mais do que entrou?
  const st = $('status');
  if (!S.ready && !S.demo) {
    st.className = 'status neutral';
    st.innerHTML = '<div class="txt"><span>Carregando seus dados…</span></div>';
  } else if (!list.length) {
    st.className = 'status neutral';
    st.innerHTML = `<div class="txt"><span>Nenhum lançamento em ${esc(name)}.</span>
      <small>Comece pela aba Lançar: salário, bicos, gastos do cartão, Pix…</small></div>
      <div class="actions"><button type="button" class="btn small primary" data-goto="lancar">Fazer o primeiro lançamento</button>
      ${S.demo ? '' : '<button type="button" class="btn small ghost" id="seeDemo">Ver com dados de exemplo</button>'}</div>`;
  } else if (s.saiu > s.entrou + 0.004) {
    st.className = 'status bad';
    st.innerHTML = `<span class="dot"></span><div class="txt"><span>Saiu mais dinheiro do que entrou em ${esc(name)}.</span>
      <small>Os gastos passaram as entradas em ${esc(brl(s.saiu - s.entrou))}${s.investiu ? `, sem contar os ${esc(brl(s.investiu))} guardados` : ''}.</small></div>`;
  } else if (s.sobra < -0.004) {
    st.className = 'status warn';
    st.innerHTML = `<span class="dot"></span><div class="txt"><span>Os gastos couberam, mas você guardou mais do que sobrou.</span>
      <small>Faltaram ${esc(brl(-s.sobra))}: esse valor saiu do que você já tinha antes.</small></div>`;
  } else {
    st.className = 'status good';
    st.innerHTML = `<span class="dot"></span><div class="txt"><span>Entrou mais do que saiu em ${esc(name)}.</span>
      <small>Depois dos gastos e do que você guardou, sobraram ${esc(brl(s.sobra))}.</small></div>`;
  }

  renderWallets();
  $('byMethod').innerHTML = bars(sortRows(s.byMethod, GASTO_METHODS), 'f-ink', s.saiu);
  $('byCat').innerHTML = bars(sortRows(s.byCat).slice(0, 8), 'f-out', s.saiu);
  $('byIncome').innerHTML = bars(sortRows(s.inCat), 'f-in', s.entrou);
  $('trend').innerHTML = trendSvg(S.month);

  const inv = src().inv;
  const applied = inv.reduce((a, p) => a + parseNum(p.applied), 0);
  const current = inv.reduce((a, p) => a + parseNum(p.current), 0);
  $('patriDate').textContent = inv.length ? `${inv.length} ${inv.length === 1 ? 'item' : 'itens'}` : '';
  $('patriMini').innerHTML = inv.length ? `
    <div class="bar-h"><span>Valor atual</span><b>${brl(current)}</b></div>
    <div class="bar-h"><span>Valor aplicado</span><b>${brl(applied)}</b></div>
    <div class="bar-h"><span>Rendimento</span><b class="${current - applied >= 0 ? 'up' : 'down'}">${current - applied >= 0 ? '+' : '−'} ${brl(Math.abs(current - applied))}</b></div>`
    : '<p class="empty">Cadastre seus investimentos e reservas na aba Patrimônio.</p>';
}

function renderWallets() {
  const rep = walletReport(S.month);
  const cfg = walletCfg();
  const hasStart = rep.some((r) => r.start !== null);
  const line = (label, v, cls = '') => (v ? `<div class="wl ${cls}"><span>${esc(label)}</span><b>${v > 0 && cls === 'plus' ? '+' : '−'} ${esc(brl(Math.abs(v)))}</b></div>` : '');

  $('wallets').innerHTML = rep.map((r) => {
    let big;
    let bigLabel;
    if (r.start === null) { big = r.net; bigLabel = r.net >= 0 ? 'Sobrou no mês' : 'Faltou no mês'; }
    else if (r.isCur) { big = r.now; bigLabel = 'Tem agora'; }
    else if (r.isFuture) { big = r.end; bigLabel = 'Previsto no fim do mês'; }
    else { big = r.end; bigLabel = 'Terminou o mês com'; }
    const neg = big < -0.004;
    const rows = [
      r.start !== null ? `<div class="wl start"><span>Tinha no começo do mês</span><b>${esc(brl(r.start))}</b></div>` : '',
      line(r.w === 'conta' ? 'Entrou na conta' : r.w === 'vale' ? 'Entrou no vale' : 'Recebeu em dinheiro', r.entrou, 'plus'),
      line(r.w === 'conta' ? 'Pix, débito e boleto' : 'Gastou', r.gastos, 'minus'),
      line(S.card.byInvoice ? 'Fatura do cartão' : 'Compras no crédito', r.fatura, 'minus'),
      line('Guardado / investido', r.guardado, 'minus'),
      line(r.w === 'conta' ? 'Depósitos (dinheiro → conta)' : 'Saques (conta → dinheiro)', r.transIn, 'plus'),
      line(r.w === 'conta' ? 'Saques (conta → dinheiro)' : 'Depósitos (dinheiro → conta)', r.transOut, 'minus')
    ].join('');
    let foot = '';
    if (r.isCur && r.start !== null && (r.pendingOut || r.pendingIn)) {
      foot = `<p class="wl-foot">Ainda neste mês: ${r.pendingOut ? `−${esc(brl(r.pendingOut))}` : ''}${r.pendingOut && r.pendingIn ? ' e ' : ''}${r.pendingIn ? `+${esc(brl(r.pendingIn))}` : ''} · fim do mês: <b>${esc(brl(r.end))}</b></p>`;
    } else if (r.isCur && r.start === null && (r.pendingOut || r.pendingIn)) {
      foot = `<p class="wl-foot">Inclui ${r.pendingOut ? `${esc(brl(r.pendingOut))} que ainda vai sair` : ''}${r.pendingOut && r.pendingIn ? ' e ' : ''}${r.pendingIn ? `${esc(brl(r.pendingIn))} que ainda vai entrar` : ''} até o fim do mês.</p>`;
    }
    const empty = !rows && r.start === null;
    return `<div class="wallet w-${r.w}${neg ? ' neg' : ''}">
      <div class="w-top"><span class="w-name"><i></i>${esc(r.name)}</span><small>${esc(bigLabel)}</small></div>
      <div class="w-big">${esc(brl(big))}</div>
      <div class="w-lines">${empty ? '<p class="empty">Nada neste mês.</p>' : rows}</div>
      ${foot}
    </div>`;
  }).join('');

  $('walletSub').textContent = hasStart ? 'quanto tem em cada lugar' : 'o que entrou e saiu de cada lugar no mês';
  $('walletHint').innerHTML = S.demo ? '' : hasStart
    ? `Saldo contado desde ${esc(monthTitle(cfg.start))}. Se não bater com o banco ou com a carteira, <button type="button" class="linkish" data-goto="backup">ajuste o saldo inicial</button>.`
    : cfg.start && S.month < cfg.start
      ? `O saldo começa a ser contado em ${esc(monthTitle(cfg.start))}.`
      : `Para ver <b>quanto você tem</b> em cada lugar (e não só o que sobrou no mês), <button type="button" class="linkish" data-goto="backup">informe quanto tinha</button> na conta e em dinheiro.`;
}

function fillCatSelect() {
  const sel = $('fCat');
  const prev = sel.value;
  const cats = catsFor(S.formType);
  sel.innerHTML = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('') + '<option value="__new">+ Nova categoria…</option>';
  if (cats.includes(prev)) sel.value = prev;
  $('fCatNewWrap').hidden = sel.value !== '__new';
}

function renderForm() {
  document.querySelectorAll('#txForm .seg button').forEach((b) => b.classList.toggle('on', b.dataset.type === S.formType));
  fillCatSelect();

  const isGasto = S.formType === 'gasto';
  const isEntrada = S.formType === 'entrada';
  const isTransf = S.formType === 'transf';
  $('catWrap').hidden = isTransf;
  $('methodWrap').hidden = !(isGasto || isEntrada || isTransf);
  $('methodLabel').textContent = isGasto ? 'Forma de pagamento' : isEntrada ? 'Como recebeu' : 'O que você fez';
  if (isTransf) {
    $('fMethods').innerHTML = Object.entries(TRANSF_DIRS).map(([k, v]) =>
      `<button type="button" class="chip${k === S.transfDir ? ' on' : ''}" data-method="${k}">${esc(v.label)}: ${esc(WALLETS[v.from])} → ${esc(WALLETS[v.to])}</button>`).join('');
  } else {
    const methods = isGasto ? GASTO_METHODS : ENTRADA_METHODS;
    const cur = isGasto ? S.gastoMethod : S.entradaMethod;
    $('fMethods').innerHTML = Object.entries(methods).map(([k, v]) =>
      `<button type="button" class="chip${k === cur ? ' on' : ''}" data-method="${k}">${esc(v)}</button>`).join('');
  }

  const showParc = isGasto && S.gastoMethod === 'credito' && !S.editing;
  $('parcWrap').hidden = !showParc;
  updateParcInfo();

  $('saveTx').textContent = S.editing ? 'Salvar alteração' : isGasto ? 'Salvar gasto' : isEntrada ? 'Salvar entrada' : isTransf ? `Salvar ${TRANSF_DIRS[S.transfDir].label.toLowerCase()}` : 'Salvar valor guardado';
  $('saveTx').className = 'btn block ' + (isGasto ? 'danger' : isEntrada ? 'primary' : 'dark');
  $('editBar').hidden = !S.editing;
  $('formHint').textContent = isTransf
    ? `${TRANSF_DIRS[S.transfDir].hint}. Não conta como gasto nem como entrada: só muda o dinheiro de lugar.`
    : S.formType === 'invest'
    ? 'Use para o dinheiro que você separou no mês (aporte, poupança). Ele sai do "sobrou", mas não conta como gasto.'
    : isGasto && S.gastoMethod === 'credito'
      ? 'Lance cada compra do cartão aqui, com a data da compra. Não lance a fatura inteira de novo, senão o gasto conta duas vezes.'
      : '';
}

function updateParcInfo() {
  const n = parseInt($('fParc').value, 10) || 1;
  const total = parseNum($('fAmount').value);
  const date = $('fDate').value || todayISO();
  const first = S.card.byInvoice ? invoiceMonth(date) : date.slice(0, 7);
  const last = addMonths(first, n - 1);
  const dueTxt = S.card.byInvoice ? `fatura que vence em ${fmtBR(invoiceDates(first).due)}` : monthTitle(first);
  if (n <= 1) {
    $('parcInfo').textContent = S.card.byInvoice
      ? `Entra na ${dueTxt}, e conta no mês de ${monthTitle(first)}.`
      : 'À vista no crédito.';
    return;
  }
  const each = total > 0 ? `${n}× de ${brl(round2(total / n))}` : `${n} parcelas`;
  $('parcInfo').textContent = S.card.byInvoice
    ? `${each}: a 1ª na ${dueTxt}, a última na fatura de ${monthTitle(last)}.`
    : `${each}: de ${monthTitle(first)} até ${monthTitle(last)}.`;
}

function renderRecent() {
  // Os últimos que você lançou, de qualquer mês (uma compra no crédito pode cair na fatura do mês seguinte)
  const seen = new Set();
  const list = src().tx.slice()
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
    .filter((t) => { if (!t.grupo) return true; if (seen.has(t.grupo)) return false; seen.add(t.grupo); return true; })
    .slice(0, 6);
  $('recent').innerHTML = list.length ? list.map((t) => txRow(t, false)).join('') : '<p class="empty">Nada lançado ainda.</p>';
}

// ------------------------------------------------------------------ extrato: filtros
const DEFAULT_FILTER = { type: 'all', method: 'all', q: '', period: 'month', from: '', to: '', cat: 'all', min: '', max: '', sort: 'date-desc' };

/** Meses (AAAA-MM) que o período do filtro cobre; null = todos */
function filterRange() {
  const f = S.filter;
  const m = S.month;
  if (f.period === 'month') return [m, m];
  if (f.period === '3m') return [addMonths(m, -2), m];
  if (f.period === '6m') return [addMonths(m, -5), m];
  if (f.period === 'year') { const y = m.slice(0, 4); return [`${y}-01`, `${y}-12`]; }
  if (f.period === 'custom') {
    let from = /^\d{4}-\d{2}$/.test(f.from) ? f.from : m;
    let to = /^\d{4}-\d{2}$/.test(f.to) ? f.to : m;
    if (from > to) [from, to] = [to, from];
    return [from, to];
  }
  return null;
}

function periodLabel() {
  const r = filterRange();
  if (!r) return 'Todo o período';
  if (r[0] === r[1]) return monthTitle(r[0]);
  if (S.filter.period === 'year') return `Ano de ${r[0].slice(0, 4)}`;
  return `${monthTitle(r[0])} a ${monthTitle(r[1])}`;
}

function activeFilterCount() {
  const f = S.filter;
  let n = 0;
  if (f.period !== 'month') n++;
  if (f.cat !== 'all') n++;
  if (f.method !== 'all') n++;
  if (parseNum(f.min) > 0) n++;
  if (parseNum(f.max) > 0) n++;
  if (f.sort !== 'date-desc') n++;
  return n;
}

function filteredTx() {
  const f = S.filter;
  const r = filterRange();
  const q = f.q.trim().toLowerCase();
  const min = parseNum(f.min);
  const max = parseNum(f.max);
  const list = src().tx
    .filter((t) => { if (!r) return true; const m = txMonth(t); return m >= r[0] && m <= r[1]; })
    .filter((t) => f.type === 'all' || t.type === f.type)
    .filter((t) => f.method === 'all' || t.method === f.method)
    .filter((t) => f.cat === 'all' || t.cat === f.cat)
    .filter((t) => !(min > 0) || parseNum(t.amount) >= min)
    .filter((t) => !(max > 0) || parseNum(t.amount) <= max)
    .filter((t) => !q || `${t.desc || ''} ${t.cat || ''}`.toLowerCase().includes(q));
  const byDate = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  const sorters = {
    'date-desc': (a, b) => txMonth(b).localeCompare(txMonth(a)) || byDate(b, a),
    'date-asc': (a, b) => txMonth(a).localeCompare(txMonth(b)) || byDate(a, b),
    'value-desc': (a, b) => parseNum(b.amount) - parseNum(a.amount),
    'value-asc': (a, b) => parseNum(a.amount) - parseNum(b.amount)
  };
  return list.sort(sorters[f.sort] || sorters['date-desc']);
}

function fillFilterSelects() {
  const mSel = $('fMethodFilter');
  if (!mSel.options.length) {
    mSel.innerHTML = '<option value="all">Todas as formas</option>' +
      Object.entries(GASTO_METHODS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('') +
      '<option value="conta">Recebido na conta / Pix</option>';
  }
  mSel.value = S.filter.method;

  const types = S.filter.type === 'all' ? ['gasto', 'entrada', 'invest'] : [S.filter.type];
  const groups = types.map((ty) => {
    const cats = catsFor(ty);
    return `<optgroup label="${esc(TYPE_LABEL[ty])}">${cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</optgroup>`;
  }).join('');
  const cSel = $('fCatFilter');
  const html = '<option value="all">Todas as categorias</option>' + groups;
  if (cSel.dataset.html !== html) { cSel.innerHTML = html; cSel.dataset.html = html; }
  const exists = [...cSel.options].some((o) => o.value === S.filter.cat);
  if (!exists) S.filter.cat = 'all';
  cSel.value = S.filter.cat;

  $('fPeriod').value = S.filter.period;
  $('fRangeWrap').hidden = S.filter.period !== 'custom';
  if (S.filter.period === 'custom') {
    if (!S.filter.from) S.filter.from = addMonths(S.month, -2);
    if (!S.filter.to) S.filter.to = S.month;
    if (document.activeElement !== $('fFrom')) $('fFrom').value = S.filter.from;
    if (document.activeElement !== $('fTo')) $('fTo').value = S.filter.to;
  }
  $('fSort').value = S.filter.sort;
  const n = activeFilterCount();
  $('filterCount').textContent = String(n);
  $('filterCount').hidden = !n;
}

function renderExtrato() {
  document.querySelectorAll('#fType button').forEach((b) => b.classList.toggle('on', b.dataset.f === S.filter.type));
  fillFilterSelects();

  const list = filteredTx();
  const s = sums(list);
  $('periodTxt').textContent = periodLabel();
  $('listTotals').innerHTML = list.length
    ? `<span>${list.length} ${list.length === 1 ? 'lançamento' : 'lançamentos'}</span>
       ${s.entrou ? `<span>Entradas <b>${brl(s.entrou)}</b></span>` : ''}
       ${s.saiu ? `<span>Gastos <b>${brl(s.saiu)}</b></span>` : ''}
       ${s.investiu ? `<span>Guardado <b>${brl(s.investiu)}</b></span>` : ''}`
    : '<span>Nenhum lançamento</span>';
  $('btnPdf').disabled = !list.length;

  if (!list.length) { $('txList').innerHTML = `<p class="empty" style="padding-top:14px">Nenhum lançamento encontrado em ${esc(periodLabel())} com esses filtros.</p>`; return; }

  const byValue = S.filter.sort.startsWith('value');
  const r = filterRange();
  const multiMonth = !r || r[0] !== r[1];
  let html = '';
  let lastMonth = '';
  let lastDay = '';
  for (const t of list) {
    if (!byValue && multiMonth && txMonth(t) !== lastMonth) {
      lastMonth = txMonth(t);
      const ms = sums(list.filter((x) => txMonth(x) === lastMonth));
      html += `<div class="month-h"><span>${esc(monthTitle(lastMonth))}</span><small>${ms.entrou ? `+${esc(brl(ms.entrou))} · ` : ''}−${esc(brl(ms.saiu + ms.investiu))}</small></div>`;
      lastDay = '';
    }
    if (!byValue && t.date !== lastDay) { html += `<div class="day">${esc(dayTitle(t.date))}</div>`; lastDay = t.date; }
    html += txRow(t, true, byValue);
  }
  $('txList').innerHTML = html;
}

// ------------------------------------------------------------------ PDF (relatório para imprimir / salvar)
function filtersDescription() {
  const f = S.filter;
  const parts = [];
  if (f.type !== 'all') parts.push(`Tipo: ${TYPE_LABEL[f.type]}`);
  if (f.cat !== 'all') parts.push(`Categoria: ${f.cat}`);
  if (f.method !== 'all') parts.push(`Forma: ${GASTO_METHODS[f.method] || ENTRADA_METHODS[f.method] || f.method}`);
  if (parseNum(f.min) > 0) parts.push(`A partir de ${brl(parseNum(f.min))}`);
  if (parseNum(f.max) > 0) parts.push(`Até ${brl(parseNum(f.max))}`);
  if (f.q.trim()) parts.push(`Busca: "${f.q.trim()}"`);
  return parts.length ? parts.join(' · ') : 'Sem filtros: todos os lançamentos do período';
}

function buildReport() {
  const list = filteredTx();
  const s = sums(list);
  const left = s.entrou - s.saiu - s.investiu;
  const r = filterRange();
  const multiMonth = !r || r[0] !== r[1];
  const now = new Date();
  const device = readLS(LS_DEVICE).trim();

  const rows = (obj, labels, total) => sortRows(obj, labels).map((x) =>
    `<tr><td>${esc(x.k)}</td><td class="n">${esc(brl(x.v))}</td><td class="n">${esc(pct(total ? x.v / total : 0))}</td></tr>`).join('') ||
    '<tr><td colspan="3">Nenhum gasto</td></tr>';

  // Lista em ordem de data (mais antigo primeiro), com subtotal por mês quando cobre vários meses
  const ordered = list.slice().sort((a, b) => txMonth(a).localeCompare(txMonth(b)) || String(a.date).localeCompare(String(b.date)));
  let body = '';
  let lastMonth = '';
  for (const t of ordered) {
    if (multiMonth && txMonth(t) !== lastMonth) {
      lastMonth = txMonth(t);
      const ms = sums(ordered.filter((x) => txMonth(x) === lastMonth));
      body += `<tr class="m-row"><td colspan="4">${esc(monthTitle(lastMonth))}</td><td class="n">${esc(brl(ms.entrou - ms.saiu - ms.investiu))}</td></tr>`;
    }
    const method = t.type === 'gasto' ? GASTO_METHODS[t.method] : t.type === 'entrada' ? ENTRADA_METHODS[t.method] : t.type === 'transf' ? `${WALLETS[t.from]} → ${WALLETS[t.to]}` : 'Guardado';
    const extra = [parseNum(t.parcelas) > 1 ? `parcela ${t.parcela}/${t.parcelas}` : '', isCredit(t) && S.card.byInvoice ? `fatura ${shortMonth(txMonth(t))}` : ''].filter(Boolean).join(' · ');
    const sign = t.type === 'entrada' ? '+' : t.type === 'transf' ? '⇄' : '−';
    body += `<tr>
      <td>${esc(fmtBR(t.date))}</td>
      <td>${esc(t.desc || '—')}${extra ? `<br><small style="color:#5B6A86">${esc(extra)}</small>` : ''}</td>
      <td>${esc(t.cat || TYPE_LABEL[t.type])}</td>
      <td>${esc(method || '')}</td>
      <td class="n ${t.type === 'entrada' ? 'pos' : t.type === 'transf' ? '' : 'neg'}">${sign} ${esc(brl(parseNum(t.amount)))}</td></tr>`;
  }

  $('report').innerHTML = `
    <div class="r-head">
      <div><h1>Meu Caixa · Extrato</h1><p><b>${esc(periodLabel())}</b></p></div>
      <p>Gerado em ${esc(now.toLocaleDateString('pt-BR'))} às ${esc(now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }))}${device ? `<br>${esc(device)}` : ''}</p>
    </div>
    <p class="r-filters">${esc(filtersDescription())} · ${list.length} ${list.length === 1 ? 'lançamento' : 'lançamentos'}${S.card.byInvoice ? ' · compras no crédito contadas no mês em que a fatura vence' : ''}</p>
    <div class="r-kpis">
      <div class="r-kpi in"><span>Entradas</span><b>${esc(brl(s.entrou))}</b></div>
      <div class="r-kpi out"><span>Gastos</span><b>${esc(brl(s.saiu))}</b></div>
      <div class="r-kpi"><span>Guardado / investido</span><b>${esc(brl(s.investiu))}</b></div>
      <div class="r-kpi left${left < 0 ? ' neg' : ''}"><span>${left < 0 ? 'Faltou' : 'Sobrou'}</span><b>${esc(brl(Math.abs(left)))}</b></div>
    </div>
    <div class="r-two">
      <div><h2>Gastos por categoria</h2><table><thead><tr><th>Categoria</th><th class="n">Valor</th><th class="n">%</th></tr></thead><tbody>${rows(s.byCat, null, s.saiu)}</tbody></table></div>
      <div><h2>Gastos por forma de pagamento</h2><table><thead><tr><th>Forma</th><th class="n">Valor</th><th class="n">%</th></tr></thead><tbody>${rows(s.byMethod, GASTO_METHODS, s.saiu)}</tbody></table></div>
    </div>
    ${walletTableHtml(list)}
    <h2>Lançamentos</h2>
    <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th class="n">Valor</th></tr></thead><tbody>${body}</tbody></table>
    <p class="r-foot">Meu Caixa · relatório gerado a partir dos dados deste aparelho.</p>`;
  return list.length;
}

/** Tabela do PDF: quanto entrou e saiu da conta, do dinheiro e do vale */
function walletTableHtml(list) {
  const rows = activeWallets().map((w) => {
    let inn = 0;
    let out = 0;
    list.forEach((t) => { const d = walletDelta(t, w); if (d > 0) inn += d; else out -= d; });
    return { w, inn, out };
  }).filter((r) => r.inn || r.out);
  if (!rows.length) return '';
  return `<h2>Por onde passou o dinheiro</h2>
    <table><thead><tr><th>Lugar</th><th class="n">Entrou</th><th class="n">Saiu</th><th class="n">Diferença</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td>${esc(WALLETS[r.w])}</td><td class="n pos">${esc(brl(r.inn))}</td><td class="n neg">${esc(brl(r.out))}</td><td class="n ${r.inn - r.out < 0 ? 'neg' : 'pos'}">${esc(brl(r.inn - r.out))}</td></tr>`).join('')}
    </tbody></table>
    <p class="r-filters" style="margin-top:4px">Conta = Pix, débito, boleto, fatura do cartão e valores guardados. Saques e depósitos aparecem nos dois lados.</p>`;
}

function exportPdf() {
  if (!buildReport()) { toast('Não há lançamentos com esses filtros.', 'err'); return; }
  const old = document.title;
  document.title = `Meu Caixa - ${periodLabel()}`;   // vira o nome sugerido do PDF
  setTimeout(() => {
    window.print();
    setTimeout(() => { document.title = old; }, 500);
  }, 60);
}

function renderPatrimonio() {
  const inv = src().inv.slice().sort((a, b) => INV_KINDS.indexOf(a.kind) - INV_KINDS.indexOf(b.kind) || String(a.name).localeCompare(String(b.name), 'pt-BR'));
  const applied = inv.reduce((a, p) => a + parseNum(p.applied), 0);
  const current = inv.reduce((a, p) => a + parseNum(p.current), 0);
  const gain = current - applied;
  $('pApplied').textContent = brl(applied);
  $('pCurrent').textContent = brl(current);
  $('pCount').textContent = inv.length ? `${inv.length} ${inv.length === 1 ? 'item' : 'itens'}` : 'nenhum cadastrado';
  $('pGain').textContent = `${gain >= 0 ? '+' : '−'} ${brl(Math.abs(gain))}`;
  $('pGainSub').textContent = applied ? `${gain >= 0 ? '+' : ''}${pct(gain / applied)} sobre o aplicado` : '—';
  $('pGainCard').classList.toggle('neg', gain < -0.004);

  const byKind = {};
  const byKindApplied = {};
  inv.forEach((p) => {
    const k = p.kind || 'Outro';
    byKind[k] = (byKind[k] || 0) + parseNum(p.current);
    byKindApplied[k] = (byKindApplied[k] || 0) + parseNum(p.applied);
  });
  const rows = sortRows(byKind).map((r) => ({ ...r, note: `aplicado ${brl(byKindApplied[r.k] || 0)}` }));
  $('byKind').innerHTML = rows.length ? bars(rows, 'f-blue', current) : '<p class="empty">Nenhum investimento cadastrado ainda.</p>';

  $('invList').innerHTML = inv.length ? inv.map((p) => {
    const g = parseNum(p.current) - parseNum(p.applied);
    const gp = parseNum(p.applied) ? g / parseNum(p.applied) : 0;
    let act;
    if (S.pendingInvDel === p.id) {
      act = `<div class="confirm">Excluir "${esc(p.name)}"?
        <button type="button" class="btn small danger" data-iact="del-yes" data-id="${esc(p.id)}">Excluir</button>
        <button type="button" class="btn small ghost" data-iact="del-no">Cancelar</button></div>`;
    } else {
      act = `<div class="tx-act">
        <button type="button" class="btn small ghost" data-iact="edit" data-id="${esc(p.id)}">Atualizar valores</button>
        <button type="button" class="btn small ghost" data-iact="del" data-id="${esc(p.id)}">Excluir</button></div>`;
    }
    return `<div class="pos">
      <div style="min-width:0"><b>${esc(p.name)}</b><br><small><span class="tag">${esc(p.kind || 'Outro')}</span>${esc(p.note || '')}</small></div>
      <div class="vals"><strong>${brl(parseNum(p.current))}</strong><small>aplicado ${brl(parseNum(p.applied))}</small><br>
        <small class="${g >= 0 ? 'up' : 'down'}">${g >= 0 ? '+' : '−'} ${brl(Math.abs(g))} (${pct(gp)})</small></div>
      ${act}</div>`;
  }).join('') : '<p class="empty">Cadastre aqui o que você tem investido e guardado: CDB, Tesouro, ações, cripto, FGTS, reserva na conta…</p>';
}

function renderAll() {
  const [my, mm] = S.month.split('-').map(Number);
  $('monthLabel').innerHTML = `<span class="m-full">${esc(monthTitle(S.month))}</span><span class="m-short">${esc(MES_CURTO[mm - 1])}/${String(my).slice(2)}</span>`;
  const dark = document.documentElement.dataset.theme === 'dark';
  $('themeBtn').setAttribute('aria-label', dark ? 'Voltar ao modo claro' : 'Ativar modo escuro');
  $('themeBtn').title = dark ? 'Modo claro' : 'Modo escuro';
  $('darkTheme').checked = dark;
  $('demoBar').hidden = !S.demo;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.view === S.view));
  VIEWS.forEach((v) => { $('v-' + v).hidden = v !== S.view; });
  renderResumo();
  renderForm();
  renderRecent();
  renderExtrato();
  renderPatrimonio();
  renderBackup();
  renderFatura();
  renderCardSettings();
  renderWalletSettings();
  $('storeNote').textContent = 'Salvo neste aparelho, funciona sem internet. Use a aba Ajustes para fazer backup e juntar com outros aparelhos.';
}

// ------------------------------------------------------------------ fatura (Resumo) e ajustes do cartão
function renderFatura() {
  const card = $('faturaCard');
  const all = src().tx.filter(isCredit);
  if (!all.length) { card.hidden = true; return; }
  card.hidden = false;

  const ym = S.month;
  const list = all.filter((t) => txMonth(t) === ym);
  const total = list.reduce((a, t) => a + parseNum(t.amount), 0);
  const nextYm = addMonths(ym, 1);
  const nextTotal = all.filter((t) => txMonth(t) === nextYm).reduce((a, t) => a + parseNum(t.amount), 0);
  const today = todayISO();

  if (S.card.byInvoice) {
    const { close, due } = invoiceDates(ym);
    $('fatLabel').textContent = `Vence em ${fmtBR(due)}`;
    let pill;
    if (today < close) pill = `<span class="pill open">Aberta · fecha ${esc(fmtBR(close).slice(0, 5))}</span>`;
    else if (today <= due) pill = `<span class="pill closed">Fechada · pague até ${esc(fmtBR(due).slice(0, 5))}</span>`;
    else pill = `<span class="pill past">Venceu em ${esc(fmtBR(due).slice(0, 5))}</span>`;
    $('fatStatus').innerHTML = pill;
    const parcCount = list.filter((t) => parseNum(t.parcelas) > 1).length;
    $('fatSub').textContent = list.length
      ? `${list.length} ${list.length === 1 ? 'compra' : 'compras'}${parcCount ? `, ${parcCount} ${parcCount === 1 ? 'parcela' : 'parcelas'}` : ''} · já descontado do mês de ${monthTitle(ym)}`
      : 'nenhuma compra nesta fatura';
    $('fatNextLabel').textContent = `Próxima · vence ${fmtBR(invoiceDates(nextYm).due).slice(0, 5)}`;
    $('fatNextSub').textContent = 'já lançado até agora (vai descontar no mês seguinte)';
  } else {
    $('fatLabel').textContent = `Compras no crédito em ${monthTitle(ym)}`;
    $('fatStatus').textContent = 'contando no mês da compra';
    $('fatSub').textContent = `${list.length} ${list.length === 1 ? 'compra' : 'compras'}`;
    $('fatNextLabel').textContent = `Parcelas de ${monthTitle(nextYm)}`;
    $('fatNextSub').textContent = 'já lançadas';
  }
  $('fatValue').textContent = brl(total);
  $('fatNext').textContent = brl(nextTotal);

  renderForecast(nextYm, nextTotal, today);

  // Maiores itens da fatura
  const top = list.slice().sort((a, b) => parseNum(b.amount) - parseNum(a.amount)).slice(0, 5);
  $('fatList').innerHTML = top.length
    ? `<p class="sub-h" style="margin-top:14px">Maiores itens desta fatura</p>${top.map((t) => txRow(t, false)).join('')}`
    : '';

  // Aviso para configurar o cartão, se ainda não configurou
  $('cardNotice').hidden = !!S.card.updatedAt || S.demo || S.view === 'backup';
}

/**
 * Simulação do mês seguinte (só informativa, não altera lançamentos):
 *   salário (previsto ou digitado) − próxima fatura − gastos fixos marcados − outros gastos = sobra
 * Salário previsto = o "Salário" já lançado naquele mês; se ainda não tiver, repete o último recebido.
 * Os gastos fixos ficam salvos (e vão no backup); o resto da simulação é temporário.
 */
function predictedSalary(nextYm) {
  const isSalary = (t) => t.type === 'entrada' && String(t.cat || '').toLowerCase().startsWith('salário');
  const salaries = src().tx.filter(isSalary);
  const already = salaries.filter((t) => txMonth(t) === nextYm);
  if (already.length) return { value: already.reduce((a, t) => a + parseNum(t.amount), 0), label: 'Salário já lançado' };
  const before = salaries.filter((t) => String(t.date) < `${nextYm}-01`).sort((x, y) => String(y.date).localeCompare(String(x.date)));
  if (before.length) return { value: parseNum(before[0].amount), label: `Salário previsto (igual ao de ${fmtBR(before[0].date).slice(0, 5)})` };
  return { value: 0, label: 'Salário (digite para simular)' };
}

function renderForecast(nextYm, nextTotal, today) {
  const box = $('forecast');
  const fixed = src().fixed;
  const pred = predictedSalary(nextYm);
  if (!S.card.byInvoice || !(nextTotal > 0 || fixed.length || pred.value > 0)) { box.hidden = true; return; }
  box.hidden = false;

  // Se mudou o mês olhado, a simulação começa de novo
  if (S.sim.ym !== nextYm) S.sim = { ym: nextYm, salary: null, extra: 0, off: new Set() };
  const { close, due } = invoiceDates(nextYm);
  S.fc = { nextYm, nextTotal, pred, close, due, stillOpen: today < close };

  $('fcTitle').textContent = `Simulação para ${monthTitle(nextYm)}`;
  $('fcSalaryLabel').textContent = S.sim.salary === null ? pred.label : 'Salário (valor da simulação)';
  if (document.activeElement !== $('fcSalary')) {
    const v = S.sim.salary === null ? pred.value : S.sim.salary;
    $('fcSalary').value = v ? moneyTxt(v) : '';
  }
  if (document.activeElement !== $('fcExtra')) $('fcExtra').value = S.sim.extra ? moneyTxt(S.sim.extra) : '';
  $('fcInvLabel').textContent = `− Fatura que vence em ${fmtBR(due).slice(0, 5)}`;
  $('fcInv').textContent = brl(nextTotal);

  $('fcFixed').innerHTML = fixed.length
    ? fixed.slice().sort((x, y) => parseNum(y.amount) - parseNum(x.amount)).map((f) => {
      const off = S.sim.off.has(f.id);
      return `<div class="fc-fix${off ? ' off' : ''}">
        <label class="check"><input type="checkbox" data-fix="${esc(f.id)}"${off ? '' : ' checked'}><span>${esc(f.name)}</span></label>
        <b>${brl(parseNum(f.amount))}</b>
        <button type="button" class="x" data-delfix="${esc(f.id)}" aria-label="Remover ${esc(f.name)}" title="Remover dos gastos fixos">×</button>
      </div>`;
    }).join('')
    : '<p class="hint" style="margin:0 0 6px">Nenhum gasto fixo ainda. Adicione abaixo o que você sabe que vai pagar (faculdade, seguro, celular…).</p>';

  updateForecastCalc();
}

/** Só recalcula o resultado (sem redesenhar os campos), para não atrapalhar quem está digitando */
function updateForecastCalc() {
  if (!S.fc) return;
  const salary = S.sim.salary === null ? S.fc.pred.value : S.sim.salary;
  const fixedOn = src().fixed.filter((f) => !S.sim.off.has(f.id)).reduce((a, f) => a + parseNum(f.amount), 0);
  const extra = S.sim.extra || 0;
  const inv = S.fc.nextTotal;
  const outFix = fixedOn + extra;
  const left = salary - inv - outFix;

  $('fcResultLabel').textContent = left >= 0 ? 'Sobra no mês' : 'Falta no mês';
  $('fcResult').textContent = brl(Math.abs(left));
  $('fcResult').style.color = `var(${left >= 0 ? '--green' : '--red'})`;

  const base = Math.max(salary, inv + outFix, 0.01);
  $('fcBarInv').style.width = `${(inv / base * 100).toFixed(1)}%`;
  $('fcBarFix').style.width = `${(outFix / base * 100).toFixed(1)}%`;

  let note;
  let cls = 'forecast';
  if (!(salary > 0)) {
    note = 'Lance seu salário (categoria "Salário") ou digite um valor acima para simular.';
  } else if (left < 0) {
    note = `Os gastos passam do salário em ${brl(-left)}.`;
    cls += ' tight';
  } else if (left < salary * 0.1) {
    note = `Sobra pouco: só ${pct(left / salary)} do salário. A fatura leva ${pct(inv / salary)} e os fixos ${pct(outFix / salary)}.`;
    cls += ' tight';
  } else {
    note = `A fatura leva ${pct(inv / salary)} do salário e os fixos ${pct(outFix / salary)}. Sobram ${pct(left / salary)}.`;
    cls += ' good';
  }
  if (S.fc.stillOpen) note += ` A fatura ainda pode aumentar até fechar em ${fmtBR(S.fc.close).slice(0, 5)}.`;
  $('fcNote').textContent = note;
  $('forecast').className = cls;
  $('fcReset').hidden = S.sim.salary === null && !S.sim.extra && !S.sim.off.size;
}

async function addFixed(e) {
  e.preventDefault();
  if (S.demo) { toast('Saia dos dados de exemplo para cadastrar seus gastos fixos.', 'err'); return; }
  const name = $('fcNewName').value.trim();
  const amount = round2(parseNum($('fcNewValue').value));
  if (!name) { toast('Digite o nome do gasto fixo.', 'err'); $('fcNewName').focus(); return; }
  if (!(amount > 0)) { toast('Digite o valor do gasto fixo.', 'err'); $('fcNewValue').focus(); return; }
  upsert(S.fixed, { id: rid(), name, amount, updatedAt: nowISO() });
  persist();
  $('fcNewName').value = '';
  $('fcNewValue').value = '';
  renderAll();
  toast(`"${name}" adicionado aos gastos fixos.`);
}

function onFixedClick(e) {
  const del = e.target.closest('[data-delfix]');
  if (del) {
    if (S.demo) { toast('Saia dos dados de exemplo para mudar os gastos fixos.', 'err'); return; }
    const id = del.dataset.delfix;
    upsert(S.fixed, { id, deleted: true, updatedAt: nowISO() });
    persist();
    renderAll();
    toast('Gasto fixo removido.');
  }
}

function onFixedToggle(e) {
  const box = e.target.closest('[data-fix]');
  if (!box) return;
  if (box.checked) S.sim.off.delete(box.dataset.fix); else S.sim.off.add(box.dataset.fix);
  box.closest('.fc-fix').classList.toggle('off', !box.checked);
  updateForecastCalc();
}

function renderWalletSettings() {
  const f = $('walletForm');
  if (f.contains(document.activeElement)) return;
  const w = S.wallets;
  $('wStart').value = w.start || todayISO().slice(0, 7);
  $('wConta').value = w.start ? moneyTxt(w.conta) : '';
  $('wDinheiro').value = w.start ? moneyTxt(w.dinheiro) : '';
  $('wVale').value = w.start && w.vale ? moneyTxt(w.vale) : '';
  $('wClear').hidden = !w.start;
}

function saveWallets(e) {
  e.preventDefault();
  if (S.demo) { toast('Saia dos dados de exemplo antes de mudar os ajustes.', 'err'); return; }
  const start = $('wStart').value;
  if (!/^\d{4}-\d{2}$/.test(start)) { toast('Escolha o mês.', 'err'); $('wStart').focus(); return; }
  S.wallets = {
    start,
    conta: round2(parseNum($('wConta').value)),
    dinheiro: round2(parseNum($('wDinheiro').value)),
    vale: round2(parseNum($('wVale').value)),
    updatedAt: nowISO()
  };
  persist();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  renderAll();
  toast(`Saldo inicial salvo. Contando a partir de ${monthTitle(start)}.`);
}

function clearWallets() {
  if (S.demo) return;
  S.wallets = { start: '', conta: 0, dinheiro: 0, vale: 0, updatedAt: nowISO() };
  persist();
  renderAll();
  toast('Saldo inicial removido. O Resumo volta a mostrar só o que sobrou no mês.');
}

function renderCardSettings() {
  const f = $('cardForm');
  if (!f.contains(document.activeElement)) {
    $('cClosing').value = S.card.closing;
    $('cDue').value = S.card.due;
    $('cByInvoice').checked = S.card.byInvoice;
  }
  updateCardExample();
}

function updateCardExample() {
  const closing = Math.round(parseNum($('cClosing').value));
  const due = Math.round(parseNum($('cDue').value));
  if (!(closing >= 1 && closing <= 31 && due >= 1 && due <= 31)) { $('cExample').textContent = 'Digite dias de 1 a 31.'; return; }
  const saved = S.card;
  S.card = { ...saved, closing, due };
  const t = todayISO();
  const ym = invoiceMonth(t);
  const ex = `Exemplo: uma compra hoje (${fmtBR(t).slice(0, 5)}) entra na fatura que vence em ${fmtBR(invoiceDates(ym).due)}` +
    ($('cByInvoice').checked ? ` e desconta no mês de ${monthTitle(ym)}.` : ', mas conta no mês da compra.');
  S.card = saved;
  $('cExample').textContent = ex;
}

function saveCard(e) {
  e.preventDefault();
  if (S.demo) { toast('Saia dos dados de exemplo antes de mudar os ajustes.', 'err'); return; }
  const closing = Math.round(parseNum($('cClosing').value));
  const due = Math.round(parseNum($('cDue').value));
  if (!(closing >= 1 && closing <= 31) || !(due >= 1 && due <= 31)) { toast('Os dias precisam estar entre 1 e 31.', 'err'); return; }
  if (closing === due) { toast('O fechamento e o vencimento não podem ser no mesmo dia.', 'err'); return; }
  S.card = { closing, due, byInvoice: $('cByInvoice').checked, updatedAt: nowISO() };
  persist();
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  renderAll();
  toast('Cartão salvo. Os meses já foram recalculados.');
}

// ------------------------------------------------------------------ backup
function daysSince(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  return Number.isFinite(ms) ? Math.floor(ms / 86400000) : null;
}
function readLS(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignora */ } }

function renderBackup() {
  const tx = live(S.tx);
  const inv = live(S.inv);
  const months = [...new Set(tx.map((t) => String(t.date || '').slice(0, 7)).filter(Boolean))].sort();
  $('bkInfo').innerHTML = `
    <div><span>Lançamentos</span><b>${tx.length}</b></div>
    <div><span>Meses com lançamentos</span><b>${months.length ? `${esc(monthTitle(months[0]))} a ${esc(monthTitle(months[months.length - 1]))}` : '—'}</b></div>
    <div><span>Investimentos e reservas</span><b>${inv.length}</b></div>`;
  if (document.activeElement !== $('deviceName')) $('deviceName').value = readLS(LS_DEVICE);

  const last = readLS(LS_LAST);
  const d = daysSince(last);
  $('bkLast').textContent = last
    ? `Último backup baixado neste aparelho: ${d === 0 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`}.`
    : 'Você ainda não baixou nenhum backup neste aparelho.';

  // Lembrete no Resumo quando faz tempo que não baixa backup
  const n = $('notice');
  if (!S.demo && tx.length >= 5 && (d === null || d >= 7)) {
    n.className = 'notice warn';
    n.innerHTML = `<span>${d === null ? 'Você ainda não fez nenhum backup.' : `Faz ${d} dias desde o último backup.`} Se o navegador for limpo, os dados somem.</span>
      <button type="button" class="btn small danger" data-goto="backup">Fazer backup</button>`;
    n.hidden = S.view === 'backup';
  } else {
    n.hidden = true;
  }
}

function slug(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
}

function buildBackup() {
  const device = readLS(LS_DEVICE).trim();
  const now = new Date();
  const stamp = `${todayISO()}_${String(now.getHours()).padStart(2, '0')}h${String(now.getMinutes()).padStart(2, '0')}`;
  const data = {
    app: 'meu-caixa', version: 1, device, exportedAt: now.toISOString(),
    tx: S.tx, inv: S.inv, extraCats: S.extraCats, card: S.card, fixed: S.fixed, wallets: S.wallets
  };
  const name = `meucaixa-${slug(device) || 'backup'}-${stamp}.json`;
  return { name, text: JSON.stringify(data, null, 1) };
}

function exportBackup() {
  if (S.demo) { toast('Saia dos dados de exemplo antes de fazer backup.', 'err'); return; }
  const { name, text } = buildBackup();
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  writeLS(LS_LAST, nowISO());
  renderBackup();
  toast(`Backup baixado: ${name}`);
}

async function shareBackup() {
  if (S.demo) { toast('Saia dos dados de exemplo antes de fazer backup.', 'err'); return; }
  const { name, text } = buildBackup();
  try {
    const file = new File([text], name, { type: 'application/json' });
    await navigator.share({ files: [file], title: 'Backup Meu Caixa' });
    writeLS(LS_LAST, nowISO());
    renderBackup();
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    toast('Não deu para enviar daqui. Use "Baixar backup".', 'err');
  }
}

async function importBackups(files) {
  if (S.demo) { toast('Saia dos dados de exemplo antes de juntar backups.', 'err'); return; }
  const tot = { tx: { added: 0, updated: 0, removed: 0, same: 0 }, inv: { added: 0, updated: 0, removed: 0, same: 0 } };
  const ok = [];
  const bad = [];
  for (const f of files) {
    try {
      const data = JSON.parse(await f.text());
      if (!data || (data.app && data.app !== 'meu-caixa') || !Array.isArray(data.tx)) throw new Error('formato');
      const a = mergeList(S.tx, data.tx);
      S.tx = a.list;
      const b = mergeList(S.inv, Array.isArray(data.inv) ? data.inv : []);
      S.inv = b.list;
      for (const k of ['added', 'updated', 'removed', 'same']) { tot.tx[k] += a[k]; tot.inv[k] += b[k]; }
      if (data.card && String(data.card.updatedAt || '') > S.card.updatedAt) S.card = normalizeCard(data.card);
      if (Array.isArray(data.fixed)) S.fixed = mergeList(S.fixed, data.fixed).list;
      if (data.wallets && String(data.wallets.updatedAt || '') > S.wallets.updatedAt) S.wallets = normalizeWallets(data.wallets);
      const cats = normalizeCats(data.extraCats);
      for (const k of Object.keys(cats)) S.extraCats[k] = [...new Set([...(S.extraCats[k] || []), ...cats[k]])];
      ok.push(data.device ? `${f.name} (${data.device})` : f.name);
    } catch (e) {
      bad.push(f.name);
    }
  }
  if (ok.length) persist();
  renderAll();

  const res = $('importResult');
  const parts = [];
  if (ok.length) {
    parts.push(`<b>${ok.length === 1 ? 'Backup juntado' : `${ok.length} backups juntados`}.</b>`);
    parts.push(`Lançamentos: ${tot.tx.added} novos, ${tot.tx.updated} atualizados, ${tot.tx.removed} excluídos, ${tot.tx.same} já estavam iguais.`);
    parts.push(`Investimentos: ${tot.inv.added} novos, ${tot.inv.updated} atualizados, ${tot.inv.removed} excluídos.`);
  }
  if (bad.length) parts.push(`<span style="color:var(--red)">Não reconheci: ${bad.map(esc).join(', ')}. Use arquivos baixados pelo Meu Caixa.</span>`);
  res.innerHTML = parts.join('<br>');
  res.hidden = false;
  if (ok.length) toast('Backups juntados.');
}

// ------------------------------------------------------------------ ações
function setView(v) {
  S.view = v;
  try { if (location.hash !== '#' + v) history.replaceState(null, '', '#' + v); } catch (e) { /* ignora */ }
  renderAll();
  window.scrollTo({ top: 0 });
}

function blockDemo() {
  if (S.demo) { toast('Saia dos dados de exemplo para lançar os seus.', 'err'); return true; }
  if (!store) { toast('Ainda carregando seus dados…', 'err'); return true; }
  return false;
}

function buildItems(base, n) {
  const createdAt = new Date().toISOString();
  if (n <= 1) return [{ ...base, id: rid(), createdAt }];
  // Todas as parcelas guardam a data da compra; a parcela N cai na N-ésima fatura (v: 2)
  const part = round2(base.amount / n);
  const grupo = rid();
  const items = [];
  for (let i = 0; i < n; i++) {
    const amount = i < n - 1 ? part : round2(base.amount - part * (n - 1));
    items.push({ ...base, id: rid() + i, amount, parcela: i + 1, parcelas: n, grupo, total: base.amount, v: 2, createdAt });
  }
  return items;
}

async function submitTx(e) {
  e.preventDefault();
  if (blockDemo()) return;
  const amount = round2(parseNum($('fAmount').value));
  if (!(amount > 0)) { toast('Digite o valor.', 'err'); $('fAmount').focus(); return; }
  const date = $('fDate').value || todayISO();
  let cat = S.formType === 'transf' ? '' : $('fCat').value;
  if (cat === '__new') {
    cat = $('fCatNew').value.trim();
    if (!cat) { toast('Digite o nome da nova categoria.', 'err'); $('fCatNew').focus(); return; }
    if (!catsFor(S.formType).includes(cat)) {
      S.extraCats[S.formType] = [...(S.extraCats[S.formType] || []), cat];
      store.putCats().catch(() => {});
    }
  }
  const type = S.formType;
  const method = type === 'gasto' ? S.gastoMethod : type === 'entrada' ? S.entradaMethod : type === 'transf' ? S.transfDir : '';
  const desc = $('fDesc').value.trim();
  const move = type === 'transf' ? { from: TRANSF_DIRS[method].from, to: TRANSF_DIRS[method].to } : {};
  const btn = $('saveTx');
  btn.disabled = true;
  try {
    if (S.editing) {
      const old = src().tx.find((t) => t.id === S.editing);
      if (!old) throw new Error('missing');
      const { from: _f, to: _t, ...rest } = old;
      await store.putTx({ ...rest, type, amount, date, cat, desc, method, ...move });
      S.editing = null;
      toast('Lançamento atualizado.');
    } else {
      const n = type === 'gasto' && method === 'credito' ? (parseInt($('fParc').value, 10) || 1) : 1;
      const items = buildItems({ type, amount, date, cat, desc, method, ...move }, n);
      for (const it of items) await store.putTx(it);
      const fatMsg = method === 'credito' && S.card.byInvoice && type === 'gasto' ? ` Vai para a fatura de ${monthTitle(txMonth(items[0]))}.` : '';
      toast((n > 1 ? `Compra lançada em ${n} parcelas.` : type === 'entrada' ? `Entrada de ${brl(amount)} salva.` : type === 'gasto' ? `Gasto de ${brl(amount)} salvo.` : type === 'transf' ? `${TRANSF_DIRS[method].label} de ${brl(amount)} salvo.` : `${brl(amount)} guardados.`) + fatMsg);
    }
    $('fAmount').value = '';
    $('fDesc').value = '';
    $('fCatNew').value = '';
    $('fParc').value = '1';
    if (date.slice(0, 7) !== S.month) S.month = date.slice(0, 7);
    renderAll();
    if (cat) $('fCat').value = cat;
    $('fCatNewWrap').hidden = true;
  } catch (err) {
    /* aviso já mostrado pelo armazenamento */
  } finally {
    btn.disabled = false;
  }
}

function startEdit(id) {
  const t = src().tx.find((x) => x.id === id);
  if (!t) return;
  S.editing = id;
  S.formType = t.type;
  if (t.type === 'gasto' && t.method) S.gastoMethod = t.method;
  if (t.type === 'entrada' && t.method) S.entradaMethod = t.method;
  if (t.type === 'transf' && TRANSF_DIRS[t.method]) S.transfDir = t.method;
  setView('lancar');
  $('fAmount').value = toInput(parseNum(t.amount));
  $('fDate').value = t.date;
  $('fDesc').value = t.desc || '';
  fillCatSelect();
  if (t.type !== 'transf') $('fCat').value = catsFor(t.type).includes(t.cat) ? t.cat : 'Outros';
  $('fCatNewWrap').hidden = true;
}

function stopEdit() {
  S.editing = null;
  $('fAmount').value = '';
  $('fDesc').value = '';
  $('fDate').value = todayISO();
  renderAll();
}

async function onListClick(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const id = b.dataset.id;
  if (act === 'edit') { if (!blockDemo()) startEdit(id); return; }
  if (act === 'del') { if (blockDemo()) return; S.pendingDel = id; renderExtrato(); return; }
  if (act === 'del-cancel') { S.pendingDel = null; renderExtrato(); return; }
  if (act === 'del-one' || act === 'del-group') {
    const t = live(S.tx).find((x) => x.id === id);
    const ids = act === 'del-group' && t && t.grupo ? live(S.tx).filter((x) => x.grupo === t.grupo).map((x) => x.id) : [id];
    S.pendingDel = null;
    try {
      for (const x of ids) await store.delTx(x);
      toast(ids.length > 1 ? `${ids.length} parcelas excluídas.` : 'Lançamento excluído.');
    } catch (err) { /* aviso já mostrado */ }
    renderAll();
  }
}

async function submitInv(e) {
  e.preventDefault();
  if (blockDemo()) return;
  const name = $('iName').value.trim();
  if (!name) { toast('Dê um nome ao investimento.', 'err'); $('iName').focus(); return; }
  const applied = round2(parseNum($('iApplied').value));
  let current = round2(parseNum($('iCurrent').value));
  if (!current && applied) current = applied;
  const old = S.invEditing ? live(S.inv).find((p) => p.id === S.invEditing) : null;
  const item = { ...(old || {}), id: old ? old.id : rid(), name, kind: $('iKind').value, applied, current, note: $('iNote').value.trim(), updatedAt: todayISO() };
  try {
    await store.putInv(item);
    toast(old ? 'Investimento atualizado.' : 'Investimento adicionado.');
    resetInvForm();
  } catch (err) { /* aviso já mostrado */ }
}

function resetInvForm() {
  S.invEditing = null;
  ['iName', 'iApplied', 'iCurrent', 'iNote'].forEach((id) => { $(id).value = ''; });
  $('invEditBar').hidden = true;
  $('invFormTitle').textContent = 'Adicionar investimento';
  $('saveInv').textContent = 'Adicionar';
  renderAll();
}

async function onInvClick(e) {
  const b = e.target.closest('[data-iact]');
  if (!b) return;
  const act = b.dataset.iact;
  const id = b.dataset.id;
  if (blockDemo()) return;
  if (act === 'edit') {
    const p = live(S.inv).find((x) => x.id === id);
    if (!p) return;
    S.invEditing = id;
    $('iName').value = p.name || '';
    $('iKind').value = INV_KINDS.includes(p.kind) ? p.kind : 'Outro';
    $('iApplied').value = toInput(parseNum(p.applied));
    $('iCurrent').value = toInput(parseNum(p.current));
    $('iNote').value = p.note || '';
    $('invEditBar').hidden = false;
    $('invFormTitle').textContent = p.name;
    $('saveInv').textContent = 'Salvar valores';
    $('iCurrent').focus();
    $('invForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  if (act === 'del') { S.pendingInvDel = id; renderPatrimonio(); return; }
  if (act === 'del-no') { S.pendingInvDel = null; renderPatrimonio(); return; }
  if (act === 'del-yes') {
    S.pendingInvDel = null;
    try { await store.delInv(id); toast('Investimento excluído.'); } catch (err) { /* aviso já mostrado */ }
    renderAll();
  }
}

function bind() {
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => setView(t.dataset.view)));
  document.addEventListener('click', (e) => {
    const go = e.target.closest('[data-goto]');
    if (go) setView(go.dataset.goto);
    if (e.target.id === 'seeDemo') { S.demo = true; renderAll(); }
  });
  $('exitDemo').addEventListener('click', () => { S.demo = false; renderAll(); });
  $('prevMonth').addEventListener('click', () => { S.month = addMonths(S.month, -1); S.pendingDel = null; renderAll(); });
  $('nextMonth').addEventListener('click', () => { S.month = addMonths(S.month, 1); S.pendingDel = null; renderAll(); });

  document.querySelectorAll('#txForm .seg button').forEach((b) => b.addEventListener('click', () => {
    S.formType = b.dataset.type;
    renderForm();
  }));
  $('fMethods').addEventListener('click', (e) => {
    const c = e.target.closest('[data-method]');
    if (!c) return;
    if (S.formType === 'gasto') S.gastoMethod = c.dataset.method;
    else if (S.formType === 'transf') S.transfDir = c.dataset.method;
    else S.entradaMethod = c.dataset.method;
    renderForm();
  });
  $('fCat').addEventListener('change', () => {
    $('fCatNewWrap').hidden = $('fCat').value !== '__new';
    if (!$('fCatNewWrap').hidden) $('fCatNew').focus();
  });
  $('fParc').innerHTML = Array.from({ length: 24 }, (_, i) => `<option value="${i + 1}">${i === 0 ? 'À vista (1×)' : `${i + 1}×`}</option>`).join('');
  ['fAmount', 'fDate', 'fParc'].forEach((id) => $(id).addEventListener('input', updateParcInfo));
  $('fDate').value = todayISO();
  $('txForm').addEventListener('submit', submitTx);
  $('cancelEdit').addEventListener('click', stopEdit);

  document.querySelectorAll('#fType button').forEach((b) => b.addEventListener('click', () => { S.filter.type = b.dataset.f; renderExtrato(); }));
  $('fSearch').addEventListener('input', (e) => { S.filter.q = e.target.value; renderExtrato(); });
  $('toggleFilters').addEventListener('click', () => {
    const open = $('filterPanel').hidden;
    $('filterPanel').hidden = !open;
    $('toggleFilters').setAttribute('aria-expanded', String(open));
  });
  const onF = (id, key, ev = 'change') => $(id).addEventListener(ev, (e) => { S.filter[key] = e.target.value; renderExtrato(); });
  onF('fMethodFilter', 'method');
  onF('fCatFilter', 'cat');
  onF('fPeriod', 'period');
  onF('fFrom', 'from');
  onF('fTo', 'to');
  onF('fSort', 'sort');
  onF('fMin', 'min', 'input');
  onF('fMax', 'max', 'input');
  $('clearFilters').addEventListener('click', () => {
    S.filter = { ...DEFAULT_FILTER, type: S.filter.type, q: S.filter.q };
    $('fMin').value = '';
    $('fMax').value = '';
    renderExtrato();
  });
  $('btnPdf').addEventListener('click', exportPdf);
  $('txList').addEventListener('click', onListClick);

  $('iKind').innerHTML = INV_KINDS.map((k) => `<option value="${esc(k)}">${esc(k)}</option>`).join('');
  $('invForm').addEventListener('submit', submitInv);
  $('cancelInvEdit').addEventListener('click', resetInvForm);
  $('invList').addEventListener('click', onInvClick);

  let lastW = 0;
  window.addEventListener('resize', () => {
    clearTimeout(bind.rt);
    bind.rt = setTimeout(() => {
      const w = $('trend').clientWidth;
      if (S.view === 'resumo' && Math.abs(w - lastW) > 8) { lastW = w; $('trend').innerHTML = trendSvg(S.month); }
    }, 150);
  });

  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (VIEWS.includes(v)) { S.view = v; renderAll(); } });

  // Backup
  $('btnExport').addEventListener('click', exportBackup);
  try {
    const probe = new File(['{}'], 'x.json', { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [probe] })) {
      $('btnShare').hidden = false;
      $('btnShare').addEventListener('click', shareBackup);
    }
  } catch (e) { /* sem compartilhamento */ }
  $('btnImport').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    if (files.length) await importBackups(files);
  });
  $('deviceName').addEventListener('input', (e) => writeLS(LS_DEVICE, e.target.value.trim()));

  // Saldo inicial
  $('walletForm').addEventListener('submit', saveWallets);
  $('wClear').addEventListener('click', clearWallets);

  // Cartão
  $('cardForm').addEventListener('submit', saveCard);
  ['cClosing', 'cDue'].forEach((id) => $(id).addEventListener('input', updateCardExample));
  $('cByInvoice').addEventListener('change', updateCardExample);

  // Simulação
  $('fcAddForm').addEventListener('submit', addFixed);
  $('fcFixed').addEventListener('click', onFixedClick);
  $('fcFixed').addEventListener('change', onFixedToggle);
  $('fcSalary').addEventListener('input', (e) => { S.sim.salary = e.target.value.trim() === '' ? 0 : parseNum(e.target.value); $('fcSalaryLabel').textContent = 'Salário (valor da simulação)'; updateForecastCalc(); });
  $('fcExtra').addEventListener('input', (e) => { S.sim.extra = Math.max(0, parseNum(e.target.value)); updateForecastCalc(); });
  $('fcReset').addEventListener('click', () => { S.sim = { ym: '', salary: null, extra: 0, off: new Set() }; renderAll(); });

  // Aparência
  $('darkTheme').checked = readLS(LS_THEME) === 'dark';
  $('darkTheme').addEventListener('change', (e) => {
    writeLS(LS_THEME, e.target.checked ? 'dark' : 'light');
    applyTheme();
    renderAll();
  });
  $('themeBtn').addEventListener('click', () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    writeLS(LS_THEME, dark ? 'light' : 'dark');
    applyTheme();
    renderAll();
  });

  // Outra aba/janela deste aparelho salvou algo: recarrega os dados
  window.addEventListener('storage', (e) => { if (e.key === LS_KEY) { loadLocal(); renderAll(); } });
}

// ------------------------------------------------------------------ tema (claro por padrão)
const LS_THEME = 'meucaixa_tema';
function applyTheme() {
  const dark = readLS(LS_THEME) === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#101B2D' : '#2D5CD3');
}

function init() {
  applyTheme();
  S.month = todayISO().slice(0, 7);
  const h = location.hash.slice(1);
  if (VIEWS.includes(h)) S.view = h;
  S.mode = 'local';
  store = localStore();
  S.ready = true;
  bind();
  renderAll();

  // Pede ao navegador para não apagar os dados sozinho
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignora */ }
  // Funciona sem internet quando aberto por um link (https)
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
