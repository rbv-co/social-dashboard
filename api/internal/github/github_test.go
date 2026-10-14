package github

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

const uuidA = "0a1b2c3d-0000-4000-8000-0123456789ab"

type pedido struct {
	Metodo, Caminho string
	Cab             http.Header
	Corpo           string
}

// falso é o GitHub de mentira: guarda cada pedido e responde o status e os cabeçalhos do caso.
type falso struct {
	*httptest.Server
	mu      sync.Mutex
	pedidos []pedido
}

func (f *falso) n() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pedidos)
}

func novoFalso(t *testing.T, status int, cab map[string]string) *falso {
	t.Helper()
	f := &falso{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := new(bytes.Buffer)
		b.ReadFrom(r.Body)
		f.mu.Lock()
		f.pedidos = append(f.pedidos, pedido{r.Method, r.URL.Path, r.Header.Clone(), b.String()})
		f.mu.Unlock()
		for k, v := range cab {
			w.Header().Set(k, v)
		}
		w.WriteHeader(status)
		w.Write([]byte(`{"message":"Bad credentials SEGREDO-corpo"}`))
	}))
	t.Cleanup(f.Close)
	return f
}

func clienteDe(f *falso) *Cliente {
	c := Novo("SEGREDO-pat")
	c.base = f.URL
	return c
}

func TestListaFechadaBemFormada(t *testing.T) {
	for nome, d := range Disparos {
		if !reRepo.MatchString(d.Repo) || !reWorkflow.MatchString(d.Workflow) || !reRef.MatchString(d.Ref) {
			t.Errorf("%s: repo/workflow/ref mal formado: %+v", nome, d)
		}
		if strings.Contains(d.Repo+d.Workflow+d.Ref, "..") {
			t.Errorf("%s: contém ..", nome)
		}
		for k, re := range d.Entradas {
			if re == nil {
				t.Errorf("%s: entrada %q sem formato", nome, k)
			}
		}
	}
}

func TestDispararListaFechada(t *testing.T) {
	ctx := context.Background()
	f := novoFalso(t, 204, nil)
	c := clienteDe(f)
	if err := c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}); err != nil {
		t.Fatal(err)
	}
	if f.n() != 1 {
		t.Fatalf("pedidos = %d", f.n())
	}
	p := f.pedidos[0]
	if p.Metodo != "POST" || p.Caminho != "/repos/rbv-co/social-dashboard/actions/workflows/fabrica.yml/dispatches" {
		t.Fatalf("pedido = %s %s", p.Metodo, p.Caminho)
	}
	if p.Corpo != `{"inputs":{"job_id":"`+uuidA+`"},"ref":"main"}` {
		t.Fatalf("corpo = %s", p.Corpo)
	}
	if p.Cab.Get("Authorization") != "Bearer SEGREDO-pat" || p.Cab.Get("Accept") != "application/vnd.github+json" ||
		p.Cab.Get("X-GitHub-Api-Version") != "2022-11-28" || p.Cab.Get("User-Agent") != "api-central" {
		t.Fatalf("cabeçalhos = %v", p.Cab)
	}

	negados := []struct {
		nome     string
		cliente  *Cliente
		disparo  string
		entradas map[string]string
		quer     error
	}{
		{"desconhecido", c, "outro", map[string]string{"job_id": uuidA}, ErrDesconhecido},
		{"sem job_id", c, "fabrica", map[string]string{}, ErrEntrada},
		{"nil", c, "fabrica", nil, ErrEntrada},
		{"job_id fora do formato", c, "fabrica", map[string]string{"job_id": "../x"}, ErrEntrada},
		{"entrada a mais", c, "fabrica", map[string]string{"job_id": uuidA, "ref": "evil"}, ErrEntrada},
	}
	for _, n := range negados {
		antes := f.n()
		if err := n.cliente.Disparar(ctx, n.disparo, n.entradas); !errors.Is(err, n.quer) {
			t.Errorf("%s: err = %v", n.nome, err)
		}
		if f.n() != antes {
			t.Errorf("%s: chamou o GitHub", n.nome)
		}
	}
	for _, tok := range []string{"", "   "} {
		sem := Novo(tok)
		sem.base = f.URL
		antes := f.n()
		if sem.Configurado() {
			t.Errorf("Novo(%q).Configurado() = true", tok)
		}
		if err := sem.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}); !errors.Is(err, ErrSemToken) {
			t.Errorf("Novo(%q): err = %v", tok, err)
		}
		if err := sem.Cancelar(ctx, "fabrica", "1"); !errors.Is(err, ErrSemToken) {
			t.Errorf("Cancelar Novo(%q): err = %v", tok, err)
		}
		if f.n() != antes {
			t.Errorf("Novo(%q): chamou o GitHub", tok)
		}
	}
}

