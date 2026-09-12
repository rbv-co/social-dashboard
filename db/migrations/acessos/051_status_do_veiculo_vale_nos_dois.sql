-- Frota ↔ Patrimônio: o status do CARRO passa a valer nos dois lugares.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
--
-- ── O PEDIDO DO DONO (20/08/2026) ───────────────────────────────────────────
--
-- "Quando o bem for veículo, o status de patrimônio precisa ser igual à frota
-- para sincronizar informação."
--
-- ── POR QUE NÃO DÁ PRA SER A MESMA PALAVRA ──────────────────────────────────
--
-- As duas tabelas têm CHECK próprio, e eles só compartilham UMA palavra:
--
--   frota_veiculos    ativo · inativo · em_manutencao · alienado
--   patrimonio_bens   em_uso · em_estoque · em_manutencao · baixado
--
-- Gravar "ativo" num bem é recusado pelo banco. E trocar o vocabulário do
-- Patrimônio alcançaria 362 itens, a tela de Planilha, os Relatórios e os
-- filtros que já rodam em cima dele — muito estrago pra resolver 13 carros.
--
-- Então a informação vira a mesma por TRADUÇÃO de um pra um, confirmada pelo
-- dono item a item:
--
--   Livre                → em_uso        a empresa está usando o carro
--   Fixo com uma pessoa  → em_uso        quem dirige é assunto da Frota
--   Parado               → em_estoque    é bem da empresa, mas não roda
--   Em manutenção        → em_manutencao já era a mesma palavra
--   Fora da frota        → baixado       saiu do patrimônio
--
-- Repare que "Livre" e "Fixo com uma pessoa" caem no MESMO destino, e isso é
-- de propósito: pro Patrimônio os dois significam "em uso pela empresa". A
-- diferença entre eles é quem dirige, que é pergunta da Frota.
--
-- ── QUEM MANDA ──────────────────────────────────────────────────────────────
--
-- A FROTA manda. É a regra da casa: o Patrimônio diz o que a coisa É, a Frota
-- diz como ela é USADA — e status é uso. Por isso são dois gatilhos e não um:
-- o primeiro empurra a mudança pra lá, o segundo impede que uma edição no
-- Patrimônio faça o valor divergir de volta.
--
-- ── O QUE ELE NÃO TOCA ──────────────────────────────────────────────────────
--
-- Só bem que TEM CARRO LIGADO. Os outros 349 itens da empresa não sabem que
-- isto existe: nenhum passa por este gatilho, porque nenhum aparece em
-- `frota_veiculos.bem_id`.

-- ── 1. A TRADUÇÃO, num lugar só ─────────────────────────────────────────────
-- Função própria pra que os dois gatilhos leiam a MESMA tabela de conversão.
-- Escrita duas vezes, ela divergiria na primeira revisão que mexesse num lado.
create or replace function public.situacao_do_bem_pelo_veiculo(p_situacao text)
returns text
language sql immutable set search_path = public as $$
  select case p_situacao
    when 'ativo'         then 'em_uso'
    when 'inativo'       then 'em_estoque'
    when 'em_manutencao' then 'em_manutencao'
    when 'alienado'      then 'baixado'
    -- Situação que esta versão não conhece NÃO vira 'em_uso' por descuido:
    -- devolve nulo, e quem chama trata como "não sei" deixando o bem como
    -- está. Chutar 'em_uso' faria um carro baixado continuar contando como
    -- patrimônio ativo da empresa.
    else null
  end;
$$;

comment on function public.situacao_do_bem_pelo_veiculo(text) is
  'Traduz a situação do veículo (Frota) para a do item (Patrimônio). Nulo quando '
  'não reconhece — quem chama deixa o item como está, nunca chuta.';

-- ── 2. A FROTA EMPURRA ──────────────────────────────────────────────────────
create or replace function public.frota_espelha_situacao_no_bem()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_alvo text;
begin
  -- Sem bem ligado não há o que espelhar. É o caso normal de carro recém
  -- cadastrado e do que nunca foi ligado ao Patrimônio.
  if new.bem_id is null then return new; end if;

  -- Só age quando a situação MUDOU, ou quando o carro acabou de ser LIGADO a
  -- um bem (aí o espelho precisa nascer certo). Um update que mexe no
  -- hodômetro passa reto — senão isto viraria pedágio de toda edição.
  if tg_op = 'UPDATE'
     and new.situacao is not distinct from old.situacao
     and new.bem_id  is not distinct from old.bem_id then
    return new;
  end if;

  v_alvo := public.situacao_do_bem_pelo_veiculo(new.situacao);
  if v_alvo is null then return new; end if;

  update public.patrimonio_bens
     set situacao = v_alvo, atualizado_em = now()
   where id = new.bem_id
     and situacao is distinct from v_alvo;

  return new;
end;
$$;

drop trigger if exists trg_frota_espelha_situacao_no_bem on public.frota_veiculos;
create trigger trg_frota_espelha_situacao_no_bem
  after insert or update on public.frota_veiculos
  for each row
  execute function public.frota_espelha_situacao_no_bem();

-- ── 3. O PATRIMÔNIO NÃO DIVERGE DE VOLTA ────────────────────────────────────
-- Sem isto, editar o item na tela do Patrimônio desfaria o espelho em silêncio,
-- e a pergunta do dono voltaria na semana seguinte.
create or replace function public.bem_de_veiculo_segue_a_frota()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_situacao_do_carro text;
  v_alvo text;
begin
  if new.situacao is not distinct from old.situacao then return new; end if;

  select v.situacao into v_situacao_do_carro
    from public.frota_veiculos v where v.bem_id = new.id;

  -- Item sem carro ligado é item comum: cadeira, Macbook, e também o veículo
  -- que ainda não virou carro (o nº 291 é assim). A situação dele continua
  -- sendo decidida no Patrimônio, como sempre foi.
  if v_situacao_do_carro is null then return new; end if;

  v_alvo := public.situacao_do_bem_pelo_veiculo(v_situacao_do_carro);
  if v_alvo is null then return new; end if;

  new.situacao := v_alvo;
  return new;
end;
$$;

drop trigger if exists trg_bem_de_veiculo_segue_a_frota on public.patrimonio_bens;
create trigger trg_bem_de_veiculo_segue_a_frota
  before update on public.patrimonio_bens
  for each row
  execute function public.bem_de_veiculo_segue_a_frota();

-- ── 4. O PASSADO ────────────────────────────────────────────────────────────
-- Medido antes de escrever: dos 13 carros ligados, 10 JÁ batiam com a tradução
-- — sinal de que ela reflete o que as pessoas já faziam à mão. Mudam 3: os
-- KWIDs cadastrados em 20/08, que estão ativos na Frota e nasceram
-- `em_estoque` no Patrimônio.
update public.patrimonio_bens b
   set situacao = public.situacao_do_bem_pelo_veiculo(v.situacao),
       atualizado_em = now()
  from public.frota_veiculos v
 where v.bem_id = b.id
   and public.situacao_do_bem_pelo_veiculo(v.situacao) is not null
   and b.situacao is distinct from public.situacao_do_bem_pelo_veiculo(v.situacao);
