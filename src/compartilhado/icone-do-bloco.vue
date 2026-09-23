<template>
  <!-- ⚠️ ÍCONE É SVG, NUNCA EMOJI. A cor vem de `currentColor`: quem manda é o
       título onde ele mora (a cor da ferramenta, ou a do grupo do placar). -->
  <svg class="id-icone" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <template v-if="nome === 'porta'">
      <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
      <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
    </template>
    <template v-else-if="nome === 'placar'">
      <path d="M3 21h18" /><path d="M6 17v-6" /><path d="M11 17V6" /><path d="M16 17v-9" />
    </template>
    <template v-else-if="nome === 'novo'">
      <circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" />
    </template>
    <template v-else-if="nome === 'funil'">
      <rect x="3" y="4" width="5" height="15" rx="1" /><rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="6" rx="1" />
    </template>
    <template v-else-if="nome === 'leitura'">
      <circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" />
    </template>
    <template v-else-if="nome === 'conjunto'">
      <path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" />
    </template>
    <template v-else-if="nome === 'parceiras'">
      <circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14.5c2 .8 3 2.8 3 5.5" />
    </template>
    <template v-else-if="nome === 'encontros'">
      <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" />
    </template>
    <template v-else-if="nome === 'venda'">
      <path d="M5 8h14l-1 13H6L5 8z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </template>
    <template v-else-if="nome === 'contato'">
      <path d="M4 5h16v11H9l-5 4V5z" />
    </template>
    <template v-else-if="nome === 'editar'">
      <path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </template>
  </svg>
</template>

<script setup>
/* O ÍCONE PEQUENO QUE MARCA O TIPO DE BLOCO (pedido do dono, 23/09/2026).
 * Nasceu no Stylist Circle e no Private Edit e mudou-se para cá na Onda 0,
 * para qualquer ferramenta usar. O desenho e o tamanho vêm da classe
 * `.id-icone` (src/estilos/identidade-da-ferramenta.css), que chega aqui pela
 * raiz do componente — por isso a tela que usa o ícone importa aquela folha. */
defineProps({ nome: { type: String, required: true } })
</script>
