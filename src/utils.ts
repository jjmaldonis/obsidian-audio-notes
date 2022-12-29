import { findIconDefinition, icon as getFAIcon } from "@fortawesome/fontawesome-svg-core";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import { IconPrefix } from "@fortawesome/free-regular-svg-icons";


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

