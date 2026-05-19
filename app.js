// --- CORE CONFIGURATION SETUP ---
const OFFICE_LAT = 23.7926166;       
const OFFICE_LON = 90.4141156;       
const ALLOWED_RADIUS_KM = 0.1;    // 100 meters restriction zone
const ADMIN_PASSWORD = "admin123"; 

// Centralized credentials linked directly to your Supabase project instance
const SUPABASE_URL = "https://ibwqhkhoysrjcliplhlu.supabase.co";
const SUPABASE_KEY = "sb_publishable_qdGSgzFt-leoTCUfukCveA_17edgX7j"; 

// Create client reference instance globally
const { createClient } = supabase;
const _supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// DOM Initializer: Check persistent session token immediately when the page loads
document.addEventListener("DOMContentLoaded", async () => {
    const isAdminLoggedIn = sessionStorage.getItem("admin_authenticated");
    if (isAdminLoggedIn === "true") {
        // Silently transition into admin view without re-prompting for password
        executeViewSwitch('admin'); 
    } else {
        executeViewSwitch('employee');
    }
    await checkDatabaseConnection();
});

// --- DIAGNOSTICS & LOGGING ---
async function checkDatabaseConnection() {
    const statusEl = document.getElementById('dbStatus');
    try {
        const { error } = await _supabase.from('employees').select('id', { count: 'exact', head: true });
        if (error) throw error;
        if (statusEl) {
            statusEl.innerText = "● Database Connected";
            statusEl.className = "db-status success";
        }
    } catch (err) {
        if (statusEl) {
            statusEl.innerText = "● Database Disconnected";
            statusEl.className = "db-status error";
        }
        logError("Connection Error: " + err.message);
    }
}

function logError(message) {
    console.error(message);
    const consoleEl = document.getElementById('errorConsole');
    if (consoleEl) {
        consoleEl.style.display = 'block';
        const entry = document.createElement('div');
        entry.style.borderBottom = "1px solid #333";
        entry.style.padding = "4px 0";
        entry.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
        consoleEl.appendChild(entry);
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

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
function processAttendance(action) { // 👈 Make sure 'action' is received here
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
            .eq('employee_id', promptId.trim())
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
                // If they have no action history, default them to check-in on registration success
                await processAttendanceEvent(employee, action || 'check-in'); 
            }
        } else {
            showStatus("Location verified. Please touch your fingerprint sensor to check-in/out...", true);
            const verifiedSuccess = await runBiometricVerification(employee);
            if (verifiedSuccess) {
                // 📊 Fixed: Calling the correct event routing engine
                await processAttendanceEvent(employee, action); 
            } else {
                showStatus("Biometric verification rejected or canceled.", false);
            }
        }
    }, () => {
        showStatus("Failed to access location parameter metrics. Check browser permissions.", false);
    }, { enableHighAccuracy: true });
}

// New function for biometric registration
async function processRegistration() {
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

        const promptId = prompt("Enter your Employee ID to proceed with registration:");
        if(!promptId) return;

        const { data: employee, error: empError } = await _supabase
            .from('employees')
            .select('*')
            .eq('employee_id', promptId.trim())
            .maybeSingle();

        if (empError || !employee) {
            alert("Employee ID not found in centralized cloud registry database.");
            showStatus("Identity lookup mismatch.", false);
            return;
        }

        if (employee.raw_id) {
            showStatus(`${employee.name} already has biometrics registered.`, false);
            return;
        }

        showStatus(`Please touch your fingerprint sensor to register biometrics for ${employee.name}...`, true);
        const registeredSuccess = await runBiometricRegister(employee);
        if (registeredSuccess) {
            showStatus(`✅ Biometrics registered successfully for ${employee.name}!`, true);
            await updateAdminDashboard();
        } else {
            showStatus("Biometric registration rejected or canceled.", false);
        }
    }, () => {
        showStatus("Failed to access location parameter metrics. Check browser permissions.", false);
    }, { enableHighAccuracy: true });
}

