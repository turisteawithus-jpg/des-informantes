# 📰 DES Informantes

> *Más allá del relato, están los hechos.*

Ecosistema de trabajo digital online donde los equipos crean **mesas de trabajo**,
conversan por **voz y texto**, y la IA **transcribe, modera, resume y sistematiza**
todo automáticamente en documentos completos con relatorías, tareas y un mapa de
contenidos.

## ✨ Funcionalidades

- **Landing con chat general público** — cualquiera puede leer; solo usuarios registrados escriben.
- **Registro con correo + contraseña** y verificación por correo (Resend, gratis).
- **Mesas de trabajo (tableros)** con flujo de aprobación por el administrador general.
- **Dentro de cada mesa**: discusiones por voz/texto, tareas, documentos, línea de trabajo con hitos, y sistematización con IA.
- **Transcripción oculta con IA** — cada audio se transcribe automáticamente.
- **Moderación con IA** — resumen cada 5 mensajes: conclusiones, tareas detectadas, ambiente.
- **Relatoría automática** al cerrar una discusión.
- **Sistematización** — la IA compila todo el historial de la mesa en un documento descargable.
- **Mapa de documentos** — los documentos se conectan por temas mostrando el proceso.
- **Panel de administrador general** — aprueba/rechaza mesas, gestiona admins de mesas, usuarios.
- **Panel de administrador de mesa** — aprueba/rechaza solicitudes de ingreso de miembros.

## 🧱 Stack

React 19 + TypeScript + Vite + Tailwind + shadcn/ui · Hono + tRPC · Drizzle ORM + MySQL ·
Google Gemini (IA) · Resend (correos) · JWT en cookie httpOnly.

## 🚀 Desarrollo local

```bash
npm install
# Edita .env con tus variables (ver tabla abajo)
npm run db:push        # crea las tablas en MySQL
npm run dev            # http://localhost:3000
```

> Sin `GEMINI_API_KEY` ni `RESEND_API_KEY` la app funciona en modo degradado:
> los correos se imprimen en consola y las funciones de IA muestran mensajes informativos.

## 🔑 Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Conexión MySQL |
| `JWT_SECRET` | Clave larga y secreta para firmar sesiones |
| `ADMIN_EMAIL` | **Tu correo**. Quien se registre con este correo será administrador general |
| `GEMINI_API_KEY` | API key gratis de [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_MODEL` | `gemini-2.0-flash` (por defecto) |
| `RESEND_API_KEY` | API key gratis de [Resend](https://resend.com/api-keys) |
| `RESEND_FROM` | Remitente, ej. `DES Informantes <hola@tudominio.com>` |
| `APP_URL` | URL pública, ej. `https://desinformantes.tudominio.com` |

## 🌐 Despliegue en Hostinger VPS

> ⚠️ Requiere un **plan VPS** de Hostinger (el hosting compartido no sirve para Node.js + MySQL).
> El plan KVM 1 es suficiente.

1. **En tu VPS**, instala Node.js 20+ y MySQL (o usa la misma DB externa que ya tienes).
2. **Sube el código** (con Git o SFTP).
3. **Configura el entorno**: `cp .env.example .env` y edita todas las variables.
4. **Instala y compila**:
   ```bash
   npm install
   npm run db:push
   npm run build
   ```
5. **Arranca con PM2**:
   ```bash
   npm install -g pm2
   NODE_ENV=production pm2 start "npm start" --name desinformantes
   pm2 save && pm2 startup
   ```
6. **Nginx como proxy inverso**:
   ```nginx
   server {
       listen 80;
       server_name desinformantes.tudominio.com;
       client_max_body_size 50M;
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Forwarded-For $remote_addr;
       }
   }
   ```
7. **HTTPS con Certbot**:
   ```bash
   certbot --nginx -d desinformantes.tudominio.com
   ```

Los archivos subidos (audios/documentos) se guardan en `uploads/` en el VPS.

## 📁 Estructura

```
api/routers/    auth, globalChat, workspaces, workspaceApprovals, discussions, tasks, documents, timeline, admin
db/schema.ts    Tablas MySQL (Drizzle)
src/pages/      Home (landing + chat global), Register, Login, VerifyEmail, Dashboard, WorkspaceView, DiscussionRoom, Admin
src/components/ workspace/  TasksPanel, DocumentsPanel, SystematizationPanel, TimelinePanel
uploads/        Archivos subidos (no se sube a Git)
```

## 🛡️ Administrador general

1. Configura `ADMIN_EMAIL=tucorreo@ejemplo.com` en `.env`.
2. Regístrate en la plataforma con ese correo.
3. Tu cuenta será **administrador general** — verás el botón "Admin".
4. Desde el panel admin podrás aprobar mesas, gestionar admins de mesas y usuarios.
