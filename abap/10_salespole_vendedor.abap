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
