-- A LOJA DO IGUATEMI ENTRA NA FÁBRICA DE ANÚNCIOS, E A DO DOM PEDRO SAI.
--
-- Pedido do dono, 09/09/2026: "já tem depósito do iguatemi precisa linkar no
-- canal de venda".
--
-- ⚠️ O QUE JÁ FUNCIONAVA, E POR QUE ISTO NÃO É SOBRE ESTOQUE: no estoque da
-- Gestão à Vista o Iguatemi já aparece hoje, porque `canalCasaComDeposito`
-- reconhece a palavra própria "Iguatemi" no canal e no depósito. Quem precisa do
-- vínculo explícito é o Tivoli, cujo canal se chama "Loja Santa Bárbara d'Oeste"
-- e o depósito "Estoque Loja Sbo. Tivoli" — nenhuma palavra em comum.
--
-- O que faltava é `fabrica_lojas`: a Fábrica de Anúncios e a Gestão de Tráfego
-- listam ela com `ativo = true`, e a edge `fabrica-candidatos` usa
-- `canal_loja_id` para mapear depósito → canal. Sem a linha, a loja do Iguatemi
-- simplesmente não existe para elas.
--
-- O depósito NÃO é criado aqui: `Estoque Loja Iguatemi` (14888726277) já veio do
-- Bling sozinho, e é o antigo de Hortolândia RENOMEADO — mesmo id.

-- ── O IGUATEMI ─────────────────────────────────────────────────────────────
--
-- ⚠️ `geo_cities` É A CHAVE DA META, NÃO O NOME DA CIDADE. 247071 é a mesma que
-- a loja do Dom Pedro usa — as duas são em Campinas. Se um dia o Iguatemi
-- precisar de raio ou de cidade própria, é aqui que muda.
insert into public.fabrica_lojas
  (deposito_id, nome, ativo, ordem, marca_id, whatsapp, geo_cities, canal_loja_id)
values
  ('14888726277', 'Iguatemi (Campinas)', true, 2,
   (select marca_id from public.fabrica_lojas where deposito_id = '14888726315'),
   '+5519971092194', '[247071]'::jsonb, '205834116')
on conflict (deposito_id) do update
  set nome = excluded.nome,
      ativo = excluded.ativo,
      ordem = excluded.ordem,
      marca_id = coalesce(excluded.marca_id, public.fabrica_lojas.marca_id),
      whatsapp = excluded.whatsapp,
      geo_cities = excluded.geo_cities,
      canal_loja_id = excluded.canal_loja_id;

-- ── O DOM PEDRO ────────────────────────────────────────────────────────────
--
-- A loja fechou (o canal de venda foi fechado em 31/08/2026 na mesma semana).
-- Deixá-la ativa aqui deixa alguém subir anúncio de uma loja que não existe.
--
-- ⚠️ SÓ O `ativo` MUDA. O vínculo, o WhatsApp e as cidades ficam na linha: se a
-- loja reabrir, ou se alguém precisar saber para onde iam os anúncios dela, o
-- dado está lá. Apagar a linha seria perder isso sem ganho nenhum.
update public.fabrica_lojas
   set ativo = false
 where deposito_id = '14888617206';
