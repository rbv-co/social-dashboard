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
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"net/url"
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
	if claims["aud"] != "https://example.com" || claims["sub"] != v.Assunto || int64(claims["exp"].(float64)) <= time.Now().Unix() || int64(claims["exp"].(float64)) > time.Now().Add(24*time.Hour).Unix() {
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

// Chaves VAPID nunca aparecem em log nem em erro (o teste chega ao caminho da chave privada),
// o erro de rede não traz a URL do endpoint (um token) e redirecionamento não é seguido.
func TestEnviarNaoVazaSegredoNemSegueRedirecionamento(t *testing.T) {
	var buf strings.Builder
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(antigo)
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	destino := 0
	cli := servicoDePush(t, func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/rede"):
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
		case r.URL.Path == "/alvo":
			destino++
		default:
			http.Redirect(w, r, "https://example.com/alvo", http.StatusFound)
		}
	})
	ins := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	st, err := Enviar(context.Background(), cli, ins, []byte("x"), v)
	if err != nil || st != http.StatusFound || destino != 0 {
		t.Fatalf("st=%d err=%v destino=%d", st, err, destino)
	}
	saidas := []string{}
	// privada que decodifica mas não é chave (escalar zero): chega ao caminho da chave privada
	zero := base64.RawURLEncoding.EncodeToString(make([]byte, 32))
	outra, _ := chavesVAPID(t)
	for _, ruim := range []VAPID{{Publica: v.Publica, Privada: zero, Assunto: v.Assunto}, {Publica: outra.Publica, Privada: v.Privada, Assunto: v.Assunto}} {
		_, err := Enviar(context.Background(), cli, ins, []byte("x"), ruim)
		if err == nil {
			t.Fatal("VAPID ruim deveria falhar")
		}
		saidas = append(saidas, err.Error())
	}
	ins.Endpoint = "https://example.com/push/TOKEN-SECRETO/rede"
	_, err = Enviar(context.Background(), cli, ins, []byte("x"), v)
	if err == nil {
		t.Fatal("conexão cortada deveria dar erro")
	}
	saidas = append(saidas, err.Error(), buf.String())
	for _, saida := range saidas {
		for _, segredo := range []string{v.Privada, v.Publica, outra.Publica, zero, "TOKEN-SECRETO", "example.com/push"} {
			if strings.Contains(saida, segredo) {
				t.Fatalf("vazou %q em %q", segredo, saida)
			}
		}
	}
}

func TestEndpointsRecusadosPorNomeEForma(t *testing.T) {
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	boa := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	chamadas := 0
	cli := servicoDePush(t, func(w http.ResponseWriter, _ *http.Request) { chamadas++; w.WriteHeader(201) })
	for _, e := range []string{
		"https://LOCALHOST/p", "https://localhost./p", "https://2130706433/p", "https://0x7f.1/p", "https://127.1/p", "https://0/p",
		"https://[fe80::1%25en0]/p", "https://impressora.local/p", "https://api.internal/p", "https://a.b.localhost/p",
		"https://usuario:senha@example.com/p", "https://user@example.com/p", "https://10.0.0.1/p", "https://[::ffff:127.0.0.1]/p",
		"https://0177.0.0.1/p", "https://127.0.0.0x1/p", "https://example.0x7f/p", "https://example.com:443@127.0.0.1/p", "https:///p", "ftp://example.com/p", "https://100.64.0.1/p",
	} {
		ins := boa
		ins.Endpoint = e
		// a regra de nome/forma é que recusa (não um erro de certificado lá na frente)
		if u, err := url.Parse(e); err == nil && endpointAceito(u) {
			t.Errorf("endpointAceito(%q) deveria ser false", e)
		}
		if _, err := Enviar(context.Background(), cli, ins, []byte("x"), v); err == nil || !strings.Contains(err.Error(), "endpoint recusado") {
			t.Errorf("endpoint %q deveria ser recusado pela validação, err=%v", e, err)
		}
	}
	if chamadas != 0 {
		t.Fatalf("%d chamadas saíram", chamadas)
	}
	for _, e := range []string{"https://example.com/p", "https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/Qx", "https://wns2-par02p.notify.windows.com/w/?token=a", "https://exemplo.de/p", "https://push.example.com.br/p"} {
		u, _ := url.Parse(e)
		if !endpointAceito(u) {
			t.Errorf("endpoint %q deveria passar", e)
		}
	}
}

// O cliente de produção (clienteSeguro, o mesmo que Enviar usa com cli == nil) recusa conectar
// em endereço interno, mesmo com o certificado e o servidor perfeitamente válidos.
func TestClienteSeguroRecusaEnderecoInterno(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { t.Error("chegou no servidor"); w.WriteHeader(201) }))
	defer srv.Close()
	cli := clienteSeguro()
	cli.Transport.(*http.Transport).TLSClientConfig = &tls.Config{RootCAs: srv.Client().Transport.(*http.Transport).TLSClientConfig.RootCAs}
	_, err := cli.Get(srv.URL) // https://127.0.0.1:porta
	if err == nil || !strings.Contains(err.Error(), "destino recusado") {
		t.Fatalf("err = %v", err)
	}
	for _, ip := range []string{"127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fc00::1", "::", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a00:1", "::7f00:1", "::a00:1", "2002:7f00:1::1", "2002:c0a8:101::", "fec0::1", "198.18.0.1", "198.19.255.255", "240.0.0.1", "255.255.255.255"} {
		if !destinoProibido(netip.MustParseAddr(ip)) {
			t.Errorf("%s deveria ser proibido", ip)
		}
	}
	for _, ip := range []string{"8.8.8.8", "142.250.0.1", "100.128.0.1", "2607:f8b0:4004::1", "198.20.0.1", "223.255.255.255", "2001:4860:4860::8888"} {
		if destinoProibido(netip.MustParseAddr(ip)) {
			t.Errorf("%s deveria passar", ip)
		}
	}
}

