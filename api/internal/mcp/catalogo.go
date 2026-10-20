package mcp

// A Central inteira para o modelo: o catálogo de tabelas e funções e as ferramentas genéricas (consultar, criar,
// editar, apagar, executar_rpc). O catálogo é montado na subida com o que a API JÁ declara — a rota de cada tabela
// vem do contrato da tela (contrato_front.json), os filtros, ordens e campos das declarações das rotas
// (dados.Declaradas), as funções da lista branca de RPC — e a escrita segue a convenção da tela
// (src/compartilhado/banco-pela-api.js, escreverPelaApi): criar = POST rota, editar = PATCH rota/{id} (rota, se for
// linha única), apagar = DELETE rota/{id}. Nada daqui decide permissão: cada chamada passa pelo autz da rota, como
// na tela, e o que a pessoa não pode volta como a frase de recusa da API.

import (
	"encoding/json"
	"fmt"
	"maps"
	"math"
	"net/http"
	"net/url"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

type tabelaDoCatalogo struct {
	Area, Rota string
	LinhaUnica bool
	Ler        bool // há GET na rota
	Consulta   bool // a leitura é dados.Consulta (aceita limite e ordem)
	Filtros    map[string]string
	Ordens     []string
	Criar      []string
	Editar     []string
	Apagar     bool
}

type catalogo struct {
	tabelas map[string]tabelaDoCatalogo
	rpcs    map[string]rpc.Funcao
}

// semParamFinal: "/frota/requisicoes/{id}" → "/frota/requisicoes", true.
func semParamFinal(caminho string) (string, bool) {
	i := strings.LastIndex(caminho, "/{")
	if i < 0 || !strings.HasSuffix(caminho, "}") || strings.Contains(caminho[i+2:len(caminho)-1], "/") {
		return caminho, false
	}
	return caminho[:i], true
}

func montarCatalogo(r chi.Routes, contrato []byte, funcoes []rpc.Funcao) (*catalogo, error) {
	var c struct {
		Tabelas map[string]struct {
			Area       string  `json:"area"`
			Rota       *string `json:"rota"`
			LinhaUnica bool    `json:"linhaUnica"`
		} `json:"tabelas"`
	}
	if err := json.Unmarshal(contrato, &c); err != nil {
		return nil, fmt.Errorf("mcp: contrato da tela ilegível: %w", err)
	}
	// o que existe no roteador: "GET /x" e, para as rotas com parâmetro final, "PATCH /x/{}"
	existe := map[string]bool{}
	if err := chi.Walk(r, func(metodo, caminho string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if base, ok := semParamFinal(caminho); ok {
			existe[metodo+" "+base+"/{}"] = true
		} else {
			existe[metodo+" "+caminho] = true
		}
		return nil
	}); err != nil {
		return nil, err
	}
	decl := dados.Declaradas()
	cat := &catalogo{tabelas: map[string]tabelaDoCatalogo{}, rpcs: map[string]rpc.Funcao{}}
	for nome, t := range c.Tabelas {
		if t.Rota == nil || !existe["GET "+*t.Rota] && !existe["POST "+*t.Rota] {
			continue // sem rota na API (a tela não lê pela API ou a rota é outra porta)
		}
		d := decl[nome]
		x := tabelaDoCatalogo{Area: t.Area, Rota: *t.Rota, LinhaUnica: t.LinhaUnica, Ler: existe["GET "+*t.Rota]}
		if x.Ler && d.Ler {
			x.Consulta, x.Filtros, x.Ordens = true, d.Filtros, d.Ordens
		}
		if existe["POST "+x.Rota] {
			x.Criar = d.Criar
		}
		if alvo := x.Rota + "/{}"; x.LinhaUnica && existe["PATCH "+x.Rota] || !x.LinhaUnica && existe["PATCH "+alvo] {
			x.Editar = d.Editar
		}
		x.Apagar = d.Apagar && existe["DELETE "+x.Rota+"/{}"]
		cat.tabelas[nome] = x
	}
	for _, f := range funcoes {
		cat.rpcs[f.Nome] = f
	}
	return cat, nil
}

func (c *catalogo) areas() []string {
	vistas := map[string]bool{}
	for _, t := range c.tabelas {
		vistas[t.Area] = true
	}
	return slices.Sorted(maps.Keys(vistas))
}

// ---- as ferramentas genéricas ----

// verCatalogo: sem área, o mapa (áreas e tabelas); com área, o que cada tabela aceita; area=rpc, as funções.
func verCatalogo(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Area string `json:"area"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	cat := c.s.catalogo
	switch in.Area {
	case "":
		mapa := map[string][]string{}
		for nome, t := range cat.tabelas {
			mapa[t.Area] = append(mapa[t.Area], nome)
		}
		for _, l := range mapa {
			sort.Strings(l)
		}
		return jsonDe(map[string]any{"areas": mapa, "rpc": fmt.Sprintf("%d funções: catalogo com area=rpc", len(cat.rpcs))})
	case "rpc":
		lista := map[string]string{}
		for nome, f := range cat.rpcs {
			ps := make([]string, len(f.Params))
			for i, p := range f.Params {
				ps[i] = p.Nome + " " + p.Tipo
				if p.Opcional {
					ps[i] += "?"
				}
			}
			lista[nome] = strings.Join(ps, ", ")
		}
		return jsonDe(lista)
	}
	if !slices.Contains(cat.areas(), in.Area) {
		return recusa("area deve ser rpc ou uma de: " + strings.Join(cat.areas(), ", "))
	}
	saida := map[string]any{}
	for nome, t := range cat.tabelas {
		if t.Area != in.Area {
			continue
		}
		d := map[string]any{}
		if t.Ler {
			l := map[string]any{}
			if len(t.Filtros) > 0 {
				l["filtros"] = t.Filtros
			}
			if len(t.Ordens) > 0 {
				l["ordens"] = t.Ordens
			}
			d["consultar"] = l
		}
		if len(t.Criar) > 0 {
			d["criar"] = t.Criar
		}
		if len(t.Editar) > 0 {
			d["editar"] = t.Editar
		}
		if t.Apagar {
			d["apagar"] = true
		}
		if t.LinhaUnica {
			d["linha_unica"] = true
		}
		saida[nome] = d
	}
	return jsonDe(saida)
}

func (cat *catalogo) tabela(nome string) (tabelaDoCatalogo, string) {
	t, ok := cat.tabelas[nome]
	if !ok {
		return t, "tabela fora do catálogo: " + nome + ". Veja as tabelas com a ferramenta catalogo."
	}
	return t, ""
}

func consultar(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Tabela  string         `json:"tabela"`
		Filtros map[string]any `json:"filtros"`
		Ordem   string         `json:"ordem"`
		Desc    bool           `json:"desc"`
		Limite  *float64       `json:"limite"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	t, erro := c.s.catalogo.tabela(in.Tabela)
	if erro != "" {
		return recusa(erro)
	}
	if !t.Ler {
		return recusa(in.Tabela + " não tem leitura pela API.")
	}
	q := url.Values{}
	for k, v := range in.Filtros {
		if _, ok := t.Filtros[k]; !ok {
			return recusa(fmt.Sprintf("filtro que %s não aceita: %s. Aceita: %s", in.Tabela, k, strings.Join(slices.Sorted(maps.Keys(t.Filtros)), ", ")))
		}
		switch x := v.(type) {
		case []any:
			partes := make([]string, len(x))
			for i, p := range x {
				partes[i] = fmt.Sprint(p)
			}
			q.Set(k, strings.Join(partes, ","))
		case nil:
			return recusa("filtro " + k + " sem valor")
		default:
			q.Set(k, fmt.Sprint(x))
		}
	}
	if t.Consulta {
		limite := 20
		if in.Limite != nil {
			if *in.Limite < 1 || *in.Limite > 200 || *in.Limite != math.Trunc(*in.Limite) {
				return recusa("limite deve ser um inteiro de 1 a 200")
			}
			limite = int(*in.Limite)
		}
		q.Set("limite", strconv.Itoa(limite))
		if in.Ordem != "" {
			if !slices.Contains(t.Ordens, in.Ordem) {
				return recusa(fmt.Sprintf("ordem que %s não aceita: %s. Aceita: %s", in.Tabela, in.Ordem, strings.Join(t.Ordens, ", ")))
			}
			if in.Desc {
				q.Set("ordem", in.Ordem+".desc")
			} else {
				q.Set("ordem", in.Ordem)
			}
		}
	} else if in.Ordem != "" || in.Limite != nil {
		return recusa(in.Tabela + " não aceita ordem nem limite.")
	}
	return resultado(c.pedir(http.MethodGet, t.Rota, q, nil))
}

// camposPermitidos confere que só vão campos que a rota declara (a rota recusaria; aqui a frase diz quais pode).
func camposPermitidos(tabela, op string, campos map[string]json.RawMessage, pode []string) string {
	if len(pode) == 0 {
		return tabela + " não aceita " + op + " pela API."
	}
	if len(campos) == 0 {
		return "nada para gravar. Campos: " + strings.Join(pode, ", ")
	}
	for k := range campos {
		if !slices.Contains(pode, k) {
			return fmt.Sprintf("campo que %s não grava ao %s: %s. Pode: %s", tabela, op, k, strings.Join(pode, ", "))
		}
	}
	return ""
}

func criar(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Tabela string                     `json:"tabela"`
		Campos map[string]json.RawMessage `json:"campos"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	t, erro := c.s.catalogo.tabela(in.Tabela)
	if erro == "" {
		erro = camposPermitidos(in.Tabela, "criar", in.Campos, t.Criar)
	}
	if erro != "" {
		return recusa(erro)
	}
	return resultado(c.pedir(http.MethodPost, t.Rota, nil, in.Campos))
}

func editar(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Tabela string                     `json:"tabela"`
		ID     string                     `json:"id"`
		Campos map[string]json.RawMessage `json:"campos"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	t, erro := c.s.catalogo.tabela(in.Tabela)
	if erro == "" {
		erro = camposPermitidos(in.Tabela, "editar", in.Campos, t.Editar)
	}
	if erro != "" {
		return recusa(erro)
	}
	destino := t.Rota
	if !t.LinhaUnica {
		if strings.TrimSpace(in.ID) == "" {
			return recusa("falta o id da linha (use consultar para achar)")
		}
		destino += "/" + url.PathEscape(in.ID)
	}
	return resultado(c.pedir(http.MethodPatch, destino, nil, in.Campos))
}

func apagar(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Tabela string `json:"tabela"`
		ID     string `json:"id"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	t, erro := c.s.catalogo.tabela(in.Tabela)
	if erro != "" {
		return recusa(erro)
	}
	if !t.Apagar {
		return recusa(in.Tabela + " não aceita apagar pela API.")
	}
	if strings.TrimSpace(in.ID) == "" {
		return recusa("falta o id da linha (use consultar para achar)")
	}
	return resultado(c.pedir(http.MethodDelete, t.Rota+"/"+url.PathEscape(in.ID), nil, nil))
}

func executarRPC(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Nome string                     `json:"nome"`
		Args map[string]json.RawMessage `json:"args"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	f, ok := c.s.catalogo.rpcs[in.Nome]
	if !ok {
		return recusa("função fora da lista: " + in.Nome + ". Veja as funções com catalogo area=rpc.")
	}
	for k := range in.Args {
		if !slices.ContainsFunc(f.Params, func(p rpc.Param) bool { return p.Nome == k }) {
			return recusa("parâmetro que " + in.Nome + " não tem: " + k)
		}
	}
	if in.Args == nil {
		in.Args = map[string]json.RawMessage{}
	}
	return resultado(c.pedir(http.MethodPost, "/rpc/"+in.Nome, nil, in.Args))
}

func jsonDe(v any) (string, bool) {
	b, err := json.Marshal(v)
	if err != nil {
		return recusa("erro ao montar a resposta")
	}
	return string(b), false
}

const pTabela = `"tabela":{"type":"string","description":"Nome da tabela, como o catalogo mostra."}`

var ferramentasDaCentral = []ferramenta{
	{nome: "catalogo", titulo: "Ver o que a Central tem", leitura: true,
		descricao: "Mapa da Central: sem area, as áreas e suas tabelas; com area, o que cada tabela aceita (filtros e " +
			"ordens para consultar, campos para criar e editar, se apaga); area=rpc lista as funções e seus parâmetros. " +
			"Use antes de consultar ou gravar numa tabela que você ainda não viu.",
		esquema: `{"type":"object","properties":{"area":{"type":"string","description":"Área (ex.: frota, comercial, acessos) ou rpc."}},"additionalProperties":false}`,
		rodar:   verCatalogo},
	{nome: "consultar", titulo: "Consultar uma tabela", leitura: true,
		descricao: "Lê linhas de uma tabela da Central com os filtros que ela aceita (veja no catalogo). Só volta o que " +
			"a pessoa pode ver na tela. Padrão: 20 linhas.",
		esquema: `{"type":"object","required":["tabela"],"properties":{` + pTabela + `,` +
			`"filtros":{"type":"object","description":"filtro → valor (lista vira valores separados por vírgula)."},` +
			`"ordem":{"type":"string"},"desc":{"type":"boolean"},` +
			`"limite":{"type":"integer","minimum":1,"maximum":200}},"additionalProperties":false}`,
		rodar: consultar},
	{nome: "criar", titulo: "Criar linha numa tabela",
		descricao: "Cria uma linha com os campos que a tabela aceita (veja no catalogo). Confirme os valores com a " +
			"pessoa antes. A regra de quem pode é a da tela.",
		esquema: `{"type":"object","required":["tabela","campos"],"properties":{` + pTabela + `,` +
			`"campos":{"type":"object"}},"additionalProperties":false}`,
		rodar: criar},
	{nome: "editar", titulo: "Editar linha de uma tabela", destrutiva: true,
		descricao: "Altera campos de uma linha (id) com os campos que a tabela aceita (veja no catalogo). Confirme com " +
			"a pessoa antes. Tabela de linha única não leva id.",
		esquema: `{"type":"object","required":["tabela","campos"],"properties":{` + pTabela + `,` +
			`"id":{"type":"string"},"campos":{"type":"object"}},"additionalProperties":false}`,
		rodar: editar},
	{nome: "apagar", titulo: "Apagar linha de uma tabela", destrutiva: true,
		descricao: "Apaga uma linha (id). Só nas tabelas que aceitam apagar (veja no catalogo). Peça confirmação " +
			"explícita da pessoa, dizendo o que vai sumir.",
		esquema: `{"type":"object","required":["tabela","id"],"properties":{` + pTabela + `,` +
			`"id":{"type":"string"}},"additionalProperties":false}`,
		rodar: apagar},
	{nome: "executar_rpc", titulo: "Executar função da Central", destrutiva: true,
		descricao: "Executa uma função da lista branca (catalogo area=rpc) com os parâmetros dela. Algumas gravam: " +
			"confirme com a pessoa antes.",
		esquema: `{"type":"object","required":["nome"],"properties":{"nome":{"type":"string"},` +
			`"args":{"type":"object"}},"additionalProperties":false}`,
		rodar: executarRPC},
}
