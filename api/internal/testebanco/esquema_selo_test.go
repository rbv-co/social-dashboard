package testebanco

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.10: as 12 tabelas do selo, os 6 gatilhos vivos em produção (com o OF e o WHEN das migrations), as 35
// funções verbatim e a disparar_robo nova (migração 00007). Porta, por COMPORTAMENTO, o que os db/*.test.mjs do
// selo provavam pelo texto das migrations: registro-com-conta (o gatilho preenche cliente_id pelo pedido),
// lembretes-de-registro (o lembrete morre com o registro), trilha-de-edicoes (a lista fechada de ações),
// vessel-registro-nao-toma-peca-com-dona (o 'bling' só para a chave de serviço). A série, a peça presa e as
// recusas das funções são da Task 4 (pelas rotas).
func TestFatiaDaAutenticidade(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		selo    = "a5a10000-0000-4000-a000-000000000001" // features {autenticidade}
		super   = "a5a10000-0000-4000-a000-000000000002" // is_superadmin da ficha, sem o módulo
		admin   = "a5a10000-0000-4000-a000-000000000003" // papel admin, sem o módulo: is_vessel_admin NÃO olha o papel
		lote1   = "a5a20000-0000-4000-a000-0000000000b1"
		lote2   = "a5a20000-0000-4000-a000-0000000000b2"
		lote3   = "a5a20000-0000-4000-a000-0000000000b3"
		pedido  = "a5a30000-0000-4000-a000-0000000000d1"
		cliente = "a5a40000-0000-4000-a000-0000000000c1"
	)
	um := func(sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := p.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	como := func(id, sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { return tx.QueryRow(ctx, sql, args...).Scan(&v) }); err != nil {
			t.Fatalf("%s como %s: %v", sql, id, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}

	for _, tab := range []string{"vessel_lotes", "vessel_pecas", "vessel_clientes", "vessel_pedidos_de_registro", "vessel_registros",
		"vessel_leituras", "vessel_baixas", "vessel_edicoes", "vessel_garantias_baixadas", "vessel_cartao_pedidos",
		"vessel_cartao_arquivos", "vessel_lembretes", "disparos_pendentes"} {
		if um(`select coalesce(to_regclass($1::text)::text, 'falta')`, "public."+tab) == "falta" {
			t.Errorf("tabela %s não existe", tab)
		}
	}
	// os gatilhos do selo: os 6 vivos; vessel_lote_novo_pede_foto e vessel_cartao_pedido_novo_acorda_o_robo saíram em 10/10
	linhas, err := p.Query(ctx, `select c.relname::text || '.' || g.tgname::text || ':' ||
		  case when g.tgtype::int & 2 = 2 then 'before' else 'after' end
		  from pg_trigger g join pg_class c on c.oid = g.tgrelid
		 where not g.tgisinternal and c.relname like 'vessel\_%' order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	gat, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		t.Fatal(err)
	}
	if quer := []string{"vessel_clientes.vessel_clientes_atualizado:before",
		"vessel_lotes.trg_vessel_lote_material_recalcula_garantia:after", "vessel_lotes.trg_vessel_lote_novo_herda_material:before",
		"vessel_lotes.trg_vessel_lotes_marcar_teste:before", "vessel_registros.vessel_registros_mata_o_lembrete:after",
		"vessel_registros.vessel_registros_preencher_cliente_id:before"}; !reflect.DeepEqual(gat, quer) {
		t.Errorf("gatilhos do selo = %v, esperava %v", gat, quer)
	}

	// o gatilho de produção da lista de espera (o dele é do 5.11) numa tabela de prova: insert e update não quebram, e
	// os 6 disparos (3 inserts, 3 updates) viram UM pedido pendente
	exec(`create table lista_de_prova (id int);
		create trigger lista_de_prova_espelhar after insert or update on lista_de_prova
		  for each row execute function vessel_espelhar_agora();
		insert into lista_de_prova values (1);
		insert into lista_de_prova values (2), (3);
		update lista_de_prova set id = id + 10`)
	if v := um(`select robo || '|' || situacao || '|' || pedidos || '|' || corpo::text from disparos_pendentes`); v != `vessel-espelhar-lista|pendente|6|{"origem": "gatilho"}` {
		t.Errorf("disparos do espelho = %s", v)
	}

	// lote: marcar teste pelo prefixo do SKU (no insert e no update OF sku) e herdar o material do último lote do SKU
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade, material, material_fonte) values ($1::uuid, 'Linear', 'SS0001HB.S1', 3, 'canvas', 'dono')`, lote1)
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade) values ($1::uuid, 'Linear', 'SS0001HB.S1', 1)`, lote3)
	exec(`insert into vessel_lotes (id, modelo, sku, quantidade) values ($1::uuid, 'Prova', 'teste-01', 2)`, lote2)
	if v := um(`select material || '|' || material_fonte || '|' || teste::text from vessel_lotes where id = $1::uuid`, lote3); v != "canvas|herdado|false" {
		t.Errorf("lote novo do mesmo SKU = %s", v)
	}
	if v := um(`select teste::text || '|' || coalesce(material, '-') from vessel_lotes where id = $1::uuid`, lote2); v != "true|-" {
		t.Errorf("lote de teste = %s", v)
	}
	exec(`update vessel_lotes set sku = 'SS9' where id = $1::uuid`, lote2)
	if v := um(`select teste::text from vessel_lotes where id = $1::uuid`, lote2); v != "false" {
		t.Errorf("trocar o SKU não recalculou teste: %s", v)
	}

	// registro: o gatilho preenche cliente_id pelo PEDIDO (new.pedido_id) e mata o lembrete aberto da peça
	exec(`insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values ('VBAAAA0003', $1::uuid, 3, now())`, lote1)
	exec(`insert into vessel_clientes (id, nome, cpf, email, senha_hash) values ($1::uuid, 'Ana', '52998224725', 'ana@x.com', 'x')`, cliente)
	exec(`insert into vessel_pedidos_de_registro (id, codigo, nome, cpf, whatsapp, estado, decidido_por_que, conferencia, criado_em, cliente_id)
		values ($1::uuid, 'VBAAAA0003', 'Ana Cliente', '52998224725', '11999990000', 'aprovado', 'na_mao', '{"quando":"2026-01-10"}',
		  '2026-01-12T12:00:00Z', $2::uuid)`, pedido, cliente)
	exec(`insert into vessel_lembretes (peca_codigo, email, consentimento_em) values ('VBAAAA0003', 'ana@x.com', now())`)
	exec(`insert into vessel_registros (codigo, nome, whatsapp, garantia_ate, registrado_em, cpf, pedido_id, bling_pedido)
		values ('VBAAAA0003', 'Ana Cliente', '11999990000', '2028-01-10', '2026-01-15T15:00:00Z', '52998224725', $1::uuid, '777')`, pedido)
	if v := um(`select cliente_id::text from vessel_registros where codigo = 'VBAAAA0003'`); v != cliente {
		t.Errorf("cliente_id do registro = %s", v)
	}
	if v := um(`select cancelado_por || '|' || (cancelado_em is not null)::text from vessel_lembretes`); v != "registro|true" {
		t.Errorf("lembrete depois do registro = %s", v)
	}
	// material do lote muda → a garantia recalcula pela data da compra da conferência (couro: 6 meses)
	exec(`update vessel_lotes set material = 'couro', material_fonte = 'painel' where id = $1::uuid`, lote1)
	if v := um(`select garantia_ate::text from vessel_registros where codigo = 'VBAAAA0003'`); v != "2026-07-10" {
		t.Errorf("garantia em couro = %s", v)
	}
	exec(`update vessel_clientes set nome = 'Ana B' where id = $1::uuid`, cliente)
	if v := um(`select (atualizado_em > criado_em)::text from vessel_clientes`); v != "true" {
		t.Error("vessel_clientes_atualizado não tocou atualizado_em")
	}

	// a trilha aceita toda ação que as funções do painel escrevem, e só a lista fechada
	for _, acao := range []string{"desmarcar_gravada", "sobrescrever_para_fila", "sobrescrever_para_baixa", "registro_aprovado",
		"registro_recusado", "dono_trocado", "baixar_garantia", "lote_excluido", "peca_excluida", "material_do_lote"} {
		if _, err := p.Exec(ctx, `insert into vessel_edicoes (codigo, acao) values ('X', $1::text)`, acao); err != nil {
			t.Errorf("a trilha recusou %s: %v", acao, err)
		}
	}
	_, err = p.Exec(ctx, `insert into vessel_edicoes (codigo, acao) values ('X', 'inventada')`)
	if pe := (*pgconn.PgError)(nil); !errors.As(err, &pe) || pe.Code != "23514" {
		t.Errorf("ação fora da lista = %v", err)
	}

	// o portão das funções: módulo ou super da ficha; o papel admin sozinho, não
	exec(`insert into usuarios (id, email) values ($1::uuid, 'selo@x.com'), ($2::uuid, 'super@x.com'), ($3::uuid, 'admin@x.com')`, selo, super, admin)
	exec(`insert into profiles (id, email, role, features, is_superadmin) values ($1::uuid, 'selo@x.com', 'viewer', '{autenticidade}', false),
		  ($2::uuid, 'super@x.com', 'viewer', '{}', true), ($3::uuid, 'admin@x.com', 'admin', '{}', false)`, selo, super, admin)
	if v := como(selo, `select vessel_alertas()->>'ok'`); v != "true" {
		t.Errorf("selo nos alertas = %s", v)
	}
	if v := como(admin, `select vessel_alertas()->>'motivo'`); v != "sem_permissao" {
		t.Errorf("admin sem o módulo nos alertas = %s", v)
	}
	// 'bling' (aprovação automática) na compat: ninguém passa — nem o selo, nem o super, nem uma conexão sem identidade
	// (auth.role() da compat nunca é nulo e o papel nunca é service_role): é do Plano 6 (achado 2)
	for _, id := range []string{selo, super} {
		if v := como(id, `select vessel_decidir_pedido_de_registro($1::uuid, 'aprovado', 'bling', '{"pedido":"9"}'::jsonb, null)->>'motivo'`, pedido); v != "sem_permissao" {
			t.Errorf("'bling' como %s = %s", id, v)
		}
	}
	if v := um(`select vessel_decidir_pedido_de_registro($1::uuid, 'aprovado', 'bling', '{"pedido":"9"}'::jsonb, null)->>'motivo'`, pedido); v != "sem_permissao" {
		t.Errorf("'bling' sem identidade = %s", v)
	}
}
