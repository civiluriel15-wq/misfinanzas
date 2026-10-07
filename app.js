/* =========================================================
   app.js — Lógica de interfaz de "Mis Finanzas"
   Módulos internos:
     Util        : formato de moneda, fechas, DOM
     Presupuesto : cálculo de saldo a favor / en contra
     Vistas      : inicio, movimientos, listas, ajustes
     Mov         : hoja de alta/edición con foto de comprobante
     Export      : Excel (.xlsx) y copia de seguridad JSON
   ========================================================= */
'use strict';

/* ---------------- Util ---------------- */
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const soles = n => 'S/ ' + r2(n).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const mesDe = fechaISO => fechaISO.slice(0, 7);
function nombreMes(mes, corto = false) {
  const [y, m] = mes.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-PE', { month: corto ? 'short' : 'long', year: 'numeric' });
}
function sumarMes(mes, delta) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const diasDelMes = mes => { const [y, m] = mes.split('-').map(Number); return new Date(y, m, 0).getDate(); };
function fechaLarga(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
}
const fechaCorta = iso => iso.split('-').reverse().join('/');
function numero(valor) {
  const n = parseFloat(String(valor).replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}
let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), ms);
}
const ICONOS = [
  [/aliment|comida|restaur|almuerzo/i, '🍽'], [/mercado|compra|super/i, '🛒'], [/transp|pasaje|taxi/i, '🚌'],
  [/combust|gasol|petr/i, '⛽'], [/vivienda|alquiler|casa/i, '🏠'], [/servic|luz|agua|internet|tel/i, '💡'],
  [/salud|farmac|medic/i, '💊'], [/educa|curso|maestr/i, '🎓'], [/trabajo|obra|herram/i, '🛠'],
  [/ropa|vest/i, '👕'], [/entreten|ocio|cine/i, '🎉'], [/sueldo|salario|honorar/i, '💼'], [/venta/i, '🏷']
];
function icono(cat, tipo) {
  for (const [re, ic] of ICONOS) if (re.test(cat)) return ic;
  return tipo === 'ingreso' ? '💰' : '💸';
}

/* ---------------- Estado ---------------- */
const CATS_GASTO = ['Alimentación', 'Compras', 'Transporte', 'Combustible', 'Vivienda', 'Servicios (luz, agua, internet)',
  'Salud', 'Educación', 'Trabajo / Obra', 'Ropa', 'Entretenimiento', 'Otros'];
const CATS_ING = ['Sueldo', 'Honorarios', 'Ventas', 'Otros ingresos'];
const st = {
  mes: mesDe(hoyISO()),
  vista: 'inicio',
  movs: [], listas: [],
  pres: { base: 0, meses: {}, sumarIngresos: false },
  cats: { gasto: CATS_GASTO, ingreso: CATS_ING },
  listaActual: null,
  edit: null // {id, tipo, fotoBlob, fotoIdOriginal, quitarFoto, listaId}
};

async function cargar() {
  [st.movs, st.listas] = await Promise.all([DB.todos('movs'), DB.todos('listas')]);
  st.pres = Object.assign({ base: 0, meses: {}, sumarIngresos: false }, await DB.getConfig('presupuesto', {}));
  st.cats = Object.assign({ gasto: CATS_GASTO, ingreso: CATS_ING }, await DB.getConfig('categorias', {}));
}

/* ---------------- Presupuesto ---------------- */
function presupuestoDe(mes) {
  const v = st.pres.meses[mes];
  return Number.isFinite(v) ? v : (Number(st.pres.base) || 0);
}
function resumenMes(mes) {
  let ing = 0, gas = 0;
  const porCat = {};
  for (const m of st.movs) {
    if (mesDe(m.fecha) !== mes) continue;
    if (m.tipo === 'ingreso') ing += m.monto;
    else { gas += m.monto; porCat[m.categoria] = (porCat[m.categoria] || 0) + m.monto; }
  }
  const pres = presupuestoDe(mes);
  const disponible = pres + (st.pres.sumarIngresos ? ing : 0);
  return { mes, ing: r2(ing), gas: r2(gas), pres: r2(pres), disponible: r2(disponible), saldo: r2(disponible - gas), balance: r2(ing - gas), porCat };
}
function textoSaldo(s) {
  return s >= 0 ? `${soles(s)} a favor` : `${soles(-s)} en contra`;
}

