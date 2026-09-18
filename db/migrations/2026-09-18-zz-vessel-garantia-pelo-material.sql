-- A GARANTIA PASSA A DEPENDER DO MATERIAL DA BOLSA
--
-- Decisão do dono, 18/09/2026:
--   - bolsa de CANVAS: 2 anos (24 meses);
--   - bolsa de COURO:  6 meses;
--   - contados da DATA DA COMPRA, e não do dia do registro;
--   - vale o material DE FORA do corpo da bolsa. Camurça conta como couro.
--     Sintético (napa fly, recouro, Bristol) conta como canvas.
--   - quem decide o material é o campo no LOTE (`vessel_lotes.material`).
--
-- O QUE ESTE ARQUIVO FAZ, NA ORDEM:
--   1. `vessel_lotes` ganha `material` e `material_fonte`; e
--      `vessel_registros.garantia_ate` passa a aceitar nulo.
--   2. Quatro contas pequenas: meses do material, data da compra, data final
--      da garantia, e a garantia de um registro já gravado.
--   3. `vessel_decidir_pedido_de_registro` (a ÚNICA função que grava
--      `garantia_ate` — conferido no banco em 18/09/2026 com
--      pg_get_functiondef de todas as funções que citam `garantia_ate`) passa a
--      usar a regra nova. Todo o resto dela fica igual.
--   4. Um gatilho: quando o material de um lote muda, a garantia das peças
--      já registradas daquele lote é recalculada.
--   5. `vessel_verificar` devolve também `material` e `garantia_meses`.
--   6. Os 140 lotes de hoje recebem o material da lista conferida pelo dono.
--   7. As peças já registradas têm `garantia_ate` recalculada.
--
-- ⚠️ LOTE SEM MATERIAL = GARANTIA NULA. Nunca chutar 2 anos. Uma data errada
-- no certificado é pior que uma data que ainda não existe: a nula aparece
-- como "falta preencher"; a errada parece certa.
--
-- ⚠️ O NOME TEM "zz-" DE PROPÓSITO: este arquivo redefine `vessel_verificar`,
-- que também é redefinida por 2026-09-18-vessel-verificar-nome-completo-no-
-- teste.sql. Em ordem alfabética, sem o "zz-", este arquivo rodaria ANTES
-- daquele, e a versão velha apagaria os campos novos. Mesmo truque de
-- 2026-09-03-zz-vessel-garantia-com-dono.sql.
--
-- ⚠️ NADA AQUI SE PASSA POR ADMIN. Nenhum `set_config('request.jwt.claims')`,
-- nenhum desvio de `is_vessel_admin()` — ver o motivo em
-- 2026-09-17-vessel-lote-de-teste.sql.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. AS DUAS COLUNAS NOVAS DO LOTE
-- ══════════════════════════════════════════════════════════════════════════
--
-- Aceitam nulo: lote criado pelo painel daqui pra frente nasce SEM material
-- (`vessel_gerar_lote` não conhece a coluna), e fica nulo até alguém decidir.
--
-- GRANTS E TRAVAS: iguais às outras colunas do lote, sem nada a mais. Conferido
-- no banco (18/09/2026): `vessel_lotes` tem RLS ligado e uma só política, de
-- LEITURA para quem é admin do selo (`is_vessel_admin()`). Não há política de
-- escrita — quem grava é sempre uma função `security definer`. Coluna nova
-- herda isso sozinha, como `teste` e `os` herdaram.
alter table public.vessel_lotes
  add column if not exists material text,
  add column if not exists material_fonte text;

alter table public.vessel_lotes drop constraint if exists vessel_lotes_material_check;
alter table public.vessel_lotes add constraint vessel_lotes_material_check
  check (material is null or material in ('canvas', 'couro'));

-- De onde saiu o material. Lista fechada para não virar texto livre:
--   dono            — a lista conferida pelo dono (esta migration);
--   bling_estrutura — sugerido pela estrutura do produto no Bling
--                     (coletor/classificar-material-dos-lotes.mjs);
--   painel          — alguém escolheu no painel Autenticidade.
alter table public.vessel_lotes drop constraint if exists vessel_lotes_material_fonte_check;
alter table public.vessel_lotes add constraint vessel_lotes_material_fonte_check
  check (material_fonte is null or material_fonte in ('dono', 'bling_estrutura', 'painel'));

-- Fonte sem material não quer dizer nada.
alter table public.vessel_lotes drop constraint if exists vessel_lotes_material_com_fonte_check;
alter table public.vessel_lotes add constraint vessel_lotes_material_com_fonte_check
  check (material is not null or material_fonte is null);

