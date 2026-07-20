// =============================================================================
// public/src/features/control/control.js — logic for control.html
//
// Manages admin users and displays platform stats for the owner.
// Access-code logic was removed in v6.1 — only email/OAuth auth is supported.
// =============================================================================
import {
    getToken,
    isAdminAuthenticated,
    fullSignOut,
    signInWithSupabase,
} from '../../shared/adminAuth.js';

const API_URL = '/api/admin-control';

// Module-scoped Supabase client — set once in init(), used in logout()
let _supabaseClient = null;
let _token = getToken();

// ── Bootstrap ──────────────────────────────────────────────────────────────────
async function init() {
    // 1. Redirect immediately if no local admin JWT exists
    if (!isAdminAuthenticated()) {
        window.location.href = '/#my-quizzes';
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
                    // Non-admin Supabase session — destroy it and redirect
                    await fullSignOut(_supabaseClient);
                    window.location.href = '/#my-quizzes';
                    return;
                }
            } else if (!session && isAdminAuthenticated()) {
                // Stale JWT with no live Supabase session — clear and redirect
                await fullSignOut(null);
                window.location.href = '/#my-quizzes';
                return;
            }
        }
    } catch (err) {
        console.error('[control] Failed to initialize Supabase:', err);
    }

    // Re-read token in case reconciliation updated it
    _token = getToken();

    if (!_token) {
        window.location.href = '/#my-quizzes';
        return;
    }

    // 4. Load admin-control data (admins + platform stats)
    loadData();
}

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${_token}`
    };
}

// ── Toast ──────────────────────────────────────────────────────────────────────
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

// ── Platform Stats ─────────────────────────────────────────────────────────────
function renderPlatformStats(stats) {
    if (!stats) return;
    const statQuizzes = document.getElementById('statQuizzes');
    const statCategories = document.getElementById('statCategories');
    const statAdmins = document.getElementById('statAdmins');
    const ownerEmailDisplay = document.getElementById('ownerEmailDisplay');

    if (statQuizzes) statQuizzes.textContent = stats.totalQuizzes ?? '—';
    if (statCategories) statCategories.textContent = stats.totalCategories ?? '—';
    if (statAdmins) statAdmins.textContent = stats.totalAdmins ?? '—';
    if (ownerEmailDisplay) ownerEmailDisplay.textContent = stats.ownerEmail ?? '—';
}

// ── Data loading ───────────────────────────────────────────────────────────────
async function loadData() {
    try {
        const res = await fetch(API_URL, { headers: getHeaders() });
        const data = await res.json();

        if (!res.ok) {
            if (res.status === 401 || res.status === 403) {
                alert('غير مصرح لك بالدخول إلى هذه الصفحة.');
                window.location.href = '/#my-quizzes';
                return;
            }
            throw new Error(data.error || 'فشل تحميل البيانات');
        }

        // Render platform stats
        renderPlatformStats(data.platformStats);

        // Render admin list
        const list = document.getElementById('adminsTableBody');
        list.innerHTML = '';

        if (!data.admins || data.admins.length === 0) {
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

// ── Actions ────────────────────────────────────────────────────────────────────
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

window.submitAddAdmin = submitAddAdmin;

document.getElementById('confirmModal').addEventListener('click', function (e) {
    if (e.target === this) closeModal();
});

// ── Logout ─────────────────────────────────────────────────────────────────────
// fullSignOut() clears BOTH the local JWT AND calls supabaseClient.auth.signOut()
// so the Supabase session in localStorage is also terminated.
// Redirects to /#my-quizzes — the owner can decide to sign back in from there.
window.logout = async function () {
    try {
        await fullSignOut(_supabaseClient);
    } catch (err) {
        console.error('[control] Error during logout:', err);
    }
    window.location.href = '/#my-quizzes';
};

// ── Start ───────────────────────────────────────────────────────────────────────
init();