/* ---------------- Navegación ---------------- */
function irA(vista) {
  st.vista = vista;
  $$('.vista').forEach(v => v.classList.toggle('on', v.id === 'v-' + vista));
  $$('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === vista || (vista === 'lista' && b.dataset.v === 'listas')));
  const conMes = ['inicio', 'movs', 'ajustes'].includes(vista);
  $('#mesSel').style.visibility = conMes ? 'visible' : 'hidden';
  $('#fab').style.display = ['inicio', 'movs'].includes(vista) ? '' : 'none';
  $('#titulo').textContent = { inicio: 'Mis Finanzas', movs: 'Movimientos', listas: 'Compras', lista: 'Lista', ajustes: 'Ajustes' }[vista];
  render();
  window.scrollTo(0, 0);
}
function render() {
  $('#mesTxt').textContent = cap(nombreMes(st.mes));
  if (st.vista === 'inicio') renderInicio();
  else if (st.vista === 'movs') renderMovs();
  else if (st.vista === 'listas') renderListas();
  else if (st.vista === 'lista') renderLista();
  else if (st.vista === 'ajustes') renderAjustes();
}

/* ---------------- Vista: Inicio ---------------- */
function renderInicio() {
  const r = resumenMes(st.mes);
  const sp = $('#saldoPres');
  const aviso = $('#avisoPres');
  aviso.innerHTML = '';

  if (r.disponible <= 0 && r.pres === 0) {
    sp.textContent = soles(-r.gas);
    sp.className = 'saldo ' + (r.gas > 0 ? 'contra' : '');
    $('#saldoPresTxt').textContent = 'Aún no defines un presupuesto para este mes.';
    $('#barraPres').style.width = '0';
    $('#barraTxt').textContent = '';
    aviso.innerHTML = '<button class="btn sec full" style="margin-top:10px" onclick="irA(\'ajustes\')">Definir presupuesto</button>';
  } else {
    sp.textContent = (r.saldo < 0 ? '− ' : '') + soles(Math.abs(r.saldo));
    sp.className = 'saldo ' + (r.saldo >= 0 ? 'favor' : 'contra');
    $('#saldoPresTxt').textContent = r.saldo >= 0 ? 'A favor: aún dentro del presupuesto' : 'En contra: presupuesto excedido';
    const pct = r.disponible > 0 ? (r.gas / r.disponible) * 100 : 100;
    const barra = $('#barraPres');
    barra.style.width = Math.min(pct, 100) + '%';
    barra.className = pct > 100 ? 'exceso' : pct >= 80 ? 'alerta' : '';
    $('#barraTxt').textContent = `Gastado ${soles(r.gas)} de ${soles(r.disponible)} (${pct.toFixed(0)} %)` +
      (st.pres.sumarIngresos ? ' · incluye ingresos' : '');

    // Proyección (solo mes en curso)
    const hoy = hoyISO();
    if (st.mes === mesDe(hoy) && r.gas > 0) {
      const dia = Number(hoy.slice(8, 10)), total = diasDelMes(st.mes);
      const proyectado = r2((r.gas / dia) * total);
      const cierre = r2(r.disponible - proyectado);
      aviso.innerHTML = cierre >= 0
        ? `<div class="aviso ok">✅ A este ritmo (${soles(r.gas / dia)}/día) cerrarías el mes con <b>${soles(cierre)} a favor</b>.</div>`
        : `<div class="aviso mal">⚠️ A este ritmo (${soles(r.gas / dia)}/día) cerrarías el mes con <b>${soles(-cierre)} en contra</b>. Reduce a ${soles(Math.max(r.saldo, 0) / (total - dia + 1))}/día.</div>`;
    } else if (st.mes < mesDe(hoy)) {
      aviso.innerHTML = `<div class="aviso ${r.saldo >= 0 ? 'ok' : 'mal'}">Mes cerrado con ${textoSaldo(r.saldo)}.</div>`;
    }
  }

  $('#kIng').textContent = soles(r.ing);
  $('#kGas').textContent = soles(r.gas);
  const kb = $('#kBal'); kb.textContent = soles(r.balance); kb.className = r.balance >= 0 ? 'favor' : 'contra';
  const hoy = hoyISO();
  if (st.mes === mesDe(hoy) && r.disponible > 0) {
    const restantes = diasDelMes(st.mes) - Number(hoy.slice(8, 10)) + 1;
    $('#kDia').textContent = r.saldo > 0 ? soles(r.saldo / restantes) : 'S/ 0.00';
  } else $('#kDia').textContent = '—';

  // Por categoría
  const cats = Object.entries(r.porCat).sort((a, b) => b[1] - a[1]);
  $('#porCat').innerHTML = cats.length ? cats.map(([c, v]) => `
    <div class="cat-row"><span>${icono(c)} ${esc(c)}</span><b>${soles(v)}</b></div>
    <div class="cat-bar"><i style="width:${(v / r.gas * 100).toFixed(1)}%"></i></div>`).join('')
    : '<div class="vacio">Sin gastos este mes.</div>';

  // Últimos
  const ult = movsDelMes().slice(0, 6);
  $('#ultimos').innerHTML = ult.length ? ult.map(htmlMov).join('') : '<div class="vacio">Toca <b>+</b> para registrar tu primer gasto o ingreso.</div>';
}

/* ---------------- Vista: Movimientos ---------------- */
function movsDelMes() {
  return st.movs.filter(m => mesDe(m.fecha) === st.mes)
    .sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
}
function htmlMov(m) {
  const signo = m.tipo === 'ingreso' ? '+' : '−';
  return `<li class="mov" data-id="${m.id}">
    <div class="ic">${icono(m.categoria, m.tipo)}</div>
    <div class="info"><b>${esc(m.desc || m.categoria)}</b>
      <span class="etq">${esc(m.categoria)} · ${fechaCorta(m.fecha)}</span>
      ${m.fotoId ? `<span class="clip" data-foto="${m.fotoId}"> · 📎 ver comprobante</span>` : ''}</div>
    <div class="monto ${m.tipo === 'ingreso' ? 'favor' : 'contra'}">${signo} ${soles(m.monto)}</div>
  </li>`;
}
function renderMovs() {
  const tipo = $('#filtroTipo').value;
  const q = $('#buscar').value.trim().toLowerCase();
  const lista = movsDelMes().filter(m => (!tipo || m.tipo === tipo) &&
    (!q || `${m.desc} ${m.categoria} ${m.monto}`.toLowerCase().includes(q)));
  if (!lista.length) { $('#listaMovs').innerHTML = '<div class="vacio">No hay movimientos.</div>'; return; }
  let html = '', diaPrevio = '';
  for (const m of lista) {
    if (m.fecha !== diaPrevio) {
      if (diaPrevio) html += '</ul>';
      html += `<div class="dia">${cap(fechaLarga(m.fecha))}</div><ul class="lista">`;
      diaPrevio = m.fecha;
    }
    html += htmlMov(m);
  }
  $('#listaMovs').innerHTML = html + '</ul>';
}

/* ---------------- Hoja de movimiento ---------------- */
function llenarCategorias(tipo, seleccion) {
  const cats = [...st.cats[tipo]];
  if (seleccion && !cats.includes(seleccion)) cats.push(seleccion);
  $('#fCat').innerHTML = cats.map(c => `<option ${c === seleccion ? 'selected' : ''}>${esc(c)}</option>`).join('');
}
function setTipo(tipo) {
  st.edit.tipo = tipo;
  $$('#hojaMov .seg button').forEach(b => b.classList.toggle('on', b.dataset.tipo === tipo));
  const actual = $('#fCat').value;
  llenarCategorias(tipo, st.cats[tipo].includes(actual) ? actual : st.cats[tipo][0]);
}
let urlPrev = null;
function mostrarPrev(blob) {
  if (urlPrev) URL.revokeObjectURL(urlPrev);
  urlPrev = blob ? URL.createObjectURL(blob) : null;
  $('#fotoPrev').style.display = blob ? 'block' : 'none';
  if (blob) $('#fotoPrevImg').src = urlPrev;
}
async function abrirHoja(mov, prefill = {}) {
  const base = mov || Object.assign({ tipo: 'gasto', monto: '', fecha: hoyISO(), categoria: '', desc: '', fotoId: null, listaId: null }, prefill);
  st.edit = { id: mov ? mov.id : null, tipo: base.tipo, fotoBlob: null, fotoIdOriginal: base.fotoId, quitarFoto: false, listaId: base.listaId };
  $('#hojaTitulo').textContent = mov ? 'Editar movimiento' : 'Nuevo movimiento';
  $$('#hojaMov .seg button').forEach(b => b.classList.toggle('on', b.dataset.tipo === base.tipo));
  llenarCategorias(base.tipo, base.categoria || st.cats[base.tipo][0]);
  $('#fMonto').value = base.monto === '' ? '' : r2(base.monto);
  $('#fFecha').value = base.fecha;
  $('#fDesc').value = base.desc || '';
  $('#btnBorrarMov').style.display = mov ? '' : 'none';
  mostrarPrev(null);
  if (base.fotoId) {
    const f = await DB.obtener('fotos', base.fotoId);
    if (f) mostrarPrev(f.blob);
  }
  $('#velo').classList.add('on'); $('#hojaMov').classList.add('on');
  if (!mov && base.monto === '') setTimeout(() => $('#fMonto').focus(), 250);
}
function cerrarHoja() {
  $('#velo').classList.remove('on'); $('#hojaMov').classList.remove('on');
  mostrarPrev(null); st.edit = null;
}

/** Reduce la foto a máx. 1600 px y JPEG 0.8 para no llenar la memoria del celular. */
function comprimirImagen(file, maxLado = 1600, calidad = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxLado / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo procesar la imagen')), 'image/jpeg', calidad);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Formato de imagen no soportado')); };
    img.src = url;
  });
}
async function alElegirFoto(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !st.edit) return;
  try {
    const blob = await comprimirImagen(file);
    st.edit.fotoBlob = blob; st.edit.quitarFoto = false;
    mostrarPrev(blob);
  } catch (err) { toast('⚠️ ' + err.message); }
}

