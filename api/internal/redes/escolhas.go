package redes

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"maps"
	"math"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasMeta   = `account_id, periodo, indicador, valor`
	colunasFiltro = `account_id, selected_ids, updated_at`
)

var consultaMetas = dados.Consulta{Tabela: "social_metas", Alias: "t",
	SQL:     `select t.account_id, t.periodo, t.indicador, t.valor from social_metas t`,
	Filtros: []dados.Filtro{filtroContaTexto}, OrdemPadrao: "t.account_id, t.periodo", Desempate: "t.indicador"}

var consultaFiltros = dados.Consulta{Tabela: "campaign_filters", Alias: "t",
	SQL:     `select t.account_id, t.selected_ids, t.updated_at from campaign_filters t`,
	Filtros: []dados.Filtro{filtroConta}, OrdemPadrao: "t.updated_at", Desempate: "t.account_id"}

var (
	reUUID      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	rePeriodo   = regexp.MustCompile(`^[a-z0-9_]{1,20}$`)
	reIndicador = regexp.MustCompile(`^[a-z0-9_.-]{1,80}$`)
	reIDDaMeta  = regexp.MustCompile(`^[0-9]{1,30}$`) // id de campanha da Meta
)

// upsertVisivel: INSERT … ON CONFLICT DO UPDATE com a semântica que o PostgREST tinha sob a RLS de
// produção (a tela fazia .upsert / resolution=merge-duplicates): (1) a linha nova passa no WITH CHECK de
// criar (PodeCriar) E na regra de LER e de editar sobre ela (EditarNova: num upsert o Postgres confere as
// policies de SELECT na linha proposta — é isso que barrava a conta invisível); (2) a linha que já existe
// só muda se quem pede a lê e a edita (WHERE do DO UPDATE). Fora disso, autz.ErrNegado — igual para "existe
// e é de outra conta" e "não existe e não se veria" (sem oráculo; Ruling 5.6-7). `linha` é o MESMO mapa
// que vai às conferências e ao INSERT (jsonb_populate_record); tabela, chave e resposta são da rota, nunca
// do pedido. Roda na tx de banco.ComUsuario de quem pede.
func upsertVisivel(ctx context.Context, tx pgx.Tx, e *autz.Escopo, tab string, chave []string, linha map[string]any, resposta string) ([]byte, error) {
	if err := autz.Producao.PodeCriar(ctx, tx, e, tab, linha); err != nil {
		return nil, err
	}
	fn, err := autz.Producao.Filtro(e, tab, autz.EditarNova, "autz_nova")
	if err != nil {
		return nil, err
	}
	if ok, err := autz.Conferir(ctx, tx, fn, tab, linha); err != nil || !ok {
		if err == nil {
			err = autz.ErrNegado
		}
		return nil, err
	}
	fl, err := autz.Producao.Filtro(e, tab, autz.Ler, tab)
	if err != nil {
		return nil, err
	}
	fe, err := autz.Producao.Filtro(e, tab, autz.Editar, tab)
	if err != nil {
		return nil, err
	}
	var lista, sets, alvo []string
	for _, c := range slices.Sorted(maps.Keys(linha)) {
		id := pgx.Identifier{c}.Sanitize()
		lista = append(lista, id)
		if !slices.Contains(chave, c) {
			sets = append(sets, id+" = excluded."+id)
		}
	}
	for _, c := range chave {
		alvo = append(alvo, pgx.Identifier{c}.Sanitize())
	}
	j, err := json.Marshal(linha)
	if err != nil {
		return nil, err
	}
	t, l := pgx.Identifier{tab}.Sanitize(), strings.Join(lista, ", ")
	var corpo []byte
	err = tx.QueryRow(ctx, `with n as (insert into `+t+` (`+l+`) select `+l+` from jsonb_populate_record(null::`+t+`, @linha::jsonb)
		on conflict (`+strings.Join(alvo, ", ")+`) do update set `+strings.Join(sets, ", ")+`
		  where (`+fl.SQL+`) and (`+fe.SQL+`)
		returning `+resposta+`) select row_to_json(n) from n`,
		fe.Juntar(fl.Juntar(pgx.NamedArgs{"linha": string(j)}))).Scan(&corpo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, autz.ErrNegado // a linha existe e quem pede não a lê ou não a edita: fica como estava
	}
	return corpo, err
}

