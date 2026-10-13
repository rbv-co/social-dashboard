package fabrica

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var reObjetivo = regexp.MustCompile(`^[a-z_]{1,40}$`)

// Curadoria: POST /fabrica-looks e POST /fabrica-publicos. Portão (soFabricante, soSessaoPropria) na montagem.
type Curadoria struct{ Pool *pgxpool.Pool }

type pedidoLooks struct {
	Acao     string          `json:"acao"`
	Look     json.RawMessage `json:"look"`
	Ordem    []itemDeOrdem   `json:"ordem"`
	Chave    json.RawMessage `json:"chave"`
	Excluido json.RawMessage `json:"excluido"`
}

type itemDeOrdem struct {
	Chave json.RawMessage `json:"chave"`
	Ordem *int            `json:"ordem"`
}

type lookSalvar struct {
	Chave     json.RawMessage `json:"chave"`
	Nome      json.RawMessage `json:"nome"`
	Objetivos json.RawMessage `json:"objetivos"`
	Ativo     json.RawMessage `json:"ativo"`
}

func objetivosValidos(v json.RawMessage) ([]string, bool) {
	var l []string
	if !lista(v) || json.Unmarshal(v, &l) != nil || len(l) > 10 {
		return nil, false
	}
	for _, o := range l {
		if !reObjetivo.MatchString(o) {
			return nil, false
		}
	}
	return l, true
}

func (cu *Curadoria) Looks(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoLooks
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	ctx := r.Context()
	var resposta any = map[string]bool{"ok": true}
	var corpoRuim string
	trabalho := func(tx pgx.Tx) error { return nil }
	switch c.Acao {
	case "salvar":
		var l lookSalvar
		if len(c.Look) == 0 || nulo(c.Look) || json.Unmarshal(c.Look, &l) != nil || !objeto(c.Look) {
			corpoRuim = "look é um objeto."
			break
		}
		if len(l.Chave) == 0 || nulo(l.Chave) || string(l.Chave) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "chave_obrigatoria"})
			return
		}
		chave, _ := texto(l.Chave)
		objetivos, objOK := objetivosValidos(l.Objetivos)
		switch {
		case !reChaveLook.MatchString(chave):
			corpoRuim = "chave de look inválida."
		case l.Nome != nil && !textoAte(l.Nome, 120, false):
			corpoRuim = "nome tem de 1 a 120 caracteres."
		case l.Objetivos != nil && !objOK:
			corpoRuim = "objetivos é uma lista de até 10 chaves de objetivo."
		case l.Ativo != nil && !booleano(l.Ativo):
			corpoRuim = "ativo é verdadeiro ou falso."
		case l.Nome == nil && l.Objetivos == nil && l.Ativo == nil:
			corpoRuim = "Nada para gravar."
		}
		nome, _ := texto(l.Nome)
		ativo := string(l.Ativo) == "true"
		trabalho = func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `update fabrica_looks set
				nome = case when @tem_nome::boolean then @nome::text else nome end,
				objetivos = case when @tem_objetivos::boolean then @objetivos::text[] else objetivos end,
				ativo = case when @tem_ativo::boolean then @ativo::boolean else ativo end
				where chave = @chave::text`,
				pgx.NamedArgs{"tem_nome": l.Nome != nil, "nome": nome, "tem_objetivos": l.Objetivos != nil,
					"objetivos": objetivos, "tem_ativo": l.Ativo != nil, "ativo": ativo, "chave": chave})
			return err
		}
	case "ordenar":
		if len(c.Ordem) > 200 {
			corpoRuim = "No máximo 200 looks."
			break
		}
		for _, o := range c.Ordem {
			if len(o.Chave) > 0 && !nulo(o.Chave) && !casa(o.Chave, reChaveLook) {
				corpoRuim = "chave de look inválida."
			}
		}
		trabalho = func(tx pgx.Tx) error {
			for _, o := range c.Ordem {
				if len(o.Chave) == 0 || nulo(o.Chave) {
					continue // a edge pulava o item sem chave
				}
				chave, _ := texto(o.Chave)
				ordem := 0
				if o.Ordem != nil {
					ordem = *o.Ordem
				}
				if _, err := tx.Exec(ctx, `update fabrica_looks set ordem = $1::int where chave = $2::text`, ordem, chave); err != nil {
					return err
				}
			}
			return nil
		}
	case "excluir":
		if len(c.Chave) == 0 || nulo(c.Chave) || string(c.Chave) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "chave_obrigatoria"})
			return
		}
		chave, _ := texto(c.Chave)
		if !reChaveLook.MatchString(chave) {
			corpoRuim = "chave de look inválida."
		}
		excluido := string(c.Excluido) != "false"
		resposta = map[string]bool{"ok": true, "excluido": excluido}
		trabalho = func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `update fabrica_looks set excluido = $1::boolean where chave = $2::text`, excluido, chave)
			return err
		}
	default: // "sync" inclusive: ninguém chama (Ruling 5.8-12)
		responder(w, http.StatusBadRequest, map[string]string{"error": "acao_invalida"})
		return
	}
	if corpoRuim != "" {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", corpoRuim)
		return
	}
	if err := banco.ComUsuario(ctx, cu.Pool, e.ID, trabalho); err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	responder(w, http.StatusOK, resposta)
}

type pedidoPublicos struct {
	Acao   string          `json:"acao"`
	ID     json.RawMessage `json:"id"`
	Preset json.RawMessage `json:"preset"`
}

