// Package comercial: vendas (bling-proxy e push de vendas), sempre pelo core.
package comercial

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// caminhosPermitidos: o token do Bling (no core) abre o ERP INTEIRO; esta lista é o que
// separa a Central do resto. Cópia exata de supabase/functions/bling-proxy/index.ts
// (CAMINHOS_PERMITIDOS). O id aceita só [A-Za-z0-9_-]: sem ponto nem barra, não há fuga.
var caminhosPermitidos = []*regexp.Regexp{
	regexp.MustCompile(`^pedidos/vendas$`),
	regexp.MustCompile(`^pedidos/vendas/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^vendedores/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^produtos$`),
	regexp.MustCompile(`^produtos/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^estoques/saldos$`),
	regexp.MustCompile(`^depositos$`),
	regexp.MustCompile(`^formas-pagamentos$`),
	regexp.MustCompile(`^nfe$`),
	regexp.MustCompile(`^nfe/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^nfce$`),
	regexp.MustCompile(`^nfce/[A-Za-z0-9_-]+$`),
}

// 'autenticidade' abre SÓ os caminhos de produto (o seletor de produto do painel NFC).
var caminhoDeProduto = regexp.MustCompile(`^produtos(/[A-Za-z0-9_-]+)?$`)

func permitido(endpoint string) bool {
	for _, re := range caminhosPermitidos {
		if re.MatchString(endpoint) {
			return true
		}
	}
	return false
}

// Bling é POST /bling-proxy {endpoint, params}: porta de supabase/functions/bling-proxy.
// Mesmo contrato de entrada e saída da edge. Deve vir DEPOIS de auth.Exigir.
type Bling struct {
	Pool *pgxpool.Pool
	Core *core.Cliente
}

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func erro(w http.ResponseWriter, status int, msg string) {
	responder(w, status, map[string]string{"error": msg})
}

// texto é o String() do JS para um valor de params: a edge montava a URL com ele, então o
// core recebia "[object Object]" para objeto e "1,2" para lista dentro de lista. Igual aqui.
func texto(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		f, err := x.Float64()
		if err != nil {
			return x.String()
		}
		if f == 0 {
			return "0"
		}
		if af := math.Abs(f); af >= 1e21 || af < 1e-6 {
			e := strconv.FormatFloat(f, 'e', -1, 64) // 1e-07 → 1e-7, como o JS
			m, ex, _ := strings.Cut(e, "e")
			return m + "e" + ex[:1] + strings.TrimLeft(ex[1:], "0")
		}
		return strconv.FormatFloat(f, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return "null"
	case []any:
		partes := make([]string, len(x))
		for i, it := range x {
			if it != nil { // join do JS: null vira vazio
				partes[i] = texto(it)
			}
		}
		return strings.Join(partes, ",")
	}
	return "[object Object]"
}

// query reproduz o que a edge mandava ao core: a URL montada com params e relida por
// blingPeloCore (_shared/core-bling-proxy.js:128-130) — valor único vira texto, repetido
// vira lista, null/ausente some, lista vazia some.
func query(params map[string]any) map[string]any {
	q := map[string]any{}
	for k, v := range params {
		switch x := v.(type) {
		case nil:
		case []any:
			var vs []string
			for _, it := range x {
				vs = append(vs, texto(it)) // append(String(item)): null vira "null"
			}
			if len(vs) == 1 {
				q[k] = vs[0]
			} else if len(vs) > 1 {
				q[k] = vs
			}
		default:
			q[k] = texto(x)
		}
	}
	return q
}

// saida é o que a edge devolveria: status, corpo JSON decodificado e os cabeçalhos do core
// que o front usa (Retry-After para recuar; X-Core-Origem para distinguir erro do Bling do core).
type saida struct {
	status  int
	corpo   any
	cab     map[string]string
	propria bool // erro montado aqui, não resposta do Bling
}

func falha(status int, msg string) saida {
	return saida{status: status, corpo: map[string]string{"error": msg}, propria: true}
}

