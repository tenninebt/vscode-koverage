/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from "vscode"
import * as rx from "rxjs"
import type { Logger } from "./Logger"

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
      this.cleanUpRemove(e.removed)
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
    return this._perFolderConfigChanged.get(workspaceFolder.uri)!.asObservable()
  }

  public get(workspaceFolder: vscode.WorkspaceFolder): Config {
    return this._perFolderConfig.get(workspaceFolder.uri)!
  }


  private cleanUpRemove(removed: readonly vscode.WorkspaceFolder[]): void {
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
    const defaultConfig = this.getDefaultConfig(rawConfig)
    const newConfig = this.convertConfig(rawConfig)
    const { invalidRules, validConfig } = newConfig.validate(defaultConfig)

    this._perFolderConfig.set(workspaceFolder.uri, validConfig)
    if (invalidRules?.length) {
      this.logger.warn(`Invalid configuration : \n${invalidRules.join("\n- ")}\nThe following configuration will be used :\n ${JSON.stringify(validConfig, null, 2)}`)
    }
    await this.publishConfigToVSCode(rawConfig, validConfig)
    let notifier = this._perFolderConfigChanged.get(workspaceFolder.uri)
    if (!notifier) {
      notifier = new rx.Subject<Config>()
      this._perFolderConfigChanged.set(workspaceFolder.uri, notifier)
    }
    notifier.next(validConfig)
  }

  private getDefaultConfig(rawWorkspaceConfig: vscode.WorkspaceConfiguration): Config {
    const coverageCommand = rawWorkspaceConfig.inspect("coverageCommand")?.defaultValue as string
    const coverageFileNames = rawWorkspaceConfig.inspect("coverageFileNames")?.defaultValue as string[]
    const coverageFilePaths = rawWorkspaceConfig.inspect("coverageFilePaths")?.defaultValue as string[]
    const ignoredPathGlobs = rawWorkspaceConfig.inspect("ignoredPathGlobs")?.defaultValue as string
    const lowCoverageThreshold = rawWorkspaceConfig.inspect("lowCoverageThreshold")?.defaultValue as number
    const sufficientCoverageThreshold = rawWorkspaceConfig.inspect("sufficientCoverageThreshold")?.defaultValue as number
    const autoRefresh = rawWorkspaceConfig.inspect("autoRefresh")?.defaultValue as boolean
    const autoRefreshDebounce = rawWorkspaceConfig.inspect("autoRefreshDebounce")?.defaultValue as number
    const defaultConfig = new Config({
      coverageCommand,
      autoRefresh,
      autoRefreshDebounce,
      coverageFileNames,
      coverageFilePaths,
      ignoredPathGlobs,
      lowCoverageThreshold,
      sufficientCoverageThreshold
    })
    return defaultConfig
  }

  private async publishConfigToVSCode(updatedRawConfig: vscode.WorkspaceConfiguration, config: Config): Promise<void> {
    await updatedRawConfig.update("coverageCommand", config.coverageCommand)
    await updatedRawConfig.update("autoRefresh", config.autoRefresh)
    await updatedRawConfig.update("autoRefreshDebounce", config.autoRefreshDebounce)
    await updatedRawConfig.update("coverageFileNames", config.coverageFileNames)
    await updatedRawConfig.update("coverageFilePaths", config.coverageFilePaths)
    await updatedRawConfig.update("lowCoverageThreshold", config.lowCoverageThreshold)
    await updatedRawConfig.update("sufficientCoverageThreshold", config.sufficientCoverageThreshold)
  }


  private convertConfig(workspaceConfiguration: vscode.WorkspaceConfiguration): Config {
    // Basic configurations
    const coverageCommand = workspaceConfiguration.get("coverageCommand") as string
    const coverageFileNames = workspaceConfiguration.get("coverageFileNames") as string[]
    const coverageFilePaths = workspaceConfiguration.get("coverageFilePaths") as string[]
    const ignoredPathGlobs = workspaceConfiguration.get("ignoredPathGlobs") as string
    const lowCoverageThreshold = workspaceConfiguration.get("lowCoverageThreshold") as number
    const sufficientCoverageThreshold = workspaceConfiguration.get("sufficientCoverageThreshold") as number
    const autoRefresh = workspaceConfiguration.get("autoRefresh") as boolean
    const autoRefreshDebounce = workspaceConfiguration.get("autoRefreshDebounce") as number
    return new Config({
      coverageCommand,
      autoRefresh,
      autoRefreshDebounce,
      coverageFileNames,
      coverageFilePaths,
      ignoredPathGlobs,
      lowCoverageThreshold,
      sufficientCoverageThreshold
    })
  }
}

export class Config {

  public coverageCommand: string
  public autoRefresh: boolean
  public autoRefreshDebounce: number
  public coverageFileNames: string[]
  public coverageFilePaths: string[]
  public ignoredPathGlobs: string
  public lowCoverageThreshold: number
  public sufficientCoverageThreshold: number

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

  public validate(defaultValues: Config): { validConfig: Config; invalidRules: string[] } {
    let validConfig = {
      ...this
    }
    const invalidRules: string[] = []

    if (this.sufficientCoverageThreshold <= 0 || this.sufficientCoverageThreshold > 100) {
      validConfig = {
        ...validConfig,
        sufficientCoverageThreshold: defaultValues.sufficientCoverageThreshold
      }
      invalidRules.push(`Rule: 0 < sufficientCoverageThreshold(${this.sufficientCoverageThreshold}) < 100`)
    }
    if (this.lowCoverageThreshold < 0 || this.lowCoverageThreshold >= 99) {
      validConfig = {
        ...validConfig,
        lowCoverageThreshold: defaultValues.lowCoverageThreshold
      }
      invalidRules.push(`Rule: 0 <= lowCoverageThreshold(${this.lowCoverageThreshold}) < 99`)
    }
    if (this.sufficientCoverageThreshold < this.lowCoverageThreshold) {
      validConfig = {
        ...validConfig,
        lowCoverageThreshold: defaultValues.lowCoverageThreshold,
        sufficientCoverageThreshold: defaultValues.sufficientCoverageThreshold
      }
      invalidRules.push(`sufficientCoverageThreshold(${this.sufficientCoverageThreshold}) > lowCoverageThreshold(${this.lowCoverageThreshold})`)
    }
    return {
      validConfig,
      invalidRules
    }
  }
}

