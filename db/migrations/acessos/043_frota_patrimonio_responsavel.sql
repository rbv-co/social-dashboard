-- Quem responde pelo carro passa a valer nos DOIS lados: Frota e Patrimônio.
--
-- O PEDIDO DO DONO (12/08/2026): "na gestão de patrimônio a Doblo diz que está
-- com o Jeremias (que é o correto hoje) e na gestão de frota diz que está com
-- ninguém... mais um cenário que é necessário ter a mão de via dupla."
--
-- O QUE A MEDIÇÃO ACHOU, e de novo é pior que o pedido: não era só a Doblo.
-- TRÊS dos 10 carros divergiam no responsável:
--
--     FIAT DOBLO           Frota: ninguém          Patrimônio: Jeremias Vieira
--     BRAVO BLACKMOTION    Frota: Erick Martins    Patrimônio: ninguém
--     PORSCHE CAYENNE      Frota: Raissa Herculano Patrimônio: ninguém
--
-- Isso é caro de um jeito específico: `frota_veiculos.pessoa_id` é o DONO FIXO,
-- e é ele que a multa procura quando não há posse aberta. Carro sem responsável
-- na Frota é multa sem dono — o problema de R$ 1.301,60 que motivou o módulo.
--
-- A REGRA, escolhida pelo dono entre três: O ÚLTIMO QUE MEXEU VALE. Sem
-- hierarquia entre as telas, igual à sincronização da situação (migration 042),
-- e pelo mesmo motivo — ninguém precisa lembrar qual tela manda.
--
-- ⚠️ O LAÇO é o risco de sempre, e a guarda é a mesma da 042: `is distinct
-- from` nos dois lados, então o segundo gatilho encontra o valor já correto e
-- não escreve nada.
--
-- ⚠️ ESTA MIGRATION NÃO ALINHA OS 3 QUE JÁ DIVERGEM. Escolher um vencedor por
-- script decidiria, sem o dono, quem responde por uma multa. A partir daqui, a
-- próxima edição de qualquer lado alinha os dois.
--
-- NÃO CONFUNDIR COM O CONTATO. `frota_veiculos.contato_nome` é a pessoa a quem
-- PERGUNTAR sobre o carro (a Doblo tem "Siqueira" ali), e não quem responde por
-- ele. São duas perguntas diferentes e continuam em campos diferentes; foi
-- justamente a confusão entre as duas que fez o dono estranhar a Doblo.

-- ── Frota → Patrimônio ──────────────────────────────────────────────────────
create or replace function public.frota_espelha_responsavel_no_bem()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.bem_id is null or new.pessoa_id is not distinct from old.pessoa_id then
    return new;
  end if;
  update public.patrimonio_bens
     set pessoa_id = new.pessoa_id
   where id = new.bem_id
     and pessoa_id is distinct from new.pessoa_id;
  return new;
end $$;

drop trigger if exists trg_frota_espelha_responsavel on public.frota_veiculos;
create trigger trg_frota_espelha_responsavel
  after update of pessoa_id on public.frota_veiculos
  for each row execute function public.frota_espelha_responsavel_no_bem();

-- ── Patrimônio → Frota ──────────────────────────────────────────────────────
create or replace function public.patrimonio_espelha_responsavel_no_veiculo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.pessoa_id is not distinct from old.pessoa_id then return new; end if;
  -- Só os bens que SÃO um carro da frota. Um notebook trocando de responsável
  -- não tem veículo pra espelhar, e o update não acha linha.
  update public.frota_veiculos
     set pessoa_id = new.pessoa_id
   where bem_id = new.id
     and pessoa_id is distinct from new.pessoa_id;
  return new;
end $$;

drop trigger if exists trg_patrimonio_espelha_responsavel on public.patrimonio_bens;
create trigger trg_patrimonio_espelha_responsavel
  after update of pessoa_id on public.patrimonio_bens
  for each row execute function public.patrimonio_espelha_responsavel_no_veiculo();
