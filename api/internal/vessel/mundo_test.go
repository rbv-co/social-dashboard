package vessel

import (
	"context"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O mundo do selo: quem passa em is_vessel_admin() (o módulo autenticidade, ou is_superadmin da ficha) e quem não
// passa (papel admin sem o módulo, a chave autenticidade em permissions sem o módulo, um leitor, a conta
// desativada), mais o "entrar como" (o super entrou como o selo).
const (
	idSelo       = "a5a10000-0000-4000-a000-000000000001"
	idSuper      = "a5a10000-0000-4000-a000-000000000002"
	idAdmin      = "a5a10000-0000-4000-a000-000000000003"
	idLeitor     = "a5a10000-0000-4000-a000-000000000004"
	idDesativado = "a5a10000-0000-4000-a000-000000000005"
	idChave      = "a5a10000-0000-4000-a000-000000000006"

	L1 = "a5a20000-0000-4000-a000-0000000000b1" // Linear, SS0001HB.S1, canvas: P1 gravada com cartão, P2 livre, P3 gravada com dona
	L2 = "a5a20000-0000-4000-a000-0000000000b2" // Prova, TESTE-01, sem material: T1 livre (lembrete, pedido pendente), T2 baixada

	P1, P2, P3 = "VBAAAA0001", "VBAAAA0002", "VBAAAA0003"
	T1, T2     = "VBTTTT0001", "VBTTTT0002"

	PR1 = "a5a30000-0000-4000-a000-0000000000d1" // aprovado: deu a dona de P3 (conferência com data: 2026-01-10)
	PR2 = "a5a30000-0000-4000-a000-0000000000d2" // pendente, em P2
	PR3 = "a5a30000-0000-4000-a000-0000000000d3" // pendente, em T1
	Q1  = "a5a50000-0000-4000-a000-0000000000e1" // pedido de cartão pronto (P1), pasta do dia 2026-10-09
	Q2  = "a5a50000-0000-4000-a000-0000000000e2" // pedido de cartão que falhou (P2)

	cpfDaDona = "52998224725"
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "selo", ID: idSelo, Email: "selo@x.com", Papel: "viewer", Modulos: []string{"autenticidade"}},
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin", Modulos: []string{"meta", "sales"}},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "desativado", ID: idDesativado, Email: "fora@x.com", Papel: "viewer", Modulos: []string{"autenticidade"}, Desativado: true},
	{Chave: "chave", ID: idChave, Email: "chave@x.com", Papel: "viewer", Modulos: []string{"meta"}},
}

