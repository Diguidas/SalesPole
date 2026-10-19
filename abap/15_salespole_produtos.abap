METHOD salespole_produtos.

  " GET /salespole/produtos
  " Cadastro de produtos lido DIRETO do SAP (MARA, MAKT, MARC, MARM, T006A, ZSDT129-132, TVARVC),
  " sem passar pela tabela intermediaria ZFV_PRODUTO.
  " Sem preco (vem de /salespole/precos) e sem estoque (vem de /salespole/estoque).
  " Unidades: o codigo INTERNO (MARM-MEINH, ex.: KI) e o que vai no pedido; o TEXTO (T006A, ex.: CX)
  " e o que o vendedor le. A caixa e a unidade da MARM cujo texto e 'CX' (c_texto_caixa); sem ela,
  " unidade_venda = unidade base.
  " conversoes = unidades alternativas da MARM, com o fator em UNIDADES BASE por 1 unidade
  " (UMREZ/UMREN). O app usa isso para o preco por caixa, o estoque em caixas e o minimo/multiplo.
  " pedido.multiplo = fator da unidade de venda (1 caixa em unidade base), como o get_fv_produto fazia.

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
           marca     TYPE string,        " MARA-NORMT (texto: a marca nao tem ID)
           categoria TYPE string,
           linha     TYPE string,
           grupo     TYPE string,
           " IDs do cadastro (ZSDT129 -> ZSDT130/131/132): as regras de incentivo do painel usam o ID
           categoria_id TYPE string,
           linha_id     TYPE string,
           grupo_id     TYPE string,
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
        lv_caixa    TYPE marm-meinh,
        lv_ncm      TYPE marc-steuc,
        lv_ladgr    TYPE marc-ladgr,
        lv_codigo   TYPE string,
        lv_fator    TYPE decfloat34.

  " ------------------------------------------------------------------
  " Universo: materiais vendaveis (mesmos filtros do get_fv_produto:
  " tipo FERT/HAWA/ZVAR e sem bloqueio de status geral MSTAV), sem marca de eliminacao.
  " AJUSTAR: se o seu gr_mtart do get_fv_produto tiver outros tipos, inclua aqui.
  " ------------------------------------------------------------------
  SELECT matnr, mtart, meins, ean11, mhdhb, normt, ntgew, brgew
    FROM mara
    INTO TABLE @DATA(lt_mara)
    WHERE mtart IN ( @c_mtart_fert, @c_mtart_hawa, @c_mtart_zvar )
      AND mstav = @space
      AND lvorm = @space.

  IF lt_mara IS INITIAL.
    send_json( is_data = ls_response ).
    RETURN.
  ENDIF.

  " ------------------------------------------------------------------
  " Leituras em lote
  " ------------------------------------------------------------------
  SELECT matnr, maktx
    FROM makt
    INTO TABLE @DATA(lt_makt)
    FOR ALL ENTRIES IN @lt_mara
    WHERE matnr = @lt_mara-matnr
      AND spras = @c_lang.

  " conversoes de unidade
  SELECT matnr, meinh, umrez, umren
    FROM marm
    INTO TABLE @DATA(lt_marm)
    FOR ALL ENTRIES IN @lt_mara
    WHERE matnr = @lt_mara-matnr.

  " NCM e grupo de carregamento (LADGR), nos mesmos centros do get_fv_produto
  SELECT matnr, werks, ladgr, steuc
    FROM marc
    INTO TABLE @DATA(lt_marc)
    FOR ALL ENTRIES IN @lt_mara
    WHERE matnr = @lt_mara-matnr
      AND werks IN ( '2002', '2014', '2015', '2100' ).

  " categoria / linha / grupo do SKU (IDs) e o texto de cada ID
  SELECT matnr, categoria, linha, grupo
    FROM zsdt129
    INTO TABLE @DATA(lt_z129)
    FOR ALL ENTRIES IN @lt_mara
    WHERE matnr = @lt_mara-matnr.

  SELECT id, categoria AS texto FROM zsdt130 INTO TABLE @DATA(lt_cat).
  SELECT id, linha     AS texto FROM zsdt131 INTO TABLE @DATA(lt_lin).
  SELECT id, grupo     AS texto FROM zsdt132 INTO TABLE @DATA(lt_grp).

  " textos externos das unidades (tabela pequena, lida inteira)
  SELECT msehi, mseh3
    FROM t006a
    INTO TABLE @DATA(lt_t006a)
    WHERE spras = @c_lang.

  " produtos com prazo de entrega fixo (24h / 48h)
  SELECT name, low
    FROM tvarvc
    INTO TABLE @DATA(lt_tvarvc)
    WHERE name IN ( 'ZPROD_SELLENT_24', 'ZPROD_SELLENT_48' ).

  SORT lt_mara   BY matnr.
  SORT lt_makt   BY matnr.
  SORT lt_marm   BY matnr meinh.
  SORT lt_marc   BY matnr werks.
  SORT lt_z129   BY matnr.
  SORT lt_cat    BY id.
  SORT lt_lin    BY id.
  SORT lt_grp    BY id.
  SORT lt_t006a  BY msehi.
  SORT lt_tvarvc BY name low.

  DATA: ls_makt  LIKE LINE OF lt_makt,
        ls_marm  LIKE LINE OF lt_marm,
        ls_marc  LIKE LINE OF lt_marc,
        ls_z129  LIKE LINE OF lt_z129,
        ls_cat   LIKE LINE OF lt_cat,
        ls_lin   LIKE LINE OF lt_lin,
        ls_grp   LIKE LINE OF lt_grp,
        ls_t006a LIKE LINE OF lt_t006a,
        lv_low   TYPE tvarvc-low.

  " ------------------------------------------------------------------
  " Montagem
  " ------------------------------------------------------------------
  LOOP AT lt_mara INTO DATA(ls_mara).

    CLEAR: ls_produto, lv_caixa, lv_ncm, lv_ladgr, ls_makt, ls_z129.

    lv_codigo = |{ ls_mara-matnr ALPHA = OUT }|.

    READ TABLE lt_makt INTO ls_makt WITH KEY matnr = ls_mara-matnr BINARY SEARCH.

    " NCM e LADGR: o primeiro centro (2002, 2014, 2015, 2100) que tiver valor
    READ TABLE lt_marc TRANSPORTING NO FIELDS WITH KEY matnr = ls_mara-matnr BINARY SEARCH.
    IF sy-subrc = 0.
      LOOP AT lt_marc INTO ls_marc FROM sy-tabix.
        IF ls_marc-matnr <> ls_mara-matnr.
          EXIT.
        ENDIF.
        IF lv_ncm IS INITIAL AND ls_marc-steuc IS NOT INITIAL.
          lv_ncm = ls_marc-steuc.
        ENDIF.
        IF lv_ladgr IS INITIAL AND ls_marc-ladgr IS NOT INITIAL.
          lv_ladgr = ls_marc-ladgr.
        ENDIF.
      ENDLOOP.
    ENDIF.

    ls_produto-codigoproduto = lv_codigo.
    ls_produto-descricao     = ls_makt-maktx.
    " grupo de carregamento 0007 = produto de peso variavel: o tipo vai como ZVAR (regra do get_fv_produto)
    ls_produto-tipo          = COND #( WHEN lv_ladgr = '0007' THEN c_mtart_zvar ELSE ls_mara-mtart ).
    ls_produto-ean           = ls_mara-ean11.
    ls_produto-ncm           = lv_ncm.
    ls_produto-validade      = COND #( WHEN ls_mara-mhdhb > 0 THEN |{ ls_mara-mhdhb }| ).
    ls_produto-tipo_material = ls_mara-mtart.

    " unidade do cadastro: 'UN' quando o material tem UN na MARM; senao a unidade base
    READ TABLE lt_marm TRANSPORTING NO FIELDS WITH KEY matnr = ls_mara-matnr meinh = 'UN' BINARY SEARCH.
    ls_produto-unidade = COND #( WHEN sy-subrc = 0 THEN 'UN' ELSE ls_mara-meins ).

    ls_produto-unidade_base = ls_mara-meins.

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_mara-meins BINARY SEARCH.
    ls_produto-unidade_base_texto = ls_t006a-mseh3.

    " conversoes da MARM com o texto de cada unidade; a CAIXA e a que tem o texto 'CX'
    READ TABLE lt_marm TRANSPORTING NO FIELDS WITH KEY matnr = ls_mara-matnr BINARY SEARCH.
    IF sy-subrc = 0.
      LOOP AT lt_marm INTO ls_marm FROM sy-tabix.

        IF ls_marm-matnr <> ls_mara-matnr.
          EXIT.
        ENDIF.

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
    ENDIF.

    " o pedido e feito em CAIXA; sem unidade de caixa na MARM usa a unidade base
    ls_produto-unidade_venda = COND #( WHEN lv_caixa IS NOT INITIAL THEN lv_caixa ELSE ls_mara-meins ).

    CLEAR ls_t006a.
    READ TABLE lt_t006a INTO ls_t006a WITH KEY msehi = ls_produto-unidade_venda BINARY SEARCH.
    ls_produto-unidade_venda_texto = ls_t006a-mseh3.

    " multiplo do pedido = 1 unidade de venda (caixa) em UNIDADE BASE (ex.: caixa de 14 KG -> 14)
    READ TABLE lt_marm INTO ls_marm WITH KEY matnr = ls_mara-matnr meinh = ls_produto-unidade_venda BINARY SEARCH.
    IF sy-subrc = 0 AND ls_marm-umren <> 0.
      lv_fator = CONV decfloat34( ls_marm-umrez ) / ls_marm-umren.
      ls_produto-pedido-multiplo = |{ lv_fator DECIMALS = 3 }|.
    ENDIF.

    " quantidade minima: o get_fv_produto nunca preencheu (campo MINIMUM). Fica vazio = sem regra.
    " AJUSTAR: se existir regra de minimo por produto no SAP (ex.: MVKE-AUMNG), leia aqui.

    " peso real do material (o get_fv_produto gravava o FATOR de unidade nesse campo)
    IF ls_mara-ntgew > 0.
      ls_produto-peso-pesoliquido = |{ ls_mara-ntgew DECIMALS = 3 }|.
    ENDIF.
    IF ls_mara-brgew > 0.
      ls_produto-peso-pesobruto = |{ ls_mara-brgew DECIMALS = 3 }|.
    ENDIF.

    " prazo de entrega (dias), igual ao get_fv_produto:
    "   na lista de 24h (TVARVC ZPROD_SELLENT_24) = 1 | na de 48h (ZPROD_SELLENT_48) = 2
    "   senao, grupo de carregamento 0001/0006/0007 = 2, demais = 1
    lv_low = lv_codigo.
    READ TABLE lt_tvarvc TRANSPORTING NO FIELDS WITH KEY name = 'ZPROD_SELLENT_24' low = lv_low BINARY SEARCH.
    IF sy-subrc = 0.
      ls_produto-estoque-prazoentregadias = '1'.
    ELSE.
      READ TABLE lt_tvarvc TRANSPORTING NO FIELDS WITH KEY name = 'ZPROD_SELLENT_48' low = lv_low BINARY SEARCH.
      IF sy-subrc = 0.
        ls_produto-estoque-prazoentregadias = '2'.
      ELSEIF lv_ladgr = '0001' OR lv_ladgr = '0006' OR lv_ladgr = '0007'.
        ls_produto-estoque-prazoentregadias = '2'.
      ELSE.
        ls_produto-estoque-prazoentregadias = '1'.
      ENDIF.
    ENDIF.

    " disponibilidade e-commerce: o get_fv_produto nunca preencheu (ALLOW_ECOMMERCE). Fica vazio.
    " AJUSTAR: se existir essa regra no SAP, preencha aqui (o app nao usa hoje).

    " classificacao
    ls_produto-classificacao-marca = ls_mara-normt.

    READ TABLE lt_z129 INTO ls_z129 WITH KEY matnr = ls_mara-matnr BINARY SEARCH.
    IF sy-subrc = 0.
      ls_produto-classificacao-categoria_id = ls_z129-categoria.
      ls_produto-classificacao-linha_id     = ls_z129-linha.
      ls_produto-classificacao-grupo_id     = ls_z129-grupo.
      READ TABLE lt_cat INTO ls_cat WITH KEY id = ls_z129-categoria BINARY SEARCH.
      IF sy-subrc = 0.
        ls_produto-classificacao-categoria = ls_cat-texto.
      ENDIF.
      READ TABLE lt_lin INTO ls_lin WITH KEY id = ls_z129-linha BINARY SEARCH.
      IF sy-subrc = 0.
        ls_produto-classificacao-linha = ls_lin-texto.
      ENDIF.
      READ TABLE lt_grp INTO ls_grp WITH KEY id = ls_z129-grupo BINARY SEARCH.
      IF sy-subrc = 0.
        ls_produto-classificacao-grupo = ls_grp-texto.
      ENDIF.
    ENDIF.

    APPEND ls_produto TO ls_response-produtos.

  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.
