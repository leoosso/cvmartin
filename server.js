require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const ExcelJS = require('exceljs');
const nodemailer = require('nodemailer');
const path = require('path');
const { db, initDb } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const EDIT_WINDOW_DAYS = parseInt(process.env.EDIT_WINDOW_DAYS || '7', 10);

initDb();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const asyncRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const asyncGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

const asyncAll = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });

const authMiddleware = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await asyncGet('SELECT * FROM users WHERE id = ? AND activo = 1', [decoded.id]);
    if (!user) return res.status(401).json({ error: 'Usuario no válido' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido' });
  }
};

const authorize = (roles = []) => (req, res, next) => {
  if (roles.length && !roles.includes(req.user.rol)) {
    return res.status(403).json({ error: 'Sin permisos' });
  }
  return next();
};

const calculateHours = (start, end) => {
  const startDate = new Date(`1970-01-01T${start}:00Z`);
  const endDate = new Date(`1970-01-01T${end}:00Z`);
  const diffMs = endDate - startDate;
  const hours = diffMs / (1000 * 60 * 60);
  return { hours, valid: diffMs > 0 };
};

const withinEditWindow = (fecha) => {
  const entryDate = new Date(fecha);
  const now = new Date();
  const diffDays = (now - entryDate) / (1000 * 60 * 60 * 24);
  return diffDays <= EDIT_WINDOW_DAYS;
};

const seedAdmin = async () => {
  const existing = await asyncGet('SELECT * FROM users WHERE email = ?', ['admin@example.com']);
  if (!existing) {
    const hash = await bcrypt.hash('admin123', 10);
    await asyncRun(
      'INSERT INTO users (nombre, apellido, email, password_hash, rol, activo) VALUES (?, ?, ?, ?, ?, 1)',
      ['Admin', 'Principal', 'admin@example.com', hash, 'ADMIN']
    );
  }
};
seedAdmin();

app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });
  const user = await asyncGet('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !user.activo) return res.status(401).json({ error: 'Credenciales inválidas' });
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return res.status(401).json({ error: 'Credenciales inválidas' });
  const token = jwt.sign({ id: user.id, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, nombre: user.nombre, apellido: user.apellido, rol: user.rol } });
});

app.get('/me', authMiddleware, (req, res) => {
  const { password_hash, ...rest } = req.user;
  res.json(rest);
});

app.get('/users', authMiddleware, authorize(['ADMIN']), async (req, res) => {
  const rows = await asyncAll('SELECT id, nombre, apellido, email, rol, activo FROM users');
  res.json(rows);
});

app.post('/users', authMiddleware, authorize(['ADMIN']), async (req, res) => {
  const { nombre, apellido, email, password, rol, client_id = null, activo = 1 } = req.body;
  if (!nombre || !apellido || !email || !password || !rol) return res.status(400).json({ error: 'Datos incompletos' });
  const hash = await bcrypt.hash(password, 10);
  try {
    const result = await asyncRun(
      'INSERT INTO users (nombre, apellido, email, password_hash, rol, client_id, activo) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [nombre, apellido, email, hash, rol, client_id, activo]
    );
    res.status(201).json({ id: result.lastID });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo crear el usuario', detail: err.message });
  }
});

app.put('/users/:id', authMiddleware, authorize(['ADMIN']), async (req, res) => {
  const { nombre, apellido, email, password, rol, client_id, activo } = req.body;
  const existing = await asyncGet('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' });
  const hash = password ? await bcrypt.hash(password, 10) : existing.password_hash;
  await asyncRun(
    'UPDATE users SET nombre=?, apellido=?, email=?, password_hash=?, rol=?, client_id=?, activo=? WHERE id=?',
    [
      nombre || existing.nombre,
      apellido || existing.apellido,
      email || existing.email,
      hash,
      rol || existing.rol,
      client_id ?? existing.client_id,
      activo ?? existing.activo,
      req.params.id,
    ]
  );
  res.json({ ok: true });
});

