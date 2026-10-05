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

CLASS zcl_integracao_pole_tech IMPLEMENTATION.

METHOD constructor.

  super->constructor( ).

ENDMETHOD.


METHOD recurso_da_rota.

  " Rota: /poletech/salespole/<recurso>  ou  /poletech/salespole/salespole_<recurso>
  " (o que vier depois de '?' e ignorado; o prefixo 'salespole_' e opcional)
  DATA(lv_path) = to_lower( mo_request->get_uri_path( ) ).

  DATA(lv_q) = find( val = lv_path sub = '?' ).
  IF lv_q >= 0.
    lv_path = lv_path(lv_q).
  ENDIF.

  DATA(lv_pos) = find( val = lv_path sub = 'salespole/' ).

  IF lv_pos >= 0 AND strlen( lv_path ) > lv_pos + 10.
    rv_recurso = substring( val = lv_path off = lv_pos + 10 ).
    REPLACE ALL OCCURRENCES OF '/' IN rv_recurso WITH ''.
  ENDIF.

  " tabela de rotas cadastra o ultimo trecho com o nome do metodo (salespole_vendedor)
  IF strlen( rv_recurso ) > 10 AND rv_recurso(10) = 'salespole_'.
    rv_recurso = substring( val = rv_recurso off = 10 ).
  ENDIF.

ENDMETHOD.


METHOD if_rest_resource~get.

  " Somente os recursos abaixo sao expostos (sem CALL METHOD dinamico: evita
  " chamar por URL qualquer metodo publico da classe).
  DATA(lv_recurso) = recurso_da_rota( ).

  TRY.
      CASE lv_recurso.
        WHEN 'vendedor'.        salespole_vendedor( ).
        WHEN 'clientes'.        salespole_clientes( ).
        WHEN 'pedidos'.         salespole_pedidos( ).
        WHEN 'itens'.           salespole_itens( ).
        WHEN 'titulos'.         salespole_titulos( ).
        WHEN 'produtos'.        salespole_produtos( ).
        WHEN 'catalogo_preco'.  salespole_catalogo_preco( ).
        WHEN 'precos'.          salespole_precos( ).
        WHEN 'estoque'.         salespole_estoque( ).
        WHEN 'remessas'.        salespole_remessas( ).
        WHEN OTHERS.
          send_error( iv_status = 404 iv_msg = |Recurso GET inexistente: { lv_recurso }| ).
      ENDCASE.
    CATCH cx_root INTO DATA(lx_erro).
      send_error( iv_status = 500 iv_msg = descrever_excecao( lx_erro ) ).
  ENDTRY.

ENDMETHOD.


METHOD if_rest_resource~post.

  DATA(lv_recurso) = recurso_da_rota( ).

  TRY.
      CASE lv_recurso.
        WHEN 'criar_pedido'.     salespole_criar_pedido( ).
        WHEN 'cancelar_pedido'.  salespole_cancelar_pedido( ).
        WHEN OTHERS.
          send_error( iv_status = 404 iv_msg = |Recurso POST inexistente: { lv_recurso }| ).
      ENDCASE.
    CATCH cx_root INTO DATA(lx_erro).
      send_error( iv_status = 500 iv_msg = descrever_excecao( lx_erro ) ).
  ENDTRY.

ENDMETHOD.


METHOD send_json.

  " ZF_SERIALIZE_JSON devolve os nomes de campo em MAIUSCULAS; o cliente (NestJS)
  " converte as chaves para minusculas ao receber.
  DATA lv_json TYPE string.

  CALL FUNCTION 'ZF_SERIALIZE_JSON'
    EXPORTING
      data = is_data
    IMPORTING
      json = lv_json.

  DATA(lo_entity) = mo_response->create_entity( ).
  lo_entity->set_content_type( if_rest_media_type=>gc_appl_json ).
  lo_entity->set_string_data( lv_json ).
  mo_response->set_status( iv_status ).

ENDMETHOD.


METHOD send_error.

  TYPES: BEGIN OF ty_erro,
           erro TYPE string,
         END OF ty_erro.

  send_json( is_data   = VALUE ty_erro( erro = iv_msg )
             iv_status = iv_status ).

ENDMETHOD.


METHOD parse_data.

  " aceita 'YYYY-MM-DD' ou 'YYYYMMDD'; devolve vazio se invalido
  DATA(lv_txt) = iv_txt.

  REPLACE ALL OCCURRENCES OF '-' IN lv_txt WITH ''.
  CONDENSE lv_txt NO-GAPS.

  IF strlen( lv_txt ) = 8 AND lv_txt CO '0123456789'.
    rv_data = lv_txt.
    CALL FUNCTION 'DATE_CHECK_PLAUSIBILITY'
      EXPORTING
        date                      = rv_data
      EXCEPTIONS
        plausibility_check_failed = 1
        OTHERS                    = 2.
    IF sy-subrc <> 0.
      CLEAR rv_data.
    ENDIF.
  ENDIF.

ENDMETHOD.


METHOD iso_data.

  IF iv_data IS INITIAL.
    RETURN.
  ENDIF.

  rv_iso = |{ iv_data DATE = ISO }|.

ENDMETHOD.


METHOD resolve_clientes.

  DATA: lv_cod   TYPE string,
        lv_lifnr TYPE lifnr,
        lv_kunnr TYPE kunnr.

  CLEAR: et_kunnr, ev_rota.

  lv_cod = mo_request->get_uri_query_parameter( 'codvendedor' ).

  IF lv_cod IS INITIAL.
    send_error( iv_status = 400 iv_msg = 'Parametro codvendedor obrigatorio' ).
    RETURN.
  ENDIF.

  lv_lifnr = |{ lv_cod ALPHA = IN WIDTH = 10 }|.

  SELECT SINGLE rota
    FROM zsdt005
    INTO @ev_rota
    WHERE lifnr = @lv_lifnr
      AND datbi >= @sy-datum.

  IF sy-subrc <> 0.
    send_error( iv_status = 404 iv_msg = 'Vendedor sem rota vigente' ).
    RETURN.
  ENDIF.

  SELECT DISTINCT kunnr
    FROM zsdt006
    INTO TABLE @et_kunnr
    WHERE rota = @ev_rota.

  " filtro opcional por um cliente da carteira
  lv_cod = mo_request->get_uri_query_parameter( 'codigocli' ).

  IF lv_cod IS NOT INITIAL.

    lv_kunnr = |{ lv_cod ALPHA = IN WIDTH = 10 }|.

    READ TABLE et_kunnr TRANSPORTING NO FIELDS WITH KEY table_line = lv_kunnr.

    IF sy-subrc <> 0.
      CLEAR et_kunnr.
      send_error( iv_status = 403 iv_msg = 'Cliente fora da carteira do vendedor' ).
      RETURN.
    ENDIF.

    et_kunnr = VALUE #( ( lv_kunnr ) ).

  ENDIF.

  IF et_kunnr IS INITIAL.
    send_error( iv_status = 404 iv_msg = 'Carteira vazia' ).
  ENDIF.

ENDMETHOD.


METHOD valida_carteira.

  DATA: lv_lifnr TYPE lifnr,
        lv_rota  TYPE zsdt005-rota.

  ev_ok = abap_false.
  CLEAR ev_lifnr.

  IF iv_codvendedor IS INITIAL.
    RETURN.
  ENDIF.

  lv_lifnr = |{ iv_codvendedor ALPHA = IN WIDTH = 10 }|.

  SELECT SINGLE rota
    FROM zsdt005
    INTO @lv_rota
    WHERE lifnr = @lv_lifnr
      AND datbi >= @sy-datum.

  IF sy-subrc <> 0.
    RETURN.
  ENDIF.

  SELECT SINGLE kunnr
    FROM zsdt006
    INTO @DATA(lv_kunnr)
    WHERE rota  = @lv_rota
      AND kunnr = @iv_kunnr.

  IF sy-subrc = 0.
    ev_ok    = abap_true.
    ev_lifnr = lv_lifnr.
  ENDIF.

ENDMETHOD.


METHOD lookup_txt.

  READ TABLE it_txt INTO DATA(ls_txt)
       WITH KEY tipo = iv_tipo codigo = iv_cod BINARY SEARCH.

  IF sy-subrc = 0.
    rv_txt = ls_txt-descricao.
  ENDIF.

ENDMETHOD.


METHOD preco_kg.

  " Preco por KG quando a unidade base do material e KG e a condicao esta
  " em outra unidade (ex.: caixa). Considera a unidade de preco (kpein).
  DATA: lv_conv TYPE bstmg,
        lv_p    TYPE p LENGTH 15 DECIMALS 4.

  READ TABLE mt_conv INTO DATA(ls_conv)
       WITH TABLE KEY matnr = iv_matnr kmein = iv_kmein.

  IF sy-subrc <> 0.

    ls_conv-matnr = iv_matnr.
    ls_conv-kmein = iv_kmein.
    ls_conv-fator = 1.

    READ TABLE mt_meins INTO DATA(ls_meins) WITH TABLE KEY matnr = iv_matnr.

    IF sy-subrc <> 0.
      ls_meins-matnr = iv_matnr.
      SELECT SINGLE meins FROM mara INTO @ls_meins-meins WHERE matnr = @iv_matnr.
      INSERT ls_meins INTO TABLE mt_meins.
    ENDIF.

    IF ls_meins-meins = 'KG' AND iv_kmein <> 'KG'.
      CALL FUNCTION 'MD_CONVERT_MATERIAL_UNIT'
        EXPORTING
          i_matnr  = iv_matnr
          i_in_me  = iv_kmein
          i_out_me = 'KG'
          i_menge  = 1
        IMPORTING
          e_menge  = lv_conv
        EXCEPTIONS
          OTHERS   = 1.
      IF sy-subrc = 0 AND lv_conv <> 0.
        ls_conv-fator = lv_conv.
      ENDIF.
    ENDIF.

    INSERT ls_conv INTO TABLE mt_conv.

  ENDIF.

  IF iv_kpein <> 0 AND ls_conv-fator <> 0.
    lv_p = iv_kbetr / iv_kpein / ls_conv-fator.
    rv_preco = |{ lv_p DECIMALS = 4 }|.
  ENDIF.

ENDMETHOD.


METHOD tipo_da_org.

  CASE iv_vkorg.
    WHEN c_vkorg_1 OR c_vkorg_2.
      rv_tipo = 'FERT'.
    WHEN c_vkorg_h1 OR c_vkorg_h2.
      rv_tipo = 'HAWA'.
  ENDCASE.

ENDMETHOD.


METHOD tipo_do_material.

  CASE iv_mtart.
    WHEN c_mtart_fert.
      rv_tipo = 'FERT'.
    WHEN c_mtart_hawa OR c_mtart_zvar.
      rv_tipo = 'HAWA'.
  ENDCASE.

ENDMETHOD.


METHOD dias_entrega.

  SELECT SINGLE domingo, segunda, terca, quarta, quinta, sexta, sabado
    FROM zsdt111
    INTO @DATA(ls_z)
    WHERE kunnr = @iv_kunnr.

  IF sy-subrc = 0.
    IF ls_z-segunda EQ 'X'. APPEND '1' TO rt_dias. ENDIF.
    IF ls_z-terca   EQ 'X'. APPEND '2' TO rt_dias. ENDIF.
    IF ls_z-quarta  EQ 'X'. APPEND '3' TO rt_dias. ENDIF.
    IF ls_z-quinta  EQ 'X'. APPEND '4' TO rt_dias. ENDIF.
    IF ls_z-sexta   EQ 'X'. APPEND '5' TO rt_dias. ENDIF.
    IF ls_z-sabado  EQ 'X'. APPEND '6' TO rt_dias. ENDIF.
    IF ls_z-domingo EQ 'X'. APPEND '7' TO rt_dias. ENDIF.
  ENDIF.

  IF rt_dias IS INITIAL.
    rt_dias = VALUE #( ( `1` ) ( `2` ) ( `3` ) ( `4` ) ( `5` ) ( `6` ) ).
  ENDIF.

ENDMETHOD.


METHOD descrever_excecao.

  DATA: lx     TYPE REF TO cx_root,
        lv_prog TYPE syrepid,
        lv_inc  TYPE syrepid,
        lv_line TYPE i.

  lx = ix.

  DO 5 TIMES.

    IF lx IS NOT BOUND.
      EXIT.
    ENDIF.

    CLEAR: lv_prog, lv_inc, lv_line.
    lx->get_source_position(
      IMPORTING
        program_name = lv_prog
        include_name = lv_inc
        source_line  = lv_line ).

    rv = |{ rv }[{ cl_abap_classdescr=>get_class_name( lx ) }] { lx->get_text( ) } | &&
         |(include { lv_inc }, linha { lv_line })|.

    lx = lx->previous.

    IF lx IS BOUND.
      rv = |{ rv } <= causa: |.
    ENDIF.

  ENDDO.

ENDMETHOD.

