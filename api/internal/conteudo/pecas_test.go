package conteudo

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// intacto: cada caso negado roda e o banco (as 9 tabelas) fica igual.
func intacto(t *testing.T, m *mundoteste.Mundo, casos []mundoteste.Caso) {
	t.Helper()
	for _, c := range casos {
		antes := m.Um(t, fotoDoConteudo)
		m.Rodar(t, []mundoteste.Caso{c})
		if m.Um(t, fotoDoConteudo) != antes {
			t.Errorf("%s: o banco mudou", c.Nome)
		}
	}
}

func TestPecas(t *testing.T) {
	m := novoMundo(t, montarPecas)
	const status = `select status from conteudo_pecas where id = '`
	intacto(t, m, []mundoteste.Caso{
		{Nome: "criar em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A2 + `","titulo":"x","formato":"feed"}`, Status: 403, Tem: "sem_permissao"},
		{Nome: "criar já agendada (o INSERT pulava a guarda)", Quem: "aprovador", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","status":"agendada","publicar_em":"2026-11-01T15:00:00.000Z"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com aprovado_por", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","aprovado_por":"` + idConteudista + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com criado_por (vem da sessão)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","criado_por":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar sem título", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","formato":"feed"}`, Status: 400, Tem: "Informe account_id, titulo e formato."},
		{Nome: "criar marcando o aviso", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed","avisado_em":"2026-10-01T00:00:00Z"}`, Status: 400, Tem: "avisado_em"},
		{Nome: "criar com formato fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"tiktok"}`, Status: 400, Tem: "formato"},
		{Nome: "só conteudo.aprovar não cria", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`, Status: 403},
		{Nome: "sem módulo não cria", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`, Status: 403},
		// a guarda pela rota: sem conteudo.aprovar, nem aprovar nem agendar vindo de em_aprovacao (400, a frase da função)
		{Nome: "editor aprova pelo PATCH", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"aprovada"}`, Status: 400, Tem: "Sem permissao para aprovar pecas de conteudo."},
		{Nome: "editor agenda direto de em_aprovacao", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"agendada","avisado_em":null}`, Status: 400, Tem: "Sem permissao para aprovar pecas de conteudo."},
		{Nome: "editar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P3,
			Corpo: `{"titulo":"x"}`, Status: 404},
		{Nome: "mover a peça para conta que não vê", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"account_id":"` + A2 + `"}`, Status: 403},
		{Nome: "marcar o aviso", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P4,
			Corpo: `{"avisado_em":"2026-10-01T00:00:00Z"}`, Status: 400, Tem: "avisado_em"},
		{Nome: "gravar ig_media_id", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"ig_media_id":"IG1"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "agendar sem data (check do banco)", Quem: "aprovador", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"status":"agendada"}`, Status: 400},
		{Nome: "impersonado não edita", Quem: "impersonado", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"titulo":"x"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "apagar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/pecas/" + P3, Status: 404},
	})
	if v := m.Um(t, status+P2+`'`); v != "em_aprovacao" {
		t.Fatalf("P2 = %s", v)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "criar", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/pecas",
			Corpo: `{"account_id":"` + A1 + `","titulo":"Nova","formato":"feed","legenda":"oi","responsavel":null,` +
				`"publicar_em":"2026-11-01T15:00:00.000Z","avisado_em":null}`,
			Status: 201, Tem: `"criado_por":"` + idConteudistaA1 + `"`,
			Efeito: `select status || '|' || coalesce(avisado_em::text, 'nulo') from conteudo_pecas where titulo = 'Nova'`, Quer: "rascunho|nulo"},
		{Nome: "editar", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"titulo":"Bastidor 2","legenda":"nova","status":"em_aprovacao"}`, Status: 200, Tem: `"titulo":"Bastidor 2"`,
			Efeito: status + P1 + `'`, Quer: "em_aprovacao"},
		{Nome: "remarcar limpa o aviso (tela-de-conteudo.vue:433)", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P4,
			Corpo: `{"publicar_em":"2026-10-30T15:00:00.000Z","avisado_em":null}`, Status: 200,
			Efeito: `select coalesce(avisado_em::text, 'nulo') from conteudo_pecas where id = '` + P4 + `'`, Quer: "nulo"},
		{Nome: "aprovador aprova pelo PATCH (a guarda deixa)", Quem: "aprovador", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
			Corpo: `{"status":"aprovada"}`, Status: 200, Efeito: status + P2 + `'`, Quer: "aprovada"},
		{Nome: "admin edita a de A2", Quem: "adminA1", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P3,
			Corpo: `{"observacoes":null}`, Status: 200},
		{Nome: "apagar leva as filhas", Quem: "conteudista", Metodo: "DELETE", Caminho: "/conteudo/pecas/" + P1, Status: 204,
			Efeito: `select (select count(*) from conteudo_arquivos where peca_id = '` + P1 + `') + (select count(*) from conteudo_eventos where peca_id = '` + P1 + `')`, Quer: "0"},
	})
}

