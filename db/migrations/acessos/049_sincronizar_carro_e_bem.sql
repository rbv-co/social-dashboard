-- Frota ↔ Patrimônio: cadastrar de um lado passa a criar e amarrar o outro.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
-- Plano:   docs/superpowers/plans/2026-08-20-frota-patrimonio-via-de-mao-dupla.md
--
-- O PEDIDO DO DONO (20/08/2026): "o cadastro de bens de carros está
-- necessitando duas mão de obra. Se eu cadastro o carro pelo patrimônio já é
-- para aparecer em frota, e se eu cadastro em frota primeiro já é pra ir pra
-- patrimônio."
--
-- O CASO REAL: três KWIDs cadastrados na Frota em 20/08 (RVU6B06 às 11:11,
-- RUL1A41 às 11:19, RUL1A35 às 11:23) e UM bem KWID no Patrimônio (nº 291, das
-- 09:53). Quatro fichas, zero ligações. São três carros de verdade — placas
-- diferentes —, então faltam dois bens, e nenhuma tela sabia criá-los.
--
-- ── POR QUE UMA FUNÇÃO, E NÃO DOIS INSERTS NA TELA ──────────────────────────
--
-- Os portões de permissão são DIFERENTES: `is_frota_admin()` (feature 'frota'
-- ou superadmin) e `is_patrimonio_admin()` (role admin ou feature
-- 'patrimonio'). Medido em 20/08 sobre 22 pessoas: 5 têm SÓ Frota e 2 têm SÓ
-- Patrimônio. Pra essas 7, o insert do outro lado bateria na RLS e falharia — e
-- a mão de obra dobrada voltaria justamente pra quem menos pode resolver.
--
-- Esta função tem poder próprio, mas NÃO é porta dos fundos pro Patrimônio: ela
-- só sabe fazer uma coisa — criar bem da categoria Veículos amarrado àquele
-- carro. Não cria cadeira, não lê os outros 362 bens, não edita o que já
-- existe. Quem só tem Frota continua sem enxergar o Patrimônio.
--
-- ── O QUE ELA RECUSA, E POR QUÊ ─────────────────────────────────────────────
--
-- Se a placa aponta pro carro A, a etiqueta aponta pro bem B, e A já está preso
-- ao bem C, ela PARA e explica. Religar ficha errada é pior que não ligar: some
-- prova sem ninguém saber. Quem desfaz ligação antiga é gente, na tela.
--
-- A trava da 048 (`uq_frota_veiculos_bem_id`) é a rede embaixo disso: mesmo que
-- um `if` daqui falhasse um dia, o banco ainda recusaria dois carros num bem.
--
-- ── proxima_etiqueta_livre(), e por que ela existe ──────────────────────────
--
-- A conta já existe em JS (`mapaDeNumeros`, numeros-de-etiqueta.js), mas precisa
-- de duas coisas que a Frota não alcança: a lista de bens e o teto. E
-- `patrimonio_config` tem RLS `is_patrimonio_admin()` — medido: as 5 pessoas
-- só-Frota NÃO conseguem ler o teto. Fazer a conta na tela da Frota daria número
-- errado pra elas, EM SILÊNCIO. Então a conta desce pro banco, onde a resposta é
-- a mesma pra todo mundo.
--
-- Ela devolve o primeiro BURACO, não o maior+1 — em 20/08 isso é 5, e não 381.
-- É de propósito: etiqueta é adesivo físico, e queimar número é desperdício.
--
-- ── GRANTS ──────────────────────────────────────────────────────────────────
--
-- `revoke from public, anon` explícito nas duas. Função SECURITY DEFINER nasce
-- executável por todo mundo, inclusive anônimo — e uma que cria linha em duas
-- tabelas não pode ficar assim.

-- ── 1. O próximo número livre ───────────────────────────────────────────────
create or replace function public.proxima_etiqueta_livre()
returns int
language sql stable security definer set search_path = public as $$
  select min(n)::int
    from generate_series(
           1,
           coalesce((select nullif(btrim(valor), '')::int
                       from public.patrimonio_config where chave = 'numero_maximo'),
                    400)
         ) as n
   where not exists (select 1 from public.patrimonio_bens b where b.numero = n);
$$;

comment on function public.proxima_etiqueta_livre() is
  'O primeiro número de etiqueta ainda livre (o primeiro BURACO, não o maior+1). '
  'Nulo quando a numeração está cheia. Mora no banco porque patrimonio_config '
  'não é legível por quem só tem a Frota.';

revoke all on function public.proxima_etiqueta_livre() from public, anon;
grant execute on function public.proxima_etiqueta_livre() to authenticated;

-- ── 2. A costura ────────────────────────────────────────────────────────────
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
    raise exception 'Você não pode cadastrar veículo nem bem. Peça a quem administra.'
      using errcode = 'check_violation';
  end if;

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
      -- Mesmo critério tolerante a acento que os dois lados já usam pra achar a
      -- categoria. Sem ela identificada, NÃO cria bem sem categoria: bem solto
      -- não aparece em relatório nenhum e vira item fantasma.
      select id into v_cat from public.patrimonio_categorias
       where nome ilike '%ve%cul%' order by nome limit 1;
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

comment on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint) is
  'Costura carro e bem nas duas direções: acha pela placa e pela etiqueta, cria o '
  'que faltar, amarra frota_veiculos.bem_id. Recusa religar ficha que já tem par.';

revoke all on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  from public, anon;
grant execute on function public.sincronizar_carro_e_bem(uuid,uuid,text,int,text,text,bigint)
  to authenticated;
