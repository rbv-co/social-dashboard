-- A APROVAÇÃO AUTOMÁTICA NÃO TOMA MAIS A PEÇA DE QUEM JÁ É DONA
--
-- Achado de segurança, 18/09/2026, em produção.
--
-- O DEFEITO: a edge `vessel-registrar-garantia` aprova sozinha (`'bling'`)
-- sempre que o CPF de quem pede tem QUALQUER pedido no Bling com o MESMO SKU
-- da peça. E esta função gravava com `on conflict (codigo) do update` — ou
-- seja, SOBRESCREVIA a dona. Então:
--   1. A pessoa B, que comprou uma bolsa do mesmo modelo, digitava o código da
--      peça da pessoa A e virava a dona — sem ninguém ver.
--   2. O mesmo pedido do Bling (1 unidade) aprovava N peças. Visto hoje: o
--      pedido 2670, quantidade 1, aprovou TBNWXAS28A e VBDK9AANRU.
--   3. Um pedido novo de uma peça que JÁ era da mesma pessoa era "aprovado" de
--      novo, regravando o registro e deixando um pedido duplicado inútil.
--
-- O CONSERTO — só no caminho automático (`p_quem_decidiu = 'bling'` e
-- `p_estado = 'aprovado'`), ANTES de mexer em qualquer tabela:
--   a) a peça já tem registro com CPF DIFERENTE (ou registro sem CPF) →
--      NÃO aprova: `ok:false, motivo 'ja_tem_dona'`. O pedido CONTINUA
--      pendente e cai na fila do painel; uma pessoa decide. Trocar a dona
--      continua possível, mas só 'na_mao' (admin), como hoje.
--   b) a peça já tem registro com o MESMO CPF → nada é regravado. O pedido é
--      marcado como decidido ('aprovado', motivo "já registrada no mesmo
--      CPF") e a resposta é `ok:true, estado 'aprovado', ja_era_sua:true`,
--      com a garantia do registro que já existe. Não grava vessel_edicoes:
--      nada mudou de dono.
--      POR QUE ASSIM, e não deixar pendente nem recusar: a pessoa JÁ é a
--      dona, então não há o que uma pessoa decidir — deixar pendente só
--      sujaria a fila. Recusar seria mentira (ela tem direito) e a página
--      diria "recusado" para a dona. E NÃO regravar protege o registro
--      original: a garantia conta da compra original, o elo com o pedido de
--      registro e com o Bling fica o de antes, e a marca do robô do Bling
--      (`bling_atualizado_em`) não é zerada à toa.
--   c) o pedido do Bling da conferência já sustenta o registro de OUTRA
--      peça do MESMO SKU → NÃO aprova: `ok:false, motivo 'pedido_ja_usado'`,
--      fica pendente. A conferência não traz a quantidade do item no pedido;
--      a regra conservadora é: a 2ª peça do mesmo pedido+SKU vai para a fila
--      de gente. Quem comprou duas iguais no mesmo pedido espera a pessoa
--      aprovar a segunda — é o preço de não entregar bolsa alheia.
--   Ordem: a → b → c. (b antes de c porque, se a peça já é dela, o pedido
--   "usado" é o dela mesma.)
--
-- CORRIDA: duas aprovações da mesma peça ao mesmo tempo passariam as duas
-- pela conferência antes de qualquer uma gravar. Por isso, antes de olhar,
-- a função trava a LINHA DA PEÇA (`for no key update` — não briga com a
-- chave estrangeira de vessel_registros) e trava o NÚMERO DO PEDIDO DO BLING
-- (`pg_advisory_xact_lock`, solto sozinho no fim da transação). A segunda
-- espera a primeira terminar e já vê o registro gravado.
--
-- A EDGE JÁ TRATA `ok:false` COMO PENDENTE nos três caminhos (antigo sem
-- conta, logada, e "É presente?") — conferido em
-- supabase/functions/vessel-registrar-garantia/index.ts. Nada muda lá.
--
-- O QUE NÃO MUDA: a assinatura, o `security definer`, as permissões
-- (`create or replace` não mexe nelas — nada de grant/revoke aqui), o
-- caminho 'na_mao', a recusa, a conta da garantia pelo material, o
-- `on conflict` (que continua existindo para o 'na_mao' trocar a dona).
-- Todo o texto novo está entre as marcas `>>> TRAVA DA DONA` e
-- `<<< TRAVA DA DONA`; fora delas a função é a MESMA de
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql (e do banco, conferido
-- com pg_get_functiondef em 18/09/2026) — o teste
-- db/vessel-registro-nao-toma-peca-com-dona.test.mjs confere isso.
--
-- ⚠️ O NOME TEM "zzzz-" DE PROPÓSITO: 2026-09-18-zz-vessel-garantia-pelo-
-- material.sql também redefine esta função. "zzzz-" ordena depois de "zz-" e
-- de "zzz-" (o hífen é menor que a letra), então este arquivo roda por último
-- e não é apagado pela versão velha.
--
-- ⚠️ NADA AQUI SE PASSA POR ADMIN.

