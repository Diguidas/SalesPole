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
