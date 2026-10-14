package publico

import (
	"crypto/rand"
	"math/big"
	"strings"
)

// Os textos e a senha da conta da cliente: porta de supabase/functions/_shared/{senha-gerada,email-textos}.js.
// textos_test.go compara a saída byte a byte com a do JS (golden gerado do próprio arquivo).

// alfabetoDaSenha: sem caractere ambíguo (0/O, 1/l/I): ela copia do e-mail e digita no celular.
const alfabetoDaSenha = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

const tamanhoDaSenha = 12

// gerarSenha sorteia com crypto/rand (uniforme, sem o viés do módulo); nunca math/rand.
func gerarSenha() string {
	var b strings.Builder
	for i := 0; i < tamanhoDaSenha; i++ {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(alfabetoDaSenha))))
		if err != nil {
			panic("crypto/rand sem entropia: " + err.Error()) // a API não deve seguir sem sorteio de verdade
		}
		b.WriteByte(alfabetoDaSenha[n.Int64()])
	}
	return b.String()
}

type textoDeEmail struct{ Assunto, HTML, Texto string }

const assinatura = "VESSEL Brasil · vesselbrasil.com.br"

// escaparHTML: o NOME vem digitado pela cliente; sem escapar, `<img onerror=…>` entra cru no HTML do e-mail.
func escaparHTML(t string) string {
	return strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;", `"`, "&quot;", "'", "&#39;").Replace(t)
}

func montarTexto(assunto, titulo, miolo, senha string) textoDeEmail {
	texto := titulo + "\n\n" + miolo + "\n\nSua senha: " + senha + "\n\n" + assinatura
	html := `<div style="font-family:Arial,Helvetica,sans-serif;color:#2A2823;line-height:1.6">
  <p style="letter-spacing:.2em;font-size:12px;color:#5E6851">VESSEL</p>
  <h1 style="font-weight:300;font-size:22px">` + escaparHTML(titulo) + `</h1>
  <p>` + escaparHTML(miolo) + `</p>
  <p style="font-size:20px;letter-spacing:.08em;background:#F2EFE6;padding:12px 16px;display:inline-block">` + escaparHTML(senha) + `</p>
  <p style="font-size:12px;color:#6B685F">` + assinatura + `</p>
</div>`
	return textoDeEmail{Assunto: assunto, HTML: html, Texto: texto}
}

func textoDoPrimeiroAcesso(nome, senha string) textoDeEmail {
	primeiro, _, _ := strings.Cut(nome, " ")
	return montarTexto("Seu acesso VESSEL", "Bem-vinda, "+primeiro,
		"Criamos seu perfil VESSEL. Use o e-mail ou o seu documento e a senha abaixo para entrar. "+
			"Você pode trocar a senha assim que entrar.", senha)
}

func textoDaSenhaNova(senha string) textoDeEmail {
	return montarTexto("Sua nova senha VESSEL", "Nova senha",
		"Geramos uma senha nova para o seu perfil. A senha anterior deixou de valer. "+
			"Se não foi você quem pediu, fale com a gente.", senha)
}

// mascararEmail: a primeira letra e o domínio ("a•••@x.com"); sem "@" (ou sem usuário), vazio.
func mascararEmail(e string) string {
	i := strings.Index(e, "@")
	if i < 1 {
		return ""
	}
	return string([]rune(e)[:1]) + "•••" + e[i:]
}
