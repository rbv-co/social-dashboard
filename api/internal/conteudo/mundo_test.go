package conteudo

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	A1 = "a5900000-0000-4000-a000-0000000000a1" // 'Vessel'
	A2 = "a5900000-0000-4000-a000-0000000000a2" // 'Mantova'
	A9 = "a5900000-0000-4000-a000-0000000000a9" // conta que não existe

	P1 = "a5930000-0000-4000-a000-0000000000c1" // A1, rascunho, com 2 arquivos e 1 evento
	P2 = "a5930000-0000-4000-a000-0000000000c2" // A1, em_aprovacao, com data
	P3 = "a5930000-0000-4000-a000-0000000000c3" // A2, em_aprovacao, com data, 1 arquivo, 1 evento, 1 sugestão
	P4 = "a5930000-0000-4000-a000-0000000000c4" // A1, agendada e já avisada, 2 sugestões
	P5 = "a5930000-0000-4000-a000-0000000000c5" // A2, publicada, 2 métricas
	P6 = "a5930000-0000-4000-a000-0000000000c6" // A1, publicada, 2 métricas
	P7 = "a5930000-0000-4000-a000-0000000000c7" // A1, em_aprovacao SEM data

	AR1 = "a5940000-0000-4000-a000-0000000000d1" // P1, ordem 1, imagem (a capa)
	AR2 = "a5940000-0000-4000-a000-0000000000d2" // P1, ordem 2, vídeo
	AR3 = "a5940000-0000-4000-a000-0000000000d3" // P3, ordem 1, imagem

	CS1 = "a5950000-0000-4000-a000-0000000000e1" // P4, sugerido, 0.7
	CS2 = "a5950000-0000-4000-a000-0000000000e2" // P4, sugerido, 0.5
	CS3 = "a5950000-0000-4000-a000-0000000000e3" // P3, sugerido, 0.9

	I1 = "a5960000-0000-4000-a000-0000000000f1" // A1, nova, da IA
	I2 = "a5960000-0000-4000-a000-0000000000f2" // de todas as marcas (conta nula), nova
	I3 = "a5960000-0000-4000-a000-0000000000f3" // A2, favorita
	I4 = "a5960000-0000-4000-a000-0000000000f4" // A1, descartada
	I5 = "a5960000-0000-4000-a000-0000000000f5" // A1, usada

	B1 = "a5970000-0000-4000-a000-000000000001" // A1, legenda
	B2 = "a5970000-0000-4000-a000-000000000002" // de todas, hashtags
	B3 = "a5970000-0000-4000-a000-000000000003" // A2, cta
	B4 = "a5970000-0000-4000-a000-000000000004" // A1, assinatura, inativo

	K1 = "a5980000-0000-4000-a000-000000000001" // A1, lojaum
	K2 = "a5980000-0000-4000-a000-000000000002" // A2, lojadois

	J1 = "a5990000-0000-4000-a000-000000000001" // A1, ideias, concluído
	J2 = "a5990000-0000-4000-a000-000000000002" // A2, semana, erro

	idConteudista        = "a5910000-0000-4000-a000-000000000001"
	idConteudistaA1      = "a5910000-0000-4000-a000-000000000002"
	idConteudistaNenhuma = "a5910000-0000-4000-a000-000000000003"
	idAprovador          = "a5910000-0000-4000-a000-000000000004"
	idAprovadorA1        = "a5910000-0000-4000-a000-000000000005"
	idSoAprovar          = "a5910000-0000-4000-a000-000000000006"
	idAdminA1            = "a5910000-0000-4000-a000-000000000007"
	idSuper              = "a5910000-0000-4000-a000-000000000008"
	idChaveConteudo      = "a5910000-0000-4000-a000-000000000009"
	idSemModulo          = "a5910000-0000-4000-a000-000000000010"
	idDesativado         = "a5910000-0000-4000-a000-000000000011"
)

