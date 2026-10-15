package web

// Plano 02 do esforço REVISAO-TESTES-2026-10 (item C): paridade das RPCs. Para cada uma das funções registradas em
// FuncoesRPC, chama a FUNÇÃO ORIGINAL do banco direto (SQL, numa transação com rollback, com auth.uid() igual ao do
// pedido) e a ROTA `POST /rpc/{nome}` com os mesmos argumentos, e compara:
//   - sucesso: o mesmo JSON (Valor = to_json(f(...)), Conjunto = json_agg das linhas, Nada = 204);
//   - erro: o status HTTP que o PostgREST dava para aquele SQLSTATE (tabela abaixo, da documentação do PostgREST),
//     salvo as diferenças de propósito listadas em statusDeProposito.
// Dois casos por função: `{}` (só onde nenhum parâmetro é obrigatório) e todos os parâmetros `null`.
//
// Sem PARIDADE_DATABASE_URL, roda no banco de teste (esquema de produção, sem dados). Com ela, roda sobre um banco
// RESTAURADO de produção (dados reais; a rota COMMITA: nunca aponte para produção ou para o api-db compartilhado).

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// statusDoPostgREST: o status HTTP do PostgREST para um erro do Postgres (docs.postgrest.org, "Status Codes").
func statusDoPostgREST(codigo string) int {
	switch {
	case codigo == "23503" || codigo == "23505":
		return 409
	case codigo == "25006":
		return 405
	case codigo == "42883" || codigo == "42P01":
		return 404
	case codigo == "42501":
		return 403
	case codigo == "P0001":
		return 400
	case strings.HasPrefix(codigo, "08"), strings.HasPrefix(codigo, "53"):
		return 503
	case strings.HasPrefix(codigo, "54"):
		return 413
	case strings.HasPrefix(codigo, "0L"), strings.HasPrefix(codigo, "0P"), strings.HasPrefix(codigo, "28"):
		return 403
	case strings.HasPrefix(codigo, "09"), strings.HasPrefix(codigo, "25"), strings.HasPrefix(codigo, "2D"),
		strings.HasPrefix(codigo, "38"), strings.HasPrefix(codigo, "39"), strings.HasPrefix(codigo, "3B"),
		strings.HasPrefix(codigo, "40"), strings.HasPrefix(codigo, "55"), strings.HasPrefix(codigo, "57"),
		strings.HasPrefix(codigo, "58"), strings.HasPrefix(codigo, "F0"), strings.HasPrefix(codigo, "HV"),
		strings.HasPrefix(codigo, "XX"), strings.HasPrefix(codigo, "P0"):
		return 500
	}
	return 400
}

// statusDeProposito: SQLSTATE em que a API Go responde diferente do PostgREST, por decisão (dados.ErroDoBanco).
var statusDeProposito = map[string]struct {
	status int
	motivo string
}{
	"P0002": {404, "RAISE ... USING ERRCODE 'P0002' nosso é 'não encontrado'; o PostgREST dava 500 (classe P0)"},
	"57014": {504, "statement_timeout/cancelamento: 504 prazo_esgotado; o PostgREST dava 500"},
	"42883": {500, "função inexistente/assinatura: defeito do servidor, não 'rota não achada'; o PostgREST dava 404"},
	"42P01": {500, "tabela inexistente: defeito do servidor; o PostgREST dava 404"},
}

// maisRestritaDeProposito: a rota recusa com 403 antes de a função rodar, onde o PostgREST deixava a função decidir
// (400 com a frase dela ou sucesso). É o Conferir de cada função (conteudo: a peça/ideia tem de ser VISÍVEL a quem
// pede; inexistente e invisível dão o mesmo 403, sem revelar existência) e o portão da decisão de registro.
var maisRestritaDeProposito = map[string]string{
	"conteudo_aprovar_e_agendar":        "Conferir: a peça tem de ser visível a quem pede (403 igual para inexistente e invisível)",
	"conteudo_casar_na_mao":             "idem",
	"conteudo_decidir":                  "idem",
	"conteudo_decidir_casamento":        "idem (o casamento leva à peça)",
	"conteudo_ideia_virar_peca":         "Conferir: ideia e conta visíveis",
	"conteudo_reavisar":                 "idem conteudo_aprovar_e_agendar",
	"vessel_decidir_pedido_de_registro": "soNaMao: a decisão de registro só vale 'na mão' (vessel/rpc.go)",
}

