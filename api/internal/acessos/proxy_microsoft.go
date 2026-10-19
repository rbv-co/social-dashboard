package acessos

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/conexoes"
	"github.com/rbv-co/social-dashboard/api/internal/microsoft"
)

// As 15 ações microsoft.* do acessos-proxy (OneDrive pelo Microsoft Graph): porte fiel da edge, mesmas chaves de
// resposta, mesmos códigos de erro e mesmos tetos. O que muda de propósito está marcado com "diverge da edge".

func init() {
	for nome, a := range map[string]acao{
		"microsoft.status":         {(*Proxy).msStatus, false},
		"microsoft.authUrl":        {(*Proxy).msAuthURL, true},
		"microsoft.browse":         {(*Proxy).msBrowse, false},
		"microsoft.tree":           {(*Proxy).msTree, false},
		"microsoft.shareMany":      {(*Proxy).msShareMany, true},
		"microsoft.addFolder":      {(*Proxy).msAddFolder, true},
		"microsoft.folders":        {(*Proxy).msFolders, false},
		"microsoft.removeFolder":   {(*Proxy).msRemoveFolder, true},
		"microsoft.shares":         {(*Proxy).msShares, false},
		"microsoft.sharesMany":     {(*Proxy).msSharesMany, false},
		"microsoft.accessScan":     {(*Proxy).msAccessScan, false},
		"microsoft.allShares":      {(*Proxy).msAllShares, false},
		"microsoft.share":          {(*Proxy).msShare, true},
		"microsoft.unshare":        {(*Proxy).msUnshare, true},
		"microsoft.revokeForEmail": {(*Proxy).msRevokeForEmail, true},
	} {
		acoes[nome] = a
	}
}

const mensagemDoConvite = "Você recebeu acesso a uma pasta compartilhada da RBV. Entre com sua conta Microsoft para acessar."

// ---- Graph: formas tolerantes (a edge lê tudo como `any`; campo de tipo errado vira vazio, não erro) ----

type gUsuario struct {
	DisplayName string `json:"displayName"`
	Email       string `json:"email"`
	LoginName   string `json:"loginName"`
}

type gConjunto struct {
	User, SiteUser, Group, Application *gUsuario
}

func (c *gConjunto) usuario() *gUsuario {
	if c == nil {
		return nil
	}
	for _, u := range []*gUsuario{c.User, c.SiteUser, c.Group, c.Application} {
		if u != nil {
			return u
		}
	}
	return nil
}

type gPermissao struct {
	ID                    string      `json:"id"`
	Roles                 []string    `json:"roles"`
	GrantedToV2           *gConjunto  `json:"grantedToV2"`
	GrantedTo             *gConjunto  `json:"grantedTo"`
	GrantedToIdentitiesV2 []gConjunto `json:"grantedToIdentitiesV2"`
	Invitation            *struct {
		Email     string     `json:"email"`
		InvitedBy *gConjunto `json:"invitedBy"`
	} `json:"invitation"`
	Link *struct {
		Scope  string `json:"scope"`
		WebURL string `json:"webUrl"`
	} `json:"link"`
	InheritedFrom json.RawMessage `json:"inheritedFrom"`
}

func (p gPermissao) dono() bool { return slices.Contains(p.Roles, "owner") }

func (p gPermissao) papel() string {
	if slices.Contains(p.Roles, "write") {
		return "edição"
	}
	return "leitura"
}

func (p gPermissao) herdada() bool {
	s := strings.TrimSpace(string(p.InheritedFrom))
	return s != "" && s != "null"
}

type identidade struct{ nome, email string }

// identidade: porte de parsePermIdentity (OneDrive pessoal devolve formas diferentes: grantedToV2, grantedToIdentitiesV2,
// invitation.email, link sem identidade, e o acesso DIRETO como permissão de "link" com o e-mail só no id em base64).
func (p gPermissao) identidade() identidade {
	de := func(c *gConjunto) *identidade {
		u := c.usuario()
		if u == nil {
			return nil
		}
		e := u.Email
		if e == "" {
			e = u.LoginName
		}
		return &identidade{u.DisplayName, e}
	}
	id := de(p.GrantedToV2)
	if id == nil && len(p.GrantedToIdentitiesV2) > 0 {
		id = de(&p.GrantedToIdentitiesV2[0])
	}
	if id == nil && p.Invitation != nil && p.Invitation.Email != "" {
		nome := ""
		if ib := p.Invitation.InvitedBy; ib != nil && ib.User != nil {
			nome = ib.User.DisplayName
		}
		id = &identidade{nome, p.Invitation.Email}
	}
	// Consumer OneDrive: o acesso direto (membership) vem sem grantedTo*; o e-mail está no id (base64 de
	// "i:0#.f|membership|<email>"). Sem isso a Auditoria perdia quem tem acesso direto.
	if id == nil || id.email == "" {
		if dec, err := base64.RawStdEncoding.DecodeString(strings.TrimRight(p.ID, "=")); err == nil {
			const k = "|membership|"
			if i := strings.Index(string(dec), k); i >= 0 {
				if email := strings.TrimSpace(string(dec)[i+len(k):]); email != "" && strings.Contains(email, "@") {
					nome := ""
					if id != nil {
						nome = id.nome
					}
					id = &identidade{nome, email}
				}
			}
		}
	}
	if id == nil && p.Link != nil {
		nome := "Link de compartilhamento"
		if p.Link.Scope != "" {
			nome = "Link (" + p.Link.Scope + ")"
		}
		id = &identidade{nome, ""}
	}
	if id == nil {
		return identidade{}
	}
	return *id
}

