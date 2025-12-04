# Gestor de horas - Node.js + Tailwind

Aplicación web liviana para que programadores carguen horas diarias, los clientes consulten sus reportes y el administrador exporte a Excel o envíe resúmenes por correo.

## Requisitos
- Node.js 18+
- SQLite (se usa un archivo local `data.db`)

## Instalación y ejecución local
```bash
npm install
npm run start
```
El servidor quedará en `http://localhost:3000` y servirá el frontend estático desde `public/`.

Credenciales iniciales: `admin@example.com` / `admin123` (se autogenera al iniciar si no existe).

## Variables de entorno
Crear un archivo `.env` opcional con:
```
PORT=3000
JWT_SECRET=una_clave_segura
EDIT_WINDOW_DAYS=7
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=usuario
SMTP_PASS=clave
SMTP_FROM=noreply@example.com
```

## Endpoints principales
- `POST /auth/login` — devuelve JWT.
- CRUD de catálogos: `/users`, `/clients`, `/departments`, `/collaborators`, `/projects`, `/tasks` (solo ADMIN).
- `GET/POST/PUT/DELETE /time-entries` — carga y gestión de horas con validación de rol y ventana de edición.
- `GET /reports/summary` — resumen por colaborador/departamento.
- `GET /reports/excel` — exporta Excel (detalle + resumen).
- `POST /reports/send-weekly` — genera Excel y lo envía por correo.

## Frontend
El `public/index.html` usa Tailwind CDN y JS vanilla (`public/app.js`). Se muestran tres paneles según el rol del usuario autenticado (programador, administrador, cliente). El token JWT se almacena en `localStorage` para reutilizar sesión.

## Despliegue
- **Frontend**: los archivos en `public/` pueden hospedarse en GitHub Pages o cualquier CDN estático.
- **Backend**: desplegable en servicios con free tier (Render, Railway, Fly.io). Se requiere definir variables de entorno y usar una base relacional compatible (SQLite o Postgres adaptando `db.js`).
- La app sirve el frontend directamente, pero también puede configurarse un dominio separado para el cliente estático consumiendo la API pública.

## Generación de Excel y correos
Se usa `exceljs` para armar el archivo con hoja de detalle y resumen, y `nodemailer` para enviarlo por SMTP definido por variables de entorno. El botón de administrador “Enviar correo” llama a `/reports/send-weekly`.
