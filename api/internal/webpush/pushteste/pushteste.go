// Package pushteste: o serviço de Web Push de mentira, as chaves e a decifragem do lado do
// "navegador", para os testes dos pacotes que mandam push (meta, frota, conteudo). Só testes o importam.
package pushteste

import (
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
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

// Tabelas como em produção (db/migrations/2026-07-24-push-subs.sql e 2026-07-29-push-preferencias.sql,
// sem as FKs para auth.users/profiles).
const Tabelas = `
create table push_subs (id uuid primary key default gen_random_uuid(), endpoint text not null unique,
  p256dh text not null, auth text not null, user_id uuid, created_at timestamptz not null default now());
create table push_preferencias (user_id uuid not null, tipo text not null, ativo boolean not null,
  alterado_em timestamptz not null default now(), alterado_por uuid, primary key (user_id, tipo));`

// Servico é o serviço de push em https://example.com/push/<caminho>. O sufixo do caminho escolhe a
// resposta: /morta 410, /nf 404, /e500 500, /e429 429, /rede derruba a conexão, /lento responde 201
// depois de 300 ms (para o prazo do cliente vencer antes); o resto, 201.
type Servico struct {
	HTTP *http.Client

	mu     sync.Mutex
	corpos map[string][][]byte
}

func Novo(t *testing.T) *Servico {
	t.Helper()
	s := &Servico{corpos: map[string][][]byte{}}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s.mu.Lock()
		s.corpos[r.URL.Path] = append(s.corpos[r.URL.Path], b)
		s.mu.Unlock()
		for sufixo, st := range map[string]int{"/morta": 410, "/nf": 404, "/e500": 500, "/e429": 429} {
			if strings.HasSuffix(r.URL.Path, sufixo) {
				w.WriteHeader(st)
				return
			}
		}
		if strings.HasSuffix(r.URL.Path, "/rede") {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		if strings.HasSuffix(r.URL.Path, "/lento") {
			time.Sleep(300 * time.Millisecond)
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srv.Close)
	s.HTTP = srv.Client()
	s.HTTP.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srv.Listener.Addr().String())
	}
	return s
}

// Recebidos: quantos pushes chegaram em /push/<caminho>.
func (s *Servico) Recebidos(caminho string) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.corpos["/push/"+caminho])
}

// Total: quantos pushes chegaram, em todos os caminhos.
func (s *Servico) Total() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := 0
	for _, c := range s.corpos {
		n += len(c)
	}
	return n
}

// Ultimo: o último corpo (cifrado) que chegou em /push/<caminho>.
func (s *Servico) Ultimo(t *testing.T, caminho string) []byte {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	c := s.corpos["/push/"+caminho]
	if len(c) == 0 {
		t.Fatalf("nada chegou em /push/%s", caminho)
	}
	return c[len(c)-1]
}

// VAPID gera um par de chaves de teste válido.
func VAPID(t *testing.T) webpush.VAPID {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	return webpush.VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:teste@exemplo.com"}
}

// Inscrever grava uma inscrição em https://example.com/push/<caminho> (auth = 16 zeros) e devolve a
// chave do "navegador" para Decifrar. userID vazio = inscrição sem dono.
func Inscrever(t *testing.T, p *pgxpool.Pool, caminho, userID string) *ecdh.PrivateKey {
	t.Helper()
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := p.Exec(context.Background(), `insert into push_subs (endpoint, p256dh, auth, user_id) values ($1, $2, $3, nullif($4::text, '')::uuid)`,
		"https://example.com/push/"+caminho, base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()),
		base64.RawURLEncoding.EncodeToString(make([]byte, 16)), userID); err != nil {
		t.Fatal(err)
	}
	return ua
}

// Decifrar faz o papel do navegador (RFC 8291 §3.4) com a chave de Inscrever (auth = 16 zeros).
func Decifrar(t *testing.T, corpo []byte, ua *ecdh.PrivateKey) []byte {
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
