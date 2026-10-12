// Package email manda e-mail pela API do ZeptoMail (Zoho), como supabase/functions/_shared/email-zeptomail.ts:
// convite e troca de senha da Central, que antes saíam pelo Auth do Supabase.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const URLPadrao = "https://api.zeptomail.com/v1.1/email"

var ErrSemToken = errors.New("zeptomail: ZEPTOMAIL_TOKEN ausente")

type ZeptoMail struct {
	URL, Token, De, Nome string
	HTTP                 *http.Client // nil = cliente próprio (15 s, nunca segue redirecionamento)
}

// cabecalho aceita a chave crua ou já com o esquema "Zoho-enczapikey" (o painel do Zoho entrega dos dois jeitos).
func (z *ZeptoMail) cabecalho() string {
	if strings.HasPrefix(z.Token, "Zoho-enczapikey") {
		return z.Token
	}
	return "Zoho-enczapikey " + z.Token
}

// Mandar envia UM e-mail. O erro nunca traz token, destinatário nem texto (o texto leva link
// de senha): só o status e o código do ZeptoMail, ou "rede".
func (z *ZeptoMail) Mandar(ctx context.Context, para, assunto, html, texto string) error {
	if z.Token == "" {
		return ErrSemToken
	}
	corpo, _ := json.Marshal(map[string]any{
		"from":     map[string]string{"address": z.De, "name": z.Nome},
		"to":       []any{map[string]any{"email_address": map[string]string{"address": para}}},
		"subject":  assunto,
		"htmlbody": html,
		"textbody": texto,
	})
	url := z.URL
	if url == "" {
		url = URLPadrao
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(corpo))
	if err != nil {
		return errors.New("zeptomail: pedido inválido")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", z.cabecalho())
	cli := &http.Client{Timeout: 15 * time.Second}
	if z.HTTP != nil {
		copia := *z.HTTP // mesmo com cliente de fora, nunca segue redirecionamento
		cli = &copia
	}
	cli.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := cli.Do(req)
	if err != nil {
		return errors.New("zeptomail: rede") // *url.Error traz a URL; nada dele sai daqui
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	var e struct {
		Error struct{ Code string } `json:"error"`
	}
	json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&e)
	return fmt.Errorf("zeptomail: recusou (%d %s)", resp.StatusCode, e.Error.Code)
}
