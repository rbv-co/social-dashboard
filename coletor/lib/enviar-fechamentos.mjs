// Manda as mensagens de fechamento do dia, cada uma independente da outra. Devolve os nomes que
// FALHARAM: quem chama marca a rodada como falha (exit 1), senão o painel de saúde fica verde com a mensagem perdida.
export async function enviarFechamentos(mensagens, enviar, log = console.error) {
  const falhas = [];
  for (const [nome, msg] of mensagens) {
    if (!msg) continue;
    try {
      await enviar(msg);
    } catch (e) {
      falhas.push(nome);
      log(`Falha ao mandar a mensagem de fechamento (${nome}):`, e.message);
    }
  }
  return falhas;
}
