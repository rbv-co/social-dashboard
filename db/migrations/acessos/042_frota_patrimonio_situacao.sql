-- A situação do carro passa a valer nos DOIS lados: Frota e Patrimônio.
--
-- O PEDIDO DO DONO (12/08/2026): "não consigo colocar situação de 'em
-- manutenção' na gestão de frota, mas em gestão de patrimônio eu consigo,
-- precisa ter a via de mão também, nos dois dê pra configurar isso, as duas se
-- conversam."
--
-- O QUE A MEDIÇÃO ACHOU, e é pior que o pedido: os 10 carros JÁ estão ligados a
-- um bem do Patrimônio (`frota_veiculos.bem_id`), e DOIS já discordavam —
-- a Doblo estava `em_manutencao` no Patrimônio e `ativo` na Frota, e a Porsche
-- `em_estoque` lá e `ativo` aqui. Ou seja: alguém marcou a Doblo como parada
-- pra manutenção e a Frota continuou oferecendo ela como carro disponível.
--
-- A TRADUÇÃO, escolhida pelo dono entre "só manutenção e baixa sincronizam" e
-- "tudo sincroniza": tudo sincroniza.
--
--     FROTA                    PATRIMÔNIO
--     ativo            <->     em_uso
--     inativo (Parado) <->     em_estoque
--     em_manutencao    <->     em_manutencao
--     alienado         <->     baixado
--
-- O que o dono aceitou perder ao escolher a tradução completa: "em estoque" num
-- carro passa a querer dizer "parado", que não é exatamente a mesma ideia — o
-- vocabulário das duas ferramentas fica amarrado. Foi apresentado assim e ele
-- decidiu assim.
--
-- POR QUE GATILHO E NÃO CÓDIGO DE TELA: "as duas se conversam" tem de valer
-- venha a escrita de onde vier — da ficha da Frota, da ficha do Patrimônio, de
-- um robô ou de um SQL na mão. Regra que mora só na tela vale só pra quem passa
-- pela tela.
--
-- ⚠️ O RISCO REAL AQUI É O LAÇO: A muda B, que muda A, que muda B… A guarda é
-- `is distinct from` nos dois lados — o segundo gatilho encontra o valor já
-- correto e não escreve nada, e a corrente para. Sem isso, uma edição derrubaria
-- o banco com recursão infinita.
--
-- ⚠️ ESTA MIGRATION NÃO MEXE NOS 2 CARROS QUE JÁ DISCORDAM. Escolher um
-- vencedor por script decidiria, sem o dono, se a Doblo está ou não na oficina.
-- A partir daqui a próxima edição de qualquer um dos lados alinha os dois.

create or replace function public.frota_traduz_situacao_para_patrimonio(s text)
returns text language sql immutable as $$
  select case s
    when 'ativo'         then 'em_uso'
    when 'inativo'       then 'em_estoque'
    when 'em_manutencao' then 'em_manutencao'
    when 'alienado'      then 'baixado'
    else null            -- valor novo de um lado não inventa tradução no outro
  end;
$$;

create or replace function public.patrimonio_traduz_situacao_para_frota(s text)
returns text language sql immutable as $$
  select case s
    when 'em_uso'        then 'ativo'
    when 'em_estoque'    then 'inativo'
    when 'em_manutencao' then 'em_manutencao'
    when 'baixado'       then 'alienado'
    else null
  end;
$$;

-- ── Frota → Patrimônio ──────────────────────────────────────────────────────
create or replace function public.frota_espelha_situacao_no_bem()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  equivalente text;
begin
  if new.bem_id is null or new.situacao is not distinct from old.situacao then
    return new;
  end if;
  equivalente := public.frota_traduz_situacao_para_patrimonio(new.situacao);
  if equivalente is null then return new; end if;

  -- `is distinct from` no WHERE: se o bem já está no valor certo, nenhuma linha
  -- é tocada e o gatilho do outro lado nem dispara. É o que quebra o laço.
  update public.patrimonio_bens
     set situacao = equivalente
   where id = new.bem_id
     and situacao is distinct from equivalente;
  return new;
end $$;

drop trigger if exists trg_frota_espelha_situacao on public.frota_veiculos;
create trigger trg_frota_espelha_situacao
  after update of situacao on public.frota_veiculos
  for each row execute function public.frota_espelha_situacao_no_bem();

-- ── Patrimônio → Frota ──────────────────────────────────────────────────────
create or replace function public.patrimonio_espelha_situacao_no_veiculo()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  equivalente text;
begin
  if new.situacao is not distinct from old.situacao then return new; end if;
  equivalente := public.patrimonio_traduz_situacao_para_frota(new.situacao);
  if equivalente is null then return new; end if;

  -- Só os bens que SÃO um carro da frota. Um notebook em manutenção não tem
  -- veículo pra espelhar, e o update simplesmente não acha linha.
  update public.frota_veiculos
     set situacao = equivalente
   where bem_id = new.id
     and situacao is distinct from equivalente;
  return new;
end $$;

drop trigger if exists trg_patrimonio_espelha_situacao on public.patrimonio_bens;
create trigger trg_patrimonio_espelha_situacao
  after update of situacao on public.patrimonio_bens
  for each row execute function public.patrimonio_espelha_situacao_no_veiculo();
