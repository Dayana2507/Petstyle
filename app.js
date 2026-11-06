const SUPABASE_URL = 'https://ynlbicplvtahhmhxhytw.supabase.co/rest/v1/';
const SUPABASE_ANON_KEY = 'sb_publishable_FcVgjC4s6lsQDCQRX8e2Qw__47e8bfo';

const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =====================================================================
// PETSTYLE · app.js — HTML + CSS + JavaScript puro, conectado a _supabase
// Un solo login para todos: el rol (CLIENTE / ADMINISTRADOR) se lee de la
// tabla `profiles` y cada rol ve SU vista. El administrador lo asigna el
// responsable del sistema desde _supabase (ver database/schema.sql).
// =====================================================================

const ESTADOS_TERMINALES = ['Entregada', 'Rechazada', 'Cancelada'];
const REFRESCO_RESPALDO_MS = 15000; // solo si el tiempo real no está disponible

// Rutas de la SPA (una por vista)
const RUTA_LOGIN = '#/login';
const RUTA_CLIENTE = '#/cliente';
const RUTA_ADMIN = '#/admin';
const rutaDeRol = (rol) => (rol === 'ADMINISTRADOR' ? RUTA_ADMIN : RUTA_CLIENTE);

// Estado local
let perfilActual = null; // { id, nombre, telefono, rol }
let listaCitasGlobal = [];
let canalCitas = null;
let timerRespaldo = null;
let timerDebounce = null;