type caso struct {
	nome   string
	status int
	cab    map[string]string
	classe Classe // "" = sucesso
	espMin time.Duration
	espMax time.Duration
}

func casos() []caso {
	reset := strconv.FormatInt(time.Now().Add(120*time.Second).Unix(), 10)
	return []caso{
		{"204", 204, nil, "", 0, 0},
		{"200", 200, nil, "", 0, 0},
		{"401", 401, nil, TokenInvalido, 0, 0},
		{"403", 403, nil, SemPermissao, 0, 0},
		{"403 limite", 403, map[string]string{"X-RateLimit-Remaining": "0", "X-RateLimit-Reset": reset}, Limite, 100 * time.Second, 120 * time.Second},
		{"429", 429, map[string]string{"Retry-After": "30"}, Limite, 30 * time.Second, 30 * time.Second},
		{"404", 404, nil, NaoEncontrado, 0, 0},
		{"422", 422, nil, Recusado, 0, 0},
		{"500", 500, nil, Indisponivel, 0, 0},
		{"503", 503, nil, Indisponivel, 0, 0},
		{"502 (gateway: pode ter sido aceito)", 502, nil, Incerto, 0, 0},
		{"504 (gateway: pode ter sido aceito)", 504, nil, Incerto, 0, 0},
	}
}

func confere(t *testing.T, nome string, err error, status int, classe Classe) *Erro {
	t.Helper()
	if classe == "" {
		if err != nil {
			t.Errorf("%s: err = %v", nome, err)
		}
		return nil
	}
	var e *Erro
	if !errors.As(err, &e) {
		t.Errorf("%s: err = %v, quer *Erro", nome, err)
		return nil
	}
	if e.Classe != classe || e.Status != status {
		t.Errorf("%s: %s (%d), quer %s (%d)", nome, e.Classe, e.Status, classe, status)
	}
	return e
}

func TestErrosPorClasse(t *testing.T) {
	ctx := context.Background()
	for _, k := range casos() {
		t.Run(k.nome, func(t *testing.T) {
			f := novoFalso(t, k.status, k.cab)
			err := clienteDe(f).Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA})
			e := confere(t, k.nome, err, k.status, k.classe)
			if e != nil && k.classe == Limite && (e.EsperarAte < k.espMin || e.EsperarAte > k.espMax) {
				t.Errorf("EsperarAte = %v, quer entre %v e %v", e.EsperarAte, k.espMin, k.espMax)
			}
			if f.n() != 1 {
				t.Errorf("pedidos = %d (sem repetição automática)", f.n())
			}
		})
	}

	t.Run("429 sem cabeçalho: 1 minuto", func(t *testing.T) {
		f := novoFalso(t, 429, nil)
		e := confere(t, "429", clienteDe(f).Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}), 429, Limite)
		if e != nil && e.EsperarAte != time.Minute {
			t.Errorf("EsperarAte = %v", e.EsperarAte)
		}
	})

	t.Run("302 não é seguido", func(t *testing.T) {
		outro := novoFalso(t, 204, nil)
		f := novoFalso(t, 302, map[string]string{"Location": outro.URL + "/roubo"})
		err := clienteDe(f).Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA})
		confere(t, "302", err, 302, Inesperado)
		if outro.n() != 0 {
			t.Fatalf("o outro servidor recebeu %d pedido(s): o token vazou", outro.n())
		}
	})

	t.Run("prazo estourado: incerto", func(t *testing.T) {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			time.Sleep(200 * time.Millisecond)
		}))
		defer srv.Close()
		c := Novo("SEGREDO-pat")
		c.base = srv.URL
		c.http.Timeout = 50 * time.Millisecond
		confere(t, "prazo", c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}), 0, Incerto)
	})

	t.Run("conexão recusada: indisponível", func(t *testing.T) {
		f := novoFalso(t, 204, nil)
		c := clienteDe(f)
		f.Close()
		confere(t, "recusada", c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}), 0, Indisponivel)
	})

	t.Run("DNS: indisponível", func(t *testing.T) {
		c := Novo("SEGREDO-pat")
		c.base = "http://nao-existe.invalid"
		confere(t, "dns", c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}), 0, Indisponivel)
	})
}

