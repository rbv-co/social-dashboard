package webhooks

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// decisao é o que fazer com um webhook (abandono-de-checkout.js e pedido-para-mensagem.js).
type decisao struct {
	acao     string // ignorar | registrar | comprou | pagamento_pendente | reabrir | registrar_pedido | cancelar_pedido
	motivo   string
	token    *string
	email    *string
	telefone *string
	nome     *string
	total    *string // texto numérico (vai como numeric)
	moeda    *string
	url      *string
	pedidoID int64
	numero   *string
	criadoEm *string
}

func primeiroTexto(vs ...any) *string {
	for _, v := range vs {
		if t := texto(v); t != nil {
			return t
		}
	}
	return nil
}

// nomeDe: nome e sobrenome de um bloco (endereço ou customer).
func nomeDe(v any) *string {
	m := mapa(v)
	var partes []string
	for _, k := range []string{"first_name", "last_name"} {
		if t := texto(m[k]); t != nil {
			partes = append(partes, *t)
		}
	}
	if len(partes) == 0 {
		return nil
	}
	s := strings.Join(partes, " ")
	return &s
}

// contato: o que foi digitado no endereço vence o cadastro do cliente.
func telefoneDe(c map[string]any) *string {
	return primeiroTexto(c["phone"], mapa(c["shipping_address"])["phone"], mapa(c["billing_address"])["phone"], mapa(c["customer"])["phone"])
}

var pago = map[string]bool{"paid": true, "authorized": true, "partially_paid": true}

func decidir(topico string, c map[string]any) decisao {
	switch topico {
	case "orders/create", "orders/paid", "orders/cancelled":
		token := texto(c["checkout_token"])
		status, _ := c["financial_status"].(string)
		eraPago := topico == "orders/paid" || pago[status]
		email := primeiroTexto(c["email"], c["contact_email"], mapa(c["customer"])["email"])
		tel := telefoneDe(c)
		if token == nil {
			// Pedido pago sem checkout (admin, WhatsApp) também é compra dessa pessoa.
			if topico != "orders/cancelled" && eraPago && (email != nil || tel != nil) {
				return decisao{acao: "comprou", email: email, telefone: tel}
			}
			return decisao{acao: "ignorar", motivo: "pedido_sem_checkout"}
		}
		if topico == "orders/cancelled" {
			return decisao{acao: "reabrir", token: token} // Pix que expirou: o checkout volta a valer
		}
		if eraPago {
			return decisao{acao: "comprou", token: token, email: email, telefone: tel}
		}
		return decisao{acao: "pagamento_pendente", token: token}
	case "checkouts/create", "checkouts/update":
		token := texto(c["token"])
		if token == nil {
			return decisao{acao: "ignorar", motivo: "sem_token"}
		}
		if c["completed_at"] != nil {
			return decisao{acao: "ignorar", motivo: "checkout_concluido"} // com Pix, concluído ≠ pago
		}
		email := primeiroTexto(c["email"], mapa(c["customer"])["email"])
		tel := telefoneDe(c)
		if email == nil && tel == nil {
			return decisao{acao: "ignorar", motivo: "sem_contato"}
		}
		d := decisao{acao: "registrar", token: token, email: email, telefone: tel,
			nome: nomeDe(c["shipping_address"]), moeda: primeiroTexto(c["currency"], c["presentment_currency"]), url: texto(c["abandoned_checkout_url"])}
		if d.nome == nil {
			d.nome = nomeDe(c["billing_address"])
		}
		if d.nome == nil {
			d.nome = nomeDe(c["customer"])
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(textoCru(c["total_price"])), 64); err == nil {
			v := strconv.FormatFloat(f, 'f', -1, 64)
			d.total = &v
		}
		return d
	}
	return decisao{acao: "ignorar", motivo: "topico_nao_tratado"}
}

func textoCru(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	}
	return ""
}

func decidirPedido(topico string, c map[string]any) decisao {
	if topico != "orders/create" && topico != "orders/cancelled" {
		return decisao{acao: "ignorar", motivo: "topico_nao_tratado"}
	}
	id, ok := inteiro(c["id"])
	if !ok {
		return decisao{acao: "ignorar", motivo: "sem_id"}
	}
	if topico == "orders/cancelled" {
		return decisao{acao: "cancelar_pedido", pedidoID: id}
	}
	if c["test"] == true {
		return decisao{acao: "ignorar", motivo: "pedido_de_teste"}
	}
	if c["source_name"] != "web" {
		return decisao{acao: "ignorar", motivo: "pedido_de_outro_canal"}
	}
	tel := telefoneDe(c)
	if tel == nil {
		return decisao{acao: "ignorar", motivo: "sem_telefone"}
	}
	numero := texto(c["name"])
	if numero == nil {
		if n, ok := inteiro(c["order_number"]); ok {
			v := "#" + strconv.FormatInt(n, 10)
			numero = &v
		}
	}
	if numero == nil {
		return decisao{acao: "ignorar", motivo: "sem_numero"}
	}
	nome := nomeDe(c["shipping_address"])
	if nome == nil {
		nome = nomeDe(c["billing_address"])
	}
	if nome == nil {
		nome = nomeDe(c["customer"])
	}
	return decisao{acao: "registrar_pedido", pedidoID: id, numero: numero, nome: nome, telefone: tel, criadoEm: texto(c["created_at"])}
}

// aplicar chama a função SQL da decisão (argumentos nomeados: não depende da ordem nem de
// sobrecarga). Os ::text:: fazem o banco converter, sem o pgx adivinhar o tipo.
func aplicar(ctx context.Context, tx pgx.Tx, d decisao) error {
	var err error
	switch d.acao {
	case "ignorar":
	case "registrar":
		_, err = tx.Exec(ctx, `select registrar_checkout_abandono(p_token => $1, p_email => $2, p_telefone => $3, p_nome => $4,
			p_total => $5::text::numeric, p_moeda => $6, p_url => $7)`, d.token, d.email, d.telefone, d.nome, d.total, d.moeda, d.url)
	case "comprou":
		_, err = tx.Exec(ctx, `select marcar_checkout_comprou(p_token => $1, p_email => $2, p_telefone => $3)`, d.token, d.email, d.telefone)
	case "pagamento_pendente":
		_, err = tx.Exec(ctx, `select marcar_checkout_pagamento_pendente(p_token => $1)`, d.token)
	case "reabrir":
		_, err = tx.Exec(ctx, `select reabrir_checkout_abandono(p_token => $1)`, d.token)
	case "registrar_pedido":
		_, err = tx.Exec(ctx, `select registrar_pedido_para_mensagem(p_pedido_id => $1, p_numero => $2, p_nome => $3, p_telefone => $4,
			p_criado_em => $5::text::timestamptz)`, d.pedidoID, d.numero, d.nome, d.telefone, d.criadoEm)
	case "cancelar_pedido":
		_, err = tx.Exec(ctx, `select cancelar_mensagem_pedido(p_pedido_id => $1)`, d.pedidoID)
	default:
		err = errAcaoDesconhecida
	}
	return err
}
