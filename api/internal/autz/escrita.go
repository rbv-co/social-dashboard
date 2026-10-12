package autz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// ErrNaoEncontrado: a linha não existe OU quem pede não a lê. As duas respostas são iguais
// (404) de propósito: um id de outra loja/conta nunca confirma que existe (IDOR).
var ErrNaoEncontrado = errors.New("autz: não encontrado")

// ErrDeclaracao: defeito da rota (linha de criação sem a coluna que a policy lê, chave que não é
// única): a rota responde 500, nunca 400.
var ErrDeclaracao = errors.New("autz: declaração inválida")

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
			erro := func(status int, codigo string) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(status)
				w.Write([]byte(`{"error":"` + codigo + `"}`))
			}
			a := auth.AtorDoContexto(r.Context())
			if a == nil {
				erro(http.StatusUnauthorized, "nao_autenticado")
				return
			}
			e, err := CarregarEscopo(r.Context(), b, a.ID)
			switch {
			case errors.Is(err, context.Canceled): // o cliente desistiu: não é defeito nosso (499, como o nginx)
				slog.Debug("autz: pedido cancelado ao carregar o escopo")
				erro(499, "requisicao_cancelada")
				return
			case errors.Is(err, context.DeadlineExceeded):
				erro(http.StatusGatewayTimeout, "prazo_esgotado")
				return
			case err != nil:
				slog.Error("autz: carregar o escopo", "erro", err.Error())
				erro(http.StatusInternalServerError, "erro_interno")
				return
			}
			next.ServeHTTP(w, r.WithContext(NoContexto(r.Context(), e)))
		})
	}
}

var reColunaDaRegra = regexp.MustCompile(`"autz_nova"\."([^"]+)"`)

// colunasDaLinhaNova: as colunas da linha nova que a regra lê (o SQL da regra as cita como
// "autz_nova"."coluna"), sem repetição.
func colunasDaLinhaNova(f Filtro) []string {
	var cols []string
	for _, m := range reColunaDaRegra.FindAllStringSubmatch(f.SQL, -1) {
		if !slices.Contains(cols, m[1]) {
			cols = append(cols, m[1])
		}
	}
	return cols
}

// semChaveParecida recusa chave de `linha` que só difere por caixa de uma coluna que a regra lê
// (`Account_id`): o Postgres a ignoraria na conferência (coluna inexistente) e a rota poderia
// gravar outra coisa. Chave que não casa com nenhuma coluna da regra é legítima (qualquer outra
// coluna da tabela) e passa.
func semChaveParecida(cols []string, linha map[string]any) error {
	for k := range linha {
		for _, c := range cols {
			if k != c && strings.EqualFold(k, c) {
				return fmt.Errorf("%w: a chave %q difere só na caixa da coluna %q", ErrDeclaracao, k, c)
			}
		}
	}
	return nil
}

// PodeCriar: a linha nova passa no WITH CHECK de insert (Criar). `linha` TEM de trazer toda
// coluna que a regra lê (pode ser nil/NULL, como na RLS de produção): coluna ausente viraria NULL
// e a regra poderia passar (pode_ver_conta(NULL) é verdadeiro) enquanto a rota grava outro
// valor/default. Ausência é defeito da rota: ErrDeclaracao (500).
func (c *Catalogo) PodeCriar(ctx context.Context, b Banco, e *Escopo, tab string, linha map[string]any) error {
	f, err := c.Filtro(e, tab, Criar, "autz_nova")
	if err != nil {
		return err
	}
	cols := colunasDaLinhaNova(f)
	for _, col := range cols {
		if _, ok := linha[col]; !ok {
			return fmt.Errorf("%w: a linha de criação de %s não traz a coluna %q, que a regra de Criar lê", ErrDeclaracao, tab, col)
		}
	}
	if err := semChaveParecida(cols, linha); err != nil {
		return err
	}
	if linha == nil {
		linha = map[string]any{}
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
// ser a MESMA transação que grava (o lock vale até o commit). Linha que a pessoa não lê = 404,
// sem travá-la e sem avaliar `mudancas` nela (nenhum erro de tipo denuncia que ela existe).
func (c *Catalogo) PodeEditar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, mudancas map[string]any) error {
	fe, err := c.Filtro(e, tab, Editar, "autz_velha")
	if err != nil {
		return err
	}
	fn, err := c.Filtro(e, tab, EditarNova, "autz_nova")
	if err != nil {
		return err
	}
	if err := semChaveParecida(colunasDaLinhaNova(fn), mudancas); err != nil {
		return err
	}
	if mudancas == nil {
		mudancas = map[string]any{} // json.Marshal(nil) dá "null", que o jsonb concatena como array
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

// conferirExistente: (1) trava a linha `id` SE a pessoa a lê (a regra de Ler está no WHERE do
// select que trava: linha alheia não é travada, e um for update nowait de outra transação não
// revela que ela existe); (2) confere a operação (USING e, em edição, o WITH CHECK da linha nova).
//
// O id é comparado com a coluna no tipo dela (o índice da chave primária serve; o Postgres infere o
// tipo do parâmetro). Um id que não converte (22xxx: "abc" numa chave uuid/inteira) é 404 como
// um id inexistente, e a leitura roda num savepoint para esse erro não abortar a transação. A
// chave tem de ser única: mais de uma linha é ErrDeclaracao (a rota/tabela está errada).
func (c *Catalogo) conferirExistente(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, fop Filtro, extra string, extraArgs pgx.NamedArgs) error {
	fl, err := c.Filtro(e, tab, Ler, "autz_velha")
	if err != nil {
		return err
	}
	nome := pgx.Identifier{tab}.Sanitize()
	if err := c.travar(ctx, tx, nome, id, fl); err != nil {
		return err
	}
	args := fop.Juntar(pgx.NamedArgs{"autz_id": id})
	for k, v := range extraArgs {
		args[k] = v
	}
	var pode bool
	err = tx.QueryRow(ctx, `select coalesce(`+fop.SQL+`, false) and `+extra+` from `+nome+` as autz_velha where autz_velha.id = @autz_id`, args).Scan(&pode)
	switch {
	case err != nil:
		return err
	case !pode:
		return ErrNegado
	}
	return nil
}

func (c *Catalogo) travar(ctx context.Context, tx pgx.Tx, tabela, id string, fl Filtro) error {
	sp, err := tx.Begin(ctx) // savepoint
	if err != nil {
		return err
	}
	rows, err := sp.Query(ctx, `select 1 from `+tabela+` as autz_velha where autz_velha.id = @autz_id and (`+fl.SQL+`) for update limit 2`,
		fl.Juntar(pgx.NamedArgs{"autz_id": id}))
	n := 0
	if err == nil {
		for rows.Next() {
			n++
		}
		err = rows.Err()
	}
	if err != nil {
		sp.Rollback(ctx)
		var pe *pgconn.PgError
		if errors.As(err, &pe) && strings.HasPrefix(pe.Code, "22") {
			return ErrNaoEncontrado // o id não é do tipo da chave: não existe
		}
		return err
	}
	if err := sp.Commit(ctx); err != nil {
		return err
	}
	switch {
	case n == 0:
		return ErrNaoEncontrado
	case n > 1:
		return fmt.Errorf("%w: %s.id não é único", ErrDeclaracao, tabela)
	}
	return nil
}
