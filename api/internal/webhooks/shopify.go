// Package webhooks: os receptores públicos (Shopify, direto ou pelo fan-out do core, e
// Chatwoot). Autenticação por assinatura/segredo, nunca por sessão; o efeito e a marca de
// "já recebido" andam na mesma transação.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	limiteShopify  = 5 << 20 // pedido grande da Shopify cabe com folga
	limiteEventoID = 256
)

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// assinaturaShopify confere X-Shopify-Hmac-Sha256 (base64 do HMAC-SHA256 do corpo CRU) contra
// QUALQUER um dos segredos, em tempo constante. Sem segredo, sem corpo ou sem cabeçalho: falso.
func assinaturaShopify(segredos []string, corpo []byte, cabecalho string) bool {
	recebida, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cabecalho))
	if err != nil || len(recebida) == 0 || len(corpo) == 0 {
		return false
	}
	ok := false
	for _, s := range segredos {
		if s == "" {
			continue
		}
		m := hmac.New(sha256.New, []byte(s))
		m.Write(corpo)
		if hmac.Equal(m.Sum(nil), recebida) {
			ok = true // sem sair cedo: o tempo não diz qual segredo bateu
		}
	}
	return ok
}

// Shopify recebe os três webhooks da Shopify. Segredos: o do admin da loja, o do app e o do
// destino cadastrado no fan-out do core (CORE_SHOPIFY_DESTINOS), que reassina o corpo cru.
type Shopify struct {
	Pool     *pgxpool.Pool
	Segredos []string
}

type processar func(ctx context.Context, tx pgx.Tx, topico string, corpo map[string]any, cru []byte) (int, any, error)

func (s *Shopify) receber(w http.ResponseWriter, r *http.Request, origem string, fn processar) {
	if r.Method != http.MethodPost {
		responder(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	cru, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limiteShopify))
	if err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			responder(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "corpo_grande_demais"})
		} else {
			responder(w, http.StatusBadRequest, map[string]string{"error": "corpo_ilegivel"})
		}
		return
	}
	if !assinaturaShopify(s.Segredos, cru, r.Header.Get("X-Shopify-Hmac-Sha256")) {
		responder(w, http.StatusUnauthorized, map[string]string{"error": "nao_autorizado"})
		return
	}
	eventoID := strings.TrimSpace(r.Header.Get("X-Shopify-Event-Id"))
	if len(eventoID) > limiteEventoID {
		responder(w, http.StatusBadRequest, map[string]string{"error": "event_id_invalido"})
		return
	}
	var corpo map[string]any
	d := json.NewDecoder(bytes.NewReader(cru))
	d.UseNumber()
	if d.Decode(&corpo) != nil || corpo == nil {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": "json_invalido"}) // repetir não conserta
		return
	}
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		slog.Error("webhook shopify: falha ao abrir transação", "origem", origem, "erro", erroSemDados(err))
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	defer tx.Rollback(ctx)
	if eventoID != "" {
		tag, err := tx.Exec(ctx, `insert into webhooks_recebidos (origem, evento_id) values ($1, $2) on conflict do nothing`, origem, eventoID)
		if err != nil {
			slog.Error("webhook shopify: falha ao marcar o evento", "origem", origem, "erro", erroSemDados(err))
			responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
			return
		}
		if tag.RowsAffected() == 0 {
			responder(w, http.StatusOK, map[string]any{"ok": true, "duplicado": true})
			return
		}
	}
	status, resposta, err := fn(ctx, tx, r.Header.Get("X-Shopify-Topic"), corpo, cru)
	if err == nil {
		err = tx.Commit(ctx)
	}
	var pg *pgconn.PgError
	if errors.As(err, &pg) && strings.HasPrefix(pg.Code, "22") {
		// Dado que a reentrega não conserta (data inválida, \u0000 no JSON...): como a edge, 200 com log.
		slog.Error("webhook shopify: dado inválido, descartado", "origem", origem, "erro", erroSemDados(err))
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": "dado_invalido"})
		return
	}
	if err != nil {
		// 500: o core (ou a Shopify) reentrega com recuo; os efeitos são idempotentes.
		slog.Error("webhook shopify: falha ao gravar", "origem", origem, "erro", erroSemDados(err))
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	responder(w, status, resposta)
}

// texto: string não vazia (sem espaços nas pontas) ou nil.
func texto(v any) *string {
	s, ok := v.(string)
	if s = strings.TrimSpace(s); !ok || s == "" {
		return nil
	}
	return &s
}

func mapa(v any) map[string]any { m, _ := v.(map[string]any); return m }

