package fabrica

import (
	"context"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5800000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5800000-0000-4000-a000-0000000000a2" // 'Mantova'

	M1 = "a5820000-0000-4000-a000-0000000000b1" // marca da A1
	M2 = "a5820000-0000-4000-a000-0000000000b2" // marca da A2

	C1 = "a5830000-0000-4000-a000-0000000000c1" // gerando (J1 rodando, run 111)
	C2 = "a5830000-0000-4000-a000-0000000000c2" // pronta
	C3 = "a5830000-0000-4000-a000-0000000000c3" // publicada (fechada)
	C4 = "a5830000-0000-4000-a000-0000000000c4" // fechada e purgada

	K1 = "a5840000-0000-4000-a000-0000000000d1" // C1, produto, escolhido
	K2 = "a5840000-0000-4000-a000-0000000000d2" // C1, promo
	K3 = "a5840000-0000-4000-a000-0000000000d3" // C2, produto
	K4 = "a5840000-0000-4000-a000-0000000000d4" // C3, produto, escolhido

	J1  = "a5850000-0000-4000-a000-0000000000e1" // gerar C1, rodando, run 111
	J2  = "a5850000-0000-4000-a000-0000000000e2" // subir C3, concluido
	MJ1 = "a5860000-0000-4000-a000-0000000000f1" // rastro da subida de C3
	P1  = "a5870000-0000-4000-a000-000000000001" // público ativo da M1
	P2  = "a5870000-0000-4000-a000-000000000002" // público inativo

	idFabricante        = "a5810000-0000-4000-a000-000000000001"
	idFabricanteA1      = "a5810000-0000-4000-a000-000000000002"
	idFabricanteNenhuma = "a5810000-0000-4000-a000-000000000003"
	idAdminA1           = "a5810000-0000-4000-a000-000000000004"
	idSuper             = "a5810000-0000-4000-a000-000000000005"
	idLeitor            = "a5810000-0000-4000-a000-000000000006"
	idChaveEmLista      = "a5810000-0000-4000-a000-000000000007"
	idSemModulo         = "a5810000-0000-4000-a000-000000000008"
	idDesativado        = "a5810000-0000-4000-a000-000000000009"
	idRobo              = "a5810000-0000-4000-a000-000000000010"
	idRoboSemFabrica    = "a5810000-0000-4000-a000-000000000011"
)

