package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// tiposDeJob: a lista da edge (fabrica-trigger/index.ts:17). "excluir" fica fora (Ruling 5.8-7).
var tiposDeJob = []string{"gerar", "subir", "ativar", "preview"}

var tabelaCampanhas = dados.Tabela{Nome: "fabrica_campanhas", Resposta: colunasCampanha, Autor: "criado_por"}

type pedidoDisparo struct {
	Tipo   string          `json:"tipo"`
	Params json.RawMessage `json:"params"`
}

// lerParams: params é objeto (ausente ou null = {}), até 64 KiB; campanhaId, quando vem não vazio, é uuid
// (o robô o põe na URL: fabrica-job-runner.mjs:168); nome até 200 e objetivo até 40 caracteres.
func lerParams(bruto json.RawMessage) (map[string]json.RawMessage, string) {
	params := map[string]json.RawMessage{}
	if len(bruto) == 0 || nulo(bruto) {
		return params, ""
	}
	if len(bruto) > 64<<10 {
		return nil, "params passa de 64 KiB."
	}
	if !objeto(bruto) {
		return nil, "params é um objeto."
	}
	if err := json.Unmarshal(bruto, &params); err != nil {
		return nil, "params é um objeto."
	}
	vazio := func(v json.RawMessage) bool { return nulo(v) || string(v) == `""` }
	if v, tem := params["campanhaId"]; tem && !vazio(v) && !casa(v, reUUID) {
		return nil, "campanhaId é o id da rodada."
	}
	if v, tem := params["nome"]; tem && !nulo(v) && !textoAte(v, 200, true) {
		return nil, "nome tem até 200 caracteres."
	}
	if v, tem := params["objetivo"]; tem && !nulo(v) && !textoAte(v, 40, true) {
		return nil, "objetivo tem até 40 caracteres."
	}
	return params, ""
}

// Disparador: POST /fabrica-trigger. Portão (soFabricante, soSessaoPropria) na montagem.
type Disparador struct {
	Pool   *pgxpool.Pool
	GH     *github.Cliente
	Limite *auth.Limitador // por pessoa (Ruling 5.8-16); Montar põe 30 por hora
}

func (d *Disparador) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoDisparo
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	if !slices.Contains(tiposDeJob, c.Tipo) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "tipo_invalido"})
		return
	}
	params, motivo := lerParams(c.Params)
	if motivo != "" {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", motivo)
		return
	}
	if d.Limite != nil && !d.Limite.Tentar(e.ID) {
		w.Header().Set("Retry-After", strconv.Itoa(int(d.Limite.Janela.Seconds())))
		dados.Erro(w, http.StatusTooManyRequests, "muitas_tentativas", "Muitos disparos seguidos; espere um pouco.")
		return
	}
	if !d.GH.Configurado() { // antes de gravar: sem token nada nasce (Ruling 5.8-6)
		responder(w, http.StatusServiceUnavailable, map[string]string{"error": "github_nao_configurado"})
		return
	}
	ctx := r.Context()
	campanha, _ := texto(params["campanhaId"])
	criou := false
	var job string
	err := banco.ComUsuario(ctx, d.Pool, e.ID, func(tx pgx.Tx) error {
		if c.Tipo == "gerar" && campanha == "" {
			nome := "Rodada · " + time.Now().UTC().Format("2006-01-02 15:04")
			if s, ok := texto(params["nome"]); ok && s != "" {
				nome = s
			}
			objetivo := "engajamento"
			if s, ok := texto(params["objetivo"]); ok && s != "" {
				objetivo = s
			}
			linha, err := tabelaCampanhas.Criar(ctx, tx, autz.Producao, e,
				map[string]any{"nome": nome, "status": "gerando", "objetivo": objetivo})
			if err != nil {
				return err
			}
			var nova struct {
				ID string `json:"id"`
			}
			if err := json.Unmarshal(linha, &nova); err != nil || nova.ID == "" {
				return fmt.Errorf("fabrica-trigger: rodada criada sem id: %v", err)
			}
			campanha, criou = nova.ID, true
			params["campanhaId"], _ = json.Marshal(campanha)
			params["objetivo"], _ = json.Marshal(objetivo)
		}
		j, err := json.Marshal(params)
		if err != nil {
			return err
		}
		// fabrica_jobs: só a chave de serviço gravava (fab_jobs_srv); o portão é o da edge (Ruling 5.8-3).
		if err := tx.QueryRow(ctx, `insert into fabrica_jobs (tipo, params, status, criado_por)
			values ($1::text, $2::jsonb, 'enfileirado', $3::uuid) returning id::text`,
			c.Tipo, string(j), e.ID).Scan(&job); err != nil {
			return err
		}
		if criou {
			_, err = tx.Exec(ctx, `update fabrica_campanhas set job_id = $1::uuid where id = $2::uuid`, job, campanha)
		}
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	var campanhaID any
	if campanha != "" {
		campanhaID = campanha
	}
	inicio := time.Now()
	// O job já está confirmado no banco: aba fechada agora não pode virar "Incerto" num despacho que o GitHub
	// aceitaria; por isso o despacho ignora o cancelamento da requisição (o cliente tem prazo próprio de 15 s).
	// Estado "Incerto, mas o GitHub aceitou" (resposta perdida): job e rodada ficam `erro` até o robô, que roda
	// mesmo assim, regravar o status (fabrica-job-runner.mjs:118); disparar de novo é decisão da pessoa.
	// ponytail: janela entre o commit do job e o despacho sem outbox: queda do processo aí deixa o job
	// `enfileirado` sem robô; upgrade = varrer jobs `enfileirado` com mais de N minutos e redisparar.
	err = d.GH.Disparar(context.WithoutCancel(ctx), "fabrica", map[string]string{"job_id": job})
	if err == nil {
		slog.Info("fabrica-trigger: robô acordado", "tipo", c.Tipo, "job", job, "ms", time.Since(inicio).Milliseconds())
		responder(w, http.StatusOK, map[string]any{"job_id": job, "campanha_id": campanhaID})
		return
	}
	status, codigo, frase, espera := respostaDoDespacho(err)
	slog.Warn("fabrica-trigger: despacho falhou", "tipo", c.Tipo, "job", job, "erro", err.Error(),
		"ms", time.Since(inicio).Milliseconds())
	ctx2, cancelar := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancelar()
	if err := marcarFalha(ctx2, d.Pool, e.ID, job, campanha, criou, codigo+" "+err.Error()); err != nil {
		slog.Error("fabrica-trigger: não marquei o job como erro", "job", job, "erro", err.Error())
	}
	if espera > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(espera.Round(time.Second).Seconds())))
	}
	responder(w, status, map[string]string{"error": codigo, "detail": frase})
}

