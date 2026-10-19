package mcp

import (
	"bytes"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
)

const instrucoes = `Ferramentas da Frota da RBV (carros da empresa). Valores em reais; datas em ISO 8601 com fuso ` +
	`(ex.: 2026-10-20T14:00:00-03:00). Para agir sobre um carro, ache o id dele com listar_veiculos (pelo nome ou ` +
	`placa). Antes de gravar, confirme com a pessoa os números que ela disse. Erro de regra volta com a frase do ` +
	`sistema: repasse-a, não tente contornar.`

// ferramenta: rodar devolve o texto para o modelo e se é erro (isError do MCP).
type ferramenta struct {
	nome, titulo, descricao string
	leitura                 bool
	esquema                 string
	rodar                   func(c chamada, args json.RawMessage) (string, bool)
}

var reUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// resultado: 2xx devolve o corpo como veio; o resto, a frase da rota ({"error","mensagem"}).
func resultado(status int, corpo []byte) (string, bool) {
	if status >= 200 && status < 300 {
		if len(corpo) == 0 {
			return `{"ok":true}`, false
		}
		return string(corpo), false
	}
	var e struct {
		Codigo   string `json:"error"`
		Mensagem string `json:"mensagem"`
	}
	json.Unmarshal(corpo, &e)
	if e.Mensagem == "" {
		e.Mensagem = e.Codigo
	}
	return fmt.Sprintf("Não deu certo (HTTP %d): %s", status, e.Mensagem), true
}

func recusa(frase string) (string, bool) { return frase, true }

// decodificar lê os argumentos no struct, recusando campo desconhecido (o modelo não inventa coluna).
func decodificar(args json.RawMessage, dst any) error {
	d := json.NewDecoder(bytes.NewReader(args))
	d.DisallowUnknownFields()
	if err := d.Decode(dst); err != nil {
		return fmt.Errorf("argumentos inválidos: %v", err)
	}
	return nil
}

func centavos(reais float64) int64 { return int64(math.Round(reais * 100)) }

// ---- leitura ----

// listar: GET numa rota de consulta, com os filtros declarados dela, limite (padrão 50, máx. 200) e uma ordem fixa.
func listar(caminho, ordem string, filtros ...string) func(chamada, json.RawMessage) (string, bool) {
	return func(c chamada, args json.RawMessage) (string, bool) {
		var in map[string]any
		if err := json.Unmarshal(args, &in); err != nil {
			return recusa("argumentos inválidos")
		}
		q := url.Values{"limite": {"50"}}
		if ordem != "" {
			q.Set("ordem", ordem)
		}
		for k, v := range in {
			switch {
			case k == "limite":
				n, ok := v.(float64)
				if !ok || n < 1 || n > 200 || n != math.Trunc(n) {
					return recusa("limite deve ser um inteiro de 1 a 200")
				}
				q.Set("limite", strconv.Itoa(int(n)))
			case slices.Contains(filtros, k):
				q.Set(k, fmt.Sprint(v))
			default:
				return recusa("argumento desconhecido: " + k)
			}
		}
		return resultado(c.pedir(http.MethodGet, caminho, q, nil))
	}
}

// ---- escrita direta (PATCH/POST com os campos da rota) ----

// gravar repassa os campos permitidos. Com comID, "id" é obrigatório e vai na URL (caminho + "/" + id).
func gravar(metodo, caminho string, comID bool, obrigatorios, permitidos []string) func(chamada, json.RawMessage) (string, bool) {
	return func(c chamada, args json.RawMessage) (string, bool) {
		var in map[string]json.RawMessage
		if err := json.Unmarshal(args, &in); err != nil {
			return recusa("argumentos inválidos")
		}
		destino := caminho // a closure é reusada: nunca alterar `caminho`
		if comID {
			var id string
			if json.Unmarshal(in["id"], &id) != nil || !reUUID.MatchString(id) {
				return recusa("id deve ser o uuid do registro")
			}
			destino += "/" + id
			delete(in, "id")
		}
		for k := range in {
			if !slices.Contains(permitidos, k) {
				return recusa("campo que esta ferramenta não grava: " + k + ". Pode: " + strings.Join(permitidos, ", "))
			}
		}
		for _, k := range obrigatorios {
			if _, ok := in[k]; !ok {
				return recusa("falta " + k)
			}
		}
		if len(in) == 0 {
			return recusa("nada para gravar")
		}
		return resultado(c.pedir(metodo, destino, nil, in))
	}
}

