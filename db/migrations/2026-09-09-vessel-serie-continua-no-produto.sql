-- A SEQUÊNCIA DO NÚMERO DE SÉRIE PASSA A SER DO PRODUTO, NÃO DO LOTE.
--
-- ⚠️ O DEFEITO, medido em 09/09/2026: `vessel_gerar_lote` criava as peças
-- sempre de 1 até a quantidade. Como o "lote" na prática é uma SESSÃO DE
-- CADASTRO na bancada — 56 dos 84 lotes de produto repetido têm UMA peça, e a
-- Ravelle Small Jeans tem 4 lotes todos fabricados no mesmo dia 06/09 —, cada
-- sessão recomeçava do 1. Resultado no banco: **43 números de série repetidos,
-- em 99 peças, 97 delas já gravadas**. A Linear Medium Chocolate tinha CINCO
-- bolsas diferentes carregando `SS0001HBM4001`.
--
-- O código da etiqueta nunca repetiu (é chave primária, e o sorteio é
-- criptográfico) — então ninguém abre a página de outra bolsa. O que repetia
-- era o número IMPRESSO no certificado e no cartão PVC, que é o que a cliente
-- lê para saber qual peça é a dela.
--
-- ⚠️ SÃO TRÊS FUNÇÕES, E ARRUMAR SÓ A PRIMEIRA NÃO RESOLVE:
--   1. `vessel_gerar_lote`     começava em 1;
--   2. `vessel_editar_lote`    ao aumentar a quantidade, continuava do maior
--                              número DAQUELE lote;
--   3. `vessel_renumerar_lote` puxava as peças livres de volta para as vagas
--                              de 1 até N DAQUELE lote — ou seja, desfazia as
--                              duas primeiras na primeira edição de lote.
--
-- Esta migration NÃO renumera nada do que já existe. Ela só faz o próximo lote
-- nascer certo. As 99 peças de hoje são assunto à parte, com lista conferida
-- antes, porque mexer nelas muda número de peça gravada.

-- ── O ajudante: qual o próximo número livre DESTE PRODUTO ──────────────────
-- Sem portão de propósito: é só leitura, não muda nada, e é chamado de dentro
-- de funções que já conferiram a permissão de quem chamou.
create or replace function public.vessel_chave_do_produto(p_sku text)
returns text language sql immutable set search_path to 'public'
as $$
  -- A MESMA NORMALIZAÇÃO do número de série (`numeroDeSerie` em
  -- verify/regras.js e em lotes.js): sobra letra e dígito, em maiúscula.
  -- Comparar o texto cru deixaria "SS0001HB.B1" e "ss0001hb b1" como produtos
  -- diferentes, e eles imprimem o MESMO número.
  select nullif(upper(regexp_replace(coalesce(p_sku, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

create or replace function public.vessel_maior_da_serie(p_sku text, p_excluir_lote uuid default null)
returns int language sql stable set search_path to 'public'
as $$
  -- ⚠️ SEM SKU, VOLTA ZERO — e isso é o certo, não um buraco: `numeroDeSerie`
  -- devolve string vazia quando não há SKU, então peça sem produto não imprime
  -- número nenhum e não tem com o que colidir.
  select coalesce(max(p.numero_na_serie), 0)
    from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where public.vessel_chave_do_produto(l.sku) is not null
     and public.vessel_chave_do_produto(l.sku) = public.vessel_chave_do_produto(p_sku)
     and (p_excluir_lote is null or l.id <> p_excluir_lote);
$$;

-- ── 1. LOTE NOVO continua de onde o produto parou ─────────────────────────
create or replace function public.vessel_gerar_lote(
  p_modelo text, p_cor text, p_sku text, p_quantidade int,
  p_fabricado_em date, p_fotos text[], p_os text default null
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_lote uuid; v_de int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, fotos, os, criado_por)
  values (trim(p_modelo),
          nullif(trim(coalesce(p_cor, '')), ''),
          nullif(trim(coalesce(p_sku, '')), ''),
          p_quantidade, coalesce(p_fabricado_em, current_date), p_fotos,
          -- O.S. em branco entra NULA, e nao string vazia: e o que o resto desta
          -- casa faz com campo opcional, e o que a busca e a tela esperam.
          nullif(trim(coalesce(p_os, '')), ''),
          auth.uid())
  returning id into v_lote;

  -- AQUI ESTAVA O DEFEITO: era `1, p_quantidade`, fixo.
  v_de := public.vessel_maior_da_serie(p_sku);
  perform public.vessel_criar_pecas(v_lote, v_de + 1, v_de + p_quantidade);

  return json_build_object('ok', true, 'lote_id', v_lote,
                           'quantidade', p_quantidade,
                           'primeiro_numero', v_de + 1);
end;
$$;

-- ── 3. RENUMERAR só ocupa vaga que o PRODUTO inteiro não usa ──────────────
create or replace function public.vessel_renumerar_lote(p_lote uuid)
returns int language plpgsql security definer set search_path to 'public'
as $$
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
    -- PRESA = está no mundo. Mesma definição de `vessel_editar_lote`.
    select p.codigo, p.numero_na_serie
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and (p.gravada_em is not null
            or exists (select 1 from public.vessel_registros r where r.codigo = p.codigo))
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
$$;

-- As permissões continuam como estavam: `anon` não executa nenhuma das duas.
revoke execute on function public.vessel_gerar_lote(text, text, text, integer, date, text[], text) from anon;
revoke execute on function public.vessel_renumerar_lote(uuid) from anon;
revoke execute on function public.vessel_maior_da_serie(text, uuid) from anon;
revoke execute on function public.vessel_chave_do_produto(text) from anon;
