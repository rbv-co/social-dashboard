// A LISTA DE COLABORADORES COMO O PATRIMÔNIO E A FROTA PRECISAM DELA.
//
// POR QUE ESTE ARQUIVO EXISTE: a tabela `acessos_pessoas` só abre para quem tem
// Colaboradores e Acessos. Medido em 13/08/2026: Gabriel Alves, Guilherme
// Cardoso e Jeremias Vieira mexem na Frota e enxergavam ZERO pessoas — o campo
// "Responsável — de quem é o carro" nascia vazio para eles.
//
// A saída foi a porta estreita: a função `pessoas_para_escolher()` do banco
// entrega nome, cargo, situação e o elo com o login para quem mexe em
// Patrimônio/Frota, e NUNCA e-mail nem telefone. Quem tem Colaboradores e
// Acessos continua lendo a tabela direto, e é dali que vêm os contatos (a Frota
// usa o celular para cobrar multa).
//
// Duas leituras, uma lista só: é isso que este módulo faz.

// Junta pelo id. O que veio da leitura direta (contatos) entra por cima, porque
// é a fonte mais completa; quem só existe num dos dois lados continua na lista.
export function mesclarPessoas(nomes, contatos) {
  const mapa = new Map()
  for (const p of nomes || []) if (p && p.id) mapa.set(p.id, { ...p })
  for (const c of contatos || []) {
    if (!c || !c.id) continue
    mapa.set(c.id, { ...(mapa.get(c.id) || {}), ...c })
  }
  return [...mapa.values()].sort((a, b) =>
    String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR', { sensitivity: 'base' }))
}

// Campo de escolher pessoa mostra quem trabalha aqui hoje. Ficha sem `status`
// conta como ativa: a coluna tem padrão 'ativo' no banco, e sumir com alguém por
// causa de campo vazio seria dado a menos sem avisar.
export function apenasAtivas(pessoas) {
  return (pessoas || []).filter((p) => p && p.status !== 'desligado')
}

// Os cargos que já existem viram sugestão do campo de digitar. Não vira lista
// cadastrada: 23 das 28 pessoas estão sem cargo, e uma tabela nasceria com ~5
// valores para manter, sem ganho nenhum.
export function cargosConhecidos(pessoas) {
  const vistos = new Map()
  for (const p of pessoas || []) {
    const cargo = String((p && p.cargo) || '').trim()
    if (!cargo) continue
    const chave = cargo.toLowerCase()
    if (!vistos.has(chave)) vistos.set(chave, cargo)
  }
  return [...vistos.values()].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

// A pessoa ESCOLHIDA continua aparecendo mesmo depois de desligada. Sem isto o
// campo de um carro (ou de um bem) cujo responsável saiu da empresa fica em
// branco, e a tela passa a dizer "ninguém" sobre um registro que TEM dono.
// O rótulo diz que ela saiu — some do alcance de quem escolhe, não do registro
// que já a aponta.
//
// "(saiu da empresa)" e não "(desligada)": o rótulo vale para qualquer pessoa da
// lista, e no masculino saía "Gabriel Alves (desligada)".
export function comSelecionada(visiveis, todas, id) {
  if (!id) return visiveis || []
  const lista = visiveis || []
  if (lista.some((p) => p && p.id === id)) return lista
  const achada = (todas || []).find((p) => p && p.id === id)
  if (!achada) return lista
  return [...lista, { ...achada, nome: `${achada.nome} (saiu da empresa)` }]
}

// Os argumentos da chamada `criar_pessoa_rapida` no banco. Só o nome é
// obrigatório: exigir marca e setor criaria uma trava nova no lugar da que se
// está tirando (16 das 28 pessoas de hoje estão sem marca, 15 sem setor).
export function dadosDaPessoaRapida({ nome, cargo, marcaId, setorId } = {}) {
  const limpo = String(nome || '').trim()
  if (!limpo) return { ok: false, mensagem: 'Digite o nome da pessoa antes de criar.' }
  return {
    ok: true,
    dados: {
      p_nome: limpo,
      p_cargo: String(cargo || '').trim() || null,
      p_marca_id: marcaId || null,
      p_setor_id: setorId || null,
    },
  }
}
