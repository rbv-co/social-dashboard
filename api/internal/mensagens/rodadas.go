package mensagens

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Porta de _shared/rodada-de-mensagens.js (abandono), rodada-da-fila.js (inicio, pedido, follow-up)
// e rodada-completa.js (as 4 passadas, cada uma com o seu MODO). ⚠️ NASCE TUDO DESLIGADO.

// resultado de uma passada: o status da edge (200 ok; 500 configuração/fila/bloqueados/prazo; 502
// credencial recusada) e o corpo (vai para o log, sem telefone nem segredo).
type resultado struct {
	status int
	corpo  map[string]any
}

// Mensagens é o robô enviar-mensagem-abandono (pg_cron 1/min).
type Mensagens struct {
	Pool  *pgxpool.Pool
	Cfg   Config
	HTTP  *http.Client     // para o Chatwoot; nil = cliente padrão, que NUNCA segue redirect (produção deixa nil)
	Agora func() time.Time // nil = time.Now
	fila  fila             // nil = filaSQL{Pool} (o teste troca)
}

// Tarefa: 1/min. O prazo (4 min) passa do minuto de propósito: a execução seguinte é pulada pela trava,
// e uma rodada com Chatwoot lento termina as linhas que começou em vez de cortá-las no meio.
func (m *Mensagens) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-mensagem-abandono", Agenda: "* * * * *", Limite: 4 * time.Minute, Executar: m.Rodar}
}

var modos = []string{"desligado", "seco", "lista", "ligado"}

// O que a rodada faz depois de enviar (ou tentar enviar) UM item.
const (
	seguir     = iota // próximo item
	credencial        // credencial recusada: devolve este e o resto, sem contar tentativa (502)
	prazo             // o prazo da tarefa acabou e ESTE item já foi resolvido: o resto volta à fila (limite_de_tempo)
)

func (m *Mensagens) Rodar(ctx context.Context) error {
	agora := m.Agora // lido a CADA item: um lote que atravessa as 21 h não envia depois da janela
	if agora == nil {
		agora = time.Now
	}
	f := m.fila
	if f == nil {
		f = filaSQL{m.Pool}
	}
	c := m.Cfg
	chat := &Chatwoot{URL: c.Chatwoot.URL, ContaID: c.Chatwoot.ContaID, CaixaID: int64(numeroJS(c.Chatwoot.CaixaID, 0)),
		Token: c.Chatwoot.Token, BotSecret: c.Chatwoot.BotSecret, HTTP: m.HTTP}
	passadas := []struct {
		nome  string
		p     Passada
		rodar func(cli *Chatwoot) resultado
	}{
		{"inicio", c.Inicio, func(cli *Chatwoot) resultado {
			return processarFila(ctx, f, cli, c.Inicio, c.Chatwoot, "inicio", agora)
		}},
		{"pedido", c.Pedido, func(cli *Chatwoot) resultado {
			return processarFila(ctx, f, cli, c.Pedido, c.Chatwoot, "pedido", agora)
		}},
		{"abandono", c.Abandono, func(cli *Chatwoot) resultado { return processarRodada(ctx, f, cli, c.Abandono, c.Chatwoot, agora) }},
		{"followup", c.Followup, func(cli *Chatwoot) resultado {
			// Configuração inválida não toca em nada: nem agenda. FOLLOWUP_APOS_HORAS vai para agendar_followups(int, int).
			problemas := append(problemasDaFila(c.Followup, c.Chatwoot, "followup"), c.ProblemasDoFollowup()...)
			if len(problemas) > 0 {
				return resultado{500, map[string]any{"ok": false, "erro": "config_invalida", "problemas": problemas}}
			}
			// Agenda quem recebeu a de abandono há FOLLOWUP_APOS_HORAS. O seco só LÊ: não agenda.
			var errAgenda error
			if c.Followup.Modo != "seco" {
				errAgenda = registrar("agendar_followups", f.agendarFollowups(context.WithoutCancel(ctx), int(c.FollowupAposHoras), int(c.Followup.MaxHoras)))
			}
			r := processarFila(ctx, f, cli, c.Followup, c.Chatwoot, "followup", agora)
			if errAgenda != nil && r.status == 200 { // a fila já agendada foi processada; a falha continua visível
				return resultado{500, map[string]any{"ok": false, "erro": "falha_ao_agendar", "resultado": r.corpo["resultado"]}}
			}
			return r
		}},
	}
	var falhas []string
	for _, p := range passadas {
		if p.p.Modo == "desligado" {
			continue
		}
		if !slices.Contains(modos, p.p.Modo) { // modo desconhecido falha fechado só naquele tipo
			falhas = append(falhas, p.nome+": modo_invalido")
			continue
		}
		if ctx.Err() != nil { // o prazo já acabou: a passada nem começa (nada é reservado para depois devolver)
			falhas = append(falhas, p.nome+": limite_de_tempo")
			continue
		}
		cli := chat
		if p.p.Modo == "seco" {
			cli = nil // o seco nunca fala com o Chatwoot
		}
		r := rodarProtegido(p.rodar, cli)
		slog.Info("enviar-mensagem-abandono", "passada", p.nome, "modo", p.p.Modo, "status", r.status, "corpo", r.corpo)
		if r.status != 200 {
			falhas = append(falhas, fmt.Sprintf("%s: %v", p.nome, r.corpo["erro"]))
		}
	}
	if len(falhas) > 0 {
		return errors.New(strings.Join(falhas, "; "))
	}
	return nil
}