async function guardarMov() {
  const e = st.edit;
  const monto = numero($('#fMonto').value);
  const fecha = $('#fFecha').value;
  if (!(monto > 0)) { toast('Ingresa un monto mayor a 0'); $('#fMonto').focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) { toast('Ingresa una fecha válida'); return; }

  const btn = $('#btnGuardarMov'); btn.disabled = true;
  try {
    let fotoId = e.fotoIdOriginal;
    if ((e.fotoBlob || e.quitarFoto) && e.fotoIdOriginal) { await DB.borrar('fotos', e.fotoIdOriginal); fotoId = null; }
    if (e.fotoBlob) { fotoId = DB.uid(); await DB.guardar('fotos', { id: fotoId, blob: e.fotoBlob }); }

    const previo = e.id ? st.movs.find(m => m.id === e.id) : null;
    const mov = {
      id: e.id || DB.uid(), tipo: e.tipo, monto: r2(monto), fecha,
      categoria: $('#fCat').value, desc: $('#fDesc').value.trim(),
      fotoId, listaId: e.listaId || null, creado: previo ? previo.creado : Date.now()
    };
    await DB.guardar('movs', mov);
    if (previo) Object.assign(previo, mov); else st.movs.push(mov);

    // Vincular con lista de compras
    if (mov.listaId) {
      const l = st.listas.find(x => x.id === mov.listaId);
      if (l) { l.cerrada = true; l.movId = mov.id; await DB.guardar('listas', l); }
    }
    cerrarHoja();
    render();
    const r = resumenMes(mesDe(fecha));
    if (mov.tipo === 'gasto' && (r.disponible > 0 || r.pres > 0)) {
      toast(`${r.saldo >= 0 ? '✅' : '⚠️'} Saldo del presupuesto (${nombreMes(r.mes, true)}): ${textoSaldo(r.saldo)}`, 4500);
    } else toast('Guardado ✔');
  } catch (err) {
    console.error(err); toast('⚠️ No se pudo guardar: ' + err.message);
  } finally { btn.disabled = false; }
}
async function borrarMov() {
  const e = st.edit;
  if (!e?.id || !confirm('¿Eliminar este movimiento y su foto?')) return;
  const m = st.movs.find(x => x.id === e.id);
  if (m?.fotoId) await DB.borrar('fotos', m.fotoId);
  await DB.borrar('movs', e.id);
  st.movs = st.movs.filter(x => x.id !== e.id);
  if (m?.listaId) {
    const l = st.listas.find(x => x.id === m.listaId);
    if (l) { l.cerrada = false; l.movId = null; await DB.guardar('listas', l); }
  }
  cerrarHoja(); render(); toast('Movimiento eliminado');
}

