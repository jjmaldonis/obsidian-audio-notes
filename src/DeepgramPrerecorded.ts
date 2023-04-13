import { request } from "obsidian";
import queryString from "query-string";

export async function deepgramPrerecorded(
	apiKey: string,
	payload?: any,
	// eslint-disable-next-line @typescript-eslint/ban-types
	options?: any,
	contentType: string = "audio/webm"
): Promise<any> {  
	const response = await request({
		url: `https://api.deepgram.com/v1/listen?${queryString.stringify(
			options
		)}`,
		method: "POST",
		headers: {
			"User-Agent": "Deepgram Obsidian Audio Notes Plugin",
			"Content-Type": contentType,
			Authorization: `token ${apiKey}`,
		},
		contentType: contentType,
		body: payload.buffer,
	});

	return JSON.parse(response);
}
