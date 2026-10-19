export type TipoCampo = 'texto' | 'numero' | 'data' | 'bool' | 'produto' | 'select';

export interface Campo {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  dica?: string;
  maxLength?: number;
  opcoes?: Array<{ v: string; r: string }>;
  /** campo so aparece quando esta funcao devolve true (recebe os valores do formulario) */
  quando?: (v: Record<string, string | boolean>) => boolean;
  /** nao pode ser editado depois de criado (ex.: codigo que e a chave) */
  fixoAoEditar?: boolean;
}

export interface Coluna {
  chave: string;
  rotulo: string;
  formatar?: (valor: unknown, linha: Record<string, unknown>) => string;
}

export interface DefCadastro {
  titulo: string;
  descricao: string;
  nome: string; // nome na API
  chave: string; // coluna que identifica a linha
  campos: Campo[];
  colunas: Coluna[];
  rotuloNovo: string;
}

const sim = (v: unknown) => (v ? 'Sim' : '—');
const dataBR = (v: unknown) => (typeof v === 'string' && v.length >= 10 ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : '—');
const traco = (v: unknown) => (v == null || v === '' ? '—' : String(v));
const pct = (v: unknown) => (v == null ? '—' : `${Number(v).toLocaleString('pt-BR')}%`);

const ESCOPOS = [
  { v: 'geral', r: 'Geral (todos)' },
  { v: 'produto', r: 'Produto (para todos)' },
  { v: 'cliente', r: 'Cliente' },
  { v: 'vendedor', r: 'Vendedor' },
  { v: 'canal', r: 'Canal' },
  { v: 'escritorio', r: 'Escritório de vendas' },
];

