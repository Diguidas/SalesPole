// Formato das respostas de ZCL_INTEGRACAO_POLE_TECH (tudo chega como string).

export interface SapCd {
  codigo: string;
  descricao: string;
}

export interface SapVendedorResp {
  codvendedor: string;
  nome: string;
  documento: string;
  rota: string;
  clientes: Array<{
    codigocli: string;
    cnpjcpf: string;
    nome_fantasia: string;
    razao_social: string;
    bloqueado: string; // 'true' | 'false'
    visitas: Array<{ dia_semana: string; sequencia: string }>;
  }>;
}

export interface SapClienteArea {
  vkorg: string;
  tipo_material: string; // FERT | HAWA
  centro: string;
  canal: SapCd;
  segmento: SapCd;
  cond_pagamento: SapCd;
  lista_preco: SapCd;
  rede: SapCd;
  tipo_estabelecimento: SapCd;
}

export interface SapClientesResp {
  clientes: Array<{
    codigocli: string;
    nome_fantasia: string;
    razao_social: string;
    cnpjcpf: string;
    telefone: string;
    bloqueado: string;
    endereco: { logradouro: string; bairro: string; cidade: string; uf: string; cep: string };
    limite_total: string;
    limite_disponivel: string;
    agrupado: string;
    dias_entrega: string[]; // '1'..'7'
    classe_risco: SapCd;
    areas: SapClienteArea[];
  }>;
}

export interface SapProdutosResp {
  produtos: Array<{
    codigoproduto: string;
    descricao: string;
    tipo: string;
    unidade: string;
    ean: string;
    ncm: string;
    validade: string;
    tipo_material: string; // FERT | HAWA | ZVAR
    unidade_base?: string; // MARA-MEINS (codigo interno)
    unidade_base_texto?: string;
    unidade_venda?: string; // unidade do pedido (codigo interno da caixa, ex.: KI)
    unidade_venda_texto?: string; // o que o vendedor le (ex.: CX)
    conversoes?: Array<{ unidade: string; texto?: string; fator: string }>; // unidades base por 1 da unidade
    estoque: { disponivelecommerce: string; prazoentregadias: string };
    peso: { pesoliquido: string; pesobruto: string };
    pedido: { quantidademinima: string; multiplo: string };
    classificacao: { marca: string; categoria: string; linha: string; grupo: string };
  }>;
}

export interface SapPrecoItem {
  matnr: string;
  datab: string;
  datbi: string;
  kbetr: string;
  kpein: string;
  kmein: string;
  konwa: string;
  krech: string;
  preco_kg: string;
  desconto_max?: string;
}

export interface SapPrecosResp {
  data_ref: string;
  listas: Array<{ pltyp: string; itens: SapPrecoItem[] }>;
  grupos: Array<{ pltyp: string; kdgrp: string; itens: SapPrecoItem[] }>;
}

export interface SapEstoqueResp {
  gerado_em: string;
  deposito: string;
  estoque: Array<{ centro: string; material: string; quantidade: string; unidade_base: string }>;
}

export interface SapPedidosResp {
  pedidos: Array<{
    ordem: string;
    codigocli: string;
    tp_ped: string;
    dt_criacao: string;
    dt_entrega: string;
    valor: string;
    status: string;
    refaturado: string;
    pedido_externo: string;
    plataforma: string;
    notas: Array<{ nota_fiscal: string; serie: string; danfe_url: string; xml_url: string; boleto_url: string }>;
  }>;
}

export interface SapItensResp {
  ordens: Array<{
    ordem: string;
    pedido_externo: string;
    plataforma: string;
    dt_faturamento: string;
    itens: Array<{
      item: string;
      material: string;
      denominacao: string;
      grupo: string;
      quantidade: string;
      unidade_venda: string;
      valor_unitario: string;
      recusa: string;
      cod_recusa: string;
    }>;
  }>;
}

export interface SapTitulosResp {
  titulos: Array<{
    codigocli: string;
    nfe: string;
    parcela: string;
    status: string;
    valor: string;
    vencimento: string;
    dt_compensacao: string;
    ordem: string;
    danfe_url: string;
    boleto_url: string;
  }>;
}

export interface SapRemessasResp {
  remessas: Array<{
    ordem: string;
    item: string;
    codigocli: string;
    tp_ped: string;
    data_remessa: string;
    material: string;
    denominacao: string;
    unidade_venda: string;
    quantidade_pedida: string;
    quantidade_confirmada: string;
    peso: string;
  }>;
}

export interface SapCriarPedidoResp {
  sucesso: string; // 'true' | 'false'
  parcial: string; // 'true' quando so parte das ordens (FERT/HAWA) foi criada
  codigo_interno: string;
  dt_entrega: string; // data de entrega calculada pelo SAP (AAAA-MM-DD)
  ordens: Array<{ ordem: string; tipo_material: string; vkorg: string; duplicado: string }>;
  mensagens: Array<{ tipo: string; mensagem: string }>;
  erro?: string; // respostas de erro simples do dispatcher ({ "erro": "..." })
}