// As filhas (arquivo, evento) só com a peça VISÍVEL; a peça invisível e a inexistente respondem igual.
func TestFilhasSoComAPecaVisivel(t *testing.T) {
	m := novoMundo(t, montarPecas)
	inexistente := "a5930000-0000-4000-a000-0000000000ff"
	arq := func(peca, conta string) string {
		return `{"peca_id":"` + peca + `","ordem":5,"bucket":"conteudo","caminho":"` + conta + `/` + peca + `/5-x.png","tipo":"imagem","mime":"image/png","bytes":10}`
	}
	intacto(t, m, []mundoteste.Caso{
		{Nome: "arquivo em peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(P3, A2), Status: 403},
		{Nome: "arquivo em peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(inexistente, A1), Status: 403},
		{Nome: "reordenar arquivo de peça de A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR3, Corpo: `{"ordem":2}`, Status: 404},
		{Nome: "apagar arquivo de peça de A2", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/arquivos/" + AR3, Status: 404},
		{Nome: "evento em peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P3 + `","acao":"criou"}`, Status: 403},
		{Nome: "evento em peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + inexistente + `","acao":"criou"}`, Status: 403},
		{Nome: "evento forjando aprovação", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P2 + `","de":"em_aprovacao","para":"aprovada","acao":"aprovou"}`, Status: 400, Tem: "acao"},
		{Nome: "evento assinado por outro", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","acao":"criou","quem":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "evento com estado fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","de":"x","acao":"mudou_status"}`, Status: 400, Tem: "de e para são estados da peça ou null."},
		{Nome: "só conteudo.aprovar não grava evento", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","acao":"criou"}`, Status: 403},
	})
	// a mãe invisível e a inexistente respondem IGUAL (status e corpo): o pedido não confirma que a peça existe
	for _, c := range [][2]string{
		{"/conteudo/arquivos", arq(P3, A2) + "|" + arq(inexistente, A2)},
		{"/conteudo/eventos", `{"peca_id":"` + P3 + `","acao":"criou"}|{"peca_id":"` + inexistente + `","acao":"criou"}`},
	} {
		corpos := strings.Split(c[1], "|")
		s1, b1 := m.Pedir(t, "conteudistaA1", "POST", c[0], corpos[0])
		s2, b2 := m.Pedir(t, "conteudistaA1", "POST", c[0], corpos[1])
		if s1 != 403 || s2 != 403 || b1 != b2 {
			t.Errorf("%s: invisível = %d %s; inexistente = %d %s", c[0], s1, b1, s2, b2)
		}
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "evento na própria peça, assinado pela sessão", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/eventos",
			Corpo: `{"peca_id":"` + P1 + `","de":"rascunho","para":"em_aprovacao","acao":"mudou_status"}`, Status: 201,
			Tem: `"quem":"` + idConteudistaA1 + `"`},
		{Nome: "admin grava arquivo na peça de A2", Quem: "adminA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: arq(P3, A2), Status: 201},
	})
}

// O caminho do arquivo fica preso a <conta da peça>/<peça>/; reordenar e apagar seguem a tela.
func TestArquivos(t *testing.T) {
	m := novoMundo(t, montarPecas)
	corpo := func(caminho string) string {
		return `{"peca_id":"` + P1 + `","ordem":3,"bucket":"conteudo","caminho":"` + caminho + `","tipo":"imagem","mime":"image/png","bytes":10}`
	}
	intacto(t, m, []mundoteste.Caso{
		{Nome: "caminho de outra peça", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A2 + "/" + P3 + "/1-capa.png"), Status: 403},
		{Nome: "caminho de outra peça da mesma conta", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P2 + "/3-x.png"), Status: 403},
		{Nome: "caminho com ..", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P1 + "/../x.png"), Status: 400},
		{Nome: "caminho absoluto", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo("/etc/passwd"), Status: 400},
		{Nome: "outro bucket", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos",
			Corpo: `{"peca_id":"` + P1 + `","bucket":"fabrica-criativos","caminho":"` + A1 + `/` + P1 + `/3-x.png","tipo":"imagem"}`, Status: 400},
		{Nome: "a mesma ordem duas vezes", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/arquivos",
			Corpo: `{"peca_id":"` + P1 + `","ordem":1,"caminho":"` + A1 + `/` + P1 + `/1-outra.png","tipo":"imagem"}`, Status: 409},
		{Nome: "reordenar trocando o caminho", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1,
			Corpo: `{"ordem":3,"caminho":"x"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "ordem fora da faixa", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":-2}`, Status: 400},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "subir", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/arquivos", Corpo: corpo(A1 + "/" + P1 + "/3-foto.png"), Status: 201,
			Tem: `"caminho":"` + A1 + `/` + P1 + `/3-foto.png"`},
		// a troca em três passos de painel-peca.vue:737-739
		{Nome: "troca 1", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":-1}`, Status: 200},
		{Nome: "troca 2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR2, Corpo: `{"ordem":1}`, Status: 200},
		{Nome: "troca 3", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/arquivos/" + AR1, Corpo: `{"ordem":2}`, Status: 200,
			Efeito: `select string_agg(ordem::text, ',' order by caminho) from conteudo_arquivos where peca_id = '` + P1 + `'`, Quer: "2,1,3"},
		{Nome: "apagar", Quem: "conteudistaA1", Metodo: "DELETE", Caminho: "/conteudo/arquivos/" + AR2, Status: 204,
			Efeito: `select count(*)::text from conteudo_arquivos where id = '` + AR2 + `'`, Quer: "0"},
	})
}

// O furo da guarda de produção: ela só barra 'aprovada'/'agendada' vindo de em_aprovacao. Quem não aprova
// voltava a peça para rascunho e agendava dali (ou de reprovada), e o robô da hora H avisava a publicação.
func TestAgendarSemAprovarPeloRascunho(t *testing.T) {
	m := novoMundo(t, montarPecas)
	const status = `select status from conteudo_pecas where id = '`
	agendar := func(quem, peca string) mundoteste.Caso {
		return mundoteste.Caso{Nome: quem + " agenda " + peca, Quem: quem, Metodo: "PATCH", Caminho: "/conteudo/pecas/" + peca,
			Corpo: `{"status":"agendada","publicar_em":"2026-11-01T15:00:00.000Z"}`}
	}
	nega := func(quem, peca string) mundoteste.Caso { c := agendar(quem, peca); c.Status = 403; return c }
	publicar := func(quem, peca string, status int) mundoteste.Caso {
		return mundoteste.Caso{Nome: quem + " publica " + peca, Quem: quem, Metodo: "PATCH", Caminho: "/conteudo/pecas/" + peca,
			Corpo: `{"status":"publicada","publicado_em":"2026-11-01T15:05:00.000Z"}`, Status: status}
	}
	// o gatilho não barra 'publicada' nem de em_aprovacao: P7 (em_aprovacao) também é 403
	intacto(t, m, []mundoteste.Caso{nega("conteudista", P1), publicar("conteudista", P1, 403), publicar("conteudista", P7, 403)}) // rascunho
	m.Um(t, `with u as (update conteudo_pecas set status = 'reprovada' where id = '`+P1+`' returning 1) select count(*) from u`)
	aprovar := nega("conteudista", P1) // reprovada
	aprovar.Corpo = `{"status":"aprovada"}`
	intacto(t, m, []mundoteste.Caso{nega("conteudista", P1), aprovar, nega("conteudistaA1", P1), publicar("conteudista", P1, 403)})
	// em_aprovacao → rascunho o editor ainda faz; dali, agendar não
	m.Rodar(t, []mundoteste.Caso{{Nome: "devolver ao rascunho", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P2,
		Corpo: `{"status":"rascunho"}`, Status: 200, Efeito: status + P2 + `'`, Quer: "rascunho"}})
	intacto(t, m, []mundoteste.Caso{nega("conteudista", P2)})
	m.Rodar(t, []mundoteste.Caso{
		func() mundoteste.Caso {
			c := agendar("aprovador", P1)
			c.Status = 200
			c.Efeito = status + P1 + `'`
			c.Quer = "agendada"
			return c
		}(),
		// já agendada: remarcar (status continua agendada) o editor pode
		{Nome: "editor remarca a agendada", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/pecas/" + P1,
			Corpo: `{"status":"agendada","publicar_em":"2026-11-05T15:00:00.000Z","avisado_em":null}`, Status: 200,
			Efeito: `select status || '|' || publicar_em::text from conteudo_pecas where id = '` + P1 + `'`, Quer: "agendada|2026-11-05 15:00:00+00"},
	})
	// agendada → publicada: o editor pode (a peça já passou pela aprovação)
	m.Rodar(t, []mundoteste.Caso{func() mundoteste.Caso {
		c := publicar("conteudista", P1, 200)
		c.Efeito, c.Quer = status+P1+`'`, "publicada"
		return c
	}()})
}
