METHOD salespole_pedidos.

  " GET /salespole/pedidos?codvendedor=[&codigocli=][&datain=][&datafim=][&dtentrega=]
  "   - sem filtros de data: ultimos 90 dias de criacao
  "   - dtentrega: pedidos da carteira com data de remessa naquele dia
  "     (qualquer data de criacao) -> tela "remessas de hoje"
  " Sem SUBMIT zsdr124 (a ZSDT139 deve ser alimentada por job).
  " pedido_externo / plataforma permitem ao app reconhecer o pedido que ele
  " mesmo criou (codigo interno gravado em BSTKD_E).

  TYPES: BEGIN OF ty_nota,
           nota_fiscal TYPE string,
           serie       TYPE string,
           danfe_url   TYPE string,
           xml_url     TYPE string,
           boleto_url  TYPE string,
         END OF ty_nota,
         tt_nota TYPE STANDARD TABLE OF ty_nota WITH EMPTY KEY,

         BEGIN OF ty_pedido,
           ordem          TYPE string,
           codigocli      TYPE string,
           tp_ped         TYPE string,
           dt_criacao     TYPE string,
           dt_entrega     TYPE string,
           valor          TYPE string,
           status         TYPE string,
           refaturado     TYPE string,
           pedido_externo TYPE string,
           plataforma     TYPE string,
           notas          TYPE tt_nota,
         END OF ty_pedido,
         tt_pedido TYPE STANDARD TABLE OF ty_pedido WITH EMPTY KEY,

         BEGIN OF ty_response,
           pedidos TYPE tt_pedido,
         END OF ty_response,

         BEGIN OF ty_nk,
           ordem  TYPE vbak-vbeln,
           fatura TYPE vbrk-vbeln,
           nfenum TYPE j_1bnfdoc-nfenum,
           series TYPE j_1bnfdoc-series,
         END OF ty_nk.

  DATA: ls_response TYPE ty_response,
        ls_pedido   TYPE ty_pedido,
        ls_nota     TYPE ty_nota,
        lt_nk       TYPE STANDARD TABLE OF ty_nk,
        lt_docnum   TYPE STANDARD TABLE OF j_1bnflin-docnum WITH EMPTY KEY,
        lt_refkey   TYPE STANDARD TABLE OF j_1bnflin-refkey WITH EMPTY KEY,
        lv_refkey   TYPE j_1bnflin-refkey,
        ls_nk       TYPE ty_nk,
        lr_auart    TYPE RANGE OF vbak-auart,
        lr_erdat    TYPE RANGE OF vbak-erdat,
        lr_vdatu    TYPE RANGE OF vbak-vdatu,
        lv_nf       TYPE string,
        lv_serie    TYPE string,
        lv_tem_fat  TYPE abap_bool,
        lv_tem_nfe  TYPE abap_bool.

  resolve_clientes( IMPORTING et_kunnr = DATA(lt_kunnr) ).

  IF lt_kunnr IS INITIAL.
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Filtros
  " ------------------------------------------------------------------
  DATA(lv_ini) = parse_data( mo_request->get_uri_query_parameter( 'datain' ) ).
  DATA(lv_fim) = parse_data( mo_request->get_uri_query_parameter( 'datafim' ) ).
  DATA(lv_ent) = parse_data( mo_request->get_uri_query_parameter( 'dtentrega' ) ).

  IF lv_ini IS INITIAL.
    lv_ini = sy-datum - 90.
  ENDIF.
  IF lv_fim IS INITIAL.
    lv_fim = sy-datum.
  ENDIF.

  IF lv_ent IS NOT INITIAL.
    lr_vdatu = VALUE #( ( sign = 'I' option = 'EQ' low = lv_ent ) ).
  ELSE.
    lr_erdat = VALUE #( ( sign = 'I' option = 'BT' low = lv_ini high = lv_fim ) ).
  ENDIF.

  lr_auart = VALUE #( sign = 'I' option = 'EQ'
                      ( low = 'Z001' ) ( low = 'Z010' ) ( low = 'Z011' ) ( low = 'Z034' ) ).

  " ------------------------------------------------------------------
  " Leituras em lote
  " ------------------------------------------------------------------
  SELECT vbeln, kunnr, auart, erdat, vdatu, netwr
    FROM vbak
    INTO TABLE @DATA(lt_vbak)
    FOR ALL ENTRIES IN @lt_kunnr
    WHERE kunnr = @lt_kunnr-table_line
      AND erdat IN @lr_erdat
      AND vdatu IN @lr_vdatu
      AND auart IN @lr_auart.

  IF lt_vbak IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  SORT lt_vbak BY vbeln.

  SELECT vbeln, lfstk, abstk, cmgst
    FROM vbuk
    INTO TABLE @DATA(lt_vbuk)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  " cabecalho comercial: BSTKD_E / BSARK_E = referencia e plataforma de origem
  SELECT vbeln, bstkd, bstkd_e, bsark_e
    FROM vbkd
    INTO TABLE @DATA(lt_vbkd)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln
      AND posnr = '000000'.

  SELECT vbeln, refaturamento
    FROM zsdt139
    INTO TABLE @DATA(lt_z139)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbeln = @lt_vbak-vbeln.

  " faturas (ordem -> fatura), ignorando faturas estornadas
  SELECT vbeln, vbelv
    FROM vbfa
    INTO TABLE @DATA(lt_vbfa)
    FOR ALL ENTRIES IN @lt_vbak
    WHERE vbelv = @lt_vbak-vbeln
      AND vbtyp_n = 'M'.

  IF lt_vbfa IS NOT INITIAL.
    SELECT vbeln, xblnr
      FROM vbrk
      INTO TABLE @DATA(lt_vbrk)
      FOR ALL ENTRIES IN @lt_vbfa
      WHERE vbeln = @lt_vbfa-vbeln
        AND fksto = @space.
  ENDIF.

  SORT lt_vbuk BY vbeln.
  SORT lt_vbkd BY vbeln.
  SORT lt_z139 BY vbeln.
  SORT lt_vbrk BY vbeln.

  LOOP AT lt_vbfa INTO DATA(ls_vf).

    READ TABLE lt_vbrk INTO DATA(ls_vr) WITH KEY vbeln = ls_vf-vbeln BINARY SEARCH.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.

    READ TABLE lt_vbak INTO DATA(ls_vk) WITH KEY vbeln = ls_vf-vbelv BINARY SEARCH.
    IF sy-subrc <> 0.
      CONTINUE.
    ENDIF.

    CLEAR: ls_nk, lv_nf, lv_serie.
    SPLIT ls_vr-xblnr AT '-' INTO lv_nf lv_serie.

    ls_nk-ordem  = ls_vf-vbelv.
    ls_nk-fatura = ls_vf-vbeln.
    ls_nk-nfenum = lv_nf.
    ls_nk-series = lv_serie.
    APPEND ls_nk TO lt_nk.

  ENDLOOP.

  " documento fiscal pela chave de referencia da NF (J_1BNFLIN-REFKEY = fatura).
  " A consulta direta a J_1BNFDOC por NFENUM/SERIES/PARID varre a tabela inteira.
  " FOR ALL ENTRIES exige mesmo tipo/comprimento: REFKEY e CHAR20, VBELN e CHAR10
  lt_refkey = VALUE #( FOR f IN lt_vbrk ( CONV j_1bnflin-refkey( f-vbeln ) ) ).

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
    SELECT docnum, xml_url, danfe_url, boleto_url
      FROM zsdt_savedocs
      INTO TABLE @DATA(lt_sav)
      FOR ALL ENTRIES IN @lt_docnum
      WHERE docnum = @lt_docnum-table_line.
  ENDIF.

  SORT lt_sav BY docnum.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  DATA: ls_vbuk LIKE LINE OF lt_vbuk,
        ls_vbkd LIKE LINE OF lt_vbkd,
        ls_z139 LIKE LINE OF lt_z139,
        ls_lin  LIKE LINE OF lt_lin,
        ls_sav  LIKE LINE OF lt_sav.

  LOOP AT lt_vbak INTO DATA(ls_vbak).

    CLEAR: ls_pedido, ls_vbuk, ls_vbkd, ls_z139, lv_tem_fat, lv_tem_nfe.

    ls_pedido-ordem      = |{ ls_vbak-vbeln ALPHA = OUT }|.
    ls_pedido-codigocli  = |{ ls_vbak-kunnr ALPHA = OUT }|.
    ls_pedido-tp_ped     = ls_vbak-auart.
    ls_pedido-dt_criacao = iso_data( ls_vbak-erdat ).
    ls_pedido-dt_entrega = iso_data( ls_vbak-vdatu ).
    " valor liquido do pedido (VBAK-NETWR). O original usava ZSDT139-NETWR.
    ls_pedido-valor      = |{ ls_vbak-netwr DECIMALS = 2 }|.

    READ TABLE lt_vbuk INTO ls_vbuk WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.
    READ TABLE lt_vbkd INTO ls_vbkd WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.
    READ TABLE lt_z139 INTO ls_z139 WITH KEY vbeln = ls_vbak-vbeln BINARY SEARCH.

    ls_pedido-refaturado     = ls_z139-refaturamento.
    ls_pedido-pedido_externo = COND #( WHEN ls_vbkd-bstkd IS NOT INITIAL THEN ls_vbkd-bstkd ELSE ls_vbkd-bstkd_e ).
    ls_pedido-plataforma     = ls_vbkd-bsark_e.

    " --- notas fiscais ---
    LOOP AT lt_nk INTO ls_nk WHERE ordem = ls_vbak-vbeln.

      CLEAR: ls_nota, ls_lin, ls_sav.
      lv_tem_fat = abap_true.

      ls_nota-nota_fiscal = ls_nk-nfenum.
      ls_nota-serie       = ls_nk-series.

      IF ls_nk-nfenum IS NOT INITIAL.
        lv_tem_nfe = abap_true.
      ENDIF.

      lv_refkey = ls_nk-fatura.
      READ TABLE lt_lin INTO ls_lin WITH KEY refkey = lv_refkey BINARY SEARCH.
      IF sy-subrc = 0.
        READ TABLE lt_sav INTO ls_sav WITH KEY docnum = ls_lin-docnum BINARY SEARCH.
        IF sy-subrc = 0.
          ls_nota-danfe_url  = ls_sav-danfe_url.
          ls_nota-xml_url    = ls_sav-xml_url.
          ls_nota-boleto_url = ls_sav-boleto_url.
        ENDIF.
      ENDIF.

      APPEND ls_nota TO ls_pedido-notas.

    ENDLOOP.

    " --- status (mesma regra do original; antes o ramo "sem fatura" usava
    "     VBUK de outra iteracao) ---
    IF lv_tem_fat = abap_true.

      IF ls_vbuk-lfstk = 'C'.
        ls_pedido-status = 'Faturado'.
      ELSEIF ls_vbuk-lfstk = 'B' AND lv_tem_nfe = abap_true.
        ls_pedido-status = 'Faturado Parcial'.
      ELSE.
        ls_pedido-status = 'A Faturar'.
      ENDIF.

    ELSE.

      IF ls_vbuk-abstk = 'C'.
        ls_pedido-status = 'Recusado'.
      ELSEIF ls_vbuk-cmgst = 'B'.
        ls_pedido-status = 'Aguardando Liberação'.
      ELSE.
        ls_pedido-status = 'Liberado para faturamento'.
      ENDIF.

    ENDIF.

    APPEND ls_pedido TO ls_response-pedidos.

  ENDLOOP.

  SORT ls_response-pedidos BY dt_criacao DESCENDING ordem DESCENDING.

  send_json( is_data = ls_response ).

ENDMETHOD.