// inteiro: json.Number inteiro e seguro (Number.isSafeInteger do JS), maior que zero.
func inteiro(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil && i > 0 && i <= 1<<53-1
}

// Pedido é POST /receber-webhook-pedido-shopify (orders/create, orders/paid, orders/updated):
// upsert em shopify_pedidos por id (pedidoDoPayload de _shared/pedido-shopify.js).
func (s *Shopify) Pedido(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:pedido", func(ctx context.Context, tx pgx.Tx, _ string, c map[string]any, cru []byte) (int, any, error) {
		id, ok := inteiro(c["id"])
		criado := texto(c["created_at"])
		if !ok || criado == nil {
			return http.StatusOK, map[string]any{"ok": true, "ignorado": "payload sem id ou sem created_at"}, nil
		}
		numero := texto(c["name"])
		if numero == nil {
			if n, ok := c["order_number"].(json.Number); ok {
				v := "#" + n.String()
				numero = &v
			}
		}
		total := "0" // Number(x) || 0 do JS: lixo, NaN e infinito viram 0
		if f, ok := numero64(textoCru(c["total_price"])); ok {
			total = strconv.FormatFloat(f, 'f', -1, 64)
		}
		moeda, status := "BRL", "pending"
		if m := texto(c["currency"]); m != nil {
			moeda = *m
		}
		if f := texto(c["financial_status"]); f != nil {
			status = *f
		}
		cli := mapa(c["customer"])
		var partes []string
		for _, k := range []string{"first_name", "last_name"} {
			if v, _ := cli[k].(string); v != "" {
				partes = append(partes, v)
			}
		}
		var nome *string
		if len(partes) > 0 {
			n := strings.Join(partes, " ")
			nome = &n
		}
		email, _ := cli["email"].(string)
		var emailP *string
		if email != "" {
			emailP = &email
		}
		_, err := tx.Exec(ctx, `insert into shopify_pedidos
			  (id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto, atualizado_em)
			values ($1, $2, 205512275, coalesce(nullif($3::text, '')::numeric, 0), $4, $5, $6, $7, $8::text::timestamptz, $9::text::jsonb, now())
			on conflict (id) do update set numero = excluded.numero, loja_id = excluded.loja_id, total = excluded.total,
			  moeda = excluded.moeda, status_financeiro = excluded.status_financeiro, cliente_nome = excluded.cliente_nome,
			  cliente_email = excluded.cliente_email, criado_em_shopify = excluded.criado_em_shopify, bruto = excluded.bruto,
			  atualizado_em = now()`, id, numero, total, moeda, status, nome, emailP, *criado, string(cru))
		return http.StatusOK, map[string]any{"ok": true}, err
	})
}

// Checkout é POST /receber-webhook-checkout (checkouts/create): só o cart_token vai para
// carrinho_eventos (corte de dado pessoal; e-mail e telefone ficam de fora de propósito).
func (s *Shopify) Checkout(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:checkout", func(ctx context.Context, tx pgx.Tx, _ string, c map[string]any, _ []byte) (int, any, error) {
		token := texto(c["cart_token"]) // nulo é válido: a coluna aceita e a tela de leads conta a linha
		id := strings.TrimSpace(r.Header.Get("X-Shopify-Event-Id"))
		var evento *string
		if id != "" {
			evento = &id
		}
		_, err := tx.Exec(ctx, `insert into carrinho_eventos (tipo, cart_token, evento_shopify_id)
			values ('checkout_iniciado', $1, $2) on conflict do nothing`, token, evento)
		return http.StatusOK, map[string]any{"ok": true}, err
	})
}

// Abandono é POST /receber-webhook-abandono (checkouts/create|update, orders/create|paid|cancelled):
// a fila de checkout abandonado E a mensagem de pedido recebido, pelas funções SQL que o banco
// restaurado já tem. As duas rodam na mesma transação: falhou uma, 500 e a reentrega refaz as
// duas (ambas idempotentes).
func (s *Shopify) Abandono(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:abandono", func(ctx context.Context, tx pgx.Tx, topico string, c map[string]any, _ []byte) (int, any, error) {
		dc, dp := decidir(topico, c), decidirPedido(topico, c)
		if err := aplicar(ctx, tx, dc); err != nil {
			return 0, nil, err
		}
		if err := aplicar(ctx, tx, dp); err != nil {
			return 0, nil, err
		}
		if dc.acao == "ignorar" { // como a edge: sem falha, a resposta é a do checkout
			return http.StatusOK, map[string]any{"ok": true, "ignorado": dc.motivo}, nil
		}
		return http.StatusOK, map[string]any{"ok": true}, nil
	})
}

var errAcaoDesconhecida = errors.New("webhook: ação desconhecida")
