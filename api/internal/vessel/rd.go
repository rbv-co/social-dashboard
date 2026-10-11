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
//
// "Nada sai duas vezes": a reserva da linha (status 'enviado' + tentativa, num comando só, com
// for update skip locked) impede que duas rodadas ou dois workers mandem a mesma conversão. A RD NÃO
// tem chave de idempotência (conversion_identifier é do evento, não deduplica o POST), então existe
// UMA exceção explícita, aceita pela Ruling 4 (deixar linha parada perderia lead em silêncio): um
// envio AMBÍGUO pode sair de novo. É ambíguo o POST cujo resultado não se sabe: o prazo de 30 s do
// cliente, o prazo da tarefa estourando com o POST no ar, a morte do processo entre a reserva e a
// gravação do resultado e a falha ao gravar o resultado. Esses ficam 'enviado'/'falhou' e a regra de
// 10 min (igual à do pg_net) ou a nova tentativa (até 5) os manda outra vez. Já a linha que NUNCA foi
// postada (prazo vencido antes dela) volta a 'pendente' com a tentativa devolvida.
type RD struct {
	Pool  *pgxpool.Pool
	Token string       // RD_STATION_TOKEN (era segredos_de_cron 'rd-station-token-publico'): vai na query
	URL   string       // vazio = a da RD (o teste troca)
	HTTP  *http.Client // nil = prazo de 30 s por envio (o timeout_milliseconds do pg_net)
}

func (rd *RD) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: 4 * time.Minute, Executar: rd.Rodar}
}

type envioRD struct {
	id, origem int64
	tentativas int
}

func (rd *RD) Rodar(ctx context.Context) error {
	// 1) Enviado há mais de 10 min sem resposta (inclui o que estava no pg_net na hora do corte).
	//    Se era a 5ª tentativa, a linha sai da fila aqui (nenhum envio dela passa pelo lote): conta como esgotada.
	var travadas int
	if err := rd.Pool.QueryRow(ctx, `with m as (update vessel_rd_envios
		   set status = 'falhou', resposta = 'sem resposta em 10 min', atualizado_em = now()
		 where status = 'enviado' and atualizado_em < now() - interval '10 minutes'
		 returning tentativas)
		select (count(*) filter (where tentativas >= 5))::int from m`).Scan(&travadas); err != nil {
		return err
	}
	esgotou := func(n int) error {
		if n == 0 {
			return nil
		}
		return fmt.Errorf("rd: %d linha(s) esgotaram as 5 tentativas e saíram da fila: precisam de olho humano", n)
	}
	// 2) Sem e-mail espera (a conta da RD recusa contato só com telefone); ganhou e-mail, volta à fila.
	if _, err := rd.Pool.Exec(ctx, `update vessel_rd_envios e
		   set status = case when nullif(trim(p.email), '') is null then 'sem_email' else 'pendente' end,
		       atualizado_em = now()
		  from vessel_pessoas p
		 where p.id = e.pessoa_id
		   and ((e.status = 'pendente' and nullif(trim(p.email), '') is null)
		     or (e.status = 'sem_email' and nullif(trim(p.email), '') is not null))`); err != nil {
		return errors.Join(err, esgotou(travadas)) // a esgotada do passo 1 não se perde
	}
	if rd.Token == "" {
		return errors.Join(errors.New("rd_sem_token: RD_STATION_TOKEN vazio (para desligar a tarefa, WORKER_TAREFAS_DESLIGADAS=vessel-rd-station)"), esgotou(travadas))
	}
	// 3) Reserva até 50 (pendentes e falhas com menos de 5 tentativas) num comando só: quem reservou
	//    marca 'enviado' e conta a tentativa ANTES do HTTP (caiu no meio = volta em 10 min, passo 1).
	linhas, err := rd.Pool.Query(ctx, `with alvo as (
		  select id from vessel_rd_envios
		   where status = 'pendente' or (status = 'falhou' and tentativas < 5)
		   order by id limit 50 for update skip locked)
		update vessel_rd_envios e set status = 'enviado', tentativas = e.tentativas + 1, atualizado_em = now()
		  from alvo where e.id = alvo.id
		returning e.id, e.origem_id, e.tentativas`)
	if err != nil {
		return errors.Join(err, esgotou(travadas)) // a esgotada do passo 1 não se perde
	}
	alvos, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (a envioRD, err error) {
		return a, r.Scan(&a.id, &a.origem, &a.tentativas)
	})
	if err != nil {
		return errors.Join(err, esgotou(travadas)) // a esgotada do passo 1 não se perde
	}
	slices.SortFunc(alvos, func(a, b envioRD) int { return cmp.Compare(a.id, b.id) })
	var erros []error
	var devolver []int64 // reservadas que nunca foram postadas (prazo da tarefa vencido)
	enviadas, falhas, esgotadas, ambiguas := 0, 0, 0, 0
	for i, a := range alvos {
		if ctx.Err() != nil {
			for _, r := range alvos[i:] {
				devolver = append(devolver, r.id)
			}
			break
		}
		status, codigo, resposta, postou := rd.enviar(ctx, a.origem)
		if rd.Token != "" { // a RD não ecoa a chave, mas o que vai para a tabela nunca a leva
			resposta = strings.ReplaceAll(resposta, rd.Token, "***")
		}
		if status != "ok" && codigo == nil && ctx.Err() != nil {
			// O prazo da tarefa cortou este envio (sem resposta da RD). Se o POST estava no ar, é ambíguo: fica 'enviado'
			// (a regra de 10 min decide). Se nem chegou a sair, volta à fila.
			if postou {
				ambiguas++
			} else {
				devolver = append(devolver, a.id)
			}
			continue
		}
		enviadas++
		if status != "ok" {
			falhas++
			if a.tentativas >= 5 {
				esgotadas++
			}
		}
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_, err := rd.Pool.Exec(c, `update vessel_rd_envios set status = $2::text, http_status = $3::int,
			resposta = left($4::text, 500), atualizado_em = now() where id = $1::bigint`, a.id, status, codigo, resposta)
		cancela()
		if err != nil { // não aborta o lote: a linha fica 'enviado' e a regra de 10 min a recupera
			erros = append(erros, fmt.Errorf("rd: gravar o resultado da linha %d: %w", a.id, err))
		}
	}
	if len(devolver) > 0 {
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		_, err := rd.Pool.Exec(c, `update vessel_rd_envios set status = 'pendente', tentativas = greatest(tentativas - 1, 0),
			atualizado_em = now() where id = any($1::bigint[]) and status = 'enviado'`, devolver)
		cancela()
		if err != nil {
			erros = append(erros, fmt.Errorf("rd: devolver %d linhas à fila: %w", len(devolver), err))
		}
	}
	if len(alvos) > 0 {
		slog.Info("vessel-rd-station", "reservadas", len(alvos), "enviadas", enviadas, "falhas", falhas,
			"devolvidas", len(devolver), "ambiguas", ambiguas)
	}
	if len(devolver)+ambiguas > 0 {
		erros = append(erros, fmt.Errorf("limite_de_tempo: o prazo da tarefa acabou com %d de %d reservadas sem enviar (voltaram à fila) e %d com o envio no ar (a regra de 10 min decide)",
			len(devolver), len(alvos), ambiguas))
	}
	if falhas > 0 {
		erros = append(erros, fmt.Errorf("rd: %d de %d envios falharam (tentam de novo no próximo minuto, até 5 vezes)", falhas, len(alvos)))
	}
	if err := esgotou(esgotadas + travadas); err != nil {
		erros = append(erros, err)
	}
	return errors.Join(erros...)
}

