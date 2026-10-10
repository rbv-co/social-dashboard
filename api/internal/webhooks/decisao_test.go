package webhooks

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func corpoJSON(t *testing.T, s string) map[string]any {
	t.Helper()
	var m map[string]any
	d := json.NewDecoder(strings.NewReader(s))
	d.UseNumber()
	if err := d.Decode(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func p(s *string) string {
	if s == nil {
		return "-"
	}
	return *s
}

// desenhar: a decisão numa linha, para comparar a decisão inteira (campo a campo).
func desenhar(d decisao) string {
	return fmt.Sprintf("%s|%s|tok=%s|email=%s|tel=%s|nome=%s|total=%s|moeda=%s|url=%s|ped=%d|num=%s|criado=%s",
		d.acao, d.motivo, p(d.token), p(d.email), p(d.telefone), p(d.nome), p(d.total), p(d.moeda), p(d.url), d.pedidoID, p(d.numero), p(d.criadoEm))
}

func ign(motivo string) string {
	return desenhar(decisao{acao: "ignorar", motivo: motivo})
}

// Casos portados de supabase/functions/_shared/abandono-de-checkout.test.mjs.
func TestDecidirAbandono(t *testing.T) {
	casos := []struct{ nome, topico, corpo, quer string }{
		{"checkout com e-mail registra, total numérico", "checkouts/create",
			`{"token":"abc","email":"a@b.com","total_price":"199.90","currency":"BRL","abandoned_checkout_url":"https://loja/recover","customer":{"first_name":"Ana"}}`,
			"registrar||tok=abc|email=a@b.com|tel=-|nome=Ana|total=199.9|moeda=BRL|url=https://loja/recover|ped=0|num=-|criado=-"},
		{"só telefone no endereço conta", "checkouts/update", `{"token":"t","shipping_address":{"phone":"+5511999999999"}}`,
			"registrar||tok=t|email=-|tel=+5511999999999|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"sem contato", "checkouts/create", `{"token":"t","email":"  ","phone":""}`, ign("sem_contato")},
		{"completed_at não é compra", "checkouts/update", `{"token":"t","email":"a@b.com","completed_at":"2026-09-28T10:00:00Z"}`, ign("checkout_concluido")},
		{"completed_at vazio ou falso não é concluído", "checkouts/update", `{"token":"t","email":"a@b.com","completed_at":""}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"completed_at false", "checkouts/update", `{"token":"t","email":"a@b.com","completed_at":false}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido pendente", "orders/create", `{"checkout_token":"zzz","financial_status":"pending"}`, "pagamento_pendente||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido voided", "orders/create", `{"checkout_token":"zzz","financial_status":"voided"}`, "pagamento_pendente||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido sem status", "orders/create", `{"checkout_token":"zzz"}`, "pagamento_pendente||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido pago", "orders/create", `{"checkout_token":"zzz","financial_status":"paid"}`, "comprou||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido autorizado", "orders/create", `{"checkout_token":"zzz","financial_status":"authorized"}`, "comprou||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pedido parcialmente pago", "orders/create", `{"checkout_token":"zzz","financial_status":"partially_paid"}`, "comprou||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"orders/paid sempre compra", "orders/paid", `{"checkout_token":"zzz"}`, "comprou||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"compra leva o contato do pedido (endereço vence cadastro)", "orders/paid",
			`{"checkout_token":"zzz","email":"ana@x.com","customer":{"email":"velho@x.com","phone":"+5511000000000"},"shipping_address":{"phone":"+5519982621828"}}`,
			"comprou||tok=zzz|email=ana@x.com|tel=+5519982621828|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"contact_email e telefone de cobrança", "orders/paid", `{"checkout_token":"zzz","contact_email":"b@x.com","billing_address":{"phone":"+5511988887777"}}`,
			"comprou||tok=zzz|email=b@x.com|tel=+5511988887777|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pago sem checkout mas com contato", "orders/paid", `{"email":"ana@x.com","phone":"+5519982621828","checkout_token":null}`,
			"comprou||tok=-|email=ana@x.com|tel=+5519982621828|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"create pago sem checkout com contato", "orders/create", `{"email":"ana@x.com","financial_status":"paid"}`,
			"comprou||tok=-|email=ana@x.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"pago sem checkout e sem contato", "orders/paid", `{"id":1}`, ign("pedido_sem_checkout")},
		{"pendente sem checkout", "orders/create", `{"email":"ana@x.com","financial_status":"pending"}`, ign("pedido_sem_checkout")},
		{"cancelado sem checkout (mesmo pago, com contato)", "orders/cancelled", `{"email":"ana@x.com","financial_status":"paid"}`, ign("pedido_sem_checkout")},
		{"cancelado reabre", "orders/cancelled", `{"checkout_token":"zzz","financial_status":"paid"}`, "reabrir||tok=zzz|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"token em branco é sem checkout", "orders/paid", `{"checkout_token":"  "}`, ign("pedido_sem_checkout")},
		{"sem token", "checkouts/create", `{"email":"a@b.com"}`, ign("sem_token")},
		{"tópico desconhecido", "products/update", `{"token":"t","email":"a@b.com"}`, ign("topico_nao_tratado")},
		{"total lixo vira nulo", "checkouts/create", `{"token":"t","email":"a@b.com","total_price":"x"}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"total NaN vira nulo", "checkouts/create", `{"token":"t","email":"a@b.com","total_price":"NaN"}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"total infinito vira nulo", "checkouts/create", `{"token":"t","email":"a@b.com","total_price":"Infinity"}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"total numérico", "checkouts/create", `{"token":"t","email":"a@b.com","total_price":12.5}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=12.5|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"endereço vence customer no nome", "checkouts/update", `{"token":"t","email":"a@b.com","customer":{"first_name":"Gabrie"},"shipping_address":{"first_name":"Gabriel"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Gabriel|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"nome cai para billing", "checkouts/update", `{"token":"t","email":"a@b.com","billing_address":{"first_name":"Bia"},"customer":{"first_name":"Ana"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Bia|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"nome cai para customer", "checkouts/update", `{"token":"t","email":"a@b.com","customer":{"first_name":"Ana"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Ana|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"nome completo do endereço", "checkouts/update", `{"token":"t","email":"a@b.com","shipping_address":{"first_name":"Luis","last_name":"Fulano de Tal"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Luis Fulano de Tal|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"nome completo do customer", "checkouts/update", `{"token":"t","email":"a@b.com","customer":{"first_name":"Ana","last_name":"Silva"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Ana Silva|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"sobrenome em branco", "checkouts/update", `{"token":"t","email":"a@b.com","shipping_address":{"first_name":"Luis","last_name":"  "}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Luis|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"só sobrenome", "checkouts/update", `{"token":"t","email":"a@b.com","shipping_address":{"first_name":null,"last_name":"Silva"}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=Silva|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"nomes vazios", "checkouts/update", `{"token":"t","email":"a@b.com","shipping_address":{"first_name":"","last_name":""}}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"telefone do endereço vence customer", "checkouts/update", `{"token":"t","customer":{"phone":"+551100000000"},"shipping_address":{"phone":"+5511999999999"}}`,
			"registrar||tok=t|email=-|tel=+5511999999999|nome=-|total=-|moeda=-|url=-|ped=0|num=-|criado=-"},
		{"moeda de apresentação", "checkouts/create", `{"token":"t","email":"a@b.com","presentment_currency":"USD"}`,
			"registrar||tok=t|email=a@b.com|tel=-|nome=-|total=-|moeda=USD|url=-|ped=0|num=-|criado=-"},
	}
	for _, c := range casos {
		if got := desenhar(decidir(c.topico, corpoJSON(t, c.corpo))); got != c.quer {
			t.Errorf("%s:\n got  %s\n want %s", c.nome, got, c.quer)
		}
	}
}

const pedidoWeb = `{"id":6012345678901,"name":"#1001","source_name":"web","test":false,"created_at":"2026-09-30T15:00:00-03:00","email":"ana@x.com",` +
	`"shipping_address":{"first_name":"Maysa","last_name":"Priscila","phone":"+5519982621828"},"customer":{"first_name":"Ana","last_name":"Velha","phone":"+5511000000000"}}`

// com troca campos do pedido-base (valor JSON cru; "" remove a chave).
func com(t *testing.T, extra map[string]string) map[string]any {
	t.Helper()
	m := corpoJSON(t, pedidoWeb)
	for k, v := range extra {
		if v == "" {
			delete(m, k)
			continue
		}
		var x any
		d := json.NewDecoder(strings.NewReader(v))
		d.UseNumber()
		if err := d.Decode(&x); err != nil {
			t.Fatal(err)
		}
		m[k] = x
	}
	return m
}

// Casos portados de supabase/functions/_shared/pedido-para-mensagem.test.mjs.
func TestDecidirPedido(t *testing.T) {
	reg := func(num, nome, tel string) string {
		return "registrar_pedido||tok=-|email=-|tel=" + tel + "|nome=" + nome + "|total=-|moeda=-|url=-|ped=6012345678901|num=" + num + "|criado=2026-09-30T15:00:00-03:00"
	}
	casos := []struct {
		nome, topico string
		extra        map[string]string
		quer         string
	}{
		{"loja online registra (endereço vence cadastro)", "orders/create", nil, reg("#1001", "Maysa Priscila", "+5519982621828")},
		{"telefone: cadastro", "orders/create", map[string]string{"shipping_address": `{"first_name":"Maysa"}`}, reg("#1001", "Maysa", "+5511000000000")},
		{"telefone: pedido", "orders/create", map[string]string{"shipping_address": `{"first_name":"Maysa"}`, "phone": `"+5521999990000"`}, reg("#1001", "Maysa", "+5521999990000")},
		{"telefone: cobrança vence cadastro", "orders/create", map[string]string{"shipping_address": `{"first_name":"Maysa"}`, "billing_address": `{"phone":"+5531888880000"}`}, reg("#1001", "Maysa", "+5531888880000")},
		{"teste", "orders/create", map[string]string{"test": "true"}, ign("pedido_de_teste")},
		{"pos", "orders/create", map[string]string{"source_name": `"pos"`}, ign("pedido_de_outro_canal")},
		{"rascunho", "orders/create", map[string]string{"source_name": `"shopify_draft_order"`}, ign("pedido_de_outro_canal")},
		{"sem source_name", "orders/create", map[string]string{"source_name": ""}, ign("pedido_de_outro_canal")},
		{"id nulo", "orders/create", map[string]string{"id": "null"}, ign("sem_id")},
		{"id inseguro (acima de 2^53)", "orders/create", map[string]string{"id": "9007199254740993"}, ign("sem_id")},
		{"id fracionário", "orders/create", map[string]string{"id": "1.5"}, ign("sem_id")},
		{"sem telefone", "orders/create", map[string]string{"shipping_address": `{}`, "customer": `{}`}, ign("sem_telefone")},
		{"sem número", "orders/create", map[string]string{"name": "null", "order_number": "null"}, ign("sem_numero")},
		{"número do order_number", "orders/create", map[string]string{"name": "", "order_number": "1002"}, reg("#1002", "Maysa Priscila", "+5519982621828")},
		{"nome nenhum", "orders/create", map[string]string{"shipping_address": `{"phone":"+5519982621828"}`, "customer": `{}`}, reg("#1001", "-", "+5519982621828")},
		{"nome da cobrança", "orders/create", map[string]string{"shipping_address": `{"phone":"+5519982621828"}`, "billing_address": `{"first_name":"Bia"}`}, reg("#1001", "Bia", "+5519982621828")},
		{"cancelado", "orders/cancelled", map[string]string{"id": "55"}, "cancelar_pedido||tok=-|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=55|num=-|criado=-"},
		{"cancelado sem id", "orders/cancelled", map[string]string{"id": ""}, ign("sem_id")},
		{"cancelado ignora canal e teste", "orders/cancelled", map[string]string{"id": "55", "test": "true", "source_name": `"pos"`}, "cancelar_pedido||tok=-|email=-|tel=-|nome=-|total=-|moeda=-|url=-|ped=55|num=-|criado=-"},
		{"orders/paid", "orders/paid", nil, ign("topico_nao_tratado")},
		{"checkouts/update", "checkouts/update", nil, ign("topico_nao_tratado")},
	}
	for _, c := range casos {
		if got := desenhar(decidirPedido(c.topico, com(t, c.extra))); got != c.quer {
			t.Errorf("%s:\n got  %s\n want %s", c.nome, got, c.quer)
		}
	}
}
