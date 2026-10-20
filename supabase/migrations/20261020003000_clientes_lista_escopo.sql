-- Clientes de uma lista de preco: supervisor/gerente veem so os clientes da carteira da equipe (p_rotas; null = todos).
drop function if exists fn_clientes_da_lista(text, text, integer, integer);

create or replace function fn_clientes_da_lista(p_pltyp text, p_busca text, p_limite integer, p_offset integer, p_rotas text[] default null)
returns table (
  cod_cliente text, nome text, razao_social text, cnpjcpf text, cidade text, uf text,
  bloqueado boolean, rede text, total bigint
)
language plpgsql stable as $$
begin
  return query
  select c.cod_cliente, coalesce(c.nome_fantasia, c.razao_social), c.razao_social, c.cnpjcpf,
         c.endereco ->> 'cidade', c.endereco ->> 'uf', c.bloqueado,
         (select nullif(a -> 'rede' ->> 'descricao', '') from jsonb_array_elements(c.areas) a
           where a -> 'lista_preco' ->> 'codigo' = p_pltyp limit 1),
         count(*) over ()
    from clientes c
   where exists (select 1 from jsonb_array_elements(c.areas) a where a -> 'lista_preco' ->> 'codigo' = p_pltyp)
     and (p_rotas is null
          or exists (select 1 from rota_clientes rc where rc.cod_cliente = c.cod_cliente and rc.rota = any (p_rotas)))
     and (coalesce(p_busca, '') = ''
          or c.cod_cliente ilike '%' || p_busca || '%'
          or coalesce(c.nome_fantasia, '') ilike '%' || p_busca || '%'
          or coalesce(c.razao_social, '') ilike '%' || p_busca || '%'
          or coalesce(c.cnpjcpf, '') ilike '%' || p_busca || '%')
   order by c.bloqueado, coalesce(c.nome_fantasia, c.razao_social, c.cod_cliente)
   limit least(coalesce(p_limite, 50), 200)
  offset greatest(coalesce(p_offset, 0), 0);
end
$$;