// Renamed and modified from original recordLog
async function processAttendanceEvent(employee, action) {
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const startOfDay = `${todayStr}T00:00:00Z`;
    const endOfDay = `${todayStr}T23:59:59Z`;

    let statusMessage = '';
    let isSuccess = false;
    let dbError = null;

    // Logic for check-in
    if (action === 'check-in') {
        // Check if already checked in today
        const { data: existingCheckIn, error: checkInQueryError } = await _supabase
            .from('check_ins')
            .select('id')
            .eq('employee_id', employee.id)
            .gte('timestamp', startOfDay)
            .lte('timestamp', endOfDay)
            .maybeSingle();

        if (checkInQueryError && checkInQueryError.code !== 'PGRST116') { // PGRST116 means "no rows found"
            logError('Supabase query error (check-in check): ' + checkInQueryError.message);
            statusMessage = `Error checking previous check-in status: ${checkInQueryError.message}`; // FIX: Added error message
        } else if (existingCheckIn) {
            statusMessage = `${employee.name} is already checked IN today.`;
        } else {
            const { error } = await _supabase
                .from('check_ins')
                .insert([{ employee_id: employee.id, timestamp: now.toISOString() }]);
            if (!error) {
                statusMessage = `✅ Check-In Verified: ${employee.name} at ${now.toLocaleTimeString()}`;
                isSuccess = true;
            } else {
                dbError = error;
                statusMessage = `Error saving Check-In record: ${error.message}`;
                logError('Supabase insert error (check-in): ' + error.message);
            }
        }
    }
    // Logic for check-out
    else if (action === 'check-out') {
        // Check if checked in today
        const { data: existingCheckIn, error: checkInQueryError } = await _supabase
            .from('check_ins')
            .select('id')
            .eq('employee_id', employee.id)
            .gte('timestamp', startOfDay)
            .lte('timestamp', endOfDay)
            .maybeSingle();

        if (checkInQueryError && checkInQueryError.code !== 'PGRST116') {
            logError('Supabase query error (check-in check for checkout): ' + checkInQueryError.message);
            statusMessage = `Error checking previous check-in status for check-out: ${checkInQueryError.message}`; // FIX: Added error message
        } else if (!existingCheckIn) {
            statusMessage = `${employee.name} has not checked IN today.`;
        } else {
            // Check if already checked out today
            const { data: existingCheckOut, error: checkOutQueryError } = await _supabase
                .from('check_outs')
                .select('id')
                .eq('employee_id', employee.id)
                .gte('timestamp', startOfDay)
                .lte('timestamp', endOfDay)
                .maybeSingle();

            if (checkOutQueryError && checkOutQueryError.code !== 'PGRST116') {
                logError('Supabase query error (check-out check): ' + checkOutQueryError.message);
                statusMessage = `Error checking previous check-out status: ${checkOutQueryError.message}`; // FIX: Added error message
            } else if (existingCheckOut) {
                statusMessage = `${employee.name} is already checked OUT today.`;
            } else {
                const { error } = await _supabase
                    .from('check_outs')
                    .insert([{ employee_id: employee.id, timestamp: now.toISOString() }]);
                if (!error) {
                    statusMessage = `✅ Check-Out Verified: ${employee.name} at ${now.toLocaleTimeString()}`;
                    isSuccess = true;
                } else {
                    dbError = error;
                    statusMessage = `Error saving Check-Out record: ${error.message}`;
                    logError('Supabase insert error (check-out): ' + error.message);
                }
            }
        }
    } else {
        statusMessage = 'Invalid attendance action.';
    }

    showStatus(statusMessage, isSuccess);
    await updateAdminDashboard();
}

// SELF-REGISTRATION PIPELINE
async function runBiometricRegister(employee) {
    try {
        const publicKeyCredentialCreationOptions = {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { name: "Attendance System", id: window.location.hostname || "localhost" },
            user: {
                id: crypto.getRandomValues(new Uint8Array(16)),
                name: employee.employee_id,
                displayName: employee.name,
            },
            pubKeyCredParams: [{ alg: -7, type: "public-key" }, { alg: -257, type: "public-key" }],
            authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
            timeout: 60000,
            attestation: "none"
        };

        const credential = await navigator.credentials.create({ publicKey: publicKeyCredentialCreationOptions });
        if (credential) {
            // Convert ArrayBuffer to Array for storage
            const rawId = Array.from(new Uint8Array(credential.rawId));
            const { error } = await _supabase
                .from('employees')
                .update({ raw_id: rawId })
                .eq('id', employee.id);
            
            if (error) throw error;
            return true;
        }
    } catch (err) {
        logError("Biometric Registration Error: " + err.message);
        if (err.name === 'NotAllowedError') {
            alert("Registration timed out or was canceled. Please try again.");
        }
    }
    return false;
}

// BIOMETRIC VERIFICATION (SUBSEQUENT LOGINS)
async function runBiometricVerification(employee) {
    try {
        // Ensure raw_id is correctly formatted as Uint8Array
        const savedRawId = new Uint8Array(Object.values(employee.raw_id));
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
        logError("Biometric Verification Error: " + err.message);
        showStatus(`Hardware reader error: ${err.message}`, false); // FIX: Added status message
    }
    return false;
}

