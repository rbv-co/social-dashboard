/* O ABASTECIMENTO — a regra, longe da tela.
 *
 * Desenho: docs/superpowers/specs/2026-09-21-frota-abastecimento-design.md
 * D39: número que não fecha AVISA; só o dedo errado barra. Um sistema que
 * recusa o registro do que aconteceu de verdade ensina a não registrar. */

/** O número que a pessoa confere contra o cupom, em reais. Nulo quando não dá
 *  para calcular — nunca zero, que seria um preço. */
export function precoPorLitro(totalCentavos, litros) {
  const t = Number(totalCentavos);
  const l = Number(litros);
  if (!Number.isFinite(t) || !Number.isFinite(l) || t <= 0 || l <= 0) return null;
  return t / 100 / l;
}

const PRECO_MIN = 1;    // R$/litro. Frouxo de propósito: pega o dedo errado,
const PRECO_MAX = 15;   // não a variação de posto pra posto.

export function problemasDoAbastecimento({
  km, kmConhecido, litros, totalCentavos, tanqueDepois,
  abastecidoEm, agoraIso, tanqueDoCarro,
} = {}) {
  const barra = [];
  const avisa = [];
  const n = (v) => {
    if (v === null || v === undefined) return null;
    const num = Number(v);
    if (Number.isFinite(num)) return num;
    return null;
  };

  const kmN = n(km);
  if (kmN === null || kmN <= 0) barra.push('Informe o KM que está no painel.');
  else if (n(kmConhecido) !== null && kmN < n(kmConhecido)) {
    barra.push(`O KM informado (${kmN.toLocaleString('pt-BR')}) é menor que o último `
      + `conhecido deste carro (${n(kmConhecido).toLocaleString('pt-BR')}). Confira o painel.`);
  }

  const litrosN = n(litros);
  if (litrosN === null || litrosN <= 0) barra.push('Informe quantos litros você colocou.');

  const totalN = n(totalCentavos);
  if (totalN === null || totalN <= 0) barra.push('Informe quanto você pagou.');

  const tanqueN = n(tanqueDepois);
  if (tanqueN === null || tanqueN < 0 || tanqueN > 4) {
    barra.push('Diga como ficou o tanque depois de abastecer.');
  }

  const quando = Date.parse(abastecidoEm);
  const agora = Date.parse(agoraIso || new Date().toISOString());
  if (Number.isFinite(quando) && Number.isFinite(agora) && quando > agora) {
    barra.push('A data do abastecimento está no futuro.');
  }

  // Avisos só fazem sentido quando os números existem.
  if (litrosN !== null && n(tanqueDoCarro) !== null && litrosN > n(tanqueDoCarro)) {
    avisa.push(`São ${litrosN.toLocaleString('pt-BR')} litros num tanque de `
      + `${n(tanqueDoCarro).toLocaleString('pt-BR')}. Confirme antes de gravar.`);
  }
  const preco = precoPorLitro(totalN, litrosN);
  if (preco !== null && (preco < PRECO_MIN || preco > PRECO_MAX)) {
    avisa.push(`Isso dá R$ ${preco.toFixed(2).replace('.', ',')} o litro. Confirme os dois números.`);
  }

  return { barra, avisa };
}

const CHEIO = 4;

/** Os trechos fechados: de um tanque CHEIO ao próximo tanque CHEIO.
 *
 * D36. O parcial do meio ENTRA nos litros do trecho — ele foi queimado ali. O
 * que ele não faz é FECHAR um trecho sozinho, porque ninguém sabe quanto havia
 * no tanque antes nem depois dele.
 *
 * Os litros do PRIMEIRO cheio não entram: eles encheram o tanque que rodou
 * ANTES deste trecho. É o erro clássico dessa conta, e ele infla o consumo. */
