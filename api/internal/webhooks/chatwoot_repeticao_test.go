package webhooks

import (
	"strings"
	"sync"
	"testing"
)

// Plano 04 (C): o mesmo evento do Chatwoot entregue em paralelo e fora de ordem grava uma linha por
// (conversa, tipo); os tipos não dependem da ordem; o opt-out repetido não duplica.
func TestChatwootRepeticaoEmParaleloEOrdemTrocada(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	var wg sync.WaitGroup
	var mu sync.Mutex
	falhas := 0
	for range 12 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead); w.Code != 200 {
				mu.Lock()
				falhas++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if falhas != 0 || contar(t, p, `select count(*) from chatwoot_eventos where conversation_id = 555`) != 1 {
		t.Fatalf("falhas=%d linhas=%d", falhas, contar(t, p, `select count(*) from chatwoot_eventos`))
	}
	// ordem trocada: o qualificado (já gravado acima) vem antes do lead novo da MESMA conversa: ambos contam.
	novo := strings.Replace(lead, `"qualified_lead"`, `"lead_novo"`, 1)
	if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, novo); w.Code != 200 {
		t.Fatalf("lead_novo atrasado: %d %s", w.Code, w.Body)
	}
	if n := contar(t, p, `select count(*) from chatwoot_eventos where conversation_id = 555`); n != 2 {
		t.Fatalf("linhas = %d, esperava 2 (um por tipo)", n)
	}
	// opt-out repetido: uma linha só.
	parar := `{"event":"message_created","message_type":"incoming","content":"PARAR","sender":{"phone_number":"+5511987654321"}}`
	for range 3 {
		if w := postCW(h, "/receber-opt-out-chatwoot", segredoCW, parar); w.Code != 200 {
			t.Fatalf("opt-out: %d", w.Code)
		}
	}
	if n := contar(t, p, `select count(*) from contatos_sem_mensagem`); n != 1 {
		t.Fatalf("opt-outs = %d", n)
	}
}
