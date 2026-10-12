package config

import (
	"slices"
	"strings"
	"testing"
)

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

func TestCarregarVariaveisDoWorker(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("WORKER_ADDR", " 127.0.0.1:8081 ")
	t.Setenv("CORE_API_TOKEN", "tok-do-core")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.WorkerAddr != "127.0.0.1:8081" {
		t.Fatalf("%+v", c)
	}
	if !slices.Contains(c.Segredos(), "tok-do-core") {
		t.Fatalf("o token do core é segredo do worker: %v", c.Segredos())
	}
}

func TestCarregarRDEArquivos(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("RD_STATION_TOKEN", " token-publico-rd ")
	c, _ := Carregar()
	if c.RDStationToken != "token-publico-rd" || c.ArquivosDir != "/var/lib/api/arquivos" || !slices.Contains(c.Segredos(), "token-publico-rd") {
		t.Fatalf("%+v", c)
	}
	t.Setenv("ARQUIVOS_DIR", "/dados/arquivos")
	if c, _ := Carregar(); c.ArquivosDir != "/dados/arquivos" {
		t.Fatalf("ArquivosDir = %q", c.ArquivosDir)
	}
}
func TestCarregarAlerta(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ALERT_WEBHOOK_URL", "https://hooks.exemplo/segredo-do-webhook")
	c, _ := Carregar()
	if c.AlertaWebhook != "https://hooks.exemplo/segredo-do-webhook" || !slices.Contains(c.Segredos(), c.AlertaWebhook) {
		t.Fatalf("%+v", c)
	}
}

func TestCarregarZAPI(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ZAPI_INSTANCE_ID", "instancia-123")
	t.Setenv("ZAPI_INSTANCE_TOKEN", "token-da-instancia")
	t.Setenv("ZAPI_TOKEN", "client-token")
	c, _ := Carregar()
	if c.ZAPIInstancia != "instancia-123" || c.ZAPIToken != "token-da-instancia" || c.ZAPICliente != "client-token" {
		t.Fatalf("%+v", c)
	}
	for _, s := range []string{"instancia-123", "token-da-instancia", "client-token"} {
		if !slices.Contains(c.Segredos(), s) {
			t.Errorf("%q fora de Segredos()", s)
		}
	}
}

func TestCarregarVariaveisDoPlano5(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ZEPTOMAIL_TOKEN", " zepto-segredo-123 ")
	t.Setenv("ZEPTOMAIL_DE", "")
	t.Setenv("ZEPTOMAIL_NOME", "")
	t.Setenv("ENDERECOS_DO_APP", "")
	t.Setenv("ENDERECO_PADRAO", "")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.ZeptoToken != "zepto-segredo-123" || c.ZeptoDe != "nao-responda@vesselbrasil.com.br" || c.ZeptoNome != "Central de Inteligência RBV" ||
		len(c.EnderecosDoApp) != 2 || c.EnderecoPadrao != "https://socialdashboard.rbvcompany.com" {
		t.Fatalf("padrões = %+v", c)
	}
	if !slices.Contains(c.Segredos(), "zepto-segredo-123") {
		t.Fatal("ZEPTOMAIL_TOKEN fora de Segredos()")
	}
	t.Setenv("ENDERECOS_DO_APP", "https://a.exemplo, https://b.exemplo")
	t.Setenv("ENDERECO_PADRAO", "https://b.exemplo")
	t.Setenv("ZEPTOMAIL_DE", "central@exemplo.com.br")
	t.Setenv("ZEPTOMAIL_NOME", " Outra Central ")
	c, _ = Carregar()
	if len(c.EnderecosDoApp) != 2 || c.EnderecosDoApp[1] != "https://b.exemplo" || c.EnderecoPadrao != "https://b.exemplo" ||
		c.ZeptoDe != "central@exemplo.com.br" || c.ZeptoNome != "Outra Central" {
		t.Fatalf("endereços = %v %q %q %q", c.EnderecosDoApp, c.EnderecoPadrao, c.ZeptoDe, c.ZeptoNome)
	}
}

