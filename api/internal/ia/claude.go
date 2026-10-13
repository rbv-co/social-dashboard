// Package ia: os proxies de IA da Gestão de Tráfego (supabase/functions/sugerir-publico-ia e
// ler-documento): o navegador nunca vê a chave da Anthropic; a API confere quem pode, limita o gasto por
// pessoa e repassa o corpo que a edge mandava. A chave vem de ANTHROPIC_API_KEY_TRAFEGO (spec §11).
package ia

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"unicode/utf8"
)

const urlAnthropic = "https://api.anthropic.com/v1/messages"

// claude: o cliente mínimo do Messages API. url só é trocada pelos testes deste pacote.
type claude struct {
	chave string
	url   string
	http  *http.Client
}

type resposta struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	StopReason string          `json:"stop_reason"`
	Usage      json.RawMessage `json:"usage"`
	Error      *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// enviar: POST do corpo. err = não houve resposta (rede, prazo); senão o status, a resposta lida (corpo
// que não é JSON vira resposta vazia, como o `.catch(() => ({}))` da edge) e o corpo cru.
func (c *claude) enviar(ctx context.Context, corpo any) (int, resposta, []byte, error) {
	j, err := json.Marshal(corpo)
	if err != nil {
		return 0, resposta{}, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url, bytes.NewReader(j))
	if err != nil {
		return 0, resposta{}, nil, err
	}
	req.Header.Set("x-api-key", c.chave)
	req.Header.Set("anthropic-version", "2023-06-01")
	req.Header.Set("content-type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return 0, resposta{}, nil, err
	}
	defer res.Body.Close()
	bruto, _ := io.ReadAll(io.LimitReader(res.Body, 4<<20))
	var r resposta
	_ = json.Unmarshal(bruto, &r)
	return res.StatusCode, r, bruto, nil
}

// detalheDoErro: `d?.error?.message || JSON.stringify(d).slice(0, 500)` da edge.
func detalheDoErro(r resposta, bruto []byte) string {
	if r.Error != nil && r.Error.Message != "" {
		return r.Error.Message
	}
	var b bytes.Buffer
	if json.Compact(&b, bruto) != nil {
		return "{}"
	}
	return cortar(b.String(), 500)
}

// cortar: os primeiros n caracteres (o .slice(0, n) da edge conta unidades UTF-16; aqui, caracteres).
func cortar(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

func usoOuNulo(u json.RawMessage) json.RawMessage {
	if len(bytes.TrimSpace(u)) == 0 {
		return json.RawMessage("null")
	}
	return u
}

// decodificar: JSON com números exatos (id de interesse da Meta não passa por float64).
func decodificar(b []byte, v any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	return d.Decode(v)
}

// textoDe: o `String(x || ”)` da edge para texto e número; outro tipo sai vazio.
func textoDe(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		if x == "0" {
			return ""
		}
		return string(x)
	}
	return ""
}
