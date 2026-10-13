package redes

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5600000-0000-4000-a000-0000000000a1" // 'Vessel': ig 1784, act 111, token SEGREDO-token-A1
	A2 = "a5600000-0000-4000-a000-0000000000a2" // 'Mantova': ig 1785, ad_account 'act_222', token SEGREDO-token-A2
	A3 = "a5600000-0000-4000-a000-0000000000a3" // não existe

	idTodas      = "a5610000-0000-4000-a000-000000000001"
	idSoA1       = "a5610000-0000-4000-a000-000000000002"
	idNenhuma    = "a5610000-0000-4000-a000-000000000003"
	idAdminA1    = "a5610000-0000-4000-a000-000000000004"
	idSuperA1    = "a5610000-0000-4000-a000-000000000005"
	idEmailA1    = "a5610000-0000-4000-a000-000000000006"
	idHoraA1     = "a5610000-0000-4000-a000-000000000007"
	idSemModulo  = "a5610000-0000-4000-a000-000000000008"
	idDesativado = "a5610000-0000-4000-a000-000000000009"
)

// pessoas: os três estados de allowed_accounts (nulo, lista, vazia), os que ignoram a lista (papel admin,
// super pela FICHA) e o que não ignora (super por E-MAIL), a chave meta.hora (Linhas) e quem não tem
// módulo nenhum (as tabelas não olham módulo: Ruling 5.6-3).
var pessoas = []mundoteste.Pessoa{
	{Chave: "todas", ID: idTodas, Email: "todas@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}},
	{Chave: "soA1", ID: idSoA1, Email: "soa1@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}, Contas: []string{A1}},
	{Chave: "nenhuma", ID: idNenhuma, Email: "nenhuma@x.com", Papel: "viewer", Modulos: []string{"social", "meta"}, Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "superA1", ID: idSuperA1, Email: "supera1@x.com", Papel: "viewer", Super: true, Contas: []string{A1}},
	{Chave: "emailA1", ID: idEmailA1, Email: "breno@rbvcompany.com", Papel: "viewer", Contas: []string{A1}},
	{Chave: "horaA1", ID: idHoraA1, Email: "horaa1@x.com", Papel: "viewer", Modulos: []string{"meta"}, Contas: []string{A1}},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 em account_id: é por ele que a varredura acha
// vazamento. A campanha 9000 não tem conta (pode_ver_conta(null) = verdadeiro: visível a todos).
const linhasDasRedes = `
update profiles set permissions = '{"meta.hora": ["ver"]}' where id = '` + idHoraA1 + `';
insert into accounts (id, name, username, instagram_id, ad_account_id, access_token, accent_color, persona, publicacao_automatica) values
  ('` + A1 + `', 'Vessel', 'vessel', '1784', '111', 'SEGREDO-token-A1', '#1A3A6B', 'Mulheres 30+', true),
  ('` + A2 + `', 'Mantova', 'mantova', '1785', 'act_222', 'SEGREDO-token-A2', '#7A1F1F', null, false);
insert into daily_snapshots (account_id, captured_at, followers_count, gained, lost) values
  ('` + A1 + `', '2026-10-10', 1000, 5, 1), ('` + A1 + `', '2026-10-11', 1004, 6, 2), ('` + A2 + `', '2026-10-11', 2000, 9, 3);
insert into followers_leituras (account_id, followers_count, lido_em, origem) values
  ('` + A1 + `', 1004, '2026-10-11T12:00:00Z', 'hora'), ('` + A2 + `', 2000, '2026-10-11T12:00:00Z', 'hora');
insert into engagement_snapshots (account_id, captured_at, period_days, likes, reach) values
  ('` + A1 + `', '2026-10-11', 7, 10, 100), ('` + A1 + `', '2026-10-11', 1, 2, 20), ('` + A2 + `', '2026-10-11', 7, 30, 300);
insert into content_snapshots (account_id, captured_at, period_days, posts_count, stories_count, story_replies) values
  ('` + A1 + `', '2026-10-11', 1, 1, 3, 4), ('` + A1 + `', '2026-10-11', 0, 0, 1, 0), ('` + A2 + `', '2026-10-11', 1, 2, 5, 6);
insert into campaigns (campaign_id, account_id, name, objective, status, synced_at) values
  ('9000', null, 'Campanha sem conta', 'OUTCOME_AWARENESS', 'ACTIVE', '2026-10-11'),
  ('9001', '` + A1 + `', 'Seguidores Vessel', 'OUTCOME_ENGAGEMENT', 'ACTIVE', '2026-10-11'),
  ('9002', '` + A2 + `', 'Vendas Mantova', 'OUTCOME_SALES', 'PAUSED', '2026-10-11');
insert into campaign_adsets (adset_id, campaign_id, account_id, destination_type, optimization_goal) values
  ('8001', '9001', '` + A1 + `', 'INSTAGRAM_PROFILE', 'PROFILE_VISIT'), ('8002', '9002', '` + A2 + `', 'WEBSITE', 'OFFSITE_CONVERSIONS');
insert into ads (ad_id, campaign_id, account_id, name, status, destino_link) values
  ('7001', '9001', '` + A1 + `', 'Anúncio Vessel', 'ACTIVE', 'https://vessel.exemplo/a'),
  ('7002', '9002', '` + A2 + `', 'Anúncio Mantova', 'ACTIVE', 'https://mantova.exemplo/b');
insert into campaign_insights (campaign_id, account_id, captured_at, period_days, spend, impressions) values
  ('9001', '` + A1 + `', '2026-10-10', 0, 100.10, 1000), ('9001', '` + A1 + `', '2026-10-11', 0, 1234.56, 2000),
  ('9002', '` + A2 + `', '2026-10-11', 0, 999.99, 5000);
insert into account_insights (account_id, captured_at, period_days, spend, impressions, clicks, reach, frequency) values
  ('` + A1 + `', '2026-10-11', 7, 1334.66, 3000, 30, 900, 3.33), ('` + A2 + `', '2026-10-11', 7, 999.99, 5000, 50, 2000, 2.5);
insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, gasto_hora, conversas_hora) values
  ('9001', '` + A1 + `', '2026-10-11', 9, 12.50, 12.50, 1), ('9001', '` + A1 + `', '2026-10-11', 10, 20.00, 7.50, 0),
  ('9002', '` + A2 + `', '2026-10-11', 9, 40.00, 40.00, 2);
insert into ad_insights_hora (ad_id, campaign_id, account_id, dia, hora, gasto_hora, cliques_hora) values
  ('7001', '9001', '` + A1 + `', '2026-10-11', 9, 3.25, 4), ('7002', '9002', '` + A2 + `', '2026-10-11', 9, 8.75, 9);
insert into perfil_visitas_hora (account_id, dia, hora, visitas_hora) values
  ('` + A1 + `', '2026-10-11', 9, 11), ('` + A2 + `', '2026-10-11', 9, 22);
insert into visitas_perfil_dia (account_id, dia, visitas) values ('` + A1 + `', '2026-10-10', 50), ('` + A2 + `', '2026-10-10', 60);
insert into social_metas (account_id, periodo, indicador, valor) values
  ('` + A1 + `', '1', 'seguidores', 100), ('` + A2 + `', '1', 'seguidores', 200);
insert into campaign_filters (account_id, selected_ids, updated_at) values
  ('` + A1 + `', '{9001}', '2026-10-01T00:00:00Z'), ('` + A2 + `', '{9002}', '2026-10-01T00:00:00Z');`

// fotoDasRedes: hash das 16 tabelas da fatia (as sem rota inclusive). Igual antes e depois = nada mudou.
const fotoDasRedes = `select md5(string_agg(l, '|' order by l)) from (
  select 'a:' || t::text as l from accounts t union all
  select 'd:' || t::text from daily_snapshots t union all
  select 'f:' || t::text from followers_leituras t union all
  select 'e:' || t::text from engagement_snapshots t union all
  select 'c:' || t::text from content_snapshots t union all
  select 'ca:' || t::text from campaigns t union all
  select 'cs:' || t::text from campaign_adsets t union all
  select 'ad:' || t::text from ads t union all
  select 'ci:' || t::text from campaign_insights t union all
  select 'ai:' || t::text from account_insights t union all
  select 'ch:' || t::text from campaign_insights_hora t union all
  select 'ph:' || t::text from perfil_visitas_hora t union all
  select 'ah:' || t::text from ad_insights_hora t union all
  select 'vd:' || t::text from visitas_perfil_dia t union all
  select 'sm:' || t::text from social_metas t union all
  select 'cf:' || t::text from campaign_filters t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de soA1 aberta por
// superA1), com as rotas de `montar` atrás da MESMA cadeia do grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDasRedes,
		Impersonadas: map[string][2]string{"impersonado": {idSoA1, idSuperA1}}}, montar...)
}
