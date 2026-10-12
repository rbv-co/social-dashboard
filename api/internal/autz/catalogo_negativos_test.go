package autz

import (
	"fmt"
	"strings"
	"testing"
)

func catalogoDe(t *testing.T, policies ...string) *Catalogo {
	t.Helper()
	c, err := Compilar([]byte("[" + strings.Join(policies, ",") + "]"))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// pol monta uma policy como o pg_policies a entrega: insert só tem WITH CHECK, as demais só USING.
func pol(tipo, cmd, papeis, expr string) string {
	if cmd == "insert" {
		return fmt.Sprintf(`{"tabela":"t","nome":"p","tipo":%q,"comando":%q,"papeis":%s,"using":null,"withCheck":%q}`, tipo, cmd, papeis, expr)
	}
	return fmt.Sprintf(`{"tabela":"t","nome":"p","tipo":%q,"comando":%q,"papeis":%s,"using":%q,"withCheck":null}`, tipo, cmd, papeis, expr)
}

func sqlDe(t *testing.T, c *Catalogo, e *Escopo, op Op) string {
	t.Helper()
	f, err := c.Filtro(e, "t", op, "v")
	if err != nil {
		t.Fatal(err)
	}
	return f.SQL
}

// Ruling 5: policy só de anon/service_role nunca vale para a API; auth.role()='service_role' nega.
func TestPolicySoDeAnonOuServiceRoleNaoLibera(t *testing.T) {
	e := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true}
	c := catalogoDe(t,
		pol("permissive", "all", `["anon"]`, "true"),
		pol("permissive", "all", `["service_role"]`, "true"),
		pol("permissive", "select", `["authenticated"]`, "(auth.role() = 'service_role'::text)"))
	for _, op := range []Op{Ler, Criar, Editar, EditarNova, Apagar} {
		if s := sqlDe(t, c, e, op); s != "false" {
			t.Errorf("%s = %q, esperava false", op, s)
		}
	}
	if !c.Tem("t") {
		t.Error("tabela com policies só de anon deve existir no catálogo (nega, não 'fora do catálogo')")
	}
}

// Sem permissiva = nega; restritiva só restringe; Editar/Apagar exigem também o Ler.
func TestPermissivaRestritivaELeituraDeEditar(t *testing.T) {
	e := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Modulos: []string{"frota"}}
	soRestritiva := catalogoDe(t, pol("restrictive", "all", `["authenticated"]`, "true"))
	if s := sqlDe(t, soRestritiva, e, Ler); s != "false" {
		t.Errorf("só restritiva = %q", s)
	}
	c := catalogoDe(t,
		pol("permissive", "update", `["authenticated"]`, "true"),
		pol("permissive", "delete", `["authenticated"]`, "true"),
		pol("restrictive", "update", `["authenticated"]`, "is_frota_admin()"))
	semFrota := &Escopo{ID: e.ID, TemPerfil: true, Ativo: true}
	for _, op := range []Op{Editar, Apagar} { // sem policy de select: o UPDATE/DELETE com WHERE lê a linha → nega
		if s := sqlDe(t, c, e, op); s != "false" {
			t.Errorf("%s sem policy de leitura = %q", op, s)
		}
	}
	if s := sqlDe(t, c, e, EditarNova); s != "true" {
		t.Errorf("editar-nova com frota = %q", s)
	}
	if s := sqlDe(t, c, semFrota, EditarNova); s != "false" {
		t.Errorf("editar-nova sem frota (restritiva) = %q", s)
	}
}

// Ruling 6: subconsulta em profiles exige conta ativa; admin/super desativado não passa em nada.
func TestContaDesativadaNaoPassaEmPoliticaQueLeProfiles(t *testing.T) {
	c := catalogoDe(t,
		pol("permissive", "select", `["authenticated"]`, "(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND ((p.role = 'admin'::text) OR p.is_superadmin))))"),
		pol("permissive", "insert", `["authenticated"]`, "COALESCE((SELECT profiles.is_superadmin FROM profiles WHERE (profiles.id = auth.uid())), false)"),
		pol("permissive", "delete", `["authenticated"]`, "pode_ver_vendas()"))
	id := "11111111-0000-4000-a000-000000000001"
	ativo := &Escopo{ID: id, TemPerfil: true, Ativo: true, Papel: "admin", SuperFicha: true}
	off := &Escopo{ID: id, TemPerfil: true, Ativo: false, Papel: "admin", SuperFicha: true}
	comum := &Escopo{ID: id, TemPerfil: true, Ativo: true, Papel: "viewer"}
	for _, op := range []Op{Ler, Criar} {
		if s := sqlDe(t, c, ativo, op); s != "true" {
			t.Errorf("ativo %s = %q", op, s)
		}
		if s := sqlDe(t, c, off, op); s != "false" {
			t.Errorf("desativado %s = %q", op, s)
		}
		if s := sqlDe(t, c, comum, op); s != "false" {
			t.Errorf("comum %s = %q", op, s)
		}
	}
	if s := sqlDe(t, c, off, Apagar); s != "false" {
		t.Errorf("desativado apagar = %q", s)
	}
}