let urlVisor = null;
async function verFoto(fotoId) {
  const f = await DB.obtener('fotos', fotoId);
  if (!f) { toast('No se encontró la foto'); return; }
  if (urlVisor) URL.revokeObjectURL(urlVisor);
  urlVisor = URL.createObjectURL(f.blob);
  $('#visorImg').src = urlVisor;
  $('#visor').classList.add('on');
}

/* ---------------- Vista: Listas de compras ---------------- */
const totalesLista = l => {
  let est = 0, real = 0, hechos = 0;
  for (const it of l.items) {
    est += Number(it.precioEst) || 0;
    if (it.check) { hechos++; real += Number(it.precio) || 0; }
  }
  return { est: r2(est), real: r2(real), hechos, total: l.items.length };
};
function renderListas() {
  const ls = [...st.listas].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creado - a.creado);
  $('#listasCont').innerHTML = ls.length ? ls.map(l => {
    const t = totalesLista(l);
    return `<div class="card listaCard" data-lista="${l.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
        <b style="font-size:16px">🛒 ${esc(l.nombre)}</b>
        <span class="chip ${l.cerrada ? 'cerr' : ''}">${l.cerrada ? 'Registrada' : 'Pendiente'}</span>
      </div>
      <div class="etq" style="margin-top:4px">${fechaCorta(l.fecha)} · ${t.hechos}/${t.total} comprados · ${soles(t.real)}</div>
    </div>`;
  }).join('') : '<div class="vacio">Crea tu primera lista de compras arriba.</div>';
}
async function crearLista() {
  const nombre = $('#nuevaListaNom').value.trim() || `Compras ${fechaCorta(hoyISO())}`;
  const l = { id: DB.uid(), nombre, fecha: hoyISO(), items: [], cerrada: false, movId: null, creado: Date.now() };
  await DB.guardar('listas', l);
  st.listas.push(l);
  $('#nuevaListaNom').value = '';
  abrirLista(l.id);
}
function abrirLista(id) { st.listaActual = id; irA('lista'); }
const listaActual = () => st.listas.find(l => l.id === st.listaActual);

