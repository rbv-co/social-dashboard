// Package webpush entrega notificações Web Push só com a biblioteca padrão: corpo cifrado
// pelo RFC 8291 (aes128gcm, RFC 8188) e autenticação VAPID (RFC 8292). Substitui o
// `npm:web-push` das edges (enviar-push-vendas e, no Plano 4, saldo e frota).
package webpush

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// VAPID: as chaves no formato do web-push do npm (base64url): pública com 65 bytes
// (ponto não comprimido da P-256), privada com 32 bytes. Assunto: "mailto:...".
type VAPID struct{ Publica, Privada, Assunto string }

// Inscricao é uma linha de push_subs (PushSubscription do navegador).
type Inscricao struct{ Endpoint, P256dh, Auth string }

func b64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(s), "="))
}

// cifrar monta o corpo aes128gcm de UM registro: salt(16) | rs(4) | idlen(1) | chave do
// servidor(65) | ciphertext. Separado para o teste usar o vetor do RFC 8291, Apêndice A.
func cifrar(payload, uaPub, authSecret []byte, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	ua, err := ecdh.P256().NewPublicKey(uaPub)
	if err != nil {
		return nil, fmt.Errorf("p256dh inválida: %w", err)
	}
	segredo, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), uaPub...), asPub...)
	ikm, err := hkdf.Key(sha256.New, segredo, authSecret, string(info), 32)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	bloco, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(bloco)
	if err != nil {
		return nil, err
	}
	cab := make([]byte, 0, 86)
	cab = append(cab, salt...)
	cab = binary.BigEndian.AppendUint32(cab, 4096)
	cab = append(cab, byte(len(asPub)))
	cab = append(cab, asPub...)
	// 0x02 = delimitador do último (e único) registro.
	return gcm.Seal(cab, nonce, append(append([]byte{}, payload...), 0x02), nil), nil
}

// jwtVAPID assina o token ES256 do RFC 8292 (assinatura r||s de 64 bytes).
func jwtVAPID(aud, sub string, priv *ecdsa.PrivateKey, exp time.Time) (string, error) {
	cab := base64.RawURLEncoding.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	corpo, err := json.Marshal(map[string]any{"aud": aud, "exp": exp.Unix(), "sub": sub})
	if err != nil {
		return "", err
	}
	assinado := cab + "." + base64.RawURLEncoding.EncodeToString(corpo)
	h := sha256.Sum256([]byte(assinado))
	r, s, err := ecdsa.Sign(rand.Reader, priv, h[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return assinado + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// endpointAceito: o endpoint vem do NAVEGADOR (push_subs) e o worker faz POST nele; só https
// num host por nome (nunca IP nem localhost), para não virar SSRF cego para a rede interna.
func endpointAceito(u *url.URL) bool {
	h := u.Hostname()
	return u.Scheme == "https" && h != "" && h != "localhost" && net.ParseIP(h) == nil
}

// Enviar cifra o payload e o entrega. Devolve o status do serviço de push (201 = aceito;
// 404/410 = inscrição morta, apagar). Erro = nem chegou a ter resposta, ou dado inválido.
func Enviar(ctx context.Context, cli *http.Client, s Inscricao, payload []byte, v VAPID) (int, error) {
	u, err := url.Parse(s.Endpoint)
	if err != nil || !endpointAceito(u) {
		return 0, errors.New("webpush: endpoint recusado (precisa ser https num host por nome)")
	}
	uaPub, err := b64(s.P256dh)
	if err != nil {
		return 0, errors.New("webpush: p256dh inválida")
	}
	authSecret, err := b64(s.Auth)
	if err != nil || len(authSecret) != 16 {
		return 0, errors.New("webpush: auth inválido")
	}
	d, err := b64(v.Privada)
	if err != nil {
		return 0, errors.New("webpush: VAPID privada inválida")
	}
	priv, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), d)
	if err != nil {
		return 0, errors.New("webpush: VAPID privada inválida")
	}
	if pub, err := priv.PublicKey.Bytes(); err != nil || base64.RawURLEncoding.EncodeToString(pub) != strings.TrimRight(strings.TrimSpace(v.Publica), "=") {
		return 0, errors.New("webpush: a chave VAPID pública não confere com a privada")
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return 0, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return 0, err
	}
	corpo, err := cifrar(payload, uaPub, authSecret, as, salt)
	if err != nil {
		return 0, err
	}
	jwt, err := jwtVAPID(u.Scheme+"://"+u.Host, v.Assunto, priv, time.Now().Add(12*time.Hour))
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Endpoint, bytes.NewReader(corpo))
	if err != nil {
		return 0, err
	}
	req.Header.Set("TTL", "2419200") // 4 semanas, o padrão do web-push do npm
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+strings.TrimRight(strings.TrimSpace(v.Publica), "="))
	// Sem redirecionamento (o endpoint não pode mandar o worker para outro lugar) e com
	// prazo próprio, mesmo que o cliente do chamador não tenha.
	c := http.Client{}
	if cli != nil {
		c = *cli
	}
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if c.Timeout == 0 {
		c.Timeout = 30 * time.Second
	}
	r, err := c.Do(req)
	if err != nil {
		return 0, err
	}
	defer r.Body.Close()
	io.Copy(io.Discard, io.LimitReader(r.Body, 64<<10))
	return r.StatusCode, nil
}
