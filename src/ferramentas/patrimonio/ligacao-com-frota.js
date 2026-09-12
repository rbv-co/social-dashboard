/* A ligação bem↔veículo, olhada do lado do Patrimônio (Bronca 2).
 *
 * Palavras do dono: "lá em gestão de patrimônio eu criei a BMW X1 porém não
 * consigo linkar como frota, só lá em frota eu consigo linkar como bem,
 * precisa ter essa via de mão dupla". O vínculo mora numa coluna só —
 * `frota_veiculos.bem_id` — e até aqui só a tela da Frota sabia escrever
 * nela. Este módulo é a metade que falta: decidir o que a ficha do bem
 * mostra e oferece, sem tocar em Vue.
 *
 * A GRAVAÇÃO CONTINUA NUMA TABELA DA FROTA. Ligar por aqui significa
 * escrever em `frota_veiculos`, que tem RLS própria (`is_frota_admin()`):
 * só quem tem a feature "frota" (ou é super-admin) consegue ler OU escrever
 * essa tabela — não é uma permissão nova, é a mesma que a tela da Frota já
 * respeita. `temAcessoFrota` espelha essa mesma conta no cliente, pra tela
 * saber ANTES de perguntar ao banco se faz sentido até tentar: sem isso, uma
 * lista vazia por falta de acesso pareceria "nenhum veículo ligado", que é
 * dado inventado — a pessoa acharia que pode criar e a gravação falharia
 * calada.
 */

/** Mesma conta de `is_frota_admin()` no banco (migration da Frota): a
 * feature "frota" no perfil, ou super-admin. Se um dia divergir da função no
 * banco, o sintoma é a tela dizer "posso" e o Postgres dizer "não" — mas o
 * INSERT/UPDATE real ainda vai checar a RLS de verdade, então o pior caso é
 * uma tentativa que falha com aviso, nunca uma gravação silenciosa. */
export function temAcessoFrota(estado) {
  if (!estado) return false;
  if (estado.is_superadmin) return true;
  return Array.isArray(estado.features) && estado.features.includes('frota');
}

/** Acha a categoria "Veículos" pela lista de categorias do Patrimônio,
 * tolerante a acento e caixa (a Frota usa o mesmo critério do lado dela,
 * `ilike '%ve%cul%'`, pra achar bens candidatos a virar carro). Sem achar,
 * devolve null — nunca chuta a primeira categoria da lista como se fosse
 * "Veículos". */
export function categoriaVeiculoEntre(categorias) {
  const achada = (categorias || []).find((c) => {
    const nome = String((c && c.nome) || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
    return nome.includes('veicul');
  });
  return achada ? achada.id : null;
}

/** O bem é de uma categoria que faz sentido virar carro? Sem a categoria
 * identificada (Patrimônio carregou mas a categoria "Veículos" não foi
 * encontrada), a resposta é sempre não — mesma cautela de
 * bensLivresParaFrota() no lado da Frota: nunca oferecer a ligação pra
 * qualquer bem só porque a busca da categoria falhou. */
export function bemEhCategoriaVeiculo(bem, categoriaVeiculoId) {
  return !!(bem && categoriaVeiculoId && bem.categoria_id === categoriaVeiculoId);
}

/** O veículo da frota (se algum) que já aponta pra este bem. */
export function veiculoLigadoAoBem(veiculos, bemId) {
  if (!bemId) return null;
  return (veiculos || []).find((v) => v && v.bem_id === bemId) || null;
}

/** Os veículos que dá pra ESCOLHER no seletor "ligar a um veículo existente":
 * só os que ainda não apontam pra bem nenhum. Oferecer um já ligado tiraria
 * a ligação dele sem avisar — dois bens brigando pelo mesmo carro. */
export function veiculosParaLigar(veiculos) {
  return (veiculos || []).filter((v) => v && !v.bem_id);
}

/**
 * O que sugerir no formulário de "criar veículo a partir deste bem": só o
 * que o bem realmente guarda (nome, marca) — placa, chassi e Renavam não
 * existem em patrimonio_bens, quem cria continua digitando. Cada campo só
 * entra se o formulário ainda estiver vazio nele, pro bem sugerir sem apagar
 * o que a pessoa já tinha digitado. Duplica de propósito o mesmo formato de
 * patchDoBem() (Frota, bens-para-veiculo.js): as duas telas moram em pastas
 * de ferramentas diferentes, e cada uma cuida da própria lógica pura — a
 * conta é pequena o bastante pra não valer o acoplamento entre pastas.
 */
export function patchVeiculoDoBem(vForm, bem) {
  const patch = {};
  if (!vForm.nome && bem.nome) patch.nome = bem.nome;
  if (!vForm.marca && bem.marca) patch.marca = bem.marca;
  return patch;
}

/**
 * Este item precisa de placa? Só se for da categoria Veículos.
 *
 * Decisão do dono (20/08/2026): item de veículo não salva sem placa. É ela que
 * faz o carro NASCER na Frota — sem ela o item fica órfão, como o nº 291
 * "KWID" ficou naquele mesmo dia, criado às 09:53 e sem carro nenhum.
 *
 * A PLACA NÃO VIRA COLUNA DE `patrimonio_bens`, e isso é decisão de desenho:
 * ela mora em `frota_veiculos.placa`, que é quem manda nesse dado. A ficha do
 * item a MOSTRA lendo o carro ligado. Guardar cópia nas duas tabelas é o que
 * envelhece e diverge depois.
 *
 * Sem a categoria identificada devolve `false`, mesma cautela de
 * `bemEhCategoriaVeiculo`: se a busca da categoria falhar, exigir placa
 * travaria o cadastro de QUALQUER item da empresa.
 */
export function exigePlacaNoBem(form, categoriaVeiculoId) {
  return bemEhCategoriaVeiculo(form, categoriaVeiculoId);
}

/**
 * A placa é OBRIGATÓRIA agora, ou só desejável?
 *
 * Obrigatória no CADASTRO NOVO: é o que impede um item de veículo de nascer
 * órfão, sem carro do outro lado.
 *
 * Num item que JÁ EXISTE, avisa mas não trava — e isso é decisão do dono de
 * 20/08/2026, na mesma conversa em que ele pediu a obrigatoriedade: o item nº
 * 291 ("KWID") vai ficar sem placa por enquanto, porque o carro dele ainda não
 * foi levantado. Travar a edição obrigaria a inventar uma placa pra corrigir um
 * nome — e placa inventada é pior que placa faltando: ela é UNIQUE, entra no
 * lugar de uma real e some sem ninguém notar.
 */
export function placaObrigatoria(form, categoriaVeiculoId, ehNovo) {
  return !!ehNovo && exigePlacaNoBem(form, categoriaVeiculoId);
}
