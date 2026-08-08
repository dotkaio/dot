import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { delimiter, join } from "path";
import { afterEach, describe, expect, test } from "vitest";
import {
	detectInstallMethod,
	getSelfUpdateCommand,
	getSelfUpdateUnavailableInstruction,
	getUpdateInstruction,
} from "../src/config.ts";

const execPathDescriptor = Object.getOwnPropertyDescriptor(process, "execPath");
const originalPath = process.env.PATH;
const originalDotPackageDir = process.env.DOT_PACKAGE_DIR;
const originalArgv1 = process.argv[1];
let tempDir: string | undefined;

function setExecPath(value: string): void {
	Object.defineProperty(process, "execPath", {
		value,
		configurable: true,
	});
}

afterEach(() => {
	if (execPathDescriptor) {
		Object.defineProperty(process, "execPath", execPathDescriptor);
	}
	if (originalPath === undefined) {
		delete process.env.PATH;
	} else {
		process.env.PATH = originalPath;
	}
	if (originalDotPackageDir === undefined) {
		delete process.env.DOT_PACKAGE_DIR;
	} else {
		process.env.DOT_PACKAGE_DIR = originalDotPackageDir;
	}
	if (originalArgv1 === undefined) {
		process.argv.splice(1, 1);
	} else {
		process.argv[1] = originalArgv1;
	}
	if (tempDir) {
		chmodSync(tempDir, 0o700);
		rmSync(tempDir, { recursive: true, force: true });
		tempDir = undefined;
	}
});

function createNpmPrefixInstall(template = "dot-prefix-"): { prefix: string; packageDir: string } {
	const prefix = mkdtempSync(join(tmpdir(), template));
	const root = join(prefix, "lib", "node_modules");
	const scopeDir = join(root, "@dotkaio");
	const packageDir = join(scopeDir, "dot-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	tempDir = prefix;
	process.env.DOT_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
	return { prefix, packageDir };
}

function createPnpmGlobalInstall(): { root: string; packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "dot-pnpm-"));
	const binDir = join(temp, "bin");
	const root = join(temp, "pnpm", "global", "5", "node_modules");
	const packageDir = join(root, "@dotkaio", "dot-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), createFakePnpmScript(root));
	chmodSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
	tempDir = temp;
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.DOT_PACKAGE_DIR = packageDir;
	setExecPath(
		join(
			root,
			".pnpm",
			"@dotkaio+dot-coding-agent@0.0.0",
			"node_modules",
			"@dotkaio",
			"dot-coding-agent",
			"dist",
			"cli.js",
		),
	);
	return { root, packageDir };
}

function createYarnGlobalInstall(): { globalDir: string; packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "dot-yarn-"));
	const binDir = join(temp, "bin");
	const globalDir = join(temp, "yarn", "global");
	const packageDir = join(globalDir, "node_modules", "@dotkaio", "dot-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"), createFakeYarnScript(globalDir));
	chmodSync(join(binDir, process.platform === "win32" ? "yarn.cmd" : "yarn"), 0o755);
	tempDir = temp;
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.DOT_PACKAGE_DIR = packageDir;
	setExecPath(join(globalDir, ".yarn", "@dotkaio", "dot-coding-agent", "dist", "cli.js"));
	return { globalDir, packageDir };
}

function createBunGlobalInstall(): { packageDir: string } {
	const temp = mkdtempSync(join(tmpdir(), "dot-bun-"));
	const prefix = join(temp, ".bun");
	const bunBin = join(prefix, "bin");
	const root = join(prefix, "install", "global", "node_modules");
	const scopeDir = join(root, "@dotkaio");
	const packageDir = join(scopeDir, "dot-coding-agent");
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(bunBin, { recursive: true });
	writeFileSync(join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), createFakeBunScript(bunBin));
	chmodSync(join(bunBin, process.platform === "win32" ? "bun.cmd" : "bun"), 0o755);
	tempDir = temp;
	process.env.PATH = `${bunBin}${delimiter}${originalPath ?? ""}`;
	process.env.DOT_PACKAGE_DIR = packageDir;
	setExecPath(join(packageDir, "dist", "cli.js"));
	return { packageDir };
}

