package testebanco

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.3 (Frota): os 12 gatilhos verbatim, com as condições das migrations, disparam com a
// identidade da transação (banco.ComUsuario). Sem identidade, o aceite e a decisão de reserva recusam.
func TestFatiaDaFrotaComOsGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		motorista = "f1000000-0000-4000-a000-000000000001" // features {frota}
		aprovador = "f1000000-0000-4000-a000-000000000002" // features {frota, frota.aprovar}
		pessoa    = "f1a00000-0000-4000-a000-000000000001"
		categoria = "f1c00000-0000-4000-a000-000000000001"
		bem       = "f1b00000-0000-4000-a000-000000000001"
		carro     = "f1d00000-0000-4000-a000-000000000001" // dono fixo, posse aberta, bem ligado
		carro2    = "f1d00000-0000-4000-a000-000000000002" // rodízio, nada aberto
		item      = "f1900000-0000-4000-a000-000000000001"
		ficha     = "f1800000-0000-4000-a000-000000000001"
		reserva   = "f1f00000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+motorista+`', 'motorista@x.com'), ('`+aprovador+`', 'aprovador@x.com');
		insert into profiles (id, email, role, features) values ('`+motorista+`', 'motorista@x.com', 'viewer', '{frota}'),
		  ('`+aprovador+`', 'aprovador@x.com', 'viewer', '{frota,frota.aprovar}');
		insert into acessos_pessoas (id, nome, profile_id) values ('`+pessoa+`', 'Motorista', '`+motorista+`');
		insert into patrimonio_categorias (id, nome) values ('`+categoria+`', 'Veículos');
		insert into patrimonio_bens (id, numero, nome, categoria_id, situacao) values ('`+bem+`', 101, 'Gol', '`+categoria+`', 'em_uso');
		insert into frota_veiculos (id, placa, nome, pessoa_id, bem_id) values ('`+carro+`', 'AAA1A11', 'Gol', '`+pessoa+`', '`+bem+`'),
		  ('`+carro2+`', 'BBB2B22', 'Uno', null, null);
		insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('`+carro+`', '`+pessoa+`', 'posse');
		insert into frota_checklist_itens (id, item, cadencia) values ('`+item+`', 'Pneus', 'diario');
		insert into frota_checklist (id, veiculo_id, feita_em, hodometro) values ('`+ficha+`', '`+carro+`', '2026-10-01', 5000);
		insert into frota_checklist_respostas (checklist_id, item_id, item_texto, cadencia, estado)
		  values ('`+ficha+`', '`+item+`', 'Pneus', 'diario', 'ok');
		insert into frota_requisicoes (id, veiculo_id, retirada_prevista, criada_por)
		  values ('`+reserva+`', '`+carro2+`', '2026-10-20T12:00:00Z', '`+motorista+`');`); err != nil {
		t.Fatal(err)
	}
	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code
		}
		return ""
	}
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}

	// 1. os 12 gatilhos de produção, com as condições das migrations
	var gat []string
	linhas, err := p.Query(ctx, `select t.tgname::text from pg_trigger t join pg_class c on c.oid = t.tgrelid
		where not t.tgisinternal and c.relname like 'frota\_%' order by 1`)
	if err != nil {
		t.Fatal(err)
	}
	for linhas.Next() {
		var n string
		linhas.Scan(&n)
		gat = append(gat, n)
	}
	if quer := []string{"trg_frota_aceite_imutavel", "trg_frota_checar_arquivamento", "trg_frota_checar_decisao",
		"trg_frota_checklist_enfileirar_pdf", "trg_frota_checklist_imutavel", "trg_frota_espelha_responsavel",
		"trg_frota_espelha_situacao", "trg_frota_espelha_situacao_no_bem", "trg_frota_fechar_posse_orfa",
		"trg_frota_gravar_historico", "trg_frota_resposta_imutavel", "trg_frota_uso_enfileirar_pdf"}; !reflect.DeepEqual(gat, quer) {
		t.Fatalf("gatilhos = %v, esperava %v", gat, quer)
	}
	for nome, trechos := range map[string][]string{
		"trg_frota_checklist_imutavel":       {"WHEN ((old.assinada_em IS NOT NULL))"},
		"trg_frota_fechar_posse_orfa":        {"UPDATE OF pessoa_id", "WHEN ((new.pessoa_id IS NULL))"},
		"trg_frota_checklist_enfileirar_pdf": {"UPDATE OF assinada_em"},
		"trg_frota_uso_enfileirar_pdf":       {"UPDATE OF aceite_em"},
		"trg_frota_espelha_situacao":         {"UPDATE OF situacao"},
		"trg_frota_espelha_responsavel":      {"UPDATE OF pessoa_id"},
	} {
		def := um(`select pg_get_triggerdef(oid) from pg_trigger where tgname = '` + nome + `'`)
		for _, tr := range trechos {
			if !strings.Contains(def, tr) {
				t.Errorf("%s sem %q: %s", nome, tr, def)
			}
		}
	}

	// as RPCs que nenhum gatilho chama entram pela linha "-- funções:" da fatia (o teste do /rpc as chama)
	if v := um(`select string_agg(proname, ',' order by proname) from pg_proc
		where pronamespace = 'public'::regnamespace and proname in ('etiqueta_quem_e', 'frota_corrente_do_veiculo', 'pode_aprovar_frota')`); v != "etiqueta_quem_e,frota_corrente_do_veiculo,pode_aprovar_frota" {
		t.Errorf("funções da frota = %s", v)
	}

	// 2. aceite: sem identidade não assina; com identidade o gatilho carimba quem e quando; depois é imutável
	if _, err := p.Exec(ctx, `insert into frota_uso (veiculo_id, aceite_em) values ('`+carro2+`', now())`); codigo(err) != "23514" {
		t.Errorf("aceite sem identidade: %v", err)
	}
	if err := como(motorista, `insert into frota_uso (veiculo_id, aceite_em, aceite_nome, aceite_por)
		values ('`+carro2+`', '2020-01-01', 'Motorista', '`+aprovador+`')`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select aceite_por::text || '/' || (aceite_em > '2026-01-01')::text || '/' || (select count(*) from frota_uso_pdf)::text
		from frota_uso where veiculo_id = '` + carro2 + `'`); v != motorista+"/true/1" {
		t.Errorf("aceite = %s, esperava o carimbo de quem gravou, agora, e a fila do PDF", v)
	}
	if err := como(aprovador, `update frota_uso set aceite_nome = 'Outro' where veiculo_id = '`+carro2+`'`); codigo(err) != "23514" {
		t.Errorf("aceite assinado mudou: %v", err)
	}

	// 3. ficha: editável enquanto sem assinatura (WHEN); assinar enfileira o PDF; assinada não muda nem some
	if err := como(motorista, `update frota_checklist set hodometro = 5001 where id = '`+ficha+`'`); err != nil {
		t.Errorf("ficha sem assinatura não editou: %v", err)
	}
	if err := como(motorista, `update frota_checklist set assinada_em = now(), assinatura_hash = 'h' where id = '`+ficha+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select count(*)::text from frota_checklist_pdf where checklist_id = '` + ficha + `'`); v != "1" {
		t.Errorf("assinar não pôs a ficha na fila do PDF: %s", v)
	}
	for _, sql := range []string{
		`update frota_checklist set hodometro = 1 where id = '` + ficha + `'`,
		`delete from frota_checklist where id = '` + ficha + `'`,
		`insert into frota_checklist_respostas (checklist_id, item_texto, cadencia, estado, ordem) values ('` + ficha + `', 'x', 'diario', 'ok', 1)`,
		`update frota_checklist_respostas set estado = 'nao_ok' where checklist_id = '` + ficha + `'`,
	} {
		if err := como(aprovador, sql); codigo(err) != "P0001" {
			t.Errorf("ficha assinada aceitou %q: %v", sql, err)
		}
	}
	if v := um(`select hodometro::text || '/' || (select string_agg(estado, ',') from frota_checklist_respostas)
		from frota_checklist where id = '` + ficha + `'`); v != "5001/ok" {
		t.Errorf("ficha assinada mudou: %s", v)
	}

	// 4. reserva: quem decide é quem tem frota.aprovar (gatilho), com rastro de QUEM mudou
	if err := como(motorista, `update frota_requisicoes set situacao = 'aprovada' where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "permissão para aprovar") {
		t.Errorf("motorista aprovou: %v", err)
	}
	if _, err := p.Exec(ctx, `update frota_requisicoes set situacao = 'recusada' where id = '`+reserva+`'`); codigo(err) != "23514" {
		t.Errorf("decisão sem identidade: %v", err)
	}
	if err := como(motorista, `update frota_requisicoes set destino = 'Campinas' where id = '`+reserva+`'`); codigo(err) != "23514" {
		t.Errorf("motorista editou a reserva: %v", err)
	}
	if v := um(`select situacao || '/' || coalesce(destino, '-') || '/' || (select count(*) from frota_requisicoes_historico)::text
		from frota_requisicoes where id = '` + reserva + `'`); v != "pendente/-/0" {
		t.Errorf("recusa gravou: %s", v)
	}
	if err := como(aprovador, `update frota_requisicoes set situacao = 'aprovada', destino = 'Campinas' where id = '`+reserva+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select r.decidida_por::text || '/' || string_agg(h.campo || ':' || coalesce(h.de, '-') || '>' || h.para || ':' || h.quem::text, ',' order by h.campo)
		from frota_requisicoes r join frota_requisicoes_historico h on h.requisicao_id = r.id
		where r.id = '` + reserva + `' group by r.decidida_por`); v != aprovador+"/destino:->Campinas:"+aprovador+",situação:pendente>aprovada:"+aprovador {
		t.Errorf("decisão e histórico = %s", v)
	}
	if err := como(aprovador, `update frota_requisicoes set situacao = 'cancelada' where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "motivo") {
		t.Errorf("cancelou sem motivo: %v", err)
	}
	if err := como(aprovador, `update frota_requisicoes set arquivada_em = now() where id = '`+reserva+`'`); codigo(err) != "23514" ||
		!strings.Contains(err.Error(), "Só reserva encerrada") {
		t.Errorf("arquivou reserva aprovada que não venceu: %v", err)
	}

	// 5. veículo: parar espelha no Patrimônio; tirar o dono fecha a posse órfã; o dono novo vai ao bem
	if err := como(motorista, `update frota_veiculos set situacao = 'inativo' where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select situacao from patrimonio_bens where id = '` + bem + `'`); v != "em_estoque" {
		t.Errorf("bem = %s, esperava em_estoque", v)
	}
	if err := como(motorista, `update frota_veiculos set pessoa_id = null where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select count(*)::text from frota_uso where veiculo_id = '` + carro + `' and volta_em is null`); v != "0" {
		t.Errorf("posse órfã ficou aberta: %s", v)
	}
	if err := como(motorista, `update frota_veiculos set pessoa_id = '`+pessoa+`' where id = '`+carro+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select coalesce(pessoa_id::text, '<nulo>') from patrimonio_bens where id = '` + bem + `'`); v != pessoa {
		t.Errorf("responsável do bem = %s", v)
	}
}

// As travas de produção que o 5.2 deixou de fora ao trazer frota_uso mínima, e as das tabelas novas: o banco
// recusa o que a rota não pode deixar passar (volta antes da saída, km para trás, tipo fora de viagem/posse,
// dois usos abertos no mesmo carro, reserva que termina antes de começar, situação fora da lista).
func TestFatiaDaFrotaAsTravasDoBanco(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const carro = "f2d00000-0000-4000-a000-000000000001"
	if _, err := p.Exec(ctx, `insert into frota_veiculos (id, placa, nome) values ('`+carro+`', 'CCC3C33', 'Palio')`); err != nil {
		t.Fatal(err)
	}
	cod := func(sql string) string {
		_, err := p.Exec(ctx, sql)
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code + ":" + pe.ConstraintName
		}
		if err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return "ok"
	}
	for _, c := range []struct{ sql, quer string }{
		{`insert into frota_uso (veiculo_id, saida_em, volta_em) values ('` + carro + `', '2026-10-02', '2026-10-01')`, "23514:frota_uso_volta_depois"},
		{`insert into frota_uso (veiculo_id, km_saida, km_volta, volta_em) values ('` + carro + `', 100, 99, now() + interval '1 hour')`, "23514:frota_uso_km_cresce"},
		{`insert into frota_uso (veiculo_id, tipo, volta_em) values ('` + carro + `', 'passeio', now() + interval '1 hour')`, "23514:frota_uso_tipo_valido"},
		{`insert into frota_uso (veiculo_id, tanque_quartos, volta_em) values ('` + carro + `', 5, now() + interval '1 hour')`, "23514:frota_uso_tanque_quartos_check"},
		{`insert into frota_uso (veiculo_id, aceite_checklist_id) values ('` + carro + `', gen_random_uuid())`, "23503:frota_uso_aceite_checklist_id_fkey"},
		{`insert into frota_uso (veiculo_id) values ('` + carro + `')`, "ok"},
		{`insert into frota_uso (veiculo_id, tipo) values ('` + carro + `', 'posse')`, "23505:uniq_frota_uso_um_aberto"},
		{`insert into frota_requisicoes (veiculo_id, retirada_prevista, devolucao_prevista) values ('` + carro + `', '2026-10-02', '2026-10-01')`, "23514:frota_req_volta_depois"},
		{`insert into frota_requisicoes (veiculo_id, retirada_prevista, situacao) values ('` + carro + `', '2026-10-02', 'vencida')`, "23514:frota_requisicoes_situacao_check"},
		{`insert into frota_requisicoes (veiculo_id, retirada_prevista, situacao) values ('` + carro + `', '2026-10-02', 'revogada')`, "ok"},
		{`insert into frota_veiculos (placa, nome, situacao) values ('DDD4D44', 'X', 'vendido')`, "23514:frota_veiculos_situacao_check"},
		{`insert into frota_checklist_config default values`, "ok"},
		{`insert into frota_checklist_config (id) values (false)`, "23514:frota_checklist_config_id_check"},
		{`insert into frota_checklist (veiculo_id, feita_em, hodometro) values ('` + carro + `', '2026-10-01', 0)`, "23514:frota_checklist_hodometro_check"},
		{`insert into frota_checklist (veiculo_id, feita_em, hodometro) values ('` + carro + `', '2026-10-01', 1)`, "ok"},
		{`insert into frota_checklist (veiculo_id, feita_em, hodometro) values ('` + carro + `', '2026-10-01', 2)`, "23505:frota_checklist_veiculo_id_feita_em_key"},
		{`insert into frota_abastecimentos (veiculo_id, km, litros, total_centavos, tanque_depois, combustivel) values ('` + carro + `', 10, 0, 100, 4, 'gasolina')`, "23514:frota_abast_litros_positivo"},
	} {
		if got := cod(c.sql); got != c.quer {
			t.Errorf("%s\n  = %s, esperava %s", c.sql, got, c.quer)
		}
	}
	// a ficha nova nasce com o default da cadência, e o gatilho do PDF não a enfileira sem assinatura
	var cad string
	var fila int
	if err := p.QueryRow(ctx, `select cadencias::text, (select count(*) from frota_checklist_pdf) from frota_checklist`).Scan(&cad, &fila); err != nil || cad != "{diario}" || fila != 0 {
		t.Errorf("cadencias = %q, fila = %d, err = %v", cad, fila, err)
	}
}
