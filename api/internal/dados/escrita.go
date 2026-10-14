package dados

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"reflect"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabela é o caminho de ESCRITA declarado de uma tabela do catálogo. Nome, Resposta e Autor são
// texto FIXO da rota; o pedido só escolhe VALORES das colunas que a struct do corpo declara.
type Tabela struct {
	Nome     string // tabela do catálogo (ex.: "equipes")
	Resposta string // colunas devolvidas, sobre o alias t: a MESMA lista da leitura (ex.: "t.id, t.nome")
	Autor    string // coluna que recebe quem grava, na criação (ex.: "criado_por"); vazia = nenhuma

	// CriarSoLegivel: a linha criada tem de passar também na regra de LER de quem cria (o que a
	// pessoa grava ela tem de conseguir ver; Ruling 5.2-2). Senão — e também quando uma referência
	// (FK) não existe, para não denunciar o que existe fora do alcance dela — ErrNegado (403) e a
	// transação é desfeita.
	//
	// LIMITE: "FK inexistente = invisível" só vale para a FK cujo alvo a regra de Ler restringe (ela
	// decide a visibilidade da linha nova: existente-mas-invisível e inexistente dão o mesmo 403). Uma
	// SEGUNDA FK fora da regra de Ler (ex.: patrimonio_bens.pessoa_id → acessos_pessoas, Ruling 5.2-17)
	// responde 201 se o alvo existe e 403 se não existe: quem cria descobre se um uuid existe. Aceito
	// onde o uuid já é visível por outro caminho (pessoas_para_escolher()); senão, valide a FK à parte.
	//
	// LIMITE 2: a conferência (e o `devolver`) roda sobre o RETURNING do INSERT, isto é, depois dos
	// gatilhos BEFORE e ANTES dos AFTER. Um gatilho AFTER INSERT que tire a linha do alcance de quem criou
	// passa (201 com a linha como gravada pelo INSERT). Nenhuma tabela do 5.2 tem AFTER INSERT; tabela
	// que tiver tem de conferir de novo depois do comando (releia a linha na mesma transação).
	CriarSoLegivel bool

	// Conferir (opcional): a regra que o catálogo NÃO enxerga — a linha-mãe visível, a linha nova legível, um
	// caminho preso à mãe. Roda na MESMA transação, DEPOIS do PodeCriar/PodeEditar/PodeApagar (a linha já
	// está travada e sabidamente visível: id invisível responde 404 antes, sem oráculo) e ANTES do SQL que
	// grava. id = "" na criação; campos = nil no apagar; na criação os campos já trazem a coluna Autor.
	// autz.ErrNegado = 403, autz.ErrNaoEncontrado = 404; outro erro segue ErroDeEscrita. campos é SÓ LEITURA: o gancho não deve alterar o mapa (o que ele mudasse
	// iria ao SQL sem o PodeX). Plano 5.9 (Ruling 5.9-4).
	Conferir func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error

	// Chave: a coluna que acha a linha em Editar/Apagar/Gravar (o {id} da URL é o valor dela) e que vai
	// no {"<chave>": …} quando quem grava não lê. Vazia = "id" (Ruling 5.5-2).
	Chave string
}

func (t Tabela) chave() string {
	if t.Chave == "" {
		return "id"
	}
	return t.Chave
}

var reColuna = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// ErrSemCampos: o corpo não trouxe coluna nenhuma.
var ErrSemCampos = errors.New("dados: nada para gravar")

// ErrColunaProibida: o corpo trouxe a coluna de autoria (Tabela.Autor) ou o id; ambos vêm da sessão
// e da rota, nunca do corpo.
var ErrColunaProibida = errors.New("dados: coluna que o corpo não pode trazer")

// Validar confere a declaração na montagem (erro = a API não sobe).
func (t Tabela) Validar(cat *autz.Catalogo) error {
	switch {
	case !cat.Tem(t.Nome):
		return fmt.Errorf("tabela %q fora do catálogo", t.Nome)
	case strings.TrimSpace(t.Resposta) == "":
		return fmt.Errorf("tabela %s: Resposta obrigatória", t.Nome)
	case t.Autor != "" && !reColuna.MatchString(t.Autor):
		return fmt.Errorf("tabela %s: Autor %q inválido", t.Nome, t.Autor)
	case t.Chave != "" && !reColuna.MatchString(t.Chave):
		return fmt.Errorf("tabela %s: Chave %q inválida", t.Nome, t.Chave)
	}
	return nil
}