// ELEMENTOS DOM
const $ = (id) => document.getElementById(id);
const pantallaLogin = $('pantalla-login');
const pantallaSistema = $('pantalla-sistema');
const vistaCliente = $('vista-cliente');
const vistaAdmin = $('vista-admin');
const labelUsuario = $('label-usuario');
const formAuthLogin = $('form-auth-login');
const formAuthRegistro = $('form-auth-registro');
const checkRuta = $('check-ruta');
const boxDireccion = $('box-direccion');
const inputDireccion = $('cita-direccion');
const inputFechaCita = $('cita-fecha');
const formMascota = $('form-mascota');
const formCita = $('form-cita');
const selectMascotas = $('cita-mascota');
const listaMascotasEl = $('lista-mascotas');
const mascotaEditId = $('mascota-edit-id');
const btnGuardarMascota = $('btn-guardar-mascota');
const btnCancelarEdicion = $('btn-cancelar-edicion');
const listaMisCitasEl = $('lista-mis-citas');
const contenedorCitas = $('contenedor-citas');
const filtroBuscar = $('filtro-buscar');
const filtroEstado = $('filtro-estado');

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
// Escapa texto del usuario antes de insertarlo como HTML (evita XSS)
function esc(valor) {
  return String(valor ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

let toastTimer = null;
function mostrarNotificacion(mensaje, esError = false) {
  const toastEl = $('app-toast');
  toastEl.querySelector('.toast__icon').className =
    `ph-fill ${esError ? 'ph-warning-circle' : 'ph-check-circle'} toast__icon`;
  $('toast-mensaje').textContent = mensaje;
  toastEl.classList.toggle('toast--error', esError);
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 4200);
}
document.querySelector('.toast__close').addEventListener('click', () => $('app-toast').classList.remove('show'));

function bloquearBoton(boton, textoCarga) {
  boton.dataset.textoOriginal = boton.textContent;
  boton.textContent = textoCarga;
  boton.disabled = true;
}
function liberarBoton(boton) {
  boton.textContent = boton.dataset.textoOriginal || boton.textContent;
  boton.disabled = false;
}

// Validación en pantalla (RNF-04): marca el campo y avisa antes de enviar
function marcarInvalido(idInput, mensaje) {
  const control = $(idInput).closest('.field__control');
  if (control) control.classList.add('is-invalid');
  $(idInput).focus();
  mostrarNotificacion(mensaje, true);
  return false;
}
function limpiarInvalidos(form) {
  form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}
document.addEventListener('input', (e) => {
  const control = e.target.closest && e.target.closest('.field__control');
  if (control) control.classList.remove('is-invalid');
});

// Traduce los errores de _supabase Auth a mensajes claros
function mensajeAuth(err) {
  const m = (err && err.message) || '';
  if (/invalid login credentials/i.test(m)) return 'Credenciales inválidas, verifique su usuario o contraseña';
  if (/email not confirmed/i.test(m)) return 'Debes confirmar tu correo antes de iniciar sesión. Revisa tu bandeja de entrada.';
  if (/already (been )?registered/i.test(m)) return 'El correo electrónico ya se encuentra registrado';
  if (/rate limit|too many|security purposes/i.test(m) || (err && err.status === 429)) {
    return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  }
  if (/password/i.test(m) && /(least|short|weak|characters)/i.test(m)) return 'La contraseña debe tener mínimo 6 caracteres';
  if (/failed to fetch|networkerror|network request/i.test(m)) return 'No hay conexión con el servidor. Revisa tu Internet.';
  if (/signups? (not allowed|are disabled)/i.test(m)) return 'El registro de usuarios está deshabilitado en este momento.';
  return m || 'Ocurrió un error inesperado';
}

// ---------------------------------------------------------------------
// ROUTER (SPA) + GUARDIA POR ROL
//   #/login    -> acceso (solo sin sesión)
//   #/cliente  -> vista del cliente
//   #/admin    -> vista del administrador
// La seguridad real la imponen las políticas RLS de la base de datos;
// esto solo evita que cada rol vea la pantalla del otro.
// ---------------------------------------------------------------------
function irA(hash) {
  if (location.hash === hash) renderRuta();
  else location.hash = hash; // dispara 'hashchange' -> renderRuta()
}

function detenerActualizaciones() {
  if (canalCitas) { _supabase.removeChannel(canalCitas); canalCitas = null; }
  clearInterval(timerRespaldo); timerRespaldo = null;
  clearTimeout(timerDebounce);
}

function renderRuta() {
  const hash = location.hash || RUTA_LOGIN;

  if (!perfilActual) {
    detenerActualizaciones();
    pantallaSistema.classList.add('d-none');
    pantallaLogin.classList.remove('d-none');
    if (location.hash !== RUTA_LOGIN) history.replaceState(null, '', RUTA_LOGIN);
    return;
  }

  const destino = rutaDeRol(perfilActual.rol);
  if (hash !== destino) {
    if (hash === RUTA_ADMIN || hash === RUTA_CLIENTE) {
      mostrarNotificacion('Zona restringida: no tienes acceso a esa sección', true);
    }
    history.replaceState(null, '', destino);
  }

  pantallaLogin.classList.add('d-none');
  pantallaSistema.classList.remove('d-none');
  detenerActualizaciones();

  if (perfilActual.rol === 'ADMINISTRADOR') montarVistaAdmin();
  else montarVistaCliente();
}
window.addEventListener('hashchange', renderRuta);

async function montarVistaCliente() {
  labelUsuario.innerHTML = `<i class="ph-fill ph-heart"></i> ${esc(perfilActual.nombre)}`;
  vistaCliente.classList.remove('d-none');
  vistaAdmin.classList.add('d-none');

  // No permitir fechas pasadas en el selector
  const ahora = new Date();
  ahora.setMinutes(ahora.getMinutes() - ahora.getTimezoneOffset());
  inputFechaCita.min = ahora.toISOString().slice(0, 16);

  await cargarMascotas();
  await cargarMisCitas();
  suscribirCitas(cargarMisCitas, `user_id=eq.${perfilActual.id}`);
}

async function montarVistaAdmin() {
  labelUsuario.innerHTML = `<i class="ph ph-identification-badge"></i> Administrador: ${esc(perfilActual.nombre)}`;
  vistaAdmin.classList.remove('d-none');
  vistaCliente.classList.add('d-none');

  await cargarCitasAdmin();
  suscribirCitas(cargarCitasAdmin, null);
}

// Tiempo real: cuando cambia una cita se vuelve a consultar. Si el canal no
// está disponible, se consulta cada 15 s como respaldo.
function suscribirCitas(recargar, filtro) {
  const alCambiar = () => {
    clearTimeout(timerDebounce);
    timerDebounce = setTimeout(recargar, 250);
  };
  const config = { event: '*', schema: 'public', table: 'citas' };
  if (filtro) config.filter = filtro;

  canalCitas = _supabase.channel(`citas-${perfilActual.id}`)
    .on('postgres_changes', config, alCambiar)
    .subscribe((estado) => {
      if (estado === 'SUBSCRIBED') {
        clearInterval(timerRespaldo); timerRespaldo = null;
      } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(estado) && !timerRespaldo) {
        timerRespaldo = setInterval(recargar, REFRESCO_RESPALDO_MS);
      }
    });
}

