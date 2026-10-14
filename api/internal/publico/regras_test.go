package publico

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// Os casos dos .test.mjs de supabase/functions/_shared (casar-sku-do-bling, nome-de-quem-deu), transcritos.
func TestCasarSKUDoBling(t *testing.T) {
	sim := [][2]string{{"LV102-peça unica", "LV102"}, {"SS1025-F", "SS1025-F"}, {"SS1025-F-PRETO", "SS1025-F"}, {"ss 1025 f", "SS1025-F"},
		{"SS-1162-Ç", "ss1162c"}, {"H0015S", "H0015"}}
	for _, c := range sim {
		if !casaComOSku(c[0], c[1]) || !casaComOSku(c[1], c[0]) {
			t.Errorf("%q x %q devia casar (nos dois sentidos)", c[0], c[1])
		}
	}
	nao := [][2]string{{"SS1025-F", "SS1162-P"}, {"LV102", "H0015S"}, {"H0012S", "H0015S"}, {"SS1025-F", "SS1"}, {"SS1", "SS1025-F"}, {"ABC", "ABC"},
		{"", ""}, {"---", "SS1025-F"}, {"SS1025-F", "   "}}
	for _, c := range nao {
		if casaComOSku(c[0], c[1]) || casaComOSku(c[1], c[0]) {
			t.Errorf("%q x %q NÃO devia casar", c[0], c[1])
		}
	}
	if achatar("peça única") != "PECAUNICA" || minimoParaComparar != 4 {
		t.Errorf("achatar = %q", achatar("peça única"))
	}
}

func TestNomeDeQuemDeu(t *testing.T) {
	if normalizarNome("  Ana  MARIA de Souza ") != "ana maria de souza" {
		t.Errorf("normalizar = %q", normalizarNome("  Ana  MARIA de Souza "))
	}
	for _, c := range [][2]string{{"Ana Souza", "ANA MARIA DE SOUZA"}, {"ana maria de souza", "Ana Souza"}} {
		if !nomesBatem(c[0], c[1]) {
			t.Errorf("%q x %q devia bater", c[0], c[1])
		}
	}
	for _, c := range [][2]string{{"Ana Ferreira", "Ana Souza"}, {"Ana", "Ana Souza"}, {"", "Ana Souza"}, {"Ana Souza", ""}} {
		if nomesBatem(c[0], c[1]) {
			t.Errorf("%q x %q NÃO devia bater (só o primeiro nome / vazio)", c[0], c[1])
		}
	}
	perto := [][2]string{{"Ana Sousa", "Ana Souza"}, {"Ana Rodriges", "Ana Rodrigues"}}
	longe := [][2]string{{"Ana Soza", "Ana Souza"}, {"Bia Souza", "Ana Souza"}, {"Ana", "Ana Souza"}, {"Ana Pina", "Ana Lima"}, {"Ana Neis", "Ana Reis"},
		{"Ana Nelo", "Ana Melo"}, {"Ana Dip", "Ana Dias"}, {"  ", "Ana Souza"}}
	for _, c := range perto {
		if !nomesChegamPerto(c[0], c[1]) {
			t.Errorf("%q x %q devia chegar perto", c[0], c[1])
		}
	}
	for _, c := range longe {
		if nomesChegamPerto(c[0], c[1]) {
			t.Errorf("%q x %q NÃO devia chegar perto (sobrenome curto e diferente é outra pessoa)", c[0], c[1])
		}
	}
}

type golden struct {
	Primeiro, PrimeiroXss, Sem, Nova struct{ Assunto, Html, Texto string }
	Mask                             []string
	Alfabeto                         string
	Tam                              int
}

func lerGolden(t *testing.T) golden {
	t.Helper()
	b, err := os.ReadFile("testdata/textos-do-js.json")
	if err != nil {
		t.Fatal(err)
	}
	var g golden
	if err := json.Unmarshal(b, &g); err != nil {
		t.Fatal(err)
	}
	return g
}

