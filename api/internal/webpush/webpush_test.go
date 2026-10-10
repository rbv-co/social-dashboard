package webpush

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
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func dec(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// RFC 8291, Apêndice A: chaves, salt e o registro cifrado esperado, byte a byte.
func TestCifrarVetorDoRFC8291(t *testing.T) {
	as, err := ecdh.P256().NewPrivateKey(dec(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := cifrar([]byte("When I grow up, I want to be a watermelon"),
		dec(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
		dec(t, "BTBZMqHH6r4Tts7J_aSIgg"), as, dec(t, "DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	const quer = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if base64.RawURLEncoding.EncodeToString(got) != quer {
		t.Fatalf("registro cifrado difere do RFC 8291:\n%s", base64.RawURLEncoding.EncodeToString(got))
	}
}

// decifrar faz o papel do NAVEGADOR (RFC 8291 §3.4): prova que o que sai daqui abre do lado de lá.
func decifrar(t *testing.T, corpo []byte, ua *ecdh.PrivateKey, authSecret []byte) []byte {
	t.Helper()
	salt, asPub, ct := corpo[:16], corpo[21:86], corpo[86:]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	segredo, _ := ua.ECDH(pub)
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Key(sha256.New, segredo, authSecret, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	bloco, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(bloco)
	claro, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("não decifra: %v", err)
	}
	return claro[:len(claro)-1] // tira o delimitador 0x02
}

func chavesVAPID(t *testing.T) (VAPID, *ecdsa.PublicKey) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	return VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:teste@exemplo.com"}, &k.PublicKey
}

// servicoDePush é um serviço de push de mentira em https://example.com (o certificado do
// httptest vale para esse nome) e o cliente que disca nele.
func servicoDePush(t *testing.T, h http.HandlerFunc) *http.Client {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	cli := srv.Client()
	cli.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srv.Listener.Addr().String())
	}
	return cli
}

func TestEnviarEntregaCifradoComVAPIDValido(t *testing.T) {
	v, pubVAPID := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	authSecret := make([]byte, 16)
	rand.Read(authSecret)
	var recebido []byte
	var cab http.Header
	cli := servicoDePush(t, func(w http.ResponseWriter, r *http.Request) {
		recebido, _ = io.ReadAll(r.Body)
		cab = r.Header.Clone()
		w.WriteHeader(http.StatusCreated)
	})
	ins := Inscricao{Endpoint: "https://example.com/push/abc", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(authSecret) + "=="}
	st, err := Enviar(context.Background(), cli, ins, []byte(`{"title":"oi"}`), v)
	if err != nil || st != 201 {
		t.Fatalf("st=%d err=%v", st, err)
	}
	if got := decifrar(t, recebido, ua, authSecret); string(got) != `{"title":"oi"}` {
		t.Fatalf("payload = %q", got)
	}
	if cab.Get("Content-Encoding") != "aes128gcm" || cab.Get("TTL") == "" {
		t.Fatalf("cabeçalhos = %v", cab)
	}
	t1, ok := strings.CutPrefix(cab.Get("Authorization"), "vapid t=")
	jwt, k, ok2 := strings.Cut(t1, ", k=")
	if !ok || !ok2 || k != v.Publica {
		t.Fatalf("Authorization = %q", cab.Get("Authorization"))
	}
	partes := strings.Split(jwt, ".")
	var claims map[string]any
	json.Unmarshal(dec(t, partes[1]), &claims)
	if claims["aud"] != "https://example.com" || claims["sub"] != v.Assunto || int64(claims["exp"].(float64)) <= time.Now().Unix() {
		t.Fatalf("claims = %v", claims)
	}
	sig := dec(t, partes[2])
	h := sha256.Sum256([]byte(partes[0] + "." + partes[1]))
	if !ecdsa.Verify(pubVAPID, h[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("assinatura VAPID não confere")
	}
}

func TestEnviarRecusas(t *testing.T) {
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	boa := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	chamadas := 0
	cli := servicoDePush(t, func(w http.ResponseWriter, _ *http.Request) { chamadas++; w.WriteHeader(http.StatusGone) })
	for _, e := range []string{"http://example.com/p", "https://127.0.0.1/p", "https://[::1]/p", "https://localhost/p", "https://169.254.169.254/latest", "nada"} {
		ins := boa
		ins.Endpoint = e
		if _, err := Enviar(context.Background(), cli, ins, []byte("x"), v); err == nil {
			t.Errorf("endpoint %q deveria ser recusado", e)
		}
	}
	ruim := boa
	ruim.P256dh = "nao-e-chave"
	if _, err := Enviar(context.Background(), cli, ruim, []byte("x"), v); err == nil {
		t.Error("p256dh inválida deveria falhar")
	}
	outra, _ := chavesVAPID(t)
	misturada := VAPID{Publica: outra.Publica, Privada: v.Privada, Assunto: v.Assunto}
	if _, err := Enviar(context.Background(), cli, boa, []byte("x"), misturada); err == nil {
		t.Error("par VAPID trocado deveria falhar")
	}
	if chamadas != 0 {
		t.Fatalf("nada disso podia sair (%d chamadas)", chamadas)
	}
	if st, err := Enviar(context.Background(), cli, boa, []byte("x"), v); err != nil || st != http.StatusGone {
		t.Fatalf("410 volta como status, não erro: %d %v", st, err)
	}
}

// Chaves e tokens VAPID nunca aparecem em log nem em erro, e redirecionamento não é seguido.
func TestEnviarNaoVazaSegredoNemSegueRedirecionamento(t *testing.T) {
	var buf strings.Builder
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(antigo)
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	destino := 0
	cli := servicoDePush(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/alvo" {
			destino++
		}
		http.Redirect(w, r, "https://example.com/alvo", http.StatusFound)
	})
	ins := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	st, err := Enviar(context.Background(), cli, ins, []byte("x"), v)
	if err != nil || st != http.StatusFound || destino != 0 {
		t.Fatalf("st=%d err=%v destino=%d", st, err, destino)
	}
	ins.P256dh = "nao-e-chave"
	_, err2 := Enviar(context.Background(), cli, ins, []byte("x"), VAPID{Publica: v.Publica, Privada: "lixo", Assunto: v.Assunto})
	for _, saida := range []string{buf.String(), fmt.Sprint(err2)} {
		if strings.Contains(saida, v.Privada) || strings.Contains(saida, v.Publica) || strings.Contains(saida, "lixo") {
			t.Fatalf("vazou segredo: %q", saida)
		}
	}
}
