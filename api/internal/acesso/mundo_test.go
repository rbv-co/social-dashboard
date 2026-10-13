package acesso

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Pessoas e linhas do mundo de teste do 5.1 (ids fixos). E-mails da lista de is_superadmin() só onde a
// regra pede: super (breno@), erick@ (o perfil que guard_profiles protege) e superSoPorEmail
// (gabriel.gertrudes@: na lista, mas com a ficha falsa).
const (
	idSuper           = "5e000000-0000-4000-a000-000000000001" // papel admin, super pela ficha E por e-mail
	idSuperFicha      = "5e000000-0000-4000-a000-000000000002" // super SÓ pela ficha, papel viewer
	idAdmin           = "5e000000-0000-4000-a000-000000000003" // papel admin
	idViewer          = "5e000000-0000-4000-a000-000000000004" // trava de loja, só a conta A1, sem time
	idSemTrava        = "5e000000-0000-4000-a000-000000000005" // escopo_por_equipe = false
	idGestorT1        = "5e000000-0000-4000-a000-000000000006"
	idSupervT1        = "5e000000-0000-4000-a000-000000000007"
	idVendT1          = "5e000000-0000-4000-a000-000000000008"
	idVendT2          = "5e000000-0000-4000-a000-000000000009" // vendedora no T2 e no T3
	idSupervG1        = "5e000000-0000-4000-a000-000000000010" // supervisora do grupo G1 (a loja 3 é do G1: vê o T3)
	idErick           = "5e000000-0000-4000-a000-000000000011"
	idAdminRestrito   = "5e000000-0000-4000-a000-000000000012" // papel admin COM trava de loja e só a conta A1
	idSuperSoPorEmail = "5e000000-0000-4000-a000-000000000013" // e-mail na lista de is_superadmin(), ficha falsa, papel viewer
	idSemPerfil       = "5e000000-0000-4000-a000-000000000014" // usuarios + sessão painel, SEM linha em profiles

	T1 = "e1000000-0000-4000-a000-000000000001" // canal 1
	T2 = "e1000000-0000-4000-a000-000000000002" // canal 2
	T3 = "e1000000-0000-4000-a000-000000000003" // canal 3, loja do grupo G1
	G1 = "c6000000-0000-4000-a000-000000000001"
	G2 = "c6000000-0000-4000-a000-000000000002"
	A1 = "acc00000-0000-4000-a000-000000000001" // contas de anúncio
	A2 = "acc00000-0000-4000-a000-000000000002"

	mGestorT1       = "3e000000-0000-4000-a000-000000000001"
	mSupervT1       = "3e000000-0000-4000-a000-000000000002"
	mVendT1         = "3e000000-0000-4000-a000-000000000003"
	mVendT2         = "3e000000-0000-4000-a000-000000000004"
	mVendT2emT3     = "3e000000-0000-4000-a000-000000000005"
	cgmSupervG1     = "3c000000-0000-4000-a000-000000000001"
	epVendT1        = "3d000000-0000-4000-a000-000000000001"
	epVendT2        = "3d000000-0000-4000-a000-000000000002"
	perfilVendedora = "3a000000-0000-4000-a000-000000000001"
	pedido1         = "3b000000-0000-4000-a000-000000000001"
)

var pessoas = []struct {
	chave, id, email, papel string
	super, trava            bool
	contas                  []string
}{
	{"super", idSuper, "breno@rbvcompany.com", "admin", true, false, nil},
	{"superFicha", idSuperFicha, "superficha@x.com", "viewer", true, false, nil},
	{"admin", idAdmin, "admin@x.com", "admin", false, false, nil},
	{"viewer", idViewer, "viewer@x.com", "viewer", false, true, []string{A1}},
	{"semTrava", idSemTrava, "semtrava@x.com", "viewer", false, false, nil},
	{"gestorT1", idGestorT1, "gestort1@x.com", "viewer", false, true, nil},
	{"supervT1", idSupervT1, "supervt1@x.com", "viewer", false, true, nil},
	{"vendT1", idVendT1, "vendt1@x.com", "viewer", false, true, nil},
	{"vendT2", idVendT2, "vendt2@x.com", "viewer", false, true, nil},
	{"supervG1", idSupervG1, "supervg1@x.com", "viewer", false, true, nil},
	{"erick", idErick, "erick@rbvcompany.com", "admin", true, false, nil},
	{"adminRestrito", idAdminRestrito, "adminrestrito@x.com", "admin", false, true, []string{A1}},
	{"superSoPorEmail", idSuperSoPorEmail, "gabriel.gertrudes@rbvcompany.com", "viewer", false, false, nil},
}

