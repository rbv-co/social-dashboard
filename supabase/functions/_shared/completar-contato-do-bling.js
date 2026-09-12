// COMPLETAR O CADASTRO DA CLIENTE NO BLING com o que ela mesma preencheu ao
// validar a garantia.
//
// POR QUE ISTO EXISTE: na hora da venda a vendedora quase nunca consegue tirar
// todos os dados. Validar a garantia é o momento em que a própria cliente
// preenche o que faltou — e seria desperdício deixar isso morrer numa tabela.
//
// ⚠️ A REGRA DO DONO (06/09/2026): O QUE A CLIENTE ESCREVEU GANHA. Ela é quem
// sabe o próprio dado, e corrige o que a vendedora anotou errado. A troca é
// consciente: um erro de digitação dela sobrescreve o dado bom da loja — por
// isso a conferência na página (`erroDaDataDeNascimento`, `cpfValido`) é a
// última porta, e não enfeite.
//
// ⚠️ PRODUTO E CONTATO TÊM REGRAS OPOSTAS NO BLING. MEDIDO em 06/09/2026, com
// contatos descartáveis criados e apagados na conta de verdade:
//
//   PRODUTO → usar PATCH. O PUT apaga as fotos e ainda responde 200.
//   CONTATO → só existe PUT. O PATCH responde 404 (RESOURCE_NOT_FOUND) num
//             contato que EXISTE, e não escreve nada — a rota simplesmente não
//             existe. O PUT responde 204 e grava.
//
// ⚠️⚠️ E O PUT PARCIAL APAGA, EM SILÊNCIO. Medido no mesmo dia: um PUT mandando
// só `nome/tipo/situacao/numeroDocumento/celular` respondeu **204 (sucesso)** e
// deixou `telefone`, `email`, `dadosAdicionais.naturalidade` e
// `endereco.geral.cep` **VAZIOS**. Nenhum erro, nenhum aviso. É o mesmo desastre
// do PUT de produto apagando as fotos, na rota que não tem PATCH para escapar.
//
// POR ISSO A FUNÇÃO ABAIXO DEVOLVE O CONTATO INTEIRO, e não um punhado de
// campos. Quem for "enxugar o corpo do PUT" um dia: é isso que apaga o cadastro
// da cliente.
//
// Não dá para "usar PATCH por segurança" aqui: não há PATCH. A segurança vem de
// outro lugar — LER O CONTATO INTEIRO e devolvê-lo INTEIRO, com três campos
// trocados. Provado: depois do PUT, telefone, e-mail, naturalidade, sexo e CEP
// continuavam lá. Mandar de volta só os campos que mudaram é que apagaria os
// outros sem ninguém ver.

/** Só os campos que a cliente preencheu. Vazio não sobrescreve nada: "ela não
 *  respondeu" não é o mesmo que "ela apagou". */
function preenchido(v) {
  return v !== null && v !== undefined && String(v).trim() !== '';
}

/**
 * @param contato  o contato COMPLETO, como o Bling devolveu no GET
 * @param garantia a linha de `vessel_registros`
 * @returns {corpo, mudou, campos} — `corpo` é o contato inteiro para devolver
 */
export function completarContato(contato, garantia) {
  const atual = contato && typeof contato === 'object' ? contato : {};
  const g = garantia || {};
  const corpo = JSON.parse(JSON.stringify(atual));
  const campos = [];

  // `id` não vai no corpo: ele identifica o contato na URL, e mandá-lo dentro
  // já fez o Bling recusar com "campo não permitido" em outras rotas.
  delete corpo.id;

  if (preenchido(g.nome) && String(g.nome).trim() !== String(atual.nome ?? '').trim()) {
    corpo.nome = String(g.nome).trim();
    campos.push('nome');
  }

  // O WHATSAPP VAI EM `celular`, e não em `telefone`: nos contatos de verdade
  // desta conta é `celular` que a equipe procura. (O mesmo já vale no espelho
  // da lista de espera.)
  if (preenchido(g.whatsapp) && String(g.whatsapp) !== String(atual.celular ?? '')) {
    corpo.celular = String(g.whatsapp);
    campos.push('celular');
  }

  // A DATA DE NASCIMENTO mora em `dadosAdicionais`, e não no topo do contato.
  if (preenchido(g.nascimento)) {
    const antes = { ...(atual.dadosAdicionais || {}) };
    if (String(antes.dataNascimento ?? '') !== String(g.nascimento)) {
      corpo.dadosAdicionais = { ...antes, dataNascimento: String(g.nascimento) };
      campos.push('nascimento');
    }
  }

  return { corpo, mudou: campos.length > 0, campos };
}
