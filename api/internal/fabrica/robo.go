package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var (
	reAdAccount = regexp.MustCompile(`^act_[0-9]{1,30}$`)
	reIDMeta    = regexp.MustCompile(`^[0-9]{1,30}$`)

	// robosDaFabrica: os nomes que o fabrica-job-runner grava em ia_execucoes (fabrica-job-runner.mjs:127).
	robosDaFabrica = []string{"fabrica", "fabrica-gerar", "fabrica-subir", "fabrica-ativar", "fabrica-excluir", "fabrica-preview"}

	errLimiteDeLotes = errors.New("fabrica: limite de lotes")
)

// lerCamposRobo: corpo C (struct de json.RawMessage com `json:"<coluna>,omitempty"`), C.Validar() e as
// colunas presentes. Já respondeu quando devolve false.
func lerCamposRobo[C interface{ Validar() error }](w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var c C
	if !dados.LerCorpo(w, r, &c) {
		return nil, false
	}
	if err := c.Validar(); err != nil {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
		return nil, false
	}
	campos, err := dados.Campos(&c)
	if err != nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, false
	}
	if len(campos) == 0 {
		dados.Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
		return nil, false
	}
	return campos, true
}

// atualizarDireto: UPDATE só das colunas presentes (as tags da struct da rota), pelo jsonb_populate_record
// como dados.Tabela. Tabela, coluna-chave, o cast dela e `extra` são texto da rota, nunca do pedido. Para as
// tabelas que só a chave de serviço gravava (Ruling 5.8-11). Nenhuma linha = autz.ErrNaoEncontrado.
func atualizarDireto(ctx context.Context, tx pgx.Tx, tabela, chave, cast, valor string, campos map[string]any, extra string) error {
	cols := slices.Sorted(maps.Keys(campos))
	sets := make([]string, 0, len(cols)+1)
	for _, c := range cols {
		id := pgx.Identifier{c}.Sanitize()
		sets = append(sets, id+" = r."+id)
	}
	if extra != "" {
		sets = append(sets, extra)
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return err
	}
	t := pgx.Identifier{tabela}.Sanitize()
	tag, err := tx.Exec(ctx, `update `+t+` as a set `+strings.Join(sets, ", ")+
		` from jsonb_populate_record(null::`+t+`, @campos::jsonb) as r where a.`+pgx.Identifier{chave}.Sanitize()+` = @chave::`+cast,
		pgx.NamedArgs{"campos": string(j), "chave": valor})
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return autz.ErrNaoEncontrado
	}
	return nil
}

// inserirDireto: INSERT só das colunas presentes, devolvendo o id.
func inserirDireto(ctx context.Context, tx pgx.Tx, tabela string, campos map[string]any) (string, error) {
	cols := slices.Sorted(maps.Keys(campos))
	for i, c := range cols {
		cols[i] = pgx.Identifier{c}.Sanitize()
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return "", err
	}
	t, l := pgx.Identifier{tabela}.Sanitize(), strings.Join(cols, ", ")
	var id string
	err = tx.QueryRow(ctx, `insert into `+t+` (`+l+`) select `+l+` from jsonb_populate_record(null::`+t+`, @campos::jsonb)
		returning id::text`, pgx.NamedArgs{"campos": string(j)}).Scan(&id)
	return id, err
}

func idDaRota(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := chi.URLParam(r, "id")
	if !reUUID.MatchString(id) {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return "", false
	}
	return id, true
}

// ---- jobs ----

type corpoJob struct {
	Status      json.RawMessage `json:"status,omitempty"`
	GithubRunID json.RawMessage `json:"github_run_id,omitempty"`
	Resultado   json.RawMessage `json:"resultado,omitempty"`
	Erro        json.RawMessage `json:"erro,omitempty"`
}

