package fabrica

import (
	"fmt"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const novaRodada = "a5899999-0000-4000-a000-000000000001" // uuid que não existe em fabrica_campanhas

func mundoRobo(t *testing.T) *mundoteste.Mundo {
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { montarRobo(r, p) })
}

func criativoJSON(campanha, caminho, extra string) string {
	return fmt.Sprintf(`{"campanha_id":"%s","arquetipo":"produto","template":"produto-heroi","formato":"1080x1080",`+
		`"storage_path":"%s","url":"https://midia.x/f/a.png"%s}`, campanha, caminho, extra)
}

func TestRotasDeRobo(t *testing.T) {
	m := mundoRobo(t)
	m.P.Exec(t.Context(), `update fabrica_jobs set updated_at = '2026-10-10T10:00:00Z'`)

	// As 7 rotas com um corpo válido: só a sessão de serviço do perfil do robô grava.
	rotas := []struct{ metodo, caminho, corpo string }{
		{"PATCH", "/fabrica/robo/jobs/" + J1, `{"status":"concluido"}`},
		{"POST", "/fabrica/robo/jobs/" + J1 + "/proximo-lote", ``},
		{"PATCH", "/fabrica/robo/campanhas/" + C2, `{"status":"pronta"}`},
		{"POST", "/fabrica/robo/criativos", `[` + criativoJSON(C2, C2+"/produto/x.png", "") + `]`},
		{"PATCH", "/fabrica/robo/looks/promo-sage", `{"preview_url":"https://midia.x/f/p.png"}`},
		{"POST", "/fabrica/robo/meta-jobs", `{"tipo":"estudio"}`},
		{"POST", "/fabrica/robo/execucoes", `{"robo":"fabrica","acao":"x"}`},
	}
	antes := m.Um(t, fotoDaFabrica)
	for _, r := range rotas {
		// painel (mesmo o que passaria no Fabricante), "entrar como" e robô sem a chave: 403; sem sessão: 401
		for _, quem := range []string{"fabricante", "adminA1", "super", "leitor", "impersonado", "roboSemFabrica"} {
			if st, corpo := m.Pedir(t, quem, r.metodo, r.caminho, r.corpo); st != 403 {
				t.Errorf("%s %s como %s = %d %s, esperava 403", r.metodo, r.caminho, quem, st, corpo)
			}
		}
		if st, _ := m.Pedir(t, "", r.metodo, r.caminho, r.corpo); st != 401 {
			t.Errorf("%s %s sem sessão = %d, esperava 401", r.metodo, r.caminho, st)
		}
	}
	if depois := m.Um(t, fotoDaFabrica); depois != antes {
		t.Fatal("uma rota de robô gravou para quem não podia")
	}

	// Jobs
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "job ok", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Status: 204,
			Corpo:  `{"status":"concluido","resultado":{"criativos":3},"erro":null,"github_run_id":"999"}`,
			Efeito: `select (status = 'concluido' and resultado->>'criativos' = '3' and erro is null and github_run_id = '999' and updated_at > '2026-10-10T10:00:00Z')::text from fabrica_jobs where id = '` + J1 + `'`, Quer: "true"},
		{Nome: "status fora", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Corpo: `{"status":"x"}`, Status: 400},
		{Nome: "run id", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Corpo: `{"github_run_id":"12a"}`, Status: 400},
		{Nome: "vazio", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Corpo: `{}`, Status: 400},
		{Nome: "criado_por", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Corpo: `{"criado_por":"` + idRobo + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "updated_at do corpo", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + J1, Corpo: `{"updated_at":"2001-01-01T00:00:00Z"}`, Status: 400, Tem: "corpo_invalido",
			Efeito: `select (updated_at > '2026-10-10T10:00:00Z')::text from fabrica_jobs where id = '` + J1 + `'`, Quer: "true"},
		{Nome: "job inexistente", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/" + novaRodada, Corpo: `{"status":"erro"}`, Status: 404},
		{Nome: "id não é uuid", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/jobs/x", Corpo: `{"status":"erro"}`, Status: 404},
	})

	// Próximo lote: idempotente, J2 (subir) e continuacao 300 recusados.
	st, corpo := m.Pedir(t, "robo", "POST", "/fabrica/robo/jobs/"+J1+"/proximo-lote", "")
	if st != 201 {
		t.Fatalf("proximo-lote = %d %s", st, corpo)
	}
	novo := m.Um(t, `select id::text from fabrica_jobs where tipo = 'gerar' and params->>'continuacao' = '1'`)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "lote criado", Quer: "true", Efeito: `select (tipo = 'gerar' and status = 'enfileirado' and criado_por = '` + idRobo + `' and params->>'continuacao' = '1' and params->>'campanhaId' = '` + C1 + `' and params->>'objetivo' = 'engajamento') ::text from fabrica_jobs where id = '` + novo + `'`},
		{Nome: "rodada ligada", Quer: novo, Efeito: `select job_id::text from fabrica_campanhas where id = '` + C1 + `'`},
		{Nome: "de novo: o mesmo", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/jobs/" + J1 + "/proximo-lote", Status: 200, Tem: novo},
		{Nome: "um só job novo", Quer: "1", Efeito: `select count(*)::text from fabrica_jobs where tipo = 'gerar' and params->>'continuacao' = '1'`},
		{Nome: "subir não encadeia", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/jobs/" + J2 + "/proximo-lote", Status: 400},
		{Nome: "inexistente", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/jobs/" + novaRodada + "/proximo-lote", Status: 404},
	})
	m.P.Exec(t.Context(), `update fabrica_jobs set params = jsonb_set(params, '{continuacao}', '300') where id = '`+novo+`'`)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "teto de lotes", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/jobs/" + novo + "/proximo-lote", Status: 409, Tem: "limite_de_lotes",
			Efeito: `select count(*)::text from fabrica_jobs where tipo = 'gerar'`, Quer: "2"},
	})

	// Campanhas
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "status", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + C1, Corpo: `{"status":"pronta"}`, Status: 200, Tem: `"status":"pronta"`},
		{Nome: "fechar", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + C2, Corpo: `{"fechar":true}`, Status: 200,
			Efeito: `select (fechada_em between now() - interval '1 minute' and now() + interval '1 minute')::text from fabrica_campanhas where id = '` + C2 + `'`, Quer: "true"},
		{Nome: "fechada_em do corpo", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + C3, Corpo: `{"fechada_em":"2001-01-01T00:00:00Z"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "status fora", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + C3, Corpo: `{"status":"publicada"}`, Status: 400},
		{Nome: "fechar false", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + C3, Corpo: `{"fechar":false}`, Status: 400},
		{Nome: "inexistente", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/campanhas/" + novaRodada, Corpo: `{"status":"erro"}`, Status: 404},
		{Nome: "C3 intacta", Quer: "2026-10-05 10:00:00+00", Efeito: `select fechada_em::text from fabrica_campanhas where id = '` + C3 + `'`},
	})

	// Criativos: uma linha ruim = nenhuma gravada
	ok := criativoJSON(C2, C2+"/produto/boa.png", "")
	recusados := map[string]string{
		"..":               criativoJSON(C2, "../x.png", ""),
		"outra rodada":     criativoJSON(C2, C1+"/x.png", ""),
		"absoluto":         criativoJSON(C2, "/abs.png", ""),
		"contrabarra":      criativoJSON(C2, C2+`/a\\b.png`, ""),
		"sem pasta":        criativoJSON(C2, C2+"x.png", ""),
		"escapa da rodada": criativoJSON(C2, C2+"/../"+C1+"/x.png", ""),
		"url":              `{"campanha_id":"` + C2 + `","arquetipo":"produto","template":"t","formato":"f","storage_path":"` + C2 + `/a.png","url":"javascript:x"}`,
		"preço":            criativoJSON(C2, C2+"/p.png", `,"preco_de":-1`),
		"campo extra":      criativoJSON(C2, C2+"/p.png", `,"escolhido":true`),
	}
	for nome, c := range recusados {
		st, corpo := m.Pedir(t, "robo", "POST", "/fabrica/robo/criativos", `[`+ok+`,`+c+`]`)
		if st != 400 {
			t.Errorf("%s = %d %s, esperava 400", nome, st, corpo)
		}
	}
	muitos := "["
	for i := 0; i < 201; i++ {
		if i > 0 {
			muitos += ","
		}
		muitos += ok
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "201 itens", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/criativos", Corpo: muitos + "]", Status: 400},
		{Nome: "objeto", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/criativos", Corpo: `{}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "lista vazia", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/criativos", Corpo: `[]`, Status: 400},
		{Nome: "rodada inexistente", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/criativos", Status: 409, Tem: "conflito",
			Corpo: `[` + ok + `,` + criativoJSON(novaRodada, novaRodada+"/x.png", "") + `]`},
		{Nome: "nada gravado", Quer: "4", Efeito: `select count(*)::text from fabrica_criativos`},
		{Nome: "duas linhas", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/criativos", Status: 201, Tem: `"criados":2`,
			Corpo: `[` + criativoJSON(C2, C2+"/produto/s2-avista-1080x1350.png", `,"variante":"avista","sku":"S2","preco_de":100,"preco_por":70,"legenda":"Oi"`) + `,` +
				`{"campanha_id":"` + C2 + `","arquetipo":"promo","template":"promo-sage","formato":"1080x1920","storage_path":"` + C2 + `/promo/c.png","url":"https://midia.x/f/c.png"}]`},
		{Nome: "gravadas", Quer: "true", Efeito: `select (count(*) = 2 and bool_and(escolhido = false) and count(*) filter (where sku = 'S2' and preco_por = 70 and legenda = 'Oi') = 1)::text from fabrica_criativos where storage_path in ('` + C2 + `/produto/s2-avista-1080x1350.png', '` + C2 + `/promo/c.png')`},
	})

	// Looks
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "preview", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/looks/promo-sage", Status: 204,
			Corpo:  `{"preview_url":"https://midia.x/f/_previews/promo-sage-1080x1350.png"}`,
			Efeito: `select preview_url from fabrica_looks where chave = 'promo-sage'`, Quer: "https://midia.x/f/_previews/promo-sage-1080x1350.png"},
		{Nome: "look inexistente", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/looks/nao-existe", Corpo: `{"preview_url":"https://midia.x/a.png"}`, Status: 404},
		{Nome: "chave inválida", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/looks/A%20B", Corpo: `{"preview_url":"https://midia.x/a.png"}`, Status: 404},
		{Nome: "ftp", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/looks/promo-sage", Corpo: `{"preview_url":"ftp://x"}`, Status: 400},
		{Nome: "outra coluna", Quem: "robo", Metodo: "PATCH", Caminho: "/fabrica/robo/looks/promo-sage", Corpo: `{"preview_url":"https://midia.x/a.png","ativo":false}`, Status: 400, Tem: "corpo_invalido"},
	})

	// Rastro da Meta
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "rastro", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/meta-jobs", Status: 201, Tem: `"id"`,
			Corpo: `{"tipo":"estudio","ad_account_id":"act_111","loja":"Tivoli (Santa Bárbara)","meta_campaign_id":"120002","adset_ids":["1"],"ad_ids":["2","3"],` +
				`"payload":{"campanhaId":"` + C2 + `","destino":{"tipo":"nova"}},"status":"parcial","erro":"rate limit — 1 pendente(s)"}`},
		{Nome: "gravado", Quer: "true", Efeito: `select (ad_account_id = 'act_111' and meta_campaign_id = '120002' and jsonb_array_length(ad_ids::jsonb) = 2 and payload->>'campanhaId' = '` + C2 + `' and status = 'parcial')::text from fabrica_meta_jobs where payload->>'campanhaId' = '` + C2 + `'`},
		{Nome: "conta sem act_", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/meta-jobs", Corpo: `{"tipo":"estudio","ad_account_id":"111"}`, Status: 400},
		{Nome: "campanhaId ruim", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/meta-jobs", Corpo: `{"tipo":"estudio","payload":{"campanhaId":"x"}}`, Status: 400},
		{Nome: "status ok", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/meta-jobs", Corpo: `{"tipo":"estudio","status":"ok"}`, Status: 400},
		{Nome: "sem tipo", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/meta-jobs", Corpo: `{"loja":"x"}`, Status: 400},
		{Nome: "um só", Quer: "2", Efeito: `select count(*)::text from fabrica_meta_jobs`},
	})

	// Execuções
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "execução", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/execucoes", Status: 201, Tem: `"id"`,
			Corpo: `{"robo":"fabrica-gerar","acao":"gerar criativos","modelo":"gpt-image-2","itens":3,"unidade":"criativos","status":"ok","detalhe":"completo","duracao_ms":1000,"github_run_id":"999"}`},
		{Nome: "padrões", Quer: "true", Efeito: `select (usd = 0 and input_tokens = 0 and itens = 3 and github_run_id = '999')::text from ia_execucoes where acao = 'gerar criativos'`},
		{Nome: "null = padrão", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/execucoes", Status: 201,
			Corpo: `{"robo":"fabrica-subir","acao":"subir campanha","usd":null,"status":null}`},
		{Nome: "padrão do banco", Quer: "true", Efeito: `select (usd = 0 and status = 'ok')::text from ia_execucoes where acao = 'subir campanha'`},
		{Nome: "outro robô", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/execucoes", Corpo: `{"robo":"budget-ia","acao":"x"}`, Status: 400},
		{Nome: "itens negativo", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/execucoes", Corpo: `{"robo":"fabrica","acao":"x","itens":-1}`, Status: 400},
		{Nome: "usd texto", Quem: "robo", Metodo: "POST", Caminho: "/fabrica/robo/execucoes", Corpo: `{"robo":"fabrica","acao":"x","usd":"x"}`, Status: 400},
		{Nome: "duas linhas", Quer: "2", Efeito: `select count(*)::text from ia_execucoes`},
	})

	// O robô lê pelas rotas do painel (a regra do perfil dele).
	mr := novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { montarLeituras(r, p) })
	mr.Rodar(t, []mundoteste.Caso{
		{Nome: "job", Quem: "robo", Metodo: "GET", Caminho: "/fabrica/jobs?id=" + J1, Status: 200, Tem: J1},
		{Nome: "marcas", Quem: "robo", Metodo: "GET", Caminho: "/fabrica/marcas", Status: 200, Tem: M2},
	})
	if r := mr.Resposta(t, "robo", "GET", "/fabrica/criativos?campanha_id="+C1+"&limite=1&contar=1", ""); r.Code != 200 || r.Header().Get("X-Total-Count") != "2" {
		t.Errorf("contagem de criativos: %d %s total=%q", r.Code, r.Body, r.Header().Get("X-Total-Count"))
	}
}
