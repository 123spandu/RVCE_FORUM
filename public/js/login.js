// login.js — role-aware JWT login + create-account for all portals
(function () {
  const expectedRole = document.body.dataset.expectedRole || document.getElementById('expectedRole')?.value;
  const roleLabels = { admin: 'Admin', publisher: 'Publisher', viewer: 'Viewer' };

  // If already logged in with the matching role, go to the app.
  // If logged in as a different role, clear session so they can use this portal.
  if (API.getToken()) {
    const user = API.getUser();
    if (user && (!expectedRole || user.role === expectedRole)) {
      location.replace('/app.html');
      return;
    }
    API.clearToken();
  }

  // --- LOGIN ---
  const loginForm = document.getElementById('loginForm');
  const loginErr = document.getElementById('loginError');
  const loginBtn = document.getElementById('loginBtn');
  const loginBtnTxt = document.getElementById('loginBtnText');
  const loginSpinner = document.getElementById('loginBtnSpinner');
  const defaultBtnLabel = loginBtnTxt ? loginBtnTxt.textContent : 'Sign in';

  function setLoginBusy(b) {
    if (!loginBtn) return;
    loginBtn.disabled = b;
    if (loginBtnTxt) loginBtnTxt.textContent = b ? 'Signing in…' : defaultBtnLabel;
    if (loginSpinner) loginSpinner.classList.toggle('d-none', !b);
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      loginErr.classList.add('d-none');
      setLoginBusy(true);
      try {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const role = expectedRole || document.getElementById('expectedRole')?.value;
        const data = await API.post('/api/auth/login', { username, password, role });
        API.setToken(data.token);
        API.setUser(data.user);
        location.replace('/app.html');
      } catch (err) {
        let msg = err.message || 'Login failed';
        if (err.network) {
          msg = navigator.onLine
            ? 'Cannot reach the RVCE Connect server. Start the app with npm start (or check the demo URL), then try again.'
            : 'You appear to be offline. Check your internet connection and try again.';
        }
        if (err.status === 401) {
          msg = 'No matching account or wrong password. Don\'t have an account? Create one.';
        }
        loginErr.textContent = msg;
        loginErr.classList.remove('d-none');
        setLoginBusy(false);
      }
    });
  }

  // --- PASSWORD TOGGLES ---
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const input = e.currentTarget.previousElementSibling;
      const type = input.type === 'password' ? 'text' : 'password';
      input.type = type;
      e.currentTarget.querySelector('i').className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
    });
  });

  // --- REGISTRATION (all role portals) ---
  const regForm = document.getElementById('registerForm');
  if (!regForm) return;

  const regErr = document.getElementById('regError');
  const regSucc = document.getElementById('regSuccess');
  const regBtn = document.getElementById('regBtn');
  const regBtnTxt = document.getElementById('regBtnText');
  const regSpinner = document.getElementById('regBtnSpinner');
  const deptSelect = document.getElementById('reg_department');
  const regRole = document.getElementById('reg_role')?.value || expectedRole || 'viewer';
  const defaultRegLabel = regBtnTxt
    ? regBtnTxt.textContent
    : ('Create ' + (roleLabels[regRole] || 'User') + ' Account');

  function setRegBusy(b) {
    regBtn.disabled = b;
    regBtnTxt.textContent = b ? 'Creating...' : defaultRegLabel;
    regSpinner.classList.toggle('d-none', !b);
  }

  async function loadDepts() {
    if (!deptSelect) return;
    try {
      const data = await API.get('/api/departments');
      const optional = !deptSelect.required;
      deptSelect.innerHTML = (optional
        ? '<option value="">No department</option>'
        : '<option value="">Select a department</option>') +
        data.departments.map(d => `<option value="${d.id}">${d.name} (${d.code})</option>`).join('');
    } catch {
      deptSelect.innerHTML = '<option value="">Failed to load departments</option>';
    }
  }
  loadDepts();

  regForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    regErr.classList.add('d-none');
    regSucc.classList.add('d-none');
    setRegBusy(true);

    try {
      const payload = {
        full_name: document.getElementById('reg_full_name').value.trim(),
        username: document.getElementById('reg_username').value.trim(),
        email: document.getElementById('reg_email').value.trim(),
        department_id: deptSelect && deptSelect.value ? deptSelect.value : null,
        password: document.getElementById('reg_password').value,
        role: regRole
      };

      const data = await API.post('/api/auth/register', payload);

      if (data.pending) {
        regSucc.textContent = data.message;
        regSucc.classList.remove('d-none');
        regForm.reset();
      } else {
        // Auto-login with JWT; role portal must match created role
        if (expectedRole && data.user.role !== expectedRole) {
          API.clearToken();
          regSucc.textContent = 'Account created. Please sign in on the correct role page.';
          regSucc.classList.remove('d-none');
          document.getElementById('tab-login')?.click();
        } else {
          API.setToken(data.token);
          API.setUser(data.user);
          location.replace('/app.html');
        }
      }
    } catch (err) {
      if (err.network) {
        regErr.textContent = navigator.onLine
          ? 'Cannot reach the RVCE Connect server. Make sure it is running, then try again.'
          : 'You appear to be offline. Check your internet connection and try again.';
      } else {
        regErr.textContent = err.message || 'Registration failed';
      }
      regErr.classList.remove('d-none');
    }
    setRegBusy(false);
  });
})();
