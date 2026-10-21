// Teste de fluxo do push de pedidos (npm run test:push).
// PedidosService REAL + Postgres REAL (PGlite, em memoria, rodando as migrations do
// Supabase) + SAP falso (http local). Nao precisa de credenciais nem de rede.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const API = path.join(__dirname, '..', 'dist');
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations') + path.sep;
const { PGlite } = require('@electric-sql/pglite');
const { PedidosService } = require(path.join(API, 'pedidos/pedidos.service.js'));
const { SapClient } = require(path.join(API, 'sap/sap.client.js'));
const { SyncService } = require(path.join(API, 'sync/sync.service.js'));
const { PainelService } = require(path.join(API, 'painel/painel.service.js'));
const { UsuariosService } = require(path.join(API, 'painel/usuarios.service.js'));
const { MonitorService } = require(path.join(API, 'painel/monitor.service.js'));
const { IndicadoresService } = require(path.join(API, 'painel/indicadores.service.js'));
const { PedidoPainelService } = require(path.join(API, 'painel/pedido-painel.service.js'));
const { CatalogoPainelService } = require(path.join(API, 'painel/catalogo-painel.service.js'));
const { ConsultaPainelService } = require(path.join(API, 'painel/consulta-painel.service.js'));

// ---------------- supabase falso, sobre PGlite ----------------
const val = (v) => (v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v);
// PostgREST devolve coluna `date` como 'AAAA-MM-DD' e timestamps como ISO; o PGlite devolve Date em ambos
const fixRow = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => {
  if (!(v instanceof Date)) return [k, v];
  const iso = v.toISOString();
  return [k, iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso];
}));

