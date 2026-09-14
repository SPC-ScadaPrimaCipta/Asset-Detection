import Swal from 'sweetalert2';

export function isRiskMappingSchemaMissing(error: unknown): boolean {
    const text = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : JSON.stringify(error || '');

    const normalized = text.toLowerCase();
    return (
        normalized.includes('rbi_pfd') ||
        normalized.includes('invalid object name') ||
        normalized.includes('db:migrate')
    );
}

export function showRiskMappingErrorAlert(error: unknown, fallbackTitle = 'Error') {
    const message = typeof error === 'string'
        ? error
        : error instanceof Error
            ? error.message
            : 'An unexpected error occurred';

    if (isRiskMappingSchemaMissing(message)) {
        return Swal.fire({
            html: `
                <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 ring-4 ring-amber-50 dark:ring-amber-950/50">
                    <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
                </div>
                <div class="text-base font-bold text-gray-800 dark:text-white-light mb-2">Database Schema Missing</div>
                <div style="text-align: left; font-size: 13px; color: #475569;">
                    <p style="margin-bottom: 8px;">
                        The Risk Mapping database tables (such as <code>dbo.rbi_pfd_document</code>) were not found in the database.
                    </p>
                    <p style="margin-bottom: 12px; color: #64748b; font-size: 12px;">
                        This usually occurs after restoring a database backup with an older schema.
                    </p>
                    <div style="background: #0f172a; color: #38bdf8; padding: 10px 12px; border-radius: 8px; font-family: monospace; font-size: 13px; font-weight: 600; text-align: center; border: 1px solid #1e293b;">
                        npm run db:migrate
                    </div>
                    <p style="margin-top: 10px; font-size: 12px; color: #64748b;">
                        Run the command above in your terminal, then refresh this page.
                    </p>
                </div>
            `,
            confirmButtonText: 'Understood',
            customClass: {
                popup: 'sweet-alerts rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0e1726]',
                confirmButton: 'btn btn-primary px-5 py-2 rounded-lg text-sm font-semibold shadow-none',
            },
            buttonsStyling: false,
            padding: '1.75em',
        });
    }

    return Swal.fire({
        html: `
            <div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 ring-4 ring-rose-50 dark:ring-rose-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </div>
            <div class="text-base font-bold text-gray-800 dark:text-white-light">${fallbackTitle}</div>
            <div class="mt-1 text-sm text-gray-600 dark:text-gray-400">${message}</div>
        `,
        confirmButtonText: 'Close',
        customClass: {
            popup: 'sweet-alerts rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0e1726]',
            confirmButton: 'btn btn-primary px-5 py-2 rounded-lg text-sm font-semibold shadow-none',
        },
        buttonsStyling: false,
        padding: '1.75em',
    });
}

export const promptSwal = Swal.mixin({
    customClass: {
        popup: 'sweet-alerts rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0e1726]',
        confirmButton: 'btn btn-primary px-4 py-2 text-sm font-semibold rounded-lg shadow-none ltr:mr-2 rtl:ml-2',
        denyButton: 'btn btn-outline-danger px-4 py-2 text-sm font-semibold rounded-lg shadow-none ltr:mr-2 rtl:ml-2',
        cancelButton: 'btn btn-outline-secondary px-4 py-2 text-sm font-semibold rounded-lg shadow-none',
        title: 'text-base font-bold text-gray-800 dark:text-white-light',
        htmlContainer: 'text-sm text-gray-600 dark:text-gray-400',
    },
    buttonsStyling: false,
    padding: '1.75em',
});

export function getAlertIconHtml(type: 'success' | 'error' | 'warning' | 'question' | 'info'): string {
    switch (type) {
        case 'success':
            return `<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 ring-4 ring-emerald-50 dark:ring-emerald-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>
            </div>`;
        case 'error':
            return `<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 ring-4 ring-rose-50 dark:ring-rose-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </div>`;
        case 'warning':
            return `<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400 ring-4 ring-amber-50 dark:ring-amber-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/></svg>
            </div>`;
        case 'question':
            return `<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 ring-4 ring-indigo-50 dark:ring-indigo-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M12 18h.01"/></svg>
            </div>`;
        case 'info':
        default:
            return `<div class="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 ring-4 ring-blue-50 dark:ring-blue-950/50">
                <svg class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke-width="2.2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"/></svg>
            </div>`;
    }
}

export interface PAlertOptions {
    type?: 'success' | 'error' | 'warning' | 'question' | 'info';
    title: string;
    text?: string;
    html?: string;
    showCancelButton?: boolean;
    showDenyButton?: boolean;
    confirmButtonText?: string;
    confirmButtonClass?: string;
    denyButtonText?: string;
    cancelButtonText?: string;
    confirmButtonColor?: string;
    timer?: number;
    showConfirmButton?: boolean;
    isDestructive?: boolean;
    customClass?: any;
}

export function pAlert(opts: PAlertOptions) {
    const iconHtml = opts.type ? getAlertIconHtml(opts.type) : '';
    const titleHtml = `<div class="text-base font-bold text-gray-800 dark:text-white-light">${opts.title}</div>`;
    const bodyHtml = opts.html || (opts.text ? `<div class="mt-1.5 text-sm text-gray-600 dark:text-gray-400">${opts.text}</div>` : '');
    const combinedHtml = `${iconHtml}${titleHtml}${bodyHtml}`;

    const isDelete = opts.isDestructive || opts.confirmButtonText?.toLowerCase().includes('delete') || opts.confirmButtonText?.toLowerCase().includes('remove');
    const confirmBtnClass = opts.confirmButtonClass || (isDelete
        ? 'btn btn-danger px-4 py-2 text-sm font-semibold rounded-lg shadow-none ltr:mr-2 rtl:ml-2'
        : 'btn btn-primary px-4 py-2 text-sm font-semibold rounded-lg shadow-none ltr:mr-2 rtl:ml-2');

    const swalConfig: any = {
        html: combinedHtml,
        confirmButtonText: opts.confirmButtonText || 'OK',
        cancelButtonText: opts.cancelButtonText || 'Cancel',
        denyButtonText: opts.denyButtonText || 'No',
        showCancelButton: Boolean(opts.showCancelButton),
        showDenyButton: Boolean(opts.showDenyButton),
        showConfirmButton: opts.showConfirmButton !== undefined ? opts.showConfirmButton : true,
        customClass: opts.customClass || {
            popup: 'sweet-alerts rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#0e1726]',
            confirmButton: confirmBtnClass,
            denyButton: 'btn btn-outline-danger px-4 py-2 text-sm font-semibold rounded-lg shadow-none ltr:mr-2 rtl:ml-2',
            cancelButton: 'btn btn-outline-secondary px-4 py-2 text-sm font-semibold rounded-lg shadow-none',
            title: 'text-base font-bold text-gray-800 dark:text-white-light',
            htmlContainer: 'text-sm text-gray-600 dark:text-gray-400',
        },
    };
    if (opts.timer) swalConfig.timer = opts.timer;

    return promptSwal.fire(swalConfig);
}
