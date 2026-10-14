package dados

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabela.Conferir (Plano 5.9): roda na MESMA transação que grava, depois do PodeX e antes do SQL; o erro dela
// desfaz tudo (inclusive o que ela mesma gravou) e vira 403/404/500 por ErroDeEscrita.
func TestTabelaConferir(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id uuid primary key default gen_random_uuid(), account_id text,
		  nome text not null default 'sem nome', apelido text, nivel int, criado_por text);
		create table coisa_log (id uuid, quem text);
		insert into coisa (id, account_id, nome) values ('`+coisaA1+`', 'A1', 'um'), ('`+coisaA2+`', 'A2', 'dois')`); err != nil {
		t.Fatal(err)
	}
	var chamadas []string
	tab := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id, t.nome, t.criado_por", Autor: "criado_por",
		Conferir: func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
			nome := ""
			if v, ok := campos["nome"].(json.RawMessage); ok {
				json.Unmarshal(v, &nome)
			}
			autor, _ := campos["criado_por"].(string)
			chamadas = append(chamadas, id+"|"+nome+"|"+autor+"|"+map[bool]string{true: "apagar", false: "gravar"}[campos == nil])
			// grava ANTES de recusar: se a transação não fosse a mesma, a linha ficaria
			if _, err := tx.Exec(ctx, `insert into coisa_log values (gen_random_uuid(), 'conferir')`); err != nil {
				return err
			}
			switch {
			case nome == "barrado" || (campos == nil && id == coisaA1):
				return autz.ErrNegado
			case nome == "sumido":
				return autz.ErrNaoEncontrado
			case nome == "explode":
				return errors.New("defeito da conferência")
			}
			return nil
		}}
	escopos := map[string]*autz.Escopo{
		"frota-a1": {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}},
		"so-a1":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}},
		"super":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true},
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(req.Context(), escopos[req.Header.Get("X-Quem")])))
		})
	})
	r.Post("/coisas", RotaCriar[corpoCoisa](p, cat, tab))
	r.Patch("/coisas/{id}", RotaEditar[corpoCoisa](p, cat, tab))
	r.Delete("/coisas/{id}", RotaApagar(p, cat, tab))
	um := func(sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	const foto = `select (select count(*) from coisa_log)::text || '|' || (select string_agg(id::text || ':' || nome, ',' order by id) from coisa)`
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		chamada                            string // a última chamada de Conferir; "" = não foi chamada
		muda                               bool
	}{
		{"criar passa e Conferir vê a autoria da sessão", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"tres"}`, 201, "|tres|" + quemEscreve + "|gravar", true},
		{"criar recusado: 403 e nada gravado (nem o log da conferência)", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"barrado"}`, 403, "|barrado|" + quemEscreve + "|gravar", false},
		{"criar com ErrNaoEncontrado: 404", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"sumido"}`, 404, "|sumido|" + quemEscreve + "|gravar", false},
		{"erro qualquer: 500 sem detalhe", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"explode"}`, 500, "|explode|" + quemEscreve + "|gravar", false},
		{"sem a regra de criar: o PodeCriar barra ANTES (Conferir não roda)", "so-a1", "POST", "/coisas", `{"account_id":"A1","nome":"x"}`, 403, "", false},
		{"editar passa com o id da linha", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"um!"}`, 200, coisaA1 + "|um!||gravar", true},
		{"editar recusado: 403 e intacta", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"barrado"}`, 403, coisaA1 + "|barrado||gravar", false},
		{"linha invisível: 404 do PodeEditar, Conferir não roda", "so-a1", "PATCH", "/coisas/" + coisaA2, `{"nome":"barrado"}`, 404, "", false},
		{"apagar recusado pela conferência: 403 e fica", "super", "DELETE", "/coisas/" + coisaA1, "", 403, coisaA1 + "|||apagar", false},
		{"apagar passa (campos nil)", "super", "DELETE", "/coisas/" + coisaA2, "", 204, coisaA2 + "|||apagar", true},
	} {
		chamadas = nil
		antes := um(foto)
		req := httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(c.corpo))
		req.Header.Set("X-Quem", c.quem)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		ultima := ""
		if len(chamadas) > 0 {
			ultima = chamadas[len(chamadas)-1]
		}
		if w.Code != c.status || ultima != c.chamada || len(chamadas) > 1 {
			t.Errorf("%s: %d %s; Conferir = %v, esperava %d e %q", c.nome, w.Code, w.Body, chamadas, c.status, c.chamada)
		}
		if mudou := um(foto) != antes; mudou != c.muda {
			t.Errorf("%s: o banco mudou = %t, esperava %t (%s → %s)", c.nome, mudou, c.muda, antes, um(foto))
		}
		if c.status == 500 && strings.Contains(w.Body.String(), "conferência") {
			t.Errorf("%s: o texto do erro interno vazou: %s", c.nome, w.Body)
		}
	}
}
