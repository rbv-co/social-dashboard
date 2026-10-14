package ia

import (
	"reflect"
	"strings"
	"testing"
)

// naoVazias: o filter(Boolean).join('\n') da edge, escrito aqui de forma independente do código.
func naoVazias(linhas ...string) string {
	var s []string
	for _, l := range linhas {
		if l != "" {
			s = append(s, l)
		}
	}
	return strings.Join(s, "\n")
}

// as linhas de supabase/functions/sugerir-publico-ia/index.ts:160-187, uma a uma.
func linhasEdgePublico(ev string, antesDosNumeros ...string) []string {
	l := []string{
		"Você ajuda quem cuida de anúncios no Meta Ads de um negócio pequeno, e escreve em português do Brasil, direto, sem jargão.",
		"A marca é: Vessel.",
		"",
	}
	l = append(l, antesDosNumeros...)
	return append(l,
		"Estes números são REAIS, medidos nos últimos 90 dias desta conta de anúncios. Não invente outros, não recalcule, não estime:",
		"```json",
		ev,
		"```",
		"",
		"Sua tarefa:",
		"1. Escreva uma LEITURA de no máximo 4 frases dizendo o que estes números indicam sobre para quem anunciar — idade, onde e interesses. Cite os números que sustentam cada afirmação.",
		"2. Escolha os interesses que valem a pena manter, ENTRE OS QUE JÁ APARECEM na evidência. Não invente interesses novos nem ids.",
		"   ESCOLHER É DEIXAR DE FORA: devolva SÓ os que você recomenda de verdade. Se um não combina com a marca, não o inclua na lista — mesmo que ele venha dos conjuntos baratos. Explique na leitura por que o deixou de fora.",
		"   Se nenhum valer a pena, devolva a lista vazia.",
		"3. Escreva um CUIDADO de uma frase: o principal risco de seguir esta leitura (por exemplo, público pequeno demais, ou dado concentrado em poucos conjuntos).",
		"",
		"Se os números não sustentarem uma conclusão, diga isso na leitura em vez de inventar uma.",
		"",
		"Responda SÓ com JSON, neste formato:",
		`{"leitura":"...","interesses":[{"id":"...","nome":"..."}],"cuidado":"..."}`,
	)
}

func TestPromptsIguaisAEdge(t *testing.T) {
	if g, w := montarPrompt(`{"a":1}`, "Vessel", "", ""), naoVazias(linhasEdgePublico(`{"a":1}`)...); g != w {
		t.Fatalf("sem persona e sem objetivo:\n%q\n%q", g, w)
	}
	persona := []string{
		"QUEM A MARCA ATENDE, nas palavras do dono do negócio. Isto é verdade sobre a marca e vale MAIS que qualquer padrão que você encontrar nos números:",
		"<persona>",
		"mulheres 30+",
		"</persona>",
		"Se os números apontarem para um público que contradiz esta descrição, NÃO o recomende: diga na leitura que os números vão para outro lado e por quê. Número de conta mostra quem clicou, não para quem a marca quer vender.",
		"",
	}
	g := montarPrompt(`{"a":1}`, "Vessel", "", "mulheres 30+")
	if w := naoVazias(linhasEdgePublico(`{"a":1}`, persona...)...); g != w {
		t.Fatalf("com persona:\n%q\n%q", g, w)
	}
	if !(strings.Index(g, "A marca é: Vessel.") < strings.Index(g, "<persona>") && strings.Index(g, "<persona>") < strings.Index(g, "Estes números")) {
		t.Error("a persona tem de ficar entre a marca e os números")
	}
	if strings.Contains(g, "\n\n") {
		t.Error("linha vazia no prompt")
	}
	if !strings.Contains(montarPrompt(`{}`, "", "Seguidores", ""), "O tipo de campanha que está sendo criada: Seguidores.") {
		t.Error("linha do objetivo")
	}

	// as linhas de index.ts:197-233
	esperadoTexto := naoVazias(
		"Você escreve texto de anúncio para o Meta Ads de um negócio pequeno, em português do Brasil.",
		"A marca é: Vessel.",
		"O tipo de campanha: Seguidores.",
		"",
		"Estes são os textos que esta conta JÁ RODOU, com o custo real por resultado. São medidos, não estimados:",
		"```json",
		`{"a":1}`,
		"```",
		"",
		`ATENÇÃO: os itens em "vagas" são anúncios de EMPREGO. Eles têm o custo mais baixo da conta porque`,
		"gente se candidata — e NÃO servem de modelo para vender produto. Não copie o tom deles, não os cite",
		"como exemplo a seguir, e não escreva nada que pareça recrutamento.",
		"",
		"Sua tarefa:",
		"1. LEITURA: em no máximo 3 frases, o que separa os textos baratos dos caros NESTA conta. Cite os números.",
		"2. SUGESTOES: escreva 3 textos novos de anúncio, no que a evidência mostra que funciona aqui.",
		"   Cada um com no máximo 3 linhas. Português simples, sem jargão de marketing e sem promessa que a marca não fez.",
		"   Não invente desconto, preço, prazo nem condição que não apareça na evidência.",
		"3. CUIDADO: uma frase sobre o principal risco de seguir esta leitura.",
		"",
		"Responda SÓ com JSON:",
		`{"leitura":"...","sugestoes":["...","...","..."],"cuidado":"..."}`,
	)
	if g := promptDeTexto(`{"a":1}`, "Vessel", "Seguidores", ""); g != esperadoTexto {
		t.Fatalf("texto:\n%q\n%q", g, esperadoTexto)
	}
}