// ---------------------------------------------------------------------
// SESIÓN Y PERFIL
// ---------------------------------------------------------------------
async function obtenerPerfil(user) {
  let { data } = await _supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (data) return data;

  // Respaldo: si el perfil no existe (usuario creado antes del trigger),
  // el propio usuario puede crearse uno, siempre como CLIENTE.
  const meta = user.user_metadata || {};
  const { error } = await _supabase.from('profiles').insert([{
    id: user.id, nombre: meta.nombre || user.email, telefono: meta.telefono || '', rol: 'CLIENTE'
  }]);
  if (error) return null;
  ({ data } = await _supabase.from('profiles').select('*').eq('id', user.id).maybeSingle());
  return data || null;
}

// Lee la sesión guardada y carga el perfil (y con él, el rol)
async function restaurarSesion() {
  const { data: { session } } = await _supabase.auth.getSession();
  if (!session) { perfilActual = null; return false; }

  const perfil = await obtenerPerfil(session.user);
  if (!perfil) {
    perfilActual = null;
    await _supabase.auth.signOut();
    mostrarNotificacion('No se pudo cargar tu perfil. Intenta iniciar sesión de nuevo.', true);
    return false;
  }
  perfilActual = perfil;
  return true;
}

async function cerrarSesion(mensaje = 'Sesión cerrada') {
  perfilActual = null; // antes del signOut, para que el listener no repita el cierre
  detenerActualizaciones();
  await _supabase.auth.signOut();
  if (mensaje) mostrarNotificacion(mensaje);
  irA(RUTA_LOGIN);
}
$('btn-logout').addEventListener('click', () => cerrarSesion());

// Si la sesión se cierra por otro motivo (token vencido, otra pestaña), volver al login
_supabase.auth.onAuthStateChange((evento) => {
  if (evento === 'SIGNED_OUT' && perfilActual) {
    perfilActual = null;
    detenerActualizaciones();
    mostrarNotificacion('Tu sesión terminó. Inicia sesión de nuevo.', true);
    irA(RUTA_LOGIN);
  }
});

// ---------------------------------------------------------------------
// AUTENTICACIÓN (FN-01): tabs, registro y login
// ---------------------------------------------------------------------
const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    $(btn.dataset.target).classList.add('active');
  });
});

