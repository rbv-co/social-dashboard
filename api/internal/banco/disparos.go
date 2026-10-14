package banco

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrIncerto: quem atende devolve (embrulhado) quando não sabe se o efeito aconteceu (pedido no ar quando o
// prazo estourou, conexão caída depois de enviar, 502/504 do outro lado). O pedido fica 'incerto' e NUNCA é
// refeito sozinho.
var ErrIncerto = errors.New("disparo: resultado incerto")

// Disparo é um pedido de disparos_pendentes, gravado por public.disparar_robo (migração 00007).
type Disparo struct {
	ID      int64
	Robo    string
	Corpo   json.RawMessage // o p_body do PRIMEIRO disparo que o pedido juntou
	Pedidos int             // quantos disparos o pedido juntou enquanto esperava
}

// AtenderDisparo atende o pedido pendente de `robo`, se houver (no máximo um: os disparos se juntam enquanto
// ninguém atende), rodando `fazer` UMA vez. atendeu = havia pedido e `fazer` rodou.
//
// Antes de pegar: o 'atendendo' há mais de 30 min (quem atendia morreu no meio) vira 'incerto' e NÃO roda de
// novo; o resolvido há mais de 30 dias sai da tabela. Pegar é um comando só, com `for update skip locked`, em
// autocommit: dois atendentes ao mesmo tempo nunca pegam o mesmo pedido. Um disparo que chega enquanto o
// pedido está 'atendendo' abre outro 'pendente' (a mudança feita durante o atendimento pede outro).
//
// Resultado de `fazer`: nil → 'feito'; ErrIncerto, prazo ou cancelamento → 'incerto'; outro erro → 'falhou'
// (o texto vai para disparos_pendentes.erro: quem atende não põe segredo no erro). Nada se repete sozinho:
// quem precisa de nova tentativa espera o próximo disparo ou a própria agenda.
func AtenderDisparo(ctx context.Context, p *pgxpool.Pool, robo string, fazer func(context.Context, Disparo) error) (bool, error) {
	if _, err := p.Exec(ctx, `update disparos_pendentes set situacao = 'incerto', atualizado_em = now(),
		       erro = 'atendimento interrompido: sem resultado em 30 min'
		 where robo = $1::text and situacao = 'atendendo' and atualizado_em < now() - interval '30 minutes'`, robo); err != nil {
		return false, err
	}
	if _, err := p.Exec(ctx, `delete from disparos_pendentes
		 where robo = $1::text and situacao in ('feito', 'falhou', 'incerto') and atualizado_em < now() - interval '30 days'`, robo); err != nil {
		return false, err
	}
	var d Disparo
	var corpo string
	err := p.QueryRow(ctx, `update disparos_pendentes d set situacao = 'atendendo', atualizado_em = now()
		 where d.id = (select id from disparos_pendentes where robo = $1::text and situacao = 'pendente'
		                order by id limit 1 for update skip locked)
		returning d.id, d.robo, d.corpo::text, d.pedidos`, robo).Scan(&d.ID, &d.Robo, &corpo, &d.Pedidos)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	d.Corpo = json.RawMessage(corpo)
	errFazer := fazer(ctx, d)
	situacao := "feito"
	var texto *string
	if errFazer != nil {
		situacao = "falhou"
		if errors.Is(errFazer, ErrIncerto) || errors.Is(errFazer, context.DeadlineExceeded) || errors.Is(errFazer, context.Canceled) {
			situacao = "incerto"
		}
		s := errFazer.Error()
		texto = &s
	}
	// contexto próprio: o prazo da tarefa que estourou dentro de `fazer` não pode deixar a linha em 'atendendo'
	c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
	defer cancela()
	tag, errGravar := p.Exec(c, `update disparos_pendentes set situacao = $2::text, erro = left($3::text, 500), atualizado_em = now()
		 where id = $1::bigint and situacao = 'atendendo'`, d.ID, situacao, texto)
	if errGravar == nil && tag.RowsAffected() == 0 { // passou de 30 min: a reconciliação já a marcou 'incerto' e o resultado se perderia calado
		errGravar = fmt.Errorf("disparo %d: já não estava atendendo (reconciliado como incerto); resultado %q não gravado", d.ID, situacao)
	}
	if errGravar != nil { // a linha fica 'atendendo' e a reconciliação a leva a 'incerto' em 30 min: nunca roda de novo
		errGravar = fmt.Errorf("disparo %d: gravar %q: %w", d.ID, situacao, errGravar)
	}
	return true, errors.Join(errFazer, errGravar)
}
