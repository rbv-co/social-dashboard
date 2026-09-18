-- A DERIVA: uma função que já estava no ar sem migration nenhuma.
--
-- ── O QUE ACONTECEU ──────────────────────────────────────────────────────────
--
-- `vessel_abrir_pedido_de_registro` existe em PRODUÇÃO com SETE parâmetros
-- (o sétimo é `p_nascimento date default null`). A única definição que existe
-- em ARQUIVO neste repositório, em
-- `2026-09-03-zz-vessel-garantia-com-dono.sql`, tem SEIS — sem `p_nascimento`.
--
-- Alguém criou a versão de sete direto no banco, com `create or replace
-- function` rodado à mão (ou por uma migration que nunca foi commitada), sem
-- nunca ter passado por este repositório. O registro de migrations do projeto
-- está zerado (ver `project_iamundi_migrations_nao_registradas`), o que é
-- exatamente a condição que deixa esse tipo de deriva invisível: nada aqui
-- comparava "o que o banco tem" com "o que o repositório documenta".
--
-- A revisão final da Fase 1 de contas (17/09/2026) mediu isso: a migration
-- `2026-09-17-vessel-registro-com-conta.sql` chama
-- `vessel_abrir_pedido_de_registro` com SETE argumentos posicionais — a
-- chamada está certa contra o banco de produção, mas não bate com NENHUM
-- arquivo do repositório. Três consequências práticas disto, registradas no
-- relatório da revisão:
--
--   1. O erro é MUDO na aplicação: uma migration que chama a função de sete
--      argumentos sobe verde mesmo que ela não exista — o corpo de um
--      `plpgsql` só é resolvido na primeira EXECUÇÃO, não na criação. A falha
--      só apareceria quando uma cliente clicasse em "Registrar".
--   2. Reaplicar `2026-09-03-zz-vessel-garantia-com-dono.sql` recria a versão
--      de SEIS parâmetros e NÃO TOCA na de sete — as duas convivem como
--      SOBRECARGA (mesmo nome, assinaturas diferentes). Se um dia alguém
--      decidir "limpar a duplicata" e apagar a de seis achando que é a
--      antiga, quebra o registro por conta em silêncio — a de seis nunca foi
--      chamada por ninguém nesta fase, mas apagar a de SETE por engano
--      derrubaria `vessel_registrar_como_cliente` na hora.
--   3. Um ambiente novo (staging, banco restaurado do zero) NÃO TEM a versão
--      de sete — esta fase não podia ser reconstruída a partir deste
--      repositório antes deste arquivo existir.
--
-- ⚠️ ESTE ARQUIVO SÓ DOCUMENTA O QUE JÁ ESTÁ NO AR. O corpo da função abaixo
-- é a definição REAL, extraída do banco de produção com `pg_get_functiondef`
-- em 17/09/2026 (a pedido do dono, que tem acesso de leitura) — não foi
-- reescrito. A data no nome do arquivo (2026-09-16) é ANTERIOR às migrations
-- desta fase de propósito: é o que essas migrations já assumiam encontrar no
-- banco quando foram escritas.
--
-- ⚠️ A COLUNA `vessel_pedidos_de_registro.nascimento` TAMBÉM NÃO EXISTE EM
-- ARQUIVO NENHUM. O corpo desta função grava nela (`insert into
-- vessel_pedidos_de_registro (..., nascimento) values (..., p_nascimento)`) —
-- é a MESMA deriva, só que na tabela em vez da função: alguém rodou o
-- `alter table` direto no banco junto com o `create or replace function`, e
-- nenhum dos dois ficou registrado aqui. Sem esta coluna, nem a definição
-- verbatim abaixo chegaria a compilar num banco reconstruído do repositório.
alter table public.vessel_pedidos_de_registro
  add column if not exists nascimento date;

comment on column public.vessel_pedidos_de_registro.nascimento is
  'Data de nascimento informada no pedido — usada para completar o cadastro '
  'da cliente no Bling. Parte da mesma deriva de vessel_abrir_pedido_de_registro '
  '(ver o cabeçalho deste arquivo): existia em produção sem migration.';