METHOD salespole_vendedor.

  " GET /salespole/vendedor?codvendedor=
  " Vendedor, rota e carteira, com dia da semana (1=seg ... 7=dom) e a
  " sequencia de visita de cada cliente.

  TYPES: BEGIN OF ty_visita,
           dia_semana TYPE string,
           sequencia  TYPE string,
         END OF ty_visita,
         tt_visita TYPE STANDARD TABLE OF ty_visita WITH EMPTY KEY,

         BEGIN OF ty_cliente,
           codigocli     TYPE string,
           cnpjcpf       TYPE string,
           nome_fantasia TYPE string,
           razao_social  TYPE string,
           bloqueado     TYPE string,
           visitas       TYPE tt_visita,
         END OF ty_cliente,
         tt_cliente TYPE STANDARD TABLE OF ty_cliente WITH EMPTY KEY,

         BEGIN OF ty_response,
           codvendedor TYPE string,
           nome        TYPE string,
           documento   TYPE string,
           rota        TYPE string,
           clientes    TYPE tt_cliente,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        lv_ant      TYPE kunnr.

  FIELD-SYMBOLS <fs_cli> TYPE ty_cliente.

  DATA(lv_cod) = mo_request->get_uri_query_parameter( 'codvendedor' ).

  IF lv_cod IS INITIAL.
    send_error( iv_status = 400 iv_msg = 'Parametro codvendedor obrigatorio' ).
    RETURN.
  ENDIF.

  DATA(lv_lifnr) = CONV lifnr( |{ lv_cod ALPHA = IN WIDTH = 10 }| ).

  SELECT SINGLE rota
    FROM zsdt005
    INTO @DATA(lv_rota)
    WHERE lifnr = @lv_lifnr
      AND datbi >= @sy-datum.

  IF sy-subrc <> 0.
    send_error( iv_status = 404 iv_msg = 'Vendedor sem rota vigente' ).
    RETURN.
  ENDIF.

  SELECT SINGLE name1, stcd1, stcd2
    FROM lfa1
    INTO @DATA(ls_lfa1)
    WHERE lifnr = @lv_lifnr.

  ls_response-codvendedor = |{ lv_lifnr ALPHA = OUT }|.
  ls_response-nome        = ls_lfa1-name1.
  ls_response-documento   = COND #( WHEN ls_lfa1-stcd1 IS NOT INITIAL THEN ls_lfa1-stcd1 ELSE ls_lfa1-stcd2 ).
  ls_response-rota        = lv_rota.

  " z6~wotnr = dia da semana (1 = segunda)
  SELECT z6~kunnr,
         z6~posnr,
         z6~wotnr AS dia,
         k~name1,
         k~name4,
         k~aufsd,
         k~stcd1,
         k~stcd2
    FROM zsdt006 AS z6
    INNER JOIN kna1 AS k
      ON k~kunnr = z6~kunnr
    INTO TABLE @DATA(lt_rows)
    WHERE z6~rota = @lv_rota.

  SORT lt_rows BY kunnr dia posnr.

  LOOP AT lt_rows INTO DATA(ls_row).

    IF ls_row-kunnr <> lv_ant.
      APPEND VALUE #( codigocli     = |{ ls_row-kunnr ALPHA = OUT }|
                      cnpjcpf       = COND #( WHEN ls_row-stcd1 IS NOT INITIAL THEN ls_row-stcd1 ELSE ls_row-stcd2 )
                      nome_fantasia = ls_row-name4
                      razao_social  = ls_row-name1
                      bloqueado     = COND #( WHEN ls_row-aufsd IS NOT INITIAL THEN 'true' ELSE 'false' ) )
        TO ls_response-clientes ASSIGNING <fs_cli>.
      lv_ant = ls_row-kunnr.
    ENDIF.

    APPEND VALUE #( dia_semana = |{ ls_row-dia ALPHA = OUT }|
                    sequencia  = |{ ls_row-posnr ALPHA = OUT }| )
      TO <fs_cli>-visitas.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_clientes.

  " GET /salespole/clientes?codvendedor=[&codigocli=]
  " Cadastro de todos os clientes da carteira em UMA chamada (sem N+1).
  " Contagem de titulos abertos/atrasados nao vem mais daqui: o app calcula
  " a partir de /salespole/titulos.

  TYPES: BEGIN OF ty_endereco,
           logradouro TYPE string,
           bairro     TYPE string,
           cidade     TYPE string,
           uf         TYPE string,
           cep        TYPE string,
         END OF ty_endereco,

         " uma area por organizacao de vendas (FERT 2100/2002 e HAWA 2014/2015)
         BEGIN OF ty_area,
           vkorg                TYPE string,
           tipo_material        TYPE string,         " FERT | HAWA
           centro               TYPE string,         " KNVV-VWERK
           canal                TYPE ty_cd,
           segmento             TYPE ty_cd,
           cond_pagamento       TYPE ty_cd,
           lista_preco          TYPE ty_cd,          " PLTYP
           rede                 TYPE ty_cd,          " grupo de clientes (KDGRP)
           tipo_estabelecimento TYPE ty_cd,
         END OF ty_area,
         tt_area TYPE STANDARD TABLE OF ty_area WITH EMPTY KEY,

         BEGIN OF ty_cliente,
           codigocli            TYPE string,
           nome_fantasia        TYPE string,
           razao_social         TYPE string,
           cnpjcpf              TYPE string,
           telefone             TYPE string,
           bloqueado            TYPE string,
           endereco             TYPE ty_endereco,
           limite_total         TYPE string,
           limite_disponivel    TYPE string,
           agrupado             TYPE string,
           dias_entrega         TYPE string_table,   " 1=seg ... 7=dom
           classe_risco         TYPE ty_cd,
           areas                TYPE tt_area,
         END OF ty_cliente,
         tt_cliente TYPE STANDARD TABLE OF ty_cliente WITH EMPTY KEY,

         BEGIN OF ty_response,
           clientes TYPE tt_cliente,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        ls_cli      TYPE ty_cliente,
        lt_txt      TYPE ty_t_txt,
        lt_pai      TYPE ty_t_kunnr,
        lv_vant     TYPE vkorg,
        lv_delta    TYPE knkk-klimk.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Leituras em lote
  " ------------------------------------------------------------------
  SELECT kunnr, name1, name4, stcd1, stcd2, telf1,
         stras, ort02, ort01, pstlz, regio, aufsd
    FROM kna1
    INTO TABLE @DATA(lt_kna1)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line.

  SELECT kunnr, vkorg, vtweg, spart, zterm, versg, kdgrp, pltyp, vwerk
    FROM knvv
    INTO TABLE @DATA(lt_knvv)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND vkorg IN ( @c_vkorg_1, @c_vkorg_2, @c_vkorg_h1, @c_vkorg_h2 )
      AND aufsd = @space.

  SELECT kunnr, domingo, segunda, terca, quarta, quinta, sexta, sabado
    FROM zsdt111
    INTO TABLE @DATA(lt_z111)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line.

  SELECT kunnr, kkber, klimk, knkli, ctlpc
    FROM knkk
    INTO TABLE @DATA(lt_knkk)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line.

  " conta-mae de credito (limite total do grupo)
  lt_pai = VALUE #( FOR w IN lt_knkk WHERE ( knkli IS NOT INITIAL ) ( w-knkli ) ).
  SORT lt_pai.
  DELETE ADJACENT DUPLICATES FROM lt_pai.

  IF lt_pai IS NOT INITIAL.
    SELECT kunnr, kkber, klimk, knkli, ctlpc
      FROM knkk
      INTO TABLE @DATA(lt_knkk_pai)
      FOR ALL ENTRIES IN @lt_pai
      WHERE kunnr = @lt_pai-table_line.
    APPEND LINES OF lt_knkk_pai TO lt_knkk.
  ENDIF.

  SORT lt_kna1 BY kunnr.
  SORT lt_knvv BY kunnr vkorg vtweg spart.
  SORT lt_z111 BY kunnr.
  SORT lt_knkk BY kunnr kkber.
  DELETE ADJACENT DUPLICATES FROM lt_knkk COMPARING kunnr kkber.

  " ------------------------------------------------------------------
  " Textos (tabelas pequenas, lidas inteiras)
  " ------------------------------------------------------------------
  SELECT zterm, vtext FROM tvzbt INTO TABLE @DATA(lt_tvzbt) WHERE spras = @c_lang.
  SELECT vtweg, vtext FROM tvtwt INTO TABLE @DATA(lt_tvtwt) WHERE spras = @c_lang.
  SELECT spart, vtext FROM tspat INTO TABLE @DATA(lt_tspat) WHERE spras = @c_lang.
  SELECT stgku, bezei20 FROM tvsdt INTO TABLE @DATA(lt_tvsdt) WHERE spras = @c_lang.
  SELECT kdgrp, ktext FROM t151t INTO TABLE @DATA(lt_t151t) WHERE spras = @c_lang.
  SELECT kkber, ctlpc, rtext FROM t691t INTO TABLE @DATA(lt_t691t) WHERE spras = @c_lang.
  SELECT pltyp, ptext FROM t189t INTO TABLE @DATA(lt_t189t) WHERE spras = @c_lang.

  lt_txt = VALUE #( BASE lt_txt FOR a IN lt_tvzbt ( tipo = 'ZTERM' codigo = a-zterm descricao = a-vtext ) ).
  lt_txt = VALUE #( BASE lt_txt FOR b IN lt_tvtwt ( tipo = 'VTWEG' codigo = b-vtweg descricao = b-vtext ) ).
  lt_txt = VALUE #( BASE lt_txt FOR c IN lt_tspat ( tipo = 'SPART' codigo = c-spart descricao = c-vtext ) ).
  lt_txt = VALUE #( BASE lt_txt FOR d IN lt_tvsdt ( tipo = 'STGKU' codigo = d-stgku descricao = d-bezei20 ) ).
  lt_txt = VALUE #( BASE lt_txt FOR e IN lt_t151t ( tipo = 'KDGRP' codigo = e-kdgrp descricao = e-ktext ) ).
  lt_txt = VALUE #( BASE lt_txt FOR f IN lt_t691t ( tipo = 'CTLPC' codigo = |{ f-kkber }{ f-ctlpc }| descricao = f-rtext ) ).
  lt_txt = VALUE #( BASE lt_txt FOR g IN lt_t189t ( tipo = 'PLTYP' codigo = g-pltyp descricao = g-ptext ) ).
  SORT lt_txt BY tipo codigo.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  DATA: ls_kna1  LIKE LINE OF lt_kna1,
        ls_knvv  LIKE LINE OF lt_knvv,
        ls_z111  LIKE LINE OF lt_z111,
        ls_knkk  LIKE LINE OF lt_knkk,
        ls_knkkp LIKE LINE OF lt_knkk.

  LOOP AT lt_kunnr INTO DATA(lv_kunnr).

    CLEAR: ls_cli, ls_kna1, ls_knvv, ls_z111, ls_knkk, ls_knkkp, lv_vant.

    READ TABLE lt_kna1 INTO ls_kna1 WITH KEY kunnr = lv_kunnr BINARY SEARCH.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.

    ls_cli-codigocli     = |{ lv_kunnr ALPHA = OUT }|.
    ls_cli-nome_fantasia = ls_kna1-name4.
    ls_cli-razao_social  = ls_kna1-name1.
    ls_cli-cnpjcpf       = COND #( WHEN ls_kna1-stcd1 IS NOT INITIAL THEN ls_kna1-stcd1 ELSE ls_kna1-stcd2 ).
    ls_cli-telefone      = ls_kna1-telf1.
    ls_cli-bloqueado     = COND #( WHEN ls_kna1-aufsd IS NOT INITIAL THEN 'true' ELSE 'false' ).
    ls_cli-endereco      = VALUE #( logradouro = ls_kna1-stras
                                    bairro     = ls_kna1-ort02
                                    cidade     = ls_kna1-ort01
                                    uf         = ls_kna1-regio
                                    cep        = ls_kna1-pstlz ).

    " --- area de vendas ---
    LOOP AT lt_knvv INTO ls_knvv WHERE kunnr = lv_kunnr.

      " uma linha por organizacao (a KNVV pode ter varias divisoes)
      IF ls_knvv-vkorg = lv_vant.
        CONTINUE.
      ENDIF.
      lv_vant = ls_knvv-vkorg.

      APPEND VALUE #(
        vkorg                = ls_knvv-vkorg
        tipo_material        = tipo_da_org( ls_knvv-vkorg )
        centro               = ls_knvv-vwerk
        cond_pagamento       = VALUE #( codigo    = ls_knvv-zterm
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'ZTERM' iv_cod = ls_knvv-zterm ) )
        canal                = VALUE #( codigo    = ls_knvv-vtweg
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'VTWEG' iv_cod = ls_knvv-vtweg ) )
        segmento             = VALUE #( codigo    = ls_knvv-spart
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'SPART' iv_cod = ls_knvv-spart ) )
        tipo_estabelecimento = VALUE #( codigo    = ls_knvv-versg
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'STGKU' iv_cod = ls_knvv-versg ) )
        rede                 = VALUE #( codigo    = ls_knvv-kdgrp
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'KDGRP' iv_cod = ls_knvv-kdgrp ) )
        lista_preco          = VALUE #( codigo    = ls_knvv-pltyp
                                        descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'PLTYP' iv_cod = ls_knvv-pltyp ) ) )
        TO ls_cli-areas.

    ENDLOOP.

    " --- dias de entrega (1=seg ... 7=dom) ---
    READ TABLE lt_z111 INTO ls_z111 WITH KEY kunnr = lv_kunnr BINARY SEARCH.
    IF sy-subrc = 0.
      IF ls_z111-segunda EQ 'X'. APPEND '1' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-terca   EQ 'X'. APPEND '2' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-quarta  EQ 'X'. APPEND '3' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-quinta  EQ 'X'. APPEND '4' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-sexta   EQ 'X'. APPEND '5' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-sabado  EQ 'X'. APPEND '6' TO ls_cli-dias_entrega. ENDIF.
      IF ls_z111-domingo EQ 'X'. APPEND '7' TO ls_cli-dias_entrega. ENDIF.
    ENDIF.

    IF ls_cli-dias_entrega IS INITIAL.
      " sem cadastro: entrega de segunda a sabado (regra do metodo original)
      ls_cli-dias_entrega = VALUE #( ( `1` ) ( `2` ) ( `3` ) ( `4` ) ( `5` ) ( `6` ) ).
    ENDIF.

    " --- credito ---
    READ TABLE lt_knkk INTO ls_knkk WITH KEY kunnr = lv_kunnr BINARY SEARCH.
    IF sy-subrc = 0.

      ls_cli-classe_risco = VALUE #( codigo    = ls_knkk-ctlpc
                                     descricao = lookup_txt( it_txt = lt_txt iv_tipo = 'CTLPC'
                                                             iv_cod = |{ ls_knkk-kkber }{ ls_knkk-ctlpc }| ) ).

      " no original comparava KUNNR com KLIMK (valor do limite); o correto e KNKLI
      ls_cli-agrupado = COND #( WHEN ls_knkk-knkli IS NOT INITIAL AND ls_knkk-knkli <> ls_knkk-kunnr
                                THEN 'true' ELSE 'false' ).

      DATA(lv_conta) = COND kunnr( WHEN ls_knkk-knkli IS NOT INITIAL THEN ls_knkk-knkli ELSE ls_knkk-kunnr ).
      READ TABLE lt_knkk INTO ls_knkkp WITH KEY kunnr = lv_conta kkber = ls_knkk-kkber BINARY SEARCH.
      IF sy-subrc = 0.
        ls_cli-limite_total = |{ ls_knkkp-klimk DECIMALS = 2 }|.
      ENDIF.

      CLEAR lv_delta.
      CALL FUNCTION 'CREDIT_EXPOSURE'
        EXPORTING
          kkber                = ls_knkk-kkber
          kunnr                = ls_knkk-kunnr
          date_credit_exposure = sy-datum
        IMPORTING
          delta_to_limit       = lv_delta
        EXCEPTIONS
          OTHERS               = 1.

      IF lv_delta < 0.
        lv_delta = 0.
      ENDIF.
      ls_cli-limite_disponivel = |{ lv_delta DECIMALS = 2 }|.

    ENDIF.

    APPEND ls_cli TO ls_response-clientes.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_pedidos.

  " GET /salespole/pedidos?codvendedor=[&codigocli=][&datain=][&datafim=][&dtentrega=]
  "   - sem filtros de data: ultimos 90 dias de criacao
  "   - dtentrega: pedidos da carteira com data de remessa naquele dia
  "     (qualquer data de criacao) -> tela "remessas de hoje"
  " Sem SUBMIT zsdr124 (a ZSDT139 deve ser alimentada por job).
  " pedido_externo / plataforma permitem ao app reconhecer o pedido que ele
  " mesmo criou (codigo interno gravado em BSTKD_E).

  TYPES: BEGIN OF ty_nota,
           nota_fiscal TYPE string,
           serie       TYPE string,
           danfe_url   TYPE string,
           xml_url     TYPE string,
           boleto_url  TYPE string,
         END OF ty_nota,
         tt_nota TYPE STANDARD TABLE OF ty_nota WITH EMPTY KEY,

         BEGIN OF ty_pedido,
           ordem          TYPE string,
           codigocli      TYPE string,
           tp_ped         TYPE string,
           dt_criacao     TYPE string,
           dt_entrega     TYPE string,
           valor          TYPE string,
           status         TYPE string,
           refaturado     TYPE string,
           pedido_externo TYPE string,
           plataforma     TYPE string,
           notas          TYPE tt_nota,
         END OF ty_pedido,
         tt_pedido TYPE STANDARD TABLE OF ty_pedido WITH EMPTY KEY,

         BEGIN OF ty_response,
           pedidos TYPE tt_pedido,
         END OF ty_response,

         BEGIN OF ty_nk,
           ordem  TYPE vbak-vbeln,
           fatura TYPE vbrk-vbeln,
           nfenum TYPE j_1bnfdoc-nfenum,
           series TYPE j_1bnfdoc-series,
         END OF ty_nk.

  DATA: ls_response TYPE ty_response,
        ls_pedido   TYPE ty_pedido,
        ls_nota     TYPE ty_nota,
        lt_nk       TYPE STANDARD TABLE OF ty_nk,
        lt_docnum   TYPE STANDARD TABLE OF j_1bnflin-docnum WITH EMPTY KEY,
        lt_refkey   TYPE STANDARD TABLE OF j_1bnflin-refkey WITH EMPTY KEY,
        lv_refkey   TYPE j_1bnflin-refkey,
        ls_nk       TYPE ty_nk,
        lr_auart    TYPE RANGE OF vbak-auart,
        lr_erdat    TYPE RANGE OF vbak-erdat,
        lr_vdatu    TYPE RANGE OF vbak-vdatu,
        lv_nf       TYPE string,
        lv_serie    TYPE string,
        lv_tem_fat  TYPE abap_bool,
        lv_tem_nfe  TYPE abap_bool.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Filtros
  " ------------------------------------------------------------------
  DATA(lv_ini) = parse_data( mo_request->get_uri_query_parameter( 'datain' ) ).
  DATA(lv_fim) = parse_data( mo_request->get_uri_query_parameter( 'datafim' ) ).
  DATA(lv_ent) = parse_data( mo_request->get_uri_query_parameter( 'dtentrega' ) ).

  IF lv_ini IS INITIAL.
    lv_ini = sy-datum - 90.
  ENDIF.
  IF lv_fim IS INITIAL.
    lv_fim = sy-datum.
  ENDIF.

  IF lv_ent IS NOT INITIAL.
    lr_vdatu = VALUE #( ( sign = 'I' option = 'EQ' low = lv_ent ) ).
  ELSE.
    lr_erdat = VALUE #( ( sign = 'I' option = 'BT' low = lv_ini high = lv_fim ) ).
  ENDIF.

  lr_auart = VALUE #( sign = 'I' option = 'EQ'
                      ( low = 'Z001' ) ( low = 'Z010' ) ( low = 'Z011' ) ( low = 'Z034' ) ).

  " ------------------------------------------------------------------
  " Leituras em lote
  " ------------------------------------------------------------------
  SELECT vbeln, kunnr, auart, erdat, vdatu, netwr
    FROM vbak
    INTO TABLE @DATA(lt_vbak)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND erdat IN @lr_erdat
      AND vdatu IN @lr_vdatu
      AND auart IN @lr_auart.

  IF lt_vbak IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  SORT lt_vbak BY vbeln.

  SELECT vbeln, lfstk, abstk, cmgst
    FROM vbuk
    INTO TABLE @DATA(lt_vbuk)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  " cabecalho comercial: BSTKD_E / BSARK_E = referencia e plataforma de origem
  SELECT vbeln, bstkd, bstkd_e, bsark_e
    FROM vbkd
    INTO TABLE @DATA(lt_vbkd)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln
      AND posnr = '000000'.

  SELECT vbeln, refaturamento
    FROM zsdt139
    INTO TABLE @DATA(lt_z139)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  " faturas (ordem -> fatura), ignorando faturas estornadas
  SELECT vbeln, vbelv
    FROM vbfa
    INTO TABLE @DATA(lt_vbfa)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbelv = @lt_vbak-vbeln
      AND vbtyp_n = 'M'.

  IF lt_vbfa IS NOT INITIAL.
    SELECT vbeln, xblnr
      FROM vbrk
      INTO TABLE @DATA(lt_vbrk)
      FOR ALL ENTRIES IN @lt_vbfa
      WHERE vbeln = @lt_vbfa-vbeln
        AND fksto = @space.
  ENDIF.

  SORT lt_vbuk BY vbeln.
  SORT lt_vbkd BY vbeln.
  SORT lt_z139 BY vbeln.
  SORT lt_vbrk BY vbeln.

  LOOP AT lt_vbfa INTO DATA(ls_vf).

    READ TABLE lt_vbrk INTO DATA(ls_vr) WITH KEY vbeln = ls_vf-vbeln BINARY SEARCH.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.

    READ TABLE lt_vbak INTO DATA(ls_vk) WITH KEY vbeln = ls_vf-vbelv BINARY SEARCH.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.

    CLEAR: ls_nk, lv_nf, lv_serie.
    SPLIT ls_vr-xblnr AT '-' INTO lv_nf lv_serie.

    ls_nk-ordem  = ls_vf-vbelv.
    ls_nk-fatura = ls_vf-vbeln.
    ls_nk-nfenum = lv_nf.
    ls_nk-series = lv_serie.
    APPEND ls_nk TO lt_nk.

  ENDLOOP.

  " documento fiscal pela chave de referencia da NF (J_1BNFLIN-REFKEY = fatura).
  " A consulta direta a J_1BNFDOC por NFENUM/SERIES/PARID varre a tabela inteira.
  " FOR ALL ENTRIES exige mesmo tipo/comprimento: REFKEY e CHAR20, VBELN e CHAR10
  lt_refkey = VALUE #( FOR f IN lt_vbrk ( CONV j_1bnflin-refkey( f-vbeln ) ) ).

  IF lt_refkey IS NOT INITIAL.
    SELECT docnum, refkey
      FROM j_1bnflin
      INTO TABLE @DATA(lt_lin)
      FOR ALL ENTRIES IN @lt_refkey
      WHERE reftyp = 'BI'
        AND refkey = @lt_refkey-table_line.
  ENDIF.

  SORT lt_lin BY refkey docnum.
  DELETE ADJACENT DUPLICATES FROM lt_lin COMPARING refkey docnum.

  lt_docnum = VALUE #( FOR w IN lt_lin ( w-docnum ) ).
  SORT lt_docnum.
  DELETE ADJACENT DUPLICATES FROM lt_docnum.

  IF lt_docnum IS NOT INITIAL.
    SELECT docnum, xml_url, danfe_url, boleto_url
      FROM zsdt_savedocs
      INTO TABLE @DATA(lt_sav)
      FOR ALL ENTRIES IN @lt_docnum
      WHERE docnum = @lt_docnum-table_line.
  ENDIF.

  SORT lt_sav BY docnum.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  DATA: ls_vbuk LIKE LINE OF lt_vbuk,
        ls_vbkd LIKE LINE OF lt_vbkd,
        ls_z139 LIKE LINE OF lt_z139,
        ls_lin  LIKE LINE OF lt_lin,
        ls_sav  LIKE LINE OF lt_sav.

  LOOP AT lt_vbak INTO DATA(ls_vbak).

    CLEAR: ls_pedido, ls_vbuk, ls_vbkd, ls_z139, lv_tem_fat, lv_tem_nfe.

    ls_pedido-ordem      = |{ ls_vbak-vbeln ALPHA = OUT }|.
    ls_pedido-codigocli  = |{ ls_vbak-kunnr ALPHA = OUT }|.
    ls_pedido-tp_ped     = ls_vbak-auart.
    ls_pedido-dt_criacao = iso_data( ls_vbak-erdat ).
    ls_pedido-dt_entrega = iso_data( ls_vbak-vdatu ).
    " valor liquido do pedido (VBAK-NETWR). O original usava ZSDT139-NETWR.
    ls_pedido-valor      = |{ ls_vbak-netwr DECIMALS = 2 }|.

    READ TABLE lt_vbuk INTO ls_vbuk WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.
    READ TABLE lt_vbkd INTO ls_vbkd WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.
    READ TABLE lt_z139 INTO ls_z139 WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.

    ls_pedido-refaturado     = ls_z139-refaturamento.
    ls_pedido-pedido_externo = COND #( WHEN ls_vbkd-bstkd IS NOT INITIAL THEN ls_vbkd-bstkd ELSE ls_vbkd-bstkd_e ).
    ls_pedido-plataforma     = ls_vbkd-bsark_e.

    " --- notas fiscais ---
    LOOP AT lt_nk INTO ls_nk WHERE ordem = ls_vbak-vbeln.

      CLEAR: ls_nota, ls_lin, ls_sav.
      lv_tem_fat = abap_true.

      ls_nota-nota_fiscal = ls_nk-nfenum.
      ls_nota-serie       = ls_nk-series.

      IF ls_nk-nfenum IS NOT INITIAL.
        lv_tem_nfe = abap_true.
      ENDIF.

      lv_refkey = ls_nk-fatura.
      READ TABLE lt_lin INTO ls_lin WITH KEY refkey = lv_refkey BINARY SEARCH.
      IF sy-subrc = 0.
        READ TABLE lt_sav INTO ls_sav WITH KEY docnum = ls_lin-docnum BINARY SEARCH.
        IF sy-subrc = 0.
          ls_nota-danfe_url  = ls_sav-danfe_url.
          ls_nota-xml_url    = ls_sav-xml_url.
          ls_nota-boleto_url = ls_sav-boleto_url.
        ENDIF.
      ENDIF.

      APPEND ls_nota TO ls_pedido-notas.

    ENDLOOP.

    " --- status (mesma regra do original; antes o ramo "sem fatura" usava
    "     VBUK de outra iteracao) ---
    IF lv_tem_fat = abap_true.

      IF ls_vbuk-lfstk = 'C'.
        ls_pedido-status = 'Faturado'.
      ELSEIF ls_vbuk-lfstk = 'B' AND lv_tem_nfe = abap_true.
        ls_pedido-status = 'Faturado Parcial'.
      ELSE.
        ls_pedido-status = 'A Faturar'.
      ENDIF.

    ELSE.

      IF ls_vbuk-abstk = 'C'.
        ls_pedido-status = 'Recusado'.
      ELSEIF ls_vbuk-cmgst = 'B'.
        ls_pedido-status = 'Aguardando Liberação'.
      ELSE.
        ls_pedido-status = 'Liberado para faturamento'.
      ENDIF.

    ENDIF.

    APPEND ls_pedido TO ls_response-pedidos.

  ENDLOOP.

  SORT ls_response-pedidos BY dt_criacao DESCENDING ordem DESCENDING.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_itens.

  " GET /salespole/itens?codvendedor=&ordens=0001,0002,...   (ou &ordem=0001)
  " Itens de varias ordens em uma chamada (maximo 300). So devolve ordens de
  " clientes da carteira do vendedor.

  TYPES: BEGIN OF ty_item,
           item           TYPE string,
           material       TYPE string,
           denominacao    TYPE string,
           grupo          TYPE string,
           quantidade     TYPE string,
           unidade_venda  TYPE string,
           valor_unitario TYPE string,
           recusa         TYPE string,
           cod_recusa     TYPE string,
         END OF ty_item,
         tt_item TYPE STANDARD TABLE OF ty_item WITH EMPTY KEY,

         BEGIN OF ty_ordem,
           ordem          TYPE string,
           pedido_externo TYPE string,
           plataforma     TYPE string,
           dt_faturamento TYPE string,
           itens          TYPE tt_item,
         END OF ty_ordem,
         tt_ordem TYPE STANDARD TABLE OF ty_ordem WITH EMPTY KEY,

         BEGIN OF ty_response,
           ordens TYPE tt_ordem,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        ls_ordem    TYPE ty_ordem,
        ls_item     TYPE ty_item,
        lt_ord      TYPE STANDARD TABLE OF vbak-vbeln WITH EMPTY KEY,
        lt_mat      TYPE STANDARD TABLE OF matnr WITH EMPTY KEY,
        lt_mkl      TYPE STANDARD TABLE OF matkl WITH EMPTY KEY,
        lv_vu       TYPE p LENGTH 15 DECIMALS 4.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  DATA(lv_ordens) = mo_request->get_uri_query_parameter( 'ordens' ).
  IF lv_ordens IS INITIAL.
    lv_ordens = mo_request->get_uri_query_parameter( 'ordem' ).
  ENDIF.

  IF lv_ordens IS INITIAL.
    send_error( iv_status = 400 iv_msg = 'Informe ordens (ou ordem)' ).
    RETURN.
  ENDIF.

  SPLIT lv_ordens AT ',' INTO TABLE DATA(lt_txt_ord).

  LOOP AT lt_txt_ord INTO DATA(lv_o).
    CONDENSE lv_o.
    IF lv_o IS NOT INITIAL.
      APPEND CONV vbak-vbeln( |{ lv_o ALPHA = IN WIDTH = 10 }| ) TO lt_ord.
    ENDIF.
  ENDLOOP.

  IF lt_ord IS INITIAL OR lines( lt_ord ) > 300.
    send_error( iv_status = 400 iv_msg = 'Informe de 1 a 300 ordens' ).
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Autorizacao: so ordens de clientes da carteira
  " ------------------------------------------------------------------
  SELECT vbeln, kunnr
    FROM vbak
    INTO TABLE @DATA(lt_vbak)
    FOR ALL ENTRIES IN @lt_ord
    WHERE vbeln = @lt_ord-table_line.

  SORT lt_kunnr.

  LOOP AT lt_vbak INTO DATA(ls_vk).
    READ TABLE lt_kunnr TRANSPORTING NO FIELDS WITH KEY table_line = ls_vk-kunnr BINARY SEARCH.
    IF sy-subrc <> 0.
      DELETE lt_vbak.
    ENDIF.
  ENDLOOP.

  IF lt_vbak IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  SORT lt_vbak BY vbeln.

  " ------------------------------------------------------------------
  " Leituras em lote
  " ------------------------------------------------------------------
  SELECT vbeln, posnr, matnr, matkl, kwmeng, vrkme, netwr, abgru
    FROM vbap
    INTO TABLE @DATA(lt_vbap)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  SORT lt_vbap BY vbeln posnr.

  SELECT vbeln, posnr, netpr, zmeng, bezei
    FROM zsdt139
    INTO TABLE @DATA(lt_z139)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  SORT lt_z139 BY vbeln posnr.

  SELECT vbeln, bstkd, bstkd_e, bsark_e, fkdat
    FROM vbkd
    INTO TABLE @DATA(lt_vbkd)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln
      AND posnr = '000000'.

  SORT lt_vbkd BY vbeln.

  lt_mat = VALUE #( FOR a IN lt_vbap ( a-matnr ) ).
  SORT lt_mat.
  DELETE ADJACENT DUPLICATES FROM lt_mat.

  lt_mkl = VALUE #( FOR b IN lt_vbap ( b-matkl ) ).
  SORT lt_mkl.
  DELETE ADJACENT DUPLICATES FROM lt_mkl.

  IF lt_mat IS NOT INITIAL.
    SELECT matnr, maktx
      FROM makt
      INTO TABLE @DATA(lt_makt)
      FOR ALL ENTRIES IN @lt_mat
      WHERE matnr = @lt_mat-table_line
        AND spras = @c_lang.
  ENDIF.

  IF lt_mkl IS NOT INITIAL.
    SELECT matkl, wgbez60
      FROM t023t
      INTO TABLE @DATA(lt_t023t)
      FOR ALL ENTRIES IN @lt_mkl
      WHERE matkl = @lt_mkl-table_line
        AND spras = @c_lang.
  ENDIF.

  SELECT msehi, mseh3 FROM t006a INTO TABLE @DATA(lt_t006a) WHERE spras = @c_lang.
  SELECT bsark, vtext FROM t176t INTO TABLE @DATA(lt_t176t) WHERE spras = @c_lang.

  SORT lt_makt  BY matnr.
  SORT lt_t023t BY matkl.
  SORT lt_t006a BY msehi.
  SORT lt_t176t BY bsark.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  DATA: ls_vbkd  LIKE LINE OF lt_vbkd,
        ls_z139  LIKE LINE OF lt_z139,
        ls_makt  LIKE LINE OF lt_makt,
        ls_t023t LIKE LINE OF lt_t023t,
        ls_t006a LIKE LINE OF lt_t006a,
        ls_t176t LIKE LINE OF lt_t176t.

  LOOP AT lt_vbak INTO DATA(ls_vbak).

    CLEAR: ls_ordem, ls_vbkd, ls_t176t.

    READ TABLE lt_vbkd INTO ls_vbkd WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.
    READ TABLE lt_t176t INTO ls_t176t WITH KEY bsark = ls_vbkd-bsark_e BINARY SEARCH.

    ls_ordem-ordem          = |{ ls_vbak-vbeln ALPHA = OUT }|.
    ls_ordem-pedido_externo = COND #( WHEN ls_vbkd-bstkd IS NOT INITIAL THEN ls_vbkd-bstkd ELSE ls_vbkd-bstkd_e ).
    ls_ordem-plataforma     = ls_t176t-vtext.
    ls_ordem-dt_faturamento = iso_data( ls_vbkd-fkdat ).

    LOOP AT lt_vbap INTO DATA(ls_vbap) WHERE vbeln = ls_vbak-vbeln.

      CLEAR: ls_item, ls_z139, ls_makt, ls_t023t, ls_t006a, lv_vu.

      READ TABLE lt_z139  INTO ls_z139  WITH KEY vbeln = ls_vbap-vbeln posnr = ls_vbap-posnr BINARY SEARCH.
      READ TABLE lt_makt  INTO ls_makt  WITH KEY matnr = ls_vbap-matnr BINARY SEARCH.
      READ TABLE lt_t023t INTO ls_t023t WITH KEY matkl = ls_vbap-matkl BINARY SEARCH.
      READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_vbap-vrkme BINARY SEARCH.

      " valor unitario: ZSDT139 (apos processamento); se nao houver, VBAP
      IF ls_z139-zmeng <> 0.
        lv_vu = ls_z139-netpr / ls_z139-zmeng.
      ELSEIF ls_vbap-kwmeng <> 0.
        lv_vu = ls_vbap-netwr / ls_vbap-kwmeng.
      ENDIF.

      ls_item-item           = |{ ls_vbap-posnr ALPHA = OUT }|.
      ls_item-material       = |{ ls_vbap-matnr ALPHA = OUT }|.
      ls_item-denominacao    = ls_makt-maktx.
      ls_item-grupo          = ls_t023t-wgbez60.
      ls_item-quantidade     = |{ ls_vbap-kwmeng DECIMALS = 3 }|.
      ls_item-unidade_venda  = ls_t006a-mseh3.
      ls_item-valor_unitario = |{ lv_vu DECIMALS = 4 }|.
      ls_item-recusa         = ls_z139-bezei.
      ls_item-cod_recusa     = ls_vbap-abgru.

      APPEND ls_item TO ls_ordem-itens.

    ENDLOOP.

    APPEND ls_ordem TO ls_response-ordens.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_titulos.

  " GET /salespole/titulos?codvendedor=[&codigocli=]
  " Um registro por PARCELA (belnr + buzei). O original colapsava por NF e
  " perdia parcelas. O app agrupa por "nfe" se quiser mostrar por nota.

  TYPES: BEGIN OF ty_titulo,
           codigocli      TYPE string,
           nfe            TYPE string,
           parcela        TYPE string,
           status         TYPE string,   " Em aberto | Atrasado | Compensado
           valor          TYPE string,
           vencimento     TYPE string,
           dt_compensacao TYPE string,
           ordem          TYPE string,
           danfe_url      TYPE string,
           boleto_url     TYPE string,
         END OF ty_titulo,
         tt_titulo TYPE STANDARD TABLE OF ty_titulo WITH EMPTY KEY,

         BEGIN OF ty_response,
           titulos TYPE tt_titulo,
         END OF ty_response,

         BEGIN OF ty_bs,
           bukrs TYPE bsid-bukrs,
           kunnr TYPE bsid-kunnr,
           belnr TYPE bsid-belnr,
           gjahr TYPE bsid-gjahr,
           buzei TYPE bsid-buzei,
           xblnr TYPE bsid-xblnr,
           vbeln TYPE bsid-vbeln,
           zfbdt TYPE bsid-zfbdt,
           zbd1t TYPE bsid-zbd1t,
           zbd2t TYPE bsid-zbd2t,
           zbd3t TYPE bsid-zbd3t,
           shkzg TYPE bsid-shkzg,
           rebzg TYPE bsid-rebzg,
           augbl TYPE bsid-augbl,
           augdt TYPE bsid-augdt,
           wrbtr TYPE bsid-wrbtr,
         END OF ty_bs,

         BEGIN OF ty_nk,
           nfenum TYPE j_1bnfdoc-nfenum,
           series TYPE j_1bnfdoc-series,
           parid  TYPE j_1bnfdoc-parid,
         END OF ty_nk.

  DATA: ls_response TYPE ty_response,
        ls_titulo   TYPE ty_titulo,
        lt_bs       TYPE STANDARD TABLE OF ty_bs,
        lt_nk       TYPE STANDARD TABLE OF ty_nk,
        ls_nk       TYPE ty_nk,
        lt_fat      TYPE STANDARD TABLE OF vbrk-vbeln WITH EMPTY KEY,
        lt_docnum   TYPE STANDARD TABLE OF j_1bnflin-docnum WITH EMPTY KEY,
        lt_refkey   TYPE STANDARD TABLE OF j_1bnflin-refkey WITH EMPTY KEY,
        lv_refkey   TYPE j_1bnflin-refkey,
        ls_b        TYPE ty_bs,
        lr_blart    TYPE RANGE OF bsid-blart,
        lv_faedt    TYPE rfpos-faedt,
        lv_nf       TYPE string,
        lv_serie    TYPE string.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  DATA(lv_desde) = sy-datum - 90.

  lr_blart = VALUE #( sign = 'I' option = 'EQ' ( low = 'RV' ) ( low = 'DR' ) ( low = 'DD' ) ).

  " ------------------------------------------------------------------
  " Partidas em aberto (BSID) + compensadas nos ultimos 90 dias (BSAD)
  " ------------------------------------------------------------------
  SELECT bukrs, kunnr, belnr, gjahr, buzei, xblnr, vbeln, zfbdt, zbd1t, zbd2t, zbd3t,
         shkzg, rebzg, augbl, augdt, wrbtr
    FROM bsid
    INTO CORRESPONDING FIELDS OF TABLE @lt_bs
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND blart IN @lr_blart
      AND shkzg = 'S'.

  SELECT bukrs, kunnr, belnr, gjahr, buzei, xblnr, vbeln, zfbdt, zbd1t, zbd2t, zbd3t,
         shkzg, rebzg, augbl, augdt, wrbtr
    FROM bsad
    APPENDING CORRESPONDING FIELDS OF TABLE @lt_bs
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND bldat >= @lv_desde
      AND blart IN @lr_blart
      AND shkzg = 'S'.

  IF lt_bs IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Ordem de venda de origem e documentos fiscais (danfe/boleto)
  " ------------------------------------------------------------------
  lt_fat = VALUE #( FOR a IN lt_bs WHERE ( vbeln IS NOT INITIAL ) ( a-vbeln ) ).
  SORT lt_fat.
  DELETE ADJACENT DUPLICATES FROM lt_fat.

  IF lt_fat IS NOT INITIAL.
    SELECT vbeln, vbelv
      FROM vbfa
      INTO TABLE @DATA(lt_vbfa)
      FOR ALL ENTRIES IN @lt_fat
      WHERE vbeln = @lt_fat-table_line
        AND vbtyp_v = 'C'.
  ENDIF.

  SORT lt_vbfa BY vbeln.

  " documento fiscal pela chave de referencia da NF (J_1BNFLIN-REFKEY = fatura).
  " A consulta direta a J_1BNFDOC por NFENUM/SERIES/PARID varre a tabela inteira.
  " FOR ALL ENTRIES exige mesmo tipo/comprimento: REFKEY e CHAR20, VBELN e CHAR10
  lt_refkey = VALUE #( FOR f IN lt_fat ( CONV j_1bnflin-refkey( f ) ) ).

  IF lt_refkey IS NOT INITIAL.
    SELECT docnum, refkey
      FROM j_1bnflin
      INTO TABLE @DATA(lt_lin)
      FOR ALL ENTRIES IN @lt_refkey
      WHERE reftyp = 'BI'
        AND refkey = @lt_refkey-table_line.
  ENDIF.

  SORT lt_lin BY refkey docnum.
  DELETE ADJACENT DUPLICATES FROM lt_lin COMPARING refkey docnum.

  lt_docnum = VALUE #( FOR w IN lt_lin ( w-docnum ) ).
  SORT lt_docnum.
  DELETE ADJACENT DUPLICATES FROM lt_docnum.

  IF lt_docnum IS NOT INITIAL.
    SELECT docnum, danfe_url, boleto_url
      FROM zsdt_savedocs
      INTO TABLE @DATA(lt_sav)
      FOR ALL ENTRIES IN @lt_docnum
      WHERE docnum = @lt_docnum-table_line.
  ENDIF.

  SORT lt_sav BY docnum.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  DATA: ls_vbfa LIKE LINE OF lt_vbfa,
        ls_lin  LIKE LINE OF lt_lin,
        ls_sav  LIKE LINE OF lt_sav.

  LOOP AT lt_bs INTO ls_b.

    CLEAR: ls_titulo, ls_vbfa, ls_lin, ls_sav, lv_faedt, lv_nf, lv_serie.

    CALL FUNCTION 'NET_DUE_DATE_GET'
      EXPORTING
        i_zfbdt = ls_b-zfbdt
        i_zbd1t = ls_b-zbd1t
        i_zbd2t = ls_b-zbd2t
        i_zbd3t = ls_b-zbd3t
        i_shkzg = ls_b-shkzg
        i_rebzg = ls_b-rebzg
      IMPORTING
        e_faedt = lv_faedt.

    IF ls_b-augbl IS NOT INITIAL.
      ls_titulo-status = 'Compensado'.
    ELSEIF lv_faedt < sy-datum.
      ls_titulo-status = 'Atrasado'.
    ELSE.
      ls_titulo-status = 'Em aberto'.
    ENDIF.

    SPLIT ls_b-xblnr AT '-' INTO lv_nf lv_serie.

    ls_titulo-codigocli      = |{ ls_b-kunnr ALPHA = OUT }|.
    ls_titulo-nfe            = lv_nf.
    ls_titulo-parcela        = |{ ls_b-buzei ALPHA = OUT }|.
    ls_titulo-valor          = |{ ls_b-wrbtr DECIMALS = 2 }|.
    ls_titulo-vencimento     = iso_data( lv_faedt ).
    ls_titulo-dt_compensacao = iso_data( ls_b-augdt ).

    READ TABLE lt_vbfa INTO ls_vbfa WITH KEY vbeln = ls_b-vbeln BINARY SEARCH.
    IF sy-subrc = 0.
      ls_titulo-ordem = |{ ls_vbfa-vbelv ALPHA = OUT }|.
    ENDIF.

    lv_refkey = ls_b-vbeln.
    READ TABLE lt_lin INTO ls_lin WITH KEY refkey = lv_refkey BINARY SEARCH.
    IF sy-subrc = 0.
      READ TABLE lt_sav INTO ls_sav WITH KEY docnum = ls_lin-docnum BINARY SEARCH.
      IF sy-subrc = 0.
        ls_titulo-danfe_url  = ls_sav-danfe_url.
        ls_titulo-boleto_url = ls_sav-boleto_url.
      ENDIF.
    ENDIF.

    APPEND ls_titulo TO ls_response-titulos.

  ENDLOOP.

  SORT ls_response-titulos BY codigocli vencimento nfe parcela.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_produtos.

  " GET /salespole/produtos
  " Cadastro de produtos (sem preco: preco vem de /salespole/precos).
  " Unidades: o codigo INTERNO (MARM-MEINH, ex.: KI) e o que vai no pedido; o TEXTO (T006A, ex.: CX)
  " e o que o vendedor le. A caixa e a unidade da MARM cujo texto e 'CX' (c_texto_caixa); sem ela,
  " unidade_venda = unidade base.
  " conversoes = unidades alternativas da MARM, com o fator em UNIDADES BASE por 1 unidade
  " (UMREZ/UMREN). O app usa isso para o preco por caixa, o estoque em caixas e o minimo/multiplo.
  " ZFV_PRODUTO guarda price_table/price na mesma linha, entao deduplicamos
  " por product_id.

  TYPES: BEGIN OF ty_estoque,
           disponivelecommerce TYPE string,
           prazoentregadias    TYPE string,
         END OF ty_estoque,

         BEGIN OF ty_peso,
           pesoliquido TYPE string,
           pesobruto   TYPE string,
         END OF ty_peso,

         BEGIN OF ty_pedido,
           quantidademinima TYPE string,
           multiplo         TYPE string,
         END OF ty_pedido,

         BEGIN OF ty_classificacao,
           marca     TYPE string,
           categoria TYPE string,
           linha     TYPE string,
           grupo     TYPE string,
         END OF ty_classificacao,

         BEGIN OF ty_conv,
           unidade TYPE string,   " codigo interno (MARM-MEINH)
           texto   TYPE string,   " texto externo (T006A-MSEH3)
           fator   TYPE string,   " unidades base por 1 desta unidade
         END OF ty_conv,
         tt_conv TYPE STANDARD TABLE OF ty_conv WITH EMPTY KEY,

         BEGIN OF ty_produto,
           codigoproduto TYPE string,
           descricao     TYPE string,
           tipo          TYPE string,
           unidade       TYPE string,
           ean           TYPE string,
           ncm           TYPE string,
           validade      TYPE string,
           tipo_material TYPE string,   " FERT | HAWA (define em qual pedido SAP o item vai)
           unidade_base  TYPE string,   " MARA-MEINS (codigo interno)
           unidade_base_texto  TYPE string,
           unidade_venda TYPE string,   " unidade em que o pedido e feito (caixa), codigo interno
           unidade_venda_texto TYPE string,
           conversoes    TYPE tt_conv,
           estoque       TYPE ty_estoque,
           peso          TYPE ty_peso,
           pedido        TYPE ty_pedido,
           classificacao TYPE ty_classificacao,
         END OF ty_produto,
         tt_produto TYPE STANDARD TABLE OF ty_produto WITH EMPTY KEY,

         BEGIN OF ty_response,
           produtos TYPE tt_produto,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        ls_produto  TYPE ty_produto,
        lt_matnr    TYPE STANDARD TABLE OF matnr WITH EMPTY KEY.

  SELECT *
    FROM zfv_produto
    INTO TABLE @DATA(lt_prod).

  SORT lt_prod BY product_id.
  DELETE ADJACENT DUPLICATES FROM lt_prod COMPARING product_id.

  IF lt_prod IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  lt_matnr = VALUE #( FOR a IN lt_prod ( CONV matnr( |{ a-product_id ALPHA = IN WIDTH = 18 }| ) ) ).
  SORT lt_matnr.
  DELETE ADJACENT DUPLICATES FROM lt_matnr.

  SELECT matnr, mhdhb, normt, mtart, meins
    FROM mara
    INTO TABLE @DATA(lt_mara)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_mara BY matnr.

  " conversoes de unidade (em lote, uma leitura so)
  SELECT matnr, meinh, umrez, umren
    FROM marm
    INTO TABLE @DATA(lt_marm)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_marm BY matnr meinh.

  " textos externos das unidades (tabela pequena, lida inteira)
  SELECT msehi, mseh3
    FROM t006a
    INTO TABLE @DATA(lt_t006a)
    WHERE spras = @c_lang.

  SORT lt_t006a BY msehi.

  DATA: ls_mara  LIKE LINE OF lt_mara,
        ls_t006a LIKE LINE OF lt_t006a,
        lv_caixa TYPE marm-meinh.

  LOOP AT lt_prod INTO DATA(wa_prod).

    CLEAR: ls_produto, ls_mara.

    DATA(lv_matnr) = CONV matnr( |{ wa_prod-product_id ALPHA = IN WIDTH = 18 }| ).
    READ TABLE lt_mara INTO ls_mara WITH KEY matnr = lv_matnr BINARY SEARCH.

    ls_produto-codigoproduto = |{ lv_matnr ALPHA = OUT }|.
    ls_produto-descricao     = wa_prod-product_desc.
    ls_produto-tipo          = wa_prod-type.
    ls_produto-unidade       = wa_prod-unit.
    ls_produto-ean           = wa_prod-ean.
    ls_produto-ncm           = wa_prod-ncm.
    ls_produto-validade      = ls_mara-mhdhb.
    ls_produto-tipo_material = ls_mara-mtart.
    ls_produto-unidade_base = ls_mara-meins.

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_mara-meins BINARY SEARCH.
    ls_produto-unidade_base_texto = ls_t006a-mseh3.

    " conversoes da MARM com o texto de cada unidade; a CAIXA e a que tem o texto 'CX'
    CLEAR lv_caixa.
    LOOP AT lt_marm INTO DATA(ls_marm) WHERE matnr = lv_matnr.

      IF ls_marm-umren = 0.
        CONTINUE.
      ENDIF.

      CLEAR ls_t006a.
      READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_marm-meinh BINARY SEARCH.

      APPEND VALUE #( unidade = ls_marm-meinh
                      texto   = ls_t006a-mseh3
                      fator   = |{ CONV decfloat34( ls_marm-umrez ) / ls_marm-umren DECIMALS = 6 }| )
        TO ls_produto-conversoes.

      IF lv_caixa IS INITIAL AND ls_t006a-mseh3 = c_texto_caixa.
        lv_caixa = ls_marm-meinh.
      ENDIF.

    ENDLOOP.

    " o pedido e feito em CAIXA; sem unidade de caixa na MARM usa a unidade base
    ls_produto-unidade_venda = COND #( WHEN lv_caixa IS NOT INITIAL THEN lv_caixa ELSE ls_mara-meins ).

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_produto-unidade_venda BINARY SEARCH.
    ls_produto-unidade_venda_texto = ls_t006a-mseh3.

    ls_produto-estoque-disponivelecommerce = wa_prod-allow_ecommerce.
    ls_produto-estoque-prazoentregadias    = wa_prod-prevision_days_delivery.
    ls_produto-peso-pesoliquido            = wa_prod-weight_net.
    ls_produto-peso-pesobruto              = wa_prod-weight_gross.
    ls_produto-pedido-quantidademinima     = wa_prod-minimum.
    ls_produto-pedido-multiplo             = wa_prod-mutiple.

    ls_produto-classificacao-marca     = ls_mara-normt.
    ls_produto-classificacao-categoria = wa_prod-category.
    ls_produto-classificacao-linha     = wa_prod-linha.
    ls_produto-classificacao-grupo     = wa_prod-grupo.

    APPEND ls_produto TO ls_response-produtos.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_catalogo_preco.

  " GET /salespole/catalogo_preco
  " Listas de preco (T189T) e grupos de cliente (T151T) cadastrados.

  TYPES: BEGIN OF ty_lista,
           pltyp TYPE string,
           ptext TYPE string,
         END OF ty_lista,
         tt_lista TYPE STANDARD TABLE OF ty_lista WITH EMPTY KEY,

         BEGIN OF ty_grupo,
           kdgrp TYPE string,
           ktext TYPE string,
         END OF ty_grupo,
         tt_grupo TYPE STANDARD TABLE OF ty_grupo WITH EMPTY KEY,

         BEGIN OF ty_response,
           listas TYPE tt_lista,
           grupos TYPE tt_grupo,
         END OF ty_response.

  DATA ls_response TYPE ty_response.

  SELECT pltyp, ptext
    FROM t189t
    INTO TABLE @DATA(lt_listas)
    WHERE spras = @c_lang
    ORDER BY pltyp.

  SELECT kdgrp, ktext
    FROM t151t
    INTO TABLE @DATA(lt_grupos)
    WHERE spras = @c_lang
    ORDER BY kdgrp.

  ls_response-listas = VALUE #( FOR a IN lt_listas ( pltyp = a-pltyp ptext = a-ptext ) ).
  ls_response-grupos = VALUE #( FOR b IN lt_grupos ( kdgrp = b-kdgrp ktext = b-ktext ) ).

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_precos.

  " GET /salespole/precos?codvendedor=[&data=YYYY-MM-DD]
  " Precos vigentes na data (padrao: hoje) apenas das listas/grupos usados
  " pelos clientes da carteira do vendedor.
  "   listas : A913 (lista de preco x material)
  "   grupos : A912 (lista de preco x grupo de cliente x material)
  " Precedencia (definida pelo negocio): grupos (lista+grupo, A912) vale antes
  " de listas (A913). O app procura em grupos e, se nao achar, usa listas.
  " Sem filtro de tipo de condicao (KSCHL): o ZPR2 nao e o tipo em que a lista
  " esta cadastrada na A913/A912 (testado no QAS: com o filtro vinha vazio).
  " Desconto maximo por item (desconto_max, em %): (KBETR - MXWRT) / KBETR x 100 da condicao;
  " MXWRT vazio = 0 (sem desconto). So vale se a ZSDT138 liberar o desconto (DESCONTO = 'X')
  " para a chave da tabela: LISTA (A913) ou LISTA.GRUPO.LISTA (A912); senao desconto_max = 0.

  TYPES: BEGIN OF ty_preco,
           matnr      TYPE string,
           datab      TYPE string,
           datbi      TYPE string,
           kbetr      TYPE string,
           kpein      TYPE string,
           kmein      TYPE string,
           konwa      TYPE string,
           krech      TYPE string,
           preco_kg   TYPE string,
           desconto_max TYPE string,
         END OF ty_preco,
         tt_preco TYPE STANDARD TABLE OF ty_preco WITH EMPTY KEY,

         BEGIN OF ty_lista,
           pltyp TYPE string,
           itens TYPE tt_preco,
         END OF ty_lista,
         tt_lista TYPE STANDARD TABLE OF ty_lista WITH EMPTY KEY,

         BEGIN OF ty_grupo,
           pltyp TYPE string,
           kdgrp TYPE string,
           itens TYPE tt_preco,
         END OF ty_grupo,
         tt_grupo TYPE STANDARD TABLE OF ty_grupo WITH EMPTY KEY,

         BEGIN OF ty_response,
           data_ref TYPE string,
           listas   TYPE tt_lista,
           grupos   TYPE tt_grupo,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        lr_pltyp    TYPE RANGE OF knvv-pltyp,
        lr_kdgrp    TYPE RANGE OF knvv-kdgrp,
        lv_pant     TYPE a913-pltyp,
        lv_kant     TYPE a912-kdgrp,
        lv_pct      TYPE p LENGTH 8 DECIMALS 2,
        lv_idpreco  TYPE string,
        lt_138      TYPE STANDARD TABLE OF zsdt138-id WITH EMPTY KEY.

  FIELD-SYMBOLS: <fs_lista> TYPE ty_lista,
                 <fs_grupo> TYPE ty_grupo.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  DATA(lv_data) = parse_data( mo_request->get_uri_query_parameter( 'data' ) ).
  IF lv_data IS INITIAL.
    lv_data = sy-datum.
  ENDIF.

  ls_response-data_ref = iso_data( lv_data ).

  " ------------------------------------------------------------------
  " Pares (lista, grupo) usados pela carteira
  " ------------------------------------------------------------------
  SELECT DISTINCT pltyp, kdgrp
    FROM knvv
    INTO TABLE @DATA(lt_par)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND vkorg IN ( @c_vkorg_1, @c_vkorg_2, @c_vkorg_h1, @c_vkorg_h2 )
      AND aufsd = @space.

  DELETE lt_par WHERE pltyp IS INITIAL.

  IF lt_par IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  " chaves de lista/grupo que PODEM dar desconto
  SELECT id FROM zsdt138 INTO TABLE @lt_138 WHERE desconto = 'X'.

  SORT lt_par BY pltyp kdgrp.

  lr_pltyp = VALUE #( FOR a IN lt_par ( sign = 'I' option = 'EQ' low = a-pltyp ) ).
  lr_kdgrp = VALUE #( FOR b IN lt_par WHERE ( kdgrp IS NOT INITIAL ) ( sign = 'I' option = 'EQ' low = b-kdgrp ) ).

  SORT lr_pltyp BY low.
  DELETE ADJACENT DUPLICATES FROM lr_pltyp COMPARING low.
  SORT lr_kdgrp BY low.
  DELETE ADJACENT DUPLICATES FROM lr_kdgrp COMPARING low.

  " ------------------------------------------------------------------
  " A913 - lista de preco x material
  " ------------------------------------------------------------------
  SELECT a913~pltyp, a913~matnr, a913~datab, a913~datbi,
         konp~kbetr, konp~kpein, konp~kmein, konp~konwa, konp~krech, konp~mxwrt
    FROM a913
    INNER JOIN konp
      ON  konp~kappl = a913~kappl
      AND konp~kfrst = a913~kfrst
      AND konp~knumh = a913~knumh
      AND konp~kschl = a913~kschl
    INTO TABLE @DATA(lt_a913)
    WHERE a913~pltyp  IN @lr_pltyp
      AND a913~datab  <= @lv_data
      AND a913~datbi  >= @lv_data
      AND konp~loevm_ko = @space.

  SORT lt_a913 BY pltyp matnr.

  LOOP AT lt_a913 INTO DATA(ls_a13).

    IF ls_a13-pltyp <> lv_pant OR <fs_lista> IS NOT ASSIGNED.
      APPEND VALUE #( pltyp = ls_a13-pltyp ) TO ls_response-listas ASSIGNING <fs_lista>.
      lv_pant = ls_a13-pltyp.
    ENDIF.

    CLEAR lv_pct.
    IF ls_a13-kbetr > 0 AND ls_a13-mxwrt > 0 AND ls_a13-mxwrt < ls_a13-kbetr
       AND line_exists( lt_138[ table_line = CONV #( ls_a13-pltyp ) ] ).
      lv_pct = ( ls_a13-kbetr - ls_a13-mxwrt ) * 100 / ls_a13-kbetr.
    ENDIF.

    APPEND VALUE #( matnr    = |{ ls_a13-matnr ALPHA = OUT }|
                    datab    = iso_data( ls_a13-datab )
                    datbi    = iso_data( ls_a13-datbi )
                    kbetr    = |{ ls_a13-kbetr DECIMALS = 2 }|
                    kpein    = |{ ls_a13-kpein }|
                    kmein    = ls_a13-kmein
                    konwa    = ls_a13-konwa
                    krech    = ls_a13-krech
                    desconto_max = |{ lv_pct }|
                    preco_kg = preco_kg( iv_matnr = ls_a13-matnr
                                         iv_kmein = ls_a13-kmein
                                         iv_kbetr = ls_a13-kbetr
                                         iv_kpein = ls_a13-kpein ) )
      TO <fs_lista>-itens.

  ENDLOOP.

  " ------------------------------------------------------------------
  " A912 - lista de preco x grupo de cliente x material
  " ------------------------------------------------------------------
  IF lr_kdgrp IS NOT INITIAL.

    SELECT a912~pltyp, a912~kdgrp, a912~matnr, a912~datab, a912~datbi,
           konp~kbetr, konp~kpein, konp~kmein, konp~konwa, konp~krech, konp~mxwrt
      FROM a912
      INNER JOIN konp
        ON  konp~kappl = a912~kappl
        AND konp~kfrst = a912~kfrst
        AND konp~knumh = a912~knumh
        AND konp~kschl = a912~kschl
      INTO TABLE @DATA(lt_a912)
      WHERE a912~pltyp  IN @lr_pltyp
        AND a912~kdgrp  IN @lr_kdgrp
        AND a912~datab  <= @lv_data
        AND a912~datbi  >= @lv_data
        AND konp~loevm_ko = @space.

    SORT lt_a912 BY pltyp kdgrp matnr.

    CLEAR: lv_pant, lv_kant.

    LOOP AT lt_a912 INTO DATA(ls_a12).

      " descarta combinacoes lista x grupo que nenhum cliente da carteira usa
      READ TABLE lt_par TRANSPORTING NO FIELDS
           WITH KEY pltyp = ls_a12-pltyp kdgrp = ls_a12-kdgrp BINARY SEARCH.
      IF sy-subrc <> 0.
        CONTINUE.
      ENDIF.

      IF ls_a12-pltyp <> lv_pant OR ls_a12-kdgrp <> lv_kant OR <fs_grupo> IS NOT ASSIGNED.
        APPEND VALUE #( pltyp = ls_a12-pltyp kdgrp = ls_a12-kdgrp ) TO ls_response-grupos ASSIGNING <fs_grupo>.
        lv_pant = ls_a12-pltyp.
        lv_kant = ls_a12-kdgrp.
      ENDIF.

      CLEAR lv_pct.
      lv_idpreco = |{ ls_a12-pltyp }.{ ls_a12-kdgrp }.{ ls_a12-pltyp }|.
      IF ls_a12-kbetr > 0 AND ls_a12-mxwrt > 0 AND ls_a12-mxwrt < ls_a12-kbetr
         AND line_exists( lt_138[ table_line = CONV #( lv_idpreco ) ] ).
        lv_pct = ( ls_a12-kbetr - ls_a12-mxwrt ) * 100 / ls_a12-kbetr.
      ENDIF.

      APPEND VALUE #( matnr    = |{ ls_a12-matnr ALPHA = OUT }|
                      datab    = iso_data( ls_a12-datab )
                      datbi    = iso_data( ls_a12-datbi )
                      kbetr    = |{ ls_a12-kbetr DECIMALS = 2 }|
                      kpein    = |{ ls_a12-kpein }|
                      kmein    = ls_a12-kmein
                      konwa    = ls_a12-konwa
                      krech    = ls_a12-krech
                      desconto_max = |{ lv_pct }|
                      preco_kg = preco_kg( iv_matnr = ls_a12-matnr
                                           iv_kmein = ls_a12-kmein
                                           iv_kbetr = ls_a12-kbetr
                                           iv_kpein = ls_a12-kpein ) )
        TO <fs_grupo>-itens.

    ENDLOOP.

  ENDIF.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_estoque.

  " GET /salespole/estoque?codvendedor=
  " Estoque livre (MARD-LABST) do deposito CD, nos centros usados pela carteira
  " (KNVV-VWERK das areas FERT e HAWA), para os materiais do catalogo.
  " Quantidade na unidade BASE do material (unidade_base) - pode diferir da
  " unidade de venda do item. O app cruza: cliente -> area (tipo_material) ->
  " centro -> estoque do material. Dado volatil: mostrar "gerado_em".

  TYPES: BEGIN OF ty_est,
           centro       TYPE string,
           material     TYPE string,
           quantidade   TYPE string,
           unidade_base TYPE string,
         END OF ty_est,
         tt_est TYPE STANDARD TABLE OF ty_est WITH EMPTY KEY,

         BEGIN OF ty_response,
           gerado_em TYPE string,
           deposito  TYPE string,
           estoque   TYPE tt_est,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        lr_werks    TYPE RANGE OF mard-werks,
        lt_matnr    TYPE STANDARD TABLE OF matnr WITH EMPTY KEY.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  ls_response-gerado_em = |{ sy-datum DATE = ISO }T{ sy-uzeit TIME = ISO }|.
  ls_response-deposito  = c_deposito.

  " centros da carteira
  SELECT vwerk
    FROM knvv
    INTO TABLE @DATA(lt_werks)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND vkorg IN ( @c_vkorg_1, @c_vkorg_2, @c_vkorg_h1, @c_vkorg_h2 )
      AND aufsd = @space.

  DELETE lt_werks WHERE vwerk IS INITIAL.
  SORT lt_werks.
  DELETE ADJACENT DUPLICATES FROM lt_werks.

  IF lt_werks IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  lr_werks = VALUE #( FOR a IN lt_werks ( sign = 'I' option = 'EQ' low = a-vwerk ) ).

  " materiais do catalogo
  SELECT product_id
    FROM zfv_produto
    INTO TABLE @DATA(lt_prod).

  lt_matnr = VALUE #( FOR b IN lt_prod ( CONV matnr( |{ b-product_id ALPHA = IN WIDTH = 18 }| ) ) ).
  SORT lt_matnr.
  DELETE ADJACENT DUPLICATES FROM lt_matnr.

  IF lt_matnr IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  SELECT matnr, werks, labst
    FROM mard
    INTO TABLE @DATA(lt_mard)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line
      AND werks IN @lr_werks
      AND lgort = @c_deposito.

  SELECT matnr, meins
    FROM mara
    INTO TABLE @DATA(lt_mara)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_mara BY matnr.
  SORT lt_mard BY werks matnr.

  DATA ls_mara LIKE LINE OF lt_mara.

  LOOP AT lt_mard INTO DATA(ls_mard).

    CLEAR ls_mara.
    READ TABLE lt_mara INTO ls_mara WITH KEY matnr = ls_mard-matnr BINARY SEARCH.

    APPEND VALUE #( centro       = ls_mard-werks
                    material     = |{ ls_mard-matnr ALPHA = OUT }|
                    quantidade   = |{ ls_mard-labst DECIMALS = 3 }|
                    unidade_base = ls_mara-meins ) TO ls_response-estoque.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_remessas.

  " GET /salespole/remessas?codvendedor=[&codigocli=][&dataremessade=][&dataremessaate=]
  " "O que vai ser entregue": itens da carteira com linha de remessa
  " (VBEP-EDATU) no periodo (padrao: hoje), nao recusados e ainda nao
  " concluidos (VBUP-LFSTA <> C). Uma linha por linha de remessa, sem
  " deduplicar por material (o original perdia quantidade).

  TYPES: BEGIN OF ty_rem,
           ordem                 TYPE string,
           item                  TYPE string,
           codigocli             TYPE string,
           tp_ped                TYPE string,
           data_remessa          TYPE string,
           material              TYPE string,
           denominacao           TYPE string,
           unidade_venda         TYPE string,
           quantidade_pedida     TYPE string,
           quantidade_confirmada TYPE string,
           peso                  TYPE string,
         END OF ty_rem,
         tt_rem TYPE STANDARD TABLE OF ty_rem WITH EMPTY KEY,

         BEGIN OF ty_response,
           remessas TYPE tt_rem,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        lr_auart    TYPE RANGE OF vbak-auart,
        lt_mat      TYPE STANDARD TABLE OF matnr WITH EMPTY KEY.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  DATA(lv_de)  = parse_data( mo_request->get_uri_query_parameter( 'dataremessade' ) ).
  DATA(lv_ate) = parse_data( mo_request->get_uri_query_parameter( 'dataremessaate' ) ).

  IF lv_de IS INITIAL.
    lv_de = sy-datum.
  ENDIF.
  IF lv_ate IS INITIAL.
    lv_ate = lv_de.
  ENDIF.

  IF lv_ate < lv_de.
    send_error( iv_status = 400 iv_msg = 'dataremessaate anterior a dataremessade' ).
    RETURN.
  ENDIF.

  " mesmos tipos de pedido da lista de pedidos (Z005 nao entra)
  lr_auart = VALUE #( sign = 'I' option = 'EQ'
                      ( low = 'Z001' ) ( low = 'Z010' ) ( low = 'Z011' ) ( low = 'Z034' ) ).

  " parte sempre da carteira (VBEP sozinho por data nao tem bom indice)
  SELECT p~vbeln, p~posnr, p~edatu, p~wmeng, p~bmeng,
         k~kunnr, k~auart,
         a~matnr, a~vrkme, a~ntgew
    FROM vbep AS p
    INNER JOIN vbak AS k
      ON k~vbeln = p~vbeln
    INNER JOIN vbap AS a
      ON a~vbeln = p~vbeln
     AND a~posnr = p~posnr
    INNER JOIN vbup AS u
      ON u~vbeln = p~vbeln
     AND u~posnr = p~posnr
    INTO TABLE @DATA(lt_rem)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE k~kunnr = @lt_kunnr-table_line
      AND k~auart IN @lr_auart
      AND p~edatu BETWEEN @lv_de AND @lv_ate
      AND a~abgru = @space
      AND u~lfsta <> 'C'.

  IF lt_rem IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  lt_mat = VALUE #( FOR a IN lt_rem ( a-matnr ) ).
  SORT lt_mat.
  DELETE ADJACENT DUPLICATES FROM lt_mat.

  SELECT matnr, maktx
    FROM makt
    INTO TABLE @DATA(lt_makt)
    FOR ALL ENTRIES IN @lt_mat
    WHERE matnr = @lt_mat-table_line
      AND spras = @c_lang.

  SELECT msehi, mseh3 FROM t006a INTO TABLE @DATA(lt_t006a) WHERE spras = @c_lang.

  SORT lt_makt  BY matnr.
  SORT lt_t006a BY msehi.

  DATA: ls_makt  LIKE LINE OF lt_makt,
        ls_t006a LIKE LINE OF lt_t006a.

  LOOP AT lt_rem INTO DATA(ls_r).

    CLEAR: ls_makt, ls_t006a.
    READ TABLE lt_makt  INTO ls_makt  WITH KEY matnr = ls_r-matnr BINARY SEARCH.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_r-vrkme BINARY SEARCH.

    APPEND VALUE #( ordem                 = |{ ls_r-vbeln ALPHA = OUT }|
                    item                  = |{ ls_r-posnr ALPHA = OUT }|
                    codigocli             = |{ ls_r-kunnr ALPHA = OUT }|
                    tp_ped                = ls_r-auart
                    data_remessa          = iso_data( ls_r-edatu )
                    material              = |{ ls_r-matnr ALPHA = OUT }|
                    denominacao           = ls_makt-maktx
                    unidade_venda         = ls_t006a-mseh3
                    quantidade_pedida     = |{ ls_r-wmeng DECIMALS = 3 }|
                    quantidade_confirmada = |{ ls_r-bmeng DECIMALS = 3 }|
                    peso                  = |{ ls_r-ntgew DECIMALS = 3 }| )
      TO ls_response-remessas.

  ENDLOOP.

  SORT ls_response-remessas BY data_remessa codigocli ordem item.

  send_json( is_data = ls_response ).

