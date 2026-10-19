// Package meta: Graph API da Meta (anúncios e Instagram), sempre pelo core
// (POST /api/interno/meta/graph, token global do core). Nenhum token da Meta passa por aqui.
package meta

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func erro(w http.ResponseWriter, status int, msg string) {
	responder(w, status, map[string]string{"error": msg})
}

// textoDe é o `${v}` do JS para um valor do corpo (id de conta, data em segundos...).
func textoDe(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	}
	return fmt.Sprint(v)
}

// Proxy é POST /meta-proxy {accountId, path, params, method, imageFromUrl, imageField,
// videoFromUrl}: porta do ramo CORE_META de supabase/functions/meta-proxy (viaCore).
// Deve vir DEPOIS de auth.Exigir + auth.ExigirModulo("meta").
type Proxy struct {
	Pool         *pgxpool.Pool
	Core         *core.Cliente
	HostsDeMidia []string // vazio = nenhum upload de mídia é aceito

	mu       sync.Mutex
	escritas map[string]time.Time // escrita igual em andamento ou de resultado incerto -> até quando vale a trava
}

// validadeEscritaIncerta: quanto tempo uma escrita sem resposta clara bloqueia a repetição idêntica.
const validadeEscritaIncerta = 2 * time.Minute

// reservar trava a escrita `chave` enquanto ela roda. Falso = já há uma igual em andamento ou de resultado
// incerto (o core ou a rede falhou depois de o pedido poder ter chegado à Meta): repetir criaria campanha,
// anúncio ou mídia em duplicidade, e a tela só repete porque não sabe se gravou.
// ponytail: memória deste processo (a API roda numa instância só); com mais de uma, mover para o banco.
func (p *Proxy) reservar(chave string, prazo time.Duration) (time.Time, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	agora := time.Now()
	for k, ate := range p.escritas {
		if agora.After(ate) {
			delete(p.escritas, k)
		}
	}
	if _, ocupada := p.escritas[chave]; ocupada {
		return time.Time{}, false
	}
	if p.escritas == nil {
		p.escritas = map[string]time.Time{}
	}
	dona := agora.Add(prazo + 10*time.Second)
	p.escritas[chave] = dona
	return dona, true
}

// concluir libera a trava; incerta a mantém por validadeEscritaIncerta. `dona` é o que reservar devolveu: se a
// reserva venceu e outra escrita igual a tomou, esta não mexe na dela.
func (p *Proxy) concluir(chave string, dona time.Time, incerta bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if !p.escritas[chave].Equal(dona) {
		return
	}
	if incerta {
		p.escritas[chave] = time.Now().Add(validadeEscritaIncerta)
	} else {
		delete(p.escritas, chave)
	}
}

// chaveDaEscrita identifica "a mesma escrita": quem pediu, em qual conta, o quê e com quais parâmetros/mídia.
func chaveDaEscrita(ator, conta string, ped core.PedidoMeta) string {
	params, _ := json.Marshal(ped.Parametros) // chaves de mapa saem ordenadas
	h := sha256.Sum256([]byte(strings.Join([]string{ator, conta, ped.Metodo, ped.Caminho, string(params), ped.ImagemURL, ped.ImagemCampo, ped.VideoURL}, "\x00")))
	return hex.EncodeToString(h[:])
}

