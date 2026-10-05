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
