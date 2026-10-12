package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// PrazoEntrarComo: a sessão de "entrar como" vale 1 h e NUNCA renova (Store.Buscar não
// renova sessão impersonada), como o token de acesso do Supabase que a edge entregava.
const PrazoEntrarComo = time.Hour

// reUUIDEntrarComo: id de alvo que não é UUID é "pessoa não encontrada" (nunca chega ao SQL).
var reUUIDEntrarComo = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// recusaDeEntrarComo: o contrato de erro da edge entrar-como-usuario (400 {"error": frase}),
// que a tela mostra como está.
func recusaDeEntrarComo(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// motivoDeRecusa é supabase/functions/_shared/checagem-de-entrar-como.js, na mesma ordem e com
// as mesmas frases (a primeira que bater é a que a pessoa lê).
func motivoDeRecusa(chamadorSuper, chamadorDesativado bool, chamadorID, alvoID string, alvoExiste, alvoDesativado bool) string {
	switch {
	case !chamadorSuper:
		return "Apenas super-admin pode entrar como outro usuário"
	case chamadorDesativado:
		return "Sua conta está desativada"
	case strings.EqualFold(chamadorID, alvoID): // UUID em maiúsculas é a mesma pessoa
		return "Você já é você — não precisa entrar como si mesmo"
	case !alvoExiste:
		return "Não encontrei essa pessoa"
	case alvoDesativado:
		return "Conta desativada — reative antes de entrar como ela"
	}
	return ""
}

// EntrarComo: POST /entrar-como-usuario {alvoId}. Só super-admin (pela ficha); a auditoria e a
// sessão nascem na MESMA transação (sem auditoria não há sessão, e sem sessão não sobra auditoria);
// a sessão nova é do alvo, marcada com o impersonador, vale 1 h e não renova. Sessão impersonada
// não encadeia. Resposta: {token, expira_em} (a edge devolvia access/refresh token do Supabase:
// o front muda no Plano 7).
func (c *Conta) EntrarComo(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		erroComMensagem(w, http.StatusForbidden, "sem_permissao", "Sua sessão já é de outra pessoa: saia dela antes de entrar como outra.")
		return
	}
	var in struct {
		AlvoID string `json:"alvoId"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if in.AlvoID == "" {
		recusaDeEntrarComo(w, "Faltou alvoId")
		return
	}
	// o portão vem ANTES de olhar o alvo (quem não é super-admin não aprende nada sobre quem existe).
	// Só a sessão de painel entra como outra pessoa: a de serviço, mesmo de conta super-admin, não
	// (a chave de serviço da edge nem passava no getUser).
	if !a.SuperAdmin || a.Tipo != "painel" {
		recusaDeEntrarComo(w, motivoDeRecusa(false, false, a.ID, in.AlvoID, false, false))
		return
	}
	ctx := r.Context()
	var alvoEmail string
	var alvoDesativado bool
	alvoID := in.AlvoID
	alvoExiste := reUUIDEntrarComo.MatchString(in.AlvoID)
	if alvoExiste {
		// p.id::text devolve o UUID normalizado (minúsculas): é ele que vai para a auditoria e a sessão
		err := c.Pool.QueryRow(ctx, `select p.id::text, u.email, coalesce(p.disabled, false) or u.desativado_em is not null
		     from profiles p join usuarios u on u.id = p.id where p.id = $1::uuid`, in.AlvoID).Scan(&alvoID, &alvoEmail, &alvoDesativado)
		if errors.Is(err, pgx.ErrNoRows) {
			alvoExiste = false
		} else if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
	}
	// o chamador tem sessão válida, então não está desativado (Store.Buscar recusaria)
	if msg := motivoDeRecusa(true, false, a.ID, alvoID, alvoExiste, alvoDesativado); msg != "" {
		recusaDeEntrarComo(w, msg)
		return
	}
	tx, err := c.Pool.Begin(ctx)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `insert into entradas_como_outro_usuario (admin_id, admin_email, alvo_id, alvo_email)
	    values ($1::uuid, (select email from usuarios where id = $1::uuid), $2::uuid, $3::text)`, a.ID, alvoID, alvoEmail); err != nil {
		slog.Error("entrar-como: auditoria falhou", "erro", err.Error())
		recusaDeEntrarComo(w, "Não consegui registrar a auditoria.")
		return
	}
	impersonador := a.ID
	token, expira, err := c.Sessoes.inserir(ctx, tx, alvoID, "painel", &impersonador, PrazoEntrarComo)
	if err != nil {
		slog.Error("entrar-como: sessão falhou", "erro", err.Error())
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if err := tx.Commit(ctx); err != nil {
		slog.Error("entrar-como: commit falhou", "erro", err.Error())
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	// o IP não tem coluna na tabela de produção: fica no log (nunca o token)
	slog.Info("entrar-como", "admin", a.ID, "alvo", alvoID, "ip", ipDe(r))
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token, "expira_em": expira.UTC().Format(time.RFC3339)})
}

// Conferência de senha: 5 erros seguidos bloqueiam por 10 min, por pessoa (como a edge).
// ponytail: em memória, uma instância só (a edge tinha o mesmo furo, aceito pelo dono); as
// marcas só existem para quem tem sessão válida, então o mapa é limitado pelo número de contas.
const (
	ErrosAteBloquear = 5
	Bloqueio         = 10 * time.Minute
)

// marcaDeConferencia é a contagem de UMA pessoa. A trava dela serializa as conferências da
// mesma pessoa: sem ela, 50 pedidos simultâneos passariam todos pela checagem do bloqueio antes
// de qualquer erro ser contado (a edge tinha esse furo: cada cópia dela atendia pedidos simultâneos sem trava).
type marcaDeConferencia struct {
	trava sync.Mutex
	erros int
	ate   time.Time
}

type conferencias struct {
	mu    sync.Mutex
	marca map[string]*marcaDeConferencia
	agora func() time.Time
}

func (cf *conferencias) da(id string) (*marcaDeConferencia, func() time.Time) {
	cf.mu.Lock()
	defer cf.mu.Unlock()
	if cf.marca == nil {
		cf.marca = map[string]*marcaDeConferencia{}
	}
	if cf.agora == nil {
		cf.agora = time.Now
	}
	m := cf.marca[id]
	if m == nil {
		m = &marcaDeConferencia{}
		cf.marca[id] = m
	}
	return m, cf.agora
}

func respostaConferir(w http.ResponseWriter, status int, corpo map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// ConferirSenha: POST /conferir-senha {senha}. A pessoa sai da SESSÃO, nunca do corpo (não é
// oráculo de senha alheia); responde só sim ou não, com o contrato da edge conferir-senha.
// Sessão de "entrar como" não assina pelo alvo (nem gasta contagem dele).
func (c *Conta) ConferirSenha(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		erroComMensagem(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não confere senha por ela.")
		return
	}
	var in struct {
		Senha any `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	senha, _ := in.Senha.(string)

	m, relogio := c.conferir.da(a.ID)
	m.trava.Lock()
	defer m.trava.Unlock()
	agora := relogio()
	if m.ate.After(agora) {
		respostaConferir(w, http.StatusTooManyRequests, map[string]any{"ok": false, "erro": "bloqueado",
			"bloqueado_ate": m.ate.UTC().Format("2006-01-02T15:04:05.000Z")})
		return
	}
	if senha == "" {
		respostaConferir(w, http.StatusBadRequest, map[string]any{"ok": false, "erro": "sem_senha"})
		return
	}
	var hash string
	err := c.Pool.QueryRow(r.Context(), `select coalesce(senha_hash, '') from usuarios where id = $1::uuid`, a.ID).Scan(&hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		slog.Error("conferir-senha: leitura falhou", "erro", err.Error())
		respostaConferir(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_interna"})
		return
	}
	// sem senha cadastrada: gasta o mesmo bcrypt e responde como senha errada (nada a revelar)
	if hash == "" {
		hash = hashFalso
	}
	if !SenhaConfere(hash, senha) || hash == hashFalso {
		m.erros++
		if m.erros >= ErrosAteBloquear {
			m.ate = agora.Add(Bloqueio)
		}
		respostaConferir(w, http.StatusOK, map[string]any{"ok": false, "erro": "senha_incorreta", "restam": max(0, ErrosAteBloquear-m.erros)})
		return
	}
	m.erros, m.ate = 0, time.Time{}
	respostaConferir(w, http.StatusOK, map[string]any{"ok": true})
}