// contaResolvida: a conta Microsoft REAL para onde o convite resolveu (pode ser outra que o e-mail convidado: alias).
func (p gPermissao) contaResolvida() *string {
	var cands []*gUsuario
	if p.GrantedToV2 != nil {
		cands = append(cands, p.GrantedToV2.User)
	}
	if p.GrantedTo != nil {
		cands = append(cands, p.GrantedTo.User)
	}
	if p.GrantedToV2 != nil {
		cands = append(cands, p.GrantedToV2.SiteUser)
	}
	for _, u := range cands {
		if u != nil && u.Email != "" {
			return &u.Email
		}
	}
	return nil
}

type gItem struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Folder *struct {
		ChildCount int `json:"childCount"`
	} `json:"folder"`
}

// valores: o array `value` de uma resposta do Graph (vazio se não vier).
func valores[T any](r microsoft.Resposta) []T {
	var v struct {
		Value []T `json:"value"`
	}
	_ = json.Unmarshal(r.Corpo, &v)
	return v.Value
}

func pastasDe(itens []gItem) []gItem {
	return slices.DeleteFunc(itens, func(i gItem) bool { return i.Folder == nil })
}

// linkDaPasta: o link compartilhável (1drv.ms/...), que respeita requireSignIn: só quem tem grant abre.
func linkDaPasta(ps []gPermissao) *string {
	for _, p := range ps {
		if p.Link != nil && p.Link.WebURL != "" {
			l := p.Link.WebURL
			return &l
		}
	}
	return nil
}

func caminhoDoItem(id, sufixo string) string {
	return "/me/drive/items/" + idNoCaminho(id) + sufixo
}

// erroGrafo: status != 2xx do Graph vira 200 {error:"graph_http_<status>", detalhe:<json do Graph>}, como na edge.
func erroGrafo(r microsoft.Resposta) resposta {
	return ok(mapa{"error": "graph_http_" + strconv.Itoa(r.Status), "detalhe": r.Corpo})
}

// msFalha: sem conexão = nao_conectado; o resto é defeito.
func msFalha(acao string, err error) resposta {
	if r, sem := semConexao(acao, err); sem {
		return r
	}
	return falhaInterna(acao, err)
}

// grafo chama o Graph dentro de um laço. vivo = já houve resposta: erro de transporte ANTES da primeira resposta é
// defeito da conexão (token), e derruba a ação como a edge (que pedia o token antes do laço); depois disso é falha
// daquele item e o laço segue.
type grafo struct {
	x    *Proxy
	ctx  context.Context
	vivo bool
}

func (g *grafo) chamar(metodo, caminho string, corpo any) (microsoft.Resposta, error) {
	r, err := g.x.MS.Grafo(g.ctx, metodo, caminho, corpo)
	if err == nil {
		g.vivo = true
	}
	return r, err
}

func (g *grafo) fatal(err error) bool {
	return errors.Is(err, microsoft.ErrDesconectado) || errors.Is(err, conexoes.ErrSemConexao) ||
		(!g.vivo && g.ctx.Err() == nil)
}

// msPronto: a conexão tem refresh_token? Antes dos laços, para que "sem conexão" nunca vire lista vazia.
func (x *Proxy) msPronto(ctx context.Context, acao string) (resposta, bool) {
	est, err := x.MS.Estado(ctx)
	if err != nil {
		return falhaInterna(acao, err), false
	}
	if !est.Conectado {
		return naoConectado, false
	}
	return resposta{}, true
}

// ---- pedido: leitura dos campos soltos ----

// numeroJS: Number(x) do JS para o que a tela manda em `depth` (número ou texto); o que não for número vira 0.
func numeroJS(raw json.RawMessage) float64 {
	var f float64
	if json.Unmarshal(raw, &f) != nil {
		var s string
		if json.Unmarshal(raw, &s) != nil {
			return 0
		}
		var err error
		if f, err = strconv.ParseFloat(strings.TrimSpace(s), 64); err != nil {
			return 0
		}
	}
	if math.IsNaN(f) {
		return 0
	}
	return f
}

// profundidade: Math.max(1, Math.min(5, Number(x) || 2)).
func profundidade(raw json.RawMessage) float64 {
	v := numeroJS(raw)
	if v == 0 {
		v = 2
	}
	return math.Max(1, math.Min(5, v))
}

