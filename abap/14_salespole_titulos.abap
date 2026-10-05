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
