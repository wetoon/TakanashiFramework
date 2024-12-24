
import { $, build } from "bun";

process.platform == "win32"
	? await $`rmdir /s /q ./.build/dist`
	: await $`rm -rf ./.build/dist`;

await build({
	entrypoints: ['./src/index.ts'],
	outdir: './.build/dist',
	minify: true,
	target: 'bun',
	naming: 'index.mjs',
	format: 'esm',
	sourcemap: 'none',
	external: []
});

await build({
	entrypoints: ['./src/index.ts'],
	outdir: './.build/dist',
	minify: true,
	target: 'node',
	naming: 'index.cjs',
	format: 'cjs',
	sourcemap: 'none',
	external: []
});

await $`bunx tsc --project tsconfig.build.json`;
