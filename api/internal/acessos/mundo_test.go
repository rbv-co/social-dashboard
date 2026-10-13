package acessos

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

type caso = mundoteste.Caso

// Pessoas do mundo. is_acessos_admin() = conta ativa e (papel admin ou 'acessos' em features): NÃO
// inclui super-admin, nem pela ficha nem por e-mail.
const (
	idAcessos    = "a4000000-0000-4000-a000-000000000001" // features {acessos}, viewer: lê e grava; não exclui colaborador
	idAdmin      = "a4000000-0000-4000-a000-000000000002" // papel admin: is_acessos_admin pelo papel; exclui; lê o Patrimônio
	idSuperFicha = "a4000000-0000-4000-a000-000000000003" // viewer, super pela ficha, sem acessos: NADA
	idSuperEmail = "a4000000-0000-4000-a000-000000000004" // breno@rbvcompany.com (is_superadmin() por e-mail), viewer: NADA
	idFrota      = "a4000000-0000-4000-a000-000000000005" // features {frota}: o convite do dono (tela-de-frota.vue:829)
	idPatrimonio = "a4000000-0000-4000-a000-000000000006" // features {patrimonio}
	idDesativado = "a4000000-0000-4000-a000-000000000007" // features {acessos}, conta desativada: nem a sessão vale
	idViewer     = "a4000000-0000-4000-a000-000000000008" // nada; é o login que a Carla recebe no "ligar"

	O1  = "a4100000-0000-4000-a000-000000000001" // 'Sede Centro', ordem 1
	O2  = "a4100000-0000-4000-a000-000000000002" // 'Fábrica Conchal', ordem 2
	S1  = "a4200000-0000-4000-a000-000000000001" // 'RH' na O1
	S2  = "a4200000-0000-4000-a000-000000000002" // 'Comercial' na O1; o time EQ1 aponta para ele
	EMP = "a4300000-0000-4000-a000-000000000001" // patrimonio_empresas 'Vessel' (a marca)
	P1  = "a4400000-0000-4000-a000-000000000001" // 'Ana Lima', ativa, S1/O1/Vessel, LIGADA ao idAcessos
	P2  = "a4400000-0000-4000-a000-000000000002" // 'Bruno Reis', desligado, vínculo V2
	P3  = "a4400000-0000-4000-a000-000000000003" // 'Carla Dias', ativa, S2, SEM login (a ligar)
	R1  = "a4500000-0000-4000-a000-000000000001" // pasta iCloud 'Fotos da loja'
	R2  = "a4500000-0000-4000-a000-000000000002" // pasta WorkDrive 'Contratos' (wd-1)
	R3  = "a4500000-0000-4000-a000-000000000003" // pasta iCloud 'Antiga', ARQUIVADA
	V1  = "a4600000-0000-4000-a000-000000000001" // R1 ↔ P1, leitura, pendente
	V2  = "a4600000-0000-4000-a000-000000000002" // R2 ↔ P2, edição, feito
	T1  = "a4700000-0000-4000-a000-000000000001" // termo da Ana
	L1  = "a4800000-0000-4000-a000-000000000001" // uma linha da trilha
	EQ1 = "a4900000-0000-4000-a000-000000000001" // time do tipo setor (5.1) apontando para S2
	B1  = "a4a00000-0000-4000-a000-000000000001" // bem do Patrimônio com o Bruno (P2): excluir o P2 zera pessoa_id (FK set null)
	F1  = "a4b00000-0000-4000-a000-000000000001" // carro da Frota com o Bruno (P2): idem

	telefoneDaAna = "11 90000-0001" // dado pessoal: aparece nas respostas de quem pode, nunca em log
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "acessos", ID: idAcessos, Email: "acessos@x.com", Papel: "viewer", Modulos: []string{"acessos"}},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin"},
	{Chave: "superFicha", ID: idSuperFicha, Email: "superficha@x.com", Papel: "viewer", Super: true},
	{Chave: "superEmail", ID: idSuperEmail, Email: "breno@rbvcompany.com", Papel: "viewer"},
	{Chave: "frota", ID: idFrota, Email: "frota@x.com", Papel: "viewer", Modulos: []string{"frota"}},
	{Chave: "patrimonio", ID: idPatrimonio, Email: "patrimonio@x.com", Papel: "viewer", Modulos: []string{"patrimonio"}},
	{Chave: "desativado", ID: idDesativado, Email: "desativado@x.com", Papel: "viewer", Desativado: true, Modulos: []string{"acessos"}},
	{Chave: "viewer", ID: idViewer, Email: "viewer@x.com", Papel: "viewer"},
}

// semAcessos: quem tem sessão e não pode ver nem gravar NADA do cadastro (o lado negado de toda rota).
// A conta desativada fica de fora: nem sessão ela tem (401), e a varredura da Task 7 confere isso.
var semAcessos = []string{"superFicha", "superEmail", "frota", "patrimonio", "viewer"}

