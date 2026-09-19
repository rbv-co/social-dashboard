-- MEXER NA BEAUTY SESSION: editar, apagar e arquivar.
--
-- ⚠️ AS TRES USAM `is_vessel_atendimentos_editar()`, nao a trava de ver. Quem
-- so ve continua so vendo, inclusive por fora da tela. (A irma `encerrar`, que
-- e mais antiga, ainda usa a de ver — nao e modelo a copiar aqui.)
--
-- ⚠️ `codigo` NUNCA se edita: ele esta dentro dos DOIS links ja copiados desta
-- sessao — o QR da MESA e o QR do CARTAO — e os dois estao IMPRESSOS, um no
-- display do salao e outro no cartao que a cliente leva na mao. Trocar o
-- codigo mataria os dois de uma vez, sem erro nenhum para denunciar. Por isso
-- ele nao e parametro de `editar`: a garantia e a AUSENCIA dele.
--
-- ⚠️ `p_quando` E `date`, NAO `timestamptz`. A coluna `vessel_beauty_sessions.
-- quando` e `date` (a irma `vessel_beauty_session_criar` ja recebe `date` pela
-- mesma razao). Receber `timestamptz` faria o Postgres converter o instante
-- para dia NO FUSO DA SESSAO na hora de gravar, e a mesma sessao viraria dia
-- 25 ou dia 26 dependendo de quem chamou — num campo que e a data impressa no
-- QR.
--
-- ⚠️ O `codigo` QUE CHEGA E NORMALIZADO IGUALZINHO AO DA IRMA
-- `vessel_beauty_session_encerrar` — `upper(nullif(trim(coalesce(p_codigo,'')),''))`,
-- mesma expressao e mesma ordem (ver
-- `db/migrations/2026-09-18-zzzzz-vessel-beauty-sessions-com-tela.sql`). E
-- copia deliberada, para as duas nao poderem divergir. O motivo: as quatro
-- acoes moram NA MESMA TELA, lado a lado. Um codigo com espaco na ponta ou em
-- minusculas que faz "Encerrar" funcionar e "Editar", "Apagar" e "Arquivar"
-- responderem `nao_achei` e pior do que os quatro recusarem juntos: recusa em
-- bloco a pessoa entende como codigo errado; recusa pela metade ela entende
-- como sistema quebrado, e nao ha nada na tela que explique a diferenca.
--
-- ⚠️ E O VALOR NORMALIZADO VALE PARA A FUNCAO INTEIRA: o `exists`, o `update`,
-- o `delete`, a conferencia de LEITURA e o `codigo` que volta no json. Um so
-- desses lugares lendo `p_codigo` cru ja e um buraco — e este buraco ja custou
-- caro na irma do Private Edit, onde a conferencia de convidadas lia o cru e o
-- `delete` lia o normalizado: um codigo em minusculas APAGOU um encontro com
-- gente dentro, devolvendo `ok`.

create or replace function public.vessel_beauty_session_editar(
  p_codigo text,
  p_quando date default null,
  p_loja   text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ Campo nulo = "nao mexe neste", nunca "apaga o que estava la". No caso de
  -- `loja` o `coalesce` e o que separa uma edicao de dia de um erro de banco na
  -- cara da pessoa: a coluna e `not null`.
  --
  -- ⚠️ A SESSAO NAO TEM ANFITRIA NEM VAGAS — por isso so `quando` e `loja`.
  -- `praca` e `parceiro` ficam de fora de proposito: a praca esta embutida no
  -- proprio codigo impresso (BS-AAAAMMDD-PRACA-SEQ) e mudar uma sem a outra
  -- deixaria a linha discordando do QR.
  update public.vessel_beauty_sessions
     set quando = coalesce(p_quando, quando),
         loja   = coalesce(p_loja, loja)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

create or replace function public.vessel_beauty_session_apagar(p_codigo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR UMA SESSAO JA LIDA deixaria as leituras do QR SEM SESSAO, e a
  -- conta passaria a somar sobre uma sessao que nao existe mais. Para essas, a
  -- tela oferece os outros dois caminhos:
  --   · ENCERRAR  — aconteceu e acabou; continua contando no historico.
  --   · ARQUIVAR  — nao devia estar ali; sai das contas e da lista, o dado fica.
  --
  -- ⚠️ "TER GENTE" AQUI E LEITURA DO QR, nao convidada: a Beauty Session nao
  -- tem lista de convidadas. A tabela e `public.vessel_sessao_aberturas` e a
  -- ligacao e PELA COLUNA `codigo` — exatamente a mesma que a funcao de conta
  -- ja usa (`2026-09-18-vessel-contar-as-beauty-sessions.sql`: `a.codigo =
  -- s.codigo`). Nao existe coluna `sessao_codigo` nessa tabela; uma tabela ou
  -- coluna parecida contaria outra coisa.
  --
  -- ⚠️ E SEM FILTRAR POR `peca`. A conta separa 'mesa' de 'cartao' porque
  -- quer saber qual peca funciona melhor; para "alguem ja leu este QR?",
  -- QUALQUER peca conta — inclusive `peca` nula, que a coluna aceita. Copiar o
  -- `and a.peca = 'mesa'` da conta apagaria uma sessao lida so pelo cartao.
  --
  -- ⚠️ E AQUI TAMBEM E `v_codigo`, NAO `p_codigo`. Se esta linha lesse o cru
  -- enquanto o `delete` abaixo le o normalizado, um codigo em minusculas nao
  -- acharia leitura nenhuma e o `delete` apagaria uma sessao JA LIDA —
  -- exatamente o estrago que esta conferencia existe para impedir.
  if exists (select 1 from public.vessel_sessao_aberturas where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_beauty_sessions where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

create or replace function public.vessel_beauty_session_arquivar(
  p_codigo text,
  p_arquivada boolean default true
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ ARQUIVAR NAO E ENCERRAR, e `ativa` nao e tocada aqui. Encerrada continua
  -- contando (e historico); arquivada sai das contas e da lista.
  --
  -- ⚠️ `coalesce(p_arquivada, true)`: quando a tela manda so o codigo — ou
  -- quando o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "arquivar" tem de significar ARQUIVAR. Sem o `coalesce`, a coluna e
  -- `not null` e a chamada morreria com erro de banco na cara da pessoa.
  update public.vessel_beauty_sessions
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- ⚠️ AS DUAS LINHAS, PARA CADA UMA: `revoke ... from public` NAO fecha
-- `authenticated`. E funcao nova nasce aberta para `public` — ou seja, tambem
-- para `anon`, que e quem abre a pagina do QR da Beauty Session.
revoke all on function public.vessel_beauty_session_editar(text, date, text) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_editar(text, date, text) to authenticated;
revoke all on function public.vessel_beauty_session_apagar(text) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_apagar(text) to authenticated;
revoke all on function public.vessel_beauty_session_arquivar(text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_arquivar(text, boolean) to authenticated;
