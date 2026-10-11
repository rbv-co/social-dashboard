package mensagens

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// fila é o que as rodadas pedem ao banco. A implementação de verdade (filaSQL) chama as MESMAS funções
// SQL que a edge chamava por RPC (pegar_para_mensagem, pegar_da_fila, marcar_*, devolver_*,
// liberar_*, agendar_followups, avaliar_trava_cruzada): a reserva com FOR UPDATE SKIP LOCKED e os
// estados (enviando/enviada/falhou/ignorada) continuam no banco. Os testes das rodadas usam uma fila
// de mentira em memória; filaSQL é testada contra funções com as assinaturas de produção.
type fila interface {
	liberarMensagensTravadas(ctx context.Context) error
	pegarParaMensagem(ctx context.Context, limite, atrasoMin int, reservar bool, ultimos11 []string, maxHoras int) ([]LinhaAbandono, error)
	marcarMensagem(ctx context.Context, token, status, motivo string, conversa *int64) error
	devolverMensagem(ctx context.Context, token string, contar bool) error
	liberarTravadasDaFila(ctx context.Context) error
	pegarDaFila(ctx context.Context, tipo string, limite, maxHoras int, reservar bool, ultimos11 []string) ([]LinhaFila, error)
	marcarDaFila(ctx context.Context, tipo, chave, status, motivo string, conversa *int64) error
	devolverDaFila(ctx context.Context, tipo, chave string, contar bool) error
	agendarFollowups(ctx context.Context, aposHoras, tetoHoras int) error
	bloqueados(ctx context.Context, telefones []string) (map[string]bool, error)
	statusDoCheckout(ctx context.Context, token string) (string, error)    // "" = não achou
	travaCruzada(ctx context.Context, telefone, tipo, chave string) string // barrar | esperar | liberar | erro
}

type filaSQL struct{ p *pgxpool.Pool }

// prazoBanco: cada chamada ao banco tem prazo próprio. As rodadas gravam o estado da fila SEM o contexto
// da tarefa (context.WithoutCancel: o prazo da tarefa não pode deixar uma linha "enviando" para sempre), e
// sem este limite uma consulta pendurada seguraria a trava do worker e o robô pararia calado.
// Variável só para o teste encurtá-la.
var prazoBanco = 30 * time.Second

func nulo(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (f filaSQL) liberarMensagensTravadas(ctx context.Context) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select liberar_mensagens_travadas()`)
	return err
}

func (f filaSQL) pegarParaMensagem(ctx context.Context, limite, atrasoMin int, reservar bool, ultimos11 []string, maxHoras int) ([]LinhaAbandono, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	linhas, err := f.p.Query(ctx, `select token, telefone, nome, url_de_recuperacao, status, iniciado_em
		from pegar_para_mensagem(p_limite => $1::int, p_atraso_min => $2::int, p_reservar => $3::boolean, p_ultimos11 => $4::text[], p_max_horas => $5::int)`,
		limite, atrasoMin, reservar, ultimos11, maxHoras)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l LinhaAbandono, err error) {
		return l, r.Scan(&l.Token, &l.Telefone, &l.Nome, &l.URL, &l.Status, &l.IniciadoEm)
	})
}

func (f filaSQL) marcarMensagem(ctx context.Context, token, status, motivo string, conversa *int64) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select marcar_mensagem(p_token => $1::text, p_status => $2::text, p_motivo => $3::text, p_conversa => $4::bigint)`,
		token, status, nulo(motivo), conversa)
	return err
}

func (f filaSQL) devolverMensagem(ctx context.Context, token string, contar bool) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select devolver_mensagem(p_token => $1::text, p_contar => $2::boolean)`, token, contar)
	return err
}

func (f filaSQL) liberarTravadasDaFila(ctx context.Context) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select liberar_travadas_da_fila()`)
	return err
}

func (f filaSQL) pegarDaFila(ctx context.Context, tipo string, limite, maxHoras int, reservar bool, ultimos11 []string) ([]LinhaFila, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	linhas, err := f.p.Query(ctx, `select chave, numero, nome, telefone, url_de_recuperacao, conversa_origem, criado_em
		from pegar_da_fila(p_tipo => $1::text, p_limite => $2::int, p_max_horas => $3::int, p_reservar => $4::boolean, p_ultimos11 => $5::text[])`,
		tipo, limite, maxHoras, reservar, ultimos11)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l LinhaFila, err error) {
		return l, r.Scan(&l.Chave, &l.Numero, &l.Nome, &l.Telefone, &l.URL, &l.ConversaOrigem, &l.CriadoEm)
	})
}

func (f filaSQL) marcarDaFila(ctx context.Context, tipo, chave, status, motivo string, conversa *int64) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select marcar_da_fila(p_tipo => $1::text, p_chave => $2::text, p_status => $3::text, p_motivo => $4::text, p_conversa => $5::bigint)`,
		tipo, chave, status, nulo(motivo), conversa)
	return err
}

func (f filaSQL) devolverDaFila(ctx context.Context, tipo, chave string, contar bool) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select devolver_da_fila(p_tipo => $1::text, p_chave => $2::text, p_contar => $3::boolean)`, tipo, chave, contar)
	return err
}

func (f filaSQL) agendarFollowups(ctx context.Context, aposHoras, tetoHoras int) error {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	_, err := f.p.Exec(ctx, `select agendar_followups(p_apos_horas => $1::int, p_teto_horas => $2::int)`, aposHoras, tetoHoras)
	return err
}

func (f filaSQL) bloqueados(ctx context.Context, telefones []string) (map[string]bool, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	linhas, err := f.p.Query(ctx, `select telefone from contatos_sem_mensagem where telefone = any($1::text[])`, telefones)
	if err != nil {
		return nil, err
	}
	ts, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return nil, err
	}
	m := map[string]bool{}
	for _, t := range ts {
		m[t] = true
	}
	return m, nil
}

func (f filaSQL) statusDoCheckout(ctx context.Context, token string) (string, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	var st string
	err := f.p.QueryRow(ctx, `select status from checkout_abandono where token = $1::text`, token).Scan(&st)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return st, err
}

// travaCruzada (trava-cruzada.js): falha ou resposta desconhecida = 'erro' ("não sei" não libera).
func (f filaSQL) travaCruzada(ctx context.Context, telefone, tipo, chave string) string {
	ctx, cancela := context.WithTimeout(ctx, prazoBanco)
	defer cancela()
	var r *string
	if err := f.p.QueryRow(ctx, `select avaliar_trava_cruzada(p_telefone => $1::text, p_horas => $2::int, p_tipo => $3::text, p_chave => $4::text)`,
		telefone, horasDaTrava, nulo(tipo), nulo(chave)).Scan(&r); err != nil || r == nil {
		return "erro"
	}
	switch *r {
	case "barrar", "esperar", "liberar":
		return *r
	}
	return "erro"
}
