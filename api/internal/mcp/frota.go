package mcp

// O que a tela da Frota calcula e o modelo precisa saber igual: o estado de cada carro (o selo do cartão) e para
// quem é um pedido de carro. Mesmas regras da ponte do Supabase (supabase/functions/_shared/mcp-frota.js), que
// tinha o teste contra as funções da tela; estado_test.go repete os mesmos casos.

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode"

	"golang.org/x/text/runes"
	"golang.org/x/text/transform"
	"golang.org/x/text/unicode/norm"
)

var estadosDoCarro = []string{"livre", "fixo", "na_rua", "reservado", "oficina", "parado", "fora_da_frota"}

type usoAberto struct {
	VeiculoID  string  `json:"veiculo_id"`
	Tipo       *string `json:"tipo"`
	PessoaID   *string `json:"pessoa_id"`
	PessoaNome *string `json:"pessoa_nome"`
}

type reservaAprovada struct {
	VeiculoID         string  `json:"veiculo_id"`
	PessoaNome        *string `json:"pessoa_nome"`
	RetiradaPrevista  *string `json:"retirada_prevista"`
	DevolucaoPrevista *string `json:"devolucao_prevista"`
}

type pessoa struct {
	ID     string  `json:"id"`
	Nome   string  `json:"nome"`
	Status *string `json:"status"`
}

func texto(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// estadoDoCarro: o selo do cartão (seloDoVeiculo em src/ferramentas/frota/cartao-do-veiculo.js, sobre
// estadoDoVeiculo, quemEstaComOCarro e reservaSegurando): livre = ativo, sem viagem aberta, sem ninguém com ele
// (dono fixo ou posse) e sem reserva aprovada valendo agora. Devolve os campos que entram na linha do carro.
func estadoDoCarro(id, situacao, pessoaID string, usos []usoAberto, reservas []reservaAprovada, pessoas []pessoa, agora time.Time) map[string]any {
	switch situacao {
	case "alienado":
		return map[string]any{"estado": "fora_da_frota"}
	case "em_manutencao":
		return map[string]any{"estado": "oficina"}
	case "inativo":
		return map[string]any{"estado": "parado"}
	}
	nomeDe := func(id string) string {
		if i := slices.IndexFunc(pessoas, func(p pessoa) bool { return p.ID == id }); i >= 0 {
			return pessoas[i].Nome
		}
		return ""
	}
	comNome := func(e map[string]any, nome string) map[string]any {
		if nome != "" {
			e["com_quem"] = nome
		}
		return e
	}
	for _, u := range usos { // linha sem tipo é anterior à migration 028 e vale como viagem
		if u.VeiculoID == id && (u.Tipo == nil || *u.Tipo == "viagem") {
			return comNome(map[string]any{"estado": "na_rua"}, texto(u.PessoaNome))
		}
	}
	for _, u := range usos { // posse: o nome gravado vence; em branco, o do cadastro (posse.js)
		if u.VeiculoID == id && u.Tipo != nil && *u.Tipo == "posse" {
			nome := texto(u.PessoaNome)
			if nome == "" {
				nome = nomeDe(texto(u.PessoaID))
			}
			return comNome(map[string]any{"estado": "fixo", "por_posse": true}, nome)
		}
	}
	if pessoaID != "" {
		return comNome(map[string]any{"estado": "fixo"}, nomeDe(pessoaID))
	}
	for _, r := range reservas {
		ini, err := time.Parse(time.RFC3339, texto(r.RetiradaPrevista))
		if r.VeiculoID != id || err != nil {
			continue
		}
		fim := ini.Add(24 * time.Hour) // sem hora de volta, vale o dia inteiro (seAtropelam)
		if f, err := time.Parse(time.RFC3339, texto(r.DevolucaoPrevista)); err == nil {
			fim = f
		}
		if !agora.Before(ini) && !agora.After(fim) {
			e := map[string]any{"estado": "reservado"}
			if r.PessoaNome != nil {
				e["reservado_para"] = *r.PessoaNome
			}
			if r.DevolucaoPrevista != nil {
				e["ate"] = *r.DevolucaoPrevista
			}
			return e
		}
	}
	return map[string]any{"estado": "livre"}
}

// normalizar: sem acento, minúsculo, espaços simples (para casar nomes e buscas).
func normalizar(s string) string {
	t, _, _ := transform.String(transform.Chain(norm.NFD, runes.Remove(runes.In(unicode.Mn)), norm.NFC), s)
	return strings.Join(strings.Fields(strings.ToLower(t)), " ")
}

func soLetrasENumeros(s string) string {
	return strings.Map(func(r rune) rune {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return unicode.ToUpper(r)
		}
		return -1
	}, s)
}