type preset struct {
	ID              json.RawMessage `json:"id"`
	Nome            json.RawMessage `json:"nome"`
	MarcaID         json.RawMessage `json:"marca_id"`
	Geo             json.RawMessage `json:"geo"`
	IdadeMin        json.RawMessage `json:"idade_min"`
	IdadeMax        json.RawMessage `json:"idade_max"`
	Generos         json.RawMessage `json:"generos"`
	Interesses      json.RawMessage `json:"interesses"`
	CustomAudiences json.RawMessage `json:"custom_audiences"`
}

// ou: o valor do pedido, ou o padrão da edge quando ausente/null (`p.x ?? padrão`).
func ou(v json.RawMessage, padrao string) string {
	if len(v) == 0 || nulo(v) {
		return padrao
	}
	return string(v)
}

func (p preset) validar() string {
	idade := func(v json.RawMessage, padrao int) (int, bool) {
		if len(v) == 0 || nulo(v) {
			return padrao, true
		}
		var n int
		return n, json.Unmarshal(v, &n) == nil && n >= 13 && n <= 65
	}
	min, okMin := idade(p.IdadeMin, 18)
	max, okMax := idade(p.IdadeMax, 65)
	var generos []int
	switch {
	case !textoAte(p.Nome, 120, false):
		return "nome tem de 1 a 120 caracteres."
	case len(p.ID) > 0 && !nulo(p.ID) && !casa(p.ID, reUUID):
		return "id é o id do público."
	case len(p.MarcaID) > 0 && !nulo(p.MarcaID) && !casa(p.MarcaID, reUUID):
		return "marca_id é o id da marca."
	case len(p.Geo) > 0 && !nulo(p.Geo) && !objeto(p.Geo):
		return "geo é um objeto."
	case !okMin || !okMax || min > max:
		return "idades são inteiros de 13 a 65, a mínima até a máxima."
	case len(p.Generos) > 0 && !nulo(p.Generos) && (json.Unmarshal(p.Generos, &generos) != nil ||
		slices.ContainsFunc(generos, func(g int) bool { return g != 1 && g != 2 })):
		return "generos é uma lista de 1 e 2."
	case len(p.Interesses) > 0 && !nulo(p.Interesses) && !lista(p.Interesses):
		return "interesses é uma lista."
	case len(p.CustomAudiences) > 0 && !nulo(p.CustomAudiences) && !lista(p.CustomAudiences):
		return "custom_audiences é uma lista."
	}
	return ""
}

func (cu *Curadoria) Publicos(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoPublicos
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	ctx := r.Context()
	switch c.Acao {
	case "apagar":
		if len(c.ID) == 0 || nulo(c.ID) || string(c.ID) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "id_obrigatorio"})
			return
		}
		if !casa(c.ID, reUUID) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "id é o id do público.")
			return
		}
		id, _ := texto(c.ID)
		err := banco.ComUsuario(ctx, cu.Pool, e.ID, func(tx pgx.Tx) error {
			_, err := tx.Exec(ctx, `delete from fabrica_publicos where id = $1::uuid`, id)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]bool{"ok": true})
	case "salvar":
		var p preset
		if len(c.Preset) == 0 || nulo(c.Preset) || !objeto(c.Preset) || json.Unmarshal(c.Preset, &p) != nil {
			responder(w, http.StatusBadRequest, map[string]string{"error": "nome_obrigatorio"})
			return
		}
		if len(p.Nome) == 0 || nulo(p.Nome) || string(p.Nome) == `""` {
			responder(w, http.StatusBadRequest, map[string]string{"error": "nome_obrigatorio"})
			return
		}
		if motivo := p.validar(); motivo != "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", motivo)
			return
		}
		args := pgx.NamedArgs{"nome": ou(p.Nome, "null"), "marca": ou(p.MarcaID, "null"), "geo": ou(p.Geo, "{}"),
			"idade_min": ou(p.IdadeMin, "18"), "idade_max": ou(p.IdadeMax, "65"), "generos": ou(p.Generos, "[]"),
			"interesses": ou(p.Interesses, "[]"), "audiences": ou(p.CustomAudiences, "[]"), "quem": e.ID, "id": ou(p.ID, "null")}
		var id string
		err := banco.ComUsuario(ctx, cu.Pool, e.ID, func(tx pgx.Tx) error {
			// os valores entram como JSON e o Postgres converte pelo tipo da coluna (#>> '{}' tira as aspas)
			const valores = `(@nome::jsonb #>> '{}'), (@marca::jsonb #>> '{}')::uuid, @geo::jsonb,
				(@idade_min::jsonb #>> '{}')::int, (@idade_max::jsonb #>> '{}')::int,
				array(select jsonb_array_elements_text(@generos::jsonb)::int), @interesses::jsonb, @audiences::jsonb, @quem::uuid`
			if len(p.ID) == 0 || nulo(p.ID) {
				return tx.QueryRow(ctx, `insert into fabrica_publicos (nome, marca_id, geo, idade_min, idade_max, generos,
					interesses, custom_audiences, criado_por) values (`+valores+`) returning id::text`, args).Scan(&id)
			}
			err := tx.QueryRow(ctx, `update fabrica_publicos set (nome, marca_id, geo, idade_min, idade_max, generos,
				interesses, custom_audiences, criado_por) = (`+valores+`) where id = (@id::jsonb #>> '{}')::uuid
				returning id::text`, args).Scan(&id)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]string{"id": id})
	default:
		responder(w, http.StatusBadRequest, map[string]string{"error": "acao_invalida"})
	}
}