// A saída dos textos e da máscara é a do JS, byte a byte (testdata/textos-do-js.json saiu de
// supabase/functions/_shared/email-textos.js rodado em node), inclusive o caso de nome com HTML.
func TestTextosIguaisAoJS(t *testing.T) {
	g := lerGolden(t)
	for nome, c := range map[string]struct {
		got  textoDeEmail
		quer struct{ Assunto, Html, Texto string }
	}{
		"primeiro acesso":   {textoDoPrimeiroAcesso("Maria da Silva", "Abc234xyz789"), g.Primeiro},
		"primeiro com html": {textoDoPrimeiroAcesso("José <img src=x onerror=1> & \"A\"", "a<b>&'\"c"), g.PrimeiroXss},
		"primeiro sem nome": {textoDoPrimeiroAcesso("", "Zzzzzz222222"), g.Sem},
		"senha nova":        {textoDaSenhaNova("Qwer1234Tyui"), g.Nova},
	} {
		if c.got.Assunto != c.quer.Assunto || c.got.HTML != c.quer.Html || c.got.Texto != c.quer.Texto {
			t.Errorf("%s: o texto difere do JS\n got %q\nquer %q", nome, c.got.HTML+"|"+c.got.Texto, c.quer.Html+"|"+c.quer.Texto)
		}
	}
	for i, e := range []string{"ana@x.com", "@x.com", "semarroba", "éva@x.com", "a@b"} {
		if got := mascararEmail(e); got != g.Mask[i] {
			t.Errorf("mascarar(%q) = %q, o JS dá %q", e, got, g.Mask[i])
		}
	}
	if alfabetoDaSenha != g.Alfabeto || tamanhoDaSenha != g.Tam {
		t.Errorf("alfabeto/tamanho da senha diferem do JS")
	}
}

// Os casos de email-textos.test.mjs e senha-gerada.test.mjs que não são byte a byte.
func TestRegrasDosTextosDaConta(t *testing.T) {
	for _, m := range []textoDeEmail{textoDoPrimeiroAcesso("Tereza Aparecida", "ABCdef234567"), textoDaSenhaNova("ABCdef234567")} {
		tudo := strings.ToLower(m.Assunto + m.HTML + m.Texto)
		for _, proibido := range []string{"cpf", "pedido", "nota fiscal", "comprou", "obrigat"} {
			if strings.Contains(tudo, proibido) {
				t.Errorf("o texto não pode conter %q", proibido)
			}
		}
		if regexp.MustCompile(`\b2 anos\b|24 meses|dois anos|6 meses|seis meses`).MatchString(tudo) {
			t.Error("o e-mail não crava prazo de garantia (depende do material da peça)")
		}
		if !strings.Contains(m.HTML, "ABCdef234567") || !strings.Contains(m.Texto, "ABCdef234567") {
			t.Error("o e-mail traz a senha")
		}
	}
	if m := textoDoPrimeiroAcesso("José<img/src=x/onerror=alert(1)>", "x"); strings.Contains(m.HTML, "<img") || !strings.Contains(m.HTML, "&lt;img") ||
		!strings.Contains(m.Texto, "<img/src=x/onerror=alert(1)>") {
		t.Error("nome com HTML: escapado no html, literal no texto")
	}
	if m := textoDaSenhaNova("AB<cd&ef>23"); strings.Contains(m.HTML, "<cd&ef>") || !strings.Contains(m.HTML, "AB&lt;cd&amp;ef&gt;23") {
		t.Error("senha com < e & sai escapada")
	}
	if mascararEmail("tereza@exemplo.com.br") != "t•••@exemplo.com.br" || mascararEmail("") != "" {
		t.Error("mascarar")
	}
	// a senha: 12 caracteres do alfabeto, sem ambíguo, diferentes entre si
	vistas := map[string]bool{}
	for i := 0; i < 500; i++ {
		s := gerarSenha()
		if len(s) != 12 || strings.ContainsAny(s, "0O1lI") || strings.Trim(s, alfabetoDaSenha) != "" || vistas[s] {
			t.Fatalf("senha inválida ou repetida: %q", s)
		}
		vistas[s] = true
	}
}
