// Package dados é o contrato HTTP das rotas de domínio (Plano 5): formato de erro, JSON
// montado pelo próprio Postgres (o mesmo serializador do PostgREST), corpo de escrita,
// paginação, ordenação e filtros declarados por rota. Nada aqui decide permissão: isso é
// do pacote autz.
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// ErroDoBanco traduz o erro de uma consulta. Só as mensagens ESCRITAS POR NÓS nas funções do
// banco (raise exception: P0001, 22023 e 42501) chegam à pessoa, como o PostgREST fazia; o
// resto sai com texto fixo, sem nome de coluna nem valor (Detail nunca é lido nem logado).
func ErroDoBanco(w http.ResponseWriter, err error) {
	var pe *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case errors.As(err, &pe):
		switch {
		case pe.Code == "42501":
			Erro(w, http.StatusForbidden, "sem_permissao", pe.Message)
		case pe.Code == "P0001" || pe.Code == "22023":
			Erro(w, http.StatusBadRequest, "regra_de_negocio", pe.Message)
		case pe.Code == "23505":
			Erro(w, http.StatusConflict, "conflito", "Já existe um registro com esses dados.")
		case pe.Code == "23503":
			Erro(w, http.StatusConflict, "conflito", "O registro está ligado a outro que não existe ou que ainda depende dele.")
		case strings.HasPrefix(pe.Code, "22") || strings.HasPrefix(pe.Code, "23"):
			Erro(w, http.StatusBadRequest, "pedido_invalido", "")
		default:
			slog.Error("banco", "codigo", pe.Code, "mensagem", pe.Message)
			Erro(w, http.StatusInternalServerError, "erro_interno", "")
		}
	case errors.Is(err, context.DeadlineExceeded):
		Erro(w, http.StatusGatewayTimeout, "prazo_esgotado", "")
	default:
		slog.Error("banco", "erro", err.Error())
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
}

// LerCorpo decodifica UM objeto JSON de até 1 MiB em destino. Campo que a struct não declara
// é recusado (é o que impede gravar coluna que a rota não escolheu); lixo depois do objeto
// também. Devolve false depois de já ter respondido 400/413.
func LerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	err := dec.Decode(destino)
	if err == nil {
		if _, fim := dec.Token(); fim != io.EOF {
			err = errors.New("lixo depois do objeto")
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
func Lista(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	if err := q.QueryRow(ctx, `select coalesce(json_agg(t), '[]'::json) from (`+consulta+`) t`, args).Scan(&corpo); err != nil {
		ErroDoBanco(w, err)
		return
	}
	escrever(w, http.StatusOK, corpo)
}

// Um responde 200 com o objeto da ÚNICA linha de `consulta`; nenhuma linha = 404; mais de uma
// é defeito da rota (500), nunca "a primeira que vier".
func Um(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	var n int
	err := q.QueryRow(ctx, `select (array_agg(row_to_json(t)))[1], count(*) from (`+consulta+`) t`, args).Scan(&corpo, &n)
	switch {
	case err != nil:
		ErroDoBanco(w, err)
	case n == 0:
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case n > 1:
		slog.Error("dados.Um: consulta devolveu mais de uma linha", "linhas", n)
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
