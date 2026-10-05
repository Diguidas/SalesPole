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
  select(c) { this.cols = c; return this; }
  eq(c, v) { this.f.push([c, '=', v]); return this; }
  neq(c, v) { this.f.push([c, '<>', v]); return this; }
  gte(c, v) { this.f.push([c, '>=', v]); return this; }
  gt(c, v) { this.f.push([c, '>', v]); return this; }
  lte(c, v) { this.f.push([c, '<=', v]); return this; }
  in(c, arr) { this.f.push([c, 'in', arr]); return this; }
  limit(n) { this.lim = n; return this; }
  order(c, o) { this.ord = [c, o && o.ascending === false ? 'desc' : 'asc']; return this; }
  maybeSingle() { this.single = true; return this.run(); }
  upsert(o, opts) { this.op = 'upsert'; this.obj = o; this.opts = opts || {}; return this; }
  update(o) { this.op = 'update'; this.obj = o; return this; }
  insert(o) { this.op = 'insert'; this.obj = o; return this; }
  then(res, rej) { return this.run().then(res, rej); }
  where(params) {
    if (!this.f.length) return '';
    return ' where ' + this.f.map(([c, o, v]) => {
      if (o === 'in') { params.push(v); return `${c} = any($${params.length})`; }
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
      if (this.op === 'insert' || this.op === 'upsert') {
        const cols = Object.keys(this.obj);
        cols.forEach((c) => params.push(val(this.obj[c])));
        let sql = `insert into ${this.table} (${cols.join(',')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')})`;
        if (this.op === 'upsert') sql += this.opts.ignoreDuplicates ? ` on conflict (${this.opts.onConflict}) do nothing` : '';
        await this.db.query(sql, params);
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        const cols = Object.keys(this.obj);
        cols.forEach((c) => params.push(val(this.obj[c])));
        const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
        await this.db.query(`update ${this.table} set ${set}${this.where(params)}`, params);
        return { data: null, error: null };
      }
    } catch (e) { return { data: null, error: { message: e.message } }; }
  }
}
const fakeSb = (db) => ({
  from: (t) => new Q(db, t),
  rpc: async (fn, args) => {
    try {
      const names = Object.keys(args || {});
      const sql = `select * from ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
      const rows = (await db.query(sql, names.map((n) => args[n]))).rows.map(fixRow);
      return { data: rows, error: null };
    } catch (e) { return { data: null, error: { message: e.message } }; }
  },
});

// ---------------- SAP falso ----------------
let sapRespostas = []; // fila de {status, body|raw}
let sapChamadas = []; // so POSTs ACEITOS pelo CSRF
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
    console.log('        actual   = ' + JSON.stringify(e.actual));
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

  server.close();
  console.log(falhas ? `\n${falhas} teste(s) FALHARAM\n` : '\nTodos os testes passaram\n');
  process.exit(falhas ? 1 : 0);
})();
