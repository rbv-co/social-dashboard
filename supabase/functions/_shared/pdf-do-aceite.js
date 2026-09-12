/* O PAPEL DO ACEITE DE RETIRADA.
 *
 * POR QUE EXISTE (B14, 18/08/2026): desde 13/08 quem pega um carro conferido por
 * OUTRA pessoa assina um aceite de retirada. Ele fica gravado em `frota_uso`,
 * com o rabisco e o código da ficha de vistoria congelado. **O que não existia
 * era o papel.** Foi decisão consciente na época ("uma assinatura por viagem e
 * nenhum PDF a mais"), e o dono mudou de ideia em 18/08: precisa virar PDF e ir
 * para o Zoho WorkDrive, como o checklist já vai.
 *
 * O QUE VAI NO PAPEL, decidido pelo dono em 18/08: **o aceite mais o RESUMO da
 * vistoria** — hodômetro, tanque, resultado e os itens com problema. Não a lista
 * inteira: ela já está arquivada no PDF do checklist, na mesma pasta, e duplicar
 * faria o Zoho guardar duas vezes o mesmo conteúdo.
 *
 * ESTE ARQUIVO SÓ MONTA O ROTEIRO DE LINHAS. Quem desenha é o `montarPdf` do
 * `pdf-do-checklist.js` — o mesmo papel timbrado, a mesma fonte, o mesmo rodapé.
 * Um segundo desenhador seria um segundo lugar para o timbre envelhecer.
 *
 * ⚠️ NADA DISTO FOI VISTO NUM PAPEL DE VERDADE AINDA, e é honesto dizer:
 *    medido em 18/08/2026, **não existe nenhum aceite assinado** (0 de 12 linhas
 *    de `frota_uso`). A geração tem teste; a entrega no Zoho só se prova no
 *    primeiro aceite real. Se algo falhar, é aqui que se olha primeiro.
 *
 * PURO: sem rede, sem banco. */

import { dataPorExtenso, horaDeBrasilia } from './pdf-do-checklist.js';
import { normalizarRabisco } from './rabisco.js';

const comPonto = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/* O ponteiro do tanque como a pessoa lê no painel.
 *
 * ⚠️ CÓPIA CONSCIENTE de `src/ferramentas/frota/estado-do-veiculo.js`. A Edge
 * Function roda no Deno e não alcança `src/`. O vigia contra divergência é um
 * teste que lê os DOIS arquivos — sem ele, o papel diria "3/4" onde a tela diz
 * "2/4" e ninguém saberia qual está certo. */
export const NIVEIS_TANQUE = ['Reserva', '1/4', '2/4', '3/4', 'Cheio'];

const ROTULO_RESULTADO = {
  liberado: 'Liberado',
  com_ressalvas: 'Liberado com ressalvas',
  nao_liberado: 'Não liberado',
};

const rotuloDoTanque = (q) => (Number.isInteger(q) ? (NIVEIS_TANQUE[q] || 'não informado') : 'não informado');

