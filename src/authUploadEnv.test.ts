import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import {
	parseDotEnv,
	resolveAuthUploadConfig,
} from "./authUploadEnv.js";

test("parseDotEnv reads basic key value pairs", () => {
	expect(
		parseDotEnv(`
# comment
CARREFOUR_AUTH_UPLOAD_SERVER_URL=https://example.com/mcp
CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_USER="alice"
CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_PASSWORD='secret'
		`),
	).toEqual({
		CARREFOUR_AUTH_UPLOAD_SERVER_URL: "https://example.com/mcp",
		CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_USER: "alice",
		CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_PASSWORD: "secret",
	});
});

test("resolveAuthUploadConfig prefers explicit env over .env values", async () => {
	const tempDir = await mkdtemp(path.join(os.tmpdir(), "carrefour-auth-upload-"));
	await writeFile(
		path.join(tempDir, ".env"),
		[
			"CARREFOUR_AUTH_UPLOAD_SERVER_URL=https://file.example.com/mcp",
			"CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_USER=file-user",
			"CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_PASSWORD=file-password",
		].join("\n"),
	);

	const config = await resolveAuthUploadConfig({
		serverUrl: undefined,
		env: {
			CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_USER: "env-user",
			CARREFOUR_AUTH_UPLOAD_BASIC_AUTH_PASSWORD: "env-password",
		} as NodeJS.ProcessEnv,
		baseDir: tempDir,
	});

	expect(config).toEqual({
		serverUrl: "https://file.example.com/mcp",
		credentials: {
			user: "env-user",
			password: "env-password",
		},
	});
});