// Campos devolve as colunas PRESENTES no corpo já lido. O corpo é uma struct de json.RawMessage
// com `json:"<coluna>,omitempty"`: chave ausente fica fora (não muda); `null` explícito entra (grava
// nulo). O tipo de cada valor é o Postgres que confere: jsonb_populate_record faz o cast pelo tipo
// da coluna (valor que não converte = 22P02 = 400).
func Campos(corpo any) (map[string]any, error) {
	j, err := json.Marshal(corpo)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(j, &m); err != nil {
		return nil, err
	}
	campos := make(map[string]any, len(m))
	for k, v := range m {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida na struct do corpo", k)
		}
		campos[k] = v
	}
	return campos, nil
}

// recusarReservadas: o corpo nunca escolhe a chave (`id`: o PATCH /…/{id} não muda a identidade do
// recurso e o POST não escolhe o id) nem a coluna de autoria (vem da sessão). Recusa, não ignora:
// mandar autoria no corpo é erro do cliente (400), não algo a corrigir em silêncio.
func (t Tabela) recusarReservadas(campos map[string]any) error {
	for k := range campos {
		if k == "id" || (t.Autor != "" && strings.EqualFold(k, t.Autor)) {
			return fmt.Errorf("%w: %q", ErrColunaProibida, k)
		}
	}
	return nil
}

// colunas: as chaves em ordem (SQL determinístico), conferidas e citadas.
func colunas(campos map[string]any) ([]string, error) {
	if len(campos) == 0 {
		return nil, ErrSemCampos
	}
	ks := make([]string, 0, len(campos))
	for k := range campos {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida", k)
		}
		ks = append(ks, k)
	}
	slices.Sort(ks)
	for i, k := range ks {
		ks[i] = pgx.Identifier{k}.Sanitize()
	}
	return ks, nil
}

// Criar confere a linha nova (WITH CHECK de insert), grava SÓ as colunas presentes e devolve a linha.
// Rode dentro de banco.ComUsuario.
func (t Tabela) Criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
	return t.criar(ctx, tx, cat, e, campos, "")
}

// criar: Criar com um sufixo FIXO antes do returning (Gravar usa ` on conflict (<chave>) do nothing`).
func (t Tabela) criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any, seConflito string) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if err := t.recusarReservadas(campos); err != nil {
		return nil, err
	}
	if t.Autor != "" {
		campos = maps.Clone(campos) // não muda o mapa de quem chamou
		campos[t.Autor] = e.ID      // autoria vem da sessão, nunca do corpo
	}
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeCriar(ctx, tx, e, t.Nome, campos); err != nil {
		return nil, err
	}
	if err := t.conferir(ctx, tx, e, "", campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	tab, lista := pgx.Identifier{t.Nome}.Sanitize(), strings.Join(cols, ", ")
	linha, err := t.devolver(ctx, tx, cat, e, `insert into `+tab+` (`+lista+`) select `+lista+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb)`+seConflito+` returning *`,
		pgx.NamedArgs{"dados_campos": string(j)}, t.CriarSoLegivel)
	var pe *pgconn.PgError
	if t.CriarSoLegivel && errors.As(err, &pe) && pe.Code == "23503" {
		return nil, autz.ErrNegado // referência inexistente responde igual à invisível (sem oráculo)
	}
	return linha, err
}

// Editar confere (autz.PodeEditar trava a linha; Ler + USING na antiga; WITH CHECK na nova), muda SÓ
// as colunas presentes e devolve a linha. Rode dentro de banco.ComUsuario.
func (t Tabela) Editar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string, campos map[string]any) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if err := t.recusarReservadas(campos); err != nil {
		return nil, err
	}
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeEditarPor(ctx, tx, e, t.Nome, t.chave(), id, campos); err != nil {
		return nil, err
	}
	if err := t.conferir(ctx, tx, e, id, campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	sets := make([]string, len(cols))
	for i, c := range cols {
		sets[i] = c + " = dados_r." + c
	}
	tab := pgx.Identifier{t.Nome}.Sanitize()
	return t.devolver(ctx, tx, cat, e, `update `+tab+` as dados_alvo set `+strings.Join(sets, ", ")+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) as dados_r`+
		` where dados_alvo.`+pgx.Identifier{t.chave()}.Sanitize()+` = @dados_id returning dados_alvo.*`,
		pgx.NamedArgs{"dados_campos": string(j), "dados_id": id}, false)
}