function renderLista() {
  const l = listaActual();
  if (!l) { irA('listas'); return; }
  $('#lstNombre').textContent = '🛒 ' + l.nombre;
  $('#lstInfo').textContent = `Creada el ${fechaCorta(l.fecha)}` + (l.cerrada ? ' · ya registrada como gasto' : '');
  $('#btnCerrarLista').textContent = l.cerrada ? '↻ Actualizar gasto registrado' : '✔ Registrar como gasto';
  $('#lstItems').innerHTML = l.items.length ? l.items.map(it => `
    <li class="item ${it.check ? 'hecho' : ''}" data-item="${it.id}">
      <input type="checkbox" ${it.check ? 'checked' : ''} aria-label="Comprado">
      <div class="nom"><b>${esc(it.nombre)}</b>
        <span class="etq">${it.cant ? 'Cant. ' + it.cant : ''}${it.cant && it.precioEst ? ' · ' : ''}${it.precioEst ? 'Est. ' + soles(it.precioEst) : ''}</span></div>
      <input class="precio" type="number" inputmode="decimal" min="0" step="0.01" placeholder="Precio"
        value="${it.precio !== null && it.precio !== '' && it.precio !== undefined ? r2(it.precio) : ''}">
      <button class="x" aria-label="Quitar">✕</button>
    </li>`).join('') : '<div class="vacio">Agrega productos a tu lista.</div>';
  actualizarTotalesLista();
}
function actualizarTotalesLista() {
  const l = listaActual(); if (!l) return;
  const t = totalesLista(l);
  $('#totEst').textContent = soles(t.est);
  $('#totReal').textContent = soles(t.real);
  $('#totCnt').textContent = `${t.hechos} / ${t.total}`;
}
async function guardarListaActual() { const l = listaActual(); if (l) await DB.guardar('listas', l); }

async function agregarItem() {
  const l = listaActual();
  const nombre = $('#itemNom').value.trim();
  if (!nombre) { $('#itemNom').focus(); return; }
  const cant = numero($('#itemCant').value), est = numero($('#itemEst').value);
  l.items.push({ id: DB.uid(), nombre, cant: cant > 0 ? cant : '', precioEst: est >= 0 ? r2(est) : '', precio: '', check: false });
  await guardarListaActual();
  $('#itemNom').value = ''; $('#itemCant').value = ''; $('#itemEst').value = '';
  renderLista(); $('#itemNom').focus();
}

async function registrarLista() {
  const l = listaActual();
  const t = totalesLista(l);
  if (t.hechos === 0) { toast('Marca con ✔ al menos un producto comprado'); return; }
  const sinPrecio = l.items.filter(i => i.check && !(Number(i.precio) > 0)).length;
  if (sinPrecio && !confirm(`${sinPrecio} producto(s) marcados no tienen precio. ¿Continuar igual?`)) return;
  const pendientes = t.total - t.hechos;
  if (pendientes && !confirm(`${pendientes} producto(s) sin comprar no se incluirán. ¿Continuar?`)) return;

  const existente = l.movId ? st.movs.find(m => m.id === l.movId) : null;
  if (existente) {
    await abrirHoja(existente);
    $('#fMonto').value = t.real; // actualiza al total real actual
  } else {
    await abrirHoja(null, { tipo: 'gasto', monto: t.real, fecha: hoyISO(), categoria: 'Compras', desc: 'Lista: ' + l.nombre, listaId: l.id });
  }
  toast('Puedes adjuntar la foto de la boleta antes de guardar', 3000);
}
async function borrarLista() {
  const l = listaActual();
  if (!confirm(`¿Eliminar la lista "${l.nombre}"?` + (l.movId ? '\n(El gasto ya registrado se conserva.)' : ''))) return;
  if (l.movId) {
    const m = st.movs.find(x => x.id === l.movId);
    if (m) { m.listaId = null; await DB.guardar('movs', m); }
  }
  await DB.borrar('listas', l.id);
  st.listas = st.listas.filter(x => x.id !== l.id);
  irA('listas'); toast('Lista eliminada');
}

/* ---------------- Vista: Ajustes ---------------- */
function renderAjustes() {
  $('#presBase').value = st.pres.base || '';
  const pm = st.pres.meses[st.mes];
  $('#presMes').value = Number.isFinite(pm) ? pm : '';
  $('#presMesTxt').textContent = nombreMes(st.mes);
  $('#sumarIngresos').checked = !!st.pres.sumarIngresos;
  $('#catsGasto').value = st.cats.gasto.join(', ');
  $('#catsIng').value = st.cats.ingreso.join(', ');
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(e => {
      $('#infoAlmac').textContent = `Espacio usado: ${(e.usage / 1048576).toFixed(1)} MB · ${st.movs.length} movimientos · ${st.listas.length} listas`;
    }).catch(() => {});
  }
}
async function guardarPresupuesto() {
  const base = numero($('#presBase').value);
  const mes = numero($('#presMes').value);
  if ($('#presBase').value !== '' && !(base >= 0)) { toast('Presupuesto no válido'); return; }
  st.pres.base = base >= 0 ? r2(base) : 0;
  if ($('#presMes').value === '') delete st.pres.meses[st.mes];
  else if (mes >= 0) st.pres.meses[st.mes] = r2(mes);
  st.pres.sumarIngresos = $('#sumarIngresos').checked;
  await DB.setConfig('presupuesto', st.pres);
  toast('Presupuesto guardado ✔');
}
async function guardarCategorias() {
  const parse = s => [...new Set(s.split(',').map(x => x.trim()).filter(Boolean))];
  const g = parse($('#catsGasto').value), i = parse($('#catsIng').value);
  if (!g.length || !i.length) { toast('Debe haber al menos una categoría de cada tipo'); return; }
  st.cats = { gasto: g, ingreso: i };
  await DB.setConfig('categorias', st.cats);
  toast('Categorías guardadas ✔');
}

