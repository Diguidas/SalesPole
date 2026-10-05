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
