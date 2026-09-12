-- EDIÇÃO DE ETIQUETA JÁ GRAVADA — desmarcar e sobrescrever, com trilha.
--
-- ⚠️ ORDEM ALFABÉTICA. `coletor/run-migrations.mjs` aplica os arquivos em ordem
-- alfabética. `2026-09-01` cai DEPOIS de `2026-08-30-vessel-zz-fecha-o-portao-e-
-- garantias.sql`, e é de propósito: este arquivo recria `vessel_baixar_peca`
-- (para aceitar o motivo 'teste') e, a partir dele, passa a ser A PALAVRA FINAL
-- sobre essa função. Se alguém criar depois um arquivo com data anterior mexendo
-- nela, o buraco de 30/08 volta em banco novo — foi exatamente assim que
-- `vessel_criar_pecas` perdeu o portão por meia hora na produção.
--
-- ══════════════════════════════════════════════════════════════════════════
-- A REGRA DE OURO DESTE PROJETO, repetida aqui porque já custou caro
-- ══════════════════════════════════════════════════════════════════════════
-- `revoke all on function ... from public, anon` NÃO tira a concessão que o
-- Postgres dá por DEFAULT PRIVILEGES a `authenticated` em função nova do schema
-- public. Uma função `security definer` sem portão por dentro fica alcançável
-- por QUALQUER pessoa logada na Central, mesmo sem a chave 'autenticidade'.
-- Documentado em `2026-07-31-saude-dos-robos.sql` e pago em produção em 30/08.
--
-- Por isso toda função nova daqui leva AS DUAS TRAVAS:
--   1. `revoke all ... from public, anon, authenticated` e só depois o
--      `grant execute ... to authenticated` das que a tela chama;
--   2. o portão por dentro: `if not public.is_vessel_admin() then ...`.
--
-- E as duas viram asserção em `docs/provar-editar-etiquetas.sql` — inclusive
-- `has_function_privilege('authenticated', ..., 'execute') = false` ANTES do
-- grant final, que é a única asserção que pega QUEM PODE CHAMAR. Nenhuma
-- asserção de comportamento pega isso: elas medem o que a função FAZ.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A TRILHA
-- ══════════════════════════════════════════════════════════════════════════
--
-- Desmarcar uma gravação e sobrescrever uma etiqueta são atos DESTRUTIVOS e
-- INVISÍVEIS: a etiqueta já está costurada dentro de uma bolsa, e depois de
-- desfeita a marca no banco não sobra sinal nenhum de que ela existiu. Sem
-- trilha, ninguém responde "por que a peça 7 voltou para a fila em setembro".
--
-- POR QUE A COLUNA `codigo` NÃO TEM CHAVE ESTRANGEIRA, diferente de
-- `vessel_baixas.codigo`: lá o `on delete cascade` é certo — baixa de peça que
-- não existe mais não significa nada. Aqui seria o contrário: a peça pode ser
-- excluída depois, e a trilha do que foi feito com ela é justamente o que tem
-- de sobreviver. Chave estrangeira com cascade APAGARIA a auditoria; com
-- `set null` a linha viraria um registro sem sujeito. Fica o texto, solto e de
-- propósito.
create table if not exists public.vessel_edicoes (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null,
  acao      text not null check (acao in ('desmarcar_gravada',
                                          'sobrescrever_para_fila',
                                          'sobrescrever_para_baixa')),
  motivo    text,
  -- o que não cabe em coluna: o código novo da sobrescrita, e se havia garantia
  detalhes  jsonb not null default '{}'::jsonb,
  feito_por uuid,
  feito_em  timestamptz not null default now()
);

create index if not exists vessel_edicoes_codigo_idx on public.vessel_edicoes(codigo, feito_em desc);

alter table public.vessel_edicoes enable row level security;