function createSourceCheckout(): { repoRoot: string; packageDir: string } {
	const repoRoot = mkdtempSync(join(tmpdir(), "dot-source-"));
	const binDir = join(repoRoot, "bin");
	const packageDir = join(repoRoot, "packages", "coding-agent");
	mkdirSync(join(repoRoot, ".git"), { recursive: true });
	mkdirSync(packageDir, { recursive: true });
	mkdirSync(binDir, { recursive: true });
	writeFileSync(join(packageDir, "package.json"), "{}\n");
	writeFileSync(join(binDir, process.platform === "win32" ? "git.cmd" : "git"), createFakeGitScript());
	chmodSync(join(binDir, process.platform === "win32" ? "git.cmd" : "git"), 0o755);
	tempDir = repoRoot;
	process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
	process.env.DOT_PACKAGE_DIR = packageDir;
	process.argv[1] = join(packageDir, "src", "main.ts");
	setExecPath(join("usr", "local", "bin", "node"));
	return { repoRoot, packageDir };
}

function createFakePnpmScript(root: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="root" if "%2"=="-g" echo ${root}\r\n`;
	}
	const escapedRoot = root.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "root" ] && [ "$2" = "-g" ]; then\n\tprintf '%s\\n' '${escapedRoot}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeYarnScript(globalDir: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="global" if "%2"=="dir" echo ${globalDir}\r\n`;
	}
	const escapedGlobalDir = globalDir.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "global" ] && [ "$2" = "dir" ]; then\n\tprintf '%s\\n' '${escapedGlobalDir}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeBunScript(bunBin: string): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%1"=="pm" if "%2"=="bin" if "%3"=="-g" echo ${bunBin}\r\n`;
	}
	const escapedBunBin = bunBin.replaceAll("'", "'\\''");
	return `#!/bin/sh\nif [ "$1" = "pm" ] && [ "$2" = "bin" ] && [ "$3" = "-g" ]; then\n\tprintf '%s\\n' '${escapedBunBin}'\n\texit 0\nfi\nexit 1\n`;
}

function createFakeGitScript(): string {
	if (process.platform === "win32") {
		return `@echo off\r\nif "%3"=="remote" (echo upstream&echo origin&exit /b 0)\r\nif "%3"=="symbolic-ref" (echo upstream/main&exit /b 0)\r\nexit /b 1\r\n`;
	}
	return `#!/bin/sh\nif [ "$3" = "remote" ]; then\n\tprintf 'upstream\\norigin\\n'\n\texit 0\nfi\nif [ "$3" = "symbolic-ref" ]; then\n\tprintf 'upstream/main\\n'\n\texit 0\nfi\nexit 1\n`;
}

