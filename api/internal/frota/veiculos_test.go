package frota

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// Funções locais com prefixo: as outras Tasks da Frota escrevem testes no mesmo pacote.
func contarVeic(tabela string) string { return "select count(*)::text from " + tabela }

func colVeic(tabela, coluna, id string) string {
	return "select " + coluna + "::text from " + tabela + " where id = '" + id + "'"
}

func idsVeic(t *testing.T, corpo string) []string {
	t.Helper()
	var l []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, len(l))
	for i, x := range l {
		out[i] = x.ID
	}
	return out
}

// A regra de produção (frota_veiculos_ler = is_frota_admin()): quem tem a Frota lê, quem não tem recebe
// lista vazia (nunca 403 nem a linha alheia).
func TestVeiculosLeitura(t *testing.T) {
	m := novoMundo(t, montarVeiculos)
	for _, quem := range []string{"motorista", "motorista2", "aprovador", "superFicha", "impersonado"} {
		st, corpo := m.Pedir(t, quem, "GET", "/frota/veiculos", "")
		if got := idsVeic(t, corpo); st != 200 || !slices.Equal(got, []string{V1, V2}) { // Gol antes de Uno
			t.Errorf("%s vê %v (%d), esperava [V1 V2] na ordem do nome", quem, got, st)
		}
	}
	for _, quem := range semFrota {
		if st, corpo := m.Pedir(t, quem, "GET", "/frota/veiculos", ""); st != 200 || corpo != "[]" {
			t.Errorf("VAZAMENTO: %s (sem a Frota) lê %d %s", quem, st, corpo)
		}
		if st, corpo := m.Pedir(t, quem, "GET", "/frota/veiculos?pessoa_id="+pMotorista, ""); st != 200 || corpo != "[]" {
			t.Errorf("VAZAMENTO por filtro: %s lê %d %s", quem, st, corpo)
		}
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/frota/veiculos", Status: 401},
		{Nome: "conta desativada", Quem: "desativado", Metodo: "GET", Caminho: "/frota/veiculos", Status: 401},
		{Nome: "colunas do contrato", Quem: "motorista", Metodo: "GET", Caminho: "/frota/veiculos", Status: 200,
			Tem: `"placa":"AAA1A11"`},
		{Nome: "filtro por dono: só o V1", Quem: "motorista", Metodo: "GET", Caminho: "/frota/veiculos?pessoa_id=" + pMotorista,
			Status: 200, Tem: `"placa":"AAA1A11"`, NaoTem: "BBB2B22"},
		{Nome: "pessoa_id malformado", Quem: "motorista", Metodo: "GET", Caminho: "/frota/veiculos?pessoa_id=x", Status: 400},
		{Nome: "ordem fora da lista", Quem: "motorista", Metodo: "GET", Caminho: "/frota/veiculos?ordem=aluguel_centavos", Status: 400},
		{Nome: "filtro que não existe não vira filtro silencioso", Quem: "motorista", Metodo: "GET", Caminho: "/frota/veiculos?situacao=ativo", Status: 400},
	})
	if w := m.Resposta(t, "motorista", "GET", "/frota/veiculos?pessoa_id="+pMotorista+"&contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "1" {
		t.Errorf("X-Total-Count = %q (o contador da ficha de Acessos)", w.Header().Get("X-Total-Count"))
	}
}