export function trechosDeConsumo(abastecimentos) {
  const lista = (abastecimentos || [])
    .filter((a) => a && Number.isFinite(Number(a.km)) && Number.isFinite(Number(a.litros)))
    .slice()
    .sort((a, b) => Number(a.km) - Number(b.km));

  const trechos = [];
  let inicio = null;
  let litros = 0;
  for (const a of lista) {
    if (inicio === null) {
      if (Number(a.tanque_depois) === CHEIO) { inicio = a; litros = 0; }
      continue;
    }
    litros += Number(a.litros);
    if (Number(a.tanque_depois) !== CHEIO) continue;
    const km = Number(a.km) - Number(inicio.km);
    // Combustível diferente nas pontas não vira consumo (D37): etanol rende
    // menos que gasolina, e misturar os dois inventaria uma piora.
    if (km > 0 && litros > 0 && a.combustivel === inicio.combustivel) {
      trechos.push({
        de: inicio.id, ate: a.id, km, litros,
        kmPorLitro: km / litros, combustivel: a.combustivel,
      });
    }
    inicio = a;
    litros = 0;
  }
  return trechos;
}

/** O consumo do carro: o trecho mais novo e a média — do MESMO combustível do
 *  trecho mais novo (D37). Nulo enquanto não houver dois cheios — a tela diz
 *  "ainda não dá para calcular", nunca um zero. */
export function consumoDoVeiculo(abastecimentos) {
  const trechos = trechosDeConsumo(abastecimentos);
  if (!trechos.length) return null;
  const recente = trechos[trechos.length - 1];
  /* A MÉDIA É DO MESMO COMBUSTÍVEL do trecho mais novo (D37). Somar etanol com
   * gasolina inventa uma piora que não existe: etanol rende ~30% menos por
   * litro, e um flex que alterna teria a média puxada para baixo sem nada ter
   * acontecido com o carro. `trechos` continua vindo INTEIRO — quem quiser ver
   * o histórico todo tem ele na mão. */
  const mesmos = trechos.filter((t) => t.combustivel === recente.combustivel);
  const soma = mesmos.reduce((total, t) => total + t.kmPorLitro, 0);
  return {
    kmPorLitro: recente.kmPorLitro,
    media: soma / mesmos.length,
    trechos,
  };
}

/** O maior km já registrado num abastecimento deste carro. A QUINTA fonte de
 *  quilometragem (D40). Pelo MAIOR e não pela data, mesma razão das outras
 *  quatro: data digitada errada acontece, odômetro só anda pra frente. */
export function ultimoKmDeAbastecimento(abastecimentos, veiculoId) {
  const meus = (abastecimentos || [])
    .filter((a) => a && a.veiculo_id === veiculoId && Number.isFinite(Number(a.km)))
    .map((a) => Number(a.km));
  return meus.length ? Math.max(...meus) : null;
}

/** O nível do tanque pelo registro MAIS RECENTE — abastecimento ou devolução
 *  (D40). Nulo quando nenhum dos dois informou: travessão, nunca zero, que
 *  seria "Reserva".
 *
 *  ⚠️ `uso` é UM USO SÓ, já escolhido por quem chama — a viagem aberta ou a
 *  última devolução, exatamente o `aberto || fechado` que `estadoDoVeiculo` já
 *  calcula. NÃO é a lista inteira, e a diferença não é estilo.
 *
 *  A primeira versão recebia todos os `frota_uso` do carro e pegava qualquer
 *  linha com `tanque_quartos` preenchido. Isso já discordava da regra antiga
 *  COM A LISTA DE ABASTECIMENTOS VAZIA, que é o estado de produção hoje:
 *
 *   - devolução de ontem sem informar o tanque (18 das 25 viagens) perdia para
 *     uma viagem de semanas atrás que informou: "—, sem alerta" virava
 *     "1/4 · abastecer";
 *   - carro na rua agora, saída sem tanque: virava "Reserva · abastecer";
 *   - volta gravada sem `km_volta` — que `ultimoUsoFechado` descarta de
 *     propósito — passava a mandar, e **Cheio virava Reserva**. Inversão.
 *
 *  O D40 pediu "o registro mais recente ENTRE OS DOIS", não "qualquer uso que
 *  por acaso tenha um número". Quem escolhe o uso é quem já sabe escolher.
 *  As três linhas estão provadas em estado-do-veiculo.test.mjs ("dia zero").
 *
 *  `quando` vira -Infinity quando a data do uso não dá para ler: ele continua
 *  valendo quando é o único candidato (que é o que a regra antiga fazia), e
 *  perde para qualquer abastecimento datado. */