// ---- abastecimento: as travas que só a tela tinha (src/ferramentas/frota/abastecimentos.js) ----

type argsAbastecimento struct {
	VeiculoID    string  `json:"veiculo_id"`
	Km           int64   `json:"km"`
	Litros       float64 `json:"litros"`
	TotalReais   float64 `json:"total_reais"`
	TanqueDepois *int    `json:"tanque_depois"`
	Combustivel  string  `json:"combustivel"`
	AbastecidoEm string  `json:"abastecido_em,omitempty"`
	Posto        *string `json:"posto,omitempty"`
	Observacao   *string `json:"observacao,omitempty"`
	PessoaNome   *string `json:"pessoa_nome,omitempty"`
}

// kmConhecido: o MAIOR km já registrado do carro (estado-do-veiculo.js: devolução, saída em aberto, hodômetro do
// checklist, manutenção e abastecimento). Pelo maior e não pelo mais novo: data errada acontece, o odômetro só
// anda para frente. Nulo = nenhuma fonte; erro = alguma leitura falhou (aí não se grava às cegas).
func kmConhecido(c chamada, veiculo string) (*int64, error) {
	var maior *int64
	ver := func(v *int64) {
		if v != nil && (maior == nil || *v > *maior) {
			maior = v
		}
	}
	q := url.Values{"veiculo_id": {veiculo}}
	for _, fonte := range []struct{ caminho, coluna string }{
		{"/frota/usos", "km_volta"}, {"/frota/usos", "km_saida"}, {"/frota/checklists", "hodometro"},
		{"/frota/revisoes", "km"}, {"/frota/abastecimentos", "km"},
	} {
		st, corpo := c.pedir(http.MethodGet, fonte.caminho, q, nil)
		if st != http.StatusOK {
			return nil, fmt.Errorf("não consegui ler %s (HTTP %d)", fonte.caminho, st)
		}
		var linhas []map[string]json.RawMessage
		if err := json.Unmarshal(corpo, &linhas); err != nil {
			return nil, err
		}
		for _, l := range linhas {
			var v *int64
			if json.Unmarshal(l[fonte.coluna], &v) == nil {
				ver(v)
			}
		}
	}
	return maior, nil
}

