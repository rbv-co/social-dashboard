-- BAIXA DE PEÇA — e por que ela existe em vez de um "excluir".
--
-- A página da cliente, diante de um código que não existe, diz "não consta no
-- nosso registro de peças". Então APAGAR uma peça cuja etiqueta já foi gravada e
-- costurada dentro de uma bolsa faz a bolsa ORIGINAL parecer falsa para quem
-- comprou — e não há como desfazer, porque a etiqueta está dentro da bolsa.
--
-- Por isso peça gravada não se exclui: ela é BAIXADA, com motivo. O código
-- continua respondendo normalmente para a cliente (decisão do dono: a página não
-- muda), e some da fila de gravação.

-- É TABELA, e não coluna em vessel_pecas, para o histórico ficar inteiro: com
-- coluna, baixar de novo depois de desfazer apagaria a baixa anterior — e é
-- justamente numa peça que já sumiu uma vez que o histórico interessa.
create table if not exists public.vessel_baixas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null references public.vessel_pecas(codigo) on delete cascade,
  motivo       text not null check (motivo in ('extraviada','defeito','devolvida','etiqueta_perdida')),
  baixada_em   timestamptz not null default now(),
  baixada_por  uuid,
  desfeita_em  timestamptz,
  desfeita_por uuid
);

create index if not exists vessel_baixas_codigo_idx on public.vessel_baixas(codigo);

-- UMA baixa ativa por peça, garantida pelo banco. Sem isto, dois cliques
-- rápidos deixariam duas baixas abertas e "desfazer" fecharia só uma.
create unique index if not exists vessel_baixas_ativa_idx
  on public.vessel_baixas(codigo) where desfeita_em is null;

alter table public.vessel_baixas enable row level security;

-- UMA política, de SELECT, igual às outras quatro tabelas do selo. É ela que
-- deixa o painel ler. Escrita nenhuma: só as funções abaixo escrevem.
drop policy if exists vessel_baixas_read on public.vessel_baixas;
create policy vessel_baixas_read on public.vessel_baixas
  for select to authenticated using (public.is_vessel_admin());

-- ── BAIXAR ────────────────────────────────────────────────────────────────
create or replace function public.vessel_baixar_peca(p_codigo text, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if p_motivo not in ('extraviada','defeito','devolvida','etiqueta_perdida') then
    return json_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  if not exists (select 1 from public.vessel_pecas where codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if exists (select 1 from public.vessel_baixas
              where codigo = v_codigo and desfeita_em is null) then
    return json_build_object('ok', false, 'motivo', 'ja_baixada');
  end if;
  -- quem baixou sai de auth.uid(), NUNCA de parâmetro: por parâmetro, quem
  -- chama poderia dizer que foi outra pessoa.
  insert into public.vessel_baixas (codigo, motivo, baixada_por)
  values (v_codigo, p_motivo, auth.uid());
  return json_build_object('ok', true, 'codigo', v_codigo, 'motivo_da_baixa', p_motivo);
end;
$$;

-- ── DESFAZER ──────────────────────────────────────────────────────────────
-- Existe porque peça dada como extraviada REAPARECE, e porque um clique errado
-- não pode ser definitivo numa peça que já está com a cliente.
create or replace function public.vessel_desfazer_baixa(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, ''))); v_n int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.vessel_baixas
     set desfeita_em = now(), desfeita_por = auth.uid()
   where codigo = v_codigo and desfeita_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return json_build_object('ok', false, 'motivo', 'nao_esta_baixada');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ── O ALERTA QUE DEVOLVE O SINAL PERDIDO ──────────────────────────────────
-- A página da cliente não avisa nada sobre peça baixada (decisão do dono), então
-- o dono não saberia que a bolsa extraviada apareceu. Mas a página JÁ registra
-- toda leitura — então o painel avisa, sem incomodar quem está com a bolsa.
create or replace function public.vessel_alertas()
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v json;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select json_build_object(
    'ok', true,
    'repetidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)                  as leituras,
               count(distinct l.ip_hash) as aparelhos,
               max(l.lido_em)            as ultima
          from public.vessel_leituras l
         where l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
        having count(distinct l.ip_hash) >= 5
         order by count(distinct l.ip_hash) desc
         limit 20
      ) x), '[]'::json),
    'invalidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)       as tentativas,
               max(l.lido_em) as ultima
          from public.vessel_leituras l
         where not l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
         order by count(*) desc
         limit 20
      ) x), '[]'::json),
    'baixadas_lidas', coalesce((
      select json_agg(x) from (
        select b.codigo,
               b.motivo,
               count(l.*)     as leituras,
               max(l.lido_em) as ultima
          from public.vessel_baixas b
          join public.vessel_leituras l
            on l.codigo = b.codigo and l.achou and l.lido_em > b.baixada_em
         where b.desfeita_em is null
         group by b.codigo, b.motivo
         order by max(l.lido_em) desc
         limit 20
      ) x), '[]'::json),
    'total_leituras', (select count(*) from public.vessel_leituras where lido_em > now() - interval '30 days')
  ) into v;
  return v;
end;
$$;

revoke all on function public.vessel_baixar_peca(text, text) from public, anon;
revoke all on function public.vessel_desfazer_baixa(text) from public, anon;
grant execute on function public.vessel_baixar_peca(text, text) to authenticated;
grant execute on function public.vessel_desfazer_baixa(text) to authenticated;
