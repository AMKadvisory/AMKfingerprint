// --- CORE CONFIGURATION SETUP ---
const OFFICE_LAT = 23.7926166;       
const OFFICE_LON = 90.4141156;       
const ALLOWED_RADIUS_KM = 0.1;    // 100 meters restriction zone
const ADMIN_PASSWORD = "amk2026"; 

// Centralized credentials linked directly to your Supabase project instance
const SUPABASE_URL = "https://idhqqygtfbjcwerkywgn.supabase.co";
const SUPABASE_KEY = "sb_publishable_KOfqg9CslH0Jvg8PphT6aA_jVklvK-U"; 

// Create client reference instance globally
const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Runtime local cache references
let attendanceLogLocal = [];

// DOM Initializer: Check persistent session token immediately when the page loads
document.addEventListener("DOMContentLoaded", () => {
    const isAdminLoggedIn = sessionStorage.getItem("admin_authenticated");
    if (isAdminLoggedIn === "true") {
        // Silently transition into admin view without re-prompting for password
        executeViewSwitch('admin'); 
    } else {
        executeViewSwitch('employee');
    }
});

// --- ROUTING MANAGER ---
function switchView(target) {
    if (target === 'admin') {
        // If already validated in this tab session, skip password check
        if (sessionStorage.getItem("admin_authenticated") === "true") {
            executeViewSwitch('admin');
            return;
        }

        const passwordCheck = prompt("Enter Administration Security Password:");
        if (passwordCheck === ADMIN_PASSWORD) {
            sessionStorage.setItem("admin_authenticated", "true"); // Save session state
            executeViewSwitch('admin');
            showStatus("Admin verification successful.", true);
        } else {
            alert("Unauthorized Access. Invalid password.");
        }
    } else {
        // Clear session state if they explicitly choose to shift back to Employee Mode
        sessionStorage.removeItem("admin_authenticated"); 
        executeViewSwitch('employee');
    }
}

// Internal function to switch UI panels
function executeViewSwitch(view) {
    const empInterface = document.getElementById('employeeInterface');
    const adminInterface = document.getElementById('adminInterface');
    const btnEmp = document.getElementById('btnEmpView');
    const btnAdmin = document.getElementById('btnAdminView');

    if (view === 'admin') {
        if(empInterface) empInterface.style.display = 'none';
        if(adminInterface) adminInterface.style.display = 'block';
        if(btnEmp) btnEmp.classList.remove('active');
        if(btnAdmin) btnAdmin.classList.add('active');
        updateAdminDashboard();
    } else {
        if(empInterface) empInterface.style.display = 'block';
        if(adminInterface) adminInterface.style.display = 'none';
        if(btnEmp) btnEmp.classList.add('active');
        if(btnAdmin) btnAdmin.classList.remove('active');
    }
}

// Haversine formula calculation for geo-fencing verification
function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; 
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) * Math.sin(dLon/2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))); 
}

function showStatus(message, isSuccess) {
    const box = document.getElementById('statusBox');
    if(box) {
        box.style.display = 'block';
        box.className = `status ${isSuccess ? 'success' : 'error'}`;
        box.innerText = message;
    }
    window.scrollTo({top: 0, behavior: 'smooth'});
}

// ==========================================
// EMPLOYEE VIEW: ATTENDANCE & SELF-REGISTER
// ==========================================
function processAttendance() {
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
        if(!promptId) return;

        // DB Query lookup checking profile presence
        const { data: employee, error } = await _supabase
            .from('employees')
            .select('*')
            .eq('id', promptId.trim())
            .maybeSingle();

        if (error || !employee) {
            alert("Employee ID not found in centralized cloud registry database.");
            showStatus("Identity lookup mismatch.", false);
            return;
        }

        // PATHWAYS DEPENDING ON THE EXTREME RAW BIOMETRIC TOKEN STATUS
        if (!employee.raw_id) {
            showStatus(`New Profile Detected! Please touch your fingerprint sensor to register biometrics for ${employee.name}...`, true);
            const registeredSuccess = await runBiometricRegister(employee);
            if (registeredSuccess) {
                recordLog(employee);
            }
        } else {
            showStatus("Location verified. Please touch your fingerprint sensor to check-in/out...", true);
            const verifiedSuccess = await runBiometricVerification(employee);
            if (verifiedSuccess) {
                recordLog(employee);
            } else {
                showStatus("Biometric verification rejected or canceled.", false);
            }
        }
    }, () => {
        showStatus("Failed to access location parameter metrics. Check browser permissions.", false);
    }, { enableHighAccuracy: true });
}

