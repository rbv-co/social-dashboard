-- O QUE A PESSOA QUER, DEPOIS DE JÁ ESTAR NO BANCO.
--
-- A LP nova cadastra primeiro e pergunta depois (decisão do dono, 11/09/2026):
-- se a escolha viesse antes, quem desistisse no meio sumiria sem deixar
-- contato. Isso torna a escolha uma SEGUNDA escrita.
--
-- ⚠️ E a segunda escrita é o risco. Se a página pudesse dizer "grave visita na
-- linha 412", qualquer visitante diria isso sobre a linha de qualquer cliente.
-- Por isso `vessel_entrar_na_lista` passa a devolver uma SENHA DE USO ÚNICO,
-- guardada aqui só como impressão digital, e `vessel_marcar_objetivo` só aceita
-- quem a tiver na mão.

alter table public.vessel_lista_espera
  add column if not exists objetivo   text,
  add column if not exists loja       text,
  add column if not exists senha_hash text,
  add column if not exists senha_em   timestamptz;

comment on column public.vessel_lista_espera.objetivo is
  'O que a pessoa escolheu na LP: visita, ecommerce, ou nulo (cadastrou e não escolheu).';

-- ⚠️ NASCE ACEITANDO AS DUAS LOJAS ABERTAS (Tivoli Santa Bárbara e Iguatemi
-- Campinas). A tela de hoje grava só `iguatemi`, porque foi o que o dono pediu
-- em 11/09 — o seletor é trabalho de tela depois, SEM migration nova.
-- Não cravar loja no código da tela: duas lojas fecharam em 2026.
comment on column public.vessel_lista_espera.loja is
  'Qual loja, quando o objetivo é visita: tivoli | iguatemi.';

comment on column public.vessel_lista_espera.senha_hash is
  'sha256 da senha de uso único devolvida no cadastro. Zerada assim que usada.';

-- ⚠️ SEM LISTA FECHADA (CHECK) NO OBJETIVO. Já aconteceu neste projeto de um
-- CHECK derrubar a transação INTEIRA quando chegou um valor que ninguém previu.
-- A trava está na FUNÇÃO, que recusa o valor devolvendo erro tratado, em vez de
-- abortar tudo. Valor novo (por exemplo um terceiro caminho) passa a ser uma
-- linha na função, não uma migration de emergência.

create index if not exists vessel_lista_espera_senha_hash_idx
  on public.vessel_lista_espera (senha_hash)
  where senha_hash is not null;
