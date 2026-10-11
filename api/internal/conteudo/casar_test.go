package conteudo

import (
	"math"
	"testing"
	"time"
	"unicode"
)

// Esperados gerados com o próprio _shared/casar-publicacao.js (Node 22).
func TestSemelhancaDeTextoComoAEdge(t *testing.T) {
	for _, c := range []struct {
		a, b string
		quer float64
	}{
		{"Bolsa de couro preta #vessel @loja 😍✨", "bolsa de couro preta", 1},
		{"bolsa de couro preta", "receita de bolo", 0.19393939393939397},
		{"Nova coleção de inverno chegou", "Nova coleção de inverno chegou! Corre pro site 🛍️", 1},
		{"𝐁𝐨𝐥𝐬𝐚 𝐩𝐫𝐞𝐭𝐚 nova", "𝐁𝐨𝐥𝐬𝐚 𝐩𝐫𝐞𝐭𝐚 linda", 0.7234042553191489},
		{"Ação de Natal: até 30% OFF", "acao de natal ate 30 off", 0.7454545454545454},
		{"", "qualquer", 0},
		{"Lançamento da semana — carteira café", "Lancamento semana carteira cafe ☕", 0.9703703703703703},
	} {
		if got := semelhancaDeTexto(c.a, c.b); math.Abs(got-c.quer) > 1e-12 {
			t.Errorf("%q × %q = %v, esperava %v", c.a, c.b, got, c.quer)
		}
	}
}

func hora(s string) *time.Time { t, _ := time.Parse(time.RFC3339, s); return &t }

func TestCasarComoAEdge(t *testing.T) {
	pecas := []Peca{
		{ID: "p1", Formato: "feed", Legenda: "Bolsa de couro preta", Hashtags: "#vessel", PublicarEm: hora("2026-10-09T14:00:00Z")},
		{ID: "p2", Formato: "reels", Legenda: "Bastidores da sessão de fotos", PublicarEm: hora("2026-10-09T18:00:00Z")},
		{ID: "p3", Formato: "carrossel", Legenda: "Três jeitos de usar a bolsa", PublicarEm: hora("2026-10-09T20:00:00Z")},
	}
	midias := []Midia{
		{ID: "m1", Caption: "Bolsa de couro preta #vessel", MediaType: "IMAGE", MediaProductType: "FEED", Timestamp: "2026-10-09T14:07:00+0000", Permalink: "https://ig/p/m1", MediaURL: "https://cdn/m1.jpg"},
		{ID: "m2", Caption: "Bastidores da sessão de fotos 🎬", MediaType: "VIDEO", MediaProductType: "REELS", Timestamp: "2026-10-09T17:30:00+0000", Permalink: "https://ig/p/m2", ThumbnailURL: "https://cdn/m2t.jpg"},
		{ID: "m3", Caption: "Bastidores da sessão", MediaType: "VIDEO", MediaProductType: "REELS", Timestamp: "2026-10-09T18:20:00+0000", Permalink: "https://ig/p/m3"},
		{ID: "m4", Caption: "Três jeitos de usar", MediaType: "CAROUSEL_ALBUM", MediaProductType: "FEED", Timestamp: "2026-10-10T19:00:00+0000"},
		{ID: "m5", Caption: "Bolsa de couro preta #vessel", MediaType: "IMAGE", MediaProductType: "STORY", Timestamp: "2026-10-09T14:01:00+0000"},
	}
	got := casar(pecas, midias, map[string]bool{})
	quer := []struct {
		peca, midia, situacao, motivo string
		pont                          float64
	}{
		{"p1", "m1", "automatico", "Legenda 100% parecida, publicado 7 min depois do combinado.", 0.9985},
		{"p2", "m3", "sugerido", "Legenda 100% parecida, publicado 20 min depois do combinado. Há outro post parecido no mesmo período.", 0.9958},
		{"p3", "m4", "sugerido", "Legenda 100% parecida, publicado 1380 min depois do combinado.", 0.7125},
	}
	if len(got) != len(quer) {
		t.Fatalf("achados = %+v", got)
	}
	for i, q := range quer {
		g := got[i]
		if g.PecaID != q.peca || g.IGMediaID != q.midia || g.Situacao != q.situacao || g.Motivo != q.motivo || g.Pontuacao != q.pont {
			t.Errorf("achado %d = %+v", i, g)
		}
	}
	if *got[0].IGThumb != "https://cdn/m1.jpg" || got[2].IGPermalink != nil || got[1].IGThumb != nil {
		t.Errorf("thumb cai no media_url; permalink ausente = nulo: %+v", got)
	}
	if again := casar(pecas, midias, map[string]bool{"m1": true}); len(again) != 2 || again[0].PecaID != "p2" {
		t.Fatalf("post já usado não é oferecido de novo: %+v", again)
	}
}