// REGISTRO: la cuenta SIEMPRE nace como CLIENTE (lo garantiza el trigger de la base de datos).
formAuthRegistro.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarInvalidos(formAuthRegistro);

  const nombre = $('reg-nombre').value.trim();
  const email = $('reg-email').value.trim();
  const telefono = $('reg-telefono').value.trim();
  const password = $('reg-password').value;

  // Validación en pantalla antes de enviar
  if (nombre.length < 2) return marcarInvalido('reg-nombre', 'Escribe tu nombre completo');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return marcarInvalido('reg-email', 'Escribe un correo electrónico válido');
  if (!/^[0-9+()\s-]{7,20}$/.test(telefono)) return marcarInvalido('reg-telefono', 'Escribe un teléfono válido (solo números)');
  if (password.length < 6) return marcarInvalido('reg-password', 'La contraseña debe tener mínimo 6 caracteres');

  const btn = $('btn-registro-submit');
  bloquearBoton(btn, 'Creando cuenta…');

  try {
    const { data, error } = await _supabase.auth.signUp({
      email, password, options: { data: { nombre, telefono } }
    });
    if (error) { mostrarNotificacion(mensajeAuth(error), true); return; }

    // Con la confirmación por correo activa, un correo ya registrado no da error:
    // devuelve un usuario sin "identities".
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      mostrarNotificacion('El correo electrónico ya se encuentra registrado', true);
      return;
    }

    // Sin sesión = _supabase está pidiendo confirmar el correo
    if (!data.session) {
      formAuthRegistro.reset();
      $('tab-login').click();
      mostrarNotificacion('Cuenta creada. Revisa tu correo y confírmala antes de iniciar sesión.');
      return;
    }

    if (await restaurarSesion()) {
      formAuthRegistro.reset();
      mostrarNotificacion(`¡Bienvenido a PetStyle, ${nombre}! Registro exitoso 🎉`);
      irA(rutaDeRol(perfilActual.rol));
    }
  } catch (err) {
    mostrarNotificacion(mensajeAuth(err), true);
  } finally {
    liberarBoton(btn);
  }
});

// LOGIN ÚNICO: el rol se identifica automáticamente a partir del perfil.
formAuthLogin.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarInvalidos(formAuthLogin);

  const email = $('login-usuario').value.trim();
  const password = $('login-password').value;
  if (!email) return marcarInvalido('login-usuario', 'Ingresa tu correo electrónico');
  if (!password) return marcarInvalido('login-password', 'Ingresa tu contraseña');

  const btn = $('btn-login-submit');
  bloquearBoton(btn, 'Verificando…');

  try {
    const { error } = await _supabase.auth.signInWithPassword({ email, password });
    if (error) { mostrarNotificacion(mensajeAuth(error), true); return; }

    if (await restaurarSesion()) {
      formAuthLogin.reset();
      irA(rutaDeRol(perfilActual.rol)); // cada rol aterriza en SU vista
    }
  } catch (err) {
    mostrarNotificacion(mensajeAuth(err), true);
  } finally {
    liberarBoton(btn);
  }
});

// ---------------------------------------------------------------------
// VISTA CLIENTE · MASCOTAS (FN-02: CRUD)
// ---------------------------------------------------------------------
function limpiarFormularioMascota() {
  formMascota.reset();
  mascotaEditId.value = '';
  btnGuardarMascota.textContent = 'Guardar mascota';
  btnCancelarEdicion.classList.add('d-none');
}
btnCancelarEdicion.addEventListener('click', limpiarFormularioMascota);

formMascota.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!perfilActual) return;

  const nombre = $('mascota-nombre').value.trim();
  const especie = $('mascota-especie').value;
  const raza = $('mascota-raza').value.trim();
  const edadValor = $('mascota-edad').value;
  const edad = edadValor === '' ? null : parseInt(edadValor, 10);
  const idEnEdicion = mascotaEditId.value;

  if (!nombre || !raza) return mostrarNotificacion('Por favor complete los campos obligatorios', true);
  if (edad !== null && (Number.isNaN(edad) || edad < 0 || edad > 40)) {
    return mostrarNotificacion('La edad debe estar entre 0 y 40 años', true);
  }

  const { error } = idEnEdicion
    ? await _supabase.from('mascotas').update({ nombre, especie, raza, edad }).eq('id', idEnEdicion)
    : await _supabase.from('mascotas').insert([{ user_id: perfilActual.id, nombre, especie, raza, edad }]);

  if (error) return mostrarNotificacion('Error: ' + error.message, true);

  mostrarNotificacion(idEnEdicion ? '🐾 Mascota actualizada correctamente' : '🐾 Mascota agregada correctamente');
  limpiarFormularioMascota();
  await cargarMascotas();
});

