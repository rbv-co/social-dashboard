package trafego

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5700000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5700000-0000-4000-a000-0000000000a2" // 'Mantova'
	A3 = "a5700000-0000-4000-a000-0000000000a3" // conta que ninguém tem

	M1 = "a5720000-0000-4000-a000-0000000000b1" // marca da A1
	M2 = "a5720000-0000-4000-a000-0000000000b2" // marca da A2

	R1 = "a5730000-0000-4000-a000-0000000000c1" // rascunho de A1, de gestorTodas
	R2 = "a5730000-0000-4000-a000-0000000000c2" // rascunho de A1, de gestorA1
	R3 = "a5730000-0000-4000-a000-0000000000c3" // rascunho de A2, de gestorTodas

	idGestorTodas   = "a5710000-0000-4000-a000-000000000001"
	idGestorA1      = "a5710000-0000-4000-a000-000000000002"
	idGestorNenhuma = "a5710000-0000-4000-a000-000000000003"
	idAdminA1       = "a5710000-0000-4000-a000-000000000004"
	idSuperA1       = "a5710000-0000-4000-a000-000000000005"
	idLeitor        = "a5710000-0000-4000-a000-000000000006"
	idSemModulo     = "a5710000-0000-4000-a000-000000000007"
	idDesativado    = "a5710000-0000-4000-a000-000000000008"
)

// pessoas: o gestor nos três estados de allowed_accounts (nulo, lista, vazia), quem passa por papel
// (admin), o super pela FICHA que NÃO é gestor (as policies gt_* não o incluem), quem tem 'meta' sem
// 'meta.gestor' (lê o que é aberto, usa o mapa, não usa a IA) e quem não tem módulo nenhum.
var pessoas = []mundoteste.Pessoa{
	{Chave: "gestorTodas", ID: idGestorTodas, Email: "gestortodas@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.gestor"}},
	{Chave: "gestorA1", ID: idGestorA1, Email: "gestora1@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.gestor"}, Contas: []string{A1}},
	{Chave: "gestorNenhuma", ID: idGestorNenhuma, Email: "gestornenhuma@x.com", Papel: "viewer", Modulos: []string{"meta.gestor"}, Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "superA1", ID: idSuperA1, Email: "supera1@x.com", Papel: "viewer", Super: true, Contas: []string{A1}},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Modulos: []string{"meta.gestor"}, Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 em account_id (ou é ligada à marca M2).
