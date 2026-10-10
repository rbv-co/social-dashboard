package webpush

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Destino é uma inscrição de push com o dono (push_subs.user_id).
type Destino struct {
	Inscricao
	UserID string
}

// padraoDoTipo: sem linha em push_preferencias vale o padrão do tipo (TIPOS_DE_NOTIFICACAO de
// _shared/notificacoes.js): só 'vendas' nasce ligado. Tipo fora da lista não chega a ninguém.
var padraoDoTipo = map[string]bool{"vendas": true, "saldo": false, "conteudo": false, "frota": false, "frota_reserva": false}

// Destinatarios = inscricoesDoTipo de _shared/notificacoes.js: as inscrições COM dono que querem
// `tipo` (a preferência gravada vence; sem ela, o padrão do tipo). usuario != "" restringe a um dono.
func Destinatarios(ctx context.Context, p *pgxpool.Pool, tipo, usuario string) ([]Destino, error) {
	padrao, ok := padraoDoTipo[tipo]
	if !ok {
		return nil, nil
	}
	linhas, err := p.Query(ctx, `select s.endpoint, s.p256dh, s.auth, s.user_id::text from push_subs s
		where s.user_id is not null and ($3::text = '' or s.user_id::text = $3::text)
		  and coalesce((select pp.ativo from push_preferencias pp where pp.user_id = s.user_id and pp.tipo = $1::text), $2::boolean)
		order by s.endpoint`, tipo, padrao, usuario)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (d Destino, err error) {
		return d, r.Scan(&d.Endpoint, &d.P256dh, &d.Auth, &d.UserID)
	})
}

// Resultado de uma entrega.
type Resultado struct {
	Enviados, Podados, Repetidos, Falhas int
}

// Entregar manda `payload` a cada destino. Antes de cada envio reserva `prefixo:<sha do endpoint>`
// no livro de envios: destino já servido com esse prefixo não recebe de novo (execução repetida =
// Repetidos). 404/410 apaga a inscrição (morta; poda que o banco recusa conta como Falhas). Sem 2xx a
// reserva é desfeita, e a próxima execução pode tentar. A falha de um destino não derruba os outros; o
// erro devolvido é só o do banco.
func Entregar(ctx context.Context, p *pgxpool.Pool, cli *http.Client, alvos []Destino, payload []byte, v VAPID, prefixo string) (Resultado, error) {
	var r Resultado
	for _, d := range alvos {
		h := sha256.Sum256([]byte(d.Endpoint))
		chave := prefixo + ":" + hex.EncodeToString(h[:8]) // o endpoint é um token: não vai inteiro para a chave
		ok, err := banco.ReservarEnvio(ctx, p, chave)
		if err != nil {
			return r, err
		}
		if !ok {
			r.Repetidos++
			continue
		}
		st, err := Enviar(ctx, cli, d.Inscricao, payload, v)
		switch {
		case err != nil:
			slog.Warn("push: inscrição pulada", "erro", err) // o erro do Enviar não traz o endpoint
			r.Falhas++
		case st >= 200 && st < 300:
			r.Enviados++
			continue // a reserva fica: esta mensagem saiu
		case st == http.StatusGone || st == http.StatusNotFound:
			if _, err := p.Exec(ctx, `delete from push_subs where endpoint = $1::text`, d.Endpoint); err != nil {
				slog.Warn("push: não consegui podar a inscrição morta", "erro", err) // o erro do banco não traz o endpoint
				r.Falhas++
			} else {
				r.Podados++
			}
		default:
			slog.Warn("push: o serviço de push recusou", "status", st) // só o código: o endpoint é um token
			r.Falhas++
		}
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		err = banco.LiberarEnvio(c, p, chave)
		cancela()
		if err != nil {
			return r, err
		}
	}
	return r, nil
}