// Apagar confere (autz.PodeApagar trava a linha; Ler + USING de delete) e apaga.
func (t Tabela) Apagar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string) error {
	if e == nil {
		return autz.ErrNegado
	}
	if err := cat.PodeApagarPor(ctx, tx, e, t.Nome, t.chave(), id); err != nil {
		return err
	}
	if err := t.conferir(ctx, tx, e, id, nil); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from `+pgx.Identifier{t.Nome}.Sanitize()+` where `+pgx.Identifier{t.chave()}.Sanitize()+` = @dados_id`,
		pgx.NamedArgs{"dados_id": id})
	return err
}

// Gravar é o `.upsert(…, {onConflict: <chave>})` das telas, sem corrida (Ruling 5.5-3): se a linha existe
// e quem pede a lê, Editar (PodeEditarPor trava a linha: USING na antiga, WITH CHECK na nova; só as
// colunas presentes além da chave); se não existe, Criar com `on conflict (<chave>) do nothing`
// (PodeCriar antes) e, se outra transação a criou entre um passo e outro, Editar de novo. Existe e não
// se lê = ErrNaoEncontrado (404, sem oráculo). A chave TEM de vir em campos e nunca muda. Rode dentro
// de banco.ComUsuario.
func (t Tabela) Gravar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
	k := t.chave()
	if t.CriarSoLegivel || k == "id" {
		return nil, autz.ErrDeclaracao // o "do nothing" responderia ErrNegado; e Criar recusa o `id` no corpo
	}
	valor, err := textoDaChave(campos[k])
	if err != nil {
		return nil, fmt.Errorf("dados: %s.%s: %w", t.Nome, k, err)
	}
	mudancas := maps.Clone(campos)
	delete(mudancas, k)
	if len(mudancas) == 0 {
		return nil, ErrSemCampos
	}
	linha, err := t.Editar(ctx, tx, cat, e, valor, mudancas)
	if !errors.Is(err, autz.ErrNaoEncontrado) {
		return linha, err
	}
	linha, err = t.criar(ctx, tx, cat, e, maps.Clone(campos), ` on conflict (`+pgx.Identifier{k}.Sanitize()+`) do nothing`)
	if !errors.Is(err, autz.ErrNaoEncontrado) {
		return linha, err // criou; ou PodeCriar negou (403, que não depende de a linha existir)
	}
	return t.Editar(ctx, tx, cat, e, valor, mudancas) // outra transação criou no meio; ou existe e não se lê: 404
}

// textoDaChave: o valor da chave como texto (PodeEditarPor o põe no tipo da coluna). Vem do corpo
// (json.RawMessage: número ou texto JSON) ou da rota (string).
func textoDaChave(v any) (string, error) {
	switch x := v.(type) {
	case string:
		return x, nil
	case json.RawMessage:
		d := json.NewDecoder(bytes.NewReader(x))
		d.UseNumber()
		var y any
		if d.Decode(&y) == nil {
			switch z := y.(type) {
			case string:
				return z, nil
			case json.Number:
				return z.String(), nil
			}
		}
	}
	return "", errors.New("chave ausente ou não é número/texto")
}

// conferir roda Tabela.Conferir, se houver.
func (t Tabela) conferir(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if t.Conferir == nil {
		return nil
	}
	return t.Conferir(ctx, tx, e, id, campos)
}

// devolver roda a escrita como CTE e responde a linha pela lista Resposta se quem pede a lê DEPOIS
// de gravada (regra de Ler do catálogo sobre a linha nova); senão {"id": …} (contrato II.2) — ou,
// com soLegivel, ErrNegado: a transação de banco.ComUsuario é desfeita e nada fica gravado.
func (t Tabela) devolver(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, escrita string, args pgx.NamedArgs, soLegivel bool) ([]byte, error) {
	f, err := cat.Filtro(e, t.Nome, autz.Ler, "t")
	if err != nil {
		return nil, err
	}
	seNaoLe := `(select row_to_json(y) from (select t.` + pgx.Identifier{t.chave()}.Sanitize() + ` from t) y)`
	if soLegivel {
		seNaoLe = `null::json`
	}
	var corpo []byte
	// row_to_json e não json_build_object: este escreve {"id" : …} com espaços; o PostgREST, compacto
	err = tx.QueryRow(ctx, `with t as (`+escrita+`) select coalesce(
		(select row_to_json(x) from (select `+t.Resposta+` from t where `+f.SQL+`) x), `+seNaoLe+`)`, f.Juntar(args)).Scan(&corpo)
	if err != nil {
		return nil, err
	}
	if corpo == nil {
		if soLegivel {
			return nil, autz.ErrNegado
		}
		return nil, autz.ErrNaoEncontrado
	}
	return corpo, nil
}

// colunasDoCorpo confere na MONTAGEM a struct C do corpo e devolve as colunas que ela declara.
// Regra mínima: todo campo exportado é json.RawMessage com `json:"<coluna>,omitempty"` (sem
// embutidas). Só assim "ausente" fica fora do UPDATE e `null` explícito grava nulo: um `string`
// sem omitempty gravaria "" em todo PATCH, e um `*string` perderia o null explícito. Validação de
// valor é do banco (cast pelo tipo da coluna) e do método Validar() de C.
func colunasDoCorpo[C any]() ([]string, error) {
	rt := reflect.TypeFor[C]()
	if rt.Kind() != reflect.Struct {
		return nil, fmt.Errorf("corpo %s não é struct", rt)
	}
	var cols []string
	for i := range rt.NumField() {
		f := rt.Field(i)
		if f.Anonymous {
			return nil, fmt.Errorf("corpo %s: campo embutido %s não é permitido", rt, f.Name)
		}
		if !f.IsExported() {
			continue
		}
		tag := f.Tag.Get("json")
		if tag == "-" {
			continue
		}
		nome, opcao, _ := strings.Cut(tag, ",")
		switch {
		case f.Type != reflect.TypeFor[json.RawMessage]():
			return nil, fmt.Errorf("corpo %s: campo %s tem de ser json.RawMessage (ausente ≠ null)", rt, f.Name)
		case !reColuna.MatchString(nome) || opcao != "omitempty":
			return nil, fmt.Errorf("corpo %s: campo %s tem de ter a tag `json:\"<coluna>,omitempty\"`", rt, f.Name)
		}
		cols = append(cols, nome)
	}
	return cols, nil
}

