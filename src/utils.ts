import { findIconDefinition, icon as getFAIcon } from "@fortawesome/fontawesome-svg-core";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import type { IconPrefix } from "@fortawesome/free-regular-svg-icons";


export class DefaultMap<K, V> extends Map<K, V> {
	/** Usage
	 * new DefaultMap<string, Number>(() => 0)
	 * new DefaultMap<string, Array>(() => [])
	 */
	constructor(private defaultFactory: () => V) {
		super();
	}

	get(key: K): V {
		if (!super.has(key)) {
			super.set(key, this.defaultFactory());
		}
		return super.get(key)!;
	}
}


export class Podcast {
	constructor(public name: string, public author: string, public feedUrl: string) { }
}


export class PodcastEpisode {
	constructor(public title: string, public url: string) { }
}


export function generateRandomString(length: number) {
	let result = '';
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const charactersLength = characters.length;
	for (let i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}


export function getIcon(iconName: string) {
	for (const prefix of ["fas", "far", "fab", "fa"] as IconPrefix[]) {
		const definition = findIconDefinition({
			iconName: iconName as IconName,
			prefix
		});
		if (definition) return getFAIcon(definition).node[0];
	}
}


export function secondsToTimeString(totalSeconds: number, truncateMilliseconds: boolean): string {
	if (totalSeconds === 0) {
		return "00:00";
	}
	let hours = Math.floor(totalSeconds / 3600);
	let minutes = Math.floor((totalSeconds / 60 - (hours * 60)));
	let seconds = totalSeconds - (hours * 3600 + minutes * 60);
	let s = "";
	if (hours > 0) {
		if (hours >= 10) {
			s += hours.toString() + ":";
		} else {
			s += "0" + hours.toString() + ":";
		}
	}
	if (minutes >= 10) {
		s += minutes.toString() + ":";
	} else {
		s += "0" + minutes.toString() + ":";
	}
	seconds = Math.round(seconds * 100) / 100; // round to 2 decimal places
	if (seconds >= 10) {
		s += seconds.toString();
	} else {
		s += "0" + seconds.toString();
	}
	if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds) || hours === undefined || minutes === undefined || seconds === undefined) {
		throw new Error(`Failed to convert seconds to time string: ${totalSeconds}`);
	}
	if (truncateMilliseconds && s.includes(".")) {
		s = s.slice(0, s.indexOf("."));
	}
	return s;
}


export function timeStringToSeconds(s: string): number {
	let hours = 0;
	let minutes = 0;
	let seconds = 0;
	const split = s.split(":");
	if (split.length > 2) {
		hours = parseInt(split[0]);
		minutes = parseInt(split[1]);
		seconds = parseFloat(split[2]);
	} else if (split.length > 1) {
		minutes = parseInt(split[0]);
		seconds = parseFloat(split[1]);
	} else {
		seconds = parseFloat(split[0]);
	}
	if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds) || hours === undefined || minutes === undefined || seconds === undefined) {
		throw new Error(`Failed to convert time string to seconds: ${s}`);
	}
	return (hours * 3600) + (minutes * 60) + seconds;
}


/**
 * generate groups of 4 random characters
 * @example getUniqueId(1) : 607f
 * @example getUniqueId(4) : 95ca-361a-f8a1-1e73
 */
