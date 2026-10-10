// Package config lê a configuração do processo a partir de variáveis de ambiente.
package config

import (
	"errors"
	"net/url"
	"os"
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
	// WORKER_TAREFAS_DESLIGADAS: nomes de tarefas que o worker NÃO registra ("*" = todas).
	// O ensaio roda com banco restaurado de produção: ligue "*" (ou o push) para não mandar push de verdade.
	TarefasDesligadas []string
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
	}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.CoreURL == "" {
		c.CoreURL = "https://core.rbvcompany.com"
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL ausente")
	}
	// O Bearer do core viaja na chamada: só https (http apenas em loopback, para dev/teste).
	if u, err := url.Parse(c.CoreURL); err != nil || u.Host == "" || !(u.Scheme == "https" || (u.Scheme == "http" && loopback(u.Hostname()))) {
		return c, errors.New("CORE_URL deve ser https (http só para localhost, 127.0.0.1 ou ::1)")
	}
	return c, nil
}
