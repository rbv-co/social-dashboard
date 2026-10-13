package patrimonio

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Configuração e log do Patrimônio. Regra de produção: patrimonio_config_rw (is_patrimonio_admin, só de
// ator: a configuração é da empresa, sem escopo por time) e patrimonio_log_insert (is_patrimonio_admin).
// O log não tem leitura (nenhuma tela lê; Ruling 5.2-8).

var consultaConfig = dados.Consulta{Tabela: "patrimonio_config", Alias: "t",
	SQL: `select t.chave, t.valor, t.atualizado_em from patrimonio_config t`, OrdemPadrao: "t.chave", Desempate: "t.chave"}

// formatosDeConfig: as chaves que a tela grava e o formato do valor (lista fechada, Ruling 5.2-10).
var formatosDeConfig = map[string]*regexp.Regexp{
	"numero_maximo": regexp.MustCompile(`^[1-9][0-9]{0,5}$`), // tela-de-patrimonio.vue:1735-1737
}

// gravarConfig: PUT /patrimonio/config/{chave} {valor}. Upsert pela chave (a tela fazia .upsert), com a
// regra do PostgREST sob a RLS escrita à mão e na MESMA tx de ComUsuario: a linha nova passa no WITH CHECK
// de criar e na regra de ler/editar sobre ela; a que já existe só muda se quem pede a lê e a edita.
func gravarConfig(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		chave := chi.URLParam(r, "chave")
		formato, ok := formatosDeConfig[chave]
		if !ok {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Valor string `json:"valor"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !formato.MatchString(in.Valor) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "A numeração vai de 1 a 999999.")
			return
		}
		ctx := r.Context()
		var corpo []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			linha := map[string]any{"chave": chave, "valor": in.Valor}
			if err := autz.Producao.PodeCriar(ctx, tx, e, "patrimonio_config", linha); err != nil {
				return err
			}
			fn, err := autz.Producao.Filtro(e, "patrimonio_config", autz.EditarNova, "autz_nova")
			if err != nil {
				return err
			}
			if ok, err := autz.Conferir(ctx, tx, fn, "patrimonio_config", linha); err != nil || !ok {
				if err == nil {
					err = autz.ErrNegado
				}
				return err
			}
			fl, err := autz.Producao.Filtro(e, "patrimonio_config", autz.Ler, "patrimonio_config")
			if err != nil {
				return err
			}
			fe, err := autz.Producao.Filtro(e, "patrimonio_config", autz.Editar, "patrimonio_config")
			if err != nil {
				return err
			}
			err = tx.QueryRow(ctx, `with n as (insert into patrimonio_config (chave, valor, atualizado_em)
				values (@chave::text, @valor::text, now())
				on conflict (chave) do update set valor = excluded.valor, atualizado_em = excluded.atualizado_em
				  where (`+fl.SQL+`) and (`+fe.SQL+`)
				returning chave, valor, atualizado_em) select row_to_json(n) from n`,
				fe.Juntar(fl.Juntar(pgx.NamedArgs{"chave": chave, "valor": in.Valor}))).Scan(&corpo)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNegado // a linha existe e quem pede não a edita: fica como estava
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

const colunasLog = `t.id, t.quem, t.acao, t.alvo, t.resultado, t.detalhe, t.quando`

// corpoLog: o que registrarLog grava (tela-de-patrimonio.vue:1604). quem vem da sessão (Autor).
type corpoLog struct {
	Acao      json.RawMessage `json:"acao,omitempty"`
	Alvo      json.RawMessage `json:"alvo,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
	Detalhe   json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoLog) Validar() error {
	return errors.Join(texto("a ação", c.Acao, 100, true), textoOuNulo("o alvo", c.Alvo, 200),
		textoOuNulo("o resultado", c.Resultado, 50), textoOuNulo("o detalhe", c.Detalhe, 2000))
}

var tabelaLog = dados.Tabela{Nome: "patrimonio_log", Resposta: colunasLog, Autor: "quem"}

// montarConfig: GET /patrimonio/config, PUT /patrimonio/config/{chave}, POST /patrimonio/log. Monte
// DEPOIS de auth.Exigir e autz.ComEscopo. Cada escrita passa por soSessaoPropria.
func montarConfig(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLog.Validar(autz.Producao))
	deve(consultaConfig.Validar(autz.Producao))
	r.Get("/patrimonio/config", consultaConfig.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/patrimonio/config/{chave}", gravarConfig(p))
	r.With(soSessaoPropria).Post("/patrimonio/log", dados.RotaCriar[corpoLog](p, autz.Producao, tabelaLog))
}
