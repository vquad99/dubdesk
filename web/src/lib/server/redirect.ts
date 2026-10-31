/**
 * A "next" address from the URL is followed only when it stays on this site: one leading slash,
 * no second slash or backslash after it (browsers read a backslash as a slash), no control characters.
 */
export function safeNext(next: string | null | undefined): string | null {
	if (!next || next.length > 1000) return null;
	if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
	if (/[\\\u0000-\u001f\u007f]/.test(next)) return null;
	return next;
}