func registrarAbastecimento(c chamada, args json.RawMessage) (string, bool) {
	var in argsAbastecimento
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	var barra []string
	if !reUUID.MatchString(in.VeiculoID) {
		barra = append(barra, "veiculo_id deve ser o uuid do carro (use listar_veiculos).")
	}
	if in.Km <= 0 {
		barra = append(barra, "Informe o KM que está no painel.")
	}
	if in.Litros <= 0 {
		barra = append(barra, "Informe quantos litros foram colocados.")
	}
	if in.TotalReais <= 0 {
		barra = append(barra, "Informe quanto foi pago.")
	}
	if in.TanqueDepois == nil || *in.TanqueDepois < 0 || *in.TanqueDepois > 4 {
		barra = append(barra, "Diga como ficou o tanque depois (0 a 4 quartos; 4 = cheio).")
	}
	if strings.TrimSpace(in.Combustivel) == "" {
		barra = append(barra, "Informe o combustível.")
	}
	quando := time.Now()
	if in.AbastecidoEm != "" {
		t, err := time.Parse(time.RFC3339, in.AbastecidoEm)
		switch {
		case err != nil:
			barra = append(barra, "abastecido_em deve ser data e hora ISO 8601 com fuso (ex.: 2026-10-20T14:00:00-03:00).")
		case t.After(time.Now().Add(5 * time.Minute)):
			barra = append(barra, "A data do abastecimento está no futuro.")
		default:
			quando = t
		}
	}
	if len(barra) > 0 {
		return recusa(strings.Join(barra, " "))
	}
	km, err := kmConhecido(c, in.VeiculoID)
	if err != nil {
		return recusa("Não gravei: " + err.Error())
	}
	if km != nil && in.Km < *km {
		return recusa(fmt.Sprintf("O KM informado (%d) é menor que o último conhecido deste carro (%d). Confira o painel.", in.Km, *km))
	}
	corpo := map[string]any{"veiculo_id": in.VeiculoID, "km": in.Km, "litros": in.Litros,
		"total_centavos": centavos(in.TotalReais), "tanque_depois": *in.TanqueDepois,
		"combustivel": strings.TrimSpace(in.Combustivel), "abastecido_em": quando.Format(time.RFC3339)}
	for k, v := range map[string]*string{"posto": in.Posto, "observacao": in.Observacao, "pessoa_nome": in.PessoaNome} {
		if v != nil {
			corpo[k] = *v
		}
	}
	texto, falhou := resultado(c.pedir(http.MethodPost, "/frota/abastecimentos", nil, corpo))
	// D39: número que não fecha AVISA, não barra
	if preco := in.TotalReais / in.Litros; !falhou && (preco < 1 || preco > 15) {
		texto += fmt.Sprintf("\n\nAviso: isso dá R$ %.2f o litro. Confira com a pessoa os dois números.", preco)
	}
	return texto, falhou
}

// ---- decisão de requisição ----