async function cargarMascotas() {
  if (!perfilActual) return;
  const { data: mascotas, error } = await _supabase.from('mascotas')
    .select('*').eq('user_id', perfilActual.id).order('nombre', { ascending: true });

  if (error || !mascotas) {
    selectMascotas.innerHTML = '<option value="">No se pudieron cargar tus mascotas</option>';
    listaMascotasEl.innerHTML = `<p class="pet-list__empty">Error al cargar mascotas.</p>`;
    return;
  }

  const seleccionPrevia = selectMascotas.value;
  if (mascotas.length === 0) {
    selectMascotas.innerHTML = '<option value="">Sin mascotas. ¡Registra una!</option>';
    listaMascotasEl.innerHTML = `<p class="pet-list__empty">Aún no has registrado mascotas.</p>`;
    return;
  }

  selectMascotas.innerHTML = '<option value="">Selecciona tu mascota...</option>' +
    mascotas.map(m => `<option value="${m.id}">${esc(m.nombre)} (${esc(m.especie)} - ${esc(m.raza)})</option>`).join('');
  if (seleccionPrevia) selectMascotas.value = seleccionPrevia;

  listaMascotasEl.innerHTML = mascotas.map(m => `
    <div class="pet-item animate-fade-in">
      <span class="pet-item__icon"><i class="ph-fill ${m.especie === 'Gato' ? 'ph-cat' : 'ph-dog'}"></i></span>
      <span class="pet-item__info">
        <span class="pet-item__name">${esc(m.nombre)}</span>
        <span class="pet-item__meta">${esc(m.especie)} · ${esc(m.raza)}${m.edad != null ? ` · ${m.edad} ${m.edad === 1 ? 'año' : 'años'}` : ''}</span>
      </span>
      <span class="pet-item__actions">
        <button type="button" class="icon-btn" title="Editar" data-editar="${m.id}"><i class="ph ph-pencil-simple"></i></button>
        <button type="button" class="icon-btn icon-btn--danger" title="Eliminar" data-eliminar="${m.id}"><i class="ph ph-trash"></i></button>
      </span>
    </div>`).join('');

  listaMascotasEl.querySelectorAll('[data-editar]').forEach(btn => {
    btn.addEventListener('click', () => iniciarEdicionMascota(btn.dataset.editar, mascotas));
  });
  listaMascotasEl.querySelectorAll('[data-eliminar]').forEach(btn => {
    btn.addEventListener('click', () => eliminarMascota(btn.dataset.eliminar));
  });
}

