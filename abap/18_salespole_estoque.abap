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