// segredos: valores FALSOS plantados em acessos_conexoes. Em produção são o client_secret, o
// refresh_token e o oauth_state do Zoho e da Microsoft: nenhum pode aparecer em resposta nem em log.
var segredos = []string{
	"SEGREDO-cliente-zoho", "SEGREDO-refresh-zoho", "SEGREDO-estado-zoho",
	"SEGREDO-cliente-ms", "SEGREDO-refresh-ms",
}

// Sem identidade (p.Exec). Os SEGREDO-* de acessos_conexoes nunca podem aparecer em resposta nem em log.
const linhasDosAcessos = `
insert into acessos_organizacoes (id, nome, ordem) values ('` + O1 + `', 'Sede Centro', 1), ('` + O2 + `', 'Fábrica Conchal', 2);
insert into acessos_setores (id, nome, ordem, organizacao_id) values ('` + S1 + `', 'RH', 1, '` + O1 + `'), ('` + S2 + `', 'Comercial', 2, '` + O1 + `');
insert into patrimonio_empresas (id, nome) values ('` + EMP + `', 'Vessel');
insert into acessos_pessoas (id, nome, status, setor_id, organizacao_id, marca_id, profile_id, email_corporativo, numero_pessoal) values
  ('` + P1 + `', 'Ana Lima', 'ativo', '` + S1 + `', '` + O1 + `', '` + EMP + `', '` + idAcessos + `', 'ana@rbv.com', '` + telefoneDaAna + `'),
  ('` + P3 + `', 'Carla Dias', 'ativo', '` + S2 + `', '` + O1 + `', null, null, null, null);
insert into acessos_pessoas (id, nome, status, motivo_saida, data_fim_contrato)
  values ('` + P2 + `', 'Bruno Reis', 'desligado', 'Pediu demissão', '2026-09-30');
insert into acessos_recursos (id, tipo, provedor, nome, external_id, caminho, arquivado_em) values
  ('` + R1 + `', 'icloud', 'apple', 'Fotos da loja', null, null, null),
  ('` + R2 + `', 'workdrive', 'zoho', 'Contratos', 'wd-1', '/RBV/Contratos', null),
  ('` + R3 + `', 'icloud', 'apple', 'Antiga', null, null, '2026-07-16T00:00:00Z');
insert into acessos_vinculos (id, recurso_id, pessoa_id, papel, estado, criado_em) values
  ('` + V1 + `', '` + R1 + `', '` + P1 + `', 'leitura', 'pendente', '2026-10-01T10:00:00Z'),
  ('` + V2 + `', '` + R2 + `', '` + P2 + `', 'edicao', 'feito', '2026-10-02T10:00:00Z');
insert into acessos_termos (id, pessoa_id, titulo, arquivo_path) values ('` + T1 + `', '` + P1 + `', 'Termo do notebook', '` + P1 + `/1760000000000-termo.pdf');
insert into acessos_log (id, quem, acao, alvo) values ('` + L1 + `', '` + idAcessos + `', 'org.criar', 'org:Sede Centro');
insert into acessos_drive_marcas (nome, external_id) values ('RBV', 'od-raiz-1');
insert into acessos_drive_setores (chave, label) values ('c_marketing_1234', 'Marketing');
insert into acessos_drive_overrides (external_id, setor_chave) values ('od-pasta-1', 'c_marketing_1234');
insert into equipes (id, nome, tipo, setor_id) values ('` + EQ1 + `', 'Time Comercial', 'setor', '` + S2 + `');
insert into patrimonio_bens (id, numero, nome, pessoa_id, situacao) values ('` + B1 + `', 1, 'Notebook do Bruno', '` + P2 + `', 'em_uso');
insert into patrimonio_posse (bem_id, pessoa_id, pessoa_nome, de, ate) values ('` + B1 + `', '` + P2 + `', 'Bruno Reis', '2026-01-01', null);
insert into frota_veiculos (id, placa, nome, situacao, pessoa_id) values ('` + F1 + `', 'ABC1D23', 'Kwid', 'ativo', '` + P2 + `');
insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('` + F1 + `', '` + P2 + `', 'posse');
insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token, org_id, oauth_state) values
  ('zoho', 'cli-zoho', 'SEGREDO-cliente-zoho', 'SEGREDO-refresh-zoho', 'org-1', 'SEGREDO-estado-zoho'),
  ('microsoft', 'cli-ms', 'SEGREDO-cliente-ms', 'SEGREDO-refresh-ms', null, null);`