// O link de senha só vai para endereço da lista, comparado por texto exato com o Origin: valor
// que nunca casaria (barra no fim, caminho, maiúscula) ou que abriria o link para fora é erro
// na subida, não e-mail com link quebrado (ou, pior, para o lugar errado) em produção.
func TestEnderecosDoAppValidadosNaSubida(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ENDERECO_PADRAO", "")
	for lista, ok := range map[string]bool{
		"https://central.exemplo": true, "https://a.exemplo,https://b.exemplo:8443": true, "http://localhost:5199": true, "http://127.0.0.1:5199": true,
		"http://central.exemplo": false, "central.exemplo": false, "https://central.exemplo/app": false, "https://central.exemplo?x=1": false,
		"https://central.exemplo#frag": false, "https://u:p@central.exemplo": false, "ftp://central.exemplo": false, "https://": false,
		"javascript:alert(1)": false, "https://a.exemplo,http://b.exemplo": false, "http://localhost.evil.com": false,
	} {
		t.Setenv("ENDERECOS_DO_APP", lista)
		if _, err := Carregar(); (err == nil) != ok {
			t.Errorf("ENDERECOS_DO_APP=%q: err=%v, esperava ok=%v", lista, err, ok)
		}
	}
	// a barra final e a caixa são normalizadas (o Origin do navegador nunca leva barra e vem em minúsculas)
	t.Setenv("ENDERECOS_DO_APP", "HTTPS://Central.Exemplo/")
	c, err := Carregar()
	if err != nil || c.EnderecosDoApp[0] != "https://central.exemplo" || c.EnderecoPadrao != "https://central.exemplo" {
		t.Fatalf("normalização: %v %+v", err, c.EnderecosDoApp)
	}
	// o padrão tem de ser um dos endereços da lista (Ruling 16: o link só leva a ENDERECOS_DO_APP)
	t.Setenv("ENDERECOS_DO_APP", "https://a.exemplo")
	for padrao, ok := range map[string]bool{"https://a.exemplo": true, "https://b.exemplo": false, "a.exemplo": false} {
		t.Setenv("ENDERECO_PADRAO", padrao)
		if _, err := Carregar(); (err == nil) != ok {
			t.Errorf("ENDERECO_PADRAO=%q: err=%v, esperava ok=%v", padrao, err, ok)
		}
	}
}

func TestZeptoDeTemDeSerUmEnderecoDeEmail(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	for de, ok := range map[string]bool{"a@exemplo.com": true, "Nome <a@exemplo.com>": false, "sem-arroba": false, "a@": false, "a@b.c, d@e.f": false} {
		t.Setenv("ZEPTOMAIL_DE", de)
		if _, err := Carregar(); (err == nil) != ok {
			t.Errorf("ZEPTOMAIL_DE=%q: err=%v, esperava ok=%v", de, err, ok)
		}
	}
}

// Nenhum erro de configuração carrega o valor do segredo (o log da subida mostra o erro).
func TestErroDeConfiguracaoNaoVazaOToken(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ZEPTOMAIL_TOKEN", "Zoho-enczapikey segredo-que-nao-pode-vazar")
	t.Setenv("ENDERECOS_DO_APP", "http://errado.exemplo")
	_, err := Carregar()
	if err == nil || strings.Contains(err.Error(), "segredo-que-nao-pode-vazar") {
		t.Fatalf("err = %v", err)
	}
}

func TestCarregarChavesDeCusto(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ANTHROPIC_ADMIN_KEY", " sk-ant-admin-falsa-123 ")
	t.Setenv("OPENAI_ADMIN_KEY", "sk-admin-falsa-456")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.AnthropicAdmin != "sk-ant-admin-falsa-123" || c.OpenAIAdmin != "sk-admin-falsa-456" {
		t.Fatalf("%q %q", c.AnthropicAdmin, c.OpenAIAdmin)
	}
	for _, s := range []string{"sk-ant-admin-falsa-123", "sk-admin-falsa-456"} {
		if !slices.Contains(c.Segredos(), s) {
			t.Errorf("%q fora de Segredos()", s)
		}
	}
}
