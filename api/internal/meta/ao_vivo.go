package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// AoVivo: as rotas que o front chama para KPIs exatos da Meta (portas de
// supabase/functions/insights-ao-vivo, serie-novos-dia e contar-collabs, ramo CORE_META).
// Devem vir DEPOIS de auth.Exigir + auth.ExigirModulo("social").
type AoVivo struct {
	Pool *pgxpool.Pool
	Core *core.Cliente
}

type obj = map[string]any

// graph faz um GET da Graph pelo core e devolve o JSON NO FORMATO DA GRAPH: erro do core
// vira {"error":{"message":"core: ...","type":"CoreProxy","code":N}} (comoGraph de
// _shared/core-meta.js). 429 do core (recuo) repete até 3 vezes (chamarGraph). Erro só
// quando não houve resposta (rede/prazo) ou falta o token.
func (av *AoVivo) graph(ctx context.Context, caminho string, params obj) (obj, error) {
	// 60 s por chamada: nunca estende o prazo da rota (WithTimeout mantém o que vencer antes),
	// mas uma chamada presa não come o orçamento inteiro das demais.
	ctx, cancela := context.WithTimeout(ctx, 60*time.Second)
	defer cancela()
	r, err := av.Core.Meta(ctx, core.PedidoMeta{Caminho: caminho, Metodo: "GET", Parametros: params}, 3)
	if err != nil {
		return nil, err
	}
	var j obj
	d := json.NewDecoder(bytes.NewReader(r.Corpo))
	d.UseNumber() // ids e contagens saem como entraram
	if d.Decode(&j) != nil || j == nil {
		j = obj{"raw": string(r.Corpo)}
	}
	return comoGraph(r.Status, j), nil
}

func comoGraph(status int, j obj) obj {
	if status < 400 {
		return j
	}
	if _, ok := j["error"].(obj); ok {
		return j
	}
	msg := fmt.Sprintf("HTTP %d", status)
	if s, ok := j["erro"].(string); ok && s != "" {
		msg = s
	} else if s, ok := j["message"].(string); ok && s != "" {
		msg = s
	} else if s, ok := j["raw"].(string); ok && s != "" {
		msg = s[:min(len(s), 200)]
	}
	return obj{"error": obj{"message": "core: " + msg, "type": "CoreProxy", "code": status}}
}

var versaoDaGraph = regexp.MustCompile(`^/v\d+\.\d+/`)

// traduzirURL: `paging.next` (https://graph.facebook.com/v22.0/act_1/insights?after=X&access_token=***)
// -> caminho sem versão + parâmetros sem access_token. ok=false se não for a Graph.
func traduzirURL(bruta string) (string, obj, bool) {
	u, err := url.Parse(bruta)
	if err != nil || u.Scheme != "https" || u.Hostname() != "graph.facebook.com" {
		return "", nil, false
	}
	params := obj{}
	for k, vs := range u.Query() {
		if k != "access_token" && len(vs) > 0 {
			params[k] = vs[len(vs)-1]
		}
	}
	caminho := versaoDaGraph.ReplaceAllString(u.Path, "/")
	if caminho == "" {
		caminho = "/"
	}
	return caminho, params, true
}

// semResposta: nulo é "não sei", zero é "não gastou" (gasto-de-campanhas.js).
func semResposta(r obj) bool {
	_, lista := r["data"].([]any)
	return r == nil || r["error"] != nil || !lista
}

func podeBuscarProxima(pagina obj, lidas, max int) bool {
	paging, _ := pagina["paging"].(obj)
	next, _ := paging["next"].(string)
	dados, _ := pagina["data"].([]any)
	return next != "" && len(dados) > 0 && lidas < max
}

func numero(v any) float64 {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	}
	return 0
}

// primeiro devolve r.data[0] (ou nil).
func primeiro(r obj) obj {
	d, _ := r["data"].([]any)
	if len(d) == 0 {
		return nil
	}
	o, _ := d[0].(obj)
	return o
}

// resultados devolve item.total_value.breakdowns[0].results.
func resultados(item obj) []any {
	tv, _ := item["total_value"].(obj)
	bds, _ := tv["breakdowns"].([]any)
	if len(bds) == 0 {
		return nil
	}
	b0, _ := bds[0].(obj)
	rs, _ := b0["results"].([]any)
	return rs
}

