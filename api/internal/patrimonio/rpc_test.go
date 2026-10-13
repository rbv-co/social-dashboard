package patrimonio

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// montarRPCs: a lista branca do 5.2 como web.Rotas a monta (POST /rpc/{nome} no grupo de domínio).
// Também é usado pela varredura da Task 10.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

// O portão do Go = a checagem de dentro da função de produção chamada como a pessoa: cada pessoa do
// mundo, mais uma desativada com tudo (Desativado do mundoteste) e uma só em usuarios (sem perfil).
func TestPortoesDoPatrimonioContraAsFuncoes(t *testing.T) {
	const semPerfil = "5e200000-0000-4000-a000-000000000098"
	todas := append(append([]mundoteste.Pessoa{}, pessoas...), mundoteste.Pessoa{Chave: "desativada", ID: "5e200000-0000-4000-a000-000000000099",
		Email: "des@x.com", Papel: "admin", Super: true, Desativado: true, Modulos: []string{"patrimonio", "frota", "acessos"}})
	m := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: todas, Linhas: linhasDoMundo})
	ctx := context.Background()
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, semPerfil); err != nil {
		t.Fatal(err)
	}
	quem := []string{semPerfil}
	for _, x := range todas {
		quem = append(quem, x.ID)
	}
	lados := map[string]map[bool]bool{"pessoa": {}, "carro": {}}
	for _, id := range quem {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		var pessoa, carro bool
		if err := banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select pode_cadastrar_pessoa_rapida(), is_frota_admin() or is_patrimonio_admin()`).Scan(&pessoa, &carro)
		}); err != nil {
			t.Fatal(err)
		}
		if autz.PodeCadastrarPessoaRapida(e) != pessoa || FrotaOuPatrimonio(e) != carro {
			t.Errorf("%s: Go %v/%v, produção %v/%v", id, autz.PodeCadastrarPessoaRapida(e), FrotaOuPatrimonio(e), pessoa, carro)
		}
		lados["pessoa"][pessoa], lados["carro"][carro] = true, true
	}
	for nome, l := range lados {
		if !l[true] || !l[false] {
			t.Errorf("o mundo não mostra os dois lados do portão %s", nome)
		}
	}
}

func TestRPCsDoPatrimonio(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	pessoasN, setoresN, carrosN := contar("acessos_pessoas"), contar("acessos_setores"), contar("frota_veiculos")
	nomeNova := "select count(*)::text from acessos_pessoas where lower(btrim(nome)) = 'nova pessoa'"
	carroXYZ := "select count(*)::text from frota_veiculos where placa = 'XYZ9A88'"
	const frasePessoa, fraseSetor, fraseBemDoT1 = "Digite o nome antes de criar.", "Digite o nome antes de criar.", "Cadeira da Tivoli"
	rpcURL := func(n string) string { return "/rpc/" + n }
	igual := func(nome, sql string) func() {
		antes := m.Um(t, sql)
		return func() {
			t.Helper()
			if depois := m.Um(t, sql); depois != antes {
				t.Errorf("%s: %q mudou de %s para %s", nome, sql, antes, depois)
			}
		}
	}

	// as listas de escolha: leem, ficam abertas a quem entrou como; o viewer leva 403 sem lista
	for _, quem := range []string{"frota", "acessos", "superFicha", "patT1"} {
		m.Rodar(t, []caso{{Nome: "pessoas_para_escolher " + quem, Quem: quem, Metodo: "POST", Caminho: rpcURL("pessoas_para_escolher"),
			Status: http.StatusOK, Tem: "Pessoa da T1"}})
		if _, corpo := m.Pedir(t, quem, "POST", rpcURL("pessoas_para_escolher"), ""); !strings.Contains(corpo, "Motorista") {
			t.Errorf("pessoas_para_escolher %s: faltou o Motorista: %s", quem, corpo)
		}
	}
	m.Rodar(t, []caso{
		{Nome: "pessoas_para_escolher viewer", Quem: "viewer", Metodo: "POST", Caminho: rpcURL("pessoas_para_escolher"), Status: 403, NaoTem: "Motorista"},
		{Nome: "pessoas_para_escolher sem sessão", Quem: "", Metodo: "POST", Caminho: rpcURL("pessoas_para_escolher"), Status: 401},
		{Nome: "setores_para_escolher frota", Quem: "frota", Metodo: "POST", Caminho: rpcURL("setores_para_escolher"), Status: 200, Tem: "Administrativo"},
		{Nome: "setores_para_escolher viewer", Quem: "viewer", Metodo: "POST", Caminho: rpcURL("setores_para_escolher"), Status: 403, NaoTem: "Administrativo"},
		// quem entrou como outra pessoa só LÊ a lista (ver o que ela vê)
		{Nome: "pessoas_para_escolher impersonado", Quem: "impersonado", Metodo: "POST", Caminho: rpcURL("pessoas_para_escolher"), Status: 200, Tem: "Motorista"},
	})
	// a lista é a tabela inteira, sem a restrição do time (a função é SECURITY DEFINER): as duas pessoas
	if _, corpo := m.Pedir(t, "patT1", "POST", rpcURL("pessoas_para_escolher"), "{}"); !strings.HasPrefix(corpo, "[") ||
		strings.Count(corpo, `"id"`) != 2 {
		t.Errorf("pessoas_para_escolher: esperava uma lista com as 2 pessoas: %s", corpo)
	}

	// criar_pessoa_rapida
	pessoaNova := func(corpo string) (int, string) {
		return m.Pedir(t, "patT1", "POST", rpcURL("criar_pessoa_rapida"), corpo)
	}
	st, corpo := pessoaNova(`{"p_nome":"Nova Pessoa"}`)
	if st != 200 || !strings.Contains(corpo, `"ja_existia":false`) {
		t.Errorf("criar_pessoa_rapida: %d %s", st, corpo)
	}
	st, corpo = pessoaNova(`{"p_nome":"nova pessoa "}`)
	if st != 200 || !strings.Contains(corpo, `"ja_existia":true`) || m.Um(t, nomeNova) != "1" {
		t.Errorf("criar_pessoa_rapida repetida: %d %s (linhas %s)", st, corpo, m.Um(t, nomeNova))
	}
	igualPessoas := igual("pessoas", pessoasN)
	for _, c := range []struct {
		nome, quem, corpo, tem string
		st                     int
	}{
		{"nome em branco", "patT1", `{"p_nome":"   "}`, frasePessoa, 400},
		{"parâmetro desconhecido", "patT1", `{"p_nome":"X","p_email":"y"}`, "", 400},
		{"sem p_nome", "patT1", `{}`, "", 400},
		{"viewer", "viewer", `{"p_nome":"Outra Pessoa"}`, "", 403},
		{"impersonado", "impersonado", `{"p_nome":"Outra Pessoa"}`, "Quem entrou como outra pessoa", 403},
	} {
		st, corpo := m.Pedir(t, c.quem, "POST", rpcURL("criar_pessoa_rapida"), c.corpo)
		if st != c.st || !strings.Contains(corpo, c.tem) || (c.st == 400 && c.tem != "" && !strings.Contains(corpo, "regra_de_negocio")) {
			t.Errorf("criar_pessoa_rapida %s: %d %s; esperava %d com %q", c.nome, st, corpo, c.st, c.tem)
		}
		igualPessoas()
	}
	// o portão é o da função: frota e acessos podem; o viewer (e a sessão de outra pessoa) não
	for _, quem := range []string{"frota", "acessos"} {
		if st, corpo := m.Pedir(t, quem, "POST", rpcURL("criar_pessoa_rapida"), `{"p_nome":"Feita por `+quem+`"}`); st != 200 {
			t.Errorf("criar_pessoa_rapida %s: %d %s", quem, st, corpo)
		}
	}

	// criar_setor_rapido
	st, corpo = m.Pedir(t, "frota", "POST", rpcURL("criar_setor_rapido"), `{"p_nome":"Logística"}`)
	if st != 200 || !strings.Contains(corpo, `"ja_existia":false`) {
		t.Errorf("criar_setor_rapido: %d %s", st, corpo)
	}
	if st, corpo = m.Pedir(t, "frota", "POST", rpcURL("criar_setor_rapido"), `{"p_nome":" logística"}`); st != 200 || !strings.Contains(corpo, `"ja_existia":true`) {
		t.Errorf("criar_setor_rapido repetido: %d %s", st, corpo)
	}
	igualSetores := igual("setores", setoresN)
	for _, c := range []struct {
		nome, quem, corpo, tem string
		st                     int
	}{
		{"em branco", "frota", `{"p_nome":""}`, fraseSetor, 400},
		{"viewer", "viewer", `{"p_nome":"Compras"}`, "", 403},
		{"impersonado", "impersonado", `{"p_nome":"Compras"}`, "Quem entrou como outra pessoa", 403},
	} {
		if st, corpo := m.Pedir(t, c.quem, "POST", rpcURL("criar_setor_rapido"), c.corpo); st != c.st || !strings.Contains(corpo, c.tem) {
			t.Errorf("criar_setor_rapido %s: %d %s; esperava %d com %q", c.nome, st, corpo, c.st, c.tem)
		}
		igualSetores()
	}
	if got := m.Um(t, "select count(*)::text from acessos_setores where lower(nome) like 'log%'"); got != "1" {
		t.Errorf("criar_setor_rapido: esperava 1 setor Logística, há %s", got)
	}

	// sincronizar_carro_e_bem (jsonb: o texto sai com ": ", então procuramos o valor)
	sinc := func(quem, corpo string) (int, string) {
		return m.Pedir(t, quem, "POST", rpcURL("sincronizar_carro_e_bem"), corpo)
	}
	st, corpo = sinc("patGeral", `{"p_bem_id":"`+BV2+`","p_placa":"xyz-9a88","p_nome":"Kwid novo"}`)
	if st != 200 || !strings.Contains(corpo, "criou_carro") {
		t.Errorf("sincronizar criou_carro: %d %s", st, corpo)
	}
	if got := m.Um(t, "select bem_id::text from frota_veiculos where placa = 'XYZ9A88'"); got != BV2 {
		t.Errorf("carro XYZ9A88 ligado a %s, esperava %s", got, BV2)
	}
	if got := m.Um(t, col("patrimonio_bens", "situacao", BV2)); got != "em_uso" {
		t.Errorf("BV2 = %s, o gatilho devia pô-lo em_uso", got)
	}
	if st, corpo = sinc("patGeral", `{"p_bem_id":"`+BV2+`","p_placa":"xyz-9a88","p_nome":"Kwid novo"}`); st != 200 || !strings.Contains(corpo, "ja_ligados") {
		t.Errorf("sincronizar repetido: %d %s", st, corpo)
	}
	igualCarros := igual("carros", carrosN)
	for _, c := range []struct {
		nome, quem, corpo, tem string
		st                     int
	}{
		{"bem que não é veículo", "patGeral", `{"p_bem_id":"` + B1 + `","p_placa":"QQQ1Q11","p_nome":"x"}`, "não é um veículo", 400},
		// ACHADO (Ruling 5.2-6), paridade documentada: a frase leva o nome de um bem que a patT2 não vê
		{"patT2 lê o nome do bem do outro time na frase", "patT2", `{"p_etiqueta":1,"p_placa":"ZZZ1Z11","p_nome":"x"}`, fraseBemDoT1, 400},
		{"viewer", "viewer", `{"p_bem_id":"` + BV2 + `","p_placa":"WWW1W11","p_nome":"x"}`, "", 403},
		{"acessos não liga carro", "acessos", `{"p_etiqueta":11,"p_placa":"WWW1W11","p_nome":"x"}`, "", 403},
		{"impersonado", "impersonado", `{"p_etiqueta":11,"p_placa":"WWW1W11","p_nome":"x"}`, "Quem entrou como outra pessoa", 403},
	} {
		if st, corpo := sinc(c.quem, c.corpo); st != c.st || !strings.Contains(corpo, c.tem) {
			t.Errorf("sincronizar %s: %d %s; esperava %d com %q", c.nome, st, corpo, c.st, c.tem)
		}
		igualCarros()
	}
	if got := m.Um(t, "select count(*)::text from frota_veiculos where placa in ('QQQ1Q11','ZZZ1Z11','WWW1W11')"); got != "0" {
		t.Errorf("recusadas criaram carro: %s", got)
	}
	// frota (sem patrimônio) liga pelo número da etiqueta
	if st, corpo = sinc("frota", `{"p_etiqueta":11,"p_placa":"XYZ9A88"}`); st != 200 || !strings.Contains(corpo, "ja_ligados") {
		t.Errorf("sincronizar frota: %d %s", st, corpo)
	}
	if got := m.Um(t, carroXYZ); got != "1" {
		t.Errorf("XYZ9A88: %s carros", got)
	}
}