/* ---------------- Exportación ---------------- */
const Export = (() => {
  // Serie de fecha Excel sin desfase de zona horaria
  const serial = iso => { const [y, m, d] = iso.split('-').map(Number); return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; };
  const F = iso => ({ t: 'n', v: serial(iso), z: 'dd/mm/yyyy' });
  const N = v => ({ t: 'n', v: r2(v), z: '#,##0.00' });
  const FORM = f => ({ t: 'n', f, z: '#,##0.00' });

  function hoja(aoa, anchos) {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = anchos.map(w => ({ wch: w }));
    return ws;
  }

  function hojaMovimientos(movs) {
    const lista = [...movs].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creado - b.creado);
    const aoa = [['Fecha', 'Tipo', 'Categoría', 'Descripción', 'Ingreso (S/)', 'Gasto (S/)', 'Saldo acumulado (S/)', 'Comprobante', 'Lista de compras']];
    lista.forEach((m, i) => {
      const fila = i + 2;
      const lst = m.listaId ? st.listas.find(l => l.id === m.listaId) : null;
      aoa.push([F(m.fecha), m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto', m.categoria, m.desc,
        m.tipo === 'ingreso' ? N(m.monto) : null, m.tipo === 'gasto' ? N(m.monto) : null,
        FORM(i === 0 ? `N(E${fila})-N(F${fila})` : `G${fila - 1}+N(E${fila})-N(F${fila})`),
        m.fotoId ? 'Sí (foto en app)' : 'No', lst ? lst.nombre : '']);
    });
    const n = lista.length + 1;
    aoa.push([]);
    aoa.push(['', '', '', 'TOTALES', FORM(`SUM(E2:E${n})`), FORM(`SUM(F2:F${n})`), FORM(`E${n + 2}-F${n + 2}`)]);
    return hoja(aoa, [12, 9, 22, 34, 13, 13, 18, 16, 22]);
  }

  function hojaResumen(meses) {
    const aoa = [['Mes', 'Presupuesto (S/)', 'Ingresos (S/)', 'Gastos (S/)', 'Saldo vs presupuesto (S/)', 'Situación', 'Balance ingresos − gastos (S/)']];
    meses.forEach((mes, i) => {
      const r = resumenMes(mes), f = i + 2;
      const saldoF = st.pres.sumarIngresos ? `B${f}+C${f}-D${f}` : `B${f}-D${f}`;
      aoa.push([nombreMes(mes), N(r.pres), N(r.ing), N(r.gas), FORM(saldoF),
        { t: 's', f: `IF(E${f}>=0,"A favor","En contra")`, v: r.saldo >= 0 ? 'A favor' : 'En contra' }, FORM(`C${f}-D${f}`)]);
    });
    return hoja(aoa, [18, 16, 14, 14, 22, 11, 26]);
  }

  function hojaListas(listas) {
    const aoa = [['Lista', 'Fecha de lista', 'Producto', 'Cantidad', 'Precio estimado (S/)', 'Precio real (S/)', 'Comprado', 'Fecha gasto registrado']];
    for (const l of [...listas].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
      const mov = l.movId ? st.movs.find(m => m.id === l.movId) : null;
      for (const it of l.items) {
        aoa.push([l.nombre, F(l.fecha), it.nombre, it.cant === '' ? null : Number(it.cant),
          it.precioEst === '' ? null : N(it.precioEst), it.check && it.precio !== '' ? N(it.precio) : null,
          it.check ? 'Sí' : 'No', mov ? F(mov.fecha) : '']);
      }
    }
    const n = aoa.length;
    aoa.push([]);
    aoa.push(['', '', 'TOTALES', '', FORM(`SUM(E2:E${n})`), FORM(`SUM(F2:F${n})`)]);
    return hoja(aoa, [24, 13, 26, 9, 18, 15, 10, 20]);
  }

  async function entregar(wb, nombre) {
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await entregarBlob(blob, nombre);
  }

  async function entregarBlob(blob, nombre) {
    const file = new File([blob], nombre, { type: blob.type });
    const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (esIOS && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: nombre }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Archivo descargado: ' + nombre);
  }

  return {
    async general(soloMes) {
      if (typeof XLSX === 'undefined') { toast('⚠️ No se cargó el módulo de Excel'); return; }
      const movs = soloMes ? st.movs.filter(m => mesDe(m.fecha) === st.mes) : st.movs;
      if (!movs.length && !st.listas.length) { toast('No hay datos para exportar'); return; }
      const meses = soloMes ? [st.mes] : [...new Set(st.movs.map(m => mesDe(m.fecha)))].sort();
      const listas = soloMes ? st.listas.filter(l => mesDe(l.fecha) === st.mes) : st.listas;
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, hojaMovimientos(movs), 'Movimientos');
      XLSX.utils.book_append_sheet(wb, hojaResumen(meses.length ? meses : [st.mes]), 'Resumen mensual');
      XLSX.utils.book_append_sheet(wb, hojaListas(listas), 'Listas de compras');
      await entregar(wb, `MisFinanzas_${soloMes ? st.mes : 'completo'}_${hoyISO()}.xlsx`);
    },
    async lista(l) {
      if (!l.items.length) { toast('La lista está vacía'); return; }
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, hojaListas([l]), 'Lista');
      const nom = l.nombre.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '').trim().replace(/\s+/g, '_') || 'lista';
      await entregar(wb, `Lista_${nom}_${l.fecha}.xlsx`);
    },
    entregarBlob
  };
})();