func textoJS(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		if t != 0 {
			return strconv.FormatFloat(t, 'f', -1, 64)
		}
	}
	return ""
}

type pastaPedida struct {
	id   string
	nome *string
}

// pastasDoPedido: `items` como lista de ids (texto) ou de {id, name}; o que não tem id sai.
func pastasDoPedido(raw json.RawMessage) []pastaPedida {
	var lista []any
	_ = json.Unmarshal(raw, &lista)
	out := []pastaPedida{}
	for _, v := range lista {
		switch t := v.(type) {
		case string:
			if t != "" {
				out = append(out, pastaPedida{id: t})
			}
		case map[string]any:
			if id := textoJS(t["id"]); id != "" {
				var nome *string
				if n := textoJS(t["name"]); n != "" {
					nome = &n
				}
				out = append(out, pastaPedida{id, nome})
			}
		}
	}
	return out
}

// ---- ações ----

func (x *Proxy) msStatus(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	est, err := x.MS.Estado(ctx)
	if err != nil {
		return falhaInterna("microsoft.status", err)
	}
	return ok(mapa{"connected": est.Conectado, "conectado_em": est.ConectadoEm})
}

func (x *Proxy) msAuthURL(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if x.APIPublica == "" {
		return erro(http.StatusInternalServerError, "api_url_publica_ausente")
	}
	u, err := x.MS.URLDeConsentimento(ctx, x.callback("microsoft"))
	if err != nil {
		return falhaInterna("microsoft.authUrl", err)
	}
	return ok(mapa{"url": u})
}

func (x *Proxy) msBrowse(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	caminho, pai := "/me/drive/root/children", any(nil)
	if p.ItemID != "" {
		caminho, pai = caminhoDoItem(string(p.ItemID), "/children"), string(p.ItemID)
	}
	r, err := x.MS.Grafo(ctx, "GET", caminho, nil)
	if err != nil {
		return msFalha("microsoft.browse", err)
	}
	if !r.OK() {
		return erroGrafo(r)
	}
	type pasta struct {
		ID         string `json:"id"`
		Name       string `json:"name"`
		ChildCount int    `json:"childCount"`
	}
	pastas := []pasta{}
	for _, i := range pastasDe(valores[gItem](r)) {
		pastas = append(pastas, pasta{i.ID, i.Name, i.Folder.ChildCount})
	}
	return ok(mapa{"folders": pastas, "parentId": pai})
}

// msTree: varredura recursiva de uma marca: TODAS as pastas descendentes (achatadas) até a profundidade, cada uma com a
// trilha de ancestrais. Limitada por profundidade (1..5, padrão 2), 1500 pastas e 400 chamadas.
func (x *Proxy) msTree(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	const nodeCap, callCap = 1500, 400
	if p.ItemID == "" {
		return erro(http.StatusBadRequest, "sem_itemId")
	}
	if r, ok := x.msPronto(ctx, "microsoft.tree"); !ok {
		return r
	}
	prof := profundidade(p.Depth)
	type no struct {
		ID         string   `json:"id"`
		Name       string   `json:"name"`
		Depth      int      `json:"depth"`
		ChildCount int      `json:"childCount"`
		Trail      []string `json:"trail"`
		ParentID   string   `json:"parentId"`
	}
	type fronteira struct {
		id    string
		trail []string
	}
	out := []no{}
	chamadas, truncado := 0, false
	g := &grafo{x: x, ctx: ctx}
	atual := []fronteira{{string(p.ItemID), []string{}}}
parar:
	for d := 1; float64(d) <= prof && len(atual) > 0; d++ {
		var prox []fronteira
		for _, n := range atual {
			if chamadas >= callCap || len(out) >= nodeCap || ctx.Err() != nil {
				truncado = true
				break parar
			}
			chamadas++
			r, err := g.chamar("GET", caminhoDoItem(n.id, "/children?$top=200&$select=id,name,folder"), nil)
			if err != nil {
				if g.fatal(err) {
					return msFalha("microsoft.tree", err)
				}
				continue
			}
			if !r.OK() {
				continue
			}
			for _, k := range pastasDe(valores[gItem](r)) {
				if len(out) >= nodeCap {
					truncado = true
					break parar
				}
				out = append(out, no{k.ID, k.Name, d, k.Folder.ChildCount, n.trail, n.id})
				if float64(d) < prof && k.Folder.ChildCount != 0 {
					prox = append(prox, fronteira{k.ID, append(slices.Clone(n.trail), k.Name)})
				}
			}
		}
		atual = prox
	}
	return ok(mapa{"folders": out, "truncated": truncado, "depth": prof, "total": len(out)})
}

