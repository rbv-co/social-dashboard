package comercial

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// decifrar faz o papel do navegador (RFC 8291 §3.4) com a chave de teste da inscrição (auth = 16 zeros).
func decifrar(t *testing.T, corpo []byte, ua *ecdh.PrivateKey) []byte {
	t.Helper()
	salt, asPub, ct := corpo[:16], corpo[21:86], corpo[86:]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	segredo, _ := ua.ECDH(pub)
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Key(sha256.New, segredo, make([]byte, 16), string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	bloco, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(bloco)
	claro, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("não decifra: %v", err)
	}
	return claro[:len(claro)-1]
}

// pedidosDoConteudo: 09/10 tem 1 (100, ajustado para 90), 2 (50) e 4 (400, nota situação 4 = negada);
// 08/10 tem 3 (70) e 5 (30, mas a nota saiu em 09/10: sai de 08/10 e entra em 09/10).
func pedidosDoConteudo(p core.PedidoBling, n int) (int, string, map[string]string) {
	switch {
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-09":
		return 200, `{"data":[{"id":1,"data":"2026-10-09","total":100,"loja":{"id":205657609}},{"id":"2","data":"2026-10-09","total":"50","loja":{"id":"205657609"}},{"id":4,"data":"2026-10-09","total":400,"loja":{"id":205657609}}]}`, nil
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-08":
		return 200, `{"data":[{"id":3,"data":"2026-10-08","total":70,"loja":{"id":205657609}},{"id":5,"data":"2026-10-08","total":30,"loja":{"id":205657609}}]}`, nil
	}
	return pedidosPorDia(p, n)
}

const notasDoConteudo = `insert into bling_pedido_nota (pedido_id, loja_id, data_pedido, total, nota_situacao, data_da_nota) values
 (4, 205657609, '2026-10-09', 400, 4, null),
 (5, 205657609, '2026-10-08', 30, 5, '2026-10-09')`

func texto1(t *testing.T, pf *pushFalso, ua *ecdh.PrivateKey, caminho string) map[string]string {
	t.Helper()
	corpo := pf.corpos[caminho]
	if corpo == nil {
		t.Fatalf("%s não recebeu nada (%v)", caminho, pf.recebidos)
	}
	claro := decifrar(t, corpo, ua)
	if string(claro) == "{}" || len(claro) == 0 {
		t.Fatalf("payload vazio: %q", claro)
	}
	var m map[string]string
	if err := json.Unmarshal(claro, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestPushVendasConteudoDaNotificacao(t *testing.T) {
	pv, f, pf, p := ambientePush(t, pedidosDoConteudo)
	if _, err := p.Exec(context.Background(), notasDoConteudo); err != nil {
		t.Fatal(err)
	}
	ua := inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	m := texto1(t, pf, ua, "/push/quer")
	// hoje (09/10) = pedidos 1 (R$ 90 corrigido, 3 itens do cache), 2 (R$ 50, 2 itens) e 5 (R$ 30, trazido, 2 itens);
	// o 4 (nota negada) fica de fora. Ontem (08/10) = só o 3 (R$ 70).
	if m["title"] != "\U0001F6CD\uFE0F Vendas de hoje · R$\u00a0170" {
		t.Fatalf("title = %q", m["title"])
	}
	quer := "\U0001F4C8 143% vs ontem · 3 vendas · 7 itens\nDom Pedro · R$\u00a0170 · \U0001F4C8 143%"
	if m["body"] != quer || m["url"] != "/gestao-vista" || m["tag"] != "vendas-do-dia" {
		t.Fatalf("body = %q", m["body"])
	}
	var detalhes []string
	for _, ped := range f.pedidos {
		if strings.HasPrefix(ped.Caminho, "/pedidos/vendas/") {
			detalhes = append(detalhes, strings.TrimPrefix(ped.Caminho, "/pedidos/vendas/"))
		}
	}
	if len(detalhes) != 3 || strings.Contains(","+strings.Join(detalhes, ",")+",", ",1,") || strings.Contains(","+strings.Join(detalhes, ",")+",", ",4,") {
		t.Fatalf("detalhes = %v (esperava 2, 3 e 5)", detalhes)
	}
}

func TestPushVendasConteudoDoModoOntem(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosDoConteudo)
	if _, err := p.Exec(context.Background(), notasDoConteudo); err != nil {
		t.Fatal(err)
	}
	ua := inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	if err := pv.Rodar(context.Background(), "ontem"); err != nil {
		t.Fatal(err)
	}
	// ontem (08/10): só o pedido 3 (o 5 saiu pela data da nota); anteontem (07/10) vazio.
	m := texto1(t, pf, ua, "/push/quer")
	if m["title"] != "\U0001F6CD\uFE0F Vendas de ontem · R$\u00a070" || m["body"] != "\U0001F195 vs anteontem · 1 venda · 2 itens\nDom Pedro · R$\u00a070 · \U0001F195" {
		t.Fatalf("%q / %q", m["title"], m["body"])
	}
}

func TestPushVendasRegrasDeApagarInscricao(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	u := "cccccccc-0000-0000-0000-000000000001"
	for _, c := range []string{"boa", "morta", "nf", "e500", "e503", "e429", "rede"} {
		inscrever(t, p, c, u)
	}
	p.Exec(context.Background(), `insert into push_subs values ('https://example.com/push/ruim', 'nao-e-chave', 'x', $1)`, u)
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	rows, _ := p.Query(context.Background(), `select substring(endpoint from '[^/]+$') from push_subs order by 1`)
	var ficaram []string
	for rows.Next() {
		var c string
		rows.Scan(&c)
		ficaram = append(ficaram, c)
	}
	if got := strings.Join(ficaram, ","); got != "boa,e429,e500,e503,rede,ruim" {
		t.Fatalf("ficaram %s (404 e 410 apagam; 5xx, 429, rede e malformada ficam); recebidos=%v", got, pf.recebidos)
	}
}

func TestPushVendasSemNenhumEnvioAceitoEErro(t *testing.T) {
	pv, _, _, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "e500", "cccccccc-0000-0000-0000-000000000001")
	if err := pv.Rodar(context.Background(), "hoje"); err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
		t.Fatalf("err = %v", err)
	}
	// sem destinatário nenhum não é erro
	pv2, _, _, _ := ambientePush(t, pedidosPorDia)
	if err := pv2.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
}

