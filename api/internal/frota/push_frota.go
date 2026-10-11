package frota

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// PushFrota porta supabase/functions/enviar-push-frota (cron 30 10 * * 1-5, robô 'enviar-push-frota'):
// avisa, no celular, quem ainda não fez o checklist do carro de hoje. Quem responde pelo carro é
// quem está com ele (posse aberta em frota_uso); só na falta dela, o dono fixo (D9b).
type PushFrota struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client     // serviço de push; nil = o cliente seguro do webpush
	Agora func() time.Time // nil = time.Now
}

func (pf *PushFrota) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-push-frota", Agenda: "30 10 * * 1-5", Limite: 2 * time.Minute, Executar: pf.Rodar}
}

type veiculo struct{ id, nome, pessoaID string }

func (pf *PushFrota) Rodar(ctx context.Context) error {
	if _, err := webpush.ValidarVAPID(pf.VAPID); err != nil {
		return err
	}
	agora := time.Now
	if pf.Agora != nil {
		agora = pf.Agora
	}
	hojeT := agora().In(saoPaulo)
	hoje := hojeT.Format("2006-01-02")
	desde := hojeT.AddDate(0, 0, -120).Format("2006-01-02") // acha a última semanal/mensal de cada carro

	// Toda consulta de que a decisão depende é conferida: falhou, a tarefa falha (nada sai com dado pela metade).
	var cfg Config
	err := pf.Pool.QueryRow(ctx, `select dia_semanal, semana_mensal, dia_mensal from frota_checklist_config limit 1`).
		Scan(&cfg.DiaSemanal, &cfg.SemanaMensal, &cfg.DiaMensal)
	semConfig := errors.Is(err, pgx.ErrNoRows)
	if err != nil && !semConfig {
		return fmt.Errorf("configuração: %w", err)
	}
	linhas, err := pf.Pool.Query(ctx, `select cadencia, ordem, ativo from frota_checklist_itens order by ordem`)
	if err != nil {
		return fmt.Errorf("itens do checklist: %w", err)
	}
	itens, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (i Item, err error) { return i, r.Scan(&i.Cadencia, &i.Ordem, &i.Ativo) })
	if err != nil {
		return fmt.Errorf("itens do checklist: %w", err)
	}
	if semConfig || len(itens) == 0 {
		slog.Info("push da frota: sem lista ou sem configuração — não envio com dado incompleto")
		return nil
	}
	inscritos, err := webpush.Destinatarios(ctx, pf.Pool, "frota", "")
	if err != nil {
		return fmt.Errorf("aparelhos inscritos: %w", err)
	}
	if len(inscritos) == 0 {
		slog.Info("push da frota: ninguém ligou este aviso ainda")
		return nil
	}
	linhas, err = pf.Pool.Query(ctx, `select v.id::text, v.nome,
			coalesce((select u.pessoa_id::text from frota_uso u
			   where u.veiculo_id = v.id and u.tipo = 'posse' and u.volta_em is null and u.pessoa_id is not null
				   order by u.saida_em desc, u.id limit 1), v.pessoa_id::text)
		  from frota_veiculos v
		 where v.pessoa_id is not null and v.situacao = 'ativo'
		   and not exists (select 1 from frota_checklist f where f.veiculo_id = v.id and f.feita_em = $1::date)
		 order by v.nome`, hoje)
	if err != nil {
		return fmt.Errorf("quem está com cada carro: %w", err)
	}
	devendo, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (v veiculo, err error) { return v, r.Scan(&v.id, &v.nome, &v.pessoaID) })
	if err != nil {
		return fmt.Errorf("quem está com cada carro: %w", err)
	}
	pessoas, err := carregarPessoas(ctx, pf.Pool)
	if err != nil {
		return err
	}
	usuarios, err := carregarUsuarios(ctx, pf.Pool)
	if err != nil {
		return err
	}
	var total webpush.Resultado
	var semAviso, semEntrega []string
	for _, v := range devendo {
		var us, um *string
		if err := pf.Pool.QueryRow(ctx, `select
			  to_char(max(feita_em) filter (where 'semanal' = any(cadencias)), 'YYYY-MM-DD'),
			  to_char(max(feita_em) filter (where 'mensal' = any(cadencias)), 'YYYY-MM-DD')
			from frota_checklist where veiculo_id = $1::uuid and feita_em >= $2::date`, v.id, desde).Scan(&us, &um); err != nil {
			return fmt.Errorf("fichas de checklist: %w", err)
		}
		cad := cadenciasDoDia(hoje, cfg, deref(us), deref(um))
		if len(cad) == 0 {
			continue // fim de semana
		}
		pessoa := pessoas[v.pessoaID]
		uid := loginDaPessoa(pessoa, usuarios)
		if uid == "" {
			if pessoa != nil && !slices.Contains(semAviso, pessoa.Nome) {
				semAviso = append(semAviso, pessoa.Nome)
			}
			continue
		}
		var dela []webpush.Destino
		for _, s := range inscritos {
			if s.UserID == uid {
				dela = append(dela, s)
			}
		}
		if len(dela) == 0 {
			continue
		}
		titulo, corpo := montarAviso(v.nome, len(itensDaFicha(itens, cad)), cad)
		// Um aviso por carro, independentes entre si: tag por carro (o de amanhã, ainda não lido, substitui o de
		// hoje). O livro leva o DIA e o carro; o endereço do aparelho entra no Entregar.
		r, err := webpush.Entregar(ctx, pf.Pool, pf.HTTP, dela, carga(Aviso{titulo, corpo, "/frota"}, "frota-checklist-"+v.id),
			pf.VAPID, "enviar-push-frota:"+hoje+":"+v.id)
		if err != nil {
			return err
		}
		total.Enviados += r.Enviados
		total.Podados += r.Podados
		total.Repetidos += r.Repetidos
		total.Falhas += r.Falhas
		// Cada carro avisa uma pessoa diferente: um carro cujos aparelhos todos falharam (nenhum aviso entregue) é
		// erro da tarefa, ainda que os outros tenham saído. Vários aparelhos da MESMA pessoa com um ruim: tolerado
		// (ela recebeu). Aparelho morto podado (410) e reenvio repetido não são falha; um aparelho já avisado numa
		// rodada anterior do dia (Repetido) conta como entregue, senão a reexecução manual ficaria vermelha. A tarefa
		// avisa todos os carros antes de falhar.
		if r.Falhas > 0 && r.Enviados+r.Repetidos == 0 {
			semEntrega = append(semEntrega, v.nome)
		}
	}
	// Quem devia hoje e não tem login sai NOMEADO no LOG (a edge o punha também na resposta, que aqui não existe:
	// a tarefa só devolve erro ou nada). O defeito antigo era pular calado; no log ele aparece com o nome.
	slog.Info("push da frota", "hoje", hoje, "enviados", total.Enviados, "podados", total.Podados,
		"repetidos", total.Repetidos, "falhas", total.Falhas, "sem_aviso", semAviso)
	if len(semEntrega) > 0 {
		return fmt.Errorf("nenhum_push_entregue: %d carro(s) sem aviso entregue (%s): %d falhas", len(semEntrega), strings.Join(semEntrega, ", "), total.Falhas)
	}
	return nil
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func carregarPessoas(ctx context.Context, p *pgxpool.Pool) (map[string]*Pessoa, error) {
	linhas, err := p.Query(ctx, `select id::text, nome, coalesce(profile_id::text, ''), coalesce(email_corporativo, '') from acessos_pessoas`)
	if err != nil {
		return nil, fmt.Errorf("pessoas: %w", err)
	}
	ps, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (x Pessoa, err error) {
		return x, r.Scan(&x.ID, &x.Nome, &x.ProfileID, &x.EmailCorporativo)
	})
	if err != nil {
		return nil, fmt.Errorf("pessoas: %w", err)
	}
	m := map[string]*Pessoa{}
	for i := range ps {
		m[ps[i].ID] = &ps[i]
	}
	return m, nil
}

func carregarUsuarios(ctx context.Context, p *pgxpool.Pool) ([]Usuario, error) {
	linhas, err := p.Query(ctx, `select id::text, coalesce(email, '') from profiles`)
	if err != nil {
		return nil, fmt.Errorf("usuários do app: %w", err)
	}
	us, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (u Usuario, err error) { return u, r.Scan(&u.ID, &u.Email) })
	if err != nil {
		return nil, fmt.Errorf("usuários do app: %w", err)
	}
	return us, nil
}