// rodarProtegido: uma passada que quebra não derruba as outras (o try/catch de rodada-completa.js).
func rodarProtegido(rodar func(*Chatwoot) resultado, cli *Chatwoot) (r resultado) {
	defer func() {
		if x := recover(); x != nil {
			slog.Error("falha na passada", "erro", texto.CortarUTF16(fmt.Sprint(x), 160))
			r = resultado{500, map[string]any{"ok": false, "erro": "excecao"}}
		}
	}()
	return rodar(cli)
}

func registrar(nome string, err error) error {
	if err != nil {
		slog.Error("falha em "+nome, "erro", err) // o item já foi decidido: não há o que refazer aqui
	}
	return err
}

// substituirJS é String.prototype.replace(alvo, novo) do JS com alvo em texto: só a 1ª ocorrência, e o
// `novo` com os padrões de substituição do JS ($$, $&, $` e $'); $n e $<nome> ficam como estão (alvo em
// texto não tem grupos). Um nome "Ana$&" tem de sair como o JS faria: mensagem a cliente byte a byte.
func substituirJS(s, alvo, novo string) string {
	i := strings.Index(s, alvo)
	if i < 0 {
		return s
	}
	antes, depois := s[:i], s[i+len(alvo):]
	var b strings.Builder
	for j := 0; j < len(novo); j++ {
		if novo[j] == '$' && j+1 < len(novo) {
			switch novo[j+1] {
			case '$':
				b.WriteByte('$')
				j++
				continue
			case '&':
				b.WriteString(alvo)
				j++
				continue
			case '`':
				b.WriteString(antes)
				j++
				continue
			case '\'':
				b.WriteString(depois)
				j++
				continue
			}
		}
		b.WriteByte(novo[j])
	}
	return antes + b.String() + depois
}

// limpo mascara o token e o segredo do bot no texto que vai para o log, o resultado e a coluna de motivo da
// fila (o corpo de erro do Chatwoot é de fora e pode ecoar um cabeçalho).
func limpo(s string, cli *Chatwoot) string {
	return worker.Limpar(s, []string{cli.Token, cli.BotSecret})
}

// semResposta: o Chatwoot não respondeu (rede ou prazo).
func semResposta(err error) bool {
	var ec *ErroChatwoot
	return errors.As(err, &ec) && ec.Status == 0
}

func ultimos11(p Passada) []string {
	if p.Modo != "lista" {
		return nil
	}
	out := make([]string, len(p.SoPara))
	for i, n := range p.SoPara {
		out[i] = n[max(0, len(n)-11):]
	}
	return out
}

func finalDoTelefone(t string) any {
	if t == "" {
		return nil
	}
	return t[len(t)-4:]
}

func motivoOuNulo(m string) any {
	if m == "" {
		return nil
	}
	return m
}

