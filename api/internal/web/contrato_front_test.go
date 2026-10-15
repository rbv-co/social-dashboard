package web

// Plano 02 do esforço REVISAO-TESTES-2026-10 (item A): o CONTRATO ESTÁTICO front ↔ API.
//
// A entrada é testdata/contrato_front.json, gerado do código do front por
// src/compartilhado/extrair-contrato-front.mjs (o teste npm daquele arquivo reprova se o JSON ficar velho).
// Aqui o JSON é confrontado com a API de verdade: o roteador montado (chi.Walk), o registro de RPC e os
// filtros/ordens que cada rota ACEITA (sonda HTTP com a sessão de superadmin). Chamada do front sem rota,
// filtro que a rota não conhece, ordem recusada ou escrita sem método reprovam.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

type contratoFront struct {
	TetoDeLinhas int `json:"tetoDeLinhas"`
	Tabelas      map[string]struct {
		Area             string   `json:"area"`
		Rota             *string  `json:"rota"`
		Params           []string `json:"params"`
		Ordens           []string `json:"ordens"`
		OrdemFixa        bool     `json:"ordemFixa"`
		LinhaUnica       bool     `json:"linhaUnica"`
		Chave            string   `json:"chave"`
		PaginaAteOLimite bool     `json:"paginaAteOLimite"`
		Escritas         []struct {
			Metodo  string `json:"metodo"`
			Caminho string `json:"caminho"`
		} `json:"escritas"`
	} `json:"tabelas"`
	Usos struct {
		Tabelas  map[string]usoFront `json:"tabelas"`
		RPCs     map[string]usoFront `json:"rpcs"`
		Edges    map[string]usoFront `json:"edges"`
		Caminhos map[string]usoFront `json:"caminhos"`
	} `json:"usos"`
}

type usoFront struct {
	Arquivos []string `json:"arquivos"`
	Escreve  []string `json:"escreve"`
}

func lerContratoFront(t *testing.T) contratoFront {
	t.Helper()
	b, err := os.ReadFile("testdata/contrato_front.json")
	if err != nil {
		t.Fatalf("contrato do front: %v (gere com: node src/compartilhado/extrair-contrato-front.mjs)", err)
	}
	var c contratoFront
	if err := json.Unmarshal(b, &c); err != nil {
		t.Fatal(err)
	}
	return c
}

// doPainel: o uso tem pelo menos um arquivo de src/ (o painel). Os robôs do coletor/ falam com o banco pelo
// próprio caminho e são do plano 06.
func (u usoFront) doPainel() bool {
	for _, a := range u.Arquivos {
		if strings.HasPrefix(a, "src/") {
			return true
		}
	}
	return false
}

var reParamDeRota = regexp.MustCompile(`\{[^}]*\}`)

// forma tira o nome dos parâmetros de caminho: `/x/{id}` e `/x/${id}` do front viram `/x/{}`.
func forma(caminho string) string { return reParamDeRota.ReplaceAllString(caminho, "{}") }

// rotasDaApi: "METODO /forma" de toda rota montada.
func rotasDaApi(t *testing.T, h http.Handler) map[string]bool {
	t.Helper()
	rotas := map[string]bool{}
	err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		rotas[metodo+" "+forma(strings.TrimSuffix(rota, "/"))] = true
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return rotas
}

func temRota(rotas map[string]bool, metodo, caminho string) bool {
	if metodo == "ANY" {
		for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
			if rotas[m+" "+forma(caminho)] {
				return true
			}
		}
		return false
	}
	return rotas[metodo+" "+forma(caminho)]
}

