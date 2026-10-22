export type TipoCampo = 'texto' | 'area' | 'numero' | 'data' | 'bool' | 'produto' | 'select' | 'escopo_valor' | 'classificacao';

export interface Campo {
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  obrigatorio?: boolean;
  dica?: string;
  maxLength?: number;
  opcoes?: Array<{ v: string; r: string }>;
  /** classificacao: de onde vem as opcoes (linha | grupo | categoria | marca) */
  fonte?: string;
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
  { v: 'lista_preco', r: 'Lista de preço' },
  { v: 'equipe', r: 'Equipe do vendedor' },
  { v: 'tipo_estabelecimento', r: 'Tipo de estabelecimento' },
];

const TIPOS_PERGUNTA = [
  { v: 'texto', r: 'Texto livre' },
  { v: 'sim_nao', r: 'Sim ou não' },
  { v: 'numero', r: 'Número' },
  { v: 'opcoes', r: 'Escolher uma opção' },
];
const NIVEIS_AVISO = [
  { v: 'info', r: 'Informativo' },
  { v: 'importante', r: 'Importante' },
  { v: 'urgente', r: 'Urgente' },
];
const ESCOPOS_AVISO = [
  { v: 'geral', r: 'Todos' },
  { v: 'vendedor', r: 'Vendedor' },
  { v: 'escritorio', r: 'Escritório de vendas' },
  { v: 'canal', r: 'Canal' },
];
const ESCOPOS_PERGUNTA = [
  { v: 'geral', r: 'Todos' },
  { v: 'vendedor', r: 'Vendedor' },
  { v: 'escritorio', r: 'Escritório de vendas' },
  { v: 'canal', r: 'Canal' },
  { v: 'cliente', r: 'Cliente' },
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
  bi: {
    titulo: 'Painéis de BI',
    descricao: 'Links do Power BI que abrem dentro do painel (menu Comercial → BI) e/ou do app (Perfil → BI). Use o link de incorporação do relatório (Arquivo → Incorporar relatório). Quem abrir precisa ter acesso ao relatório no Power BI.',
    nome: 'bi',
    chave: 'id',
    rotuloNovo: 'Novo painel de BI',
    campos: [
      { chave: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, maxLength: 60, dica: 'Ex.: Vendas' },
      { chave: 'url', rotulo: 'Link do relatório', tipo: 'texto', obrigatorio: true, maxLength: 1000, dica: 'https://app.powerbi.com/...' },
      { chave: 'onde', rotulo: 'Onde aparece', tipo: 'select', opcoes: [{ v: 'painel', r: 'Só no painel' }, { v: 'app', r: 'Só no app' }, { v: 'ambos', r: 'Painel e app' }] },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', dica: 'Menor aparece primeiro' },
    ],
    colunas: [
      { chave: 'nome', rotulo: 'Nome' },
      { chave: 'onde', rotulo: 'Onde', formatar: (v) => (v === 'ambos' ? 'Painel e app' : v === 'app' ? 'Só no app' : 'Só no painel') },
      { chave: 'ordem', rotulo: 'Ordem' },
    ],
  },
  prazos: {
    titulo: 'Prazos de pagamento',
    descricao: 'Prazos que o vendedor escolhe no cadastro de cliente e o supervisor na alteração de condição de pagamento. A ordem menor aparece primeiro.',
    nome: 'prazos',
    chave: 'id',
    rotuloNovo: 'Novo prazo',
    campos: [
      { chave: 'codigo', rotulo: 'Código SAP', tipo: 'texto', maxLength: 10, dica: 'Ex.: Z030' },
      { chave: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, maxLength: 80, dica: 'Ex.: 30 dias' },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', dica: 'Menor aparece primeiro' },
    ],
    colunas: [
      { chave: 'codigo', rotulo: 'Código', formatar: traco },
      { chave: 'descricao', rotulo: 'Descrição' },
      { chave: 'ordem', rotulo: 'Ordem' },
    ],
  },
  'motivos-exclusao': {
    titulo: 'Motivos de exclusão',
    descricao: 'Motivos que o supervisor escolhe ao pedir a exclusão de um cliente. A ordem menor aparece primeiro.',
    nome: 'motivos-exclusao',
    chave: 'id',
    rotuloNovo: 'Novo motivo',
    campos: [
      { chave: 'descricao', rotulo: 'Motivo', tipo: 'texto', obrigatorio: true, maxLength: 80 },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', dica: 'Menor aparece primeiro' },
    ],
    colunas: [
      { chave: 'descricao', rotulo: 'Motivo' },
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
      { chave: 'escopo_valor', rotulo: 'Para quem (código ou opções)', tipo: 'escopo_valor', maxLength: 400, obrigatorio: true, quando: (v) => !['geral', 'produto', ''].includes(String(v.escopo ?? 'geral')) },
      { chave: 'cod_produto', rotulo: 'Produto', tipo: 'produto', dica: 'Vazio = qualquer produto', obrigatorio: false },
      { chave: 'linha_id', rotulo: 'Linha', tipo: 'classificacao', fonte: 'linha', maxLength: 20 },
      { chave: 'grupo_id', rotulo: 'Grupo', tipo: 'classificacao', fonte: 'grupo', maxLength: 20 },
      { chave: 'categoria_id', rotulo: 'Categoria', tipo: 'classificacao', fonte: 'categoria', maxLength: 20 },
      { chave: 'marca', rotulo: 'Marca', tipo: 'classificacao', fonte: 'marca', maxLength: 60 },
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
  avisos: {
    titulo: 'Avisos para os vendedores',
    descricao: 'Aviso que aparece num pop-up quando o vendedor abre o app, uma vez por aparelho (ele toca em "Entendi"). Escolha para quem vale: todos, vendedor, escritório ou canal (escritório e canal valem para quem tem cliente neles). O aviso chega depois que o vendedor sincroniza.',
    nome: 'avisos',
    chave: 'id',
    rotuloNovo: 'Novo aviso',
    campos: [
      { chave: 'titulo', rotulo: 'Título', tipo: 'texto', obrigatorio: true, maxLength: 80, dica: 'Ex.: Nova tabela de preços' },
      { chave: 'mensagem', rotulo: 'Mensagem', tipo: 'area', obrigatorio: true, maxLength: 1000 },
      { chave: 'nivel', rotulo: 'Destaque', tipo: 'select', opcoes: NIVEIS_AVISO },
      { chave: 'escopo', rotulo: 'Para quem', tipo: 'select', opcoes: ESCOPOS_AVISO },
      { chave: 'escopo_valor', rotulo: 'Código(s) do vendedor / escritório / canal', tipo: 'escopo_valor', maxLength: 400, obrigatorio: true, dica: 'Vários separados por vírgula', quando: (v) => !['geral', ''].includes(String(v.escopo ?? 'geral')) },
      { chave: 'vigencia_ini', rotulo: 'Mostrar a partir de', tipo: 'data', dica: 'Vazio = já' },
      { chave: 'vigencia_fim', rotulo: 'Mostrar até', tipo: 'data', dica: 'Vazio = sem fim' },
    ],
    colunas: [
      { chave: 'titulo', rotulo: 'Aviso', formatar: (v, l) => `${v ?? ''}${l.mensagem ? ` — ${String(l.mensagem).slice(0, 70)}${String(l.mensagem).length > 70 ? '…' : ''}` : ''}` },
      { chave: 'nivel', rotulo: 'Destaque', formatar: (v) => String(NIVEIS_AVISO.find((n) => n.v === v)?.r ?? v ?? '') },
      { chave: 'escopo', rotulo: 'Para', formatar: (v, l) => (v === 'geral' || !v ? 'Todos' : `${ESCOPOS_AVISO.find((e) => e.v === v)?.r ?? v}: ${l.escopo_valor ?? ''}`) },
      { chave: 'vigencia_ini', rotulo: 'Período', formatar: (_v, l) => (l.vigencia_ini || l.vigencia_fim ? `${l.vigencia_ini ? dataBR(l.vigencia_ini) : 'já'} a ${l.vigencia_fim ? dataBR(l.vigencia_fim) : 'sem fim'}` : 'sempre') },
    ],
  },
  'perguntas-visita': {
    titulo: 'Perguntas da visita',
    descricao: 'Perguntas que o vendedor responde durante a visita, na tela da visita do app. Escolha a quem vale (todos, vendedor, escritório, canal ou cliente) e se é obrigatória: a visita só conclui com todas as obrigatórias respondidas. A ordem menor aparece primeiro.',
    nome: 'perguntas-visita',
    chave: 'id',
    rotuloNovo: 'Nova pergunta',
    campos: [
      { chave: 'texto', rotulo: 'Pergunta', tipo: 'texto', obrigatorio: true, maxLength: 200, dica: 'Ex.: O produto está exposto na gôndola?' },
      { chave: 'tipo', rotulo: 'Tipo de resposta', tipo: 'select', opcoes: TIPOS_PERGUNTA },
      { chave: 'opcoes', rotulo: 'Opções de resposta', tipo: 'texto', maxLength: 400, obrigatorio: true, dica: 'Separe com ponto e vírgula. Ex.: Ótimo; Bom; Ruim', quando: (v) => v.tipo === 'opcoes' },
      { chave: 'obrigatoria', rotulo: 'Obrigatória', tipo: 'bool' },
      { chave: 'escopo', rotulo: 'A quem vale', tipo: 'select', opcoes: ESCOPOS_PERGUNTA },
      { chave: 'escopo_valor', rotulo: 'Código(s) do vendedor / escritório / canal / cliente', tipo: 'escopo_valor', maxLength: 400, obrigatorio: true, dica: 'Vários separados por vírgula', quando: (v) => !['geral', ''].includes(String(v.escopo ?? 'geral')) },
      { chave: 'ordem', rotulo: 'Ordem', tipo: 'numero', dica: 'Menor aparece primeiro' },
    ],
    colunas: [
      { chave: 'texto', rotulo: 'Pergunta' },
      { chave: 'tipo', rotulo: 'Resposta', formatar: (v, l) => (v === 'opcoes' ? `Opções: ${l.opcoes ?? ''}` : String(TIPOS_PERGUNTA.find((t) => t.v === v)?.r ?? v ?? '')) },
      { chave: 'obrigatoria', rotulo: 'Obrigatória', formatar: sim },
      { chave: 'escopo', rotulo: 'Vale para', formatar: (v, l) => (v === 'geral' || !v ? 'Todos' : `${ESCOPOS_PERGUNTA.find((e) => e.v === v)?.r ?? v}: ${l.escopo_valor ?? ''}`) },
      { chave: 'ordem', rotulo: 'Ordem' },
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

export const ordemMenu = ['avisos', 'tipos-bonificacao', 'centros-custo', 'destaques', 'incentivos', 'perguntas-visita', 'feriados'];
export { traco };
