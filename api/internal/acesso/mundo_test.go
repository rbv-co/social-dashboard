package acesso

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
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
	p   *pgxpool.Pool
	h   http.Handler
	tok map[string]string
}

// novoMundo: a fatia de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a sessão do admin aberta pelo super, e as de "entrar como" num super-admin; + "semPerfil": usuário com sessão de painel e sem linha em
// profiles) e as rotas de `montar` atrás da mesma cadeia de autorização do grupo de domínio de
// web.Rotas: auth.Exigir → autz.ComEscopo. Sem o comPrazo, que só limita o tempo (montagem real: Task 11;
// Ruling 5.1-12).
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &mundo{p: p, tok: map[string]string{}}
	for _, x := range pessoas {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x.id, x.email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, $7::uuid[])`,
			x.id, x.email, x.chave, x.papel, x.super, x.trava, x.contas); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.tok[x.chave] = tok
	}
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, idSemPerfil); err != nil {
		t.Fatal(err)
	}
	tokSP, err := s.Criar(ctx, idSemPerfil, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["semPerfil"] = tokSP
	m.entrarComo(t, "impersonado", idAdmin, idSuper)
	// o ALVO é super-admin: a regra do catálogo deixaria escrever, só o portão soSessaoPropria recusa.
	// impersonadoSuper = alvo super pela ficha; superImpersonado = alvo super por e-mail (breno@), entrando
	// um super como outro super.
	m.entrarComo(t, "impersonadoSuper", idSuperFicha, idSuper)
	m.entrarComo(t, "superImpersonado", idSuper, idSuperFicha)
	if _, err := p.Exec(ctx, linhasDoMundo); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Use(autz.ComEscopo(p))
		for _, f := range montar {
			f(r, p)
		}
	})
	m.h = r
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

// resposta faz a requisição como `quem` ("" = sem sessão).
func (m *mundo) resposta(t testing.TB, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if quem != "" {
		tok, ok := m.tok[quem]
		if !ok {
			t.Fatalf("pessoa %q fora do mundo", quem)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	m.h.ServeHTTP(w, r)
	return w
}

func (m *mundo) pedir(t testing.TB, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	w := m.resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String()
}

// um roda uma consulta de UMA coluna ::text (nulo = "<nulo>").
func (m *mundo) um(t testing.TB, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.p.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

// caso: uma requisição e o que tem de sair dela. efeito/quer: consulta rodada DEPOIS (o "negado não
// grava"); caso sem metodo só confere o efeito.
type caso struct {
	nome, quem, metodo, caminho, corpo string
	status                             int
	tem, naoTem                        string
	efeito, quer                       string
}

func (m *mundo) rodar(t testing.TB, casos []caso) {
	t.Helper()
	for _, c := range casos {
		if c.metodo != "" {
			st, corpo := m.pedir(t, c.quem, c.metodo, c.caminho, c.corpo)
			if st != c.status || (c.tem != "" && !strings.Contains(corpo, c.tem)) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
				t.Errorf("%s: %s %s como %q = %d %s; esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
			}
		}
		if c.efeito != "" {
			if v := m.um(t, c.efeito); v != c.quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.nome, c.efeito, v, c.quer)
			}
		}
	}
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
