-- VERBATIM de levantamento/02-funções.csv (gerado por fatia510.mjs, Plano 5.10 Task 2): o portão is_vessel_admin,
-- 11 ajudantes, as 7 funções de gatilho (vessel_espelhar_agora SEM gatilho: o dele é da fatia do 5.11, em
-- vessel_lista_espera) e as 16 RPCs do painel. Os 6 gatilhos vivos em produção vão no fim, com OF/WHEN das
-- migrations; vessel_lote_novo_pede_foto e vessel_cartao_pedido_novo_acorda_o_robo NÃO (removidos em 10/10:
-- db/migrations/2026-10-10-robos-na-vps-sem-gatilho-do-actions.sql). `create or replace trigger`: se o gerador do
-- 02-gatilhos.sql também os emitir (com CONFERIDOS), a recriação aqui é a mesma (Rulings 5.7-1, 5.9-1, 5.10-4).

CREATE OR REPLACE FUNCTION public.is_vessel_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select public.conta_ativa() and coalesce(
    (select 'autenticidade' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.vessel_chave_do_produto(p_sku text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  -- A MESMA NORMALIZAÇÃO do número de série (`numeroDeSerie` em
  -- verify/regras.js e em lotes.js): sobra letra e dígito, em maiúscula.
  -- Comparar o texto cru deixaria "SS0001HB.B1" e "ss0001hb b1" como produtos
  -- diferentes, e eles imprimem o MESMO número.
  select nullif(upper(regexp_replace(coalesce(p_sku, ''), '[^A-Za-z0-9]', '', 'g')), '');
$function$;

CREATE OR REPLACE FUNCTION public.vessel_cpf_mascarado(p_cpf text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case when length(regexp_replace(coalesce(p_cpf,''), '\D', '', 'g')) <> 11 then null
    else '***.' || substr(regexp_replace(p_cpf, '\D', '', 'g'), 4, 3)
         || '.' || substr(regexp_replace(p_cpf, '\D', '', 'g'), 7, 3) || '-**' end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_cpf_valido(p_cpf text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare
  v text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  s int; d1 int; d2 int; i int;
begin
  if length(v) <> 11 then return false; end if;
  -- 11111111111 e os outros dez repetidos passam na conta dos digitos: e o
  -- CPF falso que todo mundo digita quando quer so passar pela tela.
  if v ~ '^(\d)\1{10}$' then return false; end if;
  s := 0;
  for i in 1..9 loop s := s + substr(v, i, 1)::int * (11 - i); end loop;
  d1 := 11 - (s % 11); if d1 >= 10 then d1 := 0; end if;
  s := 0;
  for i in 1..10 loop s := s + substr(v, i, 1)::int * (12 - i); end loop;
  d2 := 11 - (s % 11); if d2 >= 10 then d2 := 0; end if;
  return d1 = substr(v, 10, 1)::int and d2 = substr(v, 11, 1)::int;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_meses_de_garantia(p_material text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select case p_material
           when 'canvas' then 24
           when 'couro'  then 6
         end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_garantia_ate(p_compra date, p_material text)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  select (p_compra + make_interval(months => public.vessel_meses_de_garantia(p_material)))::date;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_data_da_compra(p_quando text, p_bling_pedido text, p_registro timestamp with time zone)
 RETURNS date
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vessel_garantia_ate_do_registro(p_codigo text)
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vessel_peca_presa(p_codigo text)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- PRESA = esta peça já existe no mundo, fora daqui. Mexer no número dela
  -- deixaria mentindo alguma coisa que já saiu: a etiqueta gravada, a garantia
  -- da cliente, ou o cartão impresso dentro da bolsa.
  --
  -- A ORDEM É A DA GRAVIDADE, porque só um motivo é devolvido: a garantia é de
  -- uma pessoa de verdade, a etiqueta gravada pode estar numa bolsa, e o cartão
  -- é papel — o mais fácil de refazer dos três, embora não se desfaça.
  select case
    when exists (select 1 from public.vessel_registros r where r.codigo = p_codigo)
      then 'garantia'
    when exists (select 1 from public.vessel_pecas p
                  where p.codigo = p_codigo and p.gravada_em is not null)
      then 'gravada'
    when exists (select 1 from public.vessel_pecas p
                  where p.codigo = p_codigo and p.cartao_gerado_em is not null)
      then 'cartao'
    -- Pedido em aberto conta igual: entre o "gerar" e o arquivo no Zoho existe
    -- uma janela de minutos, e renumerar dentro dela imprime o número errado.
    when exists (select 1 from public.vessel_cartao_pedidos q
                  where q.situacao in ('na_fila', 'rodando')
                    and p_codigo = any (q.pecas))
      then 'cartao'
    else null
  end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_maior_da_serie(p_sku text, p_excluir_lote uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- ⚠️ SEM SKU, VOLTA ZERO — e isso é o certo, não um buraco: `numeroDeSerie`
  -- devolve string vazia quando não há SKU, então peça sem produto não imprime
  -- número nenhum e não tem com o que colidir.
  select coalesce(max(p.numero_na_serie), 0)
    from public.vessel_pecas p
    join public.vessel_lotes l on l.id = p.lote_id
   where public.vessel_chave_do_produto(l.sku) is not null
     and public.vessel_chave_do_produto(l.sku) = public.vessel_chave_do_produto(p_sku)
     and (p_excluir_lote is null or l.id <> p_excluir_lote);
$function$;

CREATE OR REPLACE FUNCTION public.vessel_criar_pecas(p_lote uuid, p_de integer, p_ate integer)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ALFABETO constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem O, 0, I, 1
  v_codigo text; v_bytes bytea; i int; j int; tentativa int; v_feitas int := 0;
begin
  -- O PORTÃO. As duas funções que chamam esta já conferem antes, e continuam
  -- passando: `auth.uid()` aqui dentro ainda é o da pessoa que chamou.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  -- Um intervalo absurdo seguraria a transação até o timeout. O lote já é
  -- limitado a 500 nas duas funções que chamam esta; aqui a trava é do próprio
  -- ajudante, para ele não depender de quem o chama.
  if p_de is null or p_ate is null or p_ate < p_de or (p_ate - p_de) >= 500 then
    raise exception 'intervalo_invalido';
  end if;

  for i in p_de..p_ate loop
    tentativa := 0;
    loop
      -- Sorteio CRIPTOGRAFICO, nao random(). O random() do Postgres e
      -- previsivel: quem comprasse algumas bolsas e olhasse os codigos poderia
      -- calcular os proximos — e a protecao contra falsificacao depende
      -- justamente de o codigo nao ser adivinhavel.
      -- O alfabeto tem exatamente 32 letras e 256/32 = 8, entao `byte % 32` nao
      -- puxa pra letra nenhuma (sem vies de modulo).
      v_bytes := extensions.gen_random_bytes(10);
      v_codigo := '';
      for j in 0..9 loop
        v_codigo := v_codigo || substr(ALFABETO, 1 + (get_byte(v_bytes, j) % length(ALFABETO)), 1);
      end loop;
      begin
        insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
        values (v_codigo, p_lote, i);
        v_feitas := v_feitas + 1;
        exit;
      exception when unique_violation then
        tentativa := tentativa + 1;
        if tentativa > 20 then raise exception 'nao consegui sortear codigo livre'; end if;
      end;
    end loop;
  end loop;
  return v_feitas;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_renumerar_lote(p_lote uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n int; v_sku text; v_base int;
begin
  -- Portão por dentro. `revoke ... from public` NÃO tira a concessão que o
  -- Postgres dá por DEFAULT PRIVILEGES a `authenticated`, então quem protege
  -- este ajudante é esta linha, não o grant.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  select sku into v_sku from public.vessel_lotes where id = p_lote;

  with presa as (
    -- PRESA = está no mundo. A definição mora em `vessel_peca_presa`, e só lá:
    -- ela estava escrita quatro vezes, e somar uma condição em quatro lugares é
    -- somar em três e esquecer um — caladamente.
    select p.codigo, p.numero_na_serie
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and public.vessel_peca_presa(p.codigo) is not null
  ),
  -- ⚠️ O QUE MUDOU: as peças dos OUTROS lotes do mesmo produto também ocupam
  -- número. Sem isto, renumerar puxava as livres para 1, 2, 3 e recriava a
  -- colisão que as outras duas funções acabaram de evitar.
  dos_irmaos as (
    select p.numero_na_serie
      from public.vessel_pecas p
      join public.vessel_lotes l on l.id = p.lote_id
     where l.id <> p_lote
       and public.vessel_chave_do_produto(l.sku) is not null
       and public.vessel_chave_do_produto(l.sku) = public.vessel_chave_do_produto(v_sku)
  ),
  livre as (
    -- a ordem atual manda: quem era o primeiro continua sendo o primeiro
    select p.codigo,
           row_number() over (order by p.numero_na_serie, p.criado_em, p.codigo) as ordem
      from public.vessel_pecas p
     where p.lote_id = p_lote
       and not exists (select 1 from presa x where x.codigo = p.codigo)
  ),
  vaga as (
    select n, row_number() over (order by n) as ordem
      from generate_series(
             1,
             -- teto folgado: o que o produto inteiro já usa, mais o que este
             -- lote precisa. Sempre sobra vaga suficiente.
             (select count(*) from public.vessel_pecas where lote_id = p_lote)
               + (select count(*) from presa)
               + (select count(*) from dos_irmaos)
               + coalesce((select max(numero_na_serie) from dos_irmaos), 0)
           ) as n
     where not exists (select 1 from presa x where x.numero_na_serie = n)
       and not exists (select 1 from dos_irmaos y where y.numero_na_serie = n)
  ),
  nova as (
    select l.codigo, v.n from livre l join vaga v on v.ordem = l.ordem
  )
  update public.vessel_pecas p
     set numero_na_serie = nova.n
    from nova
   where nova.codigo = p.codigo
     and p.numero_na_serie is distinct from nova.n;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_toca_atualizado_em()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.atualizado_em := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_lotes_marcar_teste()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.teste := left(upper(coalesce(new.sku, '')), 6) = 'TESTE-';
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_lote_novo_herda_material()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_material text;
begin
  if new.material is null and nullif(trim(coalesce(new.sku, '')), '') is not null then
    select l.material into v_material
      from public.vessel_lotes l
     where l.sku = new.sku and l.material is not null
     order by l.criado_em desc, l.id desc
     limit 1;
    if v_material is not null then
      new.material := v_material;
      new.material_fonte := 'herdado';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_lote_material_recalcula_garantia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.vessel_registros r
     set garantia_ate = public.vessel_garantia_ate_do_registro(r.codigo)
   where r.codigo in (select p.codigo from public.vessel_pecas p where p.lote_id = new.id);
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_lembretes_morre_com_o_registro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.vessel_lembretes
     set cancelado_em = now(), cancelado_por = 'registro'
   where peca_codigo = upper(regexp_replace(coalesce(new.codigo, ''), '[\s.\-_]', '', 'g'))
     and cancelado_em is null;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_registros_preencher_cliente_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if new.cliente_id is null and new.pedido_id is not null then
    select pr.cliente_id into new.cliente_id
      from public.vessel_pedidos_de_registro pr
     where pr.id = new.pedido_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_espelhar_agora()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.disparar_robo(
    'vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista',
    '{"origem":"gatilho"}'::jsonb, 120000);
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_alertas()
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v json;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select json_build_object(
    'ok', true,
    'repetidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)                  as leituras,
               count(distinct l.ip_hash) as aparelhos,
               max(l.lido_em)            as ultima
          from public.vessel_leituras l
         where l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
        having count(distinct l.ip_hash) >= 5
         order by count(distinct l.ip_hash) desc
         limit 20
      ) x), '[]'::json),
    'invalidas', coalesce((
      select json_agg(x) from (
        select l.codigo,
               count(*)       as tentativas,
               max(l.lido_em) as ultima
          from public.vessel_leituras l
         where not l.achou and l.lido_em > now() - interval '30 days'
         group by l.codigo
         order by count(*) desc
         limit 20
      ) x), '[]'::json),
    'baixadas_lidas', coalesce((
      select json_agg(x) from (
        select b.codigo,
               b.motivo,
               count(l.*)     as leituras,
               max(l.lido_em) as ultima
          from public.vessel_baixas b
          join public.vessel_leituras l
            on l.codigo = b.codigo and l.achou and l.lido_em > b.baixada_em
         where b.desfeita_em is null
         group by b.codigo, b.motivo
         order by max(l.lido_em) desc
         limit 20
      ) x), '[]'::json),
    'total_leituras', (select count(*) from public.vessel_leituras where lido_em > now() - interval '30 days')
  ) into v;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_baixar_garantia(p_codigo text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_reg    record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- ⚠️ O MOTIVO É SEMPRE OBRIGATÓRIO AQUI, e não só "quando é grave" como no
  -- desmarcar gravada. Baixar apaga o vínculo de uma pessoa de verdade com a
  -- bolsa dela; decisão dessas sem motivo escrito vira mistério em três meses.
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

  -- ⚠️ SÓ APAGA DEPOIS DE GUARDAR. Na ordem inversa, uma falha no meio perderia
  -- a garantia da cliente para sempre. Como as duas rodam na mesma transação da
  -- função, ou as duas acontecem ou nenhuma acontece.
  delete from public.vessel_registros where codigo = v_codigo;

  -- A TRILHA TAMBÉM, como toda ação que muda o mundo nesta tela.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'baixar_garantia', v_motivo,
          jsonb_build_object('registrado_em', v_reg.registrado_em,
                             'garantia_ate', v_reg.garantia_ate),
          auth.uid());

  return json_build_object('ok', true, 'codigo', v_codigo,
    'aviso', 'A garantia foi encerrada. A página do selo volta a mostrar a bolsa '
          || 'sem dona, e ela pode ser registrada de novo por quem comprar.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_baixar_peca(p_codigo text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vessel_decidir_pedido_de_registro(p_pedido uuid, p_estado text, p_quem_decidiu text, p_conferencia jsonb DEFAULT NULL::jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- >>> TRAVA DA DONA (quem pode dizer 'bling')
  -- 'bling' é a palavra da EDGE (chave de serviço) — ou do dono do banco,
  -- numa conexão direta. Conta da Central logada ('authenticated') e a chave
  -- pública ('anon') NÃO: sem isto, qualquer login aprovava um pedido
  -- pendente com uma "conferência" inventada. Ver o cabeçalho do arquivo.
  if p_quem_decidiu = 'bling' and not (
       (current_setting('role', true) = 'service_role'
        and coalesce(auth.role(), 'service_role') = 'service_role')
    or (current_setting('role', true) = 'none' and auth.role() is null)
  ) then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  -- <<< TRAVA DA DONA
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

CREATE OR REPLACE FUNCTION public.vessel_definir_material_do_lote(p_lote uuid, p_material text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_antes text;
  v_fonte_antes text;
  v_material text := nullif(trim(lower(coalesce(p_material, ''))), '');
  v_registradas int := 0;
begin
  -- O PORTÃO É O MESMO DAS IRMÃS. `is_vessel_admin()` é quem manda; a tela
  -- esconder o botão é conveniência, não segurança.
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- A MESMA LISTA DA TRAVA DA COLUNA (`vessel_lotes_material_check`), conferida
  -- aqui em vez de deixar o `check` estourar: erro de constraint sobe como
  -- exceção do Postgres e chega na tela como texto técnico, em inglês.
  -- ⚠️ E NÃO ACEITA NULO — ver o aviso do cabeçalho.
  if v_material is null or v_material not in ('canvas', 'couro') then
    return json_build_object('ok', false, 'motivo', 'material_invalido');
  end if;

  select material, material_fonte into v_antes, v_fonte_antes
    from public.vessel_lotes where id = p_lote;
  if not found then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  update public.vessel_lotes
     set material = v_material,
         material_fonte = 'painel'
   where id = p_lote;
  -- O gatilho `trg_vessel_lote_material_recalcula_garantia` recalcula a
  -- `garantia_ate` das peças registradas AQUI, dentro deste update. Nada a
  -- fazer nesta função além de contar o que ele mexeu.

  -- A TRILHA, só nas peças em que a data de fato se moveu.
  with alvos as (
    select p.codigo
      from public.vessel_pecas p
      join public.vessel_registros r on r.codigo = p.codigo
     where p.lote_id = p_lote
  ), gravadas as (
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    select a.codigo, 'material_do_lote',
           case when v_antes is null then 'material escolhido no painel'
                else 'material corrigido no painel' end,
           jsonb_build_object(
             'lote', p_lote,
             'material_antes', v_antes,
             'material_fonte_antes', v_fonte_antes,
             'material_depois', v_material,
             'material_fonte_depois', 'painel'),
           auth.uid()
      from alvos a
    returning 1
  )
  select count(*) into v_registradas from gravadas;

  return json_build_object(
    'ok', true,
    'material', v_material,
    'material_fonte', 'painel',
    'material_antes', v_antes,
    -- quantas peças já registradas tiveram a data da garantia recalculada: é o
    -- número que a tela mostra, porque é o que mexeu na vida de alguém
    'registros_recalculados', v_registradas);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_desfazer_baixa(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_codigo text := upper(trim(coalesce(p_codigo, ''))); v_n int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  update public.vessel_baixas
     set desfeita_em = now(), desfeita_por = auth.uid()
   where codigo = v_codigo and desfeita_em is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return json_build_object('ok', false, 'motivo', 'nao_esta_baixada');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_desmarcar_gravada(p_codigo text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vessel_editar_lote(p_lote uuid, p_modelo text, p_cor text, p_sku text, p_fabricado_em date, p_quantidade integer, p_os text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_presas int; v_hoje int; v_maior int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  -- PRESA = ja existe no mundo, fora daqui: gravada, com garantia, ou com
  -- cartao impresso. A definicao mora em `vessel_peca_presa`.
  select count(*) filter (where public.vessel_peca_presa(p.codigo) is not null),
         count(*), coalesce(max(p.numero_na_serie), 0)
    into v_presas, v_hoje, v_maior
    from public.vessel_pecas p where p.lote_id = p_lote;

  if p_quantidade < v_presas then
    return json_build_object('ok', false, 'motivo', 'abaixo_do_gravado',
                             'gravadas', v_presas);
  end if;

  update public.vessel_lotes
     set modelo = trim(p_modelo),
         cor = nullif(trim(coalesce(p_cor, '')), ''),
         sku = nullif(trim(coalesce(p_sku, '')), ''),
         fabricado_em = coalesce(p_fabricado_em, fabricado_em),
         quantidade = p_quantidade,
         -- ⚠️ TRES ESTADOS, E NAO DOIS. NULO quer dizer "nao mexa" — e o que
         -- chega de quem chama a funcao sem o parametro, e apagar a O.S. de um
         -- lote por omissao seria perder o numero que amarra a bolsa ao papel.
         -- String VAZIA quer dizer "limpe", que e como se corrige um numero
         -- digitado errado. Texto quer dizer "grave isto".
         os = case when p_os is null then os else nullif(trim(p_os), '') end
   where id = p_lote;

  if p_quantidade > v_hoje then
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
  elsif p_quantidade < v_hoje then
    -- so saem as LIVRES: nem gravadas, nem com garantia
    delete from public.vessel_pecas
     where codigo in (
       select p.codigo from public.vessel_pecas p
        where p.lote_id = p_lote
          and public.vessel_peca_presa(p.codigo) is null
        order by p.numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
  end if;

  -- FORA DOS RAMOS, sempre. Quando a quantidade nao muda, nenhum ramo rodava e
  -- um lote que ja tivesse buraco ficava com numero maior que o total.
  perform public.vessel_renumerar_lote(p_lote);

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_excluir_lote(p_lote uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_gravadas int; v_garantias int; v_cartoes int; v_total int; v_lote record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lote from public.vessel_lotes where id = p_lote;
  if not found then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  -- ⚠️ CONTA PELO MOTIVO QUE `vessel_peca_presa` DEVOLVE, e nao por condicoes
  -- escritas aqui. Era aqui que a regra estava pela quarta vez.
  select count(*) filter (where public.vessel_peca_presa(p.codigo) = 'gravada'),
         count(*) filter (where public.vessel_peca_presa(p.codigo) = 'garantia'),
         count(*) filter (where public.vessel_peca_presa(p.codigo) = 'cartao'),
         count(*)
    into v_gravadas, v_garantias, v_cartoes, v_total
    from public.vessel_pecas p where p.lote_id = p_lote;

  -- BASTA UMA gravada para o lote inteiro ficar preso: o lote e o que da modelo,
  -- cor e data para a pagina da cliente ler. Sem ele, a peca gravada fica orfa.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;
  -- E BASTA UMA GARANTIA REGISTRADA. Apagar levaria a garantia da cliente junto,
  -- por cascade, sem ninguem ver.
  if v_garantias > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_garantia',
                             'garantias', v_garantias, 'total', v_total);
  end if;
  -- E BASTA UM CARTAO IMPRESSO. O papel esta dentro da bolsa com o numero de
  -- serie; apagar a peca libera o numero para outra, e passam a existir duas
  -- bolsas com a mesma identidade — uma delas so no papel, onde ninguem corrige.
  if v_cartoes > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_cartao',
                             'cartoes', v_cartoes, 'total', v_total);
  end if;

  -- ⚠️ A TRILHA VEM ANTES DO DELETE. Depois dele nao ha de onde ler o codigo.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  select p.codigo, 'lote_excluido', null,
         jsonb_build_object('lote', p_lote, 'modelo', v_lote.modelo,
                            'cor', v_lote.cor, 'sku', v_lote.sku,
                            'numero_na_serie', p.numero_na_serie,
                            'pecas_no_lote', v_total),
         auth.uid()
    from public.vessel_pecas p where p.lote_id = p_lote;

  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_excluir_peca(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
        v_gravada timestamptz; v_lote uuid; v_num int; v_l record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select gravada_em, lote_id, numero_na_serie into v_gravada, v_lote, v_num
    from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'esta_gravada');
  end if;
  if exists (select 1 from public.vessel_registros r where r.codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'tem_garantia', 'garantias', 1);
  end if;

  select * into v_l from public.vessel_lotes where id = v_lote;

  -- ⚠️ A TRILHA VEM ANTES DO DELETE, pelo mesmo motivo do lote.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'peca_excluida', null,
          jsonb_build_object('lote', v_lote, 'modelo', v_l.modelo, 'cor', v_l.cor,
                             'sku', v_l.sku, 'numero_na_serie', v_num),
          auth.uid());

  delete from public.vessel_pecas where codigo = v_codigo;
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  perform public.vessel_renumerar_lote(v_lote);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_fila_de_registros(p_codigo text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r json;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select coalesce(json_agg(x order by x.criado_em desc), '[]'::json) into v_r from (
    select pr.id, pr.codigo, pr.nome, pr.whatsapp, pr.onde_comprou, pr.comprado_em,
           pr.estado, pr.decidido_por_que, pr.conferencia, pr.criado_em,
           pr.decidido_em, pr.motivo,
           public.vessel_cpf_mascarado(pr.cpf) as cpf,
           l.modelo, l.cor, l.sku, p.numero_na_serie,
           (r.codigo is not null and r.pedido_id = pr.id) as e_o_dono_atual
      from public.vessel_pedidos_de_registro pr
      join public.vessel_pecas p on p.codigo = pr.codigo
      join public.vessel_lotes l on l.id = p.lote_id
      left join public.vessel_registros r on r.codigo = pr.codigo
     where p_codigo is null or pr.codigo = upper(trim(p_codigo))
  ) x;
  return json_build_object('ok', true, 'pedidos', v_r);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_gerar_lote(p_modelo text, p_cor text, p_sku text, p_quantidade integer, p_fabricado_em date, p_fotos text[], p_os text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_lote uuid; v_de int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, fotos, os, criado_por)
  values (trim(p_modelo),
          nullif(trim(coalesce(p_cor, '')), ''),
          nullif(trim(coalesce(p_sku, '')), ''),
          p_quantidade, coalesce(p_fabricado_em, current_date), p_fotos,
          -- O.S. em branco entra NULA, e nao string vazia: e o que o resto desta
          -- casa faz com campo opcional, e o que a busca e a tela esperam.
          nullif(trim(coalesce(p_os, '')), ''),
          auth.uid())
  returning id into v_lote;

  -- AQUI ESTAVA O DEFEITO: era `1, p_quantidade`, fixo.
  v_de := public.vessel_maior_da_serie(p_sku);
  perform public.vessel_criar_pecas(v_lote, v_de + 1, v_de + p_quantidade);

  return json_build_object('ok', true, 'lote_id', v_lote,
                           'quantidade', p_quantidade,
                           'primeiro_numero', v_de + 1);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_marcar_gravada(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(trim(coalesce(p_codigo, '')));
  v_existe boolean;
  v_mudou  int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select exists(select 1 from public.vessel_pecas where codigo = v_codigo) into v_existe;
  if not v_existe then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;

  update public.vessel_pecas
     set gravada_em = now()
   where codigo = v_codigo and gravada_em is null;
  get diagnostics v_mudou = row_count;

  -- Zero linhas COM a peça existindo só pode ser uma coisa: ela já estava
  -- gravada. Não se inventa erro para isso.
  return json_build_object('ok', true, 'ja_estava', v_mudou = 0);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_pedir_cartoes(p_pecas text[])
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pecas text[];
  v_faltando text[];
  v_repetidas int;
  v_pedido uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- Normaliza e tira repetição: a tela manda o que foi marcado, e marcar a
  -- mesma peça duas vezes não pode virar dois cartões com o mesmo número.
  select array_agg(distinct upper(trim(x)))
    into v_pecas
    from unnest(coalesce(p_pecas, array[]::text[])) as x
   where coalesce(trim(x), '') <> '';

  if v_pecas is null or array_length(v_pecas, 1) is null then
    return json_build_object('ok', false, 'motivo', 'nenhuma_peca');
  end if;
  -- Teto: uma leva de 500 cartões já é um dia de impressão. Acima disso é
  -- engano de clique, não pedido.
  if array_length(v_pecas, 1) > 500 then
    return json_build_object('ok', false, 'motivo', 'demais',
                             'pedidas', array_length(v_pecas, 1), 'teto', 500);
  end if;

  -- ⚠️ PEÇA QUE NÃO EXISTE TEM DE PARAR AQUI, e não virar um cartão a menos no
  -- fim da fila. O robô que descobre isso três minutos depois entrega uma pasta
  -- incompleta, e quem conferir vai contar os arquivos sem saber o que faltou.
  select array_agg(x) into v_faltando
    from unnest(v_pecas) as x
   where not exists (select 1 from public.vessel_pecas p where p.codigo = x);
  if v_faltando is not null then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe',
                             'pecas', to_jsonb(v_faltando));
  end if;

  -- Refazer cartão é permitido — cartão rasga, mancha, some. Mas a tela precisa
  -- DIZER que já existia, senão a leva volta do Zoho com o dobro dos arquivos e
  -- ninguém sabe qual é o bom.
  select count(*) into v_repetidas
    from public.vessel_pecas p
   where p.codigo = any (v_pecas) and p.cartao_gerado_em is not null;

  insert into public.vessel_cartao_pedidos (pecas, criado_por)
  values (v_pecas, auth.uid())
  returning id into v_pedido;

  return json_build_object('ok', true, 'pedido', v_pedido,
                           'pecas', array_length(v_pecas, 1),
                           'refazendo', v_repetidas);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_sobrescrever_etiqueta(p_codigo_antigo text, p_codigo_novo text, p_destino text, p_motivo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.vessel_trocar_dono(p_codigo text, p_nome text, p_cpf text, p_whatsapp text, p_motivo text, p_confirmacao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(regexp_replace(coalesce(p_codigo, ''), '[\s.\-_]', '', 'g'));
  v_conf   text := upper(regexp_replace(coalesce(p_confirmacao, ''), '[\s.\-_]', '', 'g'));
  v_cpf    text := regexp_replace(coalesce(p_cpf, ''), '\D', '', 'g');
  v_zap    text := regexp_replace(coalesce(p_whatsapp, ''), '\D', '', 'g');
  v_nome   text := left(trim(coalesce(p_nome, '')), 120);
  v_ant    record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_conf <> v_codigo then
    return json_build_object('ok', false, 'motivo', 'confirmacao_nao_bate');
  end if;
  if coalesce(trim(coalesce(p_motivo, '')), '') = '' then
    return json_build_object('ok', false, 'motivo', 'motivo_obrigatorio');
  end if;
  if v_nome = '' or length(v_zap) not in (10, 11) then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  if not public.vessel_cpf_valido(v_cpf) then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;

  select * into v_ant from public.vessel_registros where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'nao_tem_dono');
  end if;

  update public.vessel_registros
     set nome = v_nome, cpf = v_cpf, whatsapp = v_zap,
         -- o vinculo com o Bling era do dono ANTIGO: mante-lo apontaria a bolsa
         -- nova para o pedido de venda de outra pessoa
         bling_contato_id = null, bling_pedido = null, pedido_id = null
   where codigo = v_codigo;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'dono_trocado', p_motivo,
          jsonb_build_object(
            'de',   jsonb_build_object('nome', v_ant.nome,
                                       'cpf', public.vessel_cpf_mascarado(v_ant.cpf)),
            'para', jsonb_build_object('nome', v_nome,
                                       'cpf', public.vessel_cpf_mascarado(v_cpf)),
            'garantia_ate', v_ant.garantia_ate), auth.uid());

  return json_build_object('ok', true, 'de', v_ant.nome, 'para', v_nome);
end;
$function$;

-- 2026-09-17-vessel-lote-de-teste.sql:94-98
create or replace trigger trg_vessel_lotes_marcar_teste before insert or update of sku on public.vessel_lotes
  for each row execute function public.vessel_lotes_marcar_teste();
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql:377-381
create or replace trigger trg_vessel_lote_novo_herda_material before insert on public.vessel_lotes
  for each row execute function public.vessel_lote_novo_herda_material();
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql:331-336
create or replace trigger trg_vessel_lote_material_recalcula_garantia after update of material on public.vessel_lotes
  for each row when (old.material is distinct from new.material)
  execute function public.vessel_lote_material_recalcula_garantia();
-- 2026-09-17-vessel-contas-base.sql:77-80
create or replace trigger vessel_clientes_atualizado before update on public.vessel_clientes
  for each row execute function public.vessel_toca_atualizado_em();
-- 2026-09-17-vessel-registro-com-conta.sql:230-233
create or replace trigger vessel_registros_preencher_cliente_id before insert on public.vessel_registros
  for each row execute function public.vessel_registros_preencher_cliente_id();
-- 2026-09-19-zzz-vessel-lembretes-register-later.sql:472-475
create or replace trigger vessel_registros_mata_o_lembrete after insert on public.vessel_registros
  for each row execute function public.vessel_lembretes_morre_com_o_registro();
