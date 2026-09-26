// O ALVO de cada tipo de campanha: quanto o dono aceita pagar por um resultado,
// na unidade que faz sentido para aquele objetivo.
//
// A regra que amarra tudo: TODA meta aqui é "custo por resultado, MENOR É MELHOR".
// É isso que permite um semáforo só para a ferramenta inteira. Por isso vendas usa
// CAC (custo por compra) e não ROAS — ROAS é maior-é-melhor e precisaria de uma
// régua invertida, uma segunda régua para manter na cabeça.
//
// `resultado` e a metrica da QUANTIDADE daquele resultado (nao do custo): e o
// numero que faz sentido mostrar no detalhe do exemplo. Campanha de lead mostra
// LEADS, nao curtida e salvamento — mostrar interacao numa campanha de lead nao
// diz nada sobre o que ela comprou.
//
// ATUALIZADO 24/09/2026: engajamento passou a usar `engaj_pub` (post_engagement
// bruto) como resultado, junto com a troca de régua explicada no bloco dele
// abaixo. Antes da troca, `resultado` era null porque o julgamento era pelo
// PONTO da métrica ponderada, e o detalhe do exemplo já era a própria quebra
// das interações — isso continua existindo na tela, só não é mais o que decide
// a cor do semáforo. PURO: sem rede, sem tela.
import { faixaDoIndice } from './ponderada.js';

export const ALVOS = {
  engajamento: {
    // TROCA DE RÉGUA (24/09/2026, decisão do dono depois da medição): o veredito
    // de engajamento saiu do PONTO PONDERADO e passou para o ENGAJAMENTO BRUTO.
    // Medindo campanhas reais, a [FLUXO SHOPPING] da Vessel tinha 11.323
    // engajamentos e 44 pontos — julgada por ponto parecia catastrófica (662× a
    // meta, recebeu "reduzir" em 24/09), por engajamento pareceria ótima. E não
    // há fator de conversão: a razão pontos/engajamento foi de 0 a 0,56 nas
    // campanhas medidas.
    //
    // A ponderada NÃO foi apagada — só deixou de ser consultada. O que ESTÁ
    // garantido e provado hoje: `ponderada.js` intacto (pesos, colunas do
    // banco, `calcularPonderada`), as duas metas coexistindo sem se
    // sobrescreverem (a antiga em `metas.engajamento`, a nova em
    // `metas.engajamento_bruto`) e a meta em R$/ponto sobrevivendo ao salvar
    // na tela da régua.
    // CORREÇÃO (revisão final da Onda B, correção 2, 25/09/2026): trocar só
    // `metrica` para `'ponderada'` aqui e apagar `chaveMeta` NÃO religa nada
    // sozinho — "duas linhas" era promessa falsa. `custoDoAlvo` (metricas.js)
    // tem uma guarda explícita que devolve `null` para `metrica === 'ponderada'`
    // (o ramo que chamava `calcularPonderada` foi REMOVIDO de lá, não
    // desviado), e o cartão (tela-de-gestao-trafego.vue) não sabe ler
    // `'ponderada'` no catálogo de métricas — o veredito de toda campanha de
    // engajamento sairia com custo NULO, não com o ponto de volta. São DOIS
    // lugares reais a corrigir: `custoDoAlvo` (metricas.js) e a leitura do
    // cartão (mais os chips "Custo/ponto"/"Qualidade", removidos de lá, que
    // precisariam voltar). `custoAtualDoAlvo` (budget-ia.mjs) NÃO é um
    // terceiro lugar — ele só chama `custoDoAlvo`, então corrigido lá ele
    // acompanha sem edição própria. Os limiares das duas seções da régua
    // (Seção 1 = ponto, Seção 2 = resultado) também se misturariam se o
    // caminho de leitura não for redesenhado junto. Um interruptor de
    // verdade — para os dois lugares reais — está planejado para a onda
    // seguinte; até lá, isto aqui é só a metade que fica pronta, não o
    // caminho de volta inteiro.
    metrica: 'custo_engajamento', resultado: 'engaj_pub', chaveMeta: 'engajamento_bruto',
    rotulo: 'Custo por engajamento', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada engajamento que a Meta conta na publicação (curtida, comentário, compartilhamento, clique, salvamento e afins, todos valendo o mesmo).',
  },
  reconhecimento: {
    // "impressões", NÃO "pessoas alcançadas": a conta é CPM (gasto ÷ impressões ×
    // 1000), e uma mesma pessoa pode ver o anúncio várias vezes. Com frequência 1,5
    // o rótulo errado faria o dono definir a meta com um denominador 50% maior do
    // que o real — e o veredito de verba sairia contra um número que ele entendeu
    // de outro jeito. Este rótulo alimenta três lugares: a linha da régua, o título
    // do exemplo vivo e a frase do veredito.
    metrica: 'cpm', resultado: 'impressoes', rotulo: 'Custo por mil impressões', unidade: 'R$',
    ajuda: 'Campanha de reconhecimento existe para aparecer. O preço justo é por mil impressões.',
  },
  trafego: {
    metrica: 'custo_visita', resultado: 'visitas', rotulo: 'Custo por visita', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cada pessoa que realmente chegou no destino.',
  },
  mensagens: {
    // O dono chama de LEAD a conversa iniciada (decisão de 24/09/2026): quem abre
    // conversa no WhatsApp já é lead para ele. A CONTA não muda — continua
    // messaging_conversation_started, como decidido em 2026-07-29 (ver baldes.js).
    // Só o nome que ele lê na tela e na justificativa.
    metrica: 'custo_conversa', resultado: 'conversas', rotulo: 'Custo por lead', unidade: 'R$',
    ajuda: 'Cada conversa de WhatsApp aberta. É o resultado que essa campanha compra.',
  },
  leads: {
    metrica: 'custo_lead', resultado: 'leads', rotulo: 'Custo por lead', unidade: 'R$',
    ajuda: 'Quanto você aceita pagar por cadastro recebido.',
  },
  vendas: {
    metrica: 'cac', resultado: 'compras', rotulo: 'Custo por venda', unidade: 'R$',
    ajuda: 'Quanto custa trazer uma venda. Usamos custo por venda (e não ROAS) para toda a ferramenta ter uma régua só.',
  },
};

// Sem alvo definido devolve null — e null faz o veredito cair na leitura de saúde
// daquele objetivo, que é melhor do que inventar um alvo qualquer.
export function alvoDoBalde(balde) {
  return (balde && ALVOS[balde]) || null;
}

export function avaliarAlvo(entrada) {
  const e = entrada || {};
  const custo = Number(e.custo);
  const meta = Number(e.meta);
  const temCusto = e.custo != null && Number.isFinite(custo) && custo >= 0;
  const temMeta = Number.isFinite(meta) && meta > 0;
  const indice = (temCusto && temMeta) ? custo / meta : null;
  return { indice, faixa: faixaDoIndice(indice, e.limiares) };
}
