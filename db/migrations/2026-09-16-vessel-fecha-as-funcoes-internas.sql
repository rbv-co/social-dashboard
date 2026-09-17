-- FECHA AS FUNÇÕES INTERNAS DE vessel_pessoas PARA A CHAVE PÚBLICA.
--
-- ⚠️ O BURACO, medido em 16/09/2026 com a chave que está no HTML do site:
--
--     POST /rest/v1/rpc/vessel_pessoa_por_telefone
--       { "p_nome": "…", "p_telefone": "…" }        → HTTP 200, e GRAVOU.
--
-- Qualquer visitante podia criar pessoas à vontade, pulando a armadilha e o
-- teto por hora que existem justamente para isso.
--
-- A CAUSA: a migration anterior fez `revoke all on function … from public` — e
-- isso NÃO FECHA. No Supabase os papéis `anon` e `authenticated` recebem
-- execute por privilégio padrão do schema, que é uma concessão SEPARADA da do
-- papel `public`. Revogar de `public` deixa as duas de pé.
--
-- Já tínhamos tropeçado nisto antes, em outra tabela. Agora está escrito.
--
-- A SEGUNDA LIÇÃO, e ela é da PROVA, não do banco: a prova dava 404 nessa
-- função e eu li como "fechada". Era assinatura errada — a função tem dois
-- argumentos obrigatórios e eu chamava sem nenhum. Chamada com os argumentos
-- certos, respondia 200. Prova que passa por engano é pior que prova nenhuma.

revoke all on function public.vessel_pessoa_por_telefone(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.vessel_novo_codigo_de_convite()
  from public, anon, authenticated;
revoke all on function public.vessel_hash_de_origem()
  from public, anon, authenticated;
revoke all on function public.vessel_telefone_canonico(text)
  from public, anon, authenticated;
revoke all on function public.vessel_toca_atualizado_em()
  from public, anon, authenticated;

-- As três portas continuam abertas, e SÓ elas.
grant execute on function public.vessel_pedir_atendimento(text, text, text, text, text, text, boolean, json, text) to anon, authenticated;
grant execute on function public.vessel_registrar_cartao(text, text, text, timestamptz, text, text) to anon, authenticated;
grant execute on function public.vessel_abrir_convite(text, text, text, text) to anon, authenticated;
