package conteudo

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// As 7 declarações passam na gramática do 5.0 (sem banco): a API não sobe com uma leitura inválida.
func TestLeiturasDeclaradas(t *testing.T) {
	for nome, c := range map[string]interface{ Validar(*autz.Catalogo) error }{
		"pecas": consultaPecas, "arquivos": consultaArquivos, "eventos": consultaEventos, "ideias": consultaIdeias,
		"blocos": consultaBlocos, "concorrentes": consultaConcorrentes, "jobs": consultaJobs,
	} {
		if err := c.Validar(autz.Producao); err != nil {
			t.Errorf("%s: %v", nome, err)
		}
	}
}

func TestLeituras(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	ids := func(corpo string) string {
		var l []struct{ ID json.RawMessage }
		if err := json.Unmarshal([]byte(corpo), &l); err != nil {
			t.Fatalf("%v: %s", err, corpo)
		}
		var s []string
		for _, x := range l {
			s = append(s, strings.Trim(string(x.ID), `"`))
		}
		return strings.Join(s, ",")
	}
	lista := func(quem, caminho, quer string) {
		t.Helper()
		st, b := m.Pedir(t, quem, "GET", caminho, "")
		if st != 200 || ids(b) != quer {
			t.Errorf("%s GET %s = %d %s\n  esperava ids %s", quem, caminho, st, b, quer)
		}
	}
	// peças: a restritiva, a ordem (publicar_em asc, nulos por último) e os filtros
	lista("conteudista", "/conteudo/pecas", strings.Join([]string{P5, P6, P4, P2, P3, P1, P7}, ","))
	lista("conteudistaA1", "/conteudo/pecas", strings.Join([]string{P6, P4, P2, P1, P7}, ","))
	lista("impersonado", "/conteudo/pecas", strings.Join([]string{P6, P4, P2, P1, P7}, ","))
	lista("adminA1", "/conteudo/pecas?account_id="+A2, P5+","+P3)
	lista("conteudistaA1", "/conteudo/pecas?account_id="+A2, "")
	lista("conteudistaNenhuma", "/conteudo/pecas", "")
	lista("soAprovar", "/conteudo/pecas", "")
	lista("semModulo", "/conteudo/pecas", "")
	lista("conteudista", "/conteudo/pecas?id="+P1, P1)
	lista("conteudista", "/conteudo/pecas?status=em_aprovacao,agendada&ordem=created_at.desc", strings.Join([]string{P7, P4, P3, P2}, ","))
	// os embutidos: capa (ordem 1 imagem), a métrica MAIS RECENTE, a sugestão de MAIOR pontuação
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "capa da P1", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P1, Status: 200,
			Tem: `"capa":{"tipo": "imagem", "caminho": "` + A1 + `/` + P1 + `/1-capa.png"}`},
		{Nome: "sem capa nem métrica", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P2, Status: 200,
			Tem: `"capa":null,"metrica":null,"sugestao":null`},
		{Nome: "métrica mais recente da P6", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P6, Status: 200,
			Tem: `"curtidas": 20`, NaoTem: `"curtidas": 10`},
		{Nome: "sugestão de maior pontuação da P4", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=" + P4, Status: 200,
			Tem: `"id": "` + CS1 + `"`, NaoTem: CS2},
		{Nome: "contar", Quem: "conteudistaA1", Metodo: "GET", Caminho: "/conteudo/pecas?limite=1&contar=1", Status: 200, Tem: P6},
		{Nome: "filtro desconhecido", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?criado_por=" + idConteudista, Status: 400},
		{Nome: "uuid inválido", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?id=xyz", Status: 400},
		{Nome: "ordem fora da lista", Quem: "conteudista", Metodo: "GET", Caminho: "/conteudo/pecas?ordem=titulo", Status: 400},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/conteudo/pecas", Status: 401},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/conteudo/pecas", Status: 401},
	})
	if w := m.Resposta(t, "conteudistaA1", "GET", "/conteudo/pecas?limite=1&contar=1", ""); w.Header().Get("X-Total-Count") != "5" {
		t.Errorf("X-Total-Count = %q, esperava 5", w.Header().Get("X-Total-Count"))
	}
	// filhas: presas à peça visível
	lista("conteudista", "/conteudo/arquivos?peca_id="+P1, AR1+","+AR2)
	lista("conteudista", "/conteudo/arquivos?account_id="+A2, AR3)
	lista("conteudistaA1", "/conteudo/arquivos", AR1+","+AR2)
	lista("conteudistaA1", "/conteudo/arquivos?peca_id="+P3, "")
	lista("conteudistaA1", "/conteudo/eventos?peca_id="+P3, "")
	if st, b := m.Pedir(t, "conteudista", "GET", "/conteudo/eventos?peca_id="+P1, ""); st != 200 || !strings.Contains(b, `"acao":"criou"`) || !strings.Contains(b, `"account_id":"`+A1+`"`) {
		t.Errorf("eventos da P1: %d %s", st, b)
	}
	// ideias e blocos: "desta marca ou de todas"
	lista("conteudista", "/conteudo/ideias?da_marca="+A1+"&descartada=false", strings.Join([]string{I5, I2, I1}, ","))
	lista("conteudistaA1", "/conteudo/ideias", strings.Join([]string{I5, I4, I2, I1}, ","))
	lista("conteudistaA1", "/conteudo/ideias?da_marca="+A2, I2)
	lista("conteudista", "/conteudo/ideias?situacao=favorita", I3)
	lista("conteudista", "/conteudo/blocos?da_marca="+A1+"&ativo=true", B2+","+B1) // ordem: tipo
	lista("conteudistaA1", "/conteudo/blocos", B4+","+B2+","+B1)
	// concorrentes: SEM a restritiva (Ruling 5.9-5) — quem só vê A1 lê os de A2, como hoje
	lista("conteudistaA1", "/conteudo/concorrentes?account_id="+A2+"&ativo=true", K2)
	lista("semModulo", "/conteudo/concorrentes", "")
	// jobs: a restritiva
	lista("conteudista", "/conteudo/jobs", J2+","+J1)
	lista("conteudistaA1", "/conteudo/jobs", J1)
	lista("conteudistaA1", "/conteudo/jobs?id="+J2, "")
	if st, b := m.Pedir(t, "conteudista", "GET", "/conteudo/jobs?id="+J1, ""); st != 200 || !strings.Contains(b, `"resultado":{"gravadas": 12}`) || strings.Contains(b, "criado_por") {
		t.Errorf("job J1: %d %s", st, b)
	}
}
