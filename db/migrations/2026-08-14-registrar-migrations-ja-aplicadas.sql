-- ACERTAR O CONTROLE DE MIGRATIONS: registrar as 60 que já valem no banco.
--
-- O PROBLEMA (item B12 das pendências): `node run-migrations.mjs --dry` listava
-- 60 migrations como PENDENTES, quase todas obviamente já rodadas. A tabela de
-- controle `public.schema_migrations` tinha 26 registros para 86 arquivos — as
-- outras foram aplicadas na mão, pelo painel ou pelo MCP, e ninguém registrou.
--
-- POR QUE ISSO ERA PERIGOSO: rodar o runner replicaria as 60 em produção. Muitas
-- são `if not exists` e não fariam nada, mas NEM TODAS. Três exemplos reais que
-- estavam nessa lista:
--   · `2026-07-02-gt-config-metricas.sql` recriaria as policies
--     `gt_cfg_admin_insert` / `gt_cfg_admin_update`, que uma migration POSTERIOR
--     substituiu de propósito pelas `gt_cfg_ferramenta_*`. Voltariam as duas
--     antigas ao lado das novas, afrouxando quem pode escrever a config.
--   · `027_grant_claude_status.sql` e `2026-07-29-conteudo-03-permissao.sql` são
--     UPDATE em `profiles`: mexeriam em permissão de gente de verdade.
--   · `2026-07-31-conteudo-11-permissao-desmarcada.sql` TIRA a permissão de
--     Conteúdo de todo mundo — e hoje uma pessoa a tem, de propósito. Rodar de
--     novo tomaria o acesso dela sem ninguém pedir.
--
-- COMO FOI CONFERIDO, uma a uma (14/08/2026), e não deduzido: de cada arquivo
-- foram extraídos os objetos que ele cria — 227 alvos entre tabela, coluna,
-- função, policy, índice, trigger, tipo, view, job de cron e bucket — e cada
-- alvo foi perguntado ao banco.
--   · 50 arquivos: todos os alvos presentes.
--   · 3 arquivos apareceram como "parciais", e os três eram erro da minha
--     leitura, não do banco:
--       - `2026-07-30-conteudo-04-hora-h.sql`: a coluna é em `accounts`, não em
--         `push_preferencias` (li o ALTER errado). Está lá.
--       - `2026-07-31-allowed-accounts-no-banco.sql`: cria a policy dentro de um
--         bloco DO com `format()`, então o nome da tabela não aparece no texto.
--         A policy `so_contas_permitidas` existe em 20 tabelas.
--       - `2026-07-02-gt-config-metricas.sql`: as duas policies que faltavam são
--         as que a migration seguinte trocou de nome. É o caso descrito acima.
--   · 7 arquivos não criam objeto nenhum (UPDATE de permissão, INSERT de
--     segredo, GRANT de coluna, COMMENT). Cada um foi conferido pelo efeito:
--     os dois segredos de cron existem, o grant da coluna
--     `accounts.conteudo_usa_portal` para `authenticated` existe, o comentário
--     de `criar_pessoa_rapida` está lá, e o par 03/11 de Conteúdo bate com o
--     estado atual (se o 11 não tivesse rodado, os três super-admins teriam a
--     permissão; só uma pessoa a tem).
--
-- RESULTADO: nenhuma das 60 precisa rodar. Nenhuma. Este arquivo só carimba o
-- que já é verdade — não cria nem altera nada.
--
-- A `observacao` existe porque `applied_at` aqui é a data do CARIMBO, não a da
-- aplicação de verdade — essa ninguém sabe mais. Sem a coluna, quem lesse a
-- tabela daqui a um mês concluiria que 60 migrations rodaram todas no dia 14/08.

alter table public.schema_migrations
  add column if not exists observacao text;

insert into public.schema_migrations (name, observacao)
values
  ('022_fabrica_objetivos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('023_fabrica_publicos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('024_fabrica_looks.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('025_ia_execucoes.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('026_projetos_status.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('027_grant_claude_status.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('028_projetos_status_manual.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('029_fabrica_criativos_sku.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('030_fabrica_looks_excluido.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-02-gt-config-metricas-acesso-ferramenta.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-02-gt-config-metricas.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-16-acessos-arquivar-recurso.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-16-followers-leituras.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-16-segredos-de-cron.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-17-acessos-recursos-aceitar-workdrive.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-17-patrimonio-completo.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-24-cron-push-vendas.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-24-push-subs.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-25-cron-push-vendas-07h.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-conteudo-01-fundacao.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-conteudo-02-bucket.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-conteudo-03-permissao.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-cron-push-saldo.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-fila-decisoes.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-fila-escopo-criativos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-push-preferencias.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-29-regua-metas-por-conta.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-30-conteudo-04-hora-h.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-30-conteudo-05-segredo-hora-h.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-30-conteudo-06-cron-hora-h.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-allowed-accounts-no-banco.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-coletor-uma-conta-por-vez.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-conteudo-07-metricas.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-conteudo-08-segredo-espelho.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-conteudo-09-cron-espelho.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-conteudo-10-ideias.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-conteudo-11-permissao-desmarcada.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-interesses-sugeridos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-marca-segmento.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-07-31-saude-dos-robos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-12-concorrentes-por-marca.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-13-roteiro-completo.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-14-grant-coluna-portal.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-15-casar-na-mao.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-16-responsavel-e-aprovar-agendando.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-conteudo-17-guarda-cobre-agendar-direto.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-01-interesses-termos-de-produto.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-03-gestor-envio-de-imagem.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-03-gt-rascunhos-de-campanha.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-04-equipes-e-escopo.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-04-escopo-em-vendas-e-estoque.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-04-patrimonio-por-time.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-04-vessel-verify-fotos.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-04-vessel-verify.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-05-vessel-painel.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-06-pessoa-marca.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-13-cadastro-rapido-de-pessoa.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-13-cadastro-rapido-nota-de-escopo.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-13-marcar-senha-trocada.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-13-patrimonio-numero-de-serie.sql', 'conferida contra o banco em 14/08/2026: ja estava aplicada'),
  ('2026-08-14-registrar-migrations-ja-aplicadas.sql', 'este arquivo, registrando a si mesmo')
on conflict (name) do nothing;
