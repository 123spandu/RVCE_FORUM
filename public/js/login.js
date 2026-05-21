// login.js
(function () {
  if (API.getToken()) {
    location.replace('/app.html');
    return;
  }

  // --- LOGIN LOGIC ---
  const loginForm = document.getElementById('loginForm');
  const loginErr  = document.getElementById('loginError');
  const loginBtn  = document.getElementById('loginBtn');
  const loginBtnTxt = document.getElementById('loginBtnText');
  const loginSpinner = document.getElementById('loginBtnSpinner');
  
  function setLoginBusy(b) {
    loginBtn.disabled = b;
    loginBtnTxt.textContent = b ? 'Signing in…' : 'Sign in';
    loginSpinner.classList.toggle('d-none', !b);
  }

  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginErr.classList.add('d-none');
    setLoginBusy(true);
    try {
      const username = document.getElementById('username').value.trim();
      const password = document.getElementById('password').value;
      const data = await API.post('/api/auth/login', { username, password });
      API.setToken(data.token);
      API.setUser(data.user);
      location.replace('/app.html');
    } catch (err) {
      loginErr.textContent = err.network ? 'Network error — you appear to be offline.' : (err.message || 'Login failed');
      loginErr.classList.remove('d-none');
      setLoginBusy(false);
    }
  });

  // --- PASSWORD TOGGLES ---
  document.querySelectorAll('.toggle-pw').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const input = e.currentTarget.previousElementSibling;
      const type = input.type === 'password' ? 'text' : 'password';
      input.type = type;
      e.currentTarget.querySelector('i').className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
    });
  });

  // --- REGISTRATION LOGIC ---
  const regForm = document.getElementById('registerForm');
  const regErr = document.getElementById('regError');
  const regSucc = document.getElementById('regSuccess');
  const regBtn = document.getElementById('regBtn');
  const regBtnTxt = document.getElementById('regBtnText');
  const regSpinner = document.getElementById('regBtnSpinner');
  const deptSelect = document.getElementById('reg_department');

  function setRegBusy(b) {
    regBtn.disabled = b;
    regBtnTxt.textContent = b ? 'Creating...' : 'Create Account';
    regSpinner.classList.toggle('d-none', !b);
  }

  // Load departments dynamically for the dropdown
  async function loadDepts() {
    try {
      const data = await API.get('/api/departments');
      deptSelect.innerHTML = '<option value="">Select a department</option>' + 
        data.departments.map(d => `<option value="${d.id}">${d.name} (${d.code})</option>`).join('');
    } catch (err) {
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
        phone_number: document.getElementById('reg_phone').value.trim(),
        role: document.getElementById('reg_role').value,
        department_id: deptSelect.value,
        password: document.getElementById('reg_password').value
      };

      const data = await API.post('/api/auth/register', payload);
      
      if (data.pending) {
        regSucc.textContent = data.message;
        regSucc.classList.remove('d-none');
        regForm.reset();
      } else {
        // Auto-login success
        API.setToken(data.token);
        API.setUser(data.user);
        location.replace('/app.html');
      }
    } catch (err) {
      regErr.textContent = err.network ? 'Network error — you appear to be offline.' : (err.message || 'Registration failed');
      regErr.classList.remove('d-none');
    }
    setRegBusy(false);
  });
})();
