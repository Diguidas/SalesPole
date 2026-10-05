METHOD salespole_produtos.

  " GET /salespole/produtos
  " Cadastro de produtos (sem preco: preco vem de /salespole/precos).
  " Unidades: o codigo INTERNO (MARM-MEINH, ex.: KI) e o que vai no pedido; o TEXTO (T006A, ex.: CX)
  " e o que o vendedor le. A caixa e a unidade da MARM cujo texto e 'CX' (c_texto_caixa); sem ela,
  " unidade_venda = unidade base.
  " conversoes = unidades alternativas da MARM, com o fator em UNIDADES BASE por 1 unidade
  " (UMREZ/UMREN). O app usa isso para o preco por caixa, o estoque em caixas e o minimo/multiplo.
  " ZFV_PRODUTO guarda price_table/price na mesma linha, entao deduplicamos
  " por product_id.

  TYPES: BEGIN OF ty_estoque,
           disponivelecommerce TYPE string,
           prazoentregadias    TYPE string,
         END OF ty_estoque,

         BEGIN OF ty_peso,
           pesoliquido TYPE string,
           pesobruto   TYPE string,
         END OF ty_peso,

         BEGIN OF ty_pedido,
           quantidademinima TYPE string,
           multiplo         TYPE string,
         END OF ty_pedido,

         BEGIN OF ty_classificacao,
           marca     TYPE string,
           categoria TYPE string,
           linha     TYPE string,
           grupo     TYPE string,
         END OF ty_classificacao,

         BEGIN OF ty_conv,
           unidade TYPE string,   " codigo interno (MARM-MEINH)
           texto   TYPE string,   " texto externo (T006A-MSEH3)
           fator   TYPE string,   " unidades base por 1 desta unidade
         END OF ty_conv,
         tt_conv TYPE STANDARD TABLE OF ty_conv WITH EMPTY KEY,

         BEGIN OF ty_produto,
           codigoproduto TYPE string,
           descricao     TYPE string,
           tipo          TYPE string,
           unidade       TYPE string,
           ean           TYPE string,
           ncm           TYPE string,
           validade      TYPE string,
           tipo_material TYPE string,   " FERT | HAWA (define em qual pedido SAP o item vai)
           unidade_base  TYPE string,   " MARA-MEINS (codigo interno)
           unidade_base_texto  TYPE string,
           unidade_venda TYPE string,   " unidade em que o pedido e feito (caixa), codigo interno
           unidade_venda_texto TYPE string,
           conversoes    TYPE tt_conv,
           estoque       TYPE ty_estoque,
           peso          TYPE ty_peso,
           pedido        TYPE ty_pedido,
           classificacao TYPE ty_classificacao,
         END OF ty_produto,
         tt_produto TYPE STANDARD TABLE OF ty_produto WITH EMPTY KEY,

         BEGIN OF ty_response,
           produtos TYPE tt_produto,
         END OF ty_response.

  DATA: ls_response TYPE ty_response,
        ls_produto  TYPE ty_produto,
        lt_matnr    TYPE STANDARD TABLE OF matnr WITH EMPTY KEY.

  SELECT *
    FROM zfv_produto
    INTO TABLE @DATA(lt_prod).

  SORT lt_prod BY product_id.
  DELETE ADJACENT DUPLICATES FROM lt_prod COMPARING product_id.

  IF lt_prod IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  lt_matnr = VALUE #( FOR a IN lt_prod ( CONV matnr( |{ a-product_id ALPHA = IN WIDTH = 18 }| ) ) ).
  SORT lt_matnr.
  DELETE ADJACENT DUPLICATES FROM lt_matnr.

  SELECT matnr, mhdhb, normt, mtart, meins
    FROM mara
    INTO TABLE @DATA(lt_mara)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_mara BY matnr.

  " conversoes de unidade (em lote, uma leitura so)
  SELECT matnr, meinh, umrez, umren
    FROM marm
    INTO TABLE @DATA(lt_marm)
    FOR ALL ENTRIES IN @lt_matnr
    WHERE matnr = @lt_matnr-table_line.

  SORT lt_marm BY matnr meinh.

  " textos externos das unidades (tabela pequena, lida inteira)
  SELECT msehi, mseh3
    FROM t006a
    INTO TABLE @DATA(lt_t006a)
    WHERE spras = @c_lang.

  SORT lt_t006a BY msehi.

  DATA: ls_mara  LIKE LINE OF lt_mara,
        ls_t006a LIKE LINE OF lt_t006a,
        lv_caixa TYPE marm-meinh.

  LOOP AT lt_prod INTO DATA(wa_prod).

    CLEAR: ls_produto, ls_mara.

    DATA(lv_matnr) = CONV matnr( |{ wa_prod-product_id ALPHA = IN WIDTH = 18 }| ).
    READ TABLE lt_mara INTO ls_mara WITH KEY matnr = lv_matnr BINARY SEARCH.

    ls_produto-codigoproduto = |{ lv_matnr ALPHA = OUT }|.
    ls_produto-descricao     = wa_prod-product_desc.
    ls_produto-tipo          = wa_prod-type.
    ls_produto-unidade       = wa_prod-unit.
    ls_produto-ean           = wa_prod-ean.
    ls_produto-ncm           = wa_prod-ncm.
    ls_produto-validade      = ls_mara-mhdhb.
    ls_produto-tipo_material = ls_mara-mtart.
    ls_produto-unidade_base = ls_mara-meins.

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_mara-meins BINARY SEARCH.
    ls_produto-unidade_base_texto = ls_t006a-mseh3.

    " conversoes da MARM com o texto de cada unidade; a CAIXA e a que tem o texto 'CX'
    CLEAR lv_caixa.
    LOOP AT lt_marm INTO DATA(ls_marm) WHERE matnr = lv_matnr.

      IF ls_marm-umren = 0.
        CONTINUE.
      ENDIF.

      CLEAR ls_t006a.
      READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_marm-meinh BINARY SEARCH.

      APPEND VALUE #( unidade = ls_marm-meinh
                      texto   = ls_t006a-mseh3
                      fator   = |{ CONV decfloat34( ls_marm-umrez ) / ls_marm-umren DECIMALS = 6 }| )
        TO ls_produto-conversoes.

      IF lv_caixa IS INITIAL AND ls_t006a-mseh3 = c_texto_caixa.
        lv_caixa = ls_marm-meinh.
      ENDIF.

    ENDLOOP.

    " o pedido e feito em CAIXA; sem unidade de caixa na MARM usa a unidade base
    ls_produto-unidade_venda = COND #( WHEN lv_caixa IS NOT INITIAL THEN lv_caixa ELSE ls_mara-meins ).

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_produto-unidade_venda BINARY SEARCH.
    ls_produto-unidade_venda_texto = ls_t006a-mseh3.

    ls_produto-estoque-disponivelecommerce = wa_prod-allow_ecommerce.
    ls_produto-estoque-prazoentregadias    = wa_prod-prevision_days_delivery.
    ls_produto-peso-pesoliquido            = wa_prod-weight_net.
    ls_produto-peso-pesobruto              = wa_prod-weight_gross.
    ls_produto-pedido-quantidademinima     = wa_prod-minimum.
    ls_produto-pedido-multiplo             = wa_prod-mutiple.

    ls_produto-classificacao-marca     = ls_mara-normt.
    ls_produto-classificacao-categoria = wa_prod-category.
    ls_produto-classificacao-linha     = wa_prod-linha.
    ls_produto-classificacao-grupo     = wa_prod-grupo.

    APPEND ls_produto TO ls_response-produtos.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.
