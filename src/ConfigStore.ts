/* eslint-disable @typescript-eslint/no-non-null-assertion */
import os from "os"
import * as vscode from "vscode"
import * as rx from "rxjs"
import type { Logger } from "./Logger"
import { isEmpty } from "./Utils";

interface InspectReturn<T> {
  /**
   * The fully qualified key of the configuration value
   */
  key: string;

  /**
   * The default value which is used when no other value is defined
   */
  defaultValue?: T;

  /**
   * The global or installation-wide value.
   */
  globalValue?: T;

  /**
   * The workspace-specific value.
   */
  workspaceValue?: T;

  /**
   * The workpace-folder-specific value.
   */
  workspaceFolderValue?: T;
}

type ConfigValueType = string[] | string | number | boolean | undefined

// T is not really constrained in the definition of inspect, weird this does not compile!
// type ConfigItemMeta<T extends string[] | string | number | boolean> = ReturnType<vscode.WorkspaceConfiguration[`inspect<${T}>`]>
type ConfigItemMeta<T extends ConfigValueType> = InspectReturn<T>

type ConfigMeta = {
  [P in keyof Config]: ConfigItemMeta<Config[P]>
}

type ConfigOverride = {
  [P in keyof ConfigMeta]?: ConfigMeta[P] & { reason?: string }
}

export class ConfigStore {
  private readonly configurationKey: string = "koverage"

  private readonly _configChanged: rx.Subject<Config>
  public readonly ConfigChanged: rx.Observable<Config>
  private readonly _perFolderConfigChanged: Map<vscode.Uri, rx.Subject<Config>>

  private readonly _perFolderConfig: Map<vscode.Uri, Config>

  constructor(private readonly logger: Logger) {
    this._configChanged = new rx.Subject<Config>()
    this.ConfigChanged = this._configChanged.asObservable()

    this._perFolderConfigChanged = new Map<vscode.Uri, rx.Subject<Config>>
    this._perFolderConfig = new Map<vscode.Uri, Config>()
  }

