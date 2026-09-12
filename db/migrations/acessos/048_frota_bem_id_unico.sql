-- Frota: um bem do Patrimônio pertence a UM veículo, e o banco passa a garantir.
--
-- Desenho: docs/superpowers/specs/2026-08-20-frota-patrimonio-via-de-mao-dupla-design.md
-- Plano:   docs/superpowers/plans/2026-08-20-frota-patrimonio-via-de-mao-dupla.md
--
-- ── POR QUE AGORA ───────────────────────────────────────────────────────────
--
-- A partir desta leva (049), criar carro passa a criar bem sozinho. Automatizar
-- em cima de um vínculo que o banco não protege é multiplicar o defeito: hoje é
-- preciso alguém errar na tela pra duplicar; depois bastaria uma chamada
-- repetida.
--
-- ── O BURACO, MEDIDO EM 20/08/2026 ──────────────────────────────────────────
--
-- `frota_veiculos.bem_id` tinha FK (`frota_veiculos_bem_id_fkey`), mas NÃO
-- tinha unicidade. Os dois lados evitavam a colisão por gentileza no código —
-- `veiculosParaLigar()` (patrimonio/ligacao-com-frota.js) e
-- `bensLivresParaFrota()` (frota/bens-para-veiculo.js) filtram os já usados.
--
-- Gentileza de tela não é trava: qualquer escrita que não passe por ali (SQL na
-- mão, robô, PostgREST direto, e a partir de agora a própria 049) passava reto.
--
-- Provado antes de escrever esta migration, com um update dentro de `rollback`:
-- forçado o HONDA FIT a apontar pro bem do VOLVO XC60, o banco ACEITOU — dois
-- carros no mesmo bem. Conferido depois que o rollback devolveu tudo.
--
-- Duplicatas existentes na hora de criar: ZERO (13 veículos, 10 ligados).
-- Está limpo, e é por isso que dá pra fechar sem escolher qual ligação morre.
--
-- ── POR QUE PARCIAL ─────────────────────────────────────────────────────────
--
-- Carro sem bem é caso NORMAL — são 3 agora (os KWIDs de 20/08). Em Postgres
-- nulo não colide com nulo, então até um índice cheio funcionaria; o `where`
-- está aqui pra não indexar linhas que este caminho nunca consulta.
--
-- ── SEM `grant`, DE PROPÓSITO ───────────────────────────────────────────────
--
-- Índice não tem ACL. A regra decorada desta central ("coluna nova precisa de
-- GRANT próprio") vem do `accounts`, onde o SELECT é concedido coluna a coluna
-- e uma coluna nova sem grant derruba a linha toda. Aqui não há coluna nova —
-- escrever grant por decoreba criaria ACL de coluna nesta tabela e, com ela, a
-- armadilha que a regra existe pra evitar.

create unique index if not exists uq_frota_veiculos_bem_id
  on public.frota_veiculos (bem_id)
  where bem_id is not null;

comment on index public.uq_frota_veiculos_bem_id is
  'Um bem do Patrimônio pertence a um veículo só. Parcial: carro sem bem é normal.';