// Quem lê é quem grava (frota_veiculos_escrever); os gatilhos verbatim rodam em ComUsuario e a resposta é
// a linha DEPOIS deles.
func TestVeiculosCriar(t *testing.T) {
	m := novoMundo(t, montarVeiculos)
	foto := m.Um(t, fotoDaFrota)
	const url = "/frota/veiculos"
	criar := func(nome, quem, corpo string, status int, total string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: url, Corpo: corpo, Status: status,
			Efeito: contarVeic("frota_veiculos"), Quer: total}
	}
	for _, quem := range semFrota {
		m.Rodar(t, []caso{{Nome: "sem a Frota não cria: " + quem, Quem: quem, Metodo: "POST", Caminho: url,
			Corpo: `{"placa":"ZZZ9Z99","nome":"Fantasma"}`, Status: 403, Efeito: fotoDaFrota, Quer: foto}})
	}
	m.Rodar(t, []caso{
		{Nome: "entrar como não cria", Quem: "impersonado", Metodo: "POST", Caminho: url, Corpo: `{"placa":"ZZZ9Z99","nome":"Fantasma"}`,
			Status: 403, Tem: "Quem entrou como outra pessoa", Efeito: fotoDaFrota, Quer: foto},
		{Nome: "sem sessão", Metodo: "POST", Caminho: url, Corpo: `{"placa":"ZZZ9Z99","nome":"Fantasma"}`, Status: 401, Efeito: fotoDaFrota, Quer: foto},
		criar("a forma da Frota", "motorista", `{"placa":"CCC3C33","nome":"Kwid","situacao":"ativo","aluguel_centavos":150000}`, 201, "3"),
		{Nome: "a resposta traz o que gravou", Quem: "aprovador", Metodo: "POST", Caminho: url,
			Corpo: `{"placa":"EEE5E55","nome":"Strada","seguro_vence_em":"2027-01-31","fipe_centavos":9000000}`, Status: 201,
			Tem: `"seguro_vence_em":"2027-01-31"`, Efeito: contarVeic("frota_veiculos"), Quer: "4"},
		{Nome: "a forma do Patrimônio liga o bem e o gatilho do INSERT põe o bem em uso", Quem: "motorista", Metodo: "POST", Caminho: url,
			Corpo:  `{"nome":"Kwid 2","placa":"DDD4D44","marca":null,"bem_id":"` + bemCarro2 + `","situacao":"ativo"}`,
			Status: 201, Tem: bemCarro2, Efeito: colVeic("patrimonio_bens", "situacao", bemCarro2), Quer: "em_uso"},
		criar("placa repetida", "motorista", `{"placa":"AAA1A11","nome":"Clone"}`, 409, "5"),
		criar("bem já ligado a outro carro", "motorista", `{"placa":"FFF6F66","nome":"Clone","bem_id":"`+bemCarro+`"}`, 409, "5"),
		criar("blindado não é da tela", "motorista", `{"placa":"GGG7G77","nome":"X","blindado":true}`, 400, "5"),
		criar("criado_em não é da tela", "motorista", `{"placa":"GGG7G77","nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, 400, "5"),
		criar("id não é da tela", "motorista", `{"id":"f3d00000-0000-4000-a000-0000000000ff","placa":"GGG7G77","nome":"X"}`, 400, "5"),
		criar("situação fora da lista", "motorista", `{"placa":"GGG7G77","nome":"X","situacao":"voando"}`, 400, "5"),
		criar("ano que não é número", "motorista", `{"placa":"GGG7G77","nome":"X","ano":"dois mil"}`, 400, "5"),
		criar("sem placa", "motorista", `{"nome":"X"}`, 400, "5"),
		criar("sem nome", "motorista", `{"placa":"GGG7G77"}`, 400, "5"),
		criar("corpo que não é JSON", "motorista", `lixo`, 400, "5"),
	})
	// bem_id de um bem que não existe: a FK
	m.Rodar(t, []caso{{Nome: "bem que não existe", Quem: "motorista", Metodo: "POST", Caminho: url,
		Corpo: `{"placa":"HHH8H88","nome":"X","bem_id":"f3b00000-0000-4000-a000-0000000000ff"}`, Status: 409,
		Efeito: contarVeic("frota_veiculos"), Quer: "5"}})
}

func TestVeiculosEditar(t *testing.T) {
	m := novoMundo(t, montarVeiculos)
	u := func(id string) string { return "/frota/veiculos/" + id }
	foto := m.Um(t, fotoDaFrota)
	posseAberta := colVeic("frota_uso", "(volta_em is null)", U1)

	// quem não é da Frota recebe 404 igual ao do carro que não existe, e nada muda (IDOR)
	for _, quem := range semFrota {
		m.Rodar(t, []caso{{Nome: "IDOR: " + quem + " não mexe no V1", Quem: quem, Metodo: "PATCH", Caminho: u(V1), Corpo: `{"nome":"x"}`,
			Status: 404, Efeito: fotoDaFrota, Quer: foto}})
	}
	m.Rodar(t, []caso{
		{Nome: "id que não existe", Quem: "motorista", Metodo: "PATCH", Caminho: u("f3d00000-0000-4000-a000-0000000000ff"),
			Corpo: `{"nome":"x"}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "id malformado", Quem: "motorista", Metodo: "PATCH", Caminho: u("nao-e-uuid"), Corpo: `{"nome":"x"}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "entrar como não edita", Quem: "impersonado", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"nome":"x"}`,
			Status: 403, Tem: "Quem entrou como outra pessoa", Efeito: fotoDaFrota, Quer: foto},
		{Nome: "sem sessão", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"nome":"x"}`, Status: 401, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "sem rota de apagar", Quem: "motorista", Metodo: "DELETE", Caminho: u(V1), Status: 405, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "blindado não é da tela", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"blindado":true}`, Status: 400,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "id não se troca", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"id":"f3d00000-0000-4000-a000-0000000000ff"}`, Status: 400,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "situação fora da lista", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"situacao":"voando"}`, Status: 400,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "situação não se limpa", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"situacao":null}`, Status: 400,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "nome não se limpa", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"nome":null}`, Status: 400,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "placa de outro carro", Quem: "motorista", Metodo: "PATCH", Caminho: u(V2), Corpo: `{"placa":"AAA1A11"}`, Status: 409,
			Efeito: fotoDaFrota, Quer: foto},
		{Nome: "bem de outro carro", Quem: "motorista", Metodo: "PATCH", Caminho: u(V2), Corpo: `{"bem_id":"` + bemCarro + `"}`, Status: 409,
			Efeito: fotoDaFrota, Quer: foto},
	})

	m.Rodar(t, []caso{
		{Nome: "edita o que lê", Quem: "motorista", Metodo: "PATCH", Caminho: u(V2), Corpo: `{"situacao":"em_manutencao"}`, Status: 200,
			Tem: `"situacao":"em_manutencao"`, Efeito: colVeic("frota_veiculos", "situacao", V2), Quer: "em_manutencao"},
		{Nome: "outros campos ficam como estavam", Quem: "aprovador", Metodo: "PATCH", Caminho: u(V2), Corpo: `{"cor":"prata","observacao":"riscado"}`,
			Status: 200, Tem: `"cor":"prata"`, Efeito: colVeic("frota_veiculos", "nome || '|' || situacao", V2), Quer: "Uno|em_manutencao"},
		{Nome: "mudar só o nome NÃO fecha a posse (o WHEN do gatilho)", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"nome":"Gol 2"}`,
			Status: 200, Efeito: posseAberta, Quer: "true"},
		{Nome: "o mesmo dono de novo NÃO fecha a posse", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"pessoa_id":"` + pMotorista + `"}`,
			Status: 200, Efeito: posseAberta, Quer: "true"},
		{Nome: "a tela manda atualizado_em; inativo espelha no bem", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1),
			Corpo: `{"situacao":"inativo","atualizado_em":"2026-10-12T10:00:00Z"}`, Status: 200, Tem: `"situacao":"inativo"`,
			Efeito: colVeic("patrimonio_bens", "situacao", bemCarro), Quer: "em_estoque"},
		{Nome: "o atualizado_em da tela vale", Efeito: colVeic("frota_veiculos", "(atualizado_em = '2026-10-12T10:00:00Z')", V1), Quer: "true"},
		{Nome: "ativo de volta: o bem volta a em uso", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"situacao":"ativo"}`, Status: 200,
			Efeito: colVeic("patrimonio_bens", "situacao", bemCarro), Quer: "em_uso"},
		{Nome: "em manutenção também espelha", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"situacao":"em_manutencao"}`, Status: 200,
			Efeito: colVeic("patrimonio_bens", "situacao", bemCarro), Quer: "em_manutencao"},
		{Nome: "sem dono: a posse aberta é fechada pelo gatilho", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"pessoa_id":null}`,
			Status: 200, Tem: `"pessoa_id":null`, Efeito: colVeic("frota_uso", "(volta_em is not null)", U1), Quer: "true"},
		{Nome: "a posse do outro carro (já fechada) segue como estava", Efeito: colVeic("frota_uso", "volta_em", U2), Quer: "2026-10-02 12:00:00+00"},
		{Nome: "desliga o bem", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"bem_id":null}`, Status: 200, Tem: `"bem_id":null`,
			Efeito: colVeic("frota_veiculos", "coalesce(bem_id::text, '-')", V1), Quer: "-"},
		{Nome: "sem o bem, a situação não espelha em ninguém", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"situacao":"alienado"}`, Status: 200,
			Efeito: colVeic("patrimonio_bens", "situacao", bemCarro), Quer: "em_manutencao"},
		{Nome: "religa o bem: a situação do carro vai para ele", Quem: "motorista", Metodo: "PATCH", Caminho: u(V1), Corpo: `{"bem_id":"` + bemCarro + `"}`,
			Status: 200, Efeito: colVeic("patrimonio_bens", "situacao", bemCarro), Quer: "baixado"},
	})

	// o espelho do responsável no bem (gatilho de UPDATE OF pessoa_id) num carro novo ligado a um bem
	m.Rodar(t, []caso{{Nome: "carro novo ligado ao bem livre", Quem: "motorista", Metodo: "POST", Caminho: "/frota/veiculos",
		Corpo: `{"nome":"Kwid 2","placa":"DDD4D44","bem_id":"` + bemCarro2 + `"}`, Status: 201}})
	novo := m.Um(t, "select id::text from frota_veiculos where placa = 'DDD4D44'")
	m.Rodar(t, []caso{
		{Nome: "o dono vai para o bem", Quem: "motorista", Metodo: "PATCH", Caminho: u(novo), Corpo: `{"pessoa_id":"` + pMotorista + `"}`, Status: 200,
			Efeito: colVeic("patrimonio_bens", "pessoa_id", bemCarro2), Quer: pMotorista},
		{Nome: "sem dono: o bem também fica sem", Quem: "motorista", Metodo: "PATCH", Caminho: u(novo), Corpo: `{"pessoa_id":null}`, Status: 200,
			Efeito: colVeic("patrimonio_bens", "pessoa_id", bemCarro2), Quer: "<nulo>"},
	})

	// quem não é da Frota não deixou rastro em momento nenhum: o nome do V2 é o do carga
	m.Rodar(t, []caso{{Nome: "nome do V2 intacto", Efeito: colVeic("frota_veiculos", "nome", V2), Quer: "Uno"}})
}

// As declarações do contrato passam no catálogo de produção; uma consulta que aponta a tabela errada não
// passa (deve() derrubaria a montagem da API).
func TestVeiculosDeclaracoes(t *testing.T) {
	if err := consultaVeiculos.Validar(autz.Producao); err != nil {
		t.Errorf("consulta: %v", err)
	}
	if err := tabelaVeiculos.Validar(autz.Producao); err != nil {
		t.Errorf("tabela: %v", err)
	}
	errada := consultaVeiculos
	errada.Tabela = "frota_uso"
	if err := errada.Validar(autz.Producao); err == nil {
		t.Error("consulta com a tabela errada passou")
	}
}