func (c corpoJob) Validar() error {
	var e []error
	if c.Status != nil && !textoEm(c.Status, "enfileirado", "rodando", "concluido", "erro") {
		e = append(e, errors.New("status é enfileirado, rodando, concluido ou erro."))
	}
	if c.GithubRunID != nil && !nulo(c.GithubRunID) && !casa(c.GithubRunID, reRunID) {
		e = append(e, errors.New("github_run_id é o número da execução."))
	}
	if len(c.Resultado) > 256<<10 {
		e = append(e, errors.New("resultado passa de 256 KiB."))
	}
	if !textoOuNulo(c.Erro, 2000) {
		e = append(e, errors.New("erro tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

func atualizarJob(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		campos, ok := lerCamposRobo[corpoJob](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			return atualizarDireto(ctx, tx, "fabrica_jobs", "id", "uuid", id, campos, "updated_at = now()")
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// proximoLote: o encadeamento do gerar (fabrica-job-runner.mjs:46-63) numa transação, idempotente.
func proximoLote(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		var novo string
		status := http.StatusCreated
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var tipo string
			var bruto []byte
			err := tx.QueryRow(ctx, `select tipo, params from fabrica_jobs where id = $1::uuid for update`, id).Scan(&tipo, &bruto)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			if err != nil {
				return err
			}
			if tipo != "gerar" {
				return errPedido{"Só o job gerar encadeia lote."}
			}
			params := map[string]json.RawMessage{}
			if err := json.Unmarshal(bruto, &params); err != nil {
				return errPedido{"params do job não é objeto."}
			}
			cont := 0
			if v, tem := params["continuacao"]; tem && !nulo(v) {
				if json.Unmarshal(v, &cont) != nil || cont < 0 {
					return errPedido{"continuacao do job inválida."}
				}
			}
			cont++
			if cont > 300 {
				return errLimiteDeLotes
			}
			campanha, _ := texto(params["campanhaId"])
			err = tx.QueryRow(ctx, `select id::text from fabrica_jobs where tipo = 'gerar' and params->>'campanhaId' = $1::text
				and params->>'continuacao' = $2::text order by created_at limit 1`, campanha, strconv.Itoa(cont)).Scan(&novo)
			if err == nil {
				status = http.StatusOK // o mesmo lote pedido de novo: devolve o que já existe
				return nil
			}
			if !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			params["continuacao"], _ = json.Marshal(cont)
			j, err := json.Marshal(params)
			if err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `insert into fabrica_jobs (tipo, params, status, criado_por)
				values ('gerar', $1::jsonb, 'enfileirado', $2::uuid) returning id::text`, string(j), e.ID).Scan(&novo); err != nil {
				return err
			}
			if reUUID.MatchString(campanha) {
				_, err = tx.Exec(ctx, `update fabrica_campanhas set job_id = $1::uuid where id = $2::uuid`, novo, campanha)
			}
			return err
		})
		switch {
		case errors.Is(err, errLimiteDeLotes):
			responder(w, http.StatusConflict, map[string]string{"error": "limite_de_lotes"})
		case err != nil:
			escritaOuPedido(w, err)
		default:
			responder(w, status, map[string]string{"job_id": novo})
		}
	}
}

// ---- campanhas (catálogo: fab_camp_write) ----

type corpoCampanhaRobo struct {
	Status json.RawMessage `json:"status,omitempty"`
	Fechar json.RawMessage `json:"fechar,omitempty"`
}

func (c corpoCampanhaRobo) Validar() error {
	if c.Status != nil && !textoEm(c.Status, "gerando", "pronta", "erro") {
		return errors.New("status é gerando, pronta ou erro.")
	}
	if c.Fechar != nil && string(c.Fechar) != "true" {
		return errors.New("fechar só aceita true.")
	}
	return nil
}

func atualizarCampanha(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		id, ok := idDaRota(w, r)
		if !ok {
			return
		}
		campos, ok := lerCamposRobo[corpoCampanhaRobo](w, r)
		if !ok {
			return
		}
		if _, tem := campos["fechar"]; tem { // o relógio é do servidor (o robô mandava o dele)
			delete(campos, "fechar")
			campos["fechada_em"] = time.Now().UTC().Format(time.RFC3339Nano)
		}
		ctx := r.Context()
		var linha []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = tabelaCampanhas.Editar(ctx, tx, autz.Producao, e, id, campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, linha)
	}
}

// ---- criativos (catálogo: fab_criativos_write) ----

type corpoCriativoRobo struct {
	CampanhaID  json.RawMessage `json:"campanha_id,omitempty"`
	SKU         json.RawMessage `json:"sku,omitempty"`
	Arquetipo   json.RawMessage `json:"arquetipo,omitempty"`
	Template    json.RawMessage `json:"template,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Variante    json.RawMessage `json:"variante,omitempty"`
	PrecoDe     json.RawMessage `json:"preco_de,omitempty"`
	PrecoPor    json.RawMessage `json:"preco_por,omitempty"`
	StoragePath json.RawMessage `json:"storage_path,omitempty"`
	URL         json.RawMessage `json:"url,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
}

// Validar: o storage_path é o caminho que o fabrica-apagar e a purga apagam do disco — só dentro da pasta
// da rodada (Ruling 5.8-11). Clean(caminho) == caminho: `<rodada>/../<outra>/x.png` é local para o IsLocal e
// tem o prefixo certo, mas aponta para a pasta de outra rodada.
func (c corpoCriativoRobo) Validar() error {
	campanha, _ := texto(c.CampanhaID)
	caminho, _ := texto(c.StoragePath)
	switch {
	case !reUUID.MatchString(campanha):
		return errors.New("campanha_id é o id da rodada.")
	case !textoAte(c.Arquetipo, 40, false) || !textoAte(c.Template, 80, false) || !textoAte(c.Formato, 20, false):
		return errors.New("arquetipo, template e formato são obrigatórios (até 40, 80 e 20 caracteres).")
	case !textoOuNulo(c.SKU, 80) || !textoOuNulo(c.Variante, 80) || !textoOuNulo(c.Legenda, 5000):
		return errors.New("sku e variante têm até 80 caracteres e legenda até 5000.")
	case !numeroOuNulo(c.PrecoDe) || !numeroOuNulo(c.PrecoPor):
		return errors.New("preco_de e preco_por são números não negativos.")
	case utf8.RuneCountInString(caminho) > 300 || !filepath.IsLocal(caminho) || filepath.Clean(caminho) != caminho || strings.ContainsAny(caminho, "\\\x00") ||
		!strings.HasPrefix(caminho, campanha+"/"):
		return errors.New("storage_path fica dentro da pasta da rodada (<campanha_id>/…).")
	case !urlValida(c.URL):
		return errors.New("url é o endereço http(s) do arquivo.")
	}
	return nil
}

func criarCriativos(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		var linhas []corpoCriativoRobo
		if !dados.LerCorpo(w, r, &linhas) {
			return
		}
		if len(linhas) == 0 || len(linhas) > 200 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 200 criativos.")
			return
		}
		todos := make([]map[string]any, len(linhas))
		for i, l := range linhas {
			if err := l.Validar(); err != nil {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("criativo %d: %v", i+1, err))
				return
			}
			campos, err := dados.Campos(&l)
			if err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			todos[i] = campos
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, campos := range todos {
				if _, err := tabelaCriativos.Criar(ctx, tx, autz.Producao, e, campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]int{"criados": len(todos)})
	}
}

