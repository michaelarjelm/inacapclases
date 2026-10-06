// Las notas vienen cifradas en notas.enc.json: cada alumno queda bajo un id y
// una clave derivados de su RUT (PBKDF2-SHA256 + AES-GCM), asi el archivo no
// expone RUT, nombres ni notas. Lo genera generar.js, fuera de este repo.
const DATA_URL = 'notas.enc.json';

function normalizarRut(rut) {
    return String(rut).toUpperCase().replace(/[^0-9K]/g, '');
}

function base64ToBytes(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToHex(bytes) {
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Devuelve el alumno descifrado, o null si el RUT no esta.
async function buscarAlumno(data, rut) {
    const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(rut), 'PBKDF2', false, ['deriveBits']
    );
    const bits = new Uint8Array(await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(data.kdf.salt), iterations: data.kdf.iteraciones },
        material, 384
    ));
    const entrada = data.alumnos[bytesToHex(bits.slice(0, 16))];
    if (!entrada) return null;
    const key = await crypto.subtle.importKey('raw', bits.slice(16, 48), 'AES-GCM', false, ['decrypt']);
    const plano = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(entrada.iv) }, key, base64ToBytes(entrada.ct)
    );
    return JSON.parse(new TextDecoder().decode(plano));
}

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const rutInput = document.getElementById('rut');
    const errorMsg = document.getElementById('error-msg');
    const sections = {
        login: document.getElementById('login-section'),
        selector: document.getElementById('selector-section'),
        dashboard: document.getElementById('dashboard-section'),
        detail: document.getElementById('detail-section')
    };
    const backBtn = document.getElementById('back-btn');

    let alumno = null;
    let cursoActual = null;

    function show(name) {
        Object.entries(sections).forEach(([key, el]) => {
            el.classList.toggle('hidden', key !== name);
        });
    }

    function showError(msg) {
        errorMsg.textContent = msg;
        errorMsg.classList.remove('hidden');
    }

    function formatNota(n) {
        return n === null ? '-' : n.toFixed(1);
    }

    // 8 -> "8", 1.5 -> "1,5"
    function formatPuntaje(n) {
        return String(Math.round(n * 100) / 100).replace('.', ',');
    }

    function colorNota(n) {
        return n !== null && n < 4.0 ? '#d63031' : '#2d3436';
    }

    function estaPendiente(ev) {
        return Boolean(ev.cierre) && new Date() < new Date(ev.cierre);
    }

    function etiquetasEstado(ev) {
        const tags = [];
        if (estaPendiente(ev)) tags.push('Pendiente');
        else if (!ev.rendida) tags.push('No rendida');
        if (ev.descartada) tags.push('Descartada');
        return tags;
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorMsg.classList.add('hidden');
        loginBtn.disabled = true;
        loginBtn.textContent = 'Consultando...';
        try {
            const rut = normalizarRut(rutInput.value);
            if (!rut) {
                showError('Debes ingresar un RUT.');
                return;
            }
            const res = await fetch(DATA_URL + '?t=' + Date.now());
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const encontrado = await buscarAlumno(await res.json(), rut);
            if (!encontrado) {
                showError('RUT no encontrado. Verifica e intenta nuevamente.');
                return;
            }
            alumno = encontrado;
            if (alumno.cursos.length === 1) {
                showDashboard(alumno.cursos[0]);
            } else {
                showSelector();
            }
        } catch (err) {
            console.error(err);
            showError('No se pudieron cargar las notas. Intenta nuevamente en unos minutos.');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Consultar';
        }
    });

    function showSelector() {
        document.getElementById('selector-name').textContent = alumno.nombre;
        const list = document.getElementById('course-list');
        list.innerHTML = '';
        alumno.cursos.forEach((curso) => {
            const btn = document.createElement('button');
            btn.className = 'course-option';
            btn.innerHTML = '<strong></strong><span></span>';
            btn.querySelector('strong').textContent = curso.modulo;
            btn.querySelector('span').textContent = 'Sección ' + curso.seccion;
            btn.addEventListener('click', () => showDashboard(curso));
            list.appendChild(btn);
        });
        show('selector');
    }

    function showDashboard(curso) {
        cursoActual = curso;
        document.getElementById('student-name').textContent = alumno.nombre;
        document.getElementById('student-module').textContent = `Módulo: ${curso.modulo}`;
        document.getElementById('student-section').textContent = `Sección: ${curso.seccion}`;
        document.getElementById('avg-real').textContent = formatNota(curso.promedioReal);
        document.getElementById('avg-final').textContent = formatNota(curso.promedioFinal);
        backBtn.classList.toggle('hidden', alumno.cursos.length === 1);

        const container = document.getElementById('grades-container');
        container.innerHTML = '';

        if (curso.cantidad === 0) {
            const vacio = document.createElement('p');
            vacio.className = 'empty-note';
            vacio.textContent = 'Aún no hay evaluaciones registradas en este módulo.';
            container.appendChild(vacio);
        }

        curso.evaluaciones.forEach((ev) => {
            const box = document.createElement('button');
            box.type = 'button';
            box.className = 'grade-box' + (ev.descartada ? ' descartada' : '');
            box.setAttribute('aria-label', `Ver detalle de ${ev.etiqueta}`);
            box.innerHTML = '<span class="grade-label"></span><span class="grade-value"></span>';
            box.querySelector('.grade-label').textContent = ev.etiqueta;
            const value = box.querySelector('.grade-value');
            value.textContent = formatNota(ev.nota);
            value.style.color = colorNota(ev.nota);
            const tags = etiquetasEstado(ev);
            if (tags.length) {
                const tag = document.createElement('span');
                tag.className = 'grade-tag';
                tag.textContent = tags.join(' - ');
                box.appendChild(tag);
            }
            box.addEventListener('click', () => showDetail(ev));
            container.appendChild(box);
        });

        let nota = curso.aplicaDescarte
            ? `* El promedio final considera las mejores ${curso.cantidad - 2} de tus ${curso.cantidad} calificaciones (se descartan las 2 más bajas). Las evaluaciones no rendidas cuentan como 1.0.`
            : '* Con menos de 3 evaluaciones aún no se descarta ninguna; el promedio final es el promedio simple.';
        if (curso.evaluaciones.some(estaPendiente)) {
            nota += ' Las evaluaciones pendientes aún están abiertas: cuentan como 1.0 hasta que las rindas.';
        }
        nota += ' Toca una evaluación para ver su detalle.';
        document.getElementById('footer-note').textContent = nota;

        show('dashboard');
    }

    function showDetail(ev) {
        const curso = cursoActual;
        document.getElementById('detail-title').textContent = `Evaluación ${ev.etiqueta}`;
        document.getElementById('detail-module').textContent = `${curso.modulo} - Sección ${curso.seccion}`;

        const value = document.getElementById('detail-grade-value');
        value.textContent = formatNota(ev.nota);
        value.style.color = colorNota(ev.nota);
        document.getElementById('detail-grade-tags').textContent = etiquetasEstado(ev).join(' - ');

        let estado;
        if (estaPendiente(ev)) {
            estado = 'Esta evaluación sigue abierta. Mientras no la rindas cuenta como 1.0.';
        } else if (!ev.rendida) {
            estado = 'No rendiste esta evaluación, así que cuenta como 1.0.';
        } else {
            estado = 'Esta nota cuenta para tu promedio final.';
        }
        if (ev.descartada) {
            estado = (ev.rendida ? '' : 'No rendiste esta evaluación. ') +
                'Es una de tus 2 notas más bajas, así que se descarta y no cuenta para tu promedio final.';
        }
        document.getElementById('detail-status').textContent = estado;

        const score = document.getElementById('detail-score');
        const list = document.getElementById('detail-questions');
        list.innerHTML = '';
        const det = ev.detalle;
        score.classList.toggle('hidden', !det);
        if (det) {
            document.getElementById('detail-score-total').textContent =
                `${formatPuntaje(det.puntaje)} de ${formatPuntaje(det.puntajeMax)} puntos`;
            det.preguntas.forEach((p) => {
                const li = document.createElement('li');
                li.className = 'question';
                li.innerHTML =
                    '<span class="question-name"></span>' +
                    '<span class="question-bar"><span class="question-fill"></span><span class="question-mark"></span></span>' +
                    '<span class="question-score"></span>';
                li.querySelector('.question-name').textContent = `Pregunta ${p.numero}`;
                const fill = li.querySelector('.question-fill');
                fill.style.width = `${(p.puntaje / p.max) * 100}%`;
                fill.classList.toggle('parcial', p.puntaje < p.max);
                const mark = li.querySelector('.question-mark');
                if (p.promedioCurso === null) mark.remove();
                else mark.style.left = `${(p.promedioCurso / p.max) * 100}%`;
                li.querySelector('.question-score').textContent = `${formatPuntaje(p.puntaje)} / ${formatPuntaje(p.max)}`;
                li.title = p.promedioCurso === null ? '' : `Promedio del curso: ${formatPuntaje(p.promedioCurso)}`;
                list.appendChild(li);
            });
        }

        const facts = document.getElementById('detail-facts');
        facts.innerHTML = '';
        const agregar = (label, texto) => {
            const dt = document.createElement('dt');
            dt.textContent = label;
            const dd = document.createElement('dd');
            dd.textContent = texto;
            facts.append(dt, dd);
        };
        if (det) {
            agregar('Rendida el', det.finalizado);
            agregar('Duración', det.duracion);
        } else if (ev.rendida) {
            agregar('Detalle', 'No hay detalle por pregunta para esta evaluación.');
        }
        if (ev.promedioCurso !== undefined) {
            agregar('Promedio del curso', `${formatNota(ev.promedioCurso)} (de quienes la rindieron)`);
        }
        if (estaPendiente(ev)) {
            agregar('Cierra el', new Date(ev.cierre).toLocaleString('es-CL', {
                timeZone: 'America/Santiago', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
            }));
        }

        show('detail');
        window.scrollTo(0, 0);
    }

    document.getElementById('detail-back-btn').addEventListener('click', () => showDashboard(cursoActual));
    backBtn.addEventListener('click', showSelector);
    document.getElementById('selector-back-btn').addEventListener('click', logout);
    document.getElementById('logout-btn').addEventListener('click', logout);

    function logout() {
        alumno = null;
        cursoActual = null;
        rutInput.value = '';
        errorMsg.classList.add('hidden');
        show('login');
    }
});