// montar: declaração inválida derruba a montagem (panic), como Consulta.Handler: rota de escrita
// com tabela ou corpo inválidos nunca entra no ar.
func montar[C any](cat *autz.Catalogo, t Tabela) []string {
	if err := t.Validar(cat); err != nil {
		panic(err)
	}
	cols, err := colunasDoCorpo[C]()
	if err != nil {
		panic(fmt.Errorf("%w: %v", ErrDeclaracao, err))
	}
	return cols
}

// lerCampos lê o corpo C, roda C.Validar() se existir e devolve as colunas presentes. Já respondeu
// quando devolve false.
func lerCampos[C any](w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var c C
	if !LerCorpo(w, r, &c) {
		return nil, false
	}
	if v, ok := any(&c).(interface{ Validar() error }); ok {
		if err := v.Validar(); err != nil {
			Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return nil, false
		}
	}
	campos, err := Campos(&c)
	if err != nil { // tag de struct inválida: defeito da rota, não do pedido
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, false
	}
	if len(campos) == 0 {
		Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
		return nil, false
	}
	return campos, true
}

// escopoOuErro: rota de escrita montada fora de autz.ComEscopo é defeito de montagem: 500, nada gravado.
func escopoOuErro(w http.ResponseWriter, r *http.Request) *autz.Escopo {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
	return e
}

// regraTemSuasColunas: coluna que a regra de criar lê, que a struct do corpo declara e que o
// pedido deixou de mandar é erro do PEDIDO (400 "Informe …"), não 500 com log a cada tentativa.
// Coluna que a struct nem declara continua defeito da rota: autz.PodeCriar responde ErrDeclaracao.
func (t Tabela) regraTemSuasColunas(w http.ResponseWriter, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any, declaradas []string) bool {
	f, err := cat.Filtro(e, t.Nome, autz.Criar, "autz_nova")
	if err != nil {
		ErroDeEscrita(w, err)
		return false
	}
	for _, col := range autz.ColunasDaLinhaNova(f) {
		if _, tem := campos[col]; !tem && col != t.Autor && slices.Contains(declaradas, col) {
			Erro(w, http.StatusBadRequest, "pedido_invalido", "Informe "+col+".")
			return false
		}
	}
	return true
}

// RotaCriar: POST que lê o corpo C (struct de json.RawMessage), confere e grava em banco.ComUsuario.
func RotaCriar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	declaradas := montar[C](cat, t)
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		if !t.regraTemSuasColunas(w, cat, e, campos, declaradas) {
			return
		}
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Criar(r.Context(), tx, cat, e, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusCreated, linha)
	}
}

// RotaEditar: PATCH /…/{id} com o corpo C.
func RotaEditar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	montar[C](cat, t)
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Editar(r.Context(), tx, cat, e, id, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusOK, linha)
	}
}

// RotaApagar: DELETE /…/{id}.
func RotaApagar(p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	if err := t.Validar(cat); err != nil {
		panic(err)
	}
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		id := chi.URLParam(r, "id")
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			return t.Apagar(r.Context(), tx, cat, e, id)
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Responder escreve um corpo JSON já montado (pelo Postgres) com o status.
func Responder(w http.ResponseWriter, status int, corpo []byte) { escrever(w, status, corpo) }