// msRegistrar: acha o recurso pelo external_id ou cria (onedrive/microsoft). Sem filtro de arquivado_em de propósito:
// é checagem de duplicata, não listagem; pasta arquivada já está gravada e conta como existente. A trava por external_id
// evita duplicar com dois pedidos ao mesmo tempo (a tabela não tem único para onedrive).
func (x *Proxy) msRegistrar(ctx context.Context, itemID, nome string, caminho *string) (id string, recurso json.RawMessage, jaExistia bool, err error) {
	tx, err := x.Pool.Begin(ctx)
	if err != nil {
		return "", nil, false, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	if _, err = tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('acessos_recursos:' || $1::text))`, itemID); err != nil {
		return "", nil, false, err
	}
	err = tx.QueryRow(ctx, `select id::text, to_jsonb(r) from acessos_recursos r where external_id = $1 limit 1`, itemID).Scan(&id, &recurso)
	if err == nil {
		return id, recurso, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", nil, false, err
	}
	if nome == "" {
		nome = "(sem nome)"
	}
	if err = tx.QueryRow(ctx, `insert into acessos_recursos (tipo, provedor, nome, external_id, caminho) values ('onedrive', 'microsoft', $1, $2, $3)
		  returning id::text, to_jsonb(acessos_recursos)`, nome, itemID, caminho).Scan(&id, &recurso); err != nil {
		return "", nil, false, err
	}
	return id, recurso, false, tx.Commit(ctx)
}

func (x *Proxy) msAddFolder(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.ItemID == "" {
		return erro(http.StatusBadRequest, "sem_itemId")
	}
	var caminho *string
	if p.Caminho != "" {
		caminho = ptr(string(p.Caminho))
	}
	id, rec, jaExistia, err := x.msRegistrar(ctx, string(p.ItemID), string(p.Name), caminho)
	if err != nil {
		slog.Error("acessos-proxy: microsoft.addFolder", "erro", err)
		return erro(http.StatusInternalServerError, "falha_ao_inserir")
	}
	if jaExistia {
		return ok(mapa{"recurso": rec, "jaExistia": true})
	}
	x.trilha(ctx, e.ID, "onedrive.addFolder", "microsoft", ptr(id), "ok", mapa{"itemId": p.ItemID, "name": p.Name})
	return ok(mapa{"recurso": rec})
}

func (x *Proxy) msFolders(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	var linhas json.RawMessage
	// Pasta arquivada não aparece: arquivado_em preenchido = fora de uso (reversível limpando a coluna).
	err := x.Pool.QueryRow(ctx, `select coalesce(jsonb_agg(to_jsonb(r) order by r.nome), '[]'::jsonb)
		  from acessos_recursos r where tipo = 'onedrive' and arquivado_em is null`).Scan(&linhas)
	if err != nil {
		slog.Error("acessos-proxy: microsoft.folders", "erro", err)
		return erro(http.StatusInternalServerError, "falha_ao_listar")
	}
	return ok(mapa{"folders": linhas})
}

func (x *Proxy) msRemoveFolder(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.RecursoID == "" {
		return erro(http.StatusBadRequest, "sem_recursoId")
	}
	if _, err := x.Pool.Exec(ctx, `delete from acessos_recursos where id = $1::uuid`, string(p.RecursoID)); err != nil {
		slog.Error("acessos-proxy: microsoft.removeFolder", "erro", err)
		return erro(http.StatusInternalServerError, "falha_ao_remover")
	}
	x.trilha(ctx, e.ID, "onedrive.removeFolder", "microsoft", ptr(string(p.RecursoID)), "ok", mapa{"recursoId": p.RecursoID})
	return ok(mapa{"ok": true})
}

func (x *Proxy) msShares(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.ItemID == "" {
		return erro(http.StatusBadRequest, "sem_itemId")
	}
	r, err := x.MS.Grafo(ctx, "GET", caminhoDoItem(string(p.ItemID), "/permissions"), nil)
	if err != nil {
		return msFalha("microsoft.shares", err)
	}
	if !r.OK() {
		return erroGrafo(r)
	}
	type acesso struct {
		PermID string `json:"permId"`
		Name   string `json:"name"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	}
	ps := valores[gPermissao](r)
	shares := []acesso{}
	for _, pm := range ps {
		if pm.dono() { // a permissão do dono não é um "compartilhamento" a gerenciar
			continue
		}
		id := pm.identidade()
		shares = append(shares, acesso{pm.ID, id.nome, id.email, pm.papel()})
	}
	return ok(mapa{"shares": shares, "link": linkDaPasta(ps)})
}

// convidar: driveItem:invite. sendInvitation:true para a pessoa RECEBER o e-mail com o link (com false nascia uma permissão
// de link sem URL entregue e ninguém via nada em "Compartilhado comigo"); requireSignIn:true exige a conta convidada.
func convidar(chamar func(metodo, caminho string, corpo any) (microsoft.Resposta, error), itemID, email, papelGraph string) (microsoft.Resposta, error) {
	return chamar("POST", caminhoDoItem(itemID, "/invite"), mapa{
		"recipients":     []mapa{{"email": email}},
		"roles":          []string{papelGraph},
		"requireSignIn":  true,
		"sendInvitation": true,
		"message":        mensagemDoConvite,
	})
}

