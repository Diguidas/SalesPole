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
