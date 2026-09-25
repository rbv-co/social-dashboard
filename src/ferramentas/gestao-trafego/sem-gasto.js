// Campanha ATIVA que ainda não gastou nada precisa aparecer na lista.
//
// A lista de campanhas é montada a partir do /insights com `spend > 0` — é de
// lá que vêm os números do cartão. Efeito colateral: campanha que acabou de
// subir (ou que está ativa mas travada, sem entregar) simplesmente NÃO EXISTIA
// na tela. Em 25/09/2026 a "[LEADS] CAUÇÃO GRÁTIS | PIRACICABA" foi ligada à
// meia-noite, aprovada, e o dono abriu a ferramenta e não a achou — parecia que
// ela nem tinha subido.
//
// Aqui entra uma linha "vazia" para cada campanha em veiculação que o
// /insights não trouxe. Os números vão zerados (é a verdade: R$ 0,00), e a
// marca `aguardandoEntrega` deixa a tela dizer por que ela está sem número.
//
// Só vale quando o período olhado chega até HOJE: ver "mês passado" ou
// "ontem" e dar com uma campanha criada hoje marcada como "aguardando entrega"
// seria dizer algo sobre um período em que ela nem existia.
// PURO: o `agora` entra por parâmetro, como em veiculacao.js.

import { emVeiculacao } from './veiculacao.js';

export function campanhasAguardandoEntrega(campanhas, insights, agoraMs, periodoChegaAHoje = true) {
  if (!periodoChegaAHoje) return [];
  const comNumero = new Set((insights || []).map((i) => String(i.campaign_id)));
  return (campanhas || [])
    .filter((c) => c && c.id != null && !comNumero.has(String(c.id)) && emVeiculacao(c, agoraMs))
    .map((c) => ({
      campaign_id: String(c.id),
      campaign_name: c.name || '',
      objective: c.objective || '',
      spend: '0',
      impressions: '0',
      clicks: '0',
      reach: '0',
      actions: [],
      aguardandoEntrega: true,
    }));
}
