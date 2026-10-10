-- ROBÔS DA VPS NO PAINEL DE SAÚDE (robos_esperados / robos_saude).
--
-- Os robôs saíram do GitHub Actions para a VPS (#336 a #339) e o único aviso de falha era o WhatsApp do monitor
-- (ALERT_COMANDO). Em 10/10/2026 a sessão Evolution `alarmes-pdv` estava fechada: nenhum robô avisaria de nada, e o painel
-- de saúde da central não conhecia nenhum deles. Agora `coletor/vps/rodar-robo.sh` grava cada rodada em `robos_execucoes`
-- (segundo canal) e cada robô entra aqui com o teto de tempo sem sucesso, medido pela agenda de `robos.cron`:
--   de 5 em 5 min = 2 h · de hora em hora = 4 h · diário = 30 h · semanal = 200 h (8 dias e meio).
-- Nenhum é crítico: parar não derruba venda nem estoque; o painel mostra e o dono decide.
-- `copia-do-banco` já está como `guardar-copia-do-banco` (o próprio script grava a execução).
insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('fotos-do-selo',          2,   false, 'Busca as fotos das bolsas dos lotes novos (certificado). Roda de 5 em 5 min na VPS.'),
  ('publicar-o-site',        2,   false, 'Publica o site vesselbrasil.com.br quando o main do vessel-brasil muda. Roda de 5 em 5 min na VPS.'),
  ('notas-dos-pedidos',      4,   false, 'Data da venda dos pedidos (janela de 7 dias). De hora em hora na VPS.'),
  ('pedidos-da-vessel',      4,   false, 'Pedidos e vendedores da Vessel vindos do Bling. De hora em hora na VPS.'),
  ('pedidos-da-shopify',     4,   false, 'Pedidos da loja Shopify (3 dias ao vivo, 30 dias às 07h). De hora em hora na VPS.'),
  ('faxina-storage',         30,  false, 'Faxina do Storage e vigia de armazenamento. Diário na VPS.'),
  ('meta-ads-no-zoho',       30,  false, 'Planilha do Meta Ads no Zoho WorkDrive. Diário na VPS.'),
  ('cards-comercial-diario', 30,  false, 'Cards do comercial. Diário na VPS.'),
  ('relatorios-comerciais',  30,  false, 'Relatórios comerciais. Diário na VPS.'),
  ('vigia-problemas-meta',   30,  false, 'Problemas do Meta (leitura e gravação, sem IA). Diário na VPS.'),
  ('budget-ia',              30,  false, 'Análise diária de tráfego com IA (08h BRT). Diário na VPS.'),
  ('opr-diario',             30,  false, 'Relatório OPR diário no WhatsApp (05h BRT). Falha enquanto a instância Z-API estiver desconectada.'),
  ('coletor-noticias',       200, false, 'Coletor de Notícias do Observatório (segunda 09:07 UTC). Semanal na VPS.'),
  ('gestor-comercial',       200, false, 'Briefing semanal do gestor comercial (segunda 09:23 UTC). Semanal na VPS.'),
  ('sugerir-interesses',     200, false, 'Sugestão de interesses (domingo 10:34 UTC). Semanal na VPS.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
