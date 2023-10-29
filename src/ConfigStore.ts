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

  private readonly _configChanged: rx.Subject<void>
  public readonly ConfigChanged: rx.Observable<void>
  private readonly _foldersNotifiers: Map<vscode.Uri, rx.BehaviorSubject<Config>>

  constructor(private readonly logger: Logger) {
    this._configChanged = new rx.Subject<void>()
    this.ConfigChanged = this._configChanged.asObservable()

    this._foldersNotifiers = new Map<vscode.Uri, rx.BehaviorSubject<Config>>
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

  public getObservable(workspaceFolder: vscode.WorkspaceFolder): rx.Observable<Config> {
    return this._foldersNotifiers.get(workspaceFolder.uri)!.asObservable()
  }

  public get(workspaceFolder: vscode.WorkspaceFolder): Config {
    return this._foldersNotifiers.get(workspaceFolder.uri)!.value
  }

  private cleanUpRemovedWorkspaceFolders(removed: readonly vscode.WorkspaceFolder[]): void {
    removed.forEach((workspaceFolder) => {
      this._foldersNotifiers.get(workspaceFolder.uri)?.complete()
      this._foldersNotifiers.delete(workspaceFolder.uri)
    })
  }

  private async readConfig(): Promise<void> {
    const promises = vscode.workspace.workspaceFolders?.map(async (workspaceFolder) => {
      await this.readWorkspaceConfig(workspaceFolder)
    })
    await Promise.all(promises ?? [Promise.resolve()])
    this._configChanged.next()
  }

  private async readWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const rawConfig = vscode.workspace.getConfiguration(this.configurationKey, workspaceFolder)
    const configMeta = this.inspectConfig(rawConfig)
    const { config: validConfig, overridenConfig } = this.convertConfig(rawConfig, configMeta)

    if (!isEmpty(overridenConfig)) {
      const invalidRules = Object.values(overridenConfig).filter((c) => !!c.reason).map((c) => `${c.reason!}`)
      const warnMessage = `Invalid configuration`
      const warnDetails = `${invalidRules.join(`${os.EOL}`)}${os.EOL}Using defaults instead`
      this.logger.warn(`${warnMessage}: ${os.EOL}${warnDetails}`)
      await vscode.window.showWarningMessage(`[Koverage] ${warnMessage} ${warnDetails}`)
      await this.publishConfigToVSCode(rawConfig, overridenConfig)
    }
    let notifier = this._foldersNotifiers.get(workspaceFolder.uri)
    if (!notifier) {
      notifier = new rx.BehaviorSubject<Config>(validConfig)
      this._foldersNotifiers.set(workspaceFolder.uri, notifier)
    } else {
      notifier.next(validConfig)
    }
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

