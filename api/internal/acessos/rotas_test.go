package acessos

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Um pedido de escrita por rota de Montar e o status de quem NÃO tem Colaboradores e Acessos: criar =
// 403, linha existente = 404. Rota de escrita nova sem entrada aqui faz as varreduras falharem.
type escrita struct {
	id, corpo string
	status    int
}

var escritas = map[string]escrita{
	"POST /acessos/pessoas":             {"", `{"nome":"Intruso"}`, 403},
	"PATCH /acessos/pessoas/{id}":       {P1, `{"cargo":"x"}`, 404},
	"DELETE /acessos/pessoas/{id}":      {P1, ``, 404},
	"POST /acessos/pessoas/{id}/ligar":  {P3, `{"profile_id":"` + idViewer + `"}`, 404},
	"POST /acessos/log":                 {"", `{"acao":"x"}`, 403},
	"POST /acessos/organizacoes":        {"", `{"nome":"Intrusa"}`, 403},
	"DELETE /acessos/organizacoes/{id}": {O1, ``, 404},
	"POST /acessos/setores":             {"", `{"nome":"Intruso"}`, 403},
	"DELETE /acessos/setores/{id}":      {S1, ``, 404},
	"POST /acessos/vinculos":            {"", `{"recurso_id":"` + R1 + `","pessoa_id":"` + P3 + `","papel":"leitura","estado":"pendente"}`, 403},
	"POST /acessos/termos":              {"", `{"pessoa_id":"` + P3 + `","titulo":"x","arquivo_path":"` + P3 + `/x.pdf"}`, 403},
	"DELETE /acessos/termos/{id}":       {T1, ``, 404},
}

// varrer chama `f` para cada rota de Montar, com o caminho já preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			leituras++
			f(metodo, rota, rota, "")
			return nil
		}
		gravacoes++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
			return nil
		}
		f(metodo, rota, strings.ReplaceAll(rota, "{id}", e.id), e.corpo)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.4-5).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDosAcessos)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 12 {
		t.Errorf("escritas = %d, esperava 12 (rota de escrita nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if depois := m.Um(t, fotoDosAcessos); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Quem não tem Colaboradores e Acessos (super pela ficha, super por e-mail, só Frota, só Patrimônio,
// ninguém) não lê nem grava NADA, pelo handler real; a conta desativada (com a feature) nem passa da
// sessão: 401 em toda rota; banco intacto.
func TestNadaVazaParaQuemNaoTemAcessos(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDosAcessos)
	for _, quem := range semAcessos {
		l, g := varrer(t, m, func(metodo, rota, caminho, corpo string) {
			st, b := m.Pedir(t, quem, metodo, caminho, corpo)
			if metodo == http.MethodGet {
				if st != http.StatusOK || strings.TrimSpace(b) != "[]" {
					t.Errorf("%s GET %s = %d %s; esperava 200 []", quem, rota, st, b)
				}
				return
			}
			if quer := escritas[metodo+" "+rota].status; st != quer {
				t.Errorf("%s %s %s = %d %s; esperava %d", quem, metodo, rota, st, b, quer)
			}
		})
		if l != 6 || g != 12 {
			t.Errorf("rotas = %d leituras e %d escritas, esperava 6 e 12", l, g)
		}
	}
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if st, b := m.Pedir(t, "desativado", metodo, caminho, corpo); st != http.StatusUnauthorized {
			t.Errorf("desativado %s %s = %d %s; esperava 401", metodo, rota, st, b)
		}
	})
	if depois := m.Um(t, fotoDosAcessos); depois != antes {
		t.Error("quem não tem Colaboradores e Acessos mudou o banco")
	}
}

// Os segredos de acessos_conexoes (Plano 6) nunca saem por este pacote: a tabela está fora do catálogo
// (em produção: RLS sem policy), nenhuma declaração a lê, e nenhuma resposta nem linha de log de
// NENHUMA rota de Montar — de quem pode tudo, com corpos válidos e inválidos — traz um deles. Quando o
// Plano 6 montar o proxy aqui, esta varredura passa a cobri-lo sozinha.
func TestConexoesNuncaSaem(t *testing.T) {
	if _, err := autz.Producao.Filtro(&autz.Escopo{}, "acessos_conexoes", autz.Ler, "c"); err == nil {
		t.Fatal("acessos_conexoes entrou no catálogo: reveja o Ruling 5.4-11 antes de qualquer rota")
	}
	for nome, c := range map[string]dados.Consulta{
		"principal": {Tabela: "acessos_conexoes", Alias: "t", SQL: `select t.provedor from acessos_conexoes t`,
			OrdemPadrao: "t.provedor", Desempate: "t.provedor"},
		"embutida com marcador": {Tabela: "acessos_pessoas", Alias: "t", OrdemPadrao: "t.nome", Desempate: "t.id",
			SQL: `select t.id, (select c.refresh_token from acessos_conexoes c where c.provedor = 'zoho' and {ler:acessos_conexoes:c}) as x from acessos_pessoas t`},
		"embutida sem marcador": {Tabela: "acessos_pessoas", Alias: "t", OrdemPadrao: "t.nome", Desempate: "t.id",
			SQL: `select t.id, (select c.refresh_token from acessos_conexoes c where c.provedor = 'zoho') as x from acessos_pessoas t`},
	} {
		if err := c.Validar(autz.Producao); err == nil {
			t.Errorf("%s: Validar aceitou ler acessos_conexoes", nome)
		}
	}
	if err := (dados.Tabela{Nome: "acessos_conexoes", Resposta: "t.provedor"}).Validar(autz.Producao); err == nil {
		t.Error("Tabela aceitou gravar acessos_conexoes")
	}

	m := novoMundo(t, Montar)
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(anterior)
	for _, quem := range []string{"admin", "acessos", "impersonado"} {
		varrer(t, m, func(metodo, rota, caminho, corpo string) {
			for _, c := range []string{corpo, `{"lixo":`} { // o corpo do caso e um quebrado (caminho de erro)
				if _, b := m.Pedir(t, quem, metodo, caminho, c); strings.Contains(b, "SEGREDO") {
					t.Errorf("%s %s %s devolveu segredo: %s", quem, metodo, rota, b)
				}
			}
		})
	}
	if s := log.String(); strings.Contains(s, "SEGREDO") || strings.Contains(s, telefoneDaAna) {
		t.Errorf("segredo ou dado pessoal no log:\n%s", s)
	}
	if v := m.Um(t, `select count(*)::text from acessos_conexoes where client_secret like 'SEGREDO-%' and refresh_token like 'SEGREDO-%'`); v != "2" {
		t.Errorf("as conexões mudaram: %s", v)
	}
}
