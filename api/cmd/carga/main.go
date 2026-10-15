// Comando carga: gerador de carga da API (plano 07 da REVISAO-TESTES-2026-10). Só stdlib.
// Para cada rota e cada nível de concorrência roda um laço fechado (cada trabalhador manda o próximo pedido quando o anterior
// volta) e imprime RPS, p50/p95/p99 e erros em linhas de tabela Markdown.
//
//	carga -base http://172.21.0.3:8080 -rotas rotas.txt -niveis 1,4,16,32 -dur 15s
//
// rotas.txt: uma por linha, "nome|METODO|caminho|corpo" (corpo opcional; # comenta). "{{n}}" no caminho e no corpo vira um
// número único por pedido; corpo "bytes:N" manda um PDF de N bytes (PUT de upload). METODO WEBHOOK = POST de webhook da Shopify
// assinado com CARGA_SHOPIFY_SEGREDO (X-Shopify-Hmac-Sha256 e um X-Shopify-Event-Id novo a cada pedido). O token sai de
// CARGA_TOKEN (nunca por argumento: apareceria no ps). -teto limita o RPS global (protege um host compartilhado).
// Códigos 2xx são sucesso; 429 e 5xx e falha de rede contam como erro; 4xx esperado (ex.: 403) conta à parte.
package main

import (
	"bufio"
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

type rota struct{ nome, metodo, caminho, corpo string }

func lerRotas(arq string) ([]rota, error) {
	f, err := os.Open(arq)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var rs []rota
	for sc := bufio.NewScanner(f); sc.Scan(); {
		l := strings.TrimSpace(sc.Text())
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		p := strings.SplitN(l, "|", 4)
		if len(p) < 3 {
			return nil, fmt.Errorf("linha inválida: %q", l)
		}
		r := rota{p[0], p[1], p[2], ""}
		if len(p) == 4 {
			r.corpo = p[3]
		}
		rs = append(rs, r)
	}
	return rs, nil
}

func montar(r rota, base, tok, segredoShopify string, n int) *http.Request {
	num := strconv.Itoa(n)
	corpo := []byte(strings.ReplaceAll(r.corpo, "{{n}}", num))
	if t, ok := strings.CutPrefix(r.corpo, "bytes:"); ok {
		tam, _ := strconv.Atoi(t)
		corpo = append([]byte("%PDF-1.4\n"), make([]byte, max(tam-9, 0))...)
	}
	metodo := r.metodo
	if metodo == "WEBHOOK" {
		metodo = "POST"
	}
	req, _ := http.NewRequest(metodo, base+strings.ReplaceAll(r.caminho, "{{n}}", num), bytes.NewReader(corpo))
	if tok != "" && r.metodo != "WEBHOOK" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	switch {
	case r.metodo == "WEBHOOK":
		m := hmac.New(sha256.New, []byte(segredoShopify))
		m.Write(corpo)
		req.Header.Set("X-Shopify-Hmac-Sha256", base64.StdEncoding.EncodeToString(m.Sum(nil)))
		req.Header.Set("X-Shopify-Event-Id", fmt.Sprintf("carga-%d-%d", time.Now().UnixNano(), n))
		req.Header.Set("X-Shopify-Topic", "orders/create")
		req.Header.Set("Content-Type", "application/json")
	case strings.HasPrefix(r.corpo, "bytes:"):
		req.Header.Set("Content-Type", "application/pdf")
	case r.corpo != "":
		req.Header.Set("Content-Type", "application/json")
	}
	return req
}

func pct(l []time.Duration, p float64) time.Duration {
	if len(l) == 0 {
		return 0
	}
	return l[min(len(l)-1, int(float64(len(l))*p))]
}

func main() {
	base := flag.String("base", "", "URL base da API")
	arq := flag.String("rotas", "", "arquivo de rotas")
	niveis := flag.String("niveis", "1,4,16", "concorrências, separadas por vírgula")
	dur := flag.Duration("dur", 10*time.Second, "duração de cada nível")
	teto := flag.Int("teto", 0, "teto de RPS global (0 = sem teto)")
	flag.Parse()
	rs, err := lerRotas(*arq)
	if err != nil || *base == "" {
		fmt.Fprintln(os.Stderr, "uso: carga -base URL -rotas arquivo [-niveis 1,4,16] [-dur 10s] [-teto N]", err)
		os.Exit(2)
	}
	tok := os.Getenv("CARGA_TOKEN")
	cli := &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{MaxIdleConnsPerHost: 512, MaxConnsPerHost: 512}}
	fmt.Println("| rota | conc | RPS | p50 | p95 | p99 | máx | ok | 4xx | erros |\n|---|---|---|---|---|---|---|---|---|---|")
	for _, r := range rs {
		for _, ns := range strings.Split(*niveis, ",") {
			n, _ := strconv.Atoi(ns)
			var mu sync.Mutex
			var lat []time.Duration
			var ok, c4, erros, seq atomic.Int64
			var freio <-chan time.Time
			if *teto > 0 {
				freio = time.NewTicker(time.Second / time.Duration(*teto)).C
			}
			fim := time.Now().Add(*dur)
			var wg sync.WaitGroup
			for range n {
				wg.Add(1)
				go func() {
					defer wg.Done()
					var local []time.Duration
					for time.Now().Before(fim) {
						if freio != nil {
							<-freio
						}
						req := montar(r, *base, tok, os.Getenv("CARGA_SHOPIFY_SEGREDO"), int(seq.Add(1)))
						t0 := time.Now()
						resp, err := cli.Do(req)
						if err == nil {
							io.Copy(io.Discard, resp.Body)
							resp.Body.Close()
						}
						d := time.Since(t0)
						switch {
						case err != nil || resp.StatusCode == 429 || resp.StatusCode >= 500:
							erros.Add(1)
						case resp.StatusCode >= 400:
							c4.Add(1)
						default:
							ok.Add(1)
							local = append(local, d)
						}
					}
					mu.Lock()
					lat = append(lat, local...)
					mu.Unlock()
				}()
			}
			t0 := time.Now()
			wg.Wait()
			slices.Sort(lat)
			fmt.Printf("| %s | %d | %.0f | %s | %s | %s | %s | %d | %d | %d |\n", r.nome, n, float64(ok.Load())/time.Since(t0).Seconds(),
				pct(lat, .5).Round(time.Microsecond*100), pct(lat, .95).Round(time.Microsecond*100), pct(lat, .99).Round(time.Microsecond*100),
				pct(lat, 1).Round(time.Microsecond*100), ok.Load(), c4.Load(), erros.Load())
		}
	}
}
