package conteudo

import (
	"cmp"
	"encoding/binary"
	"fmt"
	"math"
	"math/big"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf16"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
)

// Porta de _shared/casar-publicacao.js. Um falso positivo é MUITO pior que um "não sei": o
// automático só dispara com nota alta e sem concorrente perto; o resto vira pergunta na tela.

const (
	limiarAutomatico  = 0.85
	limiarConcorrente = 0.60
	horasAntes        = 2
	horasDepois       = 24
	pesoLegenda       = 0.70
	pesoTempo         = 0.30
	pesoPalavras      = 0.6
	pesoBigramas      = 0.4
)

var (
	reAcento   = regexp.MustCompile(`[\x{0300}-\x{036f}]`)
	reMarcacao = regexp.MustCompile(`[#@][\p{L}\p{N}_]+`)
	reEspacos  = regexp.MustCompile(texto.EspacoJS + `+`)
)

// normalizar = normalizarParaComparar, devolvida em unidades UTF-16: o JS corta (slice(0,200)),
// mede palavras (p.length > 2) e monta bigramas sobre unidades UTF-16 — legendas do Instagram usam
// letras "𝐁𝐨𝐥𝐝" (fora do BMP), e contar runas daria outra nota.
func normalizar(s string) []uint16 {
	s = reAcento.ReplaceAllString(norm.NFD.String(s), "")
	s = reMarcacao.ReplaceAllString(s, " ")
	s = strings.Map(func(r rune) rune {
		if r == 0xFE0F || r == 0x200D || unicode.Is(pictografico, r) {
			return ' '
		}
		return r
	}, s)
	s = strings.Trim(reEspacos.ReplaceAllString(cases.Lower(language.Und).String(s), " "), " ")
	u := utf16.Encode([]rune(s))
	if len(u) > 200 {
		u = u[:200]
	}
	return u
}

func chave(u []uint16) string {
	b := make([]byte, 2*len(u))
	for i, x := range u {
		binary.LittleEndian.PutUint16(b[2*i:], x)
	}
	return string(b)
}

func palavras(u []uint16) map[string]bool {
	m := map[string]bool{}
	ini := 0
	for i := 0; i <= len(u); i++ {
		if i == len(u) || u[i] == ' ' {
			if i-ini > 2 { // palavra curta ("de", "na") é cola, não conteúdo
				m[chave(u[ini:i])] = true
			}
			ini = i + 1
		}
	}
	return m
}

func bigramas(u []uint16) map[string]bool {
	m := map[string]bool{}
	for i := 0; i+1 < len(u); i++ {
		m[chave(u[i:i+2])] = true
	}
	return m
}

func dice(a, b map[string]bool) float64 {
	if len(a) == 0 || len(b) == 0 {
		return 0
	}
	comuns := 0
	for x := range a {
		if b[x] {
			comuns++
		}
	}
	return 2 * float64(comuns) / float64(len(a)+len(b))
}

func comeca(a, b []uint16) bool { return len(a) >= len(b) && slices.Equal(a[:len(b)], b) }

func semelhancaDeTexto(a, b string) float64 {
	na, nb := normalizar(a), normalizar(b)
	if len(na) == 0 || len(nb) == 0 {
		return 0
	}
	if comeca(na, nb) || comeca(nb, na) { // legenda colada e alguém acrescentou algo no fim
		return 1
	}
	// float64(...) em cada produto: proíbe a fusão multiplica-e-soma (FMA) do arm64, que muda o último bit.
	return float64(pesoPalavras*dice(palavras(na), palavras(nb))) + float64(pesoBigramas*dice(bigramas(na), bigramas(nb)))
}

// Midia é um item de /{ig}/media.
type Midia struct {
	ID               string `json:"id"`
	Caption          string `json:"caption"`
	MediaType        string `json:"media_type"`
	MediaProductType string `json:"media_product_type"`
	Timestamp        string `json:"timestamp"`
	Permalink        string `json:"permalink"`
	ThumbnailURL     string `json:"thumbnail_url"`
	MediaURL         string `json:"media_url"`
}

// Peca é o pedaço de conteudo_pecas que o casamento lê.
type Peca struct {
	ID, AccountID, Formato, Legenda, Hashtags string
	PublicarEm                                *time.Time
}

func formatoCombina(formato string, m Midia) bool {
	if m.MediaProductType == "STORY" {
		return false
	}
	switch formato { // stories fica de fora: /{ig}/media não devolve story de forma confiável
	case "feed":
		return (m.MediaType == "IMAGE" || m.MediaType == "VIDEO") && m.MediaProductType != "REELS"
	case "carrossel":
		return m.MediaType == "CAROUSEL_ALBUM"
	case "reels":
		return m.MediaProductType == "REELS"
	}
	return false
}