func papelGraph(role texto) string {
	if role == "edição" {
		return "write"
	}
	return "read"
}

// linkAvulso: o link da pasta lido das permissões (quando o convite não o trouxe). Falha = sem link.
func linkAvulso(chamar func(metodo, caminho string, corpo any) (microsoft.Resposta, error), itemID string) *string {
	r, err := chamar("GET", caminhoDoItem(itemID, "/permissions"), nil)
	if err != nil || !r.OK() {
		return nil
	}
	return linkDaPasta(valores[gPermissao](r))
}

func (x *Proxy) msShare(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.ItemID == "" || p.Email == "" {
		return erro(http.StatusBadRequest, "sem_itemId_ou_email")
	}
	chamar := func(m, c string, b any) (microsoft.Resposta, error) { return x.MS.Grafo(ctx, m, c, b) }
	pg := papelGraph(p.Role)
	r, err := convidar(chamar, string(p.ItemID), string(p.Email), pg)
	if err != nil {
		return msFalha("microsoft.share", err)
	}
	if !r.OK() {
		x.trilha(ctx, e.ID, "onedrive.share", "microsoft", ptr(string(p.ItemID)), "erro",
			mapa{"email": p.Email, "role": p.Role, "status": r.Status, "detalhe": r.Corpo})
		return erroGrafo(r)
	}
	x.trilha(ctx, e.ID, "onedrive.share", "microsoft", ptr(string(p.ItemID)), "ok", mapa{"email": p.Email, "role": pg})
	// link da pasta para mandar direto ao colaborador (sem depender do e-mail da Microsoft)
	vs := valores[gPermissao](r)
	link := linkDaPasta(vs)
	if link == nil {
		link = linkAvulso(chamar, string(p.ItemID))
	}
	var conta *string
	if len(vs) > 0 {
		conta = vs[0].contaResolvida()
	}
	return ok(mapa{"ok": true, "link": link, "invited": p.Email, "account": conta})
}

// msShareMany: várias pastas para vários e-mails ("Liberar setor"). Teto de 600 convites por chamada.
func (x *Proxy) msShareMany(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	const teto = 600
	pastas := pastasDoPedido(p.Items)
	var ems []string
	var brutos []any
	_ = json.Unmarshal(p.Emails, &brutos)
	for _, v := range brutos {
		if s, isStr := v.(string); isStr && s != "" {
			ems = append(ems, s)
		}
	}
	if len(pastas) == 0 || len(ems) == 0 {
		return erro(http.StatusBadRequest, "sem_items_ou_emails")
	}
	if r, ok := x.msPronto(ctx, "microsoft.shareMany"); !ok {
		return r
	}
	pg := papelGraph(p.Role)
	// Registra as pastas em acessos_recursos (a Auditoria reflete o que o Drive compartilhou). Melhor esforço.
	for _, it := range pastas {
		nome := ""
		if it.nome != nil {
			nome = *it.nome
		}
		if _, _, _, err := x.msRegistrar(ctx, it.id, nome, nil); err != nil {
			slog.Warn("acessos-proxy: microsoft.shareMany: registrar pasta", "erro", err)
		}
	}
	g := &grafo{x: x, ctx: ctx}
	certos, falhas, ops, truncado := 0, 0, 0, false
	linkPorPasta := map[string]*string{}
	contaPorEmail := map[string]*string{} // conta real resolvida por e-mail convidado
parar:
	for _, it := range pastas {
		for _, em := range ems {
			if ops >= teto || ctx.Err() != nil {
				truncado = true
				break parar
			}
			ops++
			r, err := convidar(g.chamar, it.id, em, pg)
			if err != nil {
				if g.fatal(err) {
					return msFalha("microsoft.shareMany", err)
				}
				falhas++
				continue
			}
			if !r.OK() {
				falhas++
				continue
			}
			certos++
			vs := valores[gPermissao](r)
			if _, tem := linkPorPasta[it.id]; !tem {
				linkPorPasta[it.id] = linkDaPasta(vs)
			}
			if _, tem := contaPorEmail[em]; !tem {
				var c *string
				if len(vs) > 0 {
					c = vs[0].contaResolvida()
				}
				contaPorEmail[em] = c
			}
		}
	}
	type resolvido struct {
		Invited string  `json:"invited"`
		Account *string `json:"account"`
	}
	resolved := []resolvido{}
	for _, em := range ems {
		resolved = append(resolved, resolvido{em, contaPorEmail[em]})
	}
	// link por pasta (cai para a leitura das permissões se o convite não trouxe)
	type linkDePasta struct {
		ID   string  `json:"id"`
		Name *string `json:"name"`
		Link *string `json:"link"`
	}
	links := []linkDePasta{}
	for _, it := range pastas {
		lk, tem := linkPorPasta[it.id]
		if !tem { // pulou (truncado): sem link
			continue
		}
		if lk == nil && ctx.Err() == nil {
			lk = linkAvulso(g.chamar, it.id)
		}
		links = append(links, linkDePasta{it.id, it.nome, lk})
	}
	// acessos_log.resultado só aceita ok/erro: o 'parcial' da edge vira 'erro' com o placar no detalhe (diverge da edge).
	res := "ok"
	if falhas > 0 {
		res = "erro"
	}
	x.trilha(ctx, e.ID, "onedrive.shareMany", "microsoft", nil, res, mapa{"items": len(pastas), "emails": len(ems), "ok": certos, "fail": falhas})
	return ok(mapa{"ok": certos, "fail": falhas, "ops": ops, "truncated": truncado, "links": links, "resolved": resolved})
}

