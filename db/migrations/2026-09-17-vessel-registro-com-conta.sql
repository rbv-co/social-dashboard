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
--
-- ⚠️ `limit 50`, SEM FILTRO DE DATA (adiado da Tarefa 6, reavaliado na
-- revisão final junto de C3). Comprador fora dos 50 pedidos mais recentes
-- daquele SKU cai na FILA — lado seguro, nunca aprova sozinho. O que tornava
-- esse limite perigoso não era o TAMANHO da lista, era a MOEDA DE TROCA:
-- antes de C3, cada tentativa de "É presente?" era de graça e ilimitada, e
-- ter até 50 nomes para testar contra um chute baixava ainda mais o custo de
-- acertar um por sorte. Com o teto de 3 tentativas por peça a cada 24h
-- (`vessel_tentativa_de_presente`, mais abaixo), o tamanho da lista deixa de
-- importar para a segurança: o limite de tentativas é o mesmo, tenha a peça 5
-- ou 50 candidatos. Fica 50, sem filtro de data — filtrar por data é trabalho
-- de relatório (Fase 2), não de segurança.
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
--
-- ⚠️ CRÍTICO N2 (conferência da onda, 17/09/2026) — A PRIMEIRA VERSÃO da
-- trava de C2 era `if p_so_teste and not exists (...)`: OPT-IN. Bastava
-- omitir `so_teste` na chamada (a chave anônima está no HTML público —
-- qualquer um chama a edge direto, sem passar pela tela) para a conferência
-- de lote inteira ficar DESLIGADA, e a bolsa VENDIDA registrava normal. Pior:
-- a prova por rollback deste arquivo CRAVAVA esse buraco como comportamento
-- esperado ("sem so_teste, o comportamento de sempre não pode mudar", numa
-- peça de lote não marcado teste — corrigido na mesma conferência).
--
-- ⚠️ `vessel_registrar_como_cliente` É USADA SÓ PELA PÁGINA DE ENSAIO
-- (`/verify/novo`) NESTA FASE — conferido: o caminho das 157 etiquetas já
-- vendidas chama `vessel_abrir_pedido_de_registro` DIRETO (ver o bloco
-- "CAMINHO ANTIGO" na edge `vessel-registrar-garantia`), nunca esta função.
-- Por isso a conferência de lote abaixo é INCONDICIONAL enquanto a fase for
-- de teste: qualquer chamada a esta função — mande `so_teste` ou não — exige
-- peça de lote `teste = true`. O padrão tem de ser SEGURO por si só, nunca
-- depender de a chamadora lembrar de pedir a trava.
--
-- `p_so_teste` continua existindo como parâmetro (não removido) para servir
-- de gancho para a Fase 2, quando esta MESMA função puder passar a atender
-- também o caminho de produção (hoje ela não atende) — nesse dia, quem
-- decide o que `so_teste` faz de novo é quem estiver reformando esta função
-- para os dois caminhos, e não antes.
--
-- ⚠️ `p_presente_de_nome` (achado I1): grava o nome que a presenteada digitou
-- em "É presente?". Antes, a coluna `presente_de_nome` nascia e NINGUÉM a
-- preenchia — a fila do painel recebia o pedido pendente sem nenhuma pista do
-- que a cliente afirmou, que é justamente o que a conferência humana precisa
-- ler. Fica nulo no caminho normal (sem presente).
--
-- ⚠️ MENOR N4 (conferência da onda, 17/09/2026): `create or replace function`
-- NÃO troca a assinatura de uma função — assinatura diferente cria
-- SOBRECARGA (as duas convivem, mesmo nome). A versão de 4 parâmetros desta
-- função (sem `p_so_teste`/`p_presente_de_nome`) nunca foi aplicada em
-- produção nesta fase, mas se algum dia tivesse sido, o `create or replace`
-- abaixo deixaria as DUAS no ar — e a de 4 parâmetros, sem a trava do C2,
-- continuaria concedida e chamável. O `drop` garante que só existe UMA
-- versão desta função, qualquer que seja o estado do banco em que este
-- arquivo for aplicado.
drop function if exists public.vessel_registrar_como_cliente(text, text, text, date);
create or replace function public.vessel_registrar_como_cliente(
  p_token text, p_codigo text, p_onde text default null, p_comprado_em date default null,
  p_so_teste boolean default false, p_presente_de_nome text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_sessao json; v_c record; v_aberto json;
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  select * into v_c from public.vessel_clientes where id = (v_sessao ->> 'cliente_id')::uuid;

  if not exists (
    select 1 from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_codigo and l.teste
  ) then
    return json_build_object('ok', false, 'motivo', 'fora_do_teste');
  end if;

  v_aberto := public.vessel_abrir_pedido_de_registro(
    p_codigo, v_c.nome, v_c.cpf, v_c.whatsapp, p_onde, p_comprado_em, v_c.nascimento);
  if not (v_aberto ->> 'ok')::boolean then return v_aberto; end if;

  update public.vessel_pedidos_de_registro
     set cliente_id = v_c.id,
         presente_de_nome = coalesce(nullif(trim(coalesce(p_presente_de_nome, '')), ''),
                                      presente_de_nome)
   where id = (v_aberto ->> 'pedido')::uuid;

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

-- ══════════════════════════════════════════════════════════════════════════
-- C1 (revisão final, 17/09/2026) — cliente_id NUNCA é gravado por quem decide
-- ══════════════════════════════════════════════════════════════════════════
--
-- Quem grava a linha DEFINITIVA em `vessel_registros` é
-- `vessel_decidir_pedido_de_registro` (2026-09-03-zz-vessel-garantia-com-dono.sql),
-- função ANTIGA, compartilhada com o painel Autenticidade que está no ar
-- hoje — e o `insert ... on conflict (codigo) do update` dela nunca conheceu
-- a coluna `cliente_id` (que só nasceu aqui, no topo deste arquivo). Medido na
-- revisão final: a cliente registra, o Bling casa a compra, ela vê a tela de
-- confirmação — e "Minhas peças" fica VAZIA, porque a coluna que liga a peça
-- ao perfil nunca é preenchida por ninguém.
--
-- ⚠️ DECISÃO: NÃO MEXER em `vessel_decidir_pedido_de_registro`. Ela é
-- compartilhada com o painel, testada e em produção; editar uma função usada
-- por dois caminhos para consertar só um deles é o tipo de conserto que
-- quebra o outro sem avisar. Em vez disso, um GATILHO em `vessel_registros`
-- preenche `cliente_id` sozinho, olhando o `pedido_id` que aquela mesma
-- função (`2026-09-03-zz-vessel-garantia-com-dono.sql`, seção 5) JÁ GRAVA em
-- `vessel_registros.pedido_id` no `insert` — é o pedido EXATO que está sendo
-- aprovado, não "um pedido daquele código".
--
-- ⚠️ CRÍTICO N1 (conferência da onda, 17/09/2026) — A PRIMEIRA VERSÃO deste
-- gatilho buscava "o pedido mais recente daquele código com cliente_id não
-- nulo" (`order by criado_em desc limit 1`), em vez de usar `new.pedido_id`.
-- Isso reabria o MESMO defeito que o C1 existia para consertar, só que entre
-- contas: "pendente não tranca a etiqueta" é o desenho deste projeto (ver o
-- cabeçalho de `2026-09-03-zz-vessel-garantia-com-dono.sql`) — MAIS DE UM
-- pedido pendente para a mesma peça é esperado, não exceção. Cenário: a dona
-- A abre um pedido; a dona B abre outro depois, para a mesma peça; a equipe
-- aprova o de A — mas "o mais recente com cliente_id preenchido" é o de B. O
-- gatilho errado ligaria a peça à cliente ERRADA: a peça sumiria de "Minhas
-- peças" da A (a dona de verdade) e apareceria na de B. Consertado: o gatilho
-- lê `new.pedido_id`, que é preenchido pela PRÓPRIA LINHA que está nascendo,
-- não por uma busca que pode pegar outro pedido de outra pessoa.
--
-- ⚠️ SE `new.pedido_id` VIER NULO (por exemplo, um `insert` direto em
-- `vessel_registros` fora do fluxo de aprovação, como `vessel_trocar_dono` —
-- que hoje zera `pedido_id` de propósito — ou uma migração de dado antiga),
-- `cliente_id` FICA NULO. Não adivinhar a dona é melhor que adivinhar
-- errado: a peça volta a aparecer só como "em conferência"/sem "Minhas
-- peças" para essa cliente, que é o estado ANTERIOR a esta fase — não um
-- estado novo, pior.
--
-- ⚠️ SÓ NO INSERT. O `on conflict (codigo) do update` de
-- `vessel_decidir_pedido_de_registro` não passa pelo caminho de INSERT deste
-- gatilho para a parte que é UPDATE (o Postgres troca para um UPDATE por
-- dentro) — então uma peça que JÁ tinha dono antes desta fase, e troca de
-- dono de novo por aquele caminho, não tem `cliente_id` atualizado por este
-- gatilho. Não é regressão: antes desta fase nenhum caminho preenchia
-- `cliente_id` nunca, e o caso comum — peça nova, primeira aprovação — é
-- sempre um INSERT puro, sem conflito. É esse caso que este gatilho resolve.
create or replace function public.vessel_registros_preencher_cliente_id()
returns trigger language plpgsql as $$
begin
  if new.cliente_id is null and new.pedido_id is not null then
    select pr.cliente_id into new.cliente_id
      from public.vessel_pedidos_de_registro pr
     where pr.id = new.pedido_id;
  end if;
  return new;
end;
$$;

drop trigger if exists vessel_registros_preencher_cliente_id on public.vessel_registros;
create trigger vessel_registros_preencher_cliente_id
  before insert on public.vessel_registros
  for each row execute function public.vessel_registros_preencher_cliente_id();

-- ══════════════════════════════════════════════════════════════════════════
-- C3 (revisão final, 17/09/2026) — "É presente?" era um adivinhador de nome
-- de graça e sem limite
-- ══════════════════════════════════════════════════════════════════════════
--
-- Antes: tentativas ilimitadas, custo zero, e a resposta dizia NA HORA se o
-- nome tinha acertado (`estado: 'aprovado'`) ou não (`'pendente'`). Nome de
-- compradora de marca de luxo é achável (post marcado no Instagram); somado a
-- C2 aberto, isso era tomada de posse de bolsa já VENDIDA — e mesmo com C2
-- fechado, seria tomada de posse de peça de teste.
--
-- ⚠️ A TRAVA É NO BANCO, NÃO NA EDGE. Uma Edge Function não guarda estado
-- entre chamadas — cada invocação é um processo novo (ou reaproveitado sem
-- garantia nenhuma), sem memória da tentativa anterior. Um contador em
-- variável JavaScript da edge não seguraria nada.
create table if not exists public.vessel_tentativas_de_presente (
  codigo text not null,
  quando timestamptz not null default now()
);
create index if not exists vessel_tentativas_presente_idx
  on public.vessel_tentativas_de_presente (codigo, quando desc);
alter table public.vessel_tentativas_de_presente enable row level security;
-- Sem política nenhuma, mesmo padrão de vessel_tentativas_de_login: só a
-- função abaixo (security definer) escreve e lê; ninguém consulta em tela.

-- Teto de 3 tentativas de "É presente?" por PEÇA a cada 24h. Estourou: quem
-- chama (a edge) tem de cair na fila SEM rodar o casamento de nome — se
-- rodasse e só escondesse o resultado da resposta, um bug futuro na tela
-- poderia vazar o resultado de qualquer jeito. Não rodar é a trava de raiz.
create or replace function public.vessel_tentativa_de_presente(p_codigo text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_n int;
begin
  insert into public.vessel_tentativas_de_presente (codigo) values (v_codigo);

  select count(*) into v_n from public.vessel_tentativas_de_presente
   where codigo = v_codigo and quando > now() - interval '24 hours';

  return json_build_object('ok', true, 'permitido', v_n <= 3, 'tentativas', v_n);
end;
$$;

-- ── o portão ─────────────────────────────────────────────────────────────────
-- Mesma regra de "Grant não é o portão" de 2026-09-17-vessel-contas-base.sql:
-- revogar dos três papéis, um a um, e conceder só a service_role — a página
-- pública nunca chama estas funções direto.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_registrar_como_cliente(text,text,text,date,boolean,text)',
    'vessel_candidatos_de_presente(text)',
    'vessel_tentativa_de_presente(text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
