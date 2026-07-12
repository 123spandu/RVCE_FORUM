// api.js — tiny fetch wrapper that attaches the JWT and handles errors
const API = (() => {
  const TOKEN_KEY = 'cc_token';
  const USER_KEY  = 'cc_user';

  function getToken() { return localStorage.getItem(TOKEN_KEY); }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }

  function getUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }
  function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }

  async function request(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;

    let res;
    try {
      res = await fetch(path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      // Network failure
      const e = new Error('Network unreachable');
      e.network = true;
      throw e;
    }

    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }

    if (res.status === 401) {
      clearToken();
      const path = location.pathname;
      const onAuthPage = path === '/' || path === '/index.html'
        || path.startsWith('/login-');
      if (!onAuthPage) {
        location.href = '/';
      }
    }
    if (!res.ok) {
      const e = new Error(data.error || ('HTTP ' + res.status));
      e.status = res.status;
      throw e;
    }
    return data;
  }

  return {
    getToken, setToken, clearToken, getUser, setUser,
    get:   (p)    => request('GET', p),
    post:  (p, b) => request('POST', p, b),
    del:   (p)    => request('DELETE', p),
    put:   (p, b) => request('PUT', p, b),
    patch: (p, b) => request('PATCH', p, b),
  };
})();