// problemasDoAbandono: o que o abandono exige antes de tocar em qualquer linha.
func problemasDoAbandono(cfg Passada, chat ChatwootConfig) []string {
	problemas := validarConfig(cfg, chat, true)
	if !inteiro(cfg.MaxHoras) || cfg.MaxHoras < 1 {
		problemas = append(problemas, "ENVIO_MAX_HORAS inválido (inteiro a partir de 1)")
	}
	// ENVIO_ATRASO_MINUTOS vai para pegar_para_mensagem(int): NaN, infinito, fração ou negativo reprovam
	// (a edge mandava NaN sem validar). 0 é o padrão e vale.
	if !inteiro(cfg.AtrasoMin) || cfg.AtrasoMin < 0 {
		problemas = append(problemas, "ENVIO_ATRASO_MINUTOS inválido (inteiro a partir de 0)")
	}
	return problemas
}

// problemasDaFila: o mesmo para inicio, pedido e follow-up.
func problemasDaFila(cfg Passada, chat ChatwootConfig, tipo string) []string {
	problemas := validarConfig(cfg, chat, tipo == "followup" || tipo == "inicio")
	if !inteiro(cfg.MaxHoras) || cfg.MaxHoras < 1 {
		problemas = append(problemas, "ENVIO_MAX_HORAS inválido (inteiro a partir de 1)")
	}
	if tipo == "pedido" && cfg.ReservarAviso && chat.BotSecret == "" { // não envia o pedido sem a trava que se pediu
		problemas = append(problemas, "CHATWOOT_BOT_SECRET ausente (RESERVAR_AVISO_CHATWOOT=true exige)")
	}
	return problemas
}

