package config

import "testing"

func TestCarregarExigeDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Carregar(); err == nil {
		t.Fatal("deveria recusar sem DATABASE_URL")
	}
}

func TestCarregarPadroes(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ADDR", "")
	t.Setenv("ORIGENS_PERMITIDAS", " https://a.com , ,https://b.com ")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.Addr != ":8080" {
		t.Fatalf("Addr = %q", c.Addr)
	}
	if len(c.Origens) != 2 || c.Origens[0] != "https://a.com" || c.Origens[1] != "https://b.com" {
		t.Fatalf("Origens = %#v", c.Origens)
	}
}

func TestCarregarVariaveisDoPlano3(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CORE_URL", " https://core.exemplo/ ")
	t.Setenv("CORE_API_TOKEN", "tok")
	t.Setenv("HOSTS_DE_MIDIA", "a.exemplo, b.exemplo")
	t.Setenv("SHOPIFY_WEBHOOK_SEGREDOS", "s1,,s2")
	t.Setenv("CHATWOOT_WEBHOOK_SEGREDO", "cw")
	t.Setenv("VAPID_PUBLIC_KEY", "pub")
	t.Setenv("VAPID_PRIVATE_KEY", "priv")
	t.Setenv("VAPID_SUBJECT", "mailto:x@exemplo")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.CoreURL != "https://core.exemplo" || c.CoreToken != "tok" {
		t.Fatalf("core = %q %q", c.CoreURL, c.CoreToken)
	}
	if len(c.HostsDeMidia) != 2 || c.HostsDeMidia[1] != "b.exemplo" {
		t.Fatalf("HostsDeMidia = %#v", c.HostsDeMidia)
	}
	if len(c.ShopifySegredos) != 2 || c.ShopifySegredos[1] != "s2" {
		t.Fatalf("ShopifySegredos = %#v", c.ShopifySegredos)
	}
	if c.ChatwootSegredo != "cw" || c.VAPIDPublica != "pub" || c.VAPIDPrivada != "priv" || c.VAPIDAssunto != "mailto:x@exemplo" {
		t.Fatalf("config = %+v", c)
	}
}

func TestCarregarCoreURLPadrao(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CORE_URL", "")
	c, _ := Carregar()
	if c.CoreURL != "https://core.rbvcompany.com" {
		t.Fatalf("CoreURL = %q", c.CoreURL)
	}
}

func TestCarregarTiraEspacosDoToken(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CORE_API_TOKEN", " tok\n")
	c, _ := Carregar()
	if c.CoreToken != "tok" {
		t.Fatalf("CoreToken = %q", c.CoreToken)
	}
}

func TestHostsDeMidiaEmMinusculas(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("HOSTS_DE_MIDIA", " CDN.Exemplo.COM , B.exemplo")
	c, _ := Carregar()
	if len(c.HostsDeMidia) != 2 || c.HostsDeMidia[0] != "cdn.exemplo.com" || c.HostsDeMidia[1] != "b.exemplo" {
		t.Fatalf("HostsDeMidia = %#v", c.HostsDeMidia)
	}
}

func TestCoreURLSoHTTPSOuLoopback(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	for url, ok := range map[string]bool{
		"https://core.exemplo": true, "http://localhost:8000": true, "http://127.0.0.1:9": true, "http://[::1]:9": true,
		"HTTPS://core.x": true, "https:/x": false, "http://localhost@evil.com": false, "http://core.exemplo": false, "http://localhost.evil.com": false, "ftp://core.exemplo": false, "core.exemplo": false, "https://": false,
	} {
		t.Setenv("CORE_URL", url)
		if _, err := Carregar(); (err == nil) != ok {
			t.Errorf("CORE_URL=%q: err=%v, esperava ok=%v", url, err, ok)
		}
	}
}

func TestTiraEspacosDoSegredoDoChatwoot(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CHATWOOT_WEBHOOK_SEGREDO", " seg\n")
	c, _ := Carregar()
	if c.ChatwootSegredo != "seg" {
		t.Fatalf("%q", c.ChatwootSegredo)
	}
}

func TestTarefasDesligadas(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("WORKER_TAREFAS_DESLIGADAS", " enviar-push-vendas-07h, ,*")
	c, _ := Carregar()
	if len(c.TarefasDesligadas) != 2 || c.TarefasDesligadas[0] != "enviar-push-vendas-07h" || c.TarefasDesligadas[1] != "*" {
		t.Fatalf("%#v", c.TarefasDesligadas)
	}
}
