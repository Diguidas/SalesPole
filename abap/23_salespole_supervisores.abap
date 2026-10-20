METHOD salespole_supervisores.

  " GET /salespole/supervisores
  " Supervisores vigentes (ZSDT087): supervisor x escritorio + equipe de vendas, com o gerente do supervisor.
  " O vendedor chega ao supervisor pelo escritorio e equipe que vem em /salespole/vendedores
  " (ZSDT005-VKBUR/VKGRP). Nao recebe parametros.

  TYPES: BEGIN OF ty_sup,
           codsupervisor TYPE string,
           nome          TYPE string,
           codgerente    TYPE string,
           gerente_nome  TYPE string,
           escritorio    TYPE string,
           equipe        TYPE string,
           dt_inicio     TYPE string,
           dt_fim        TYPE string,
         END OF ty_sup,
         tt_sup TYPE STANDARD TABLE OF ty_sup WITH EMPTY KEY,

         BEGIN OF ty_response,
           supervisores TYPE tt_sup,
         END OF ty_response.

  DATA ls_response TYPE ty_response.

  " vigente hoje; DATAF vazio = sem fim
  SELECT z~lifnr,
         z~datai,
         z~dataf,
         z~vkgrp,
         z~vkbur,
         z~gerente,
         z~gerente_nome,
         l~name1
    FROM zsdt087 AS z
    LEFT OUTER JOIN lfa1 AS l
      ON l~lifnr = z~lifnr
    INTO TABLE @DATA(lt_rows)
    WHERE z~datai <= @sy-datum
      AND ( z~dataf >= @sy-datum OR z~dataf = '00000000' ).

  SORT lt_rows BY lifnr vkbur vkgrp datai DESCENDING.

  LOOP AT lt_rows INTO DATA(ls_row).
    APPEND VALUE #( codsupervisor = |{ ls_row-lifnr ALPHA = OUT }|
                    nome          = ls_row-name1
                    codgerente    = |{ ls_row-gerente ALPHA = OUT }|
                    gerente_nome  = ls_row-gerente_nome
                    escritorio    = ls_row-vkbur
                    equipe        = ls_row-vkgrp
                    dt_inicio     = |{ ls_row-datai DATE = ISO }|
                    dt_fim        = COND #( WHEN ls_row-dataf IS INITIAL THEN `` ELSE |{ ls_row-dataf DATE = ISO }| ) )
      TO ls_response-supervisores.
  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.