// ---- looks ----

type corpoLookRobo struct {
	PreviewURL json.RawMessage `json:"preview_url,omitempty"`
}

func (c corpoLookRobo) Validar() error {
	if !urlValida(c.PreviewURL) {
		return errors.New("preview_url é o endereço http(s) da prévia.")
	}
	return nil
}

func atualizarLook(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		chave := chi.URLParam(r, "chave")
		if !reChaveLook.MatchString(chave) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		campos, ok := lerCamposRobo[corpoLookRobo](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			return atualizarDireto(ctx, tx, "fabrica_looks", "chave", "text", chave, campos, "")
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ---- rastro da subida na Meta ----

type corpoMetaJob struct {
	Tipo           json.RawMessage `json:"tipo,omitempty"`
	AdAccountID    json.RawMessage `json:"ad_account_id,omitempty"`
	Loja           json.RawMessage `json:"loja,omitempty"`
	MetaCampaignID json.RawMessage `json:"meta_campaign_id,omitempty"`
	AdsetIDs       json.RawMessage `json:"adset_ids,omitempty"`
	AdIDs          json.RawMessage `json:"ad_ids,omitempty"`
	Payload        json.RawMessage `json:"payload,omitempty"`
	Status         json.RawMessage `json:"status,omitempty"`
	Erro           json.RawMessage `json:"erro,omitempty"`
}

func (c corpoMetaJob) Validar() error {
	var payload map[string]json.RawMessage
	switch {
	case !textoAte(c.Tipo, 40, false):
		return errors.New("tipo é obrigatório (até 40 caracteres).")
	case c.AdAccountID != nil && !nulo(c.AdAccountID) && !casa(c.AdAccountID, reAdAccount):
		return errors.New("ad_account_id é act_<número>.")
	case c.MetaCampaignID != nil && !nulo(c.MetaCampaignID) && !casa(c.MetaCampaignID, reIDMeta):
		return errors.New("meta_campaign_id é o id da campanha na Meta.")
	case !textoOuNulo(c.Loja, 120) || !textoOuNulo(c.Erro, 2000):
		return errors.New("loja tem até 120 caracteres e erro até 2000.")
	case (c.AdsetIDs != nil && !nulo(c.AdsetIDs) && !lista(c.AdsetIDs)) || (c.AdIDs != nil && !nulo(c.AdIDs) && !lista(c.AdIDs)):
		return errors.New("adset_ids e ad_ids são listas.")
	case c.Payload != nil && !nulo(c.Payload) && (!objeto(c.Payload) || len(c.Payload) > 64<<10 || json.Unmarshal(c.Payload, &payload) != nil):
		return errors.New("payload é um objeto de até 64 KiB.")
	case payload["campanhaId"] != nil && !nulo(payload["campanhaId"]) && !casa(payload["campanhaId"], reUUID):
		return errors.New("payload.campanhaId é o id da rodada.")
	case c.Status != nil && !textoEm(c.Status, "criado", "parcial"):
		return errors.New("status é criado ou parcial.")
	}
	return nil
}

func criarMetaJob(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		campos, ok := lerCamposRobo[corpoMetaJob](w, r)
		if !ok {
			return
		}
		ctx := r.Context()
		var id string
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			id, err = inserirDireto(ctx, tx, "fabrica_meta_jobs", campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]string{"id": id})
	}
}