// pessoas: a chave meta.fabrica de permissions nos três estados de allowed_accounts (nulo, lista, vazia),
// quem passa por papel (admin) e pela ficha (super), quem tem 'meta.fabrica' só em FEATURES (não passa: a
// policy lê permissions), a chave num array no topo (passa: o ? do jsonb), quem não tem nada e os dois
// robôs (perfil próprio, sessão de serviço; um com a chave, outro sem). As chaves vão em linhasDaFabrica.
var pessoas = []mundoteste.Pessoa{
	{Chave: "fabricante", ID: idFabricante, Email: "fabricante@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "fabricanteA1", ID: idFabricanteA1, Email: "fabricantea1@x.com", Papel: "viewer", Modulos: []string{"meta"}, Contas: []string{A1}},
	{Chave: "fabricanteNenhuma", ID: idFabricanteNenhuma, Email: "fabricantenenhuma@x.com", Papel: "viewer", Contas: []string{}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta", "meta.fabrica"}},
	{Chave: "chaveEmLista", ID: idChaveEmLista, Email: "chaveemlista@x.com", Papel: "viewer"},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Desativado: true},
	{Chave: "robo", ID: idRobo, Email: "robo-fabrica@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "roboSemFabrica", ID: idRoboSemFabrica, Email: "robo-outro@x.com", Papel: "viewer", Modulos: []string{"meta"}},
}

// Sem identidade. Toda linha de A2 é a marca M2; nada mais tem conta (as outras 8 tabelas não têm a
// restritiva).
const linhasDaFabrica = `
update profiles set permissions = '{"meta.fabrica": ["ver", "editar"]}'
 where id in ('` + idFabricante + `', '` + idFabricanteA1 + `', '` + idFabricanteNenhuma + `', '` + idRobo + `');
update profiles set permissions = '["meta.fabrica"]' where id = '` + idChaveEmLista + `';
insert into fabrica_marcas (id, nome, ad_account, page_id, ig_id, account_id, created_at) values
  ('` + M1 + `', 'Vessel', 'act_111', 'p1', '1784', '` + A1 + `', '2026-10-01T00:00:00Z'),
  ('` + M2 + `', 'Mantova', 'act_222', 'p2', '1785', '` + A2 + `', '2026-10-02T00:00:00Z');
insert into fabrica_lojas (deposito_id, nome, ativo, ordem, marca_id, whatsapp, geo_cities, canal_loja_id) values
  ('14888726315', 'Tivoli (Santa Bárbara)', true, 1, '` + M1 + `', '+5519971690502', '[267873]', '205834140'),
  ('14888726277', 'Iguatemi (Campinas)', true, 2, '` + M1 + `', '+5519971092194', '[247071]', '205834116'),
  ('14888617206', 'Shopping Dom Pedro', false, 3, '` + M1 + `', '+5519999545112', '[247071]', '205657609');
insert into fabrica_objetivos (chave, rotulo, meta_objective, optimization_goal, pede_desconto, ativo, ordem) values
  ('engajamento', 'Engajamento (WhatsApp)', 'OUTCOME_ENGAGEMENT', 'CONVERSATIONS', true, true, 1),
  ('branding', 'Reconhecimento', 'OUTCOME_AWARENESS', 'REACH', false, true, 3),
  ('antigo', 'Antigo', 'OUTCOME_TRAFFIC', 'LINK_CLICKS', true, false, 9);
insert into fabrica_looks (chave, nome, arquetipo, objetivos, ativo, ordem, excluido) values
  ('produto-heroi', 'Produto · Herói', 'produto', '{engajamento}', true, 1, false),
  ('promo-sage', 'Promo · Sage', 'promo', '{engajamento,branding}', true, 2, false),
  ('marca-velha', 'Marca · Velha', 'produto', '{}', false, 3, true);
insert into fabrica_campanhas (id, nome, status, objetivo, job_id, created_at, fechada_em, purgado_em) values
  ('` + C1 + `', 'Rodada 1', 'gerando', 'engajamento', '` + J1 + `', '2026-10-10T10:00:00Z', null, null),
  ('` + C2 + `', 'Rodada 2', 'pronta', 'branding', null, '2026-10-11T10:00:00Z', null, null),
  ('` + C3 + `', 'Rodada 3', 'pronta', 'engajamento', null, '2026-10-01T10:00:00Z', '2026-10-05T10:00:00Z', null),
  ('` + C4 + `', 'Rodada 4', 'pronta', 'engajamento', null, '2026-08-01T10:00:00Z', '2026-08-05T10:00:00Z', '2026-09-05T10:00:00Z');
insert into fabrica_criativos (id, campanha_id, sku, arquetipo, template, formato, variante, storage_path, url, escolhido, created_at) values
  ('` + K1 + `', '` + C1 + `', 'S1', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C1 + `/produto/s1-avista-1080x1080.png', 'https://midia.x/f/` + C1 + `/produto/s1.png', true, '2026-10-10T10:01:00Z'),
  ('` + K2 + `', '` + C1 + `', null, 'promo', 'promo-sage', '1080x1920', 'colecao', '` + C1 + `/promo/colecao-1080x1920.png', 'https://midia.x/f/` + C1 + `/promo/c.png', false, '2026-10-10T10:02:00Z'),
  ('` + K3 + `', '` + C2 + `', 'S2', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C2 + `/produto/s2-avista-1080x1080.png', 'https://midia.x/f/` + C2 + `/produto/s2.png', false, '2026-10-11T10:01:00Z'),
  ('` + K4 + `', '` + C3 + `', 'S3', 'produto', 'produto-heroi', '1080x1080', 'avista', '` + C3 + `/produto/s3-avista-1080x1080.png', 'https://midia.x/f/` + C3 + `/produto/s3.png', true, '2026-10-01T10:01:00Z');
insert into fabrica_jobs (id, tipo, params, status, github_run_id, criado_por, created_at) values
  ('` + J1 + `', 'gerar', '{"campanhaId": "` + C1 + `", "objetivo": "engajamento"}', 'rodando', '111', '` + idFabricante + `', '2026-10-10T10:00:00Z'),
  ('` + J2 + `', 'subir', '{"campanhaId": "` + C3 + `"}', 'concluido', '222', '` + idFabricante + `', '2026-10-04T10:00:00Z');
insert into fabrica_meta_jobs (id, ad_account_id, loja, tipo, meta_campaign_id, adset_ids, ad_ids, payload, status, created_at) values
  ('` + MJ1 + `', 'act_111', 'Tivoli (Santa Bárbara)', 'estudio', '120001', '["1"]', '["2"]', '{"campanhaId": "` + C3 + `"}', 'criado', '2026-10-05T09:00:00Z');
insert into fabrica_publicos (id, nome, marca_id, ativo, created_at) values
  ('` + P1 + `', 'Campinas 25-45', '` + M1 + `', true, '2026-10-01T00:00:00Z'),
  ('` + P2 + `', 'Velho', null, false, '2026-09-01T00:00:00Z');`

// fotoDaFabrica: hash das 9 tabelas e de ia_execucoes. Igual antes e depois = nada mudou.
const fotoDaFabrica = `select md5(string_agg(l, '|' order by l)) from (
  select 'lo:' || t::text as l from fabrica_lojas t union all
  select 'ob:' || t::text from fabrica_objetivos t union all
  select 'lk:' || t::text from fabrica_looks t union all
  select 'ma:' || t::text from fabrica_marcas t union all
  select 'ca:' || t::text from fabrica_campanhas t union all
  select 'cr:' || t::text from fabrica_criativos t union all
  select 'jo:' || t::text from fabrica_jobs t union all
  select 'mj:' || t::text from fabrica_meta_jobs t union all
  select 'pu:' || t::text from fabrica_publicos t union all
  select 'ia:' || t::text from ia_execucoes t) z`

// sessaoDeServico: o token `srv_` do robô, emitido como o 5.13 emite (auth.Store.CriarContaDeServico sobre o
// usuário que já existe como Pessoa, sem senha). Sessão tipo 'servico' criada à mão em `sessoes` NÃO serve: a
// Exigir só reconhece o robô pelo token de tokens_de_servico.
func sessaoDeServico(t *testing.T, m *mundoteste.Mundo, chave, nome, email string) {
	t.Helper()
	tok, err := auth.NovoStore(m.P).CriarContaDeServico(context.Background(), nome, email, nil)
	if err != nil {
		t.Fatal(err)
	}
	m.Tok[chave] = tok
}

// novoMundo: a fatia de produção, as pessoas, as linhas, a sessão "impersonado" (a de fabricanteA1
// aberta por super) e as sessões de SERVIÇO dos dois robôs, com as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	m := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDaFabrica,
		Impersonadas: map[string][2]string{"impersonado": {idFabricanteA1, idSuper}}}, montar...)
	sessaoDeServico(t, m, "robo", "robo-fabrica", "robo-fabrica@x.com")
	sessaoDeServico(t, m, "roboSemFabrica", "robo-outro", "robo-outro@x.com")
	return m
}
