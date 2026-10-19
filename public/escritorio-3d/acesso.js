// Decisão de acesso ao Escritório 3D, separada do porteiro para ter teste (acesso.test.mjs).
// Script clássico (a página é estática): expõe `acessoDo3d` em globalThis.
// Os dois chamadores normalizam para { superadmin, permissoes, modulos }:
//   API:      superadmin, permissoes, modulos (GET /api/auth/eu)
//   Supabase: is_superadmin, permissions, features (profiles)
// SEM atalho para papel admin, de propósito: o cartão da home usa hasPermission, que não tem esse
// atalho; com ele aqui, um admin comum entraria pelo endereço sem ver o cartão (04/08/2026).
globalThis.acessoDo3d = {
  pode: function (p) {
    if (!p) return false;
    var perms = p.permissoes || {};
    var ver = perms.escritorio3d;
    return p.superadmin === true
      || (Array.isArray(p.modulos) && p.modulos.indexOf('escritorio3d') >= 0)
      || (Array.isArray(ver) && ver.indexOf('ver') >= 0);
  }
};