-- CONFERIDO CONTRA AS TABELAS IRMÃS antes de escrever, e não de cabeça:
-- `vessel_lotes`, `vessel_pecas`, `vessel_registros`, `vessel_leituras` e
-- `vessel_baixas` têm todas EXATAMENTE UMA política, de SELECT, para
-- `authenticated`, com `using (public.is_vessel_admin())`. Nenhuma tem política
-- de escrita: quem escreve são as funções `security definer`, que rodam como
-- dona da tabela e passam por cima da RLS. Esta nasce igual às cinco.
drop policy if exists vessel_edicoes_read on public.vessel_edicoes;
create policy vessel_edicoes_read on public.vessel_edicoes
  for select to authenticated using (public.is_vessel_admin());

-- A SEGUNDA TRAVA DA TABELA, no mesmo espírito das duas travas das funções. A
-- RLS sem política de INSERT já barra a escrita direta — mas o Supabase concede
-- ALL em tabela nova do schema public para `anon` e `authenticated` por default
-- privileges, então a única coisa entre a chave anônima e um INSERT é a RLS.
-- Ligar a RLS e revogar o privilégio são duas portas; uma sozinha volta a falhar
-- no dia em que alguém criar uma política de escrita "só para facilitar".
revoke insert, update, delete, truncate on table public.vessel_edicoes from public, anon, authenticated;

-- E O SELECT DE `anon` TAMBÉM SAI — aqui a trilha é MAIS FECHADA que as irmãs,
-- de propósito. Medido em 01/09/2026: as seis tabelas `vessel_*` que já existiam
-- têm `has_table_privilege('anon', ..., 'select') = true`, e quem barra é só a
-- RLS. Para elas, mexer agora seria mudar tabela que a tela já lê — não é hora.
-- Esta nasce hoje, ninguém a lê com a chave anônima, e ela é a mais sensível do
-- conjunto: guarda QUEM apagou a gravação de QUAL peça e por quê. Duas portas
-- custam uma linha; uma porta só volta a falhar no dia em que alguém afrouxar a
-- política "só para facilitar".
revoke select on table public.vessel_edicoes from public, anon;

comment on table public.vessel_edicoes is
  'Trilha das ações destrutivas sobre etiqueta já gravada (desmarcar e '
  'sobrescrever). Só vessel_desmarcar_gravada e vessel_sobrescrever_etiqueta '
  'escrevem aqui; leitura só para quem passa por is_vessel_admin().';

-- ══════════════════════════════════════════════════════════════════════════
-- 2. DESMARCAR GRAVADA
-- ══════════════════════════════════════════════════════════════════════════
--
-- Devolve a peça para a fila, apagando `gravada_em`. É o desfazer de
-- `vessel_marcar_gravada`, para o clique errado no meio de vinte etiquetas
-- fisicamente idênticas.
--
-- A DECISÃO DO DONO, EXPLÍCITA: peça COM garantia registrada PODE ser
-- desmarcada. Não é o mesmo caso de `vessel_excluir_peca`, que recusa por
-- `tem_garantia` — lá a peça sumiria e o `on delete cascade` de
-- `vessel_registros` levaria a garantia da cliente junto. Aqui nada é apagado: o
-- código continua existindo e a garantia continua pendurada nele. O que muda é
-- que a peça volta para a fila de gravação.
--
-- Em compensação, quando há garantia a ação EXIGE motivo escrito e sempre entra
-- na trilha, e a resposta devolve um aviso — porque uma bolsa que já está com
-- uma cliente voltar para a fila é coisa que alguém vai precisar explicar.
create or replace function public.vessel_desmarcar_gravada(p_codigo text, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_codigo  text := upper(trim(coalesce(p_codigo, '')));
  v_motivo  text := nullif(trim(coalesce(p_motivo, '')), '');
  v_gravada timestamptz;
  v_tinha   boolean;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- A existência vem PRIMEIRO: sem isso, `v_gravada` viria nula por a peça não
  -- existir e a função devolveria 'nao_esta_gravada' — motivo errado para o que
  -- de fato aconteceu, e a tela diria a frase errada.
  select gravada_em into v_gravada from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is null then
    return json_build_object('ok', false, 'motivo', 'nao_esta_gravada');
  end if;

  v_tinha := exists (select 1 from public.vessel_registros where codigo = v_codigo);

  -- Motivo em branco só é recusado quando HÁ garantia. Desmarcar uma peça que
  -- ninguém registrou é conserto de bancada; desmarcar a de uma cliente é uma
  -- decisão, e decisão sem motivo escrito vira mistério em três meses.
  if v_tinha and v_motivo is null then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  update public.vessel_pecas set gravada_em = null where codigo = v_codigo;

  -- A TRILHA É SEMPRE, com ou sem garantia. Gravar só o caso "grave" faria o
  -- histórico mentir por omissão: 40 peças desmarcadas e nenhuma linha.
  -- `feito_por` sai de auth.uid(), NUNCA de parâmetro — por parâmetro, quem
  -- chama poderia dizer que foi outra pessoa. Mesma regra de vessel_baixar_peca.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'desmarcar_gravada', v_motivo,
          jsonb_build_object('tinha_garantia', v_tinha, 'gravada_em_antes', v_gravada),
          auth.uid());

  return json_build_object(
    'ok', true,
    'codigo', v_codigo,
    'tinha_garantia', v_tinha,
    'aviso', case when v_tinha
      then 'Esta peça tem garantia registrada por uma cliente. A garantia continua valendo, '
        || 'mas a peça voltou para a fila de gravação. A ação ficou na trilha.'
      else null end);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. SOBRESCREVER ETIQUETA