func TestCancelar(t *testing.T) {
	ctx := context.Background()
	f := novoFalso(t, 202, nil)
	c := clienteDe(f)
	if err := c.Cancelar(ctx, "fabrica", "123"); err != nil {
		t.Fatal(err)
	}
	p := f.pedidos[0]
	if p.Metodo != "POST" || p.Caminho != "/repos/rbv-co/social-dashboard/actions/runs/123/cancel" || p.Corpo != "" {
		t.Fatalf("pedido = %+v", p)
	}
	if p.Cab.Get("Authorization") != "Bearer SEGREDO-pat" {
		t.Fatalf("Authorization = %q", p.Cab.Get("Authorization"))
	}

	f409 := novoFalso(t, 409, nil)
	if err := clienteDe(f409).Cancelar(ctx, "fabrica", "123"); err != nil {
		t.Errorf("409 deveria ser sucesso: %v", err)
	}
	f404 := novoFalso(t, 404, nil)
	confere(t, "404", clienteDe(f404).Cancelar(ctx, "fabrica", "123"), 404, NaoEncontrado)

	for _, id := range []string{"12/../../x", "", "1a", strings.Repeat("1", 21)} {
		if err := c.Cancelar(ctx, "fabrica", id); !errors.Is(err, ErrEntrada) {
			t.Errorf("runID %q: err = %v", id, err)
		}
	}
	if err := c.Cancelar(ctx, "outro", "1"); !errors.Is(err, ErrDesconhecido) {
		t.Errorf("disparo desconhecido: err = %v", err)
	}
	if f.n() != 1 {
		t.Fatalf("os negados chamaram o GitHub: %d pedidos", f.n())
	}
}

func TestTokenNuncaSai(t *testing.T) {
	var logs bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&logs, nil)))
	defer slog.SetDefault(antes)

	ctx := context.Background()
	proibidos := func(f *falso) []string { return []string{"SEGREDO", f.URL, "Bad credentials"} }
	for _, k := range casos() {
		f := novoFalso(t, k.status, k.cab)
		c := clienteDe(f)
		for nome, err := range map[string]error{
			"disparar": c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA}),
			"cancelar": c.Cancelar(ctx, "fabrica", "7"),
		} {
			if err == nil {
				continue
			}
			for _, p := range proibidos(f) {
				if strings.Contains(err.Error(), p) {
					t.Errorf("%s %s: o erro contém %q: %v", k.nome, nome, p, err)
				}
			}
		}
	}
	// sem resposta
	f := novoFalso(t, 204, nil)
	c := clienteDe(f)
	f.Close()
	err := c.Disparar(ctx, "fabrica", map[string]string{"job_id": uuidA})
	if err == nil || strings.Contains(err.Error(), "SEGREDO") || strings.Contains(err.Error(), f.URL) {
		t.Errorf("sem resposta: %v", err)
	}
	if strings.Contains(logs.String(), "SEGREDO") {
		t.Errorf("o log contém o segredo: %s", logs.String())
	}
}

func TestParaTesteSoLoopback(t *testing.T) {
	f := novoFalso(t, 204, nil)
	for _, base := range []string{"https://api.github.com", "http://10.0.0.1", "https://127.0.0.1", "http://127.0.0.1.exemplo.com", "http://[::2]:1", ""} {
		if loopback(base) {
			t.Errorf("loopback(%q) = true", base)
		}
	}
	for _, base := range []string{f.URL, "http://localhost:1", "http://[::1]:8080"} {
		if !loopback(base) {
			t.Errorf("loopback(%q) = false", base)
		}
	}
	c := ParaTeste(t, "SEGREDO-pat", f.URL+"/")
	if err := c.Disparar(context.Background(), "fabrica", map[string]string{"job_id": uuidA}); err != nil {
		t.Fatal(err)
	}
	if f.n() != 1 {
		t.Fatalf("pedidos = %d", f.n())
	}
}

// Plano 6: o espelho da planilha da Vessel é a ÚNICA entrada nova da lista fechada: o workflow certo, sem entradas
// (entrada que ninguém declarou é recusada) e sem token = ErrSemToken, tudo sem chamar a rede.
func TestDisparoDoEspelhoDaVessel(t *testing.T) {
	ctx := context.Background()
	f := novoFalso(t, 204, nil)
	c := clienteDe(f)
	if err := c.Disparar(ctx, "espelho-vessel", map[string]string{}); err != nil {
		t.Fatal(err)
	}
	p := f.pedidos[0]
	if p.Caminho != "/repos/rbv-co/social-dashboard/actions/workflows/espelho-da-vessel.yml/dispatches" || p.Corpo != `{"ref":"main"}` {
		t.Errorf("pedido = %s %s", p.Caminho, p.Corpo)
	}
	for _, entradas := range []map[string]string{{"ensaio": "sim"}, {"ref": "outra"}, {"job_id": uuidA}} {
		if err := c.Disparar(ctx, "espelho-vessel", entradas); err != ErrEntrada {
			t.Errorf("entradas %v = %v, esperava ErrEntrada", entradas, err)
		}
	}
	if f.n() != 1 {
		t.Errorf("%d pedidos: entrada recusada chegou à rede", f.n())
	}
	if err := Novo("").Disparar(ctx, "espelho-vessel", map[string]string{}); err != ErrSemToken {
		t.Errorf("sem token = %v, esperava ErrSemToken", err)
	}
	if got := len(Disparos); got != 2 {
		t.Errorf("a lista fechada tem %d disparos: o Plano 6 acrescenta exatamente um (fabrica e espelho-vessel)", got)
	}
}