/* ---------------- Copia de seguridad ---------------- */
const blobADataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataURLABlob = async d => (await fetch(d)).blob();

async function crearBackup() {
  toast('Preparando copia…');
  const fotos = await DB.todos('fotos');
  const data = {
    app: 'MisFinanzas', version: 1, creado: new Date().toISOString(),
    movs: st.movs, listas: st.listas, presupuesto: st.pres, categorias: st.cats,
    fotos: await Promise.all(fotos.map(async f => ({ id: f.id, data: await blobADataURL(f.blob) })))
  };
  await Export.entregarBlob(new Blob([JSON.stringify(data)], { type: 'application/json' }), `MisFinanzas_respaldo_${hoyISO()}.json`);
}
async function restaurarBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'MisFinanzas' || !Array.isArray(data.movs)) throw new Error('El archivo no es una copia de Mis Finanzas');
    if (!confirm(`Se reemplazarán los datos actuales por la copia del ${new Date(data.creado).toLocaleString('es-PE')} (${data.movs.length} movimientos). ¿Continuar?`)) return;
    for (const s of ['movs', 'listas', 'fotos', 'config']) await DB.limpiar(s);
    for (const m of data.movs) await DB.guardar('movs', m);
    for (const l of data.listas || []) await DB.guardar('listas', l);
    for (const f of data.fotos || []) await DB.guardar('fotos', { id: f.id, blob: await dataURLABlob(f.data) });
    if (data.presupuesto) await DB.setConfig('presupuesto', data.presupuesto);
    if (data.categorias) await DB.setConfig('categorias', data.categorias);
    await cargar(); render(); toast('Copia restaurada ✔');
  } catch (err) { toast('⚠️ ' + err.message, 5000); }
}
async function borrarTodo() {
  if (!confirm('¿Borrar TODOS los movimientos, fotos, listas y ajustes? Esta acción no se puede deshacer.')) return;
  if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
  for (const s of ['movs', 'listas', 'fotos', 'config']) await DB.limpiar(s);
  await cargar(); irA('inicio'); toast('Datos borrados');
}

/* ---------------- Instalación (PWA) ---------------- */
let eventoInstalar = null;
function prepararInstalacion() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) return;
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); eventoInstalar = e;
    $('#cardInstalar').classList.add('on');
  });
  window.addEventListener('appinstalled', () => { $('#cardInstalar').classList.remove('on'); toast('App instalada ✔'); });
  if (esIOS) {
    $('#cardInstalar').classList.add('on');
    $('#btnInstalar').textContent = 'Cómo instalar en iPhone';
  }
  $('#btnInstalar').onclick = async () => {
    if (eventoInstalar) {
      eventoInstalar.prompt();
      await eventoInstalar.userChoice; eventoInstalar = null;
      $('#cardInstalar').classList.remove('on');
    } else if (esIOS) {
      alert('En Safari: toca el botón Compartir (□↑) y luego "Agregar a pantalla de inicio".');
    } else {
      alert('Abre el menú ⋮ de Chrome y elige "Instalar app" o "Agregar a pantalla principal".');
    }
  };
}

