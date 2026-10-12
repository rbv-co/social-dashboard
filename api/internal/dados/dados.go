// Package dados é o contrato HTTP das rotas de domínio (Plano 5): formato de erro, JSON
// montado pelo próprio Postgres (o mesmo serializador do PostgREST), corpo de escrita,
// paginação, ordenação e filtros declarados por rota. Nada aqui decide permissão: isso é
// do pacote autz.
package dados

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Consultor é o que Lista e Um precisam: *pgxpool.Pool e pgx.Tx servem.
type Consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Erro escreve {"error": codigo} e, se houver, "mensagem" (frase para a pessoa ler).
func Erro(w http.ResponseWriter, status int, codigo, mensagem string) {
	corpo := map[string]string{"error": codigo}
	if mensagem != "" {
		corpo["mensagem"] = mensagem
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// Query lê a query string INTEIRA ou falha. r.URL.Query() descarta em silêncio os pares
// malformados (`?loja=1;x=2`, `?loja=%zz`): o filtro simplesmente não seria aplicado e a pessoa
// receberia mais linhas do que pediu. Toda rota de domínio lê a query por aqui.
func Query(r *http.Request) (url.Values, error) {
	q, err := url.ParseQuery(r.URL.RawQuery)
	if err != nil {
		return nil, errors.New("a query string está malformada")
	}
	return q, nil
}

// LerQuery é Query com a resposta pronta: 400 parametro_invalido e false se a query não presta.
func LerQuery(w http.ResponseWriter, r *http.Request) (url.Values, bool) {
	q, err := Query(r)
	if err != nil {
		Erro(w, http.StatusBadRequest, "parametro_invalido", err.Error())
		return nil, false
	}
	return q, true
}

// ErroDoBanco traduz o erro de uma consulta. A frase de um RAISE nosso chega à pessoa, como o
// PostgREST fazia: P0001/22023/23514 = 400 regra_de_negocio, 42501 = 403 sem_permissao, P0002 =
// 404 nao_encontrado, sempre com "mensagem". Os erros nativos (42501 "permission denied for
// table x", 22023 "unit \"xx\" not recognized"...) carregam nome de tabela, coluna ou valor do
// pedido: saem com texto fixo e status certo. Detail nunca é lido.
func ErroDoBanco(w http.ResponseWriter, err error) {
	var pe *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case errors.As(err, &pe):
		switch {
		case banco.RaiseNosso(pe) && pe.Code == "42501":
			Erro(w, http.StatusForbidden, "sem_permissao", pe.Message)
		case banco.RaiseNosso(pe) && pe.Code == "P0002":
			Erro(w, http.StatusNotFound, "nao_encontrado", pe.Message)
		case banco.RaiseNosso(pe):
			Erro(w, http.StatusBadRequest, "regra_de_negocio", pe.Message)
		case pe.Code == "42501":
			Erro(w, http.StatusForbidden, "sem_permissao", "")
		case pe.Code == "23505":
			Erro(w, http.StatusConflict, "conflito", "Já existe um registro com esses dados.")
		case pe.Code == "23503":
			Erro(w, http.StatusConflict, "conflito", "O registro está ligado a outro que não existe ou que ainda depende dele.")
		case pe.Code == "57014": // statement_timeout ou cancelamento do lado do servidor
			Erro(w, http.StatusGatewayTimeout, "prazo_esgotado", "")
		case strings.HasPrefix(pe.Code, "22") || strings.HasPrefix(pe.Code, "23"):
			Erro(w, http.StatusBadRequest, "pedido_invalido", "")
		default:
			slog.Error("banco", "codigo", pe.Code, "mensagem", pe.Message)
			Erro(w, http.StatusInternalServerError, "erro_interno", "")
		}
	case errors.Is(err, context.DeadlineExceeded):
		Erro(w, http.StatusGatewayTimeout, "prazo_esgotado", "")
	case errors.Is(err, context.Canceled):
		// o cliente desistiu: não é defeito nosso (sem log de erro); 499 é o código do nginx
		slog.Debug("banco: pedido cancelado pelo cliente")
		Erro(w, 499, "requisicao_cancelada", "")
	default:
		slog.Error("banco", "erro", err.Error())
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
}

// LerCorpo decodifica UM objeto JSON de até 1 MiB em destino. Campo que a struct não declara
// é recusado (é o que impede gravar coluna que a rota não escolheu); lixo depois do objeto
// também, e um corpo `null` (que o encoding/json aceitaria deixando destino vazio). Devolve
// false depois de já ter respondido 400/413.
//
// destino TEM de ser ponteiro para struct: DisallowUnknownFields não age em map nem em
// interface (aceitariam qualquer campo). O Content-Type não é exigido: a API autentica por
// Bearer (nunca por cookie), então não há CSRF a evitar, e as telas já mandam application/json.
func LerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	// lê tudo sob o teto: assim qualquer corpo acima de 1 MiB é 413, inclusive o lixo que
	// vem depois do objeto
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err == nil && string(bytes.TrimSpace(bruto)) == "null" {
		err = errors.New("corpo null")
	}
	if err == nil {
		dec := json.NewDecoder(bytes.NewReader(bruto))
		dec.DisallowUnknownFields()
		if err = dec.Decode(destino); err == nil {
			if _, fim := dec.Token(); fim != io.EOF {
				err = errors.New("lixo depois do objeto")
			}
		}
	}
	if err == nil {
		return true
	}
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		Erro(w, http.StatusRequestEntityTooLarge, "corpo_grande_demais", "")
	} else {
		Erro(w, http.StatusBadRequest, "corpo_invalido", "")
	}
	return false
}

// Lista responde 200 com o array JSON de `consulta`, montado pelo Postgres (json_agg): datas
// com "+00:00", numeric como número, nulos e chaves na ordem das colunas, exatamente como o
// PostgREST entregava. Lista vazia = [].
//
// O limite de LimitePadrao linhas é do próprio invólucro: a rota que esquecer o LIMIT (ou o
// filtro) não devolve a tabela inteira, e o Postgres para de calcular na linha seguinte.
func Lista(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	sql := `select coalesce(json_agg(t), '[]'::json) from (select * from (` + consulta + `) x limit ` + strconv.Itoa(LimitePadrao) + `) t`
	if err := q.QueryRow(ctx, sql, args).Scan(&corpo); err != nil {
		ErroDoBanco(w, err)
		return
	}
	escrever(w, http.StatusOK, corpo)
}

// Um responde 200 com o objeto da ÚNICA linha de `consulta`; nenhuma linha = 404; mais de uma
// é defeito da rota (500), nunca "a primeira que vier". Olha no máximo duas linhas: não agrega
// a tabela inteira só para contar.
func Um(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	var n int
	err := q.QueryRow(ctx, `select (array_agg(row_to_json(t)))[1], count(*) from (select * from (`+consulta+`) x limit 2) t`, args).Scan(&corpo, &n)
	switch {
	case err != nil:
		ErroDoBanco(w, err)
	case n == 0:
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case n > 1:
		slog.Error("dados.Um: consulta devolveu mais de uma linha")
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	default:
		escrever(w, http.StatusOK, corpo)
	}
}

func escrever(w http.ResponseWriter, status int, corpo []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(corpo)
}
