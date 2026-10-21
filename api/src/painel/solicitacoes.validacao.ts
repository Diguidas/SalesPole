import { UnprocessableEntityException } from '@nestjs/common';

type Corpo = Record<string, unknown>;

export const TIPOS_SUPERVISOR = ['aumento_limite', 'alteracao_pagamento', 'agrupamento', 'exclusao'] as const;
export type TipoSupervisor = (typeof TIPOS_SUPERVISOR)[number];

const erro = (m: string) => new UnprocessableEntityException(m);

export const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

export function cpfValido(v: string): boolean {
  if (!/^\d{11}$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  const dig = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(v[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dig(9) === Number(v[9]) && dig(10) === Number(v[10]);
}

export function cnpjValido(v: string): boolean {
  if (!/^\d{14}$/.test(v) || /^(\d)\1+$/.test(v)) return false;
  const dig = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const s = pesos.reduce((a, p, i) => a + p * Number(v[i]), 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dig(12) === Number(v[12]) && dig(13) === Number(v[13]);
}

const txt = (b: Corpo, c: string, rotulo: string, { max = 120, obrigatorio = false } = {}): string | null => {
  const v = b[c] == null ? '' : String(b[c]).trim();
  if (!v) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return null;
  }
  if (v.length > max) throw erro(`${rotulo} tem no maximo ${max} caracteres`);
  return v;
};

const sn = (b: Corpo, c: string, rotulo: string): boolean => {
  const v = b[c];
  if (v === true || v === 'true' || v === 'sim') return true;
  if (v === false || v === 'false' || v === 'nao') return false;
  throw erro(`${rotulo}: responda Sim ou Nao`);
};

const email = (b: Corpo, c: string, rotulo: string, obrigatorio: boolean): string | null => {
  const v = txt(b, c, rotulo, { max: 120, obrigatorio });
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw erro(`${rotulo} invalido`);
  return v?.toLowerCase() ?? null;
};

const fone = (b: Corpo, c: string, rotulo: string, obrigatorio: boolean): string | null => {
  const v = soDigitos(b[c]);
  if (!v) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return null;
  }
  if (v.length < 10 || v.length > 11) throw erro(`${rotulo} invalido (DDD + numero)`);
  return v;
};

const coord = (b: Corpo, c: string, rotulo: string, lim: number): number | null => {
  if (b[c] == null || b[c] === '') return null;
  const n = Number(String(b[c]).replace(',', '.'));
  if (!Number.isFinite(n) || Math.abs(n) > lim) throw erro(`${rotulo} invalida`);
  return n;
};

export interface CadastroCliente {
  dados: Record<string, unknown>;
  documento: string;
}

/** Valida o formulario de cadastro de cliente. Escritorio, equipe, rota e vendedor sao preenchidos pelo servidor depois. */
export function validarCadastroCliente(b: Corpo): CadastroCliente {
  const pessoa = b.tipo_pessoa === 'F' ? 'F' : b.tipo_pessoa === 'J' ? 'J' : null;
  if (!pessoa) throw erro('Informe o tipo de pessoa (Juridica ou Fisica)');
  const documento = soDigitos(b.documento);
  if (pessoa === 'J' && !cnpjValido(documento)) throw erro('CNPJ invalido');
  if (pessoa === 'F' && !cpfValido(documento)) throw erro('CPF invalido');

  const dados: Record<string, unknown> = { tipo_pessoa: pessoa, documento };
  if (pessoa === 'J') {
    dados.inscricao_estadual = txt(b, 'inscricao_estadual', 'Inscricao estadual', { max: 20, obrigatorio: true });
    dados.razao_social = txt(b, 'razao_social', 'Razao social', { max: 120, obrigatorio: true });
    dados.nome_fantasia = txt(b, 'nome_fantasia', 'Nome fantasia', { max: 120, obrigatorio: true });
  } else {
    dados.nome = txt(b, 'nome', 'Nome', { max: 60, obrigatorio: true });
    dados.sobrenome = txt(b, 'sobrenome', 'Sobrenome', { max: 60, obrigatorio: true });
  }

  const cep = soDigitos(b.cep);
  if (cep.length !== 8) throw erro('CEP invalido');
  const uf = txt(b, 'uf', 'UF', { max: 2, obrigatorio: true })!.toUpperCase();
  if (!/^[A-Z]{2}$/.test(uf)) throw erro('UF deve ter 2 letras');
  Object.assign(dados, {
    cep,
    endereco: txt(b, 'endereco', 'Endereco', { max: 120, obrigatorio: true }),
    numero: txt(b, 'numero', 'Numero', { max: 10, obrigatorio: true }),
    complemento: txt(b, 'complemento', 'Complemento', { max: 60 }),
    latitude: coord(b, 'latitude', 'Latitude', 90),
    longitude: coord(b, 'longitude', 'Longitude', 180),
    bairro: txt(b, 'bairro', 'Bairro', { max: 60, obrigatorio: true }),
    uf,
    municipio: txt(b, 'municipio', 'Municipio', { max: 60, obrigatorio: true }),
    distrito: txt(b, 'distrito', 'Distrito', { max: 60 }),
    ponto_referencia: txt(b, 'ponto_referencia', 'Ponto de referencia', { max: 120 }),
  });

  Object.assign(dados, {
    email: email(b, 'email', 'E-mail prioritario', true),
    telefone_fixo: fone(b, 'telefone_fixo', 'Telefone fixo', false),
    proprietario_nome: txt(b, 'proprietario_nome', 'Nome do proprietario', { max: 80, obrigatorio: true }),
    proprietario_celular: fone(b, 'proprietario_celular', 'Celular do proprietario', true),
    proprietario_email: email(b, 'proprietario_email', 'E-mail do proprietario', false),
  });
  const proprietarioCompra = sn(b, 'proprietario_compra', 'O proprietario e responsavel pelas compras?');
  dados.proprietario_compra = proprietarioCompra;
  if (!proprietarioCompra) {
    dados.comprador_nome = txt(b, 'comprador_nome', 'Nome do responsavel pelas compras', { max: 80, obrigatorio: true });
    dados.comprador_celular = fone(b, 'comprador_celular', 'Celular do responsavel pelas compras', true);
    dados.comprador_email = email(b, 'comprador_email', 'E-mail do responsavel pelas compras', true);
  }

  dados.em_rede = sn(b, 'em_rede', 'Participa de rede cadastrada?');
  if (dados.em_rede) dados.rede = txt(b, 'rede', 'Rede', { max: 80, obrigatorio: true });
  dados.e_filial = sn(b, 'e_filial', 'E filial de cliente cadastrado?');
  if (dados.e_filial) dados.cod_cliente_pai = txt(b, 'cod_cliente_pai', 'Codigo do cliente pai', { max: 10, obrigatorio: true });
  dados.e_substituicao = sn(b, 'e_substituicao', 'Sera substituicao de cliente cadastrado?');
  if (dados.e_substituicao) dados.cod_cliente_substituido = txt(b, 'cod_cliente_substituido', 'Codigo do cliente substituido', { max: 10, obrigatorio: true });

  const dia = Number(b.dia_visita);
  if (!Number.isInteger(dia) || dia < 1 || dia > 5) throw erro('Dia de visita deve ser de segunda a sexta');
  const ordem = Number(b.ordem_visita);
  if (!Number.isInteger(ordem) || ordem < 1 || ordem > 999) throw erro('Ordem da visita deve ser um numero entre 1 e 999');
  Object.assign(dados, {
    org_vendas: txt(b, 'org_vendas', 'Organizacao de venda', { max: 10, obrigatorio: true }),
    dia_visita: dia,
    ordem_visita: ordem,
    prazo: txt(b, 'prazo', 'Prazo', { max: 80, obrigatorio: true }),
    canal: txt(b, 'canal', 'Canal de vendas', { max: 80, obrigatorio: true }),
    tipo_estabelecimento: txt(b, 'tipo_estabelecimento', 'Tipo de estabelecimento', { max: 80, obrigatorio: true }),
    observacao: txt(b, 'observacao', 'Observacao', { max: 500 }),
  });
  if (pessoa === 'F' && b.tem_comprovante !== true) throw erro('Anexe o comprovante de endereco (obrigatorio para pessoa fisica)');
  dados.tem_comprovante = pessoa === 'F';
  return { dados, documento };
}

export interface PedidoSupervisor {
  dados: Record<string, unknown>;
  cod_cliente: string;
}

/** Valida os formularios do supervisor (alteracao e exclusao). Supervisor e e-mail vem do login. */
export function validarSolicitacaoSupervisor(tipo: TipoSupervisor, b: Corpo): PedidoSupervisor {
  const cod = soDigitos(b.cod_cliente).replace(/^0+/, '');
  if (!cod) throw erro('Informe o codigo do cliente');
  const dados: Record<string, unknown> = { cod_cliente: cod, observacao: txt(b, 'observacao', 'Observacao/resumo', { max: 500, obrigatorio: tipo !== 'exclusao' }) };
  if (tipo === 'agrupamento') {
    const pai = soDigitos(b.conta_credito).replace(/^0+/, '');
    if (!pai) throw erro('Informe a conta de credito (conta pai)');
    if (pai === cod) throw erro('A conta pai deve ser diferente do cliente');
    dados.conta_credito = pai;
  } else if (tipo === 'aumento_limite') {
    const n = Number(String(b.limite_credito ?? '').replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 999_999_999) throw erro('Limite de credito invalido');
    dados.limite_credito = n;
  } else if (tipo === 'alteracao_pagamento') {
    dados.condicao_pagamento = txt(b, 'condicao_pagamento', 'Condicao de pagamento', { max: 80, obrigatorio: true });
  } else {
    dados.motivo = txt(b, 'motivo', 'Motivo da exclusao', { max: 80, obrigatorio: true });
  }
  return { dados, cod_cliente: cod };
}