comment on column public.vessel_lotes.material is
  'Material DE FORA do corpo da bolsa: canvas (2 anos de garantia) ou couro (6 '
  'meses). Camurça = couro; sintético = canvas. Nulo = ainda não decidido, e aí '
  'a garantia fica nula. Decisão do dono, 18/09/2026.';
comment on column public.vessel_lotes.material_fonte is
  'De onde saiu o material: dono, bling_estrutura ou painel.';

-- ── A GARANTIA DO REGISTRO PASSA A ACEITAR NULO ─────────────────────────────
-- `vessel_registros.garantia_ate` nasceu `not null` (2026-08-04-vessel-
-- verify.sql), no tempo em que toda garantia era "2 anos" e sempre havia uma
-- data para gravar. Com a regra nova, peça de lote sem material fica SEM
-- data — e o `not null` derrubaria a aprovação inteira da cliente. Medido no
-- ensaio de 18/09/2026: sem esta linha, aprovar peça de lote sem material
-- dava erro de `not null`.
-- Quem lê já aguenta nulo, conferido: o painel mostra "—" (`dataCurta`), a
-- planilha deixa em branco (`csv-de-garantias.js`, `dia`), as duas páginas
-- /verify só escrevem a data `if (garantia_ate)`, e
-- `vessel_garantias_baixadas.garantia_ate` já aceita nulo.
alter table public.vessel_registros alter column garantia_ate drop not null;

-- ══════════════════════════════════════════════════════════════════════════
-- 2. AS CONTAS
-- ══════════════════════════════════════════════════════════════════════════

-- Quantos meses de garantia cada material dá. Sem material, nulo.
create or replace function public.vessel_meses_de_garantia(p_material text)
returns int
language sql
immutable
set search_path = public
as $$
  select case p_material
           when 'canvas' then 24
           when 'couro'  then 6
         end;
$$;

-- A DATA DA COMPRA, nesta ordem:
--   1. a data que a conferência do Bling anotou (`quando`, gravado pela edge
--      `vessel-registrar-garantia` com a data do pedido que casou);
--   2. a data do pedido na cópia local (`vessel_pedidos.data_do_pedido`),
--      pelo número do pedido — é o caminho do "É presente?", que anota só o
--      número. Só vale se o número der UMA data; duas datas = não sei;
--   3. sem pedido que casou: a data do REGISTRO, no fuso de Brasília.
--
-- ⚠️ A data que a cliente DIGITOU (`comprado_em`) não entra na conta. Ela
-- continua guardada, mas não é prova de compra — a prova é o pedido.
create or replace function public.vessel_data_da_compra(
  p_quando text, p_bling_pedido text, p_registro timestamptz
) returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_data date;
  v_quantas int;
  v_numero text := nullif(trim(coalesce(p_bling_pedido, '')), '');
begin
  if coalesce(p_quando, '') ~ '^\d{4}-\d{2}-\d{2}' then
    begin
      v_data := left(p_quando, 10)::date;
    exception when others then
      v_data := null;   -- "0000-00-00" e parecidos: tratar como sem data
    end;
    if v_data is not null then return v_data; end if;
  end if;

  if v_numero is not null then
    select count(distinct data_do_pedido), min(data_do_pedido)
      into v_quantas, v_data
      from public.vessel_pedidos
     where numero = v_numero;
    if v_quantas = 1 then return v_data; end if;
  end if;

  return (coalesce(p_registro, now()) at time zone 'America/Sao_Paulo')::date;
end;
$$;

-- A data final: compra + meses do material. Qualquer um dos dois nulo → nulo.
create or replace function public.vessel_garantia_ate(p_compra date, p_material text)
returns date
language sql
immutable
set search_path = public
as $$
  select (p_compra + make_interval(months => public.vessel_meses_de_garantia(p_material)))::date;
$$;

-- A garantia de uma peça JÁ registrada, recalculada do zero com o que está
-- gravado: o pedido de registro que foi aprovado (data do Bling e número),
-- o número do pedido guardado no registro e o material do lote da peça.
--
-- A "data do registro" é quando a cliente PEDIU (`criado_em` do pedido de
-- registro), e não quando alguém aprovou — aprovar três dias depois não pode
-- encurtar a garantia dela. Sem pedido ligado (registro antigo, ou dono
-- trocado no painel, que desliga o pedido), vale `registrado_em`.
create or replace function public.vessel_garantia_ate_do_registro(p_codigo text)
returns date
language sql
stable
set search_path = public
as $$
  select public.vessel_garantia_ate(
           public.vessel_data_da_compra(
             pr.conferencia ->> 'quando',
             coalesce(r.bling_pedido, pr.conferencia ->> 'pedido'),
             coalesce(pr.criado_em, r.registrado_em)),
           l.material)
    from public.vessel_registros r
    left join public.vessel_pedidos_de_registro pr on pr.id = r.pedido_id
    left join public.vessel_pecas p on p.codigo = r.codigo
    left join public.vessel_lotes l on l.id = p.lote_id
   where r.codigo = p_codigo;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- 3. QUEM GRAVA A GARANTIA: vessel_decidir_pedido_de_registro
