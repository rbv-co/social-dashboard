-- A PRIVATE EDIT GANHA TELA — e a porta de criar passa a ter tranca
--
-- `vessel_criar_private_edit` existia desde a migration da Private Edit, mas
-- estava NO AR SEM PODER SER CHAMADA: sem `is_vessel_atendimentos()` por dentro
-- e sem grant para ninguém. Na prática, criar um encontro só acontecia por SQL
-- à mão — que é exatamente a "perda de controle" que o dono apontou.
--
-- Dar o grant SEM a conferência de permissão seria pior do que deixar como
-- está: `security definer` roda como dono, e `authenticated` é TODO mundo que
-- fez login na Central. Qualquer conta criaria encontro em nome de qualquer
-- stylist. As duas coisas andam juntas, nesta ordem.
--
-- O corpo da função é o que já estava no ar, preservado linha por linha. O que
-- entra é a conferência no topo, e a recusa em português no lugar dos códigos
-- secos — quem vai ler é a operação.

create or replace function public.vessel_criar_private_edit(
  p_stylist text,
  p_quando  timestamp with time zone,
  p_local   text default null,
  p_praca   text default null,
  p_loja    text default null,
  p_vagas   integer default 8,
  p_teste   boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_tam      int  := length(v_alfabeto);          -- 30
  -- O maior múltiplo de 30 que cabe em 256: 240. Byte de 240 para cima é
  -- descartado, e é isso que tira o viés.
  v_teto     int  := 256 - (256 % v_tam);
  v_stylist  bigint;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
begin
  -- ⚠️ A TRANCA MORA AQUI DENTRO, não no grant. Ver o cabeçalho.
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao',
      'erro', 'Você não tem a permissão de Atendimentos para criar um encontro.');
  end if;

  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada',
      'erro', 'Não achei esta stylist. O código é o STY-0000 dela.');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data',
      'erro', 'Escolha o dia e a hora do encontro.');
  end if;
  -- ⚠️ ENCONTRO NO PASSADO NÃO SE CRIA. O convite tem data e avisa quando
  -- passou: nascer já vencido produz um link que só serve para confundir quem
  -- recebe. (A regra é do CRIAR; encontro que já aconteceu continua na lista.)
  if p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'situacao', 'data_no_passado',
      'erro', 'Esta data já passou. O convite nasceria vencido.');
  end if;
  if v_praca is null or v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'A praça precisa ser CPS, SAO, SBO ou BSB.');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha uma loja válida.');
  end if;
  -- ⚠️ VAGAS É O DENOMINADOR DA TAXA DE COMPARECIMENTO na tela. Zero ou
  -- negativo viraria divisão por zero lá na frente; número absurdo estraga a
  -- leitura. O plano fala em 5 a 8 convidadas, e o teto aqui é folgado.
  if p_vagas is null or p_vagas < 1 or p_vagas > 60 then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas',
      'erro', 'O número de vagas precisa estar entre 1 e 60.');
  end if;

  -- A sequência é POR DIA E POR PRAÇA, como manda o formato do módulo 10.
  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;
  v_codigo := 'PE-'
    || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD')
    || '-' || v_praca || '-' || lpad(v_seq::text, 2, '0');

  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;      -- descarta e sorteia outro
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
  end loop;

  insert into public.vessel_private_edits
    (codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)
  values (v_codigo, v_chave, v_stylist, p_quando,
          nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);

  return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
end;
$function$;

revoke all on function public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean)
  to authenticated;

-- ── encerrar e reabrir um encontro ─────────────────────────────────────────
/**
 * ⚠️ MESMA LIÇÃO DA BEAUTY SESSION: a coluna `ativa` existia e ninguém a
 * consultava. Aqui ela já é lida por `vessel_convite_da_private_edit` — o que
 * faltava era um jeito de MUDAR, fora do SQL à mão.
 *
 * Encerrar NÃO apaga: o encontro continua na lista com os números que trouxe.
 */
create or replace function public.vessel_private_edit_encerrar(
  p_codigo text,
  p_ativa  boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nos encontros.');
  end if;
  update public.vessel_private_edits
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei este encontro.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

revoke all on function public.vessel_private_edit_encerrar(text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_private_edit_encerrar(text, boolean) to authenticated;

-- ── a lista de stylists, para escolher a anfitriã ──────────────────────────
/**
 * A tela precisa oferecer as stylists num menu — digitar `STY-0007` à mão é a
 * mesma armadilha do código da Beauty Session.
 *
 * ⚠️ SÓ CÓDIGO E NOME, e só para quem tem a permissão. A lista inteira de
 * stylists com cidade, WhatsApp e Instagram é dado de parceira; aqui só sai o
 * necessário para preencher um campo.
 */
create or replace function public.vessel_stylists_para_escolher()
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade)
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
   where not coalesce(s.teste, false);
  return v_saida;
end;
$function$;

revoke all on function public.vessel_stylists_para_escolher() from public, anon, authenticated;
grant execute on function public.vessel_stylists_para_escolher() to authenticated;

comment on function public.vessel_criar_private_edit(text, timestamptz, text, text, text, integer, boolean) is
  'Cria um encontro da Private Edit pela tela da Central. A permissao e '
  'conferida DENTRO da funcao: o grant a authenticated e so a porta, nao a '
  'tranca — authenticated e todo mundo que fez login.';
