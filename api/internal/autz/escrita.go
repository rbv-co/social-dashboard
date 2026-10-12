package autz

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// ErrNaoEncontrado: a linha não existe OU quem pede não a lê. As duas respostas são iguais
// (404) de propósito: um id de outra loja/conta nunca confirma que existe (IDOR).
var ErrNaoEncontrado = errors.New("autz: não encontrado")

type chaveEscopo struct{}

func NoContexto(ctx context.Context, e *Escopo) context.Context {
	return context.WithValue(ctx, chaveEscopo{}, e)
}

// EscopoDo devolve o escopo que ComEscopo pôs no contexto (nil se a rota não passou por ele).
func EscopoDo(ctx context.Context) *Escopo {
	e, _ := ctx.Value(chaveEscopo{}).(*Escopo)
	return e
}

// ComEscopo carrega o Escopo de quem pede. Vem DEPOIS de auth.Exigir (que garante o ator).
func ComEscopo(b Banco) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a := auth.AtorDoContexto(r.Context())
			if a == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusUnauthorized)
				w.Write([]byte(`{"error":"nao_autenticado"}`))
				return
			}
			e, err := CarregarEscopo(r.Context(), b, a.ID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"erro_interno"}`))
				return
			}
			next.ServeHTTP(w, r.WithContext(NoContexto(r.Context(), e)))
		})
	}
}

// PodeCriar: a linha nova passa no WITH CHECK de insert (Criar).
func (c *Catalogo) PodeCriar(ctx context.Context, b Banco, e *Escopo, tab string, linha map[string]any) error {
	f, err := c.Filtro(e, tab, Criar, "autz_nova")
	if err != nil {
		return err
	}
	ok, err := Conferir(ctx, b, f, tab, linha)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNegado
	}
	return nil
}

// PodeEditar trava a linha `id` (for update) e confere: a linha antiga é lida e passa no USING
// de update (senão ErrNaoEncontrado/ErrNegado), e a linha NOVA (a antiga com `mudancas`) passa
// no WITH CHECK (mover uma linha para uma conta/loja que a pessoa não vê é negado). `tx` tem de
// ser a MESMA transação que grava (o lock vale até o commit).
func (c *Catalogo) PodeEditar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, mudancas map[string]any) error {
	fe, err := c.Filtro(e, tab, Editar, "autz_velha")
	if err != nil {
		return err
	}
	fn, err := c.Filtro(e, tab, EditarNova, "autz_nova")
	if err != nil {
		return err
	}
	j, err := json.Marshal(mudancas)
	if err != nil {
		return err
	}
	return c.conferirExistente(ctx, tx, e, tab, id, fe, `coalesce((select `+fn.SQL+` from jsonb_populate_record(null::`+
		pgx.Identifier{tab}.Sanitize()+`, to_jsonb(autz_velha) || @autz_mudancas::jsonb) as autz_nova), false)`,
		fn.Juntar(pgx.NamedArgs{"autz_mudancas": string(j)}))
}

// PodeApagar trava a linha `id` e confere Ler + USING de delete.
func (c *Catalogo) PodeApagar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string) error {
	fa, err := c.Filtro(e, tab, Apagar, "autz_velha")
	if err != nil {
		return err
	}
	return c.conferirExistente(ctx, tx, e, tab, id, fa, "true", nil)
}

func (c *Catalogo) conferirExistente(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, fop Filtro, extra string, extraArgs pgx.NamedArgs) error {
	fl, err := c.Filtro(e, tab, Ler, "autz_velha")
	if err != nil {
		return err
	}
	args := fop.Juntar(fl.Juntar(pgx.NamedArgs{"autz_id": id}))
	for k, v := range extraArgs {
		args[k] = v
	}
	var ler, pode bool
	err = tx.QueryRow(ctx, `select coalesce(`+fl.SQL+`, false), coalesce(`+fop.SQL+`, false) and `+extra+
		` from `+pgx.Identifier{tab}.Sanitize()+` as autz_velha where autz_velha.id::text = @autz_id::text for update`, args).Scan(&ler, &pode)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNaoEncontrado
	case err != nil:
		return err
	case !ler:
		return ErrNaoEncontrado
	case !pode:
		return ErrNegado
	}
	return nil
}