// chamar faz a chamada ao core (GET, com a repetição do cliente). Uma 5xx/429 final chega
// como Resposta e segue como veio; só "sem resposta nenhuma" vira 504.
func (b *Bling) chamar(r *http.Request, endpoint string, q map[string]any) saida {
	if len(q) == 0 {
		q = nil
	}
	resp, err := b.Core.Bling(r.Context(), core.PedidoBling{Metodo: http.MethodGet, Caminho: "/" + endpoint, Query: q})
	var sr *core.SemResposta
	switch {
	case errors.Is(err, core.ErrSemToken):
		return falha(http.StatusServiceUnavailable, "core nao configurado")
	case errors.As(err, &sr):
		slog.Error("bling-proxy: desisti", "endpoint", endpoint, "tentativas", sr.Tentativas, "causa", sr.Causa)
		return falha(http.StatusGatewayTimeout, sr.Error())
	case err != nil:
		slog.Error("bling-proxy: falha ao falar com o core", "endpoint", endpoint, "erro", err)
		return falha(http.StatusBadGateway, "falha ao falar com o core")
	}
	// 401/403 que NÃO veio do Bling é o core recusando a credencial DESTA API: repassar
	// 401 faria o front achar que a sessão da pessoa expirou.
	if (resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden) && resp.Origem != "bling" && resp.Origem != "proxy" {
		slog.Error("bling-proxy: o core recusou a credencial da API", "status", resp.Status)
		return falha(http.StatusBadGateway, "o core recusou a credencial desta API")
	}
	var corpo any
	d := json.NewDecoder(bytes.NewReader(resp.Corpo))
	d.UseNumber()
	if d.Decode(&corpo) != nil {
		corpo = map[string]any{"raw": string(resp.Corpo)}
	}
	cab := map[string]string{}
	if resp.RetryAfter != "" {
		cab["Retry-After"] = resp.RetryAfter
	}
	if resp.Origem != "" {
		cab["X-Core-Origem"] = resp.Origem
	}
	return saida{status: resp.Status, corpo: corpo, cab: cab}
}

func (s saida) enviar(w http.ResponseWriter) {
	for k, v := range s.cab {
		w.Header().Set(k, v)
	}
	responder(w, s.status, s.corpo)
}

func (b *Bling) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	var in struct {
		Endpoint string         `json:"endpoint"`
		Params   map[string]any `json:"params"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.UseNumber()
	if err := d.Decode(&in); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			erro(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
			return
		}
		erro(w, http.StatusBadRequest, "endpoint required")
		return
	}
	if in.Endpoint == "" {
		erro(w, http.StatusBadRequest, "endpoint required")
		return
	}
	if !permitido(in.Endpoint) {
		erro(w, http.StatusForbidden, "endpoint nao permitido")
		return
	}
	// Daqui em diante `in.Endpoint` já é o normalizado que canais.Recortar espera: a regra
	// ancorada só deixa passar caminho sem "/" inicial, sem query e sem espaço.
	// Vendas ('sales') e Gestão Comercial ('gestor') consultam tudo da lista; 'autenticidade'
	// só produto.
	pode := a.PodeModulo("sales") || a.PodeModulo("gestor")
	if caminhoDeProduto.MatchString(in.Endpoint) {
		pode = pode || a.PodeModulo("autenticidade")
	}
	if !pode {
		erro(w, http.StatusForbidden, "sem permissao")
		return
	}
	lista, err := canais.Carregar(r.Context(), b.Pool, a)
	if err != nil {
		slog.Error("bling-proxy: carregar canais", "erro", err)
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}

	// A LISTA de pedidos para quem está limitado: quem recorta é o Bling (`idLoja`, uma loja
	// por chamada), senão a página de 100 chegaria com 30 e a paginação da tela pararia cedo
	// (vendedora veria MENOS venda da própria loja, calada).
	if lista != nil && in.Endpoint == "pedidos/vendas" {
		if len(lista) == 0 {
			responder(w, http.StatusOK, map[string]any{"data": []any{}})
			return
		}
		pedidos := []any{}
		for _, canal := range lista {
			q := query(in.Params)
			q["idLoja"] = strconv.FormatInt(canal, 10)
			res := b.chamar(r, in.Endpoint, q)
			if res.status >= 400 {
				res.enviar(w) // erro sobe como veio: "deu ruim" ≠ "não vendeu nada"
				return
			}
			if m, ok := res.corpo.(map[string]any); ok {
				if dados, ok := m["data"].([]any); ok {
					pedidos = append(pedidos, dados...)
				}
			}
		}
		// Cinto e suspensório: se o recorte do nosso lado tirar algo, o `idLoja` deixou de
		// ser honrado; o certo é erro visível, não lista torta.
		conferido, _ := canais.Recortar(in.Endpoint, map[string]any{"data": pedidos}, lista)
		if len(conferido.(map[string]any)["data"].([]any)) != len(pedidos) {
			erro(w, http.StatusBadGateway, "O filtro de loja do Bling parou de funcionar. Nao vou devolver uma lista pela metade: avise quem cuida do sistema.")
			return
		}
		responder(w, http.StatusOK, conferido)
		return
	}

	res := b.chamar(r, in.Endpoint, query(in.Params))
	if !res.propria { // erro desta API (core fora, sem token) não é corpo do Bling: não se recorta
		corpo, negado := canais.Recortar(in.Endpoint, res.corpo, lista)
		if negado {
			erro(w, http.StatusForbidden, "sem permissao para este canal")
			return
		}
		res.corpo = corpo
	}
	res.enviar(w)
}
