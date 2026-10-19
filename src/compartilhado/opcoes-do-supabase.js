// As opções do supabase-js. Com a conta na API (depois da virada, `VITE_API_AREAS` com `conta`) o cliente não tem
// sessão a manter: sem isto, quem tinha uma sessão velha do Supabase guardada neste navegador dispara um refresh
// em supabase.co a cada abertura da Central (e, com o Supabase fora do ar, repete a cada ~30 s).
export function opcoesDoSupabase(contaNaApi, storageEspecial) {
  if (contaNaApi) return { auth: { persistSession: false, autoRefreshToken: false } }
  return storageEspecial ? { auth: { storage: storageEspecial } } : undefined
}

// Com `persistSession:false` o `signOut({scope:'local'})` só limpa a memória: a chave de sessão que o supabase-js gravou
// ANTES (o login pelo Supabase, de antes da virada) ficaria no navegador e, no rollback para o front do Supabase,
// abriria a Central como a pessoa de antes. Apaga as chaves `sb-<ref>-auth-token*` dos armazenamentos dados.
export function apagarSessaoGuardadaDoSupabase(...storages) {
  for (const st of storages) {
    try {
      for (const k of Object.keys(st)) if (/^sb-.+-auth-token/.test(k)) st.removeItem(k)
    } catch { /* armazenamento indisponível: nada a apagar */ }
  }
}
