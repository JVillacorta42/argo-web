(function () {
  var VALID_TOKENS = [
    '53287951-0b18-42d8-acfd-61d36d056945', // Javier_Bris
    '1825a09a-e5ca-4d76-8932-745b54127fc6',  // Admin
    '5e8f2eec-2b0b-4c9f-bfed-b94c231a938e',  // Admin2
    '0dfc5a42-7252-48e3-8967-887b52083c84'  // Javi_bris2
  ];
  var STORAGE_KEY = 'argo_access';

  // Check URL for token
  var params = new URLSearchParams(window.location.search);
  var urlToken = params.get('token');

  if (urlToken && VALID_TOKENS.indexOf(urlToken) !== -1) {
    localStorage.setItem(STORAGE_KEY, urlToken);
    params.delete('token');
    var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
    window.history.replaceState({}, '', clean);
    return; // autorizado
  }

  var stored = localStorage.getItem(STORAGE_KEY);
  if (stored && VALID_TOKENS.indexOf(stored) !== -1) {
    return; // autorizado
  }

  // No autorizado — bloquear página
  document.documentElement.style.display = 'none';
  document.addEventListener('DOMContentLoaded', function () {
    document.documentElement.style.display = '';
    document.body.innerHTML = [
      '<style>',
      '* { box-sizing: border-box; margin: 0; padding: 0; }',
      'body { background: #06080f; color: #e0e8f0; font-family: Segoe UI, Georgia, serif;',
      '  display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }',
      '.box { max-width: 420px; text-align: center; }',
      '.box h1 { font-size: 1rem; letter-spacing: 0.25em; text-transform: uppercase; margin-bottom: 16px; color: #fff; }',
      '.box p { font-size: 0.82rem; color: #9aaabb; line-height: 1.6; margin-bottom: 24px; }',
      '.box a { font-size: 0.78rem; color: #4a6080; letter-spacing: 0.1em; }',
      '</style>',
      '<div class="box">',
      '<h1>Acceso restringido</h1>',
      '<p>Esta aplicación es de uso privado.<br>Necesitas un enlace de invitación válido para acceder.</p>',
      '</div>'
    ].join('');
  });
})();