// umPar casa uma peça de legenda igual à do post, `minutos` depois do combinado.
func umPar(minutos int) Achado {
	base := time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC)
	peca := Peca{ID: "p", Formato: "feed", Legenda: "Bolsa de couro preta", PublicarEm: &base}
	m := Midia{ID: "m", Caption: "Bolsa de couro preta", MediaType: "IMAGE", MediaProductType: "FEED",
		Timestamp: base.Add(time.Duration(minutos) * time.Minute).Format("2006-01-02T15:04:05-0700")}
	got := casar([]Peca{peca}, []Midia{m}, map[string]bool{})
	if len(got) != 1 {
		return Achado{}
	}
	return got[0]
}

// Esperados do casar() do _shared/casar-publicacao.js (Node 22). Em 90, 450 e 1050 min o total ×10⁴ cai
// exatamente em x,5: o toFixed(4) do JS arredonda para o maior, o FormatFloat do Go para o par.
func TestPontuacaoArredondaComoOToFixedDoJS(t *testing.T) {
	for _, c := range []struct {
		min  int
		quer float64
		sit  string
	}{
		{90, 0.9812, "automatico"}, {-90, 0.9812, "automatico"}, {450, 0.9063, "automatico"}, {1050, 0.7813, "sugerido"},
		{0, 1, "automatico"}, {360, 0.925, "automatico"},
		// limiar automático: 0,875 passa de 0,85 (e de 0,80); 0,8125 está entre 0,80 e 0,85
		{600, 0.875, "automatico"}, {900, 0.8125, "sugerido"}, {1200, 0.75, "sugerido"},
	} {
		if a := umPar(c.min); a.Pontuacao != c.quer || a.Situacao != c.sit {
			t.Errorf("%d min: %v %s, esperava %v %s", c.min, a.Pontuacao, a.Situacao, c.quer, c.sit)
		}
	}
}

func TestMinusculaComoOtoLowerCaseDoJS(t *testing.T) {
	// sigma final: JS "ΟΔΥΣΣΕΥΣ".toLowerCase() = "οδυσσευς" (strings.ToLower do Go daria "οδυσσευσ")
	if got := semelhancaDeTexto("ΟΔΥΣΣΕΥΣ ΜΕΓΑΣ", "οδυσσευς μεγας"); got != 1 {
		t.Errorf("sigma final = %v", got)
	}
}

// Sondas geradas com /\p{Extended_Pictographic}/u do Node 22: as bordas das faixas da tabela e os
// pontos que ela mais usa (✨ 2728, 😍 1F60D, 🎬 1F3AC, 🐀…📽 1F400–1F4FD).
func TestTabelaPictograficaContraONode22(t *testing.T) {
	for _, c := range []struct {
		r    rune
		quer bool
	}{
		{0x2727, false}, {0x2728, true}, {0x2729, false}, {0x1F60C, true}, {0x1F60D, true}, {0x1F60E, true}, {0x1F3AB, true},
		{0x1F3AC, true}, {0x1F3AD, true}, {0x1F3F7, true}, {0x1F3FA, true}, {0x1F3FB, false}, {0x1F3FF, false}, {0x1F400, true},
		{0x1F4FD, true}, {0x1F4FE, false}, {0x1F4FF, true}, {0x1F53D, true}, {0x1F53E, false}, {0x2600, true}, {0x2604, true},
		{0x2605, false}, {0xA9, true}, {0xAA, false}, {0xAE, true}, {0xAF, false}, {0x203C, true}, {0x1F004, true}, {0x1F005, false},
		{0x1F9FF, true}, {0x1FA00, false}, {0x1FAFF, true}, {0x1FB00, false}, {0x1FC00, true}, {0x1FFFD, true}, {0x1FFFE, false},
		{0x2B50, true}, {0x2B55, true}, {0x2B56, false}, {0x3297, true}, {0x3299, true}, {0x329A, false}, {0x23, false}, {0x30, false},
		{0x1F1E6, false}, {0x1F1FF, false}, {0x1F680, true}, {0x1F6C5, true}, {0x1F6C6, false}, {0x1F90C, true}, {0x1F93A, true},
		{0x1F93B, false}, {0x1F93C, true}, {0x1F945, true}, {0x1F946, false}, {0x1F947, true},
	} {
		if got := unicode.Is(pictografico, c.r); got != c.quer {
			t.Errorf("U+%X: %v, Node 22 diz %v", c.r, got, c.quer)
		}
	}
}
