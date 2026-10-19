METHOD salespole_vendedores.

  " GET /salespole/vendedores
  " Todos os vendedores com rota vigente (codigo, nome, documento e rota).
  " Usado pelo painel gerencial para escolher quais vendedores entram nos indicadores,
  " mesmo sem usar o app. Nao recebe parametros.

  TYPES: BEGIN OF ty_vend,
           codvendedor TYPE string,
           nome        TYPE string,
           documento   TYPE string,
           rota        TYPE string,
         END OF ty_vend,
         tt_vend TYPE STANDARD TABLE OF ty_vend WITH EMPTY KEY,

         BEGIN OF ty_response,
           vendedores TYPE tt_vend,
         END OF ty_response.

  DATA ls_response TYPE ty_response.

  SELECT z5~lifnr,
         z5~rota,
         l~name1,
         l~stcd1,
         l~stcd2
    FROM zsdt005 AS z5
    INNER JOIN lfa1 AS l
      ON l~lifnr = z5~lifnr
    INTO TABLE @DATA(lt_rows)
    WHERE z5~datbi >= @sy-datum.

  " um vendedor aparece uma vez so (vigencia mais de uma vez na tabela de rotas)
  SORT lt_rows BY lifnr rota.
  DELETE ADJACENT DUPLICATES FROM lt_rows COMPARING lifnr.

  LOOP AT lt_rows INTO DATA(ls_row).
    APPEND VALUE #( codvendedor = |{ ls_row-lifnr ALPHA = OUT }|
                    nome        = ls_row-name1
                    documento   = COND #( WHEN ls_row-stcd1 IS NOT INITIAL THEN ls_row-stcd1 ELSE ls_row-stcd2 )
                    rota        = ls_row-rota )
      TO ls_response-vendedores.
  ENDLOOP.

  send_json( is_data = ls_response ).

ENDMETHOD.
