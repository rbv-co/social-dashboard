// Package arquivos é o Storage no disco: <ARQUIVOS_DIR>/<bucket>/<caminho>. Troca o Supabase Storage mantendo o que as
// telas usam (listar, enviar com upsert, apagar vários, copiar, URL assinada, URL pública) e as regras que as policies
// de produção davam a cada bucket.
package arquivos

import (
	"slices"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// Quem pede: o escopo (perfil) e o ator (tipo de sessão, "entrar como").
type regra func(e *autz.Escopo, a *auth.Ator, caminho string) bool

type bucket struct {
	Nome             string
	Publico          bool
	Max              int64           // bytes por objeto
	Tipos            map[string]bool // tipos declarados aceitos no envio
	Ler              regra
	Escrever, Apagar regra
}

const (
	MiB = 1 << 20

	octetStream = "application/octet-stream"
)

func conjunto(l ...string) map[string]bool {
	m := make(map[string]bool, len(l))
	for _, x := range l {
		m[x] = true
	}
	return m
}

var imagens = []string{"image/jpeg", "image/png", "image/webp", "image/gif"}

// pode: permissions[chave] tem a ação (ou é super-admin pela ficha); conta ativa.
func pode(e *autz.Escopo, chave, acao string) bool {
	return e != nil && e.Ativo && (e.SuperFicha || slices.Contains(e.Acoes[chave], acao))
}

func papelAdmin(e *autz.Escopo) bool {
	return e != nil && e.Ativo && (e.Papel == "admin" || e.SuperFicha)
}

func servico(a *auth.Ator) bool { return a != nil && a.Tipo == "servico" }

func todos(*autz.Escopo, *auth.Ator, string) bool { return true }

func adminDeAcessos(e *autz.Escopo, _ *auth.Ator, _ string) bool {
	return e != nil && autz.AcessosAdmin(e)
}

func soSuper(e *autz.Escopo, _ *auth.Ator, _ string) bool { return e != nil && e.Ativo && e.SuperFicha }

// buckets de produção (levantamento 10-buckets.csv) e as regras das policies conhecidas (db/migrations):
//   - acessos-avatars/acessos-termos: is_acessos_admin();
//   - conteudo: papel admin, super ou módulo `conteudo` (as 4 policies conteudo_obj_*);
//   - fabrica-criativos: gestor-envios/ = papel admin ou módulo meta.gestor; o resto, a Fábrica (papel admin, super ou a chave meta.fabrica);
//   - vessel-curriculos: o anônimo só ENVIA, e só nas pastas consultor-* (rota própria, curriculo.go).
//
// fotos-modelo fica fora (nada no banco aponta para ele). ig-cache entra SÓ PARA LEITURA: as imagens das Notícias
// (noticias_concorrentes.imagem_url e produtos) apontam para ele desde a troca de host da virada, e sem o bucket davam 404.
// Os buckets sem policy no repositório (arquivos, avatars, profile-pics, publico) seguem as telas que os usam: o
// Banco confere permissions.banco (ver/criar/excluir); avatars é do Admin; profile-pics é do robô de coleta.
func padrao() map[string]*bucket {
	conteudo := func(e *autz.Escopo, _ *auth.Ator, _ string) bool {
		return e != nil && e.Ativo && (e.Papel == "admin" || e.SuperFicha || e.Modulo("conteudo"))
	}
	// fabrica-criativos: `gestor-envios/` é do gestor (papel admin ou módulo meta.gestor, a policy gestor_envios_*); o resto
	// é da Fábrica, a regra de fab_criativos_write: papel admin, super ou a CHAVE meta.fabrica em permissions (a pessoa
	// da Fábrica e o robô dela, que tem a chave). meta.fabrica é chave de permissions, não módulo de features.
	criativos := func(e *autz.Escopo, _ *auth.Ator, c string) bool {
		if e == nil || !e.Ativo {
			return false
		}
		if strings.HasPrefix(c, "gestor-envios/") {
			return e.Papel == "admin" || e.SuperFicha || e.Modulo("meta.gestor")
		}
		return e.Papel == "admin" || e.SuperFicha || e.Chaves["meta.fabrica"]
	}
	roboDeMeta := func(e *autz.Escopo, a *auth.Ator, _ string) bool {
		return e != nil && e.Ativo && (e.SuperFicha || (servico(a) && e.Modulo("meta")))
	}
	l := []*bucket{
		{Nome: "acessos-avatars", Publico: true, Max: 5 * MiB, Tipos: conjunto(imagens...), Ler: todos, Escrever: adminDeAcessos, Apagar: adminDeAcessos},
		{Nome: "acessos-termos", Max: 50 * MiB, Tipos: conjunto("application/pdf", "image/jpeg", "image/png", "image/webp", "application/msword",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document"), Ler: adminDeAcessos, Escrever: adminDeAcessos, Apagar: adminDeAcessos},
		{Nome: "arquivos", Max: 50 * MiB, Tipos: conjunto(tiposDoBanco...),
			Ler:      func(e *autz.Escopo, _ *auth.Ator, _ string) bool { return pode(e, "banco", "ver") },
			Escrever: func(e *autz.Escopo, _ *auth.Ator, _ string) bool { return pode(e, "banco", "criar") },
			Apagar:   func(e *autz.Escopo, _ *auth.Ator, _ string) bool { return pode(e, "banco", "excluir") }},
		{Nome: "avatars", Publico: true, Max: 2 * MiB, Tipos: conjunto(imagens...), Ler: todos,
			Escrever: func(e *autz.Escopo, _ *auth.Ator, _ string) bool { return papelAdmin(e) },
			Apagar:   func(e *autz.Escopo, _ *auth.Ator, _ string) bool { return papelAdmin(e) }},
		{Nome: "conteudo", Max: 300 * MiB, Tipos: conjunto("image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime"),
			Ler: conteudo, Escrever: conteudo, Apagar: conteudo},
		{Nome: "fabrica-criativos", Publico: true, Max: 100 * MiB, Tipos: conjunto(append(slices.Clone(imagens), "video/mp4", "video/quicktime")...),
			Ler: todos, Escrever: criativos, Apagar: criativos},
		{Nome: "ig-cache", Publico: true, Max: 25 * MiB, Tipos: conjunto(append(slices.Clone(imagens), "video/mp4")...), Ler: todos,
			Escrever: func(*autz.Escopo, *auth.Ator, string) bool { return false },
			Apagar:   func(*autz.Escopo, *auth.Ator, string) bool { return false }},
		{Nome: "profile-pics", Publico: true, Max: 5 * MiB, Tipos: conjunto(imagens...), Ler: todos, Escrever: roboDeMeta, Apagar: roboDeMeta},
		{Nome: "publico", Publico: true, Max: 5 * MiB, Tipos: conjunto(append(slices.Clone(imagens), "application/pdf")...), Ler: todos, Escrever: soSuper, Apagar: soSuper},
		// vessel-curriculos: leitura só do robô da triagem (sessão de serviço); o envio é a rota anônima/Core de curriculo.go
		{Nome: nomeCurriculos, Max: 5 * MiB, Tipos: conjunto(tiposDeCurriculo...),
			Ler: func(e *autz.Escopo, a *auth.Ator, _ string) bool {
				return e != nil && e.Ativo && (e.SuperFicha || servico(a))
			},
			Escrever: func(*autz.Escopo, *auth.Ator, string) bool { return false },
			Apagar: func(e *autz.Escopo, a *auth.Ator, _ string) bool {
				return e != nil && e.Ativo && (e.SuperFicha || servico(a))
			}},
	}
	m := make(map[string]*bucket, len(l))
	for _, b := range l {
		m[b.Nome] = b
	}
	return m
}

const nomeCurriculos = "vessel-curriculos"

var tiposDeCurriculo = []string{"application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	"image/jpeg", "image/png", "image/heic", "image/heif", "image/webp"}

// tiposDoBanco: os 41 tipos do bucket `arquivos` de hoje (levantamento 10-buckets.csv): é o banco de arquivos da
// equipe, aceita quase tudo (por isso o download nunca renderiza na origem da API: ver servir.go).
var tiposDoBanco = []string{"image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/heic", "video/mp4", "video/quicktime",
	"application/pdf", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	"application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint", "application/zip", "application/x-zip-compressed",
	"application/x-7z-compressed", "application/x-rar-compressed", "application/gzip", "application/x-tar", "text/plain", "text/csv", "text/markdown",
	"text/html", "text/css", "application/json", "application/xml", "text/xml", "application/javascript", "text/javascript", "application/x-powershell",
	"text/x-powershell", "application/x-msdownload", "application/x-msdos-program", "application/vnd.microsoft.portable-executable", "application/x-sh",
	"application/x-shellscript", "application/x-bat", "application/x-apple-diskimage", octetStream}

// extensoesDe: as extensões coerentes com o tipo declarado nos buckets que NÃO aceitam octet-stream (um .html declarado
// image/png é o ataque que isto fecha). Bucket com octet-stream (o banco de arquivos) aceita qualquer nome.
var extensoesDe = map[string][]string{
	"image/jpeg": {".jpg", ".jpeg"}, "image/png": {".png"}, "image/webp": {".webp"}, "image/gif": {".gif"},
	"image/heic": {".heic"}, "image/heif": {".heif"}, "video/mp4": {".mp4", ".m4v"}, "video/quicktime": {".mov"},
	"application/pdf": {".pdf"}, "application/msword": {".doc"},
	"application/vnd.openxmlformats-officedocument.wordprocessingml.document": {".docx"},
}

// tipoPelaExtensao: o tipo que a resposta declara (nunca o que o cliente mandou no envio; nada é guardado do envio).
var tipoPelaExtensao = map[string]string{
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
	".heic": "image/heic", ".heif": "image/heif", ".mp4": "video/mp4", ".m4v": "video/mp4", ".mov": "video/quicktime", ".pdf": "application/pdf",
}

// semRisco: o que o navegador pode mostrar na própria resposta sem executar nada: imagem raster, vídeo e PDF. O resto
// (html, svg, js, xml, txt…) sai como attachment.
var semRisco = conjunto("image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/quicktime", "application/pdf")
