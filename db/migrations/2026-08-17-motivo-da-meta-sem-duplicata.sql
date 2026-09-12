-- A GRAVAÇÃO DO MOTIVO PASSA A AGUENTAR LISTA COM REPETIÇÃO.
--
-- DEFEITO REAL, no mesmo dia em que a tabela subiu (17/08/2026): a conta
-- C1 - Vessel Brasil mandou 6 problemas e gravou ZERO. O aviso no console dizia:
--
--   ON CONFLICT DO UPDATE command cannot affect row a second time
--
-- O Postgres recusa o LOTE INTEIRO quando a mesma chave aparece duas vezes num
-- `INSERT ... ON CONFLICT`. **Não é erro de linha, é erro de comando** — uma
-- repetição apaga a história daquela conta por completo. A Meta lista o mesmo
-- código duas vezes quando o problema existe no nível do anúncio E no do
-- conjunto, então a repetição é normal, não excepcional.
--
-- A tela já foi corrigida para não repetir. Esta migration é a segunda tranca, e
-- ela é necessária de verdade: navegador com a versão anterior em cache continua
-- mandando a lista repetida por um tempo, e este projeto já teve o caso de app
-- aberto rodando versão velha. Trava só no cliente é trava que o cache contorna.
--
-- ⚠️ NÃO reescrevi o arquivo de 17/08 que já rodou. Migration aplicada é
-- histórico do que aconteceu; corrigir por cima faria o arquivo mentir sobre o
-- que estava no banco — que é a lição que este projeto já aprendeu duas vezes.

create or replace function public.gt_registrar_problemas(p_conta text, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_quantos integer := 0;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or 'meta.gestor' = any (p.features))
  ) then
    raise exception 'Sem permissao na Gestao de Trafego.';
  end if;

  if p_conta is null or p_conta = '' then
    raise exception 'Falta dizer de qual conta e a lista.';
  end if;

  with bruto as (
    select
      x.ad_id, x.codigo, x.campaign_id, x.conta_nome, x.campanha_nome,
      x.ad_nome, x.titulo, x.detalhe, x.nivel, coalesce(x.grave, false) as grave,
      row_number() over () as ordem
    from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(
      ad_id text, codigo integer, campaign_id text, conta_nome text,
      campanha_nome text, ad_nome text, titulo text, detalhe text,
      nivel text, grave boolean
    )
    where x.ad_id is not null and x.codigo is not null
  ),
  -- A SEGUNDA TRANCA: uma linha por (ad_id, codigo), ficando com a primeira que
  -- veio. Sem isto o comando inteiro é recusado e a conta perde a rodada.
  entrada as (
    select distinct on (ad_id, codigo) *
      from bruto
     order by ad_id, codigo, ordem
  )
  insert into public.gt_problemas_meta as g (
    ad_id, codigo, account_id, campaign_id, conta_nome, campanha_nome,
    ad_nome, titulo, detalhe, nivel, grave, primeira_vez, ultima_vez, resolvido_em
  )
  select
    e.ad_id, e.codigo, p_conta, e.campaign_id, e.conta_nome, e.campanha_nome,
    e.ad_nome, e.titulo, e.detalhe, e.nivel, e.grave, now(), now(), null
  from entrada e
  on conflict (ad_id, codigo) do update set
    ultima_vez    = now(),
    resolvido_em  = null,
    account_id    = excluded.account_id,
    campaign_id   = coalesce(excluded.campaign_id, g.campaign_id),
    conta_nome    = coalesce(nullif(excluded.conta_nome, ''), g.conta_nome),
    campanha_nome = coalesce(nullif(excluded.campanha_nome, ''), g.campanha_nome),
    ad_nome       = coalesce(nullif(excluded.ad_nome, ''), g.ad_nome),
    titulo        = coalesce(nullif(excluded.titulo, ''), g.titulo),
    detalhe       = coalesce(nullif(excluded.detalhe, ''), g.detalhe),
    nivel         = coalesce(nullif(excluded.nivel, ''), g.nivel),
    grave         = excluded.grave;

  get diagnostics v_quantos = row_count;

  update public.gt_problemas_meta g
     set resolvido_em = now()
   where g.account_id = p_conta
     and g.resolvido_em is null
     and not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(ad_id text, codigo integer)
        where x.ad_id = g.ad_id and x.codigo = g.codigo
     );

  return v_quantos;
end $fn$;

insert into public.schema_migrations (name, observacao)
values ('2026-08-17-motivo-da-meta-sem-duplicata.sql', 'aplicada pelo MCP')
on conflict (name) do nothing;