/* ---------------- Eventos ---------------- */
function enlazar() {
  $$('nav button').forEach(b => b.onclick = () => irA(b.dataset.v));
  $('#mesAnt').onclick = () => { st.mes = sumarMes(st.mes, -1); render(); };
  $('#mesSig').onclick = () => { st.mes = sumarMes(st.mes, 1); render(); };
  $('#fab').onclick = () => abrirHoja(null, st.mes !== mesDe(hoyISO()) ? { fecha: st.mes + '-01' } : {});

  // Clic en movimientos (inicio y lista): ver foto o editar
  const clicMov = async e => {
    const clip = e.target.closest('[data-foto]');
    if (clip) { e.stopPropagation(); verFoto(clip.dataset.foto); return; }
    const li = e.target.closest('.mov');
    if (li) abrirHoja(st.movs.find(m => m.id === li.dataset.id));
  };
  $('#ultimos').onclick = clicMov;
  $('#listaMovs').onclick = clicMov;
  $('#filtroTipo').onchange = renderMovs;
  $('#buscar').oninput = renderMovs;

  // Hoja
  $$('#hojaMov .seg button').forEach(b => b.onclick = () => setTipo(b.dataset.tipo));
  $('#velo').onclick = cerrarHoja;
  $('#btnCancelar').onclick = cerrarHoja;
  $('#btnGuardarMov').onclick = guardarMov;
  $('#btnBorrarMov').onclick = borrarMov;
  $('#btnCamara').onclick = () => $('#fileCamara').click();
  $('#btnGaleria').onclick = () => $('#fileGaleria').click();
  $('#fileCamara').onchange = alElegirFoto;
  $('#fileGaleria').onchange = alElegirFoto;
  $('#btnQuitarFoto').onclick = () => { st.edit.fotoBlob = null; st.edit.quitarFoto = true; mostrarPrev(null); };
  $('#fotoPrevImg').onclick = () => { $('#visorImg').src = $('#fotoPrevImg').src; $('#visor').classList.add('on'); };
  $('#visorCerrar').onclick = () => $('#visor').classList.remove('on');

  // Listas
  $('#btnNuevaLista').onclick = crearLista;
  $('#nuevaListaNom').onkeydown = e => { if (e.key === 'Enter') crearLista(); };
  $('#listasCont').onclick = e => { const c = e.target.closest('[data-lista]'); if (c) abrirLista(c.dataset.lista); };
  $('#btnVolverListas').onclick = () => irA('listas');
  $('#btnAddItem').onclick = agregarItem;
  ['#itemNom', '#itemCant', '#itemEst'].forEach(s => $(s).onkeydown = e => { if (e.key === 'Enter') agregarItem(); });
  $('#lstItems').addEventListener('change', async e => {
    const li = e.target.closest('[data-item]'); if (!li) return;
    const it = listaActual().items.find(i => i.id === li.dataset.item);
    if (e.target.type === 'checkbox') {
      it.check = e.target.checked;
      li.classList.toggle('hecho', it.check);
      const inp = li.querySelector('.precio');
      if (it.check && inp.value === '') {
        if (it.precioEst !== '' && it.precioEst > 0) { inp.value = it.precioEst; it.precio = it.precioEst; inp.select(); }
        inp.focus();
      }
    } else if (e.target.classList.contains('precio')) {
      const p = numero(e.target.value);
      it.precio = p >= 0 ? r2(p) : '';
      if (p > 0 && !it.check) { it.check = true; li.classList.add('hecho'); li.querySelector('[type=checkbox]').checked = true; }
    }
    await guardarListaActual(); actualizarTotalesLista();
  });
  $('#lstItems').addEventListener('click', async e => {
    if (!e.target.classList.contains('x')) return;
    const l = listaActual(), id = e.target.closest('[data-item]').dataset.item;
    l.items = l.items.filter(i => i.id !== id);
    await guardarListaActual(); renderLista();
  });
  $('#btnCerrarLista').onclick = registrarLista;
  $('#btnExpLista').onclick = () => Export.lista(listaActual());
  $('#btnBorrarLista').onclick = borrarLista;

  // Ajustes
  $('#btnGuardarPres').onclick = guardarPresupuesto;
  $('#btnGuardarCats').onclick = guardarCategorias;
  $('#btnExpMes').onclick = () => Export.general(true);
  $('#btnExpTodo').onclick = () => Export.general(false);
  $('#btnBackup').onclick = crearBackup;
  $('#btnRestaurar').onclick = () => $('#fileRestaurar').click();
  $('#fileRestaurar').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) restaurarBackup(f); };
  $('#btnBorrarTodo').onclick = borrarTodo;

  // Botón atrás de Android cierra la hoja / visor
  window.addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarHoja(); $('#visor').classList.remove('on'); } });
}

/* ---------------- Arranque ---------------- */
(async function iniciar() {
  try {
    await DB.abrir();
    await cargar();
    enlazar();
    prepararInstalacion();
    irA('inicio');
    if (new URLSearchParams(location.search).has('nuevo')) abrirHoja(null);
    // Pide al navegador que no borre los datos por falta de espacio
    if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW:', err));
    }
  } catch (err) {
    console.error(err);
    document.body.innerHTML = `<p style="padding:20px">No se pudo iniciar la app: ${esc(err.message)}</p>`;
  }
})();
