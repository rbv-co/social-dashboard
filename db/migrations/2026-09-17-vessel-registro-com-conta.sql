-- O REGISTRO DA PEÇA PASSA A TER DONA COM PERFIL, E GANHA O "É PRESENTE?".
--
-- Desenho: docs/superpowers/specs/2026-09-17-registered-pieces-contas-design.md
-- (seção 5.6, "É presente?" — a comparação de nomes é da PRÓXIMA tarefa; esta
-- aqui só liga o registro à conta e ensina o sistema a ENXERGAR a marca).
--
-- ⚠️ UMA FUNÇÃO NOVA SÓ PARA APROVAR PRESENTE, cogitada num desenho anterior
-- deste trabalho, foi RISCADA: ela não existe e não é criada aqui. A
-- aprovação — de presente ou não — usa a função de decisão que já existe (ver
-- 2026-09-03-zz-vessel-garantia-com-dono.sql, seção "5. DECIDIR UM PEDIDO"),
-- com a conferência anexada em `p_conferencia`. Criar uma segunda porta de
-- aprovação duplicaria a regra de "virar dono", que é exatamente a regra que
-- não pode divergir.

alter table public.vessel_registros
  add column if not exists cliente_id uuid references public.vessel_clientes(id);
alter table public.vessel_pedidos_de_registro
  add column if not exists cliente_id uuid references public.vessel_clientes(id),
  add column if not exists presente_de_nome text;

comment on column public.vessel_pedidos_de_registro.presente_de_nome is
  'O nome de quem deu, informado pela presenteada. Casamento contra os pedidos '
  'do SKU é da tarefa seguinte — aqui só a coluna nasce.';

-- A cópia local dos pedidos do Bling passa a guardar as observações: é onde a
-- vendedora escreve PRESENTE.
alter table public.vessel_pedidos
  add column if not exists observacoes text,
  add column if not exists observacoes_internas text;

comment on column public.vessel_pedidos.observacoes_internas is
  'Texto livre do pedido no Bling. A palavra PRESENTE aqui afrouxa a conferência de nome no "É presente?".';

-- ⚠️ A MARCA É PALAVRA SOLTA, e por isso a leitura é tolerante: maiúscula,
-- acento e a frase em volta não importam. O que NÃO pode é casar com "presente
-- de aniversário do vendedor" escrito por engano — daí a marca sozinha nunca
-- aprova: ela só permite o nome chegar perto (ver _shared/nome-de-quem-deu.js,
-- a escrever na tarefa seguinte).
create or replace function public.vessel_pedido_marcado_presente(p_texto text)
returns boolean language sql immutable as $$
  select coalesce(p_texto, '') <> '' and
         translate(lower(p_texto), 'áéíóúâêôãõç', 'aeiouaeoaoc') like '%presente%';
$$;

-- Candidatos de presente: pedidos que contêm aquele SKU. É lista crua, para a
-- tarefa seguinte casar por nome — esta aqui não decide nada sozinha.
create or replace function public.vessel_candidatos_de_presente(p_sku text)
returns table (bling_pedido text, contato_nome text, tem_marca boolean)
language sql stable security definer set search_path to 'public' as $$
  select p.numero, p.contato_nome,
         public.vessel_pedido_marcado_presente(
           coalesce(p.observacoes, '') || ' ' || coalesce(p.observacoes_internas, ''))
    from public.vessel_pedidos p
    join public.vessel_pedido_itens i on i.pedido_id = p.id
   where i.sku = p_sku
   order by p.data_do_pedido desc nulls last
   limit 50;
$$;

-- Registrar estando logada: o pedido nasce ligado ao perfil.
--
-- ⚠️ A ASSINATURA DE `vessel_abrir_pedido_de_registro` GANHOU `p_nascimento`
-- (7º parâmetro, `date default null`) depois de
-- 2026-09-03-zz-vessel-garantia-com-dono.sql — conferido no banco antes de
-- escrever esta chamada. Quem reaplicar este arquivo num banco onde essa
-- mudança ainda não existe vai ver `function does not exist`; a correção é
-- ajustar a assinatura de origem, não este arquivo.
create or replace function public.vessel_registrar_como_cliente(
  p_token text, p_codigo text, p_onde text default null, p_comprado_em date default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_c record; v_aberto json;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  select * into v_c from public.vessel_clientes where id = (v_sessao ->> 'cliente_id')::uuid;

  v_aberto := public.vessel_abrir_pedido_de_registro(
    p_codigo, v_c.nome, v_c.cpf, v_c.whatsapp, p_onde, p_comprado_em, v_c.nascimento);
  if not (v_aberto ->> 'ok')::boolean then return v_aberto; end if;

  update public.vessel_pedidos_de_registro
     set cliente_id = v_c.id where id = (v_aberto ->> 'pedido')::uuid;

  -- `ja_tem_dono` e `dono_curto` atravessam de `vessel_abrir_pedido_de_registro`
  -- sem alteração: é a peça já ter dona OU NÃO, e a edge (e a tela) precisam
  -- disso para explicar a situação à cliente. Sem repassar, uma peça que já
  -- tem dona responderia como se estivesse livre — não é falha de segurança
  -- (nada usa este campo para liberar ou barrar registro), mas é informação
  -- sumindo em silêncio.
  return json_build_object('ok', true, 'pedido', v_aberto ->> 'pedido',
                           'sku', v_aberto ->> 'sku', 'cliente_id', v_c.id,
                           'ja_tem_dono', (v_aberto ->> 'ja_tem_dono')::boolean,
                           'dono_curto', v_aberto ->> 'dono_curto');
end;
$$;

-- ── o portão ─────────────────────────────────────────────────────────────────
-- Mesma regra de "Grant não é o portão" de 2026-09-17-vessel-contas-base.sql:
-- revogar dos três papéis, um a um, e conceder só a service_role — a página
-- pública nunca chama estas duas funções direto.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_registrar_como_cliente(text,text,text,date)',
    'vessel_candidatos_de_presente(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
