package acessos

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/conexoes"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// As 14 ações zoho.* do acessos-proxy. Segredos e token ficam dentro de internal/zoho.

func init() {
	for nome, a := range map[string]acao{
		"zoho.status":  {(*Proxy).zohoStatus, false},
		"zoho.authUrl": {(*Proxy).zohoAuthURL, true},
		"zoho.users":   {(*Proxy).zohoUsers, false},
		"zoho.import":  {(*Proxy).zohoImport, true},
		"zoho.suspend": {func(x *Proxy, c context.Context, e *autz.Escopo, p pedido) resposta {
			return x.zohoSetUser(c, e, p, "disableUser")
		}, true},
		"zoho.reactivate": {func(x *Proxy, c context.Context, e *autz.Escopo, p pedido) resposta {
			return x.zohoSetUser(c, e, p, "enableUser")
		}, true},
		"zoho.create":                {(*Proxy).zohoCreate, true},
		"zoho.pastas":                {(*Proxy).zohoPastas, false},
		"zoho.importarPastas":        {(*Proxy).zohoImportarPastas, true},
		"zoho.acessoDaPasta":         {(*Proxy).zohoAcessoDaPasta, false},
		"zoho.criarLink":             {(*Proxy).zohoCriarLink, true},
		"zoho.apagarLink":            {(*Proxy).zohoApagarLink, true},
		"zoho.compartilharWorkspace": {(*Proxy).zohoCompartilharWorkspace, true},
		"zoho.revogarWorkspace":      {(*Proxy).zohoRevogarWorkspace, true},
	} {
		acoes[nome] = a
	}
}

// ---- JSON solto do Zoho (campos que variam por tenant: leitura defensiva, como a edge) ----

func objeto(b []byte) map[string]any {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var m map[string]any
	if d.Decode(&m) != nil {
		return nil
	}
	return m
}

// no desce por chaves de objetos; qualquer elo ausente dá nil.
func no(v any, chaves ...string) any {
	for _, c := range chaves {
		m, _ := v.(map[string]any)
		if m == nil {
			return nil
		}
		v = m[c]
	}
	return v
}

func verdadeiro(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case json.Number:
		return x.String() != "0"
	}
	return true
}

// primeiro: o `a || b || c` do JS.
func primeiro(vs ...any) any {
	for _, v := range vs {
		if verdadeiro(v) {
			return v
		}
	}
	return nil
}

func cortar(b []byte, n int) string {
	if len(b) <= n {
		return string(b)
	}
	b = b[:n]
	for len(b) > 0 && !utf8.Valid(b) {
		b = b[:len(b)-1]
	}
	return string(b)
}

// comZoho: a conexão com refresh_token, ou "nao_conectado" (200 {error}) como a edge.
func (x *Proxy) comZoho(ctx context.Context, nome string, f func(zoho.Conexao) resposta) resposta {
	con, err := x.Zoho.Conexao(ctx)
	if errors.Is(err, zoho.ErrDesconectado) {
		return naoConectado
	}
	if err != nil {
		return falhaInterna(nome, err)
	}
	return f(con)
}

func (x *Proxy) zohoStatus(ctx context.Context, _ *autz.Escopo, _ pedido) resposta {
	s, err := x.Zoho.Estado(ctx)
	if err != nil {
		return falhaInterna("zoho.status", err)
	}
	return ok(mapa{"connected": s.Conectado, "org_id": s.OrgID, "conectado_em": s.ConectadoEm})
}

func (x *Proxy) zohoAuthURL(ctx context.Context, _ *autz.Escopo, _ pedido) resposta {
	if x.APIPublica == "" {
		return erro(http.StatusInternalServerError, "api_url_publica_ausente")
	}
	u, err := x.Zoho.URLDeConsentimento(ctx, x.callback("zoho"))
	if errors.Is(err, conexoes.ErrSemConexao) || errors.Is(err, zoho.ErrDesconectado) {
		return erroComDetalhe(http.StatusInternalServerError, "falha_ao_gravar_state", "conexao_zoho_inexistente")
	}
	if err != nil {
		return falhaInterna("zoho.authUrl", err)
	}
	return ok(mapa{"url": u})
}

// ---- usuários (Zoho Mail) ----

