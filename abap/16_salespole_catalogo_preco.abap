METHOD salespole_catalogo_preco.

  " GET /salespole/catalogo_preco
  " Listas de preco (T189T) e grupos de cliente (T151T) cadastrados.

  TYPES: BEGIN OF ty_lista,
           pltyp TYPE string,
           ptext TYPE string,
         END OF ty_lista,
         tt_lista TYPE STANDARD TABLE OF ty_lista WITH EMPTY KEY,

         BEGIN OF ty_grupo,
           kdgrp TYPE string,
           ktext TYPE string,
         END OF ty_grupo,
         tt_grupo TYPE STANDARD TABLE OF ty_grupo WITH EMPTY KEY,

         BEGIN OF ty_response,
           listas TYPE tt_lista,
           grupos TYPE tt_grupo,
         END OF ty_response.

  DATA ls_response TYPE ty_response.

  SELECT pltyp, ptext
    FROM t189t
    INTO TABLE @DATA(lt_listas)
    WHERE spras = @c_lang
    ORDER BY pltyp.

  SELECT kdgrp, ktext
    FROM t151t
    INTO TABLE @DATA(lt_grupos)
    WHERE spras = @c_lang
    ORDER BY kdgrp.

  ls_response-listas = VALUE #( FOR a IN lt_listas ( pltyp = a-pltyp ptext = a-ptext ) ).
  ls_response-grupos = VALUE #( FOR b IN lt_grupos ( kdgrp = b-kdgrp ktext = b-ktext ) ).

  send_json( is_data = ls_response ).

ENDMETHOD.