// msAccessScan: varre a árvore de CADA marca (acessos_drive_marcas) e junta os acessos DEFINIDOS (não herdados) em cada
// pasta, sem depender de acessos_recursos. Limitada por profundidade (1..5, padrão 2) e 900 chamadas.
func (x *Proxy) msAccessScan(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	const callCap = 900
	if r, ok := x.msPronto(ctx, "microsoft.accessScan"); !ok {
		return r
	}
	prof := profundidade(p.Depth)
	type marca struct{ nome, id string }
	var marcas []marca
	linhas, err := x.Pool.Query(ctx, `select nome, external_id from acessos_drive_marcas order by ordem, nome`)
	if err != nil {
		return falhaInterna("microsoft.accessScan", err)
	}
	for linhas.Next() {
		var m marca
		if err := linhas.Scan(&m.nome, &m.id); err != nil {
			linhas.Close()
			return falhaInterna("microsoft.accessScan", err)
		}
		marcas = append(marcas, m)
	}
	// diverge da edge: erro ao ler as marcas é defeito, não "nenhuma marca" (a edge devolvia lista vazia calada).
	if err := linhas.Err(); err != nil {
		return falhaInterna("microsoft.accessScan", err)
	}
	type acesso struct {
		Email string `json:"email"`
		Name  string `json:"name"`
		Role  string `json:"role"`
		Marca string `json:"marca"`
		Pasta string `json:"pasta"`
	}
	type pasta struct{ id, nome string }
	items := []acesso{}
	chamadas, truncado := 0, false
	g := &grafo{x: x, ctx: ctx}
parar:
	for _, m := range marcas {
		if m.id == "" {
			continue
		}
		atual := []pasta{{m.id, m.nome}}
		for d := 0; float64(d) <= prof && len(atual) > 0; d++ {
			var prox []pasta
			for _, n := range atual {
				if chamadas >= callCap || ctx.Err() != nil {
					truncado = true
					break parar
				}
				chamadas++
				pr, err := g.chamar("GET", caminhoDoItem(n.id, "/permissions"), nil)
				if err != nil && g.fatal(err) {
					return msFalha("microsoft.accessScan", err)
				}
				if err == nil && pr.OK() {
					for _, pm := range valores[gPermissao](pr) {
						if pm.dono() || pm.herdada() { // só o grant DEFINIDO aqui (evita duplicar os herdados)
							continue
						}
						id := pm.identidade()
						if id.email == "" {
							continue
						}
						items = append(items, acesso{strings.ToLower(id.email), id.nome, pm.papel(), m.nome, n.nome})
					}
				}
				if float64(d) < prof && chamadas < callCap {
					chamadas++
					cr, err := g.chamar("GET", caminhoDoItem(n.id, "/children?$top=200&$select=id,name,folder"), nil)
					if err == nil && cr.OK() {
						for _, k := range pastasDe(valores[gItem](cr)) {
							prox = append(prox, pasta{k.ID, k.Name})
						}
					}
				}
			}
			atual = prox
		}
	}
	return ok(mapa{"items": items, "truncated": truncado, "depth": prof})
}

// msSharesMany: quem já tem acesso a um conjunto de pastas, agregado por pessoa (modal "Liberar setor").
func (x *Proxy) msSharesMany(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	pastas := pastasDoPedido(p.Items)
	if len(pastas) == 0 {
		return ok(mapa{"shares": []any{}, "total": 0})
	}
	if r, ok := x.msPronto(ctx, "microsoft.sharesMany"); !ok {
		return r
	}
	type pessoa struct {
		Name    string `json:"name"`
		Email   string `json:"email"`
		Role    string `json:"role"`
		Folders int    `json:"folders"`
	}
	porChave := map[string]*pessoa{}
	ordem := []*pessoa{} // ordem de chegada: o desempate do sort estável
	g := &grafo{x: x, ctx: ctx}
	for _, it := range pastas {
		if ctx.Err() != nil {
			break
		}
		r, err := g.chamar("GET", caminhoDoItem(it.id, "/permissions"), nil)
		if err != nil {
			if g.fatal(err) {
				return msFalha("microsoft.sharesMany", err)
			}
			continue
		}
		if !r.OK() {
			continue
		}
		for _, pm := range valores[gPermissao](r) {
			if pm.dono() {
				continue
			}
			id := pm.identidade()
			chave := strings.ToLower(id.email)
			if chave == "" {
				chave = strings.ToLower(id.nome)
			}
			if chave == "" {
				continue
			}
			papel := pm.papel()
			pe := porChave[chave]
			if pe == nil {
				pe = &pessoa{Name: id.nome, Email: id.email, Role: papel}
				porChave[chave] = pe
				ordem = append(ordem, pe)
			}
			pe.Folders++
			if papel == "edição" {
				pe.Role = "edição"
			}
		}
	}
	sort.SliceStable(ordem, func(i, j int) bool { return ordem[i].Folders > ordem[j].Folders })
	shares := make([]pessoa, 0, len(ordem))
	for _, pe := range ordem {
		shares = append(shares, *pe)
	}
	return ok(mapa{"shares": shares, "total": len(pastas)})
}

