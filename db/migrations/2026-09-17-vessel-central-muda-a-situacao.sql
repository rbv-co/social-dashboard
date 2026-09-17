-- A PORTA DE ESCRITA DA CENTRAL — marcar veio, não veio, remarcou.
--
-- ⚠️ POR QUE NÃO REUSAR `vessel_marcar_presenca`. Aquela é a porta do CELULAR:
-- sem login, identifica o atendimento pelo CÓDIGO DO CONVITE (que a Client
-- Advisor tem no aparelho dela), responde "ok" até para código inexistente — de
-- propósito, para não virar um verificador de códigos válidos — e só sabe duas
-- respostas, veio e não veio.
--
-- Esta é a porta da CENTRAL: é gente logada, com a permissão `atendimentos`,
-- olhando a lista inteira. Identifica pelo `id` da linha (que ela está vendo),
-- pode dizer também "remarcou" e "cancelou", e — ao contrário da irmã — DIZ
-- quando não achou, porque aqui esconder seria só esconder defeito de quem está
-- trabalhando.
--
-- ⚠️ E ELA CHECA A PERMISSÃO POR DENTRO. `security definer` roda como dona da
-- função: sem esta checagem, qualquer sessão autenticada (qualquer pessoa da
-- empresa, de qualquer ferramenta) mudaria o atendimento de qualquer cliente.
-- O `grant` não é o portão — o portão é o `if` da primeira linha.

create or replace function public.vessel_situacao_do_atendimento(
  p_id        bigint,
  p_situacao  text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_atual public.vessel_atendimentos%rowtype;
begin
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  -- A lista fechada mora AQUI, e não num CHECK novo: a coluna já tem o seu, e
  -- este recorte é menor de propósito. 'solicitado' não entra — ninguém
  -- "desmarca" uma visita de volta para pedido; e 'cancelado' entra porque
  -- desistir antes da hora é diferente de faltar.
  if p_situacao is null or p_situacao not in
     ('confirmado', 'realizado', 'no_show', 'remarcado', 'cancelado') then
    return json_build_object('ok', false, 'situacao', 'situacao_invalida');
  end if;

  select * into v_atual from public.vessel_atendimentos where id = p_id;
  if v_atual.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ QA11 DO PLANO: "no-show não vira presença". Só 'realizado' carimba hora
  -- de chegada; todo o resto APAGA o carimbo. Sem isso, marcar "veio" por
  -- engano e corrigir para "não veio" deixaria a hora de chegada para trás, e o
  -- show rate contaria quem não veio.
  update public.vessel_atendimentos
     set status      = p_situacao,
         presenca_em = case when p_situacao = 'realizado'
                            then coalesce(presenca_em, now()) else null end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', p_situacao,
                           'antes', v_atual.status);
end;
$$;

-- ⚠️ `revoke ... from public` NAO fecha anon nem authenticated: os dois recebem
-- execute por privilegio PADRAO do schema, que e outra concessao.
revoke all on function public.vessel_situacao_do_atendimento(bigint, text)
  from public, anon, authenticated;
-- Só quem está logado. `anon` NÃO entra: a porta sem login já existe e é outra
-- (`vessel_marcar_presenca`), com outro desenho e outra defesa.
grant execute on function public.vessel_situacao_do_atendimento(bigint, text)
  to authenticated;

comment on function public.vessel_situacao_do_atendimento(bigint, text) is
  'A porta da Central (gente logada com a permissao atendimentos) para mudar a '
  'situacao de um atendimento. Checa a permissao POR DENTRO: o grant nao e o '
  'portao. So realizado carimba presenca_em; o resto apaga.';
