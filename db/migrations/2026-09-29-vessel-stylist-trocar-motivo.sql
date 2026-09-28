-- TROCAR O MOTIVO DA SAÍDA SEM MUDAR A ETAPA (decisão do dono, 29/09/2026).
--
-- Até aqui o motivo só se gravava na CHEGADA a uma saída
-- (`vessel_stylist_mover_de_etapa` → gatilho `vessel_stylists_etapa_depois`),
-- e mover para a mesma etapa responde `sem_mudanca` sem gravar nada. Duas
-- stylists da Edição 1 (Campinas) saíram por "Outro" quando o certo era
-- "Indisponível na data" — e só esse motivo as traz de volta na próxima
-- edição. Sem esta porta, o único jeito seria tirar e pôr de novo na etapa
-- (um movimento que não aconteceu).
--
-- A porta nova, `vessel_stylist_trocar_motivo(codigo, motivo, nota)`:
--   • só para quem ESTÁ numa etapa de saída; o motivo tem de ser DESSA saída,
--     ativo, e a nota vem quando o motivo pede (a MESMA
--     `vessel_stylist_conferir_motivo` do mover);
--   • acrescenta UMA linha ao histórico (a tabela só acrescenta) com a mesma
--     etapa em `de` e `para`, `motivo = 'troca_de_motivo'`, o motivo novo e a
--     nota — e é essa a última linha que `vessel_stylist_saida_atual` lê;
--   • `liberava_private_edit = false`: troca não é chegada (a ativação é a 1ª
--     CHEGADA numa etapa que libera, e fica como estava);
--   • `p_nota` nula ou vazia = mantém a nota atual;
--   • motivo e nota iguais aos de hoje = `sem_mudanca`, nenhuma linha;
--   • chama `vessel_edicao_marcar_movimento` (a mesma do mover): com motivo
--     `volta_na_proxima_edicao` marca `indisponivel_em` na edição aberta da
--     praça, sem apagar marca nenhuma.
-- Trava: `vessel_pode('atendimentos.stylist-circle', 'editar')`, senão 42501.

-- ── 1. a lista fechada do porquê ganha 'troca_de_motivo' ─────────────────────
alter table public.vessel_stylist_etapas_historico
  drop constraint vessel_stylist_etapas_historico_motivo_valido;
alter table public.vessel_stylist_etapas_historico
  add constraint vessel_stylist_etapas_historico_motivo_valido
  check (motivo = any (array['cadastro'::text, 'mudanca'::text, 'etapa_excluida'::text, 'troca_de_motivo'::text]));

-- ── 2. a porta ───────────────────────────────────────────────────────────────
create or replace function public.vessel_stylist_trocar_motivo(p_codigo text, p_motivo_id bigint, p_nota text default null)
returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
  v_e      public.vessel_stylist_etapas%rowtype;
  v_atual  record;
  v_nota   text;
  v_recusa text;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  -- trava a linha dela: um mover ao mesmo tempo espera esta troca terminar
  select * into v_s from public.vessel_stylists where codigo = v_codigo for update;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_e from public.vessel_stylist_etapas where id = v_s.etapa_id;
  if v_e.id is null or v_e.tipo <> 'saida' then
    return json_build_object('ok', false, 'situacao', 'nao_esta_em_saida', 'codigo', v_codigo, 'etapa', v_e.nome);
  end if;
  select * into v_atual from public.vessel_stylist_saida_atual(v_s.id);
  v_nota := coalesce(nullif(btrim(coalesce(p_nota, '')), ''), v_atual.nota);
  v_recusa := public.vessel_stylist_conferir_motivo(v_e.id, p_motivo_id, v_nota);
  if v_recusa is null and p_motivo_id is null then
    v_recusa := 'motivo_obrigatorio';   -- saída sem motivos: não há o que trocar
  end if;
  if v_recusa is not null then
    return json_build_object('ok', false, 'situacao', v_recusa, 'codigo', v_codigo, 'etapa', v_e.nome);
  end if;
  if v_atual.motivo_id is not distinct from p_motivo_id and v_atual.nota is not distinct from v_nota then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'codigo', v_codigo);
  end if;
  insert into public.vessel_stylist_etapas_historico
    (stylist_id, de_etapa_id, para_etapa_id, motivo, por, por_nome, teste, motivo_id, nota, liberava_private_edit)
  values (v_s.id, v_e.id, v_e.id, 'troca_de_motivo', auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          coalesce(v_s.teste, false), p_motivo_id, v_nota, false);
  perform public.vessel_edicao_marcar_movimento(v_s.id, v_e.id, p_motivo_id);
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo, 'etapa', v_e.nome,
    'motivo_id', p_motivo_id, 'motivo_anterior_id', v_atual.motivo_id,
    'motivo', (select nome from public.vessel_stylist_motivos_de_saida where id = p_motivo_id));
end;
$$;

revoke all on function public.vessel_stylist_trocar_motivo(text, bigint, text) from public, anon;
grant execute on function public.vessel_stylist_trocar_motivo(text, bigint, text) to authenticated;