func TestParidadeDasRPCs(t *testing.T) {
	var (
		p   *pgxpool.Pool
		h   http.Handler
		tok string
		uid string
	)
	if url := os.Getenv("PARIDADE_DATABASE_URL"); url != "" {
		pool, err := pgxpool.New(context.Background(), url)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(pool.Close)
		p = pool
		if err := p.QueryRow(context.Background(), `select id::text from profiles where is_superadmin order by created_at limit 1`).Scan(&uid); err != nil {
			t.Fatalf("o banco restaurado não tem superadmin: %v", err)
		}
		st := auth.NovoStore(p)
		tk, err := st.Criar(context.Background(), uid, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		tok, h = tk, Rotas(p, st, auth.NovoLimitador(), config.Config{})
	} else {
		var sessoes func() map[perfil]string
		p, h, sessoes, _, _ = mundoDaMatriz(t)
		tok, uid = sessoes()[pSuper], "22222222-2222-4222-a222-222222222222"
	}

	chamarRota := func(nome string, corpo map[string]any) (int, []byte) {
		b, _ := json.Marshal(corpo)
		r := httptest.NewRequest("POST", "/rpc/"+nome, bytes.NewReader(b))
		r.Header.Set("Authorization", "Bearer "+tok)
		r.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.Bytes()
	}
	// a função original, sem passar pela API: transação, auth.uid() = uid, rollback
	chamarSQL := func(f rpc.Funcao, nulos bool) ([]byte, string) {
		var args []string
		for _, pr := range f.Params {
			if nulos {
				args = append(args, fmt.Sprintf("%s => null::%s", pr.Nome, pr.Tipo))
			}
		}
		chamada := fmt.Sprintf("public.%s(%s)", f.Nome, strings.Join(args, ", "))
		var sql string
		switch f.Retorno {
		case rpc.Conjunto:
			sql = `select coalesce(json_agg(t), '[]'::json)::text from ` + chamada + ` t`
		case rpc.Nada:
			sql = `select ` + chamada + `::text`
		default:
			sql = `select to_json(` + chamada + `)::text`
		}
		ctx := context.Background()
		tx, err := p.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(ctx)
		if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1, true)`, uid); err != nil {
			t.Fatal(err)
		}
		var saida *string
		err = tx.QueryRow(ctx, sql).Scan(&saida)
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return nil, pe.Code
		}
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("%s: %v", f.Nome, err)
		}
		if saida == nil {
			return []byte("null"), ""
		}
		return []byte(*saida), ""
	}
	canonico := func(b []byte) any {
		var v any
		d := json.NewDecoder(bytes.NewReader(b))
		d.UseNumber()
		if err := d.Decode(&v); err != nil {
			return string(b)
		}
		return v
	}

	var iguais, diferentesDeProposito, erros int
	usadasRestritas := map[string]bool{}
	var porCodigo = map[string]int{}
	nomes := make([]string, 0, len(FuncoesRPC))
	porNome := map[string]rpc.Funcao{}
	for _, f := range FuncoesRPC {
		nomes = append(nomes, f.Nome)
		porNome[f.Nome] = f
	}
	sort.Strings(nomes)
	for _, nome := range nomes {
		f := porNome[nome]
		obrigatorios := 0
		for _, pr := range f.Params {
			if !pr.Opcional {
				obrigatorios++
			}
		}
		for _, nulos := range []bool{false, true} {
			if !nulos && obrigatorios > 0 {
				continue // `{}` só onde a função aceita zero argumentos
			}
			caso := map[bool]string{false: "sem argumentos", true: "argumentos null"}[nulos]
			corpo := map[string]any{}
			if nulos {
				for _, pr := range f.Params {
					corpo[pr.Nome] = nil
				}
			}
			esperado, sqlstate := chamarSQL(f, nulos)
			status, saida := chamarRota(nome, corpo)
			if _, restrita := maisRestritaDeProposito[nome]; restrita && nulos {
				usadasRestritas[nome] = true
				if status != 403 {
					t.Errorf("%s: esperava 403 (mais restrita de propósito) e a rota respondeu %d %.120s", nome, status, saida)
					erros++
				} else {
					diferentesDeProposito++
				}
				continue
			}
			switch {
			case sqlstate == "":
				erros0 := erros
				if f.Retorno == rpc.Nada {
					if status != 204 {
						t.Errorf("%s (%s): a função devolveu void e a rota respondeu %d %.120s", nome, caso, status, saida)
						erros++
					}
				} else if status != 200 {
					t.Errorf("%s (%s): a função respondeu e a rota deu %d %.160s", nome, caso, status, saida)
					erros++
				} else if !reflect.DeepEqual(canonico(esperado), canonico(saida)) {
					t.Errorf("%s (%s): JSON diferente\n   função: %.200s\n   rota:   %.200s", nome, caso, esperado, saida)
					erros++
				}
				if erros == erros0 {
					iguais++
				}
			default:
				porCodigo[sqlstate]++
				quer := statusDoPostgREST(sqlstate)
				if d, ok := statusDeProposito[sqlstate]; ok {
					if status == d.status {
						diferentesDeProposito++
						continue
					}
					quer = d.status
				}
				if status != quer {
					t.Errorf("%s (%s): a função deu SQLSTATE %s (PostgREST: %d) e a rota respondeu %d %.140s", nome, caso, sqlstate, statusDoPostgREST(sqlstate), status, saida)
					erros++
				} else {
					iguais++
				}
			}
		}
	}
	for nome := range maisRestritaDeProposito {
		if !usadasRestritas[nome] {
			t.Errorf("maisRestritaDeProposito tem %q, que não é mais RPC registrada: tire da lista", nome)
		}
	}
	t.Logf("%d RPCs; casos iguais ao PostgREST: %d; diferentes de propósito: %d; divergências: %d; SQLSTATE vistos: %v", len(nomes), iguais, diferentesDeProposito, erros, porCodigo)
}