func dimensao(r obj) any {
	dv, _ := r["dimension_values"].([]any)
	if len(dv) == 0 {
		return nil
	}
	return dv[0]
}

// lerBrutoDoDia (bruto-de-seguidores.js): "publicou zero" e "não publicou" NÃO são a mesma coisa.
func lerBrutoDoDia(r obj) (publicado bool, seguiu, deixou float64) {
	item := primeiro(r)
	if item == nil {
		return false, 0, 0
	}
	rs := resultados(item)
	if len(rs) == 0 {
		return false, 0, 0
	}
	for _, x := range rs {
		o, _ := x.(obj)
		switch dimensao(o) {
		case "FOLLOWER":
			seguiu = numero(o["value"])
		case "NON_FOLLOWER":
			deixou = numero(o["value"])
		}
	}
	return true, seguiu, deixou
}

func diaSP(segundos string) string {
	f, _ := strconv.ParseFloat(segundos, 64)
	return time.Unix(int64(f), 0).In(saoPaulo).Format("2006-01-02")
}

func janela(since, until string) string {
	u, _ := strconv.ParseFloat(until, 64)
	b, _ := json.Marshal(struct {
		Since string `json:"since"`
		Until string `json:"until"`
	}{diaSP(since), diaSP(strconv.FormatFloat(u-1, 'f', -1, 64))})
	return string(b)
}

func lerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.UseNumber()
	if err := d.Decode(destino); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			responder(w, http.StatusRequestEntityTooLarge, obj{"erro": "corpo grande demais"})
		} else {
			responder(w, http.StatusBadRequest, obj{"erro": "corpo invalido"})
		}
		return false
	}
	return true
}

// falhar responde a uma falha sem resposta do core: sem token = 503 (como meta-proxy e bling),
// o resto = 500 `erro interno`. Só a causa vai ao log (o cliente do core não põe o token em erro).
func falhar(w http.ResponseWriter, rota, chave string, err error) {
	if errors.Is(err, core.ErrSemToken) {
		responder(w, http.StatusServiceUnavailable, obj{chave: "core nao configurado"})
		return
	}
	slog.Error("ao-vivo: falha", "rota", rota, "erro", err)
	responder(w, http.StatusInternalServerError, obj{chave: "erro interno"})
}

// ── insights-ao-vivo ──────────────────────────────────────────────────────────

type periodo struct{ eS, eU, fS, fU string }

