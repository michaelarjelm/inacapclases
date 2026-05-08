document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const rutInput = document.getElementById('rut');
    const errorMsg = document.getElementById('error-msg');
    const loginSection = document.getElementById('login-section');
    const dashboardSection = document.getElementById('dashboard-section');
    const logoutBtn = document.getElementById('logout-btn');

    let studentsData = [];

    // Load JSON data
    fetch('data.json')
        .then(response => {
            if (!response.ok) throw new Error('No se pudo cargar el archivo JSON');
            return response.json();
        })
        .then(data => {
            studentsData = data;
            console.log('Base de datos cargada:', studentsData.length, 'alumnos');
        })
        .catch(err => {
            console.error('Error loading data:', err);
            alert('Atención: Si estás probando localmente, asegúrate de usar un servidor local (como Live Server) o subir los archivos a Azure. Los navegadores bloquean la carga de datos por seguridad al abrir archivos directamente.');
        });

    // Helper to clean RUT (remove dots, hyphens, spaces)
    const cleanRutStr = (str) => {
        return str.toString().toUpperCase().replace(/[^0-9K]/g, '');
    };

    // Handle Login
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        if (studentsData.length === 0) {
            alert('Los datos aún no han cargado. Revisa la consola (F12).');
            return;
        }

        const inputRut = cleanRutStr(rutInput.value);
        console.log('Buscando RUT:', inputRut);
        
        const student = studentsData.find(s => cleanRutStr(s.rut) === inputRut);

        if (student) {
            showDashboard(student);
        } else {
            errorMsg.classList.remove('hidden');
            setTimeout(() => errorMsg.classList.add('hidden'), 3000);
        }
    });

    // Handle Logout
    logoutBtn.addEventListener('click', () => {
        dashboardSection.classList.add('hidden');
        loginSection.classList.remove('hidden');
        rutInput.value = '';
    });

    function showDashboard(student) {
        document.getElementById('student-name').textContent = student.nombre;
        document.getElementById('student-module').textContent = `Módulo: ${student.modulo}`;
        document.getElementById('student-section').textContent = `Sección: ${student.seccion}`;
        document.getElementById('avg-real').textContent = student.promedio_real.toFixed(1);
        document.getElementById('avg-final').textContent = student.promedio_final.toFixed(1);

        const container = document.getElementById('grades-container');
        container.innerHTML = '';

        student.evaluaciones.forEach((grade, index) => {
            const box = document.createElement('div');
            box.className = 'grade-box';
            box.innerHTML = `
                <span class="grade-label">Eval ${index + 1}</span>
                <span class="grade-value" style="color: ${grade < 4.0 ? '#d63031' : '#2d3436'}">${grade.toFixed(1)}</span>
            `;
            container.appendChild(box);
        });

        loginSection.classList.add('hidden');
        dashboardSection.classList.remove('hidden');
    }
});