// Negativos por loja/equipe/conta: quem tem trava de escopo só enxerga o que o escopo lista;
// sem nada na lista o filtro continua sendo uma condição (nunca "true") e a lista vai vazia (nunca nil).
func TestEscopoTravadoNaoViraTrue(t *testing.T) {
	c := catalogoDe(t,
		pol("permissive", "select", `["authenticated"]`, "pode_ver_canal(canal_id)"),
		pol("permissive", "insert", `["authenticated"]`, "pode_ver_equipe(equipe_id)"),
		pol("permissive", "update", `["authenticated"]`, "pode_ver_estoque(deposito_id)"))
	id := "11111111-0000-4000-a000-000000000001"
	travado := &Escopo{ID: id, TemPerfil: true, Ativo: true}
	f, err := c.Filtro(travado, "t", Ler, "v")
	if err != nil || f.SQL != `("v"."canal_id" = any(@autz_v_0_1::bigint[]))` {
		t.Fatalf("canal: %q %v", f.SQL, err)
	}
	if l, ok := f.Args["autz_v_0_1"].([]int64); !ok || l == nil || len(l) != 0 {
		t.Errorf("lista do escopo vazio = %#v", f.Args["autz_v_0_1"])
	}
	if s := sqlDe(t, c, travado, Criar); s != `("v"."equipe_id"::text = any(@autz_v_1_1::text[]))` {
		t.Errorf("equipe = %q", s)
	}
	desativado := &Escopo{ID: id, TemPerfil: true, Ativo: false, SemTrava: true, SuperFicha: true}
	for _, op := range []Op{Ler, Criar} {
		if s := sqlDe(t, c, desativado, op); s != "false" {
			t.Errorf("desativado %s = %q", op, s)
		}
	}
	livre := &Escopo{ID: id, TemPerfil: true, Ativo: true, SemTrava: true}
	if s := sqlDe(t, c, livre, Ler); s != "true" {
		t.Errorf("sem trava = %q", s)
	}
}

// Papel na equipe: só as equipes onde o papel casa entram na lista; papel diferente nega.
func TestPapelNaEquipe(t *testing.T) {
	c := catalogoDe(t, pol("permissive", "update", `["authenticated"]`, "tenho_papel_na_equipe(equipe_id, ARRAY['gestor'::text])"))
	// a política só de update não tem leitura: Editar sempre nega; o EditarNova mostra a lista
	id := "11111111-0000-4000-a000-000000000001"
	gestor := &Escopo{ID: id, TemPerfil: true, Ativo: true, Vinculos: map[string][]string{"E1": {"gestor"}, "E2": {"membro"}}}
	f, err := c.Filtro(gestor, "t", EditarNova, "v")
	if err != nil || f.SQL != `("v"."equipe_id"::text = any(@autz_v_3_1::text[]))` {
		t.Fatalf("%q %v", f.SQL, err)
	}
	if l := f.Args["autz_v_3_1"].([]string); len(l) != 1 || l[0] != "E1" {
		t.Errorf("equipes = %v", l)
	}
	membro := &Escopo{ID: id, TemPerfil: true, Ativo: true, Vinculos: map[string][]string{"E2": {"membro"}}}
	if s := sqlDe(t, c, membro, EditarNova); s != "false" {
		t.Errorf("membro = %q", s)
	}
}

// Portões de RPC: negativo por papel/módulo/conta desativada.
func TestPortoesDeRPC(t *testing.T) {
	id := "11111111-0000-4000-a000-000000000001"
	ativo := func(m ...string) *Escopo { return &Escopo{ID: id, TemPerfil: true, Ativo: true, Modulos: m} }
	off := &Escopo{ID: id, TemPerfil: true, Ativo: false, Papel: "admin", SuperFicha: true, Modulos: []string{"frota", "autenticidade", "atendimentos"}, Email: SuperAdminsPorEmail[0]}
	for nome, r := range map[string]Regra{"frota": FrotaAdmin, "acessos": AcessosAdmin, "patrimonio": PatrimonioAdmin,
		"vessel": VesselAdmin, "vendas": PodeVerVendas, "aprovar": PodeAprovarFrota, "atend": VesselAtendimentos,
		"atend-editar": VesselAtendimentosEditar, "email": SuperEmail, "pessoa-rapida": PodeCadastrarPessoaRapida} {
		if r(off) {
			t.Errorf("%s: conta desativada passou", nome)
		}
		if r(ativo()) {
			t.Errorf("%s: pessoa sem módulo passou", nome)
		}
	}
	if !FrotaAdmin(ativo("frota")) || FrotaAdmin(ativo("patrimonio")) || !PodeCadastrarPessoaRapida(ativo("patrimonio")) {
		t.Error("módulo frota/patrimonio")
	}
	if SuperEmail(&Escopo{Ativo: true, Email: "alguem@exemplo.com"}) {
		t.Error("e-mail fora da lista passou")
	}
	if _, err := VesselPode("outra", "ver"); err == nil {
		t.Error("ferramenta fora da lista")
	}
	r, _ := VesselPode("atendimentos", "editar")
	soVer := &Escopo{Ativo: true, Acoes: map[string][]string{"atendimentos": {"ver"}}}
	soEditar := &Escopo{Ativo: true, Acoes: map[string][]string{"atendimentos": {"editar"}}}
	pode := &Escopo{Ativo: true, Acoes: map[string][]string{"atendimentos": {"ver", "editar"}}}
	if r(soVer) || r(soEditar) || !r(pode) {
		t.Error("vessel_pode editar exige ver e editar")
	}
}

// Op fora do conjunto e tabela fora do catálogo negam com erro.
func TestOpEOTabelaDesconhecidasNegam(t *testing.T) {
	e := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, SuperFicha: true}
	if f, err := Producao.Filtro(e, "push_subs", Op(99), "v"); err == nil || !f.Nega() {
		t.Errorf("op 99: %q %v", f.SQL, err)
	}
	if f, err := Producao.Filtro(e, "robos_saude", Ler, "v"); err == nil || !f.Nega() {
		t.Errorf("view fora do catálogo: %q %v", f.SQL, err)
	}
}