// SELF-REGISTRATION PIPELINE (FIRST LOGIN)
async function runBiometricRegister(employee) {
    if (!window.PublicKeyCredential) {
        showStatus("Biometrics engine not supported on this platform.", false);
        return false;
    }
    try {
        const publicKeyCredentialCreationOptions = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: "Office Attendance System" },
            user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: employee.id,
                displayName: employee.name
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
            
            // Push hardware token configuration array up to Supabase Row Object
            await _supabase
                .from('employees')
                .update({ raw_id: rawIdArray })
                .eq('id', employee.id);

            return true;
        }
    } catch (err) {
        console.error("Self-registration error:", err);
        showStatus("Biometric registration pipeline failure. Check your security constraints (HTTPS required).", false);
    }
    return false;
}

// BIOMETRIC VERIFICATION (SUBSEQUENT LOGINS)
async function runBiometricVerification(employee) {
    try {
        const savedRawId = new Uint8Array(employee.raw_id);
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

async function recordLog(employee) {
    const now = new Date();
    const todayStr = now.toLocaleDateString();
    
    // Check total actions committed today by this targeted asset to toggle action status
    const { data: logs } = await _supabase
        .from('attendance_log')
        .select('id')
        .eq('employee_id', employee.id)
        .eq('date', todayStr);

    const countToday = logs ? logs.length : 0;
    const mode = countToday % 2 === 0 ? "Check-In" : "Check-Out";

    const payload = { 
        employee_id: employee.id, 
        name: employee.name, 
        date: todayStr, 
        time: now.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'}), 
        status: mode 
    };

    const { error } = await _supabase.from('attendance_log').insert([payload]);
    if(!error) {
        showStatus(`✅ Verified: ${employee.name} (${employee.id}) logged as [${mode}] at ${now.toLocaleTimeString()}`, true);
    } else {
        showStatus("Error pushing transactional logging record up to cloud database server.", false);
    }
}

// ==========================================
// ADMIN DASHBOARD CORE METRIC CALCULATIONS
// ==========================================
async function updateAdminDashboard() {
    // 1. Refresh Directories Table Display UI
    updateEmployeeTable();
    
    const todayStr = new Date().toLocaleDateString();

    // 2. Fetch all registered employees
    const { data: allEmployees } = await _supabase.from('employees').select('id');
    const totalEmpCount = allEmployees ? allEmployees.length : 0;

    // 3. Fetch today's transaction items logs directly from cloud row entities
    const { data: logsToday } = await _supabase
        .from('attendance_log')
        .select('*')
        .eq('date', todayStr);

    const actualLogs = logsToday || [];
    const presentEmployees = new Set(actualLogs.map(log => log.employee_id));
    const presentCount = presentEmployees.size;
    const absentCount = Math.max(0, totalEmpCount - presentCount);

    // Update Metrics Dashboard elements safely if active inside UI layer context
    if(document.getElementById('statTotalEmployees')) {
        document.getElementById('statTotalEmployees').innerText = totalEmpCount;
        document.getElementById('statPresentToday').innerText = presentCount;
        document.getElementById('statAbsentToday').innerText = absentCount;
    }

    const liveLogBody = document.getElementById('liveLogTableBody');
    if(liveLogBody) {
        liveLogBody.innerHTML = '';
        if (actualLogs.length === 0) {
            liveLogBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888;">No transactions registered today yet.</td></tr>`;
        } else {
            // Sort to display newest transactions first
            [...actualLogs].reverse().forEach(log => {
                const row = document.createElement('tr');
                const badgeClass = log.status === 'Check-In' ? 'badge check-in' : 'badge check-out';
                row.innerHTML = `
                    <td>${log.employee_id}</td>
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
async function saveEmployeeData() {
    const id = document.getElementById('empID').value.trim();
    const name = document.getElementById('empName').value.trim();
    const editCredId = document.getElementById('editCredId').value;

    if (!id || !name) {
        showStatus("All fields are strictly required for validation parameters.", false);
        return;
    }

    if (!editCredId) {
        // Query database directly to check for collisions
        const { data: collision } = await _supabase
            .from('employees')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (collision) {
            showStatus(`Error: Employee ID '${id}' is already assigned to an account inside database metrics.`, false);
            return;
        }

        // Insert fresh placeholder profile row instance configuration object context
        const { error } = await _supabase.from('employees').insert([{ id, name, raw_id: null }]);
        if(!error) showStatus(`Profile registered! ${name} can now scan their finger on their first login attempt.`, true);
    } else {
        // Perform inline data update operation transformations 
        const { error } = await _supabase
            .from('employees')
            .update({ id: id, name: name })
            .eq('id', editCredId);

        if(!error) {
            showStatus(`Successfully updated information for: ${name}`, true);
            cancelEditMode();
        }
    }

    clearFormInputs();
    updateAdminDashboard();
}

async function updateEmployeeTable() {
    const tbody = document.getElementById('employeeTableBody');
    if(!tbody) return;
    tbody.innerHTML = '';
    
    const { data: dbProfiles } = await _supabase.from('employees').select('*').order('created_at');
    
    if (!dbProfiles || dbProfiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#666;">No profiles configured.</td></tr>`;
        return;
    }

    dbProfiles.forEach(emp => {
        const statusBadge = emp.raw_id ? `<span class="badge check-in">Linked</span>` : `<span class="badge check-out">Pending Registration</span>`;
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${emp.id}</td>
            <td>${emp.name}</td>
            <td>${statusBadge}</td>
            <td>
                <span class="action-link" onclick="startEditMode('${emp.id}', '${emp.name}')">Modify</span>
                <span class="action-link delete" onclick="deleteEmployee('${emp.id}', '${emp.name}')">Delete</span>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function startEditMode(id, name) {
    document.getElementById('editCredId').value = id;
    document.getElementById('empID').value = id;
    document.getElementById('empName').value = name;
    
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

async function deleteEmployee(id, name) {
    if (confirm(`Confirming deletion sequence logic parameters for profile object: ${name}?`)) {
        const { error } = await _supabase.from('employees').delete().eq('id', id);
        if(!error) {
            updateAdminDashboard();
            showStatus("The targeted account file data parameter has been successfully scrubbed.", true);
        }
    }
}

function clearFormInputs() {
    document.getElementById('empID').value = '';
    document.getElementById('empName').value = '';
}

// ==========================================
// EXPORT AND RESET UTILITIES
// ==========================================
async function downloadSheet() {
    const { data: fullLogs } = await _supabase.from('attendance_log').select('*');

    if (!fullLogs || fullLogs.length === 0) {
        alert("The system logs remain blank. No records available for export compilation.");
        return;
    }
    let csv = "data:text/csv;charset=utf-8,Employee ID,Name,Date,Time,Status\n";
    fullLogs.forEach(r => csv += `"${r.employee_id}","${r.name}","${r.date}","${r.time}","${r.status}"\n`);
    
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function clearAllData() {
    if (confirm("CRITICAL WARNING: This completely wipes out both the Employee Directory and all historic records. Proceed?")) {
        // Cascade delete configuration parameters will empty the log entries automatically
        const { data: list } = await _supabase.from('employees').select('id');
        if (list && list.length > 0) {
            const ids = list.map(item => item.id);
            await _supabase.from('employees').delete().in('id', ids);
        }
        
        sessionStorage.removeItem("admin_authenticated"); // Destroy local session token
        updateAdminDashboard();
        executeViewSwitch('employee');
        showStatus("All database entries successfully purged from Supabase.", false);
    }
}