// fotoDosAcessos: um hash das 14 tabelas acessos_* (as sem rota inclusive: acessos_conexoes, drive,
// dispositivos, config, histórico), do setor dos times e do que excluir colaborador ou setor zera por
// FK (patrimônio e frota). Igual antes e depois = nada mudou. TestFotoDosAcessosCobreOQueAsRotasGravam
// confere que nenhuma tabela ligada às acessos_* fica de fora.
const fotoDosAcessos = `select md5(string_agg(l, '|' order by l)) from (
  select 'p:' || t::text as l from acessos_pessoas t union all
  select 'o:' || t::text from acessos_organizacoes t union all
  select 's:' || t::text from acessos_setores t union all
  select 'r:' || t::text from acessos_recursos t union all
  select 'v:' || t::text from acessos_vinculos t union all
  select 't:' || t::text from acessos_termos t union all
  select 'l:' || t::text from acessos_log t union all
  select 'd:' || t::text from acessos_dispositivos t union all
  select 'c:' || t::text from acessos_config t union all
  select 'h:' || t::text from acessos_patrimonio_historico t union all
  select 'dm:' || t::text from acessos_drive_marcas t union all
  select 'ds:' || t::text from acessos_drive_setores t union all
  select 'do:' || t::text from acessos_drive_overrides t union all
  select 'cx:' || t::text from acessos_conexoes t union all
  select 'bem:' || t::text from patrimonio_bens t union all
  select 'posse:' || t::text from patrimonio_posse t union all
  select 'carro:' || t::text from frota_veiculos t union all
  select 'uso:' || t::text from frota_uso t union all
  select 'eq:' || t.id || ':' || coalesce(t.setor_id::text, '-') from equipes t) z`

// segredoEm devolve o primeiro segredo plantado que aparece em s ("" = nenhum). Procura o valor exato
// e também o prefixo SEGREDO-, para pegar um segredo novo plantado e esquecido na lista.
func segredoEm(s string) string {
	for _, x := range segredos {
		if strings.Contains(s, x) {
			return x
		}
	}
	if i := strings.Index(s, "SEGREDO-"); i >= 0 {
		return s[i:min(len(s), i+24)]
	}
	return ""
}

// vigiado: o roteador do mundo com a vigia na frente. Mantém chi.Routes (a varredura da Task 7 anda
// pelas rotas com chi.Walk) e é o tipo que TestNovoMundoInstalaAVigia confere.
type vigiado struct {
	http.Handler
	rotas
}

// rotas: apelido de chi.Routes para embutir sem o campo se chamar "Routes" (o que esconderia o método).
type rotas = chi.Routes

// vigiarSegredos envolve h: toda resposta (corpo e TODOS os cabeçalhos) das requisições que passam pelo
// mundo vai por segredoEm; achou, chama falha. É o "nunca sai" das acessos_conexoes provado em cada
// requisição, não só nas que alguém lembrou de conferir. O log não é olhado aqui: o teste das conexões
// (Task 7) confere o log por conta própria.
func vigiarSegredos(h http.Handler, falha func(string, ...any)) vigiado {
	return vigiado{rotas: h.(chi.Routes), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, r)
		var tudo strings.Builder
		tudo.WriteString(rec.Body.String())
		for k, vs := range rec.Header() {
			tudo.WriteString("\n" + k + ": " + strings.Join(vs, ", "))
		}
		if x := segredoEm(tudo.String()); x != "" {
			falha("segredo %q saiu na resposta de %s %s", x, r.Method, r.URL.Path)
		}
		for k, v := range rec.Header() {
			w.Header()[k] = v
		}
		w.WriteHeader(rec.Code)
		_, _ = w.Write(rec.Body.Bytes())
	})}
}

// novoMundo: a fatia de produção, as pessoas e as linhas acima, uma sessão por pessoa (+ "impersonado":
// a sessão de `acessos` aberta pelo super pela ficha) e as rotas de `montar` atrás da MESMA cadeia do
// grupo de domínio de web.Rotas (auth.Exigir → autz.ComEscopo), vigiadas contra vazamento de segredo.
func novoMundo(t *testing.T, montar ...func(chi.Router, *pgxpool.Pool)) *mundoteste.Mundo {
	t.Helper()
	m := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhasDosAcessos,
		Impersonadas: map[string][2]string{"impersonado": {idAcessos, idSuperFicha}}}, montar...)
	m.H = vigiarSegredos(m.H, t.Errorf)
	return m
}

// comSessaoSemPerfil abre uma sessão para um usuário sem linha em profiles (a Task 7 a usa na varredura).
func comSessaoSemPerfil(t *testing.T, m *mundoteste.Mundo, chave, id string) {
	t.Helper()
	const sql = `insert into usuarios (id, email) values ($1::uuid, $2::text)`
	if _, err := m.P.Exec(t.Context(), sql, id, chave+"@x.com"); err != nil {
		t.Fatal(err)
	}
	tok, err := auth.NovoStore(m.P).Criar(t.Context(), id, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	m.Tok[chave] = tok
}