// midiaPermitida fecha o SSRF: a URL de mídia só pode ser https, sem credenciais, num host
// da lista (u.Host inclui a porta: host:8443 não casa). Devolve a URL normalizada (u.String(),
// host em minúsculas como o `new URL` do edge): é ela, e não a bruta, que vai ao core.
func (p *Proxy) midiaPermitida(bruta string) (string, bool) {
	u, err := url.Parse(bruta)
	if err != nil || u.Scheme != "https" || u.User != nil {
		return "", false
	}
	u.Host = strings.ToLower(u.Host)
	if u.Host == "" || !slices.Contains(p.HostsDeMidia, u.Host) {
		return "", false
	}
	return u.String(), true
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID    any            `json:"accountId"`
		Path         string         `json:"path"`
		Params       map[string]any `json:"params"`
		Method       string         `json:"method"`
		ImageFromURL string         `json:"imageFromUrl"`
		ImageField   string         `json:"imageField"`
		VideoFromURL string         `json:"videoFromUrl"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)) // o core recusa parametros > 64 KB
	d.UseNumber()
	if err := d.Decode(&in); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			erro(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
			return
		}
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	conta := textoDe(in.AccountID)
	if conta == "" || conta == "0" || in.Path == "" {
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	if temParam(in.Params, "access_token") { // o pedido nunca troca o token do core, seja qual for a grafia
		erro(w, http.StatusBadRequest, "parametro nao permitido")
		return
	}
	metodo := strings.ToUpper(in.Method)
	escreve := metodo == "POST" || metodo == "DELETE" || in.ImageFromURL != "" || in.VideoFromURL != "" || temParam(in.Params, "method")
	ator := auth.AtorDoContexto(r.Context())
	if a := ator; escreve && (a == nil || a.ImpersonadorID != nil) {
		// Ruling 5.6-6: criar campanha, subir mídia e apagar na Meta gastam dinheiro em nome de alguém.
		responder(w, http.StatusForbidden, map[string]string{"error": "sem_permissao", "mensagem": dados.FraseEntrarComo})
		return
	}
	if !contaVisivel(r, conta) { // Ruling 34: conta que a pessoa não vê responde igual à que não existe
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	var adAcc, ig *string
	err := p.Pool.QueryRow(r.Context(), `select ad_account_id::text, instagram_id::text from accounts where id::text = $1`, conta).Scan(&adAcc, &ig)
	if errors.Is(err, pgx.ErrNoRows) {
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	if err != nil {
		slog.Error("meta-proxy: consulta de conta falhou", "erro", err)
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	texto := func(s *string) string {
		if s == nil {
			return ""
		}
		return *s
	}
	if !autz.VeTodasAsContas(autz.EscopoDo(r.Context())) && (!caminhoDaConta(in.Path, texto(adAcc), texto(ig)) || temParam(in.Params, "ids", "batch") || paramAlcancaOutraConta(in.Params)) {
		erro(w, http.StatusForbidden, "caminho fora da conta")
		return
	}
	// Igual ao edge: com imageFromUrl o vídeo é ignorado (nem validado nem encaminhado).
	var imagem, video string
	if in.ImageFromURL != "" {
		var ok bool
		if imagem, ok = p.midiaPermitida(in.ImageFromURL); !ok {
			erro(w, http.StatusBadRequest, "origem da imagem nao permitida")
			return
		}
	} else if in.VideoFromURL != "" {
		var ok bool
		if video, ok = p.midiaPermitida(in.VideoFromURL); !ok {
			erro(w, http.StatusBadRequest, "origem do video nao permitida")
			return
		}
	}
	ped := core.PedidoMeta{Caminho: in.Path, Metodo: "GET", Parametros: map[string]any{}}
	for k, v := range in.Params {
		if v != nil {
			ped.Parametros[k] = v
		}
	}
	if metodo == "POST" || metodo == "DELETE" {
		ped.Metodo = metodo
	}
	prazo := 25 * time.Second
	switch {
	case imagem != "":
		ped.Metodo, ped.ImagemURL, ped.ImagemCampo, prazo = "POST", imagem, in.ImageField, 45*time.Second
	case video != "":
		ped.Metodo, ped.VideoURL, prazo = "POST", video, 75*time.Second
	}
	ctx, cancela := context.WithTimeout(r.Context(), prazo)
	defer cancela()
	incerta := false
	if escreve {
		chave := chaveDaEscrita(ator.ID, conta, ped)
		dona, ok := p.reservar(chave, prazo)
		if !ok {
			// 500 de propósito: a tela trata string com status < 500 como "nada foi gravado" e deixaria repetir.
			erro(w, http.StatusInternalServerError, "uma escrita igual está em andamento ou terminou sem resposta clara: confira na Meta se ela foi gravada antes de repetir")
			return
		}
		incerta = true // padrão seguro (inclusive em pânico): só libera quando o desfecho é conhecido
		defer func() { p.concluir(chave, dona, incerta) }()
	}
	// Sem repetição aqui (tentativas = 1): o gestor e os robôs já tentam de novo.
	resp, err := p.Core.Meta(ctx, ped, 1)
	if errors.Is(err, core.ErrSemToken) {
		incerta = false // nunca saiu daqui
		erro(w, http.StatusServiceUnavailable, "core nao configurado")
		return
	}
	if err != nil {
		// só a causa (o cliente do core não põe o token em erro) e o caminho; nunca parametros.
		slog.Error("meta-proxy: sem resposta do core", "caminho", in.Path, "erro", err)
		erro(w, http.StatusInternalServerError, "falha ao falar com o core")
		return
	}
	incerta = resp.Status >= 500 // 5xx do core/Graph: pode ter gravado; < 500 é resposta definitiva (inclusive recusa da Graph)
	var j any
	dj := json.NewDecoder(bytes.NewReader(resp.Corpo))
	dj.UseNumber() // números da Graph saem como entraram
	if dj.Decode(&j) != nil {
		j = map[string]any{"raw": string(resp.Corpo)}
	}
	// Erro do PRÓPRIO core vem em `erro` e volta como STRING em `error`: o gestor classifica
	// por aí (barrado antes da Meta = status < 500; desistiu no meio = 500). Um 401/403 do core
	// (credencial da API, escopo) NUNCA sai como 401/403: o front leria "sessão expirada".
	obj, eObj := j.(map[string]any)
	barrado := resp.Status >= 400 && resp.Status < 500 && resp.Status != 401 && resp.Status != 403
	status := http.StatusInternalServerError
	if barrado {
		status = resp.Status
	}
	if e, ok := obj["erro"]; eObj && ok {
		if resp.Status == http.StatusTooManyRequests && resp.RetryAfter != "" {
			w.Header().Set("Retry-After", resp.RetryAfter)
		}
		erro(w, status, fmt.Sprint(e))
		return
	}
	_, temErro := obj["error"]
	if resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden || (resp.Status >= 400 && !(eObj && temErro)) {
		erro(w, status, fmt.Sprintf("core: %d", resp.Status))
		return
	}
	responder(w, resp.Status, j) // a Graph tal qual (inclusive {error:{...}} da Meta)
}