func TestValidarVAPID(t *testing.T) {
	v, _ := chavesVAPID(t)
	if _, err := ValidarVAPID(v); err != nil {
		t.Fatal(err)
	}
	outra, _ := chavesVAPID(t)
	std := func(s string) string { return base64.StdEncoding.EncodeToString(dec(t, s)) }
	casos := map[string]VAPID{
		"vazia":         {},
		"trocada":       {Publica: outra.Publica, Privada: v.Privada, Assunto: v.Assunto},
		"malformada":    {Publica: v.Publica, Privada: "lixo!", Assunto: v.Assunto},
		"escalar zero":  {Publica: v.Publica, Privada: base64.RawURLEncoding.EncodeToString(make([]byte, 32)), Assunto: v.Assunto},
		"assunto vazio": {Publica: v.Publica, Privada: v.Privada},
		"assunto ruim":  {Publica: v.Publica, Privada: v.Privada, Assunto: "http://exemplo.com"},
		"assunto curto": {Publica: v.Publica, Privada: v.Privada, Assunto: "mailto:"},
		"pública curta": {Publica: v.Publica[:20], Privada: v.Privada, Assunto: v.Assunto},
	}
	// chave em base64 padrão (com + e /): procura um par que contenha esses caracteres
	for range 200 {
		k, _ := chavesVAPID(t)
		if strings.ContainsAny(std(k.Publica), "+/") {
			casos["base64 padrão"] = VAPID{Publica: std(k.Publica), Privada: std(k.Privada), Assunto: k.Assunto}
			break
		}
	}
	if _, ok := casos["base64 padrão"]; !ok {
		t.Fatal("não achei par com + ou /")
	}
	for nome, c := range casos {
		_, err := ValidarVAPID(c)
		if err == nil {
			t.Errorf("%s: deveria falhar", nome)
			continue
		}
		for _, seg := range []string{c.Privada, c.Publica} {
			if seg != "" && strings.Contains(err.Error(), seg) {
				t.Errorf("%s: erro traz a chave: %v", nome, err)
			}
		}
	}
	if _, err := ValidarVAPID(VAPID{Publica: v.Publica, Privada: v.Privada, Assunto: "https://exemplo.com/contato"}); err != nil {
		t.Fatal(err)
	}
}

func TestEnviarRecusaPayloadMaiorQueOUnicoRegistro(t *testing.T) {
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	ins := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	var tam int
	cli := servicoDePush(t, func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		tam = len(b)
		w.WriteHeader(201)
	})
	if st, err := Enviar(context.Background(), cli, ins, make([]byte, 3993), v); err != nil || st != 201 || tam != 4096 {
		t.Fatalf("no limite: st=%d err=%v tam=%d", st, err, tam)
	}
	if _, err := Enviar(context.Background(), cli, ins, make([]byte, 3994), v); err == nil {
		t.Fatal("3994 bytes deveria ser recusado")
	}
}

type rtFalso func(*http.Request) (*http.Response, error)

func (f rtFalso) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Enviar com cliente nil usa o cliente seguro (o `padrao`), e ele não usa proxy do ambiente.
func TestEnviarSemClienteUsaOClienteSeguro(t *testing.T) {
	tr, ok := padrao.Transport.(*http.Transport)
	if !ok || tr.Proxy != nil {
		t.Fatalf("o cliente seguro não pode ter Proxy (ProxyFromEnvironment contornaria o Control): %#v", padrao.Transport)
	}
	if _, err := tr.DialContext(context.Background(), "tcp", "127.0.0.1:9"); err == nil || !strings.Contains(err.Error(), "destino recusado") {
		t.Fatalf("o discador do padrao deveria recusar loopback: %v", err)
	}
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	ins := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	antigo, usou := padrao, 0
	padrao = &http.Client{Transport: rtFalso(func(*http.Request) (*http.Response, error) {
		usou++
		return &http.Response{StatusCode: 201, Body: io.NopCloser(strings.NewReader(""))}, nil
	})}
	defer func() { padrao = antigo }()
	if st, err := Enviar(context.Background(), nil, ins, []byte("x"), v); err != nil || st != 201 || usou != 1 {
		t.Fatalf("st=%d err=%v usou=%d", st, err, usou)
	}
}

func TestControlSeguroFalhaFechada(t *testing.T) {
	for _, ruim := range []string{"", "lixo", "example.com:443", "[::1]", "127.0.0.1", "8.8.8.8", "8.8.8.8:porta", "127.0.0.1:443", "[::1]:443"} {
		if err := controlSeguro("tcp", ruim, nil); err == nil {
			t.Errorf("controlSeguro(%q) deveria recusar", ruim)
		}
	}
	for _, boa := range []string{"8.8.8.8:443", "[2607:f8b0:4004::1]:443"} {
		if err := controlSeguro("tcp", boa, nil); err != nil {
			t.Errorf("controlSeguro(%q) = %v", boa, err)
		}
	}
}
