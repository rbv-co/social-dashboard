// Package vessel: as tarefas da Vessel que o worker roda.
package vessel

import (
	"bytes"
	"cmp"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

const urlRD = "https://api.rd.services/platform/conversions"

// RD porta public.vessel_rd_enviar (job vessel-rd-station, pg_cron 1/min): manda à RD Station
// Marketing a fila vessel_rd_envios (cadastros de Beauty Session) como conversão. O gatilho
// vessel_rd_na_fila e a função vessel_rd_payload continuam no banco; só o HTTP sai do pg_net.
type RD struct {
	Pool  *pgxpool.Pool
	Token string       // RD_STATION_TOKEN (era segredos_de_cron 'rd-station-token-publico'): vai na query
	URL   string       // vazio = a da RD (o teste troca)
	HTTP  *http.Client // nil = prazo de 30 s por envio (o timeout_milliseconds do pg_net)
}

func (rd *RD) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: 4 * time.Minute, Executar: rd.Rodar}
}

type envioRD struct{ id, origem int64 }

func (rd *RD) Rodar(ctx context.Context) error {
	// 1) Enviado há mais de 10 min sem resposta (inclui o que estava no pg_net na hora do corte).
	if _, err := rd.Pool.Exec(ctx, `update vessel_rd_envios
		   set status = 'falhou', resposta = 'sem resposta em 10 min', atualizado_em = now()
		 where status = 'enviado' and atualizado_em < now() - interval '10 minutes'`); err != nil {
		return err
	}
	// 2) Sem e-mail espera (a conta da RD recusa contato só com telefone); ganhou e-mail, volta à fila.
	if _, err := rd.Pool.Exec(ctx, `update vessel_rd_envios e
		   set status = case when nullif(trim(p.email), '') is null then 'sem_email' else 'pendente' end,
		       atualizado_em = now()
		  from vessel_pessoas p
		 where p.id = e.pessoa_id
		   and ((e.status = 'pendente' and nullif(trim(p.email), '') is null)
		     or (e.status = 'sem_email' and nullif(trim(p.email), '') is not null))`); err != nil {
		return err
	}
	if rd.Token == "" {
		return errors.New("rd_sem_token: RD_STATION_TOKEN vazio (para desligar a tarefa, WORKER_TAREFAS_DESLIGADAS=vessel-rd-station)")
	}
	// 3) Reserva até 50 (pendentes e falhas com menos de 5 tentativas) num comando só: quem reservou
	//    marca 'enviado' e conta a tentativa ANTES do HTTP (caiu no meio = volta em 10 min, passo 1).
	linhas, err := rd.Pool.Query(ctx, `with alvo as (
		  select id from vessel_rd_envios
		   where status = 'pendente' or (status = 'falhou' and tentativas < 5)
		   order by id limit 50 for update skip locked)
		update vessel_rd_envios e set status = 'enviado', tentativas = e.tentativas + 1, atualizado_em = now()
		  from alvo where e.id = alvo.id
		returning e.id, e.origem_id`)
	if err != nil {
		return err
	}
	alvos, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (a envioRD, err error) {
		return a, r.Scan(&a.id, &a.origem)
	})
	if err != nil {
		return err
	}
	slices.SortFunc(alvos, func(a, b envioRD) int { return cmp.Compare(a.id, b.id) })
	falhas := 0
	for _, a := range alvos {
		status, codigo, resposta := rd.enviar(ctx, a.origem)
		if rd.Token != "" { // a RD não ecoa a chave, mas o que vai para a tabela nunca a leva
			resposta = strings.ReplaceAll(resposta, rd.Token, "***")
		}
		if status != "ok" {
			falhas++
		}
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_, err := rd.Pool.Exec(c, `update vessel_rd_envios set status = $2::text, http_status = $3::int,
			resposta = left($4::text, 500), atualizado_em = now() where id = $1::bigint`, a.id, status, codigo, resposta)
		cancela()
		if err != nil {
			return err
		}
	}
	if len(alvos) > 0 {
		slog.Info("vessel-rd-station", "enviados", len(alvos), "falhas", falhas)
	}
	if falhas > 0 {
		return fmt.Errorf("rd: %d de %d envios falharam (tentam de novo no próximo minuto, até 5 vezes)", falhas, len(alvos))
	}
	return nil
}

// enviar faz UM POST. Devolve status ('ok'|'falhou'), o código HTTP (nil sem resposta) e o texto
// para vessel_rd_envios.resposta. O token vai na query da URL: o erro do http.Client traz a URL
// inteira, então só a causa (sem URL) é guardada.
func (rd *RD) enviar(ctx context.Context, origem int64) (string, *int, string) {
	var payload *string
	if err := rd.Pool.QueryRow(ctx, `select vessel_rd_payload($1::bigint)::text`, origem).Scan(&payload); err != nil {
		return "falhou", nil, "payload: " + err.Error()
	}
	if payload == nil {
		return "falhou", nil, "sem payload: a origem não existe mais"
	}
	base := rd.URL
	if base == "" {
		base = urlRD
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"?api_key="+url.QueryEscape(rd.Token), bytes.NewReader([]byte(*payload)))
	if err != nil {
		return "falhou", nil, "pedido inválido"
	}
	req.Header.Set("Content-Type", "application/json")
	cli := rd.HTTP
	if cli == nil {
		cli = &http.Client{Timeout: 30 * time.Second}
	}
	r, err := cli.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return "falhou", nil, err.Error()
	}
	defer r.Body.Close()
	corpo, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	codigo := r.StatusCode
	if codigo >= 200 && codigo <= 299 {
		return "ok", &codigo, string(corpo)
	}
	return "falhou", &codigo, string(corpo)
}