// ==========================================
// ADMIN DASHBOARD CORE METRIC CALCULATIONS
// ==========================================
async function updateAdminDashboard() {
    // 1. Refresh Directories Table Display UI
    updateEmployeeTable();
    
    const todayStr = new Date().toISOString().split('T')[0];
    const startOfDay = `${todayStr}T00:00:00Z`;
    const endOfDay = `${todayStr}T23:59:59Z`;

    // 2. Fetch all registered employees
    const { data: allEmployees, error: allEmpError } = await _supabase.from('employees').select('id');
    if (allEmpError) logError('Error fetching all employees: ' + allEmpError.message);
    const totalEmpCount = allEmployees ? allEmployees.length : 0;

    // 3. Fetch today's data from both tables
    const { data: ins, error: insError } = await _supabase.from('check_ins').select('*, employees(name, employee_id)').gte('timestamp', startOfDay).lte('timestamp', endOfDay); // FIX: Added employee_id to select
    if (insError) logError('Error fetching check-ins: ' + insError.message);
    const { data: outs, error: outsError } = await _supabase.from('check_outs').select('*, employees(name, employee_id)').gte('timestamp', startOfDay).lte('timestamp', endOfDay); // FIX: Added employee_id to select
    if (outsError) logError('Error fetching check-outs: ' + outsError.message);

    // Combine and normalize for the live feed
    const combinedLogs = [
        ...(ins || []).map(i => ({ 
            employee_id: i.employees?.employee_id || 'Unknown ID', // FIX: Use human-readable employee_id
            name: i.employees?.name || 'Unknown', 
            time: new Date(i.timestamp).toLocaleTimeString(), 
            status: 'Check-In', 
            raw_time: i.timestamp 
        })),
        ...(outs || []).map(o => ({ 
            employee_id: o.employees?.employee_id || 'Unknown ID', // FIX: Use human-readable employee_id
            name: o.employees?.name || 'Unknown', 
            time: new Date(o.timestamp).toLocaleTimeString(), 
            status: 'Check-Out', 
            raw_time: o.timestamp 
        }))
    ].sort((a, b) => new Date(b.raw_time) - new Date(a.raw_time));

    // FIX: Calculate present count based on unique employee_ids from check_ins
    const presentEmployeesSet = new Set();
    (ins || []).forEach(i => presentEmployeesSet.add(i.employee_id));
    const presentCount = presentEmployeesSet.size;

    const absentCount = Math.max(0, totalEmpCount - presentCount);

    if(document.getElementById('statTotalEmployees')) {
        document.getElementById('statTotalEmployees').innerText = totalEmpCount;
        document.getElementById('statPresentToday').innerText = presentCount;
        document.getElementById('statAbsentToday').innerText = absentCount;
    }

    const liveLogBody = document.getElementById('liveLogTableBody');
    if(liveLogBody) {
        liveLogBody.innerHTML = '';
        if (combinedLogs.length === 0) {
            liveLogBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#888;">No transactions registered today yet.</td></tr>`;
        } else {
            combinedLogs.forEach(log => {
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
    const empIDInput = document.getElementById('empID').value.trim(); // This is the human-readable ID
    const name = document.getElementById('empName').value.trim();
    const editCredId = document.getElementById('editCredId').value;

    if (!empIDInput || !name) {
        showStatus("All fields are strictly required for validation parameters.", false);
        return;
    }

    if (!editCredId) {
        // Query database directly to check for collisions
        const { data: collision, error: collisionError } = await _supabase
            .from('employees')
            .select('employee_id')
            .eq('employee_id', empIDInput)
            .maybeSingle();

        if (collisionError) {
            logError('Error checking for employee ID collision: ' + collisionError.message);
            showStatus(`Error checking for employee ID collision: ${collisionError.message}`, false);
            return;
        }
        if (collision) {
            showStatus(`Error: Employee ID '${empIDInput}' is already used.`, false);
            return;
        }

        // Insert fresh placeholder profile row instance configuration object context
        // FIX: Insert employee_id and name, let 'id' (UUID) be auto-generated
        const { error } = await _supabase.from('employees').insert([{ employee_id: empIDInput, name: name, raw_id: null }]);
        if (error) {
            logError('Error inserting new employee: ' + error.message);
            showStatus(`Error inserting new employee: ${error.message}`, false);
        } else {
            showStatus(`Profile registered! ${name} (ID: ${empIDInput}) can now scan their finger on their first login attempt.`, true);
        }
    } else {
        // Perform inline data update operation transformations 
        const { error } = await _supabase
            .from('employees')
            .update({ employee_id: empIDInput, name: name })
            .eq('id', editCredId);
        if (error) {
            logError('Error updating employee: ' + error.message);
            showStatus(`Error updating employee: ${error.message}`, false);
        } else {
            showStatus(`Successfully updated information for: ${name} (ID: ${empIDInput})`, true);
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
    
    // FIX: Select both 'id' (UUID) and 'employee_id' (human-readable)
    const { data: dbProfiles, error: fetchError } = await _supabase.from('employees').select('id, employee_id, name, raw_id').order('created_at');
    if (fetchError) logError('Error fetching employee profiles: ' + fetchError.message);
    
    if (!dbProfiles || dbProfiles.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:#666;">No profiles configured.</td></tr>`;
        return;
    }

    dbProfiles.forEach(emp => {
        const statusBadge = emp.raw_id ? `<span class="badge check-in">Linked</span>` : `<span class="badge check-out">Pending Registration</span>`;
        const row = document.createElement('tr'); 
        row.innerHTML = ` 
            <td>${emp.employee_id}</td> <!-- FIX: Display human-readable employee_id -->
            <td>${emp.name}</td>
            <td>${statusBadge}</td>
            <td> 
                <span class="action-link" onclick="startEditMode('${emp.id}', '${emp.employee_id}', '${emp.name}')">Modify</span> <!-- FIX: Pass UUID for editCredId -->
                <span class="action-link delete" onclick="deleteEmployee('${emp.id}', '${emp.name}')">Delete</span>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function startEditMode(uuid, empId, name) { // FIX: Added uuid parameter
    document.getElementById('editCredId').value = uuid; // Store UUID for update operation
    document.getElementById('empID').value = empId; // Display human-readable ID
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

async function deleteEmployee(id, name) { // 'id' here is the UUID
    if (confirm(`Confirming deletion sequence logic parameters for profile object: ${name}?`)) {
        const { error } = await _supabase.from('employees').delete().eq('id', id); // Delete by UUID
        if (error) {
            logError('Error deleting employee: ' + error.message);
            showStatus(`Error deleting employee: ${error.message}`, false);
        } else {
            await updateAdminDashboard(); // Await to ensure dashboard reflects changes
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
    // FIX: Select both 'name' and 'employee_id' from employees table
    const { data: ins, error: insError } = await _supabase.from('check_ins').select('*, employees(name, employee_id)');
    if (insError) logError('Error fetching all check-ins for export: ' + insError.message);

    const { data: outs, error: outsError } = await _supabase.from('check_outs').select('*, employees(name, employee_id)');
    if (outsError) logError('Error fetching all check-outs for export: ' + outsError.message);

    if ((!ins || ins.length === 0) && (!outs || outs.length === 0)) { // FIX: Check for empty arrays
        alert("The system logs remain blank. No records available for export compilation.");
        return;
    }

    const allData = [
        ...(ins || []).map(i => ({ ...i, type: 'Check-In' })),
        ...(outs || []).map(o => ({ ...o, type: 'Check-Out' }))
    ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    let csv = "data:text/csv;charset=utf-8,Employee ID,Name,Date,Time,Status\n";
    allData.forEach(r => {
        const dt = new Date(r.timestamp);
        const empId = r.employees?.employee_id || r.employee_id;
        const empName = r.employees?.name || "Unknown";
        csv += `"${empId}","${empName}","${dt.toLocaleDateString()}","${dt.toLocaleTimeString()}","${r.type}"\n`;
    });
    
    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csv));
    link.setAttribute("download", `Attendance_Export_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

async function clearAllData() {
    if (confirm("CRITICAL WARNING: This completely wipes out both the Employee Directory and all historic records. Proceed?")) {
        // Delete all check-ins and check-outs first to avoid foreign key constraint issues
        const { error: checkInsDeleteError } = await _supabase.from('check_ins').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
        if (checkInsDeleteError) console.error('Error deleting check-ins:', checkInsDeleteError);
        const { error: checkOutsDeleteError } = await _supabase.from('check_outs').delete().neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows
        if (checkOutsDeleteError) console.error('Error deleting check-outs:', checkOutsDeleteError);

        // Cascade delete configuration parameters will empty the log entries automatically
        const { data: list, error: empListError } = await _supabase.from('employees').select('id');
        if (empListError) console.error('Error fetching employee IDs for deletion:', empListError);

        if (list && list.length > 0) {
            const ids = list.map(item => item.id);
            const { error: empDeleteError } = await _supabase.from('employees').delete().in('id', ids); // Delete by UUID
            if (empDeleteError) {
                console.error('Error deleting employees:', empDeleteError);
            }
        }
        
        sessionStorage.removeItem("admin_authenticated"); // Destroy local session token
        await updateAdminDashboard();
        executeViewSwitch('employee');
        showStatus("All database entries successfully purged from Supabase.", false);
    }
}