// tabelasSemRota: tabela que o front cita e que NÃO está em ROTAS (banco-pela-api.js). Com a área ligada,
// uma tabela fora de ROTAS cai no Supabase (tabelaNaApi = false), que deixa de existir na virada: por isso
// toda tabela citada tem de estar em ROTAS ou aqui, com o motivo. "ACHADO" = defeito de contrato aberto
// (ACHADOS-02.md); o teste o deixa passar mas o REGISTRA, e reprova quando a entrada fica velha.
var tabelasSemRota = map[string]string{
	"ads_snapshots":           "com a área meta ligada o cartão sai (Ruling 9 do 5.6): `sb('ads_snapshots…')` só roda com a área desligada",
	"conteudo_casamentos":     "só com a área conteudo desligada; ligada, vêm embutidos em /conteudo/pecas (dados-conteudo.js, `_naApi()`)",
	"conteudo_metricas":       "idem conteudo_casamentos",
	"frota_manutencoes":       "ligada a área frota, a gravação é composta: POST /frota/manutencoes (escreverComposto)",
	"gt_ponderada_config_log": "ligada a área trafego, PUT /gestao-trafego/regua grava o histórico junto",
	"ia_execucoes":            "ligada a área paineis: GET /status-ia/execucoes (tela-de-status-claude.vue); o resto é do robô (coletor/)",
	"robos_saude":             "ligada a área paineis: GET /status-ia/saude-dos-robos",
	"noticias_concorrentes":   "ligada a área paineis: GET /noticias/*; o resto é do robô (coletor/)",
	"noticias_panorama":       "ligada a área paineis: GET /noticias/panorama",
	"acessos_drive_marcas":    "ACHADO 02-1: aba Drive do Acessos grava direto no Supabase, sem rota nem ROTAS",
	"acessos_drive_overrides": "ACHADO 02-1",
	"acessos_drive_setores":   "ACHADO 02-1",
	"chatwoot_eventos":        "ACHADO 02-2: o relatório OPR lê `sb('chatwoot_eventos…')`, sem rota de leitura (só o webhook grava)",
}

// escritasDesviadas: escrita simples ("tabela:operação") que ainda está no código do painel, mas que com a
// área ligada a tela desvia para outra rota (um `areaNaApi(...) ? pedir(...) : sbClient.from(...)`). O teste
// não enxerga o desvio, então cada entrada diz para onde ele vai (e o `caminhos` confere que essa rota existe).
var escritasDesviadas = map[string]string{
	"access_requests:insert":           "área admin: POST /pedir-acesso (tela-de-login.vue)",
	"fabrica_criativos:update":         "área fabrica: POST /fabrica/criativos/escolher (painel-curar.vue)",
	"frota_checklist:update":           "área frota: escreverComposto POST /frota/checklists (tela-de-frota.vue)",
	"frota_checklist_respostas:insert": "idem frota_checklist:update",
	"frota_revisoes:insert":            "área frota: escreverComposto POST /frota/manutencoes (tela-de-frota.vue)",
	"gt_ponderada_config:update":       "área trafego: PUT /gestao-trafego/regua (tela-de-gestao-trafego.vue)",
}

// ---------------------------------------------------------------------------------------------------------
// 1. Toda tabela de ROTAS tem a rota, e a rota aceita o que o front manda (filtro, ordem, escrita, teto).

