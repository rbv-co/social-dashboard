package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// HoraH porta supabase/functions/conteudo-hora-h (pg_cron */5, robô 'conteudo-hora-h'): reivindica as
// peças cuja hora chegou (conteudo_reivindicar_hora_h: UPDATE ... RETURNING no banco, então duas
// execuções nunca avisam a mesma peça) e manda o push a quem pode publicar. A publicação automática
// da edge NÃO é portada: está desligada (ESCOPOS_DE_PUBLICACAO_LIBERADOS = false, sem App Review).
type HoraH struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (h *HoraH) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "conteudo-hora-h", Agenda: "*/5 * * * *", Limite: 2 * time.Minute, Executar: h.Rodar}
}

// toleranciaHoraH: peça mais velha que isto é reivindicada (não fica presa) mas não gera aviso
// (aviso-de-conteudo.js: HORAS_DE_TOLERANCIA = 12).
const toleranciaHoraH = 12 * time.Hour

var formatos = map[string]string{"feed": "Post do feed", "carrossel": "Carrossel", "reels": "Reels", "stories": "Story"}

type pecaDaHora struct {
	id, accountID, titulo, formato, conta string
	publicarEm                            *time.Time
	responsavel                           string
	avisadoEm                             *time.Time
}

// avisoDePeca = montarAvisoDePeca (aviso-de-conteudo.js).
func avisoDePeca(p pecaDaHora) []byte {
	titulo := strings.TrimSpace(p.titulo)
	if titulo == "" {
		titulo = "Peça sem título"
	}
	formato := formatos[p.formato]
	if formato == "" {
		formato = "Publicação"
	}
	partes := []string{formato}
	if marca := strings.TrimSpace(p.conta); marca != "" {
		partes = append(partes, marca)
	}
	partes = append(partes, "legenda pronta para copiar")
	b, _ := json.Marshal(struct {
		Title string `json:"title"`
		Body  string `json:"body"`
		Tag   string `json:"tag"` // por peça: o service worker usa renotify, tag repetida apagaria o aviso anterior
		URL   string `json:"url"`
	}{"Hora de publicar: " + titulo, strings.Join(partes, " · "), "conteudo-" + p.id, "/conteudo/peca/" + p.id})
	return b
}

// prazoPorPeca: o que cada peça reivindicada tem para ser avisada, mesmo depois de a execução ter
// perdido o contexto (prazo ou desligamento): a reivindicação é irreversível.
var prazoPorPeca = 30 * time.Second // var: o teste baixa

func (h *HoraH) Rodar(ctx context.Context) error {
	// VAPID errado falha ANTES de reivindicar: senão as peças seriam marcadas e nunca avisadas.
	if _, err := webpush.ValidarVAPID(h.VAPID); err != nil {
		return err
	}
	agora := time.Now
	if h.Agora != nil {
		agora = h.Agora
	}
	if err := ctx.Err(); err != nil { // prazo já vencido: nada reivindicado ainda, nada se perde
		return err
	}
	// A reivindicação é irreversível: a query roda com contexto próprio e curto (sem o cancelamento da tarefa), senão
	// o prazo vencendo no meio dela marcaria as peças no banco e a resposta se perderia (peça sem aviso e sem trilha).
	cr, cancelaR := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
	defer cancelaR()
	linhas, err := h.Pool.Query(cr, `select c.id::text, c.account_id::text, coalesce(c.titulo, ''), coalesce(c.formato, ''),
			coalesce(a.name, ''), c.publicar_em, coalesce(c.responsavel::text, ''), c.avisado_em
		  from conteudo_reivindicar_hora_h() c left join accounts a on a.id = c.account_id`)
	if err != nil {
		return fmt.Errorf("falha_ao_reivindicar: %w", err)
	}
	pecas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p pecaDaHora, err error) {
		return p, r.Scan(&p.id, &p.accountID, &p.titulo, &p.formato, &p.conta, &p.publicarEm, &p.responsavel, &p.avisadoEm)
	})
	if err != nil {
		return fmt.Errorf("falha_ao_reivindicar: %w", err)
	}
	// Daqui em diante cada peça é avisada por conta própria: o erro de uma (banco, push) não deixa as
	// outras, já reivindicadas, sem aviso nem trilha. Os erros sobem juntos no fim.
	var total webpush.Resultado
	var erros []error
	for _, p := range pecas {
		r, err := h.avisar(ctx, p, agora())
		total.Enviados += r.Enviados
		total.Podados += r.Podados
		total.Falhas += r.Falhas
		if err != nil {
			erros = append(erros, fmt.Errorf("peça %s: %w", p.id, err))
		}
	}
	if len(pecas) > 0 {
		slog.Info("conteudo-hora-h", "pecas", len(pecas), "enviados", total.Enviados, "podados", total.Podados, "falhas", total.Falhas)
	}
	if total.Falhas > 0 { // falha parcial também é falha: a tela de saúde tem de ficar vermelha
		erros = append(erros, fmt.Errorf("push_nao_entregue: %d falha(s)", total.Falhas))
	}
	return errors.Join(erros...)
}