// A decisão 3 não tem conta (pode_ver_conta(null) = verdadeiro: todo gestor a vê).
const linhasDoTrafego = `
insert into accounts (id, name, username, instagram_id) values
  ('` + A1 + `', 'Vessel', 'vessel', '1784'), ('` + A2 + `', 'Mantova', 'mantova', '1785');
insert into campaigns (campaign_id, account_id, name) values ('9001', '` + A1 + `', 'Vessel 1'), ('9002', '` + A2 + `', 'Mantova 1');
insert into gt_config_metricas (balde, metricas, updated_at) values ('engajamento', '["cpm","custo_visita"]', '2026-10-01T00:00:00Z');
insert into gt_objetivo_interacao (alvo_id, nivel, interacao, conta_id, updated_at) values
  ('9001', 'campanha', 'curtidas', '` + A1 + `', '2026-10-01T00:00:00Z'),
  ('9002', 'campanha', 'salvamentos', '` + A2 + `', '2026-10-01T00:00:00Z');
insert into gt_ponderada_config (id, metas_por_conta, limiares_resultado, updated_at) values
  (1, '{"` + A1 + `": {"mensagens": 9.8}, "` + A2 + `": {"mensagens": 7.7}}', '{"dentroMeta": 1.0}', '2026-10-01T00:00:00Z');
insert into gt_budget_analises (campaign_id, account_id, veredito, justificativa, budget_atual_centavos, budget_sugerido_centavos, impactos, gerado_em) values
  ('9001', '` + A1 + `', 'escalar', 'Custo abaixo da meta', 10000, 15000, '{"conversas": 3}', '2026-10-11T08:00:00Z'),
  ('9002', '` + A2 + `', 'reduzir', 'Custo acima da meta', 20000, 10000, null, '2026-10-11T09:00:00Z');
insert into gt_ad_analises (ad_id, campaign_id, account_id, veredito, justificativa, gerado_em) values
  ('7001', '9001', '` + A1 + `', 'pausar', 'Sem tração', '2026-10-11T08:00:00Z'),
  ('7002', '9002', '` + A2 + `', 'pausar', 'Sem tração', '2026-10-11T08:00:00Z'),
  ('7003', '9001', '` + A1 + `', 'manter', 'Bom', '2026-10-11T08:00:00Z');
insert into gt_fila_decisoes (campaign_id, account_id, veredito, decisao, decidido_por, escopo, decidido_em) values
  ('9001', '` + A1 + `', 'escalar', 'aprovada', '` + idGestorTodas + `', 'orcamento', '2026-10-10T10:00:00Z'),
  ('9002', '` + A2 + `', 'reduzir', 'recusada', '` + idGestorTodas + `', 'saude', '2026-10-11T10:00:00Z'),
  ('9003', null, 'pausar', 'aprovada', '` + idGestorTodas + `', 'criativos', '2026-10-09T10:00:00Z');
insert into gt_campanhas_rascunho (id, account_id, criado_por, nome, status, updated_at) values
  ('` + R1 + `', '` + A1 + `', '` + idGestorTodas + `', 'Seguidores outubro', 'rascunho', '2026-10-10T10:00:00Z'),
  ('` + R2 + `', '` + A1 + `', '` + idGestorA1 + `', 'Mensagens', 'rascunho', '2026-10-11T10:00:00Z'),
  ('` + R3 + `', '` + A2 + `', '` + idGestorTodas + `', 'Vendas Mantova', 'criada', '2026-10-09T10:00:00Z');
insert into gt_problemas_meta (ad_id, codigo, account_id, titulo, grave) values
  ('7001', 1, '` + A1 + `', 'Texto recusado', true), ('7002', 2, '` + A2 + `', 'Imagem recusada', false);
insert into fabrica_marcas (id, nome, ad_account, page_id, ig_id, account_id) values
  ('` + M1 + `', 'Vessel', 'act_111', 'p1', '1784', '` + A1 + `'),
  ('` + M2 + `', 'Mantova', 'act_222', 'p2', '1785', '` + A2 + `');
insert into interesses_sugeridos (marca_id, objetivo, itens) values
  ('` + M1 + `', 'seguidores', '[{"id":"6003","nome":"Moda"}]'),
  ('` + M2 + `', 'seguidores', '[{"id":"6004","nome":"Bolsas"}]');`

// fotoDoTrafego: hash das 11 tabelas da fatia. Igual antes e depois = nada mudou.
const fotoDoTrafego = `select md5(string_agg(l, '|' order by l)) from (
  select 'cm:' || t::text as l from gt_config_metricas t union all
  select 'oi:' || t::text from gt_objetivo_interacao t union all
  select 'pc:' || t::text from gt_ponderada_config t union all
  select 'pl:' || t::text from gt_ponderada_config_log t union all
  select 'ba:' || t::text from gt_budget_analises t union all
  select 'aa:' || t::text from gt_ad_analises t union all
  select 'fd:' || t::text from gt_fila_decisoes t union all
  select 'cr:' || t::text from gt_campanhas_rascunho t union all
  select 'pm:' || t::text from gt_problemas_meta t union all
  select 'fm:' || t::text from fabrica_marcas t union all
  select 'is:' || t::text from interesses_sugeridos t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de gestorA1 aberta por
// superA1), com as rotas de `montar` atrás da MESMA cadeia do grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoTrafego,
		Impersonadas: map[string][2]string{"impersonado": {idGestorA1, idSuperA1}}}, montar...)
}
