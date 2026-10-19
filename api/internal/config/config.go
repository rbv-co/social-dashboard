// Package config lê a configuração do processo a partir de variáveis de ambiente.
package config

import (
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"slices"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	Origens     []string // CORS: usado quando as rotas públicas entrarem (plano da Vessel)

	// Plano 3 (edges do core). Todos opcionais na carga: a rota que precisa e não tem
	// responde 503 (core) ou 401 (webhook); nunca sobe "aberta".
	CoreURL         string   // CORE_URL; padrão https://core.rbvcompany.com
	CoreToken       string   // CORE_API_TOKEN: Bearer deste consumidor no core
	HostsDeMidia    []string // HOSTS_DE_MIDIA: hosts de onde o meta-proxy aceita imagem/vídeo
	ShopifySegredos []string // SHOPIFY_WEBHOOK_SEGREDOS: admin, app e o do destino no fan-out do core
	ChatwootSegredo string   // CHATWOOT_WEBHOOK_SEGREDO
	VAPIDPublica    string   // VAPID_PUBLIC_KEY (base64url, 65 bytes)
	VAPIDPrivada    string   // VAPID_PRIVATE_KEY (base64url, 32 bytes)
	VAPIDAssunto    string   // VAPID_SUBJECT (ex.: mailto:...)
	// WORKER_TAREFAS_DESLIGADAS: tarefas que o worker NÃO agenda ("*" = todas); `api worker rodar <t> --forcar` ainda roda.
	// Nome que não é "*" nem de tarefa registrada: o worker recusa subir (worker.ValidarDesligadas).
	// O ensaio roda com banco restaurado de produção: ligue "*" (ou o push) para não mandar push de verdade.
	TarefasDesligadas []string

	// Plano 4 (worker).
	WorkerAddr    string // WORKER_ADDR: endereço do GET /saude e /metricas do worker; vazio = sem HTTP
	ArquivosDir   string // ARQUIVOS_DIR: raiz dos buckets no disco (spec §7); padrão /var/lib/api/arquivos
	AlertaWebhook string // ALERT_WEBHOOK_URL: recados de coleta zerada e da auditoria (opcional; é segredo)
	ZAPIInstancia string // ZAPI_INSTANCE_ID (vai no caminho da URL da Z-API)
	ZAPIToken     string // ZAPI_INSTANCE_TOKEN (vai no caminho da URL da Z-API)
	ZAPICliente   string // ZAPI_TOKEN (cabeçalho Client-Token)

	// Plano 5.0 (conta: convite e troca de senha por e-mail).
	ZeptoToken     string   // ZEPTOMAIL_TOKEN (vazio = convite e "esqueci a senha" não mandam e-mail; é segredo)
	ZeptoDe        string   // ZEPTOMAIL_DE; padrão nao-responda@vesselbrasil.com.br (domínio verificado no ZeptoMail)
	ZeptoNome      string   // ZEPTOMAIL_NOME; padrão "Central de Inteligência RBV" (o nome do remetente)
	EnderecosDoApp []string // ENDERECOS_DO_APP: para onde o link de senha pode levar (a origem do pedido, se estiver aqui)
	EnderecoPadrao string   // ENDERECO_PADRAO: o link quando a origem não é do app (um dos EnderecosDoApp)

	// Plano 5.12 (fatura real das contas de IA). Vazia = a rota responde 500 chave_admin_nao_configurada.
	AnthropicAdmin string // ANTHROPIC_ADMIN_KEY: chave ADMIN da organização (Cost/Usage Report)
	OpenAIAdmin    string // OPENAI_ADMIN_KEY: chave ADMIN da organização (Costs API, projetos)

	// Plano 5.7 (Gestão de Tráfego). Vazia = 503 chave_nao_configurada nos proxies de IA.
	IATrafego string // ANTHROPIC_API_KEY_TRAFEGO: a chave da Anthropic dos proxies de IA da Gestão de Tráfego. É segredo.

	// Plano 5.8 (fábrica de anúncios).
	GitHubPAT string // GITHUB_PAT: token do GitHub para disparar workflows (fabrica-trigger; 5.10; Plano 6); é segredo

	// Plano 6 (Vessel pública e Storage).
	VesselInterno   string // VESSEL_INTERNO_SEGREDO: a chave que o Core manda no lugar da anon (é o que o torna "o Core"); é segredo
	VesselSoCore    bool   // VESSEL_SO_CORE: as 14 funções de escrita da Vessel só com a chave do Core (liga quando o site passar pelo Core)
	ArquivosSegredo string // ARQUIVOS_SEGREDO: HMAC das URLs assinadas dos arquivos; é segredo (vazio = assinar responde 503)

	// Plano 07a (proxy do Acessos).
	APIURLPublica string // API_URL_PUBLICA: a base pública da API, sem barra final (ex.: https://socialdashboard.rbvcompany.com/api); host do redirect_uri do OAuth do Zoho/Microsoft e das fotos importadas. Vazia = o authUrl recusa
}

