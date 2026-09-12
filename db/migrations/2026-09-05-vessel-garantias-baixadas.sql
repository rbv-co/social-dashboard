-- APLICADA EM 05/09/2026. Registro do que foi para producao.
--
-- BAIXAR A GARANTIA DE UMA PECA QUE VOLTOU, GUARDANDO O HISTORICO.
-- Pedido do dono: "caso a cliente devolver depois de ter validado a garantia,
-- coloca a garantia como baixada e mantem historico no sistema".
--
-- ⚠️ BAIXAR E MOVER, NAO MARCAR — e a escolha tem duas razoes MEDIDAS:
--   1. `vessel_registros` tem PRIMARY KEY (codigo): uma garantia por peca. Com a
--      linha fora de la, a chave libera e a PROXIMA dona registra normalmente,
--      que foi a decisao do dono. Marcando com uma coluna, seria preciso trocar
--      a chave primaria de uma tabela com 12 funcoes em cima.
--   2. DOZE funcoes leem `vessel_registros`. Marcando, CADA UMA teria de
--      aprender a ignorar as baixadas — e bastaria UMA esquecida para as
--      iniciais da dona anterior aparecerem num canto da tela ou na pagina
--      PUBLICA do selo. Movendo, esse buraco nao chega a existir.
--
-- ⚠️ A TRAVA FOI CONFERIDA CONTRA AS IRMAS, e nao escrita de cabeca. A irma
-- certa e `vessel_edicoes` (a trilha): RLS ligada, `anon` NAO le, `authenticated`
-- le so se for admin, e NINGUEM escreve direto. Esta tabela guarda CPF, nome e
-- WhatsApp: merece a trava da trilha, e nao a de `vessel_registros`, que anon
-- alcanca. Ja subiu tabela sem trava nesta casa, e nove revisoes passaram batido.
--
-- ⚠️ E FOI PRECISO UMA SEGUNDA MIGRATION (ver o arquivo irmao desta data): a
-- tabela nasceu com INSERT/UPDATE/DELETE para `authenticated`, pela concessao
-- padrao do Supabase. `grant select` nao retira o resto.
--
-- PROVADO em transacao com ROLLBACK, sem sujar dado real: com a garantia ativa a
-- pagina mostrava "Fulana D."; depois do movimento ela abre igual, com
-- `registrada: false`, dono VAZIO e o modelo intacto — autenticidade preservada,
-- dona anterior fora do ar. O historico ficou com nome, CPF e motivo.
--
-- ⚠️ O SQL ABAIXO E O QUE ESTA NO BANCO, e nao um resumo. Ele estava so no
-- banco, com este arquivo apontando para la — e isso escondeu um defeito: a
-- guarda `db/trilha-de-edicoes.test.mjs` confere se toda acao escrita na trilha
-- existe na lista de acoes permitidas, e ela nao tinha como ver uma funcao que
-- nao estava no repositorio. Migration que aponta para o banco nao e migration.

create table if not exists public.vessel_garantias_baixadas (
  id                bigint generated always as identity primary key,
  codigo            text not null,
  nome              text,
  whatsapp          text,
  cpf               text,
  onde_comprou      text,
  comprado_em       date,
  garantia_ate      date,
  registrado_em     timestamptz,
  bling_contato_id  text,
  bling_pedido      text,
  motivo            text not null,
  baixada_em        timestamptz not null default now(),
  baixada_por       uuid
);

alter table public.vessel_garantias_baixadas enable row level security;

-- SO LEITURA, e so para quem e admin. Escrever aqui e privilegio da funcao
-- abaixo (SECURITY DEFINER): historico que o front pode editar nao e historico.
create policy vessel_garantias_baixadas_read
  on public.vessel_garantias_baixadas for select
  to authenticated using (public.is_vessel_admin());

grant select on public.vessel_garantias_baixadas to authenticated;

create or replace function public.vessel_baixar_garantia(p_codigo text, p_motivo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_reg    record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- ⚠️ O MOTIVO E SEMPRE OBRIGATORIO AQUI, e nao so "quando e grave" como no
  -- desmarcar gravada. Baixar apaga o vinculo de uma pessoa de verdade com a
  -- bolsa dela; decisao dessas sem motivo escrito vira misterio em tres meses.
  if v_motivo is null then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  select * into v_reg from public.vessel_registros where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'sem_garantia');
  end if;

  insert into public.vessel_garantias_baixadas (
    codigo, nome, whatsapp, cpf, onde_comprou, comprado_em, garantia_ate,
    registrado_em, bling_contato_id, bling_pedido, motivo, baixada_por)
  values (
    v_reg.codigo, v_reg.nome, v_reg.whatsapp, v_reg.cpf, v_reg.onde_comprou,
    v_reg.comprado_em, v_reg.garantia_ate, v_reg.registrado_em,
    v_reg.bling_contato_id, v_reg.bling_pedido, v_motivo, auth.uid());

  -- ⚠️ SO APAGA DEPOIS DE GUARDAR. Na ordem inversa, uma falha no meio perderia
  -- a garantia da cliente para sempre. Como as duas rodam na mesma transacao da
  -- funcao, ou as duas acontecem ou nenhuma acontece.
  delete from public.vessel_registros where codigo = v_codigo;

  -- A TRILHA TAMBEM, como toda acao que muda o mundo nesta tela.
  -- ⚠️ 'baixar_garantia' PRECISA estar na lista de vessel_edicoes_acao_check,
  -- senao este insert derruba a transacao inteira e nada acontece nunca. Foi
  -- exatamente o que aconteceu — ver o arquivo irmao desta data.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'baixar_garantia', v_motivo,
          jsonb_build_object('registrado_em', v_reg.registrado_em,
                             'garantia_ate', v_reg.garantia_ate),
          auth.uid());

  return json_build_object('ok', true, 'codigo', v_codigo,
    'aviso', 'A garantia foi encerrada. A pagina do selo volta a mostrar a bolsa '
          || 'sem dona, e ela pode ser registrada de novo por quem comprar.');
end;
$function$;

-- A CONCESSAO PADRAO DO SUPABASE da EXECUTE para anon em funcao nova. Aqui nao.
revoke execute on function public.vessel_baixar_garantia(text, text) from anon;
grant  execute on function public.vessel_baixar_garantia(text, text) to authenticated;