-- ══════════════════════════════════════════════════════════════════════════
--
-- O caso real: a pessoa pega uma etiqueta NFC para gravar e ela JÁ TEM outra
-- peça dentro. Gravar por cima faz o código antigo deixar de existir no mundo
-- físico — e a peça antiga não pode simplesmente ficar marcada como gravada,
-- porque a etiqueta dela acabou de ser reciclada.
--
-- POR QUE UMA FUNÇÃO SÓ, E NÃO DUAS CHAMADAS DA TELA: entre "desmarcar a antiga"
-- e "marcar a nova" há uma janela. Se a segunda chamada falhar — rede caindo,
-- aba fechada, token expirando —, as DUAS peças ficam gravadas com a mesma
-- etiqueta física, ou nenhuma fica. O corpo de uma função plpgsql é uma
-- transação só: ou os dois updates e a linha da trilha entram juntos, ou não
-- entra nada. Meia operação aqui deixa duas bolsas com a mesma identidade.
--
-- `p_destino` é a decisão do dono sobre a peça ANTIGA, e ele pediu os dois:
--   'fila'  → volta para a fila, esperando etiqueta nova;
--   'baixa' → sai da fila com baixa ativa, usando o motivo recebido.
create or replace function public.vessel_sobrescrever_etiqueta(
  p_codigo_antigo text, p_codigo_novo text, p_destino text, p_motivo text
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare
  v_antigo  text := upper(trim(coalesce(p_codigo_antigo, '')));
  v_novo    text := upper(trim(coalesce(p_codigo_novo, '')));
  v_destino text := lower(trim(coalesce(p_destino, '')));
  v_motivo  text := nullif(trim(coalesce(p_motivo, '')), '');
  v_gravada timestamptz;
  v_nova_gravada timestamptz;
  v_tinha   boolean;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- O destino vem ANTES de tudo que toca no banco: é o parâmetro que decide o
  -- caminho inteiro, e conferir depois faria a função descobrir tarde demais
  -- que não sabe o que fazer com a peça antiga.
  if v_destino not in ('fila', 'baixa') then
    return json_build_object('ok', false, 'motivo', 'destino_invalido');
  end if;

  -- A MESMA PEÇA NOS DOIS CAMPOS: sem esta recusa, a função desmarcaria e
  -- remarcaria a mesma peça (destino 'fila'), ou a marcaria gravada e baixada ao
  -- mesmo tempo (destino 'baixa'), gravando na trilha um evento que não houve.
  if v_antigo = v_novo then
    return json_build_object('ok', false, 'motivo', 'mesma_peca');
  end if;

  -- Os dois códigos existem, e a recusa DIZ QUAL falta: "peca_nao_existe" seco
  -- deixaria a pessoa recarregando a tela sem saber qual dos dois ela digitou
  -- errado.
  select gravada_em into v_gravada from public.vessel_pecas where codigo = v_antigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'antiga_nao_existe');
  end if;
  select gravada_em into v_nova_gravada from public.vessel_pecas where codigo = v_novo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'nova_nao_existe');
  end if;

  -- A antiga TEM de estar gravada: se não estiver, não há etiqueta nenhuma
  -- sendo reciclada, e o que a pessoa quer é só marcar a nova como gravada —
  -- `vessel_marcar_gravada` faz isso sem mexer em ninguém.
  if v_gravada is null then
    return json_build_object('ok', false, 'motivo', 'antiga_nao_esta_gravada');
  end if;

  -- ⚠️ ESTA RECUSA NÃO ESTAVA NA LISTA PEDIDA, e está aqui pelo mesmo motivo que
  -- a função existe: se a NOVA já está gravada, ela já tem uma etiqueta física
  -- por aí. Marcá-la de novo colocaria o mesmo código em DUAS etiquetas, em duas
  -- bolsas — o defeito que este arquivo inteiro veio impedir — e a etiqueta
  -- antiga dela sumiria da trilha sem ninguém saber.
  if v_nova_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'nova_ja_gravada');
  end if;

  v_tinha := exists (select 1 from public.vessel_registros where codigo = v_antigo);

  -- MESMA REGRA DE `vessel_desmarcar_gravada`, porque é o mesmo ato: tirar da
  -- peça de uma cliente a marca de gravada exige motivo escrito.
  if v_tinha and v_motivo is null then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- No destino 'baixa' o motivo não é só texto de auditoria: ele vai para
  -- `vessel_baixas.motivo`, que tem `check`. Conferir aqui devolve
  -- 'motivo_invalido' em vez de estourar o check com erro cru do Postgres — 500
  -- na tela, em vez da recusa que o desenho promete. Foi o mesmo tropeço do
  -- motivo nulo em `vessel_baixar_peca`, em 30/08.
  if v_destino = 'baixa'
     and coalesce(v_motivo, '') not in ('extraviada','defeito','devolvida','etiqueta_perdida','teste') then
    return json_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;

  -- ── daqui para baixo, tudo ou nada ──────────────────────────────────────
  update public.vessel_pecas set gravada_em = null where codigo = v_antigo;

  if v_destino = 'baixa' then
    -- O `if not exists` não é excesso de zelo: uma peça pode estar gravada E já
    -- baixada (baixada depois de gravada é o caso comum). Sem ele, o índice
    -- único parcial `vessel_baixas_ativa_idx` estouraria e derrubaria a
    -- sobrescrita inteira por causa de uma baixa que já dizia a mesma coisa.
    if not exists (select 1 from public.vessel_baixas
                    where codigo = v_antigo and desfeita_em is null) then
      insert into public.vessel_baixas (codigo, motivo, baixada_por)
      values (v_antigo, v_motivo, auth.uid());
    end if;
  end if;

  update public.vessel_pecas set gravada_em = now() where codigo = v_novo;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_antigo,
          case when v_destino = 'baixa' then 'sobrescrever_para_baixa'
                                        else 'sobrescrever_para_fila' end,
          v_motivo,
          jsonb_build_object('codigo_novo', v_novo,
                             'destino', v_destino,
                             'tinha_garantia', v_tinha,
                             'gravada_em_antes', v_gravada),
          auth.uid());

  return json_build_object(
    'ok', true,
    'codigo_antigo', v_antigo,
    'codigo_novo', v_novo,
    'destino', v_destino,
    'tinha_garantia', v_tinha,
    'aviso', case when v_tinha
      then 'A peça ' || v_antigo || ' tem garantia registrada por uma cliente. A garantia '
        || 'continua valendo no código dela. A ação ficou na trilha.'
      else null end);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 4. O MOTIVO DE BAIXA NOVO: 'teste'