func decidirRequisicao(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		ID      string `json:"id"`
		Decisao string `json:"decisao"`
		Motivo  string `json:"motivo"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	if !reUUID.MatchString(in.ID) {
		return recusa("id deve ser o uuid da requisição (use listar_requisicoes)")
	}
	motivo := strings.TrimSpace(in.Motivo)
	var corpo map[string]any
	switch in.Decisao {
	case "aprovada":
		corpo = map[string]any{"situacao": "aprovada", "motivo_decisao": nil}
		if motivo != "" {
			corpo["motivo_decisao"] = motivo
		}
	case "recusada":
		if motivo == "" {
			return recusa("Diga o motivo da recusa. Quem pediu precisa saber o que fazer diferente.")
		}
		corpo = map[string]any{"situacao": "recusada", "motivo_decisao": motivo}
	case "cancelada", "revogada":
		if motivo == "" {
			return recusa("Diga o motivo. Quem pediu ou está com a reserva precisa saber.")
		}
		corpo = map[string]any{"situacao": in.Decisao, "encerrada_motivo": motivo}
	default:
		return recusa("decisao deve ser aprovada, recusada, cancelada ou revogada")
	}
	texto, falhou := resultado(c.pedir(http.MethodPatch, "/frota/requisicoes/"+in.ID, nil, corpo))
	if falhou || (in.Decisao != "aprovada" && in.Decisao != "recusada") {
		return texto, falhou
	}
	// o mesmo aviso que a tela manda depois de decidir; falhar aqui não desfaz a decisão
	st, aviso := c.pedir(http.MethodPost, "/avisar-decisao-de-reserva", nil, map[string]string{"requisicaoId": in.ID})
	if st/100 != 2 {
		return texto + "\n\nA decisão foi gravada, mas o aviso no celular de quem pediu não saiu.", false
	}
	return texto + "\n\nAviso a quem pediu: " + string(aviso), false
}

// ---- manutenção ----

func lancarManutencao(c chamada, args json.RawMessage) (string, bool) {
	var in struct {
		VeiculoID  string   `json:"veiculo_id"`
		Km         int64    `json:"km"`
		FeitaEm    *string  `json:"feita_em,omitempty"`
		Oficina    *string  `json:"oficina,omitempty"`
		TotalReais *float64 `json:"total_reais,omitempty"`
		Observacao *string  `json:"observacao,omitempty"`
		Trocas     []struct {
			Item       string   `json:"item"`
			CustoReais *float64 `json:"custo_reais,omitempty"`
		} `json:"trocas"`
	}
	if err := decodificar(args, &in); err != nil {
		return recusa(err.Error())
	}
	if !reUUID.MatchString(in.VeiculoID) {
		return recusa("veiculo_id deve ser o uuid do carro (use listar_veiculos)")
	}
	cab := map[string]any{"veiculo_id": in.VeiculoID, "km": in.Km}
	for k, v := range map[string]*string{"feita_em": in.FeitaEm, "oficina": in.Oficina, "observacao": in.Observacao} {
		if v != nil {
			cab[k] = *v
		}
	}
	if in.TotalReais != nil {
		cab["total_centavos"] = centavos(*in.TotalReais)
	}
	trocas := make([]map[string]any, len(in.Trocas))
	for i, t := range in.Trocas {
		trocas[i] = map[string]any{"item": t.Item}
		if t.CustoReais != nil {
			trocas[i]["custo_centavos"] = centavos(*t.CustoReais)
		}
	}
	return resultado(c.pedir(http.MethodPost, "/frota/manutencoes", nil, map[string]any{"manutencao": cab, "trocas": trocas}))
}

// ---- o catálogo ----

const (
	pLimite  = `"limite":{"type":"integer","minimum":1,"maximum":200,"description":"Quantas linhas (padrão 50)."}`
	pVeiculo = `"veiculo_id":{"type":"string","format":"uuid","description":"id do carro (de listar_veiculos)."}`
)

var camposDoVeiculo = []string{"nome", "marca", "ano", "cor", "combustivel", "tipo_oleo", "contrato", "categoria_comercial",
	"situacao", "local_texto", "observacao", "seguro_seguradora", "seguro_apolice", "seguro_vence_em", "tag_pedagio",
	"rastreador", "contato_nome", "contato_telefone", "contato_papel", "oficina_nome", "oficina_telefone"}

var ferramentas = []ferramenta{
	{nome: "listar_veiculos", titulo: "Listar veículos", leitura: true,
		descricao: "Lista os carros da frota com placa, nome, situação (ativo, em_manutencao, alienado, inativo), local, " +
			"seguro e contatos. Use para achar o id de um carro pelo nome ou placa.",
		esquema: `{"type":"object","properties":{},"additionalProperties":false}`,
		rodar:   listar("/frota/veiculos", "nome")},
	{nome: "listar_usos", titulo: "Listar retiradas e posses", leitura: true,
		descricao: "Retiradas e posses dos carros (quem pegou, saída/volta, km). aberta=true mostra só os carros que estão fora agora.",
		esquema: `{"type":"object","properties":{` + pVeiculo + `,"aberta":{"type":"boolean"},` +
			`"saida_de":{"type":"string","format":"date"},"saida_ate":{"type":"string","format":"date"},` + pLimite + `},"additionalProperties":false}`,
		rodar: listar("/frota/usos", "saida_em.desc", "veiculo_id", "aberta", "saida_de", "saida_ate")},
	{nome: "listar_requisicoes", titulo: "Listar pedidos de carro", leitura: true,
		descricao: "Pedidos (reservas) de carro, das retiradas previstas mais novas para as mais antigas.",
		esquema: `{"type":"object","properties":{` + pVeiculo + `,"situacao":{"type":"string",` +
			`"enum":["pendente","aprovada","recusada","cancelada","revogada","usada"]},` + pLimite + `},"additionalProperties":false}`,
		rodar: listar("/frota/requisicoes", "retirada_prevista.desc", "veiculo_id", "situacao")},
	{nome: "listar_abastecimentos", titulo: "Listar abastecimentos", leitura: true,
		descricao: "Abastecimentos, do mais recente ao mais antigo. Valores em centavos (total_centavos).",
		esquema:   `{"type":"object","properties":{` + pVeiculo + `,` + pLimite + `},"additionalProperties":false}`,
		rodar:     listar("/frota/abastecimentos", "", "veiculo_id")},
	{nome: "listar_revisoes", titulo: "Listar revisões feitas", leitura: true,
		descricao: "Itens trocados nas manutenções (revisões feitas), do mais recente ao mais antigo. Custo em centavos.",
		esquema:   `{"type":"object","properties":{` + pVeiculo + `,` + pLimite + `},"additionalProperties":false}`,
		rodar:     listar("/frota/revisoes", "criada_em.desc", "veiculo_id")},
	{nome: "ver_plano_de_revisao", titulo: "Ver plano de revisão", leitura: true,
		descricao: "O plano de revisão da frota: cada item e de quantos em quantos km ele se troca.",
		esquema:   `{"type":"object","properties":{` + pLimite + `},"additionalProperties":false}`,
		rodar:     listar("/frota/plano-revisao", "")},

	{nome: "editar_veiculo", titulo: "Editar dados do veículo",
		descricao: "Altera dados de um carro. Não muda placa, Renavam, chassi, patrimônio, responsável nem valores. " +
			"situacao: ativo, em_manutencao, alienado ou inativo.",
		esquema: `{"type":"object","required":["id"],"properties":{"id":{"type":"string","format":"uuid"},` +
			`"nome":{"type":"string"},"marca":{"type":"string"},"ano":{"type":"integer"},"cor":{"type":"string"},` +
			`"combustivel":{"type":"string"},"tipo_oleo":{"type":"string"},"contrato":{"type":"string"},` +
			`"categoria_comercial":{"type":"string"},"situacao":{"type":"string","enum":["ativo","em_manutencao","alienado","inativo"]},` +
			`"local_texto":{"type":"string","description":"Onde o carro fica."},"observacao":{"type":"string"},` +
			`"seguro_seguradora":{"type":"string"},"seguro_apolice":{"type":"string"},"seguro_vence_em":{"type":"string","format":"date"},` +
			`"tag_pedagio":{"type":"string"},"rastreador":{"type":"string"},"contato_nome":{"type":"string"},` +
			`"contato_telefone":{"type":"string"},"contato_papel":{"type":"string"},"oficina_nome":{"type":"string"},` +
			`"oficina_telefone":{"type":"string"}},"additionalProperties":false}`,
		rodar: gravar(http.MethodPatch, "/frota/veiculos", true, nil, camposDoVeiculo)},
	{nome: "registrar_abastecimento", titulo: "Registrar abastecimento",
		descricao: "Registra um abastecimento. Recusa KM menor que o último conhecido do carro e data no futuro; avisa " +
			"quando o preço por litro foge de R$ 1 a R$ 15.",
		esquema: `{"type":"object","required":["veiculo_id","km","litros","total_reais","tanque_depois","combustivel"],"properties":{` +
			pVeiculo + `,"km":{"type":"integer","minimum":1,"description":"KM do painel."},"litros":{"type":"number","exclusiveMinimum":0},` +
			`"total_reais":{"type":"number","exclusiveMinimum":0,"description":"Valor pago, em reais."},` +
			`"tanque_depois":{"type":"integer","minimum":0,"maximum":4,"description":"Quartos de tanque depois (4 = cheio)."},` +
			`"combustivel":{"type":"string","description":"Ex.: gasolina, etanol, diesel."},` +
			`"abastecido_em":{"type":"string","format":"date-time","description":"Padrão: agora."},` +
			`"posto":{"type":"string"},"observacao":{"type":"string"},"pessoa_nome":{"type":"string","description":"Quem abasteceu."}},` +
			`"additionalProperties":false}`,
		rodar: registrarAbastecimento},
	{nome: "pedir_carro", titulo: "Pedir carro (criar requisição)",
		descricao: "Cria um pedido de carro, que nasce pendente de aprovação.",
		esquema: `{"type":"object","required":["veiculo_id","retirada_prevista"],"properties":{` + pVeiculo + `,` +
			`"retirada_prevista":{"type":"string","format":"date-time"},"devolucao_prevista":{"type":"string","format":"date-time"},` +
			`"pessoa_nome":{"type":"string","description":"Quem vai usar."},"departamento":{"type":"string"},` +
			`"destino":{"type":"string"},"finalidade":{"type":"string"},"observacao":{"type":"string"}},"additionalProperties":false}`,
		rodar: gravar(http.MethodPost, "/frota/requisicoes", false, []string{"veiculo_id", "retirada_prevista"},
			[]string{"veiculo_id", "retirada_prevista", "devolucao_prevista", "pessoa_nome", "departamento", "destino", "finalidade", "observacao"})},
	{nome: "decidir_requisicao", titulo: "Decidir pedido de carro",
		descricao: "Aprova, recusa, cancela ou revoga um pedido de carro. Recusar, cancelar e revogar exigem motivo. " +
			"Aprovar e recusar avisam no celular de quem pediu.",
		esquema: `{"type":"object","required":["id","decisao"],"properties":{"id":{"type":"string","format":"uuid"},` +
			`"decisao":{"type":"string","enum":["aprovada","recusada","cancelada","revogada"]},"motivo":{"type":"string"}},` +
			`"additionalProperties":false}`,
		rodar: decidirRequisicao},
	{nome: "lancar_manutencao", titulo: "Lançar manutenção",
		descricao: "Lança um serviço de manutenção e os itens trocados nele (de 1 a 30). Cada troca entra nas revisões feitas.",
		esquema: `{"type":"object","required":["veiculo_id","km","trocas"],"properties":{` + pVeiculo + `,` +
			`"km":{"type":"integer","minimum":1},"feita_em":{"type":"string","format":"date"},"oficina":{"type":"string"},` +
			`"total_reais":{"type":"number","minimum":0},"observacao":{"type":"string"},` +
			`"trocas":{"type":"array","minItems":1,"maxItems":30,"items":{"type":"object","required":["item"],"properties":{` +
			`"item":{"type":"string","description":"Use o nome do item do plano de revisão quando houver."},` +
			`"custo_reais":{"type":"number","minimum":0}},"additionalProperties":false}}},"additionalProperties":false}`,
		rodar: lancarManutencao},
	{nome: "criar_item_do_plano", titulo: "Criar item do plano de revisão",
		descricao: "Acrescenta um item ao plano de revisão (de quantos em quantos km ele se troca).",
		esquema: `{"type":"object","required":["item","a_cada_km"],"properties":{"item":{"type":"string"},` +
			`"a_cada_km":{"type":"integer","minimum":1},"observacao":{"type":"string"},"ordem":{"type":"integer"},` +
			`"ativo":{"type":"boolean"}},"additionalProperties":false}`,
		rodar: gravar(http.MethodPost, "/frota/plano-revisao", false, []string{"item", "a_cada_km"},
			[]string{"item", "a_cada_km", "observacao", "ordem", "ativo"})},
	{nome: "editar_item_do_plano", titulo: "Editar item do plano de revisão",
		descricao: "Altera um item do plano de revisão. Para tirar um item do plano, use ativo=false.",
		esquema: `{"type":"object","required":["id"],"properties":{"id":{"type":"string","format":"uuid"},"item":{"type":"string"},` +
			`"a_cada_km":{"type":"integer","minimum":1},"observacao":{"type":"string"},"ordem":{"type":"integer"},` +
			`"ativo":{"type":"boolean"}},"additionalProperties":false}`,
		rodar: gravar(http.MethodPatch, "/frota/plano-revisao", true, nil, []string{"item", "a_cada_km", "observacao", "ordem", "ativo"})},
}
