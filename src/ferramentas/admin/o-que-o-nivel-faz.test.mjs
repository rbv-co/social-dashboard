import { test } from 'node:test'
import assert from 'node:assert/strict'
import { oQueONivelFaz, temFraseConferida, FRASES, NEUTRO } from './o-que-o-nivel-faz.js'

test('a frase diz o que a pessoa CONSEGUE e o que NAO consegue', () => {
  const f = oQueONivelFaz('frota', 'mexer')
  assert.match(f, /checklist/i)
  assert.match(f, /não cadastra/i)
})

test('o mesmo degrau em ferramentas diferentes NAO da a mesma frase', () => {
  // E o defeito que motivou tudo: "Ver e mexer" na Frota e pegar carro;
  // na Gestao de Trafego e mexer em orcamento que esta gastando agora.
  assert.notEqual(oQueONivelFaz('frota', 'mexer'), oQueONivelFaz('meta.gestor', 'mexer'))
})

test('ferramenta sem frase conferida cai no texto neutro, e nao inventa nada', () => {
  // A garantia real: quando nao ha frase conferida, a tela usa o texto que
  // descreve o EFEITO DO NIVEL (verdade em qualquer ferramenta) e nunca um
  // texto sobre aquela ferramenta. Comparar com o proprio NEUTRO e mais
  // preciso que farejar palavras: "apaga" e generico e legitimo, "cadastra
  // veiculo" nao seria.
  assert.equal(temFraseConferida('escritorio3d'), false)
  assert.equal(oQueONivelFaz('escritorio3d', 'tudo'), NEUTRO.tudo)
  assert.equal(oQueONivelFaz('escritorio3d', 'sem'), NEUTRO.sem)
  assert.ok(oQueONivelFaz('escritorio3d', 'tudo').length > 0, 'nunca devolve vazio')
})

test('"sem acesso" fala do MENU quando o menu depende SO daquela chave', () => {
  // Frota tem card proprio em tela-de-menu-gestao-interna.vue:66, gateado so
  // por hasPermission('frota','ver'): tirar a chave faz o card sumir mesmo.
  assert.match(oQueONivelFaz('frota', 'sem'), /não aparece/i)
})

test('nao promete sumico de menu que e liberado por um OU de varias chaves', () => {
  // O card de Redes na tela de Inicio (tela-de-inicio.vue:184) sai de
  // social || social.relatorio || conteudo, e 13 das 15 pessoas tem
  // social.relatorio: tirar 'social' NAO faz o menu sumir. Idem o texto
  // neutro, que serve sales.gestao/sales.analise (card de Vendas) e
  // meta.campanha (card de Meta), ambos OU de duas chaves.
  assert.doesNotMatch(oQueONivelFaz('social', 'sem'), /menu/i)
  assert.match(oQueONivelFaz('social', 'sem'), /não abre/i)
  assert.doesNotMatch(NEUTRO.sem, /menu/i)
})

test('recurso desconhecido nao estoura', () => {
  assert.ok(oQueONivelFaz('inventado', 'tudo').length > 0)
  assert.ok(oQueONivelFaz(null, null).length > 0)
})

test('Task 2b: claude.status virou tela so de leitura — o texto nao pode prometer escrita', () => {
  // Ate 19/08/2026 esta permissao dava direito de MEXER: o quadro de projetos
  // (criar/editar/arrastar/arquivar) ficava liberado assim que a rota deixava
  // entrar, porque tela-de-status-claude.vue nao tem NENHUM hasPermission por
  // dentro. O quadro saiu da tela, e com ele a escrita: nao sobrou um unico
  // insert/update na tela. Se alguem devolver o quadro sem devolver o degrau da
  // permissao, este teste continua passando — o que ele guarda e a promessa do
  // texto, que nao pode falar de criar/editar enquanto nao houver o que criar.
  const txt = oQueONivelFaz('claude.status', 'ver')
  assert.match(txt, /so de leitura|só de leitura/i)
  assert.doesNotMatch(txt, /cria, edita|arrasta|arquiva/i)
})

test('Task 2b: conteudo.aprovar decide a peca dos OUTROS, e quem trava e o banco', () => {
  // Evidencia: dados-conteudo.js:56-58 (podeAprovar) + estados.js:69
  // (podeTransicionar exige podeAprovar) + painel-peca.vue:215 (botao some
  // sem a permissao, mas o gate de verdade e a trigger do banco).
  assert.match(oQueONivelFaz('conteudo.aprovar', 'ver'), /aprova e reprova/i)
  assert.match(oQueONivelFaz('conteudo.aprovar', 'sem'), /não decide/i)
})

