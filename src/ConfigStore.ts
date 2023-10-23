import * as vscode from "vscode"
import * as rx from "rxjs"
import type * as vscodeLogging from "@vscode-logging/logger"

export class ConfigStore {
  private readonly configurationKey: string = "koverage"

  private readonly _configChangedNotifier: rx.Subject<void>
  private readonly _perFolderConfig: Map<vscode.Uri, rx.BehaviorSubject<Config>>
  public get(workspaceFolder: vscode.WorkspaceFolder): Config {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this._perFolderConfig.get(workspaceFolder.uri)!.value
  }

  constructor(private readonly logger: vscodeLogging.IVSCodeExtLogger) {
    this._configChangedNotifier = new rx.Subject<void>()
    this._perFolderConfig = new Map<vscode.Uri, rx.BehaviorSubject<Config>>()

    void this.readConfig()

    // Reload the cached values if the configuration changes
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration(this.configurationKey)) {
        await this.readConfig()
      }
    })
  }

  private async readWorkspaceConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
    const updatedRawConfig = vscode.workspace.getConfiguration(this.configurationKey, workspaceFolder)
    const updatedConfig = this.convertConfig(updatedRawConfig)
    if (updatedConfig.isValid) {
      let workspaceFolderConfig = this._perFolderConfig.get(workspaceFolder.uri)
      if (workspaceFolderConfig == null) {
        workspaceFolderConfig = new rx.BehaviorSubject<Config>(updatedConfig)
        this._perFolderConfig.set(workspaceFolder.uri, workspaceFolderConfig)
      } else {
        workspaceFolderConfig.next(updatedConfig)
      }
      this._configChangedNotifier.next()
    } else {
      let rollbackConfig: Config
      const current = this._perFolderConfig.get(workspaceFolder.uri)?.value
      if (current?.isValid) {
        rollbackConfig = current
      } else {
        const coverageCommand = updatedRawConfig.inspect("coverageCommand")?.defaultValue as string
        const coverageFileNames = updatedRawConfig.inspect("coverageFileNames")?.defaultValue as string[]
        const coverageFilePaths = updatedRawConfig.inspect("coverageFilePaths")?.defaultValue as string[]
        const ignoredPathGlobs = updatedRawConfig.inspect("ignoredPathGlobs")?.defaultValue as string
        const lowCoverageThreshold = updatedRawConfig.inspect("lowCoverageThreshold")?.defaultValue as number
        const sufficientCoverageThreshold = updatedRawConfig.inspect("sufficientCoverageThreshold")?.defaultValue as number
        rollbackConfig = new Config({
          coverageCommand,
          coverageFileNames,
          coverageFilePaths,
          ignoredPathGlobs,
          lowCoverageThreshold,
          sufficientCoverageThreshold
        })
      }
      this.logger.warn(`Invalid configuration : ${JSON.stringify(updatedConfig, null, 2)}`)
      this.logger.warn(`Last valid configuration will be used : ${JSON.stringify(rollbackConfig)}`)
      await updatedRawConfig.update("coverageCommand", rollbackConfig.coverageCommand)
      await updatedRawConfig.update("coverageFileNames", rollbackConfig.coverageFileNames)
      await updatedRawConfig.update("coverageFilePaths", rollbackConfig.coverageFilePaths)
      await updatedRawConfig.update("lowCoverageThreshold", rollbackConfig.lowCoverageThreshold)
      await updatedRawConfig.update("sufficientCoverageThreshold", rollbackConfig.sufficientCoverageThreshold)
    }
  }

  private async readConfig(): Promise<void> {
    const promises = vscode.workspace.workspaceFolders?.map(async (workspaceFolder) => {
      await this.readWorkspaceConfig(workspaceFolder)
    })
    await Promise.all(promises ?? [Promise.resolve()])
  }

  private convertConfig(workspaceConfiguration: vscode.WorkspaceConfiguration): Config {
    // Basic configurations
    const coverageCommand = workspaceConfiguration.get("coverageCommand") as string
    const coverageFileNames = workspaceConfiguration.get("coverageFileNames") as string[]
    const coverageFilePaths = workspaceConfiguration.get("coverageFilePaths") as string[]
    const ignoredPathGlobs = workspaceConfiguration.get("ignoredPathGlobs") as string
    const lowCoverageThreshold = workspaceConfiguration.get("lowCoverageThreshold") as number
    const sufficientCoverageThreshold = workspaceConfiguration.get("sufficientCoverageThreshold") as number
    return new Config({
      coverageCommand,
      coverageFileNames,
      coverageFilePaths,
      ignoredPathGlobs,
      lowCoverageThreshold,
      sufficientCoverageThreshold
    })
  }

  public subscribe(next?: () => void, error?: (error: any) => void, complete?: () => void): rx.Subscription {
    return this._configChangedNotifier.subscribe(next, error, complete)
  }
}

export class Config {
  public readonly isValid: boolean

  public coverageCommand: string
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
    sufficientCoverageThreshold
  }: {
    coverageCommand: string
    coverageFileNames: string[]
    coverageFilePaths: string[]
    ignoredPathGlobs: string
    lowCoverageThreshold: number
    sufficientCoverageThreshold: number
  }) {
    this.coverageCommand = coverageCommand
    this.coverageFileNames = coverageFileNames
    this.coverageFilePaths = coverageFilePaths
    this.ignoredPathGlobs = ignoredPathGlobs
    this.lowCoverageThreshold = lowCoverageThreshold
    this.sufficientCoverageThreshold = sufficientCoverageThreshold
    // Make fileNames unique
    this.coverageFileNames = [...new Set(this.coverageFileNames)]
    // Make filePaths unique
    this.coverageFilePaths = [...new Set(this.coverageFilePaths)]

    this.isValid = this.checkRules() === null
  }

  private checkRules(): string | null {
    if (this.sufficientCoverageThreshold <= 0 || this.sufficientCoverageThreshold > 100) {
      return "Rule: 0 < sufficientCoverageThreshold < 100"
    }
    if (this.lowCoverageThreshold < 0 || this.lowCoverageThreshold >= 99) {
      return "Rule: 0 <= lowCoverageThreshold < 99"
    }
    if (this.sufficientCoverageThreshold < this.lowCoverageThreshold) {
      return "sufficientCoverageThreshold > lowCoverageThreshold"
    }
    return null
  }
}
