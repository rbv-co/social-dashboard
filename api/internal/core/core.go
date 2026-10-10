// Package core fala com o `core` (Laravel; dono do Bling, da Shopify e do token da Meta).
// A API NUNCA chama Bling nem Meta direto: o core guarda os tokens, o gate de 3 req/s por
// conta do Bling e a idempotência. Contrato (repo vessel-core-go, services/core):
// docs/migracao-core/PROXY-BLING.md, API-META.md e app/Http/Controllers/BlingProxyController.php.
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

const (
	CaminhoBling = "/api/interno/bling/proxy"
	CaminhoMeta  = "/api/interno/meta/graph"
)

// limiteResposta: nenhuma resposta legítima do core passa disso (var para o teste baixar).
var limiteResposta int64 = 32 << 20

// ErrSemToken: CORE_API_TOKEN não configurado; nada é enviado.
var ErrSemToken = errors.New("core: CORE_API_TOKEN ausente")

type Cliente struct {
	URL       string // sem barra no fim
	Token     string
	HTTP      *http.Client
	Prazo     time.Duration                                    // por tentativa no Bling; 0 = 11 s
	Orcamento time.Duration                                    // da chamada inteira no Bling; 0 = 25 s
	Dormir    func(ctx context.Context, d time.Duration) error // nil = espera de verdade (o teste troca)
}

// Novo devolve um cliente que não segue redirecionamento (o Bearer não sai para outro lugar).
func Novo(url, token string) *Cliente {
	return &Cliente{URL: url, Token: token, HTTP: &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Resposta é o que o core devolveu, cru.
type Resposta struct {
	Status     int
	Corpo      []byte
	RetryAfter string // cabeçalho cru (segundos)
	Origem     string // X-Core-Origem: "bling" = repassado do Bling; "proxy" = erro do core; "" = autenticação/nginx
}

// PedidoBling é o corpo de POST /api/interno/bling/proxy. Este plano só lê (GET).
type PedidoBling struct {
	Metodo  string         `json:"metodo"`
	Caminho string         `json:"caminho"` // começa com "/" (ex.: /pedidos/vendas)
	Query   map[string]any `json:"query,omitempty"`
}

// PedidoMeta é o corpo de POST /api/interno/meta/graph.
type PedidoMeta struct {
	Caminho     string         `json:"caminho"`
	Metodo      string         `json:"metodo"`
	Parametros  map[string]any `json:"parametros"`
	ImagemURL   string         `json:"imagem_url,omitempty"`
	ImagemCampo string         `json:"imagem_campo,omitempty"`
	VideoURL    string         `json:"video_url,omitempty"`
}

// SemResposta: nenhuma tentativa teve resposta do core (prazo ou rede). Error() é a frase
// que a tela mostra (fraseDeDesistencia de _shared/tentar-de-novo.js).
type SemResposta struct {
	Causa      string
	Tentativas int
}

func (e *SemResposta) Error() string {
	vez := "vezes"
	if e.Tentativas == 1 {
		vez = "vez"
	}
	return fmt.Sprintf("Não consegui falar com o Bling agora (%s). Tentei %d %s. Tente de novo em instantes; se continuar, o Bling está fora do ar.", e.Causa, e.Tentativas, vez)
}

// enviar faz UMA chamada. Erro = sem resposta (rede, prazo, ctx). O token vai só no
// cabeçalho: o erro do http (método + URL + causa) nunca o contém.
func (c *Cliente) enviar(ctx context.Context, caminho string, corpo any) (*Resposta, error) {
	if c.Token == "" {
		return nil, ErrSemToken
	}
	b, err := json.Marshal(corpo)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+caminho, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	cli := c.HTTP
	if cli == nil {
		cli = http.DefaultClient
	}
	r, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	lido, err := io.ReadAll(io.LimitReader(r.Body, limiteResposta+1))
	if err != nil {
		return nil, err
	}
	if int64(len(lido)) > limiteResposta {
		return nil, errors.New("core: resposta grande demais")
	}
	return &Resposta{Status: r.StatusCode, Corpo: lido, RetryAfter: r.Header.Get("Retry-After"), Origem: r.Header.Get("X-Core-Origem")}, nil
}

func (c *Cliente) dormir(ctx context.Context, d time.Duration) error {
	if c.Dormir != nil {
		return c.Dormir(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func retryAfter(r *Resposta) time.Duration {
	if r == nil {
		return 0
	}
	s, err := strconv.Atoi(r.RetryAfter)
	if err != nil || s <= 0 {
		return 0
	}
	return time.Duration(s) * time.Second
}

// Bling chama o proxy do Bling. GET repete o que é falha do lado de lá (429, 5xx, sem
// resposta) com recuo e dentro do orçamento (`decidir`); qualquer outro método sai UMA vez
// (escrita repetida duplicaria movimento). Erro *SemResposta = nenhuma tentativa respondeu.
func (c *Cliente) Bling(ctx context.Context, p PedidoBling) (*Resposta, error) {
	prazo, orc := c.Prazo, c.Orcamento
	if prazo == 0 {
		prazo = 11 * time.Second
	}
	if orc == 0 {
		orc = 25 * time.Second
	}
	comeco := time.Now()
	causa := "o Bling não respondeu"
	for tentativa := 1; ; tentativa++ {
		ctxT, cancela := context.WithTimeout(ctx, prazo)
		r, err := c.enviar(ctxT, CaminhoBling, p)
		cancela()
		if errors.Is(err, ErrSemToken) || (err != nil && ctx.Err() != nil) {
			return nil, err
		}
		status := 0
		if err != nil {
			causa = "o Bling não respondeu no prazo"
		} else {
			status = r.Status
			if status >= 400 {
				causa = fmt.Sprintf("o Bling respondeu %d", status)
			}
		}
		d := decisao{motivo: "escrita não se repete"}
		if p.Metodo == http.MethodGet {
			d = decidir(tentativa, status, time.Since(comeco), retryAfter(r), prazo, orc)
		}
		if !d.repetir {
			if err != nil {
				return nil, &SemResposta{Causa: causa, Tentativas: tentativa}
			}
			return r, nil
		}
		slog.Warn("core bling: repetindo", "caminho", p.Caminho, "tentativa", tentativa, "motivo", d.motivo, "espera", d.esperar)
		if err := c.dormir(ctx, d.esperar); err != nil {
			return nil, err
		}
	}
}

// Meta chama a Graph pelo core. Só repete 429 do core (recuo por uso alto: nada chegou à
// Meta), esperando o Retry-After (padrão 5 s, teto 30 s), até `tentativas`. 5xx, rede e
// prazo NÃO se repetem: POST repetido duplicaria campanha. O prazo é o do ctx.
func (c *Cliente) Meta(ctx context.Context, p PedidoMeta, tentativas int) (*Resposta, error) {
	if p.Parametros == nil {
		p.Parametros = map[string]any{}
	}
	for t := 1; ; t++ {
		r, err := c.enviar(ctx, CaminhoMeta, p)
		if err != nil || r.Status != http.StatusTooManyRequests || t >= tentativas {
			return r, err
		}
		espera := retryAfter(r)
		if espera <= 0 {
			espera = 5 * time.Second
		}
		if err := c.dormir(ctx, min(espera, 30*time.Second)); err != nil {
			return nil, err
		}
	}
}