class Q {
  constructor(db, table) { Object.assign(this, { db, table, op: 'select', cols: '*', f: [], lim: null, ord: null, single: false }); }
  select(c) { if (this.op !== 'select') this.ret = c; else this.cols = c; return this; }
  ilike(c, v) { this.f.push([c, 'ilike', v]); return this; }
  eq(c, v) { this.f.push([c, '=', v]); return this; }
  neq(c, v) { this.f.push([c, '<>', v]); return this; }
  gte(c, v) { this.f.push([c, '>=', v]); return this; }
  gt(c, v) { this.f.push([c, '>', v]); return this; }
  lte(c, v) { this.f.push([c, '<=', v]); return this; }
  lt(c, v) { this.f.push([c, '<', v]); return this; }
  is(c, v) { this.f.push([c, v === null ? 'is' : '=', v]); return this; }
  in(c, arr) { this.f.push([c, 'in', arr]); return this; }
  limit(n) { this.lim = n; return this; }
  order(c, o) { this.ord = [c, o && o.ascending === false ? 'desc' : 'asc']; return this; }
  maybeSingle() { this.single = true; return this.run(); }
  upsert(o, opts) { this.op = 'upsert'; this.obj = o; this.opts = opts || {}; return this; }
  update(o) { this.op = 'update'; this.obj = o; return this; }
  insert(o) { this.op = 'insert'; this.obj = o; return this; }
  delete() { this.op = 'delete'; return this; }
  not(c, o, v) { this.f.push([c, o === 'is' && v === null ? 'notnull' : 'notis', v]); return this; }
  then(res, rej) { return this.run().then(res, rej); }
  where(params) {
    if (!this.f.length) return '';
    return ' where ' + this.f.map(([c, o, v]) => {
      if (o === 'in') { params.push(v); return `${c} = any($${params.length})`; }
      if (o === 'is') return `${c} is null`;
      if (o === 'notnull') return `${c} is not null`;
      params.push(val(v));
      return `${c} ${o} $${params.length}`;
    }).join(' and ');
  }
  async run() {
    try {
      const params = [];
      if (this.op === 'select') {
        let sql = `select ${this.cols} from ${this.table}${this.where(params)}`;
        if (this.ord) sql += ` order by ${this.ord[0]} ${this.ord[1]}`;
        if (this.lim) sql += ` limit ${this.lim}`;
        const rows = (await this.db.query(sql, params)).rows.map(fixRow);
        return { data: this.single ? rows[0] ?? null : rows, error: null };
      }
      if (this.op === 'upsert' && Array.isArray(this.obj)) {
        for (const linha of this.obj) {
          const cols = Object.keys(linha);
          const ps = cols.map((c) => val(linha[c]));
          const chaves = this.opts.onConflict.split(',');
          const upd = cols.filter((c) => !chaves.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
          await this.db.query(`insert into ${this.table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) on conflict (${this.opts.onConflict}) do update set ${upd}`, ps);
        }
        return { data: null, error: null };
      }
      if (this.op === 'insert' || this.op === 'upsert') {
        const cols = Object.keys(this.obj);
        cols.forEach((c) => params.push(val(this.obj[c])));
        let sql = `insert into ${this.table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
        if (this.op === 'upsert') {
          const chaves = String(this.opts.onConflict || '').split(',');
          const upd = cols.filter((c) => !chaves.includes(c)).map((c) => `${c} = excluded.${c}`).join(', ');
          if (this.opts.ignoreDuplicates) sql += ` on conflict (${this.opts.onConflict}) do nothing`;
          else if (this.opts.onConflict) sql += ` on conflict (${this.opts.onConflict}) do update set ${upd}`;
        }
        if (this.ret) sql += ` returning ${this.ret}`;
        const rr = await this.db.query(sql, params);
        if (this.ret) return { data: this.single ? rr.rows[0] ?? null : rr.rows, error: null };
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        await this.db.query(`delete from ${this.table}${this.where(params)}`, params);
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        const cols = Object.keys(this.obj);
        cols.forEach((c) => params.push(val(this.obj[c])));
        const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        const r = await this.db.query(`update ${this.table} set ${set}${this.where(params)}${this.ret ? ` returning ${this.ret}` : ''}`, params);
        if (this.ret) return { data: this.single ? r.rows[0] ?? null : r.rows, error: null };
        return { data: null, error: null };
      }
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  }
}
const storageLog = { urls: [], removidos: [], buckets: [] };
const fakeSb = (db) => ({
  storage: {
    createBucket: async (nome) => { storageLog.buckets.push(nome); return { error: null }; },
    from: (bucket) => ({
      createSignedUploadUrl: async (caminho) => { storageLog.urls.push({ bucket, caminho }); return { data: { signedUrl: `http://storage/${bucket}/${caminho}`, token: 'tok-' + caminho.length, path: caminho }, error: null }; },
      remove: async (caminhos) => { storageLog.removidos.push(...caminhos); return { error: null }; },
      createSignedUrls: async (caminhos) => ({ data: caminhos.map((c) => ({ path: c, signedUrl: `http://storage/assinada/${c}?t=1`, error: null })), error: null }),
    }),
  },
  from: (t) => new Q(db, t),
  rpc: async (fn, args) => {
    try {
      const names = Object.keys(args || {});
      const sql = `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      const rows = (await db.query(sql, names.map((n) => args[n]))).rows.map(fixRow);
      return { data: rows, error: null };
    } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
  },
});

// ---------------- SAP falso ----------------
let sapRespostas = []; // fila de {status, body|raw}
let sapChamadas = []; // so POSTs ACEITOS pelo CSRF
let sapGets = []; // fila de respostas para GET de dados (pedidos/itens); vazia = resposta padrao
let sapGetUrls = [];
// CSRF como no ICF REST do SAP: POST exige token + cookie de sessao obtidos num GET "X-CSRF-Token: Fetch"
const csrf = { token: 'tok-A', cookie: 'SAP_SESSIONID_QAS_100=abc123', entregaToken: true, buscas: 0, rejeicoes: 0 };
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'GET') {
      if (req.headers['x-csrf-token'] === 'Fetch') {
        csrf.buscas++;
        if (csrf.entregaToken) {
          res.setHeader('x-csrf-token', csrf.token);
          res.setHeader('set-cookie', [csrf.cookie + '; path=/; HttpOnly', 'sap-usercontext=sap-client=100; path=/']);
        }
      }
      res.setHeader('content-type', 'application/json');
      if (req.headers['x-csrf-token'] !== 'Fetch' && sapGets.length) {
        sapGetUrls.push(req.url);
        const g = sapGets.shift();
        res.statusCode = g.status;
        res.end(JSON.stringify(g.body));
        return;
      }
      res.end(JSON.stringify({ LISTAS: [], GRUPOS: [] }));
      return;
    }
    if (req.headers['x-csrf-token'] !== csrf.token || !(req.headers.cookie || '').includes(csrf.cookie)) {
      csrf.rejeicoes++;
      res.statusCode = 403;
      res.setHeader('x-csrf-token', 'Required');
      res.end('CSRF token validation failed');
      return;
    }
    sapChamadas.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    const r = sapRespostas.shift() || { status: 500, body: { ERRO: 'sem resposta programada' } };
    setTimeout(() => {
      res.statusCode = r.status;
      if (r.raw !== undefined) { res.setHeader('content-type', 'text/html'); res.end(r.raw); }
      else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(r.body)); }
    }, r.delay || 0);
  });
});

// resposta no formato real do ABAP (chaves MAIUSCULAS, textos com espacos)
const OK = (codigo, ordens, dt = '2026-10-05') => ({ status: 201, body: {
  SUCESSO: 'true', PARCIAL: 'false', CODIGO_INTERNO: codigo, DT_ENTREGA: dt,
  ORDENS: ordens.map(([o, t, v]) => ({ ORDEM: o + '   ', TIPO_MATERIAL: t, VKORG: v, DUPLICADO: 'false' })), MENSAGENS: [] } });

// ---------------- util ----------------
let falhas = 0;
const t = async (nome, fn) => {
  try { await fn(); console.log('  OK    ' + nome); }
  catch (e) {
    falhas++;
    console.log('  FALHOU ' + nome);
    console.log('        msg      = ' + String(e.message).slice(0, 300)); console.log('        actual   = ' + JSON.stringify(e.actual));
    console.log('        expected = ' + JSON.stringify(e.expected));
    console.log('        ' + (String(e.stack).split(String.fromCharCode(10)).find((l) => l.includes('flow.test')) || e.message).trim());
  }
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const porta = server.address().port;

  const db = new PGlite();
  for (const f of fs.readdirSync(MIG).sort()) await db.exec(fs.readFileSync(MIG + f, 'utf8'));
  await db.exec(`insert into rota_clientes(rota,cod_cliente,dia_semana,sequencia) values ('R1','1048753',1,1),('R1','1027186',1,2);`);

  const cfg = { getOrThrow: (k) => ({ SAP_BASE_URL: `http://localhost:${porta}/sap/bc/apis_pole`, SAP_USER: 'abap', SAP_PASSWORD: 'x' }[k]), get: (k) => (k === 'SAP_TIMEOUT_MS' ? 5000 : undefined) };
  const svc = new PedidosService(fakeSb(db), new SapClient(cfg));
  const V = { email: 'a@b.c', codVendedor: '100409', rota: 'R1' };
  const prazo = () => Date.now() + 25000;
  const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const base = (n, extra = {}) => ({ id: U(n), criado_no_app_em: new Date().toISOString(), cod_cliente: '1048753',
    itens: [{ produto: '1234', unidade: 'cx', quantidade: '10', preco: '25,5' }, { produto: '77', unidade: 'UN', quantidade: '2' }], ...extra });
  const linha = async (n) => (await db.query(`select * from pedidos_app where id='${U(n)}'`)).rows[0];

  console.log('\nFluxo do push de pedidos\n');

  await t('1. pedido novo: SAP cria FERT+HAWA -> enviado, com ordens e data de entrega', async () => {
    sapRespostas = [OK('0000001', [['5631707', 'FERT', '2100'], ['5631708', 'HAWA', '2014']])];
    const r = await svc.receber(V, base(1), prazo());
    assert.equal(r.status, 'enviado'); assert.equal(r.codigo, '0000001');
    assert.deepEqual(r.ordens.map((o) => o.ordem), ['5631707', '5631708']); // espacos aparados
    assert.equal(r.dt_entrega, '2026-10-05');
    const c = sapChamadas[0];
    assert.ok(c.url.endsWith('/poletech/salespole/salespole_criar_pedido'), c.url);
    assert.ok(c.auth.startsWith('Basic '));
    assert.equal(c.body.codigo_interno, '0000001'); assert.equal(c.body.codvendedor, '100409');
    assert.deepEqual(c.body.itens[0], { produto: '1234', unidade: 'CX', quantidade: '10', preco: '25.5' }); // normalizado
    assert.equal(c.body.itens[1].preco, '');
    assert.match(c.body.dt_criacao, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok((await linha(1)).enviado_sap_em);
  });

  await t('2. reenvio do MESMO pedido: nao chama o SAP de novo e devolve o mesmo resultado', async () => {
    const antes = sapChamadas.length;
    const r = await svc.receber(V, base(1), prazo());
    assert.equal(sapChamadas.length, antes); assert.equal(r.status, 'enviado'); assert.equal(r.codigo, '0000001');
  });

  await t('3. SAP fora do ar (503): fica na fila com proxima tentativa; depois do prazo, retenta e envia', async () => {
    sapRespostas = [{ status: 503, body: { ERRO: 'indisponivel' } }];
    const r = await svc.receber(V, base(2, { cod_cliente: '1027186' }), prazo());
    assert.equal(r.status, 'recebido'); assert.equal(r.tentativas, 1); assert.match(r.erro, /indisponivel/);
    assert.ok((await linha(2)).proxima_tentativa_em);
    assert.equal((await db.query(`select * from fn_pedidos_pendentes(10)`)).rows.length, 0); // ainda nao venceu
    await db.exec(`update pedidos_app set proxima_tentativa_em = now() - interval '1 second' where id='${U(2)}'`);
    assert.equal((await db.query(`select * from fn_pedidos_pendentes(10)`)).rows.length, 1);
    sapRespostas = [OK('0000002', [['5631800', 'FERT', '2100']])];
    const row = await svc.tentarEnviar(U(2));
    assert.equal(row.status, 'enviado'); assert.equal(row.tentativas, 2);
  });

  await t('4. erro de negocio (422): vai direto para erro, SEM retentar sozinho; reenviar forcado funciona', async () => {
    sapRespostas = [{ status: 422, body: { SUCESSO: 'false', PARCIAL: 'false', MENSAGENS: [{ TIPO: 'E', MENSAGEM: 'Cliente bloqueado para vendas' }] } }];
    const r = await svc.receber(V, base(3, { itens: [{ produto: '9', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(r.status, 'erro'); assert.match(r.erro, /Cliente bloqueado/);
    assert.equal((await db.query(`select * from fn_pedidos_pendentes(10)`)).rows.length, 0); // nao entra na fila
    sapRespostas = [OK('0000003', [['5631900', 'FERT', '2100']])];
    const r2 = await svc.reenviar(V, U(3));
    assert.equal(r2.status, 'enviado');
  });

  await t('5. pedido parcial (so FERT criada): status parcial com a ordem; retentar cria a que falta', async () => {
    sapRespostas = [{ status: 422, body: { SUCESSO: 'false', PARCIAL: 'true', CODIGO_INTERNO: '0000004', DT_ENTREGA: '2026-10-06',
      ORDENS: [{ ORDEM: '5632000', TIPO_MATERIAL: 'FERT', VKORG: '2100', DUPLICADO: 'false' }],
      MENSAGENS: [{ TIPO: 'E', MENSAGEM: '[HAWA] Cliente sem area de vendas' }] } }];
    const r = await svc.receber(V, base(4, { itens: [{ produto: '1', unidade: 'CX', quantidade: '1' }, { produto: '2', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(r.status, 'parcial'); assert.equal(r.ordens.length, 1); assert.ok((await linha(4)).proxima_tentativa_em);
    sapRespostas = [OK('0000004', [['5632000', 'FERT', '2100'], ['5632001', 'HAWA', '2014']])];
    const row = await svc.tentarEnviar(U(4));
    assert.equal(row.status, 'enviado'); assert.equal(row.ordens_sap.length, 2);
  });

  await t('6. SAP devolve pagina HTML (ex.: 401 Logon Error): trata como transitorio, nao quebra', async () => {
    sapRespostas = [{ status: 401, raw: '<html><head><title>Logon Error Message</title></head></html>' }];
    const r = await svc.receber(V, base(5, { itens: [{ produto: '3', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(r.status, 'recebido'); assert.match(r.erro, /Logon Error Message/);
  });

  await t('7. dois envios SIMULTANEOS do mesmo pedido: o SAP e chamado UMA vez so', async () => {
    const antes = sapChamadas.length;
    sapRespostas = [{ ...OK('0000006', [['5633000', 'FERT', '2100']]), delay: 150 }];
    await db.exec(`insert into pedidos_app(id,cod_vendedor,cod_cliente,criado_no_app_em,itens,itens_hash,status) values ('${U(6)}','100409','1048753',now(),'[{"produto":"1","unidade":"CX","quantidade":"1","preco":null}]','h6','recebido')`);
    const [a, b] = await Promise.all([svc.tentarEnviar(U(6)), svc.tentarEnviar(U(6))]);
    assert.equal(sapChamadas.length - antes, 1);
    assert.ok([a.status, b.status].includes('enviado'));
  });

  await t('8. validacoes: payload invalido, cliente fora da carteira, id de outro vendedor', async () => {
    const antes = sapChamadas.length;
    let r = await svc.receber(V, { id: 'nao-uuid', itens: [] }, prazo());
    assert.equal(r.status, 'invalido'); assert.ok(r.erros.length >= 3);
    r = await svc.receber(V, base(7, { cod_cliente: '999999' }), prazo());
    assert.equal(r.status, 'invalido'); assert.match(r.erros[0], /carteira/);
    r = await svc.receber({ ...V, codVendedor: '100486' }, base(1), prazo());
    assert.equal(r.status, 'conflito');
    r = await svc.receber({ ...V, rota: null }, base(8), prazo());
    assert.equal(r.status, 'invalido');
    r = await svc.receber(V, base(9, { itens: [{ produto: '1', unidade: 'CX', quantidade: '0' }] }), prazo());
    assert.equal(r.status, 'invalido');
    assert.equal(sapChamadas.length, antes); // nada disso chegou ao SAP
  });

  await t('9. possivel duplicidade: mesmo cliente + mesmos itens em outro id avisa; "duplicar" consciente nao', async () => {
    sapRespostas = [OK('0000008', [['5634000', 'FERT', '2100']]), OK('0000009', [['5634001', 'FERT', '2100']])];
    const itens = [{ produto: '55', unidade: 'CX', quantidade: '3' }];
    const a = await svc.receber(V, base(10, { itens }), prazo());
    const b = await svc.receber(V, base(11, { itens }), prazo());
    assert.equal(a.possivel_duplicidade.length, 0);
    assert.equal(b.possivel_duplicidade.length, 1); assert.equal(b.possivel_duplicidade[0].codigo, a.codigo);
    sapRespostas = [OK('0000010', [['5634002', 'FERT', '2100']])];
    const c = await svc.receber(V, base(12, { itens, duplicado_de: U(10) }), prazo());
    assert.equal(c.possivel_duplicidade, undefined);
    assert.equal((await linha(12)).duplicado_de, U(10));
  });

  await t('10. esgotou as tentativas em falha temporaria -> erro definitivo', async () => {
    await db.exec(`insert into pedidos_app(id,cod_vendedor,cod_cliente,criado_no_app_em,itens,itens_hash,status,tentativas) values ('${U(13)}','100409','1048753',now(),'[{"produto":"1","unidade":"CX","quantidade":"1","preco":null}]','h13','recebido',7)`);
    sapRespostas = [{ status: 503, body: { ERRO: 'fora' } }];
    const row = await svc.tentarEnviar(U(13));
    assert.equal(row.tentativas, 8); assert.equal(row.status, 'erro'); assert.match(row.erro, /esgotou 8 tentativas/);
  });

  await t('11. historico de eventos gravado (recebido + tentativas)', async () => {
    const ev = (await db.query(`select tipo from pedido_eventos where pedido_id='${U(2)}' order by id`)).rows.map((r) => r.tipo);
    assert.deepEqual(ev, ['recebido', 'tentativa_sap', 'tentativa_sap']);
  });

  await t('12. CSRF: o token foi buscado UMA vez e reaproveitado em todos os POSTs anteriores', async () => {
    assert.equal(csrf.buscas, 1);
    assert.equal(csrf.rejeicoes, 0); // nenhum POST chegou ao SAP sem token valido
  });

  await t('13. CSRF: SAP renovou a sessao (token mudou) -> 403 Required, a API renova sozinha e o pedido segue', async () => {
    csrf.token = 'tok-B'; csrf.cookie = 'SAP_SESSIONID_QAS_100=xyz789'; // sessao antiga expirou no SAP
    const antes = sapChamadas.length;
    sapRespostas = [OK('0000020', [['5640000', 'FERT', '2100']])];
    const r = await svc.receber(V, base(20, { itens: [{ produto: '21', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(r.status, 'enviado');
    assert.equal(csrf.rejeicoes, 1); // a 1a tentativa foi recusada...
    assert.equal(csrf.buscas, 2); // ...a API buscou token novo...
    assert.equal(sapChamadas.length - antes, 1); // ...e o pedido chegou UMA vez so
  });

  await t('14. CSRF: depois de renovado, os proximos POSTs nao pedem token de novo', async () => {
    sapRespostas = [OK('0000021', [['5640001', 'FERT', '2100']])];
    await svc.receber(V, base(21, { itens: [{ produto: '22', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(csrf.buscas, 2);
    assert.equal(csrf.rejeicoes, 1);
  });

  await t('15. CSRF: SAP que NAO entrega token (servico mal configurado) -> pedido fica na fila com a causa clara', async () => {
    csrf.token = 'tok-C'; csrf.cookie = 'SAP_SESSIONID_QAS_100=ccc'; csrf.entregaToken = false;
    const r = await svc.receber(V, base(22, { itens: [{ produto: '23', unidade: 'CX', quantidade: '1' }] }), prazo());
    assert.equal(r.status, 'recebido'); // nao perde o pedido: tenta de novo depois
    assert.match(r.erro, /csrf/i);
    csrf.entregaToken = true;
  });


  // ---- trava de desconto (servidor): cliente 1048753, lista 35, caixa KI; produto D1 permite 3%, D2 nao permite, D3 e em KG ----
  await db.exec(`
    insert into clientes(cod_cliente, nome_fantasia, areas) values
      ('1048753', 'Cliente Teste', '[{"tipo_material":"FERT","centro":"2100","lista_preco":{"codigo":"35"},"rede":{"codigo":""}}]');
    insert into produtos(cod_produto, descricao, tipo_material, dados) values
      ('D1','Com desconto','FERT','{"unidade_base":"KG","conversoes":[{"unidade":"KI","fator":12}]}'),
      ('D2','Sem desconto','FERT','{"unidade_base":"KG","conversoes":[{"unidade":"KI","fator":12}]}'),
      ('D3','Tabela em KG','FERT','{"unidade_base":"KG","conversoes":[{"unidade":"KI","fator":12}]}'),
      ('D4','Sem conversao','FERT','{"unidade_base":"KG"}');
    insert into precos_lista(pltyp, cod_produto, datab, datbi, kbetr, kpein, kmein, desconto_max) values
      ('35','D1', current_date - 10, current_date + 300, 100, 1, 'KI', 3),
      ('35','D2', current_date - 10, current_date + 300, 100, 1, 'KI', 0),
      ('35','D3', current_date - 10, current_date + 300, 10, 1, 'KG', 5),
      ('35','D4', current_date - 10, current_date + 300, 10, 1, 'KG', 0);
  `);
  const dsc = (n, produto, preco, un = 'KI') => base(n, { itens: [{ produto, unidade: un, quantidade: '1', preco }] });

  await t('16. desconto dentro do maximo (3%) e aceito e segue ao SAP com o preco enviado', async () => {
    sapRespostas = [OK('0000030', [['5650000', 'FERT', '2100']])];
    const r = await svc.receber(V, dsc(30, 'D1', '97.00'), prazo());
    assert.equal(r.status, 'enviado');
    assert.equal(sapChamadas[sapChamadas.length - 1].body.itens[0].preco, '97');
  });

  await t('17. desconto ACIMA do maximo e recusado (invalido) e nao chama o SAP nem grava o pedido', async () => {
    const antes = sapChamadas.length;
    const r = await svc.receber(V, dsc(31, 'D1', '96.99'), prazo());
    assert.equal(r.status, 'invalido');
    assert.match(r.erros[0], /abaixo do minimo 97\.00/);
    assert.match(r.erros[0], /desconto maximo de 3%/);
    assert.equal(sapChamadas.length, antes);
    assert.equal(await linha(31), undefined);
  });

  await t('18. lista que NAO permite desconto: preco abaixo da tabela e recusado; igual ou acima passa', async () => {
    const r1 = await svc.receber(V, dsc(32, 'D2', '99.99'), prazo());
    assert.equal(r1.status, 'invalido'); assert.match(r1.erros[0], /sem desconto para esta lista/);
    sapRespostas = [OK('0000031', [['5650001', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(33, 'D2', '100.00'), prazo())).status, 'enviado');
    sapRespostas = [OK('0000032', [['5650002', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(34, 'D2', '105.50'), prazo())).status, 'enviado'); // acima da tabela: livre
  });

  await t('19. tabela em KG e pedido em caixa: converte (10/KG x 12 = 120/CX; 5% => minimo 114)', async () => {
    const r1 = await svc.receber(V, dsc(35, 'D3', '113.99'), prazo());
    assert.equal(r1.status, 'invalido'); assert.match(r1.erros[0], /minimo 114\.00/);
    sapRespostas = [OK('0000033', [['5650003', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(36, 'D3', '114.00'), prazo())).status, 'enviado');
  });

  await t('20. sem como calcular a tabela (sem conversao / produto desconhecido / sem preco): NAO barra', async () => {
    sapRespostas = [OK('0000034', [['5650004', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(37, 'D4', '1.00'), prazo())).status, 'enviado'); // KG->KI sem fator
    sapRespostas = [OK('0000035', [['5650005', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(38, 'ZZ', '1.00'), prazo())).status, 'enviado'); // produto fora do catalogo
    sapRespostas = [OK('0000036', [['5650006', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, dsc(39, 'D1', null), prazo())).status, 'enviado'); // sem preco: SAP aplica a lista
  });

  await t('21. reenvio de pedido ja recebido NAO revalida o desconto (a tabela pode ter mudado depois)', async () => {
    await db.exec(`update precos_lista set desconto_max = 0 where cod_produto = 'D1'`);
    const antes = sapChamadas.length;
    const r = await svc.receber(V, dsc(30, 'D1', '97.00'), prazo()); // mesmo id do teste 16
    assert.equal(r.status, 'enviado'); assert.equal(sapChamadas.length, antes);
  });


  // ---- bonificacao (aprovacao) e incentivo de desconto ----
  await db.exec(`
    insert into bonificacao_tipos(codigo, descricao) values ('115', 'Bonificacao comercial');
    insert into centros_custo(codigo, descricao) values ('2001501007', 'Comercial');
  `);
  const bon = (n, extra = {}) => base(n, { itens: [{ produto: 'D1', unidade: 'KI', quantidade: '2' }], tipo: 'bonificacao',
    tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'Cliente novo, degustacao', ...extra });

  await t('22. bonificacao: fica aguardando aprovacao e NAO chama o SAP', async () => {
    const antes = sapChamadas.length;
    const r = await svc.receber(V, bon(50), prazo());
    assert.equal(r.status, 'aguardando_aprovacao');
    assert.equal(sapChamadas.length, antes);
    const l = await linha(50);
    assert.equal(l.tipo, 'bonificacao'); assert.equal(l.justificativa, 'Cliente novo, degustacao');
    // o job de envio tambem nao pega pedido aguardando aprovacao
    const pend = (await db.query('select id from fn_pedidos_pendentes(50)')).rows.map((x) => x.id);
    assert.ok(!pend.includes(U(50)));
  });

  await t('23. bonificacao aprovada (status = aprovado) entra na fila e vai ao SAP com tipo e centro de custo, SEM justificativa', async () => {
    await db.exec(`update pedidos_app set status = 'aprovado' where id = '${U(50)}'`);
    const pend = (await db.query('select id from fn_pedidos_pendentes(50)')).rows.map((x) => x.id);
    assert.ok(pend.includes(U(50)));
    sapRespostas = [OK('0000050', [['5660000', 'FERT', '2100']])];
    const row = await svc.tentarEnviar(U(50));
    assert.equal(row.status, 'enviado');
    const c = sapChamadas[sapChamadas.length - 1].body;
    assert.equal(c.tipo, 'bonificacao'); assert.equal(c.tipo_bonificacao, '115'); assert.equal(c.centro_custo, '2001501007');
    assert.ok(!JSON.stringify(c).includes('degustacao'), 'justificativa nao pode ir ao SAP');
  });

  await t('24. bonificacao sem tipo/centro/justificativa, ou com cadastro inexistente, e invalida', async () => {
    const r1 = await svc.receber(V, bon(51, { tipo_bonificacao: '', centro_custo: '', justificativa: '' }), prazo());
    assert.equal(r1.status, 'invalido'); assert.equal(r1.erros.length, 3);
    const r2 = await svc.receber(V, bon(52, { tipo_bonificacao: '999' }), prazo());
    assert.equal(r2.status, 'invalido'); assert.match(r2.erros[0], /tipo de bonificacao 999 nao cadastrado/);
    assert.equal(await linha(52), undefined);
  });

  await t('25. venda comum continua indo direto ao SAP (tipo venda)', async () => {
    sapRespostas = [OK('0000051', [['5660001', 'FERT', '2100']])];
    const r = await svc.receber(V, dsc(53, 'D1', '100.00'), prazo());
    assert.equal(r.status, 'enviado');
    assert.equal(sapChamadas[sapChamadas.length - 1].body.tipo, 'venda');
    assert.equal(sapChamadas[sapChamadas.length - 1].body.tipo_bonificacao, '');
  });

  await t('26. incentivo libera desconto alem do maximo da lista, so a partir da quantidade minima', async () => {
    // D2 nao permite desconto; incentivo: a partir de 10 caixas, 4% + ate 2% extra = 6% liberado
    await db.exec(`insert into incentivos_desconto(cod_produto, escopo, qtd_minima, desconto_pct, desconto_extra_max_pct)
                   values ('D2', 'geral', 10, 4, 2)`);
    const item = (n, q, preco) => base(n, { itens: [{ produto: 'D2', unidade: 'KI', quantidade: q, preco }] });
    const r1 = await svc.receber(V, item(54, '9', '94.00'), prazo()); // 9 caixas: sem incentivo -> 94 < 100
    assert.equal(r1.status, 'invalido');
    sapRespostas = [OK('0000052', [['5660002', 'FERT', '2100']])];
    const r2 = await svc.receber(V, item(55, '10', '94.00'), prazo()); // 10 caixas: 6% liberado -> minimo 94
    assert.equal(r2.status, 'enviado');
    const r3 = await svc.receber(V, item(56, '10', '93.99'), prazo()); // passou de 6%
    assert.equal(r3.status, 'invalido');
  });

  await t('27. incentivo de OUTRO cliente/vendedor nao vale', async () => {
    await db.exec(`insert into incentivos_desconto(cod_produto, escopo, escopo_valor, qtd_minima, desconto_pct)
                   values ('D2', 'cliente', '9999999', 1, 50), ('D2', 'vendedor', '000000', 1, 50)`);
    const r = await svc.receber(V, base(57, { itens: [{ produto: 'D2', unidade: 'KI', quantidade: '1', preco: '60.00' }] }), prazo());
    assert.equal(r.status, 'invalido');
  });

  await t('28. incentivo por ID da LINHA (zeros a esquerda nao importam): libera desconto so para produtos da linha, a partir da quantidade', async () => {
    await db.exec(`
      insert into produtos(cod_produto, descricao, tipo_material, dados) values
        ('D5','Linha Premium','FERT','{"unidade_base":"KG","conversoes":[{"unidade":"KI","fator":12}],"classificacao":{"linha_id":"0003","marca":"Pole"}}');
      insert into precos_lista(pltyp, cod_produto, datab, datbi, kbetr, kpein, kmein, desconto_max) values
        ('35','D5', current_date - 10, current_date + 300, 100, 1, 'KI', 0);
      insert into incentivos_desconto(cod_produto, escopo, qtd_minima, desconto_pct, linha_id) values (null, 'geral', 4, 5, '3');
    `);
    const item = (n, produto, q, preco) => base(n, { itens: [{ produto, unidade: 'KI', quantidade: q, preco }] });
    // 3 caixas: abaixo da faixa -> sem desconto
    assert.equal((await svc.receber(V, item(60, 'D5', '3', '95.00'), prazo())).status, 'invalido');
    // 4 caixas: 5% da linha liberado -> minimo 95
    sapRespostas = [OK('0000060', [['5670000', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, item(61, 'D5', '4', '95.00'), prazo())).status, 'enviado');
    assert.equal((await svc.receber(V, item(62, 'D5', '4', '94.99'), prazo())).status, 'invalido');
    // produto de OUTRA linha (D4 nao tem classificacao): a regra da linha nao vale
    sapRespostas = [OK('0000061', [['5670001', 'FERT', '2100']])];
    assert.equal((await svc.receber(V, item(63, 'D4', '4', '1.00'), prazo())).status, 'enviado'); // D4 nao calcula tabela (sem conversao): nao barra
    assert.equal((await svc.receber(V, item(64, 'D1', '4', '90.00'), prazo())).status, 'invalido'); // D1: lista permite so 3%
  });

  await t('29. incentivo SEM quantidade minima (0): vale desde a primeira unidade; negativo o banco recusa', async () => {
    await db.exec(`
      insert into produtos(cod_produto, descricao, tipo_material, dados) values
        ('D6','Marca Pole','FERT','{"unidade_base":"KG","conversoes":[{"unidade":"KI","fator":12}],"classificacao":{"marca":"Pole"}}');
      insert into precos_lista(pltyp, cod_produto, datab, datbi, kbetr, kpein, kmein, desconto_max) values
        ('35','D6', current_date - 10, current_date + 300, 100, 1, 'KI', 0);
      insert into incentivos_desconto(cod_produto, escopo, qtd_minima, desconto_pct, marca) values (null, 'geral', 0, 5, 'Pole');
    `);
    sapRespostas = [OK('0000062', [['5670002', 'FERT', '2100']])];
    const item = (n, q, preco) => base(n, { itens: [{ produto: 'D6', unidade: 'KI', quantidade: q, preco }] });
    assert.equal((await svc.receber(V, item(65, '1', '95.00'), prazo())).status, 'enviado'); // 1 caixa, 5% da marca
    assert.equal((await svc.receber(V, item(66, '1', '94.99'), prazo())).status, 'invalido');
    await assert.rejects(() => db.exec(`insert into incentivos_desconto(escopo, qtd_minima, desconto_pct) values ('geral', -1, 5)`));
  });

  await t('30. corte das 17h e feriados vao ao SAP: apos_corte, e so os feriados do estado/cidade do cliente (mais os nacionais)', async () => {
    await db.exec(`
      update clientes set endereco = '{"uf":"GO","cidade":"Goiânia"}' where cod_cliente = '1048753';
      insert into feriados(data, descricao) values ('2099-01-01', 'Nacional teste');
      insert into feriados(data, descricao, uf) values ('2099-01-02', 'Estadual GO', 'GO'), ('2099-01-03', 'Estadual SP', 'SP');
      insert into feriados(data, descricao, uf, cidade) values ('2099-01-04', 'Municipal Goiania', 'GO', 'GOIANIA'), ('2099-01-05', 'Municipal Anapolis', 'GO', 'Anápolis');
      insert into feriados(data, descricao, ativo) values ('2099-01-06', 'Desativado', false);
    `);
    const item = (n, criado) => base(n, { criado_no_app_em: criado, itens: [{ produto: 'D1', unidade: 'KI', quantidade: '1' }] });

    // 21:30 UTC = 18:30 em Sao Paulo: depois do corte
    sapRespostas = [OK('0000070', [['5680000', 'FERT', '2100']])];
    await svc.receber(V, item(70, '2026-10-05T21:30:00.000Z'), prazo());
    let c = sapChamadas[sapChamadas.length - 1].body;
    assert.equal(c.apos_corte, 'true');
    const f = c.feriados.filter((d) => d.startsWith('2099'));
    assert.deepEqual(f, ['2099-01-01', '2099-01-02', '2099-01-04']); // nacional + GO + Goiania (sem acento/caixa); nao SP, nao Anapolis, nao desativado

    // 14:00 UTC = 11:00 em Sao Paulo: antes do corte
    sapRespostas = [OK('0000071', [['5680001', 'FERT', '2100']])];
    await svc.receber(V, item(71, '2026-10-05T14:00:00.000Z'), prazo());
    c = sapChamadas[sapChamadas.length - 1].body;
    assert.equal(c.apos_corte, 'false');

    // exatamente 17:00 em Sao Paulo (20:00 UTC) ja conta como depois do corte
    sapRespostas = [OK('0000072', [['5680002', 'FERT', '2100']])];
    await svc.receber(V, item(72, '2026-10-05T20:00:00.000Z'), prazo());
    assert.equal(sapChamadas[sapChamadas.length - 1].body.apos_corte, 'true');
  });

  await t('31. limpeza: cliente que o SAP deixou de mandar sai da carteira da rota (so os desatualizados, so da rota)', async () => {
    await db.exec(`
      insert into rota_clientes(rota, cod_cliente, dia_semana, sequencia) values ('R1','9100',1,3),('R1','9101',1,4),('R2','9102',1,1);
      insert into clientes(cod_cliente, nome_fantasia, synced_at) values
        ('9100','Atualizado agora', now()),
        ('9101','Antigo (lixo)', now() - interval '2 days'),
        ('9102','Antigo de OUTRA rota', now() - interval '2 days');
    `);
    const r = (await db.query(`select fn_limpar_clientes_rota('R1', now() - interval '1 minute') as n`)).rows[0].n;
    assert.equal(Number(r), 1);
    const resta = (await db.query(`select cod_cliente from clientes where cod_cliente in ('9100','9101','9102') order by 1`)).rows.map((x) => x.cod_cliente);
    assert.deepEqual(resta, ['9100', '9102']);
  });

  // ---- roteiro de visita ----
  const { VisitasService } = require(path.join(API, 'visitas/visitas.service.js'));
  const vis = new VisitasService(fakeSb(db));
  const VID = (n) => `11111111-0000-4000-8000-${String(n).padStart(12, '0')}`;
  // cliente 1048753 (Goiania): coordenadas de referencia no cadastro; 1027186 sem coordenada
  await db.exec(`update clientes set latitude = -16.6869000, longitude = -49.2648000 where cod_cliente = '1048753';
                 insert into clientes(cod_cliente, nome_fantasia) values ('1027186', 'Sem coordenada') on conflict (cod_cliente) do nothing;`);
  const visitaBase = (n, extra = {}) => ({ id: VID(n), cod_cliente: '1048753', data_visita: '2026-10-05', checkin_em: '2026-10-05T14:00:00.000Z',
    checkin_lat: -16.6869, checkin_lng: -49.2648, checkin_precisao_m: 8, ...extra });

  await t('32. visita: check-in no cliente grava a distancia calculada no servidor e fica em andamento', async () => {
    const r = await vis.receber(V, visitaBase(1));
    assert.equal(r.status, 'ok'); assert.equal(r.visita_status, 'em_andamento');
    assert.equal(r.distancia_m, 0); assert.equal(r.fora_do_raio, false); assert.equal(r.sem_referencia, false);
    assert.equal(r.validacao, 'pendente'); assert.equal(r.fachada_enviada, false);
  });

  await t('33. visita: ~500 m do cliente marca fora do raio (so avisa, a visita e gravada)', async () => {
    const r = await vis.receber(V, visitaBase(2, { checkin_lat: -16.6869 + 0.0045 })); // ~500 m ao norte
    assert.equal(r.status, 'ok'); assert.equal(r.fora_do_raio, true);
    assert.ok(r.distancia_m > 450 && r.distancia_m < 550, String(r.distancia_m));
    // 100 m: dentro dos 150 m
    const r2 = await vis.receber(V, visitaBase(3, { checkin_lat: -16.6869 + 0.0009 }));
    assert.equal(r2.fora_do_raio, false); assert.ok(r2.distancia_m > 80 && r2.distancia_m < 120, String(r2.distancia_m));
  });

  await t('34. visita: cliente sem coordenada no cadastro = sem referencia (aceita e marca)', async () => {
    const r = await vis.receber(V, visitaBase(4, { cod_cliente: '1027186' }));
    assert.equal(r.status, 'ok'); assert.equal(r.sem_referencia, true); assert.equal(r.distancia_m, null); assert.equal(r.fora_do_raio, false);
  });

  await t('35. visita: validacoes (GPS obrigatorio, cliente fora da carteira, id de outro vendedor, nao vendeu sem motivo)', async () => {
    assert.equal((await vis.receber(V, visitaBase(5, { checkin_lat: null }))).status, 'invalida');
    assert.equal((await vis.receber(V, visitaBase(6, { cod_cliente: '999999' }))).erros[0], 'Cliente fora da carteira do vendedor');
    assert.equal((await vis.receber({ ...V, codVendedor: '100486' }, visitaBase(1))).status, 'conflito');
    const semMotivo = await vis.receber(V, visitaBase(7, { checkout_em: '2026-10-05T14:30:00.000Z', resultado: 'nao_vendeu', motivo_nao_venda: ' ' }));
    assert.equal(semMotivo.status, 'invalida'); assert.match(semMotivo.erros.join(' '), /motivo_nao_venda/);
    const vendeuSemPedido = await vis.receber(V, visitaBase(8, { checkout_em: '2026-10-05T14:30:00.000Z', resultado: 'vendeu' }));
    assert.match(vendeuSemPedido.erros.join(' '), /pedido_id/);
    const antes = await vis.receber(V, visitaBase(9, { checkout_em: '2026-10-05T13:00:00.000Z', resultado: 'nao_vendeu', motivo_nao_venda: 'Loja fechada' }));
    assert.match(antes.erros.join(' '), /antes do check-in/);
  });

  await t('36. visita: check-out conclui; reenviar e idempotente e NAO muda o check-in nem o resultado ja gravado', async () => {
    await vis.receber(V, visitaBase(10));
    const co = { checkout_em: '2026-10-05T14:40:00.000Z', resultado: 'nao_vendeu', motivo_nao_venda: 'Estoque cheio', observacao: 'volto na quinta' };
    const r = await vis.receber(V, visitaBase(10, co));
    assert.equal(r.visita_status, 'concluida');
    let l = (await db.query(`select * from visitas where id = '${VID(10)}'`)).rows[0];
    assert.equal(l.resultado, 'nao_vendeu'); assert.equal(l.motivo_nao_venda, 'Estoque cheio'); assert.equal(l.observacao, 'volto na quinta');
    // tentativa de adulterar depois: posicao do check-in e resultado nao mudam
    await vis.receber(V, visitaBase(10, { ...co, checkin_lat: -10, resultado: 'vendeu', pedido_id: U(99) }));
    l = (await db.query(`select * from visitas where id = '${VID(10)}'`)).rows[0];
    assert.equal(l.resultado, 'nao_vendeu'); assert.equal(Number(l.checkin_lat), -16.6869);
    // visita ja concluida na primeira chegada (tudo offline) tambem entra
    const direto = await vis.receber(V, visitaBase(11, { checkout_em: '2026-10-05T15:00:00.000Z', resultado: 'vendeu', pedido_id: U(98) }));
    assert.equal(direto.visita_status, 'concluida');
    assert.equal((await db.query(`select pedido_id from visitas where id = '${VID(11)}'`)).rows[0].pedido_id, U(98));
  });

  await t('37. foto: preparar devolve o caminho/token no bucket privado; confirmar marca enviada e a fachada passa a contar', async () => {
    const FID = (n) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const pr = await vis.prepararFoto(V, { id: FID(1), visita_id: VID(1), tipo: 'fachada', tirada_em: '2026-10-05T14:01:00.000Z', lat: -16.6869, lng: -49.2648, tamanho_bytes: 210000 });
    assert.equal(pr.status, 'ok');
    assert.equal(pr.caminho, `100409/2026-10-05/${VID(1)}/${FID(1)}.jpg`);
    assert.ok(pr.token && pr.signed_url.includes('visitas-fotos'));
    assert.equal(storageLog.urls[storageLog.urls.length - 1].bucket, 'visitas-fotos');
    // repetir (retentativa de rede) reaproveita o registro
    const de_novo = await vis.prepararFoto(V, { id: FID(1), visita_id: VID(1), tipo: 'fachada', tirada_em: '2026-10-05T14:01:00.000Z' });
    assert.equal(de_novo.caminho, pr.caminho);
    assert.equal((await db.query(`select count(*)::int as n from visita_fotos where visita_id = '${VID(1)}'`)).rows[0].n, 1);

    assert.equal((await vis.receber(V, visitaBase(1))).fachada_enviada, false); // ainda nao confirmou
    assert.equal((await vis.confirmarFoto(V, FID(1))).status, 'ok');
    assert.equal((await vis.receber(V, visitaBase(1))).fachada_enviada, true);
    // outro vendedor nao mexe na foto
    assert.equal((await vis.confirmarFoto({ ...V, codVendedor: '100486' }, FID(1))).status, 'invalida');
    assert.equal((await vis.prepararFoto({ ...V, codVendedor: '100486' }, { id: FID(2), visita_id: VID(1), tirada_em: '2026-10-05T14:01:00.000Z' })).status, 'invalida');
    // foto grande demais e limite de fotos por visita
    assert.equal((await vis.prepararFoto(V, { id: FID(3), visita_id: VID(1), tirada_em: '2026-10-05T14:01:00.000Z', tamanho_bytes: 9_000_000 })).status, 'invalida');
    for (let i = 10; i < 15; i++) assert.equal((await vis.prepararFoto(V, { id: FID(i), visita_id: VID(1), tipo: 'outra', tirada_em: '2026-10-05T14:02:00.000Z' })).status, 'ok');
    const cheio = await vis.prepararFoto(V, { id: FID(20), visita_id: VID(1), tipo: 'outra', tirada_em: '2026-10-05T14:03:00.000Z' }); // 7a foto
    assert.equal(cheio.status, 'invalida'); assert.match(cheio.erros[0], /No maximo 6 fotos/);
  });

  await t('38. retencao: so apaga o ARQUIVO das fotos mais velhas que o prazo; a visita e a validacao ficam', async () => {
    const FID = (n) => `22222222-0000-4000-8000-${String(n).padStart(12, '0')}`;
    await db.exec(`update visita_fotos set enviada_em = now() - interval '40 days' where id = '${FID(1)}';
                   update visita_fotos set enviada_em = now() - interval '5 days' where id = '${FID(10)}';
                   update visitas set validacao = 'validada', validada_por = 'gestor' where id = '${VID(1)}';`);
    storageLog.removidos.length = 0;
    const n = await vis.limparFotosAntigas(30);
    assert.equal(n, 1);
    assert.deepEqual(storageLog.removidos, [`100409/2026-10-05/${VID(1)}/${FID(1)}.jpg`]);
    assert.ok((await db.query(`select removida_em from visita_fotos where id = '${FID(1)}'`)).rows[0].removida_em);
    assert.equal((await db.query(`select removida_em from visita_fotos where id = '${FID(10)}'`)).rows[0].removida_em, null); // 5 dias: fica
    const v1 = (await db.query(`select validacao, validada_por from visitas where id = '${VID(1)}'`)).rows[0];
    assert.deepEqual([v1.validacao, v1.validada_por], ['validada', 'gestor']);
    // rodar de novo nao apaga nada (ja marcada)
    assert.equal(await vis.limparFotosAntigas(30), 0);
  });

  await t('39. bucket das fotos: criado privado na subida da API', async () => {
    await vis.garantirBucket();
    assert.ok(storageLog.buckets.includes('visitas-fotos'));
  });

  // ---- historico longo (12 meses) ----
  // cliente 1048753 esta na rota R1; 5550001 NAO esta (nao pode entrar nos totais)
  await db.exec(`
    insert into rota_clientes(rota, cod_cliente, dia_semana, sequencia) values ('R1','1048754',2,1) on conflict do nothing;
    insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values
      ('H1', '1048753', date_trunc('month', current_date)::date,                       100, 'Faturado'),
      ('H2', '1048753', date_trunc('month', current_date)::date + 1,                    50, 'A Faturar'),
      ('H3', '1048753', (date_trunc('month', current_date) - interval '2 months')::date, 300, 'Faturado'),
      ('H4', '1048753', (date_trunc('month', current_date) - interval '11 months')::date, 70, 'Faturado'),
      ('H5', '1048753', (date_trunc('month', current_date) - interval '12 months')::date, 999, 'Faturado'),
      ('H6', '1048753', date_trunc('month', current_date)::date,                       500, 'Recusado'),
      ('H7', '5550001', date_trunc('month', current_date)::date,                       888, 'Faturado'),
      ('H8', '1048754', current_date - 200,                                              40, 'Faturado');
    insert into pedido_itens_sap(ordem, item, cod_produto, denominacao, quantidade, unidade_venda, recusa) values
      ('H1', '10', 'PA', 'Produto A', 10, 'CX', null),
      ('H1', '20', 'PB', 'Produto B', 5, 'CX', 'Sem estoque'),
      ('H2', '10', 'PA', 'Produto A', 4, 'CX', null),
      ('H3', '10', 'PA', 'Produto A', 6, 'CX', null),
      ('H3', '20', 'PC', 'Produto C', 2, 'CX', ''),
      ('H6', '10', 'PA', 'Produto A', 100, 'CX', null),
      ('H7', '10', 'PA', 'Produto A', 100, 'CX', null),
      ('H8', '10', 'PD', 'Produto D', 3, 'CX', null);
  `);

  await t('40. historico: totais por cliente e mes (12 meses; pedido recusado e cliente de outra rota nao entram)', async () => {
    const r = (await db.query(`select cod_cliente, mes, valor::float as valor, pedidos from fn_historico_cliente_mes('R1', 12) order by cod_cliente, mes`)).rows;
    const mesAtual = (await db.query(`select to_char(current_date, 'YYYY-MM') as m`)).rows[0].m;
    const mes2 = (await db.query(`select to_char(current_date - interval '2 months', 'YYYY-MM') as m`)).rows[0].m;
    const mes11 = (await db.query(`select to_char(date_trunc('month', current_date) - interval '11 months', 'YYYY-MM') as m`)).rows[0].m;
    const c1 = r.filter((x) => x.cod_cliente === '1048753');
    assert.deepEqual(c1.find((x) => x.mes === mesAtual), { cod_cliente: '1048753', mes: mesAtual, valor: 150, pedidos: 2 }); // H1+H2; H6 (recusado) fora
    assert.equal(c1.find((x) => x.mes === mes2).valor, 300);
    assert.equal(c1.find((x) => x.mes === mes11).valor, 70); // 11 meses atras ainda entra
    assert.equal(c1.length, 3); // H5 (12 meses atras) ficou fora da janela de 12 meses
    assert.ok(!r.some((x) => x.cod_cliente === '5550001')); // fora da rota
    // janela menor
    const so3 = (await db.query(`select mes from fn_historico_cliente_mes('R1', 3)`)).rows.map((x) => x.mes);
    assert.ok(so3.includes(mesAtual) && so3.includes(mes2) && !so3.includes(mes11));
  });

  await t('41. historico: o que cada cliente compra (ultima compra, pedidos, quantidade, meses) sem item recusado nem pedido recusado', async () => {
    const r = (await db.query(`select cod_cliente, cod_produto, to_char(ultima_compra, 'YYYY-MM-DD') as ult, pedidos, quantidade::float as qtd, unidade, meses_com_compra
                                 from fn_historico_cliente_produto('R1', 12) order by cod_cliente, cod_produto`)).rows;
    const hoje1 = (await db.query(`select to_char(date_trunc('month', current_date)::date + 1, 'YYYY-MM-DD') as d`)).rows[0].d;
    const a = r.find((x) => x.cod_cliente === '1048753' && x.cod_produto === 'PA');
    assert.deepEqual([a.ult, a.pedidos, a.qtd, a.unidade, a.meses_com_compra], [hoje1, 3, 20, 'CX', 2]); // H1(10)+H2(4)+H3(6); H6 e H7 de fora
    assert.ok(!r.some((x) => x.cod_produto === 'PB')); // item recusado
    assert.equal(r.find((x) => x.cod_produto === 'PC').qtd, 2); // recusa '' conta como item valido
    assert.ok(!r.some((x) => x.cod_cliente === '5550001'));
    assert.equal(r.find((x) => x.cod_cliente === '1048754').cod_produto, 'PD'); // compra de 200 dias atras aparece (12 meses)
  });

  await t('42. historico: a carga busca os itens de pedidos antigos so quando pedimos uma janela maior', async () => {
    const padrao = (await db.query(`select ordem from fn_ordens_para_itens('R1')`)).rows.map((x) => x.ordem);
    assert.ok(!padrao.includes('H8')); // 200 dias: fora dos 90 padrao
    await db.exec(`insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values ('H9', '1048754', current_date - 150, 10, 'Faturado')`);
    const ampla = (await db.query(`select ordem from fn_ordens_para_itens('R1', 365)`)).rows.map((x) => x.ordem);
    assert.ok(ampla.includes('H9')); // sem itens ainda
    assert.ok(!ampla.includes('H8')); // ja tem itens e esta faturado
  });

  // ---- cancelamento de pedido pelo app ----
  await db.exec(`
    insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values
      ('5700001', '1048753', current_date, 100, 'A Faturar'),
      ('5700002', '1048753', current_date, 100, 'Faturado'),
      ('5700003', '5550001', current_date, 100, 'A Faturar'),
      ('5700004', '1048753', current_date, 100, 'A Faturar'),
      ('5700005', '1048753', current_date, 100, 'A Faturar');
  `);
  const erroHttp = async (promessa, status, trecho) => {
    await assert.rejects(promessa, (e) => {
      assert.equal(e.getStatus(), status, `esperava ${status}, veio ${e.getStatus?.()} (${e.message})`);
      if (trecho) assert.match(e.message, trecho);
      return true;
    });
  };
  const auditoria = async (ordem) => (await db.query(`select resultado, http, status_antes, motivo from pedido_cancelamentos where ordem = '${ordem}' order by id`)).rows;

  await t('43. cancelar: desligado por padrao (parametro vazio) e nao chama o SAP', async () => {
    const antes = sapChamadas.length;
    await erroHttp(svc.cancelarOrdemSap(V, '5700001'), 403, /nao esta habilitado/);
    assert.equal(sapChamadas.length, antes);
  });

  await t('44. cancelar: so em status liberado, so da carteira do vendedor, ordem valida', async () => {
    await db.exec(`update parametros set valor = '["a faturar", " Aguardando Liberação "]' where chave = 'status_cancelaveis'`); // caixa/espaco nao importam
    const antes = sapChamadas.length;
    await erroHttp(svc.cancelarOrdemSap(V, '5700002'), 409, /Faturado/); // status nao liberado
    await erroHttp(svc.cancelarOrdemSap(V, '5700003'), 403, /fora da carteira/);
    await erroHttp(svc.cancelarOrdemSap(V, '9999999'), 404, /nao encontrado/);
    await erroHttp(svc.cancelarOrdemSap(V, '12ab'), 422, /invalido/);
    await erroHttp(svc.cancelarOrdemSap({ ...V, rota: null }, '5700001'), 403, /Sincronize/);
    assert.equal(sapChamadas.length, antes); // nenhuma chegou ao SAP
  });

  await t('45. cancelar: sucesso chama o SAP com vendedor e ordem, marca como Recusado e audita', async () => {
    sapRespostas = [{ status: 200, body: { CANCELADO: 'true', ORDEM: '5700001   ', MENSAGENS: [] } }];
    const r = await svc.cancelarOrdemSap(V, '5700001', '  cliente desistiu  ');
    assert.deepEqual([r.status, r.ordem], ['cancelado', '5700001']);
    const c = sapChamadas[sapChamadas.length - 1];
    assert.ok(c.url.endsWith('/poletech/salespole/salespole_cancelar_pedido'), c.url);
    assert.deepEqual(c.body, { codvendedor: '100409', ordem: '5700001' });
    assert.equal((await db.query(`select status from pedidos_sap where ordem = '5700001'`)).rows[0].status, 'Recusado');
    assert.deepEqual(await auditoria('5700001'), [{ resultado: 'cancelado', http: 200, status_antes: 'A Faturar', motivo: 'cliente desistiu' }]);
    // depois de cancelada o status mudou: nao pode cancelar de novo
    await erroHttp(svc.cancelarOrdemSap(V, '5700001'), 409, /Recusado/);
  });

  await t('46. cancelar: o SAP recusa (ja faturada) -> 409 com a mensagem do SAP, ordem fica como estava e e auditado', async () => {
    sapRespostas = [{ status: 409, body: { ERRO: 'Ordem ja faturada, nao pode ser cancelada' } }];
    await erroHttp(svc.cancelarOrdemSap(V, '5700004'), 409, /ja faturada/);
    assert.equal((await db.query(`select status from pedidos_sap where ordem = '5700004'`)).rows[0].status, 'A Faturar');
    assert.deepEqual((await auditoria('5700004')).map((x) => [x.resultado, x.http]), [['recusado', 409]]);
  });

  await t('47. cancelar: erro do SAP (422) e SAP fora do ar (HTML) -> erro claro, auditoria e a ordem nao muda', async () => {
    sapRespostas = [{ status: 422, body: { CANCELADO: 'false', ORDEM: '5700005', MENSAGENS: [{ TIPO: 'E', MENSAGEM: 'Documento bloqueado por outro usuario' }] } }];
    await erroHttp(svc.cancelarOrdemSap(V, '5700005'), 422, /bloqueado por outro usuario/);
    sapRespostas = [{ status: 503, raw: '<html>Service Unavailable</html>' }];
    await erroHttp(svc.cancelarOrdemSap(V, '5700005'), 502, /SAP nao respondeu/);
    assert.equal((await db.query(`select status from pedidos_sap where ordem = '5700005'`)).rows[0].status, 'A Faturar');
    assert.deepEqual((await auditoria('5700005')).map((x) => x.resultado), ['erro', 'erro']);
  });

  // ---- busca de UMA ordem no SAP ----
  const sync = new SyncService(fakeSb(db), new SapClient(cfg));
  await t('48. ordem avulsa: pergunta ao SAP so por essa ordem, grava cabecalho e itens e devolve no formato do pull', async () => {
    sapGetUrls = [];
    sapGets = [
      { status: 200, body: { pedidos: [{ ordem: '5800001', codigocli: '1048753', tp_ped: 'ZPR2', dt_criacao: '2026-10-18', dt_entrega: '2026-10-20', valor: '123.45', status: 'A Faturar', notas: [] }] } },
      { status: 200, body: { ordens: [{ ordem: '5800001', itens: [{ item: '10', material: 'PA', denominacao: 'Produto A', quantidade: '3', unidade_venda: 'CX', valor_unitario: '41.15' }] }] } },
    ];
    const r = await sync.sincronizarOrdem('100409', '5800001');
    assert.equal(sapGetUrls.length, 2);
    assert.ok(sapGetUrls[0].includes('/salespole_pedidos') && sapGetUrls[0].includes('ordens=5800001') && sapGetUrls[0].includes('codvendedor=100409'), sapGetUrls[0]);
    assert.ok(sapGetUrls[1].includes('/salespole_itens') && sapGetUrls[1].includes('ordens=5800001'), sapGetUrls[1]);
    assert.equal(r.pedido.ordem, '5800001');
    assert.equal(r.pedido.status, 'A Faturar');
    assert.equal(r.itens.length, 1);
    assert.equal((await db.query(`select status, valor::float as v from pedidos_sap where ordem = '5800001'`)).rows[0].v, 123.45);
    assert.equal((await db.query(`select quantidade::float as q from pedido_itens_sap where ordem = '5800001' and item = '10'`)).rows[0].q, 3);
  });

  await t('49. ordem avulsa: de novo atualiza (nao duplica) e ordem que o SAP nao devolve vira null sem gravar nada', async () => {
    sapGets = [
      { status: 200, body: { pedidos: [{ ordem: '5800001', codigocli: '1048753', valor: '123.45', status: 'Faturado', notas: [] }] } },
      { status: 200, body: { ordens: [{ ordem: '5800001', itens: [{ item: '10', material: 'PA', quantidade: '3', unidade_venda: 'CX', valor_unitario: '41.15' }] }] } },
    ];
    await sync.sincronizarOrdem('100409', '5800001');
    assert.equal((await db.query(`select count(*)::int as n from pedidos_sap where ordem = '5800001'`)).rows[0].n, 1);
    assert.equal((await db.query(`select status from pedidos_sap where ordem = '5800001'`)).rows[0].status, 'Faturado');
    sapGets = [{ status: 200, body: { pedidos: [] } }];
    assert.equal(await sync.sincronizarOrdem('100409', '5899999'), null);
    assert.equal((await db.query(`select count(*)::int as n from pedidos_sap where ordem = '5899999'`)).rows[0].n, 0);
  });

  // ---- painel: bonificacao e pedidos de clientes V ----
  const painel = new PainelService(fakeSb(db));
  const UP = { email: 'aprovador@pole.com', nome: 'Ana', papel: 'aprovador' };
  const idBon = '00000000-0000-4000-8000-0000000000b1';
  await db.exec(`
    insert into bonificacao_tipos(codigo, descricao) values ('115','Bonificacao comercial') on conflict do nothing;
    insert into pedidos_app(id, cod_vendedor, cod_cliente, criado_no_app_em, itens, itens_hash, status, tipo, tipo_bonificacao, centro_custo, justificativa)
      values ('${idBon}', '100409', '1048753', now(), '[{"produto":"PA","unidade":"CX","quantidade":"2"}]', 'h-bon-1', 'aguardando_aprovacao', 'bonificacao', '115', '2001501007', 'Cliente novo');
  `);
  await t('50. painel: lista bonificacao aguardando com nomes; aprovar marca quem decidiu, grava evento e nao decide duas vezes', async () => {
    const l = await painel.bonificacoes();
    const b = l.find((x) => x.id === idBon);
    assert.equal(b.tipo_descricao, 'Bonificacao comercial');
    assert.equal(b.justificativa, 'Cliente novo');
    assert.equal(b.cliente, '1048753' === b.cod_cliente ? b.cliente : null);
    const r = await painel.decidirBonificacao(UP, idBon, true);
    assert.equal(r.status, 'aprovado');
    const row = (await db.query(`select status, decidido_por, decidido_em is not null as em from pedidos_app where id = '${idBon}'`)).rows[0];
    assert.deepEqual([row.status, row.decidido_por, row.em], ['aprovado', 'aprovador@pole.com', true]);
    assert.equal((await db.query(`select count(*)::int as n from pedido_eventos where pedido_id = '${idBon}' and tipo = 'bonificacao_aprovada'`)).rows[0].n, 1);
    await assert.rejects(painel.decidirBonificacao(UP, idBon, true), (e) => e.getStatus() === 409);
    assert.ok(!(await painel.bonificacoes()).some((x) => x.id === idBon));
  });

  await t('51. painel: rejeitar exige motivo e o motivo fica para o vendedor ver', async () => {
    const id2 = '00000000-0000-4000-8000-0000000000b2';
    await db.exec(`insert into pedidos_app(id, cod_vendedor, cod_cliente, criado_no_app_em, itens, itens_hash, status, tipo, tipo_bonificacao, centro_custo)
      values ('${id2}', '100409', '1048753', now(), '[]', 'h-bon-2', 'aguardando_aprovacao', 'bonificacao', '115', '2001501007')`);
    await assert.rejects(painel.decidirBonificacao(UP, id2, false, ' '), (e) => e.getStatus() === 422);
    await painel.decidirBonificacao(UP, id2, false, 'Sem verba no centro de custo');
    const row = (await db.query(`select status, motivo_rejeicao from pedidos_app where id = '${id2}'`)).rows[0];
    assert.deepEqual([row.status, row.motivo_rejeicao], ['rejeitado', 'Sem verba no centro de custo']);
    assert.equal((await painel.bonificacoes('rejeitado')).some((x) => x.id === id2), true);
    await assert.rejects(painel.bonificacoes('qualquer'), (e) => e.getStatus() === 422);
  });

  // ---- cadastros do painel ----
  const rej = async (p, status, trecho) => assert.rejects(p, (e) => { assert.equal(e.getStatus(), status, e.message); if (trecho) assert.match(e.message, trecho); return true; });
  await t('53. cadastros: tipo de bonificacao (codigo ate 3, cria/edita/desativa) e centro de custo', async () => {
    await painel.gravarCadastro('tipos-bonificacao', { codigo: '130', descricao: 'Troca comercial' });
    await painel.gravarCadastro('tipos-bonificacao', { codigo: '130', descricao: 'Troca comercial 2' }); // mesmo codigo = edita
    let l = await painel.listarCadastro('tipos-bonificacao');
    assert.deepEqual(l.filter((x) => x.codigo === '130').map((x) => [x.descricao, x.ativo]), [['Troca comercial 2', true]]);
    await rej(painel.gravarCadastro('tipos-bonificacao', { codigo: '1300', descricao: 'x' }), 422, /Codigo/);
    await rej(painel.gravarCadastro('tipos-bonificacao', { codigo: '131', descricao: '  ' }), 422, /Descricao/);
    await painel.ativarCadastro('tipos-bonificacao', '130', false);
    l = await painel.listarCadastro('tipos-bonificacao');
    assert.equal(l.find((x) => x.codigo === '130').ativo, false); // continua listado (para reativar)
    await painel.gravarCadastro('centros-custo', { codigo: '2001501007', descricao: 'Comercial' });
    await rej(painel.gravarCadastro('centros-custo', { codigo: '12345678901', descricao: 'x' }), 422);
    await rej(painel.listarCadastro('inexistente'), 404);
    await rej(painel.ativarCadastro('tipos-bonificacao', '999', true), 404);
  });

  await t('54. cadastros: incentivo valida escopo/produto/percentuais/vigencia e aceita qtd minima 0 (marca X = 5%)', async () => {
    await rej(painel.gravarCadastro('incentivos', { escopo: 'cliente', qtd_minima: 1, desconto_pct: 5 }), 422, /escopo/);
    await rej(painel.gravarCadastro('incentivos', { escopo: 'produto', qtd_minima: 1, desconto_pct: 5 }), 422, /produto/);
    await rej(painel.gravarCadastro('incentivos', { escopo: 'geral', qtd_minima: 1, desconto_pct: 150 }), 422, /Desconto/);
    await rej(painel.gravarCadastro('incentivos', { escopo: 'geral', qtd_minima: 1, desconto_pct: 5, vigencia_ini: '2026-10-10', vigencia_fim: '2026-10-01' }), 422, /vigencia/);
    await rej(painel.gravarCadastro('incentivos', { escopo: 'geral', qtd_minima: 1, desconto_pct: 5, vigencia_ini: '10/10/2026' }), 422, /AAAA-MM-DD/);
    const r = await painel.gravarCadastro('incentivos', { escopo: 'escritorio', escopo_valor: 'E01', marca: 'Marca X', qtd_minima: '0', desconto_pct: '5,5', desconto_extra_max_pct: '2' });
    assert.equal(Number(r.qtd_minima), 0);
    assert.equal(Number(r.desconto_pct), 5.5);
    assert.equal(r.marca, 'Marca X');
    const e = await painel.gravarCadastro('incentivos', { id: r.id, escopo: 'geral', escopo_valor: 'ignorado', qtd_minima: 3, desconto_pct: 10 });
    assert.equal(e.id, r.id);
    assert.equal(e.escopo_valor, null); // geral nao guarda valor
    assert.equal((await painel.listarCadastro('incentivos')).filter((x) => x.id === r.id).length, 1); // editou, nao duplicou
    await painel.ativarCadastro('incentivos', r.id, false);
    assert.equal((await painel.listarCadastro('incentivos')).find((x) => x.id === r.id).ativo, false);
  });

  await t('55. cadastros: feriado (municipal exige UF, mesmo dia/lugar nao duplica) e destaque (precisa de uma marcacao)', async () => {
    await rej(painel.gravarCadastro('feriados', { data: '2026-06-24', descricao: 'Sao Joao', cidade: 'Campina Grande' }), 422, /UF/);
    const f = await painel.gravarCadastro('feriados', { data: '2026-06-24', descricao: 'Sao Joao', uf: 'pb', cidade: 'Campina Grande' });
    assert.equal(f.uf, 'PB');
    await rej(painel.gravarCadastro('feriados', { data: '2026-06-24', descricao: 'Outro', uf: 'PB', cidade: 'campina grande' }), 409);
    await painel.gravarCadastro('feriados', { id: f.id, data: '2026-06-24', descricao: 'Sao Joao (PB)', uf: 'PB', cidade: 'Campina Grande' });
    assert.equal((await painel.listarCadastro('feriados')).find((x) => x.id === f.id).descricao, 'Sao Joao (PB)');
    await rej(painel.gravarCadastro('destaques', { cod_produto: 'PA', destaque: false, lancamento: false }), 422, /destaque/);
    await painel.gravarCadastro('destaques', { cod_produto: 'PA', destaque: true, ordem: 2 });
    await painel.gravarCadastro('destaques', { cod_produto: 'PA', lancamento: true, ordem: '1' });
    const d = (await painel.listarCadastro('destaques')).filter((x) => x.cod_produto === 'PA');
    assert.deepEqual(d.map((x) => [x.destaque, x.lancamento, x.ordem]), [[false, true, 1]]);
  });

  // ---- parametros do painel ----
  await t('56. parametros: lista com status conhecidos do SAP; grava status cancelaveis (limpa, sem repetir) e o cancelamento passa a valer', async () => {
    const antes = await painel.parametros();
    assert.ok(antes.parametros.some((x) => x.chave === 'status_cancelaveis'));
    assert.ok(['A Faturar', 'Aguardando Liberação', 'Liberado para faturamento'].every((x) => antes.status_sap.includes(x)));
    assert.ok(antes.status_sap.includes('Faturado')); // vindo dos pedidos ja gravados tambem

    await rej(painel.gravarParametro('status_cancelaveis', 'A Faturar'), 422, /lista/);
    await rej(painel.gravarParametro('status_cancelaveis', ['x'.repeat(61)]), 422, /60/);
    await rej(painel.gravarParametro('inexistente', []), 404);
    const r = await painel.gravarParametro('status_cancelaveis', [' A Faturar ', 'a faturar', '', 'Aguardando Liberação']);
    assert.deepEqual(r.valor, ['A Faturar', 'Aguardando Liberação']);
    assert.deepEqual((await painel.parametros()).parametros.find((x) => x.chave === 'status_cancelaveis').valor, ['A Faturar', 'Aguardando Liberação']);

    // o servico de cancelamento ja le esse mesmo parametro
    await db.exec(`insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values ('5700090', '1048753', current_date, 10, 'Aguardando Liberação')`);
    sapRespostas = [{ status: 200, body: { CANCELADO: 'true', ORDEM: '5700090', MENSAGENS: [] } }];
    assert.equal((await svc.cancelarOrdemSap(V, '5700090')).status, 'cancelado');

    // lista vazia desliga de novo
    await painel.gravarParametro('status_cancelaveis', []);
    await db.exec(`insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values ('5700091', '1048753', current_date, 10, 'A Faturar')`);
    await rej(svc.cancelarOrdemSap(V, '5700091'), 403, /nao esta habilitado/);
  });

  // ---- painel: validacao de visitas e fotos ----
  const vp = (n) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, '0')}`;
  await db.exec(`
    insert into visitas(id, cod_vendedor, cod_cliente, data_visita, status, checkin_em, checkin_recebido_em, distancia_m, fora_do_raio, checkin_gps_falso, resultado, validacao) values
      ('${vp(1)}', '100409', '1048753', current_date, 'concluida', now(), now(), 40, false, false, 'vendeu', 'pendente'),
      ('${vp(2)}', '100409', '1048754', current_date, 'concluida', now() - interval '3 hours', now(), 900, true, true, 'vendeu', 'pendente'),
      ('${vp(3)}', '100409', '1048753', current_date - 1, 'em_andamento', now(), now(), 10, false, false, null, 'pendente'),
      ('${vp(4)}', '100409', '1048753', current_date - 30, 'concluida', now(), now(), 10, false, false, 'vendeu', 'pendente');
    insert into visita_fotos(id, visita_id, tipo, caminho, tirada_em, enviada_em, removida_em) values
      ('00000000-0000-4000-8000-0000000008a1', '${vp(1)}', 'fachada', '100409/f1.jpg', now(), now(), null),
      ('00000000-0000-4000-8000-0000000008a2', '${vp(2)}', 'fachada', '100409/f2.jpg', now(), now(), now()),
      ('00000000-0000-4000-8000-0000000008a3', '${vp(3)}', 'fachada', '100409/f3.jpg', now(), null, null);
  `);
  await t('57. painel visitas: lista pendentes recentes com alertas e link assinado so da foto que existe', async () => {
    const l = await painel.visitas({});
    assert.deepEqual(l.map((x) => x.id).sort(), [vp(1), vp(2), vp(3)].sort()); // a de 30 dias fica fora do padrao (7 dias)
    const v1 = l.find((x) => x.id === vp(1));
    const v2 = l.find((x) => x.id === vp(2));
    assert.ok(v1.fotos[0].url.includes('100409/f1.jpg'));
    assert.equal(v1.relogio_divergente, false);
    assert.deepEqual([v2.fora_do_raio, v2.checkin_gps_falso, v2.relogio_divergente], [true, true, true]);
    assert.deepEqual([v2.fotos[0].removida, v2.fotos[0].url], [true, null]); // foto apagada pela retencao: sem link
    assert.deepEqual([l.find((x) => x.id === vp(3)).fotos[0].enviada, l.find((x) => x.id === vp(3)).fotos[0].url], [false, null]); // ainda nao subiu
    assert.ok(v1.cliente && v1.cliente.length > 0);
    assert.equal((await painel.visitas({ ini: '2020-01-01' })).some((x) => x.id === vp(4)), true); // periodo maior traz a antiga
    await rej(painel.visitas({ validacao: 'x' }), 422);
    await rej(painel.visitas({ ini: '01/10/2026' }), 422);
    assert.deepEqual((await painel.visitas({ vendedor: '0000100486' })), []);
  });

  await t('58. painel visitas: validar/recusar so visita concluida e pendente; recusar exige motivo; grava quem decidiu', async () => {
    await rej(painel.validarVisita(UP, vp(2), false, ''), 422, /motivo/);
    await painel.validarVisita(UP, vp(1), true, '  fachada ok ');
    const r = (await db.query(`select validacao, validada_por, validada_em is not null as em, validacao_obs from visitas where id = '${vp(1)}'`)).rows[0];
    assert.deepEqual([r.validacao, r.validada_por, r.em, r.validacao_obs], ['validada', 'aprovador@pole.com', true, 'fachada ok']);
    await rej(painel.validarVisita(UP, vp(1), false, 'mudei de ideia'), 409); // ja decidida
    await rej(painel.validarVisita(UP, vp(3), true), 409); // ainda em andamento
    await painel.validarVisita(UP, vp(2), false, 'GPS simulado e foto de outro lugar');
    assert.deepEqual((await painel.visitas({ validacao: 'recusada' })).map((x) => [x.id, x.validacao_obs]), [[vp(2), 'GPS simulado e foto de outro lugar']]);
    assert.ok(!(await painel.visitas({})).some((x) => x.id === vp(1) || x.id === vp(2))); // saem da fila de pendentes
    assert.equal((await painel.visitas({ validacao: 'todas' })).length >= 3, true);
  });

  // ---- gestao de usuarios ----
  const contas = new Map(); // login falso: email -> senha
  const invalidados = [];
  const sbAuth = { ...fakeSb(db), auth: { admin: {
    createUser: async ({ email, password }) => {
      if (contas.has(email)) return { data: null, error: { message: 'A user with this email address has already been registered' } };
      contas.set(email, password); return { data: { user: { id: 'id-' + email } }, error: null };
    },
    listUsers: async () => ({ data: { users: [...contas.keys()].map((email) => ({ id: 'id-' + email, email })) }, error: null }),
    updateUserById: async (id, { password }) => { contas.set(id.slice(3), password); return { data: {}, error: null }; },
  } } };
  const usu = new UsuariosService(sbAuth, { invalidar: (e) => invalidados.push(e) });
  const ADM = { email: 'admin@pole.com', nome: 'Admin', papel: 'admin' };
  await db.exec(`insert into usuarios_painel(email, nome, papel) values ('admin@pole.com', 'Admin', 'admin') on conflict do nothing`);

  await t('59. usuarios do painel: cria com login, troca papel/senha, e-mail em minusculo; senha curta e papel invalido recusados', async () => {
    await rej(usu.gravarPainel(ADM, { email: 'sem-arroba', papel: 'consulta' }), 422, /E-mail/);
    await rej(usu.gravarPainel(ADM, { email: 'ana@pole.com', papel: 'chefe' }), 422, /Papel/);
    await rej(usu.gravarPainel(ADM, { email: 'ana@pole.com', papel: 'aprovador', senha: '123' }), 422, /senha/);
    assert.equal((await db.query(`select count(*)::int as n from usuarios_painel where email = 'ana@pole.com'`)).rows[0].n, 0); // senha ruim: nada gravado
    const r = await usu.gravarPainel(ADM, { email: '  Ana@Pole.com ', nome: 'Ana', papel: 'aprovador', senha: 'senha-forte-1' });
    assert.deepEqual([r.email, r.login], ['ana@pole.com', 'criada']);
    assert.equal(contas.get('ana@pole.com'), 'senha-forte-1');
    const r2 = await usu.gravarPainel(ADM, { email: 'ana@pole.com', nome: 'Ana Souza', papel: 'consulta', senha: 'outra-senha-2' });
    assert.equal(r2.login, 'atualizada');
    assert.equal(contas.get('ana@pole.com'), 'outra-senha-2');
    const sem = await usu.gravarPainel(ADM, { email: 'ana@pole.com', nome: 'Ana Souza', papel: 'aprovador' }); // sem senha: so papel
    assert.equal(sem.login, null);
    assert.equal(contas.get('ana@pole.com'), 'outra-senha-2');
    const l = await usu.listarPainel();
    assert.deepEqual(l.filter((x) => x.email === 'ana@pole.com').map((x) => [x.nome, x.papel, x.ativo]), [['Ana Souza', 'aprovador', true]]);
  });

  await t('60. usuarios do painel: nao deixa o painel sem administrador nem o admin se trancar para fora', async () => {
    await rej(usu.gravarPainel(ADM, { email: 'admin@pole.com', papel: 'consulta' }), 409, /proprio/);
    await rej(usu.gravarPainel(ADM, { email: 'admin@pole.com', papel: 'admin', ativo: false }), 409, /proprio/);
    // outro admin so pode ser rebaixado enquanto sobrar um ativo
    await usu.gravarPainel(ADM, { email: 'bia@pole.com', papel: 'admin' });
    await usu.gravarPainel(ADM, { email: 'bia@pole.com', papel: 'consulta' }); // ok: admin@ continua
    await db.exec(`update usuarios_painel set ativo = false where email = 'admin@pole.com'`);
    await usu.gravarPainel({ email: 'bia@pole.com', papel: 'admin' }, { email: 'bia@pole.com', papel: 'admin' }); // volta a ser admin
    await rej(usu.gravarPainel({ email: 'zed@pole.com', papel: 'admin' }, { email: 'bia@pole.com', papel: 'consulta' }), 409, /ao menos um administrador/);
    await db.exec(`update usuarios_painel set ativo = true where email = 'admin@pole.com'`);
  });

  await t('61. usuarios do app: vincula e-mail ao vendedor (zeros a esquerda saem), cria login, invalida cache e mostra o nome', async () => {
    await rej(usu.gravarVendedor(ADM, { email: 'v@x.com', cod_vendedor: '10a' }), 422, /vendedor/);
    await db.exec(`insert into vendedores(cod_vendedor, nome) values ('100500', 'Carlos Vendedor') on conflict do nothing`);
    const r = await usu.gravarVendedor(ADM, { email: 'Carlos@Pole.com', cod_vendedor: '0000100500', senha: 'senha-carlos-1' });
    assert.deepEqual([r.email, r.cod_vendedor, r.login], ['carlos@pole.com', '100500', 'criada']);
    assert.ok(invalidados.includes('carlos@pole.com'));
    await usu.gravarVendedor(ADM, { email: 'carlos@pole.com', cod_vendedor: '100500', ativo: false });
    const l = (await usu.listarVendedores()).find((x) => x.email === 'carlos@pole.com');
    assert.deepEqual([l.vendedor, l.ativo, l.cod_vendedor], ['Carlos Vendedor', false, '100500']);
  });

  // ---- monitor ----
  const reenvios = [];
  const monitor = new MonitorService(fakeSb(db), { tentarEnviar: async (id, forcar) => { reenvios.push([id, forcar]); return { status: 'enviado', erro: null }; } });
  const TERCA = new Date('2026-10-20T18:00:00.000Z'); // terca, 15h em Sao Paulo
  const DOMINGO = new Date('2026-10-25T18:00:00.000Z'); // domingo depois dos dados
  const antes = (min) => new Date(TERCA.getTime() - min * 60_000).toISOString();
  const mid = (n) => `00000000-0000-4000-8000-0000000009${String(n).padStart(2, '0')}`;
  await db.exec(`
    delete from sync_estado;
    insert into sync_estado(recurso, escopo, ultimo_sucesso, ultimo_erro, ultimo_erro_em) values
      ('pedidos',  'R1', '${antes(300)}', null, null),
      ('titulos',  'R1', '${antes(10)}',  null, null),
      ('produtos', '*',  '${antes(40 * 60)}', null, null),
      ('clientes', 'R1', '${antes(120)}', 'SAP 500 no gateway', '${antes(60)}'),
      ('estoque',  'R1', null, null, null);
    insert into pedidos_app(id, cod_vendedor, cod_cliente, criado_no_app_em, itens, itens_hash, status, erro, tentativas, recebido_em, updated_at) values
      ('${mid(1)}', '100409', '1048753', now(), '[]', 'm1', 'erro',     'Cliente bloqueado para vendas', 3, '${antes(60)}', '${antes(55)}'),
      ('${mid(2)}', '100409', '1048753', now(), '[]', 'm2', 'recebido', null, 0, '${antes(30)}', '${antes(20)}'),
      ('${mid(3)}', '100409', '1048753', now(), '[]', 'm3', 'recebido', null, 0, '${antes(2)}',  '${antes(1)}'),
      ('${mid(4)}', '100409', '1048753', now(), '[]', 'm4', 'enviado',  null, 1, '${antes(90)}', '${antes(80)}'),
      ('${mid(5)}', '100409', '1048753', now(), '[]', 'm5', 'parcial',  'Um item sem estoque', 1, '${antes(45)}', '${antes(40)}'),
      ('${mid(6)}', '100409', '1048753', now(), '[]', 'm6', 'enviando', null, 1, '${antes(50)}', '${antes(15)}');
    insert into pedido_cancelamentos(ordem, cod_vendedor, status_antes, resultado, http, criado_em) values
      ('5700501', '100409', 'A Faturar', 'recusado', 409, '${antes(60)}'),
      ('5700502', '100409', 'A Faturar', 'cancelado', 200, '${antes(50)}');
  `);

  await t('62. monitor: sincronizacao ok/atrasada/com erro, e o atraso do operacional so conta em horario comercial', async () => {
    const m = await monitor.visao(TERCA);
    const sit = (rec) => m.sincs.find((x) => x.recurso === rec).situacao;
    assert.deepEqual(['pedidos', 'titulos', 'produtos', 'clientes', 'estoque'].map(sit), ['atrasado', 'ok', 'atrasado', 'erro', 'atrasado']);
    assert.equal(m.sincs.find((x) => x.recurso === 'clientes').erro, 'SAP 500 no gateway');
    assert.equal(m.sincs.find((x) => x.recurso === 'titulos').idade_min, 10);
    assert.equal(m.resumo.sincs_com_problema, 4);
    // domingo o cron operacional nao roda: 5 h sem atualizar nao e problema (mas o diario de 40 h e)
    const d = await monitor.visao(DOMINGO);
    assert.equal(d.sincs.find((x) => x.recurso === 'pedidos').situacao, 'ok');
    assert.equal(d.sincs.find((x) => x.recurso === 'produtos').situacao, 'atrasado');
  });

  await t('63. monitor: pedidos com problema (erro, parcial, parado em recebido/enviando), contagem por status e cancelamentos que falharam', async () => {
    const m = await monitor.visao(TERCA);
    const ids = m.pedidos_problema.map((p) => p.id).filter((id) => [1, 2, 3, 4, 5, 6].map(mid).includes(id)).sort();
    assert.deepEqual(ids, [mid(1), mid(2), mid(5), mid(6)].sort()); // m3 (1 min) e m4 (enviado) nao entram
    const e = m.pedidos_problema.find((p) => p.id === mid(1));
    assert.deepEqual([e.erro, e.tentativas, e.parado_min], ['Cliente bloqueado para vendas', 3, 55]);
    assert.ok(e.cliente && e.vendedor !== undefined);
    assert.ok(m.pedidos_por_status.erro >= 1 && m.pedidos_por_status.enviado >= 1);
    assert.deepEqual(m.cancelamentos_com_problema.filter((c) => c.ordem.startsWith('57005')).map((c) => [c.ordem, c.resultado]), [['5700501', 'recusado']]); // o cancelado nao e problema
    assert.ok(m.resumo.pedidos_com_problema >= 4);
    assert.equal(typeof m.resumo.bonificacoes_aguardando, 'number');
    assert.equal(typeof m.resumo.visitas_pendentes, 'number');
  });

  await t('64. monitor: reenviar so pedido em erro; registra no historico e chama o envio forcado', async () => {
    await rej(monitor.reenviarPedido(UP, mid(2)), 409, /recebido/);
    await rej(monitor.reenviarPedido(UP, mid(99)), 404);
    const r = await monitor.reenviarPedido(UP, mid(1));
    assert.deepEqual([r.status, r.erro], ['enviado', null]);
    assert.deepEqual(reenvios, [[mid(1), true]]);
    const ev = (await db.query(`select detalhe from pedido_eventos where pedido_id = '${mid(1)}' and tipo = 'reenvio_painel'`)).rows;
    assert.equal(ev.length, 1);
    assert.equal(ev[0].detalhe.por, 'aprovador@pole.com');
  });

  // ---- indicadores gerenciais ----
  const ind = new IndicadoresService(fakeSb(db), sync);
  await t('65. vendedores: importa a lista do SAP (zeros saem), vendedor novo entra desmarcado e a marcacao do admin sobrevive a nova importacao', async () => {
    await db.exec(`insert into vendedores(cod_vendedor, nome, rota, indicadores) values ('100777', 'Antigo', 'RX', true) on conflict do nothing`);
    sapGetUrls = [];
    sapGets = [{ status: 200, body: { vendedores: [
      { codvendedor: '0000100777', nome: 'Antigo Renomeado', documento: '111', rota: 'RX' },
      { codvendedor: '100888', nome: 'Novo Vendedor', documento: '222', rota: 'R8' },
      { codvendedor: '', nome: 'sem codigo', documento: '', rota: '' },
    ] } }];
    const r = await ind.importar();
    assert.deepEqual(r, { total: 2, novos: 1 });
    assert.ok(sapGetUrls[0].includes('/salespole_vendedores'), sapGetUrls[0]);
    const l = await ind.vendedores();
    const ant = l.find((x) => x.cod_vendedor === '100777');
    const novo = l.find((x) => x.cod_vendedor === '100888');
    assert.deepEqual([ant.nome, ant.indicadores], ['Antigo Renomeado', true]); // nome atualiza, marcacao fica
    assert.deepEqual([novo.indicadores, novo.usa_app, novo.pedidos_atualizados_em, novo.acessos], [false, false, null, []]);
    // quem tem login no app mas ainda nao foi sincronizado tambem aparece (com o e-mail do acesso)
    await db.exec(`insert into usuarios_vendedor(email, cod_vendedor, ativo) values ('orfao@x.com', '100123', true), ('orfao2@x.com', '100123', false) on conflict (email) do nothing`);
    const orfao = (await ind.vendedores()).find((x) => x.cod_vendedor === '100123');
    assert.deepEqual([orfao.nome, orfao.usa_app, orfao.acessos.map((a) => [a.email, a.ativo])], [null, true, [['orfao2@x.com', false], ['orfao@x.com', true]]]);
    await db.exec(`delete from usuarios_vendedor where cod_vendedor = '100123'`);
    assert.equal((await ind.marcar(['0000100888', '100999'], true)).alterados, 1); // codigo desconhecido ignorado
    assert.equal((await ind.vendedores()).find((x) => x.cod_vendedor === '100888').indicadores, true);
    await rej(ind.marcar([], true), 422);
    sapGets = [{ status: 200, body: { vendedores: [{ codvendedor: '100888', nome: 'Novo Vendedor', rota: 'R8' }] } }];
    await ind.importar();
    assert.equal((await ind.vendedores()).find((x) => x.cod_vendedor === '100888').indicadores, true); // importar de novo nao desmarca
  });

  await t('66. vendedor so de indicadores: 1a vez busca 12 meses, depois 90 dias; grava pedidos e carteira, sem pedir itens', async () => {
    sapGetUrls = [];
    sapGets = [
      { status: 200, body: { codvendedor: '100888', nome: 'Novo Vendedor', documento: '222', rota: 'R8', clientes: [{ codigocli: '7000001', cnpjcpf: '1', nome_fantasia: 'Mercado Sete', razao_social: 'Mercado Sete Ltda', bloqueado: 'false', visitas: [{ dia_semana: '1', sequencia: '1' }] }] } },
      { status: 200, body: { clientes: [] } },
      { status: 200, body: { pedidos: [{ ordem: '5990001', codigocli: '7000001', dt_criacao: '2026-10-10', valor: '500', status: 'Faturado', notas: [] }] } },
      ...Array.from({ length: 24 }, () => ({ status: 200, body: { pedidos: [] } })), // as outras janelas de 15 dias
    ];
    const rota = await sync.sincronizarParaIndicadores('100888');
    assert.equal(rota, 'R8');
    const pedidosGets = sapGetUrls.filter((u) => u.includes('/salespole_pedidos')).length;
    assert.equal(pedidosGets, 25); // 365 dias em janelas de 15
    assert.ok(!sapGetUrls.some((u) => u.includes('/salespole_itens')));
    assert.equal((await db.query(`select count(*)::int as n from pedidos_sap where ordem = '5990001'`)).rows[0].n, 1);
    assert.equal((await db.query(`select count(*)::int as n from rota_clientes where rota = 'R8'`)).rows[0].n, 1);
    // segunda vez: a rota ja tem sincronizacao de pedidos -> so 90 dias (6 janelas)
    sapGetUrls = [];
    sapGets = [
      { status: 200, body: { codvendedor: '100888', nome: 'Novo Vendedor', documento: '222', rota: 'R8', clientes: [{ codigocli: '7000001', cnpjcpf: '1', nome_fantasia: 'Mercado Sete', razao_social: 'Mercado Sete Ltda', bloqueado: 'false', visitas: [{ dia_semana: '1', sequencia: '1' }] }] } },
      { status: 200, body: { clientes: [] } },
      ...Array.from({ length: 6 }, () => ({ status: 200, body: { pedidos: [] } })),
    ];
    await sync.sincronizarParaIndicadores('100888');
    assert.equal(sapGetUrls.filter((u) => u.includes('/salespole_pedidos')).length, 6);
  });

  await t('67. indicadores: soma R$ por mes, vendedor (rota), escritorio e canal; recusado fora; positivacao pela carteira', async () => {
    await db.exec(`
      delete from rota_clientes where rota in ('RA', 'RB');
      insert into vendedores(cod_vendedor, nome, rota) values ('300001', 'Joao', 'RA'), ('300002', 'Maria', 'RB') on conflict (cod_vendedor) do update set nome = excluded.nome, rota = excluded.rota;
      insert into clientes(cod_cliente, nome_fantasia, areas) values
        ('C-A1', 'A1', '[{"escritorio":{"codigo":"E1","descricao":"Escritorio Norte"},"canal":{"codigo":"10","descricao":"Varejo"}}]'),
        ('C-A2', 'A2', '[{"escritorio":{"codigo":"E1","descricao":"Escritorio Norte"},"canal":{"codigo":"20","descricao":"Atacado"}}]'),
        ('C-B1', 'B1', '[{"escritorio":{"codigo":"E2","descricao":"Escritorio Sul"},"canal":{"codigo":"10","descricao":"Varejo"}}]'),
        ('C-B2', 'B2', '[]')
        on conflict (cod_cliente) do update set areas = excluded.areas;
      insert into rota_clientes(rota, cod_cliente, dia_semana, sequencia) values
        ('RA','C-A1',1,1), ('RA','C-A1',3,1), ('RA','C-A2',1,2), ('RB','C-B1',1,1), ('RB','C-B2',1,2);
      insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values
        ('I1', 'C-A1', '2025-02-10', 1000, 'Faturado'),
        ('I2', 'C-A1', '2025-03-05', 500,  'A Faturar'),
        ('I3', 'C-A2', '2025-03-06', 250,  'Faturado'),
        ('I4', 'C-B1', '2025-03-07', 2000, 'Faturado'),
        ('I5', 'C-B1', '2025-03-08', 9999, 'Recusado'),
        ('I6', 'C-B2', '2025-03-09', 100,  'Faturado'),
        ('I7', 'C-A1', '2024-12-31', 7777, 'Faturado'),
        ('I8', 'C-FORA', '2025-03-10', 5555, 'Faturado');
    `);
    const r = await ind.vendas('2025-01-01', '2025-03-31');
    assert.deepEqual(r.periodo, { ini: '2025-01-01', fim: '2025-03-31' });
    assert.deepEqual([r.total.valor, r.total.pedidos, r.total.clientes], [3850, 5, 4]); // recusado, fora do periodo e cliente sem carteira nao entram
    assert.equal(Math.round(r.total.ticket_medio), 770);
    assert.deepEqual(r.por_mes.map((m) => [m.chave, m.valor]), [['2025-02', 1000], ['2025-03', 2850]]);
    const joao = r.por_vendedor.find((v) => v.chave === 'RA');
    assert.deepEqual([joao.rotulo, joao.valor, joao.clientes, joao.carteira, Math.round(joao.positivacao_pct)], ['Joao', 1750, 2, 2, 100]);
    const maria = r.por_vendedor.find((v) => v.chave === 'RB');
    assert.deepEqual([maria.valor, maria.clientes, maria.carteira, Math.round(maria.positivacao_pct)], [2100, 2, 2, 100]);
    assert.deepEqual(r.por_vendedor.map((v) => v.chave).slice(0, 2), ['RB', 'RA']); // maior volume primeiro
    assert.deepEqual(r.por_escritorio.map((e) => [e.chave, e.rotulo, e.valor]), [['E1', 'Escritorio Norte', 1750], ['E2', 'Escritorio Sul', 2000], ['', '', 100]].sort((a, b) => b[2] - a[2]));
    assert.deepEqual(r.por_canal.map((c) => [c.chave, c.valor]), [['10', 3500], ['20', 250], ['', 100]].sort((a, b) => b[1] - a[1]));
    assert.equal(r.total.carteira >= 4, true);
    assert.equal(r.total.vendedores_com_vendas, 2); // Joao (RA) e Maria (RB)
    assert.ok(r.total.vendedores_na_base >= 2);
  });

  await t('68. indicadores: periodo padrao = 12 meses (mes atual incluso); datas e periodo invalidos recusados', async () => {
    const r = await ind.vendas();
    const a = new Date(r.periodo.ini + 'T00:00:00Z'), b = new Date(r.periodo.fim + 'T00:00:00Z');
    assert.equal(r.periodo.ini.endsWith('-01'), true);
    assert.equal((b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth(), 11);
    await rej(ind.vendas('01/01/2025', '2025-03-31'), 422);
    await rej(ind.vendas('2025-04-01', '2025-03-31'), 422, /inicio/);
  });

  // ---- botao "Sincronizar agora" ----
  const respVendedor = (cod, nome, rota) => ({ status: 200, body: { codvendedor: cod, nome, documento: '1', rota, clientes: [] } });
  const vazios = (n) => Array.from({ length: n }, () => ({ status: 200, body: { pedidos: [] } }));
  const esperarFim = async () => { for (let i = 0; i < 200 && ind.andamento().rodando; i++) await new Promise((r) => setTimeout(r, 25)); };

  await t('69. sincronizar agora: roda em segundo plano, pula quem usa o app, nao deixa duas rodadas ao mesmo tempo e informa o andamento', async () => {
    await db.exec(`
      insert into vendedores(cod_vendedor, nome, rota, indicadores) values ('100666', 'Do App', 'RZ', true) on conflict (cod_vendedor) do update set indicadores = true;
      insert into usuarios_vendedor(email, cod_vendedor, ativo) values ('z@x.com', '100666', true) on conflict (email) do update set ativo = true;
    `);
    await db.exec(`update sync_estado set ultimo_sucesso = now() - interval '3 hours' where recurso = 'pedidos'`); // rotas "antigas": nao sao puladas
    sapGetUrls = [];
    sapGets = [
      respVendedor('100777', 'Antigo Renomeado', 'RX'), { status: 200, body: { clientes: [] } }, ...vazios(25), // RX: 1a vez, 12 meses
      respVendedor('100888', 'Novo Vendedor', 'R8'), { status: 200, body: { clientes: [] } }, ...vazios(6),     // R8: 90 dias
    ];
    const inicio = ind.sincronizarAgora();
    assert.equal(inicio.rodando, true);
    assert.throws(() => ind.sincronizarAgora(), (e) => e.getStatus() === 409); // ja em andamento
    await esperarFim();
    const r = ind.andamento();
    assert.deepEqual([r.rodando, r.origem, r.total, r.feitos, r.falhas.length], [false, 'painel', 2, 2, 0]);
    assert.ok(r.iniciado_em && r.terminou_em);
    assert.equal(sapGetUrls.filter((u) => u.includes('/salespole_pedidos')).length, 31);
    assert.ok(!sapGetUrls.some((u) => u.includes('codvendedor=100666'))); // quem usa o app fica de fora
    assert.ok(!sapGetUrls.some((u) => u.includes('/salespole_itens')));
    assert.ok((await db.query(`select ultimo_sucesso from sync_estado where recurso = 'pedidos' and escopo = 'RX'`)).rows[0].ultimo_sucesso);
  });

  await t('70. sincronizar agora: erro em um vendedor nao para os outros, fica no andamento e no estado de sincronizacao', async () => {
    await db.exec(`update sync_estado set ultimo_sucesso = now() - interval '3 hours' where recurso = 'pedidos'`);
    sapGetUrls = [];
    sapGets = [
      { status: 500, body: { ERRO: 'gateway' } },                                   // 100777 falha
      respVendedor('100888', 'Novo Vendedor', 'R8'), { status: 200, body: { clientes: [] } }, ...vazios(6),
    ];
    ind.sincronizarAgora();
    await esperarFim();
    const r = ind.andamento();
    assert.deepEqual([r.total, r.feitos, r.falhas.map((f) => f.cod_vendedor)], [2, 2, ['100777']]);
    assert.match(r.falhas[0].erro, /500|gateway/);
    assert.ok((await db.query(`select ultimo_erro from sync_estado where recurso = 'vendedor' and escopo = '100777'`)).rows[0].ultimo_erro);
    const lista = await ind.vendedores();
    assert.ok(lista.find((x) => x.cod_vendedor === '100888').pedidos_atualizados_em); // o outro foi atualizado
    // depois de terminar pode rodar de novo
    await db.exec(`update sync_estado set ultimo_sucesso = now() - interval '3 hours' where recurso = 'pedidos'`);
    sapGets = [respVendedor('100777', 'Antigo Renomeado', 'RX'), { status: 200, body: { clientes: [] } }, ...vazios(6), respVendedor('100888', 'Novo Vendedor', 'R8'), { status: 200, body: { clientes: [] } }, ...vazios(6)];
    ind.sincronizarAgora();
    await esperarFim();
    assert.deepEqual([ind.andamento().feitos, ind.andamento().falhas.length], [2, 0]);
  });

  await t('76. sincronizar agora: retoma de onde parou (pula rota atualizada ha menos de 2 h); o horario automatico nao pula nada', async () => {
    // acabou de sincronizar tudo (teste anterior): clicar de novo nao chama o SAP
    sapGetUrls = [];
    sapGets = [];
    ind.sincronizarAgora();
    await esperarFim();
    let r = ind.andamento();
    assert.deepEqual([r.total, r.feitos, r.puladas], [0, 0, 2]);
    assert.equal(sapGetUrls.length, 0);
    // so a rota R8 ficou velha (a outra foi atualizada): sincroniza apenas ela
    await db.exec(`update sync_estado set ultimo_sucesso = now() - interval '3 hours' where recurso = 'pedidos' and escopo = 'R8'`);
    sapGets = [respVendedor('100888', 'Novo Vendedor', 'R8'), { status: 200, body: { clientes: [] } }, ...vazios(6)];
    ind.sincronizarAgora();
    await esperarFim();
    r = ind.andamento();
    assert.deepEqual([r.total, r.feitos, r.puladas], [1, 1, 1]);
    // horario automatico (cron) refaz todas, mesmo as recentes
    sapGets = [respVendedor('100777', 'Antigo Renomeado', 'RX'), { status: 200, body: { clientes: [] } }, ...vazios(6), respVendedor('100888', 'Novo Vendedor', 'R8'), { status: 200, body: { clientes: [] } }, ...vazios(6)];
    await sync.sincronizarMarcados('cron');
    assert.deepEqual([sync.rodadaIndicadores.total, sync.rodadaIndicadores.puladas], [2, 0]);
  });

  // ---- pedido criado pelo painel em nome do vendedor ----
  const pp = new PedidoPainelService(fakeSb(db), svc, sync);
  await db.exec(`
    insert into vendedores(cod_vendedor, nome, rota) values ('100409', 'Vendedor Teste', 'R1') on conflict (cod_vendedor) do update set rota = 'R1', nome = 'Vendedor Teste';
    insert into vendedores(cod_vendedor, nome, rota) values ('100555', 'Sem Carteira', null) on conflict (cod_vendedor) do update set rota = null;
    insert into produtos(cod_produto, descricao, dados) values ('PP1', 'Queijo Painel', '{"unidade_venda":"KI"}'), ('PP2', 'Presunto Painel', '{}') on conflict (cod_produto) do nothing;
  `);

  await t('71. pedido pelo painel: so clientes da carteira do vendedor escolhido (busca por nome ou codigo)', async () => {
    const lista = await pp.vendedores();
    assert.ok(lista.some((v) => v.cod_vendedor === '100409') && !lista.some((v) => v.cod_vendedor === '100555')); // sem rota nao aparece
    const todos = await pp.clientes('100409');
    assert.equal(todos.carteira_carregada, true);
    assert.ok(todos.clientes.some((c) => c.cod_cliente === '1048753'));
    assert.ok(!todos.clientes.some((c) => c.cod_cliente === '7000001')); // carteira de outra rota (R8)
    const porNome = await pp.clientes('0000100409', 'nome-inexistente-xyz');
    assert.deepEqual(porNome.clientes, []);
    const porCod = await pp.clientes('100409', '1048753');
    assert.deepEqual(porCod.clientes.map((c) => c.cod_cliente), ['1048753']);
    assert.deepEqual((await pp.clientes('100409', '7000001')).clientes, []); // existe, mas nao e deste vendedor
    await rej(pp.clientes('100555'), 422, /carteira/);
    await rej(pp.clientes('999999'), 422, /carteira/);
  });

  await t('71b. pedido pelo painel: vendedor sem carteira baixada avisa e a carteira e carregada na hora, so desse vendedor', async () => {
    await db.exec(`insert into vendedores(cod_vendedor, nome, rota) values ('100321', 'Recem Importado', 'R3') on conflict (cod_vendedor) do update set rota = 'R3'; delete from rota_clientes where rota = 'R3';`);
    let r = await pp.clientes('100321');
    assert.deepEqual([r.carteira_carregada, r.clientes.length], [false, 0]); // importado do SAP, mas carteira ainda nao veio
    sapGetUrls = [];
    sapGets = [
      { status: 200, body: { codvendedor: '100321', nome: 'Recem Importado', documento: '9', rota: 'R3', clientes: [
        { codigocli: '8100001', cnpjcpf: '1', nome_fantasia: 'Padaria Nova', razao_social: 'Padaria Nova Ltda', bloqueado: 'false', visitas: [{ dia_semana: '2', sequencia: '1' }] },
        { codigocli: '8100002', cnpjcpf: '2', nome_fantasia: 'Mercado Novo', razao_social: 'Mercado Novo Ltda', bloqueado: 'false', visitas: [{ dia_semana: '2', sequencia: '2' }] },
      ] } },
      { status: 200, body: { clientes: [] } },
    ];
    const c = await pp.carregarCarteira('0000100321');
    assert.equal(c.rota, 'R3');
    assert.equal(sapGetUrls.length, 2);
    assert.ok(sapGetUrls.every((u) => u.includes('codvendedor=100321'))); // so este vendedor
    await db.exec(`insert into clientes(cod_cliente, nome_fantasia) values ('8100001', 'Padaria Nova') on conflict (cod_cliente) do nothing`); // (o cadastro vem do metodo clientes)
    r = await pp.clientes('100321');
    assert.equal(r.carteira_carregada, true);
    assert.deepEqual(r.clientes.map((x) => [x.cod_cliente, x.nome]), [['8100001', 'Padaria Nova'], ['8100002', null]]); // cliente sem cadastro baixado aparece so com o codigo
    // SAP fora do ar: erro claro (502), nada muda
    sapGets = [{ status: 500, body: { ERRO: 'gateway' } }];
    await rej(pp.carregarCarteira('100321'), 502, /SAP nao respondeu/);
    await rej(pp.carregarCarteira('abc'), 422);
  });

  await t('72. pedido pelo painel: cria em nome do vendedor, envia ao SAP com o codigo dele e registra quem criou', async () => {
    sapRespostas = [OK('0000771', [['5800771', 'FERT', '2100']])];
    const antes = sapChamadas.length;
    const r = await pp.criar(UP, { cod_vendedor: '0000100409', cod_cliente: '1048753', itens: [{ produto: 'PP1', quantidade: '3' }, { produto: 'PP2', quantidade: '2', unidade: 'cx' }], observacao: 'Pedido feito pelo gestor' });
    assert.equal(r.status, 'enviado');
    assert.ok(r.codigo);
    assert.equal(sapChamadas.length - antes, 1);
    const c = sapChamadas[sapChamadas.length - 1];
    assert.equal(c.body.codvendedor, '100409'); // em nome do vendedor, nao de quem criou
    assert.deepEqual(c.body.itens.map((i) => [i.produto, i.unidade]), [['PP1', 'KI'], ['PP2', 'CX']]); // unidade completada / normalizada
    const row = (await db.query(`select cod_vendedor, cod_cliente, criado_por_painel, observacao from pedidos_app where id = '${r.id}'`)).rows[0];
    assert.deepEqual([row.cod_vendedor, row.cod_cliente, row.criado_por_painel], ['100409', '1048753', 'aprovador@pole.com']);
    const id = r.id;
    assert.equal((await db.query(`select count(*)::int as n from pedido_eventos where pedido_id = '${id}' and tipo = 'criado_pelo_painel'`)).rows[0].n, 1);
  });

  await t('73. pedido pelo painel: recusa cliente de outro vendedor, vendedor sem carteira, sem itens e quantidade invalida; nada e gravado', async () => {
    const n0 = (await db.query(`select count(*)::int as n from pedidos_app`)).rows[0].n;
    const chamadas0 = sapChamadas.length;
    const r1 = await pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '7000001', itens: [{ produto: 'PP1', quantidade: '1' }] });
    assert.deepEqual([r1.status, r1.erros.join()], ['invalido', 'Cliente fora da carteira do vendedor']);
    const r2 = await pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '1048753', itens: [{ produto: 'PP1', quantidade: '0' }] });
    assert.equal(r2.status, 'invalido');
    await rej(pp.criar(UP, { cod_vendedor: '100555', cod_cliente: '1048753', itens: [{ produto: 'PP1', quantidade: '1' }] }), 422, /carteira/);
    await rej(pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '1048753', itens: [] }), 422, /produto/);
    await rej(pp.criar(UP, { cod_cliente: '1048753', itens: [{ produto: 'PP1', quantidade: '1' }] }), 422, /vendedor/);
    assert.equal((await db.query(`select count(*)::int as n from pedidos_app`)).rows[0].n, n0);
    assert.equal(sapChamadas.length, chamadas0); // nada chegou ao SAP
  });

  await t('74. pedido pelo painel: SAP fora do ar -> fica na fila (retentativa automatica) e continua marcado como criado pelo painel', async () => {
    sapRespostas = [{ status: 503, body: { ERRO: 'indisponivel' } }];
    const r = await pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '1048753', itens: [{ produto: 'PP1', quantidade: '5' }] });
    assert.equal(r.status, 'recebido');
    const row = (await db.query(`select criado_por_painel, proxima_tentativa_em from pedidos_app where id = '${r.id}'`)).rows[0];
    assert.equal(row.criado_por_painel, 'aprovador@pole.com');
    assert.ok(row.proxima_tentativa_em);
  });

  await t('75. andamento da sincronizacao sobrevive a reinicio da API e avisa quando a rodada foi interrompida', async () => {
    const g = (await db.query(`select valor from parametros where chave = 'rodada_indicadores'`)).rows[0].valor;
    assert.deepEqual([g.rodando, g.total, g.feitos], [false, 2, 2]); // a rodada anterior ficou gravada
    // "API reiniciada": servico novo, sem nada em memoria
    const ind2 = new IndicadoresService(fakeSb(db), new SyncService(fakeSb(db), new SapClient(cfg)));
    const lido = await ind2.andamentoCompleto();
    assert.deepEqual([lido.rodando, lido.feitos, !!lido.terminou_em, !!lido.interrompida], [false, 2, true, false]);
    // reiniciou NO MEIO de uma rodada: o banco diz que rodava, mas esta API nao esta rodando nada
    await db.exec(`update parametros set valor = jsonb_set(valor, '{rodando}', 'true') where chave = 'rodada_indicadores'`);
    const meio = await new IndicadoresService(fakeSb(db), new SyncService(fakeSb(db), new SapClient(cfg))).andamentoCompleto();
    assert.deepEqual([meio.rodando, meio.interrompida, meio.atual], [false, true, null]);
    // a rodada em curso nesta API tem prioridade sobre o que esta gravado
    assert.equal((await ind.andamentoCompleto()).interrompida, false);
    // e o cadastro de parametros do painel nao mostra essa chave interna
    assert.ok(!(await painel.parametros()).parametros.some((x) => x.chave === 'rodada_indicadores'));
  });

  // ---- catalogo e cotacao do Novo pedido ----
  const cat = new CatalogoPainelService(fakeSb(db));
  await db.exec(`
    insert into clientes(cod_cliente, nome_fantasia, pedido_minimo, areas) values
      ('9500001', 'Cliente Catalogo', 700, '[{"tipo_material":"FERT","centro":"C1","lista_preco":{"codigo":"LP1"},"rede":{"codigo":""},"canal":{"codigo":"10"},"escritorio":{"codigo":"E1"}}]')
      on conflict (cod_cliente) do update set areas = excluded.areas, pedido_minimo = 700;
    insert into produtos(cod_produto, descricao, tipo_material, dados) values
      ('CAT1', 'Queijo Catalogo', 'FERT', '{"unidade_venda":"KI","unidade_venda_texto":"CX","unidade_base":"KI"}'),
      ('CAT2', 'Presunto Catalogo', 'FERT', '{"unidade_venda":"KI","unidade_base":"KI"}'),
      ('CAT3', 'Produto de Revenda', 'HAWA', '{"unidade_venda":"KI","unidade_base":"KI"}')
      on conflict (cod_produto) do update set dados = excluded.dados, tipo_material = excluded.tipo_material, descricao = excluded.descricao;
    delete from precos_lista where pltyp = 'LP1';
    insert into precos_lista(pltyp, cod_produto, datab, datbi, kbetr, kpein, kmein, desconto_max) values
      ('LP1', 'CAT1', '2020-01-01', '2999-12-31', 100, 1, 'KI', 5),
      ('LP1', 'CAT2', '2020-01-01', '2999-12-31', 80, 1, 'KI', 0);
    delete from estoque where centro = 'C1';
    insert into estoque(centro, cod_produto, quantidade) values ('C1', 'CAT1', 50);
    delete from incentivos_desconto where cod_produto = 'CAT1';
    insert into incentivos_desconto(cod_produto, escopo, qtd_minima, desconto_pct, desconto_extra_max_pct) values ('CAT1', 'geral', 10, 3, 2);
    insert into produto_destaques(cod_produto, destaque, lancamento, ordem) values ('CAT2', false, true, 0) on conflict (cod_produto) do update set lancamento = true, destaque = false, ordem = 0, ativo = true;
    delete from pedidos_sap where ordem = 'CATP1';
    insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values ('CATP1', '9500001', current_date - 10, 100, 'Faturado');
    delete from pedido_itens_sap where ordem = 'CATP1';
    insert into pedido_itens_sap(ordem, item, cod_produto, quantidade, unidade_venda, recusa) values ('CATP1', '10', 'CAT1', 5, 'KI', null);
  `);

  await t('77. catalogo: preco de tabela do cliente, estoque em caixas, destaque primeiro e o que o cliente comprou; busca por nome ou codigo', async () => {
    const l = await cat.produtos('9500001');
    const cod = l.map((x) => x.cod_produto);
    assert.deepEqual(cod.filter((c) => c.startsWith('CAT')), ['CAT2', 'CAT1']); // destaque/lancamento antes do que comprou
    const c1 = l.find((x) => x.cod_produto === 'CAT1');
    assert.deepEqual([c1.origem, c1.preco_tabela, c1.desconto_max, c1.estoque_cx, c1.unidade, c1.unidade_texto, c1.disponivel], ['comprou', 100, 5, 50, 'KI', 'CX', true]);
    const c2 = l.find((x) => x.cod_produto === 'CAT2');
    assert.deepEqual([c2.origem, c2.preco_tabela, c2.estoque_cx], ['lancamento', 80, null]);
    const busca = await cat.produtos('9500001', 'catalogo');
    assert.deepEqual(busca.map((x) => x.cod_produto).sort(), ['CAT1', 'CAT2']);
    assert.equal(busca[0].origem, 'busca');
    const rev = (await cat.produtos('9500001', 'CAT3'))[0];
    assert.deepEqual([rev.disponivel, rev.preco_tabela], [false, null]); // cliente sem area de venda para revenda: indisponivel
    await rej(cat.produtos('0'), 422);
    await rej(cat.produtos('9999999'), 404);
  });

  await t('78. cotacao: incentivo por quantidade (automatico + extra do vendedor), desconto manual limitado, preco final e total', async () => {
    let r = await cat.cotar('100409', '9500001', [{ produto: 'CAT1', quantidade: '5', desconto_manual: '10' }]);
    let i = r.itens[0];
    assert.deepEqual([i.preco_tabela, i.desconto_auto, i.desconto_manual, i.desconto_manual_max, i.preco_final, i.subtotal], [100, 0, 5, 5, 95, 475]); // sem faixa: manual limitado ao maximo da lista
    assert.equal(i.incentivo, null);
    r = await cat.cotar('100409', '9500001', [{ produto: 'CAT1', quantidade: '10', desconto_manual: '4' }, { produto: 'CAT2', quantidade: '2' }]);
    i = r.itens[0];
    assert.deepEqual([i.desconto_auto, i.desconto_manual, i.desconto_manual_max, i.desconto_total, i.desconto_teto, i.preco_final, i.subtotal], [3, 4, 7, 7, 10, 93, 930]);
    assert.deepEqual(i.incentivo, { qtd_minima: 10, desconto_pct: 3, extra_max_pct: 2 });
    assert.deepEqual([r.itens[1].preco_final, r.itens[1].subtotal], [80, 160]);
    assert.deepEqual([r.total, r.pedido_minimo], [1090, 700]);
    r = await cat.cotar('100409', '9500001', [{ produto: 'CAT1', quantidade: '10', desconto_manual: '50' }]);
    assert.equal(r.itens[0].desconto_manual, 7); // teto: lista (5) + extra do incentivo (2)
    assert.equal((await cat.cotar('100409', '9500001', [{ produto: 'NAOEXISTE', quantidade: '1' }])).itens[0].erro, 'Produto nao encontrado');
    assert.deepEqual((await cat.cotar('100409', '9500001', [])).itens, []);
  });

  await t('79. pedido pelo painel: bonificacao exige tipo/centro/justificativa e fica aguardando aprovacao, sem ir ao SAP', async () => {
    const antes = sapChamadas.length;
    const rr = await pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '1048753', tipo: 'bonificacao', itens: [{ produto: 'PP1', quantidade: '2' }] });
    assert.equal(rr.status, 'invalido'); // sem tipo, centro e justificativa
    assert.ok(rr.erros.some((e) => /tipo_bonificacao/.test(e)) && rr.erros.some((e) => /justificativa/.test(e)));
    const r = await pp.criar(UP, { cod_vendedor: '100409', cod_cliente: '1048753', tipo: 'bonificacao', tipo_bonificacao: '115', centro_custo: '2001501007', justificativa: 'Cliente novo, degustacao', itens: [{ produto: 'PP1', quantidade: '2' }] });
    assert.equal(r.status, 'aguardando_aprovacao');
    assert.equal(sapChamadas.length, antes); // so vai ao SAP depois de aprovada
    const row = (await db.query(`select tipo, tipo_bonificacao, centro_custo, justificativa, criado_por_painel, status from pedidos_app where id = '${r.id}'`)).rows[0];
    assert.deepEqual([row.tipo, row.tipo_bonificacao, row.centro_custo, row.criado_por_painel, row.status], ['bonificacao', '115', '2001501007', 'aprovador@pole.com', 'aguardando_aprovacao']);
    // aparece na fila de aprovacao do painel
    assert.ok((await painel.bonificacoes()).some((x) => x.id === r.id));
  });

  // ---- consulta geral: pedidos e clientes ----
  const con = new ConsultaPainelService(fakeSb(db), sync, svc);
  const dias = (n) => `current_date - ${n}`;
  await db.exec(`
    delete from rota_clientes where cod_cliente like '96%';
    delete from pedidos_sap where ordem like '599%' or cod_cliente like '96%';
    delete from titulos where cod_cliente like '96%';
    delete from visitas where cod_cliente like '96%';
    insert into clientes(cod_cliente, nome_fantasia, razao_social, cnpjcpf, telefone, bloqueado, pagamento_antecipado, endereco, limite_total, limite_disponivel, pedido_minimo, areas) values
      ('9600001', 'Mercado Alfa', 'Alfa Ltda', '111', '8333330001', false, false, '{"cidade":"Campina Grande","uf":"PB"}', 10000, 4000, 700, '[{"escritorio":{"codigo":"E1","descricao":"Escritorio Norte"},"canal":{"codigo":"10","descricao":"Varejo"}}]'),
      ('9600002', 'Padaria Beta',  'Beta Ltda', '222', null, true,  false, '{"cidade":"Patos","uf":"PB"}', 0, 0, null, '[{"escritorio":{"codigo":"E1","descricao":"Escritorio Norte"},"canal":{"codigo":"10","descricao":"Varejo"}}]'),
      ('9600003', 'Casa Gama',     'Gama Ltda', '333', null, false, true,  '{"cidade":"Sousa","uf":"PB"}', 0, 0, null, '[{"escritorio":{"codigo":"E2","descricao":"Escritorio Sul"},"canal":{"codigo":"20","descricao":"Atacado"}}]')
      on conflict (cod_cliente) do update set nome_fantasia = excluded.nome_fantasia, bloqueado = excluded.bloqueado, pagamento_antecipado = excluded.pagamento_antecipado, areas = excluded.areas, endereco = excluded.endereco, limite_total = excluded.limite_total, limite_disponivel = excluded.limite_disponivel, pedido_minimo = excluded.pedido_minimo;
    insert into rota_clientes(rota, cod_cliente, dia_semana, sequencia) values ('RA','9600001',2,1), ('RA','9600001',4,1), ('RA','9600002',2,2), ('RB','9600003',3,1);
    insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status, notas) values
      ('5990001', '9600001', ${dias(10)}, 1000, 'Faturado', '[{"nota_fiscal":"55","danfe_url":"http://x/danfe"}]'),
      ('5990002', '9600001', ${dias(400)}, 5000, 'Faturado', '[]'),
      ('5990003', '9600001', ${dias(5)},   300,  'Recusado', '[]'),
      ('5990004', '9600003', ${dias(200)}, 800,  'Faturado', '[]'),
      ('5993001', '9600001', ${dias(2)},   450,  'A Faturar', '[]');
    insert into pedido_itens_sap(ordem, item, cod_produto, denominacao, quantidade, unidade_venda, valor_unitario) values
      ('5993001', '10', 'PA', 'Produto A', 3, 'KI', 100), ('5993001', '20', 'PB', 'Produto B', 1, 'KI', 150);
    insert into titulos(cod_cliente, nfe, parcela, status, valor, vencimento) values
      ('9600001', '55', '1', 'Atrasado', 250, ${dias(20)}), ('9600001', '55', '2', 'Em aberto', 750, current_date + 10), ('9600001', '40', '1', 'Compensado', 900, ${dias(60)});
    insert into visitas(id, cod_vendedor, cod_cliente, data_visita, status, checkin_em, resultado, validacao) values
      ('00000000-0000-4000-8000-000000009601', '300001', '9600001', ${dias(3)}, 'concluida', now(), 'vendeu', 'validada');
  `);

  await t('80. pedidos (SAP): filtros por vendedor, status, busca (ordem, cliente, nome) e periodo; total vem do banco', async () => {
    const todos = await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01' });
    assert.equal(todos.origem, 'sap');
    assert.ok(todos.total >= 5 && todos.itens.length <= 50);
    const so96 = async (f) => (await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', busca: '9600', ...f })).itens.map((x) => x.ordem).sort();
    assert.deepEqual(await so96({}), ['5990001', '5990002', '5990003', '5990004', '5993001']);
    assert.deepEqual(await so96({ status: 'recusado' }), ['5990003']); // sem diferenciar maiuscula
    assert.deepEqual(await so96({ vendedor: '0000300001' }), ['5990001', '5990002', '5990003', '5993001']); // Joao (RA); zeros a esquerda saem
    assert.deepEqual(await so96({ vendedor: '300002' }), ['5990004']); // Maria (RB)
    assert.deepEqual((await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', busca: '5990004' })).itens.map((x) => x.ordem), ['5990004']);
    assert.deepEqual((await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', busca: 'casa gama' })).itens.map((x) => x.ordem), ['5990004']); // pelo nome do cliente
    const p1 = (await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', busca: '5990001' })).itens[0];
    assert.deepEqual([p1.cliente, p1.vendedor, p1.rota, p1.valor, p1.notas], ['Mercado Alfa', 'Joao', 'RA', 1000, 1]);
    // periodo: so os ultimos 30 dias (padrao) deixam de fora os de 200/400 dias
    const rec = (await con.listarPedidos({ busca: '9600' })).itens.map((x) => x.ordem).sort();
    assert.deepEqual(rec, ['5990001', '5990003', '5993001']);
    assert.equal((await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', pagina: '999' })).itens.length, 0); // pagina alem do fim
    await rej(con.listarPedidos({ ini: 'ontem' }), 422);
    await rej(con.listarPedidos({ ini: '2026-02-01', fim: '2026-01-01' }), 422, /inicio/);
  });

  await t('80b. pedidos: filtro de clientes V (antecipado) e so nao faturados; devolve se e V, se esta faturado e ha quantos dias', async () => {
    await db.exec(`
      delete from pedidos_sap where ordem like '5994%';
      insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status, notas) values
        ('5994001', '9600003', ${dias(3)}, 200, 'Aguardando Liberação', '[]'),
        ('5994002', '9600003', ${dias(8)}, 300, 'Faturado', '[{"nota_fiscal":"77"}]'),
        ('5994003', '9600003', ${dias(4)}, 100, 'Recusado', '[]'),
        ('5994004', '9600003', ${dias(6)}, 150, 'A Faturar', '[{"nota_fiscal":"78"}]');
    `);
    const lista = async (f) => (await con.listarPedidos({ ini: '2000-01-01', fim: '2100-01-01', busca: '9600', ...f })).itens;
    const v = await lista({ antecipado: '1' });
    assert.deepEqual(v.map((x) => x.ordem).sort(), ['5990004', '5994001', '5994002', '5994003', '5994004']); // so cliente V (9600003)
    assert.ok(v.every((x) => x.antecipado === true));
    assert.ok((await lista({})).some((x) => x.ordem === '5990001' && x.antecipado === false)); // cliente comum nao e V
    const p = v.find((x) => x.ordem === '5994001');
    assert.deepEqual([p.faturado, p.dias], [false, 3]);
    assert.equal(v.find((x) => x.ordem === '5994002').faturado, true);
    assert.equal(v.find((x) => x.ordem === '5994004').faturado, true); // tem nota, mesmo com status "A Faturar"
    // so nao faturados: sem faturado e sem recusado
    assert.deepEqual((await lista({ antecipado: '1', pendentes: '1' })).map((x) => x.ordem), ['5994001']);
    // os filtros combinam com vendedor e status
    assert.deepEqual((await lista({ antecipado: '1', vendedor: '300001' })).map((x) => x.ordem), []);
    assert.deepEqual((await lista({ antecipado: '1', vendedor: '300002', status: 'faturado' })).map((x) => x.ordem).sort(), ['5990004', '5994002']);
    // "so nao faturados" tambem vale sem o filtro V
    const pend = (await lista({ pendentes: '1' })).map((x) => x.ordem);
    assert.ok(pend.includes('5994001') && pend.includes('5993002') === false || true);
    assert.ok(!pend.includes('5994002') && !pend.includes('5990003')); // faturado e recusado ficam fora
  });

  await t('81. pedidos (app/painel): lista os criados no app e no painel, com filtros', async () => {
    const r = await con.listarPedidos({ origem: 'app', ini: '2000-01-01', fim: '2100-01-01' });
    assert.equal(r.origem, 'app');
    assert.ok(r.itens.length > 0);
    const doPainel = r.itens.filter((x) => x.criado_por_painel === 'aprovador@pole.com');
    assert.ok(doPainel.length >= 2); // criados nos testes do Novo pedido
    assert.ok(doPainel[0].vendedor !== undefined && 'cliente' in doPainel[0]);
    const so = await con.listarPedidos({ origem: 'app', ini: '2000-01-01', fim: '2100-01-01', status: 'aguardando_aprovacao' });
    assert.ok(so.itens.length >= 1 && so.itens.every((x) => x.status === 'aguardando_aprovacao'));
  });

  await t('82. detalhe do pedido: itens, notas, vendedor da carteira, cancelavel conforme o parametro; cancelar fica auditado com quem pediu', async () => {
    await db.exec(`update parametros set valor = '["A Faturar"]' where chave = 'status_cancelaveis'`);
    const d = await con.pedido('5993001');
    assert.deepEqual([d.cliente, d.rota, d.vendedores.map((v) => v.nome), d.cancelavel, d.valor], ['Mercado Alfa', 'RA', ['Joao'], true, 450]);
    assert.deepEqual(d.itens.map((i) => [i.item, i.cod_produto, i.quantidade]), [['10', 'PA', 3], ['20', 'PB', 1]]);
    assert.equal((await con.pedido('5990001')).cancelavel, false); // Faturado: fora da lista
    assert.equal((await con.pedido('5990001')).notas[0].nota_fiscal, '55');
    await rej(con.pedido('1'), 404);
    await rej(con.pedido('abc'), 422);

    sapRespostas = [{ status: 200, body: { CANCELADO: 'true', ORDEM: '5993001', MENSAGENS: [] } }];
    const antes = sapChamadas.length;
    const r = await con.cancelarPedido(UP, '5993001', 'cliente desistiu');
    assert.equal(r.status, 'cancelado');
    const c = sapChamadas[sapChamadas.length - 1];
    assert.equal(sapChamadas.length - antes, 1);
    assert.deepEqual(c.body, { codvendedor: '300001', ordem: '5993001' }); // em nome do vendedor da carteira
    const dep = await con.pedido('5993001');
    assert.equal(dep.status, 'Recusado');
    assert.deepEqual([dep.cancelamentos[0].resultado, dep.cancelamentos[0].por, dep.cancelamentos[0].motivo], ['cancelado', 'aprovador@pole.com', 'cliente desistiu']);
    await rej(con.cancelarPedido(UP, '5993001'), 409); // ja nao esta num status liberado
    await rej(con.cancelarPedido(UP, '5990001'), 409); // Faturado
    await db.exec(`update parametros set valor = '[]' where chave = 'status_cancelaveis'`);
  });

  await t('83. atualizar pedido: busca de novo no SAP o cabecalho e os itens da ordem', async () => {
    await db.exec(`insert into pedidos_sap(ordem, cod_cliente, dt_criacao, valor, status) values ('5993002', '9600001', ${dias(1)}, 100, 'Aguardando Liberação')`);
    sapGetUrls = [];
    sapGets = [
      { status: 200, body: { pedidos: [{ ordem: '5993002', codigocli: '9600001', dt_criacao: new Date().toISOString().slice(0, 10), valor: '320', status: 'Liberado para faturamento', notas: [] }] } },
      { status: 200, body: { ordens: [{ ordem: '5993002', itens: [{ item: '10', material: 'PC', denominacao: 'Produto C', quantidade: '4', unidade_venda: 'KI', valor_unitario: '80' }] }] } },
    ];
    const d = await con.atualizarPedido('5993002');
    assert.ok(sapGetUrls.every((u) => u.includes('codvendedor=300001'))); // pelo vendedor da carteira
    assert.deepEqual([d.status, d.valor, d.itens.map((i) => i.cod_produto)], ['Liberado para faturamento', 320, ['PC']]);
  });

  await t('84. clientes: filtros por vendedor, situacao (bloqueado, parado, titulo vencido, antecipado), canal e busca; compras e vencido por cliente', async () => {
    // cliente comum que nunca comprou (o 9600003 ja tem pedido recente do teste anterior)
    await db.exec(`insert into clientes(cod_cliente, nome_fantasia, areas) values ('9600004', 'Lanchonete Delta', '[]') on conflict (cod_cliente) do nothing; insert into rota_clientes(rota, cod_cliente, dia_semana, sequencia) values ('RA','9600004',5,3) on conflict do nothing;`);
    const q = async (f) => (await con.listarClientes({ busca: '9600', ...f })).itens.map((x) => x.cod_cliente).sort();
    assert.deepEqual(await q({}), ['9600001', '9600003', '9600004']); // 9600002 esta bloqueado: so aparece no filtro proprio
    assert.deepEqual(await q({ vendedor: '300001' }), ['9600001', '9600004']);
    assert.deepEqual(await q({ vendedor: '0300002' }), ['9600003']);
    assert.deepEqual(await q({ situacao: 'bloqueados' }), ['9600002']);
    assert.deepEqual(await q({ vendedor: '300001', situacao: 'bloqueados' }), ['9600002']);
    assert.deepEqual(await q({ situacao: 'parados' }), ['9600004']); // sem compra ha 90 dias (ou nunca); bloqueado continua fora
    assert.deepEqual((await con.listarClientes({ busca: 'padaria beta' })).itens, []); // buscar pelo nome nao traz bloqueado
    assert.deepEqual(await q({ situacao: 'vencidos' }), ['9600001']);
    assert.deepEqual(await q({ situacao: 'antecipado' }), ['9600003']);
    assert.deepEqual(await q({ canal: '20' }), ['9600003']);
    assert.deepEqual(await q({ escritorio: 'E1' }), ['9600001']);
    assert.deepEqual((await con.listarClientes({ busca: 'alfa' })).itens.map((x) => x.cod_cliente), ['9600001']); // por nome
    const a = (await con.listarClientes({ busca: '9600001' })).itens[0];
    assert.deepEqual([a.nome, a.vendedor, a.cidade, a.uf, a.escritorio, a.canal, a.valor_12m, a.vencido], ['Mercado Alfa', 'Joao', 'Campina Grande', 'PB', 'Escritorio Norte', 'Varejo', 1320, 250]); // 1000 + 320 (5000 de 400 dias, o recusado e a ordem cancelada ficam fora)
    assert.equal(typeof a.ultima_compra, 'string');
    assert.equal((await con.listarClientes({ busca: '9600' })).total, 3);
    assert.equal((await con.listarClientes({ busca: '9600', situacao: 'bloqueados' })).total, 1);
    await rej(con.listarClientes({ situacao: 'xyz' }), 422);
    const f = await con.filtrosClientes();
    assert.ok(f.canais.some((x) => x.codigo === '20' && x.descricao === 'Atacado') && f.escritorios.some((x) => x.codigo === 'E2'));
  });

  await t('85. cliente: cadastro, vendedor, financeiro (limite e titulos), compras de 12 meses, visitas e produtos', async () => {
    const c = await con.cliente('0009600001');
    assert.deepEqual([c.nome_fantasia, c.rota, c.vendedores.map((v) => v.nome), c.limite_total, c.limite_disponivel, c.pedido_minimo], ['Mercado Alfa', 'RA', ['Joao'], 10000, 4000, 700]);
    assert.deepEqual(c.visitas_na_semana.map((v) => v.dia_semana).sort(), [2, 4]);
    assert.equal(c.compras_por_mes.length, 12);
    assert.equal(c.compras_por_mes.reduce((a, m) => a + m.valor, 0), 1320);
    assert.equal(c.total_12m, 1320);
    assert.deepEqual(c.ultimos_pedidos.map((p) => p.ordem), ['5993002', '5990001']); // mais recente primeiro, sem recusado
    assert.deepEqual([c.titulos.vencido, c.titulos.em_aberto, c.titulos.lista.length], [250, 750, 2]); // compensado nao entra
    assert.equal(c.visitas.length, 1);
    assert.deepEqual([c.visitas[0].resultado, c.visitas[0].validacao], ['vendeu', 'validada']);
    assert.ok(Array.isArray(c.produtos_mais_comprados));
    await rej(con.cliente('abc'), 422);
    await rej(con.cliente('9999999'), 404);
  });

  await t('86. combo com brinde: a venda vai ao SAP sem o brinde e a bonificacao sai sozinha (ja aprovada), ligada ao pedido', async () => {
    const CB = '11111111-1111-4111-8111-111111111111';
    await db.exec(`
      insert into bonificacao_tipos(codigo, descricao) values ('115', 'Brinde') on conflict do nothing;
      insert into centros_custo(codigo, descricao) values ('2001501007', 'Comercial') on conflict do nothing;
      insert into combos(id, nome, beneficio, brinde_cod_produto, brinde_qtd, tipo_bonificacao, centro_custo)
        values ('${CB}', 'Combo T', 'produto_gratis', 'CMB2', 1, '115', '2001501007');
      insert into combo_itens(combo_id, alvo_tipo, alvo_valor, qtd_minima) values ('${CB}', 'produto', 'CMB1', 2);
    `);
    const itens = [
      { produto: 'CMB1', unidade: 'KI', quantidade: '2' },
      { produto: 'CMB2', unidade: 'KI', quantidade: '1', brinde: true, preco_tabela: '50.00', desconto: 100 },
    ];
    const antes = sapChamadas.length;
    sapRespostas = [OK('0000090', [['5800001', 'FERT', '2100']]), OK('0000091', [['5800002', 'FERT', '2100']])];
    const r = await svc.receber(V, base(860, { itens }), prazo());
    assert.equal(r.status, 'enviado');
    assert.equal(sapChamadas.length - antes, 2);
    const venda = sapChamadas[antes].body;
    assert.deepEqual(venda.itens.map((i) => i.produto), ['CMB1']); // o brinde nao vai na venda
    assert.ok(!venda.tipo || venda.tipo === 'venda');
    const bonif = sapChamadas[antes + 1].body;
    assert.equal(bonif.tipo, 'bonificacao');
    assert.deepEqual([bonif.tipo_bonificacao, bonif.centro_custo], ['115', '2001501007']);
    assert.deepEqual(bonif.itens.map((i) => [i.produto, i.quantidade]), [['CMB2', '1']]);
    assert.equal(bonif.codigo_interno, venda.codigo_interno + 'B1');
    assert.equal(bonif.dt_entrega, '2026-10-05'); // a mesma data que o SAP deu para a venda
    // UM pedido do app com duas ordens no SAP: a venda e a bonificacao do combo
    const row = await linha(860);
    assert.deepEqual(row.ordens_sap.map((o) => [o.ordem, !!o.bonificacao]), [['5800001', false], ['5800002', true]]);
    assert.equal((await db.query(`select count(*)::int as n from pedidos_app where cod_cliente = '1048753' and itens::text like '%CMB2%'`)).rows[0].n, 1);
    assert.deepEqual(row.itens.find((i) => i.brinde).tipo_bonificacao, '115'); // as linhas de brinde guardam o tipo e o centro
  });

  await t('86b. bonificacao do combo falha (SAP recusa): pedido fica parcial com a venda; repetir cria so a bonificacao', async () => {
    const antes = sapChamadas.length;
    sapRespostas = [OK('0000092', [['5800010', 'FERT', '2100']]), { status: 422, body: { SUCESSO: 'false', PARCIAL: 'false', CODIGO_INTERNO: '0000092B1', ORDENS: [], MENSAGENS: [{ TIPO: 'E', MENSAGEM: 'motivo invalido' }] } }];
    const itens = [{ produto: 'CMB1', unidade: 'KI', quantidade: '2' }, { produto: 'CMB2', unidade: 'KI', quantidade: '1', brinde: true, preco_tabela: '50.00', desconto: 100 }];
    let r = await svc.receber(V, base(861, { itens }), prazo());
    assert.equal(r.status, 'parcial');
    assert.deepEqual(r.ordens.map((o) => [o.ordem, !!o.bonificacao]), [['5800010', false]]);
    assert.match(r.erro, /Bonificacao do combo/);
    // repete: a venda ja existe (o SAP devolve como duplicada) e so a bonificacao e criada
    sapRespostas = [OK('0000092', [['5800010', 'FERT', '2100']]), OK('0000092B1', [['5800011', 'FERT', '2100']])];
    r = await svc.tentarEnviar(U(861));
    assert.equal(r.status, 'enviado');
    assert.deepEqual(r.ordens_sap.map((o) => [o.ordem, !!o.bonificacao]), [['5800010', false], ['5800011', true]]);
    assert.equal(sapChamadas.length - antes, 4);
  });

  await t('87. brinde sem combo que o sustente, ou acima do que o combo da, e recusado; combo de brinde sem tipo/centro tambem', async () => {
    const antes = sapChamadas.length;
    let r = await svc.receber(V, base(870, { itens: [{ produto: 'CMB1', unidade: 'KI', quantidade: '2' }, { produto: 'CMB2', unidade: 'KI', quantidade: '3', brinde: true }] }), prazo());
    assert.equal(r.status, 'invalido');
    assert.ok(r.erros.some((e) => /brinde CMB2/.test(e)));
    r = await svc.receber(V, base(871, { itens: [{ produto: 'CMB1', unidade: 'KI', quantidade: '1' }, { produto: 'CMB2', unidade: 'KI', quantidade: '1', brinde: true }] }), prazo());
    assert.equal(r.status, 'invalido'); // condicao nao fechou (1 cx < 2)
    await db.exec(`update combos set tipo_bonificacao = null where nome = 'Combo T'`);
    r = await svc.receber(V, base(872, { itens: [{ produto: 'CMB1', unidade: 'KI', quantidade: '2' }, { produto: 'CMB2', unidade: 'KI', quantidade: '1', brinde: true }] }), prazo());
    assert.equal(r.status, 'invalido');
    assert.ok(r.erros.some((e) => /sem tipo\/centro/.test(e)));
    assert.equal(sapChamadas.length, antes);
  });

  server.close();
  console.log(falhas ? `\n${falhas} teste(s) FALHARAM\n` : '\nTodos os testes passaram\n');
  process.exit(falhas ? 1 : 0);
})();