export function tanqueMaisRecente(abastecimentos, uso, veiculoId) {
  const candidatos = [];
  for (const a of abastecimentos || []) {
    if (!a || a.veiculo_id !== veiculoId) continue;
    const t = Date.parse(a.abastecido_em);
    if (Number.isFinite(t) && Number.isInteger(Number(a.tanque_depois))) {
      candidatos.push({ quando: t, nivel: Number(a.tanque_depois) });
    }
  }
  if (uso && uso.veiculo_id === veiculoId && Number.isInteger(uso.tanque_quartos)) {
    const t = Date.parse(uso.volta_em || uso.saida_em);
    candidatos.push({ quando: Number.isFinite(t) ? t : -Infinity, nivel: uso.tanque_quartos });
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => b.quando - a.quando);
  return candidatos[0].nivel;
}

/** O abastecimento deste carro nas últimas `horas`, para a tela avisar antes de
 *  a pessoa digitar (D38b). Duplicata NÃO é barrada: dois abastecimentos no
 *  mesmo dia acontecem de verdade, e uma trava recusaria o registro legítimo
 *  com cara de erro do sistema. */
export function abastecimentoRecente(abastecimentos, veiculoId, agoraIso, horas = 12) {
  const agora = Date.parse(agoraIso || new Date().toISOString());
  if (!Number.isFinite(agora)) return null;
  const limite = agora - horas * 3600 * 1000;
  const achados = (abastecimentos || [])
    .filter((a) => {
      if (!a || a.veiculo_id !== veiculoId) return false;
      const t = Date.parse(a.abastecido_em);
      return Number.isFinite(t) && t <= agora && t >= limite;
    })
    .sort((a, b) => Date.parse(b.abastecido_em) - Date.parse(a.abastecido_em));
  return achados[0] || null;
}

const KML_MIN = 3;    // Frouxo de propósito, como os outros pés: pega o dedo
const KML_MAX = 30;   // errado (litro digitado no lugar do valor), não a
                      // diferença entre um carro pesado e um popular.

/** O aviso de consumo, quando o registro novo FECHA um trecho e o resultado não
 *  se sustenta. Lista vazia é a resposta normal — a maioria dos abastecimentos
 *  não fecha trecho nenhum, e aviso que aparece sempre vira paisagem.
 *
 *  `idDoRegistroNovo` é QUEM está sendo julgado, e é o que faz a frase acima
 *  ser verdade. Sem ele, um trecho ruim JÁ GRAVADO fazia todo abastecimento
 *  parcial seguinte reclamar para sempre — "Este trecho deu 2,0 km/l" sobre um
 *  cupom de meses atrás, na cara de quem acabou de digitar outro. O aviso só
 *  sai quando o trecho mais novo é o que ESTE registro fechou.
 *
 *  Sem o terceiro argumento a função responde como antes (julga o último
 *  trecho, seja de quem for). Quem chama da tela SEMPRE passa o id. */
export function avisosDeConsumo(abastecimentos, veiculoId, idDoRegistroNovo) {
  const meus = (abastecimentos || []).filter((a) => a && a.veiculo_id === veiculoId);
  const trechos = trechosDeConsumo(meus);
  if (!trechos.length) return [];
  const ultimo = trechos[trechos.length - 1];
  if (idDoRegistroNovo !== undefined && ultimo.ate !== idDoRegistroNovo) return [];
  if (ultimo.kmPorLitro >= KML_MIN && ultimo.kmPorLitro <= KML_MAX) return [];
  return [`Este trecho deu ${ultimo.kmPorLitro.toFixed(1).replace('.', ',')} km/l `
    + `(${ultimo.km.toLocaleString('pt-BR')} km com ${ultimo.litros.toLocaleString('pt-BR')} litros). `
    + 'Confira os números.'];
}
