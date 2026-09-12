<script setup>
/* A lista de itens do checklist e os dias em que o semanal e o mensal caem.
 *
 * Igual ao plano de revisão: a repartição é do GESTOR, não do código. O
 * mecânico muda de opinião, a frota muda, e a lista tem que acompanhar sem
 * depender de programador. */
import { reactive, ref, computed, watch } from 'vue'
import { CADENCIAS, problemasDoItemDeChecklist } from '../../../supabase/functions/_shared/checklist.js'

const props = defineProps({
  itens: { type: Array, default: () => [] },
  config: { type: Object, required: true },
  gravando: { type: Boolean, default: false },
  // O que a gravação lá em cima respondeu. Vazio quer dizer "sem notícia
  // ruim" — quem grava é o pai, e sem estes dois o gestor via os dias e o item
  // na tela como se tivessem sido gravados, sem nada dizer que falhou.
  erroConfig: { type: String, default: '' },
  erroItem: { type: String, default: '' },
})
const emit = defineEmits(['salvar-item', 'alternar-item', 'salvar-config', 'alternar-impede'])

const ROTULO = { diario: 'Todo dia', semanal: 'Toda semana', mensal: 'Todo mês' }
const DIAS = [
  { valor: 1, nome: 'segunda-feira' }, { valor: 2, nome: 'terça-feira' },
  { valor: 3, nome: 'quarta-feira' }, { valor: 4, nome: 'quinta-feira' },
  { valor: 5, nome: 'sexta-feira' },
]
const SEMANAS = [
  { valor: 1, nome: '1ª' }, { valor: 2, nome: '2ª' },
  { valor: 3, nome: '3ª' }, { valor: 4, nome: '4ª' },
]

const novo = reactive({ item: '', cadencia: 'diario' })
const erros = ref([])
// Cópia local porque os `<select>` precisam de algo pra editar antes de gravar.
// Como é cópia, ela SÓ pode continuar diferente do que está no banco enquanto a
// gravação não respondeu — os dois `watch` abaixo é que garantem isso.
const cfg = reactive({ ...props.config })

// Gravou: o pai recarrega e manda a configuração nova. A cópia local acompanha,
// senão ela ficaria pra sempre com o que foi digitado, mesmo que o banco tenha
// gravado outra coisa.
watch(() => props.config, (c) => Object.assign(cfg, c), { deep: true })

// Falhou: os dias voltam a mostrar o que está GRAVADO. Deixar na tela a escolha
// que não foi gravada é o defeito em si — o gestor sai achando que o semanal
// mudou de dia, e só recarregando a página descobriria que não mudou.
watch(() => props.erroConfig, (msg) => { if (msg) Object.assign(cfg, props.config) })

const porCadencia = computed(() => CADENCIAS.map((c) => ({
  cadencia: c, rotulo: ROTULO[c],
  itens: props.itens.filter((i) => i.cadencia === c).sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)),
})))

const mesmoNome = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

// O campo só se limpa quando o item REALMENTE aparece na lista (o pai recarrega
// depois de gravar). Limpar na hora do emit apagava o que foi digitado mesmo
// quando a gravação falhava: o gestor perdia o texto e não recebia aviso nenhum.
watch(() => props.itens, (lista) => {
  if (novo.item.trim() && (lista || []).some((i) => mesmoNome(i.item, novo.item))) novo.item = ''
}, { deep: true })

function adicionar() {
  erros.value = problemasDoItemDeChecklist({
    item: novo.item, cadencia: novo.cadencia, existentes: props.itens, idAtual: null })
  if (erros.value.length) return
  emit('salvar-item', { item: novo.item.trim(), cadencia: novo.cadencia,
    ordem: (props.itens.length + 1) * 10 })
}
</script>

<template>
  <section class="ec">
    <h2 class="ec-titulo">Em que dia cai cada conferência</h2>
    <p class="ec-nota">
      O diário é de segunda a sexta. O semanal e o mensal têm dia próprio para
      nenhum dia ficar pesado demais.
    </p>
    <div class="ec-dias">
      <label class="ec-campo">
        <span class="ec-lab">O semanal cai na</span>
        <select v-model.number="cfg.dia_semanal">
          <option v-for="d in DIAS" :key="d.valor" :value="d.valor">{{ d.nome }}</option>
        </select>
      </label>
      <label class="ec-campo">
        <span class="ec-lab">O mensal cai na</span>
        <select v-model.number="cfg.semana_mensal">
          <option v-for="s in SEMANAS" :key="s.valor" :value="s.valor">{{ s.nome }}</option>
        </select>
      </label>
      <label class="ec-campo">
        <span class="ec-lab">do mês, na</span>
        <select v-model.number="cfg.dia_mensal">
          <option v-for="d in DIAS" :key="d.valor" :value="d.valor">{{ d.nome }}</option>
        </select>
      </label>
      <button class="ec-btn" :disabled="gravando" @click="emit('salvar-config', { ...cfg })">
        Salvar os dias
      </button>
    </div>
    <p class="ec-erro" v-if="erroConfig">{{ erroConfig }}</p>

    <h2 class="ec-titulo">Os itens</h2>
    <div v-for="g in porCadencia" :key="g.cadencia" class="ec-grupo">
      <h3 class="ec-grupo-titulo">{{ g.rotulo }} <span class="ec-conta">{{ g.itens.length }}</span></h3>
      <ul class="ec-lista">
        <li v-for="i in g.itens" :key="i.id" class="ec-item" :class="{ desligado: !i.ativo }">
          <span class="ec-item-nome">{{ i.item }}</span>
          <!-- QUAL ITEM IMPEDE O USO é decisão do dono, não do código: é ela que
               separa "com ressalvas" de "não liberado" na ficha do motorista, e
               o resultado deixou de ser digitável em 12/08/2026. Fica aqui, no
               mesmo lugar onde ele já mantém a lista. -->
          <label class="ec-impede" :title="i.impede_uso
            ? 'Com problema neste item, o carro fica NÃO LIBERADO'
            : 'Com problema neste item, o carro fica com ressalvas — mas anda'">
            <input type="checkbox" :checked="!!i.impede_uso" :disabled="gravando"
                   @change="emit('alternar-impede', i)">
            <span>impede o uso</span>
          </label>
          <button class="ec-btn pequeno" :disabled="gravando" @click="emit('alternar-item', i)">
            {{ i.ativo ? 'Desligar' : 'Religar' }}
          </button>
        </li>
      </ul>
    </div>

    <h3 class="ec-grupo-titulo">Acrescentar item</h3>
    <div class="ec-novo">
      <input v-model="novo.item" type="text" placeholder="Ex.: Filtro de ar">
      <select v-model="novo.cadencia">
        <option v-for="c in CADENCIAS" :key="c" :value="c">{{ ROTULO[c] }}</option>
      </select>
      <button class="ec-btn" :disabled="gravando" @click="adicionar">Acrescentar</button>
    </div>
    <ul class="ec-erros" v-if="erros.length"><li v-for="e in erros" :key="e">{{ e }}</li></ul>
    <p class="ec-erro" v-if="erroItem">{{ erroItem }}</p>
  </section>
