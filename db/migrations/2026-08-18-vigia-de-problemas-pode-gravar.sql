-- O ROBÔ-VIGIA PRECISA GRAVAR O QUE A META RECLAMA.
--
-- Até aqui, quem registrava era só a TELA: `gt_registrar_problemas` exige um
-- usuário logado com admin ou a chave `meta.gestor`. Isso deixava a memória dos
-- problemas dependendo de alguém abrir a Gestão de Tráfego — e um problema que
-- nasce e morre entre duas visitas não deixava rastro nenhum. Era esse o caso
-- que originou a tabela: a campanha barrada que ninguém viu a tempo.
--
-- O QUE MUDA: além do usuário logado com permissão, a função passa a aceitar
-- quem chega com a CHAVE DE SERVIÇO (role `service_role` no token).
--
-- POR QUE ISSO NÃO ABRE PORTA NOVA: quem tem a chave de serviço já pode escrever
-- em `gt_problemas_meta` diretamente, sem passar por função nenhuma — ela ignora
-- RLS por definição. Passar pela função é ESTREITAR, não alargar: assim o robô
-- usa a mesma regra de fechar-o-que-sumiu que a tela usa, em vez de uma segunda
-- cópia em JavaScript que ia divergir.
--
-- QUEM NÃO GANHA NADA: `anon` continua sem poder executar (o `revoke` de
-- 17/08 continua valendo, e não é tocado aqui); `authenticated` continua
-- passando pela mesma checagem de admin/`meta.gestor` de sempre.
--
-- O RESTO DO CORPO É IDÊNTICO ao de `2026-08-17-motivo-da-meta-sem-duplicata.sql`.
-- Só o `if` do portão mudou.

create or replace function public.gt_registrar_problemas(p_conta text, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quantos integer := 0;
  -- O papel que veio no token. Vazio quando não há token nenhum (chamada de
  -- dentro do banco), e aí o portão continua exigindo usuário com permissão.
  v_papel text := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
begin
  if v_papel <> 'service_role' and not exists (
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
end $function$;

comment on function public.gt_registrar_problemas(text, jsonb) is
  'Registra o que a Meta reclama de uma conta e fecha o que sumiu. Aceita quem '
  'esta logado com admin/meta.gestor OU a chave de servico (robo-vigia diario).';

-- Os grants de 17/08 continuam como estavam. Repetidos aqui de proposito, para
-- que aplicar SO este arquivo num banco novo nao deixe a funcao aberta ao anon.
revoke execute on function public.gt_registrar_problemas(text, jsonb) from public, anon;
grant  execute on function public.gt_registrar_problemas(text, jsonb) to authenticated;