export function getUniqueId(parts: number): string {
	const stringArr = [];
	for (let i = 0; i < parts; i++) {
		// tslint:disable-next-line:no-bitwise
		const S4 = (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
		stringArr.push(S4);
	}
	return stringArr.join('-');
}


export function createSelect(keys: string[], values: string[], cls: string, noDefault: boolean) {
	const select = createEl("select", {
		cls: cls
	});
	if (noDefault) {
		const o = select.createEl("option");
		o.selected = true;
		o.disabled = true;
		o.hidden = true;
	}
	for (let i = 0; i < keys.length; i++) {
		const key = keys[i];
		const value = values[i];
		const o = select.createEl("option");
		o.textContent = key;
		o.value = value;
	}
	return select;
}


export const WHISPER_LANGUAGE_CODES = [
	["en", "English"],
	["zh", "Chinese"],
	["de", "German"],
	["es", "Spanish"],
	["ru", "Russian"],
	["ko", "Korean"],
	["fr", "French"],
	["ja", "Japanese"],
	["pt", "Portuguese"],
	["tr", "Turkish"],
	["pl", "Polish"],
	["ca", "Catalan"],
	["nl", "Dutch"],
	// ["ar", "Arabic"],
	// ["sv", "Swedish"],
	["it", "Italian"],
	// ["id", "Indonesian"],
	["hi", "Hindi"],
	// ["fi", "Finnish"],
	["vi", "Vietnamese"],
	// ["he", "Hebrew"],
	["uk", "Ukrainian"],
	["el", "Greek"],
	// ["ms", "Malay"],
	["cs", "Czech"],
	["ro", "Romanian"],
	["da", "Danish"],
	["hu", "Hungarian"],
	// ["ta", "Tamil"],
	// ["no", "Norwegian"],
	["th", "Thai"],
	// ["ur", "Urdu"],
	// ["hr", "Croatian"],
	// ["bg", "Bulgarian"],
	// ["lt", "Lithuanian"],
	// ["la", "Latin"],
	// ["mi", "Maori"],
	// ["ml", "Malayalam"],
	// ["cy", "Welsh"],
	// ["sk", "Slovak"],
	// ["te", "Telugu"],
	// ["fa", "Persian"],
	// ["lv", "Latvian"],
	// ["bn", "Bengali"],
	// ["sr", "Serbian"],
	// ["az", "Azerbaijani"],
	// ["sl", "Slovenian"],
	// ["kn", "Kannada"],
	// ["et", "Estonian"],
	// ["mk", "Macedonian"],
	// ["br", "Breton"],
	// ["eu", "Basque"],
	// ["is", "Icelandic"],
	// ["hy", "Armenian"],
	// ["ne", "Nepali"],
	// ["mn", "Mongolian"],
	// ["bs", "Bosnian"],
	// ["kk", "Kazakh"],
	// ["sq", "Albanian"],
	// ["sw", "Swahili"],
	// ["gl", "Galician"],
	// ["mr", "Marathi"],
	// ["pa", "Punjabi"],
	// ["si", "Sinhala"],
	// ["km", "Khmer"],
	// ["sn", "Shona"],
	// ["yo", "Yoruba"],
	// ["so", "Somali"],
	// ["af", "Afrikaans"],
	// ["oc", "Occitan"],
	// ["ka", "Georgian"],
	// ["be", "Belarusian"],
	// ["tg", "Tajik"],
	// ["sd", "Sindhi"],
	// ["gu", "Gujarati"],
	// ["am", "Amharic"],
	// ["yi", "Yiddish"],
	// ["lo", "Lao"],
	// ["uz", "Uzbek"],
	// ["fo", "Faroese"],
	// ["ht", "Haitian creole"],
	// ["ps", "Pashto"],
	// ["tk", "Turkmen"],
	// ["nn", "Nynorsk"],
	// ["mt", "Maltese"],
	// ["sa", "Sanskrit"],
	// ["lb", "Luxembourgish"],
	// ["my", "Myanmar"],
	// ["bo", "Tibetan"],
	// ["tl", "Tagalog"],
	// ["mg", "Malagasy"],
	// ["as", "Assamese"],
	// ["tt", "Tatar"],
	// ["haw", "Hawaiian"],
	// ["ln", "Lingala"],
	// ["ha", "Hausa"],
	// ["ba", "Bashkir"],
	// ["jw", "Javanese"],
	// ["su", "Sundanese"],
];

export const DG_LANGUAGE_CODES = [
	["en-US", "English (United States)"], // put at the top so this is the default for dropdowns
	["zh", "Chinese"],
	["zh-CN", "Chinese (China)"],
	["zh-TW", "Chinese (Taiwan)"],
	["da", "Danish"],
	["nl", "Dutch"],
	["en", "English"],
	["en-AU", "English (Australia)"],
	["en-GB", "English (United Kingdom)"],
	["en-IN", "English (India)"],
	["en-NZ", "English (New Zealand)"],
	["nl", "Flemish"],
	["fr", "French"],
	["fr-CA", "French (Canada)"],
	["de", "German"],
	["hi", "Hindi"],
	["hi-Latn", "Hindi (Roman Script)"],
	["id", "Indonesian"],
	["it", "Italian"],
	["ja", "Japanese"],
	["ko", "Korean"],
	["no", "Norwegian"],
	["pl", "Polish"],
	["pt", "Portuguese"],
	["pt-BR", "Portuguese (Brazil)"],
	["pt-PT", "Portuguese (Portugal)"],
	["ru", "Russian"],
	["es", "Spanish"],
	["es-419", "Spanish (Latin America)"],
	["sv", "Swedish"],
	["tr", "Turkish"],
	["uk", "Ukrainian"],
];
