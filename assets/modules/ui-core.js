(function () {
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
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        }
        if (type === 'error') {
            return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        }
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }

    function showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `${toastIcon(type)}<div class="toast-content">${escapeHtml(message).replace(/\n/g, '<br>')}</div>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    function openModal(modalOrId, display = 'flex') {
        const modal = typeof modalOrId === 'string' ? document.getElementById(modalOrId) : modalOrId;
        if (!modal) return null;
        modal.style.display = display;
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
        setTimeout(() => {
            modal.style.display = display;
            if (typeof options.afterClose === 'function') options.afterClose();
        }, delay);
    }

    function customConfirm(message, confirmBtnText = '确定', confirmBtnColor = 'var(--primary)') {
        return new Promise((resolve) => {
            confirmResolver = resolve;
            const messageEl = document.getElementById('confirm-message');
            const btnYes = document.getElementById('btn-confirm-yes');
            if (messageEl) messageEl.innerHTML = String(message || '').replace(/\n/g, '<br>');
            if (btnYes) {
                btnYes.innerText = confirmBtnText;
                btnYes.style.background = confirmBtnColor;
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
