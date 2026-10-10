package mensagens

import (
	"math"
	"strconv"
	"strings"
)

// ChatwootConfig: CHATWOOT_URL, CHATWOOT_CONTA_ID, CHATWOOT_CAIXA_ID, CHATWOOT_API_TOKEN e
// CHATWOOT_BOT_SECRET (o segredo do AgentBot, só para reservar/liberar o aviso).
type ChatwootConfig struct {
	URL, ContaID, CaixaID, Token, BotSecret string
}

// Passada é a configuração de UMA passada (inicio, pedido, abandono, followup).
type Passada struct {
	Modo                        string // desligado | seco | lista | ligado
	Limite                      float64
	MaxHoras                    float64
	AtrasoMin                   float64 // só o abandono
	SoPara                      []string
	LinkBase, Idioma            string
	TemplateNome, TemplateTexto string
	TravaCruzada                bool
	ReservarAviso               bool // só o pedido
}

// Config é o ambiente do robô (rodada-completa.js). ⚠️ NASCE TUDO DESLIGADO: modo vazio = desligado.
type Config struct {
	Chatwoot                           ChatwootConfig
	Inicio, Pedido, Abandono, Followup Passada
	FollowupAposHoras                  float64
}

// numeroJS = Number(v || padrao) do JS: vazio vira o padrão; texto que não é número vira NaN (e a
// validação RECUSA, nunca "sem limite").
func numeroJS(v string, padrao float64) float64 {
	if v == "" {
		return padrao
	}
	f, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil {
		return math.NaN()
	}
	return f
}

// LerConfig lê o mesmo ambiente da edge enviar-mensagem-abandono (getenv = os.Getenv).
func LerConfig(getenv func(string) string) Config {
	var soPara []string
	for _, n := range strings.Split(getenv("ENVIO_SO_PARA"), ",") {
		if d := reNaoDigito.ReplaceAllString(n, ""); d != "" {
			soPara = append(soPara, d)
		}
	}
	idioma := getenv("TEMPLATE_IDIOMA")
	if idioma == "" {
		idioma = "pt_BR"
	}
	modo := func(nome string) string {
		if m := getenv(nome); m != "" {
			return m
		}
		return "desligado"
	}
	base := Passada{Limite: numeroJS(getenv("ENVIO_LIMITE_POR_RODADA"), 10), SoPara: soPara, LinkBase: getenv("LINK_BASE"),
		Idioma: idioma, TravaCruzada: travaCruzadaLigada(getenv("ABANDONO_TRAVA_CRUZADA"))}
	passada := func(m, maxHoras, padraoHoras, template, textoTemplate string) Passada {
		p := base
		p.Modo, p.MaxHoras = modo(m), numeroJS(getenv(maxHoras), parse(padraoHoras))
		p.TemplateNome, p.TemplateTexto = getenv(template), getenv(textoTemplate)
		return p
	}
	c := Config{
		Chatwoot: ChatwootConfig{URL: getenv("CHATWOOT_URL"), ContaID: getenv("CHATWOOT_CONTA_ID"), CaixaID: getenv("CHATWOOT_CAIXA_ID"),
			Token: getenv("CHATWOOT_API_TOKEN"), BotSecret: getenv("CHATWOOT_BOT_SECRET")},
		Inicio:            passada("ENVIO_MODO_INICIO", "INICIO_MAX_HORAS", "1", "TEMPLATE_INICIO", "TEMPLATE_TEXTO_INICIO"),
		Pedido:            passada("ENVIO_MODO_PEDIDO", "PEDIDO_MAX_HORAS", "2", "TEMPLATE_PEDIDO", "TEMPLATE_TEXTO_PEDIDO"),
		Abandono:          passada("ENVIO_MODO", "ENVIO_MAX_HORAS", "24", "TEMPLATE_NOME", "TEMPLATE_TEXTO"),
		Followup:          passada("ENVIO_MODO_FOLLOWUP", "FOLLOWUP_MAX_HORAS", "24", "TEMPLATE_FOLLOWUP", "TEMPLATE_TEXTO_FOLLOWUP"),
		FollowupAposHoras: numeroJS(getenv("FOLLOWUP_APOS_HORAS"), 48),
	}
	c.Pedido.ReservarAviso = getenv("RESERVAR_AVISO_CHATWOOT") == "true"
	// Number(env('ENVIO_ATRASO_MINUTOS') || 0): sem padrão de validação na edge; aqui NaN reprova.
	c.Abandono.AtrasoMin = numeroJS(getenv("ENVIO_ATRASO_MINUTOS"), 0)
	return c
}

func parse(s string) float64 { f, _ := strconv.ParseFloat(s, 64); return f }

// Segredos: os valores do ambiente das mensagens que nunca podem ir para log nem robos_execucoes.
func (c Config) Segredos() []string { return []string{c.Chatwoot.Token, c.Chatwoot.BotSecret} }
