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
