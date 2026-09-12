-- APLICADA EM 04/09/2026. Registro do que foi para o banco de produção.
--
-- O LOTE PASSA A GUARDAR O NÚMERO DA ORDEM DE SERVIÇO. Campo OPCIONAL na
-- criação, editável depois, e o número aparece no cabeçalho do lote na aba
-- Etiquetas — junto da data em que o lote foi criado na ferramenta, que já
-- existe em `criado_em`. Não há campo novo de data: campo automático não tem
-- como ser esquecido nem digitado errado.
alter table public.vessel_lotes add column if not exists os text;

comment on column public.vessel_lotes.os is
  'Numero da ordem de servico da oficina. Opcional. Amarra a bolsa ao papel.';

-- ⚠️ DROP E CREATE, e não CREATE OR REPLACE: o Postgres não deixa trocar a lista
-- de parâmetros de uma função existente. Vai tudo numa transação, então não
-- existe instante em que a função esteja fora do ar.
--
-- ⚠️ E O DROP LEVA AS PERMISSÕES JUNTO — medidas ANTES: `authenticated` executa,
-- `anon` não. Elas são devolvidas no fim deste arquivo. Sem isso o botão de
-- criar lote quebraria com "sem permissão", e a função pareceria intacta para
-- quem olhasse só o corpo dela.
--
-- (Ver o arquivo desta mesma data sobre o `anon`: devolver a permissão não foi
--  suficiente, e o porquê está lá.)
--
-- O corpo das duas funções é o que já estava em produção, com uma única adição:
-- o parâmetro `p_os` e o que ele grava. Fonte lida do próprio banco antes de
-- reescrever, para não recriar por cima de uma versão velha.
--
-- Em `vessel_editar_lote` o parâmetro tem TRÊS estados, e não dois:
--   NULO  -> "não mexa na O.S." (é o que chega de quem chama sem o parâmetro)
--   ''    -> "limpe", que é como se corrige um número digitado errado
--   texto -> "grave isto"
-- Com dois estados, apagar uma O.S. errada seria impossível.
--
-- O SQL completo das duas funções foi aplicado pela migration
-- `vessel_lote_ganha_numero_da_os`; ele é longo e vive no banco. Para lê-lo:
--   select pg_get_functiondef(oid) from pg_proc where proname = 'vessel_gerar_lote';
