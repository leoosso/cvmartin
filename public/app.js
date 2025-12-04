const apiBase = '';
let token = null;
let currentUser = null;

const setVisible = (id, show) => {
  document.getElementById(id).classList.toggle('hidden', !show);
};

const authHeaders = () => ({ Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

const login = async () => {
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';
  try {
    const res = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error('Credenciales inválidas');
    const data = await res.json();
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(currentUser));
    document.getElementById('user-info').textContent = `${currentUser.nombre} ${currentUser.apellido} (${currentUser.rol})`;
    setVisible('login-section', false);
    renderPanels();
  } catch (err) {
    errorEl.textContent = err.message;
  }
};

document.getElementById('login-btn').addEventListener('click', login);

token = localStorage.getItem('token');
currentUser = localStorage.getItem('user') ? JSON.parse(localStorage.getItem('user')) : null;
if (token && currentUser) {
  document.getElementById('user-info').textContent = `${currentUser.nombre} ${currentUser.apellido} (${currentUser.rol})`;
  setVisible('login-section', false);
  renderPanels();
}

function renderPanels() {
  setVisible('programmer-panel', currentUser?.rol === 'PROGRAMADOR');
  setVisible('admin-panel', currentUser?.rol === 'ADMIN');
  setVisible('client-panel', currentUser?.rol === 'CLIENTE');
  if (currentUser?.rol === 'PROGRAMADOR') loadProgrammerEntries();
  if (currentUser?.rol === 'ADMIN') loadSummary();
  if (currentUser?.rol === 'CLIENTE') loadClientEntries();
}

async function loadProgrammerEntries() {
  const res = await fetch(`${apiBase}/time-entries`, { headers: authHeaders() });
  const data = await res.json();
  const tbody = document.getElementById('programmer-rows');
  tbody.innerHTML = '';
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="border p-2">${row.fecha}</td><td class="border p-2">${row.cliente}</td><td class="border p-2">${row.departamento}</td><td class="border p-2">${row.horas_trabajadas}</td><td class="border p-2">${row.descripcion_detallada || ''}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('refresh-programmer').addEventListener('click', loadProgrammerEntries);

async function saveTimeEntry() {
  const payload = {
    collaborator_id: Number(document.getElementById('collaborator-id').value),
    client_id: Number(document.getElementById('client-id').value),
    department_id: Number(document.getElementById('department-id').value),
    task_id: document.getElementById('task-id').value ? Number(document.getElementById('task-id').value) : null,
    fecha: document.getElementById('fecha').value,
    hora_inicio: document.getElementById('hora-inicio').value,
    hora_fin: document.getElementById('hora-fin').value,
    descripcion_detallada: document.getElementById('descripcion').value,
  };
  const msg = document.getElementById('programmer-message');
  msg.textContent = '';
  try {
    const res = await fetch(`${apiBase}/time-entries`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Error guardando entrada');
    }
    msg.textContent = 'Entrada guardada correctamente';
    loadProgrammerEntries();
  } catch (err) {
    msg.textContent = err.message;
  }
}

document.getElementById('save-time-entry').addEventListener('click', saveTimeEntry);

async function createClient() {
  const nombre = document.getElementById('admin-client-name').value;
  const email_contacto = document.getElementById('admin-client-email').value;
  if (!nombre) return;
  await fetch(`${apiBase}/clients`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ nombre, email_contacto, activo: 1 }),
  });
}

async function createDept() {
  const nombre = document.getElementById('admin-dept-name').value;
  if (!nombre) return;
  await fetch(`${apiBase}/departments`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ nombre, activo: 1 }),
  });
}

document.getElementById('create-client').addEventListener('click', createClient);
document.getElementById('create-dept').addEventListener('click', createDept);

document.getElementById('refresh-admin').addEventListener('click', loadSummary);

document.getElementById('load-summary').addEventListener('click', loadSummary);

async function loadSummary() {
  if (currentUser?.rol !== 'ADMIN') return;
  const clientId = document.getElementById('report-client-id').value;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const params = new URLSearchParams({ clientId, from, to });
  const res = await fetch(`${apiBase}/reports/summary?${params.toString()}`, { headers: authHeaders() });
  const data = await res.json();
  const container = document.getElementById('summary-table');
  container.innerHTML = '';
  if (!data.length) {
    container.textContent = 'Sin datos';
    return;
  }
  const table = document.createElement('table');
  table.className = 'min-w-full text-sm border';
  table.innerHTML = `<thead class="bg-slate-100"><tr><th class="p-2 border">Colaborador</th><th class="p-2 border">Departamento</th><th class="p-2 border">Horas</th></tr></thead>`;
  const tbody = document.createElement('tbody');
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="border p-2">${row.colaborador}</td><td class="border p-2">${row.departamento}</td><td class="border p-2">${row.total_horas}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  container.appendChild(table);
}

document.getElementById('download-excel').addEventListener('click', () => {
  const clientId = document.getElementById('report-client-id').value;
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  const params = new URLSearchParams({ clientId, from, to, token });
  window.open(`${apiBase}/reports/excel?${params.toString()}`, '_blank');
});

document.getElementById('send-mail').addEventListener('click', async () => {
  const clientId = Number(document.getElementById('report-client-id').value);
  const from = document.getElementById('report-from').value;
  const to = document.getElementById('report-to').value;
  await fetch(`${apiBase}/reports/send-weekly`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ clientId, from, to }),
  });
});

async function loadClientEntries() {
  const from = document.getElementById('client-from').value;
  const to = document.getElementById('client-to').value;
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`${apiBase}/time-entries?${params.toString()}`, { headers: authHeaders() });
  const data = await res.json();
  const tbody = document.getElementById('client-rows');
  tbody.innerHTML = '';
  data.forEach((row) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="border p-2">${row.colaborador}</td><td class="border p-2">${row.departamento}</td><td class="border p-2">${row.fecha}</td><td class="border p-2">${row.horas_trabajadas}</td><td class="border p-2">${row.descripcion_detallada || ''}</td>`;
    tbody.appendChild(tr);
  });
}

document.getElementById('refresh-client').addEventListener('click', loadClientEntries);

document.getElementById('client-download').addEventListener('click', () => {
  const from = document.getElementById('client-from').value;
  const to = document.getElementById('client-to').value;
  const params = new URLSearchParams({ from, to });
  window.open(`${apiBase}/reports/excel?${params.toString()}`, '_blank');
});