// Segredos: os valores que nunca podem sair em robos_execucoes nem no log do worker
// (worker.Limpar troca cada um por ***).
func (c Config) Segredos() []string {
	return append([]string{c.CoreToken, c.ChatwootSegredo, c.VAPIDPrivada, c.AlertaWebhook,
		c.ZAPIInstancia, c.ZAPIToken, c.ZAPICliente, c.ZeptoToken, c.AnthropicAdmin, c.OpenAIAdmin, c.IATrafego, c.GitHubPAT,
		c.VesselInterno, c.ArquivosSegredo}, c.ShopifySegredos...)
}

// ligado: "true" ou "1" (qualquer caixa); o resto, inclusive vazio, é desligado.
func ligado(v string) bool {
	v = strings.TrimSpace(v)
	return strings.EqualFold(v, "true") || v == "1"
}

// lista lê uma variável separada por vírgulas, sem itens vazios.
func lista(nome string) []string {
	var out []string
	for _, o := range strings.Split(os.Getenv(nome), ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

// minusculas: host é case-insensitive e o meta-proxy compara com o host já em minúsculas;
// uma entrada "CDN.Exemplo" nunca poderia casar e falharia fechada em silêncio.
func minusculas(l []string) []string {
	for i, v := range l {
		l[i] = strings.ToLower(v)
	}
	return l
}

// origemDoApp valida e normaliza um endereço do app: só origem (esquema + host[:porta]), https
// (http só em loopback), sem usuário, caminho, query nem fragmento; a barra final e a caixa saem
// (o Origin do navegador nunca leva barra e vem em minúsculas, e a comparação é por texto exato).
// Valor que nunca casaria viraria e-mail com link para o endereço padrão em silêncio.
func origemDoApp(nome, v string) (string, error) {
	u, err := url.Parse(v)
	if err != nil || u.Host == "" || u.User != nil || (u.Path != "" && u.Path != "/") || strings.ContainsAny(v, "?#") ||
		!(strings.EqualFold(u.Scheme, "https") || (strings.EqualFold(u.Scheme, "http") && loopback(u.Hostname()))) {
		return "", fmt.Errorf("%s: %q deve ser só a origem (https://host[:porta], sem caminho nem query; http só para localhost, 127.0.0.1 ou ::1)", nome, v)
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host), nil
}

func loopback(h string) bool { return h == "localhost" || h == "127.0.0.1" || h == "::1" }

func Carregar() (Config, error) {
	c := Config{
		Addr:            os.Getenv("ADDR"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		Origens:         lista("ORIGENS_PERMITIDAS"),
		CoreURL:         strings.TrimRight(strings.TrimSpace(os.Getenv("CORE_URL")), "/"),
		CoreToken:       strings.TrimSpace(os.Getenv("CORE_API_TOKEN")),
		HostsDeMidia:    minusculas(lista("HOSTS_DE_MIDIA")),
		ShopifySegredos: lista("SHOPIFY_WEBHOOK_SEGREDOS"),
		ChatwootSegredo: strings.TrimSpace(os.Getenv("CHATWOOT_WEBHOOK_SEGREDO")),
		VAPIDPublica:    os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivada:    os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDAssunto:    os.Getenv("VAPID_SUBJECT"),

		TarefasDesligadas: lista("WORKER_TAREFAS_DESLIGADAS"),
		WorkerAddr:        strings.TrimSpace(os.Getenv("WORKER_ADDR")),
		ArquivosDir:       strings.TrimSpace(os.Getenv("ARQUIVOS_DIR")),
		AlertaWebhook:     strings.TrimSpace(os.Getenv("ALERT_WEBHOOK_URL")),
		ZAPIInstancia:     strings.TrimSpace(os.Getenv("ZAPI_INSTANCE_ID")),
		ZAPIToken:         strings.TrimSpace(os.Getenv("ZAPI_INSTANCE_TOKEN")),
		ZAPICliente:       strings.TrimSpace(os.Getenv("ZAPI_TOKEN")),
		ZeptoToken:        strings.TrimSpace(os.Getenv("ZEPTOMAIL_TOKEN")),
		AnthropicAdmin:    strings.TrimSpace(os.Getenv("ANTHROPIC_ADMIN_KEY")),
		OpenAIAdmin:       strings.TrimSpace(os.Getenv("OPENAI_ADMIN_KEY")),
		IATrafego:         strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY_TRAFEGO")),
		ZeptoDe:           strings.TrimSpace(os.Getenv("ZEPTOMAIL_DE")),
		ZeptoNome:         strings.TrimSpace(os.Getenv("ZEPTOMAIL_NOME")),
		EnderecosDoApp:    lista("ENDERECOS_DO_APP"),
		EnderecoPadrao:    strings.TrimSpace(os.Getenv("ENDERECO_PADRAO")),
		GitHubPAT:         strings.TrimSpace(os.Getenv("GITHUB_PAT")),
		VesselInterno:     strings.TrimSpace(os.Getenv("VESSEL_INTERNO_SEGREDO")),
		VesselSoCore:      ligado(os.Getenv("VESSEL_SO_CORE")),
		ArquivosSegredo:   strings.TrimSpace(os.Getenv("ARQUIVOS_SEGREDO")),
		APIURLPublica:     strings.TrimRight(strings.TrimSpace(os.Getenv("API_URL_PUBLICA")), "/"),
	}
	// segredo curto é a chave anon (pública) ou "teste" colado por engano: quem a tem vira "o Core" ou assina URL
	for nome, v := range map[string]string{"VESSEL_INTERNO_SEGREDO": c.VesselInterno, "ARQUIVOS_SEGREDO": c.ArquivosSegredo} {
		if v != "" && len(v) < 24 {
			return c, fmt.Errorf("%s: o segredo tem de ter ao menos 24 caracteres (ex.: openssl rand -hex 32)", nome)
		}
	}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.ArquivosDir == "" {
		c.ArquivosDir = "/var/lib/api/arquivos"
	}
	if c.CoreURL == "" {
		c.CoreURL = "https://core.rbvcompany.com"
	}
	if c.ZeptoDe == "" {
		c.ZeptoDe = "nao-responda@vesselbrasil.com.br"
	}
	if c.ZeptoNome == "" {
		c.ZeptoNome = "Central de Inteligência RBV"
	}
	// os dois endereços de supabase/functions/_shared/enderecos-do-app.js; o padrão ainda é o antigo
	if len(c.EnderecosDoApp) == 0 {
		c.EnderecosDoApp = []string{"https://socialdashboard.rbvcompany.com", "https://central.rbvcompany.com"}
	}
	if c.EnderecoPadrao == "" {
		c.EnderecoPadrao = c.EnderecosDoApp[0]
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL ausente")
	}
	// O Bearer do core viaja na chamada: só https (http apenas em loopback, para dev/teste).
	if u, err := url.Parse(c.CoreURL); err != nil || u.Host == "" || !(u.Scheme == "https" || (u.Scheme == "http" && loopback(u.Hostname()))) {
		return c, errors.New("CORE_URL deve ser https (http só para localhost, 127.0.0.1 ou ::1)")
	}
	// Plano 5.0: o que errar aqui manda link de senha para o lugar errado (ou para lugar nenhum):
	// a API não sobe. Os erros trazem os endereços (públicos), nunca o token.
	if a, err := mail.ParseAddress(c.ZeptoDe); err != nil || a.Address != c.ZeptoDe {
		return c, errors.New("ZEPTOMAIL_DE deve ser só um endereço de e-mail (sem nome nem lista)")
	}
	for i, e := range c.EnderecosDoApp {
		o, err := origemDoApp("ENDERECOS_DO_APP", e)
		if err != nil {
			return c, err
		}
		c.EnderecosDoApp[i] = o
	}
	padrao, err := origemDoApp("ENDERECO_PADRAO", c.EnderecoPadrao)
	if err != nil {
		return c, err
	}
	if !slices.Contains(c.EnderecosDoApp, padrao) {
		return c, fmt.Errorf("ENDERECO_PADRAO %q não está em ENDERECOS_DO_APP (o link de senha só leva a endereço da lista)", padrao)
	}
	c.EnderecoPadrao = padrao
	// O redirect_uri do OAuth leva o code: só https (http em loopback, para dev/teste), sem query nem fragmento.
	if c.APIURLPublica != "" {
		u, err := url.Parse(c.APIURLPublica)
		if err != nil || u.Host == "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil || !(u.Scheme == "https" || (u.Scheme == "http" && loopback(u.Hostname()))) {
			return c, errors.New("API_URL_PUBLICA deve ser uma URL https sem query (http só para localhost, 127.0.0.1 ou ::1)")
		}
	}
	return c, nil
}