func TestContratoFrontTabelasContraRotas(t *testing.T) {
	c := lerContratoFront(t)
	_, h, sessoes, _, _ := mundoDaMatriz(t)
	rotas := rotasDaApi(t, h)
	tok := sessoes()[pSuper]

	if c.TetoDeLinhas != dados.LimitePadrao {
		t.Errorf("TETO_DE_LINHAS do front = %d, limite da API = %d: o front pediria mais (ou menos) do que a API entrega", c.TetoDeLinhas, dados.LimitePadrao)
	}

	get := func(rota, query string) (int, string) {
		r := httptest.NewRequest("GET", rota+"?"+query, nil)
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}

	nomes := make([]string, 0, len(c.Tabelas))
	for n := range c.Tabelas {
		nomes = append(nomes, n)
	}
	sort.Strings(nomes)
	usadasDesviadas := map[string]bool{}
	validam := 0
	var naoValidam []string
	for _, tabela := range nomes {
		d := c.Tabelas[tabela]
		usa := c.Usos.Tabelas[tabela]
		if d.Rota != nil {
			rota := *d.Rota
			if !temRota(rotas, "GET", rota) {
				// tabela que o front só escreve (sem `select`): a leitura não precisa existir
				if !slices.Contains(usa.Escreve, "insert") && len(usa.Escreve) == 0 && len(d.Escritas) == 0 {
					t.Errorf("%s: ROTAS aponta para GET %s, que a API não tem", tabela, rota)
				}
			} else {
				// A rota valida parâmetro? Sem isso, a sonda de filtro/ordem abaixo não prova nada.
				cod, corpo := get(rota, "zz_inexistente=1")
				valida := cod == 400 && strings.Contains(corpo, "desconhecido")
				if valida {
					validam++
				} else {
					naoValidam = append(naoValidam, tabela+" ("+rota+" -> "+http.StatusText(cod)+")")
				}
				for _, p := range d.Params {
					cod, corpo := get(rota, url.Values{p: {"x"}}.Encode())
					if cod == 400 && strings.Contains(corpo, "desconhecido") {
						t.Errorf("%s: a rota GET %s não aceita o filtro %q que o front manda (%s)", tabela, rota, p, corpo)
					}
				}
				for _, o := range d.Ordens {
					for _, sentido := range []string{"", ".desc"} {
						cod, corpo := get(rota, url.Values{"ordem": {o + sentido}}.Encode())
						if cod == 400 && strings.Contains(corpo, "ordem inv") {
							t.Errorf("%s: a rota GET %s recusa a ordem %q que o front pede (%s)", tabela, rota, o+sentido, corpo)
						}
					}
				}
				if cod, corpo := get(rota, "limite=1000"); cod == 400 {
					t.Errorf("%s: GET %s recusa limite=1000 (o teto do front): %s", tabela, rota, corpo)
				}
				if d.PaginaAteOLimite {
					if cod, corpo := get(rota, "limite=1000&deslocamento=1000&contar=1"); cod == 400 {
						t.Errorf("%s: GET %s não aceita a paginação por deslocamento/contar que o front usa: %s", tabela, rota, corpo)
					}
				}
			}
		}
		// escritas declaradas em ROTAS (upsert/apagarPor)
		for _, e := range d.Escritas {
			if !temRota(rotas, e.Metodo, e.Caminho) {
				t.Errorf("%s: o front escreve com %s %s, que a API não tem", tabela, e.Metodo, e.Caminho)
			}
		}
		// escritas simples que as telas fazem na tabela
		if d.Rota != nil {
			rota := *d.Rota
			for _, op := range usa.Escreve {
				if _, desviada := escritasDesviadas[tabela+":"+op]; desviada {
					usadasDesviadas[tabela+":"+op] = true
					continue
				}
				switch op {
				case "insert":
					if !temRota(rotas, "POST", rota) {
						t.Errorf("%s: o front insere (%s), a API não tem POST %s", tabela, strings.Join(usa.Arquivos, ","), rota)
					}
				case "update":
					alvo := rota + "/{}"
					if d.LinhaUnica {
						alvo = rota
					}
					if !temRota(rotas, "PATCH", alvo) {
						t.Errorf("%s: o front atualiza (%s), a API não tem PATCH %s", tabela, strings.Join(usa.Arquivos, ","), alvo)
					}
				case "delete":
					if !temRota(rotas, "DELETE", rota+"/{}") && len(d.Escritas) == 0 {
						t.Errorf("%s: o front apaga (%s), a API não tem DELETE %s/{id}", tabela, strings.Join(usa.Arquivos, ","), rota)
					}
				case "upsert":
					if len(d.Escritas) == 0 {
						t.Errorf("%s: o front faz upsert (%s) e ROTAS não declara como (sem `upsert` em banco-pela-api.js)", tabela, strings.Join(usa.Arquivos, ","))
					}
				}
			}
		}
	}
	for chave := range escritasDesviadas {
		if !usadasDesviadas[chave] {
			t.Errorf("escritasDesviadas tem %q, que o painel não faz mais: tire da lista", chave)
		}
	}
	t.Logf("%d tabelas em ROTAS; %d rotas validam parâmetro desconhecido; sem validação: %s", len(nomes), validam, strings.Join(naoValidam, "; "))
}

// ---------------------------------------------------------------------------------------------------------
// 2. Tudo o que o front chama pelo nome tem destino: tabela, RPC, edge e caminho direto.

// rpcsForaDaLista: o painel ainda cita, mas o Plano 7 troca o sítio e o Ruling 23 manda NÃO expor.
var rpcsForaDaLista = map[string]string{
	"marcar_senha_trocada":        "Ruling 23: o sítio vira POST /auth/trocar-senha (moldura-do-aplicativo.vue)",
	"minha_conta_esta_desativada": "Ruling 23: com a área conta ligada o login diz conta_desativada",
}

