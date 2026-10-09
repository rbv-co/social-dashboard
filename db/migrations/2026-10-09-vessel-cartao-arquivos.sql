-- 2026-10-09-vessel-cartao-arquivos.sql
-- ONDE ESTÁ, NO ZOHO, CADA ARQUIVO DE CARTÃO QUE O ROBÔ ENTREGOU.
--
-- Prévia e "Baixar" do modal da aba Cartões EAN (edge `vessel-baixar-cartao`) procuravam o arquivo no Zoho a cada clique:
-- dias -> pastas do dia -> pasta do SKU -> arquivo, em série, ~5 s ANTES de começar a baixar (e cada vez mais, com os dias).
-- O robô já sabe o id de cada arquivo quando confere a pasta no Zoho; agora ele o grava aqui, e a edge baixa direto.
--
-- Uma linha por arquivo (frente/verso x png/pdf): (codigo da peça, nome do arquivo) -> id no Zoho. Refazer o cartão
-- regrava a linha (upsert), então vale sempre o arquivo mais novo.
--
-- ⚠️ SÓ O SERVICE ROLE ENXERGA ISTO (robô e edge). RLS ligada, nenhuma policy, e sem grant para anon/authenticated:
-- id de arquivo do Zoho não é para o navegador. A tela continua baixando pela edge, que confere a permissão.
-- ⚠️ É CACHE DE ONDE O ARQUIVO ESTÁ, NÃO A VERDADE: se o Zoho recusar o id (arquivo trocado/apagado), a edge esquece
-- e busca do jeito antigo. Cartão gerado antes desta migration não tem linha: cai nessa busca até ser preenchido
-- (coletor/preencher-arquivos-dos-cartoes.mjs).

create table if not exists public.vessel_cartao_arquivos (
  codigo        text        not null,
  nome          text        not null,
  zoho_id       text        not null,
  pasta_id      text,
  atualizado_em timestamptz not null default now(),
  primary key (codigo, nome)
);

alter table public.vessel_cartao_arquivos enable row level security;
revoke all on table public.vessel_cartao_arquivos from public, anon, authenticated;