  public async init(): Promise<void> {
    await this.readConfig()

    // Reload the cached values if a workspace folder is added or deleted
    vscode.workspace.onDidChangeWorkspaceFolders(async (e) => {
      this.cleanUpRemovedWorkspaceFolders(e.removed)
      await this.readConfig()
    })
    // Reload the cached values if the configuration changes
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(this.configurationKey)) {
        await this.readConfig()
      }
    })
  }

  // private validateInput(event: vscode.ConfigurationChangeEvent): void {
  //   const getConfigurationKey = (property: keyof Config): string => {
  //     return `${this.configurationKey}.${property}`;
  //   }
  //   const getConfigurationValue = <T extends ConfigValueType>(property: keyof Config): T | undefined => {
  //     const koverageConfig = vscode.workspace.getConfiguration(this.configurationKey)
  //     return koverageConfig.get<T>(property)
  //   }

  //   const sufficientCoverageThresholdKey = getConfigurationKey("sufficientCoverageThreshold");
  //   const lowCoverageThresholdKey = getConfigurationKey("lowCoverageThreshold");
  //   const sufficientCoverageThreshold = getConfigurationValue<number>("sufficientCoverageThreshold")
  //   const lowCoverageThreshold = getConfigurationValue<number>("lowCoverageThreshold")

  //   if (event.affectsConfiguration(sufficientCoverageThresholdKey) &&
  //     sufficientCoverageThreshold && (sufficientCoverageThreshold <= 0 || sufficientCoverageThreshold > 100)) {
  //     throw new InvalidInputError(`Rule: 0 < sufficientCoverageThreshold(${sufficientCoverageThreshold}) < 100`)
  //   }

  //   if (event.affectsConfiguration(lowCoverageThresholdKey) &&
  //     lowCoverageThreshold && (lowCoverageThreshold <= 0 || lowCoverageThreshold > 100)) {
  //     throw new InvalidInputError(`Rule: 0 <= lowCoverageThreshold(${lowCoverageThreshold}) < 99`);
  //   }

  //   if ((event.affectsConfiguration(sufficientCoverageThresholdKey) || event.affectsConfiguration(lowCoverageThresholdKey)) &&
  //     sufficientCoverageThreshold && lowCoverageThreshold &&
  //     sufficientCoverageThreshold < lowCoverageThreshold) {
  //     throw new InvalidInputError(`sufficientCoverageThreshold(${sufficientCoverageThreshold}) > lowCoverageThreshold(${lowCoverageThreshold})`);
  //   }
  // }

  public getObservable(workspaceFolder: vscode.WorkspaceFolder): rx.Observable<Config> {
    return this._perFolderConfigChanged.get(workspaceFolder.uri)!.asObservable()
  }

  public get(workspaceFolder: vscode.WorkspaceFolder): Config {
    return this._perFolderConfig.get(workspaceFolder.uri)!
  }


  private cleanUpRemovedWorkspaceFolders(removed: readonly vscode.WorkspaceFolder[]): void {
    removed.forEach((workspaceFolder) => {
      this._perFolderConfigChanged.get(workspaceFolder.uri)?.complete()
      this._perFolderConfigChanged.delete(workspaceFolder.uri)
    })
  }

  private async readConfig(): Promise<void> {

    const promises = vscode.workspace.workspaceFolders?.map(async (workspaceFolder) => {
      await this.readWorkspaceConfig(workspaceFolder)
    })
    await Promise.all(promises ?? [Promise.resolve()])
  }

  private async readWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {

    const rawConfig = vscode.workspace.getConfiguration(this.configurationKey, workspaceFolder)
    const configMeta = this.inspectConfig(rawConfig)
    const { config: validConfig, overridenConfig } = this.convertConfig(rawConfig, configMeta)

    this._perFolderConfig.set(workspaceFolder.uri, validConfig)
    if (!isEmpty(overridenConfig)) {
      const invalidRules = Object.values(overridenConfig).filter((c) => !!c.reason).map((c) => `${c.reason!}`)
      const warnMessage = `Invalid configuration`
      const warnDetails = `${invalidRules.join(`${os.EOL}`)}${os.EOL}Using defaults instead`
      this.logger.warn(`${warnMessage}: ${os.EOL}${warnDetails}`)
      await vscode.window.showWarningMessage(`[Koverage] ${warnMessage} ${warnDetails}`)
      await this.publishConfigToVSCode(rawConfig, overridenConfig)
    }
    let notifier = this._perFolderConfigChanged.get(workspaceFolder.uri)
    if (!notifier) {
      notifier = new rx.Subject<Config>()
      this._perFolderConfigChanged.set(workspaceFolder.uri, notifier)
    }
    notifier.next(validConfig)
  }

  private inspectConfig(rawWorkspaceConfig: vscode.WorkspaceConfiguration): ConfigMeta {
    const coverageCommand = rawWorkspaceConfig.inspect<string>("coverageCommand")!
    const autoRefresh = rawWorkspaceConfig.inspect<boolean>("autoRefresh")!
    const autoRefreshDebounce = rawWorkspaceConfig.inspect<number>("autoRefreshDebounce")!
    const coverageFileNames = rawWorkspaceConfig.inspect<string[]>("coverageFileNames")!
    const coverageFilePaths = rawWorkspaceConfig.inspect<string[]>("coverageFilePaths")!
    const ignoredPathGlobs = rawWorkspaceConfig.inspect<string>("ignoredPathGlobs")!
    const lowCoverageThreshold = rawWorkspaceConfig.inspect<number>("lowCoverageThreshold")!
    const sufficientCoverageThreshold = rawWorkspaceConfig.inspect<number>("sufficientCoverageThreshold")!
    return {
      coverageCommand,
      autoRefresh,
      autoRefreshDebounce,
      coverageFileNames,
      coverageFilePaths,
      ignoredPathGlobs,
      lowCoverageThreshold,
      sufficientCoverageThreshold
    }
  }

  private async publishConfigToVSCode(updatedRawConfig: vscode.WorkspaceConfiguration, overridenConfig: ConfigOverride): Promise<void> {

    function getConfigurationTarget<T extends ConfigValueType>(configMeta: ConfigItemMeta<T>): vscode.ConfigurationTarget | undefined {
      return configMeta.workspaceFolderValue ? vscode.ConfigurationTarget.WorkspaceFolder :
        configMeta.workspaceValue ? vscode.ConfigurationTarget.Workspace :
          configMeta.globalValue ? vscode.ConfigurationTarget.Global :
            undefined
    }

    for (const [key, value] of Object.entries(overridenConfig)) {
      if (value) {
        const target = getConfigurationTarget<typeof value.defaultValue>(value)
        if (target) {
          await updatedRawConfig.update(key, value.defaultValue, target)
        }
      }
    }
  }


  private convertConfig(rawConfig: vscode.WorkspaceConfiguration, configMeta: ConfigMeta): { config: Config; overridenConfig: ConfigOverride } {

    let config: Config = new Config({
      coverageCommand: rawConfig.get<string>("coverageCommand") ?? configMeta.coverageCommand?.defaultValue as string,
      autoRefresh: rawConfig.get<boolean>("autoRefresh") ?? configMeta.autoRefresh?.defaultValue as boolean,
      autoRefreshDebounce: rawConfig.get<number>("autoRefreshDebounce") ?? configMeta.autoRefreshDebounce?.defaultValue as number,
      coverageFileNames: rawConfig.get<string[]>("coverageFileNames") ?? configMeta.coverageFileNames?.defaultValue as string[],
      coverageFilePaths: rawConfig.get<string[]>("coverageFilePaths") ?? configMeta.coverageFilePaths?.defaultValue as string[],
      ignoredPathGlobs: rawConfig.get<string>("ignoredPathGlobs") ?? configMeta.ignoredPathGlobs?.defaultValue as string,
      lowCoverageThreshold: rawConfig.get<number>("lowCoverageThreshold") ?? configMeta.lowCoverageThreshold?.defaultValue as number,
      sufficientCoverageThreshold: rawConfig.get<number>("sufficientCoverageThreshold") ?? configMeta.sufficientCoverageThreshold?.defaultValue as number,
    })

    let overridenConfig: ConfigOverride = {}
    if (config.sufficientCoverageThreshold <= 0 || config.sufficientCoverageThreshold > 100) {
      overridenConfig = {
        ...overridenConfig,
        sufficientCoverageThreshold: {
          ...configMeta.sufficientCoverageThreshold,
          reason: `Rule: 0 < sufficientCoverageThreshold(${config.sufficientCoverageThreshold}) < 100`
        }
      }
      config = {
        ...config,
        sufficientCoverageThreshold: configMeta.sufficientCoverageThreshold.defaultValue!
      }
    }
    if (config.lowCoverageThreshold < 0 || config.lowCoverageThreshold >= 99) {
      overridenConfig = {
        ...overridenConfig,
        sufficientCoverageThreshold: {
          ...configMeta.lowCoverageThreshold,
          reason: `Rule: 0 <= lowCoverageThreshold(${config.lowCoverageThreshold}) < 99`
        }
      }
      config = {
        ...config,
        lowCoverageThreshold: configMeta.lowCoverageThreshold.defaultValue!
      }
    }
    if (config.sufficientCoverageThreshold < config.lowCoverageThreshold) {
      overridenConfig = {
        ...overridenConfig,
        sufficientCoverageThreshold: {
          ...configMeta.sufficientCoverageThreshold,
          reason: `Rule: sufficientCoverageThreshold(${config.sufficientCoverageThreshold}) > lowCoverageThreshold(${config.lowCoverageThreshold})`
        },
        lowCoverageThreshold: {
          ...configMeta.lowCoverageThreshold,
        }
      }
      config = {
        ...config,
        sufficientCoverageThreshold: configMeta.sufficientCoverageThreshold.defaultValue!,
        lowCoverageThreshold: configMeta.lowCoverageThreshold.defaultValue!
      }
    }
    return {
      config,
      overridenConfig
    }

  }
}

