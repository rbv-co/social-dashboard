// Decisão pura de acesso à rota — separada do router e da cadeia de imports do
// Supabase para poder ser testada sem stub de `window` nem instanciar o roteador.
//
// Isto NÃO é segurança: o front é público, qualquer um lê o bundle e pula esta
// guarda pelo console do navegador. Quem garante o acesso de verdade é o RLS
// do banco e as Edge Functions. Esta guarda é só aparência — evita que uma tela
// sem gate próprio fique visível por esquecimento (foi o caso de /claude-status
// e /noticias) e evita tela branca em rota que não existe mais.
//
// Devolve `true` (pode entrar) ou o destino do redirecionamento (objeto de
// rota do vue-router: { name }).
//
// O `meta` de cada rota NÃO é escrito à mão em mapa-de-enderecos.js: vem de
// `metaDaRota()` do catálogo (compartilhado/catalogo-de-ferramentas.js).
//   meta.recurso    → a chave da ferramenta
//   meta.qualquerDe → uma PORTA (menu): entra quem vê qualquer uma de dentro
//   meta.superadmin → só super-admin (a Administração)
//   meta.foraDoCatalogo → rota que ninguém registrou: fechada
export function podeEntrar(rota, temSessao, checarPermissao, ehSuperadmin = false) {
  if (rota.name === 'login') return true
  if (!temSessao) return { name: 'login' }
  if (!rota.name) return { name: 'inicio' } // rota inexistente: Início, nunca tela branca
  const meta = rota.meta || {}
  // Rota que o catálogo não conhece fica FECHADA, não aberta por omissão.
  if (meta.foraDoCatalogo) return { name: 'inicio' }
  if (meta.superadmin && !ehSuperadmin) return { name: 'inicio' }
  if (meta.recurso && !checarPermissao(meta.recurso)) return { name: 'inicio' }
  if (Array.isArray(meta.qualquerDe) && !meta.qualquerDe.some((k) => checarPermissao(k))) return { name: 'inicio' }
  return true
}
