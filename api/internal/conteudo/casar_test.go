package conteudo

import (
	"math"
	"testing"
	"time"
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
