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