type corpoMetas struct {
	Metas []struct {
		AccountID string          `json:"account_id"`
		Periodo   string          `json:"periodo"`
		Indicador string          `json:"indicador"`
		Valor     json.RawMessage `json:"valor"`
	} `json:"metas"`
}

// numeroDaMeta: o valor tem de ser número JSON finito; volta o texto exato (json.Number) para o numeric
// não passar por float64 (Ruling 5.6-13).
func numeroDaMeta(v json.RawMessage) (json.Number, bool) {
	d := json.NewDecoder(bytes.NewReader(v))
	d.UseNumber()
	var x any
	if d.Decode(&x) != nil {
		return "", false
	}
	n, ok := x.(json.Number)
	if !ok {
		return "", false
	}
	f, err := strconv.ParseFloat(string(n), 64)
	return n, err == nil && !math.IsInf(f, 0)
}

// gravarMetas: PUT /redes/metas. Lote atômico (Ruling 5.6-7).
func gravarMetas(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoMetas
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if len(in.Metas) == 0 || len(in.Metas) > 50 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 50 metas.")
			return
		}
		linhas := make([]map[string]any, 0, len(in.Metas))
		for _, m := range in.Metas {
			valor, ok := numeroDaMeta(m.Valor)
			if !reUUID.MatchString(m.AccountID) || !rePeriodo.MatchString(m.Periodo) || !reIndicador.MatchString(m.Indicador) || !ok {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Meta com conta, período, indicador ou valor inválido.")
				return
			}
			linhas = append(linhas, map[string]any{"account_id": m.AccountID, "periodo": m.Periodo, "indicador": m.Indicador, "valor": valor})
		}
		ctx := r.Context()
		saida := make([]string, 0, len(linhas))
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, l := range linhas {
				b, err := upsertVisivel(ctx, tx, e, "social_metas", []string{"account_id", "periodo", "indicador"}, l, colunasMeta)
				if err != nil {
					return err // uma recusada desfaz o lote inteiro
				}
				saida = append(saida, string(b))
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, []byte("["+strings.Join(saida, ",")+"]"))
	}
}

// gravarFiltro: PUT /redes/filtros-de-campanha/{account_id} {selected_ids}.
func gravarFiltro(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		conta := chi.URLParam(r, "account_id")
		if !reUUID.MatchString(conta) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			SelectedIDs json.RawMessage `json:"selected_ids"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		var ids []string
		if in.SelectedIDs == nil || (string(in.SelectedIDs) != "null" && (json.Unmarshal(in.SelectedIDs, &ids) != nil ||
			len(ids) > 2000 || slices.ContainsFunc(ids, func(s string) bool { return !reIDDaMeta.MatchString(s) }))) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "selected_ids: null (todas) ou lista de ids de campanha.")
			return
		}
		linha := map[string]any{"account_id": conta, "selected_ids": in.SelectedIDs,
			"updated_at": time.Now().UTC().Format(time.RFC3339Nano)}
		ctx := r.Context()
		var corpo []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			corpo, err = upsertVisivel(ctx, tx, e, "campaign_filters", []string{"account_id"}, linha, colunasFiltro)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarEscolhas(r chi.Router, p *pgxpool.Pool) {
	r.Get("/redes/metas", consultaMetas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/redes/metas", gravarMetas(p))
	r.Get("/redes/filtros-de-campanha", consultaFiltros.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/redes/filtros-de-campanha/{account_id}", gravarFiltro(p))
}
