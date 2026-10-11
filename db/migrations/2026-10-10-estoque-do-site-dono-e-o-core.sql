-- ESTOQUE DO SITE: O DONO É O CORE (core:shopify-estoque-site, a cada minuto, modo aplicar).
--
-- O cron `estoque-do-site` do Supabase foi removido em 08/10/2026 (último disparo 17:52 UTC) e a edge só grava se
-- ESTOQUE_DO_SITE_DONO=edge (segredo que não existe). Só que a linha de `robos_esperados` ficou: crítica, teto de 1 hora,
-- para um robô que ninguém mais dispara. Resultado: o painel mostrava ATRASADO desde 08/10, todo dia. Alarme sempre
-- ligado é defeito (REVISAO-CORE, decisão 4): ninguém olha mais para ele quando ele tocar de verdade.
--
-- Quem vigia o estoque do site agora é o próprio Core: `core:shopify-estoque-site` com teto de 15 min e o alerta crítico
-- `estoque_site_travado` (services/core/internal/saude), exposto em /api/interno/saude.
delete from public.robos_esperados where robo = 'estoque-do-site';
