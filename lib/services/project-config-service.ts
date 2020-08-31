import {
	CONFIG_FILE_NAME_DISPLAY,
	CONFIG_FILE_NAME_JS,
	CONFIG_FILE_NAME_TS,
} from "../constants";
import * as path from "path";
import * as _ from "lodash";
import * as ts from "typescript";
import { IFileSystem, IProjectHelper } from "../common/declarations";
import { INsConfig, IProjectConfigService } from "../definitions/project";
import { IInjector } from "../common/definitions/yok";
import {
	ConfigTransformer,
	IConfigTransformer,
	SupportedConfigValues,
} from "../tools/config-manipulation/config-transformer";
import { IBasePluginData } from "../definitions/plugins";
import semver = require("semver/preload");
import { injector } from "../common/yok";
import { EOL } from "os";

export class ProjectConfigService implements IProjectConfigService {
	constructor(
		private $fs: IFileSystem,
		private $logger: ILogger,
		private $injector: IInjector
	) {}

	private requireFromString(src: string, filename: string): NodeModule {
		// @ts-ignore
		const m = new module.constructor();
		m.paths = module.paths;
		m._compile(src, filename);
		return m.exports;
	}

	get projectHelper(): IProjectHelper {
		return this.$injector.resolve("projectHelper");
	}

	public getDefaultTSConfig(appId: string = "org.nativescript.app") {
		return `import { NativeScriptConfig } from '@nativescript/core';

export default {
  id: '${appId}',
  appResourcesPath: 'App_Resources',
  android: {
    v8Flags: '--expose_gc',
    markingMode: 'none'
  }
} as NativeScriptConfig;`.trim();
	}

	public detectInfo(
		projectDir?: string
	): {
		hasTS: boolean;
		hasJS: boolean;
		configJSFilePath: string;
		configTSFilePath: string;
	} {
		const configJSFilePath = path.join(
			projectDir || this.projectHelper.projectDir,
			CONFIG_FILE_NAME_JS
		);
		const configTSFilePath = path.join(
			projectDir || this.projectHelper.projectDir,
			CONFIG_FILE_NAME_TS
		);
		const hasTS = this.$fs.exists(configTSFilePath);
		const hasJS = this.$fs.exists(configJSFilePath);

		if (!hasTS && !hasJS) {
			throw new Error(
				`You do not appear to have a ${CONFIG_FILE_NAME_DISPLAY} file. Please install NativeScript 7+ "npm i -g nativescript". You can also try running "ns migrate" after you have the latest installed. Exiting for now.`
			);
		}

		if (hasTS && hasJS) {
			this.$logger.warn(
				`You have both a ${CONFIG_FILE_NAME_JS} and ${CONFIG_FILE_NAME_TS} file. Defaulting to ${CONFIG_FILE_NAME_TS}.`
			);
		}

		return {
			hasTS,
			hasJS,
			configJSFilePath,
			configTSFilePath,
		};
	}

	public readConfig(projectDir?: string): INsConfig {
		const { hasTS, configJSFilePath, configTSFilePath } = this.detectInfo(
			projectDir
		);

		let config: INsConfig;

		if (hasTS) {
			const rawSource = this.$fs.readText(configTSFilePath);
			const transpiledSource = ts.transpileModule(rawSource, {
				compilerOptions: { module: ts.ModuleKind.CommonJS },
			});
			const result: any = this.requireFromString(
				transpiledSource.outputText,
				configTSFilePath
			);
			config = result["default"] ? result["default"] : result;
			// console.log('transpiledSource.outputText:', transpiledSource.outputText)
			// config = eval(transpiledSource.outputText);
		} else {
			const rawSource = this.$fs.readText(configJSFilePath);
			// console.log('rawSource:', rawSource)
			// config = eval(rawSource);
			config = this.requireFromString(rawSource, configJSFilePath);
		}

		// console.log('config: ', config);

		return config;
	}

	public getValue(key: string): any {
		return _.get(this.readConfig(), key);
	}

	public setValue(key: string, value: SupportedConfigValues) {
		const { hasTS, configJSFilePath, configTSFilePath } = this.detectInfo();
		const configFilePath = configTSFilePath || configJSFilePath;
		const configContent = this.$fs.readText(configFilePath);

		try {
			const transformer: IConfigTransformer = new ConfigTransformer(
				configContent
			);
			const newContent = transformer.setValue(key, value);
			this.$fs.writeFile(configFilePath, newContent);
		} catch (error) {
			this.$logger.error(`Failed to update config.` + error);
		} finally {
			// verify config is updated correctly
			if (this.getValue(key) !== value) {
				this.$logger.error(
					`${EOL}Failed to update ${
						hasTS ? CONFIG_FILE_NAME_TS : CONFIG_FILE_NAME_JS
					}.${EOL}`
				);
				this.$logger.printMarkdown(
					`Please manually update \`${
						hasTS ? CONFIG_FILE_NAME_TS : CONFIG_FILE_NAME_JS
					}\` and set \`${key}\` to \`${value}\`.${EOL}`
				);

				// restore original content
				this.$fs.writeFile(configFilePath, configContent);
			}
		}
	}

	public writeDefaultConfig(projectDir: string, appId?: string) {
		const configTSFilePath = path.join(
			projectDir || this.projectHelper.projectDir,
			CONFIG_FILE_NAME_TS
		);

		this.$fs.writeFile(configTSFilePath, this.getDefaultTSConfig(appId));
	}

	public writeLegacyNSConfigIfNeeded(
		projectDir: string,
		runtimePackage: IBasePluginData
	) {
		if (
			runtimePackage.version &&
			semver.gte(runtimePackage.version, "7.0.0-rc.5")
		) {
			return;
		}

		const runtimePackageDisplay = `${runtimePackage.name}${
			runtimePackage.version ? "@" + runtimePackage.version : ""
		}`;

		this.$logger.info();
		this.$logger.printMarkdown(`
Using __${runtimePackageDisplay}__ which requires \`nsconfig.json\` to be present.
Writing \`nsconfig.json\` based on the values set in \`${CONFIG_FILE_NAME_DISPLAY}\`.
You may add \`nsconfig.json\` to \`.gitignore\` as the CLI will regenerate it as necessary.`);

		const nsConfigPath = path.join(
			projectDir || this.projectHelper.projectDir,
			"nsconfig.json"
		);

		this.$fs.writeJson(nsConfigPath, {
			_info1: `Auto Generated for backwards compatibility with the currently used runtime.`,
			_info2: `Do not edit this file manually, as any changes will be ignored.`,
			_info3: `Config changes should be done in ${CONFIG_FILE_NAME_DISPLAY} instead.`,
			appPath: this.getValue("appPath"),
			appResourcesPath: this.getValue("appResourcesPath"),
		});
	}
}

injector.register("projectConfigService", ProjectConfigService);
