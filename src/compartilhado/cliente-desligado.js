// O CLIENTE QUE SOBROU DO SUPABASE (plano 01-D, 22/10/2026): o supabase-js saiu do bundle e do index.html.
// ~16 telas ainda importam `sbClient` no ramo `areaNaApi(...) ? api : sbClient...` (ramo morto: o build da
// API liga todas as áreas). Este objeto tem a MESMA forma que elas usam, mas nenhuma chamada sai da página:
//   - `auth`: sem sessão (era o que o supabase-js devolvia com `persistSession:false`); entrar/trocar
//     senha/recuperar respondem erro, pois a conta mora na API (`entrarPelaApi`);
//   - `from`/`rpc`/`functions`/`storage`/`channel`: respondem `{ data: null, error }`, como o supabase-js
//     responde a uma chamada que falhou (nunca lança). Quem cair aqui mostra o erro em vez de travar.
const DESLIGADO = { message: 'O Supabase foi desligado: esta chamada deveria ir pela API.', code: 'supabase_desligado' }
const falha = { data: null, error: DESLIGADO }

// Encadeável e "await-ável": `sbClient.from('x').select().eq('a', 1)` → `{ data: null, error }`.
function consulta() {
  const p = new Proxy(function () {}, {
    get: (_, chave) => (chave === 'then' ? (ok, ko) => Promise.resolve(falha).then(ok, ko) : p),
    apply: () => p,
  })
  return p
}

const semSessao = { data: { session: null }, error: null }

export function criarClienteDesligado() {
  return {
    auth: {
      getSession: async () => semSessao,
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
      signInWithPassword: async () => falha,
      updateUser: async () => falha,
      resetPasswordForEmail: async () => falha,
    },
    from: consulta,
    rpc: consulta,
    functions: { invoke: async () => falha },
    storage: { from: consulta },
    channel: () => ({ on() { return this }, subscribe() { return this }, unsubscribe() {} }),
    removeChannel: async () => 'ok',
  }
}