// Insights é POST /insights-ao-vivo. Todas as chamadas em paralelo (a latência é a da mais lenta).
func (av *AoVivo) Insights(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if !lerCorpo(w, r, &in) {
		return
	}
	var campanhas []string
	if cs, ok := in["campanhas"].([]any); ok {
		for _, c := range cs {
			campanhas = append(campanhas, textoDe(c))
		}
	}
	var ig, adAcc *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text, ad_account_id::text from accounts where id::text = $1`, textoDe(in["account_id"])).Scan(&ig, &adAcc)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"meta_erro": "conta não encontrada"})
		return
	}
	if err != nil {
		falhar(w, "insights-ao-vivo", "meta_erro", err)
		return
	}
	igID := ""
	if ig != nil {
		igID = *ig
	}
	atual := periodo{textoDe(in["engSince"]), textoDe(in["engUntil"]), textoDe(in["folSince"]), textoDe(in["folUntil"])}
	ant := periodo{textoDe(in["prevEngSince"]), textoDe(in["prevEngUntil"]), textoDe(in["prevFolSince"]), textoDe(in["prevFolUntil"])}
	querAnterior := ant.eS != "" && ant.eU != "" && ant.fS != "" && ant.fU != ""

	ctx := r.Context()
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		falhou   error
		seguidor obj
		out      = obj{}
		anterior = obj{}
		incompl  bool
	)
	anotar := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if err != nil && falhou == nil {
			falhou = err
		}
	}
	por := func(destino obj, p periodo, corrente bool) {
		wg.Go(func() {
			e, err := av.engajamento(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["engajamento"] = e.obj
			incompl = incompl || (corrente && e.erro)
			mu.Unlock()
		})
		wg.Go(func() {
			i, err := av.interacoes(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["interacoes"] = i
			mu.Unlock()
		})
		wg.Go(func() {
			n, err := av.novos(ctx, igID, p.fS, p.fU)
			anotar(err)
			mu.Lock()
			destino["novos"] = obj{"seguiu": n.seguiu, "deixou": n.deixou, "total": n.seguiu - n.deixou}
			incompl = incompl || (corrente && n.erro)
			mu.Unlock()
		})
		wg.Go(func() {
			v, err := av.respostas(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["respostas"] = v
			mu.Unlock()
		})
		wg.Go(func() {
			var inv *float64
			var acoes obj
			if adAcc != nil && *adAcc != "" {
				var err error
				inv, err = av.gasto(ctx, *adAcc, p.eS, p.eU, campanhas)
				anotar(err)
				acoes, err = av.acoesDeAnuncio(ctx, *adAcc, p.eS, p.eU)
				anotar(err)
			}
			mu.Lock()
			destino["investimento"] = inv
			destino["_acoes"] = acoes
			mu.Unlock()
		})
	}
	wg.Go(func() {
		f, err := av.graph(ctx, "/"+igID, obj{"fields": "followers_count"})
		anotar(err)
		mu.Lock()
		seguidor = f
		mu.Unlock()
	})
	por(out, atual, true)
	if querAnterior {
		por(anterior, ant, false)
	}
	wg.Wait()
	if falhou != nil {
		falhar(w, "insights-ao-vivo", "meta_erro", falhou)
		return
	}
	// Interações de anúncio = Ads Manager (sobrepõe o breakdown do IG, que difere).
	for _, d := range []obj{out, anterior} {
		if acoes, ok := d["_acoes"].(obj); ok && acoes != nil {
			fundirAnuncio(d["interacoes"].(map[string]map[string]float64), acoes)
		}
		delete(d, "_acoes")
	}
	out["followers_count"] = seguidor["followers_count"]
	if querAnterior {
		out["anterior"] = anterior
	}
	if incompl {
		out["meta_erro"] = "meta_incompleto"
	}
	responder(w, http.StatusOK, out)
}

type leitura struct {
	obj  obj
	erro bool
}

func (av *AoVivo) engajamento(ctx context.Context, ig, eS, eU string) (leitura, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "views,reach,total_interactions,profile_views", "period": "day", "metric_type": "total_value", "since": eS, "until": eU})
	if err != nil {
		return leitura{}, err
	}
	em := map[string]float64{}
	dados, _ := r["data"].([]any)
	for _, x := range dados {
		it, _ := x.(obj)
		tv, _ := it["total_value"].(obj)
		nome, _ := it["name"].(string)
		em[nome] = numero(tv["value"])
	}
	return leitura{obj{"views": em["views"], "reach": em["reach"], "interacoes": em["total_interactions"], "visitas": em["profile_views"]}, r["error"] != nil}, nil
}

type novosLidos struct {
	seguiu, deixou float64
	erro           bool
}

func (av *AoVivo) novos(ctx context.Context, ig, fS, fU string) (novosLidos, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "follows_and_unfollows", "period": "day", "metric_type": "total_value", "breakdown": "follow_type", "since": fS, "until": fU})
	if err != nil {
		return novosLidos{}, err
	}
	n := novosLidos{erro: r["error"] != nil}
	for _, x := range resultados(primeiro(r)) {
		o, _ := x.(obj)
		switch dimensao(o) {
		case "FOLLOWER":
			n.seguiu = numero(o["value"])
		case "NON_FOLLOWER":
			n.deixou = numero(o["value"])
		}
	}
	return n, nil
}

var tipoDeConteudo = map[string]string{"POST": "post", "REEL": "reel", "STORY": "story", "AD": "ad"}

// interacoes por tipo de conteúdo; geral = tudo, org = sem anúncio.
func (av *AoVivo) interacoes(ctx context.Context, ig, eS, eU string) (map[string]map[string]float64, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "likes,comments,saves,shares", "period": "day", "metric_type": "total_value", "breakdown": "media_product_type", "since": eS, "until": eU})
	if err != nil {
		return nil, err
	}
	nomes := map[string]string{"likes": "curtidas", "comments": "comentarios", "saves": "salvamentos", "shares": "compartilhamentos"}
	inter := map[string]map[string]float64{}
	for _, m := range nomes {
		inter[m] = map[string]float64{"post": 0, "reel": 0, "story": 0, "ad": 0, "geral": 0, "org": 0}
	}
	dados, _ := r["data"].([]any)
	for _, x := range dados {
		it, _ := x.(obj)
		nome, _ := it["name"].(string)
		dest := inter[nomes[nome]]
		if dest == nil {
			continue
		}
		for _, y := range resultados(it) {
			o, _ := y.(obj)
			t, _ := dimensao(o).(string)
			v := numero(o["value"])
			if k, ok := tipoDeConteudo[t]; ok {
				dest[k] += v
			}
			dest["geral"] += v
			if t != "AD" {
				dest["org"] += v
			}
		}
	}
	return inter, nil
}

func (av *AoVivo) respostas(ctx context.Context, ig, eS, eU string) (float64, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "replies", "period": "day", "metric_type": "total_value", "since": eS, "until": eU})
	if err != nil {
		return 0, err
	}
	tv, _ := primeiro(r)["total_value"].(obj)
	return numero(tv["value"]), nil
}

const maxPaginas = 20 // teto: a Graph pode mandar paging.next para sempre

// gasto do período: sem campanhas, level=account; com campanhas, level=campaign somando
// só as escolhidas e seguindo paging.next. nil = "não sei" (meia soma é pior que nada).
func (av *AoVivo) gasto(ctx context.Context, conta, eS, eU string, campanhas []string) (*float64, error) {
	jan := janela(eS, eU)
	if len(campanhas) == 0 {
		r, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "spend", "level": "account", "time_range": jan})
		if err != nil || semResposta(r) {
			return nil, err
		}
		v := numero(primeiro(r)["spend"])
		return &v, nil
	}
	pagina, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "campaign_id,spend", "level": "campaign", "time_range": jan, "limit": "500"})
	if err != nil || semResposta(pagina) {
		return nil, err
	}
	linhas := append([]any{}, pagina["data"].([]any)...)
	for lidas := 1; podeBuscarProxima(pagina, lidas, maxPaginas); lidas++ {
		caminho, params, ok := traduzirURL(pagina["paging"].(obj)["next"].(string))
		if !ok {
			return nil, nil
		}
		if pagina, err = av.graph(ctx, caminho, params); err != nil || semResposta(pagina) {
			return nil, err
		}
		linhas = append(linhas, pagina["data"].([]any)...)
	}
	alvo := map[string]bool{}
	for _, c := range campanhas {
		alvo[c] = true
	}
	total := 0.0
	for _, x := range linhas {
		l, _ := x.(obj)
		if alvo[textoDe(l["campaign_id"])] {
			total += numero(l["spend"])
		}
	}
	return &total, nil
}

// acoesDeAnuncio: interações de anúncio pelo Ads Manager (a fonte certa para .ad).
func (av *AoVivo) acoesDeAnuncio(ctx context.Context, conta, eS, eU string) (obj, error) {
	r, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "actions", "level": "account", "time_range": janela(eS, eU)})
	if err != nil {
		return nil, err
	}
	a := map[string]float64{}
	acoes, _ := primeiro(r)["actions"].([]any)
	for _, x := range acoes {
		o, _ := x.(obj)
		tipo, _ := o["action_type"].(string)
		a[tipo] = numero(o["value"])
	}
	return obj{"curtidas": a["post_reaction"], "comentarios": a["comment"], "salvamentos": a["onsite_conversion.post_save"], "compartilhamentos": a["post"]}, nil
}

// fundirAnuncio sobrepõe .ad (Ads Manager) e recalcula geral = orgânico + anúncio.
func fundirAnuncio(inter map[string]map[string]float64, acoes obj) {
	for _, m := range []string{"curtidas", "comentarios", "salvamentos", "compartilhamentos"} {
		v, _ := acoes[m].(float64)
		inter[m]["ad"] = v
		inter[m]["geral"] = inter[m]["org"] + v
	}
}

// ── serie-novos-dia ───────────────────────────────────────────────────────────

// SerieNovosDia é POST /serie-novos-dia {account_id, dias:[{since, until, label}]}: um GET
// por dia (o core não aceita o batch da Graph), em ondas de 5, no máximo 93 dias.
func (av *AoVivo) SerieNovosDia(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID any   `json:"account_id"`
		Dias      []obj `json:"dias"`
	}
	if !lerCorpo(w, r, &in) {
		return
	}
	if len(in.Dias) == 0 {
		responder(w, http.StatusOK, obj{"serie": []any{}})
		return
	}
	var ig *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text from accounts where id::text = $1`, textoDe(in.AccountID)).Scan(&ig)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"erro": "conta não encontrada"})
		return
	}
	if err != nil {
		falhar(w, "serie-novos-dia", "erro", err)
		return
	}
	igID := ""
	if ig != nil {
		igID = *ig
	}
	dias := in.Dias[:min(len(in.Dias), 93)]
	serie := make([]obj, len(dias))
	var semToken atomic.Bool
	for ini := 0; ini < len(dias); ini += 5 {
		var wg sync.WaitGroup
		for i := ini; i < min(ini+5, len(dias)); i++ {
			wg.Go(func() {
				d := dias[i]
				if textoDe(d["since"]) == "" || textoDe(d["until"]) == "" { // a edge mandava "undefined" e a Graph recusava
					serie[i] = obj{"label": d["label"], "seguiu": 0.0, "deixou": 0.0, "publicado": false}
					return
				}
				resp, err := av.graph(r.Context(), "/"+igID+"/insights", obj{"metric": "follows_and_unfollows", "period": "day",
					"metric_type": "total_value", "breakdown": "follow_type", "since": textoDe(d["since"]), "until": textoDe(d["until"])})
				publicado, seguiu, deixou := false, 0.0, 0.0
				if errors.Is(err, core.ErrSemToken) {
					semToken.Store(true)
				}
				if err == nil { // sem resposta = "não publicado", nunca um zero que parece verdade
					publicado, seguiu, deixou = lerBrutoDoDia(resp)
				}
				serie[i] = obj{"label": d["label"], "seguiu": seguiu, "deixou": deixou, "publicado": publicado}
			})
		}
		wg.Wait()
		if semToken.Load() {
			falhar(w, "serie-novos-dia", "erro", core.ErrSemToken)
			return
		}
	}
	responder(w, http.StatusOK, obj{"serie": serie})
}

