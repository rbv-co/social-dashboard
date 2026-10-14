package conteudo

import (
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
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
	// maxPorRodada: o teto da edge (MAX_POR_RODADA): cada ideia é token de Opus.
	maxPorRodada  = 20
	quantasPadrao = 12
	// minutosEntreRodadas: uma rodada por vez por marca (MINUTOS_ENTRE_RODADAS da edge).
	minutosEntreRodadas = 3
)

// pedidoGatilho: o corpo de _pedirAIA (dados-conteudo.js:353-375): {account_id, quantas, modo} ou
// {account_id, modo: 'semana', segunda}. Campo a mais = 400 (dados.LerCorpo); a edge o ignorava.
type pedidoGatilho struct {
	AccountID json.RawMessage `json:"account_id"`
	Quantas   json.RawMessage `json:"quantas"`
	Modo      json.RawMessage `json:"modo"`
	Segunda   json.RawMessage `json:"segunda"`
}

// quantasDoPedido: `Math.min(Math.max(Number(body.quantas) || 12, 1), 20)` da edge e, DEPOIS, truncado para
// inteiro: a edge deixava 3.7 passar, e o workflow apagava o ponto (`${QUANTAS//[^0-9]/}` = "37"), furando o
// teto (achado 3). Número ou texto numérico (Number("15") = 15); o resto (ausente, null, "abc", 0) vale 12.
func quantasDoPedido(v json.RawMessage) int {
	var f float64
	var s string
	switch {
	case json.Unmarshal(v, &f) == nil:
	case json.Unmarshal(v, &s) == nil:
		f, _ = strconv.ParseFloat(strings.TrimSpace(s), 64)
	}
	if f == 0 || math.IsNaN(f) {
		f = quantasPadrao
	}
	return int(math.Min(math.Max(f, 1), maxPorRodada)) // int() trunca: 3.7 → 3
}

// segundaDoPedido: "AAAA-MM-DD" de uma data que existe; senão nula (o robô usa a próxima segunda). A edge só
// conferia o formato; uma data impossível derrubava o robô (new Date inválido).
func segundaDoPedido(v json.RawMessage) any {
	s, ok := comoTexto(v)
	if !ok {
		return nil
	}
	if _, err := time.Parse("2006-01-02", s); err != nil {
		return nil
	}
	return s
}

// Gatilho: POST /conteudo-trigger — o da edge supabase/functions/conteudo-trigger/index.ts SEM o despacho ao
// GitHub (COORDENACAO 12/10 23:10 (b)): grava o pedido em conteudo_jobs ('enfileirado') e o vigia da VPS
// (coletor/vps/conteudo-vigia.sh, trilha C) o pega da fila. Portão (PedeIA) e "entrar como" na montagem.
// conteudo_jobs só a chave de serviço gravava (conteudo_jobs_srv): a escrita é SQL explícito atrás do portão
// da edge, como as edges da Fábrica (Ruling 5.8-3, 5.9-11).
type Gatilho struct{ Pool *pgxpool.Pool }

func (g *Gatilho) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoGatilho
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	conta, _ := comoTexto(c.AccountID)
	conta = strings.ToLower(conta)
	if !reUUID.MatchString(conta) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "conta_invalida"})
		return
	}
	// a conta que a pessoa não vê: a edge não olhava (gastava IA na marca de outro e gravava o job dela).
	// Ruling 5.9-11.
	if !autz.PodeVerConta(e, conta) {
		responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao"})
		return
	}
	quantas := quantasDoPedido(c.Quantas)
	modo, params := "ideias", map[string]any{"quantas": quantas}
	if s, _ := comoTexto(c.Modo); s == "semana" { // lista fechada: o valor escolhe o robô do vigia
		modo, params = "semana", map[string]any{"segunda": segundaDoPedido(c.Segunda)}
	}
	j, err := json.Marshal(params)
	if err != nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	ctx := r.Context()
	var job, emAndamento string
	existe := false
	err = banco.ComUsuario(ctx, g.Pool, e.ID, func(tx pgx.Tx) error {
		// Uma rodada por vez por marca TAMBÉM com dois cliques no mesmo instante: a trava consultiva da conta
		// (até o fim da transação) põe os pedidos em fila; o segundo vê o job do primeiro, já comitado.
		if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('conteudo-trigger:' || $1::text, 0))`, conta); err != nil {
			return err
		}
		if err := tx.QueryRow(ctx, `select exists (select 1 from accounts where id = $1::uuid)`, conta).Scan(&existe); err != nil || !existe {
			return err
		}
		err := tx.QueryRow(ctx, `select id::text from conteudo_jobs where account_id = $1::uuid
			and status in ('enfileirado', 'rodando') and created_at >= now() - make_interval(mins => $2::int)
			order by created_at desc limit 1`, conta, minutosEntreRodadas).Scan(&emAndamento)
		if !errors.Is(err, pgx.ErrNoRows) {
			return err // nil: já tem rodada; responde ja_rodando
		}
		return tx.QueryRow(ctx, `insert into conteudo_jobs (tipo, account_id, params, criado_por)
			values ($1::text, $2::uuid, $3::jsonb, $4::uuid) returning id::text`, modo, conta, string(j), e.ID).Scan(&job)
	})
	switch {
	case err != nil:
		slog.Error("conteudo-trigger: gravar o pedido", "conta", conta, "erro", err.Error())
		responder(w, http.StatusInternalServerError, map[string]string{"error": "insert_falhou"})
	case !existe:
		responder(w, http.StatusBadRequest, map[string]string{"error": "conta_invalida"})
	case emAndamento != "":
		responder(w, http.StatusConflict, map[string]string{"error": "ja_rodando", "job_id": emAndamento})
	default:
		slog.Info("conteudo-trigger: pedido na fila", "job", job, "modo", modo, "conta", conta)
		responder(w, http.StatusOK, map[string]any{"job_id": job, "quantas": quantas})
	}
}

// montarGatilho: o portão da edge (PedeIA) ANTES do "entrar como" (quem não pede IA recebe o 403 da edge,
// sem a frase), e "entrar como" só lê.
func montarGatilho(r chi.Router, p *pgxpool.Pool) {
	r.With(soPedeIA, soSessaoPropria).Post("/conteudo-trigger", (&Gatilho{Pool: p}).ServeHTTP)
}

// soPedeIA: depois de autz.ComEscopo. Sem escopo (rota montada fora do grupo) nega: falha fechada.
func soPedeIA(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !PedeIA(autz.EscopoDo(r.Context())) {
			responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao"})
			return
		}
		next.ServeHTTP(w, r)
	})
}
