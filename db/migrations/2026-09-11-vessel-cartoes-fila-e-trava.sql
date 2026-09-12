-- A FILA DE CARTÕES EAN, E A TRAVA QUE O CARTÃO IMPRESSO PASSA A TER.
--
-- A aba "Cartões EAN" deixa o dono escolher as peças e mandar gerar. Quem gera
-- é um robô, que demora (Chrome, 600 dpi, upload no Zoho), então o pedido entra
-- numa fila e a tela não fica presa esperando.
--
-- ⚠️ A PARTE QUE NÃO É ÓBVIA É A TRAVA. O número de série que sai IMPRESSO no
-- cartão é `código do produto + posição da peça`, e a posição ainda se mexe:
-- `vessel_editar_lote` e `vessel_renumerar_lote` reorganizam as peças que não
-- estão "presas". Até hoje presa queria dizer GRAVADA ou COM GARANTIA — as duas
-- formas de a peça já existir no mundo.
--
-- Um cartão impresso é uma terceira. E é a mais difícil de desfazer: a etiqueta
-- NFC se regrava, o papel dentro da bolsa não. Já aconteceu de os números
-- mudarem depois de os cartões saírem — foi por isso que existe no Zoho a pasta
-- "Cartões com EAN - BKP 07-09-2026 (numero de serie antigo)", com 620 cartões
-- que deixaram de valer. Sem esta trava, acontece de novo.
--
-- ⚠️ E A REGRA PASSA A MORAR NUM LUGAR SÓ. Ela estava escrita QUATRO vezes, em
-- três funções (`vessel_editar_lote` duas, `vessel_renumerar_lote`,
-- `vessel_excluir_lote`). Somar uma condição em quatro lugares é somar em três
-- e esquecer um — e o esquecido não dá erro: ele renumera uma peça que não
-- devia, calado. Agora é `vessel_peca_presa`, e as quatro a chamam.
--
-- PROVADO em transação com ROLLBACK contra a produção — ver
-- `db/cartao-trava-a-serie.test.mjs` e o relato no commit.

-- ── 1. A marca na peça ──────────────────────────────────────────────────────
-- Fica NULA até o robô confirmar que o arquivo existe no Zoho. Pedido feito e
-- cartão pronto são coisas diferentes: se o robô falhar, a peça não pode ficar
-- marcada como tendo um cartão que ninguém tem.
alter table public.vessel_pecas
  add column if not exists cartao_gerado_em timestamptz;

comment on column public.vessel_pecas.cartao_gerado_em is
  'Quando o cartão EAN desta peça ficou pronto no Zoho. Marcado pelo robô, não pela tela.';

-- ── 2. A fila ───────────────────────────────────────────────────────────────
create table if not exists public.vessel_cartao_pedidos (
  id          uuid primary key default gen_random_uuid(),
  -- Os CÓDIGOS das peças, e não o lote: o dono escolhe peça a peça, e um pedido
  -- pode misturar lotes do mesmo produto.
  pecas       text[] not null,
  -- ⚠️ LISTA FECHADA, e ela já derrubou uma transação inteira nesta casa
  -- (`vessel_edicoes` recusou a ação `numero_trocado` em 09/09). Quem somar uma
  -- situação nova ao robô tem de somar AQUI antes, senão o update falha e o
  -- pedido fica preso em 'rodando' para sempre.
  situacao    text not null default 'na_fila'
              check (situacao in ('na_fila', 'rodando', 'pronto', 'falhou')),
  pasta       text,          -- onde o robô deixou os arquivos no Zoho
  erro        text,          -- por que falhou, em português, para a tela mostrar
  criado_por  uuid,
  criado_em   timestamptz not null default now(),
  comecou_em  timestamptz,
  terminou_em timestamptz
);

comment on table public.vessel_cartao_pedidos is
  'Fila de geração de cartões EAN. A tela pede, o robô executa.';

-- A tela lista os pedidos recentes; sem índice ela varre a tabela inteira.
create index if not exists vessel_cartao_pedidos_recentes
  on public.vessel_cartao_pedidos (criado_em desc);