export const CADASTROS: Record<string, DefCadastro> = {
  'tipos-bonificacao': {
    titulo: 'Tipos de bonificação',
    descricao: 'Motivos de bonificação que o vendedor escolhe no pedido. Só o código vai ao SAP (ORD_REASON, até 3 posições).',
    nome: 'tipos-bonificacao',
    chave: 'codigo',
    rotuloNovo: 'Novo tipo',
    campos: [
      { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, maxLength: 3, fixoAoEditar: true, dica: 'Ex.: 115' },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, maxLength: 80 },
    ],
    colunas: [
      { chave: 'codigo', rotulo: 'Código' },
      { chave: 'descricao', rotulo: 'Descrição' },
    ],
  },
  'centros-custo': {
    titulo: 'Centros de custo',
    descricao: 'Centros de custo da bonificação. Só o código vai ao SAP (KOSTL, até 10 posições).',
    nome: 'centros-custo',
    chave: 'codigo',
    rotuloNovo: 'Novo centro',
    campos: [
      { chave: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, maxLength: 10, fixoAoEditar: true, dica: 'Ex.: 2001501007' },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, maxLength: 80 },
    ],
    colunas: [
      { chave: 'codigo', rotulo: 'Código' },
      { chave: 'descricao', rotulo: 'Descrição' },
    ],
  },
  destaques: {
    titulo: 'Destaques e lançamentos',
    descricao: 'Produtos que aparecem na aba Sugestão do pedido. A ordem menor aparece primeiro.',
    nome: 'destaques',
    chave: 'cod_produto',
    rotuloNovo: 'Novo destaque',
    campos: [
      { chave: 'cod_produto', rotulo: 'Produto', tipo: 'produto', obrigatorio: true, fixoAoEditar: true, dica: 'Digite o código ou parte do nome' },
      { chave: 'destaque', rotulo: 'Destaque', tipo: 'bool' },
      { chave: 'lancamento', rotulo: 'Lançamento', tipo: 'bool' },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', dica: 'Menor aparece primeiro' },
    ],
    colunas: [
      { chave: 'cod_produto', rotulo: 'Produto' },
      { chave: 'destaque', rotulo: 'Destaque', formatar: sim },
      { chave: 'lancamento', rotulo: 'Lançamento', formatar: sim },
      { chave: 'ordem', rotulo: 'Ordem' },
    ],
  },
  incentivos: {
    titulo: 'Incentivos de desconto',
    descricao: 'Desconto automático a partir de uma quantidade (em caixas). Quantidade mínima 0 vale desde a primeira unidade. Escolha a quem vale (escopo) e a que produtos (produto, linha, grupo, categoria ou marca).',
    nome: 'incentivos',
    chave: 'id',
    rotuloNovo: 'Novo incentivo',
    campos: [
      { chave: 'escopo', rotulo: 'A quem vale', tipo: 'select', opcoes: ESCOPOS },
      { chave: 'escopo_valor', rotulo: 'Código do cliente / vendedor / canal / escritório', tipo: 'texto', maxLength: 40, obrigatorio: true, quando: (v) => !['geral', 'produto', ''].includes(String(v.escopo ?? 'geral')) },
      { chave: 'cod_produto', rotulo: 'Produto', tipo: 'produto', dica: 'Vazio = qualquer produto', obrigatorio: false },
      { chave: 'linha_id', rotulo: 'Linha (ID)', tipo: 'texto', maxLength: 20 },
      { chave: 'grupo_id', rotulo: 'Grupo (ID)', tipo: 'texto', maxLength: 20 },
      { chave: 'categoria_id', rotulo: 'Categoria (ID)', tipo: 'texto', maxLength: 20 },
      { chave: 'marca', rotulo: 'Marca', tipo: 'texto', maxLength: 60, dica: 'Texto do cadastro do produto' },
      { chave: 'qtd_minima', rotulo: 'Quantidade mínima (caixas)', tipo: 'numero', obrigatorio: true, dica: '0 = sem mínimo' },
      { chave: 'desconto_pct', rotulo: 'Desconto automático (%)', tipo: 'numero', obrigatorio: true },
      { chave: 'desconto_extra_max_pct', rotulo: 'Extra máximo do vendedor (%)', tipo: 'numero' },
      { chave: 'vigencia_ini', rotulo: 'Início da vigência', tipo: 'data' },
      { chave: 'vigencia_fim', rotulo: 'Fim da vigência', tipo: 'data' },
    ],
    colunas: [
      { chave: 'escopo', rotulo: 'Escopo', formatar: (v, l) => (l.escopo_valor ? `${v}: ${l.escopo_valor}` : String(v ?? '')) },
      {
        chave: 'cod_produto',
        rotulo: 'Alvo',
        formatar: (_v, l) =>
          [l.cod_produto && `produto ${l.cod_produto}`, l.linha_id && `linha ${l.linha_id}`, l.grupo_id && `grupo ${l.grupo_id}`, l.categoria_id && `categoria ${l.categoria_id}`, l.marca && `marca ${l.marca}`]
            .filter(Boolean)
            .join(' + ') || 'qualquer produto',
      },
      { chave: 'qtd_minima', rotulo: 'A partir de', formatar: (v) => (Number(v) === 0 ? 'sem mínimo' : `${Number(v)} cx`) },
      { chave: 'desconto_pct', rotulo: 'Desconto', formatar: pct },
      { chave: 'desconto_extra_max_pct', rotulo: 'Extra máx.', formatar: pct },
      { chave: 'vigencia_ini', rotulo: 'Vigência', formatar: (_v, l) => (l.vigencia_ini || l.vigencia_fim ? `${dataBR(l.vigencia_ini)} a ${dataBR(l.vigencia_fim)}` : 'sempre') },
    ],
  },
  feriados: {
    titulo: 'Feriados',
    descricao: 'A entrega nunca cai em feriado. Sem UF = nacional; com UF = estadual; com UF e cidade = municipal (a cidade é comparada com o endereço do cliente no SAP).',
    nome: 'feriados',
    chave: 'id',
    rotuloNovo: 'Novo feriado',
    campos: [
      { chave: 'data', rotulo: 'Data', tipo: 'data', obrigatorio: true },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, maxLength: 80 },
      { chave: 'uf', rotulo: 'UF', tipo: 'texto', maxLength: 2, dica: 'Vazio = nacional' },
      { chave: 'cidade', rotulo: 'Cidade', tipo: 'texto', maxLength: 80, dica: 'Só para feriado municipal (precisa da UF)' },
    ],
    colunas: [
      { chave: 'data', rotulo: 'Data', formatar: dataBR },
      { chave: 'descricao', rotulo: 'Descrição' },
      { chave: 'uf', rotulo: 'Abrangência', formatar: (_v, l) => (l.uf ? (l.cidade ? `${l.cidade}/${l.uf}` : String(l.uf)) : 'Nacional') },
    ],
  },
};

export const ordemMenu = ['tipos-bonificacao', 'centros-custo', 'destaques', 'incentivos', 'feriados'];
export { traco };