// enviar faz UM POST. Devolve status ('ok'|'falhou'), o código HTTP (nil sem resposta) e o texto
// para vessel_rd_envios.resposta. O token vai na query da URL: o erro do http.Client traz a URL
// inteira, então só a causa (sem URL) é guardada.
func (rd *RD) enviar(ctx context.Context, origem int64) (status string, codigo *int, resposta string, postou bool) {
	var payload *string
	if err := rd.Pool.QueryRow(ctx, `select vessel_rd_payload($1::bigint)::text`, origem).Scan(&payload); err != nil {
		return "falhou", nil, "payload: " + err.Error(), false
	}
	if payload == nil {
		return "falhou", nil, "sem payload: a origem não existe mais", false
	}
	base := rd.URL
	if base == "" {
		base = urlRD
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"?api_key="+url.QueryEscape(rd.Token), bytes.NewReader([]byte(*payload)))
	if err != nil {
		return "falhou", nil, "pedido inválido", false
	}
	req.Header.Set("Content-Type", "application/json")
	cli := &http.Client{Timeout: 30 * time.Second}
	if rd.HTTP != nil {
		cli = rd.HTTP
	}
	c := *cli
	// Nunca segue redirecionamento: o Referer levaria ?api_key= para outro host.
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	r, err := c.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return "falhou", nil, err.Error(), true
	}
	defer r.Body.Close()
	corpo, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	cod := r.StatusCode
	codigo = &cod
	if cod >= 200 && cod <= 299 {
		return "ok", codigo, string(corpo), true
	}
	return "falhou", codigo, string(corpo), true
}