-- ══════════════════════════════════════════════════════════════════════════
--
-- Copiada da definição que está NO BANCO (pg_get_functiondef, 18/09/2026).
-- Mudam SÓ: o `declare` (duas variáveis novas) e a conta de `v_ate`. Todo o
-- resto — portões, recusa, trilha, `on conflict` — é o mesmo texto.
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

-- ══════════════════════════════════════════════════════════════════════════
-- 4. MUDOU O MATERIAL DO LOTE → RECALCULA AS PEÇAS JÁ REGISTRADAS
-- ══════════════════════════════════════════════════════════════════════════
--
-- Sem isto, uma peça registrada num lote ainda sem material ficaria com a
-- garantia nula PARA SEMPRE, mesmo depois de alguém escolher o material. E
-- uma correção de material (couro → canvas) deixaria a data velha no
-- certificado. O gatilho junta as duas pontas: o material manda, a data segue.
--
-- `security definer`: a troca de material vem de uma função do painel, e a
-- atualização das garantias não pode depender de quem está logado.
create or replace function public.vessel_lote_material_recalcula_garantia()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vessel_registros r
     set garantia_ate = public.vessel_garantia_ate_do_registro(r.codigo)
   where r.codigo in (select p.codigo from public.vessel_pecas p where p.lote_id = new.id);
  return new;
end;
$$;

drop trigger if exists trg_vessel_lote_material_recalcula_garantia on public.vessel_lotes;
create trigger trg_vessel_lote_material_recalcula_garantia
  after update of material on public.vessel_lotes
  for each row
  when (old.material is distinct from new.material)
  execute function public.vessel_lote_material_recalcula_garantia();