ENDMETHOD.

METHOD salespole_criar_pedido.

  " POST /salespole/criar_pedido
  " {
  "   "codvendedor":          "123",
  "   "codigo_interno":       "0000123",     <- sequencial gerado pelo servidor (NestJS)
  "   "codigocli":            "1048753",
  "   "dt_criacao":           "2026-10-02",  <- opcional (padrao: hoje)
  "   "dt_entrega":           "",            <- opcional (ver regra abaixo)
  "   "cond_pagamento":       "",            <- opcional (vazio: SAP assume a do cliente)
  "   "ordem_compra_cliente": "",            <- opcional (PURCH_NO_C)
  "   "endereco_entrega":     "",            <- opcional (vai no texto do cabecalho)
  "   "observacao":           "",
  "   "itens": [ { "produto": "1234", "unidade": "CX", "quantidade": "10", "preco": "" } ]
  " }
  "
  " Somente Z001. Centro (plant) e deposito (lgort) NAO sao enviados: o SAP
  " determina, como no app atual.
  "
  " DATA DE ENTREGA: proxima data de entrega do cliente (ZSDT111) estritamente
  " depois da compra. Base = a maior entre dt_criacao e hoje (pedido criado
  " offline e sincronizado depois nao pode ficar com data no passado). Se o app
  " mandar dt_entrega, ela precisa cair num dia de entrega do cliente e ser
  " posterior a base; senao 422. A data usada volta na resposta.
  "
  " SPLIT: o pedido do app vira ate 2 ordens no SAP, uma por tipo de material
  "   FERT       -> organizacao 2100/2002
  "   HAWA, ZVAR -> organizacao 2014/2015
  " (organizacao, canal e divisao vem da KNVV do cliente para cada tipo).
  " Ambas as ordens levam o MESMO codigo_interno em PURCH_NO_S (VBKD-BSTKD_E),
  " plataforma c_origem_fv em PO_METH_S.
  "
  " Idempotencia por (codigo_interno + organizacao): reenvio nao cria ordem
  " repetida; se so uma das ordens foi criada e a outra falhou, repetir o envio
  " cria apenas a que falta. O mesmo pedido nunca chega em paralelo: a API o reserva de forma
  " atomica no Postgres antes de chamar este metodo (por isso nao ha bloqueio/enqueue aqui).
  "
  " Respostas: 201 criado | 200 tudo ja existia | 4xx validacao |
  "            422 erro do SAP (resposta traz as ordens ja criadas, "parcial")

  TYPES: BEGIN OF ty_item_req,
           produto    TYPE string,
           unidade    TYPE string,
           quantidade TYPE string,
           preco      TYPE string,
         END OF ty_item_req,
         tt_item_req TYPE STANDARD TABLE OF ty_item_req WITH EMPTY KEY,

         BEGIN OF ty_req,
           codvendedor    TYPE string,
           codigocli      TYPE string,
           codigo_interno TYPE string,
           dt_criacao     TYPE string,
           dt_entrega     TYPE string,
           cond_pagamento TYPE string,
           ordem_compra_cliente TYPE string,
           endereco_entrega TYPE string,
           observacao     TYPE string,
           itens          TYPE tt_item_req,
         END OF ty_req,

         BEGIN OF ty_msg,
           tipo     TYPE string,
           mensagem TYPE string,
         END OF ty_msg,
         tt_msg TYPE STANDARD TABLE OF ty_msg WITH EMPTY KEY,

         BEGIN OF ty_ordem,
           ordem         TYPE string,
           tipo_material TYPE string,
           vkorg         TYPE string,
           duplicado     TYPE string,
         END OF ty_ordem,
         tt_ordem TYPE STANDARD TABLE OF ty_ordem WITH EMPTY KEY,

         BEGIN OF ty_resp,
           sucesso        TYPE string,
           parcial        TYPE string,
           codigo_interno TYPE string,
           dt_entrega     TYPE string,
           ordens         TYPE tt_ordem,
           mensagens      TYPE tt_msg,
         END OF ty_resp,

         BEGIN OF ty_mt,
           matnr TYPE mara-matnr,
           mtart TYPE mara-mtart,
         END OF ty_mt.

  DATA: ls_req     TYPE ty_req,
        ls_resp    TYPE ty_resp,
        lv_status  TYPE i,
        lv_vbeln   TYPE bapivbeln-vbeln,
        lv_posnr   TYPE posnr_va,
        lv_qtd     TYPE wmeng,
        lv_preco   TYPE p LENGTH 15 DECIMALS 4,
        lv_erro    TYPE abap_bool,
        lv_ok      TYPE abap_bool,
        lv_lifnr   TYPE lifnr,
        lv_dt_cri  TYPE d,
        lv_dt_ent  TYPE d,
        lv_criadas TYPE i,
        lv_novas   TYPE i,
        lt_mt      TYPE STANDARD TABLE OF ty_mt,
        lt_matnr   TYPE STANDARD TABLE OF matnr WITH EMPTY KEY,
        lt_tipos   TYPE string_table,
        ls_hdr     TYPE bapisdhd1,
        ls_hdrx    TYPE bapisdhd1x,
        lt_item    TYPE STANDARD TABLE OF bapisditm,
        lt_itemx   TYPE STANDARD TABLE OF bapisditmx,
        lt_sche    TYPE STANDARD TABLE OF bapischdl,
        lt_schex   TYPE STANDARD TABLE OF bapischdlx,
        lt_partner TYPE STANDARD TABLE OF bapiparnr,
        lt_cond    TYPE STANDARD TABLE OF bapicond,
        lt_condx   TYPE STANDARD TABLE OF bapicondx,
        lt_text    TYPE STANDARD TABLE OF bapisdtext,
        lt_return  TYPE STANDARD TABLE OF bapiret2,
        lt_dias    TYPE string_table,
        lv_base    TYPE d,
        lv_refd    TYPE d VALUE '19000101',   " uma segunda-feira
        lv_dia     TYPE string,
        lv_txt     TYPE string,
        lv_prim    TYPE abap_bool.

  " ------------------------------------------------------------------
  " Entrada e validacoes
  " ------------------------------------------------------------------
  DATA(lv_body) = mo_request->get_entity( )->get_string_data( ).
  /ui2/cl_json=>deserialize( EXPORTING json = lv_body CHANGING data = ls_req ).

  IF ls_req-codvendedor IS INITIAL OR ls_req-codigocli IS INITIAL
     OR ls_req-codigo_interno IS INITIAL OR ls_req-itens IS INITIAL.
    send_error( iv_status = 400
                iv_msg    = 'Obrigatorios: codvendedor, codigocli, codigo_interno, itens' ).
    RETURN.
  ENDIF.

  lv_dt_ent = parse_data( ls_req-dt_entrega ).
  lv_dt_cri = parse_data( ls_req-dt_criacao ).
  IF lv_dt_cri IS INITIAL.
    lv_dt_cri = sy-datum.
  ENDIF.

  DATA(lv_kunnr) = CONV kunnr( |{ ls_req-codigocli ALPHA = IN WIDTH = 10 }| ).
  DATA(lv_ref)   = CONV vbkd-bstkd_e( ls_req-codigo_interno ).

  valida_carteira( EXPORTING iv_codvendedor = ls_req-codvendedor
                             iv_kunnr       = lv_kunnr
                   IMPORTING ev_lifnr       = lv_lifnr
                             ev_ok          = lv_ok ).

  IF lv_ok = abap_false.
    send_error( iv_status = 403 iv_msg = 'Vendedor invalido ou cliente fora da carteira' ).
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Data de entrega: proxima entrega do cliente depois da compra
  " ------------------------------------------------------------------
  lt_dias = dias_entrega( lv_kunnr ).
  lv_base = COND #( WHEN lv_dt_cri > sy-datum THEN lv_dt_cri ELSE sy-datum ).

  IF ls_req-dt_entrega IS NOT INITIAL.

    " data informada: precisa ser dia de entrega do cliente e posterior a base
    DATA(lv_pedida) = parse_data( ls_req-dt_entrega ).
    lv_dia = |{ ( lv_pedida - lv_refd ) MOD 7 + 1 }|.
    READ TABLE lt_dias TRANSPORTING NO FIELDS WITH KEY table_line = lv_dia.

    IF lv_pedida IS INITIAL OR lv_pedida <= lv_base OR sy-subrc <> 0.
      send_error( iv_status = 422
                  iv_msg    = 'dt_entrega invalida: precisa ser dia de entrega do cliente e posterior a compra' ).
      RETURN.
    ENDIF.

    lv_dt_ent = lv_pedida.

  ELSE.

    lv_dt_ent = lv_base.
    DO 14 TIMES.
      lv_dt_ent = lv_dt_ent + 1.
      lv_dia = |{ ( lv_dt_ent - lv_refd ) MOD 7 + 1 }|.
      READ TABLE lt_dias TRANSPORTING NO FIELDS WITH KEY table_line = lv_dia.
      IF sy-subrc = 0.
        EXIT.
      ENDIF.
    ENDDO.

  ENDIF.

  " areas de vendas do cliente (FERT 2100/2002 e HAWA 2014/2015)
  SELECT vkorg, vtweg, spart, vwerk
    FROM knvv
    INTO TABLE @DATA(lt_vv)
    WHERE kunnr = @lv_kunnr
      AND vkorg IN ( @c_vkorg_1, @c_vkorg_2, @c_vkorg_h1, @c_vkorg_h2 )
      AND aufsd = @space.

  IF lt_vv IS INITIAL.
    send_error( iv_status = 422 iv_msg = 'Cliente sem area de vendas ativa' ).
    RETURN.
  ENDIF.

  SORT lt_vv BY vkorg vtweg spart.

  " tipo de material de cada item
  lt_matnr = VALUE #( FOR a IN ls_req-itens ( CONV matnr( |{ a-produto ALPHA = IN WIDTH = 18 }| ) ) ).
  SORT lt_matnr.
  DELETE ADJACENT DUPLICATES FROM lt_matnr.

  SELECT matnr, mtart
    FROM mara
    INTO TABLE @lt_mt
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_mt BY matnr.

  " valida itens e descobre quais tipos existem no pedido
  LOOP AT ls_req-itens INTO DATA(ls_chk).

    DATA(lv_mchk) = CONV matnr( |{ ls_chk-produto ALPHA = IN WIDTH = 18 }| ).
    READ TABLE lt_mt INTO DATA(ls_mtchk) WITH KEY matnr = lv_mchk BINARY SEARCH.

    IF sy-subrc <> 0.
      send_error( iv_status = 422 iv_msg = |Produto { ls_chk-produto } nao encontrado| ).
      RETURN.
    ENDIF.

    DATA(lv_tmat) = tipo_do_material( ls_mtchk-mtart ).

    IF lv_tmat IS INITIAL.
      send_error( iv_status = 422
                  iv_msg    = |Produto { ls_chk-produto } com tipo de material { ls_mtchk-mtart } nao suportado| ).
      RETURN.
    ENDIF.

    READ TABLE lt_tipos TRANSPORTING NO FIELDS WITH KEY table_line = lv_tmat.
    IF sy-subrc <> 0.
      APPEND lv_tmat TO lt_tipos.
    ENDIF.

  ENDLOOP.

  SORT lt_tipos.   " FERT antes de HAWA

  " cada tipo precisa de uma area de vendas do cliente
  LOOP AT lt_tipos INTO DATA(lv_tchk).

    DATA(lv_achou) = abap_false.

    LOOP AT lt_vv INTO DATA(ls_vchk).
      IF tipo_da_org( ls_vchk-vkorg ) = lv_tchk.
        lv_achou = abap_true.
        EXIT.
      ENDIF.
    ENDLOOP.

    IF lv_achou = abap_false.
      send_error( iv_status = 422 iv_msg = |Cliente sem area de vendas para itens { lv_tchk }| ).
      RETURN.
    ENDIF.

  ENDLOOP.

  " ------------------------------------------------------------------
  " Criacao das ordens (uma por tipo de material)
  " ------------------------------------------------------------------
  ls_resp-codigo_interno = ls_req-codigo_interno.
  ls_resp-dt_entrega     = iso_data( lv_dt_ent ).
  ls_resp-sucesso        = 'false'.
  ls_resp-parcial        = 'false'.

  LOOP AT lt_tipos INTO DATA(lv_tipo).

    CLEAR: ls_hdr, ls_hdrx, lt_item, lt_itemx, lt_sche, lt_schex,
           lt_partner, lt_cond, lt_condx, lt_text, lt_return,
           lv_posnr, lv_vbeln, lv_erro.

    " area deste tipo
    LOOP AT lt_vv INTO DATA(ls_vv).
      IF tipo_da_org( ls_vv-vkorg ) = lv_tipo.
        EXIT.
      ENDIF.
    ENDLOOP.

    " --- ja existe ordem deste codigo nesta organizacao? ---
    SELECT SINGLE d~vbeln
      FROM vbkd AS d
      INNER JOIN vbak AS k
        ON k~vbeln = d~vbeln
      INTO @DATA(lv_exist)
      WHERE d~bstkd_e = @lv_ref
        AND d~bsark_e = @c_origem_fv
        AND d~posnr   = '000000'
        AND k~vkorg   = @ls_vv-vkorg.

    IF sy-subrc = 0.
      APPEND VALUE #( ordem         = |{ lv_exist ALPHA = OUT }|
                      tipo_material = lv_tipo
                      vkorg         = ls_vv-vkorg
                      duplicado     = 'true' ) TO ls_resp-ordens.
      lv_criadas = lv_criadas + 1.
      CONTINUE.
    ENDIF.

    " --- cabecalho ---
    ls_hdrx-updateflag = 'I'.

    ls_hdr-doc_type   = 'Z001'.       ls_hdrx-doc_type   = 'X'.
    ls_hdr-sales_org  = ls_vv-vkorg.  ls_hdrx-sales_org  = 'X'.
    ls_hdr-distr_chan = ls_vv-vtweg.  ls_hdrx-distr_chan = 'X'.
    ls_hdr-division   = ls_vv-spart.  ls_hdrx-division   = 'X'.
    ls_hdr-purch_date = lv_dt_cri.    ls_hdrx-purch_date = 'X'.
    ls_hdr-price_date = lv_dt_cri.    ls_hdrx-price_date = 'X'.
    ls_hdr-req_date_h = lv_dt_ent.    ls_hdrx-req_date_h = 'X'.
    ls_hdr-po_meth_s  = c_origem_fv.  ls_hdrx-po_meth_s  = 'X'.
    ls_hdr-purch_no_s = lv_ref.       ls_hdrx-purch_no_s = 'X'.

    " condicao de pagamento: so envia se o vendedor escolheu; senao o SAP assume a do cliente
    IF ls_req-cond_pagamento IS NOT INITIAL.
      ls_hdr-pmnttrms  = ls_req-cond_pagamento.
      ls_hdrx-pmnttrms = 'X'.
    ENDIF.

    " forma de pagamento: vem do cadastro (KNB1-ZWELS) da empresa da organizacao de vendas
    SELECT SINGLE bukrs
      FROM tvko
      INTO @DATA(lv_bukrs)
      WHERE vkorg = @ls_vv-vkorg.

    SELECT SINGLE zwels
      FROM knb1
      INTO @DATA(lv_zwels)
      WHERE kunnr = @lv_kunnr
        AND bukrs = @lv_bukrs.

    IF sy-subrc = 0 AND lv_zwels IS NOT INITIAL.
      ls_hdr-pymt_meth  = lv_zwels.
      ls_hdrx-pymt_meth = 'X'.
    ENDIF.

    " numero da ordem de compra do cliente
    IF ls_req-ordem_compra_cliente IS NOT INITIAL.
      ls_hdr-purch_no_c  = ls_req-ordem_compra_cliente.
      ls_hdrx-purch_no_c = 'X'.
    ENDIF.

    " --- parceiros: cliente (AG) e vendedor (ZV) ---
    APPEND VALUE #( partn_role = 'AG' partn_numb = lv_kunnr ) TO lt_partner.
    APPEND VALUE #( partn_role = 'ZV' partn_numb = lv_lifnr ) TO lt_partner.

    " --- itens deste tipo ---
    LOOP AT ls_req-itens INTO DATA(ls_it).

      DATA(lv_matnr) = CONV matnr( |{ ls_it-produto ALPHA = IN WIDTH = 18 }| ).
      READ TABLE lt_mt INTO DATA(ls_mt) WITH KEY matnr = lv_matnr BINARY SEARCH.

      IF tipo_do_material( ls_mt-mtart ) <> lv_tipo.
        CONTINUE.
      ENDIF.

      CLEAR: lv_qtd, lv_preco.

      TRY.
          lv_qtd = ls_it-quantidade.
          IF ls_it-preco IS NOT INITIAL.
            lv_preco = ls_it-preco.
          ENDIF.
        CATCH cx_sy_conversion_error.
          lv_erro = abap_true.
          APPEND VALUE #( tipo = 'E' mensagem = |Quantidade/preco invalidos no produto { ls_it-produto }| )
            TO ls_resp-mensagens.
          EXIT.
      ENDTRY.

      IF lv_qtd <= 0.
        lv_erro = abap_true.
        APPEND VALUE #( tipo = 'E' mensagem = |Quantidade deve ser maior que zero no produto { ls_it-produto }| )
          TO ls_resp-mensagens.
        EXIT.
      ENDIF.

      lv_posnr = lv_posnr + 10.

      " unidade UN sem conversao na MARM vira PEC (regra do app atual)
      DATA(lv_unid) = ls_it-unidade.
      IF lv_unid = 'UN'.
        SELECT SINGLE meinh
          FROM marm
          INTO @DATA(lv_meinh)
          WHERE matnr = @lv_matnr
            AND meinh = 'UN'.
        IF sy-subrc <> 0.
          lv_unid = 'PEC'.
        ENDIF.
      ENDIF.

      " plant e store_loc ficam vazios: o SAP determina (deposito CD so serve p/ consulta de estoque)
      APPEND VALUE #( itm_number = lv_posnr material = lv_matnr sales_unit = lv_unid ) TO lt_item.
      APPEND VALUE #( itm_number = lv_posnr material = 'X' sales_unit = 'X' updateflag = 'I' ) TO lt_itemx.

      APPEND VALUE #( itm_number = lv_posnr req_date = lv_dt_ent req_qty = lv_qtd ) TO lt_sche.
      APPEND VALUE #( itm_number = lv_posnr req_date = 'X' req_qty = 'X' updateflag = 'I' ) TO lt_schex.

      " ZPR2 = preco por CAIXA que o vendedor fechou (como no app oficial: KONV 76,59 por 1 CX).
      " Sem preco informado, o SAP usa a lista (ZPRL -> ZPRT).
      IF lv_preco > 0.
        APPEND VALUE #( itm_number = lv_posnr
                        cond_type  = c_cond_preco
                        cond_value = lv_preco / c_div_preco ) TO lt_cond.
        APPEND VALUE #( itm_number = lv_posnr
                        cond_type  = c_cond_preco
                        cond_value = 'X'
                        updateflag = 'I' ) TO lt_condx.
      ENDIF.

    ENDLOOP.

    IF lv_erro = abap_true.
      EXIT.
    ENDIF.

    " --- texto do pedido: codigo, endereco de entrega e observacao (linhas de 132) ---
    lv_txt  = |FV { ls_req-codigo_interno } { ls_req-endereco_entrega } { ls_req-observacao }|.
    lv_prim = abap_true.

    WHILE lv_txt IS NOT INITIAL.
      APPEND VALUE #( text_id    = '0001'
                      langu      = 'P'
                      langu_iso  = 'PT'
                      format_col = COND #( WHEN lv_prim = abap_true THEN '*' ELSE '=' )
                      text_line  = substring( val = lv_txt len = nmin( val1 = 132 val2 = strlen( lv_txt ) ) ) )
        TO lt_text.
      lv_prim = abap_false.
      lv_txt  = COND #( WHEN strlen( lv_txt ) > 132 THEN substring( val = lv_txt off = 132 ) ELSE `` ).
    ENDWHILE.

    CALL FUNCTION 'BAPI_SALESORDER_CREATEFROMDAT2'
      EXPORTING
        order_header_in      = ls_hdr
        order_header_inx     = ls_hdrx
      IMPORTING
        salesdocument        = lv_vbeln
      TABLES
        return               = lt_return
        order_items_in       = lt_item
        order_items_inx      = lt_itemx
        order_schedules_in   = lt_sche
        order_schedules_inx  = lt_schex
        order_partners       = lt_partner
        order_conditions_in  = lt_cond
        order_conditions_inx = lt_condx
        order_text           = lt_text.

    LOOP AT lt_return INTO DATA(ls_ret) WHERE type CA 'EAW'.
      APPEND VALUE #( tipo = ls_ret-type mensagem = |[{ lv_tipo }] { ls_ret-message }| ) TO ls_resp-mensagens.
      IF ls_ret-type CA 'EA'.
        lv_erro = abap_true.
      ENDIF.
    ENDLOOP.

    IF lv_vbeln IS NOT INITIAL AND lv_erro = abap_false.

      CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
        EXPORTING
          wait = 'X'.

      APPEND VALUE #( ordem         = |{ lv_vbeln ALPHA = OUT }|
                      tipo_material = lv_tipo
                      vkorg         = ls_vv-vkorg
                      duplicado     = 'false' ) TO ls_resp-ordens.
      lv_criadas = lv_criadas + 1.
      lv_novas   = lv_novas + 1.

    ELSE.

      CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.

      IF ls_resp-mensagens IS INITIAL.
        APPEND VALUE #( tipo = 'E' mensagem = |[{ lv_tipo }] Falha ao criar pedido no SAP| ) TO ls_resp-mensagens.
      ENDIF.
      lv_erro = abap_true.
      EXIT.

    ENDIF.

  ENDLOOP.

  IF lv_erro = abap_true.
    lv_status = 422.
    IF lv_criadas > 0.
      ls_resp-parcial = 'true'.
    ENDIF.
  ELSE.
    ls_resp-sucesso = 'true'.
    lv_status       = COND #( WHEN lv_novas > 0 THEN 201 ELSE 200 ).
  ENDIF.

  send_json( is_data = ls_resp iv_status = lv_status ).

