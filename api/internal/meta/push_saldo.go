package meta

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// PushSaldo porta supabase/functions/enviar-push-saldo (job push-saldo-08h, robô
// 'enviar-push-saldo-08h'): lê o saldo das contas de anúncio pela Graph (via core) e manda UM push a
// quem quer o tipo 'saldo' quando alguma está acabando. Nada urgente = nada enviado.
type PushSaldo struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (ps *PushSaldo) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-push-saldo-08h", Agenda: "0 11 * * *", Limite: 3 * time.Minute, Executar: ps.Rodar}
}

type contaDeAnuncio struct{ id, nome, adAccount string }

func (ps *PushSaldo) Rodar(ctx context.Context) error {
	// VAPID errado falha AQUI, uma vez (a edge devolvia 500 vapid_nao_configurado).
	if _, err := webpush.ValidarVAPID(ps.VAPID); err != nil {
		return err
	}
	linhas, err := ps.Pool.Query(ctx, `select id::text, coalesce(name, ''), ad_account_id::text from accounts
		where coalesce(ad_account_id::text, '') <> '' order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaDeAnuncio, err error) {
		return c, r.Scan(&c.id, &c.nome, &c.adAccount)
	})
	if err != nil {
		return err
	}
	if len(contas) == 0 {
		slog.Info("push de saldo: nenhuma conta de anúncio", "motivo", "sem_contas")
		return nil
	}
	var leituras []Leitura
	var falhas []string
	for _, c := range contas {
		acc := strings.TrimPrefix(c.adAccount, "act_") // limparId da edge
		nome := c.nome
		if nome == "" {
			nome = acc
		}
		detalhe, err := GET(ctx, ps.Core, "/act_"+acc, map[string]any{"fields": "is_prepay_account,funding_source_details"})
		if err != nil {
			falhas = append(falhas, nome+": "+err.Error())
			continue
		}
		// O ritmo dos últimos 7 dias transforma "R$ 200" em "dura 2 dias"; sem ele, não estima prazo.
		gasto7 := 0.0
		if ins, err := GET(ctx, ps.Core, "/act_"+acc+"/insights", map[string]any{"date_preset": "last_7d", "fields": "spend"}); err == nil {
			gasto7 = numero(primeiro(ins)["spend"])
		}
		l := lerSaldo(detalhe, gasto7/7)
		l.Conta, l.AccountID = nome, c.id
		leituras = append(leituras, l)
	}
	erroDasFalhas := func() error {
		if len(falhas) == 0 {
			return nil
		}
		return fmt.Errorf("saldo: %d conta(s) sem leitura: %s", len(falhas), strings.Join(falhas, " · "))
	}
	titulo, corpo, temAviso := montarAvisoDeSaldo(leituras)
	if !temAviso {
		for _, l := range leituras {
			slog.Info("push de saldo: nada urgente", "conta", l.Conta, "nivel", l.Nivel)
		}
		return erroDasFalhas()
	}
	payload, _ := json.Marshal(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Tag   string `json:"tag"` // substitui o aviso anterior em vez de empilhar
		URL   string `json:"url"`
	}{titulo, corpo, "gt-saldo", "/gestao-trafego"})
	alvos, err := webpush.Destinatarios(ctx, ps.Pool, "saldo", "")
	if err != nil {
		return err
	}
	if len(alvos) == 0 {
		slog.Info("push de saldo: ninguém quer este tipo", "titulo", titulo)
		return erroDasFalhas()
	}
	agora := time.Now
	if ps.Agora != nil {
		agora = ps.Agora
	}
	dia := agora().In(saoPaulo).Format("2006-01-02")
	r, err := webpush.Entregar(ctx, ps.Pool, ps.HTTP, alvos, payload, ps.VAPID, "enviar-push-saldo:"+dia)
	if err != nil {
		return err
	}
	slog.Info("push de saldo", "titulo", titulo, "enviados", r.Enviados, "podados", r.Podados, "repetidos", r.Repetidos, "falhas", r.Falhas)
	if r.Enviados == 0 && r.Falhas > 0 {
		return fmt.Errorf("nenhum_push_entregue: %d inscrições (falharam %d, já enviadas hoje %d, podadas %d)", len(alvos), r.Falhas, r.Repetidos, r.Podados)
	}
	return erroDasFalhas()
}