// ── contar-collabs ────────────────────────────────────────────────────────────

// ContarCollabs é POST /contar-collabs {account_id, since, until}: conta posts/reels em COLLAB
// do perfil-alvo varrendo a /media dos OUTROS perfis da RBV (até 5 páginas por perfil).
func (av *AoVivo) ContarCollabs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID any `json:"account_id"`
		Since     any `json:"since"`
		Until     any `json:"until"`
	}
	if !lerCorpo(w, r, &in) {
		return
	}
	since, until, conta := textoDe(in.Since), textoDe(in.Until), textoDe(in.AccountID)
	if since == "" || until == "" {
		responder(w, http.StatusOK, obj{"posts": 0, "reels": 0})
		return
	}
	var alvo *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text from accounts where id::text = $1`, conta).Scan(&alvo)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"erro": "conta não encontrada"})
		return
	}
	if err != nil {
		falhar(w, "contar-collabs", "erro", err)
		return
	}
	linhas, err := av.Pool.Query(r.Context(), `select instagram_id::text from accounts where id::text <> $1 and instagram_id is not null`, conta)
	if err != nil {
		falhar(w, "contar-collabs", "erro", err)
		return
	}
	outros, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		falhar(w, "contar-collabs", "erro", err)
		return
	}
	alvoIG := ""
	if alvo != nil {
		alvoIG = *alvo
	}
	posts, reels := 0, 0
	vistos := map[string]bool{}
	for _, o := range outros {
		after := ""
		for pag := 0; pag < 5; pag++ {
			params := obj{"fields": "id,media_product_type,collaborators", "since": since, "until": until, "limit": "50"}
			if after != "" {
				params["after"] = after
			}
			m, err := av.graph(r.Context(), "/"+o+"/media", params)
			if err != nil {
				falhar(w, "contar-collabs", "erro", err)
				return
			}
			if m["error"] != nil {
				break
			}
			dados, _ := m["data"].([]any)
			for _, x := range dados {
				it, _ := x.(obj)
				id := textoDe(it["id"])
				col, _ := it["collaborators"].(obj)
				lista, _ := col["data"].([]any)
				for _, c := range lista {
					co, _ := c.(obj)
					if textoDe(co["id"]) == alvoIG && co["invite_status"] == "Accepted" && !vistos[id] {
						vistos[id] = true
						if it["media_product_type"] == "REELS" {
							reels++
						} else {
							posts++
						}
					}
				}
			}
			paging, _ := m["paging"].(obj)
			cursors, _ := paging["cursors"].(obj)
			after, _ = cursors["after"].(string)
			if after == "" {
				break
			}
		}
	}
	responder(w, http.StatusOK, obj{"posts": posts, "reels": reels})
}