ENDMETHOD.

METHOD salespole_cancelar_pedido.

  " POST /salespole/cancelar_pedido   { "codvendedor": "123", "ordem": "5631707" }
  " Recusa (motivo c_motivo_cancel) todos os itens ainda nao recusados.
  " So cancela ordem da carteira do vendedor e que ainda nao foi faturada.
  " Respostas: 200 cancelado | 403 | 404 | 409 faturada/ja cancelada | 422 erro SAP

  TYPES: BEGIN OF ty_req,
           codvendedor TYPE string,
           ordem       TYPE string,
         END OF ty_req,

         BEGIN OF ty_msg,
           tipo     TYPE string,
           mensagem TYPE string,
         END OF ty_msg,
         tt_msg TYPE STANDARD TABLE OF ty_msg WITH EMPTY KEY,

         BEGIN OF ty_resp,
           cancelado TYPE string,
           ordem     TYPE string,
           mensagens TYPE tt_msg,
         END OF ty_resp.

  DATA: ls_req    TYPE ty_req,
        ls_resp   TYPE ty_resp,
        ls_hdrx   TYPE bapisdh1x,
        lt_item   TYPE STANDARD TABLE OF bapisditm,
        lt_itemx  TYPE STANDARD TABLE OF bapisditmx,
        lt_return TYPE STANDARD TABLE OF bapiret2,
        lv_erro   TYPE abap_bool,
        lv_ok     TYPE abap_bool,
        lv_lifnr  TYPE lifnr.

  DATA(lv_body) = mo_request->get_entity( )->get_string_data( ).
  /ui2/cl_json=>deserialize( EXPORTING json = lv_body CHANGING data = ls_req ).

  IF ls_req-codvendedor IS INITIAL OR ls_req-ordem IS INITIAL.
    send_error( iv_status = 400 iv_msg = 'Obrigatorios: codvendedor, ordem' ).
    RETURN.
  ENDIF.

  DATA(lv_vbeln) = CONV vbak-vbeln( |{ ls_req-ordem ALPHA = IN WIDTH = 10 }| ).

  SELECT SINGLE kunnr
    FROM vbak
    INTO @DATA(lv_kunnr)
    WHERE vbeln = @lv_vbeln.

  IF sy-subrc <> 0.
    send_error( iv_status = 404 iv_msg = 'Ordem nao encontrada' ).
    RETURN.
  ENDIF.

  valida_carteira( EXPORTING iv_codvendedor = ls_req-codvendedor
                             iv_kunnr       = lv_kunnr
                   IMPORTING ev_lifnr       = lv_lifnr
                             ev_ok          = lv_ok ).

  IF lv_ok = abap_false.
    send_error( iv_status = 403 iv_msg = 'Ordem fora da carteira do vendedor' ).
    RETURN.
  ENDIF.

  " ja faturada (fatura nao estornada)?
  SELECT SINGLE f~vbeln
    FROM vbfa AS f
    INNER JOIN vbrk AS r
      ON r~vbeln = f~vbeln
    INTO @DATA(lv_fatura)
    WHERE f~vbelv   = @lv_vbeln
      AND f~vbtyp_n = 'M'
      AND r~fksto   = @space.

  IF sy-subrc = 0.
    send_error( iv_status = 409 iv_msg = 'Ordem ja faturada, nao pode ser cancelada' ).
    RETURN.
  ENDIF.

  SELECT posnr
    FROM vbap
    INTO TABLE @DATA(lt_vbap)
    WHERE vbeln = @lv_vbeln
      AND abgru = @space.

  IF lt_vbap IS INITIAL.
    send_error( iv_status = 409 iv_msg = 'Ordem ja cancelada' ).
    RETURN.
  ENDIF.

  ls_hdrx-updateflag = 'U'.

  LOOP AT lt_vbap INTO DATA(ls_vbap).
    APPEND VALUE #( itm_number = ls_vbap-posnr reason_rej = c_motivo_cancel ) TO lt_item.
    APPEND VALUE #( itm_number = ls_vbap-posnr updateflag = 'U' reason_rej = 'X' ) TO lt_itemx.
  ENDLOOP.

  CALL FUNCTION 'BAPI_SALESORDER_CHANGE'
    EXPORTING
      salesdocument    = lv_vbeln
      order_header_inx = ls_hdrx
    TABLES
      return           = lt_return
      order_item_in    = lt_item
      order_item_inx   = lt_itemx.

  " o original olhava sy-subrc; quem manda e a tabela RETURN
  LOOP AT lt_return INTO DATA(ls_ret) WHERE type CA 'EAW'.
    APPEND VALUE #( tipo = ls_ret-type mensagem = ls_ret-message ) TO ls_resp-mensagens.
    IF ls_ret-type CA 'EA'.
      lv_erro = abap_true.
    ENDIF.
  ENDLOOP.

  ls_resp-ordem = |{ lv_vbeln ALPHA = OUT }|.

  IF lv_erro = abap_true.

    CALL FUNCTION 'BAPI_TRANSACTION_ROLLBACK'.

    ls_resp-cancelado = 'false'.
    send_json( is_data = ls_resp iv_status = 422 ).

  ELSE.

    CALL FUNCTION 'BAPI_TRANSACTION_COMMIT'
      EXPORTING
        wait = 'X'.

    " atualiza a ZSDT139 como o original fazia
    DATA(lr_doc) = VALUE rseloption( ( sign = 'I' option = 'EQ' low = lv_vbeln ) ).
    SUBMIT zsdr124
      WITH s_doc IN lr_doc
      AND RETURN.

    ls_resp-cancelado = 'true'.
    send_json( is_data = ls_resp ).

  ENDIF.

ENDMETHOD.

ENDCLASS.