const linhas = `
update profiles set permissions = '{"autenticidade": ["ver", "editar"]}' where id = '` + idChave + `';
insert into vessel_lotes (id, modelo, cor, sku, quantidade, material, material_fonte, os, criado_em) values
  ('` + L1 + `', 'Linear', 'Caramelo', 'SS0001HB.S1', 3, 'canvas', 'dono', 'OS-7', '2026-01-01T10:00:00Z'),
  ('` + L2 + `', 'Prova', null, 'TESTE-01', 2, null, null, null, '2026-02-01T10:00:00Z');
insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em, cartao_gerado_em, criado_em) values
  ('VBAAAA0001', '` + L1 + `', 1, '2026-01-02T10:00:00Z', '2026-10-09T12:00:00Z', '2026-01-01T10:00:00Z'),
  ('VBAAAA0002', '` + L1 + `', 2, null, null, '2026-01-01T10:00:01Z'),
  ('VBAAAA0003', '` + L1 + `', 3, '2026-01-02T10:05:00Z', null, '2026-01-01T10:00:02Z'),
  ('VBTTTT0001', '` + L2 + `', 1, null, null, '2026-02-01T10:00:00Z'),
  ('VBTTTT0002', '` + L2 + `', 2, null, null, '2026-02-01T10:00:01Z');
insert into vessel_pedidos_de_registro (id, codigo, nome, cpf, whatsapp, estado, decidido_por_que, conferencia, criado_em) values
  ('` + PR1 + `', 'VBAAAA0003', 'Ana Cliente', '` + cpfDaDona + `', '11999990000', 'aprovado', 'na_mao', '{"quando": "2026-01-10"}', '2026-01-12T12:00:00Z'),
  ('` + PR2 + `', 'VBAAAA0002', 'Carla Compradora', '11144477735', '11977776666', 'pendente', null, null, '2026-02-01T12:00:00Z'),
  ('` + PR3 + `', 'VBTTTT0001', 'Duda Teste', '11144477735', '11966665555', 'pendente', null, null, '2026-02-02T12:00:00Z');
insert into vessel_registros (codigo, nome, whatsapp, onde_comprou, comprado_em, garantia_ate, registrado_em, cpf, pedido_id,
    bling_pedido, bling_contato_id, nascimento)
  values ('VBAAAA0003', 'Ana Cliente', '11999990000', 'Loja Iguatemi', '2026-01-10', '2028-01-10', '2026-01-15T15:00:00Z',
    '` + cpfDaDona + `', '` + PR1 + `', '777', '555', '1990-05-01');
insert into vessel_baixas (codigo, motivo, baixada_em) values ('VBTTTT0002', 'teste', '2026-02-03T10:00:00Z');
insert into vessel_baixas (codigo, motivo, baixada_em, desfeita_em) values ('VBTTTT0001', 'defeito', '2026-02-02T10:00:00Z', '2026-02-02T11:00:00Z');
insert into vessel_cartao_pedidos (id, pecas, situacao, pasta, erro, criado_em, terminou_em) values
  ('` + Q1 + `', '{VBAAAA0001}', 'pronto', 'Cartões com EAN/2026-10-09', null, '2026-10-09T11:00:00Z', '2026-10-09T12:00:00Z'),
  ('` + Q2 + `', '{VBAAAA0002}', 'falhou', null, 'zoho fora', '2026-10-10T11:00:00Z', '2026-10-10T11:05:00Z');
insert into vessel_lembretes (peca_codigo, email, consentimento_em, token_hash) values
  ('VBTTTT0001', 'duda@x.com', '2026-02-02T12:00:00Z', 'HASH-SECRETO');
insert into vessel_leituras (codigo, achou, ip_hash, lido_em) values
  ('VBAAAA0003', true, 'ip1', now() - interval '1 day'), ('NAOEXISTE', false, 'ip2', now() - interval '2 days');
`

// fotoDoSelo: tudo o que uma RPC do selo pode mudar. Igual antes e depois = o negado não gravou.
const fotoDoSelo = `select md5(coalesce(string_agg(t, '|' order by t), '')) from (
	select 'l' || row_to_json(x)::text t from vessel_lotes x union all
	select 'p' || row_to_json(x)::text from vessel_pecas x union all
	select 'r' || row_to_json(x)::text from vessel_registros x union all
	select 'q' || row_to_json(x)::text from vessel_pedidos_de_registro x union all
	select 'b' || row_to_json(x)::text from vessel_baixas x union all
	select 'e' || row_to_json(x)::text from vessel_edicoes x union all
	select 'g' || row_to_json(x)::text from vessel_garantias_baixadas x union all
	select 'c' || row_to_json(x)::text from vessel_cartao_pedidos x union all
	select 'm' || row_to_json(x)::text from vessel_lembretes x union all
	select 'd' || row_to_json(x)::text from disparos_pendentes x) f`

func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhas,
		Impersonadas: map[string][2]string{"impersonado": {idSelo, idSuper}}}, montar...)
}

// O mundo mostra os dois lados da regra (is_vessel_admin = autz.VesselAdmin) e as linhas carregam.
func TestMundoDoSelo(t *testing.T) {
	m := novoMundo(t)
	for id, quer := range map[string]bool{idSelo: true, idSuper: true, idAdmin: false, idLeitor: false, idChave: false, idDesativado: false} {
		e, err := autz.CarregarEscopo(context.Background(), m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		if autz.VesselAdmin(e) != quer {
			t.Errorf("VesselAdmin(%s) = %t, esperava %t", id, !quer, quer)
		}
	}
	if v := m.Um(t, `select (select count(*) from vessel_pecas)::text || '|' || (select count(*) from vessel_registros)::text
		|| '|' || (select count(*) from vessel_baixas where desfeita_em is null)::text`); v != "5|1|1" {
		t.Errorf("linhas = %s", v)
	}
}