create or replace function public.vessel_decidir_pedido_de_registro(
  p_pedido uuid, p_estado text, p_quem_decidiu text,
  p_conferencia jsonb default null::jsonb, p_motivo text default null::text
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ped      record;
  v_ate      date;
  v_quem     uuid := auth.uid();
  v_material text;
  v_compra   date;
  -- >>> TRAVA DA DONA (variáveis)
  v_reg      record;
  v_sku      text;
  -- <<< TRAVA DA DONA
begin
  if p_estado not in ('aprovado', 'recusado') then
    return json_build_object('ok', false, 'motivo', 'estado_invalido');
  end if;
  if p_quem_decidiu not in ('bling', 'na_mao') then
    return json_build_object('ok', false, 'motivo', 'origem_invalida');
  end if;
  if p_quem_decidiu = 'na_mao' and not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- Aprovacao automatica SEM a prova do Bling anexada nao entra: e ela que
  -- explica a decisao daqui a um ano, e sem ela "conferido no Bling" e so uma
  -- palavra que o sistema deu a si mesmo.
  if p_quem_decidiu = 'bling' and p_estado = 'aprovado'
     and coalesce(p_conferencia ->> 'pedido', '') = '' then
    return json_build_object('ok', false, 'motivo', 'conferencia_sem_pedido');
  end if;

  select * into v_ped from public.vessel_pedidos_de_registro where id = p_pedido;
  if not found then
    return json_build_object('ok', false, 'motivo', 'pedido_nao_existe');
  end if;
  if v_ped.estado <> 'pendente' then
    return json_build_object('ok', false, 'motivo', 'ja_decidido',
                             'estado', v_ped.estado);
  end if;
  -- Recusar exige motivo escrito. Aprovar nao: aprovar e o caminho normal, e
  -- exigir justificativa do caminho normal ensina a escrever "ok" em tudo.
  if p_estado = 'recusado' and coalesce(trim(coalesce(p_motivo, '')), '') = '' then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;

  -- >>> TRAVA DA DONA (18/09/2026) — só a aprovação automática passa aqui.
  -- Ver o cabeçalho deste arquivo para o porquê de cada regra.
  if p_quem_decidiu = 'bling' and p_estado = 'aprovado' then
    -- Fila única por peça e por pedido do Bling: quem chegar depois espera e
    -- enxerga o que o primeiro gravou.
    select l.sku into v_sku
      from public.vessel_pecas p
      join public.vessel_lotes l on l.id = p.lote_id
     where p.codigo = v_ped.codigo
       for no key update of p;
    perform pg_advisory_xact_lock(
      hashtext('vessel_bling_pedido:' || (p_conferencia ->> 'pedido')));

    select r.cpf, r.garantia_ate into v_reg
      from public.vessel_registros r
     where r.codigo = v_ped.codigo;

    if found then
      -- a) já tem dona, e não é quem pede (registro sem CPF conta como
      --    "outra pessoa": na dúvida, uma pessoa decide).
      if regexp_replace(coalesce(v_reg.cpf, ''), '\D', '', 'g') = ''
         or regexp_replace(v_reg.cpf, '\D', '', 'g')
            <> regexp_replace(coalesce(v_ped.cpf, ''), '\D', '', 'g') then
        return json_build_object('ok', false, 'motivo', 'ja_tem_dona');
      end if;
      -- b) já é dela: fecha o pedido sem regravar nada.
      update public.vessel_pedidos_de_registro
         set estado = 'aprovado', decidido_por_que = 'bling',
             conferencia = p_conferencia, decidido_em = now(),
             decidido_quem = v_quem, motivo = 'já registrada no mesmo CPF'
       where id = p_pedido;
      return json_build_object('ok', true, 'estado', 'aprovado',
                               'ja_era_sua', true,
                               'garantia_ate', v_reg.garantia_ate);
    end if;

    -- c) este pedido do Bling já sustenta outra peça do mesmo modelo.
    if exists (
      select 1
        from public.vessel_registros r
        join public.vessel_pecas p on p.codigo = r.codigo
        join public.vessel_lotes l on l.id = p.lote_id
       where r.bling_pedido = p_conferencia ->> 'pedido'
         and r.codigo <> v_ped.codigo
         and l.sku is not distinct from v_sku
    ) then
      return json_build_object('ok', false, 'motivo', 'pedido_ja_usado');
    end if;
  end if;
  -- <<< TRAVA DA DONA

  update public.vessel_pedidos_de_registro
     set estado = p_estado, decidido_por_que = p_quem_decidiu,
         conferencia = p_conferencia, decidido_em = now(),
         decidido_quem = v_quem, motivo = nullif(trim(coalesce(p_motivo, '')), '')
   where id = p_pedido;

  if p_estado = 'recusado' then
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    values (v_ped.codigo, 'registro_recusado', p_motivo,
            jsonb_build_object('pedido', p_pedido, 'nome', v_ped.nome,
                               'cpf', public.vessel_cpf_mascarado(v_ped.cpf),
                               'por_que', p_quem_decidiu), v_quem);
    return json_build_object('ok', true, 'estado', 'recusado');
  end if;

  -- ── APROVADO: vira o dono atual ──
  -- REGRA DE 18/09/2026: data da compra + meses do material do LOTE da peça
  -- (canvas 24, couro 6). A data da compra é a do pedido que casou; sem
  -- pedido, a do registro (ver `vessel_data_da_compra`). Lote sem material →
  -- `v_ate` nulo, de propósito: nunca chutar.
  select l.material into v_material
    from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_ped.codigo;
  v_compra := public.vessel_data_da_compra(
    p_conferencia ->> 'quando', p_conferencia ->> 'pedido', v_ped.criado_em);
  v_ate := public.vessel_garantia_ate(v_compra, v_material);

  insert into public.vessel_registros
    (codigo, nome, whatsapp, onde_comprou, comprado_em, garantia_ate,
     cpf, nascimento, pedido_id, bling_contato_id, bling_pedido)
  values (v_ped.codigo, v_ped.nome, v_ped.whatsapp, v_ped.onde_comprou,
          v_ped.comprado_em, v_ate, v_ped.cpf, v_ped.nascimento, p_pedido,
          p_conferencia ->> 'contato', p_conferencia ->> 'pedido')
  on conflict (codigo) do update
     set nome = excluded.nome, whatsapp = excluded.whatsapp,
         onde_comprou = excluded.onde_comprou, comprado_em = excluded.comprado_em,
         garantia_ate = excluded.garantia_ate, cpf = excluded.cpf,
         nascimento = excluded.nascimento,
         pedido_id = excluded.pedido_id,
         bling_contato_id = excluded.bling_contato_id,
         bling_pedido = excluded.bling_pedido,
         -- ⚠️ ZERA A MARCA do Bling: os dados mudaram, entao o cadastro de la
         -- precisa ser atualizado de novo. Sem isto, uma troca de dono ou uma
         -- correcao levaria a marca antiga junto e o robo pularia esta linha.
         bling_atualizado_em = null;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_ped.codigo, 'registro_aprovado', p_motivo,
          jsonb_build_object('pedido', p_pedido, 'nome', v_ped.nome,
                             'cpf', public.vessel_cpf_mascarado(v_ped.cpf),
                             'por_que', p_quem_decidiu,
                             'bling_pedido', p_conferencia ->> 'pedido'), v_quem);

  return json_build_object('ok', true, 'estado', 'aprovado', 'garantia_ate', v_ate);
end;
$function$;
