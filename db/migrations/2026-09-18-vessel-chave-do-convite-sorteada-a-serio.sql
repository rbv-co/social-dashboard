-- A CHAVE DO CONVITE PASSA A SER SORTEADA DE VERDADE
--
-- ⚠️ `random()` DO POSTGRES NÃO SERVE PARA ESCONDER NADA. Ele é um gerador
-- comum, semeado por sessão: quem vê algumas chaves consegue continuar a
-- sequência. Para uma cor de gráfico tanto faz; aqui a chave é a ÚNICA coisa
-- que impede alguém de varrer a agenda de encontros da marca e descobrir quais
-- stylists hospedam cada um — que é exatamente a lista que a operação passa
-- semanas montando.
--
-- Trocado por `gen_random_bytes`, que é criptográfico.
--
-- ⚠️ E COM REJEIÇÃO, NÃO COM RESTO DIRETO. O alfabeto tem 30 letras e o byte
-- tem 256 valores: 256 não é múltiplo de 30, então `byte % 30` faria as 16
-- primeiras letras saírem com mais frequência que as outras 14. Um sorteio
-- torto é mais fácil de adivinhar do que um sorteio justo — e o conserto custa
-- descartar um byte de cada dezesseis.
--
-- ⚠️ `extensions.` NA FRENTE NÃO É ENFEITE: a função tem
-- `set search_path to 'public'`, e no Supabase a pgcrypto mora no schema
-- `extensions`. Sem o prefixo, a chamada não acha a função e a criação do
-- encontro quebra — só quando alguém tentar criar um, semanas depois.

create or replace function public.vessel_criar_private_edit(
  p_stylist  text,                        -- STY-0001
  p_quando   timestamptz,
  p_local    text default null,
  p_praca    text default null,
  p_loja     text default null,
  p_vagas    int default 8,
  p_teste    boolean default false
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
  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data');
  end if;
  if v_praca is null or v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
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

revoke all on function public.vessel_criar_private_edit(
  text, timestamptz, text, text, text, int, boolean) from public, anon, authenticated;