// marcarFalha: o job SÓ se ainda enfileirado (o robô que já começou é a verdade) e a rodada que ESTE pedido
// criou SÓ se ainda gerando. Sem isto ficariam "enfileirado"/"gerando" para sempre (a Home consulta a cada 4 s).
func marcarFalha(ctx context.Context, p *pgxpool.Pool, quem, job, campanha string, criou bool, motivo string) error {
	return banco.ComUsuario(ctx, p, quem, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update fabrica_jobs set status = 'erro', erro = $2::text, updated_at = now()
			where id = $1::uuid and status = 'enfileirado'`, job, motivo); err != nil {
			return err
		}
		if !criou {
			return nil
		}
		_, err := tx.Exec(ctx, `update fabrica_campanhas set status = 'erro' where id = $1::uuid and status = 'gerando'`, campanha)
		return err
	})
}

// respostaDoDespacho: o que a tela recebe por classe; nunca o corpo do GitHub (Ruling 5.8-5).
func respostaDoDespacho(err error) (status int, codigo, frase string, espera time.Duration) {
	var e *github.Erro
	if !errors.As(err, &e) {
		return http.StatusInternalServerError, "erro_interno", "", 0
	}
	switch e.Classe {
	case github.Limite:
		return http.StatusTooManyRequests, "muitas_tentativas", "O GitHub pediu para esperar antes de acordar o robô de novo.", e.EsperarAte
	case github.Incerto:
		return http.StatusGatewayTimeout, "dispatch_incerto",
			"O GitHub não respondeu a tempo. Confira em Actions se o robô começou antes de disparar de novo.", 0
	case github.TokenInvalido:
		return http.StatusBadGateway, "dispatch_falhou", "O token do GitHub (GITHUB_PAT) venceu ou foi revogado.", 0
	case github.SemPermissao:
		return http.StatusBadGateway, "dispatch_falhou",
			`O token do GitHub não pode disparar ação: falta "Actions: Read and write" no repositório.`, 0
	case github.NaoEncontrado:
		return http.StatusBadGateway, "dispatch_falhou",
			"O GitHub não achou o fabrica.yml na branch main (ou o token não enxerga o repositório).", 0
	case github.Recusado:
		return http.StatusBadGateway, "dispatch_falhou", "O GitHub recusou o disparo: o fabrica.yml não aceita estas entradas.", 0
	case github.Indisponivel:
		return http.StatusBadGateway, "dispatch_falhou", "O GitHub está fora do ar. Tente de novo em alguns minutos.", 0
	}
	return http.StatusBadGateway, "dispatch_falhou", "Resposta inesperada do GitHub.", 0
}