// msAllShares: todos os acessos de todas as pastas conhecidas (raízes das marcas + pastas registradas), para a Auditoria.
func (x *Proxy) msAllShares(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if r, ok := x.msPronto(ctx, "microsoft.allShares"); !ok {
		return r
	}
	type pastaVarrida struct {
		id, nome, externalID string
		raiz                 bool
		marca                *string
	}
	var pastas []pastaVarrida
	vistas := map[string]bool{}
	// Raízes das marcas primeiro (cobre o acesso por pessoa dado no topo da marca, que não está em acessos_recursos) e
	// depois as pastas registradas, sem repetir external_id.
	lm, err := x.Pool.Query(ctx, `select id::text, nome, external_id from acessos_drive_marcas order by ordem, nome`)
	if err != nil {
		return falhaInterna("microsoft.allShares", err)
	}
	for lm.Next() {
		var f pastaVarrida
		if err := lm.Scan(&f.id, &f.nome, &f.externalID); err != nil {
			lm.Close()
			return falhaInterna("microsoft.allShares", err)
		}
		if f.externalID != "" && !vistas[f.externalID] {
			vistas[f.externalID] = true
			f.raiz, f.marca = true, ptr(f.nome)
			pastas = append(pastas, f)
		}
	}
	if err := lm.Err(); err != nil {
		return falhaInterna("microsoft.allShares", err)
	}
	// DE PROPÓSITO sem filtro de arquivado_em, ao contrário das listagens: arquivar é decisão de ORGANIZAÇÃO (some do
	// painel) e não tira o acesso real de ninguém no OneDrive. A Auditoria existe para mostrar quem tem acesso DE
	// VERDADE; pular a pasta arquivada diria "ninguém tem acesso" enquanto as pessoas seguem entrando (ponto cego de
	// segurança). Pasta arquivada com acesso vivo é exatamente o que ela precisa mostrar.
	lr, err := x.Pool.Query(ctx, `select id::text, nome, external_id from acessos_recursos where tipo = 'onedrive'
		  and external_id is not null order by criado_em, id`)
	if err != nil {
		return falhaInterna("microsoft.allShares", err)
	}
	for lr.Next() {
		var f pastaVarrida
		if err := lr.Scan(&f.id, &f.nome, &f.externalID); err != nil {
			lr.Close()
			return falhaInterna("microsoft.allShares", err)
		}
		if f.externalID != "" && !vistas[f.externalID] {
			vistas[f.externalID] = true
			pastas = append(pastas, f)
		}
	}
	if err := lr.Err(); err != nil {
		return falhaInterna("microsoft.allShares", err)
	}
	type acesso struct {
		RecursoID string  `json:"recursoId"`
		Pasta     string  `json:"pasta"`
		Name      string  `json:"name"`
		Email     string  `json:"email"`
		Role      string  `json:"role"`
		IsRoot    bool    `json:"isRoot"`
		Marca     *string `json:"marca"`
		Inherited bool    `json:"inherited"`
	}
	type falha struct {
		Pasta  string `json:"pasta"`
		Motivo string `json:"motivo"`
	}
	items, falhas := []acesso{}, []falha{}
	g := &grafo{x: x, ctx: ctx}
	for _, f := range pastas {
		// A pasta que falhou vai NA RESPOSTA, não só no log: lista vazia sem falhas = "ninguém tem acesso"; lista vazia
		// com falhas = "não consegui olhar". Zero calado é lido como fato.
		if ctx.Err() != nil {
			falhas = append(falhas, falha{f.nome, "prazo_esgotado"})
			continue
		}
		r, err := g.chamar("GET", caminhoDoItem(f.externalID, "/permissions"), nil)
		if err != nil {
			if g.fatal(err) {
				return msFalha("microsoft.allShares", err)
			}
			falhas = append(falhas, falha{f.nome, "sem_resposta"})
			continue
		}
		if !r.OK() {
			falhas = append(falhas, falha{f.nome, "HTTP " + strconv.Itoa(r.Status)})
			continue
		}
		for _, pm := range valores[gPermissao](r) {
			if pm.dono() {
				continue
			}
			id := pm.identidade()
			items = append(items, acesso{f.id, f.nome, id.nome, strings.ToLower(id.email), pm.papel(), f.raiz, f.marca, pm.herdada()})
		}
	}
	return ok(mapa{"items": items, "falhas": falhas})
}