</template>

<style scoped>
/* Tudo em cima das variaveis do app (--surface, --border, --red...), nunca cor
   chumbada nem `--borda`, que NAO EXISTE aqui — a certa e `--border`. Era por
   isso que este editor e o painel do motorista ignoravam o tema e caiam num
   cinza de emergencia, feio no claro e pior no escuro. */
.ec-titulo {
  margin: var(--sp-5) 0 var(--sp-1); font-size: 10px; font-weight: 700;
  letter-spacing: 1.6px; text-transform: uppercase; color: var(--muted);
}
.ec-nota { font-size: 13px; color: var(--muted); margin: 0 0 var(--sp-3); line-height: 1.45; }
.ec-dias { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.ec-campo { display: block; }
.ec-lab {
  display: block; font-size: 10px; font-weight: 700; letter-spacing: 1.2px;
  text-transform: uppercase; color: var(--muted); margin-bottom: var(--sp-1);
}
.ec-campo select, .ec-novo input, .ec-novo select {
  padding: 9px var(--sp-3); border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--bg); color: var(--text);
  font-family: var(--fonte-principal); font-size: 14px;
}
.ec-campo select:focus, .ec-novo input:focus, .ec-novo select:focus {
  outline: none; border-color: var(--accent-forte); box-shadow: 0 0 0 3px var(--accent-light);
}
.ec-grupo-titulo { font-size: 13px; font-weight: 600; color: var(--text); margin: var(--sp-4) 0 var(--sp-2); }
.ec-conta { color: var(--muted); font-weight: 400; font-family: var(--fonte-dados); font-size: 11px; }
.ec-lista { list-style: none; padding: 0; margin: 0; }
.ec-item {
  display: flex; align-items: center; justify-content: space-between; gap: var(--sp-3);
  padding: var(--sp-3); margin-bottom: 6px;
  border: 1px solid var(--border); border-radius: var(--radius-md);
  background: var(--bg); font-size: 14px; color: var(--text);
}
.ec-item.desligado { opacity: .55; }
.ec-item.desligado span { text-decoration: line-through; }
.ec-novo { display: flex; flex-wrap: wrap; gap: var(--sp-2); }
.ec-novo input { flex: 1 1 200px; }
.ec-btn {
  padding: 9px var(--sp-4); border-radius: var(--radius-md);
  border: 1px solid var(--border); background: var(--surface); color: var(--text);
  font-family: var(--fonte-principal); font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background .15s, border-color .15s;
}
.ec-btn:hover:not(:disabled) { background: var(--surface2); border-color: var(--accent-mid); }
.ec-btn.pequeno { padding: 5px var(--sp-3); font-size: 12px; }
.ec-btn:disabled { opacity: .6; cursor: default; }
.ec-erros { color: var(--red); font-size: 13px; padding-left: 18px; line-height: 1.5; }
.ec-erro { color: var(--red); font-size: 13px; margin: var(--sp-2) 0 0; line-height: 1.45; }
/* Mesmo ponto de quebra do irmao painel-de-checklist.vue. So .ec-item precisa
 * disso: sem quebrar em coluna, um nome de item comprido (o gestor digita
 * livre) fica espremido ao lado do botao. As outras areas (.ec-dias, .ec-novo)
 * ja tem flex-wrap e se acomodam sozinhas. */
@media (max-width: 560px) {
  .ec-item { flex-direction: column; align-items: stretch; gap: var(--sp-2); }
  .ec-item .ec-btn { width: 100%; }
}
.ec-item-nome{flex:1 1 auto;min-width:0;overflow-wrap:anywhere;}
/* Alvo de 40px: o padrão manda, e esta caixinha decide se um carro sai ou não. */
.ec-impede{display:inline-flex;align-items:center;gap:6px;min-height:40px;padding:0 6px;cursor:pointer;
  font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);white-space:nowrap;touch-action:manipulation;}
.ec-impede input{width:18px;height:18px;accent-color:var(--red);}
</style>
