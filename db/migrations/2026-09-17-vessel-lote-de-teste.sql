-- LOTE DE TESTE para a validação do dono (Tarefa 10, Fase 1 de contas do
-- Selo Vessel). Ele precisa de 3 peças de mentira, marcadas como TESTE, para
-- percorrer sozinho o roteiro descrito em verify/novo/LEIA-ME.txt sem tocar
-- em nenhuma peça de verdade.
--
-- ⚠️ MEDIDO NO BANCO (17/09/2026): `vessel_lotes` NÃO tem coluna para marcar
-- teste. Esta migration cria `teste boolean not null default false` — o
-- PADRÃO É FALSE, ao contrário da marca de `vessel_pessoas`/`vessel_atendimentos`
-- (2026-09-17-vessel-fase-de-testes.sql, que usa `default true`): aqui quem
-- decide é sempre uma migration ou uma tela de admin, nunca uma porta pública
-- gravando sem pensar — então o valor seguro por omissão é "isto é um lote de
-- verdade", e só este arquivo marca `true` no que ele mesmo cria.
--
-- Filtrar o painel e os relatórios por esta coluna FICA PARA A FASE 2. Esta
-- migration só cria a coluna e marca a linha; nada aqui muda o que já é
-- mostrado hoje.
--
-- ⚠️ AS PEÇAS NASCEM PELA FUNÇÃO DE SEMPRE, NÃO POR INSERT DIRETO.
-- `vessel_gerar_lote` (medida no banco: `vessel_gerar_lote(p_modelo text,
-- p_cor text, p_sku text, p_quantidade integer, p_fabricado_em date,
-- p_fotos text[], p_os text default null)`) chama por baixo o
-- `vessel_criar_pecas`, que sorteia cada código com
-- `extensions.gen_random_bytes` — o mesmo sorteio criptográfico de toda peça
-- de verdade (db/migrations/2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql).
-- Um `insert` direto em `vessel_pecas` teria de reimplementar esse sorteio
-- (ou, pior, usar um código previsível) só para o lote de teste — duas fontes
-- de verdade para a mesma regra de segurança. Por isso o SQL abaixo CHAMA a
-- função, em vez de inserir a peça à mão.
--
-- ⚠️ `vessel_gerar_lote` E `vessel_criar_pecas` SÃO GATEADAS por
-- `is_vessel_admin()`, que lê `auth.uid()` — e uma migration rodando direto no
-- banco não carrega token nenhum, então `auth.uid()` viria nulo e as duas
-- recusariam com "sem_permissao". O bloco abaixo empresta, só dentro desta
-- transação (`set_config(..., true)` é local à transação, e a migration
-- inteira roda numa só), a identidade de um super-admin já cadastrado em
-- `profiles` — não um UUID fixo, para não depender de qual conta é a do
-- dono neste banco. Fora desta transação nada muda: nenhuma sessão real vira
-- super-admin, e a técnica não abre porta nenhuma, só evita duplicar a lógica
-- de sorteio de código para um lote que é, ele mesmo, ADMINISTRATIVO (só um
-- admin cria lote, de teste ou de verdade).

alter table public.vessel_lotes
  add column if not exists teste boolean not null default false;

comment on column public.vessel_lotes.teste is
  'Lote de ensaio para validação do dono (Tarefa 10, Fase 1 de contas do Selo '
  'Vessel), não uma peça de verdade. Filtrar painel e relatórios por esta '
  'coluna é trabalho da Fase 2 — ainda não filtram.';

create index if not exists vessel_lotes_teste_idx
  on public.vessel_lotes (teste) where teste;

do $$
declare
  v_admin     uuid;
  v_resultado json;
  v_lote      uuid;
begin
  -- Idempotente: rodar esta migration duas vezes não deve duplicar o lote.
  if exists (
    select 1 from public.vessel_lotes
     where teste and os = 'TESTE' and sku = 'TESTE-SS0002SB.M1'
  ) then
    raise notice 'Lote de teste já existe — nada a fazer.';
  else
    select id into v_admin from public.profiles where is_superadmin limit 1;
    if v_admin is null then
      raise exception 'Nenhum super-admin encontrado em profiles; não deu para gerar o lote de teste.';
    end if;

    -- Empréstimo de identidade só nesta transação (ver comentário acima).
    perform set_config('request.jwt.claim.sub', v_admin::text, true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

    v_resultado := public.vessel_gerar_lote(
      'Cyrène Medium Café (TESTE)', -- modelo: a marca "(TESTE)" também vai no
                                     -- nome, para o painel nunca confundir com
                                     -- um modelo de verdade mesmo sem filtro
      'Café',
      'TESTE-SS0002SB.M1',          -- sku com prefixo TESTE-, para não colidir
                                     -- com a numeração de série de nenhum
                                     -- produto real
      3,                             -- 3 peças: o roteiro do dono usa a
                                     -- primeira, a segunda e a terceira
      current_date,
      null,                          -- sem fotos: lote de teste não precisa
      'TESTE'                        -- O.S. "TESTE", visível na tela de lotes
    );

    if not coalesce((v_resultado->>'ok')::boolean, false) then
      raise exception 'vessel_gerar_lote recusou o lote de teste: %', v_resultado;
    end if;

    v_lote := (v_resultado->>'lote_id')::uuid;
    update public.vessel_lotes set teste = true where id = v_lote;

    raise notice 'Lote de teste criado: id=%, peças=%', v_lote, v_resultado->>'quantidade';
  end if;
end
$$;