// pessoas: o conteudista nos três estados de allowed_accounts (nulo, lista, vazia), o aprovador com e sem
// lista, quem só tem 'conteudo.aprovar' (passa no portão das decisões, não lê as tabelas), quem passa por papel
// (admin) e pela ficha (super), quem tem a chave 'conteudo' só em PERMISSIONS (a edge conteudo-trigger aceita;
// as policies e as funções, não), quem não tem nada e o desativado. A chave vai em linhasDoConteudo.
var pessoas = []mundoteste.Pessoa{
	{Chave: "conteudista", ID: idConteudista, Email: "conteudista@x.com", Papel: "viewer", Modulos: []string{"conteudo"}},
	{Chave: "conteudistaA1", ID: idConteudistaA1, Email: "conteudistaa1@x.com", Papel: "viewer", Modulos: []string{"conteudo"}, Contas: []string{A1}},
	{Chave: "conteudistaNenhuma", ID: idConteudistaNenhuma, Email: "conteudistanenhuma@x.com", Papel: "viewer", Modulos: []string{"conteudo"}, Contas: []string{}},
	{Chave: "aprovador", ID: idAprovador, Email: "aprovador@x.com", Papel: "viewer", Modulos: []string{"conteudo", "conteudo.aprovar"}},
	{Chave: "aprovadorA1", ID: idAprovadorA1, Email: "aprovadora1@x.com", Papel: "viewer", Modulos: []string{"conteudo", "conteudo.aprovar"}, Contas: []string{A1}},
	{Chave: "soAprovar", ID: idSoAprovar, Email: "soaprovar@x.com", Papel: "viewer", Modulos: []string{"conteudo.aprovar"}},
	{Chave: "adminA1", ID: idAdminA1, Email: "admina1@x.com", Papel: "admin", Contas: []string{A1}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "chaveConteudo", ID: idChaveConteudo, Email: "chaveconteudo@x.com", Papel: "viewer"},
	{Chave: "semModulo", ID: idSemModulo, Email: "semmodulo@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "admin", Modulos: []string{"conteudo", "conteudo.aprovar"}, Desativado: true},
}

// Sem identidade. Toda linha de A2 carrega o uuid de A2 (na conta da linha, da peça-mãe ou no caminho).
const linhasDoConteudo = `
update profiles set permissions = '{"conteudo": ["ver"]}' where id = '` + idChaveConteudo + `';
insert into accounts (id, name, username, instagram_id) values ('` + A1 + `', 'Vessel', 'vessel', '1784'), ('` + A2 + `', 'Mantova', 'mantova', '1785');
insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em, publicado_em, avisado_em, ig_media_id, criado_por, created_at) values
  ('` + P1 + `', '` + A1 + `', 'Bastidor da loja', 'reels', 'rascunho', null, null, null, null, '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + P2 + `', '` + A1 + `', 'Lançamento', 'feed', 'em_aprovacao', '2026-10-20T15:00:00Z', null, null, null, '` + idConteudista + `', '2026-10-02T10:00:00Z'),
  ('` + P3 + `', '` + A2 + `', 'Mantova verão', 'carrossel', 'em_aprovacao', '2026-10-21T15:00:00Z', null, null, null, '` + idConteudista + `', '2026-10-03T10:00:00Z'),
  ('` + P4 + `', '` + A1 + `', 'Promoção', 'stories', 'agendada', '2026-10-10T15:00:00Z', null, '2026-10-10T15:00:00Z', null, '` + idConteudista + `', '2026-10-04T10:00:00Z'),
  ('` + P5 + `', '` + A2 + `', 'Mantova publicada', 'feed', 'publicada', '2026-09-10T15:00:00Z', '2026-09-10T15:05:00Z', null, 'IG5', '` + idConteudista + `', '2026-09-01T10:00:00Z'),
  ('` + P6 + `', '` + A1 + `', 'Vessel publicada', 'feed', 'publicada', '2026-09-11T15:00:00Z', '2026-09-11T15:05:00Z', null, 'IG6', '` + idConteudista + `', '2026-09-02T10:00:00Z'),
  ('` + P7 + `', '` + A1 + `', 'Sem data', 'feed', 'em_aprovacao', null, null, null, null, '` + idConteudista + `', '2026-10-05T10:00:00Z');
insert into conteudo_arquivos (id, peca_id, ordem, caminho, tipo, mime, bytes) values
  ('` + AR1 + `', '` + P1 + `', 1, '` + A1 + `/` + P1 + `/1-capa.png', 'imagem', 'image/png', 1000),
  ('` + AR2 + `', '` + P1 + `', 2, '` + A1 + `/` + P1 + `/2-video.mp4', 'video', 'video/mp4', 9000),
  ('` + AR3 + `', '` + P3 + `', 1, '` + A2 + `/` + P3 + `/1-capa.png', 'imagem', 'image/png', 1000);
insert into conteudo_eventos (peca_id, para, acao, quem, quando) values
  ('` + P1 + `', 'rascunho', 'criou', '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + P3 + `', 'rascunho', 'criou', '` + idConteudista + `', '2026-10-03T10:00:00Z');
insert into conteudo_metricas (peca_id, capturado_em, curtidas, alcance) values
  ('` + P5 + `', '2026-09-11', 5, 50), ('` + P5 + `', '2026-09-12', 7, 70),
  ('` + P6 + `', '2026-09-12', 10, 100), ('` + P6 + `', '2026-09-13', 20, 200);
insert into conteudo_casamentos (id, peca_id, ig_media_id, pontuacao, motivo, situacao) values
  ('` + CS1 + `', '` + P4 + `', 'IG41', 0.7, 'legenda parecida', 'sugerido'),
  ('` + CS2 + `', '` + P4 + `', 'IG42', 0.5, 'horário perto', 'sugerido'),
  ('` + CS3 + `', '` + P3 + `', 'IG31', 0.9, 'legenda igual', 'sugerido');
insert into conteudo_ideias (id, account_id, titulo, formato, origem, situacao, created_at) values
  ('` + I1 + `', '` + A1 + `', 'Provador ao vivo', 'reels', 'ia', 'nova', '2026-10-01T10:00:00Z'),
  ('` + I2 + `', null, 'Dica de cuidado com couro', 'carrossel', 'manual', 'nova', '2026-10-02T10:00:00Z'),
  ('` + I3 + `', '` + A2 + `', 'Mantova na praia', 'feed', 'manual', 'favorita', '2026-10-03T10:00:00Z'),
  ('` + I4 + `', '` + A1 + `', 'Descartada', 'feed', 'manual', 'descartada', '2026-10-04T10:00:00Z'),
  ('` + I5 + `', '` + A1 + `', 'Já usada', 'feed', 'manual', 'usada', '2026-10-05T10:00:00Z');
insert into conteudo_blocos (id, account_id, tipo, nome, texto, ativo) values
  ('` + B1 + `', '` + A1 + `', 'legenda', 'Abertura', 'Chegou!', true),
  ('` + B2 + `', null, 'hashtags', 'Gerais', '#moda', true),
  ('` + B3 + `', '` + A2 + `', 'cta', 'Chame', 'Chame no direct', true),
  ('` + B4 + `', '` + A1 + `', 'assinatura', 'Velha', 'Vessel', false);
insert into conteudo_concorrentes (id, account_id, handle, nome) values
  ('` + K1 + `', '` + A1 + `', 'lojaum', 'Loja Um'), ('` + K2 + `', '` + A2 + `', 'lojadois', 'Loja Dois');
insert into conteudo_jobs (id, tipo, account_id, params, status, resultado, criado_por, created_at) values
  ('` + J1 + `', 'ideias', '` + A1 + `', '{"quantas": 12}', 'concluido', '{"gravadas": 12}', '` + idConteudista + `', '2026-10-01T10:00:00Z'),
  ('` + J2 + `', 'semana', '` + A2 + `', '{"segunda": "2026-10-05"}', 'erro', null, '` + idConteudista + `', '2026-10-02T10:00:00Z');`

// fotoDoConteudo: hash das 9 tabelas. Igual antes e depois = nada mudou.
const fotoDoConteudo = `select md5(string_agg(l, '|' order by l)) from (
  select 'pe:' || t::text as l from conteudo_pecas t union all
  select 'ar:' || t::text from conteudo_arquivos t union all
  select 'ev:' || t::text from conteudo_eventos t union all
  select 'me:' || t::text from conteudo_metricas t union all
  select 'ca:' || t::text from conteudo_casamentos t union all
  select 'id:' || t::text from conteudo_ideias t union all
  select 'bl:' || t::text from conteudo_blocos t union all
  select 'co:' || t::text from conteudo_concorrentes t union all
  select 'jo:' || t::text from conteudo_jobs t) z`

// novoMundo: a fatia de produção, as pessoas, as linhas e a sessão "impersonado" (a de conteudistaA1 aberta
// por super: o "entrar como" vê o que o ALVO vê, só A1; e "impersonadoAprovador", a de aprovadorA1), com as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoConteudo,
		Impersonadas: map[string][2]string{"impersonado": {idConteudistaA1, idSuper},
			// o alvo é quem PASSA no portão das 6 RPCs: o que as recusa é o SoSessaoPropria, não o portão
			"impersonadoAprovador": {idAprovadorA1, idSuper}}}, montar...)
}
