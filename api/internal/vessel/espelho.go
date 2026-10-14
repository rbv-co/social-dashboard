package vessel

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// RoboDoEspelho é o nome do pedido em disparos_pendentes (public.disparar_robo, gatilho vessel_lista_espera_espelhar) e
// o da tarefa em robos_execucoes: o mesmo de produção.
const RoboDoEspelho = "vessel-espelhar-lista"

// IntervaloDoEspelho: no máximo UM despacho a cada 5 minutos. O Actions tem cota; num pico de cadastros os pedidos se
// juntam (o índice único de disparos_pendentes) e saem, no máximo, 12 despachos por hora.
const IntervaloDoEspelho = 5 * time.Minute

// Despachante é o que a tarefa usa do GitHub (internal/github.Cliente): lista fechada de workflows, sem repetição.
type Despachante interface {
	Disparar(ctx context.Context, nome string, entradas map[string]string) error
	Configurado() bool
}

// Espelho atende o pedido do espelho da planilha da Vessel. O robô que escreve a planilha (workflow
// espelho-da-vessel.yml, que roda coletor/espelhar-vessel-no-zoho.mjs com o Zoho) continua em JS: a API não tem
// biblioteca de xlsx e o arquivo é o mesmo código com teste. A API entrega o GATILHO: a cada pedido acorda o workflow.
//
// "Despachado" não é "escrito": 204 do GitHub = o pedido foi aceito. 502, 504 e a conexão que cai depois de enviar
// = INCERTO (pode ter sido aceito) e nunca se repete sozinho; o próximo cadastro abre outro pedido.
type Espelho struct {
	Pool      *pgxpool.Pool
	GitHub    Despachante
	Intervalo time.Duration // 0 = IntervaloDoEspelho (o teste encurta)
}

func (e *Espelho) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: RoboDoEspelho, Agenda: "* * * * *", Limite: 45 * time.Second, Executar: e.rodar}
}

func (e *Espelho) rodar(ctx context.Context) error {
	intervalo := e.Intervalo
	if intervalo == 0 {
		intervalo = IntervaloDoEspelho
	}
	// sem pedido esperando não há o que fazer (a rodada comum é UMA consulta)
	var espera bool
	if err := e.Pool.QueryRow(ctx, `select exists (select 1 from disparos_pendentes where robo = $1::text and situacao = 'pendente')`, RoboDoEspelho).Scan(&espera); err != nil {
		return err
	}
	if !espera {
		return nil
	}
	// o pedido só é pego com o GitHub configurado: sem o token o pedido fica à espera e a tarefa FALHA à vista
	if e.GitHub == nil || !e.GitHub.Configurado() {
		return errors.New("espelho parado: GITHUB_PAT ausente (há cadastro esperando)")
	}
	var recente bool
	if err := e.Pool.QueryRow(ctx, `select exists (select 1 from disparos_pendentes where robo = $1::text
		   and situacao in ('atendendo', 'feito', 'falhou', 'incerto') and atualizado_em > now() - make_interval(secs => $2::double precision))`,
		RoboDoEspelho, intervalo.Seconds()).Scan(&recente); err != nil {
		return err
	}
	if recente {
		return nil
	}
	_, err := banco.AtenderDisparo(ctx, e.Pool, RoboDoEspelho, func(ctx context.Context, _ banco.Disparo) error {
		err := e.GitHub.Disparar(ctx, "espelho-vessel", map[string]string{})
		var ge *github.Erro
		if errors.As(err, &ge) && ge.Classe == github.Incerto {
			return fmt.Errorf("%w: %s", banco.ErrIncerto, err.Error())
		}
		return err
	})
	return err
}
