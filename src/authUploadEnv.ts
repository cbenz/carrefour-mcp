import { access, readFile } from "node:fs/promises";
import path from "node:path";

export type AuthUploadCredentials = {
	user: string;
	password: string;
};

export type AuthUploadConfig = {
	serverUrl: string;
	credentials?: AuthUploadCredentials;
};

function normalizeEnvValue(value: string | undefined): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function parseDotEnvLine(line: string): [string, string] | undefined {
	const trimmedLine = line.trim();
	if (!trimmedLine || trimmedLine.startsWith("#")) {
		return undefined;
	}

	const withoutExport = trimmedLine.startsWith("export ")
		? trimmedLine.slice(7).trim()
		: trimmedLine;
	const separatorIndex = withoutExport.indexOf("=");
	if (separatorIndex <= 0) {
		return undefined;
	}

	const key = withoutExport.slice(0, separatorIndex).trim();
	if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
		return undefined;
	}

	let value = withoutExport.slice(separatorIndex + 1).trim();
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		value = value.slice(1, -1);
	}

	return [key, value];
}

export function parseDotEnv(content: string): Record<string, string> {
	return content
		.split(/\r?\n/)
		.map((line) => parseDotEnvLine(line))
		.filter((entry): entry is [string, string] => Boolean(entry))
		.reduce<Record<string, string>>((accumulator, [key, value]) => {
			accumulator[key] = value;
			return accumulator;
		}, {});
}

export async function readDotEnvFileIfPresent(
	baseDir: string,
): Promise<Record<string, string>> {
	const filePath = path.join(baseDir, ".env");

	try {
		await access(filePath);
	} catch {
		return {};
	}

	const rawContent = await readFile(filePath, { encoding: "utf-8" });
	return parseDotEnv(rawContent);
}

function getEnvValue(
	env: NodeJS.ProcessEnv,
	dotEnv: Record<string, string>,
	key: string,
): string | undefined {
	return normalizeEnvValue(env[key]) ?? normalizeEnvValue(dotEnv[key]);
}

export async function resolveAuthUploadConfig({
	serverUrl,
	env = process.env,
	baseDir = process.cwd(),
}: {
	serverUrl?: string;
	env?: NodeJS.ProcessEnv;
	baseDir?: string;
} = {}): Promise<AuthUploadConfig> {
	const dotEnv = await readDotEnvFileIfPresent(baseDir);
	const resolvedServerUrl =
		normalizeEnvValue(serverUrl) ??
		getEnvValue(env, dotEnv, "CARREFOUR_AUTH_UPLOAD_SERVER_URL") ??
		getEnvValue(env, dotEnv, "CARREFOUR_MCP_SERVER_URL") ??
		getEnvValue(env, dotEnv, "AUTH_UPLOAD_SERVER_URL");

	if (!resolvedServerUrl) {
		throw new Error(
			"Missing auth upload server URL. Provide --server-url or set CARREFOUR_AUTH_UPLOAD_SERVER_URL.",
		);
	}

	const user =
		getEnvValue(env, dotEnv, "CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_USER") ??
		getEnvValue(env, dotEnv, "CARREFOUR_MCP_BASIC_AUTH_USER") ??
		getEnvValue(env, dotEnv, "BASIC_AUTH_USER");
	const password =
		getEnvValue(env, dotEnv, "CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_PASSWORD") ??
		getEnvValue(env, dotEnv, "CARREFOUR_MCP_BASIC_AUTH_PASSWORD") ??
		getEnvValue(env, dotEnv, "BASIC_AUTH_PASSWORD");

	return {
		serverUrl: resolvedServerUrl,
		credentials:
			user && password
				? {
					user,
					password,
				}
				: undefined,
	};
}
