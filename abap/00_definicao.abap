*"----------------------------------------------------------------------
*" ZCL_INTEGRACAO_POLE_TECH  -  integracao Sales Pole (forca de vendas) x SAP ECC
*"
*" Todos os recursos ficam em /poletech/salespole/{recurso}
*"   GET : vendedor, clientes, pedidos, itens, titulos, produtos,
*"         catalogo_preco, precos, estoque, remessas
*"   POST: criar_pedido, cancelar_pedido
*"
*" PONTOS A AJUSTAR NO SEU SAP (procure por "AJUSTAR" nos metodos):
*"   1. c_origem_fv        : hoje 'Z010' (mesma origem do app atual); trocar quando
*"                           existir a chave T176 (BSARK) propria do Sales Pole
*"   2. c_cond_preco       : ZPR2 = preco manual enviado na criacao do pedido (nao filtra a lista)
*"   3. c_div_preco        : 10 = o SAP le o valor da ZPR2 x10 neste BAPI: manda preco/10 (confirmado: 125,88 enviado virou 1.258,80)
*"----------------------------------------------------------------------
CLASS zcl_integracao_pole_tech DEFINITION
  PUBLIC
  INHERITING FROM cl_rest_resource
  CREATE PUBLIC.

  PUBLIC SECTION.

    METHODS constructor.

    METHODS if_rest_resource~get  REDEFINITION.
    METHODS if_rest_resource~post REDEFINITION.

    METHODS salespole_vendedor.
    METHODS salespole_clientes.
    METHODS salespole_pedidos.
    METHODS salespole_itens.
    METHODS salespole_titulos.
    METHODS salespole_produtos.
    METHODS salespole_catalogo_preco.
    METHODS salespole_estoque.
    METHODS salespole_remessas.
    METHODS salespole_precos.
    METHODS salespole_criar_pedido.
    METHODS salespole_cancelar_pedido.

  PROTECTED SECTION.

  PRIVATE SECTION.

    TYPES: ty_t_kunnr TYPE STANDARD TABLE OF kunnr WITH EMPTY KEY,
           BEGIN OF ty_cd,
             codigo    TYPE string,
             descricao TYPE string,
           END OF ty_cd,
           BEGIN OF ty_txt,
             tipo      TYPE string,
             codigo    TYPE string,
             descricao TYPE string,
           END OF ty_txt,
           ty_t_txt TYPE STANDARD TABLE OF ty_txt WITH DEFAULT KEY,
           BEGIN OF ty_meins,
             matnr TYPE matnr,
             meins TYPE meins,
           END OF ty_meins,
           BEGIN OF ty_conv,
             matnr TYPE matnr,
             kmein TYPE meins,
             fator TYPE f,
           END OF ty_conv.

    " Areas de vendas: FERT = 2100/2002 (fabricados) | HAWA = 2014/2015 (revenda)
    " O cliente pertence a 2100+2014 ou 2002+2015. O VWERK de cada area e o centro.
    CONSTANTS: c_vkorg_1      TYPE vkorg VALUE '2100',
               c_vkorg_2      TYPE vkorg VALUE '2002',
               c_vkorg_h1     TYPE vkorg VALUE '2014',
               c_vkorg_h2     TYPE vkorg VALUE '2015',
               c_mtart_fert   TYPE mtart VALUE 'FERT',
               c_mtart_hawa   TYPE mtart VALUE 'HAWA',
               c_mtart_zvar   TYPE mtart VALUE 'ZVAR',   " vai junto com HAWA (org 2014/2015)
               c_deposito     TYPE lgort_d VALUE 'CD',
               " texto EXTERNO (T006A) da unidade de venda; o codigo INTERNO e outro (ex.: KI)
               c_texto_caixa  TYPE t006a-mseh3 VALUE 'CX',
               c_spart        TYPE spart VALUE '10',
               c_lang         TYPE spras VALUE 'P',
               c_cond_preco   TYPE kschl VALUE 'ZPR2',
               c_origem_fv    TYPE bsark VALUE 'Z010',
               " ZPR2 = preco por CAIXA (KONV oficial: 76,59 por 1 CX). O app novo ja manda esse valor: nao divide.
               c_div_preco    TYPE i     VALUE 10,
               c_motivo_cancel TYPE abgru VALUE '15'.

    DATA: mt_meins TYPE HASHED TABLE OF ty_meins WITH UNIQUE KEY matnr,
          mt_conv  TYPE HASHED TABLE OF ty_conv  WITH UNIQUE KEY matnr kmein.

    " Texto de diagnostico de uma excecao: classe, mensagem, include e LINHA onde nasceu,
    " seguindo a cadeia (CX_SY_NO_HANDLER embrulha a excecao original vinda de um modulo de funcao).
    METHODS descrever_excecao
      IMPORTING ix        TYPE REF TO cx_root
      RETURNING VALUE(rv) TYPE string.

    " Trecho da rota depois de 'salespole/' (ex.: /poletech/salespole/vendedor?x=1 -> 'vendedor')
    METHODS recurso_da_rota
      RETURNING VALUE(rv_recurso) TYPE string.

    METHODS send_json
      IMPORTING is_data   TYPE any
                iv_status TYPE i DEFAULT 200.

    METHODS send_error
      IMPORTING iv_status TYPE i
                iv_msg    TYPE string.

    METHODS parse_data
      IMPORTING iv_txt         TYPE string
      RETURNING VALUE(rv_data) TYPE d.

    METHODS iso_data
      IMPORTING iv_data       TYPE d
      RETURNING VALUE(rv_iso) TYPE string.

    " Carteira do vendedor (clientes da rota). Se der erro, ja responde e devolve vazio.
    METHODS resolve_clientes
      EXPORTING et_kunnr TYPE ty_t_kunnr
                ev_rota  TYPE zsdt005-rota.

    " Confere vendedor vigente e cliente na rota dele (usado nos POSTs)
    METHODS valida_carteira
      IMPORTING iv_codvendedor TYPE string
                iv_kunnr       TYPE kunnr
      EXPORTING ev_lifnr       TYPE lifnr
                ev_ok          TYPE abap_bool.

    METHODS lookup_txt
      IMPORTING it_txt        TYPE ty_t_txt
                iv_tipo       TYPE string
                iv_cod        TYPE clike
      RETURNING VALUE(rv_txt) TYPE string.

    " 'FERT' para 2100/2002, 'HAWA' para 2014/2015, vazio para outras
    METHODS tipo_da_org
      IMPORTING iv_vkorg       TYPE vkorg
      RETURNING VALUE(rv_tipo) TYPE string.

    " 'FERT' (FERT) ou 'HAWA' (HAWA e ZVAR); vazio para outros tipos
    METHODS tipo_do_material
      IMPORTING iv_mtart       TYPE mtart
      RETURNING VALUE(rv_tipo) TYPE string.

    " dias de entrega do cliente (ZSDT111): '1' segunda ... '7' domingo.
    " Sem cadastro: segunda a sabado.
    METHODS dias_entrega
      IMPORTING iv_kunnr       TYPE kunnr
      RETURNING VALUE(rt_dias) TYPE string_table.

    METHODS preco_kg
      IMPORTING iv_matnr        TYPE matnr
                iv_kmein        TYPE konp-kmein
                iv_kbetr        TYPE konp-kbetr
                iv_kpein        TYPE konp-kpein
      RETURNING VALUE(rv_preco) TYPE string.

ENDCLASS.
