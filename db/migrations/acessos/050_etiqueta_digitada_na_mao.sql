-- Frota: o nº de patrimônio passa a ser digitado à mão — e o banco protege isso.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
--
-- ── A DECISÃO DO DONO (20/08/2026), E O QUE ELA ABRIU ───────────────────────
--
-- O plano previa a tela SUGERINDO o próximo número livre. Ele preferiu campo
-- VAZIO: "não sugerir nada", porque quem cadastra tem o adesivo na mão e o
-- número é o que está impresso nele. Faz sentido — e foi o que ele já fez na
-- prática, dando 291 ao KWID em vez do 5 que a tela sugeria.
--
-- Só que a sugestão escondia um buraco, e sem ela ele fica exposto: a 049 acha
-- o bem PELO NÚMERO, e liga o carro a qualquer bem que tenha aquele número.
--
-- Medido em 20/08, os números que um dedo errado alcança primeiro:
--
--     1, 2, 3, 4, 6   Macbook Air
--                47   Microfone de Mesa Yealink CP960
--               100   Cadeira de escritório
--
-- Digitar 47 no lugar de 147 ligaria o carro ao MICROFONE — e a 049, como
-- estava, faria isso em silêncio e com cara de sucesso. É a família de defeito
-- que já custou caro aqui: a tela afirmando algo que não aconteceu.
--
-- ── 1. A TRAVA DE CATEGORIA ─────────────────────────────────────────────────
--
-- Bem ACHADO por número só serve se for da categoria Veículos. Bem CRIADO pela
-- própria função já nasce na categoria certa, então a trava não o alcança.
--
-- A mensagem DIZ O QUE O NÚMERO É ("o nº 47 é Microfone de Mesa Yealink
-- CP960"), em vez de um "número inválido" genérico: quem digitou errado precisa
-- entender na hora que pegou o adesivo do vizinho, não ficar adivinhando.

create or replace function public.sincronizar_carro_e_bem(
  p_carro_id       uuid   default null,
  p_bem_id         uuid   default null,
  p_placa          text   default null,
  p_etiqueta       int    default null,
  p_nome           text   default null,
  p_marca          text   default null,
  p_valor_centavos bigint default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_carro       public.frota_veiculos%rowtype;
  v_bem         public.patrimonio_bens%rowtype;
  v_cat         uuid;
  v_placa       text;
  v_outro       uuid;
  v_criou_carro boolean := false;
  v_criou_bem   boolean := false;
  v_fez         text;
begin
  if not (public.is_frota_admin() or public.is_patrimonio_admin()) then
    raise exception 'Você não pode cadastrar veículo nem item. Peça a quem administra.'
      using errcode = 'check_violation';
  end if;

  -- A categoria é lida UMA vez, no começo: ela serve pra criar bem novo e pra
  -- conferir bem achado, e ler duas vezes convidaria as duas metades a
  -- divergirem numa revisão futura.
  select id into v_cat from public.patrimonio_categorias
   where nome ilike '%ve%cul%' order by nome limit 1;

  -- Mesma normalização que a tela da Frota já faz ao gravar (salvarVeiculo):
  -- sem ela, "ABC-1D23" e "abc1d23" viram dois carros diferentes.
  v_placa := nullif(upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')), '');

  -- ── O CARRO: acha, ou cria ──
  if p_carro_id is not null then
    select * into v_carro from public.frota_veiculos where id = p_carro_id;
    if not found then
      raise exception 'O veículo informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif v_placa is not null then
    select * into v_carro from public.frota_veiculos where placa = v_placa;
    if not found then
      if coalesce(btrim(p_nome), '') = '' then
        raise exception 'Pra criar o veículo eu preciso do nome dele.'
          using errcode = 'check_violation';
      end if;
      insert into public.frota_veiculos (placa, nome, marca, fipe_centavos, situacao)
      values (v_placa, btrim(p_nome),
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, 'ativo')
      returning * into v_carro;
      v_criou_carro := true;
    end if;
  else
    raise exception 'Preciso da placa pra achar ou criar o veículo.'
      using errcode = 'check_violation';
  end if;

  -- ── O BEM: acha, ou cria ──
  if p_bem_id is not null then
    select * into v_bem from public.patrimonio_bens where id = p_bem_id;
    if not found then
      raise exception 'O item informado não existe mais. Recarregue a tela.'
        using errcode = 'check_violation';
    end if;
  elsif p_etiqueta is not null then
    select * into v_bem from public.patrimonio_bens where numero = p_etiqueta;
    if not found then
      if v_cat is null then
        raise exception 'Não achei a categoria "Veículos" no Patrimônio. Crie a categoria antes.'
          using errcode = 'check_violation';
      end if;
      insert into public.patrimonio_bens (nome, numero, marca, valor_centavos, categoria_id)
      values (coalesce(nullif(btrim(coalesce(p_nome, '')), ''), v_carro.nome),
              p_etiqueta,
              nullif(btrim(coalesce(p_marca, '')), ''),
              p_valor_centavos, v_cat)
      returning * into v_bem;
      v_criou_bem := true;
    end if;
  else
    raise exception 'Preciso do nº de patrimônio pra achar ou criar o item.'
      using errcode = 'check_violation';
  end if;

  -- ── A TRAVA DE CATEGORIA (050) ──
  -- Só para bem ACHADO: o criado acima já nasceu em Veículos.
  if not v_criou_bem and v_bem.categoria_id is distinct from v_cat then
    raise exception
      'O nº de patrimônio % é "%", que não é um veículo. Confira o número do adesivo.',
      v_bem.numero, v_bem.nome using errcode = 'check_violation';
  end if;

  -- ── O CONFLITO: para e explica, nunca rewira calada ──
  if v_carro.bem_id is not null and v_carro.bem_id <> v_bem.id then
    raise exception
      'O veículo % já está ligado a outro item do Patrimônio. Desfaça a ligação antiga primeiro.',
      v_carro.placa using errcode = 'check_violation';
  end if;

  select id into v_outro from public.frota_veiculos
   where bem_id = v_bem.id and id <> v_carro.id limit 1;
  if v_outro is not null then
    raise exception
      'O nº de patrimônio % já pertence a outro veículo da Frota. Desfaça a ligação antiga primeiro.',
      v_bem.numero using errcode = 'check_violation';
  end if;

  -- ── AMARRA ──
  if v_carro.bem_id is null then
    update public.frota_veiculos
       set bem_id = v_bem.id, atualizado_em = now()
     where id = v_carro.id;
    v_fez := 'ligou';
  else
    v_fez := 'ja_ligados';
  end if;

  if v_criou_carro and v_criou_bem then v_fez := 'criou_os_dois';
  elsif v_criou_carro then v_fez := 'criou_carro';
  elsif v_criou_bem then v_fez := 'criou_bem';
  end if;

  return jsonb_build_object(
    'carro_id', v_carro.id,
    'bem_id',   v_bem.id,
    'placa',    v_carro.placa,
    'etiqueta', v_bem.numero,
    'fez',      v_fez);
end;
$$;

revoke all on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  from public, anon;
grant execute on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  to authenticated;

-- ── 2. "ESTE NÚMERO É DE QUÊ?" ──────────────────────────────────────────────
--
-- Com o campo vazio, a pessoa digita e precisa saber ANTES de salvar o que
-- aquele número já é. Isto é o que substitui a sugestão: em vez de a tela
-- escolher o número, ela conta a verdade sobre o número escolhido.
--
-- Mora no banco pelo mesmo motivo da 049: quem só tem a Frota não lê
-- `patrimonio_bens` de forma confiável (a RLS de leitura é por equipe) nem
-- `patrimonio_config`. A conta na tela daria resposta errada, em silêncio.

create or replace function public.etiqueta_quem_e(p_numero int)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
        'existe',        true,
        'nome',          b.nome,
        'categoria',     c.nome,
        'eh_veiculo',    coalesce(c.nome ilike '%ve%cul%', false),
        'placa_ligada',  (select v.placa from public.frota_veiculos v where v.bem_id = b.id))
       from public.patrimonio_bens b
       left join public.patrimonio_categorias c on c.id = b.categoria_id
      where b.numero = p_numero),
    jsonb_build_object('existe', false));
$$;

comment on function public.etiqueta_quem_e(int) is
  'O que este nº de patrimônio já é hoje: nome, categoria, se é veículo e a placa '
  'do carro ligado. Serve pra tela avisar ANTES de salvar. Nunca escreve.';

revoke all on function public.etiqueta_quem_e(int) from public, anon;
grant execute on function public.etiqueta_quem_e(int) to authenticated;

-- ── 3. A SUGESTÃO SAI DE CENA ───────────────────────────────────────────────
--
-- `proxima_etiqueta_livre()` nasceu na 049 pra alimentar a sugestão que o dono
-- decidiu não ter. Função com poder próprio que ninguém chama é dívida: um dia
-- alguém a encontra, supõe que é usada e constrói em cima. Sai agora, com a
-- decisão ainda fresca. A conta continua existindo em JS
-- (numeros-de-etiqueta.js), onde o Patrimônio a usa na aba Etiquetas.

drop function if exists public.proxima_etiqueta_livre();
