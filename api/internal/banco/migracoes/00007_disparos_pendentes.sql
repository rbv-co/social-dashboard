-- +goose Up
-- Plano 5.10 (Ruling 28 do mestre; Rulings 5.10-1 a 5.10-3): public.disparar_robo sem pg_net. A função de
-- produção (levantamento/02-funções.csv:617-637) chamava net.http_post para acordar uma edge; o Postgres novo
-- não tem pg_net e o gatilho vessel_lista_espera_espelhar (vessel_espelhar_agora, sem tratamento de erro)
-- quebraria todo cadastro da lista de espera. Agora ela só enfileira: quem atende é o worker, por
-- banco.AtenderDisparo (internal/banco/disparos.go). O CREATE FUNCTION do dump sai em limpar-dump.mjs (regra
-- `substituidas`): o restaurar.sh roda esta migração ANTES do schema.
create table disparos_pendentes (
  id            bigserial primary key,
  robo          text not null,
  corpo         jsonb not null default '{}'::jsonb,
  situacao      text not null default 'pendente'
                check (situacao in ('pendente', 'atendendo', 'feito', 'falhou', 'incerto')),
  pedidos       integer not null default 1,   -- quantos disparos este pedido juntou
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  erro          text                          -- por que falhou ou ficou incerto (sem segredo)
);
-- UM pedido esperando por robô: o gatilho dispara a cada linha da lista, e o robô relê a lista inteira.
create unique index disparos_pendentes_um_por_robo on disparos_pendentes (robo) where situacao = 'pendente';
-- a reconciliação procura o atendimento órfão
create index disparos_pendentes_atendendo on disparos_pendentes (robo, atualizado_em) where situacao = 'atendendo';

-- +goose StatementBegin
create or replace function disparar_robo(p_robo text, p_funcao text, p_segredo text,
  p_body jsonb default '{}'::jsonb, p_timeout integer default 120000)
returns bigint
language plpgsql
security definer
set search_path from current
as $function$
-- p_funcao, p_segredo e p_timeout eram da chamada HTTP; ficam na assinatura para os chamadores de produção.
-- NUNCA falha por argumento: quem chama é gatilho de cadastro do site.
declare v_id bigint;
begin
  insert into disparos_pendentes as d (robo, corpo)
  values (coalesce(nullif(p_robo, ''), '?'), coalesce(p_body, '{}'::jsonb))
  on conflict (robo) where situacao = 'pendente'
  do update set pedidos = d.pedidos + 1, atualizado_em = now()
  returning d.id into v_id;
  return v_id;
end
$function$;
-- +goose StatementEnd

-- +goose Down
-- Sem a fila, a função sai junto (a de produção dependia do pg_net, que não existe aqui; restaurar o dump de
-- novo a traz). Sem função, o gatilho de vessel_lista_espera quebra o insert: Down só em ensaio.
-- +goose StatementBegin
drop function if exists disparar_robo(text, text, text, jsonb, integer);
drop table if exists disparos_pendentes;
-- +goose StatementEnd
