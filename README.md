# 🐾 PetStyle — Peluquería canina con servicio de ruta

Aplicación web hecha **solo con HTML, CSS y JavaScript**, conectada a una base de datos en la nube
(**Supabase / PostgreSQL**) y publicada con **GitHub + Vercel**. No necesita instalar nada.

| Rol | Cómo se obtiene | Qué ve |
|---|---|---|
| **Cliente** | Cualquiera se registra en "Crear cuenta" | Registra mascotas, agenda citas (con ruta opcional), ve y cancela sus citas |
| **Administrador** | Lo asigna la responsable del sistema desde Supabase (paso 3) | Todas las citas con teléfono y dirección del cliente; aprueba, pone en proceso, rechaza y entrega |

Hay **un solo login** para todos: el rol se identifica automáticamente.

```
petstyle/
├── index.html          pantallas (login, vista cliente, vista administrador)
├── style.css           estilos
├── app.js              lógica (login, registro, mascotas, citas, estados)
├── config.js           URL y clave PÚBLICA de Supabase
├── database/schema.sql base de datos completa (tablas, reglas y seguridad)
└── docs/modelo-datos.md
```

---

## 1. Crear la base de datos (Supabase)

1. Entra a [supabase.com](https://supabase.com) → tu proyecto (o **New project** si no tienes uno).
2. Menú **SQL Editor** → **New query** → pega **todo** el contenido de `database/schema.sql` → **Run**.
   Debe terminar con *Success*. (Puedes volver a ejecutarlo cuando quieras; borra y recrea las tablas.)
3. Menú **Authentication → Sign In / Providers → Email** → **desactiva "Confirm email"** y guarda.
   Así, al registrarse, la persona entra de inmediato. *(Si lo dejas activo, el registro funciona igual, pero
   cada persona debe confirmar su correo y Supabase limita el envío de correos a pocos por hora.)*
4. Menú **Project Settings → API**: copia **Project URL** y la clave **publishable** (o *anon*) y pégalas en `config.js`.
   Si usas el mismo proyecto de antes, ya están puestas.

> 🔒 La clave publishable es pública por diseño; la seguridad la dan las reglas del `schema.sql`.
> **Nunca** pegues en `config.js` la clave *secret* ni *service_role*.

## 2. Probarla en tu computador
En VS Code instala la extensión **Live Server**, abre la carpeta del proyecto y pulsa **Go Live**.
(También sirve abrir `index.html` con doble clic.)

## 3. Crear la cuenta de Administrador
1. En la página, **Crear cuenta** con el correo que será de administrador.
2. En Supabase → **SQL Editor** → **New query**, cambia el correo y ejecuta:
   ```sql
   update public.profiles
   set rol = 'ADMINISTRADOR'
   where id = (select id from auth.users where email = 'tu-correo@ejemplo.com');
   ```
3. Cierra sesión e inicia de nuevo: ahora entras al panel de administrador.

Para quitarle el permiso: la misma consulta con `rol = 'CLIENTE'`.

## 4. Subir a GitHub
**Con comandos** (en la carpeta del proyecto):
```bash
git init
git add .
git commit -m "PetStyle: primera versión"
git branch -M main
git remote add origin https://github.com/TU-USUARIO/petstyle.git
git push -u origin main
```
**Sin comandos:** en GitHub → **New repository** → **Add file → Upload files** → arrastra los archivos.

## 5. Publicar en Vercel
1. [vercel.com](https://vercel.com) → inicia sesión con GitHub → **Add New… → Project**.
2. **Import** el repositorio `petstyle`.
3. *Framework Preset*: **Other**. Deja vacíos *Build Command* y *Output Directory*. **Deploy**.
4. Vercel te da una URL pública (`https://petstyle-xxxx.vercel.app`). Pruébala: registro, login, citas.
5. Supabase → **Authentication → URL Configuration** → pega esa URL en **Site URL**.

Cada vez que hagas `git push`, Vercel publica los cambios solo.

## Problemas frecuentes
| Mensaje / síntoma | Causa y solución |
|---|---|
| "Demasiados intentos…" al registrarse | Supabase limita los correos de confirmación. Desactiva *Confirm email* (paso 1.3). |
| "Debes confirmar tu correo…" | Tenías *Confirm email* activo. Desactívalo y, en *Authentication → Users*, borra ese usuario y regístralo de nuevo. |
| "No se pudo cargar tu perfil" | No se ejecutó `schema.sql`, o se ejecutó con error. Vuelve a correrlo completo. |
| "Credenciales inválidas…" | Correo o contraseña incorrectos. |
| Entro como cliente y debería ser administrador | Falta el paso 3, o no cerraste sesión después de ejecutarlo. |
| No se actualiza en vivo | La página se refresca sola cada 15 s si el tiempo real no está disponible. |
| En Vercel la página carga pero no hay datos | Revisa que `config.js` esté subido a GitHub con la URL y clave correctas. |

⚠️ **Plan gratuito de Supabase:** el proyecto se **pausa tras 7 días sin actividad**. Se reactiva con un clic
en el panel de Supabase. Conviene entrar el día antes de la sustentación.