app.delete('/users/:id', authMiddleware, authorize(['ADMIN']), async (req, res) => {
  await asyncRun('UPDATE users SET activo = 0 WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

const simpleCrud = (table) => {
  app.get(`/${table}`, authMiddleware, authorize(['ADMIN']), async (req, res) => {
    const rows = await asyncAll(`SELECT * FROM ${table}`);
    res.json(rows);
  });

  app.post(`/${table}`, authMiddleware, authorize(['ADMIN']), async (req, res) => {
    const keys = Object.keys(req.body);
    const values = Object.values(req.body);
    const placeholders = keys.map(() => '?').join(',');
    try {
      const result = await asyncRun(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders})`, values);
      res.status(201).json({ id: result.lastID });
    } catch (err) {
      res.status(400).json({ error: 'No se pudo crear', detail: err.message });
    }
  });

  app.put(`/${table}/:id`, authMiddleware, authorize(['ADMIN']), async (req, res) => {
    const keys = Object.keys(req.body);
    const values = Object.values(req.body);
    const assignments = keys.map((k) => `${k}=?`).join(',');
    try {
      await asyncRun(`UPDATE ${table} SET ${assignments} WHERE id=?`, [...values, req.params.id]);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: 'No se pudo actualizar', detail: err.message });
    }
  });
};

['clients', 'departments', 'collaborators', 'projects', 'tasks'].forEach(simpleCrud);

app.get('/time-entries', authMiddleware, async (req, res) => {
  const { from, to, clientId, departmentId, collaboratorId } = req.query;
  let baseQuery = `SELECT te.*, u.nombre || ' ' || u.apellido AS colaborador, d.nombre AS departamento, c.nombre AS cliente
                   FROM time_entries te
                   JOIN collaborators co ON co.id = te.collaborator_id
                   JOIN users u ON u.id = co.user_id
                   JOIN departments d ON d.id = te.department_id
                   JOIN clients c ON c.id = te.client_id`;
  const conditions = [];
  const params = [];

  if (from) {
    conditions.push('fecha >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('fecha <= ?');
    params.push(to);
  }
  if (clientId) {
    conditions.push('te.client_id = ?');
    params.push(clientId);
  }
  if (departmentId) {
    conditions.push('te.department_id = ?');
    params.push(departmentId);
  }
  if (req.user.rol === 'PROGRAMADOR') {
    conditions.push('co.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.rol === 'CLIENTE') {
    conditions.push('te.client_id = ?');
    params.push(req.user.client_id);
  } else if (collaboratorId) {
    conditions.push('te.collaborator_id = ?');
    params.push(collaboratorId);
  }

  if (conditions.length) {
    baseQuery += ' WHERE ' + conditions.join(' AND ');
  }
  baseQuery += ' ORDER BY fecha DESC, hora_inicio DESC';

  const rows = await asyncAll(baseQuery, params);
  res.json(rows);
});

app.post('/time-entries', authMiddleware, async (req, res) => {
  const { collaborator_id, client_id, department_id, task_id, fecha, hora_inicio, hora_fin, descripcion_detallada } = req.body;
  const { hours, valid } = calculateHours(hora_inicio, hora_fin);
  if (!valid) return res.status(400).json({ error: 'Hora fin debe ser mayor a hora inicio' });
  if (hours <= 0 || hours > 24) return res.status(400).json({ error: 'Horas inválidas' });

  if (req.user.rol === 'PROGRAMADOR') {
    const collaborator = await asyncGet('SELECT * FROM collaborators WHERE user_id = ?', [req.user.id]);
    if (!collaborator || collaborator.id !== collaborator_id) {
      return res.status(403).json({ error: 'No puedes cargar horas para otro colaborador' });
    }
  }

  try {
    const result = await asyncRun(
      `INSERT INTO time_entries (collaborator_id, client_id, department_id, task_id, fecha, hora_inicio, hora_fin, horas_trabajadas, descripcion_detallada)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [collaborator_id, client_id, department_id, task_id || null, fecha, hora_inicio, hora_fin, hours, descripcion_detallada]
    );
    res.status(201).json({ id: result.lastID, horas_trabajadas: hours });
  } catch (err) {
    res.status(400).json({ error: 'No se pudo guardar', detail: err.message });
  }
});

app.put('/time-entries/:id', authMiddleware, async (req, res) => {
  const entry = await asyncGet('SELECT * FROM time_entries WHERE id = ?', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (req.user.rol === 'PROGRAMADOR' && entry.collaborator_id) {
    const collaborator = await asyncGet('SELECT * FROM collaborators WHERE user_id = ?', [req.user.id]);
    if (!collaborator || collaborator.id !== entry.collaborator_id || !withinEditWindow(entry.fecha)) {
      return res.status(403).json({ error: 'No puedes editar esta entrada' });
    }
  }

  const {
    client_id = entry.client_id,
    department_id = entry.department_id,
    task_id = entry.task_id,
    fecha = entry.fecha,
    hora_inicio = entry.hora_inicio,
    hora_fin = entry.hora_fin,
    descripcion_detallada = entry.descripcion_detallada,
  } = req.body;

  const { hours, valid } = calculateHours(hora_inicio, hora_fin);
  if (!valid) return res.status(400).json({ error: 'Hora fin debe ser mayor a hora inicio' });
  await asyncRun(
    `UPDATE time_entries SET client_id=?, department_id=?, task_id=?, fecha=?, hora_inicio=?, hora_fin=?, horas_trabajadas=?, descripcion_detallada=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [client_id, department_id, task_id, fecha, hora_inicio, hora_fin, hours, descripcion_detallada, req.params.id]
  );
  res.json({ ok: true, horas_trabajadas: hours });
});

app.delete('/time-entries/:id', authMiddleware, async (req, res) => {
  const entry = await asyncGet('SELECT * FROM time_entries WHERE id = ?', [req.params.id]);
  if (!entry) return res.status(404).json({ error: 'Entrada no encontrada' });
  if (req.user.rol === 'PROGRAMADOR') {
    const collaborator = await asyncGet('SELECT * FROM collaborators WHERE user_id = ?', [req.user.id]);
    if (!collaborator || collaborator.id !== entry.collaborator_id || !withinEditWindow(entry.fecha)) {
      return res.status(403).json({ error: 'No puedes borrar esta entrada' });
    }
  }
  await asyncRun('DELETE FROM time_entries WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

const buildSummary = async (clientId, from, to) => {
  let query = `SELECT te.client_id, c.nombre AS cliente, co.id AS collaborator_id, u.nombre || ' ' || u.apellido AS colaborador, d.nombre AS departamento,
                      SUM(te.horas_trabajadas) AS total_horas
               FROM time_entries te
               JOIN collaborators co ON co.id = te.collaborator_id
               JOIN users u ON u.id = co.user_id
               JOIN departments d ON d.id = te.department_id
               JOIN clients c ON c.id = te.client_id`;
  const conditions = [];
  const params = [];
  if (clientId) {
    conditions.push('te.client_id = ?');
    params.push(clientId);
  }
  if (from) {
    conditions.push('te.fecha >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('te.fecha <= ?');
    params.push(to);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' GROUP BY te.client_id, co.id, d.id';
  return asyncAll(query, params);
};

const buildDetail = async (clientId, from, to) => {
  let query = `SELECT te.*, u.nombre || ' ' || u.apellido AS colaborador, d.nombre AS departamento, c.nombre AS cliente
               FROM time_entries te
               JOIN collaborators co ON co.id = te.collaborator_id
               JOIN users u ON u.id = co.user_id
               JOIN departments d ON d.id = te.department_id
               JOIN clients c ON c.id = te.client_id`;
  const conditions = [];
  const params = [];
  if (clientId) {
    conditions.push('te.client_id = ?');
    params.push(clientId);
  }
  if (from) {
    conditions.push('te.fecha >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('te.fecha <= ?');
    params.push(to);
  }
  if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
  query += ' ORDER BY te.fecha ASC';
  return asyncAll(query, params);
};

const generateExcelBuffer = async (clientId, from, to) => {
  const workbook = new ExcelJS.Workbook();
  const detailSheet = workbook.addWorksheet('Detalle');
  detailSheet.columns = [
    { header: 'Cliente', key: 'cliente', width: 20 },
    { header: 'Colaborador', key: 'colaborador', width: 25 },
    { header: 'Departamento', key: 'departamento', width: 20 },
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Hora inicio', key: 'hora_inicio', width: 12 },
    { header: 'Hora fin', key: 'hora_fin', width: 12 },
    { header: 'Horas trabajadas', key: 'horas_trabajadas', width: 18 },
    { header: 'Descripción', key: 'descripcion_detallada', width: 40 },
  ];

  const details = await buildDetail(clientId, from, to);
  details.forEach((row) => detailSheet.addRow(row));

  const summarySheet = workbook.addWorksheet('Resumen');
  summarySheet.columns = [
    { header: 'Cliente', key: 'cliente', width: 20 },
    { header: 'Colaborador', key: 'colaborador', width: 25 },
    { header: 'Departamento', key: 'departamento', width: 20 },
    { header: 'Total horas', key: 'total_horas', width: 14 },
  ];
  const summary = await buildSummary(clientId, from, to);
  summary.forEach((row) => summarySheet.addRow(row));

  return workbook.xlsx.writeBuffer();
};

app.get('/reports/summary', authMiddleware, async (req, res) => {
  let { clientId, from, to } = req.query;
  if (req.user.rol === 'CLIENTE') {
    clientId = req.user.client_id;
  }
  const summary = await buildSummary(clientId, from, to);
  res.json(summary);
});

app.get('/reports/excel', authMiddleware, async (req, res) => {
  let { clientId, from, to } = req.query;
  if (req.user.rol === 'CLIENTE') {
    clientId = req.user.client_id;
  }
  const buffer = await generateExcelBuffer(clientId, from, to);
  res.setHeader('Content-Disposition', 'attachment; filename="horas.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

app.post('/reports/send-weekly', authMiddleware, authorize(['ADMIN']), async (req, res) => {
  const { clientId, from, to } = req.body;
  if (!clientId || !from || !to) return res.status(400).json({ error: 'Parámetros requeridos' });
  const client = await asyncGet('SELECT * FROM clients WHERE id = ?', [clientId]);
  if (!client) return res.status(404).json({ error: 'Cliente no encontrado' });

  const buffer = await generateExcelBuffer(clientId, from, to);
  const summary = await buildSummary(clientId, from, to);
  const summaryText = summary
    .map((row) => `${row.colaborador} - ${row.departamento}: ${row.total_horas}h`)
    .join('\n');

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || 'user@example.com',
      pass: process.env.SMTP_PASS || 'password',
    },
  });

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@example.com',
      to: client.email_contacto || 'destinatario@example.com',
      subject: `Resumen semanal ${from} - ${to}`,
      text: `Hola,\n\nAdjuntamos el detalle de horas.\n\nResumen:\n${summaryText}`,
      attachments: [
        {
          filename: 'horas.xlsx',
          content: buffer,
        },
      ],
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo enviar el correo', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
