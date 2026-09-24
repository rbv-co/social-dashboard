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
    <template v-else-if="nome === 'filtro'">
      <path d="M4 6h16M7 12h10M10 18h4" />
    </template>
    <template v-else-if="nome === 'carrinho-mais'">
      <circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M2 3h3l2.6 12h11l2-8H6" /><path d="M13 7v5M10.5 9.5h5" />
    </template>
    <template v-else-if="nome === 'carrinho-menos'">
      <circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /><path d="M2 3h3l2.6 12h11l2-8H6" /><path d="M10.5 9.5h5" />
    </template>
    <template v-else-if="nome === 'relogio'">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </template>
    <template v-else-if="nome === 'etiqueta'">
      <path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><path d="M7.5 7.5h.01" />
    </template>
    <template v-else-if="nome === 'veiculo'">
      <path d="M5 17h14M3 17V9l3-4h9l4 5v7" /><circle cx="7" cy="17" r="2" /><circle cx="17" cy="17" r="2" />
    </template>
    <template v-else-if="nome === 'pessoa'">
      <circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </template>
    <template v-else-if="nome === 'documento'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
    </template>
    <template v-else-if="nome === 'lista'">
      <path d="M9 6h11M9 12h11M9 18h11" /><path d="M4 6h.01M4 12h.01M4 18h.01" />
    </template>
    <!-- Beauty Sessions (24/09/2026): os botões do cartão da sessão, cada um
         com o desenho do que faz. -->
    <template v-else-if="nome === 'lead-mais'">
      <circle cx="10" cy="8" r="4" /><path d="M3 21c0-3.9 3.1-7 7-7 1.5 0 2.9.5 4 1.3" /><path d="M18 14v6M15 17h6" />
    </template>
    <template v-else-if="nome === 'parar'">
      <circle cx="12" cy="12" r="9" /><rect x="9" y="9" width="6" height="6" rx="1" />
    </template>
    <template v-else-if="nome === 'reabrir'">
      <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
    </template>
    <template v-else-if="nome === 'arquivar'">
      <rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" />
    </template>
    <template v-else-if="nome === 'lixeira'">
      <path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5M14 11v5" />
    </template>
    <template v-else-if="nome === 'baixar'">
      <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
    </template>
    <template v-else-if="nome === 'copiar'">
      <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h10" />
    </template>
    <!-- Frota (Onda 2b): o aviso de problema e a chave da oficina. -->
    <template v-else-if="nome === 'alerta'">
      <path d="M12 3.5l9 16H3l9-16z" /><path d="M12 10v4" /><path d="M12 17h.01" />
    </template>
    <template v-else-if="nome === 'ferramenta'">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </template>
    <!-- Administração (Onda 3): o banco de dados, o mesmo desenho do item
         "Dados" da barra lateral dela. -->
    <template v-else-if="nome === 'banco'">
      <ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </template>
    <!-- Stylist Circle (24/09/2026): a nota de qualificação — a estrela de
         avaliar, a medalha do bloco, o "aplicar" da sugestão e o "salvar". -->
    <template v-else-if="nome === 'avaliar'">
      <path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9L12 3z" />
    </template>
    <template v-else-if="nome === 'medalha'">
      <circle cx="12" cy="14" r="6" /><path d="M8.5 9.2L6 3h4l2 4 2-4h4l-2.5 6.2" /><path d="M12 12v4" />
    </template>
    <template v-else-if="nome === 'aplicar'">
      <path d="M4 12.5l5 5L20 6.5" />
    </template>
    <template v-else-if="nome === 'salvar'">
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" />
    </template>
    <!-- Stylist Circle (24/09/2026): o funil configurável — a engrenagem que
         abre "Etapas do funil", subir/descer uma etapa e avançar a parceira. -->
    <template v-else-if="nome === 'engrenagem'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </template>
    <template v-else-if="nome === 'subir'">
      <path d="M12 19V5" /><path d="M6 11l6-6 6 6" />
    </template>
    <template v-else-if="nome === 'descer'">
      <path d="M12 5v14" /><path d="M6 13l6 6 6-6" />
    </template>
    <template v-else-if="nome === 'avancar'">
      <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
    </template>
    <!-- O contato fácil (24/09/2026): o balão do WhatsApp e a câmera do
         Instagram, no traço da casa (contorno, `currentColor`). -->
    <template v-else-if="nome === 'whatsapp'">
      <path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4l-4.5 1.1z" />
      <path d="M9 8.6c.2-.5.5-.6.8-.6h.6c.2 0 .4.1.5.4l.7 1.6c.1.3 0 .5-.1.7l-.5.6c.6 1.1 1.5 2 2.6 2.6l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.5v.6c0 .3-.1.6-.6.8-.6.3-1.6.4-3-.3a8.6 8.6 0 0 1-3.8-3.8c-.7-1.4-.6-2.4-.3-3z" />
    </template>
    <template v-else-if="nome === 'instagram'">
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" /><circle cx="12" cy="12" r="4" /><path d="M17.2 6.8h.01" />
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