func TestPushVendasVAPIDRuimFalhaERegistraNoRobo(t *testing.T) {
	pv, f, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	boa := pv.VAPID
	outra := boa
	outra.Publica = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
	casos := map[string]webpush.VAPID{
		"par trocado":      outra,
		"privada ruim":     {Publica: boa.Publica, Privada: "lixo!", Assunto: boa.Assunto},
		"base64 padrão":    {Publica: strings.NewReplacer("-", "+", "_", "/").Replace(boa.Publica) + "=", Privada: boa.Privada, Assunto: boa.Assunto},
		"assunto vazio":    {Publica: boa.Publica, Privada: boa.Privada},
		"assunto inválido": {Publica: boa.Publica, Privada: boa.Privada, Assunto: "teste@exemplo.com"},
	}
	for nome, v := range casos {
		pv.VAPID = v
		if err := pv.Rodar(context.Background(), "hoje"); err == nil {
			t.Errorf("%s: Rodar deveria falhar", nome)
		}
	}
	if len(pf.recebidos) != 0 || f.n() != 0 {
		t.Fatalf("nada podia sair: pushes=%d chamadas ao core=%d", len(pf.recebidos), f.n())
	}
	pv.VAPID = casos["par trocado"]
	if _, err := worker.Novo(p).Rodar(context.Background(), pv.Tarefas()[1]); err != nil {
		t.Fatal(err)
	}
	var ok bool
	var resp string
	if err := p.QueryRow(context.Background(), `select ok, resposta from robos_execucoes where robo = 'enviar-push-vendas-22h'`).Scan(&ok, &resp); err != nil || ok {
		t.Fatalf("ok=%v resp=%q err=%v", ok, resp, err)
	}
	if strings.Contains(resp, boa.Privada) || strings.Contains(resp, boa.Publica) {
		t.Fatalf("resposta traz chave: %q", resp)
	}
}

func TestPushVendasLogNaoTrazSegredo(t *testing.T) {
	var buf bytes.Buffer
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(antigo)
	pv, _, _, p := ambientePush(t, pedidosPorDia)
	u := "cccccccc-0000-0000-0000-000000000001"
	inscrever(t, p, "boa", u)
	inscrever(t, p, "TOKEN-DO-ENDPOINT/rede", u)
	inscrever(t, p, "TOKEN-DO-ENDPOINT/e500", u)
	p.Exec(context.Background(), `insert into push_subs values ('https://example.com/push/TOKEN-DO-ENDPOINT/ruim', 'nao-e-chave', 'x', $1)`, u)
	err := pv.Rodar(context.Background(), "hoje")
	saida := buf.String()
	if err != nil {
		saida += err.Error()
	}
	if !strings.Contains(buf.String(), "inscrição pulada") {
		t.Fatalf("o log deveria registrar o que foi pulado: %s", buf.String())
	}
	for _, segredo := range []string{pv.VAPID.Privada, pv.VAPID.Publica, "TOKEN-DO-ENDPOINT", "example.com/push", "token-do-core"} {
		if strings.Contains(saida, segredo) {
			t.Fatalf("vazou %q:\n%s", segredo, saida)
		}
	}
}