export class Config {

  public readonly coverageCommand: string
  public readonly autoRefresh: boolean
  public readonly autoRefreshDebounce: number
  public readonly coverageFileNames: string[]
  public readonly coverageFilePaths: string[]
  public readonly ignoredPathGlobs: string
  public readonly lowCoverageThreshold: number
  public readonly sufficientCoverageThreshold: number

  constructor({
    coverageCommand,
    coverageFileNames,
    coverageFilePaths,
    ignoredPathGlobs,
    lowCoverageThreshold,
    sufficientCoverageThreshold,
    autoRefresh,
    autoRefreshDebounce,
  }: {
    coverageCommand: string
    coverageFileNames: string[]
    coverageFilePaths: string[]
    ignoredPathGlobs: string
    lowCoverageThreshold: number
    sufficientCoverageThreshold: number
    autoRefresh: boolean
    autoRefreshDebounce: number
  }) {
    this.coverageCommand = coverageCommand
    this.autoRefresh = autoRefresh
    this.autoRefreshDebounce = autoRefreshDebounce
    this.coverageFileNames = coverageFileNames
    this.coverageFilePaths = coverageFilePaths
    this.ignoredPathGlobs = ignoredPathGlobs
    this.lowCoverageThreshold = lowCoverageThreshold
    this.sufficientCoverageThreshold = sufficientCoverageThreshold
    // Make fileNames unique
    this.coverageFileNames = [...new Set(this.coverageFileNames)]
    // Make filePaths unique
    this.coverageFilePaths = [...new Set(this.coverageFilePaths)]

  }
}

