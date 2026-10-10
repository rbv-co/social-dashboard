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
	"net/netip"
	"net/url"
	"strings"
	"syscall"
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

// hostRecusado: o endpoint vem do NAVEGADOR (push_subs) e o worker faz POST nele. Só vale host
// por NOME de internet: nada de IP (nem em forma curta/decimal/hex/zona IPv6), localhost ou
// sufixos internos. A defesa de verdade contra um nome que resolve para rede interna é o
// Control do discador (clienteSeguro).
func hostRecusado(h string) bool {
	h = strings.TrimSuffix(strings.ToLower(h), ".")
	if h == "" || strings.ContainsAny(h, ":%[]") {
		return true
	}
	if _, err := netip.ParseAddr(h); err == nil {
		return true
	}
	if h == "localhost" || strings.HasSuffix(h, ".localhost") || strings.HasSuffix(h, ".local") || strings.HasSuffix(h, ".internal") {
		return true
	}
	ultimo := h[strings.LastIndex(h, ".")+1:] // 2130706433, 0x7f.1, 127.1, 0 -> IP disfarçado
	if strings.HasPrefix(ultimo, "0x") || strings.Trim(ultimo, "0123456789") == "" {
		return true
	}
	return false
}

func endpointAceito(u *url.URL) bool {
	return u.Scheme == "https" && u.User == nil && !hostRecusado(u.Hostname())
}

var cgnat = netip.MustParsePrefix("100.64.0.0/10")

// destinoProibido: loopback, privado, link-local (inclui metadados 169.254.169.254),
// não especificado, multicast e CGNAT.
func destinoProibido(ip netip.Addr) bool {
	ip = ip.Unmap()
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsUnspecified() || ip.IsMulticast() || cgnat.Contains(ip)
}

// clienteSeguro confere o IP JÁ RESOLVIDO na hora de conectar (vale para DNS que aponta para
// dentro e para redirecionamento). A verificação do TLS fica ligada.
func clienteSeguro() *http.Client {
	d := &net.Dialer{Timeout: 10 * time.Second, Control: func(_, endereco string, _ syscall.RawConn) error {
		ap, err := netip.ParseAddrPort(endereco)
		if err != nil || destinoProibido(ap.Addr()) {
			return errors.New("webpush: destino recusado (endereço interno)")
		}
		return nil
	}}
	return &http.Client{Transport: &http.Transport{DialContext: d.DialContext, TLSHandshakeTimeout: 10 * time.Second}}
}

// ValidarVAPID confere a configuração UMA vez (chamador: o início do disparo): chaves no
// formato base64url, par público/privada coerente e assunto mailto:/https:. Os erros nunca
// trazem as chaves.
func ValidarVAPID(v VAPID) (*ecdsa.PrivateKey, error) {
	if strings.TrimSpace(v.Publica) == "" || strings.TrimSpace(v.Privada) == "" {
		return nil, errors.New("vapid_nao_configurado")
	}
	if (!strings.HasPrefix(v.Assunto, "mailto:") || len(v.Assunto) == len("mailto:")) && (!strings.HasPrefix(v.Assunto, "https:") || len(v.Assunto) == len("https:")) {
		return nil, errors.New("vapid_invalido: assunto precisa começar com mailto: ou https:")
	}
	d, err := b64(v.Privada)
	if err != nil {
		return nil, errors.New("vapid_invalido: privada não é base64url")
	}
	priv, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), d)
	if err != nil {
		return nil, errors.New("vapid_invalido: privada não é uma chave P-256")
	}
	pub, err := priv.PublicKey.Bytes()
	if err != nil || base64.RawURLEncoding.EncodeToString(pub) != strings.TrimRight(strings.TrimSpace(v.Publica), "=") {
		return nil, errors.New("vapid_invalido: a chave pública não confere com a privada")
	}
	return priv, nil
}

// Limite do RFC 8188 num registro só: 4096 - cabeçalho(86) - tag(16) - delimitador(1).
const maxPayload = 3993

var padrao = clienteSeguro()

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
	if len(payload) > maxPayload {
		return 0, errors.New("webpush: payload maior que o registro único permite")
	}
	priv, err := ValidarVAPID(v)
	if err != nil {
		return 0, err
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
	if cli == nil {
		cli = padrao
	}
	c := *cli
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if c.Timeout == 0 {
		c.Timeout = 30 * time.Second
	}
	r, err := c.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) { // o *url.Error traz a URL inteira do endpoint (que é um token)
			err = ue.Err
		}
		return 0, fmt.Errorf("webpush: sem resposta do serviço de push: %w", err)
	}
	defer r.Body.Close()
	io.Copy(io.Discard, io.LimitReader(r.Body, 64<<10))
	return r.StatusCode, nil
}