test('Task 2b: autenticidade separa "gerar lote" (criar) de "marcar gravada" (editar)', () => {
  // Evidencia: tela-de-autenticidade.vue:15 (podeCriar → botao "Gerar lote")
  // e :75 (podeEditar → botao "Gravei essa").
  assert.match(oQueONivelFaz('autenticidade', 'mexer'), /marca cada etiqueta/i)
  assert.match(oQueONivelFaz('autenticidade', 'mexer'), /não gera lote/i)
  assert.match(oQueONivelFaz('autenticidade', 'tudo'), /mais gerar lote/i)
})

test('Task 2b: as .relatorios (gestor/patrimonio/frota) e social.relatorio seguem o mesmo padrao ver→exportar', () => {
  for (const chave of ['gestor.relatorios', 'patrimonio.relatorios', 'frota.relatorios', 'social.relatorio']) {
    assert.match(oQueONivelFaz(chave, 'ver'), /não baixa|não baixa a planilha|não baixa o arquivo/i,
      `${chave}.ver deveria dizer que nao baixa nada`)
    assert.match(oQueONivelFaz(chave, 'exportar'), /baixa/i, `${chave}.exportar deveria mencionar baixar`)
  }
})

test('as que continuam no texto neutro', () => {
  // Em 13/08/2026 esta lista caiu de 6 para 4, e por dois motivos diferentes:
  //
  // - `banco` GANHOU frase, porque a escada dele passou a mandar em alguma
  //   coisa (item B1c). Era o caso mais gritante: quem tinha "Só ver" enviava
  //   arquivo, e "Tudo" não apagava.
  // - `sales.metas` saiu da lista porque saiu do sistema (item B1d): a chave
  //   não governava nada e foi tirada do catálogo E dos 15 perfis que a tinham.
  //
  // As 3 primeiras que sobram seguem sem frase por um motivo que MUDOU de
  // forma: elas não têm mais o degrau "Ver e baixar" (item B1e tirou a ação
  // 'exportar' das quatro que não baixam nada), então hoje são ferramentas de
  // um degrau só. Frase para "Só ver" seria repetir o texto neutro.
  for (const chave of ['sales.gestao', 'sales.analise', 'meta.campanha', 'escritorio3d']) {
    assert.equal(temFraseConferida(chave), false, `${chave} deveria seguir sem frase conferida`)
  }
})

test('o Banco de Arquivos agora TEM frase, e ela fala de enviar e apagar', () => {
  // Guarda do item B1c: se alguém desfizer o enforcement e a frase ficar, a
  // tela volta a mentir sobre permissão — que é o que este módulo existe para
  // impedir.
  assert.equal(temFraseConferida('banco'), true)
  assert.match(oQueONivelFaz('banco', 'ver'), /Não envia nem apaga/)
  assert.match(oQueONivelFaz('banco', 'tudo'), /ENVIA e APAGA/)
  assert.match(oQueONivelFaz('banco', 'tudo'), /não há lixeira/)
})

test('as frases batem com os degraus que a ferramenta REALMENTE tem', async () => {
  // O teste antigo so olhava para dentro de FRASES: nao pegava frase de um
  // degrau inexistente (meta.gestor nao tem "tudo") nem frase faltando num
  // degrau que existe. Sem cruzar com o catalogo, ele valida so a coerencia
  // do proprio erro.
  globalThis.window = { supabase: { createClient: () => ({}) } }
  const { RECURSOS } = await import('../../compartilhado/controle-de-login-e-usuario.js')
  const { degrausDoRecurso } = await import('./niveis-de-permissao.js')

  for (const [chave, porDegrau] of Object.entries(FRASES)) {
    const recurso = RECURSOS.find((r) => r.key === chave)
    assert.ok(recurso, `${chave} tem frase e nao existe em RECURSOS`)
    const reais = new Set(degrausDoRecurso(recurso).map((d) => d.chave))

    for (const escrito of Object.keys(porDegrau)) {
      assert.ok(reais.has(escrito),
        `${chave}.${escrito}: frase para um degrau que a tela nunca oferece`)
    }
    for (const real of reais) {
      assert.ok(porDegrau[real],
        `${chave}.${real}: degrau existe e ficou sem frase — cairia no texto neutro no meio de uma ferramenta conferida`)
    }
  }
})