type usuarioZoho struct {
	AccountID string  `json:"accountId"`
	Zuid      *string `json:"zuid"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	mailbox   string
}

// listarUsuarios pagina /api/organization/accounts (sem zoid no caminho: é a organização da conexão).
func (x *Proxy) listarUsuarios(ctx context.Context, con zoho.Conexao) ([]usuarioZoho, int, error) {
	out := []usuarioZoho{}
	raw := 0
	const limite = 50
	for pagina, inicio := 0, 0; pagina < 200; pagina, inicio = pagina+1, inicio+limite {
		r, err := x.Zoho.Chamar(ctx, con, zoho.Pedido{Metodo: http.MethodGet, Servico: zoho.Mail,
			Caminho: fmt.Sprintf("/api/organization/accounts?start=%d&limit=%d", inicio, limite)})
		if err != nil {
			return nil, 0, err
		}
		if r.Status/100 != 2 {
			return nil, 0, fmt.Errorf("zoho_users_http_%d", r.Status)
		}
		corpo := objeto(r.Corpo)
		if corpo == nil {
			return nil, 0, errors.New("zoho_users_parse")
		}
		dados, _ := corpo["data"].([]any)
		raw += len(dados)
		for _, d := range dados {
			u, _ := d.(map[string]any)
			id := texto0(primeiro(u["accountId"], u["zuid"], u["account_id"], u["zid"]))
			if id == "" {
				continue
			}
			nome := strings.TrimSpace(texto0(primeiro(strings.TrimSpace(texto0(u["displayName"])), strings.TrimSpace(texto0(u["accountDisplayName"])))))
			if nome == "" {
				nome = strings.TrimSpace(strings.Join(nonEmpty(texto0(u["firstName"]), texto0(u["lastName"])), " "))
			}
			email := texto0(primeiro(u["primaryEmailAddress"], u["mailboxAddress"]))
			if email == "" {
				if lista, _ := u["emailAddress"].([]any); len(lista) > 0 {
					escolhido := lista[0]
					for _, e := range lista {
						if verdadeiro(no(e, "isPrimary")) {
							escolhido = e
							break
						}
					}
					email = texto0(primeiro(no(escolhido, "mailId"), no(escolhido, "emailAddress")))
				}
			}
			if nome == "" {
				nome = email
			}
			var zuid *string
			if z := u["zuid"]; z != nil {
				s := texto0(z)
				zuid = &s
			}
			out = append(out, usuarioZoho{AccountID: id, Zuid: zuid, Name: nome, Email: email, mailbox: texto0(u["mailboxAddress"])})
		}
		if len(dados) < limite {
			break
		}
	}
	return out, raw, nil
}

func nonEmpty(ss ...string) []string {
	var o []string
	for _, s := range ss {
		if s != "" {
			o = append(o, s)
		}
	}
	return o
}

func (x *Proxy) zohoUsers(ctx context.Context, _ *autz.Escopo, _ pedido) resposta {
	return x.comZoho(ctx, "zoho.users", func(con zoho.Conexao) resposta {
		us, raw, err := x.listarUsuarios(ctx, con)
		if err != nil {
			return falhaInterna("zoho.users", err)
		}
		return ok(mapa{"count": raw, "users": us})
	})
}

// hashDeBytes: FNV-1a de 32 bits em hex de 8 casas, o mesmo da edge: impressão digital da foto para a URL (?v=) mudar
// quando a foto muda e só então.
func hashDeBytes(b []byte) string {
	h := fnv.New32a()
	h.Write(b)
	return fmt.Sprintf("%08x", h.Sum32())
}

const travaDoImport = 7_070_707 // pg_advisory_lock: dois cliques/abas no "Importar" não rodam juntos (zoho_account_id não é único)

func (x *Proxy) zohoImport(ctx context.Context, e *autz.Escopo, _ pedido) resposta {
	return x.comZoho(ctx, "zoho.import", func(con zoho.Conexao) resposta {
		us, _, err := x.listarUsuarios(ctx, con)
		if err != nil {
			return falhaInterna("zoho.import", err)
		}
		cx, err := x.Pool.Acquire(ctx)
		if err != nil {
			return falhaInterna("zoho.import", err)
		}
		defer cx.Release()
		var livre bool
		if err := cx.QueryRow(ctx, `select pg_try_advisory_lock($1)`, travaDoImport).Scan(&livre); err != nil {
			return falhaInterna("zoho.import", err)
		}
		if !livre {
			return erro(http.StatusConflict, "importacao_em_andamento")
		}
		defer cx.Exec(context.WithoutCancel(ctx), `select pg_advisory_unlock($1)`, travaDoImport)

		var criados, atualizados, comFoto, fotosFalhas, erros int
		for _, u := range us {
			if ctx.Err() != nil {
				erros++
				continue
			}
			var id string
			err := cx.QueryRow(ctx, `select id::text from acessos_pessoas where zoho_account_id = $1 limit 1`, u.AccountID).Scan(&id)
			switch {
			case err == nil:
				_, err = cx.Exec(ctx, `update acessos_pessoas set nome = coalesce(nullif($2, ''), nome),
					email_corporativo = coalesce(nullif($3, ''), email_corporativo), atualizado_em = now() where id = $1::uuid`, id, u.Name, u.Email)
				if err == nil {
					atualizados++
				}
			case errors.Is(err, pgx.ErrNoRows):
				nome := u.Name
				if nome == "" {
					nome = u.Email
				}
				if nome == "" {
					nome = "Sem nome"
				}
				err = cx.QueryRow(ctx, `insert into acessos_pessoas (nome, email_corporativo, status, setor_id, zoho_account_id)
					values ($1, nullif($2, ''), 'ativo', null, $3) returning id::text`, nome, u.Email, u.AccountID).Scan(&id)
				if err == nil {
					criados++
				}
			}
			if err != nil {
				erros++
				continue
			}
			if u.Zuid == nil {
				continue
			}
			// foto: melhor esforço (o endereço do Mail não tem foto; o do Contacts devolve a miniatura)
			r, err := x.Zoho.Chamar(ctx, con, zoho.Pedido{Metodo: http.MethodGet, Servico: zoho.Contatos,
				Caminho: "/file?ID=" + url.QueryEscape(*u.Zuid) + "&fs=thumb"})
			tipo := strings.TrimSpace(strings.SplitN(r.Tipo, ";", 2)[0])
			if err != nil || r.Status/100 != 2 || !strings.HasPrefix(strings.ToLower(tipo), "image/") || len(r.Corpo) == 0 {
				continue // sem foto
			}
			ext := "jpg"
			if strings.Contains(tipo, "png") {
				ext = "png"
			}
			if x.Fotos == nil {
				fotosFalhas++
				continue
			}
			urlFoto, err := x.Fotos.Gravar(ctx, id+"."+ext, tipo, r.Corpo)
			if err == nil {
				_, err = cx.Exec(ctx, `update acessos_pessoas set avatar_url = $2 where id = $1::uuid`, id, urlFoto+"?v="+hashDeBytes(r.Corpo))
			}
			if err != nil {
				fotosFalhas++
				continue
			}
			comFoto++
		}
		resumo := mapa{"criados": criados, "atualizados": atualizados, "com_foto": comFoto, "fotos_falhas": fotosFalhas, "erros": erros, "total": len(us)}
		res := "ok"
		if erros > 0 {
			res = "erro" // o banco só aceita ok/erro
		}
		x.trilha(ctx, e.ID, "zoho.import", "zoho", ptr("acessos_pessoas"), res, resumo)
		return ok(resumo)
	})
}

// zohoSetUser: suspende/reativa a caixa pelo e-mail (PUT /api/organization/accounts/<accountId> {mode, zuid}).
func (x *Proxy) zohoSetUser(ctx context.Context, e *autz.Escopo, p pedido, modo string) resposta {
	falhou := func(d any) resposta { return ok(mapa{"error": "zoho_" + modo + "_falhou", "detalhe": d}) }
	if p.Email == "" {
		return ok(mapa{"error": "sem_email"})
	}
	return x.comZoho(ctx, "zoho."+modo, func(con zoho.Conexao) resposta {
		us, _, err := x.listarUsuarios(ctx, con)
		if err != nil {
			return falhou(err.Error())
		}
		alvo := strings.ToLower(string(p.Email))
		var u *usuarioZoho
		for i := range us {
			if strings.ToLower(us[i].Email) == alvo || strings.ToLower(us[i].mailbox) == alvo {
				u = &us[i]
				break
			}
		}
		if u == nil {
			return ok(mapa{"error": "usuario_zoho_nao_encontrado"})
		}
		zuid := ""
		if u.Zuid != nil {
			zuid = *u.Zuid
		}
		corpo, _ := json.Marshal(mapa{"mode": modo, "zuid": zuid})
		r, err := x.Zoho.Chamar(ctx, con, zoho.Pedido{Metodo: http.MethodPut, Servico: zoho.Mail,
			Caminho: "/api/organization/accounts/" + idNoCaminho(u.AccountID), Corpo: corpo})
		if err != nil {
			return falhou(err.Error())
		}
		st := no(objeto(r.Corpo), "status")
		code := texto0(no(st, "code"))
		if r.Status/100 != 2 || (code != "200" && code != "201") {
			var d any = fmt.Sprintf("http %d %s", r.Status, cortar(r.Corpo, 300))
			if st != nil {
				d = st
			}
			return falhou(d)
		}
		acao := "zoho.suspend"
		if modo == "enableUser" {
			acao = "zoho.reactivate"
		}
		x.trilha(ctx, e.ID, acao, "zoho", ptr(string(p.Email)), "ok", mapa{"accountId": u.AccountID, "zuid": zuid, "mode": modo})
		return ok(mapa{"ok": true, "accao": modo})
	})
}

// zohoCreate: abre uma caixa nova (onboarding).
func (x *Proxy) zohoCreate(ctx context.Context, e *autz.Escopo, p pedido) resposta {
	email := strings.TrimSpace(string(p.Email))
	if email == "" || p.Password == "" {
		return ok(mapa{"error": "email_e_senha_obrigatorios"})
	}
	return x.comZoho(ctx, "zoho.create", func(con zoho.Conexao) resposta {
		corpo, _ := json.Marshal(mapa{"primaryEmailAddress": email, "password": string(p.Password),
			"firstName": string(p.FirstName), "lastName": string(p.LastName), "role": "member"})
		r, err := x.Zoho.Chamar(ctx, con, zoho.Pedido{Metodo: http.MethodPost, Servico: zoho.Mail, Caminho: "/api/organization/accounts", Corpo: corpo})
		if err != nil {
			return ok(mapa{"error": "zoho_create_falhou", "detalhe": err.Error()})
		}
		j := objeto(r.Corpo)
		code := texto0(no(j, "status", "code"))
		if r.Status/100 == 2 && (code == "201" || code == "200") {
			var accountID, zuid any
			if v := no(j, "data", "accountId"); verdadeiro(v) {
				accountID = texto0(v)
			}
			if v := no(j, "data", "zuid"); verdadeiro(v) {
				zuid = texto0(v)
			}
			x.trilha(ctx, e.ID, "zoho.create", "zoho", ptr(email), "ok", mapa{"accountId": accountID, "zuid": zuid})
			return ok(mapa{"ok": true, "email": email, "accountId": accountID, "zuid": zuid})
		}
		var d any = fmt.Sprintf("http %d", r.Status)
		if m := no(j, "data", "moreInfo"); verdadeiro(m) {
			d = m
		}
		return ok(mapa{"error": "zoho_create_falhou", "detalhe": d})
	})
}

// ---- WorkDrive ----

func (x *Proxy) wd(ctx context.Context, con zoho.Conexao, metodo, caminho string, corpo any) (zoho.Resposta, map[string]any, error) {
	var b []byte
	if corpo != nil {
		b, _ = json.Marshal(corpo)
	}
	r, err := x.Zoho.Chamar(ctx, con, zoho.Pedido{Metodo: metodo, Servico: zoho.WorkDrive, Caminho: caminho, Corpo: b})
	if err != nil {
		return r, nil, err
	}
	return r, objeto(r.Corpo), nil
}

// wdColetar: cada pasta de equipe e as pastas de dentro dela (um nível de propósito: são ~2000 no fundo).
func (x *Proxy) wdColetar(ctx context.Context, con zoho.Conexao) (linhas []linhaRecurso, equipes int, err error) {
	r, j, err := x.wd(ctx, con, http.MethodGet, "/users/me", nil)
	if err != nil {
		return nil, 0, err
	}
	if r.Status/100 != 2 {
		return nil, 0, fmt.Errorf("zoho: workdrive_users_me_http_%d", r.Status)
	}
	org := texto0(primeiro(no(j, "data", "attributes", "last_viewed_org_info", "org_id"), no(j, "data", "attributes", "preferred_org_info", "org_id")))
	if org == "" {
		return nil, 0, errors.New("zoho: workdrive_sem_org_id")
	}
	r, j, err = x.wd(ctx, con, http.MethodGet, "/teams/"+idNoCaminho(org)+"/teamfolders", nil)
	if err != nil {
		return nil, 0, err
	}
	if r.Status/100 != 2 {
		return nil, 0, fmt.Errorf("zoho: workdrive_teamfolders_http_%d", r.Status)
	}
	times := pastasDoWorkdrive(j)
	for _, tf := range times {
		linhas = append(linhas, linhasDeRecursos([]pastaWD{tf}, tf.externalID, "")...) // a pasta de equipe é a raiz do cliente
		rf, jf, err := x.wd(ctx, con, http.MethodGet, "/teamfolders/"+idNoCaminho(tf.externalID)+"/folders", nil)
		if err != nil {
			return nil, 0, err
		}
		if rf.Status/100 != 2 {
			continue // uma pasta de equipe que falha não derruba a listagem inteira
		}
		linhas = append(linhas, linhasDeRecursos(pastasDoWorkdrive(jf), tf.externalID, tf.nome)...)
	}
	return linhas, len(times), nil
}

// jaGravados: external_id de toda pasta workdrive, ARQUIVADA inclusive (é "já importei?", não listagem).
func (x *Proxy) jaGravados(ctx context.Context) ([]string, error) {
	rows, err := x.Pool.Query(ctx, `select external_id from acessos_recursos where tipo = 'workdrive' and external_id is not null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (x *Proxy) zohoPastas(ctx context.Context, _ *autz.Escopo, _ pedido) resposta {
	return x.comZoho(ctx, "zoho.pastas", func(con zoho.Conexao) resposta {
		linhas, equipes, err := x.wdColetar(ctx, con)
		if err != nil {
			return falhaInterna("zoho.pastas", err)
		}
		gravados, err := x.jaGravados(ctx)
		if err != nil {
			return falhaInterna("zoho.pastas", err)
		}
		novas, _ := separarNovas(linhas, gravados)
		eNova := map[string]bool{}
		for _, n := range novas {
			eNova[n.ExternalID] = true
		}
		pastas := make([]mapa, 0, len(linhas))
		for _, l := range linhas {
			pastas = append(pastas, mapa{"nome": l.Nome, "caminho": l.Caminho, "external_id": l.ExternalID, "drive_id": l.DriveID, "jaImportada": !eNova[l.ExternalID]})
		}
		return ok(mapa{"pastasDeEquipe": equipes, "total": len(linhas), "novas": len(novas), "jaImportadas": len(linhas) - len(novas), "pastas": pastas})
	})
}

func (x *Proxy) zohoImportarPastas(ctx context.Context, e *autz.Escopo, _ pedido) resposta {
	return x.comZoho(ctx, "zoho.importarPastas", func(con zoho.Conexao) resposta {
		linhas, _, err := x.wdColetar(ctx, con)
		if err != nil {
			return falhaInterna("zoho.importarPastas", err)
		}
		gravados, err := x.jaGravados(ctx)
		if err != nil {
			return falhaInterna("zoho.importarPastas", err)
		}
		novas, ja := separarNovas(linhas, gravados)
		criadas := 0
		// tudo ou nada, como o insert em lote da edge; o índice único parcial garante a idempotência com dois cliques juntos
		err = pgx.BeginFunc(ctx, x.Pool, func(tx pgx.Tx) error {
			for _, n := range novas {
				tag, err := tx.Exec(ctx, `insert into acessos_recursos (tipo, provedor, nome, external_id, drive_id, caminho)
					values ('workdrive', 'zoho', $1, $2, $3, $4) on conflict (external_id) where tipo = 'workdrive' and external_id is not null do nothing`,
					n.Nome, n.ExternalID, n.DriveID, n.Caminho)
				if err != nil {
					return err
				}
				criadas += int(tag.RowsAffected())
			}
			return nil
		})
		if err != nil {
			x.trilha(ctx, e.ID, "zoho.importarPastas", "zoho", ptr("acessos_recursos"), "erro", mapa{"detalhe": "falha_ao_inserir", "tentadas": len(novas)})
			return erroComDetalhe(http.StatusInternalServerError, "falha_ao_inserir", "falha ao gravar as pastas")
		}
		resumo := mapa{"criadas": criadas, "jaExistiam": len(ja) + len(novas) - criadas, "total": len(linhas), "erros": 0}
		x.trilha(ctx, e.ID, "zoho.importarPastas", "zoho", ptr("acessos_recursos"), "ok", resumo)
		return ok(resumo)
	})
}

// wdTraduzirEscopo: o "type" da permissão do WorkDrive em palavras (o cru vai junto em escopo_cru).
func wdTraduzirEscopo(tipo string) string {
	switch tipo {
	case "user":
		return "Pessoa específica"
	case "workspace":
		return "Todo o time (workspace)"
	case "everyone":
		return "Qualquer um do time"
	case "team":
		return "Equipe"
	case "":
		return "?"
	}
	return "Outro (" + tipo + ")"
}

func (x *Proxy) zohoAcessoDaPasta(ctx context.Context, _ *autz.Escopo, p pedido) resposta {
	return x.comZoho(ctx, "zoho.acessoDaPasta", func(con zoho.Conexao) resposta {
		if p.ResourceID == "" {
			return erro(http.StatusBadRequest, "faltou_resourceId")
		}
		rid := idNoCaminho(string(p.ResourceID))
		falhas := []mapa{}
		pessoas := []mapa{}
		rp, jp, err := x.wd(ctx, con, http.MethodGet, "/files/"+rid+"/permissions", nil)
		switch {
		case err != nil:
			return falhaInterna("zoho.acessoDaPasta", err)
		case rp.Status/100 == 2:
			dados, _ := jp["data"].([]any)
			for _, d := range dados {
				a, info := no(d, "attributes"), no(d, "attributes", "share_to_entity_info")
				pessoas = append(pessoas, mapa{
					"id":                no(d, "id"),
					"nome":              orInterrogacao(primeiro(no(info, "display_name"), no(a, "shared_by"), no(a, "email_id"))),
					"email":             strings.ToLower(texto0(primeiro(no(info, "email_id"), no(a, "email_id")))),
					"escopo":            wdTraduzirEscopo(texto0(no(a, "type"))),
					"escopo_cru":        no(a, "type"),
					"compartilhado_por": no(a, "shared_by"),
					"expira_em_millis":  zeroSeNulo(no(a, "expiry_in_millis")),
				})
			}
		default:
			falhas = append(falhas, mapa{"o_que": "quem tem acesso", "status": rp.Status})
		}
		links := []mapa{}
		rl, jl, err := x.wd(ctx, con, http.MethodGet, "/files/"+rid+"/links", nil)
		switch {
		case err != nil:
			return falhaInterna("zoho.acessoDaPasta", err)
		case rl.Status/100 == 2:
			dados, _ := jl["data"].([]any)
			for _, d := range dados {
				a := no(d, "attributes")
				links = append(links, mapa{
					"id":               no(d, "id"),
					"url":              primeiroNaoNulo(no(a, "link"), no(a, "download_url")),
					"nome":             no(a, "link_name"),
					"permite_download": no(a, "allow_download"),
					"tem_senha":        verdadeiro(primeiroNaoNulo(no(a, "is_password_protected"), no(a, "password_protected"))),
					"expira_em":        primeiro(no(a, "expiration_date")),
				})
			}
		default:
			falhas = append(falhas, mapa{"o_que": "links da pasta", "status": rl.Status})
		}
		return ok(mapa{"resourceId": string(p.ResourceID), "pessoas": pessoas, "links": links, "falhas": falhas})
	})
}

func orInterrogacao(v any) any {
	if v == nil {
		return "?"
	}
	return v
}

func zeroSeNulo(v any) any {
	if v == nil {
		return 0
	}
	return v
}

// primeiroNaoNulo: o `a ?? b` do JS (só nulo/ausente cai para o próximo).
func primeiroNaoNulo(vs ...any) any {
	for _, v := range vs {
		if v != nil {
			return v
		}
	}
	return nil
}

// ---- WorkDrive: escritas (cada uma faz UMA coisa, com entrada validada; não é relay genérico) ----

func wdRoleID(papel texto) string {
	if papel == "edicao" || papel == "edição" {
		return "5"
	}
	return "6"
}

// wdEscrever: 2xx = (corpo, true); senão 502 com o status do Zoho e 300 bytes do corpo (sem segredo).
func (x *Proxy) wdEscrever(ctx context.Context, con zoho.Conexao, metodo, caminho string, corpo any, codigo string) (map[string]any, *resposta) {
	r, j, err := x.wd(ctx, con, metodo, caminho, corpo)
	if err != nil {
		f := falhaInterna(codigo, err)
		return nil, &f
	}
	if r.Status/100 != 2 {
		f := resposta{http.StatusBadGateway, mapa{"error": codigo, "status": r.Status, "detalhe": cortar(r.Corpo, 300)}}
		return nil, &f
	}
	return j, nil
}

func (x *Proxy) zohoCriarLink(ctx context.Context, _ *autz.Escopo, p pedido) resposta {
	return x.comZoho(ctx, "zoho.criarLink", func(con zoho.Conexao) resposta {
		if p.ResourceID == "" {
			return erro(http.StatusBadRequest, "faltou_resourceId")
		}
		// corpo COMPLETO de propósito: o mínimo dá 500 no Zoho (descoberto na sondagem de 2026-07)
		j, f := x.wdEscrever(ctx, con, http.MethodPost, "/links", mapa{"data": mapa{"type": "links", "attributes": mapa{
			"resource_id": string(p.ResourceID), "role_id": wdRoleID(p.Papel), "link_name": "Link de compartilhamento",
			"allow_download": true, "request_user_data": false}}}, "falha_ao_criar_link")
		if f != nil {
			return *f
		}
		return ok(mapa{"ok": true, "id": no(j, "data", "id"), "url": no(j, "data", "attributes", "link")})
	})
}

func (x *Proxy) zohoApagarLink(ctx context.Context, _ *autz.Escopo, p pedido) resposta {
	return x.comZoho(ctx, "zoho.apagarLink", func(con zoho.Conexao) resposta {
		if p.LinkID == "" {
			return erro(http.StatusBadRequest, "faltou_linkId")
		}
		// a listagem do Zoho demora a refletir o apagar: a tela confia neste ok, não na listagem imediata
		if _, f := x.wdEscrever(ctx, con, http.MethodDelete, "/links/"+idNoCaminho(string(p.LinkID)), nil, "falha_ao_apagar_link"); f != nil {
			return *f
		}
		return ok(mapa{"ok": true})
	})
}

func (x *Proxy) zohoCompartilharWorkspace(ctx context.Context, _ *autz.Escopo, p pedido) resposta {
	return x.comZoho(ctx, "zoho.compartilharWorkspace", func(con zoho.Conexao) resposta {
		if p.ResourceID == "" {
			return erro(http.StatusBadRequest, "faltou_resourceId")
		}
		j, f := x.wdEscrever(ctx, con, http.MethodPost, "/permissions", mapa{"data": mapa{"type": "permissions", "attributes": mapa{
			"resource_id": string(p.ResourceID), "shared_type": "everyone", "role_id": wdRoleID(p.Papel)}}}, "falha_ao_compartilhar")
		if f != nil {
			return *f
		}
		return ok(mapa{"ok": true, "id": no(j, "data", "id")})
	})
}

func (x *Proxy) zohoRevogarWorkspace(ctx context.Context, _ *autz.Escopo, p pedido) resposta {
	return x.comZoho(ctx, "zoho.revogarWorkspace", func(con zoho.Conexao) resposta {
		if p.PermissaoID == "" {
			return erro(http.StatusBadRequest, "faltou_permissaoId")
		}
		if _, f := x.wdEscrever(ctx, con, http.MethodDelete, "/permissions/"+idNoCaminho(string(p.PermissaoID)), nil, "falha_ao_revogar"); f != nil {
			return *f
		}
		return ok(mapa{"ok": true})
	})
}