func TestPromptsCortamAEvidencia(t *testing.T) {
	ev := strings.Repeat("x", 7000)
	if g := montarPrompt(ev, "", "", ""); !strings.Contains(g, strings.Repeat("x", 6000)+"\n```") || strings.Contains(g, strings.Repeat("x", 6001)) {
		t.Error("montarPrompt corta em 6000")
	}
	if g := promptDeTexto(ev, "", "", ""); !strings.Contains(g, strings.Repeat("x", 7000)+"\n```") {
		t.Error("promptDeTexto mantém 7000")
	}
	if g := promptDeTexto(strings.Repeat("x", 7001), "", "", ""); strings.Contains(g, strings.Repeat("x", 7001)) || !strings.Contains(g, strings.Repeat("x", 7000)) {
		t.Error("promptDeTexto corta em 7000")
	}
	if cortar("ação", 2) != "aç" || cortar("ab", 5) != "ab" {
		t.Error("cortar conta caracteres")
	}
}

func TestExtrairJSON(t *testing.T) {
	if g := extrairJSON("x {\"a\":1} y"); g == nil || g["a"].(interface{ String() string }).String() != "1" {
		t.Errorf("objeto no meio do texto: %v", g)
	}
	for _, ruim := range []string{"[1]", "sem json", "{quebrado", "null", "} {"} {
		if g := extrairJSON(ruim); g != nil {
			t.Errorf("%q devia ser nil: %v", ruim, g)
		}
	}
	if g := extrairJSON(`{"a":"b"}`); g["a"] != "b" {
		t.Errorf("objeto inteiro: %v", g)
	}
}

func TestFiltrarInteresses(t *testing.T) {
	ev := map[string]any{"interesses": []any{
		map[string]any{"key": "6003", "nome": "Moda"},
		map[string]any{"key": "6005"}, // sem nome: usa a chave
		map[string]any{"nome": "sem chave"},
	}}
	esc := []any{
		map[string]any{"nome": "sem id"},
		map[string]any{"id": "9999"},
		map[string]any{"id": "6003", "nome": "inventado pela IA"},
		map[string]any{"id": "6003"},
		map[string]any{"id": "6005"},
		"lixo",
	}
	want := []interesse{{"6003", "Moda"}, {"6005", "6005"}}
	if g := filtrarInteresses(esc, ev); !reflect.DeepEqual(g, want) {
		t.Errorf("%v", g)
	}
	if g := filtrarInteresses(nil, ev); g == nil || len(g) != 0 {
		t.Errorf("nada = [] (não nil): %#v", g)
	}
	if g := filtrarInteresses(esc, map[string]any{}); g == nil || len(g) != 0 {
		t.Errorf("sem interesses na evidência: %#v", g)
	}
}
