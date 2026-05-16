(function () {
    const DEFAULT_TOAST_DURATION_MS = 5000;
    let confirmResolver = null;

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function toastIcon(type) {
        if (type === 'success') {
            return '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        }
        if (type === 'error') {
            return '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }
        if (type === 'warning') {
            return '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
        }
        return '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    function toastTitle(type) {
        if (type === 'success') return '操作成功';
        if (type === 'error') return '操作失败';
        if (type === 'warning') return '需要注意';
        return '提示信息';
    }

    function showToast(message, type = 'info', duration = DEFAULT_TOAST_DURATION_MS) {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const displayDuration = Math.max(Number(duration) || DEFAULT_TOAST_DURATION_MS, DEFAULT_TOAST_DURATION_MS);
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
        toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
        toast.style.setProperty('--toast-duration', `${displayDuration}ms`);
        toast.innerHTML = `
            <div class="toast-status" aria-hidden="true">${toastIcon(type)}</div>
            <div class="toast-content">
                <div class="toast-title">${toastTitle(type)}</div>
                <div class="toast-message">${escapeHtml(message).replace(/\n/g, '<br>')}</div>
            </div>
            <button class="toast-close" type="button" aria-label="关闭提示">&times;</button>
            <div class="toast-progress" aria-hidden="true"></div>
        `;
        container.appendChild(toast);

        let removed = false;
        const dismiss = () => {
            if (removed) return;
            removed = true;
            toast.style.animation = 'fadeOut 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        };
        const timer = setTimeout(dismiss, displayDuration);
        toast.querySelector('.toast-close')?.addEventListener('click', () => {
            clearTimeout(timer);
            dismiss();
        });
    }

    function openModal(modalOrId, display = 'flex') {
        const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
        if (!modal) return null;
        /* In route-page mode the modal lives inline in .content; the
           overlay's display is owned by cloud-modals.css. Avoid stomping
           it with an inline flex/block style. */
        if (!modal.classList.contains('route-active')) {
            modal.style.display = display;
        }
        void modal.offsetWidth;
        modal.classList.add('active');
        return modal;
    }

    function closeModal(modalOrId, options = {}) {
        const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
        if (!modal) return;
        const delay = options.delay ?? 200;
        const display = options.display ?? 'none';
        modal.classList.remove('active');
        if (options.removeClasses) {
            options.removeClasses.forEach(className => modal.classList.remove(className));
        }
        const wasRouteActive = modal.classList.contains('route-active');
        setTimeout(() => {
            if (!wasRouteActive) {
                modal.style.display = display;
            } else {
                modal.style.display = '';
            }
            if (typeof options.afterClose === 'function') options.afterClose();
        }, delay);
    }

    function confirmVariantFromColor(color) {
        const value = String(color || '').toLowerCase();
        if (value.includes('danger') || value.includes('d63031') || value.includes('dc2626') || value.includes('ef4444') || value.includes('b91c1c') || value.includes('b53916')) {
            return 'danger';
        }
        if (value.includes('success') || value.includes('00b894') || value.includes('0f766e') || value.includes('059669') || value.includes('2ecc71') || value.includes('10b981') || value.includes('1f6b4d')) {
            return 'success';
        }
        if (value.includes('warning') || value.includes('warn') || value.includes('fdcb6e') || value.includes('e6a23c') || value.includes('d97706') || value.includes('f59e0b') || value.includes('fbbf24') || value.includes('a6731f')) {
            return 'warning';
        }
        return 'primary';
    }

    function customConfirm(message, confirmBtnText = '确定', confirmBtnColor = 'var(--primary)') {
        return new Promise((resolve) => {
            confirmResolver = resolve;
            const messageEl = document.getElementById('confirm-message');
            const btnYes = document.getElementById('btn-confirm-yes');
            const modal = document.getElementById('confirm-modal');
            const box = modal?.querySelector('.confirm-box');
            const variant = confirmVariantFromColor(confirmBtnColor);
            if (messageEl) messageEl.innerHTML = String(message || '').replace(/\n/g, '<br>');
            if (box) {
                box.classList.remove('is-primary', 'is-success', 'is-warning', 'is-danger');
                box.classList.add(`is-${variant}`);
            }
            if (btnYes) {
                btnYes.innerText = confirmBtnText;
                btnYes.className = `btn-confirm btn-confirm-${variant}`;
                btnYes.style.background = variant === 'primary' ? confirmBtnColor : '';
            }
            openModal('confirm-modal');
        });
    }

    function resolveConfirm(result) {
        const resolver = confirmResolver;
        closeModal('confirm-modal', {
            afterClose: () => {
                if (resolver) resolver(result);
                if (confirmResolver === resolver) confirmResolver = null;
            }
        });
    }

    async function copyText(text, successMessage = '已复制') {
        const value = String(text || '');
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            showToast(successMessage, 'success');
            return;
        }

        const textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        textarea.remove();
        showToast(successMessage, 'success');
    }

    window.ConfigMateUi = {
        escapeHtml,
        showToast,
        openModal,
        closeModal,
        customConfirm,
        resolveConfirm,
        copyText
    };
})();