export function linhasDoAceite({ uso, veiculo, ficha, respostas }) {
  const u = uso || {};
  const v = veiculo || {};
  const L = [];
  const put = (estilo, texto, extra) => L.push({ estilo, texto, ...(extra || {}) });
  const campo = (rotulo, valor) => put('campo', `${rotulo}: ${valor}`, { rotulo, valor });

  put('titulo', 'Aceite de retirada de veículo');
  put('subtitulo', 'Documento gerado pela Central de Inteligência RBV a partir do aceite assinado. '
    + 'Ele registra que quem retirou o carro viu a vistoria feita por outra pessoa e concordou '
    + 'com o estado descrito nela. O conteúdo abaixo é o que foi gravado no dia, e não pode mais '
    + 'ser alterado.');

  put('secao', 'O carro e a retirada');
  campo('Carro', v.nome || 'não informado');
  campo('Placa', v.placa || 'não informada');
  campo('Quem retirou', u.aceite_nome || u.pessoa_nome || 'não informado');
  campo('Saída', u.saida_em ? `${horaDeBrasilia(u.saida_em)} (horário de Brasília)` : 'não informada');
  if (u.destino) campo('Destino', u.destino);
  if (u.finalidade) campo('Finalidade', u.finalidade);

  put('secao', 'A vistoria que ele aceitou');
  if (!ficha) {
    /* SEM A FICHA, O PAPEL DIZ QUE NÃO CONSEGUIU — não omite a seção. Um aceite
       existe justamente por causa de uma vistoria; um papel que a esconde em
       silêncio é pior do que um que assume a falta. */
    put('texto', 'Não foi possível carregar a vistoria congelada neste aceite. '
      + 'O código dela está no fim deste documento e permite achá-la no sistema.');
  } else {
    campo('Vistoria feita em', dataPorExtenso(ficha.feita_em));
    campo('Quem conferiu', ficha.pessoa_nome || 'não informado');
    campo('Hodômetro na vistoria', ficha.hodometro ? `${comPonto(ficha.hodometro)} km` : 'não informado');
    campo('Tanque na retirada', rotuloDoTanque(u.tanque_quartos));

    const resultado = ROTULO_RESULTADO[ficha.resultado] || ficha.resultado || 'não informado';
    put('selo', `Resultado da vistoria: ${resultado}`, {
      rotulo: 'Resultado da vistoria',
      valor: resultado,
      tom: { liberado: 'verde', com_ressalvas: 'laranja', nao_liberado: 'vermelha' }[ficha.resultado] || 'fraca',
    });

    const itens = Array.isArray(respostas) ? respostas : [];
    const comProblema = itens.filter((r) => r && r.estado === 'nao_ok');
    put('texto', `Itens conferidos na vistoria: ${itens.length}.`);
    if (!comProblema.length) {
      put('texto', 'Nenhum item com problema foi apontado.');
    } else {
      put('texto', `${comProblema.length} ${comProblema.length === 1 ? 'item foi apontado' : 'itens foram apontados'} com problema:`);
      for (const r of comProblema) {
        put('item', `Com problema — ${r.item_texto}`, {
          marca: 'Com problema', corpo: r.item_texto, tom: 'vermelha',
        });
        if (r.observacao) put('fraco', `      observação: ${r.observacao}`);
      }
    }
    put('fraco', 'Este é o RESUMO da vistoria. A lista completa está no PDF do checklist, '
      + 'arquivado na mesma pasta deste documento.');
  }

  put('secao', 'A assinatura de quem retirou');
  if (u.aceite_em) {
    campo('Assinado por', u.aceite_nome || 'não informado');
    campo('Assinado em', `${horaDeBrasilia(u.aceite_em)} (horário de Brasília)`);
    put('fraco', `Instante exato registrado pelo servidor: ${new Date(u.aceite_em).toISOString()}`);

    const rabisco = normalizarRabisco(u.aceite_rabisco);
    if (rabisco) {
      put('texto', 'Assinatura de próprio punho, feita na tela:');
      L.push({ estilo: 'rabisco', texto: '', rabisco });
    } else {
      put('fraco', 'Este aceite foi dado sem rabisco desenhado.');
    }
  } else {
    put('texto', 'Este uso NÃO tem aceite assinado.');
    put('fraco', 'O papel foi gerado assim mesmo para não esconder a falta.');
  }

  put('secao', 'O código de conferência');
  put('fraco', 'Este é o código da ficha de vistoria que estava valendo no momento do aceite. '
    + 'Ele congela o que foi aceito: se a ficha for alterada depois no sistema, o código dela '
    + 'muda e deixa de bater com este papel.');
  put('texto', 'Código da vistoria aceita:');
  put('codigo', u.aceite_checklist_hash || '(o aceite foi gravado sem código de vistoria)');

  return L;
}

/* ── Onde o papel mora no Zoho ────────────────────────────────────────────── */

const semCaractereProibido = (s) => String(s ?? '')
  .replace(/[\\/:*?"<>|]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/* A MESMA PASTA DO CHECKLIST daquele carro e mês, de propósito: o aceite e a
 * vistoria que ele aceita são o mesmo assunto, e separá-los obrigaria quem
 * procura o papel de um dia a abrir duas pastas. */
export function pastasDoAceite({ uso, veiculo }) {
  const v = veiculo || {};
  const carro = semCaractereProibido(
    v.placa ? `${v.nome || 'Carro sem nome'} (${v.placa})` : (v.nome || 'Carro sem nome'));
  const mes = /^(\d{4})-(\d{2})/.exec(String(uso?.aceite_em ?? uso?.saida_em ?? ''));
  return ['Frota', carro, mes ? `${mes[1]}-${mes[2]}` : 'sem-data'];
}

/* O nome começa com "aceite-" para não se confundir com o do checklist, que vive
 * na mesma pasta e no mesmo dia. */
export function nomeDoAceite({ uso, veiculo }) {
  const placa = semCaractereProibido(veiculo?.placa || 'sem-placa');
  const dia = /^(\d{4}-\d{2}-\d{2})/.exec(String(uso?.aceite_em ?? uso?.saida_em ?? ''));
  return `aceite-${dia ? dia[1] : 'sem-data'}-${placa}.pdf`;
}
