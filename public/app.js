// Shared helpers for the three pages. All data comes from the API, which comes from agents.json.
(function () {
  const KEY = 'eminent_admin_token';

  window.esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  window.token = function () {
    let t = sessionStorage.getItem(KEY);
    if (!t) {
      t = window.prompt('Admin token (Aalia only)') || '';
      if (t) sessionStorage.setItem(KEY, t);
    }
    return t;
  };

  window.api = async function (path, opts) {
    const o = opts || {};
    const res = await fetch(path, {
      method: o.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'x-admin-token': window.token() },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) sessionStorage.removeItem(KEY);
    return { status: res.status, ok: res.ok, data };
  };

  window.nav = function (active) {
    const links = [['roster.html', 'Roster'], ['command-center.html', 'Command Center'], ['command-router.html', 'Command Router']];
    document.getElementById('nav').innerHTML = links
      .map(([h, t]) => `<a href="${h}" class="${h === active ? 'on' : ''}">${t}</a>`).join('');
  };

  window.avatar = function (item) {
    const initials = esc(item.name.split(' ').map((w) => w[0]).slice(0, 2).join(''));
    return `<div class="avatar">${item.photoFound ? `<img src="${esc(item.photo)}" alt="${esc(item.name)}">` : initials}</div>`;
  };
})();
