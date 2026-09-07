-- LOTE NOVO ACORDA O ROBÔ DAS FOTOS.
--
-- ⚠️ O PROBLEMA: o robô rodava uma vez por dia, às 8h05, no Mac do dono. Um lote
-- criado às 9h esperava 23 HORAS pela foto — e se a bolsa saísse da fábrica
-- antes, a cliente encostava o celular e via o certificado sem foto. Aconteceu
-- em 06/09/2026: 64 lotes criados à tarde passaram a noite sem foto nenhuma.
--
-- ⚠️ POR QUE `after insert` E NÃO `before`: o robô lê o lote do banco. Chamado
-- antes do commit, ele não encontraria a linha — e concluiria, com razão, que
-- não há nada a fazer.
--
-- ⚠️ E POR QUE `pg_net`, QUE É ASSÍNCRONO: `net.http_post` devolve na hora e a
-- resposta chega depois. Se a chamada esperasse o GitHub, a criação do lote na
-- TELA ficaria travada esperando um sistema de fora — e uma falha do GitHub
-- faria a pessoa não conseguir criar lote nenhum. Criar lote não pode depender
-- de foto.
--
-- PROVADO em transação com rollback: lote com SKU acordou o robô (0 → 1
-- chamadas), lote sem SKU não acordou, o lote foi criado nos dois casos, e o
-- insert levou 20 milissegundos.
create or replace function public.vessel_lote_novo_pede_foto()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- Sem SKU não há o que buscar: o robô casa o produto pelo SKU, no Bling e no
  -- Zoho. Acordá-lo aqui seria gastar uma rodada para não fazer nada.
  if coalesce(trim(new.sku), '') = '' then
    return new;
  end if;

  -- ⚠️ FALHA AQUI NÃO PODE DERRUBAR A CRIAÇÃO DO LOTE. O gatilho roda DENTRO da
  -- transação de quem criou; um erro não tratado desfaria o lote inteiro por
  -- causa de um aviso que é, no fundo, opcional — a rodada de hora em hora
  -- pegaria o lote de qualquer jeito.
  begin
    perform public.disparar_robo(
      'vessel-fotos-trigger', 'vessel-fotos-trigger', 'vessel-fotos-trigger',
      jsonb_build_object('lote', new.id, 'sku', new.sku, 'origem', 'lote-novo'),
      30000);
  exception when others then
    null;
  end;

  return new;
end;
$function$;

drop trigger if exists vessel_lote_novo_pede_foto on public.vessel_lotes;

create trigger vessel_lote_novo_pede_foto
  after insert on public.vessel_lotes
  for each row
  execute function public.vessel_lote_novo_pede_foto();

-- O segredo desta função é criado em separado (valor aleatório, não versionado):
--   insert into public.segredos_de_cron (nome, segredo)
--   values ('vessel-fotos-trigger', encode(extensions.gen_random_bytes(32),'hex'))
--   on conflict (nome) do nothing;
