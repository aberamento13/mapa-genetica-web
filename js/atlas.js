/* ADN antiguo — prototipo 0.3
   Datos: data/atlas-data.js (window.ATLAS_DATA), sin fetch: funciona también con file://.
   Zonas: envolventes de sitios publicados. Rutas: esquemas publicados.
   No se modifica el atlas histórico. */

(() => {
  'use strict';

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const escapar = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const normalizar = (s) => String(s == null ? '' : s)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const numero = new Intl.NumberFormat('es-AR');

  const EDAD_MAX = 4000000; // 4 millones de años: australopitecos
  const HITOS = [
    { year: -4000000, texto: '4 M' },
    { year: -2000000, texto: '2 M' },
    { year: -1000000, texto: '1 M' },
    { year: -300000, texto: '300 mil' },
    { year: -45000, texto: '45 mil' },
    { year: -10000, texto: '10 mil' },
    { year: 0, texto: 'hoy' }
  ];

  /* El slider es logarítmico: 0 = hoy, 1000 = 4 M AP. Así 4 millones de años
     conviven con los últimos 45 mil sin aplastarlos. */
  function sliderToYear(p) {
    const edad = Math.pow(10, (p / 1000) * Math.log10(EDAD_MAX + 1)) - 1;
    return -Math.round(edad);
  }
  function yearToSlider(year) {
    const edad = Math.max(0, -year);
    return Math.round(1000 * Math.log10(edad + 1) / Math.log10(EDAD_MAX + 1));
  }

  // Capas del halo de difusión: anillos concéntricos para que el degradado
  // sea suave y la expansión se vea continua, no un corte.
  const HALOS = [
    { w: 5, o: 1 },
    { w: 11, o: 0.66 },
    { w: 20, o: 0.4 },
    { w: 34, o: 0.2 }
  ];

  // Anclas de las tarjetas: se separan de las zonas para que no se pisen
  // entre sí en la vista mundial. La línea guía une la tarjeta con la zona.
  const ANCLAS_TARJETA = {
    africa: [0, 20],
    europa: [62, -4],
    siberia: [64, 88],
    asia_oriental: [50, 112],
    norteamerica: [44, -70],
    mesoamerica: [12, -70],
    brasil: [-2, -32],
    andes: [-12, -96],
    cono_sur: [-30, -25]
  };

  const SVG_SILUETA = (clase) => `<svg class="${clase}" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M32 6.6c-7.3 0-12.4 5.9-12.4 14.3 0 6 2.9 10.8 6.8 13.6C16.7 38.3 9.9 46.8 8.5 57.4h47c-1.4-10.6-8.2-19.1-17.9-22.9 3.9-2.8 6.8-7.6 6.8-13.6C44.4 12.5 39.3 6.6 32 6.6z"/></svg>`;

  const estado = {
    datos: null,
    sitios: [],
    zonas: [],
    rutas: [],
    zonaPorId: Object.create(null),
    sitioPorId: Object.create(null),
    rutaPorId: Object.create(null),
    continente: 'todos',
    filtro: '',
    year: 0,
    zonaSel: null,
    sitioSel: null,
    rutaSel: null,
    mapa: null,
    capasBase: null,
    vista: 'satelite',
    capaZonas: null,
    capaRutas: null,
    capaTarjetas: null,
    capaSitio: null,
    tarjetas: new Map(),
    items: new Map(),
    rutaItems: new Map(),
    foco: null,
    play: null,
    raf: null,
    rutasOn: true
  };

  function iniciar() {
    if (!window.ATLAS_DATA) {
      mostrarError('Faltan los datos locales. Asegurate de que exista <code>data/atlas-data.js</code> y abrí <code>index.html</code> desde la carpeta del proyecto.');
      return;
    }
    if (typeof L === 'undefined') {
      mostrarError('Leaflet no está disponible. Revisá la conexión al CDN o usá una copia local de Leaflet.');
      return;
    }
    try {
      prepararDatos();
      crearMapa();
      crearFiltros();
      crearHitos();
      crearRutasLista();
      crearLeyenda();
      renderLista();
      pintarFuentes();
      pintarCreditos();
      conectarEventos();
      actualizar(0, true);
      detalleVacio();
      const cargando = $('#cargando');
      if (cargando) cargando.remove();
    } catch (e) {
      console.error(e);
      mostrarError('No se pudo iniciar el atlas. Abrí la consola para ver el detalle.');
    }
  }

  function mostrarError(html) {
    const c = $('#cargando');
    if (!c) return;
    c.classList.add('error');
    c.innerHTML = html;
  }

  function prepararDatos() {
    const datos = window.ATLAS_DATA;
    const regiones = window.ATLAS_REGIONES || { unidades: [], anclas: {} };
    estado.datos = datos;
    estado.regiones = regiones;
    estado.zonas = (datos.zonas || []).map((z) => ({ ...z, _sitios: [] }));
    estado.sitios = (datos.sitios || []).map((s) => ({ ...s }));
    estado.rutas = (datos.rutas || []).map((r) => ({ ...r }));

    estado.zonas.forEach((z) => { estado.zonaPorId[z.id] = z; });
    estado.sitios.forEach((s) => { estado.sitioPorId[s.id] = s; });
    estado.rutas.forEach((r) => { estado.rutaPorId[r.id] = r; });

    estado.zonas.forEach((z) => {
      z._sitios = (z.sitios || [])
        .map((id) => estado.sitioPorId[id])
        .filter(Boolean);
      z.edad_max = Math.max(...z._sitios.map((s) => s.edad_ap));
      z.edad_min = Math.min(...z._sitios.map((s) => s.edad_ap));
      z._paises = [...new Set(z._sitios.map((s) => s.pais))];
      z._centro = centro(z._sitios.map((s) => [s.lat, s.lon]));
      z._bounds = L.latLngBounds(z._sitios.map((s) => [s.lat, s.lon]));
      z._geometria = geometriaZona(z);
      z._unidades = (regiones.unidades || []).filter((u) => u.zona === z.id);
      z._regiones = (regiones.zonas && regiones.zonas[z.id] && regiones.zonas[z.id].regiones) || [];
      z._labelAnchor = (regiones.anclas && regiones.anclas[z.id]) || null;
      z._cardAnchor = (regiones.anclas && regiones.anclas[z.id])
        || ANCLAS_TARJETA[z.id]
        || z.etiqueta
        || z._centro;
    });

    estado.sitios.sort((a, b) => b.edad_ap - a.edad_ap);
  }

  function centro(puntos) {
    if (!puntos.length) return [0, 0];
    const lat = puntos.reduce((a, p) => a + p[0], 0) / puntos.length;
    const lon = puntos.reduce((a, p) => a + p[1], 0) / puntos.length;
    return [lat, lon];
  }

  function distanciaKm(a, b) {
    const R = 6371;
    const dLat = (b[0] - a[0]) * Math.PI / 180;
    const dLon = (b[1] - a[1]) * Math.PI / 180;
    const la1 = a[0] * Math.PI / 180;
    const la2 = b[0] * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function geometriaZona(z) {
    const puntos = z._sitios.map((s) => [s.lat, s.lon]);
    if (puntos.length < 3) {
      const c = centro(puntos);
      const max = Math.max(0, ...puntos.map((p) => distanciaKm(c, p)));
      return {
        tipo: 'circulo',
        centro: c,
        radioKm: clamp(max * 1.2 + 180, 450, 1500)
      };
    }
    const radio = z.id === 'europa' ? 380 : 320;
    return { tipo: 'poligono', puntos: bufferHull(puntos, radio) };
  }

  /* Hull dilatado: circunferencia alrededor de cada sitio y convex hull del
     conjunto. Es el "buffer" real del área de muestreo (no un simple escalado). */
  function bufferHull(puntos, radioKm) {
    const muestra = [];
    puntos.forEach(([lat, lon]) => {
      const cosLat = Math.abs(Math.cos(lat * Math.PI / 180)) < 0.01 ? 0.01 : Math.cos(lat * Math.PI / 180);
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        muestra.push([
          lat + (radioKm / 111.32) * Math.cos(a),
          lon + (radioKm / (111.32 * cosLat)) * Math.sin(a)
        ]);
      }
    });
    return convexHull(muestra);
  }

  function convexHull(points) {
    if (points.length <= 1) return points.slice();
    const pts = points
      .slice()
      .sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]));
    const cross = (o, a, b) => (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1]);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i -= 1) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }


  function crearMapa() {
    const mapa = L.map('mapa', {
      zoomControl: false,
      minZoom: 0.5,
      maxZoom: 8,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      worldCopyJump: true
    }).setView([18, -30], 2.1);

    estado.mapa = mapa;
    L.control.zoom({ position: 'bottomright' }).addTo(mapa);

    estado.capasBase = {
      satelite: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles © Esri — Esri, Maxar, Earthstar Geographics · Datos: estudios citados',
          maxZoom: 18
        }
      ),
      oscura: L.tileLayer(
        'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        {
          attribution: 'Tiles © Esri — Esri, DeLorme, NAVTEQ · Datos: estudios citados',
          maxZoom: 18
        }
      )
    };
    estado.capasBase.satelite.addTo(mapa);
    document.body.dataset.vista = estado.vista;
    const btnVista = $('#btn-vista');
    if (btnVista) btnVista.textContent = 'Vista oscura';

    estado.capaZonas = L.layerGroup().addTo(mapa);
    estado.capaRutas = L.layerGroup().addTo(mapa);
    estado.capaTarjetas = L.layerGroup().addTo(mapa);
    estado.capaSitio = L.layerGroup().addTo(mapa);

    estado.zonas.forEach((z) => {
      crearCapaZona(z);
      crearEtiqueta(z);
    });
    ajustarTamanoEtiquetas();
    estado.rutas.forEach(crearCapaRuta);

    const bounds = L.latLngBounds(estado.sitios.map((s) => [s.lat, s.lon]));
    if (bounds.isValid()) {
      mapa.fitBounds(bounds, { padding: [70, 70], maxZoom: 3.2, animate: false });
    }
    mapa.on('zoomend', actualizarTarjetas);
    const marcarZoom = () => {
      const z = Math.round(mapa.getZoom() * 10) / 10;
      document.body.dataset.zoom = String(z);
      document.body.classList.toggle('zoom-cerca', mapa.getZoom() >= 2.4);
    };
    mapa.on('zoomend', marcarZoom);
    marcarZoom();
  }

  function cambiarVista() {
    if (!estado.capasBase || !estado.mapa) return;
    estado.vista = estado.vista === 'satelite' ? 'oscura' : 'satelite';
    const { satelite, oscura } = estado.capasBase;
    const mapa = estado.mapa;
    if (estado.vista === 'satelite') {
      if (mapa.hasLayer(oscura)) mapa.removeLayer(oscura);
      if (!mapa.hasLayer(satelite)) satelite.addTo(mapa);
    } else {
      if (mapa.hasLayer(satelite)) mapa.removeLayer(satelite);
      if (!mapa.hasLayer(oscura)) oscura.addTo(mapa);
    }
    document.body.dataset.vista = estado.vista;
    const btn = $('#btn-vista');
    if (btn) btn.textContent = estado.vista === 'satelite' ? 'Vista oscura' : 'Vista satélite';
    repintarVista();
  }

  function repintarVista() {
    estado.zonas.forEach((z) => {
      if (z._card) {
        const el = z._card.getElement();
        const inner = el && el.querySelector('.zona-label');
        if (inner) inner.style.setProperty('--c', colorZona(z));
      }
    });
    estado.rutas.forEach((r) => {
      if (r._line) r._line.setStyle({ color: colorRuta(r) });
      if (r._arrow) {
        const el = r._arrow.getElement();
        const span = el && el.querySelector('.ruta-flecha');
        if (span) span.style.setProperty('--c', colorRuta(r));
      }
      const chip = estado.rutaItems.get(r.id);
      if (chip) chip.style.setProperty('--c', colorRuta(r));
    });
    actualizarRutas();
    actualizarEstiloSeleccion();
    renderLista();
    if (estado.sitioSel) {
      const s = estado.sitioPorId[estado.sitioSel];
      if (s) renderDetalleSitio(s, estado.zonaPorId[s.zona]);
    } else if (estado.zonaSel) {
      renderDetalleZona(estado.zonaPorId[estado.zonaSel]);
    } else if (estado.rutaSel && estado.rutaPorId[estado.rutaSel]) {
      renderDetalleRuta(estado.rutaPorId[estado.rutaSel]);
    }
  }

  function opacidadZona() {
    return estado.vista === 'satelite' ? .72 : .76;
  }

  /* Paleta: en modo oscuro se usan los tonos suaves de la ficha;
     en satélite se saturan para que las áreas se lean sobre la imagen. */
  function colorZona(z) {
    return estado.vista === 'satelite' ? versionSatelite(z.color, .62, .44) : z.color;
  }

  function colorBorde(z) {
    if (estado.vista !== 'satelite') return z.color;
    return versionSatelite(z.color, .68, .30);
  }

  function colorRuta(r) {
    return estado.vista === 'satelite' ? versionSatelite(r.color, .72, .42) : r.color;
  }

  function versionSatelite(hex, satMin, luzMin) {
    const c = hexToHsl(hex);
    const s = Math.min(1, Math.max(c.s, satMin));
    const l = Math.min(.54, Math.max(c.l, luzMin));
    return hslToHex(c.h, s, l);
  }

  function hexToHsl(hex) {
    let h = String(hex || '#888').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let hh = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > .5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) hh = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) hh = (b - r) / d + 2;
      else hh = (r - g) / d + 4;
      hh *= 60;
    }
    return { h: hh, s, l };
  }

  function hslToHex(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let rgb = [0, 0, 0];
    if (h < 60) rgb = [c, x, 0];
    else if (h < 120) rgb = [x, c, 0];
    else if (h < 180) rgb = [0, c, x];
    else if (h < 240) rgb = [0, x, c];
    else if (h < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return '#' + rgb.map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
  }

  function crearCapaZona(z) {
    if (z._regiones && z._regiones.length) {
      crearCapasRegiones(z);
      return;
    }
    const base = {
      color: colorZona(z),
      weight: 2,
      opacity: .95,
      ...(z.moderno ? { dashArray: '7 7' } : {}),
      fillColor: colorZona(z),
      fillOpacity: opacidadZona(),
      lineJoin: 'round',
      interactive: true,
      className: 'zona-layer'
    };
    const casingBase = {
      color: '#05070a',
      weight: 5,
      opacity: .35,
      fill: false,
      lineJoin: 'round',
      interactive: false,
      className: 'zona-casing'
    };
    const g = z._geometria;
    const casing = g.tipo === 'poligono'
      ? L.polygon(g.puntos, casingBase)
      : L.circle(g.centro, { ...casingBase, radius: g.radioKm * 1000 });
    const layer = g.tipo === 'poligono'
      ? L.polygon(g.puntos, base)
      : L.circle(g.centro, { ...base, radius: g.radioKm * 1000 });

    layer.bindTooltip(tooltipZona(z), { sticky: true, direction: 'top', maxWidth: 270 });
    layer.on('click', () => seleccionarZona(z.id, false));
    layer.on('mouseover', () => {
      if (estado.zonaSel !== z.id) {
        layer.setStyle({ fillOpacity: Math.min(opacidadZona() + .18, .92), weight: 2.6, opacity: 1 });
      }
    });
    layer.on('mouseout', () => actualizarEstiloSeleccion());
    z._casing = casing;
    z._layer = layer;
    z._layerBounds = g.tipo === 'poligono'
      ? L.latLngBounds(g.puntos)
      : L.latLng(g.centro).toBounds(g.radioKm * 2000);
  }

  /* Zonas dibujadas sobre regiones naturales reales (Natural Earth):
     cordilleras, mesetas, llanuras, cuencas, valles. El contorno sigue la
     forma del terreno y, como son tierra firme, nunca se pinta sobre el agua. */
  function crearCapasRegiones(z) {
    if (!z._regiones || !z._regiones.length) return;
    z._capas = z._regiones.map((r) => {
      const anillos = r.rings;
      const halos = HALOS.map((cfg) => L.polyline(anillos, {
        color: colorZona(z),
        weight: cfg.w,
        opacity: 0,
        fill: false,
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
        className: 'zona-halo',
        noClip: true
      }));
      const poly = L.polyline(anillos, {
        color: colorBorde(z),
        weight: 1.1,
        opacity: 0,
        ...(z.moderno ? { dashArray: '7 7' } : {}),
        fill: true,
        fillColor: colorZona(z),
        fillOpacity: 0,
        fillRule: 'nonzero',
        lineJoin: 'round',
        interactive: true,
        className: 'zona-layer',
        noClip: true
      });
      poly.bindTooltip(tooltipRegion(z, r), { sticky: true, direction: 'top', maxWidth: 270 });
      poly.on('click', () => seleccionarZona(z.id, false));
      return {
        r,
        halos,
        poly,
        fill: 0,
        haloOp: 0,
        pesos: HALOS.map((cfg) => cfg.w),
        activo: false
      };
    });
    z._layers = z._capas.map((c) => c.poly);
    z._halos = z._capas.flatMap((c) => c.halos);
    z._layer = z._layers[0];
    z._layerBounds = L.latLngBounds(
      z._capas.flatMap((c) => c.r.rings.map((p) => [p[0], p[1]]))
    );
  }

  function tooltipZona(z) {
    return `<span class="tooltip-titulo">${escapar(z.nombre)}</span>
      <span class="tooltip-meta">${escapar(periodoZona(z))} · ${z._sitios.length} sitios</span>
      <span class="tooltip-texto">${escapar(z.descripcion || '')}</span>`;
  }

  function tooltipRegion(z, r) {
    const sitios = (r.sitios || [])
      .map((id) => estado.sitioPorId[id])
      .filter(Boolean)
      .map((s) => s.nombre);
    const linea = sitios.length ? sitios.join(', ') : 'región natural';
    return `<span class="tooltip-titulo">${escapar(r.nombre)}</span>
      <span class="tooltip-meta">${escapar(linea)}</span>
      <span class="tooltip-texto">${escapar(z.nombre)} · ${escapar(periodoZona(z))}</span>`;
  }


  /* El círculo del retrato debe caber dentro del territorio: se achica por
     zona cuando el territorio es chico. No importa que quede chico. */
  function distPuntoSegmento(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const wx = p.x - a.x, wy = p.y - a.y;
    const c = vx * vx + vy * vy;
    let tt = c ? (wx * vx + wy * vy) / c : 0;
    tt = Math.max(0, Math.min(1, tt));
    const dx = wx - tt * vx, dy = wy - tt * vy;
    return Math.hypot(dx, dy);
  }

  function anillosZonaPx(z, zoom) {
    const norm = (p) => {
      const a = Array.isArray(p) ? p : [p.lat, p.lng];
      const ll = Math.abs(a[0]) > 90 ? L.latLng(a[1], a[0]) : L.latLng(a[0], a[1]);
      return estado.mapa.project(ll, zoom);
    };
    const anillos = [];
    const pushAnillo = (ring) => { if (ring && ring.length > 2) anillos.push(ring.map(norm)); };
    if (z._regiones && z._regiones.length) {
      z._regiones.forEach((r) => {
        const rings = r.rings;
        if (!rings || !rings.length) return;
        if (Array.isArray(rings[0]) && rings[0].length && Array.isArray(rings[0][0])) rings.forEach(pushAnillo);
        else pushAnillo(rings);
      });
      return anillos;
    }
    const g = z._geometria;
    if (g && g.tipo === 'poligono' && g.puntos) pushAnillo(g.puntos);
    return anillos;
  }

  function diametroEtiqueta(z) {
    const zoom = estado.mapa.getZoom();
    const movil = window.matchMedia('(max-width: 860px)').matches;
    const base = zoom < 2 ? 34 : zoom < 2.4 ? 40 : movil ? 36 : 48;
    const anchor = z._labelAnchor || z._cardAnchor || z._centro;
    if (!anchor || !mapa) return base;
    let encaje = Infinity;
    const g = z._geometria;
    if (g && g.tipo !== 'poligono' && g.centro && g.radioKm) {
      const c = estado.mapa.project(L.latLng(g.centro[0], g.centro[1]), zoom);
      const borde = estado.mapa.project(L.latLng(g.centro[0], g.centro[1] + g.radioKm / 111.32), zoom);
      encaje = Math.abs(borde.x - c.x) * 2 * 0.92;
    } else {
      const anillos = anillosZonaPx(z, zoom);
      if (!anillos.length) return base;
      const pa = estado.mapa.project(L.latLng(anchor[0], anchor[1]), zoom);
      let minD = Infinity;
      anillos.forEach((ring) => {
        for (let i = 0; i < ring.length; i++) {
          minD = Math.min(minD, distPuntoSegmento(pa, ring[i], ring[(i + 1) % ring.length]));
        }
      });
      if (!isFinite(minD)) return base;
      encaje = minD * 2 * 0.92;
    }
    return Math.max(14, Math.min(base, Math.round(encaje)));
  }

  function ajustarTamanoEtiquetas() {
    if (!estado.mapa) return;
    const zoom = estado.mapa.getZoom();
    const movil = window.matchMedia('(max-width: 860px)').matches;
    const base = zoom < 2 ? 34 : zoom < 2.4 ? 40 : movil ? 36 : 48;
    estado.zonas.forEach((z) => {
      const card = z._card;
      if (!card) return;
      const el = card.getElement();
      if (!el) return;
      const foto = el.querySelector('.zona-label-foto');
      if (!foto) return;
      const d = diametroEtiqueta(z);
      const svg = foto.querySelector('.silueta-svg');
      if (d >= base) {
        foto.style.width = ''; foto.style.height = '';
        if (svg) { svg.style.width = ''; svg.style.height = ''; }
      } else {
        foto.style.width = d + 'px'; foto.style.height = d + 'px';
        if (svg) { svg.style.width = Math.round(d * 0.66) + 'px'; svg.style.height = Math.round(d * 0.66) + 'px'; }
      }
    });
  }

  /* Rotulo del mapa: solo el retrato y el nombre de la poblacion, sin recuadro,
     situado dentro del territorio que ocupa. */
  function crearEtiqueta(z) {
    const retrato = z.retrato || {};
    const nombre = z.poblacion || z.nombre;
    const foto = retrato.src
      ? `<img src="${escapar(retrato.src)}" alt="${escapar(retrato.alt || nombre)}" loading="lazy">`
      : SVG_SILUETA('silueta-svg');
    const html = `<div class="zona-label${z.moderno ? ' moderno' : ''}" style="--c:${escapar(colorZona(z))}">
      <span class="zona-label-foto${retrato.src ? '' : ' silueta'}">${foto}</span>
      <span class="zona-label-nombre">${escapar(nombre)}</span>
    </div>`;
    const icon = L.divIcon({
      className: 'zona-label-wrap',
      html,
      iconSize: [112, 76],
      iconAnchor: [56, 38]
    });
    const marker = L.marker(z._labelAnchor || z._cardAnchor || z._centro, {
      icon,
      keyboard: true,
      riseOnHover: true,
      zIndexOffset: 500,
      title: `${nombre} · ${z._sitios.length} sitios`
    });
    marker.on('click', () => seleccionarZona(z.id, false));
    marker.on('add', () => {
      const el = marker.getElement();
      if (!el) return;
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      el.setAttribute('aria-label', `${nombre}: ${z._sitios.length} sitios`);
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          seleccionarZona(z.id, false);
        }
      });
    });
    z._card = marker;
    estado.tarjetas.set(z.id, marker);
  }

  function crearCapaRuta(r) {
    const casing = L.polyline(r.puntos, {
      color: '#05070a',
      weight: 4.2,
      opacity: .4,
      lineCap: 'round',
      lineJoin: 'round',
      interactive: false,
      className: 'ruta-casing'
    });
    const line = L.polyline(r.puntos, {
      color: colorRuta(r),
      weight: 1.8,
      opacity: .55,
      dashArray: '7 9',
      lineCap: 'round',
      lineJoin: 'round',
      interactive: true,
      className: 'ruta-linea'
    });
    line.bindTooltip(tooltipRuta(r), { sticky: true, direction: 'top', maxWidth: 300 });
    line.on('click', () => seleccionarRuta(r.id, false));
    r._casing = casing;
    r._line = line;
    r._activo = false;
    estado.capaRutas.addLayer(casing);
    estado.capaRutas.addLayer(line);

    const arrow = crearFlecha(r);
    r._arrow = arrow;
    if (arrow) estado.capaRutas.addLayer(arrow);
  }

  function tooltipRuta(r) {
    return `<span class="tooltip-titulo">${escapar(r.nombre)}</span>
      <span class="tooltip-meta">${escapar(rangoRuta(r))} · ruta esquemática</span>
      <span class="tooltip-texto">${escapar(r.nota || '')}</span>`;
  }

  function crearFlecha(r) {
    if (!r.puntos || r.puntos.length < 2) return null;
    const a = r.puntos[r.puntos.length - 2];
    const b = r.puntos[r.puntos.length - 1];
    const latMedia = (a[0] + b[0]) / 2 * Math.PI / 180;
    const dy = b[0] - a[0];
    const dx = (b[1] - a[1]) * Math.cos(latMedia);
    const angulo = Math.atan2(dx, dy) * 180 / Math.PI;
    const html = `<span class="ruta-flecha" style="--c:${escapar(colorRuta(r))};transform:rotate(${angulo.toFixed(1)}deg)"></span>`;
    return L.marker(b, {
      icon: L.divIcon({
        className: 'ruta-flecha-wrap',
        html,
        iconSize: [12, 12],
        iconAnchor: [6, 6]
      }),
      interactive: false,
      keyboard: false
    });
  }

  function crearFiltros() {
    const cont = $('#filtros');
    if (!cont) return;
    cont.innerHTML = '';
    const opciones = [{ id: 'todos', nombre: 'Todos' }, ...(estado.datos.continentes || [])];
    opciones.forEach((o) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'filtro' + (o.id === estado.continente ? ' activo' : '');
      b.dataset.continente = o.id;
      b.textContent = o.nombre;
      b.setAttribute('aria-pressed', o.id === estado.continente ? 'true' : 'false');
      cont.appendChild(b);
    });
    cont.addEventListener('click', (e) => {
      const b = e.target.closest('.filtro');
      if (!b) return;
      estado.continente = b.dataset.continente;
      actualizarFiltrosUI();
      const z = estado.zonaSel ? estado.zonaPorId[estado.zonaSel] : null;
      if (z && !zonaPasaFiltro(z)) {
        limpiarSeleccion();
        detalleVacio();
      }
      renderLista();
      actualizar(estado.year, true);
    });
  }

  function actualizarFiltrosUI() {
    $$('.filtro').forEach((b) => {
      const on = b.dataset.continente === estado.continente;
      b.classList.toggle('activo', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function crearHitos() {
    const cont = $('#hitos');
    if (!cont) return;
    cont.innerHTML = '';
    HITOS.forEach((h) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hito';
      b.dataset.year = String(h.year);
      b.textContent = h.texto;
      b.addEventListener('click', () => {
        pausar();
        actualizar(h.year, true);
      });
      cont.appendChild(b);
    });
  }

  function crearRutasLista() {
    const cont = $('#rutas-lista');
    if (!cont) return;
    cont.innerHTML = '';
    estado.rutas.forEach((r) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ruta-chip';
      b.dataset.ruta = r.id;
      b.style.setProperty('--c', colorRuta(r));
      b.title = `${r.nota || r.nombre} ${r.cita || ''}`.trim();
      b.innerHTML = `<i aria-hidden="true"></i><span>${escapar(r.nombre)}</span><span class="ruta-chip-fecha">${escapar(rangoRuta(r))}</span>`;
      b.addEventListener('click', () => seleccionarRuta(r.id, true));
      cont.appendChild(b);
      estado.rutaItems.set(r.id, b);
    });
  }

  function crearLeyenda() {
    const cont = $('#leyenda');
    if (!cont) return;
    cont.innerHTML = `<div class="rotulo">Leyenda</div>
      <div class="leyenda-item"><span class="leyenda-swatch"></span>Región natural con evidencia</div>
      <div class="leyenda-item"><span class="leyenda-halo"></span>Difusión posible (halo)</div>
      <div class="leyenda-item"><span class="leyenda-linea"></span>Ruta publicada</div>
      <div class="leyenda-item"><span class="leyenda-retrato">◐</span>Retrato de individuo</div>
      <div class="leyenda-item"><span class="leyenda-moderno"></span>Población actual (ADN moderno)</div>
      <p class="leyenda-nota">Las áreas son regiones naturales (cordilleras, mesetas, llanuras, cuencas) donde hay sitios publicados: siguen el terreno y nunca el agua. El color marca dónde hay ADN antiguo, no dónde hubo gente.</p>`;
  }

  function mil(n) {
    if (n >= 1000) {
      const v = n / 1000;
      return `${Number.isInteger(v) ? v : String(v).replace('.', ',')} mil`;
    }
    return String(n);
  }

  function rangoRuta(r) {
    return `${mil(r.desde_ap)}–${mil(r.hasta_ap)} AP`;
  }

  function periodoZona(z) {
    if (z.edad_max === 0 && z.edad_min === 0) return 'Actualidad';
    if (z.edad_max === z.edad_min) return `hace ${numero.format(z.edad_max)} años`;
    return `hace ${numero.format(z.edad_max)} – ${numero.format(z.edad_min)} años`;
  }


  function renderLista() {
    const cont = $('#lista');
    const vacia = $('#lista-vacia');
    if (!cont) return;
    const filtradas = estado.zonas.filter(zonaPasaFiltro);
    const conteo = $('#lista-conteo');
    if (conteo) {
      conteo.textContent = filtradas.length === estado.zonas.length
        ? `${filtradas.length} zonas`
        : `${filtradas.length} de ${estado.zonas.length}`;
    }

    cont.innerHTML = '';
    estado.items.clear();

    if (!filtradas.length) {
      if (vacia) {
        vacia.hidden = false;
        vacia.textContent = estado.continente !== 'todos' && !estado.filtro.trim()
          ? `No hay zonas con muestras publicadas en ${nombreContinente(estado.continente)} en este prototipo. La ausencia de muestras no es ausencia de historia.`
          : 'No hay zonas que coincidan con la búsqueda.';
      }
      return;
    }
    if (vacia) vacia.hidden = true;

    filtradas.forEach((z) => {
      const retrato = z.retrato || {};
      const thumb = retrato.src
        ? `<img src="${escapar(retrato.src)}" alt="${escapar(retrato.alt || z.nombre)}" loading="lazy">`
        : SVG_SILUETA('silueta-svg');
      const paises = z._paises.length === 1 ? z._paises[0] : `${z._paises.length} países`;
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'zona-item';
      b.dataset.zona = z.id;
      b.style.setProperty('--c', colorZona(z));
      b.title = `${z.poblacion || z.nombre} · ${periodoZona(z)}`;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `
        <span class="thumb${retrato.src ? '' : ' silueta'}">${thumb}</span>
        <span class="texto">
          <span class="nombre">${escapar(z.poblacion || z.nombre)}</span>
          <span class="meta">${escapar(z.nombre)} · ${escapar(paises)} · ${escapar(periodoZona(z))} · <b>${z._sitios.length} sitios</b></span>
        </span>`;
      b.addEventListener('click', () => seleccionarZona(z.id, true));
      li.appendChild(b);
      cont.appendChild(li);
      estado.items.set(z.id, b);
    });
    marcarLista();
  }

  function marcarLista() {
    estado.items.forEach((b, id) => {
      const z = estado.zonaPorId[id];
      if (!z) return;
      const activo = estado.zonaSel === id;
      b.classList.toggle('activo', activo);
      b.classList.toggle('fuera', !zonaVisible(z));
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
  }

  /* Los eslabones se apagan al extinguirse: fundido suave, no corte seco.
     T = edad actual (años AP, 0 = hoy). Visible pleno mientras T >= E;
     se disuelve entre E y E-W. */
  function factorExtincion(z) {
    const E = z.extincion_ap;
    if (!E) return 1;
    const T = -estado.year;
    if (T >= E) return 1;
    const W = Math.min(Math.max(E * 0.2, 8000), 300000);
    if (T <= E - W) return 0;
    return (T - (E - W)) / W;
  }

  function zonaVisible(z) {
    return z._sitios.some((s) => sitioVisible(s)) && factorExtincion(z) > 0;
  }

  function sitioVisible(s) {
    return s.edad_ap >= -estado.year;
  }

  function zonaPasaFiltro(z) {
    if (estado.continente !== 'todos' && z.continente !== estado.continente) return false;
    const q = normalizar(estado.filtro.trim());
    if (!q) return true;
    const texto = [
      z.nombre,
      z.descripcion,
      z.cautela,
      ...z._sitios.flatMap((s) => [s.nombre, s.sitio, s.pais, s.contexto, s.hallazgo])
    ].join(' ');
    return normalizar(texto).includes(q);
  }

  function nombreContinente(id) {
    const c = (estado.datos.continentes || []).find((x) => x.id === id);
    return c ? c.nombre : id;
  }

  function asegurarItemVisible(item) {
    const list = $('#lista');
    if (!list || !item) return;
    const r = item.getBoundingClientRect();
    const lr = list.getBoundingClientRect();
    if (r.top < lr.top) list.scrollTop += r.top - lr.top;
    else if (r.bottom > lr.bottom) list.scrollTop += r.bottom - lr.bottom;
  }

  function actualizar(year, forzar = false) {
    const y = clamp(Number(year) || 0, -EDAD_MAX, 0);
    estado.year = y;

    const slider = $('#slider');
    if (slider) {
      const pos = yearToSlider(y);
      slider.value = String(pos);
      slider.style.setProperty('--p', `${(pos / 1000) * 100}%`);
    }
    const edad = $('#edad');
    if (edad) edad.textContent = formatearEdad(y);

    const filtradas = estado.zonas.filter(zonaPasaFiltro);
    let visiblesZonas = 0;
    let visiblesSitios = 0;
    let totalSitios = 0;

    filtradas.forEach((z) => {
      totalSitios += z._sitios.length;
      if (zonaVisible(z)) {
        visiblesZonas += 1;
        visiblesSitios += z._sitios.filter(sitioVisible).length;
      }
    });

    estado.zonas.forEach((z) => {
      const debe = zonaPasaFiltro(z) && zonaVisible(z);
      const capas = z._layers || (z._layer ? [z._layer] : []);
      const halos = z._halos || [];
      const esta = capas.length > 0 && estado.capaZonas.hasLayer(capas[0]);
      if (debe && !esta) {
        halos.forEach((h) => estado.capaZonas.addLayer(h));
        capas.forEach((c) => estado.capaZonas.addLayer(c));
        if (z._casing) estado.capaZonas.addLayer(z._casing);
      }
      if (!debe && esta) {
        capas.forEach((c) => estado.capaZonas.removeLayer(c));
        halos.forEach((h) => estado.capaZonas.removeLayer(h));
        if (z._casing) estado.capaZonas.removeLayer(z._casing);
      }
    });

    actualizarRegiones();
    // las rutas van por encima de las zonas
    estado.capaRutas.eachLayer((l) => { if (l.bringToFront) l.bringToFront(); });

    actualizarTarjetas();
    actualizarRutas();
    actualizarEstiloSeleccion();
    marcarLista();

    const contador = $('#contador');
    if (contador) {
      if (!filtradas.length) {
        contador.textContent = 'Sin zonas en este filtro';
      } else if (visiblesZonas === filtradas.length && visiblesSitios === totalSitios) {
        contador.textContent = `${visiblesSitios} ${visiblesSitios === 1 ? 'sitio' : 'sitios'} · ${visiblesZonas} ${visiblesZonas === 1 ? 'zona' : 'zonas'}`;
      } else {
        contador.textContent = `${visiblesSitios} de ${totalSitios} sitios · ${visiblesZonas} de ${filtradas.length} zonas`;
      }
    }

    $$('.hito').forEach((b) => {
      b.classList.toggle('activo', Math.abs(y - Number(b.dataset.year)) < 350);
    });

    $$('#detalle .sitio-item[data-sitio]').forEach((b) => {
      const s = estado.sitioPorId[b.dataset.sitio];
      if (s) b.classList.toggle('fuera', !sitioVisible(s));
    });
  }

  function formatearEdad(year) {
    if (year >= -100) return 'hoy';
    const edad = -year;
    if (edad >= 1000000) {
      const m = edad / 1000000;
      return `hace ${m >= 10 ? Math.round(m) : (Math.round(m * 10) / 10)} millones de años`;
    }
    return `hace ${numero.format(edad)} años`;
  }

  function actualizarTarjetas() {
    if (!estado.mapa) return;
    const movil = window.matchMedia('(max-width: 860px)').matches;
    // en movil los rotulos se muestran al acercarse: en la vista mundial se pisan
    const mostrar = !movil || estado.mapa.getZoom() >= 2.4;
    estado.zonas.forEach((z) => {
      const debe = mostrar && zonaPasaFiltro(z) && zonaVisible(z);
      const esta = estado.capaTarjetas.hasLayer(z._card);
      if (debe && !esta) estado.capaTarjetas.addLayer(z._card);
      if (!debe && esta) estado.capaTarjetas.removeLayer(z._card);
      if (debe && z._card.setOpacity) z._card.setOpacity(factorExtincion(z));
    });
    marcarTarjetas();
    ajustarTamanoEtiquetas();
    const hay = estado.zonas.some((z) => zonaPasaFiltro(z) && zonaVisible(z));
    const pista = $('#pista-zoom');
    if (pista) pista.hidden = mostrar || !hay;
  }

  function marcarTarjetas() {
    estado.zonas.forEach((z) => {
      const card = z._card;
      if (!card) return;
      const el = card.getElement();
      if (!el) return;
      const activo = z.id === estado.zonaSel;
      const inner = el.querySelector('.zona-label');
      if (inner) inner.classList.toggle('activa', activo);
      card.setZIndexOffset(activo ? 1200 : 500);
    });
  }

  function actualizarRutas() {
    if (!estado.mapa) return;
    if (estado.rutasOn) {
      if (!estado.mapa.hasLayer(estado.capaRutas)) estado.capaRutas.addTo(estado.mapa);
    } else if (estado.mapa.hasLayer(estado.capaRutas)) {
      estado.mapa.removeLayer(estado.capaRutas);
    }

    estado.rutas.forEach((r) => {
      r._activo = rutaActiva(r);
      const sel = estado.rutaSel === r.id;
      const opacidad = sel ? .98 : (r._activo ? .85 : .50);
      const peso = sel ? 3.0 : (r._activo ? 2.4 : 1.8);
      if (r._line) r._line.setStyle({ opacity: opacidad, weight: peso });
      if (r._casing) r._casing.setStyle({ opacity: sel ? .65 : (r._activo ? .5 : .3), weight: peso + 2.4 });
      if (r._arrow) r._arrow.setOpacity(sel ? 1 : (r._activo ? .9 : .65));
      const chip = estado.rutaItems.get(r.id);
      if (chip) {
        chip.classList.toggle('activa', sel || r._activo);
        chip.setAttribute('aria-pressed', sel ? 'true' : 'false');
      }
    });

    const btn = $('#rutas-toggle');
    if (btn) {
      btn.classList.toggle('activo', estado.rutasOn);
      btn.setAttribute('aria-pressed', estado.rutasOn ? 'true' : 'false');
    }
  }

  function rutaActiva(r) {
    const edad = -estado.year;
    return edad <= r.desde_ap && edad >= r.hasta_ap;
  }

  function actualizarEstiloSeleccion() {
    const base = opacidadZona();
    estado.zonas.forEach((z) => {
      const activo = z.id === estado.zonaSel;
      const atenuado = Boolean(estado.zonaSel) && !activo;
      z._atenuado = atenuado;
      if (z._capas) {
        z._capas.forEach((c) => {
          c.poly.setStyle({
            color: colorBorde(z),
            weight: activo ? 2.2 : 1.1
          });
        });
        if (activo) z._layers.forEach((l) => l.bringToFront());
      } else if (z._layer) {
        z._layer.setStyle({
          color: colorZona(z),
          weight: activo ? 3 : (atenuado ? 1.2 : 2),
          opacity: activo ? 1 : (atenuado ? .45 : .95),
          fillColor: colorZona(z),
          fillOpacity: activo ? Math.min(base + .3, .95) : (atenuado ? base * .35 : base)
        });
        if (z._casing) {
          z._casing.setStyle({
            weight: activo ? 6.5 : (atenuado ? 3.5 : 5),
            opacity: activo ? .7 : (atenuado ? .12 : .35)
          });
        }
        if (activo && estado.capaZonas.hasLayer(z._layer)) z._layer.bringToFront();
      }
      if (z._card && estado.capaTarjetas.hasLayer(z._card)) {
        z._card.setZIndexOffset(activo ? 1200 : 500);
      }
    });
    marcarTarjetas();
    solicitarAnimacion();
  }

  /* Crecimiento: cada región natural se enciende con la fecha de su sitio y su
     halo (posible difusión) se ensancha con el correr del reloj, en varias capas
     para que el degradado sea gradual y no un corte seco. */
  function actualizarRegiones() {
    estado.zonas.forEach((z) => {
      if (!z._capas) return;
      const base = opacidadZona();
      const fade = factorExtincion(z);
      z._capas.forEach((c) => {
        const t = estado.year + c.r.edad_ap;            // 0 en la fecha del sitio
        const fill = clamp((t + 4000) / 9000, 0, 1);     // arranca antes y se profundiza
        const spread = clamp(t / 28000, 0, 1);           // el campo se extiende
        c.activo = fill > 0.01;
        c.fillObj = fill * base * fade;
        c.haloObj = fill * (0.12 + 0.10 * spread) * fade;
        c.pesosObj = HALOS.map((cfg) => cfg.w * (0.55 + 1.15 * spread));
      });
    });
    solicitarAnimacion();
  }

  function solicitarAnimacion() {
    if (estado.raf) return;
    const paso = () => {
      estado.raf = null;
      let sigue = false;
      estado.zonas.forEach((z) => {
        if (!z._capas) return;
        const sel = z.id === estado.zonaSel;
        const col = colorZona(z);
        const borde = colorBorde(z);
        z._capas.forEach((c) => {
          const f = c.fill + (c.fillObj - c.fill) * 0.14;
          const h = c.haloOp + (c.haloObj - c.haloOp) * 0.14;
          c.pesos = c.pesos || HALOS.map((cfg) => cfg.w);
          const nuevos = c.pesosObj.map((w, i) => c.pesos[i] + (w - c.pesos[i]) * 0.14);
          if (Math.abs(f - c.fillObj) > 0.003 || Math.abs(h - c.haloObj) > 0.003) sigue = true;
          for (let i = 0; i < nuevos.length; i++) {
            if (Math.abs(nuevos[i] - c.pesosObj[i]) > 0.08) sigue = true;
          }
          c.fill = f;
          c.haloOp = h;
          c.pesos = nuevos;
          c.poly.setStyle({
            color: borde,
            fillColor: col,
            fillOpacity: f,
            opacity: f > 0.015 ? (z._atenuado ? .5 : (sel ? 1 : .95)) : 0
          });
          c.halos.forEach((halo, i) => {
            halo.setStyle({
              color: col,
              opacity: h * (1 - i / HALOS.length),
              weight: nuevos[i]
            });
          });
        });
      });
      if (sigue) estado.raf = requestAnimationFrame(paso);
    };
    estado.raf = requestAnimationFrame(paso);
  }


  function seleccionarZona(id, centrar = true) {
    const z = estado.zonaPorId[id];
    if (!z) return;
    pausar();
    estado.rutaSel = null;
    estado.zonaSel = id;
    estado.sitioSel = null;
    if (estado.capaSitio) estado.capaSitio.clearLayers();

    asegurarZonaVisible(z);
    actualizar(estado.year, true);
    renderDetalleZona(z);
    marcarLista();

    if (centrar) volarABounds(z._layerBounds || z._layer.getBounds());
    asegurarItemVisible(estado.items.get(id));
    const detalle = $('#detalle');
    if (detalle) detalle.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function asegurarZonaVisible(z) {
    let tocado = false;
    if (estado.continente !== 'todos' && z.continente !== estado.continente) {
      estado.continente = 'todos';
      actualizarFiltrosUI();
      tocado = true;
    }
    if (estado.filtro.trim() && !zonaPasaFiltro(z)) {
      estado.filtro = '';
      const input = $('#buscar');
      if (input) input.value = '';
      tocado = true;
    }
    if (!zonaVisible(z)) {
      estado.year = -z.edad_max;
      tocado = true;
    }
    if (tocado) {
      renderLista();
      actualizar(estado.year, true);
    }
  }

  function seleccionarSitio(id, centrar = true) {
    const s = estado.sitioPorId[id];
    if (!s) return;
    const z = estado.zonaPorId[s.zona];
    if (!z) return;
    pausar();
    estado.rutaSel = null;
    estado.zonaSel = s.zona;
    estado.sitioSel = id;
    if (estado.capaSitio) estado.capaSitio.clearLayers();

    asegurarZonaVisible(z);
    if (!sitioVisible(s)) estado.year = -s.edad_ap;
    actualizar(estado.year, true);
    renderDetalleSitio(s, z);
    marcarLista();
    mostrarFoco(s, z);

    if (centrar && estado.mapa) {
      estado.mapa.flyTo([s.lat, s.lon], 5, { duration: .8 });
    }
    asegurarItemVisible(estado.items.get(s.zona));
    const detalle = $('#detalle');
    if (detalle) detalle.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function mostrarFoco(s, z) {
    if (!estado.capaSitio) return;
    estado.capaSitio.clearLayers();
    L.circleMarker([s.lat, s.lon], {
      radius: 8,
      color: '#f4efe3',
      weight: 2,
      fillColor: colorZona(z),
      fillOpacity: 1,
      className: 'sitio-foco'
    }).addTo(estado.capaSitio);
    L.circleMarker([s.lat, s.lon], {
      radius: 3.5,
      color: '#f4efe3',
      weight: 1,
      fillColor: colorZona(z),
      fillOpacity: 1
    }).addTo(estado.capaSitio);
    estado.foco = s.id;
  }

  function seleccionarRuta(id, centrar = true) {
    const r = estado.rutas.find((x) => x.id === id);
    if (!r) return;
    pausar();
    estado.rutaSel = id;
    estado.zonaSel = null;
    estado.sitioSel = null;
    if (estado.capaSitio) estado.capaSitio.clearLayers();
    if (!estado.rutasOn) {
      estado.rutasOn = true;
    }

    actualizar(estado.year, true);
    renderDetalleRuta(r);
    marcarLista();

    if (centrar && estado.mapa && r._line) {
      volarABounds(r._line.getBounds());
    }
    const detalle = $('#detalle');
    if (detalle) detalle.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function limpiarSeleccion() {
    estado.zonaSel = null;
    estado.sitioSel = null;
    estado.rutaSel = null;
    estado.foco = null;
    if (estado.capaSitio) estado.capaSitio.clearLayers();
  }

  function volarABounds(bounds) {
    if (!estado.mapa || !bounds) return;
    const valido = typeof bounds.isValid === 'function' ? bounds.isValid() : true;
    if (!valido) return;
    estado.mapa.flyToBounds(bounds, { padding: [80, 80], maxZoom: 5, duration: .8 });
  }


  function renderDetalleZona(z) {
    const detalle = $('#detalle');
    if (!detalle) return;
    const retrato = z.retrato || {};
    const foto = retrato.src
      ? `<img src="${escapar(retrato.src)}" alt="${escapar(retrato.alt || z.nombre)}">`
      : SVG_SILUETA('silueta-grande');
    const pie = retrato.src
      ? `<div class="foto-pie"><span>${escapar(retrato.credito || '')}${retrato.licencia ? ` · ${escapar(retrato.licencia)}` : ''}</span>${retrato.url ? `<a href="${escapar(retrato.url)}" target="_blank" rel="noopener noreferrer">Ver original</a>` : ''}</div>`
      : '<div class="foto-pie"><span>Sin retrato publicado · no inventamos una cara</span></div>';

    const paises = z._paises.length === 1 ? z._paises[0] : `${z._paises.length} países`;
    const sitios = z._sitios
      .slice()
      .sort((a, b) => b.edad_ap - a.edad_ap)
      .map((s) => {
        const fuera = sitioVisible(s) ? '' : ' fuera';
        return `<button type="button" class="sitio-item${fuera}" data-sitio="${escapar(s.id)}">
          <span><span class="sitio-nombre">${escapar(s.nombre)}</span><span class="sitio-meta">${escapar(s.pais)} · ${escapar(s.contexto)}</span></span>
          <span class="sitio-fecha">${escapar(s.fecha)}</span>
        </button>`;
      })
      .join('');

    const fuentes = fuentesUnicas(z._sitios);
    const nota = retrato.nota
      ? `<div class="retrato-nota">${escapar(retrato.nota)}</div>`
      : '';
    const extra = z.extra && z.extra.src
      ? `<div class="detalle-extra">
          <img src="${escapar(z.extra.src)}" alt="${escapar(z.extra.alt || 'Retrato adicional')}">
          <p><span class="mini-rotulo">Otro retrato de la zona</span>${escapar(z.extra.nota || '')}${z.extra.url ? ` <a href="${escapar(z.extra.url)}" target="_blank" rel="noopener noreferrer">Ver original</a>` : ''}</p>
        </div>`
      : '';

    const regiones = z._regiones || [];
    const listaRegiones = regiones.length
      ? `<div class="detalle-unidades">${regiones.map((r) => {
          const s = (r.sitios || []).map((id) => estado.sitioPorId[id]).filter(Boolean);
          return `<span class="unidad-chip" title="${escapar(s.map((x) => x.nombre).join(', '))}">${escapar(r.nombre)}</span>`;
        }).join('')}</div>`
      : '';

    detalle.innerHTML = `
      <div class="detalle-foto${retrato.src ? '' : ' silueta'}" style="--c:${escapar(colorZona(z))}">
        ${foto}
        ${pie}
      </div>
      <div class="detalle-cabeza">
        <div>
          <p class="detalle-eyebrow">${escapar(z.poblacion || 'Zona de muestras')}</p>
          <h2>${escapar(z.nombre)}</h2>
        </div>
        <span class="edad-sitio">${z.moderno ? 'Actualidad · ADN moderno' : escapar(periodoZona(z))}</span>
      </div>
      <p class="descripcion">${escapar(z.descripcion || '')}</p>
      <div class="ficha-meta">
        <div><span>Países</span><b>${escapar(paises)}</b></div>
        <div><span>${z.moderno ? 'Referencia' : 'Sitios'}</span><b>${z._sitios.length}</b></div>
        <div><span>Individuos</span><b>${z.moderno ? 'poblacional' : escapar(individuosZona(z))}</b></div>
      </div>
      ${nota}
      ${listaRegiones ? `<h3>Regiones naturales</h3>${listaRegiones}<p class="cautela">Son regiones físicas del terreno (cordilleras, mesetas, llanuras, cuencas) con sitios publicados. No son fronteras administrativas ni territorios genéticos: el color marca dónde hay evidencia y el halo, la difusión posible.</p>` : ''}
      <h3>Qué no es</h3>
      <p class="cautela">${escapar(z.cautela || 'La zona es un área de muestreo; no es un territorio ni una frontera genética.')}</p>
      <h3>${z.moderno ? 'Referencia poblacional' : 'Sitios publicados'}</h3>
      <div class="detalle-sitios">${sitios}</div>
      ${extra}
      <h3>Fuentes</h3>
      <ul class="fuentes">${fuentes}</ul>`;
  }

  function renderDetalleSitio(s, z) {
    const detalle = $('#detalle');
    if (!detalle) return;
    const retrato = z.retrato || {};
    const fuente = fuenteLink(s);
    const extra = retrato.src
      ? `<div class="detalle-extra">
          <img src="${escapar(retrato.src)}" alt="${escapar(retrato.alt || z.nombre)}">
          <p><span class="mini-rotulo">Retrato de la zona</span>${escapar(retrato.nota || '')}${retrato.url ? ` <a href="${escapar(retrato.url)}" target="_blank" rel="noopener noreferrer">Ver original</a>` : ''}</p>
        </div>`
      : '';

    const linaje = s.linaje
      ? `<div class="detalle-extra lineages">
          <p><span class="mini-rotulo">Linaje documentado</span><b>${escapar(s.linaje)}</b>${z.poblacion ? ` <span class="nota-linea">${escapar(z.poblacion)}</span>` : ''}</p>
          <p class="mini-nota">Es el componente de ascendencia que reporta el estudio citado: una relación de descendencia medida, no una categoría étnica ni una frontera.</p>
        </div>`
      : '';

    detalle.innerHTML = `
      <button type="button" class="volver-zona" data-volver-zona="${escapar(z.id)}">← Volver a ${escapar(z.nombre)}</button>
      <div class="detalle-cabeza">
        <div>
          <p class="detalle-eyebrow">Sitio · ${escapar(z.nombre)}</p>
          <h2>${escapar(s.nombre)}</h2>
        </div>
        <span class="edad-sitio">${escapar(s.fecha)}</span>
      </div>
      <p class="descripcion">${escapar(s.hallazgo || '')}</p>
      ${s.linaje ? `<div class="linaje-fila"><span class="mini-rotulo">Linaje</span><b>${escapar(s.linaje)}</b></div>` : ''}
      <dl>
        <dt>Sitio</dt><dd>${escapar(s.sitio || '')}</dd>
        <dt>País</dt><dd>${escapar(s.pais || '')}</dd>
        <dt>Zona</dt><dd>${escapar(z.nombre)}</dd>
        <dt>Contexto</dt><dd>${escapar(s.contexto || '')}</dd>
        <dt>Dato</dt><dd>${escapar(s.tipo || '')}</dd>
        <dt>Individuos</dt><dd>${escapar(s.individuos == null ? 's/d' : s.individuos)}</dd>
      </dl>
      <h3>Qué no se puede concluir</h3>
      <p class="cautela">${escapar(s.incertidumbre || 'Muestra pequeña; no representa a toda la región.')}</p>
      <h3>Fuente</h3>
      <p class="cita">${fuente}</p>
      ${linaje}
      ${extra}`;
  }

  function renderDetalleRuta(r) {
    const detalle = $('#detalle');
    if (!detalle) return;
    detalle.innerHTML = `
      <button type="button" class="volver-zona" data-volver-inicio>← Volver a la vista general</button>
      <div class="detalle-cabeza">
        <div>
          <p class="detalle-eyebrow">Ruta publicada</p>
          <h2>${escapar(r.nombre)}</h2>
        </div>
        <span class="edad-sitio">${escapar(rangoRuta(r))}</span>
      </div>
      <p class="descripcion">${escapar(r.nota || '')}</p>
      <div class="ficha-meta">
        <div><span>Tipo</span><b>Esquemática</b></div>
        <div><span>Puntos</span><b>${r.puntos ? r.puntos.length : 0}</b></div>
        <div><span>Ventana</span><b>${escapar(rangoRuta(r))}</b></div>
      </div>
      <h3>Qué no es</h3>
      <p class="cautela">La línea no es un camino exacto ni una frontera. Es una hipótesis publicada, simplificada para leer el contexto; las fechas y los trayectos se discuten en la literatura.</p>
      <h3>Fuente</h3>
      <p class="cita">${fuenteLink(r)}</p>`;
  }

  function individuosZona(z) {
    let total = 0;
    let varios = false;
    z._sitios.forEach((s) => {
      if (typeof s.individuos === 'number') total += s.individuos;
      else varios = true;
    });
    if (varios) return total > 0 ? `${total}+` : 'varios';
    return String(total);
  }

  function fuenteLink(item) {
    const url = item.doi || item.url;
    const texto = item.cita || item.nombre || '';
    if (url) {
      return `<a href="${escapar(url)}" target="_blank" rel="noopener noreferrer">${escapar(texto)}</a>`;
    }
    return escapar(texto);
  }

  function fuentesUnicas(sitios) {
    const vistos = new Set();
    const items = [];
    sitios.forEach((s) => {
      const clave = s.doi || s.cita;
      if (!clave || vistos.has(clave)) return;
      vistos.add(clave);
      items.push(`<li>${fuenteLink(s)}</li>`);
    });
    return items.join('') || '<li>Sin fuente cargada.</li>';
  }


  function detalleVacio() {
    const detalle = $('#detalle');
    if (!detalle) return;
    const total = estado.sitios.length;
    const totalZonas = estado.zonas.length;
    const sa = estado.sitios.filter((s) => s.continente === 'america' && s.pais !== 'Belice' && s.pais !== 'Estados Unidos').length;
    const porContinente = (estado.datos.continentes || []).map((c) => {
      const n = estado.sitios.filter((s) => s.continente === c.id).length;
      return `<li><span><i class="punto-region" style="background:#7f7665"></i>${escapar(c.nombre)}</span><b>${n}</b></li>`;
    }).join('');

    detalle.innerHTML = `
      <p class="detalle-titulo">${total} sitios, ${totalZonas} zonas, un mapa incompleto.</p>
      <p>Este prototipo reúne genomas antiguos publicados y los agrupa en zonas de muestreo. No es una historia completa: ${sa} sitios están en Sudamérica, hay uno en África y ninguno en Oceanía.</p>
      <ul class="bias-lista">${porContinente}</ul>
      <p>La distribución no es neutral. El ADN se conserva peor en climas cálidos y húmedos, y el muestreo depende de permisos, financiación y decisiones de investigadores y comunidades.</p>
      <p>Hacé clic en una zona, en un sitio de su ficha o en una ruta. Las áreas son envolventes de sitios; los retratos son de individuos concretos. No hay razas en este mapa.</p>`;
  }

  function pintarFuentes() {
    const metodo = $('#fuentes-metodo');
    if (metodo) {
      const base = (estado.datos.meta.fuentes_metodo || []).map((f) => {
        if (f.url) {
          return `<li><a href="${escapar(f.url)}" target="_blank" rel="noopener noreferrer">${escapar(f.cita)}</a></li>`;
        }
        return `<li>${escapar(f.cita)}</li>`;
      });
      const geografia = '<li>Natural Earth 10m admin-1 / admin-0 (dominio público) — geometría de las unidades administrativas: <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">naturalearthdata.com</a></li>';
      metodo.innerHTML = base.concat([geografia]).join('');
    }

    const rutas = $('#fuentes-rutas');
    if (rutas) {
      rutas.innerHTML = estado.rutas.map((r) => {
        const fuente = fuenteLink(r);
        return `<h4>${escapar(r.nombre)} · ${escapar(rangoRuta(r))}</h4><p>${fuente}</p>`;
      }).join('');
    }

    const sitios = $('#fuentes-sitios');
    if (sitios) {
      sitios.innerHTML = estado.sitios.map((s) => {
        const fuente = fuenteLink(s);
        return `<h4>${escapar(s.nombre)} · ${escapar(s.fecha)}</h4><p>${fuente}</p>`;
      }).join('');
    }
  }

  function pintarCreditos() {
    const cont = $('#creditos-imagenes');
    if (!cont) return;
    const fotos = [];
    estado.zonas.forEach((z) => {
      if (z.retrato && z.retrato.src) fotos.push({ ...z.retrato, zona: z.nombre });
      if (z.extra && z.extra.src) fotos.push({ ...z.extra, zona: z.nombre });
    });
    if (!fotos.length) {
      cont.innerHTML = '<li>No hay imágenes de retratos en este prototipo.</li>';
      return;
    }
    cont.innerHTML = fotos.map((f) => {
      const titulo = f.url
        ? `<a href="${escapar(f.url)}" target="_blank" rel="noopener noreferrer">${escapar(f.zona)}</a>`
        : escapar(f.zona);
      return `<li>
        <img src="${escapar(f.src)}" alt="${escapar(f.alt || f.zona)}" loading="lazy">
        <div>${titulo}<small>${escapar(f.credito || '')}${f.licencia ? ` · ${escapar(f.licencia)}` : ''}</small></div>
      </li>`;
    }).join('');
  }

  /* Puntos de cambio en el recorrido: posiciones del slider (log) donde aparece
     al menos un sitio. El recorrido frena al llegar a cada uno y acelera en los
     tramos vacíos; el pulso de brillo acelera con él. */
  function puntosDeCambio() {
    const set = new Set();
    for (const z of estado.zonas) {
      if (estado.continente !== 'todos' && z.continente !== estado.continente) continue;
      for (const s of z._sitios) set.add(yearToSlider(-s.edad_ap));
    }
    return [...set].sort((a, b) => b - a);
  }

  function fijarPulso(ratio) {
    const d = (4 / Math.min(Math.max(ratio, 1), 10)).toFixed(2);
    document.documentElement.style.setProperty('--pulso-d', `${d}s`);
  }

  function alternarPlay() {
    if (estado.play) {
      pausar();
      return;
    }
    if (estado.year >= -100) actualizar(-EDAD_MAX, true);
    let p = yearToSlider(estado.year);
    const cambios = puntosDeCambio();
    estado.play = window.setInterval(() => {
      let dist = 1000;
      for (const pc of cambios) {
        if (pc < p - 0.5) { dist = p - pc; break; }
      }
      const dp = dist < 8 ? 1.2 : Math.min(dist * 0.12, 14);
      p = Math.max(0, p - dp);
      fijarPulso(dp / 1.2);
      actualizar(sliderToYear(p), true);
      if (p <= 0) pausar();
    }, 60);
    const btn = $('#play');
    if (btn) {
      btn.innerHTML = '<span id="play-icono" aria-hidden="true">Ⅱ</span> Pausar';
      btn.classList.add('activo');
    }
  }

  function pausar() {
    if (!estado.play) return;
    window.clearInterval(estado.play);
    estado.play = null;
    document.documentElement.style.setProperty('--pulso-d', '4s');
    const btn = $('#play');
    if (btn) {
      btn.innerHTML = '<span id="play-icono" aria-hidden="true">▶</span> Recorrer';
      btn.classList.remove('activo');
    }
  }

  function abrirModal() {
    pausar();
    const modal = $('#modal');
    if (!modal) return;
    modal.hidden = false;
    const cerrar = $('#cerrar');
    if (cerrar) cerrar.focus();
  }

  function cerrarModal() {
    const modal = $('#modal');
    if (!modal) return;
    modal.hidden = true;
    const info = $('#info');
    if (info) info.focus();
  }


  function resetear() {
    pausar();
    limpiarSeleccion();
    estado.continente = 'todos';
    estado.filtro = '';
    const buscar = $('#buscar');
    if (buscar) buscar.value = '';
    actualizarFiltrosUI();
    renderLista();
    if (estado.mapa) {
      const bounds = L.latLngBounds(estado.sitios.map((s) => [s.lat, s.lon]));
      estado.mapa.fitBounds(bounds, { padding: [70, 70], maxZoom: 3.2 });
    }
    actualizar(0, true);
    detalleVacio();
    const panel = $('#panel');
    if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function conectarEventos() {
    const slider = $('#slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        pausar();
        actualizar(sliderToYear(Number(e.target.value)), true);
      });
    }

    const play = $('#play');
    if (play) play.addEventListener('click', alternarPlay);

    const reset = $('#reset');
    if (reset) reset.addEventListener('click', resetear);

    const rutasToggle = $('#rutas-toggle');
    if (rutasToggle) {
      rutasToggle.addEventListener('click', () => {
        estado.rutasOn = !estado.rutasOn;
        if (!estado.rutasOn && estado.rutaSel) {
          estado.rutaSel = null;
          detalleVacio();
        }
        actualizar(estado.year, true);
      });
    }

    const btnVista = $('#btn-vista');
    if (btnVista) btnVista.addEventListener('click', cambiarVista);

    const buscar = $('#buscar');
    if (buscar) {
      buscar.addEventListener('input', (e) => {
        estado.filtro = e.target.value;
        const z = estado.zonaSel ? estado.zonaPorId[estado.zonaSel] : null;
        if (z && !zonaPasaFiltro(z)) {
          limpiarSeleccion();
          detalleVacio();
        }
        renderLista();
        actualizar(estado.year, true);
      });
    }

    const info = $('#info');
    if (info) info.addEventListener('click', abrirModal);
    const cerrar = $('#cerrar');
    if (cerrar) cerrar.addEventListener('click', cerrarModal);
    const modal = $('#modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) cerrarModal();
      });
    }

    const detalle = $('#detalle');
    if (detalle) {
      detalle.addEventListener('click', (e) => {
        const sitio = e.target.closest('[data-sitio]');
        if (sitio) {
          seleccionarSitio(sitio.dataset.sitio);
          return;
        }
        const volver = e.target.closest('[data-volver-zona]');
        if (volver) {
          seleccionarZona(volver.dataset.volverZona);
          return;
        }
        const inicio = e.target.closest('[data-volver-inicio]');
        if (inicio) {
          limpiarSeleccion();
          actualizar(estado.year, true);
          detalleVacio();
        }
      });
    }

    document.addEventListener('keydown', (e) => {
      if (modal && !modal.hidden) {
        if (e.key === 'Escape') cerrarModal();
        return;
      }
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        pausar();
        actualizar(sliderToYear(Math.max(0, yearToSlider(estado.year) - 25)), true);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        pausar();
        actualizar(sliderToYear(Math.min(1000, yearToSlider(estado.year) + 25)), true);
      } else if (e.key === 'Home') {
        e.preventDefault();
        pausar();
        actualizar(-EDAD_MAX, true);
      } else if (e.key === 'End') {
        e.preventDefault();
        pausar();
        actualizar(0, true);
      }
    });

    let timer = null;
    window.addEventListener('resize', () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (estado.mapa) estado.mapa.invalidateSize();
        actualizarTarjetas();
      }, 140);
    });
  }

  iniciar();
})();