// avisar trata UMA peça já reivindicada.
func (h *HoraH) avisar(ctx context.Context, p pecaDaHora, agora time.Time) (webpush.Resultado, error) {
	ctx, cancela := context.WithTimeout(context.WithoutCancel(ctx), prazoPorPeca)
	defer cancela()
	// A trilha tem contexto PRÓPRIO: com push lento o do envio já venceu, e a peça (já reivindicada) ficaria sem registro.
	evento := func(detalhe string) error {
		c, cancelaE := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancelaE()
		_, err := h.Pool.Exec(c, `insert into conteudo_eventos (peca_id, acao, detalhe) values ($1::uuid, 'avisou', $2::text)`, p.id, detalhe)
		return err
	}
	if p.publicarEm == nil || agora.Sub(*p.publicarEm) > toleranciaHoraH {
		return webpush.Resultado{}, evento("Passou mais de 12 horas do horário marcado — não avisei para não encher o celular de aviso velho.")
	}
	alvos, err := alvosDoAviso(ctx, h.Pool, p.responsavel)
	if err != nil {
		return webpush.Resultado{}, err
	}
	if len(alvos) == 0 { // a peça já foi reivindicada: o motivo fica na trilha
		detalhe := "Chegou a hora, mas ninguém tem o aviso de conteúdo ligado (Administração › Usuários)."
		if p.responsavel != "" {
			detalhe = "Chegou a hora, mas quem é responsável por esta peça está com o aviso de conteúdo desligado (Administração › Usuários)."
		}
		return webpush.Resultado{}, evento(detalhe)
	}
	// A chave do livro leva o instante da reivindicação: "Reavisar" e a reaprovação zeram avisado_em e a
	// peça volta a ser reivindicada; sem a janela, todo aparelho viria como repetido e nada sairia. Duas
	// execuções simultâneas continuam sem duplicar: quem não reivindica não chega aqui.
	var janela int64
	if p.avisadoEm != nil {
		janela = p.avisadoEm.UnixMicro()
	}
	r, err := webpush.Entregar(ctx, h.Pool, h.HTTP, alvos, avisoDePeca(p), h.VAPID, "conteudo-hora-h:"+p.id+":"+strconv.FormatInt(janela, 10))
	if err != nil { // erro do banco (ou o prazo vencendo entre dois aparelhos): a peça segue reivindicada, a trilha diz o que houve
		if errEv := evento(fmt.Sprintf(`O envio foi interrompido (%s). Use "Reavisar" para tentar de novo.`, contagemDoEnvio(r))); errEv != nil {
			err = errors.Join(err, errEv)
		}
		return r, err
	}
	if r.Enviados+r.Repetidos == 0 { // não pode parecer sucesso; a reivindicação fica (desfazê-la repetiria a cada 5 min)
		return r, evento(fmt.Sprintf(`Tentei avisar, mas nenhum aparelho recebeu (%s). Use "Reavisar" para tentar de novo.`, contagemDoEnvio(r)))
	}
	return r, evento(fmt.Sprintf("Aviso enviado para %d aparelho(s).", r.Enviados+r.Repetidos))
}

// contagemDoEnvio: o que não foi entregue, com a poda (410, inscrição morta) separada das falhas.
func contagemDoEnvio(r webpush.Resultado) string {
	var partes []string
	if r.Falhas > 0 || r.Podados == 0 {
		partes = append(partes, fmt.Sprintf("%d falha(s)", r.Falhas))
	}
	if r.Podados > 0 {
		partes = append(partes, fmt.Sprintf("%d removido(s)", r.Podados))
	}
	return strings.Join(partes, ", ")
}

// alvosDoAviso (aviso-de-conteudo.js): quer o tipo 'conteudo' E pode abrir a ferramenta (admin,
// superadmin ou 'conteudo' em features). Com responsável, o aviso é SÓ dele (vazio se ele desligou).
func alvosDoAviso(ctx context.Context, p *pgxpool.Pool, responsavel string) ([]webpush.Destino, error) {
	querem, err := webpush.Destinatarios(ctx, p, "conteudo", responsavel)
	if err != nil || len(querem) == 0 {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select id::text from profiles
		where coalesce(role::text, '') = 'admin' or coalesce(is_superadmin, false) or 'conteudo' = any(coalesce(features, '{}'::text[]))`)
	if err != nil {
		return nil, err
	}
	ids, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	podem := map[string]bool{}
	for _, id := range ids {
		podem[id] = true
	}
	var out []webpush.Destino
	for _, d := range querem {
		if podem[d.UserID] {
			out = append(out, d)
		}
	}
	return out, nil
}