function iniciarEdicionMascota(id, mascotas) {
  const m = mascotas.find(x => String(x.id) === String(id));
  if (!m) return;
  $('mascota-nombre').value = m.nombre;
  $('mascota-especie').value = m.especie;
  $('mascota-raza').value = m.raza;
  $('mascota-edad').value = m.edad ?? '';
  mascotaEditId.value = m.id;
  btnGuardarMascota.textContent = 'Actualizar mascota';
  btnCancelarEdicion.classList.remove('d-none');
  formMascota.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function eliminarMascota(id) {
  if (!window.confirm('¿Eliminar esta mascota? Esta acción no se puede deshacer.')) return;

  const { error } = await _supabase.from('mascotas').delete().eq('id', id);
  if (error) {
    const porCitas = ['23001', '23503'].includes(error.code);
    return mostrarNotificacion(porCitas
      ? 'No se puede eliminar: esta mascota tiene citas registradas.'
      : 'Error al eliminar: ' + error.message, true);
  }
  mostrarNotificacion('Mascota eliminada');
  if (mascotaEditId.value === String(id)) limpiarFormularioMascota();
  await cargarMascotas();
}

// ---------------------------------------------------------------------
// VISTA CLIENTE · AGENDAR CITA (FN-03) Y "MIS CITAS" (FN-04)
// ---------------------------------------------------------------------
checkRuta.addEventListener('change', () => {
  if (checkRuta.checked) {
    boxDireccion.classList.remove('d-none');
    inputDireccion.setAttribute('required', 'true');
  } else {
    boxDireccion.classList.add('d-none');
    inputDireccion.removeAttribute('required');
    inputDireccion.value = '';
  }
});

formCita.addEventListener('submit', async (e) => {
  e.preventDefault();
  limpiarInvalidos(formCita);

  const mascota_id = selectMascotas.value;
  const requiere_ruta = checkRuta.checked;
  const direccion = inputDireccion.value.trim();
  const fecha = new Date(inputFechaCita.value);

  if (!mascota_id) return mostrarNotificacion('Selecciona una de tus mascotas', true);
  if (!inputFechaCita.value || Number.isNaN(fecha.getTime())) return marcarInvalido('cita-fecha', 'Selecciona la fecha y la hora');
  if (fecha < new Date()) return marcarInvalido('cita-fecha', 'La fecha de la cita no puede ser anterior a hoy');
  if (![0, 30].includes(fecha.getMinutes())) {
    return marcarInvalido('cita-fecha', 'Elige una hora en punto o y media (por ejemplo 10:00 o 10:30)');
  }
  if (requiere_ruta && !direccion) return marcarInvalido('cita-direccion', 'Debe ingresar una dirección para solicitar ruta');

  const { error } = await _supabase.from('citas').insert([{
    user_id: perfilActual.id,
    mascota_id: Number(mascota_id),
    servicio: $('cita-servicio').value,
    estilo_corte: $('cita-corte').value.trim() || null,
    especificaciones: $('cita-notas').value.trim() || null,
    requiere_ruta,
    direccion: requiere_ruta ? direccion : null,
    fecha_hora: fecha.toISOString(),
    estado: 'Pendiente'
  }]);

  if (error) {
    if (error.code === '23505') return mostrarNotificacion('El horario seleccionado acaba de ser ocupado. Elige otro horario.', true);
    if (error.code === '42501') return mostrarNotificacion('No se pudo agendar: revisa la mascota y que la fecha sea futura.', true);
    return mostrarNotificacion('Error: ' + error.message, true);
  }

  mostrarNotificacion('✨ ¡Cita agendada exitosamente! Quedó en estado Pendiente.');
  formCita.reset();
  boxDireccion.classList.add('d-none');
  await cargarMisCitas();
});

async function cargarMisCitas() {
  if (!perfilActual || perfilActual.rol !== 'CLIENTE') return;

  const { data: citas, error } = await _supabase.from('citas')
    .select('*, mascotas(nombre, especie, raza)')
    .eq('user_id', perfilActual.id)
    .order('fecha_hora', { ascending: false });

  if (error) {
    listaMisCitasEl.innerHTML = `<p class="pet-list__empty">No se pudieron cargar tus citas.</p>`;
    return;
  }
  renderizarMisCitas(citas || []);
}

function formatearFecha(iso) {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderizarMisCitas(citas) {
  if (citas.length === 0) {
    listaMisCitasEl.innerHTML = `<p class="pet-list__empty">Aún no has agendado ninguna cita.</p>`;
    return;
  }
  listaMisCitasEl.innerHTML = citas.map(c => `
    <div class="mi-cita-item">
      <span class="mi-cita-item__info">
        <span class="pet-item__name">${esc(c.mascotas ? c.mascotas.nombre : 'Mascota')} · ${esc(c.servicio)}</span>
        <span class="pet-item__meta"><i class="ph ph-clock"></i> ${formatearFecha(c.fecha_hora)}${c.requiere_ruta ? ' · <i class="ph ph-van"></i> con ruta' : ''}</span>
      </span>
      <span class="mi-cita-item__side">
        <span class="badge ${badgeClaseEstado(c.estado)}">${esc(c.estado)}</span>
        ${c.estado === 'Pendiente' ? `<button type="button" class="btn-mini" data-cancelar="${c.id}">Cancelar cita</button>` : ''}
      </span>
    </div>`).join('');
}

listaMisCitasEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-cancelar]');
  if (!btn) return;
  if (!window.confirm('¿Cancelar esta cita?')) return;

  const { data, error } = await _supabase.from('citas')
    .update({ estado: 'Cancelada' })
    .eq('id', btn.dataset.cancelar).eq('estado', 'Pendiente')
    .select();

  if (error) mostrarNotificacion('Error: ' + error.message, true);
  else if (!data || data.length === 0) mostrarNotificacion('No es posible cancelar una cita que ya fue atendida o está en proceso', true);
  else mostrarNotificacion('Cita cancelada');
  await cargarMisCitas();
});

