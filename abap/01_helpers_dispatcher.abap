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
