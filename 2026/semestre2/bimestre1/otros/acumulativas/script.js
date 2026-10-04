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
        dashboard: document.getElementById('dashboard-section')
    };
    const backBtn = document.getElementById('back-btn');

    let alumno = null;

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
        document.getElementById('student-name').textContent = alumno.nombre;
        document.getElementById('student-module').textContent = `Módulo: ${curso.modulo}`;
        document.getElementById('student-section').textContent = `Sección: ${curso.seccion}`;
        document.getElementById('avg-real').textContent = formatNota(curso.promedioReal);
        document.getElementById('avg-final').textContent = formatNota(curso.promedioFinal);
        backBtn.classList.toggle('hidden', alumno.cursos.length === 1);

        const container = document.getElementById('grades-container');
        container.innerHTML = '';
        const ahora = new Date();
        const pendiente = (ev) => Boolean(ev.cierre) && ahora < new Date(ev.cierre);

        if (curso.cantidad === 0) {
            const vacio = document.createElement('p');
            vacio.className = 'empty-note';
            vacio.textContent = 'Aún no hay evaluaciones registradas en este módulo.';
            container.appendChild(vacio);
        }

        curso.evaluaciones.forEach((ev) => {
            const box = document.createElement('div');
            box.className = 'grade-box' + (ev.descartada ? ' descartada' : '');
            box.innerHTML = '<span class="grade-label"></span><span class="grade-value"></span>';
            box.querySelector('.grade-label').textContent = ev.etiqueta;
            const value = box.querySelector('.grade-value');
            value.textContent = formatNota(ev.nota);
            value.style.color = ev.nota !== null && ev.nota < 4.0 ? '#d63031' : '#2d3436';
            const tags = [];
            if (pendiente(ev)) tags.push('Pendiente');
            else if (!ev.rendida) tags.push('No rendida');
            if (ev.descartada) tags.push('Descartada');
            if (tags.length) {
                const tag = document.createElement('span');
                tag.className = 'grade-tag';
                tag.textContent = tags.join(' - ');
                box.appendChild(tag);
            }
            container.appendChild(box);
        });

        let nota = curso.aplicaDescarte
            ? `* El promedio final considera las mejores ${curso.cantidad - 2} de tus ${curso.cantidad} calificaciones (se descartan las 2 más bajas). Las evaluaciones no rendidas cuentan como 1.0.`
            : '* Con menos de 3 evaluaciones aún no se descarta ninguna; el promedio final es el promedio simple.';
        if (curso.evaluaciones.some(pendiente)) {
            nota += ' Las evaluaciones pendientes aún están abiertas: cuentan como 1.0 hasta que las rindas.';
        }
        document.getElementById('footer-note').textContent = nota;

        show('dashboard');
    }

    backBtn.addEventListener('click', showSelector);
    document.getElementById('selector-back-btn').addEventListener('click', logout);
    document.getElementById('logout-btn').addEventListener('click', logout);

    function logout() {
        alumno = null;
        rutInput.value = '';
        errorMsg.classList.add('hidden');
        show('login');
    }
});