// ---------------------------------------------------------------------
// VISTA ADMINISTRADOR · PANEL OPERATIVO (FN-04)
// ---------------------------------------------------------------------
async function cargarCitasAdmin() {
  if (!perfilActual || perfilActual.rol !== 'ADMINISTRADOR') return;

  const { data: citas, error } = await _supabase.from('citas')
    .select('*, mascotas(nombre, especie, raza), profiles(nombre, telefono)')
    .order('fecha_hora', { ascending: true });

  if (error) {
    contenedorCitas.innerHTML = `<p style="color:var(--coral-deep); padding: 1rem;">Error: ${esc(error.message)}</p>`;
    return;
  }
  listaCitasGlobal = citas || [];
  actualizarMetricas(listaCitasGlobal);
  aplicarFiltros();
}

function actualizarMetricas(citas) {
  $('cnt-total').textContent = citas.length;
  $('cnt-pendientes').textContent = citas.filter(c => !ESTADOS_TERMINALES.includes(c.estado)).length;
  $('cnt-ruta').textContent = citas.filter(c => c.requiere_ruta).length;
}

function aplicarFiltros() {
  const texto = filtroBuscar.value.toLowerCase();
  const estado = filtroEstado.value;
  renderizarTarjetasCitas(listaCitasGlobal.filter(c => {
    const mascota = c.mascotas ? c.mascotas.nombre.toLowerCase() : '';
    const servicio = (c.servicio || '').toLowerCase();
    return (mascota.includes(texto) || servicio.includes(texto)) && (estado === 'TODOS' || c.estado === estado);
  }));
}

function badgeClaseEstado(estado) {
  switch (estado) {
    case 'Aprobada': return 'badge--aprobada';
    case 'En proceso': return 'badge--proceso';
    case 'Entregada': return 'badge--entregada';
    case 'Rechazada': return 'badge--rechazada';
    case 'Cancelada': return 'badge--cancelada';
    default: return 'badge--pendiente';
  }
}

function construirAccionesRapidas(cita) {
  const botones = [];
  if (cita.estado === 'Pendiente') {
    botones.push(`<button type="button" class="btn--advance" data-accion="Aprobada" data-id="${cita.id}"><i class="ph ph-check-circle"></i> Aprobar</button>`);
    botones.push(`<button type="button" class="btn--advance btn--advance-danger" data-accion="Rechazada" data-id="${cita.id}"><i class="ph ph-x-circle"></i> Rechazar</button>`);
  } else if (cita.estado === 'Aprobada') {
    botones.push(`<button type="button" class="btn--advance" data-accion="En proceso" data-id="${cita.id}"><i class="ph ph-gear-six"></i> Poner en proceso</button>`);
    botones.push(`<button type="button" class="btn--advance btn--advance-danger" data-accion="Rechazada" data-id="${cita.id}"><i class="ph ph-x-circle"></i> Rechazar</button>`);
  } else if (cita.estado === 'En proceso') {
    botones.push(`<button type="button" class="btn--advance" data-accion="Entregada" data-id="${cita.id}"><i class="ph ph-package"></i> Marcar como entregada</button>`);
  }

  if (botones.length === 0) {
    const cancelada = cita.estado === 'Rechazada' || cita.estado === 'Cancelada';
    const texto = cita.estado === 'Entregada' ? 'Ciclo completado' : `Cita ${cita.estado.toLowerCase()}`;
    return `<span class="status-locked ${cancelada ? 'status-locked--cancel' : ''}"><i class="ph ph-lock-simple"></i> ${texto}</span>`;
  }
  return `<div class="acciones-rapidas">${botones.join('')}</div>`;
}

