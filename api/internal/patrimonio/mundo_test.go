package patrimonio

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas, cadastros e bens do mundo do 5.2 (ids fixos).
const (
	idPatGeral   = "5e200000-0000-4000-a000-000000000001" // patrimônio SEM trava: vê todos os bens
	idPatT1      = "5e200000-0000-4000-a000-000000000002" // patrimônio com trava, no time T1 (local L1); a P1 é ela
	idPatT2      = "5e200000-0000-4000-a000-000000000003" // patrimônio com trava, no time T2 (local L2)
	idFrota      = "5e200000-0000-4000-a000-000000000004" // só frota: lê e cria marca, local e ambiente; não lê bem
	idAcessos    = "5e200000-0000-4000-a000-000000000005" // só acessos: cadastro rápido, nada de patrimônio
	idViewer     = "5e200000-0000-4000-a000-000000000006" // nada
	idSuperFicha = "5e200000-0000-4000-a000-000000000007" // super pela ficha, papel viewer, sem módulo (frota pela ficha)

	P1 = "9e200000-0000-4000-a000-000000000001" // acessos_pessoas da patT1 (profile_id)
	P2 = "9e200000-0000-4000-a000-000000000002" // motorista, sem login
	S1 = "a6000000-0000-4000-a000-000000000001"

	E1   = "a1000000-0000-4000-a000-000000000001"
	E2   = "a1000000-0000-4000-a000-000000000002"
	L1   = "a2000000-0000-4000-a000-000000000001" // local do T1
	L2   = "a2000000-0000-4000-a000-000000000002" // local do T2
	L3   = "a2000000-0000-4000-a000-000000000003" // local sem time
	C1   = "a3000000-0000-4000-a000-000000000001" // ambiente em L1
	CatV = "a4000000-0000-4000-a000-000000000001" // Veículos
	CatM = "a4000000-0000-4000-a000-000000000002" // Móveis e Utensílios
	TpM  = "a5000000-0000-4000-a000-000000000001" // Mesa (Móveis)
	T1   = "e2000000-0000-4000-a000-000000000001"
	T2   = "e2000000-0000-4000-a000-000000000002"

	B1  = "b0000000-0000-4000-a000-000000000001" // em L1
	B2  = "b0000000-0000-4000-a000-000000000002" // em L2
	B3  = "b0000000-0000-4000-a000-000000000003" // em L3, com a P1 (a patT1 vê pela mão)
	B4  = "b0000000-0000-4000-a000-000000000004" // sem local nem pessoa
	BV  = "b0000000-0000-4000-a000-000000000005" // veículo em L1, ligado ao V1
	BV2 = "b0000000-0000-4000-a000-000000000006" // veículo em L1, sem carro
	PO1 = "b1000000-0000-4000-a000-000000000001" // posse aberta do B1
	PO2 = "b1000000-0000-4000-a000-000000000002" // posse aberta do B2
	PO3 = "b1000000-0000-4000-a000-000000000003" // posse fechada do B3
	V1  = "f0000000-0000-4000-a000-000000000001"
	U1  = "f1000000-0000-4000-a000-000000000001" // posse aberta do V1 na frota
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "patGeral", ID: idPatGeral, Email: "patgeral@x.com", Papel: "viewer", Modulos: []string{"patrimonio"}},
	{Chave: "patT1", ID: idPatT1, Email: "patt1@x.com", Papel: "viewer", Trava: true, Modulos: []string{"patrimonio"}},
	{Chave: "patT2", ID: idPatT2, Email: "patt2@x.com", Papel: "viewer", Trava: true, Modulos: []string{"patrimonio"}},
	{Chave: "frota", ID: idFrota, Email: "frota@x.com", Papel: "viewer", Trava: true, Modulos: []string{"frota"}},
	{Chave: "acessos", ID: idAcessos, Email: "acessos@x.com", Papel: "viewer", Trava: true, Modulos: []string{"acessos"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer", Trava: true},
	{Chave: "superFicha", ID: idSuperFicha, Email: "superficha@x.com", Papel: "viewer", Super: true, Trava: true},
}

// sem identidade; ligar o V1 ao BV no insert dispara o espelho de situação (já batem: em_uso/ativo)
const linhasDoMundo = `
insert into acessos_pessoas (id, nome, profile_id) values ('` + P1 + `', 'Pessoa da T1', '` + idPatT1 + `'), ('` + P2 + `', 'Motorista', null);
insert into acessos_setores (id, nome, ordem) values ('` + S1 + `', 'Administrativo', 1);
insert into patrimonio_empresas (id, nome, ordem) values ('` + E1 + `', 'Vessel', 1), ('` + E2 + `', 'RBV Company', 2);
insert into patrimonio_locais (id, nome, ordem, empresa_id) values ('` + L1 + `', 'Loja Tivoli', 1, '` + E1 + `'),
  ('` + L2 + `', 'Loja Dom Pedro', 2, '` + E1 + `'), ('` + L3 + `', 'Sede Limeira', 1, '` + E2 + `');
insert into patrimonio_comodos (id, nome, ordem, local_id) values ('` + C1 + `', 'Operação Loja', 1, '` + L1 + `');
insert into patrimonio_categorias (id, nome, ordem) values ('` + CatM + `', 'Móveis e Utensílios', 2), ('` + CatV + `', 'Veículos', 6);
insert into patrimonio_tipos (id, categoria_id, nome, ordem) values ('` + TpM + `', '` + CatM + `', 'Mesa', 1);
insert into patrimonio_config (chave, valor) values ('numero_maximo', '400');
insert into equipes (id, nome, local_id) values ('` + T1 + `', 'Tivoli', '` + L1 + `'), ('` + T2 + `', 'Dom Pedro', '` + L2 + `');
insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '` + idPatT1 + `', 'vendedora'), ('` + T2 + `', '` + idPatT2 + `', 'vendedora');
insert into patrimonio_bens (id, numero, nome, local_id, categoria_id, pessoa_id, situacao) values
  ('` + B1 + `', 1, 'Cadeira da Tivoli', '` + L1 + `', '` + CatM + `', null, 'em_uso'),
  ('` + B2 + `', 2, 'Cadeira do Dom Pedro', '` + L2 + `', '` + CatM + `', null, 'em_uso'),
  ('` + B3 + `', 3, 'Notebook da Pessoa T1', '` + L3 + `', null, '` + P1 + `', 'em_uso'),
  ('` + B4 + `', 4, 'Mesa sem lugar', null, '` + CatM + `', null, 'em_estoque'),
  ('` + BV + `', 10, 'Kwid', '` + L1 + `', '` + CatV + `', '` + P2 + `', 'em_uso'),
  ('` + BV2 + `', 11, 'Kwid novo', '` + L1 + `', '` + CatV + `', null, 'em_estoque');
insert into patrimonio_posse (id, bem_id, pessoa_id, pessoa_nome, de, ate) values
  ('` + PO1 + `', '` + B1 + `', '` + P2 + `', 'Motorista', '2026-01-01', null),
  ('` + PO2 + `', '` + B2 + `', '` + P2 + `', 'Motorista', '2026-01-01', null),
  ('` + PO3 + `', '` + B3 + `', '` + P1 + `', 'Pessoa da T1', '2025-01-01', '2025-12-31');
insert into frota_veiculos (id, placa, nome, situacao, pessoa_id, bem_id) values ('` + V1 + `', 'ABC1D23', 'Kwid', 'ativo', '` + P2 + `', '` + BV + `');
insert into frota_uso (id, veiculo_id, pessoa_id, tipo) values ('` + U1 + `', '` + V1 + `', '` + P2 + `', 'posse');`

// fotoDoMundo: um hash de tudo que o 5.2 pode gravar (direto ou por gatilho). Igual antes e depois = nada mudou.
const fotoDoMundo = `select md5(string_agg(l, '|' order by l)) from (
  select 'bens:' || t::text as l from patrimonio_bens t union all
  select 'posse:' || t::text from patrimonio_posse t union all
  select 'empresas:' || t::text from patrimonio_empresas t union all
  select 'locais:' || t::text from patrimonio_locais t union all
  select 'comodos:' || t::text from patrimonio_comodos t union all
  select 'categorias:' || t::text from patrimonio_categorias t union all
  select 'tipos:' || t::text from patrimonio_tipos t union all
  select 'config:' || t::text from patrimonio_config t union all
  select 'log:' || t::text from patrimonio_log t union all
  select 'pessoas:' || t::text from acessos_pessoas t union all
  select 'setores:' || t::text from acessos_setores t union all
  select 'veiculos:' || t::text from frota_veiculos t union all
  select 'usos:' || t::text from frota_uso t) z`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDoMundo,
		Impersonadas: map[string][2]string{"impersonado": {idPatGeral, idSuperFicha}}}, montar...)
}

func contar(tabela string) string { return "select count(*)::text from " + tabela }

func col(tabela, coluna, id string) string {
	return "select " + coluna + "::text from " + tabela + " where id = '" + id + "'"
}

// ids: os "id" de uma lista JSON, em ordem.
func ids(t *testing.T, corpo string) []string {
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
	slices.Sort(out)
	return out
}
