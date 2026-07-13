// =======================================================================
// control.js — logic for control.html
//
// WHY THIS IS A MODULE:
//   The original inline script only called
//   sessionStorage.removeItem('__bq_adm') on logout — it never ended
//   the Supabase session stored in localStorage. That caused a "logout
//   loop": sign-in.html found the live Supabase session on next load
//   and silently re-authenticated. Importing fullSignOut() from
//   adminAuth.js fixes this.
// =======================================================================
import {
    getToken,
    isAdminAuthenticated,
    fullSignOut,
    signInWithSupabase,
} from './adminAuth.js';

const API_URL = '/api/admin-control';

// Module-scoped Supabase client — set once in init(), used in logout()
let _supabaseClient = null;
let _token = getToken();

// The real access code, kept in memory so copy/reveal work even while masked.
// The DOM only ever shows the masked version unless the owner explicitly
// reveals it — this avoids leaking the secret code via screenshots/screen
// shares/recordings by default.
let _realAccessCode = null;

function maskCode(code) {
    return '•'.repeat(Math.max(code.length, 8));
}

// ── Bootstrap ──────────────────────────────────────────────────────────
async function init() {
    // 1. Redirect immediately if no local admin JWT exists
    if (!isAdminAuthenticated()) {
        window.location.href = '/sign-in.html?redirect=/control.html';
        return;
    }

    // 2. Initialize Supabase client for session reconciliation + logout
    try {
        const envRes = await fetch('/api/env');
        const envData = await envRes.json();
        if (envData.supabaseUrl && envData.supabaseAnonKey) {
            _supabaseClient = window.supabase.createClient(
                envData.supabaseUrl,
                envData.supabaseAnonKey
            );

            // 3. Reconcile: if Supabase session exists but our JWT was
            //    wiped (new tab / browser restart), re-derive it from
            //    the live Supabase session. If Supabase session is gone
            //    but JWT still exists, clear the stale JWT.
            const { data: { session } } = await _supabaseClient.auth.getSession();

            if (session && !isAdminAuthenticated()) {
                const ok = await signInWithSupabase(session.access_token);
                if (ok) {
                    _token = getToken();
                } else {
                    window.location.href = '/sign-in.html?redirect=/control.html';
                    return;
                }
            } else if (!session && isAdminAuthenticated()) {
                // Stale JWT with no live Supabase session — clear and redirect
                await fullSignOut(null);
                window.location.href = '/sign-in.html?redirect=/control.html';
                return;
            }
        }
    } catch (err) {
        console.error('[control] Failed to initialize Supabase:', err);
    }

    // Re-read token in case reconciliation updated it
    _token = getToken();

    if (!_token) {
        window.location.href = '/sign-in.html?redirect=/control.html';
        return;
    }

    // 4. Load admin-control data
    loadData();
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_token}`
    };
}

// ── Toast ──────────────────────────────────────────────────────────────
let toastTimer = null;
function showMessage(msg, isError = false) {
    const el = document.getElementById('statusMessage');
    el.textContent = msg;
    el.className = `toast ${isError ? 'error' : 'success'}`;
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.classList.remove('show'); }, 3500);
}

// ── Access code display (masked by default) ─────────────────────────────
function renderAccessCode() {
    const el = document.getElementById('currentCodeDisplay');
    if (_realAccessCode === null) {
        el.textContent = 'جاري التحميل...';
        return;
    }
    const revealed = el.dataset.revealed === 'true';
    el.textContent = revealed ? _realAccessCode : maskCode(_realAccessCode);
}

window.toggleCodeVisibility = function () {
    if (_realAccessCode === null) return;
    const el = document.getElementById('currentCodeDisplay');
    const revealed = el.dataset.revealed === 'true';
    el.dataset.revealed = revealed ? 'false' : 'true';
    renderAccessCode();
};

// ── Data loading ───────────────────────────────────────────────────────
async function loadData() {
    try {
        const res = await fetch(API_URL, { headers: getHeaders() });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                alert('غير مصرح لك بالدخول إلى هذه الصفحة.');
                window.location.href = '/sign-in.html';
                return;
            }
            throw new Error(data.error || 'فشل تحميل البيانات');
        }

        _realAccessCode = data.accessCode;
        renderAccessCode();

        const list = document.getElementById('adminsTableBody');
        list.innerHTML = '';

        if (data.admins.length === 0) {
            list.innerHTML = '<div class="admin-empty">لا يوجد مشرفين</div>';
        } else {
            data.admins.forEach(admin => {
                const date = new Date(admin.created_at).toLocaleDateString('ar-EG');
                const card = document.createElement('div');
                card.className = 'admin-card';
                card.innerHTML = `
                <div class="admin-info">
                    <span class="admin-email">${admin.email}</span>
                    <div class="admin-meta">
                        <span class="admin-meta-item">أُضيف بواسطة: ${admin.added_by}</span>
                        <span class="meta-dot"></span>
                        <span class="admin-meta-item">${date}</span>
                    </div>
                </div>
                <button class="btn-remove" onclick="removeAdmin('${admin.email}')">&#10005;&nbsp;إزالة</button>
            `;
                list.appendChild(card);
            });
        }
    } catch (err) {
        showMessage(err.message, true);
    }
}

// ── Actions ────────────────────────────────────────────────────────────
async function submitChangeCode() {
    const newCode = document.getElementById('newCodeInput').value.trim();
    if (!newCode || newCode.length < 4) {
        showMessage('يجب أن يكون الرمز 4 أحرف على الأقل', true);
        return;
    }

    openConfirmModal({
        icon: '&#9888;',
        title: 'تأكيد تغيير الرمز',
        bodyHtml: `سيتم استبدال رمز الدخول الحالي بالرمز الجديد فورًا، وسيحتاج جميع المستخدمين لاستخدام الرمز الجديد للدخول. هل أنت متأكد؟<span class="modal-email">${newCode}</span>`,
        confirmLabel: 'تحديث الرمز',
        onConfirm: async () => {
            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ action: 'change_code', newCode })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                showMessage('تم تغيير رمز الدخول بنجاح');
                document.getElementById('newCodeInput').value = '';
                loadData();
            } catch (err) {
                showMessage(err.message, true);
            }
        }
    });
}

async function submitAddAdmin() {
    const email = document.getElementById('newAdminEmail').value.trim();
    if (!email) {
        showMessage('يرجى إدخال البريد الإلكتروني', true);
        return;
    }
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
        showMessage('يرجى إدخال بريد إلكتروني صالح', true);
        return;
    }
    try {
        const res = await fetch(API_URL, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ action: 'add_admin', email })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showMessage('تم إضافة المشرف بنجاح');
        document.getElementById('newAdminEmail').value = '';
        loadData();
    } catch (err) {
        showMessage(err.message, true);
    }
}

function closeModal() {
    document.getElementById('confirmModal').classList.remove('show');
}
window.closeModal = closeModal;

// Generic modal opener — fills in icon/title/body/button label and wires
// up the confirm button's action. Used for both "remove admin" and
// "change access code" confirmations so the two flows stay consistent.
function openConfirmModal({ icon = '&#9888;', title, bodyHtml, confirmLabel = 'تأكيد', onConfirm }) {
    document.getElementById('modalIcon').innerHTML = icon;
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    const confirmBtn = document.getElementById('modalConfirmBtn');
    confirmBtn.textContent = confirmLabel;

    const modal = document.getElementById('confirmModal');
    modal.classList.add('show');

    confirmBtn.onclick = async function () {
        closeModal();
        await onConfirm();
    };
}

// Must be on window so inline onclick="removeAdmin(...)" in dynamic HTML works
window.removeAdmin = function (email) {
    openConfirmModal({
        icon: '&#9888;',
        title: 'تأكيد الإزالة',
        bodyHtml: `هل أنت متأكد من إزالة هذا المشرف؟ لا يمكن التراجع عن هذا الإجراء.<span class="modal-email">${email}</span>`,
        confirmLabel: 'إزالة',
        onConfirm: async () => {
            try {
                const res = await fetch(API_URL, {
                    method: 'POST',
                    headers: getHeaders(),
                    body: JSON.stringify({ action: 'remove_admin', email })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error);
                showMessage('تم إزالة المشرف بنجاح');
                loadData();
            } catch (err) {
                showMessage(err.message, true);
            }
        }
    });
};

// Expose functions called by inline HTML onclick attributes
window.submitChangeCode = submitChangeCode;
window.submitAddAdmin = submitAddAdmin;
window.copyCode = function () {
    if (!_realAccessCode) return;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(_realAccessCode).then(() => showMessage('تم نسخ الرمز'));
    }
};

document.getElementById('confirmModal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

// ── Logout — fixes the ghost-session / logout-loop bug ─────────────────
// Old code: sessionStorage.removeItem('__bq_adm') only.
// That never ended the Supabase session in localStorage, so sign-in.html
// would find it on next load and silently re-authenticate.
// fullSignOut() clears BOTH the local JWT AND calls supabaseClient.auth.signOut().
window.logout = async function () {
    try {
        await fullSignOut(_supabaseClient);
    } catch (err) {
        console.error('[control] Error during logout:', err);
    }
    window.location.href = '/sign-in.html';
};

// ── Start ──────────────────────────────────────────────────────────────
init();