-- ══════════════════════════════════════════════════════════════════════════
--
-- CONFERIDO NO BANCO, não suposto: os motivos NÃO são texto livre. Eles estão
-- escritos em TRÊS lugares, e os três precisam concordar:
--   1. `check (motivo in (...))` na coluna `vessel_baixas.motivo`
--      (`2026-08-30-vessel-baixas.sql`);
--   2. o `if ... not in (...)` dentro de `vessel_baixar_peca`
--      (reescrito em `2026-08-30-vessel-zz-...`);
--   3. `MOTIVOS_DE_BAIXA`, em `src/ferramentas/autenticidade/lotes.js`.
-- Este arquivo acerta 1 e 2. O 3 é no front, e está FORA desta migration.
--
-- O `check` inline nasceu sem nome escolhido, então o Postgres deu
-- `vessel_baixas_motivo_check`. Em vez de confiar nesse nome, o bloco abaixo
-- procura QUALQUER check da tabela que fale de 'extraviada' e derruba — assim a
-- migration funciona também num banco onde a constraint tenha sido recriada com
-- outro nome, em vez de falhar calada deixando o motivo novo barrado.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.vessel_baixas'::regclass
              and contype = 'c'
              and pg_get_constraintdef(oid) like '%extraviada%'
  loop
    execute format('alter table public.vessel_baixas drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.vessel_baixas
  add constraint vessel_baixas_motivo_check
  check (motivo in ('extraviada','defeito','devolvida','etiqueta_perdida','teste'));

-- E a função, com a MESMA lista. Recriada por necessidade: sem isto o `check`
-- aceitaria 'teste' e a função continuaria devolvendo 'motivo_invalido' — a
-- trava mais fechada é a que manda, e ela é a de dentro da função. Tudo o mais
-- no corpo é idêntico ao de `2026-08-30-vessel-zz-...`, inclusive o
-- `coalesce(p_motivo, '')` que conserta o motivo NULO.
create or replace function public.vessel_baixar_peca(p_codigo text, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(p_motivo, '') not in ('extraviada','defeito','devolvida','etiqueta_perdida','teste') then
    return json_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  if not exists (select 1 from public.vessel_pecas where codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if exists (select 1 from public.vessel_baixas
              where codigo = v_codigo and desfeita_em is null) then
    return json_build_object('ok', false, 'motivo', 'ja_baixada');
  end if;
  insert into public.vessel_baixas (codigo, motivo, baixada_por)
  values (v_codigo, p_motivo, auth.uid());
  return json_build_object('ok', true, 'codigo', v_codigo, 'motivo_da_baixa', p_motivo);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- AS CONCESSÕES, por último e por inteiro
-- ══════════════════════════════════════════════════════════════════════════
-- `authenticated` no `revoke` é o que importa, e é o que faltou em 30/08. O
-- `grant` seguinte é o que a tela precisa; sem o revoke antes dele, o grant não
-- estaria concedendo nada — já viria concedido de graça.
revoke all on function public.vessel_desmarcar_gravada(text, text) from public, anon, authenticated;
revoke all on function public.vessel_sobrescrever_etiqueta(text, text, text, text) from public, anon, authenticated;
revoke all on function public.vessel_baixar_peca(text, text) from public, anon, authenticated;

grant execute on function public.vessel_desmarcar_gravada(text, text) to authenticated;
grant execute on function public.vessel_sobrescrever_etiqueta(text, text, text, text) to authenticated;
grant execute on function public.vessel_baixar_peca(text, text) to authenticated;
