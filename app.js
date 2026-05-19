// --- CORE CONFIGURATION SETUP ---
const OFFICE_LAT = 23.7926166;       
const OFFICE_LON = 90.4141156;       
const ALLOWED_RADIUS_KM = 0.1;    // 100 meters restriction zone
const ADMIN_PASSWORD = "admin123"; 

let employees = JSON.parse(localStorage.getItem('db_employees')) || {};
let attendanceLog = JSON.parse(localStorage.getItem('db_attendance')) || [];

// Initial Run to set up metrics dashboard view logic
updateAdminDashboard();

function showStatus(message, isSuccess) {
    const box = document.getElementById('statusBox');
    box.style.display = 'block';
    box.className = `status ${isSuccess ? 'success' : 'error'}`;
    box.innerText = message;
    window.scrollTo({top: 0, behavior: 'smooth'});
}

// --- ROUTING MANAGER ---
function switchView(target) {
    const empInterface = document.getElementById('employeeInterface');
    const adminInterface = document.getElementById('adminInterface');
    const btnEmp = document.getElementById('btnEmpView');
    const btnAdmin = document.getElementById('btnAdminView');

    if (target === 'admin') {
        const passwordCheck = prompt("Enter Administration Security Password:");
        if (passwordCheck === ADMIN_PASSWORD) {
            empInterface.style.display = 'none';
            adminInterface.style.display = 'block';
            btnEmp.classList.remove('active');
            btnAdmin.classList.add('active');
            updateAdminDashboard();
            showStatus("Admin verification successful.", true);
        } else {
            alert("Unauthorized Access. Invalid password.");
        }
    } else {
        empInterface.style.display = 'block';
        adminInterface.style.display = 'none';
        btnEmp.classList.add('active');
        btnAdmin.classList.remove('active');
    }
}

// Distance computation logic
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

// ==========================================
// EMPLOYEE VIEW: ATTENDANCE & SELF-REGISTER
// ==========================================
function processAttendance() {
    if (Object.keys(employees).length === 0) {
        showStatus("No registered employee profiles exist in the system database.", false);
        return;
    }
    if (!navigator.geolocation) {
        showStatus("Geolocation engine unavailable on this browser.", false);
        return;
    }

    showStatus("Locating operational coordinates...", true);

    navigator.geolocation.getCurrentPosition(async (position) => {
        const distance = getDistance(position.coords.latitude, position.coords.longitude, OFFICE_LAT, OFFICE_LON);
        if (distance > ALLOWED_RADIUS_KM) {
            showStatus(`Access Denied! You are located outside office limits. (${(distance*1000).toFixed(0)} meters away)`, false);
            return;
        }

        const promptId = prompt("Enter your Employee ID to proceed:");
        const keys = Object.keys(employees);
        const internalId = keys.find(key => employees[key].id === promptId);

        if (!internalId) {
            alert("Employee ID not found in database registry.");
            showStatus("Identity lookup mismatch.", false);
            return;
        }

        // CHOOSE PATHWAY: FIRST-TIME REGISTRATION VS VERIFICATION
        if (!employees[internalId].rawId) {
            // First time logging in -> Register fingerprint
            showStatus(`New Profile Detected! Please touch your fingerprint sensor to register biometrics for ${employees[internalId].name}...`, true);
            const registeredSuccess = await runBiometricRegister(internalId);
            if (registeredSuccess) {
                recordLog(employees[internalId]);
            }
        } else {
            // Already has fingerprint linked -> Verify identity
            showStatus("Location verified. Please touch your fingerprint sensor to check-in/out...", true);
            const verifiedSuccess = await runBiometricVerification(internalId);
            if (verifiedSuccess) {
                recordLog(employees[internalId]);
            } else {
                showStatus("Biometric verification rejected or canceled.", false);
            }
        }
    }, () => {
        showStatus("Failed to access location parameter metrics. Check browser permissions.", false);
    }, { enableHighAccuracy: true });
}

