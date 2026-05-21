// login.js
(function () {
  // If already logged in, jump straight to the app
  if (API.getToken()) {
    location.replace('/app.html');
    return;
  }

  const form    = document.getElementById('loginForm');
  const errBox  = document.getElementById('loginError');
  const btn     = document.getElementById('loginBtn');
  const btnTxt  = document.getElementById('loginBtnText');
  const spinner = document.getElementById('loginBtnSpinner');
  const togglePw = document.getElementById('togglePw');
  const pwInput  = document.getElementById('password');

  togglePw.addEventListener('click', () => {
    const t = pwInput.type === 'password' ? 'text' : 'password';
    pwInput.type = t;
    togglePw.querySelector('i').className = t === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
  });

  function setBusy(b) {
    btn.disabled = b;
    btnTxt.textContent = b ? 'Signing in…' : 'Sign in';
    spinner.classList.toggle('d-none', !b);
  }

  function showErr(msg) {
    errBox.textContent = msg;
    errBox.classList.remove('d-none');
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('d-none');
    setBusy(true);
    try {
      const username = document.getElementById('username').value.trim();
      const password = pwInput.value;
      const data = await API.post('/api/auth/login', { username, password });
      API.setToken(data.token);
      API.setUser(data.user);
      location.replace('/app.html');
    } catch (err) {
      showErr(err.network ? 'Network error — you appear to be offline.' : (err.message || 'Login failed'));
      setBusy(false);
    }
  });
})();
