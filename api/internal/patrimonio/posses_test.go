package patrimonio

import (
	"encoding/json"
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	bemInexistente = "b0000000-0000-4000-a000-000000000099"
	novaPosseDaT1  = `{"bem_id":"` + B1 + `","pessoa_id":"` + P1 + `","pessoa_nome":"Pessoa da T1","de":"2026-10-12"}`
)

// TestPosses: "a posse segue o bem". Quem lê o bem lê a posse dele; quem não vê o bem não lê, não cria
// (403 igual ao bem que nem existe) nem fecha (404 igual ao que não existe). Sessão de "entrar como" só lê.
func TestPosses(t *testing.T) {
	m := novoMundo(t, montarPosses)
	foto := m.Um(t, fotoDoMundo)
	intacto := func(nome string) caso {
		return caso{Nome: nome + ": nada mudou", Efeito: "select ((" + fotoDoMundo + ") = '" + foto + "')::text", Quer: "true"}
	}
	posses := contar("patrimonio_posse")

	for _, c := range []struct {
		nome, quem, caminho string
		quer                []string
	}{
		{"patT1 vê só as posses dos bens que vê (sem a PO2 do B2)", "patT1", "", []string{PO1, PO3}},
		{"patT1 pede o bem do outro time: nada", "patT1", "?bem_id=" + B2, []string{}},
		{"patT1 pede o bem dela", "patT1", "?bem_id=" + B1, []string{PO1}},
		{"patT2", "patT2", "", []string{PO2}},
		{"patGeral, só as abertas", "patGeral", "?aberta=true", []string{PO1, PO2}},
		{"patGeral, só as fechadas", "patGeral", "?aberta=false", []string{PO3}},
		{"patGeral, o período pela data de início", "patGeral", "?de_desde=2026-01-01&de_ate=2026-12-31&ordem=de.desc", []string{PO1, PO2}},
		{"patGeral, de_ate corta pelo início", "patGeral", "?de_ate=2025-12-31", []string{PO3}},
		// a PO3 vai de 2025-01-01 a 2025-12-31: o corte é pelo INÍCIO (de), não pelo fim (ate)
		{"patGeral, de_ate no meio da PO3: ainda entra (o início é anterior)", "patGeral", "?de_ate=2025-06-30", []string{PO3}},
		{"patGeral, de_desde no meio da PO3: não entra (o início é anterior)", "patGeral", "?de_desde=2025-06-30", []string{PO1, PO2}},
		{"frota não lê posse", "frota", "", []string{}},
		{"acessos não lê posse", "acessos", "", []string{}},
		{"viewer não lê posse", "viewer", "", []string{}},
		{"super pela ficha sem o módulo não lê posse", "superFicha", "", []string{}},
		{"quem entrou como a patGeral lê o que ela lê", "impersonado", "", []string{PO1, PO2, PO3}},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", "/patrimonio/posses"+c.caminho, "")
		if got := ids(t, corpo); st != http.StatusOK || !slices.Equal(got, c.quer) {
			t.Errorf("%s: %d %v, esperava %v (%s)", c.nome, st, got, c.quer, corpo)
		}
	}
	// a ordem: início mais recente primeiro (PO1 e PO2 de 2026, PO3 de 2025); a lista inteira, sem corte
	if _, corpo := m.Pedir(t, "patGeral", "GET", "/patrimonio/posses?ordem=de.asc", ""); strings.Index(corpo, PO3) > strings.Index(corpo, PO1) {
		t.Errorf("ordem=de.asc: a posse de 2025 devia vir antes: %s", corpo)
	}
	// o corpo do vazamento: nem o nome congelado nem o bem alheio aparecem para a patT1
	if _, corpo := m.Pedir(t, "patT1", "GET", "/patrimonio/posses", ""); strings.Contains(corpo, PO2) || strings.Contains(corpo, B2) {
		t.Errorf("a patT1 viu a posse do bem do outro time: %s", corpo)
	}

	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/patrimonio/posses", Status: http.StatusUnauthorized},
		{Nome: "aberta inválida", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/posses?aberta=sim", Status: http.StatusBadRequest},
		{Nome: "bem_id inválido", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/posses?bem_id=x", Status: http.StatusBadRequest},
		{Nome: "data inválida", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/posses?de_desde=ontem", Status: http.StatusBadRequest},
		{Nome: "filtro que a rota não declara", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/posses?pessoa_id=" + P1, Status: http.StatusBadRequest},
		{Nome: "ordem fora da lista", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/posses?ordem=pessoa_nome", Status: http.StatusBadRequest},
		intacto("leituras"),
	})

	// criar
	m.Rodar(t, []caso{
		{Nome: "posse do bem que vê", Quem: "patT1", Metodo: "POST", Caminho: "/patrimonio/posses", Corpo: novaPosseDaT1,
			Status: http.StatusCreated, Tem: `"pessoa_nome":"Pessoa da T1"`, NaoTem: `"error"`,
			Efeito: posses, Quer: "4"},
		{Nome: "posse com o fim, o motivo e o ate nulo, como a tela manda", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/posses",
			Corpo:  `{"bem_id":"` + B4 + `","pessoa_id":null,"pessoa_nome":null,"de":"2026-10-12","ate":null,"motivo":"conferência"}`,
			Status: http.StatusCreated, Tem: `"motivo":"conferência"`, Efeito: posses, Quer: "5"},
	})
	// as recusas: nada gravado (a foto do mundo depois das duas aprovadas é a nova referência)
	foto = m.Um(t, fotoDoMundo)
	for _, c := range []caso{
		{Nome: "bem do outro time: 403", Quem: "patT1", Corpo: `{"bem_id":"` + B2 + `","pessoa_id":"` + P1 + `","pessoa_nome":"Pessoa da T1","de":"2026-10-12"}`, Status: http.StatusForbidden},
		{Nome: "bem que não existe: 403 igual (sem oráculo)", Quem: "patT1", Corpo: `{"bem_id":"` + bemInexistente + `","pessoa_id":"` + P1 + `","pessoa_nome":"Pessoa da T1","de":"2026-10-12"}`, Status: http.StatusForbidden},
		{Nome: "pessoa que não existe, no bem que vê: 403 igual", Quem: "patT1", Corpo: `{"bem_id":"` + B1 + `","pessoa_id":"` + bemInexistente + `","de":"2026-10-12"}`, Status: http.StatusForbidden},
		{Nome: "bem que não existe, sem trava", Quem: "patGeral", Corpo: `{"bem_id":"` + bemInexistente + `","de":"2026-10-12"}`, Status: http.StatusForbidden},
		{Nome: "frota não cria", Quem: "frota", Corpo: novaPosseDaT1, Status: http.StatusForbidden},
		{Nome: "viewer não cria", Quem: "viewer", Corpo: novaPosseDaT1, Status: http.StatusForbidden},
		{Nome: "entrou como", Quem: "impersonado", Corpo: novaPosseDaT1, Status: http.StatusForbidden, Tem: dados.FraseEntrarComo},
		{Nome: "data inválida", Quem: "patGeral", Corpo: `{"bem_id":"` + B1 + `","de":"ontem"}`, Status: http.StatusBadRequest},
		{Nome: "sem o início", Quem: "patGeral", Corpo: `{"bem_id":"` + B1 + `","pessoa_nome":"x"}`, Status: http.StatusBadRequest},
		{Nome: "sem o bem", Quem: "patGeral", Corpo: `{"de":"2026-10-12"}`, Status: http.StatusBadRequest},
		{Nome: "id escolhido no corpo", Quem: "patGeral", Corpo: `{"id":"` + PO1 + `","bem_id":"` + B1 + `","de":"2026-10-12"}`, Status: http.StatusBadRequest},
		{Nome: "coluna que a rota não declara", Quem: "patGeral", Corpo: `{"bem_id":"` + B1 + `","de":"2026-10-12","criado_em":"2020-01-01"}`, Status: http.StatusBadRequest},
		{Nome: "corpo vazio", Quem: "patGeral", Corpo: `{}`, Status: http.StatusBadRequest},
		{Nome: "sem sessão", Quem: "", Corpo: novaPosseDaT1, Status: http.StatusUnauthorized},
	} {
		c.Metodo, c.Caminho = "POST", "/patrimonio/posses"
		c.Efeito, c.Quer = "select (("+fotoDoMundo+") = '"+foto+"')::text", "true"
		m.Rodar(t, []caso{c})
	}
	// o 403 do bem do outro time e o do bem que não existe são o MESMO corpo
	_, alheio := m.Pedir(t, "patT1", "POST", "/patrimonio/posses", `{"bem_id":"`+B2+`","de":"2026-10-12"}`)
	_, nenhum := m.Pedir(t, "patT1", "POST", "/patrimonio/posses", `{"bem_id":"`+bemInexistente+`","de":"2026-10-12"}`)
	if alheio != nenhum {
		t.Errorf("a recusa do bem alheio (%s) difere da do bem inexistente (%s)", alheio, nenhum)
	}

	// fechar
	m.Rodar(t, []caso{
		{Nome: "fecha a posse do bem que vê", Quem: "patT1", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO1, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusOK, Tem: `"ate":"2026-10-12"`, Efeito: col("patrimonio_posse", "ate", PO1), Quer: "2026-10-12"},
		{Nome: "posse do bem do outro time: 404, segue aberta", Quem: "patT1", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusNotFound, Efeito: col("patrimonio_posse", "ate", PO2), Quer: "<nulo>"},
		{Nome: "posse que não existe: 404 igual", Quem: "patT1", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + bemInexistente, Corpo: `{"ate":"2026-10-12"}`, Status: http.StatusNotFound},
		{Nome: "não troca o bem da posse", Quem: "patT1", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"bem_id":"` + B2 + `"}`,
			Status: http.StatusBadRequest, Tem: "corpo_invalido", Efeito: col("patrimonio_posse", "bem_id", PO3), Quer: B3},
		// o PATCH só FECHA: reescrever quem, o nome congelado, o início ou o motivo apagaria o histórico
		{Nome: "não troca a pessoa da posse", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"pessoa_id":"` + P2 + `"}`,
			Status: http.StatusBadRequest, Tem: "corpo_invalido", Efeito: col("patrimonio_posse", "pessoa_id", PO3), Quer: P1},
		{Nome: "não troca o nome congelado", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"pessoa_nome":"Outro"}`,
			Status: http.StatusBadRequest, Tem: "corpo_invalido", Efeito: col("patrimonio_posse", "pessoa_nome", PO3), Quer: "Pessoa da T1"},
		{Nome: "não muda o início", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"de":"2020-01-01"}`,
			Status: http.StatusBadRequest, Tem: "corpo_invalido", Efeito: col("patrimonio_posse", "de", PO3), Quer: "2025-01-01"},
		{Nome: "não muda o motivo", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"ate":"2025-12-31","motivo":"x"}`,
			Status: http.StatusBadRequest, Tem: "corpo_invalido", Efeito: col("patrimonio_posse", "motivo", PO3), Quer: "<nulo>"},
		{Nome: "data inválida", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"ontem"}`,
			Status: http.StatusBadRequest, Efeito: col("patrimonio_posse", "ate", PO2), Quer: "<nulo>"},
		{Nome: "corpo vazio", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{}`, Status: http.StatusBadRequest},
		{Nome: "viewer: 404 (não lê)", Quem: "viewer", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusNotFound, Efeito: col("patrimonio_posse", "ate", PO2), Quer: "<nulo>"},
		{Nome: "frota: 404 (não lê)", Quem: "frota", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-12"}`, Status: http.StatusNotFound},
		{Nome: "entrou como: 403, segue aberta", Quem: "impersonado", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusForbidden, Tem: dados.FraseEntrarComo, Efeito: col("patrimonio_posse", "ate", PO2), Quer: "<nulo>"},
		{Nome: "sem sessão", Quem: "", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-12"}`, Status: http.StatusUnauthorized},
		{Nome: "id que não é uuid: 404 igual ao que não existe", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/x", Corpo: `{"ate":"2026-10-12"}`, Status: http.StatusNotFound},
		{Nome: "patGeral fecha qualquer uma", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO2, Corpo: `{"ate":"2026-10-13"}`,
			Status: http.StatusOK, Efeito: col("patrimonio_posse", "ate", PO2), Quer: "2026-10-13"},
	})
	// sem DELETE: a posse some só junto do bem (FK em cascata)
	if st, _ := m.Pedir(t, "patGeral", "DELETE", "/patrimonio/posses/"+PO3, ""); st != http.StatusMethodNotAllowed && st != http.StatusNotFound {
		t.Errorf("DELETE /patrimonio/posses/{id} existe: %d", st)
	}
}

// A regra do BEM manda, não a da posse: quem vê o bem só "pela mão" (a pessoa do bem é ela) cria e lê a
// posse dele; quando o bem sai do alcance dela, a posse some da lista.
func TestPossesAPosseSegueOBemPelaMao(t *testing.T) {
	m := novoMundo(t, montarPosses)
	// B3 está em L3 (sem time) com a P1; a patT1 vê B3 pela mão, logo a PO3 (fechada) também
	m.Rodar(t, []caso{
		{Nome: "posse do bem que ela tem na mão", Quem: "patT1", Metodo: "POST", Caminho: "/patrimonio/posses",
			Corpo:  `{"bem_id":"` + B3 + `","pessoa_id":"` + P1 + `","pessoa_nome":"Pessoa da T1","de":"2026-10-12"}`,
			Status: http.StatusCreated, Efeito: contar("patrimonio_posse"), Quer: "4"},
		{Nome: "e a patT2 não vê esse bem", Quem: "patT2", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + PO3, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusNotFound, Efeito: col("patrimonio_posse", "ate", PO3), Quer: "2025-12-31"},
	})
	// o bem sai do alcance da patT1 (a pessoa muda no banco): a posse some da lista dela
	if _, err := m.P.Exec(t.Context(), `update patrimonio_bens set pessoa_id = null where id = $1`, B3); err != nil {
		t.Fatal(err)
	}
	if st, corpo := m.Pedir(t, "patT1", "GET", "/patrimonio/posses?bem_id="+B3, ""); st != http.StatusOK || corpo != "[]" {
		t.Errorf("posse de bem que saiu do alcance: %d %s", st, corpo)
	}
}

// Os gatilhos da fatia D0 que mexem em posse (frota_uso do tipo posse) ficam fora do caminho destas
// rotas: abrir e fechar a posse do Patrimônio de um bem ligado a carro NÃO fecha a posse do carro na
// frota; ela só fecha quando o carro fica sem responsável (o WHEN new.pessoa_id is null), o que o
// Patrimônio faz pelo bem (mesma transação, com a identidade de quem pede).
func TestPossesEOsGatilhosDaFrota(t *testing.T) {
	m := novoMundo(t, montarPosses)
	usoAberto := "select exists(select 1 from frota_uso where id = '" + U1 + "' and volta_em is null)::text"
	comoPatGeral := func(sql string, args ...any) {
		t.Helper()
		err := banco.ComUsuario(t.Context(), m.P, idPatGeral, func(tx pgx.Tx) error {
			_, err := tx.Exec(t.Context(), sql, args...)
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	st, corpo := m.Pedir(t, "patGeral", "POST", "/patrimonio/posses", `{"bem_id":"`+BV+`","pessoa_id":"`+P2+`","pessoa_nome":"Motorista","de":"2026-10-12"}`)
	var nova struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &nova); st != http.StatusCreated || err != nil || nova.ID == "" {
		t.Fatalf("abrir a posse do Kwid: %d %s (%v)", st, corpo, err)
	}
	m.Rodar(t, []caso{
		{Nome: "a posse do Kwid no Patrimônio abriu e a da frota segue aberta", Efeito: usoAberto, Quer: "true"},
		// a posse do KWID (a do 201), não a PO1 (do B1)
		{Nome: "fechá-la no Patrimônio não fecha a da frota", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/posses/" + nova.ID, Corpo: `{"ate":"2026-10-12"}`,
			Status: http.StatusOK, Efeito: col("patrimonio_posse", "ate", nova.ID), Quer: "2026-10-12"},
		{Nome: "e a posse da frota segue aberta", Efeito: usoAberto, Quer: "true"},
	})
	// o bem passa a ter outro responsável (o que a Task 4 faz pelo PATCH do bem): o carro acompanha e a
	// posse do carro CONTINUA aberta (o WHEN new.pessoa_id is null do gatilho)
	comoPatGeral(`update patrimonio_bens set pessoa_id = $1 where id = $2`, P1, BV)
	m.Rodar(t, []caso{
		{Nome: "responsável novo no bem: o carro acompanha", Efeito: col("frota_veiculos", "pessoa_id", V1), Quer: P1},
		{Nome: "responsável novo: a posse do carro segue aberta", Efeito: usoAberto, Quer: "true"},
	})
	// o bem sem responsável: o carro também, e a posse aberta do carro fecha
	comoPatGeral(`update patrimonio_bens set pessoa_id = null where id = $1`, BV)
	m.Rodar(t, []caso{
		{Nome: "bem sem responsável: o carro também", Efeito: col("frota_veiculos", "pessoa_id", V1), Quer: "<nulo>"},
		{Nome: "e a posse do carro fecha", Efeito: usoAberto, Quer: "false"},
		{Nome: "as posses do Patrimônio ficam como estão (3 do mundo + 1 aberta agora)", Efeito: contar("patrimonio_posse"), Quer: "4"},
	})
}

// Ruling 5.2-17: o pessoa_id da posse aponta para acessos_pessoas, cuja regra de Ler quem tem só
// patrimônio não satisfaz; pessoas_para_escolher() já lhe mostra todas as pessoas com id. Logo: pessoa
// existente de outro time = 201 (não se valida contra a regra de Ler: seria regressão); inexistente = 403
// do POST, com o MESMO corpo do bem alheio e do bem inexistente (a rota não ganha frase própria).
func TestPossesPessoaForaDaRegraDeLer(t *testing.T) {
	m := novoMundo(t, montarPosses)
	const caminho = "/patrimonio/posses"
	m.Rodar(t, []caso{
		{Nome: "patT1 põe na posse do bem dela uma pessoa que não lê (a P2 não é de time nenhum)", Quem: "patT1", Metodo: "POST", Caminho: caminho,
			Corpo:  `{"bem_id":"` + B1 + `","pessoa_id":"` + P2 + `","pessoa_nome":"Motorista","de":"2026-10-12"}`,
			Status: http.StatusCreated, Tem: `"pessoa_id":"` + P2 + `"`, Efeito: contar("patrimonio_posse"), Quer: "4"},
	})
	_, semPessoa := m.Pedir(t, "patT1", "POST", caminho, `{"bem_id":"`+B1+`","pessoa_id":"`+bemInexistente+`","de":"2026-10-12"}`)
	_, bemAlheio := m.Pedir(t, "patT1", "POST", caminho, `{"bem_id":"`+B2+`","de":"2026-10-12"}`)
	_, semBem := m.Pedir(t, "patT1", "POST", caminho, `{"bem_id":"`+bemInexistente+`","de":"2026-10-12"}`)
	if st, _ := m.Pedir(t, "patT1", "POST", caminho, `{"bem_id":"`+B1+`","pessoa_id":"`+bemInexistente+`","de":"2026-10-12"}`); st != http.StatusForbidden {
		t.Errorf("pessoa inexistente = %d, esperava 403", st)
	}
	if semPessoa != bemAlheio || semPessoa != semBem {
		t.Errorf("os 403 diferem: pessoa inexistente %s, bem alheio %s, bem inexistente %s", semPessoa, bemAlheio, semBem)
	}
	if got := m.Um(t, contar("patrimonio_posse")); got != "4" {
		t.Errorf("as recusas gravaram: %s posses", got)
	}
}
