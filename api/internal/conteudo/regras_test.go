package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// As regras pela cadeia real (auth.Exigir → autz.ComEscopo), pessoa a pessoa.
func TestMundoDoConteudo(t *testing.T) {
	m := novoMundo(t, func(r chi.Router, _ *pgxpool.Pool) {
		r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
			e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
			fmt.Fprintf(w, "%t|%t|%t|%s|%t", Conteudista(e), Aprovador(e), PedeIA(e), a.Tipo, autz.PodeVerConta(e, A2))
		})
	})
	quer := map[string]string{
		"conteudista": "true|false|true|painel|true", "conteudistaA1": "true|false|true|painel|false",
		"conteudistaNenhuma": "true|false|true|painel|false", "aprovador": "true|true|true|painel|true",
		"aprovadorA1": "true|true|true|painel|false", "soAprovar": "false|true|false|painel|true",
		"adminA1": "true|true|true|painel|true", "super": "true|true|true|painel|true",
		"chaveConteudo": "false|false|true|painel|true", "semModulo": "false|false|false|painel|true",
		"impersonado": "true|false|true|painel|false",
	}
	for quem, q := range quer {
		if st, b := m.Pedir(t, quem, "GET", "/eco", ""); st != 200 || b != q {
			t.Errorf("%s: %d %s, esperava %s", quem, st, b, q)
		}
	}
	for _, quem := range []string{"", "desativado"} {
		if st, _ := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusUnauthorized {
			t.Errorf("%q: %d, esperava 401", quem, st)
		}
	}
	if v := m.Um(t, `select count(*)::text from conteudo_pecas`); v != "7" {
		t.Errorf("peças = %s", v)
	}
}

// pecaVisivel e soLegivelAoCriar contra o banco: a mãe de outra conta, a inexistente e o id inválido
// respondem igual (sem oráculo); quem não lê a tabela não vê peça nenhuma.
func TestConferencias(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	como := func(id string, f func(tx pgx.Tx, e *autz.Escopo) error) error {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		return banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error { return f(tx, e) })
	}
	for _, c := range []struct {
		nome, quem, peca, conta string
		err                     error
	}{
		{"a própria conta", idConteudistaA1, P1, A1, nil},
		{"a peça de A2 para quem só vê A1", idConteudistaA1, P3, "", autz.ErrNaoEncontrado},
		{"a peça de A2 para quem vê todas", idConteudista, P3, A2, nil},
		{"admin vê qualquer conta", idAdminA1, P3, A2, nil},
		{"lista vazia não vê nada", idConteudistaNenhuma, P1, "", autz.ErrNaoEncontrado},
		{"só conteudo.aprovar não lê a tabela", idSoAprovar, P1, "", autz.ErrNaoEncontrado},
		{"o desativado não lê", idDesativado, P1, "", autz.ErrNaoEncontrado},
		{"inexistente", idConteudista, "a5930000-0000-4000-a000-0000000000ff", "", autz.ErrNaoEncontrado},
		{"id inválido", idConteudista, "1 or 1=1", "", autz.ErrNaoEncontrado},
	} {
		var conta string
		err := como(c.quem, func(tx pgx.Tx, e *autz.Escopo) (err error) {
			conta, err = pecaVisivel(ctx, tx, e, c.peca)
			return err
		})
		if !errors.Is(err, c.err) || conta != c.conta {
			t.Errorf("pecaVisivel %s: %q %v, esperava %q %v", c.nome, conta, err, c.conta, c.err)
		}
	}
	conferir := soLegivelAoCriar("conteudo_ideias")
	j := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, c := range []struct {
		nome, quem, id string
		campos         map[string]any
		err            error
	}{
		{"A1 cria em A1", idConteudistaA1, "", map[string]any{"account_id": j(`"` + A1 + `"`), "titulo": j(`"x"`)}, nil},
		{"A1 cria em A2", idConteudistaA1, "", map[string]any{"account_id": j(`"` + A2 + `"`), "titulo": j(`"x"`)}, autz.ErrNegado},
		{"A1 cria de todas as marcas (conta nula)", idConteudistaA1, "", map[string]any{"account_id": j(`null`), "titulo": j(`"x"`)}, nil},
		{"lista vazia cria em A1", idConteudistaNenhuma, "", map[string]any{"account_id": j(`"` + A1 + `"`)}, autz.ErrNegado},
		{"na edição não confere (o PodeEditar já confere a linha nova)", idConteudistaA1, I3, map[string]any{"account_id": j(`"` + A2 + `"`)}, nil},
	} {
		err := como(c.quem, func(tx pgx.Tx, e *autz.Escopo) error { return conferir(ctx, tx, e, c.id, c.campos) })
		if !errors.Is(err, c.err) {
			t.Errorf("soLegivelAoCriar %s: %v, esperava %v", c.nome, err, c.err)
		}
	}
}

func TestAjudantes(t *testing.T) {
	j := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, c := range []struct {
		nome string
		ok   bool
	}{
		{"comoTexto recusa null", func() bool { _, ok := comoTexto(j(`null`)); return !ok }()},
		{"comoTexto recusa número", func() bool { _, ok := comoTexto(j(`5`)); return !ok }()},
		{"textoAte conta caracteres", textoAte(j(`"ção"`), 3, false)},
		{"textoAte recusa só espaço sem vazioPode", !textoAte(j(`"  "`), 10, false)},
		{"textoOuNulo aceita null", textoOuNulo(j(`null`), 1)},
		{"uuidOuNulo recusa maiúscula (o banco aceitaria; a tela manda minúscula)", !uuidOuNulo(j(`"A5900000-0000-4000-A000-0000000000A1"`))},
		{"instanteOuNulo aceita o toISOString", instanteOuNulo(j(`"2026-10-20T15:00:00.000Z"`))},
		{"instanteOuNulo recusa data sem hora", !instanteOuNulo(j(`"2026-10-20"`))},
		{"inteiroEntre recusa 1.5", !inteiroEntre(j(`1.5`), 0, 10)},
		{"booleano só true/false", booleano(j(`false`)) && !booleano(j(`"true"`))},
		{"textoEm", textoEm(j(`"feed"`), formatosDaPeca...) && !textoEm(j(`"tiktok"`), formatosDaPeca...)},
		{"bruto de coluna ausente é nil", bruto(map[string]any{}, "x") == nil},
		{"negado troca 404 por 403", errors.Is(negado(autz.ErrNaoEncontrado), autz.ErrNegado)},
	} {
		if !c.ok {
			t.Error(c.nome)
		}
	}
}