// SELF-REGISTRATION PIPELINE (FIRST LOGIN)
async function runBiometricRegister(internalId) {
    if (!window.PublicKeyCredential) {
        showStatus("Biometrics engine not supported on this platform.", false);
        return false;
    }
    try {
        const emp = employees[internalId];
        const publicKeyCredentialCreationOptions = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: "Office Attendance System" },
            user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: emp.id,
                displayName: emp.name
            },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }],
            authenticatorSelection: {
                authenticatorAttachment: "platform",
                userVerification: "required"
            },
            timeout: 60000
        };

        const credential = await navigator.credentials.create({ publicKey: publicKeyCredentialCreationOptions });
        if (credential) {
            const rawIdArray = Array.from(new Uint8Array(credential.rawId));
            employees[internalId].rawId = rawIdArray; // Save token directly to profile
            localStorage.setItem('db_employees', JSON.stringify(employees));
            return true;
        }
    } catch (err) {
        console.error("Self-registration error:", err);
        showStatus("Biometric registration pipeline failure. Check safe contexts (HTTPS/Localhost).", false);
    }
    return false;
}

// BIOMETRIC VERIFICATION (SUBSEQUENT LOGINS)
async function runBiometricVerification(internalId) {
    try {
        const savedRawId = new Uint8Array(employees[internalId].rawId);
        const publicKeyAllowOptions = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            allowCredentials: [{
                id: savedRawId,
                type: 'public-key',
                transports: ['internal']
            }],
            userVerification: 'required',
            timeout: 60000
        };

        const assertion = await navigator.credentials.get({ publicKey: publicKeyAllowOptions });
        if (assertion) return true;
    } catch (err) {
        console.error("Biometric Verification Error: ", err);
    }
    return false;
}

function recordLog(employee) {
    const now = new Date();
    const todayStr = now.toLocaleDateString();
    const actionsToday = attendanceLog.filter(log => log.id === employee.id && log.date === todayStr);
    const mode = actionsToday.length % 2 === 0 ? "Check-In" : "Check-Out";

    attendanceLog.push({ id: employee.id, name: employee.name, date: todayStr, time: now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}), status: mode });
    localStorage.setItem('db_attendance', JSON.stringify(attendanceLog));
    showStatus(`✅ Verified: ${employee.name} (${employee.id}) logged as [${mode}] at ${now.toLocaleTimeString()}`, true);
}

// ==========================================
// ADMIN DASHBOARD CORE METRIC CALCULATIONS
// ==========================================
function updateAdminDashboard() {
    updateEmployeeTable();
    
    const todayStr = new Date().toLocaleDateString();
    const totalEmpCount = Object.keys(employees).length;
    const logsToday = attendanceLog.filter(log => log.date === todayStr);
    
    const presentEmployees = new Set(logsToday.map(log => log.id));
    const presentCount = presentEmployees.size;
    const absentCount = Math.max(0, totalEmpCount - presentCount);

    document.getElementById('statTotalEmployees').innerText = totalEmpCount;
    document.getElementById('statPresentToday').innerText = presentCount;
    document.getElementById('statAbsentToday').innerText = absentCount;

    const liveLogBody = document.getElementById('liveLogTableBody');
    if(liveLogBody) {
        liveLogBody.innerHTML = '';
        if (logsToday.length === 0) {
            liveLogBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888;">No transactions registered today yet.</td></tr>`;
        } else {
            [...logsToday].reverse().forEach(log => {
                const row = document.createElement('tr');
                const badgeClass = log.status === 'Check-In' ? 'badge check-in' : 'badge check-out';
                row.innerHTML = `
                    <td>${log.id}</td>
                    <td>${log.name}</td>
                    <td>${log.time}</td>
                    <td><span class="${badgeClass}">${log.status}</span></td>
                `;
                liveLogBody.appendChild(row);
            });
        }
    }
}

