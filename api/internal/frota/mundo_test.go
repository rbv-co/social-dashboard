package frota

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas do mundo da Frota. is_frota_admin() = conta ativa e ('frota' em features ou super pela
// ficha); pode_aprovar_frota() = conta ativa e ('frota.aprovar' em features ou super pela ficha).
const (
	idSuperFicha = "f3000000-0000-4000-a000-000000000001" // papel viewer, super pela ficha: lê, grava e aprova
	idAprovador  = "f3000000-0000-4000-a000-000000000002" // features {frota, frota.aprovar}
	idMotorista  = "f3000000-0000-4000-a000-000000000003" // features {frota}
	idMotorista2 = "f3000000-0000-4000-a000-000000000004" // features {frota}
	idSoAprovar  = "f3000000-0000-4000-a000-000000000005" // features {frota.aprovar} SEM frota: não lê nada
	idPatrimonio = "f3000000-0000-4000-a000-000000000006" // features {patrimonio}
	idAdmin      = "f3000000-0000-4000-a000-000000000007" // papel admin sem frota: admin do Patrimônio, não da Frota
	idDesativado = "f3000000-0000-4000-a000-000000000008" // features {frota}, conta desativada: a sessão não vale (401)
	idViewer     = "f3000000-0000-4000-a000-000000000009" // nada

	pMotorista = "f3a00000-0000-4000-a000-000000000001" // ficha de colaborador ligada ao motorista
	catVeiculo = "f3c00000-0000-4000-a000-000000000001"
	catMovel   = "f3c00000-0000-4000-a000-000000000002"
	bemCarro   = "f3b00000-0000-4000-a000-000000000001" // etiqueta 101, ligado ao V1
	bemCarro2  = "f3b00000-0000-4000-a000-000000000002" // etiqueta 103, veículo livre
	bemMesa    = "f3b00000-0000-4000-a000-000000000003" // etiqueta 102, não é veículo

	V1  = "f3d00000-0000-4000-a000-000000000001" // Gol, dono fixo pMotorista, posse U1 aberta, bem 101
	V2  = "f3d00000-0000-4000-a000-000000000002" // Uno, rodízio, nada aberto
	U1  = "f3e00000-0000-4000-a000-000000000001" // posse aberta do V1
	U2  = "f3e00000-0000-4000-a000-000000000002" // viagem fechada do V2 (km 100 → 150)
	R1  = "f3f00000-0000-4000-a000-000000000001" // reserva pendente do V2, criada pelo motorista
	R2  = "f3f00000-0000-4000-a000-000000000002" // reserva aprovada do V2, criada pelo motorista2
	I1  = "f3900000-0000-4000-a000-000000000001" // item diário 'Pneus'
	I2  = "f3900000-0000-4000-a000-000000000002" // item semanal 'Faróis'
	C1  = "f3800000-0000-4000-a000-000000000001" // ficha ASSINADA do V1 (2026-10-01), resposta Q1, na fila do PDF
	C2  = "f3800000-0000-4000-a000-000000000002" // ficha sem assinatura do V2 (2026-10-02)
	Q1  = "f3700000-0000-4000-a000-000000000001"
	P1  = "f3600000-0000-4000-a000-000000000001" // plano 'Troca de óleo' a cada 7000 km
	M1  = "f3500000-0000-4000-a000-000000000001" // manutenção do V1
	Rv1 = "f3500000-0000-4000-a000-000000000002" // troca da M1
	A1  = "f3400000-0000-4000-a000-000000000001" // abastecimento do V1
)

var pessoasDoMundo = []mundoteste.Pessoa{
	{Chave: "superFicha", ID: idSuperFicha, Email: "superficha@x.com", Papel: "viewer", Super: true},
	{Chave: "aprovador", ID: idAprovador, Email: "aprovador@x.com", Papel: "viewer", Modulos: []string{"frota", "frota.aprovar"}},
	{Chave: "motorista", ID: idMotorista, Email: "motorista@x.com", Papel: "viewer", Modulos: []string{"frota"}},
	{Chave: "motorista2", ID: idMotorista2, Email: "motorista2@x.com", Papel: "viewer", Modulos: []string{"frota"}},
	{Chave: "soAprovar", ID: idSoAprovar, Email: "soaprovar@x.com", Papel: "viewer", Modulos: []string{"frota.aprovar"}},
	{Chave: "patrimonio", ID: idPatrimonio, Email: "patrimonio@x.com", Papel: "viewer", Modulos: []string{"patrimonio"}},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin"},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "viewer", Desativado: true, Modulos: []string{"frota"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer"},
}

// semFrota: quem tem sessão e não pode ver nem gravar nada da Frota (o lado negado de toda rota). A conta
// desativada fica de fora: nem sessão ela tem (auth.Exigir → 401), e a varredura da Task 10 confere isso.
var semFrota = []string{"admin", "soAprovar", "patrimonio", "viewer"}