-- O robô procura o próximo da fila. Índice parcial: a fila é curta, o histórico
-- não.
create index if not exists vessel_cartao_pedidos_na_fila
  on public.vessel_cartao_pedidos (criado_em)
  where situacao in ('na_fila', 'rodando');

alter table public.vessel_cartao_pedidos enable row level security;

-- ⚠️ A TRAVA CONFERIDA CONTRA AS IRMÃS, e não escrita de cabeça. A irmã certa é
-- `vessel_lotes`: RLS ligada, `anon` não lê, `authenticated` lê só se for admin,
-- e ninguém escreve direto — quem escreve é função SECURITY DEFINER.
create policy vessel_cartao_pedidos_read
  on public.vessel_cartao_pedidos for select
  to authenticated using (public.is_vessel_admin());

-- ⚠️ `grant select` NÃO RETIRA O RESTO. Tabela nova no Supabase nasce com
-- INSERT/UPDATE/DELETE para `authenticated` pela concessão padrão, e já subiu
-- tabela assim nesta casa com nove revisões passando batido.
--
-- ⚠️ E A LISTA NOMINAL TAMBÉM NÃO BASTA: `revoke insert, update, delete,
-- truncate` deixa `references` e `trigger` de pé — conferido, é o que as irmãs
-- desta casa ainda carregam. `trigger` deixa quem tem a concessão pendurar um
-- gatilho na tabela. Aqui vai `revoke all` e só depois o `select`, que é o
-- único jeito de a lista não envelhecer quando o Postgres inventar a próxima
-- permissão. (Nas irmãs isso fica para uma limpeza separada; não é assunto
-- desta migration.)
revoke all on table public.vessel_cartao_pedidos from public, anon, authenticated;
grant  select on table public.vessel_cartao_pedidos to authenticated;

-- ── 3. "Presa" passa a ter UMA definição ────────────────────────────────────
-- ⚠️ DEVOLVE O MOTIVO, E NÃO SIM/NÃO. Quem exclui um lote precisa DIZER por que
-- não deu — "3 peças já gravadas" e "2 peças já têm cartão impresso" pedem
-- conselhos diferentes, e botão desabilitado calado faz a pessoa achar que a
-- ferramenta quebrou. Com booleano, a recusa viraria uma frase genérica.
create or replace function public.vessel_peca_presa(p_codigo text)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  -- PRESA = esta peça já existe no mundo, fora daqui. Mexer no número dela
  -- deixaria mentindo alguma coisa que já saiu: a etiqueta gravada, a garantia
  -- da cliente, ou o cartão impresso dentro da bolsa.
  --
  -- A ORDEM É A DA GRAVIDADE, porque só um motivo é devolvido: a garantia é de
  -- uma pessoa de verdade, a etiqueta gravada pode estar numa bolsa, e o cartão
  -- é papel — o mais fácil de refazer dos três, embora não se desfaça.
  select case
    when exists (select 1 from public.vessel_registros r where r.codigo = p_codigo)
      then 'garantia'
    when exists (select 1 from public.vessel_pecas p
                  where p.codigo = p_codigo and p.gravada_em is not null)
      then 'gravada'
    when exists (select 1 from public.vessel_pecas p
                  where p.codigo = p_codigo and p.cartao_gerado_em is not null)
      then 'cartao'
    -- Pedido em aberto conta igual: entre o "gerar" e o arquivo no Zoho existe
    -- uma janela de minutos, e renumerar dentro dela imprime o número errado.
    when exists (select 1 from public.vessel_cartao_pedidos q
                  where q.situacao in ('na_fila', 'rodando')
                    and p_codigo = any (q.pecas))
      then 'cartao'
    else null
  end;
$$;

revoke execute on function public.vessel_peca_presa(text) from public, anon;
grant  execute on function public.vessel_peca_presa(text) to authenticated;

-- ── 4. As três funções passam a usar a definição única ──────────────────────
-- Os corpos abaixo são os que estavam em produção, com SÓ a condição trocada.