// ---- execução do robô (custo e duração: ia_execucoes) ----

type corpoExecucao struct {
	Robo         json.RawMessage `json:"robo,omitempty"`
	Acao         json.RawMessage `json:"acao,omitempty"`
	Modelo       json.RawMessage `json:"modelo,omitempty"`
	InputTokens  json.RawMessage `json:"input_tokens,omitempty"`
	OutputTokens json.RawMessage `json:"output_tokens,omitempty"`
	Chamadas     json.RawMessage `json:"chamadas,omitempty"`
	Usd          json.RawMessage `json:"usd,omitempty"`
	DuracaoMs    json.RawMessage `json:"duracao_ms,omitempty"`
	Itens        json.RawMessage `json:"itens,omitempty"`
	Unidade      json.RawMessage `json:"unidade,omitempty"`
	Status       json.RawMessage `json:"status,omitempty"`
	Detalhe      json.RawMessage `json:"detalhe,omitempty"`
	GithubRunID  json.RawMessage `json:"github_run_id,omitempty"`
}

func (c corpoExecucao) Validar() error {
	switch {
	case !textoEm(c.Robo, robosDaFabrica...):
		return errors.New("robo é um dos robôs da Fábrica.")
	case !textoAte(c.Acao, 80, false):
		return errors.New("acao é obrigatória (até 80 caracteres).")
	case !textoOuNulo(c.Modelo, 80) || !textoOuNulo(c.Unidade, 40) || !textoOuNulo(c.Detalhe, 500):
		return errors.New("modelo, unidade e detalhe têm até 80, 40 e 500 caracteres.")
	case !inteiroOuNulo(c.InputTokens) || !inteiroOuNulo(c.OutputTokens) || !inteiroOuNulo(c.Chamadas) ||
		!inteiroOuNulo(c.DuracaoMs) || !inteiroOuNulo(c.Itens):
		return errors.New("contadores são inteiros não negativos.")
	case !numeroOuNulo(c.Usd):
		return errors.New("usd é um número não negativo.")
	case c.Status != nil && !nulo(c.Status) && !textoEm(c.Status, "ok", "parcial", "erro"):
		return errors.New("status é ok, parcial ou erro.")
	case c.GithubRunID != nil && !nulo(c.GithubRunID) && !casa(c.GithubRunID, reRunID):
		return errors.New("github_run_id é o número da execução.")
	}
	return nil
}

func criarExecucao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		campos, ok := lerCamposRobo[corpoExecucao](w, r)
		if !ok {
			return
		}
		for _, c := range []string{"input_tokens", "output_tokens", "chamadas", "usd", "status"} {
			if v, tem := campos[c]; tem && nulo(v.(json.RawMessage)) {
				delete(campos, c) // null nas colunas com padrão (not null default): vale o padrão do banco
			}
		}
		ctx := r.Context()
		var id string
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) (err error) {
			id, err = inserirDireto(ctx, tx, "ia_execucoes", campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusCreated, map[string]string{"id": id})
	}
}

// montarRobo: as rotas de robô. Só sessão de serviço (auth.SoServico, 5.13) E a regra do perfil do robô
// (soFabricante; e o catálogo onde há: campanhas e criativos). Rota nova de robô entra AQUI (a varredura da
// Task 10 confere que toda /fabrica/robo/… recusa painel).
func montarRobo(r chi.Router, p *pgxpool.Pool) {
	r.Group(func(r chi.Router) {
		r.Use(auth.SoServico, soFabricante)
		r.Patch("/fabrica/robo/jobs/{id}", atualizarJob(p))
		r.Post("/fabrica/robo/jobs/{id}/proximo-lote", proximoLote(p))
		r.Patch("/fabrica/robo/campanhas/{id}", atualizarCampanha(p))
		r.Post("/fabrica/robo/criativos", criarCriativos(p))
		r.Patch("/fabrica/robo/looks/{chave}", atualizarLook(p))
		r.Post("/fabrica/robo/meta-jobs", criarMetaJob(p))
		r.Post("/fabrica/robo/execucoes", criarExecucao(p))
	})
}
