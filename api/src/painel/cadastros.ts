import { UnprocessableEntityException } from '@nestjs/common';

type Linha = Record<string, unknown>;

export interface Cadastro {
  tabela: string;
  /** coluna que identifica a linha; 'id' = uuid gerado pelo banco (sem chave digitada) */
  chave: string;
  ordem: Array<[string, boolean]>; // [coluna, ascendente]
  /** valida e normaliza o corpo recebido; devolve so as colunas que podem ser gravadas */
  validar: (b: Linha) => Linha;
}

const erro = (m: string) => new UnprocessableEntityException(m);

const texto = (b: Linha, c: string, rotulo: string, { max = 120, obrigatorio = false } = {}): string | null => {
  const v = b[c] == null ? '' : String(b[c]).trim();
  if (!v) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return null;
  }
  if (v.length > max) throw erro(`${rotulo} tem no maximo ${max} caracteres`);
  return v;
};

const numero = (b: Linha, c: string, rotulo: string, { min = 0, max = Infinity, obrigatorio = false, padrao = 0 } = {}): number => {
  if (b[c] === '' || b[c] == null) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatorio`);
    return padrao;
  }
  const n = Number(String(b[c]).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw erro(`${rotulo} deve estar entre ${min} e ${max === Infinity ? 'o maximo' : max}`);
  return n;
};

const data = (b: Linha, c: string, rotulo: string, obrigatorio = false): string | null => {
  const v = b[c] == null ? '' : String(b[c]).trim();
  if (!v) {
    if (obrigatorio) throw erro(`${rotulo} e obrigatoria`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw erro(`${rotulo} invalida (use AAAA-MM-DD)`);
  return v;
};

const flag = (b: Linha, c: string, padrao = false) => (b[c] == null ? padrao : b[c] === true || b[c] === 'true');

const TIPOS_PERGUNTA = ['texto', 'sim_nao', 'numero', 'opcoes'];
const ESCOPOS_PERGUNTA = ['geral', 'vendedor', 'escritorio', 'canal', 'cliente'];
const ESCOPOS = ['geral', 'produto', 'cliente', 'vendedor', 'canal', 'escritorio', 'lista_preco', 'equipe', 'tipo_estabelecimento'];

export const CADASTROS: Record<string, Cadastro> = {
  bi: {
    tabela: 'bi_paineis',
    chave: 'id',
    ordem: [['ordem', true], ['nome', true]],
    validar: (b) => {
      const url = texto(b, 'url', 'Link', { max: 1000, obrigatorio: true })!;
      if (!/^https:\/\/[^\s]+$/i.test(url)) throw erro('O link precisa comecar com https://');
      const onde = texto(b, 'onde', 'Onde aparece', { max: 10 }) ?? 'painel';
      if (!['painel', 'app', 'ambos'].includes(onde)) throw erro('Onde aparece invalido');
      return {
        nome: texto(b, 'nome', 'Nome', { max: 60, obrigatorio: true }),
        url,
        onde,
        ordem: Math.trunc(numero(b, 'ordem', 'Ordem', { min: 0, max: 9999 })),
        ativo: flag(b, 'ativo', true),
      };
    },
  },
  'tipos-bonificacao': {
    tabela: 'bonificacao_tipos',
    chave: 'codigo',
    ordem: [['codigo', true]],
    validar: (b) => {
      const codigo = texto(b, 'codigo', 'Codigo', { max: 3, obrigatorio: true })!;
      return { codigo, descricao: texto(b, 'descricao', 'Descricao', { max: 80, obrigatorio: true }), ativo: flag(b, 'ativo', true) };
    },
  },
  'centros-custo': {
    tabela: 'centros_custo',
    chave: 'codigo',
    ordem: [['codigo', true]],
    validar: (b) => {
      const codigo = texto(b, 'codigo', 'Codigo', { max: 10, obrigatorio: true })!;
      return { codigo, descricao: texto(b, 'descricao', 'Descricao', { max: 80, obrigatorio: true }), ativo: flag(b, 'ativo', true) };
    },
  },
  destaques: {
    tabela: 'produto_destaques',
    chave: 'cod_produto',
    ordem: [['ordem', true]],
    validar: (b) => {
      const destaque = flag(b, 'destaque');
      const lancamento = flag(b, 'lancamento');
      if (!destaque && !lancamento) throw erro('Marque destaque e/ou lancamento (ou desative o produto)');
      return {
        cod_produto: texto(b, 'cod_produto', 'Produto', { max: 40, obrigatorio: true }),
        destaque,
        lancamento,
        ordem: Math.trunc(numero(b, 'ordem', 'Ordem', { min: 0, max: 9999 })),
        ativo: flag(b, 'ativo', true),
      };
    },
  },
  feriados: {
    tabela: 'feriados',
    chave: 'id',
    ordem: [['data', true]],
    validar: (b) => {
      const uf = texto(b, 'uf', 'UF', { max: 2 })?.toUpperCase() ?? null;
      const cidade = texto(b, 'cidade', 'Cidade', { max: 80 });
      if (uf && !/^[A-Z]{2}$/.test(uf)) throw erro('UF deve ter 2 letras');
      if (cidade && !uf) throw erro('Feriado municipal precisa da UF');
      return {
        data: data(b, 'data', 'Data', true),
        descricao: texto(b, 'descricao', 'Descricao', { max: 80, obrigatorio: true }),
        uf,
        cidade,
        ativo: flag(b, 'ativo', true),
      };
    },
  },
  avisos: {
    tabela: 'avisos',
    chave: 'id',
    ordem: [['updated_at', false]],
    validar: (b) => {
      const nivel = texto(b, 'nivel', 'Nivel', { max: 20 }) ?? 'info';
      if (!['info', 'importante', 'urgente'].includes(nivel)) throw erro('Nivel invalido');
      const escopo = texto(b, 'escopo', 'Para quem', { max: 20 }) ?? 'geral';
      if (!['geral', 'vendedor', 'escritorio', 'canal'].includes(escopo)) throw erro('Escopo invalido');
      const escopoValor = texto(b, 'escopo_valor', 'Codigos', { max: 400 });
      if (escopo !== 'geral' && !escopoValor) throw erro('Informe o(s) codigo(s) do vendedor, escritorio ou canal');
      const ini = data(b, 'vigencia_ini', 'Inicio da vigencia');
      const fim = data(b, 'vigencia_fim', 'Fim da vigencia');
      if (ini && fim && fim < ini) throw erro('O fim da vigencia e anterior ao inicio');
      return {
        titulo: texto(b, 'titulo', 'Titulo', { max: 80, obrigatorio: true }),
        mensagem: texto(b, 'mensagem', 'Mensagem', { max: 1000, obrigatorio: true }),
        nivel,
        escopo,
        escopo_valor: escopo === 'geral' || !escopoValor
          ? null
          : [...new Set(escopoValor.split(/[,;\s]+/).filter(Boolean).map((x) => (escopo === 'vendedor' ? x.replace(/^0+/, '') || '0' : x)))].join(','),
        vigencia_ini: ini,
        vigencia_fim: fim,
        ativo: flag(b, 'ativo', true),
      };
    },
  },
  'perguntas-visita': {
    tabela: 'visita_perguntas',
    chave: 'id',
    ordem: [['ordem', true], ['updated_at', false]],
    validar: (b) => {
      const tipo = texto(b, 'tipo', 'Tipo de resposta', { max: 20 }) ?? 'texto';
      if (!TIPOS_PERGUNTA.includes(tipo)) throw erro('Tipo de resposta invalido');
      const escopo = texto(b, 'escopo', 'A quem vale', { max: 20 }) ?? 'geral';
      if (!ESCOPOS_PERGUNTA.includes(escopo)) throw erro('Escopo invalido');
      const escopoValor = texto(b, 'escopo_valor', 'Codigos', { max: 400 });
      if (escopo !== 'geral' && !escopoValor) throw erro('Informe o(s) codigo(s) do vendedor, escritorio, canal ou cliente');
      let opcoes: string | null = null;
      if (tipo === 'opcoes') {
        const lista = [...new Set(String(b.opcoes ?? '').split(';').map((x) => x.trim()).filter(Boolean))];
        if (lista.length < 2) throw erro('Informe ao menos 2 opcoes separadas por ponto e virgula');
        if (lista.some((x) => x.length > 60) || lista.length > 15) throw erro('No maximo 15 opcoes de ate 60 caracteres');
        opcoes = lista.join('; ');
      }
      return {
        texto: texto(b, 'texto', 'Pergunta', { max: 200, obrigatorio: true }),
        tipo,
        opcoes,
        obrigatoria: flag(b, 'obrigatoria'),
        escopo,
        // codigos separados por virgula, sem espacos nem repeticao (vendedor sem zeros a esquerda)
        escopo_valor: escopo === 'geral' || !escopoValor
          ? null
          : [...new Set(escopoValor.split(/[,;\s]+/).filter(Boolean).map((x) => (escopo === 'vendedor' || escopo === 'cliente' ? x.replace(/^0+/, '') || '0' : x)))].join(','),
        ordem: Math.trunc(numero(b, 'ordem', 'Ordem', { min: 0, max: 9999 })),
        ativo: flag(b, 'ativo', true),
      };
    },
  },
  prazos: {
    tabela: 'prazos_pagamento',
    chave: 'id',
    ordem: [['ordem', true], ['descricao', true]],
    validar: (b) => ({
      codigo: texto(b, 'codigo', 'Codigo', { max: 10 }),
      descricao: texto(b, 'descricao', 'Descricao', { max: 80, obrigatorio: true }),
      ordem: Math.trunc(numero(b, 'ordem', 'Ordem', { min: 0, max: 9999 })),
      ativo: flag(b, 'ativo', true),
    }),
  },
  'motivos-exclusao': {
    tabela: 'motivos_exclusao',
    chave: 'id',
    ordem: [['ordem', true], ['descricao', true]],
    validar: (b) => ({
      descricao: texto(b, 'descricao', 'Descricao', { max: 80, obrigatorio: true }),
      ordem: Math.trunc(numero(b, 'ordem', 'Ordem', { min: 0, max: 9999 })),
      ativo: flag(b, 'ativo', true),
    }),
  },
  incentivos: {
    tabela: 'incentivos_desconto',
    chave: 'id',
    ordem: [['updated_at', false]],
    validar: (b) => {
      const escopo = texto(b, 'escopo', 'Escopo', { max: 20 }) ?? 'geral';
      if (!ESCOPOS.includes(escopo)) throw erro('Escopo invalido');
      // varios codigos separados por virgula, sem repeticao (cliente/vendedor sem zeros a esquerda)
      const valorBruto = texto(b, 'escopo_valor', 'Valor do escopo', { max: 400 });
      const escopo_valor = valorBruto ? [...new Set(valorBruto.split(/[,;]+/).map((x) => x.trim()).filter(Boolean).map((x) => (escopo === 'vendedor' || escopo === 'cliente' ? x.replace(/^0+/, '') || '0' : x)))].join(',') : null;
      const cod_produto = texto(b, 'cod_produto', 'Produto', { max: 40 });
      if (escopo !== 'geral' && escopo !== 'produto' && !escopo_valor) throw erro('Informe o valor do escopo (cliente, vendedor, canal ou escritorio)');
      if (escopo === 'produto' && !cod_produto) throw erro('Escopo "produto" exige o produto');
      const ini = data(b, 'vigencia_ini', 'Inicio da vigencia');
      const fim = data(b, 'vigencia_fim', 'Fim da vigencia');
      if (ini && fim && fim < ini) throw erro('O fim da vigencia e anterior ao inicio');
      return {
        escopo,
        escopo_valor: escopo === 'geral' || escopo === 'produto' ? null : escopo_valor,
        cod_produto,
        linha_id: texto(b, 'linha_id', 'Linha', { max: 20 }),
        grupo_id: texto(b, 'grupo_id', 'Grupo', { max: 20 }),
        categoria_id: texto(b, 'categoria_id', 'Categoria', { max: 20 }),
        marca: texto(b, 'marca', 'Marca', { max: 60 }),
        qtd_minima: numero(b, 'qtd_minima', 'Quantidade minima', { min: 0, max: 999999, obrigatorio: true }),
        desconto_pct: numero(b, 'desconto_pct', 'Desconto %', { min: 0, max: 100, obrigatorio: true }),
        desconto_extra_max_pct: numero(b, 'desconto_extra_max_pct', 'Extra maximo %', { min: 0, max: 100 }),
        vigencia_ini: ini,
        vigencia_fim: fim,
        ativo: flag(b, 'ativo', true),
      };
    },
  },
};

/** Status do pedido como o SAP devolve (salespole_pedidos); o painel oferece estes + os que ja apareceram nos pedidos. */
export const STATUS_SAP_CONHECIDOS = ['Faturado', 'Faturado Parcial', 'A Faturar', 'Recusado', 'Aguardando Liberação', 'Liberado para faturamento'];

/** Lista de status do SAP: tira vazios e repetidos (o app e a API comparam sem diferenciar maiuscula/minuscula). */
const listaDeStatus = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw erro('Informe a lista de status');
  if (v.length > 20) throw erro('No maximo 20 status');
  const vistos = new Set<string>();
  const lista: string[] = [];
  for (const x of v) {
    const t = String(x ?? '').trim();
    if (!t) continue;
    if (t.length > 60) throw erro('Cada status tem no maximo 60 caracteres');
    if (vistos.has(t.toLowerCase())) continue;
    vistos.add(t.toLowerCase());
    lista.push(t);
  }
  return lista;
};

/** Parametros que o painel pode alterar (tabela parametros: chave -> valor json). */
export const PARAMETROS: Record<string, { validar: (v: unknown) => unknown }> = {
  // em quais status do pedido o vendedor pode cancelar pelo app; vazio = cancelamento desligado
  status_cancelaveis: { validar: listaDeStatus },
  // status cujos itens sao atualizados a cada sincronizacao (os demais so tem os itens buscados quando ainda nao existem); vazio = todos os pedidos dos ultimos 15 dias, sem filtro de status
  status_atualizar_sync: { validar: listaDeStatus },
};
