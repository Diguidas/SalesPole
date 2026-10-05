import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class SapError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly resource: string,
    readonly url: string = '',
  ) {
    // paginas de erro do SAP vem em HTML: mostra so o <title>
    const resumo = /<title>(.*?)<\/title>/is.exec(body)?.[1]?.trim() ?? body.slice(0, 300);
    super(`SAP ${resource} respondeu ${status} (${resumo}) em ${url}`);
  }
}

export interface RespostaSap<T> {
  status: number;
  data: T;
}

/** Token CSRF + cookie de sessao do SAP (o token so vale junto com o cookie da sessao que o gerou). */
interface SessaoCsrf {
  token: string;
  cookie: string;
  obtidaEm: number;
}

interface RespostaBruta {
  status: number;
  texto: string;
  url: string;
  /** o SAP recusou o POST por token CSRF ausente/invalido/expirado */
  csrfExigido: boolean;
}

/** Recurso leve e so de leitura, usado apenas para pedir o token CSRF. */
const RECURSO_TOKEN = 'catalogo_preco';
const TOKEN_TTL_MS = 10 * 60_000;

/**
 * Cliente HTTP dos endpoints /poletech/salespole/salespole_<recurso>
 * (ZCL_INTEGRACAO_POLE_TECH). Autenticacao Basic.
 *
 * - get(): 4xx/5xx viram SapError.
 * - postComStatus(): o ICF REST do SAP exige TOKEN CSRF em POST. Busca o token com um GET
 *   "X-CSRF-Token: Fetch", guarda token + cookie de sessao e os envia no POST; se o SAP recusar
 *   por CSRF (sessao expirou), renova e tenta UMA vez de novo. Devolve status + corpo JSON mesmo
 *   em 4xx (o criar_pedido responde com detalhes de validacao); so lanca SapError se o corpo nao
 *   for JSON (ex.: pagina de erro HTML) ou em falha de rede/timeout.
 */
@Injectable()
export class SapClient {
  private readonly logger = new Logger(SapClient.name);
  private readonly base: string;
  private readonly authorization: string;
  private readonly sapClient?: string;
  private readonly timeoutMs: number;

  private sessao?: SessaoCsrf;
  private sessaoEmAndamento?: Promise<SessaoCsrf>;

  constructor(cfg: ConfigService) {
    this.base = cfg.getOrThrow<string>('SAP_BASE_URL').replace(/\/+$/, '');
    const user = cfg.getOrThrow<string>('SAP_USER');
    const pass = cfg.getOrThrow<string>('SAP_PASSWORD');
    this.authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
    this.sapClient = cfg.get<string>('SAP_CLIENT');
    this.timeoutMs = Number(cfg.get('SAP_TIMEOUT_MS') ?? 60000);
  }

  async get<T>(resource: string, params: Record<string, string | undefined> = {}): Promise<T> {
    const r = await this.chamar('GET', resource, params);
    if (r.status < 200 || r.status >= 300) throw new SapError(r.status, r.texto, resource, r.url);
    return this.parse<T>(r, resource);
  }

  async postComStatus<T>(resource: string, body: unknown): Promise<RespostaSap<T>> {
    let r = await this.chamar('POST', resource, {}, body, await this.obterSessao());

    if (r.status === 403 && r.csrfExigido) {
      this.logger.warn('SAP recusou o token CSRF; renovando e tentando de novo');
      r = await this.chamar('POST', resource, {}, body, await this.obterSessao(true));
    }
    return { status: r.status, data: this.parse<T>(r, resource) };
  }

  // ---------------------------------------------------------------------

  /** Token + cookie vigentes (cache de 10 min; chamadas simultaneas compartilham a mesma busca). */
  private obterSessao(forcar = false): Promise<SessaoCsrf> {
    if (!forcar && this.sessao && Date.now() - this.sessao.obtidaEm < TOKEN_TTL_MS) return Promise.resolve(this.sessao);
    if (!this.sessaoEmAndamento) {
      this.sessaoEmAndamento = this.buscarSessao().finally(() => {
        this.sessaoEmAndamento = undefined;
      });
    }
    return this.sessaoEmAndamento;
  }

  private async buscarSessao(): Promise<SessaoCsrf> {
    const url = this.montarUrl(RECURSO_TOKEN, {});
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: this.authorization, Accept: 'application/json', 'X-CSRF-Token': 'Fetch' },
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const texto = await res.text();
    const token = res.headers.get('x-csrf-token');

    if (!res.ok || !token || token.toLowerCase() === 'required') {
      throw new SapError(res.status, texto || 'O SAP nao devolveu o token CSRF (cabecalho x-csrf-token ausente)', 'csrf', url.toString());
    }

    // so "nome=valor" de cada Set-Cookie (descarta Path/HttpOnly/...)
    const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    this.sessao = { token, cookie, obtidaEm: Date.now() };
    this.logger.debug('Token CSRF obtido do SAP');
    return this.sessao;
  }

  private montarUrl(resource: string, params: Record<string, string | undefined>): URL {
    // rotas cadastradas na ZTAPI_ROUTES: /poletech/salespole/salespole_<recurso>
    const url = new URL(`${this.base}/poletech/salespole/salespole_${resource}`);
    if (this.sapClient) url.searchParams.set('sap-client', this.sapClient);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== '') url.searchParams.set(k, v);
    }
    // listas ("ordens=1,2,3"): o ICF do SAP nao decodifica %2C e leria uma ordem so; a virgula vai crua
    url.search = url.search.replace(/%2C/gi, ',');
    return url;
  }

  private parse<T>(r: RespostaBruta, resource: string): T {
    if (!r.texto) return {} as T;
    try {
      return normalizar(JSON.parse(r.texto)) as T;
    } catch {
      throw new SapError(r.status, r.texto, resource, r.url);
    }
  }

  private async chamar(
    method: 'GET' | 'POST',
    resource: string,
    params: Record<string, string | undefined>,
    body?: unknown,
    sessao?: SessaoCsrf,
  ): Promise<RespostaBruta> {
    const url = this.montarUrl(resource, params);

    const t0 = Date.now();
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authorization,
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(sessao ? { 'X-CSRF-Token': sessao.token, ...(sessao.cookie ? { Cookie: sessao.cookie } : {}) } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const texto = await res.text();
    this.logger.debug(`${method} ${resource} -> ${res.status} (${Date.now() - t0}ms)`);

    const csrfExigido =
      res.headers.get('x-csrf-token')?.toLowerCase() === 'required' || (res.status === 403 && /csrf/i.test(texto));
    return { status: res.status, texto, url: url.toString(), csrfExigido }; // url sem credenciais (vao no header)
  }
}

/**
 * Normaliza a resposta do SAP: chaves em minusculas (a ZF_SERIALIZE_JSON devolve
 * MAIUSCULAS) e textos sem espacos nas pontas (campos CHAR/NUMC voltam
 * preenchidos: "100409    ", "1 ").
 */
function normalizar(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizar);
  if (typeof v === 'string') return v.trim();
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.toLowerCase(), normalizar(x)]),
    );
  }
  return v;
}