CREATE OR REPLACE FUNCTION public.vessel_renumerar_lote(p_lote uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int; v_sku text; v_base int;
begin
  -- Portão por dentro. `revoke ... from public` NÃO tira a concessão que o
  -- Postgres dá por DEFAULT PRIVILEGES a `authenticated`, então quem protege
  -- este ajudante é esta linha, não o grant.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  select sku into v_sku from public.vessel_lotes where id = p_lote;

  with presa as (
    -- PRESA = está no mundo. A definição mora em `vessel_peca_presa`, e só lá:
    -- ela estava escrita quatro vezes, e somar uma condição em quatro lugares é
    -- somar em três e esquecer um — caladamente.
    select p.codigo, p.numero_na_serie
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and public.vessel_peca_presa(p.codigo) is not null
  ),
  -- ⚠️ O QUE MUDOU: as peças dos OUTROS lotes do mesmo produto também ocupam
  -- número. Sem isto, renumerar puxava as livres para 1, 2, 3 e recriava a
  -- colisão que as outras duas funções acabaram de evitar.
  dos_irmaos as (
    select p.numero_na_serie
      from public.vessel_pecas p
      join public.vessel_lotes l on l.id = p.lote_id
     where l.id <> p_lote
       and public.vessel_chave_do_produto(l.sku) is not null
       and public.vessel_chave_do_produto(l.sku) = public.vessel_chave_do_produto(v_sku)
  ),
  livre as (
    -- a ordem atual manda: quem era o primeiro continua sendo o primeiro
    select p.codigo,
           row_number() over (order by p.numero_na_serie, p.criado_em, p.codigo) as ordem
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and not exists (select 1 from presa x where x.codigo = p.codigo)
  ),
  vaga as (
    select n, row_number() over (order by n) as ordem
      from generate_series(
             1,
             -- teto folgado: o que o produto inteiro já usa, mais o que este
             -- lote precisa. Sempre sobra vaga suficiente.
             (select count(*) from public.vessel_pecas where lote_id = p_lote)
               + (select count(*) from presa)
               + (select count(*) from dos_irmaos)
               + coalesce((select max(numero_na_serie) from dos_irmaos), 0)
           ) as n
     where not exists (select 1 from presa x where x.numero_na_serie = n)
       and not exists (select 1 from dos_irmaos y where y.numero_na_serie = n)
  ),
  nova as (
    select l.codigo, v.n from livre l join vaga v on v.ordem = l.ordem
  )
  update public.vessel_pecas p
     set numero_na_serie = nova.n
    from nova
   where nova.codigo = p.codigo
     and p.numero_na_serie is distinct from nova.n;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vessel_editar_lote(p_lote uuid, p_modelo text, p_cor text, p_sku text, p_fabricado_em date, p_quantidade integer, p_os text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_presas int; v_hoje int; v_maior int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  -- PRESA = ja existe no mundo, fora daqui: gravada, com garantia, ou com
  -- cartao impresso. A definicao mora em `vessel_peca_presa`.
  select count(*) filter (where public.vessel_peca_presa(p.codigo) is not null),
         count(*), coalesce(max(p.numero_na_serie), 0)
    into v_presas, v_hoje, v_maior
    from public.vessel_pecas p where p.lote_id = p_lote;

  if p_quantidade < v_presas then
    return json_build_object('ok', false, 'motivo', 'abaixo_do_gravado',
                             'gravadas', v_presas);
  end if;

  update public.vessel_lotes
     set modelo = trim(p_modelo),
         cor = nullif(trim(coalesce(p_cor, '')), ''),
         sku = nullif(trim(coalesce(p_sku, '')), ''),
         fabricado_em = coalesce(p_fabricado_em, fabricado_em),
         quantidade = p_quantidade,
         -- ⚠️ TRES ESTADOS, E NAO DOIS. NULO quer dizer "nao mexa" — e o que
         -- chega de quem chama a funcao sem o parametro, e apagar a O.S. de um
         -- lote por omissao seria perder o numero que amarra a bolsa ao papel.
         -- String VAZIA quer dizer "limpe", que e como se corrige um numero
         -- digitado errado. Texto quer dizer "grave isto".
         os = case when p_os is null then os else nullif(trim(p_os), '') end
   where id = p_lote;

  if p_quantidade > v_hoje then
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
  elsif p_quantidade < v_hoje then
    -- so saem as LIVRES: nem gravadas, nem com garantia
    delete from public.vessel_pecas
     where codigo in (
       select p.codigo from public.vessel_pecas p
        where p.lote_id = p_lote
          and public.vessel_peca_presa(p.codigo) is null
        order by p.numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
  end if;

  -- FORA DOS RAMOS, sempre. Quando a quantidade nao muda, nenhum ramo rodava e
  -- um lote que ja tivesse buraco ficava com numero maior que o total.
  perform public.vessel_renumerar_lote(p_lote);

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.vessel_excluir_lote(p_lote uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_gravadas int; v_garantias int; v_cartoes int; v_total int; v_lote record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lote from public.vessel_lotes where id = p_lote;
  if not found then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  -- ⚠️ CONTA PELO MOTIVO QUE `vessel_peca_presa` DEVOLVE, e nao por condicoes
  -- escritas aqui. Era aqui que a regra estava pela quarta vez.
  select count(*) filter (where public.vessel_peca_presa(p.codigo) = 'gravada'),
         count(*) filter (where public.vessel_peca_presa(p.codigo) = 'garantia'),
         count(*) filter (where public.vessel_peca_presa(p.codigo) = 'cartao'),
         count(*)
    into v_gravadas, v_garantias, v_cartoes, v_total
    from public.vessel_pecas p where p.lote_id = p_lote;

  -- BASTA UMA gravada para o lote inteiro ficar preso: o lote e o que da modelo,
  -- cor e data para a pagina da cliente ler. Sem ele, a peca gravada fica orfa.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;
  -- E BASTA UMA GARANTIA REGISTRADA. Apagar levaria a garantia da cliente junto,
  -- por cascade, sem ninguem ver.
  if v_garantias > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_garantia',
                             'garantias', v_garantias, 'total', v_total);
  end if;
  -- E BASTA UM CARTAO IMPRESSO. O papel esta dentro da bolsa com o numero de
  -- serie; apagar a peca libera o numero para outra, e passam a existir duas
  -- bolsas com a mesma identidade — uma delas so no papel, onde ninguem corrige.
  if v_cartoes > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_cartao',
                             'cartoes', v_cartoes, 'total', v_total);
  end if;

  -- ⚠️ A TRILHA VEM ANTES DO DELETE. Depois dele nao ha de onde ler o codigo.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  select p.codigo, 'lote_excluido', null,
         jsonb_build_object('lote', p_lote, 'modelo', v_lote.modelo,
                            'cor', v_lote.cor, 'sku', v_lote.sku,
                            'numero_na_serie', p.numero_na_serie,
                            'pecas_no_lote', v_total),
         auth.uid()
    from public.vessel_pecas p where p.lote_id = p_lote;

  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$function$
;

-- As permissões continuam como estavam: `anon` não executa nenhuma das três.
revoke execute on function public.vessel_renumerar_lote(uuid) from anon;
revoke execute on function public.vessel_editar_lote(uuid, text, text, text, date, integer, text) from anon;
revoke execute on function public.vessel_excluir_lote(uuid) from anon;

-- ── 5. Pedir cartões (a tela) ───────────────────────────────────────────────
create or replace function public.vessel_pedir_cartoes(p_pecas text[])
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pecas text[];
  v_faltando text[];
  v_repetidas int;
  v_pedido uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Normaliza e tira repetição: a tela manda o que foi marcado, e marcar a
  -- mesma peça duas vezes não pode virar dois cartões com o mesmo número.
  select array_agg(distinct upper(trim(x)))
    into v_pecas
    from unnest(coalesce(p_pecas, array[]::text[])) as x
   where coalesce(trim(x), '') <> '';

  if v_pecas is null or array_length(v_pecas, 1) is null then
    return json_build_object('ok', false, 'motivo', 'nenhuma_peca');
  end if;
  -- Teto: uma leva de 500 cartões já é um dia de impressão. Acima disso é
  -- engano de clique, não pedido.
  if array_length(v_pecas, 1) > 500 then
    return json_build_object('ok', false, 'motivo', 'demais',
                             'pedidas', array_length(v_pecas, 1), 'teto', 500);
  end if;

  -- ⚠️ PEÇA QUE NÃO EXISTE TEM DE PARAR AQUI, e não virar um cartão a menos no
  -- fim da fila. O robô que descobre isso três minutos depois entrega uma pasta
  -- incompleta, e quem conferir vai contar os arquivos sem saber o que faltou.
  select array_agg(x) into v_faltando
    from unnest(v_pecas) as x
   where not exists (select 1 from public.vessel_pecas p where p.codigo = x);
  if v_faltando is not null then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe',
                             'pecas', to_jsonb(v_faltando));
  end if;

  -- Refazer cartão é permitido — cartão rasga, mancha, some. Mas a tela precisa
  -- DIZER que já existia, senão a leva volta do Zoho com o dobro dos arquivos e
  -- ninguém sabe qual é o bom.
  select count(*) into v_repetidas
    from public.vessel_pecas p
   where p.codigo = any (v_pecas) and p.cartao_gerado_em is not null;

  insert into public.vessel_cartao_pedidos (pecas, criado_por)
  values (v_pecas, auth.uid())
  returning id into v_pedido;

  return json_build_object('ok', true, 'pedido', v_pedido,
                           'pecas', array_length(v_pecas, 1),
                           'refazendo', v_repetidas);
end;
$function$;

revoke execute on function public.vessel_pedir_cartoes(text[]) from public, anon;
grant  execute on function public.vessel_pedir_cartoes(text[]) to authenticated;

-- ── 6. O robô pega e devolve ────────────────────────────────────────────────
-- ⚠️ PEGAR É UM UPDATE COM `for update skip locked`, e não um select seguido de
-- update. Dois robôs acordados ao mesmo tempo (o gatilho do pedido e a rodada
-- de hora em hora) pegariam o MESMO pedido e gerariam a leva duas vezes.
create or replace function public.vessel_cartao_pegar_da_fila()
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_pedido record;
begin
  update public.vessel_cartao_pedidos q
     set situacao = 'rodando', comecou_em = now()
   where q.id = (select id from public.vessel_cartao_pedidos
                  where situacao = 'na_fila'
                  order by criado_em
                  limit 1
                  for update skip locked)
  returning * into v_pedido;

  if not found then
    return json_build_object('ok', true, 'pedido', null);
  end if;
  return json_build_object('ok', true, 'pedido', to_jsonb(v_pedido));
end;
$function$;

create or replace function public.vessel_cartao_pedido_terminou(
  p_pedido uuid, p_ok boolean, p_pasta text, p_erro text, p_pecas text[])
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_marcadas int := 0;
begin
  -- ⚠️ SÓ AS PEÇAS QUE O ROBÔ CONFIRMA. Marcar o pedido inteiro deixaria
  -- `cartao_gerado_em` mentindo nas que falharam no meio — e essa marca é o que
  -- prende o número de série. Marca errada prende peça que ainda podia andar.
  if p_ok then
    update public.vessel_pecas
       set cartao_gerado_em = now()
     where codigo = any (coalesce(p_pecas, array[]::text[]));
    get diagnostics v_marcadas = row_count;
  end if;

  update public.vessel_cartao_pedidos
     set situacao = case when p_ok then 'pronto' else 'falhou' end,
         pasta = coalesce(p_pasta, pasta),
         erro = nullif(trim(coalesce(p_erro, '')), ''),
         terminou_em = now()
   where id = p_pedido;

  return json_build_object('ok', true, 'marcadas', v_marcadas);
end;
$function$;

-- ⚠️ ESTAS DUAS SÃO DO ROBÔ, e de mais ninguém. Quem chama com a chave de
-- serviço já passa por cima da RLS; o que não pode é a tela (ou `anon`)
-- conseguir marcar peça como impressa ou tirar pedido da fila.
revoke execute on function public.vessel_cartao_pegar_da_fila() from public, anon, authenticated;
revoke execute on function public.vessel_cartao_pedido_terminou(uuid, boolean, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.vessel_cartao_pegar_da_fila() to service_role;
grant execute on function public.vessel_cartao_pedido_terminou(uuid, boolean, text, text, text[])
  to service_role;
