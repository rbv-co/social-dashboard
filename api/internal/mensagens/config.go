package mensagens

import (
	"errors"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
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

var (
	reDecimalJS   = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
	rePrefixadoJS = regexp.MustCompile(`^0(?:[xX][0-9a-fA-F]+|[bB][01]+|[oO][0-7]+)$`)
	reBordasJS    = regexp.MustCompile(`^` + texto.EspacoJS + `+|` + texto.EspacoJS + `+$`)
)

// numeroJS = Number(v || padrao) do JS: vazio vira o padrão; texto que não é número vira NaN (e a
// validação RECUSA, nunca "sem limite"). Segue o Number() do JS, não o ParseFloat do Go: só espaço nas
// pontas (com o \s do JS; "  " é 0), decimal com sinal e expoente, 0x/0b/0o sem sinal, e "Infinity" com
// a caixa exata; "1_0", "inf", "nan", "0x1p3" são NaN (o ParseFloat do Go os aceitaria).
// ponytail: 0x/0b/0o acima de 2^64 viram NaN (o JS daria um número enorme): ambos reprovam nos limites.
func numeroJS(v string, padrao float64) float64 {
	if v == "" {
		return padrao
	}
	t := reBordasJS.ReplaceAllString(v, "")
	switch {
	case t == "":
		return 0
	case t == "Infinity" || t == "+Infinity":
		return math.Inf(1)
	case t == "-Infinity":
		return math.Inf(-1)
	case reDecimalJS.MatchString(t):
		f, err := strconv.ParseFloat(t, 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) { // ErrRange: ±Inf, como o JS
			return math.NaN()
		}
		return f
	case rePrefixadoJS.MatchString(t):
		base := map[byte]int{'x': 16, 'b': 2, 'o': 8}[t[1]|0x20]
		n, err := strconv.ParseUint(t[2:], base, 64)
		if err != nil {
			return math.NaN()
		}
		return float64(n)
	}
	return math.NaN()
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

// ProblemasDoFollowup: FOLLOWUP_APOS_HORAS vai para agendar_followups(int, int): NaN, infinito, fração
// ou negativo reprovam (sem isto o int() do Go viraria lixo).
func (c Config) ProblemasDoFollowup() []string {
	if h := c.FollowupAposHoras; !inteiro(h) || h < 0 {
		return []string{"FOLLOWUP_APOS_HORAS inválido (inteiro a partir de 0)"}
	}
	return nil
}

// Problemas junta os validadores de cada passada que NÃO está desligada (os mesmos que a rodada usa e que
// a fazem falhar com config_invalida), para o aviso do boot do worker: ENVIO_*, TEMPLATE_*, LINK_BASE,
// CHATWOOT_* e FOLLOWUP_APOS_HORAS. Cada texto leva o nome da passada ("abandono: LINK_BASE ...").
func (c Config) Problemas() []string {
	var ps []string
	for _, x := range []struct {
		nome string
		p    Passada
		prob []string
	}{
		{"inicio", c.Inicio, problemasDaFila(c.Inicio, c.Chatwoot, "inicio")},
		{"pedido", c.Pedido, problemasDaFila(c.Pedido, c.Chatwoot, "pedido")},
		{"abandono", c.Abandono, problemasDoAbandono(c.Abandono, c.Chatwoot)},
		{"followup", c.Followup, append(problemasDaFila(c.Followup, c.Chatwoot, "followup"), c.ProblemasDoFollowup()...)},
	} {
		switch {
		case x.p.Modo == "desligado":
		case !slices.Contains(modos, x.p.Modo):
			ps = append(ps, x.nome+": modo inválido")
		default:
			for _, p := range x.prob {
				ps = append(ps, x.nome+": "+p)
			}
		}
	}
	return ps
}
