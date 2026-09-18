// supabase/functions/_shared/senha-gerada.js
// A SENHA QUE A CLIENTE RECEBE POR E-MAIL.
//
// ⚠️ SEM CARACTERE AMBÍGUO. Ela copia do e-mail e digita no celular: 0/O e
// 1/l/I viram "minha senha não funciona", que chega como chamado de suporte.
export const ALFABETO_DA_SENHA = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

export const TAMANHO_DA_SENHA = 12;

/** `sorteio` existe para o teste ser determinístico. Em produção é
 *  `crypto.getRandomValues`, injetado por quem chama — nunca `Math.random`. */
export function gerarSenha(sorteio) {
  const sortear = sorteio ?? (() => {
    const n = new Uint32Array(1);
    crypto.getRandomValues(n);
    return n[0] / 2 ** 32;
  });
  let senha = '';
  for (let i = 0; i < TAMANHO_DA_SENHA; i++) {
    senha += ALFABETO_DA_SENHA[Math.floor(sortear() * ALFABETO_DA_SENHA.length)];
  }
  return senha;
}
