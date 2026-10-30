export type ToastKind = 'ok' | 'error' | 'info';
export type Toast = { id: number; kind: ToastKind; text: string };

let next = 1;
export const toasts = $state<Toast[]>([]);

export function toast(text: string, kind: ToastKind = 'ok', ms = 3500) {
	const id = next++;
	toasts.push({ id, kind, text });
	setTimeout(() => dismiss(id), ms);
}

export function dismiss(id: number) {
	const i = toasts.findIndex((t) => t.id === id);
	if (i >= 0) toasts.splice(i, 1);
}