-- ══════════════════════════════════════════════════════════════════════════
-- 5. A CONSULTA PÚBLICA: vessel_verificar
-- ══════════════════════════════════════════════════════════════════════════
--
-- Copiada de 2026-09-18-vessel-verificar-nome-completo-no-teste.sql (a mais
-- recente, e igual à que está no banco em 18/09/2026). Acrescenta SÓ:
--   - `l.material` na leitura do lote;
--   - `material` e `garantia_meses` no json de volta.
-- `garantia_ate` continua saindo do registro — que agora é gravado pela regra
-- nova (seção 3) e recalculado abaixo (seção 7). Nenhuma chave existente
-- muda; `dono_nome` continua só em lote de teste; a gravação em
-- `vessel_leituras` é a mesma.
create or replace function public.vessel_verificar(p_codigo text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_peca   record;
  v_reg    record;
  v_cab    json := nullif(current_setting('request.headers', true), '')::json;
begin
  select p.codigo, p.numero_na_serie, l.modelo, l.cor, l.sku, l.quantidade,
         l.fabricado_em, l.fotos, l.teste, l.material
    into v_peca
    from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_codigo;

  insert into public.vessel_leituras (codigo, achou, agente, ip_hash)
  values (
    left(v_codigo, 32),
    v_peca.codigo is not null,
    left(coalesce(v_cab ->> 'user-agent', ''), 300),
    encode(extensions.digest(coalesce(v_cab ->> 'x-forwarded-for', 'sem-ip'), 'sha256'), 'hex')
  );

  if v_peca.codigo is null then
    return json_build_object('ok', false);
  end if;

  select * into v_reg from public.vessel_registros where codigo = v_codigo;

  return json_build_object(
    'ok', true,
    'modelo', v_peca.modelo,
    'cor', v_peca.cor,
    'sku', v_peca.sku,
    'numero', v_peca.numero_na_serie,
    'total', v_peca.quantidade,
    'fabricado_em', v_peca.fabricado_em,
    'fotos', coalesce(v_peca.fotos, array[]::text[]),
    'teste', coalesce(v_peca.teste, false),
    'registrada', v_reg.codigo is not null,
    'dono_curto', public.vessel_nome_curto(v_reg.nome),
    -- Nome completo SO em peca de lote de teste (vessel_lotes.teste) — ver
    -- 2026-09-18-vessel-verificar-nome-completo-no-teste.sql.
    'dono_nome', case when coalesce(v_peca.teste, false) then v_reg.nome else null end,
    'pode_revelar', v_reg.codigo is not null,
    'registrada_em', v_reg.registrado_em,
    'garantia_ate', v_reg.garantia_ate,
    -- Regra de 18/09/2026. Nulo quando o lote ainda não tem material.
    'material', v_peca.material,
    'garantia_meses', public.vessel_meses_de_garantia(v_peca.material)
  );
end;
$$;

-- ── o portão das funções novas ───────────────────────────────────────────────
-- São contas internas: quem chama é `vessel_verificar`, `vessel_decidir_...`
-- e o gatilho, todos rodando como dono do banco. Nenhuma fica aberta à chave
-- pública. Revogar dos TRÊS papéis, um a um — revogar só de `public` não
-- fecha (ver 2026-09-16-vessel-fecha-as-funcoes-internas.sql).
-- `vessel_verificar` e `vessel_decidir_pedido_de_registro` mantêm as
-- permissões que já tinham: `create or replace` não mexe nelas.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_meses_de_garantia(text)',
    'vessel_data_da_compra(text,text,timestamptz)',
    'vessel_garantia_ate(date,text)',
    'vessel_garantia_ate_do_registro(text)',
    'vessel_lote_material_recalcula_garantia()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- ══════════════════════════════════════════════════════════════════════════
-- 6. OS 140 LOTES DE HOJE — lista conferida pelo dono em 18/09/2026
-- ══════════════════════════════════════════════════════════════════════════
--
-- 126 canvas e 14 couro. A estrutura do Bling ajudou a montar a lista
-- (coletor/classificar-material-dos-lotes.mjs), mas quem decidiu foi o dono —
-- por isso a fonte é 'dono'. Cada `update` dispara o gatilho da seção 4 para
-- as peças já registradas daquele lote.
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '31659d20-392f-46ef-982b-0cd679ac7742';  -- H0009S · Handbag Lunea · Fendi e Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '81ca4421-4e3e-4774-bf2c-486ba2cf8e15';  -- SS0001CB.M1 · ClutchBag Maelle Medium Bege · Bege
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'ef0e61d7-ac6a-432e-9ff2-e828d26ffbff';  -- SS0001CB.M1 · ClutchBag Maelle Medium Bege · Bege
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '649b1c8e-863a-47db-abb2-4cb36c02b6d1';  -- SS0001CB.M2 · ClutchBag Maelle Medium Marrom · Marrom
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'cda0b445-5932-4061-872e-41338b1eb178';  -- SS0001CB.M3 · ClutchBag Maelle Medium Taupe · Taupe
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3a0e1bbf-b32a-4760-a427-e90a18e49b72';  -- SS0001EW.B2 · East West Astrea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'eb8bd50b-c0ea-43a5-8eab-24240323c037';  -- SS0001EW.B2 · East West Astrea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'e18609b7-c5b3-4cb5-b687-879e984c6f6f';  -- SS0001EW.B3 · East West Astrea Big Bordô · bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'bdd62213-04d2-4372-83d5-6bf58b2ecbdc';  -- SS0001EW.B3 · East West Astrea Big Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'e718805d-c1ae-4b62-8a4e-a04154e1da5e';  -- SS0001EW.B3 · East West Astrea Big Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '4543926b-e0e8-44c7-a73d-b87e76ac79d7';  -- SS0001HB.B1 · HandBag Linear Big Vermelho · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c006c425-886c-470c-bedc-1314bdaa9096';  -- SS0001HB.B1 · HandBag Linear Big Vermelho · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'e6816310-92b6-4b74-8e19-5d31d6eac2aa';  -- SS0001HB.B1 · HandBag Linear Big Vermelho · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'eacb8799-d898-4804-9b3d-e7b6e3938783';  -- SS0001HB.B2 · HandBag Linear Big Blanc · blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '13dfd044-6a68-4cc6-a4f8-3cda6b84239b';  -- SS0001HB.B2 · HandBag Linear Big Blanc · blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '56c9518f-3f70-410f-8acd-812effd7a3e8';  -- SS0001HB.B2 · HandBag Linear Big Blanc · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '7d6be3af-01ed-4d8b-916f-5b67bb929a52';  -- SS0001HB.B3 · HandBag Linear Big Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '18e9c0b0-1d9d-455f-bbdb-e68ad7ebdf3d';  -- SS0001HB.M1 · HandBag Linear Medium Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '2226954c-1a05-4be1-b90b-675bbff325b1';  -- SS0001HB.M1 · HandBag Linear Medium Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '87a3ff84-502c-4eed-b005-c6c1bc95c5de';  -- SS0001HB.M1 · HandBag Linear Medium Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '0d4f1e08-4dd8-49ba-830e-667ee278634b';  -- SS0001HB.M2 · HandBag Linear Medium Vermelha · vermelha
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '4d9330ab-d157-45c8-91ec-b6d3fdcdf9b7';  -- SS0001HB.M2 · HandBag Linear Medium Vermelha · Vermelha
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c7a8eede-90eb-4b15-a729-edd4763f4e1f';  -- SS0001HB.M2 · HandBag Linear Medium Vermelha · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '663d09b3-c27c-4691-8128-bd1124eb5732';  -- SS0001HB.M2 · HandBag Linear Medium Vermelha · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '160ae7ce-d47d-4562-9bdf-47c591d1653f';  -- SS0001HB.M3 · HandBag Linear Medium Branca · blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '34d358fc-3cef-44b6-8c4a-2eaa0a60010e';  -- SS0001HB.M3 · HandBag Linear Medium Branca · branca
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'dc81df54-462f-4f54-82b0-49e2217721a7';  -- SS0001HB.M4 · HandBag Linear Medium Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c838beab-65a4-41ba-9426-36b7dceaba86';  -- SS0001HB.M4 · HandBag Linear Medium Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '528d468e-e5c6-4d1a-b338-0aeee9c9772d';  -- SS0001HB.M4 · HandBag Linear Medium Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3a8a78f5-bcd4-47b6-90a4-8fd81e6f0bf3';  -- SS0001HB.M4 · HandBag Linear Medium Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '0a9fb995-09ce-420b-8e02-d97efc0e6708';  -- SS0001HB.M4 · HandBag Linear Medium Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '45fca22c-29f7-41e5-8ed3-649280093a08';  -- SS0001HB.S1 · HandBag Linear Small Caramelo · caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '7b278fbf-c09f-4889-98b0-3d9c73f7f4ba';  -- SS0001HB.S1 · HandBag Linear Small Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c65705fb-9c3e-4ffb-a86b-df2c9fcebef4';  -- SS0001HB.S1 · HandBag Linear Small Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c54f9271-1fee-4f15-90a7-2fa19e2e4f66';  -- SS0001HB.S2 · HandBag Linear Small Vermelha · vermelha
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '84ac8b63-1151-41af-b984-da5201f2cbe9';  -- SS0001HB.S3 · HandBag Linear Small Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'd10c30db-1e64-49ad-a44f-dafb2ae10bd9';  -- SS0001HB.S3 · HandBag Linear Small Chocolate · Chocolate
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'a3fcfcae-3413-4f40-9dc7-bd564b34f1ee';  -- SS0001HB.S4 · HandBag Linear Small Branca · blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '1e3c0cbb-0cc1-45ff-9a8c-bd5a916f51b7';  -- SS0001HB.S4 · HandBag Linear Small Branca · blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '678cf4c3-744d-48ae-9dea-94fc7d892737';  -- SS0001HB.S4 · HandBag Linear Small Branca · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '512a7c00-5a86-4f2d-a2d8-26f84463f139';  -- SS0001HB.S4 · HandBag Linear Small Branca · 
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '07fbc66d-c3c6-47df-b808-83bdb4504614';  -- SS0001SB.B1 · ShoulderBag Ravelle Big Areia · areia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f478b612-838c-42d7-89d1-c01113248d68';  -- SS0001SB.B1 · ShoulderBag Ravelle Big Areia · Areia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '1f620443-b8ac-465b-9da0-05f9b24fd82b';  -- SS0001SB.B2 · ShoulderBag Ravelle Big Jeans · jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '37f9a9a1-59ef-4d91-be47-152303fb19c5';  -- SS0001SB.B2 · ShoulderBag Ravelle Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'd9c3e3f1-d41b-4875-aa98-9fbf90d3388f';  -- SS0001SB.B2 · ShoulderBag Ravelle Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '78e1b574-f31d-4aef-95c8-f0286bbc7793';  -- SS0001SB.B3 · ShoulderBag Ravelle Big Mostarda · mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'ed25685e-93f5-4e19-94cc-6ac7f77dd889';  -- SS0001SB.B3 · ShoulderBag Ravelle Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b30f7054-8cf3-4d65-a37e-d955d47856d2';  -- SS0001SB.B3 · ShoulderBag Ravelle Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c143dc26-cd0b-46b4-afd4-3c067135fce5';  -- SS0001SB.B3 · ShoulderBag Ravelle Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b016b292-c76d-4b26-b3c2-967412219f35';  -- SS0001SB.B4 · ShoulderBag Ravelle Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f24c44f6-d15c-49c0-a349-77af3b3a9cfb';  -- SS0001SB.B4 · ShoulderBag Ravelle Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '95612fa2-4f6e-4cb7-9471-df0ae132ad29';  -- SS0001SB.S1 · ShoulderBag Ravelle Small Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '128ce5c6-19c2-430b-8d9c-67a5e3f0f57d';  -- SS0001SB.S1 · ShoulderBag Ravelle Small Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '098f7a27-d100-4037-9fd9-7219325974fc';  -- SS0001SB.S1 · ShoulderBag Ravelle Small Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '85639b39-9431-401b-9d53-9b10ff4d330d';  -- SS0001SB.S1 · ShoulderBag Ravelle Small Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '0d88de37-6ddb-4770-91d3-800d120329c5';  -- SS0001SB.S2 · ShoulderBag Ravelle Small Mostarda · mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '31bb2d22-e545-4700-8630-c1d2112a813b';  -- SS0001SB.S2 · ShoulderBag Ravelle Small Mostarda · mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '9e65dcb4-cd18-4597-9e0d-3c37ae6fd10e';  -- SS0001SB.S2 · ShoulderBag Ravelle Small Mostarda · mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '8644f781-9f1d-4540-b4c5-3c42d8b99922';  -- SS0001SB.S3 · ShoulderBag Ravelle Small Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '961c3f96-6a23-41d8-af7f-b27a8cd247f3';  -- SS0001SB.S3 · ShoulderBag Ravelle Small Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f47f08d1-9863-4b60-8bf6-8e03b1cd0936';  -- SS0001SB.S3 · ShoulderBag Ravelle Small Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f8c88c2e-0bc6-44b5-b520-76e759b5d9f6';  -- SS0001SB.S4 · ShoulderBag Ravelle Small Areia · areia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '4af9ce27-85af-4391-b685-4b66000e69ad';  -- SS0001SB.S4 · ShoulderBag Ravelle Small Areia · Areia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'eba1fa64-f744-48c9-b623-1f1bfc806633';  -- SS0002HB.B1 · HandBag Cerne Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '1134bb3c-5e98-44f9-a9e0-b92b969c20c4';  -- SS0002HB.B1 · HandBag Cerne Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'e757b6c6-3b79-456b-9c4a-8c3f5be3136e';  -- SS0002HB.B2 · HandBag Cerne Big Croco Preto · Croco Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '15b72121-29f7-4fea-92be-d217047ff57c';  -- SS0002HB.B2 · HandBag Cerne Big Croco Preto · preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '720e8cb5-ffee-4d59-a770-7ffd51236f9b';  -- SS0002HB.B4 · HandBag Cerne Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f8cbd7ef-7f18-4836-914d-d0e91f05d2ac';  -- SS0002HB.B4 · HandBag Cerne Big Mostarda · Mostarda
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '8c262993-1045-48a8-81bd-4bfa04fa150a';  -- SS0002SB.M1 · Shoulder (Meia Lua) EveningColletion Medium Café · Café
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'a4f04eb1-33b6-45ff-8d8b-b78497e69983';  -- SS0002SB.M2 · Shoulder (Meia Lua) EveningColletion Medium Marfim · Marfim
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3b9b6bae-3a47-4cb4-a682-bd59a293914f';  -- SS0003HB.B1 · Handbag Oriane Big Preto · Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'fa14e2c6-b0eb-4b98-8c1a-12cfc37d7d1d';  -- SS0003HB.B1 · Handbag Oriane Big Preto · Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'dbe17e7d-b46f-4eaf-a0ed-fbe6f762626b';  -- SS0003HB.B2 · HandBag Oriane Big Blanc · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '125c18cf-155e-48e1-89bd-26599a3aa7f1';  -- SS0003HB.B2 · HandBag Oriane Big Blanc · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'd0002767-3d20-4bda-8132-051730edcb5a';  -- SS0003HB.B3 · Handbag Oriane Big Vermelha · Vermelha
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'c7e17f94-94b6-45f8-9fba-c16fa553c0b2';  -- SS0003HB.B4 · Handbag Oriane Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3c95813a-e67b-45c2-8eae-2fd67cab8c47';  -- SS0003HB.B4 · Handbag Oriane Big Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'fd044d8d-a3b4-4b75-9098-eb75fe9716b8';  -- SS0003HB.B5 · Handbag Oriane Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '81f96448-3130-4bef-8f6b-b07cf1fd7eda';  -- SS0003HB.B5 · Handbag Oriane Big Jeans · Jeans
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '806eb820-9b46-484a-8fa7-da5c0a90012b';  -- SS0003HB.B6 · Handbag Oriane Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '97d5f9f0-bdde-4bfd-a6f3-3bcdfc3f4aa8';  -- SS0003HB.B6 · Handbag Oriane Big Caramelo · Caramelo
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'afdc82db-34aa-4e9b-be87-c68cf5c13f7a';  -- SS0003SB.B1 · ShoulderBag Marea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'c8ea3789-8c91-4233-8c77-5c1163ee2366';  -- SS0003SB.B1 · ShoulderBag Marea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '3af88248-4c2b-4cd7-a6c9-6bf28c911f51';  -- SS0003SB.B1 · ShoulderBag Marea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '97d65069-c7fa-4ea8-a013-9d0c5e175da6';  -- SS0003SB.B2 · Shoulder Marea Big Preto · preto
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'c1a33c67-75b5-4175-be7e-477ab2d4415e';  -- SS0003SB.B2 · Shoulder Marea Big Preto · Preto
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'd149e9a7-6964-436c-af04-bbac6718c775';  -- SS0003SB.B2 · Shoulder Marea Big Preto · Preto
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '30251a7b-0560-45e2-934f-49b1ad04936c';  -- SS0003SB.B2 · Shoulder Marea Big Preto · Preto
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '0567daf2-f75b-4e68-98d4-94a877649afc';  -- SS0003SB.B3 · Shoulder Marea Big Bordô · bordô
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'e31d2cae-a834-4e3b-906b-1d0134edbcd7';  -- SS0003SB.B3 · Shoulder Marea Big Bordô · Bordô
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '1dd55601-8a2a-47fe-9662-04c4ffd594f6';  -- SS0003SB.B3 · Shoulder Marea Big Bordô · Bordô
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = '1c8d48bf-4dfa-4a2f-a4b9-ab8288a2e2ee';  -- SS0003SB.B3 · Shoulder Marea Big Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '35678f7f-cd4c-4358-b9d1-55e6362cb24e';  -- SS0003WB.B1 · WorkBag Elara Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '1ceef127-97dd-4d55-9fae-f432d02e313d';  -- SS0003WB.B1 · WorkBag Elara Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b221a893-ca43-4157-b042-c746f48cb6fd';  -- SS0003WB.B2 · WorkBag Elara Big Tweed · Tweed
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '9d42f00b-913f-4e31-afdd-98edb3a11695';  -- SS0003WB.B2 · WorkBag Elara Big Tweed · Tweed
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f23aa095-041f-4f3d-9ffd-c6e7af0b0741';  -- SS0003WB.B3 · WorkBag Elara Big Blanc · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '6497679c-b390-4af3-ab0e-65ae08b9ac04';  -- SS0003WB.B3 · WorkBag Elara Big Blanc · Blanc
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f8e90fa5-df51-444a-a23a-d84f5690a28d';  -- SS0003WB.B4 · WorkBag Elara Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3f04fcf3-16b3-465c-82c1-c33c8d505cd3';  -- SS0003WB.B4 · WorkBag Elara Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'ef1fdd17-e165-4265-a902-738ce3aead01';  -- SS0003WB.B5 · WorkBag Elara Big Amelie Sand · Amelie Sand
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '8e0c8811-f754-4e53-90ee-5c5bcfbb4f4e';  -- SS0004HB.B1 · HandBag Alba Big Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '7b2670e2-8dff-4906-9a27-951356fac495';  -- SS0004HB.B1 · HandBag Alba Big Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '09bde610-9968-4f92-852f-985b7eae5b46';  -- SS0004HB.B2 · HandBag Alba Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '827cb508-37fa-4e49-bcce-a23262f50317';  -- SS0004HB.B2 · HandBag Alba Big Café · Café
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'fbbde7fa-bb17-42b2-a05c-8170dcb65355';  -- SS0004HB.B3 · HandBag Alba Big Areia · Areia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'be40f766-460a-4037-82c2-8255823b5269';  -- SS0004HB.B3 · HandBag Alba Big Areia · Areia
update public.vessel_lotes set material = 'couro', material_fonte = 'dono' where id = 'a3b0acc5-ac05-44a1-bdb8-2e536000765b';  -- SS0004SB.B1 · Shoulder Nerea Big Caramelo · Caramelo
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'be945e29-b2dc-49fd-84dc-29397ec20407';  -- SS0008HB.M1 · HandBag Lunea Medium Preto c/ Bordô · Preto c/ Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3dc7f4ea-231e-4679-bc73-3d79daa3cd71';  -- SS0008HB.M1 · HandBag Lunea Medium Preto c/ Bordô · Preto c/ Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'ebca406b-a477-4884-abfa-c1d195becf5b';  -- SS0008HB.M2 · HandBag Lunea Medium Bordô c/ Amêndoas · Bordô c/ Amêndoas
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '8f41f235-36fc-4641-b76e-b05428f621db';  -- SS0008HB.M2 · HandBag Lunea Medium Bordô c/ Amêndoas · Bordô c/ Amêndoas
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '318fe668-fbfa-44ef-9e9a-4b56f738e655';  -- SS0008HB.M3 · HandBag Lunea Medium Preto · Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '591be081-dcb7-4ee1-8f72-263cd18fc963';  -- SS0008HB.M4 · HandBag Lunea Medium Pinhão · Pinhão
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '833f2bf2-7629-4d75-8d36-6292379ce015';  -- SS0008HB.M4 · HandBag Lunea Medium Pinhão · Pinhão
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '66413559-960c-4454-9ea8-9380d746a5ab';  -- SS0008HB.M5 · HandBag Lunea Medium Fendi · fendi
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '5bb92c62-21eb-4f52-8b14-87fcb6aba93a';  -- SS0008HB.M5 · HandBag Lunea Medium Fendi · Fendi
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b29aefcc-e39e-4d21-8614-a139b5d78433';  -- SS0008HB.M5 · HandBag Lunea Medium Fendi · Fendi
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'e80ca720-418a-4283-92de-df612f0225e5';  -- SS0008HB.M5 · HandBag Lunea Medium Fendi · Fendi
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '685d75fb-d342-4bb1-8895-eebcae98f288';  -- SS0008HB.M6 · HandBag Lunea Medium Oliva · olivia
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'af02fc45-581a-4462-908d-24049a623783';  -- SS0009SB.M1 · HandBag Solenne Medium Preto · Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'f75802f9-5086-4824-94b7-ed1a64afe0ea';  -- SS0009SB.M1 · HandBag Solenne Medium Preto · Preto
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b8e19d74-acb7-4d60-a864-5e8fb01a9e2c';  -- SS0009SB.M2 · HandBag Solenne Medium Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'bcd652cf-c5dc-4b01-a8c7-a1f2875fc6d3';  -- SS0009SB.M2 · HandBag Solenne Medium Bordô · Bordô
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '5aa224b1-5840-48b0-8443-20e9229279d0';  -- SS0009SB.M3 · HandBag Solenne Medium Mostarda · mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'aefaef9a-bb1c-41ef-8b4d-a5e67805ed19';  -- SS0009SB.M3 · HandBag Solenne Medium Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'd5f3e970-7101-4d5f-93e9-98cb907ac0ce';  -- SS0009SB.M3 · HandBag Solenne Medium Mostarda · Mostarda
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3632ff8e-bced-4c75-b9c2-4b05bfd8f902';  -- SS0009SB.M5 · HandBag Solenne Medium Amelie Branco · Amelie Branco
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '068f240a-034e-4d78-85ee-11abcd58697b';  -- SS0009SB.M5 · HandBag Solenne Medium Amelie Branco · Amelie Branco
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'feabdc52-e77d-400c-94c5-7c0f524d39d6';  -- SS0010HB.S1 · HandBag 00010 Small Vermelho · Vermelho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '7e36f226-f110-47e7-99e3-685936956966';  -- SS0010HB.S2 · HandBag 00010 Small Areia c/ Vinho · Areia c/ Vinho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = 'b05d9e6e-ee25-40d7-861a-7ed883a1b269';  -- SS0010HB.S2 · HandBag Petit Small Areia c/ Vinho · Areia c/ Vinho
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '96c216f3-8184-4165-9244-d4633c1f6fad';  -- SS0010HB.S3 · HandBag 00010 Small Café c/ Panacota · Café c/ Panacota
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '2b5b7d6c-24e9-418b-926e-55c4f89ce57e';  -- SS0010HB.S4 · HandBag 00010 Small Caramelo c/ Panacota · Caramelo c/ Panacota
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '57303f12-ba97-4476-aa9d-4f3b5e1194e3';  -- SS0010HB.S4 · HandBag 00010 Small Caramelo c/ Panacota · Caramelo c/ Panacota
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '274033df-3b10-40ed-9223-ef93140d47b9';  -- SS0010HB.S4 · HandBag Petit Small Caramelo c/ Panacota · Caramelo c/ Panacota
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '7b30b274-8dec-4391-9aa6-903328acbe0c';  -- SS0010HB.S5 · HandBag 00010 Small Café c/ Green · Café c/ Green
update public.vessel_lotes set material = 'canvas', material_fonte = 'dono' where id = '3316452c-24c6-4441-b01d-6350c0b7cef3';  -- SS1088-Mostarda · De Mão Média Bath Teste · Mostarda

-- ══════════════════════════════════════════════════════════════════════════
-- 7. RECALCULA A GARANTIA DE TODA PEÇA JÁ REGISTRADA
-- ══════════════════════════════════════════════════════════════════════════
--
-- O gatilho da seção 6 já cobriu as peças dos 140 lotes. Isto cobre o resto
-- (peça de lote que não estava na lista → garantia nula, pela regra) e deixa
-- o resultado independente de o gatilho ter disparado ou não.
update public.vessel_registros r
   set garantia_ate = public.vessel_garantia_ate_do_registro(r.codigo)
 where r.garantia_ate is distinct from public.vessel_garantia_ate_do_registro(r.codigo);