// processarRodada é o abandono (rodada-de-mensagens.js).
func processarRodada(ctx context.Context, f fila, cli *Chatwoot, cfg Passada, chat ChatwootConfig, agora func() time.Time) resultado {
	seco := cfg.Modo == "seco"
	if problemas := problemasDoAbandono(cfg, chat); len(problemas) > 0 {
		return resultado{500, map[string]any{"ok": false, "erro": "config_invalida", "problemas": problemas}}
	}
	db := context.WithoutCancel(ctx) // o estado da fila é gravado mesmo se o prazo da tarefa acabar no meio
	if !seco {
		registrar("liberar_mensagens_travadas", f.liberarMensagensTravadas(db))
	}
	lote, err := f.pegarParaMensagem(db, int(cfg.Limite), int(cfg.AtrasoMin), !seco, ultimos11(cfg), int(cfg.MaxHoras))
	if err != nil {
		return resultado{500, map[string]any{"ok": false, "erro": "falha_ao_pegar", "detalhe": err.Error()}}
	}
	devolver := func(token string, contar bool) { registrar("devolver_mensagem", f.devolverMensagem(db, token, contar)) }
	marcar := func(token, status, motivo string) {
		registrar("marcar_mensagem", f.marcarMensagem(db, token, status, motivo, nil))
	}
	// ⚠️ Se a lista de quem pediu para parar não puder ser lida, NÃO se envia nada.
	var telefones []string
	for _, l := range lote {
		if t := normalizarTelefone(l.Telefone); t != "" && !slices.Contains(telefones, t) {
			telefones = append(telefones, t)
		}
	}
	bloqueados := map[string]bool{}
	if len(telefones) > 0 {
		if bloqueados, err = f.bloqueados(db, telefones); err != nil {
			slog.Error("falha ao ler bloqueados; rodada abortada", "erro", err)
			if !seco {
				for _, l := range lote {
					devolver(l.Token, false)
				}
			}
			return resultado{500, map[string]any{"ok": false, "erro": "falha_bloqueados"}}
		}
	}
	var res []map[string]any
	for i, l := range lote {
		d := decidirEnvio(l, bloqueados, agora(), cfg.LinkBase)
		curto := texto.CortarUTF16(l.Token, 8)
		if seco {
			item := map[string]any{"token": curto, "decisao": d.Acao, "motivo": motivoOuNulo(d.Motivo), "telefone_final": finalDoTelefone(d.Telefone), "sufixo_amostra": nil}
			if d.Sufixo != "" {
				item["sufixo_amostra"] = amostraDoSufixo(d.Sufixo)
			}
			res = append(res, item)
			continue
		}
		if ctx.Err() != nil { // o prazo acabou: nenhuma linha nova começa; o resto volta sem gastar tentativa
			for _, x := range lote[i:] {
				devolver(x.Token, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		switch d.Acao {
		case "ignorar":
			marcar(l.Token, "ignorada", d.Motivo)
			res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": d.Motivo})
			continue
		case "esperar":
			devolver(l.Token, false)
			res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": d.Motivo})
			continue
		}
		if cfg.TravaCruzada { // outra automática ao mesmo telefone nas últimas 20 h barra esta
			switch f.travaCruzada(db, d.Telefone, "abandono", l.Token) {
			case "erro":
				devolver(l.Token, true)
				res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "falha_na_trava_cruzada"})
				continue
			case "esperar":
				devolver(l.Token, false)
				res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "telefone_com_envio_em_andamento"})
				continue
			case "barrar":
				marcar(l.Token, "ignorada", motivoTravaCruzada)
				res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": motivoTravaCruzada})
				continue
			}
		}
		// ⚠️ RELÊ o status na hora de enviar: um pagamento pode ter chegado desde a reserva.
		st, err := f.statusDoCheckout(db, l.Token)
		if err != nil {
			slog.Error("falha ao reler o status; item devolvido", "erro", err)
			devolver(l.Token, true)
			res = append(res, map[string]any{"token": curto, "resultado": "esperando", "motivo": "falha_ao_reler_status"})
			continue
		}
		if st != "fila_envio" {
			marcar(l.Token, "ignorada", "nao_esta_mais_na_fila")
			res = append(res, map[string]any{"token": curto, "resultado": "ignorada", "motivo": "nao_esta_mais_na_fila"})
			continue
		}
		item, depois := enviarAbandono(ctx, db, f, cli, cfg, l, d)
		item["token"] = curto
		switch depois {
		case credencial: // o problema não é do lead. Devolve este e os que sobraram, sem contar.
			for _, x := range lote[i:] {
				devolver(x.Token, false)
			}
			slog.Error("chatwoot recusou a credencial; rodada interrompida", "detalhe", item["detalhe"])
			return resultado{502, map[string]any{"ok": false, "erro": "credencial_recusada", "detalhe": item["detalhe"], "resultado": res}}
		case prazo: // este item já foi resolvido (falhou ou voltou); o resto volta sem contar
			res = append(res, item)
			for _, x := range lote[i+1:] {
				devolver(x.Token, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		res = append(res, item)
	}
	return resultado{200, map[string]any{"ok": true, "modo": cfg.Modo, "quantidade": len(res), "resultado": res}}
}

func enviarAbandono(ctx, db context.Context, f fila, cli *Chatwoot, cfg Passada, l LinhaAbandono, d Decisao) (map[string]any, int) {
	falha := func(err error) (map[string]any, int) {
		como, detalhe := classificarErro(err), limpo(detalheDoErro(err), cli)
		acabou := ctx.Err() != nil && semResposta(err) // a queda foi do PRAZO, não da rede
		switch {
		case como == "parar":
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, credencial
		case como == "nao_enviado" || (como == "tentar_de_novo" && acabou):
			// nada saiu e a culpa não é do lead: volta sem gastar tentativa
			registrar("devolver_mensagem", f.devolverMensagem(db, l.Token, false))
			return map[string]any{"resultado": "esperando", "motivo": "limite_de_tempo"}, prazo
		case como == "tentar_de_novo":
			registrar("devolver_mensagem", f.devolverMensagem(db, l.Token, true))
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, seguir
		}
		// falhou. No envio, o prazo vencido deixa a mensagem AMBÍGUA (pode ter saído): fica falhou, nunca reenvia.
		registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "falhou", detalhe, nil))
		depois := seguir
		if acabou {
			depois = prazo
		}
		return map[string]any{"resultado": "falhou", "detalhe": detalhe}, depois
	}
	contato, err := cli.AcharOuCriarContato(ctx, formatarNomeCompleto(l.Nome), d.Telefone)
	if err != nil {
		return falha(err)
	}
	conversa, err := cli.AbrirConversa(ctx, contato, d.Telefone)
	if err != nil {
		return falha(err)
	}
	// Já respondeu DESDE o início deste checkout (a conversa é reaproveitada): a de 24 h não sai.
	respondeu, err := cli.Respondeu(ctx, conversa, &l.IniciadoEm)
	if err != nil {
		return falha(err)
	}
	if respondeu {
		registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "ignorada", "respondeu", nil))
		return map[string]any{"resultado": "ignorada", "motivo": "respondeu"}, seguir
	}
	txt := cfg.TemplateTexto
	if txt == "" {
		txt = "[template " + cfg.TemplateNome + "]"
	}
	txt = substituirJS(txt, "{{1}}", primeiroNome(l.Nome))
	if err := cli.EnviarTemplate(ctx, conversa, txt, templateMarketing(cfg.TemplateNome, cfg.Idioma, l.Nome, d.Sufixo)); err != nil {
		return falha(err)
	}
	// ⚠️ A mensagem JÁ SAIU. Se gravar falhar, não devolve nem reenvia: fica 'enviando' e, em 10 min,
	// vira falhou/travada_sem_confirmacao (visível), nunca uma segunda mensagem.
	if registrar("marcar_mensagem", f.marcarMensagem(db, l.Token, "enviada", "", &conversa)) != nil {
		return map[string]any{"resultado": "enviada_sem_gravar"}, seguir
	}
	return map[string]any{"resultado": "enviada"}, seguir
}

