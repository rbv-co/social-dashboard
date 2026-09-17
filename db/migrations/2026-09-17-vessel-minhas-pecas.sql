-- db/migrations/2026-09-17-vessel-minhas-pecas.sql
--
-- ⚠️ TUDO PARTE DA SESSÃO. Nenhuma função aceita "me dê as peças do cliente X":
-- quem diz quem é o dono é o token, nunca a página.
create or replace function public.vessel_minhas_pecas(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_id uuid; v_pecas json;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_id := (v_sessao ->> 'cliente_id')::uuid;

  select coalesce(json_agg(x order by x.registrado_em desc), '[]'::json) into v_pecas
    from (
      select r.codigo, l.modelo, l.cor, l.sku, p.numero_na_serie,
             r.registrado_em, r.garantia_ate, 'registrada' as estado
        from public.vessel_registros r
        join public.vessel_pecas p on p.codigo = r.codigo
        join public.vessel_lotes l on l.id = p.lote_id
       where r.cliente_id = v_id
      union all
      -- ⚠️ UMA PEÇA SÓ APARECE UMA VEZ. Correção 1 (revisão 17/09/2026): a
      -- própria dona pode reabrir um pedido de registro para um código que
      -- JÁ é dela (por exemplo depois de já ter virado dona por outro
      -- caminho) — a edge e o rpc de abrir pedido não impedem isso. Sem o
      -- `not exists` abaixo, essa peça sairia DUAS VEZES em "Minhas peças":
      -- uma como "registrada" e outra como "em conferência" do mesmo código.
      -- O lugar certo de blindar é aqui, na leitura, e não confiar que quem
      -- escreve nunca vai deixar passar essa sobreposição.
      select pr.codigo, l.modelo, l.cor, l.sku, p.numero_na_serie,
             pr.criado_em, null::date, 'em conferência'
        from public.vessel_pedidos_de_registro pr
        join public.vessel_pecas p on p.codigo = pr.codigo
        join public.vessel_lotes l on l.id = p.lote_id
       where pr.cliente_id = v_id and pr.estado = 'pendente'
         and not exists (select 1 from public.vessel_registros r2 where r2.codigo = pr.codigo)
    ) x;

  return json_build_object('ok', true, 'pecas', v_pecas);
end;
$$;
revoke all on function public.vessel_minhas_pecas(text) from public, anon, authenticated;
grant execute on function public.vessel_minhas_pecas(text) to service_role;
