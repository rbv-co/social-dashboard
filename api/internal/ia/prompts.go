package ia

import "strings"

func se(cond bool, s string) string {
	if cond {
		return s
	}
	return ""
}

// juntarSemVazias: o `.filter(Boolean).join('\n')` da edge — tira TODA linha vazia, inclusive as de espaço
// que o array tinha.
func juntarSemVazias(linhas []string) string {
	var out []string
	for _, l := range linhas {
		if l != "" {
			out = append(out, l)
		}
	}
	return strings.Join(out, "\n")
}

func blocoPersona(persona string) []string {
	if persona == "" {
		return nil
	}
	return []string{
		"QUEM A MARCA ATENDE, nas palavras do dono do negócio. Isto é verdade sobre a marca e vale MAIS que qualquer padrão que você encontrar nos números:",
		"<persona>",
		persona,
		"</persona>",
		"Se os números apontarem para um público que contradiz esta descrição, NÃO o recomende: diga na leitura que os números vão para outro lado e por quê. Número de conta mostra quem clicou, não para quem a marca quer vender.",
		"",
	}
}

func montarPrompt(ev, marca, objetivo, persona string) string {
	l := []string{
		"Você ajuda quem cuida de anúncios no Meta Ads de um negócio pequeno, e escreve em português do Brasil, direto, sem jargão.",
		se(marca != "", "A marca é: "+marca+"."),
		se(objetivo != "", "O tipo de campanha que está sendo criada: "+objetivo+"."),
		"",
	}
	l = append(l, blocoPersona(persona)...)
	l = append(l,
		"Estes números são REAIS, medidos nos últimos 90 dias desta conta de anúncios. Não invente outros, não recalcule, não estime:",
		"```json",
		cortar(ev, 6000),
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
	return juntarSemVazias(l)
}

func promptDeTexto(ev, marca, objetivo, persona string) string {
	l := []string{
		"Você escreve texto de anúncio para o Meta Ads de um negócio pequeno, em português do Brasil.",
		se(marca != "", "A marca é: "+marca+"."),
		se(objetivo != "", "O tipo de campanha: "+objetivo+"."),
		"",
	}
	l = append(l, blocoPersona(persona)...)
	l = append(l,
		"Estes são os textos que esta conta JÁ RODOU, com o custo real por resultado. São medidos, não estimados:",
		"```json",
		cortar(ev, 7000),
		"```",
		"",
		"ATENÇÃO: os itens em \"vagas\" são anúncios de EMPREGO. Eles têm o custo mais baixo da conta porque",
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
	return juntarSemVazias(l)
}

// extrairJSON: o objeto da resposta, inteiro ou o primeiro `{` até o último `}` (o extrairJson da edge).
// Diferente da edge, só objeto vale (um array viraria "undefined" na leitura).
func extrairJSON(texto string) map[string]any {
	var m map[string]any
	if decodificar([]byte(texto), &m) == nil && m != nil {
		return m
	}
	i, f := strings.Index(texto, "{"), strings.LastIndex(texto, "}")
	if i < 0 || f <= i {
		return nil
	}
	m = nil
	if decodificar([]byte(texto[i:f+1]), &m) == nil && m != nil {
		return m
	}
	return nil
}

type interesse struct {
	ID   string `json:"id"`
	Nome string `json:"nome"`
}

// filtrarInteresses: SÓ os que existem na evidência (a IA escolhe; não cria), sem repetir, com o nome da
// evidência (o filtrarInteresses da edge). Nunca nil: a resposta leva [].
func filtrarInteresses(escolhidos any, ev map[string]any) []interesse {
	validos := map[string]string{}
	lista, _ := ev["interesses"].([]any)
	for _, x := range lista {
		i, _ := x.(map[string]any)
		chave := textoDe(i["key"])
		if chave == "" {
			continue
		}
		nome := textoDe(i["nome"])
		if nome == "" {
			nome = chave
		}
		validos[chave] = nome
	}
	saida := []interesse{}
	esc, _ := escolhidos.([]any)
	for _, x := range esc {
		e, _ := x.(map[string]any)
		id := textoDe(e["id"])
		nome, ok := validos[id]
		if !ok || id == "" {
			continue
		}
		repetido := false
		for _, s := range saida {
			repetido = repetido || s.ID == id
		}
		if !repetido {
			saida = append(saida, interesse{id, nome})
		}
	}
	return saida
}

// sugestoesDe: `.slice(0, 3).map(t => String(t || ”).slice(0, 600)).filter(Boolean)` — corta ANTES de
// filtrar, como a edge.
func sugestoesDe(v any) []string {
	lista, _ := v.([]any)
	if len(lista) > 3 {
		lista = lista[:3]
	}
	saida := []string{}
	for _, x := range lista {
		if s := cortar(textoDe(x), 600); s != "" {
			saida = append(saida, s)
		}
	}
	return saida
}
