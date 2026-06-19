export type UserRole = 'teacher' | 'student';

export interface UserSession {
	id: string;
	name: string;
	role: UserRole;
}

const STORAGE_KEY = 'ai-education-user';

export function saveUserSession(session: UserSession) {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function loadUserSession(): UserSession | null {
	if (typeof window === 'undefined') {
		return null;
	}

	const raw = window.localStorage.getItem(STORAGE_KEY);
	if (!raw) {
		return null;
	}

	try {
		const parsed = JSON.parse(raw) as UserSession;
		if (!parsed || typeof parsed.id !== 'string' || typeof parsed.name !== 'string') {
			return null;
		}
		return {
			id: parsed.id,
			name: parsed.name,
			role: parsed.role === 'teacher' ? 'teacher' : 'student',
		};
	} catch {
		return null;
	}
}

export function clearUserSession() {
	if (typeof window === 'undefined') {
		return;
	}
	window.localStorage.removeItem(STORAGE_KEY);
}