// lerJSON: GET interno que tem de dar certo (a resposta depende dele).
func lerJSON(c chamada, metodo, caminho string, q url.Values, dst any) error {
	st, corpo := c.pedir(metodo, caminho, q, nil)
	if st != http.StatusOK {
		txt, _ := resultado(st, corpo)
		return fmt.Errorf("não consegui ler %s: %s", caminho, txt)
	}
	return json.Unmarshal(corpo, dst)
}

func listarVeiculos(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		Busca    *string  `json:"busca"`
		Situacao string   `json:"situacao"`
		Estado   string   `json:"estado"`
		Limite   *float64 `json:"limite"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	if in.Situacao != "" && !slices.Contains([]string{"ativo", "em_manutencao", "alienado", "inativo"}, in.Situacao) {
		return recusa("situacao deve ser ativo, em_manutencao, alienado ou inativo")
	}
	if in.Estado != "" && !slices.Contains(estadosDoCarro, in.Estado) {
		return recusa("estado deve ser " + strings.Join(estadosDoCarro, ", "))
	}
	limite := 100
	if in.Limite != nil {
		if *in.Limite < 1 || *in.Limite > 200 || *in.Limite != math.Trunc(*in.Limite) {
			return recusa("limite deve ser um inteiro de 1 a 200")
		}
		limite = int(*in.Limite)
	}
	busca, placa := "", ""
	if in.Busca != nil {
		if busca, placa = normalizar(*in.Busca), soLetrasENumeros(*in.Busca); busca == "" {
			return recusa("busca deve ser parte do nome ou da placa")
		}
	}
	// ponytail: a frota inteira em uma leitura (14 carros em 10/2026) e o filtro aqui; vira filtro na rota se passar de 200
	var carros []map[string]any
	var usos []usoAberto
	var reservas []reservaAprovada
	var pessoas []pessoa
	for _, l := range []struct {
		metodo, caminho string
		q               url.Values
		dst             any
	}{
		{http.MethodGet, "/frota/veiculos", url.Values{"limite": {"200"}, "ordem": {"nome"}}, &carros},
		{http.MethodGet, "/frota/usos", url.Values{"aberta": {"true"}, "limite": {"200"}}, &usos},
		{http.MethodGet, "/frota/requisicoes", url.Values{"situacao": {"aprovada"}, "limite": {"200"}}, &reservas},
		{http.MethodPost, "/rpc/pessoas_para_escolher", nil, &pessoas},
	} {
		if err := lerJSON(c, l.metodo, l.caminho, l.q, l.dst); err != nil {
			return recusa(err.Error())
		}
	}
	agora := time.Now()
	saida := []map[string]any{}
	for _, v := range carros {
		nome, _ := v["nome"].(string)
		pl, _ := v["placa"].(string)
		situacao, _ := v["situacao"].(string)
		if in.Situacao != "" && situacao != in.Situacao {
			continue
		}
		if in.Busca != nil && !strings.Contains(normalizar(nome), busca) && (placa == "" || !strings.Contains(soLetrasENumeros(pl), placa)) {
			continue
		}
		id, _ := v["id"].(string)
		pid, _ := v["pessoa_id"].(string)
		for k, x := range estadoDoCarro(id, situacao, pid, usos, reservas, pessoas, agora) {
			v[k] = x
		}
		if in.Estado != "" && v["estado"] != in.Estado {
			continue
		}
		if saida = append(saida, v); len(saida) == limite {
			break
		}
	}
	b, _ := json.Marshal(saida)
	return resultado(http.StatusOK, b)
}

// motoristaDoPedido: a tela não grava pedido sem motorista (motoristaParaGravar em src/ferramentas/frota/
// nomes-de-fora.js). Colaborador vira pessoa_id + nome do cadastro (é por ele que a tela mostra de quem é a reserva
// e que o aviso da aprovação chega no celular de quem vai dirigir); gente de fora vira só o nome.
func motoristaDoPedido(c chamada, nome string, deFora bool) (map[string]any, string) {
	quem := strings.TrimSpace(nome)
	if quem == "" {
		return nil, "Falta para quem é o carro (pessoa_nome). Pergunte à pessoa quem vai usar; não presuma que é quem está falando."
	}
	if deFora {
		if len([]rune(quem)) < 3 {
			return nil, "O nome de quem é de fora está curto demais: escreva nome e sobrenome."
		}
		return map[string]any{"pessoa_id": nil, "pessoa_nome": quem}, ""
	}
	var pessoas []pessoa
	if err := lerJSON(c, http.MethodPost, "/rpc/pessoas_para_escolher", nil, &pessoas); err != nil {
		return nil, err.Error()
	}
	n := normalizar(quem)
	var exatas, contem []pessoa
	for _, p := range pessoas {
		if texto(p.Status) == "desligado" {
			continue
		}
		switch pn := normalizar(p.Nome); {
		case pn == n:
			exatas = append(exatas, p)
		case strings.Contains(pn, n):
			contem = append(contem, p)
		}
	}
	achadas := exatas
	if len(achadas) == 0 {
		achadas = contem
	}
	switch len(achadas) {
	case 0:
		return nil, fmt.Sprintf(`Não achei "%s" entre os colaboradores. Confirme o nome com a pessoa; se ela é de fora da empresa, mande de_fora=true com nome e sobrenome.`, quem)
	case 1:
		return map[string]any{"pessoa_id": achadas[0].ID, "pessoa_nome": achadas[0].Nome}, ""
	}
	nomes := []string{}
	for _, p := range achadas[:min(10, len(achadas))] {
		nomes = append(nomes, p.Nome)
	}
	return nil, fmt.Sprintf(`Mais de um colaborador casa com "%s": %s. Pergunte qual é e mande o nome completo.`, quem, strings.Join(nomes, "; "))
}

func pedirCarro(c chamada, args json.RawMessage) (string, bool) {
	var in map[string]json.RawMessage
	if err := json.Unmarshal(args, &in); err != nil {
		return recusa("argumentos inválidos")
	}
	permitidos := []string{"veiculo_id", "retirada_prevista", "devolucao_prevista", "pessoa_nome", "de_fora", "departamento", "destino", "finalidade", "observacao"}
	for k := range in {
		if !slices.Contains(permitidos, k) {
			return recusa("argumento desconhecido: " + k + ". Pode: " + strings.Join(permitidos, ", "))
		}
	}
	for _, k := range []string{"veiculo_id", "retirada_prevista"} {
		if _, ok := in[k]; !ok {
			return recusa("falta " + k)
		}
	}
	var nome string
	var deFora bool
	json.Unmarshal(in["pessoa_nome"], &nome)
	json.Unmarshal(in["de_fora"], &deFora)
	quem, erro := motoristaDoPedido(c, nome, deFora)
	if erro != "" {
		return recusa(erro)
	}
	corpo := map[string]any{}
	for k, v := range in {
		if k != "pessoa_nome" && k != "de_fora" {
			corpo[k] = v
		}
	}
	for k, v := range quem {
		corpo[k] = v
	}
	return resultado(c.pedir(http.MethodPost, "/frota/requisicoes", nil, corpo))
}

var acoesDeResponsavel = []string{"passar", "devolver", "recolher", "trocar_dono_fixo", "tirar_dono_fixo"}

type carroDaTroca struct {
	ID       string  `json:"id"`
	Nome     string  `json:"nome"`
	Situacao string  `json:"situacao"`
	PessoaID *string `json:"pessoa_id"`
}

// trocarResponsavel: o "passar o carro" (confirmarPasse em tela-de-frota.vue, com passarPara de
// supabase/functions/_shared/posse.js) e a troca do dono fixo (salvarVeiculo, com trocarDonoFixo), pela mesma rota
// da tela: POST /frota/usos/trocar fecha a posse aberta e abre a nova numa transação só. Tirar o dono fixo é só
// zerar pessoa_id: o gatilho trg_frota_fechar_posse_orfa (migration 029) fecha a posse junto.
func trocarResponsavel(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		VeiculoID  string `json:"veiculo_id"`
		Acao       string `json:"acao"`
		PessoaNome string `json:"pessoa_nome"`
		DeFora     bool   `json:"de_fora"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	if !reUUID.MatchString(in.VeiculoID) {
		return recusa("veiculo_id deve ser o uuid do carro (use listar_veiculos)")
	}
	if !slices.Contains(acoesDeResponsavel, in.Acao) {
		return recusa("acao deve ser " + strings.Join(acoesDeResponsavel, ", "))
	}
	if in.DeFora && in.Acao != "passar" {
		return recusa("de_fora só vale para acao=passar: o dono fixo é sempre um colaborador do cadastro.")
	}
	var carros []carroDaTroca
	var posses []struct {
		ID string `json:"id"`
		usoAberto
	}
	var pessoas []pessoa
	aberta := url.Values{"veiculo_id": {in.VeiculoID}, "aberta": {"true"}, "tipo": {"posse"}}
	for _, l := range []struct {
		metodo, caminho string
		q               url.Values
		dst             any
	}{
		{http.MethodGet, "/frota/veiculos", url.Values{"limite": {"200"}}, &carros},
		{http.MethodGet, "/frota/usos", aberta, &posses},
		{http.MethodPost, "/rpc/pessoas_para_escolher", nil, &pessoas},
	} {
		if err := lerJSON(c, l.metodo, l.caminho, l.q, l.dst); err != nil {
			return recusa("Não mudei nada: " + err.Error())
		}
	}
	i := slices.IndexFunc(carros, func(v carroDaTroca) bool { return v.ID == in.VeiculoID })
	if i < 0 {
		return recusa("Carro não encontrado (use listar_veiculos).")
	}
	carro, dono := carros[i], texto(carros[i].PessoaID)
	nomeDe := func(id string) string {
		if j := slices.IndexFunc(pessoas, func(p pessoa) bool { return p.ID == id }); j >= 0 {
			return pessoas[j].Nome
		}
		return "o dono fixo"
	}
	// a posse aberta (o banco não deixa duas): com quem o carro está hoje
	posseID, comQuem, comQuemNome := "", "", ""
	if len(posses) > 0 {
		posseID, comQuem, comQuemNome = posses[0].ID, texto(posses[0].PessoaID), texto(posses[0].PessoaNome)
	}
	agora := time.Now().Format(time.RFC3339)
	pedido := map[string]any{"veiculo_id": in.VeiculoID}
	fechar := func() {
		if posseID != "" {
			pedido["fechar"] = map[string]any{"id": posseID, "volta_em": agora}
		}
	}
	abrir := func(id any, nome string) {
		pedido["abrir"] = map[string]any{"pessoa_id": id, "pessoa_nome": nome, "saida_em": agora}
	}
	var frase string

	switch in.Acao {
	case "passar":
		quem, erro := motoristaDoPedido(c, in.PessoaNome, in.DeFora)
		if erro != "" {
			return recusa(erro)
		}
		nome := quem["pessoa_nome"].(string)
		if id, _ := quem["pessoa_id"].(string); id != "" && id == comQuem {
			return recusa(fmt.Sprintf("O %s já está com %s.", carro.Nome, nome))
		}
		fechar()
		abrir(quem["pessoa_id"], nome)
		frase = fmt.Sprintf("Feito: o %s agora está com %s.", carro.Nome, nome)
	case "devolver":
		switch {
		case dono == "" && posseID == "":
			return recusa(fmt.Sprintf("O %s não está com ninguém: não há o que devolver.", carro.Nome))
		case dono == "":
			// rodízio: sem dono fixo, devolver só fecha ("livre" é o certo)
			fechar()
			frase = fmt.Sprintf("Feito: o %s voltou e está livre (não tem dono fixo).", carro.Nome)
		case comQuem == dono:
			return recusa(fmt.Sprintf("O %s já está com o dono fixo, %s.", carro.Nome, nomeDe(dono)))
		default:
			fechar()
			abrir(dono, nomeDe(dono))
			frase = fmt.Sprintf("Feito: o %s voltou para o dono fixo, %s.", carro.Nome, nomeDe(dono))
		}
	case "recolher":
		fechar()
		if carro.Situacao != "inativo" {
			pedido["para_estoque"] = true
		}
		if len(pedido) == 1 {
			return recusa(fmt.Sprintf("O %s já está no estoque, sem ninguém com ele.", carro.Nome))
		}
		frase = fmt.Sprintf("Feito: o %s foi recolhido para o estoque (situação inativo, sem ninguém com ele).", carro.Nome)
	case "tirar_dono_fixo":
		if dono == "" {
			return recusa(fmt.Sprintf("O %s não tem dono fixo.", carro.Nome))
		}
		if txt, falhou := resultado(c.pedir(http.MethodPatch, "/frota/veiculos/"+in.VeiculoID, nil, map[string]any{"pessoa_id": nil})); falhou {
			return txt, true
		}
		return fmt.Sprintf("Feito: o %s não tem mais dono fixo (era %s); a posse aberta foi fechada junto.", carro.Nome, nomeDe(dono)), false
	case "trocar_dono_fixo":
		quem, erro := motoristaDoPedido(c, in.PessoaNome, false)
		if erro != "" {
			return recusa(erro)
		}
		id, nome := quem["pessoa_id"].(string), quem["pessoa_nome"].(string)
		if id == dono {
			return recusa(fmt.Sprintf("%s já é o dono fixo do %s.", nome, carro.Nome))
		}
		if txt, falhou := resultado(c.pedir(http.MethodPatch, "/frota/veiculos/"+in.VeiculoID, nil, map[string]any{"pessoa_id": id})); falhou {
			return txt, true
		}
		// emprestado a um terceiro: a posse não muda (diria que o dono novo esteve com o carro num dia em que nunca
		// o viu); quando voltar, devolver entrega ao dono novo. Diferente de trocarDonoFixo em posse.js, gente de fora
		// (posse sem pessoa_id) também conta como terceiro: lá ela perde a posse para o dono novo.
		if posseID != "" && dono != "" && comQuem != dono {
			return fmt.Sprintf("Feito: %s é o novo dono fixo do %s. O carro continua com %s, que estava com ele "+
				"emprestado; quando voltar, use acao=devolver.", nome, carro.Nome, comQuemNome), false
		}
		fechar()
		abrir(id, nome)
		if txt, falhou := resultado(c.pedir(http.MethodPost, "/frota/usos/trocar", nil, pedido)); falhou {
			return fmt.Sprintf("O dono fixo foi gravado (%s), mas não consegui registrar que o carro está com ele: %s "+
				"Tente acao=passar para %s; se falhar de novo, avise quem administra a Frota.", nome, txt, nome), true
		}
		return fmt.Sprintf("Feito: %s é o novo dono fixo do %s e está com ele.", nome, carro.Nome), false
	}
	if txt, falhou := resultado(c.pedir(http.MethodPost, "/frota/usos/trocar", nil, pedido)); falhou {
		return txt, true
	}
	return frase, false
}