describe("detectInstallMethod", () => {
	test("detects pnpm from Windows .pnpm install paths", () => {
		setExecPath(
			"C:\\Users\\Admin\\Documents\\pnpm-repository\\global\\5\\.pnpm\\@dotkaio+dot-coding-agent@0.67.68\\node_modules\\@dotkaio\\dot-coding-agent\\dist\\cli.js",
		);

		expect(detectInstallMethod()).toBe("pnpm");
		expect(getUpdateInstruction("@dotkaio/dot-coding-agent")).toBe(
			"Run: pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @dotkaio/dot-coding-agent",
		);
	});

	test("does not self-update unknown wrapper installs", () => {
		const packageDir = mkdtempSync(join(tmpdir(), "dot-unknown-"));
		writeFileSync(join(packageDir, "package.json"), "{}\n");
		tempDir = packageDir;
		process.env.DOT_PACKAGE_DIR = packageDir;
		process.argv[1] = join(packageDir, "cli.js");
		setExecPath("/usr/local/bin/node");

		expect(detectInstallMethod()).toBe("unknown");
		expect(getSelfUpdateCommand("@dotkaio/dot-coding-agent")).toBeUndefined();
		expect(getUpdateInstruction("@dotkaio/dot-coding-agent")).toBe(
			"Update @dotkaio/dot-coding-agent using the package manager, wrapper, or source checkout that provides this installation.",
		);
	});

	test("self-updates npm installs from custom prefixes", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent");

		expect(detectInstallMethod()).toBe("npm");
		expect(command).toEqual({
			command: "npm",
			args: [
				"--prefix",
				prefix,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				"@dotkaio/dot-coding-agent",
			],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @dotkaio/dot-coding-agent`,
		});
	});

	test("self-updates exact npm versions without uninstalling the current package", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", undefined, {
			packageName: "@dotkaio/dot-coding-agent",
			installSpec: "@dotkaio/dot-coding-agent@1.2.3",
		});

		expect(command).toEqual({
			command: "npm",
			args: [
				"--prefix",
				prefix,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				"@dotkaio/dot-coding-agent@1.2.3",
			],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @dotkaio/dot-coding-agent@1.2.3`,
		});
	});

	test("self-updates renamed packages from the current install prefix", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", undefined, "@new-scope/dot");

		expect(command).toEqual({
			command: "npm",
			args: ["--prefix", prefix, "install", "-g", "--ignore-scripts", "--min-release-age=0", "@new-scope/dot"],
			display: `npm --prefix ${prefix} uninstall -g @dotkaio/dot-coding-agent && npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/dot`,
			steps: [
				{
					command: "npm",
					args: ["--prefix", prefix, "uninstall", "-g", "@dotkaio/dot-coding-agent"],
					display: `npm --prefix ${prefix} uninstall -g @dotkaio/dot-coding-agent`,
				},
				{
					command: "npm",
					args: ["--prefix", prefix, "install", "-g", "--ignore-scripts", "--min-release-age=0", "@new-scope/dot"],
					display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @new-scope/dot`,
				},
			],
		});
	});

	test("self-update respects configured npmCommand", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", ["npm", "--prefix", prefix]);

		expect(command).toEqual({
			command: "npm",
			args: [
				"--prefix",
				prefix,
				"install",
				"-g",
				"--ignore-scripts",
				"--min-release-age=0",
				"@dotkaio/dot-coding-agent",
			],
			display: `npm --prefix ${prefix} install -g --ignore-scripts --min-release-age=0 @dotkaio/dot-coding-agent`,
		});
	});

	test("self-update treats empty npmCommand as unset", () => {
		const { prefix } = createNpmPrefixInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", []);

		expect(command?.args).toEqual([
			"--prefix",
			prefix,
			"install",
			"-g",
			"--ignore-scripts",
			"--min-release-age=0",
			"@dotkaio/dot-coding-agent",
		]);
	});

	test("quotes npm self-update display paths", () => {
		const { prefix } = createNpmPrefixInstall("dot prefix ");

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent");

		expect(command?.display).toBe(
			`npm --prefix "${prefix}" install -g --ignore-scripts --min-release-age=0 @dotkaio/dot-coding-agent`,
		);
	});

	test("does not infer Windows npm custom prefixes from package paths", () => {
		const packageDir = "C:\\Users\\Admin\\npm prefix\\node_modules\\@dotkaio\\dot-coding-agent";
		process.env.DOT_PACKAGE_DIR = packageDir;
		setExecPath(`${packageDir}\\dist\\cli.js`);

		expect(detectInstallMethod()).toBe("npm");
		expect(getUpdateInstruction("@dotkaio/dot-coding-agent")).toBe(
			"Run: npm install -g --ignore-scripts --min-release-age=0 @dotkaio/dot-coding-agent",
		);
	});

	test("self-updates source checkouts with a rebase autostash workflow", () => {
		const { repoRoot } = createSourceCheckout();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent");

		expect(detectInstallMethod()).toBe("source");
		expect(command).toEqual({
			command: "git",
			args: ["-C", repoRoot, "fetch", "upstream", "--tags", "--prune"],
			display: `git -C ${repoRoot} fetch upstream --tags --prune && git -C ${repoRoot} rebase --autostash upstream/main && npm install --ignore-scripts && npm run build`,
			steps: [
				{
					command: "git",
					args: ["-C", repoRoot, "fetch", "upstream", "--tags", "--prune"],
					display: `git -C ${repoRoot} fetch upstream --tags --prune`,
				},
				{
					command: "git",
					args: ["-C", repoRoot, "rebase", "--autostash", "upstream/main"],
					display: `git -C ${repoRoot} rebase --autostash upstream/main`,
				},
				{
					command: "npm",
					args: ["install", "--ignore-scripts"],
					display: "npm install --ignore-scripts",
				},
				{
					command: "npm",
					args: ["run", "build"],
					display: "npm run build",
				},
			],
		});
	});

	test("self-updates bun global installs from bun pm bin", () => {
		createBunGlobalInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent");

		expect(detectInstallMethod()).toBe("bun");
		expect(command).toEqual({
			command: "bun",
			args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@dotkaio/dot-coding-agent"],
			display: "bun install -g --ignore-scripts --minimum-release-age=0 @dotkaio/dot-coding-agent",
		});
	});

	test("self-updates renamed pnpm global installs by removing the old package first", () => {
		createPnpmGlobalInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", undefined, "@new-scope/dot");

		expect(detectInstallMethod()).toBe("pnpm");
		expect(command).toEqual({
			command: "pnpm",
			args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", "@new-scope/dot"],
			display:
				"pnpm remove -g @dotkaio/dot-coding-agent && pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/dot",
			steps: [
				{
					command: "pnpm",
					args: ["remove", "-g", "@dotkaio/dot-coding-agent"],
					display: "pnpm remove -g @dotkaio/dot-coding-agent",
				},
				{
					command: "pnpm",
					args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", "@new-scope/dot"],
					display: "pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 @new-scope/dot",
				},
			],
		});
	});

	test("self-updates pnpm v11 global installs resolved through the store", () => {
		const temp = mkdtempSync(join(tmpdir(), "dot-pnpm11-"));
		const binDir = join(temp, "bin");
		const root = join(temp, "Library", "pnpm", "global", "v11");
		const packageName = "@dotkaio/dot-coding-agent";
		const globalPackageDir = join(root, "11e9a", "node_modules", "@dotkaio", "dot-coding-agent");
		const storePackageDir = join(
			temp,
			"Library",
			"pnpm",
			"store",
			"v11",
			"links",
			"@dotkaio",
			"dot-coding-agent",
			"0.75.0",
			"hash",
			"node_modules",
			"@dotkaio",
			"dot-coding-agent",
		);
		mkdirSync(globalPackageDir, { recursive: true });
		mkdirSync(storePackageDir, { recursive: true });
		mkdirSync(binDir, { recursive: true });
		writeFileSync(join(globalPackageDir, "package.json"), "{}");
		writeFileSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), createFakePnpmScript(root));
		chmodSync(join(binDir, process.platform === "win32" ? "pnpm.cmd" : "pnpm"), 0o755);
		tempDir = temp;
		process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
		process.env.DOT_PACKAGE_DIR = storePackageDir;
		process.argv[1] = join(globalPackageDir, "dist", "cli.js");
		setExecPath(join(storePackageDir, "dist", "cli.js"));

		const command = getSelfUpdateCommand(packageName);

		expect(detectInstallMethod()).toBe("pnpm");
		expect(command).toEqual({
			command: "pnpm",
			args: ["install", "-g", "--ignore-scripts", "--config.minimumReleaseAge=0", packageName],
			display: `pnpm install -g --ignore-scripts --config.minimumReleaseAge=0 ${packageName}`,
		});
	});

	test("self-updates renamed yarn global installs by removing the old package first", () => {
		createYarnGlobalInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", undefined, "@new-scope/dot");

		expect(detectInstallMethod()).toBe("yarn");
		expect(command).toEqual({
			command: "yarn",
			args: ["global", "add", "--ignore-scripts", "@new-scope/dot"],
			display: "yarn global remove @dotkaio/dot-coding-agent && yarn global add --ignore-scripts @new-scope/dot",
			steps: [
				{
					command: "yarn",
					args: ["global", "remove", "@dotkaio/dot-coding-agent"],
					display: "yarn global remove @dotkaio/dot-coding-agent",
				},
				{
					command: "yarn",
					args: ["global", "add", "--ignore-scripts", "@new-scope/dot"],
					display: "yarn global add --ignore-scripts @new-scope/dot",
				},
			],
		});
	});

	test("self-updates renamed bun global installs by removing the old package first", () => {
		createBunGlobalInstall();

		const command = getSelfUpdateCommand("@dotkaio/dot-coding-agent", undefined, "@new-scope/dot");

		expect(detectInstallMethod()).toBe("bun");
		expect(command).toEqual({
			command: "bun",
			args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/dot"],
			display:
				"bun uninstall -g @dotkaio/dot-coding-agent && bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/dot",
			steps: [
				{
					command: "bun",
					args: ["uninstall", "-g", "@dotkaio/dot-coding-agent"],
					display: "bun uninstall -g @dotkaio/dot-coding-agent",
				},
				{
					command: "bun",
					args: ["install", "-g", "--ignore-scripts", "--minimum-release-age=0", "@new-scope/dot"],
					display: "bun install -g --ignore-scripts --minimum-release-age=0 @new-scope/dot",
				},
			],
		});
	});

	test("does not self-update when npm install path is not writable", () => {
		const { packageDir } = createNpmPrefixInstall();
		chmodSync(packageDir, 0o500);

		expect(getSelfUpdateCommand("@dotkaio/dot-coding-agent")).toBeUndefined();
		expect(getSelfUpdateUnavailableInstruction("@dotkaio/dot-coding-agent")).toContain(
			"the install path is not writable",
		);
	});
});