// msRevokeForEmail: tira o e-mail de TODAS as pastas onedrive conhecidas.
func (x *Proxy) msRevokeForEmail(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.Email == "" {
		return ok(mapa{"error": "sem_email"})
	}
	if r, ok := x.msPronto(ctx, "microsoft.revokeForEmail"); !ok {
		return r
	}
	// DE PROPÓSITO sem filtro de arquivado_em: aqui não se MOSTRA pasta, se TIRA acesso. Arquivar é decisão do painel e
	// não apaga a pasta nem o acesso real no OneDrive; filtrar deixaria um desligado enxergando a pasta arquivada de
	// verdade (buraco de segurança). Revogar tem de varrer tudo.
	// Mais as RAÍZES das marcas (acessos_drive_marcas): o grant dado no topo de uma marca (ex.: Moto Easy Brasil) não está
	// em acessos_recursos, e é o que a Auditoria (allShares) mostra; sem elas o desligado manteria o acesso (revisão Opus).
	linhas, err := x.Pool.Query(ctx, `select distinct on (external_id) nome, external_id from (
		  select nome, external_id from acessos_recursos where tipo = 'onedrive' and external_id is not null
		  union all select nome, external_id from acessos_drive_marcas where external_id is not null) t order by external_id, nome`)
	if err != nil {
		return falhaInterna("microsoft.revokeForEmail", err)
	}
	type pasta struct{ nome, id string }
	var pastas []pasta
	for linhas.Next() {
		var f pasta
		if err := linhas.Scan(&f.nome, &f.id); err != nil {
			linhas.Close()
			return falhaInterna("microsoft.revokeForEmail", err)
		}
		if f.id != "" {
			pastas = append(pastas, f)
		}
	}
	if err := linhas.Err(); err != nil {
		return falhaInterna("microsoft.revokeForEmail", err)
	}
	alvo := strings.ToLower(string(p.Email))
	removidos, falhas, truncado := 0, 0, false
	pastasTiradas := []string{}
	g := &grafo{x: x, ctx: ctx}
parar:
	for _, f := range pastas {
		if ctx.Err() != nil {
			truncado = true
			break
		}
		r, err := g.chamar("GET", caminhoDoItem(f.id, "/permissions"), nil)
		if err != nil || !r.OK() {
			if err != nil && g.fatal(err) {
				return msFalha("microsoft.revokeForEmail", err)
			}
			slog.Warn("acessos-proxy: revokeForEmail: falha ao ler permissões da pasta", "pasta", f.nome)
			falhas++
			continue
		}
		for _, pm := range valores[gPermissao](r) {
			if pm.dono() || pm.ID == "" || strings.ToLower(pm.identidade().email) != alvo {
				continue
			}
			if ctx.Err() != nil {
				truncado = true
				break parar
			}
			del, err := g.chamar("DELETE", caminhoDoItem(f.id, "/permissions/"+idNoCaminho(pm.ID)), nil)
			if err == nil && del.OK() {
				removidos++
				pastasTiradas = append(pastasTiradas, f.nome)
			} else {
				slog.Warn("acessos-proxy: revokeForEmail: DELETE falhou", "pasta", f.nome)
				falhas++
			}
		}
	}
	resultado := "ok"
	if falhas > 0 || truncado {
		resultado = "erro" // revogação incompleta não pode constar como feita
	}
	x.trilha(ctx, e.ID, "onedrive.revoke", "microsoft", ptr(string(p.Email)), resultado,
		strconv.Itoa(removidos)+" acessos, "+strconv.Itoa(falhas)+" falha(s)")
	resp := mapa{"removed": removidos, "folders": pastasTiradas}
	// diverge da edge: revogação parcial não pode parecer completa. Só aparecem quando acontecem.
	if falhas > 0 {
		resp["falhas"] = falhas
	}
	if truncado {
		resp["truncated"] = true
	}
	return ok(resp)
}

func (x *Proxy) msUnshare(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	if p.ItemID == "" || p.PermID == "" {
		return erro(http.StatusBadRequest, "sem_itemId_ou_permId")
	}
	r, err := x.MS.Grafo(ctx, "DELETE", caminhoDoItem(string(p.ItemID), "/permissions/"+idNoCaminho(string(p.PermID))), nil)
	if err != nil {
		return msFalha("microsoft.unshare", err)
	}
	if !r.OK() {
		x.trilha(ctx, e.ID, "onedrive.unshare", "microsoft", ptr(string(p.ItemID)), "erro",
			mapa{"permId": p.PermID, "status": r.Status, "detalhe": r.Corpo})
		return erroGrafo(r)
	}
	x.trilha(ctx, e.ID, "onedrive.unshare", "microsoft", ptr(string(p.ItemID)), "ok", mapa{"permId": p.PermID})
	return ok(mapa{"ok": true})
}
