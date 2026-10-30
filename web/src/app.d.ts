// See https://svelte.dev/docs/kit/types#app.d.ts
import type { SessionUser } from '#lib/server/session.ts';

declare global {
	namespace App {
		interface Locals {
			/** Fully signed in (password and, when turned on, the 2-step code). */
			user: SessionUser | null;
			/** Password accepted, 2-step code still owed. Grants nothing but the code page. */
			pending: SessionUser | null;
			/** Hashed id of the current session, to tell it apart from the person's other sessions. */
			sessionId: string | null;
		}
	}
}

export {};