type aviso struct{ phone, tipo, chave string }

// processarFila: inicio, pedido e follow-up (rodada-da-fila.js).
func processarFila(ctx context.Context, f fila, cli *Chatwoot, cfg Passada, chat ChatwootConfig, tipo string, agora func() time.Time) resultado {
	seco, followup := cfg.Modo == "seco", tipo == "followup"
	if problemas := problemasDaFila(cfg, chat, tipo); len(problemas) > 0 {
		return resultado{500, map[string]any{"ok": false, "erro": "config_invalida", "problemas": problemas}}
	}
	reservar := tipo == "pedido" && cfg.ReservarAviso
	db := context.WithoutCancel(ctx)
	marcar := func(chave, status, motivo string) error {
		return registrar("marcar_da_fila", f.marcarDaFila(db, tipo, chave, status, motivo, nil))
	}
	devolver := func(chave string, contar bool) {
		registrar("devolver_da_fila", f.devolverDaFila(db, tipo, chave, contar))
	}
	if !seco {
		registrar("liberar_travadas_da_fila", f.liberarTravadasDaFila(db))
	}
	lote, err := f.pegarDaFila(db, tipo, int(cfg.Limite), int(cfg.MaxHoras), !seco, ultimos11(cfg))
	if err != nil {
		slog.Error("falha ao pegar da fila", "erro", err)
		return resultado{500, map[string]any{"ok": false, "erro": "falha_ao_pegar", "detalhe": err.Error()}}
	}
	bloqueados := map[string]bool{}
	var telefones []string
	for _, l := range lote {
		if t := normalizarTelefone(l.Telefone); t != "" && !slices.Contains(telefones, t) {
			telefones = append(telefones, t)
		}
	}
	if (followup || tipo == "inicio") && len(telefones) > 0 { // o pedido é transacional: não consulta
		if bloqueados, err = f.bloqueados(db, telefones); err != nil {
			slog.Error("falha ao ler bloqueados; rodada abortada", "erro", err)
			if !seco {
				for _, l := range lote {
					devolver(l.Chave, false)
				}
			}
			return resultado{500, map[string]any{"ok": false, "erro": "falha_bloqueados"}}
		}
	}
	var res []map[string]any
	adiados := 0 // reserva respondeu 'adiado': o core manda a NF-e; só se conta
	for i, l := range lote {
		agoraDoItem := agora()
		d := decidirLinha(tipo, l, bloqueados, agoraDoItem, cfg.LinkBase)
		curto := texto.CortarUTF16(l.Chave, 8)
		if seco {
			item := map[string]any{"chave": curto, "decisao": d.Acao, "motivo": motivoOuNulo(d.Motivo), "telefone_final": finalDoTelefone(d.Telefone), "sufixo_amostra": nil}
			if d.Sufixo != "" {
				item["sufixo_amostra"] = amostraDoSufixo(d.Sufixo)
			}
			res = append(res, item)
			continue
		}
		if ctx.Err() != nil {
			for _, x := range lote[i:] {
				devolver(x.Chave, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		pendentes := lote[i+1:]
		switch d.Acao {
		case "ignorar":
			marcar(l.Chave, "ignorada", d.Motivo)
			res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": d.Motivo})
			continue
		case "esperar":
			devolver(l.Chave, false)
			res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": d.Motivo})
			continue
		}
		if cfg.TravaCruzada && tipo != "pedido" { // o pedido recebido (transacional) nunca é barrado
			switch f.travaCruzada(db, d.Telefone, tipo, l.Chave) {
			case "erro":
				devolver(l.Chave, true)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_na_trava_cruzada"})
				continue
			case "esperar":
				devolver(l.Chave, false)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "telefone_com_envio_em_andamento"})
				continue
			case "barrar":
				marcar(l.Chave, "ignorada", motivoTravaCruzada)
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": motivoTravaCruzada})
				continue
			}
		}
		// Reserva do aviso no Chatwoot (trava ADICIONAL): só 'reservado' autoriza.
		var reservado *aviso
		liberarReserva := func() { // best-effort; uma reserva órfã faria a próxima rodada receber 'duplicado'
			if reservado != nil {
				a := *reservado
				reservado = nil
				cli.LiberarAviso(db, a.phone, a.tipo, a.chave)
			}
		}
		if reservar {
			chaveAviso := strings.TrimPrefix(deref(l.Numero), "#")
			if chaveAviso == "" {
				chaveAviso = l.Chave
			}
			av := aviso{d.Telefone, "pedido_recebido", chaveAviso}
			idade := max(0, int64(agoraDoItem.Sub(l.CriadoEm)/time.Second))
			r, err := cli.ReservarAviso(ctx, av.phone, av.tipo, av.chave, &idade)
			if err != nil {
				st := 0
				var ec *ErroChatwoot
				if errors.As(err, &ec) {
					st = ec.Status
				}
				detalhe := fmt.Sprintf("reservar_aviso:%d", st)
				if st == 0 || st >= 500 || st == 200 { // a resposta pode ter se perdido com a reserva gravada
					reservado = &av
					liberarReserva()
				}
				devolver(l.Chave, false)
				if st == 401 || st == 403 {
					for _, x := range pendentes {
						devolver(x.Chave, false)
					}
					slog.Error("chatwoot recusou o X-Bot-Secret na reserva do aviso; rodada interrompida", "detalhe", detalhe)
					return resultado{502, map[string]any{"ok": false, "erro": "reserva_recusada", "detalhe": detalhe, "resultado": res}}
				}
				if st == 0 && ctx.Err() != nil { // a queda foi do PRAZO: o resto volta e a rodada termina
					for _, x := range pendentes {
						devolver(x.Chave, false)
					}
					return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
				}
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_na_reserva_do_aviso", "detalhe": detalhe})
				continue
			}
			if r == "adiado" {
				devolver(l.Chave, false)
				adiados++
				continue
			}
			if r != "reservado" { // duplicado | janela: já foi avisada
				marcar(l.Chave, "ignorada", "aviso_chatwoot_"+r)
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "aviso_chatwoot_" + r})
				continue
			}
			reservado = &av
		}
		if followup {
			// ⚠️ RELÊ o status: entre agendar e enviar a cliente pode ter comprado ou gerado um Pix.
			st, err := f.statusDoCheckout(db, l.Chave)
			if err != nil {
				slog.Error("falha ao reler o status; item devolvido", "erro", err)
				devolver(l.Chave, true)
				res = append(res, map[string]any{"chave": curto, "resultado": "esperando", "motivo": "falha_ao_reler_status"})
				continue
			}
			if st != "fila_envio" {
				marcar(l.Chave, "ignorada", "nao_esta_mais_na_fila")
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "nao_esta_mais_na_fila"})
				continue
			}
			if l.ConversaOrigem == nil { // sem a conversa anterior não há como saber se respondeu
				marcar(l.Chave, "ignorada", "sem_conversa_de_origem")
				res = append(res, map[string]any{"chave": curto, "resultado": "ignorada", "motivo": "sem_conversa_de_origem"})
				continue
			}
		}
		item, depois := enviarDaFila(ctx, db, f, cli, cfg, tipo, l, d, reservado != nil, liberarReserva)
		item["chave"] = curto
		switch depois {
		case credencial: // devolve este e os que sobraram, sem contar tentativa
			devolver(l.Chave, false)
			for _, x := range pendentes {
				devolver(x.Chave, false)
			}
			slog.Error("chatwoot recusou a credencial; rodada interrompida", "detalhe", item["detalhe"])
			return resultado{502, map[string]any{"ok": false, "erro": "credencial_recusada", "detalhe": item["detalhe"], "resultado": res}}
		case prazo: // este item já foi resolvido (falhou ou voltou); o resto volta sem contar
			res = append(res, item)
			for _, x := range pendentes {
				devolver(x.Chave, false)
			}
			return resultado{500, map[string]any{"ok": false, "erro": "limite_de_tempo", "resultado": res}}
		}
		res = append(res, item)
	}
	corpo := map[string]any{"ok": true, "modo": cfg.Modo, "tipo": tipo, "quantidade": len(res), "resultado": res}
	if reservar {
		corpo["adiados"] = adiados
	}
	return resultado{200, corpo}
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func enviarDaFila(ctx, db context.Context, f fila, cli *Chatwoot, cfg Passada, tipo string, l LinhaFila, d Decisao,
	comReserva bool, liberarReserva func()) (map[string]any, int) {
	chegouNoEnvio := false // a partir do enviarTemplate uma falha pode ser ambígua
	falha := func(err error) (map[string]any, int) {
		como, detalhe := classificarErro(err), limpo(detalheDoErro(err), cli)
		var ec *ErroChatwoot
		ehChatwoot := errors.As(err, &ec)
		acabou := ctx.Err() != nil && semResposta(err) // a queda foi do PRAZO, não da rede
		if como == "nao_enviado" {                     // o prazo venceu antes do envio: nada saiu, nada gasta tentativa
			liberarReserva()
			registrar("devolver_da_fila", f.devolverDaFila(db, tipo, l.Chave, false))
			return map[string]any{"resultado": "esperando", "motivo": "limite_de_tempo"}, prazo
		}
		depois := seguir
		if acabou {
			depois = prazo
		}
		ambigua := chegouNoEnvio && (!ehChatwoot || ec.Status == 0 || ec.Status >= 500)
		if comReserva && ambigua { // a Meta pode ter aceitado: NÃO libera (permitiria um 2º aviso) e NÃO devolve
			registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "falhou", "envio_incerto_conferir_no_chatwoot: "+detalhe, nil))
			return map[string]any{"resultado": "falhou", "motivo": "envio_incerto", "detalhe": detalhe}, depois
		}
		liberarReserva() // a falha foi comprovadamente ANTES de a mensagem ser aceita
		switch como {
		case "parar":
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, credencial
		case "tentar_de_novo":
			if acabou { // o prazo derrubou o passo, não a rede: volta sem gastar tentativa
				registrar("devolver_da_fila", f.devolverDaFila(db, tipo, l.Chave, false))
				return map[string]any{"resultado": "esperando", "motivo": "limite_de_tempo"}, prazo
			}
			registrar("devolver_da_fila", f.devolverDaFila(db, tipo, l.Chave, true))
			return map[string]any{"resultado": "tentar_de_novo", "detalhe": detalhe}, seguir
		}
		registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "falhou", detalhe, nil))
		return map[string]any{"resultado": "falhou", "detalhe": detalhe}, depois
	}
	if tipo == "followup" {
		respondeu, err := cli.Respondeu(ctx, *l.ConversaOrigem, nil)
		if err != nil {
			return falha(err)
		}
		if respondeu {
			registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "ignorada", "respondeu", nil))
			return map[string]any{"resultado": "ignorada", "motivo": "respondeu"}, seguir
		}
	}
	contato, err := cli.AcharOuCriarContato(ctx, formatarNomeCompleto(l.Nome), d.Telefone)
	if err != nil {
		return falha(err)
	}
	conversa, err := cli.AbrirConversa(ctx, contato, d.Telefone)
	if err != nil {
		return falha(err)
	}
	txt := cfg.TemplateTexto
	if txt == "" {
		txt = "[template " + cfg.TemplateNome + "]"
	}
	txt = substituirJS(substituirJS(txt, "{{1}}", primeiroNome(l.Nome)), "{{2}}", deref(l.Numero))
	params := templateMarketing(cfg.TemplateNome, cfg.Idioma, l.Nome, d.Sufixo) // inicio e follow-up
	if tipo == "pedido" {
		params = templatePedido(cfg.TemplateNome, cfg.Idioma, l.Nome, l.Numero)
	}
	chegouNoEnvio = true
	if err := cli.EnviarTemplate(ctx, conversa, txt, params); err != nil {
		return falha(err)
	}
	// ⚠️ A mensagem JÁ SAIU: se gravar falhar, fica 'enviando' (vira falhou em 10 min), nunca reenvia.
	if registrar("marcar_da_fila", f.marcarDaFila(db, tipo, l.Chave, "enviada", "", &conversa)) != nil {
		return map[string]any{"resultado": "enviada_sem_gravar"}, seguir
	}
	return map[string]any{"resultado": "enviada"}, seguir
}