function renderizarTarjetasCitas(citas) {
  if (citas.length === 0) {
    contenedorCitas.innerHTML = `<div class="empty-state"><i class="ph ph-tray"></i>No se encontraron citas</div>`;
    return;
  }

  contenedorCitas.innerHTML = citas.map(cita => {
    const mascota = cita.mascotas || {};
    const cliente = cita.profiles || {};
    const imgUrl = mascota.especie === 'Gato'
      ? 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1?auto=format&fit=crop&w=150&q=80'
      : 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?auto=format&fit=crop&w=150&q=80';
    const direccion = cita.requiere_ruta ? (cita.direccion || 'Sin especificar') : 'No aplica (sin ruta)';

    return `
      <div class="cita-card">
        <div>
          <div class="cita-card__top">
            <img src="${imgUrl}" class="cita-card__avatar" alt="">
            <div>
              <div class="cita-card__name">${esc(mascota.nombre || 'Mascota')}</div>
              <div class="cita-card__breed">${esc(mascota.raza || '')}</div>
            </div>
            <span class="badge ${badgeClaseEstado(cita.estado)} cita-card__badge">${esc(cita.estado)}</span>
          </div>

          <p class="cita-card__line"><strong>Servicio:</strong> ${esc(cita.servicio)}</p>
          <p class="cita-card__line"><i class="ph ph-clock"></i> ${formatearFecha(cita.fecha_hora)}</p>
          ${cita.estilo_corte ? `<p class="cita-card__line"><i class="ph ph-scissors"></i> ${esc(cita.estilo_corte)}</p>` : ''}
          ${cita.especificaciones ? `<p class="cita-card__notes">"${esc(cita.especificaciones)}"</p>` : ''}

          <div class="cita-card__contacto">
            <p class="cita-card__line"><i class="ph ph-user"></i> <strong>Cliente:</strong> ${esc(cliente.nombre || 'Sin nombre')}</p>
            <p class="cita-card__line"><i class="ph ph-phone"></i> <strong>Teléfono:</strong> ${esc(cliente.telefono || 'No registrado')}</p>
            <p class="cita-card__line ${cita.requiere_ruta ? 'cita-card__route' : ''}"><i class="ph ph-map-pin"></i> <strong>Dirección:</strong> ${esc(direccion)}</p>
          </div>
        </div>

        <div class="cita-card__footer">${construirAccionesRapidas(cita)}</div>
      </div>`;
  }).join('');
}

contenedorCitas.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-accion]');
  if (btn) cambiarEstado(btn.dataset.id, btn.dataset.accion);
});

async function cambiarEstado(citaId, nuevoEstado) {
  if (nuevoEstado === 'Rechazada' &&
      !window.confirm('¿Rechazar esta cita? El cliente verá el estado "Rechazada".')) return;

  const { data, error } = await _supabase.from('citas').update({ estado: nuevoEstado }).eq('id', citaId).select();

  if (error) mostrarNotificacion(error.message, true);
  else if (!data || data.length === 0) mostrarNotificacion('No se pudo actualizar la cita (sin permiso).', true);
  else mostrarNotificacion(`Cita actualizada a: ${nuevoEstado}`);

  await cargarCitasAdmin();
}

$('btn-cargar-citas').addEventListener('click', cargarCitasAdmin);
filtroBuscar.addEventListener('input', aplicarFiltros);
filtroEstado.addEventListener('change', aplicarFiltros);

// ---------------------------------------------------------------------
// ARRANQUE: restaura la sesión de _supabase si ya existía y navega según el rol
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  await restaurarSesion();
  renderRuta();
});