// Sem identidade (p.Exec): os gatilhos que exigem auth.uid() não são exercidos pela carga.
const linhasDaFrota = `
insert into acessos_pessoas (id, nome, profile_id) values ('` + pMotorista + `', 'Motorista', '` + idMotorista + `');
insert into patrimonio_categorias (id, nome) values ('` + catVeiculo + `', 'Veículos'), ('` + catMovel + `', 'Móveis');
insert into patrimonio_bens (id, numero, nome, categoria_id, situacao) values
  ('` + bemCarro + `', 101, 'Gol da frota', '` + catVeiculo + `', 'em_uso'),
  ('` + bemMesa + `', 102, 'Mesa', '` + catMovel + `', 'em_uso'),
  ('` + bemCarro2 + `', 103, 'Kwid do patrimônio', '` + catVeiculo + `', 'em_estoque');
insert into frota_veiculos (id, placa, nome, pessoa_id, bem_id) values
  ('` + V1 + `', 'AAA1A11', 'Gol', '` + pMotorista + `', '` + bemCarro + `'), ('` + V2 + `', 'BBB2B22', 'Uno', null, null);
insert into frota_uso (id, veiculo_id, pessoa_id, pessoa_nome, tipo, saida_em) values
  ('` + U1 + `', '` + V1 + `', '` + pMotorista + `', 'Motorista', 'posse', '2026-10-01T08:00:00Z');
insert into frota_uso (id, veiculo_id, pessoa_nome, tipo, saida_em, volta_em, km_saida, km_volta) values
  ('` + U2 + `', '` + V2 + `', 'Fulano', 'viagem', '2026-10-02T08:00:00Z', '2026-10-02T12:00:00Z', 100, 150);
insert into frota_requisicoes (id, veiculo_id, retirada_prevista, situacao, criada_por) values
  ('` + R1 + `', '` + V2 + `', '2026-10-20T12:00:00Z', 'pendente', '` + idMotorista + `'),
  ('` + R2 + `', '` + V2 + `', '2026-10-21T12:00:00Z', 'aprovada', '` + idMotorista2 + `');
insert into frota_checklist_itens (id, ordem, item, cadencia) values ('` + I1 + `', 1, 'Pneus', 'diario'), ('` + I2 + `', 2, 'Faróis', 'semanal');
insert into frota_checklist_config default values;
insert into frota_checklist (id, veiculo_id, feita_em, hodometro) values ('` + C1 + `', '` + V1 + `', '2026-10-01', 5000);
insert into frota_checklist_respostas (id, checklist_id, item_id, item_texto, cadencia, estado, ordem)
  values ('` + Q1 + `', '` + C1 + `', '` + I1 + `', 'Pneus', 'diario', 'ok', 0);
update frota_checklist set assinada_em = '2026-10-01T09:00:00Z', assinatura_hash = 'h-c1', assinatura_versao = 2 where id = '` + C1 + `';
insert into frota_checklist (id, veiculo_id, feita_em, hodometro, sem_assinatura_motivo)
  values ('` + C2 + `', '` + V2 + `', '2026-10-02', 150, 'sem_login');
insert into frota_plano_revisao (id, item, a_cada_km, ordem) values ('` + P1 + `', 'Troca de óleo', 7000, 1);
insert into frota_manutencoes (id, veiculo_id, km, total_centavos) values ('` + M1 + `', '` + V1 + `', 5000, 30000);
insert into frota_revisoes (id, veiculo_id, item, km, custo_centavos, manutencao_id)
  values ('` + Rv1 + `', '` + V1 + `', 'Troca de óleo', 5000, 30000, '` + M1 + `');
insert into frota_abastecimentos (id, veiculo_id, abastecido_em, km, litros, total_centavos, tanque_depois, combustivel)
  values ('` + A1 + `', '` + V1 + `', '2026-10-05T10:00:00Z', 5100, 40.5, 25000, 4, 'gasolina');`

// fotoDaFrota: um hash das 14 tabelas da Frota e do Patrimônio que os gatilhos espelham. Igual antes
// e depois = nada mudou (nem por gatilho).
const fotoDaFrota = `select md5(string_agg(l, '|' order by l)) from (
  select 'v:' || t::text as l from frota_veiculos t union all
  select 'u:' || t::text from frota_uso t union all
  select 'up:' || t::text from frota_uso_pdf t union all
  select 'r:' || t::text from frota_requisicoes t union all
  select 'rh:' || t::text from frota_requisicoes_historico t union all
  select 'c:' || t::text from frota_checklist t union all
  select 'ci:' || t::text from frota_checklist_itens t union all
  select 'cc:' || t::text from frota_checklist_config t union all
  select 'cr:' || t::text from frota_checklist_respostas t union all
  select 'cp:' || t::text from frota_checklist_pdf t union all
  select 'pl:' || t::text from frota_plano_revisao t union all
  select 'm:' || t::text from frota_manutencoes t union all
  select 'rv:' || t::text from frota_revisoes t union all
  select 'a:' || t::text from frota_abastecimentos t union all
  select 'pb:' || t::text from patrimonio_bens t) z`

// novoMundo: o esquema de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a do motorista aberta pelo super pela ficha) e as rotas de `montar` atrás da MESMA cadeia do grupo de
// domínio de web.Rotas (auth.Exigir → autz.ComEscopo), via mundoteste (extraído no 5.2).
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoasDoMundo, Linhas: linhasDaFrota,
		Impersonadas: map[string][2]string{"impersonado": {idMotorista, idSuperFicha}}}, montar...)
}
