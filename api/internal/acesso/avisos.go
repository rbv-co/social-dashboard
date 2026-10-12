package acesso

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

// Avisos: preferências por tipo e inscrição de push. Preferência: a própria OU perfil admin/super pela
// ficha (push_pref_*). Inscrição: só do dono da linha (push_subs_dono_*). O endpoint e as chaves
// (p256dh, auth) são segredo: nunca vão para log nem para a resposta. A inscrição usa a MESMA regra do
// envio (webpush.EndpointAceito e ChavesAceitas); o SSRF por nome que resolve para rede interna é barrado
// no ENVIO (Control do discador).

const colunasPreferencia = `t.user_id, t.tipo, t.ativo, t.alterado_em, t.alterado_por`

// GET /avisos/preferencias. Sem ?ordem: a chave é composta, só o padrão t.user_id + t.tipo é único.
var consultaPreferencias = dados.Consulta{Tabela: "push_preferencias", Alias: "t",
	SQL:     `select ` + colunasPreferencia + ` from push_preferencias t`,
	Filtros: []dados.Filtro{{Param: "user_id", SQL: "t.user_id = @user_id::uuid", Tipo: "uuid"}},
	Ordens:  map[string]string{}, OrdemPadrao: "t.user_id", Desempate: "t.tipo"}

// uuidCanonico: só a forma 8-4-4-4-12. O Postgres também lê sem hífens e entre chaves, e aí o par
// (user_id, tipo) repetido passaria pela checagem de duplicata e daria 21000 (500) no upsert.
var uuidCanonico = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

type preferencia struct {
	UserID string `json:"user_id"`
	Tipo   string `json:"tipo"`
	Ativo  *bool  `json:"ativo"`
}

// gravarPreferencias: POST /avisos/preferencias, lote de 1 a 20. Toda linha passa no WITH CHECK de
// push_pref_escrita ANTES de gravar qualquer uma (tudo-ou-nada). alterado_em/alterado_por vêm da sessão.
func gravarPreferencias(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var linhas []preferencia
		if !dados.LerCorpo(w, r, &linhas) { // o decoder recusa campo desconhecido em cada item
			return
		}
		if len(linhas) == 0 || len(linhas) > 20 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 20 preferências.")
			return
		}
		vistas := map[string]bool{}
		for _, l := range linhas {
			k := strings.ToLower(l.UserID) + "|" + l.Tipo
			if l.Ativo == nil || !uuidCanonico.MatchString(l.UserID) || vistas[k] {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Cada preferência precisa de user_id (uuid), ativo e aparece uma vez só.")
				return
			}
			vistas[k] = true
		}
		j, err := json.Marshal(linhas)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			for _, l := range linhas {
				// ponytail: PodeCriar basta enquanto a policy ler só user_id, que está na chave do conflito (Ruling 5.1-10)
				if err := autz.Producao.PodeCriar(r.Context(), tx, e, "push_preferencias",
					map[string]any{"user_id": l.UserID, "tipo": l.Tipo, "ativo": *l.Ativo}); err != nil {
					return err
				}
			}
			_, err := tx.Exec(r.Context(), `insert into push_preferencias (user_id, tipo, ativo, alterado_em, alterado_por)
				select x.user_id, x.tipo, x.ativo, now(), @eu::uuid
				  from jsonb_to_recordset(@linhas::jsonb) as x(user_id uuid, tipo text, ativo boolean)
				on conflict (user_id, tipo) do update
				  set ativo = excluded.ativo, alterado_em = excluded.alterado_em, alterado_por = excluded.alterado_por`,
				pgx.NamedArgs{"eu": e.ID, "linhas": string(j)})
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

type inscricao struct {
	Endpoint string `json:"endpoint"`
	P256dh   string `json:"p256dh"`
	Auth     string `json:"auth"`
}

// inscrever: POST /eu/push/inscrever. Upsert pelo endpoint, SEMPRE no nome de quem está logado; se o
// endpoint já é de outra pessoa o `where` do conflito não casa, nada muda e a resposta é 403.
func inscrever(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in inscricao
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		u, err := url.Parse(in.Endpoint)
		if err != nil || len(in.Endpoint) > 2048 || !webpush.EndpointAceito(u) || !webpush.ChavesAceitas(in.P256dh, in.Auth) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Inscrição de push inválida.")
			return
		}
		var corpo []byte
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			if err := autz.Producao.PodeCriar(r.Context(), tx, e, "push_subs", map[string]any{"user_id": e.ID}); err != nil {
				return err
			}
			fl, err := autz.Producao.Filtro(e, "push_subs", autz.Ler, "push_subs")
			if err != nil {
				return err
			}
			fe, err := autz.Producao.Filtro(e, "push_subs", autz.Editar, "push_subs")
			if err != nil {
				return err
			}
			err = tx.QueryRow(r.Context(), `with n as (insert into push_subs (endpoint, p256dh, auth, user_id)
				values (@endpoint::text, @p256dh::text, @auth::text, @eu::uuid)
				on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
				  where (`+fl.SQL+`) and (`+fe.SQL+`)
				returning id) select row_to_json(n) from n`,
				fe.Juntar(fl.Juntar(pgx.NamedArgs{"endpoint": in.Endpoint, "p256dh": in.P256dh, "auth": in.Auth, "eu": e.ID}))).Scan(&corpo)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNegado // o endpoint é de outra pessoa: a linha dela fica como estava
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

type desinscricao struct {
	Endpoint string `json:"endpoint"`
}

// desinscrever: POST /eu/push/desinscrever {endpoint}. Idempotente: apaga só a própria (regra de Ler
// e de Apagar do catálogo no WHERE) e responde 204 mesmo sem linha, como o delete de hoje.
func desinscrever(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in desinscricao
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if in.Endpoint == "" || len(in.Endpoint) > 2048 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Informe o endpoint.")
			return
		}
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			fl, err := autz.Producao.Filtro(e, "push_subs", autz.Ler, "push_subs")
			if err != nil {
				return err
			}
			fa, err := autz.Producao.Filtro(e, "push_subs", autz.Apagar, "push_subs")
			if err != nil {
				return err
			}
			_, err = tx.Exec(r.Context(), `delete from push_subs where endpoint = @endpoint::text and (`+fl.SQL+`) and (`+fa.SQL+`)`,
				fa.Juntar(fl.Juntar(pgx.NamedArgs{"endpoint": in.Endpoint})))
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// montarAvisos: GET/POST /avisos/preferencias; POST /eu/push/inscrever e /eu/push/desinscrever.
// Monte DEPOIS de auth.Exigir e autz.ComEscopo. Toda escrita passa por soSessaoPropria.
func montarAvisos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaPreferencias.Validar(autz.Producao))
	r.Get("/avisos/preferencias", consultaPreferencias.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/avisos/preferencias", gravarPreferencias(p))
	r.With(soSessaoPropria).Post("/eu/push/inscrever", inscrever(p))
	r.With(soSessaoPropria).Post("/eu/push/desinscrever", desinscrever(p))
}
