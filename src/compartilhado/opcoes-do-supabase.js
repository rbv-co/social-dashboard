// As opções do supabase-js. Com a conta na API (depois da virada, `VITE_API_AREAS` com `conta`) o cliente não tem
// sessão a manter: sem isto, quem tinha uma sessão velha do Supabase guardada neste navegador dispara um refresh
// em supabase.co a cada abertura da Central (e, com o Supabase fora do ar, repete a cada ~30 s).
export function opcoesDoSupabase(contaNaApi, storageEspecial) {
  if (contaNaApi) return { auth: { persistSession: false, autoRefreshToken: false } }
  return storageEspecial ? { auth: { storage: storageEspecial } } : undefined
}