func TestContratoFrontUsosTemDestino(t *testing.T) {
	c := lerContratoFront(t)
	_, h, _, _, _ := mundoDaMatriz(t)
	rotas := rotasDaApi(t, h)

	// tabelas
	conhecidasSemRota := map[string]bool{}
	for tabela, u := range c.Usos.Tabelas {
		if _, ok := c.Tabelas[tabela]; ok || !u.doPainel() {
			continue
		}
		motivo, ok := tabelasSemRota[tabela]
		if !ok {
			t.Errorf("tabela %q chamada pelo front (%s) sem rota na API e fora de ROTAS: com a área ligada a chamada cai no Supabase", tabela, strings.Join(u.Arquivos, ", "))
			continue
		}
		conhecidasSemRota[tabela] = true
		if strings.HasPrefix(motivo, "ACHADO") {
			t.Logf("DEFEITO ABERTO %s -> %s [%s]", tabela, motivo, strings.Join(u.Arquivos, ", "))
		}
	}
	for tabela := range tabelasSemRota {
		if !conhecidasSemRota[tabela] {
			t.Errorf("tabelasSemRota tem %q, que o front não chama mais ou que já entrou em ROTAS: tire da lista", tabela)
		}
	}

	// RPCs: só os nomes registrados (FuncoesRPC)
	registradas := map[string]bool{}
	for _, f := range FuncoesRPC {
		registradas[f.Nome] = true
	}
	for nome, u := range c.Usos.RPCs {
		if !u.doPainel() {
			continue
		}
		switch {
		case registradas[nome]:
		case rpcsForaDaLista[nome] != "":
		default:
			t.Errorf("RPC %q chamada pelo front (%s) sem registro em FuncoesRPC: POST /rpc/%s daria 404", nome, strings.Join(u.Arquivos, ", "), nome)
		}
	}

	// o inverso, só informativo: registrada que nenhum literal do painel cita (chamada por nome montado em
	// variável, ou registro sem uso). A extração por texto não enxerga as primeiras.
	var semLiteral []string
	for nome := range registradas {
		if u, ok := c.Usos.RPCs[nome]; !ok || !u.doPainel() {
			semLiteral = append(semLiteral, nome)
		}
	}
	sort.Strings(semLiteral)
	t.Logf("%d RPCs registradas, %d sem literal no painel: %s", len(registradas), len(semLiteral), strings.Join(semLiteral, " "))

	// edges portadas: POST /<nome>
	for nome, u := range c.Usos.Edges {
		if !u.doPainel() {
			continue
		}
		if !temRota(rotas, "POST", "/"+nome) {
			if m, ok := edgesSemRota[nome]; ok {
				t.Logf("edge %s sem rota na API: %s [%s]", nome, m, strings.Join(u.Arquivos, ", "))
				continue
			}
			t.Errorf("edge %q chamada pelo front (%s) sem rota POST /%s na API", nome, strings.Join(u.Arquivos, ", "), nome)
		}
	}
	for nome := range edgesSemRota {
		if _, usada := c.Usos.Edges[nome]; !usada || temRota(rotas, "POST", "/"+nome) {
			t.Errorf("edgesSemRota tem %q, que o front não chama mais ou que já tem rota: tire da lista", nome)
		}
	}

	// caminhos diretos da API
	for chave, u := range c.Usos.Caminhos {
		metodo, caminho, _ := strings.Cut(chave, " ")
		if !temRota(rotas, metodo, caminho) {
			t.Errorf("o front chama %s (%s) e a API não tem essa rota", chave, strings.Join(u.Arquivos, ", "))
		}
	}
}

// edgesSemRota: edge que o front cita e a API não porta, com o motivo.
var edgesSemRota = map[string]string{
	"acessos-proxy": "ACHADO 02-1: decisão documentada (API-PRONTA.md, NOTAS 6-4): sem rota Go; a aba Drive do Acessos chama `${SUPABASE_URL}/functions/v1/acessos-proxy` sem desvio por área",
}