// horaDaMeta lê o timestamp da Graph ("2026-10-09T14:00:00+0000") ou RFC 3339.
func horaDaMeta(s string) (time.Time, bool) {
	for _, l := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
		if t, err := time.Parse(l, s); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

type nota struct {
	total, legenda float64
	motivo         string
}

// arredondar é o Math.round do JS (x >= 0): o inteiro mais próximo, empate para o maior. Compara a
// parte fracionária (exata) em vez de somar 0,5, que arredonda errado em 0,49999999999999994.
func arredondar(x float64) int64 {
	f := math.Floor(x)
	if x-f >= 0.5 {
		f++
	}
	return int64(f)
}

// paraQuatroCasas é Number(x.toFixed(4)) do JS para x >= 0: o n que deixa n/10⁴ mais perto de x, e no
// empate EXATO o maior (o FormatFloat do Go arredonda o empate para o par: 0,28125 → 0,2812; o JS, 0,2813).
// A conta é exata (big.Float de 256 bits: x tem 53 e 10⁴ cabe em 14).
func paraQuatroCasas(x float64) float64 {
	v := new(big.Float).SetPrec(256).SetFloat64(x)
	v.Mul(v, big.NewFloat(10000))
	v.Add(v, big.NewFloat(0.5))
	n, _ := v.Int64() // trunca: x >= 0, então é o piso
	r, _ := strconv.ParseFloat(fmt.Sprintf("%d.%04d", n/10000, n%10000), 64)
	return r
}

func pontuar(p Peca, m Midia) (nota, bool) {
	if p.PublicarEm == nil || m.Timestamp == "" || !formatoCombina(p.Formato, m) {
		return nota{}, false
	}
	tm, ok := horaDaMeta(m.Timestamp)
	if !ok {
		return nota{}, false
	}
	minutos := float64(tm.Sub(*p.PublicarEm).Milliseconds()) / 60000
	if minutos < -horasAntes*60 || minutos > horasDepois*60 {
		return nota{}, false
	}
	var partes []string // a legenda de referência inclui as hashtags: é o texto que a pessoa copiou
	for _, s := range []string{p.Legenda, p.Hashtags} {
		if s != "" {
			partes = append(partes, s)
		}
	}
	legenda := semelhancaDeTexto(strings.Join(partes, " "), m.Caption)
	tempo := 1 - math.Min(math.Abs(minutos)/1440, 1)
	dif := arredondar(math.Abs(minutos))
	quando := "no horário exato"
	if dif != 0 {
		lado := "depois"
		if minutos < 0 {
			lado = "antes"
		}
		quando = fmt.Sprintf("%d min %s do combinado", dif, lado)
	}
	return nota{total: float64(pesoLegenda*legenda) + float64(pesoTempo*tempo), legenda: legenda,
		motivo: fmt.Sprintf("Legenda %d%% parecida, publicado %s.", arredondar(legenda*100), quando)}, true
}

// Achado é uma linha de conteudo_casamentos.
type Achado struct {
	PecaID, IGMediaID, IGTimestamp, IGCaption, Situacao, Motivo string
	IGPermalink, IGThumb                                        *string
	Pontuacao                                                   float64
}

func ouNulo(s ...string) *string {
	for _, x := range s {
		if x != "" {
			return &x
		}
	}
	return nil
}

// casar: atribuição gulosa (o melhor par primeiro; cada peça e cada post uma vez só).
func casar(pecas []Peca, midias []Midia, jaUsados map[string]bool) []Achado {
	type par struct {
		p Peca
		m Midia
		n nota
	}
	var pares []par
	for _, p := range pecas {
		for _, m := range midias {
			if jaUsados[m.ID] {
				continue
			}
			if n, ok := pontuar(p, m); ok {
				pares = append(pares, par{p, m, n})
			}
		}
	}
	slices.SortStableFunc(pares, func(a, b par) int { return cmp.Compare(b.n.total, a.n.total) })
	feitas, usadas := map[string]bool{}, map[string]bool{}
	var saida []Achado
	for _, x := range pares {
		if feitas[x.p.ID] || usadas[x.m.ID] {
			continue
		}
		sozinho := true // outro candidato perto para ESTA peça = não dá para ter certeza
		for _, o := range pares {
			if o.p.ID == x.p.ID && o.m.ID != x.m.ID && !usadas[o.m.ID] && o.n.total >= limiarConcorrente {
				sozinho = false
				break
			}
		}
		situacao, motivo := "sugerido", x.n.motivo
		if x.n.total >= limiarAutomatico && sozinho {
			situacao = "automatico"
		}
		if !sozinho {
			motivo += " Há outro post parecido no mesmo período."
		}
		pont := paraQuatroCasas(x.n.total) // Number(total.toFixed(4))
		feitas[x.p.ID], usadas[x.m.ID] = true, true
		saida = append(saida, Achado{PecaID: x.p.ID, IGMediaID: x.m.ID, IGPermalink: ouNulo(x.m.Permalink),
			IGTimestamp: x.m.Timestamp, IGCaption: x.m.Caption, IGThumb: ouNulo(x.m.ThumbnailURL, x.m.MediaURL),
			Pontuacao: pont, Situacao: situacao, Motivo: motivo})
	}
	return saida
}