// ==========================================
// ADMIN CRUD DATA MANAGEMENT
// ==========================================
function saveEmployeeData() {
    const id = document.getElementById('empID').value.trim();
    const name = document.getElementById('empName').value.trim();
    const editCredId = document.getElementById('editCredId').value;

    if (!id || !name) {
        showStatus("All fields are strictly required for validation parameters.", false);
        return;
    }

    if (!editCredId) {
        const keys = Object.keys(employees);
        const existingEmp = keys.find(key => employees[key].id === id);
        if (existingEmp) {
            showStatus(`Error: Employee ID '${id}' is already assigned to ${employees[existingEmp].name}.`, false);
            return;
        }
    }

    if (editCredId) {
        employees[editCredId].id = id;
        employees[editCredId].name = name;
        showStatus(`Successfully updated information for: ${name}`, true);
        cancelEditMode();
    } else {
        const targetPseudoId = "cred_" + Math.random().toString(36).substr(2, 9);
        employees[targetPseudoId] = { id: id, name: name, rawId: null };
        showStatus(`Profile registered! ${name} can now scan their finger on their first login attempt.`, true);
    }

    localStorage.setItem('db_employees', JSON.stringify(employees));
    clearFormInputs();
    updateAdminDashboard();
}

function updateEmployeeTable() {
    const tbody = document.getElementById('employeeTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const keys = Object.keys(employees);
    if (keys.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#666;">No profiles configured.</td></tr>`;
        return;
    }

    keys.forEach(key => {
        const emp = employees[key];
        const statusBadge = emp.rawId ? `<span class="badge check-in">Linked</span>` : `<span class="badge check-out">Pending Registration</span>`;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${emp.id}</td>
            <td>${emp.name}</td>
            <td>${statusBadge}</td>
            <td>
                <span class="action-link" onclick="startEditMode('${key}')">Modify</span>
                <span class="action-link delete" onclick="deleteEmployee('${key}')">Delete</span>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function startEditMode(credId) {
    const emp = employees[credId];
    document.getElementById('editCredId').value = credId;
    document.getElementById('empID').value = emp.id;
    document.getElementById('empName').value = emp.name;
    
    document.getElementById('formTitle').innerText = "✏️ Modify Employee Record";
    document.getElementById('btnSubmit').innerText = "Update Info";
    document.getElementById('btnCancelEdit').style.display = "block";
}

function cancelEditMode() {
    clearFormInputs();
    document.getElementById('editCredId').value = '';
    document.getElementById('formTitle').innerText = "👤 Add New Employee Account";
    document.getElementById('btnSubmit').innerText = "Save Profile Data";
    document.getElementById('btnCancelEdit').style.display = "none";
}

function deleteEmployee(credId) {
    if (confirm(`Confirming deletion sequence logic parameters for profile object: ${employees[credId].name}?`)) {
        delete employees[credId];
        localStorage.setItem('db_employees', JSON.stringify(employees));
        updateAdminDashboard();
        showStatus("The targeted account file data parameter has been successfully scrubbed.", true);
    }
}

function clearFormInputs() {
    document.getElementById('empID').value = '';
    document.getElementById('empName').value = '';
}

// ==========================================
// EXPORT AND RESET UTILITIES
// ==========================================
function downloadSheet() {
    if (attendanceLog.length === 0) {
        alert("The system logs remain blank. No records available for export compilation.");
        return;
    }
    let csv = "data:text/csv;charset=utf-8,Employee ID,Name,Date,Time,Status\n";
    attendanceLog.forEach(r => csv += `"${r.id}","${r.name}","${r.date}","${r.time}","${r.status}"\n`);
    
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function clearAllData() {
    if (confirm("CRITICAL WARNING: This completely wipes out both the Employee Directory and all historic records. Proceed?")) {
        localStorage.clear();
        employees = {};
        attendanceLog = [];
        updateAdminDashboard();
        switchView('employee');
        showStatus("All localized registry databases purged.", false);
    }
}