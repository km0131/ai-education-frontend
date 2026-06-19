export async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
	try {
		const data = await response.json();
		if (data && typeof data.error === 'string' && data.error.trim() !== '') {
			return data.error;
		}
		return fallbackMessage;
	} catch {
		return fallbackMessage;
	}
}