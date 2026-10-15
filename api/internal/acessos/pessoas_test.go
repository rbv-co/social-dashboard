package acessos

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Nomes próprios deste arquivo (pes*): a Task 5 roda em paralelo em estrutura_test.go.
func pesContar(tabela string) string { return "select count(*)::text from " + tabela }

func pesCol(coluna, id string) string {
	return "select " + coluna + "::text from acessos_pessoas where id = '" + id + "'"
}

// pesNomes: os "nome" de uma lista JSON, NA ORDEM em que vieram.
func pesNomes(t *testing.T, corpo string) []string {
	t.Helper()
	var l []struct {
		Nome string `json:"nome"`
	}
	if err := json.Unmarshal([]byte(corpo), &l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, len(l))
	for i, x := range l {
		out[i] = x.Nome
	}
	return out
}

func TestPessoasLeitura(t *testing.T) {
	m := novoMundo(t, montarPessoas)
	// json_build_object devolve `{"nome" : "RH"}` (com espaços; JSON equivalente ao do brief)
	// a ordem do nome (padrão), com dado pessoal e o embutido do setor
	st, corpo := m.Pedir(t, "acessos", "GET", "/acessos/pessoas", "")
	if got := strings.Join(pesNomes(t, corpo), ","); st != 200 || got != "Ana Lima,Bruno Reis,Carla Dias" {
		t.Errorf("acessos vê %q (%d): %s", got, st, corpo)
	}
	casos := []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/acessos/pessoas", Status: 401},
		{Nome: "dado pessoal e setor embutido para quem pode", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas",
			Status: 200, Tem: `"numero_pessoal":"` + telefoneDaAna + `"`},
		{Nome: "setor embutido", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas", Status: 200, Tem: `"acessos_setores":{"nome" : "RH"}`},
		{Nome: "organização embutida", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas", Status: 200, Tem: `"acessos_organizacoes":{"nome" : "Sede Centro"}`},
		{Nome: "pessoa sem setor: embutido nulo", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas?status=desligado", Status: 200, Tem: `"acessos_setores":null`},
		// o embutido NÃO abre o que a regra da outra tabela nega: acessos não lê o Patrimônio
		{Nome: "marca embutida some para quem não lê o Patrimônio", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas",
			Status: 200, Tem: `"patrimonio_empresas":null`, NaoTem: "Vessel"},
		{Nome: "papel admin lê o Patrimônio: marca embutida", Quem: "admin", Metodo: "GET", Caminho: "/acessos/pessoas",
			Status: 200, Tem: `"patrimonio_empresas":{"nome" : "Vessel"}`},
		{Nome: "a conta desativada nem tem sessão", Quem: "desativado", Metodo: "GET", Caminho: "/acessos/pessoas", Status: 401},
		{Nome: "filtro por status", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas?status=desligado", Status: 200, Tem: "Bruno", NaoTem: "Ana"},
		{Nome: "filtro que não existe não vira filtro silencioso", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas?nome=Ana", Status: 400},
		{Nome: "ordem fora da lista", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/pessoas?ordem=email", Status: 400},
		{Nome: "entrar como lê com a regra do alvo", Quem: "impersonado", Metodo: "GET", Caminho: "/acessos/pessoas", Status: 200, Tem: "Ana Lima"},
	}
	// VAZAMENTO: quem não é is_acessos_admin() recebe lista vazia (nem nome, nem telefone)
	for _, q := range semAcessos {
		casos = append(casos, caso{Nome: "vazamento: " + q, Quem: q, Metodo: "GET", Caminho: "/acessos/pessoas",
			Status: 200, Tem: "[]", NaoTem: "Ana"})
		casos = append(casos, caso{Nome: "vazamento por filtro: " + q, Quem: q, Metodo: "GET", Caminho: "/acessos/pessoas?status=ativo&contar=1",
			Status: 200, Tem: "[]", NaoTem: telefoneDaAna})
	}
	m.Rodar(t, casos)
	if w := m.Resposta(t, "acessos", "GET", "/acessos/pessoas?status=ativo&contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "2" || len(pesNomes(t, w.Body.String())) != 1 {
		t.Errorf("X-Total-Count = %q, corpo %s; esperava 2 com 1 linha", w.Header().Get("X-Total-Count"), w.Body.String())
	}
	for _, q := range semAcessos {
		if w := m.Resposta(t, q, "GET", "/acessos/pessoas?contar=1", ""); w.Header().Get("X-Total-Count") != "0" {
			t.Errorf("%s: X-Total-Count = %q, esperava 0 (o total também não denuncia)", q, w.Header().Get("X-Total-Count"))
		}
	}
}

// As declarações passam pela gramática de produção, e trocar a regra do embutido por `true` é recusado
// na montagem (deve derruba): o embutido não pode abrir o que a regra da outra tabela nega.
func TestPessoasDeclaracaoRecusaEmbutidoSemRegra(t *testing.T) {
	if err := consultaPessoas.Validar(autz.Producao); err != nil {
		t.Fatalf("a consulta de pessoas não passa pela gramática: %v", err)
	}
	if err := tabelaPessoas.Validar(autz.Producao); err != nil {
		t.Fatal(err)
	}
	for _, marcador := range []string{"{ler:patrimonio_empresas:m}", "{ler:acessos_setores:s}", "{ler:acessos_organizacoes:o}"} {
		if !strings.Contains(consultaPessoas.SQL, marcador) {
			t.Fatalf("a consulta perdeu %s", marcador)
		}
		c := consultaPessoas
		c.SQL = strings.Replace(c.SQL, marcador, "true", 1)
		if err := c.Validar(autz.Producao); err == nil {
			t.Errorf("a gramática aceitou o embutido sem %s", marcador)
		}
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("deve não derrubou a montagem sem %s", marcador)
				}
			}()
			deve(c.Validar(autz.Producao))
		}()
	}
}

func TestPessoasCriar(t *testing.T) {
	m := novoMundo(t, montarPessoas)
	foto := m.Um(t, fotoDosAcessos)
	// negado/inválido: a foto das 14 tabelas (e do que cascata) não muda
	nada := func(nome, quem, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/acessos/pessoas", Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoDosAcessos, Quer: foto}
	}
	casos := []caso{
		nada("sem sessão", "", `{"nome":"X"}`, 401, ""),
		nada("sem nome", "acessos", `{"cargo":"x"}`, 400, "Nome é obrigatório"),
		nada("nome em branco", "acessos", `{"nome":"  "}`, 400, "Nome é obrigatório"),
		nada("status não é coluna do cadastro novo", "acessos", `{"nome":"X","status":"desligado"}`, 400, "corpo_invalido"),
		nada("id vem da rota", "acessos", `{"nome":"X","id":"`+P1+`"}`, 400, "corpo_invalido"),
		nada("criado_em vem do banco", "acessos", `{"nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, 400, "corpo_invalido"),
		nada("avatar é do Plano 6", "acessos", `{"nome":"X","avatar_url":"https://x"}`, 400, "corpo_invalido"),
		nada("tipo errado", "acessos", `{"nome":"X","setor_id":"nao-e-uuid"}`, 400, ""),
		nada("setor que não existe", "acessos", `{"nome":"X","setor_id":"a4200000-0000-4000-a000-000000000099"}`, 409, ""),
		nada("organização que não existe", "acessos", `{"nome":"X","organizacao_id":"a4100000-0000-4000-a000-000000000099"}`, 409, ""),
		nada("entrar como não cadastra", "impersonado", `{"nome":"Fulano"}`, 403, "Quem entrou como outra pessoa"),
		nada("a conta desativada nem tem sessão", "desativado", `{"nome":"Fulano"}`, 401, ""),
	}
	for _, q := range semAcessos {
		casos = append(casos, nada("sem acessos não cadastra: "+q, q, `{"nome":"Fulano"}`, 403, ""))
		// o setor que existe e o que não existe respondem igual (sem oráculo)
		casos = append(casos, nada("sem oráculo de setor: "+q, q, `{"nome":"Fulano","setor_id":"`+S1+`"}`, 403, ""))
	}
	m.Rodar(t, casos)
	if n := m.Um(t, pesContar("acessos_pessoas")); n != "3" {
		t.Fatalf("as recusas gravaram: %s pessoas", n)
	}

	m.Rodar(t, []caso{
		{Nome: "acessos cadastra: nasce ativo, sem login", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/pessoas",
			Corpo: `{"nome":"Diego","email_corporativo":"diego@rbv.com","setor_id":"` + S1 + `"}`, Status: 201,
			Tem: `"status":"ativo"`, Efeito: pesContar("acessos_pessoas"), Quer: "4"},
		{Nome: "o login nulo", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/pessoas", Corpo: `{"nome":"Diogo"}`, Status: 201,
			Tem: `"profile_id":null`, Efeito: pesContar("acessos_pessoas"), Quer: "5"},
		{Nome: "admin cadastra já ligada ao login (Admin, criar cadastro)", Quem: "admin", Metodo: "POST", Caminho: "/acessos/pessoas",
			Corpo: `{"nome":"Eva","email_corporativo":"eva@x.com","profile_id":"` + idViewer + `"}`, Status: 201,
			Tem: `"profile_id":"` + idViewer + `"`, Efeito: pesContar("acessos_pessoas"), Quer: "6"},
		{Nome: "a ficha de Diego tem o setor e o telefone gravados", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/pessoas",
			Corpo: `{"nome":"Fábio","numero_pessoal":"11 98888-0000","data_inicio_contrato":"2026-10-01","atualizado_em":"2026-10-12T10:00:00Z"}`, Status: 201,
			Tem: `"numero_pessoal":"11 98888-0000"`, Efeito: "select data_inicio_contrato::text from acessos_pessoas where nome = 'Fábio'", Quer: "2026-10-01"},
	})
	// o login que a Eva recebeu liga a ficha: o Escopo passa a ver 1 ficha nova para o viewer
	if e, err := autz.CarregarEscopo(t.Context(), m.P, idViewer); err != nil || len(e.Pessoas) != 1 {
		t.Errorf("Escopo.Pessoas do viewer = %v (%v), esperava 1 ficha", e.Pessoas, err)
	}
}

func TestPessoasEditar(t *testing.T) {
	m := novoMundo(t, montarPessoas)
	u := func(id string) string { return "/acessos/pessoas/" + id }
	foto := m.Um(t, fotoDosAcessos)
	ana := m.Um(t, `select t::text from acessos_pessoas t where id = '`+P1+`'`)
	intacta := func(nome, quem, id, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "PATCH", Caminho: u(id), Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoDosAcessos, Quer: foto}
	}
	casos := []caso{
		intacta("sem sessão", "", P1, `{"cargo":"x"}`, 401, ""),
		intacta("id inexistente é 404 igual", "acessos", "a4400000-0000-4000-a000-000000000099", `{"cargo":"x"}`, 404, ""),
		intacta("id malformado é 404", "acessos", "nao-e-uuid", `{"cargo":"x"}`, 404, ""),
		intacta("status fora da lista", "acessos", P1, `{"status":"inativo"}`, 400, ""),
		intacta("nome nulo", "acessos", P1, `{"nome":null}`, 400, "Nome é obrigatório"),
		intacta("nome em branco", "acessos", P1, `{"nome":" "}`, 400, "Nome é obrigatório"),
		intacta("o elo com o login é do POST …/ligar", "acessos", P3, `{"profile_id":"`+idViewer+`"}`, 400, "corpo_invalido"),
		intacta("foto: javascript: não entra no <img>", "acessos", P1, `{"avatar_url":"javascript:alert(1)"}`, 400, "http(s)"),
		intacta("foto: host qualquer com outro caminho (pixel de rastreio)", "acessos", P1, `{"avatar_url":"https://rastreador.exemplo/pixel.png"}`, 400, "http(s)"),
		intacta("foto: caminho do bucket de termos, não o de fotos", "acessos", P1, `{"avatar_url":"https://x.com/storage/v1/object/public/acessos-termos/a.png"}`, 400, "http(s)"),
		intacta("foto: caminho relativo", "acessos", P1, `{"avatar_url":"/storage/a.png"}`, 400, "http(s)"),
		intacta("foto: data:", "acessos", P1, `{"avatar_url":"data:image/png;base64,AAAA"}`, 400, "http(s)"),
		intacta("foto: não é texto", "acessos", P1, `{"avatar_url":123}`, 400, "http(s)"),
		intacta("foto: grande demais", "acessos", P1, `{"avatar_url":"https://x.com/`+strings.Repeat("a", 2048)+`"}`, 400, "http(s)"),
		intacta("id não muda", "acessos", P1, `{"id":"`+P3+`"}`, 400, "corpo_invalido"),
		intacta("criado_em não muda", "acessos", P1, `{"criado_em":"2020-01-01T00:00:00Z"}`, 400, "corpo_invalido"),
		intacta("tipo errado", "acessos", P1, `{"setor_id":"nao-e-uuid"}`, 400, ""),
		intacta("setor que não existe", "acessos", P1, `{"setor_id":"a4200000-0000-4000-a000-000000000099"}`, 409, ""),
		intacta("marca que não existe", "admin", P1, `{"marca_id":"a4300000-0000-4000-a000-000000000099"}`, 409, ""),
		intacta("entrar como não edita", "impersonado", P1, `{"cargo":"x"}`, 403, "Quem entrou como outra pessoa"),
		intacta("a conta desativada nem tem sessão", "desativado", P1, `{"cargo":"x"}`, 401, ""),
	}
	// IDOR: quem não pode ler a ficha recebe o mesmo 404 do id inexistente, com o corpo igual
	for _, q := range semAcessos {
		casos = append(casos, intacta("IDOR: "+q, q, P1, `{"cargo":"x"}`, 404, ""))
	}
	m.Rodar(t, casos)
	_, existente := m.Pedir(t, "viewer", "PATCH", u(P1), `{"cargo":"x"}`)
	_, inexistente := m.Pedir(t, "viewer", "PATCH", u("a4400000-0000-4000-a000-000000000099"), `{"cargo":"x"}`)
	if existente != inexistente {
		t.Errorf("a ficha que existe responde diferente da que não existe: %s vs %s", existente, inexistente)
	}
	if m.Um(t, `select t::text from acessos_pessoas t where id = '`+P1+`'`) != ana {
		t.Fatal("as recusas alteraram a Ana")
	}

	m.Rodar(t, []caso{
		{Nome: "e-mail do OneDrive: só essas mudam", Quem: "acessos", Metodo: "PATCH", Caminho: u(P1),
			Corpo: `{"email_outlook":"ana@outlook.com","atualizado_em":"2026-10-12T10:00:00Z"}`, Status: 200,
			Tem: `"email_outlook":"ana@outlook.com"`, Efeito: `select concat_ws('|', email_outlook, cargo, numero_pessoal, nome, setor_id, atualizado_em at time zone 'utc') from acessos_pessoas where id = '` + P1 + `'`,
			Quer: "ana@outlook.com|" + m.Um(t, `select concat_ws('|', cargo, numero_pessoal, nome, setor_id) from acessos_pessoas where id = '`+P1+`'`) + "|2026-10-12 10:00:00"},
		{Nome: "desligar", Quem: "acessos", Metodo: "PATCH", Caminho: u(P3),
			Corpo: `{"status":"desligado","motivo_saida":"Fim do contrato","data_fim_contrato":"2026-10-12"}`, Status: 200,
			Tem: `"status":"desligado"`, Efeito: `select concat_ws('|', status, motivo_saida, data_fim_contrato) from acessos_pessoas where id = '` + P3 + `'`,
			Quer: "desligado|Fim do contrato|2026-10-12"},
		{Nome: "reativar limpa os dois", Quem: "acessos", Metodo: "PATCH", Caminho: u(P3),
			Corpo: `{"status":"ativo","motivo_saida":null,"data_fim_contrato":null}`, Status: 200,
			Tem: `"motivo_saida":null`, Efeito: `select concat_ws('|', status, coalesce(motivo_saida, 'N'), coalesce(data_fim_contrato::text, 'N')) from acessos_pessoas where id = '` + P3 + `'`,
			Quer: "ativo|N|N"},
		{Nome: "campo único (a tela do Zoho)", Quem: "acessos", Metodo: "PATCH", Caminho: u(P1), Corpo: `{"zoho_account_id":"z-1"}`, Status: 200,
			Efeito: pesCol("zoho_account_id", P1), Quer: "z-1"},
		{Nome: "lotação do Admin (marca)", Quem: "admin", Metodo: "PATCH", Caminho: u(P3), Corpo: `{"marca_id":"` + EMP + `","setor_id":"` + S1 + `"}`, Status: 200,
			Tem: `"marca_id":"` + EMP + `"`, Efeito: pesCol("marca_id", P3), Quer: EMP},
		{Nome: "foto: a tela grava a URL e a data", Quem: "acessos", Metodo: "PATCH", Caminho: u(P1),
			Corpo: `{"avatar_url":"https://x.com/storage/v1/object/public/acessos-avatars/` + P1 + `.png?v=1","atualizado_em":"2026-10-14T10:00:00Z"}`, Status: 200,
			Tem: `"avatar_url":"https://x.com/storage/v1/object/public/acessos-avatars/` + P1 + `.png?v=1"`, Efeito: pesCol("avatar_url", P1),
			Quer: "https://x.com/storage/v1/object/public/acessos-avatars/" + P1 + ".png?v=1"},
		{Nome: "foto: null remove", Quem: "admin", Metodo: "PATCH", Caminho: u(P1), Corpo: `{"avatar_url":null}`, Status: 200,
			Tem: `"avatar_url":null`, Efeito: pesCol("avatar_url", P1), Quer: "<nulo>"},
		{Nome: "edição comum não mexe no elo com o login", Quem: "acessos", Metodo: "PATCH", Caminho: u(P2), Corpo: `{"cargo":"Motorista"}`, Status: 200,
			Efeito: pesCol("profile_id", P2), Quer: "<nulo>"},
	})
	// o elo da Ana com o login não saiu do lugar em nenhuma das edições acima
	if got := m.Um(t, pesCol("profile_id", P1)); got != idAcessos {
		t.Errorf("profile_id da Ana = %s, esperava %s", got, idAcessos)
	}
}

// pesDecide roda a função de PRODUÇÃO (is_acessos_admin(), is_patrimonio_admin()…) no banco como a
// pessoa `id` (auth.uid() = id), numa transação que se desfaz.
func pesDecide(t *testing.T, m *mundoteste.Mundo, id, expr string) bool {
	t.Helper()
	tx, err := m.P.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	if _, err := tx.Exec(t.Context(), `select set_config('app.usuario_id', $1::text, true)`, id); err != nil {
		t.Fatal(err)
	}
	var ok *bool
	if err := tx.QueryRow(t.Context(), `select `+expr).Scan(&ok); err != nil {
		t.Fatalf("%s: %v", expr, err)
	}
	return ok != nil && *ok
}

// A MATRIZ: o handler real contra as regras de produção, pessoa a pessoa. A decisão de ler/gravar
// acessos_pessoas é a de is_acessos_admin() (acessos_pessoas_rw); a do embutido da marca é a das
// policies de patrimonio_empresas (is_patrimonio_admin() em _rw, is_frota_admin() em _leitura_frota).
// As duas são calculadas PELO BANCO como a pessoa. Inclui duas pessoas que o mundo padrão não tem
// (acessos com Patrimônio, acessos com Frota) e quem entrou como outra pessoa (lê com a regra do
// ALVO, não grava).
func TestPessoasMatrizContraAsPoliticasDeProducao(t *testing.T) {
	m := novoMundo(t, montarPessoas)
	extras := map[string][]string{
		"acessosPatrimonio": {"a4000000-0000-4000-a000-0000000000a1", "acessos", "patrimonio"},
		"acessosFrota":      {"a4000000-0000-4000-a000-0000000000a2", "acessos", "frota"},
	}
	for chave, x := range extras {
		if _, err := m.P.Exec(t.Context(), `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x[0], chave+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := m.P.Exec(t.Context(), `insert into profiles (id, email, name, role, features) values ($1::uuid, $2::text, $3::text, 'viewer', $4::text[])`,
			x[0], chave+"@x.com", chave, x[1:]); err != nil {
			t.Fatal(err)
		}
		tok, err := auth.NovoStore(m.P).Criar(t.Context(), x[0], "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[chave] = tok
	}
	idDe := map[string]string{"impersonado": idAcessos} // quem entrou como outra pessoa vale o ALVO
	for _, p := range pessoas {
		idDe[p.Chave] = p.ID
	}
	for chave, x := range extras {
		idDe[chave] = x[0]
	}
	lerSim, lerNao, marcaSim, marcaNao := 0, 0, 0, 0
	for quem, id := range idDe {
		if quem == "desativado" {
			continue // nem sessão tem: 401, coberto em TestPessoasLeitura/Criar/Editar
		}
		le := pesDecide(t, m, id, "is_acessos_admin()")
		vemMarca := pesDecide(t, m, id, "is_acessos_admin() and (is_patrimonio_admin() or is_frota_admin())")

		// leitura: lista inteira ou vazia, nunca parcial; a marca embutida pela regra da outra tabela
		st, corpo := m.Pedir(t, quem, "GET", "/acessos/pessoas", "")
		var l []struct {
			Nome  string                 `json:"nome"`
			Marca *struct{ Nome string } `json:"patrimonio_empresas"`
		}
		if err := json.Unmarshal([]byte(corpo), &l); err != nil || st != 200 {
			t.Fatalf("%s: %d %s (%v)", quem, st, corpo, err)
		}
		// (os POST autorizados de outras pessoas desta mesma matriz já acrescentaram fichas)
		quer := "0"
		if le {
			quer = m.Um(t, pesContar("acessos_pessoas"))
		}
		if strconv.Itoa(len(l)) != quer {
			t.Errorf("%s: o handler devolveu %d fichas, a regra de produção (is_acessos_admin = %t) diz %s", quem, len(l), le, quer)
		}
		if !le {
			lerNao++
		} else {
			lerSim++
			achou := false
			for _, x := range l {
				if x.Nome == "Ana Lima" {
					achou = true
					if (x.Marca != nil) != vemMarca {
						t.Errorf("%s: marca embutida presente = %t, a regra de patrimonio_empresas diz %t", quem, x.Marca != nil, vemMarca)
					}
				}
			}
			if !achou {
				t.Errorf("%s: sem Ana na lista", quem)
			}
			if vemMarca {
				marcaSim++
			} else {
				marcaNao++
			}
		}

		// escrita: o portão é o WITH CHECK da mesma policy; quem entrou como outra pessoa é 403 sempre
		st, _ = m.Pedir(t, quem, "POST", "/acessos/pessoas", `{"nome":"Matriz `+quem+`"}`)
		querSt := 403
		if le && quem != "impersonado" {
			querSt = 201
		}
		if st != querSt {
			t.Errorf("%s: POST = %d, esperava %d (is_acessos_admin = %t)", quem, st, querSt, le)
		}
		st, _ = m.Pedir(t, quem, "PATCH", "/acessos/pessoas/"+P3, `{"cargo":"Matriz `+quem+`"}`)
		querSt = 404 // sem leitura a ficha "não existe" (IDOR)
		if le {
			querSt = 200
		}
		if quem == "impersonado" {
			querSt = 403
		}
		if st != querSt {
			t.Errorf("%s: PATCH = %d, esperava %d (is_acessos_admin = %t)", quem, st, querSt, le)
		}
	}
	// o mundo mostra os dois lados de cada regra (senão a matriz prova pouco)
	if lerSim < 4 || lerNao < 5 || marcaSim < 3 || marcaNao < 1 {
		t.Errorf("a matriz não cobre os dois lados: lê %d, não lê %d; marca sim %d, não %d", lerSim, lerNao, marcaSim, marcaNao)
	}
}