// sem identidade: os gatilhos de profiles são só de UPDATE
const linhasDoMundo = `
insert into canais_grupos (id, nome) values ('` + G1 + `', 'Varejo'), ('` + G2 + `', 'Atacado');
insert into bling_lojas (loja_id, nome, grupo_id) values (1, 'Loja 1', null), (2, 'Loja 2', null), (3, 'Loja 3', '` + G1 + `');
insert into equipes (id, nome, canal_loja_id) values ('` + T1 + `', 'Time 1', 1), ('` + T2 + `', 'Time 2', 2), ('` + T3 + `', 'Time 3', 3);
insert into equipes_membros (id, equipe_id, profile_id, papel) values
  ('` + mGestorT1 + `', '` + T1 + `', '` + idGestorT1 + `', 'gestor'),
  ('` + mSupervT1 + `', '` + T1 + `', '` + idSupervT1 + `', 'supervisora'),
  ('` + mVendT1 + `', '` + T1 + `', '` + idVendT1 + `', 'vendedora'),
  ('` + mVendT2 + `', '` + T2 + `', '` + idVendT2 + `', 'vendedora'),
  ('` + mVendT2emT3 + `', '` + T3 + `', '` + idVendT2 + `', 'vendedora');
insert into canais_grupos_membros (id, grupo_id, profile_id) values ('` + cgmSupervG1 + `', '` + G1 + `', '` + idSupervG1 + `');
insert into equipes_permissoes (id, equipe_id, profile_id, chave) values
  ('` + epVendT1 + `', '` + T1 + `', '` + idVendT1 + `', 'estoque'), ('` + epVendT2 + `', '` + T2 + `', '` + idVendT2 + `', 'estoque');
insert into acessos_perfis (id, nome, permissions) values ('` + perfilVendedora + `', 'Vendedora', '{"frota":["ver"]}');
insert into access_requests (id, name, email, message, created_at)
  values ('` + pedido1 + `', 'Fulana', 'fulana@x.com', 'quero entrar', '2026-10-10T12:00:00Z');
insert into push_subs (endpoint, p256dh, auth, user_id) values
  ('https://push.exemplo/viewer', 'kv', 'av', '` + idViewer + `'), ('https://push.exemplo/admin', 'ka', 'aa', '` + idAdmin + `');
insert into push_preferencias (user_id, tipo, ativo) values ('` + idViewer + `', 'vendas', true), ('` + idAdmin + `', 'vendas', false);
insert into data_integrity_checks (checked_date, account_id, check_name, status, detail) values
  ('2026-10-11', '` + A1 + `', 'coleta_zerada', 'fail', 'conta A1'),
  ('2026-10-11', '` + A2 + `', 'coleta_zerada', 'fail', 'conta A2'),
  ('2026-10-11', null, 'meta_spotcheck', 'warn', 'sem conta');
insert into ia_execucoes (run_at, robo, acao) values ('2026-10-10T10:00:00Z', 'panorama', 'antiga'), ('2026-10-11T10:00:00Z', 'panorama', 'nova');`

// fotoDoMundo: um hash das tabelas que o 5.1 escreve (e do rastro; bling_lojas entra porque o gatilho de
// renomear grupo grava nela). Fora de propósito: sessoes (Buscar renova a expiração a cada requisição).
// Igual antes e depois = nada mudou.
const fotoDoMundo = `select md5(string_agg(l, '|' order by l)) from (
  select 'profiles:' || t::text as l from profiles t union all
  select 'equipes:' || t::text from equipes t union all
  select 'equipes_membros:' || t::text from equipes_membros t union all
  select 'equipes_permissoes:' || t::text from equipes_permissoes t union all
  select 'canais_grupos:' || t::text from canais_grupos t union all
  select 'bling_lojas:' || t::text from bling_lojas t union all
  select 'canais_grupos_membros:' || t::text from canais_grupos_membros t union all
  select 'acessos_perfis:' || t::text from acessos_perfis t union all
  select 'access_requests:' || t::text from access_requests t union all
  select 'push_subs:' || t::text from push_subs t union all
  select 'push_preferencias:' || t::text from push_preferencias t union all
  select 'audit_log:' || t::text from audit_log t) z`

