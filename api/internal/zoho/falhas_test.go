package zoho

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type zohoDeFalha struct {
	refreshes, listagens atomic.Int32
	listar               func(w http.ResponseWriter, r *http.Request, n int32)
	atrasoRefresh        time.Duration
}

func (z *zohoDeFalha) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	io.Copy(io.Discard, r.Body)
	if strings.HasSuffix(r.URL.Path, "/oauth/v2/token") {
		n := z.refreshes.Add(1)
		time.Sleep(z.atrasoRefresh)
		io.WriteString(w, `{"access_token":"tok-`+string(rune('0'+n))+`"}`)
		return
	}
	z.listar(w, r, z.listagens.Add(1))
}

func novoDeFalha(t *testing.T, listar func(http.ResponseWriter, *http.Request, int32)) (*Cliente, Conexao, *zohoDeFalha) {
	t.Helper()
	f := &zohoDeFalha{listar: listar}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return ParaTeste(t, nil, srv.URL), Conexao{clientID: "id", clientSecret: "seg-secreto", refreshToken: "ref-secreto", sufixo: ".com"}, f
}

// Plano 04 (D): 20 chamadas simultâneas com o token vencido fazem UM refresh.
func TestRefreshConcorrenteFazUmSo(t *testing.T) {
	c, con, f := novoDeFalha(t, func(w http.ResponseWriter, r *http.Request, n int32) { io.WriteString(w, `{"data":[]}`) })
	f.atrasoRefresh = 50 * time.Millisecond
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := c.Listar(context.Background(), con, "pasta"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if n := f.refreshes.Load(); n != 1 {
		t.Fatalf("refreshes = %d, esperava 1", n)
	}
}

// Plano 04 (D): o token vence no meio da operação (a 1ª listagem volta 401, ou F7003 com 200/400): renova UMA vez
// e a operação conclui; se o novo token também for recusado, erro (sem laço).
func TestTokenVencidoNoMeioRenovaUmaVez(t *testing.T) {
	for nome, recusa := range map[string]func(http.ResponseWriter){
		"401":   func(w http.ResponseWriter) { w.WriteHeader(401) },
		"F7003": func(w http.ResponseWriter) { w.WriteHeader(400); io.WriteString(w, `{"errors":[{"id":"F7003"}]}`) },
	} {
		t.Run(nome, func(t *testing.T) {
			c, con, f := novoDeFalha(t, func(w http.ResponseWriter, r *http.Request, n int32) {
				if n == 1 {
					recusa(w)
					return
				}
				io.WriteString(w, `{"data":[{"id":"a","attributes":{"name":"x.png","is_folder":false}}]}`)
			})
			itens, err := c.Listar(context.Background(), con, "pasta")
			if err != nil || len(itens) != 1 || f.refreshes.Load() != 2 {
				t.Fatalf("itens=%d err=%v refreshes=%d", len(itens), err, f.refreshes.Load())
			}
		})
	}
	c, con, f := novoDeFalha(t, func(w http.ResponseWriter, r *http.Request, n int32) { w.WriteHeader(401) })
	if _, err := c.Listar(context.Background(), con, "pasta"); err == nil || f.refreshes.Load() != 2 || f.listagens.Load() != 2 {
		t.Fatalf("token sempre recusado: err=%v refreshes=%d listagens=%d (esperava erro, 2 e 2)", err, f.refreshes.Load(), f.listagens.Load())
	}
}

// Plano 04 (A): cada falha da API do Zoho vira erro (nunca lista vazia), sem repetir (leitura, mas a decisão
// de repetir é de quem chama), e o erro não leva segredo nem endereço.
func TestZohoFalhasDaListagemViramErroSemVazar(t *testing.T) {
	casos := map[string]func(http.ResponseWriter, *http.Request){
		"429": func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "30"); w.WriteHeader(429) },
		"500": func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(500)
			io.WriteString(w, "ref-secreto seg-secreto")
		},
		"404":               func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) },
		"200 JSON truncado": func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"data":[{"id":"a"`) },
		"200 HTML":          func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `<html>`) },
		"200 sem data":      func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"mensagem":"ok"}`) },
		"200 data é texto":  func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"data":"nenhum"}`) },
		"conexão cortada":   func(w http.ResponseWriter, r *http.Request) { c, _, _ := w.(http.Hijacker).Hijack(); c.Close() },
	}
	for nome, serve := range casos {
		t.Run(nome, func(t *testing.T) {
			c, con, f := novoDeFalha(t, func(w http.ResponseWriter, r *http.Request, n int32) { serve(w, r) })
			itens, err := c.Listar(context.Background(), con, "pasta")
			if err == nil {
				t.Fatalf("a falha virou lista com %d itens", len(itens))
			}
			// o net/http repete sozinho um GET cuja conexão reaproveitada caiu antes da resposta: só é leitura.
			if max := int32(1); f.listagens.Load() > max && !(nome == "conexão cortada" && f.listagens.Load() == 2) {
				t.Errorf("listagens = %d, esperava %d", f.listagens.Load(), max)
			}
			for _, s := range []string{"seg-secreto", "ref-secreto", "tok-1", "127.0.0.1"} {
				if strings.Contains(err.Error(), s) {
					t.Errorf("o erro vaza %q: %s", s, err)
				}
			}
		})
	}
}

// Prazo: o Zoho que nunca responde não prende quem chama além do contexto.
func TestZohoNuncaRespondeRespeitaOContexto(t *testing.T) {
	c, con, _ := novoDeFalha(t, func(w http.ResponseWriter, r *http.Request, n int32) { <-r.Context().Done() })
	ctx, cancela := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancela()
	ini := time.Now()
	if _, err := c.Listar(ctx, con, "pasta"); err == nil || time.Since(ini) > 3*time.Second {
		t.Fatalf("err=%v em %v", err, time.Since(ini))
	}
}