-- ── A DEFINIÇÃO, VERBATIM ────────────────────────────────────────────────────
-- Extraída com: select pg_get_functiondef(
--   'public.vessel_abrir_pedido_de_registro(text,text,text,text,text,date,date)'::regprocedure);
CREATE OR REPLACE FUNCTION public.vessel_abrir_pedido_de_registro(p_codigo text, p_nome text, p_cpf text, p_whatsapp text, p_onde text DEFAULT NULL::text, p_comprado_em date DEFAULT NULL::date, p_nascimento date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_cpf    text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_zap    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome   text := left(trim(coalesce(p_nome, '')), 120);
  v_sku    text;
  v_dono   record;
  v_id     uuid;
begin
  select l.sku into v_sku
    from public.vessel_pecas p join public.vessel_lotes l on l.id = p.lote_id
   where p.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'nao_existe');
  end if;

  if v_nome = '' or length(v_zap) not in (10, 11) then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  if not public.vessel_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;
  -- Data de compra no futuro nao existe, e data de compra anterior a fabricacao
  -- da peca tambem nao. As duas sao erro de digitacao — ou tentativa de esticar
  -- a garantia, que conta dois anos a partir dela.
  if p_comprado_em is not null and p_comprado_em > current_date then
    return json_build_object('ok', false, 'motivo', 'compra_no_futuro');
  end if;

  -- ⚠️ NASCIMENTO TEM DE SER PLAUSIVEL. Sem isto, um erro de digitacao ("2026"
  -- no lugar de "1926") entra e vai parar NO CADASTRO DO BLING, sobrescrevendo
  -- o que a loja tinha. 120 anos e o limite; nascer no futuro nao existe.
  if p_nascimento is not null
     and (p_nascimento > current_date or p_nascimento < current_date - interval '120 years')
  then
    return json_build_object('ok', false, 'motivo', 'nascimento_invalido');
  end if;

  select r.nome, r.codigo into v_dono from public.vessel_registros r where r.codigo = v_codigo;

  select id into v_id from public.vessel_pedidos_de_registro
   where codigo = v_codigo and cpf = v_cpf and estado = 'pendente'
   order by criado_em desc limit 1;

  if v_id is null then
    insert into public.vessel_pedidos_de_registro
      (codigo, nome, cpf, whatsapp, onde_comprou, comprado_em, nascimento)
    values (v_codigo, v_nome, v_cpf, v_zap,
            left(nullif(trim(coalesce(p_onde, '')), ''), 120), p_comprado_em, p_nascimento)
    returning id into v_id;
  end if;

  return json_build_object(
    'ok', true, 'pedido', v_id, 'sku', v_sku,
    'ja_tem_dono', v_dono.codigo is not null,
    'dono_curto', case when v_dono.codigo is null then null
                       else public.vessel_nome_curto(v_dono.nome) end);
end;
$function$
;

-- ── O PORTÃO ─────────────────────────────────────────────────────────────────
-- ⚠️ MEDIDO NO BANCO (17/09/2026): só `postgres` e `service_role` têm
-- execução nesta função — ninguém precisou "consertar" o ACL dela, ela já
-- nasceu fechada. Mesmo assim o revoke/grant explícito entra aqui, no mesmo
-- padrão das irmãs (2026-09-03-zz-vessel-garantia-com-dono.sql, seção 11):
-- reaplicar este arquivo (por exemplo ao reconstruir um banco do zero) tem
-- de chegar no MESMO estado, e não depender de ninguém ter revogado à mão
-- antes.
--
-- ⚠️ NÃO CONFUNDIR com a versão de SEIS parâmetros. As assinaturas são
-- diferentes ((text,text,text,text,text,date) contra
-- (text,text,text,text,text,date,date)) — cada `revoke`/`grant` abaixo atinge
-- SÓ a de sete. A de seis mantém o próprio portão, já fechado em
-- 2026-09-03-zz-vessel-garantia-com-dono.sql, e continua existindo: as duas
-- ficam como sobrecarga do mesmo nome. NENHUMA delas é concedida a `anon` ou
-- `authenticated` — só a edge `vessel-registrar-garantia`, com a chave de
-- serviço, chama a de sete (é o caminho ligado ao perfil da cliente,
-- 2026-09-17-vessel-registro-com-conta.sql).
revoke all on function public.vessel_abrir_pedido_de_registro(text, text, text, text, text, date, date)
  from public, anon, authenticated;
grant execute on function public.vessel_abrir_pedido_de_registro(text, text, text, text, text, date, date)
  to service_role;