type mundo struct {
	*mundoteste.Mundo
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: o mundo do 5.1 sobre o mundoteste (Task 3 do 5.2): a fatia de produção, as pessoas e as
// linhas acima, uma sessão por pessoa (+ "impersonado": a sessão do admin aberta pelo super; as de
// "entrar como" num super-admin: impersonadoSuper = alvo super pela ficha, superImpersonado = alvo
// super por e-mail (breno@), entrando um super como outro super; + "semPerfil": usuário com sessão de
// painel e sem linha em profiles, que o mundoteste.Pessoa não expressa) e as rotas de `montar` atrás
// da mesma cadeia de autorização do grupo de domínio de web.Rotas: auth.Exigir → autz.ComEscopo. Sem o
// comPrazo, que só limita o tempo (montagem real: Task 11; Ruling 5.1-12).
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundo {
	t.Helper()
	ps := make([]mundoteste.Pessoa, len(pessoas))
	for i, x := range pessoas {
		ps[i] = mundoteste.Pessoa{Chave: x.chave, ID: x.id, Email: x.email, Papel: x.papel, Super: x.super, Trava: x.trava, Contas: x.contas}
	}
	w := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: ps, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{
			"impersonado":      {idAdmin, idSuper},
			"impersonadoSuper": {idSuperFicha, idSuper},
			"superImpersonado": {idSuper, idSuperFicha},
		}}, montar...)
	m := &mundo{Mundo: w, p: w.P, h: w.H, tok: w.Tok}
	if _, err := m.p.Exec(context.Background(), `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, idSemPerfil); err != nil {
		t.Fatal(err)
	}
	tok, err := auth.NovoStore(m.p).Criar(context.Background(), idSemPerfil, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["semPerfil"] = tok
	return m
}

// entrarComo abre uma sessão "entrar como" (`impersonador` entra na conta de `alvo`) e a guarda em m.tok[chave].
func (m *mundo) entrarComo(t *testing.T, chave, alvo, impersonador string) {
	t.Helper()
	tok, err := auth.NovoStore(m.p).Criar(context.Background(), alvo, "painel", &impersonador)
	if err != nil {
		t.Fatal(err)
	}
	m.tok[chave] = tok
}

func (m *mundo) resposta(t testing.TB, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	return m.Resposta(t, quem, metodo, caminho, corpo)
}

func (m *mundo) pedir(t testing.TB, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	return m.Pedir(t, quem, metodo, caminho, corpo)
}

func (m *mundo) um(t testing.TB, sql string, args ...any) string {
	t.Helper()
	return m.Um(t, sql, args...)
}

// caso: uma requisição e o que tem de sair dela (o mundoteste.Caso com os nomes do 5.1).
type caso struct {
	nome, quem, metodo, caminho, corpo string
	status                             int
	tem, naoTem                        string
	efeito, quer                       string
}

func (m *mundo) rodar(t testing.TB, casos []caso) {
	t.Helper()
	cs := make([]mundoteste.Caso, len(casos))
	for i, c := range casos {
		cs[i] = mundoteste.Caso{Nome: c.nome, Quem: c.quem, Metodo: c.metodo, Caminho: c.caminho, Corpo: c.corpo,
			Status: c.status, Tem: c.tem, NaoTem: c.naoTem, Efeito: c.efeito, Quer: c.quer}
	}
	m.Rodar(t, cs)
}

// gravaErros troca o testing.T para o teste do `rodar` ver o que ele reprova.
type gravaErros struct {
	testing.TB
	erros []string
}

func (g *gravaErros) Helper()                   {}
func (g *gravaErros) Errorf(f string, a ...any) { g.erros = append(g.erros, fmt.Sprintf(f, a...)) }
func (g *gravaErros) Fatalf(f string, a ...any) { panic(fmt.Sprintf(f, a...)) }

// O `rodar` não pode falhar calado: cada campo do caso (status, tem, naoTem, efeito) tem de reprovar
// quando diverge (um `naoTem` ou `efeito` quebrado deixaria passar qualquer regressão dos domínios).
func TestRodarReprovaDivergencias(t *testing.T) {
	m := novoMundo(t, montarGrupos)
	g := &gravaErros{TB: t}
	pede := caso{quem: "vendT1", metodo: "GET", caminho: "/equipes/grupos", status: 200, tem: `"nome":"Varejo"`}
	m.rodar(g, []caso{pede})
	if len(g.erros) != 0 {
		t.Fatalf("o caso correto foi reprovado: %v", g.erros)
	}
	for nome, c := range map[string]caso{
		"status": {quem: "vendT1", metodo: "GET", caminho: "/equipes/grupos", status: 201},
		"tem":    {quem: "vendT1", metodo: "GET", caminho: "/equipes/grupos", status: 200, tem: "nunca-aparece"},
		"naoTem": {quem: "vendT1", metodo: "GET", caminho: "/equipes/grupos", status: 200, naoTem: `"nome":"Varejo"`},
		"efeito": {efeito: contaGrupos(), quer: "99"},
		"sessão": {quem: "", metodo: "GET", caminho: "/equipes/grupos", status: 200},
	} {
		g.erros = nil
		m.rodar(g, []caso{c})
		if len(g.erros) == 0 {
			t.Errorf("o campo %s divergiu e o rodar não reprovou", nome)
		}
	}
}
