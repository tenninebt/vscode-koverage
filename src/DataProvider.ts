import type * as vscodeLogging from "@vscode-logging/logger"
import * as fs from "fs"
import * as iopath from "path"
import * as cp from "child_process"
import * as vscode from "vscode"
import { type ConfigStore } from "./ConfigStore"
import { type CoverageParser } from "./CoverageParser"
import { type FilesLoader } from "./FilesLoader"
import { type Section as CoverageSection } from "lcov-parse"
import { WorkspaceFolderCoverage } from "./WorkspaceFolderCoverageFile"

export class FileCoverageDataProvider implements vscode.TreeDataProvider<CoverageNode>, vscode.Disposable {
  private coverageWatcher: vscode.FileSystemWatcher

  private readonly rootNodeKey: string = ""

  constructor(
    private readonly configStore: ConfigStore,
    private readonly coverageParser: CoverageParser,
    private readonly filesLoader: FilesLoader,
    private readonly logger: vscodeLogging.IVSCodeExtLogger
  ) {
    if (configStore === null || configStore === undefined) {
      throw new Error("configStore must be defined")
    }

    if (coverageParser === null || coverageParser === undefined) {
      throw new Error("coverageParser must be defined")
    }

    if (filesLoader === null || filesLoader === undefined) {
      throw new Error("filesLoader must be defined")
    }
    this.listenToFileSystem()
    this.listenToConfigChanges()
  }

  listenToConfigChanges(): void {
    this.configStore.subscribe(() => {
      this.refresh("<ConfigChanged>")
    })
  }

  dispose(): void {
    this.coverageWatcher?.dispose()
  }

  private listenToFileSystem(): void {
    if (vscode.workspace.workspaceFolders == null) {
      // vscode.window.showInformationMessage('No file coverage in empty workspace');
      return
    }
    for (const workspaceFolder of vscode.workspace.workspaceFolders) {
      const searchPattern = iopath.join(
        workspaceFolder.uri.fsPath,
        `**${iopath.sep}{${this.configStore.get(workspaceFolder)?.coverageFilePaths?.join(",")}}${iopath.sep}**}`
      )
      this.logger.debug(`createFileSystemWatcher(Pattern = ${searchPattern})`)
      this.coverageWatcher = vscode.workspace.createFileSystemWatcher(searchPattern)
      this.coverageWatcher.onDidChange(() => {
        this.refresh("<CoverageChanged>")
      })
      this.coverageWatcher.onDidCreate(() => {
        this.refresh("<CoverageCreated>")
      })
      this.coverageWatcher.onDidDelete(() => {
        this.refresh("<CoverageDeleted>")
      })
    }
  }

  getTreeItem(element: CoverageNode): vscode.TreeItem {
    return element
  }

  getChildren(element?: CoverageNode): Thenable<CoverageNode[]> {
    if (vscode.workspace.workspaceFolders == null) {
      void vscode.window.showInformationMessage("No file coverage in empty workspace")
      return Promise.resolve([])
    }
    if (element == null) {
      return this.getIndexedCoverageData().then((indexedCoverageData) => {
        return indexedCoverageData.get(this.rootNodeKey)?.children ?? []
      })
    } else {
      return Promise.resolve(element.children.sort((a, b) => a.path.localeCompare(b.path)))
    }
  }

  public async generateCoverage(): Promise<string> {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Generating coverage...",
        cancellable: false
      },
      async () => {
        if (!vscode.workspace.workspaceFolders) {
          this.logger.warn("Empty workspace")
          throw new Error("Empty workspace")
        }
        const promises: Array<Promise<string>> = vscode.workspace.workspaceFolders.map(async (workspaceFolder) => {
          const coverageCommand = this.configStore.get(workspaceFolder)?.coverageCommand
          if (!coverageCommand) {
            this.logger.warn("No coverage command set.")
            throw new Error("No coverage command set.")
          }
          const projectPath = workspaceFolder.uri.fsPath
          const logger = this.logger

          logger.info(`Running ${coverageCommand} ...`)

          // eslint-disable-next-line @typescript-eslint/naming-convention, promise/param-names
          const progressPromise = new Promise<string>((inner_resolve, inner_reject) => {
            cp.exec(coverageCommand, { cwd: projectPath }, (err, stdout, stderr) => {
              if (err != null) {
                logger.error(`Error running coverage command: ${err.message}\n${stderr}`)
                inner_reject(err.message)
                return
              }
              logger.info("Successfully generated coverage")
              inner_resolve(stdout)
            })
          })
          return await progressPromise
        })
        return (await Promise.all(promises)).join("\n")
      }
    )
  }

  private async getRawCoverageData(): Promise<Set<WorkspaceFolderCoverage>> {
    const coverageData = await this.filesLoader.loadCoverageFiles().then(async (files) => await this.coverageParser.filesToSections(files))
    return coverageData
  }

  private async getIndexedCoverageData(): Promise<Map<string, BaseNode>> {
    let coverageData = await this.getRawCoverageData()

    coverageData = await this.postProcessPaths(coverageData)

    const nodesMap: Map<string, BaseNode> = new Map<string, BaseNode>()

    const rootNode = new RootCoverageNode(this.rootNodeKey, this.rootNodeKey, [])
    nodesMap.set(this.rootNodeKey, rootNode)

    for (const workspaceFolderCoverage of coverageData) {
      const folderConfig = this.configStore.get(workspaceFolderCoverage.workspaceFolder)
      const coverageLevelThresholds = new CoverageLevelThresholds(folderConfig.sufficientCoverageThreshold, folderConfig?.lowCoverageThreshold)

      const workspaceFolderNode = new FolderCoverageNode(
        workspaceFolderCoverage.workspaceFolder.uri.fsPath,
        workspaceFolderCoverage.workspaceFolder.name,
        [],
        coverageLevelThresholds
      )
      rootNode.children.push(workspaceFolderNode)
      nodesMap.set(workspaceFolderNode.label, workspaceFolderNode)

      for (const [codeFilePath, coverageData] of workspaceFolderCoverage.coverage) {
        const pathSteps = codeFilePath.split(iopath.sep)
        let parentNodePath = workspaceFolderNode.label // Path in the visual tree
        let parentRelativeFilePath = "" // Physical path relative to the workspace folder

        for (let index = 0; index < pathSteps.length; index++) {
          const step = pathSteps[index]
          const relativeNodePath = iopath.join(parentNodePath, step)
          const relativeFilePath = iopath.join(parentRelativeFilePath, step)
          const absoluteFilePath = iopath.join(workspaceFolderCoverage.workspaceFolder.uri.fsPath, relativeFilePath)

          const parentNode = nodesMap.get(parentNodePath)
          if (parentNode instanceof FolderCoverageNode) {
            if (!nodesMap.has(relativeNodePath)) {
              let node: CoverageNode
              if (index === pathSteps.length - 1) {
                if (!fs.existsSync(absoluteFilePath)) {
                  this.logger.warn(
                    `File ${absoluteFilePath} does not exist, if you are using a multiroot workspace, make sure you opened the .code-workspace instead of folder`
                  )
                }

                // IsLeaf node
                node = new FileCoverageNode(absoluteFilePath, step, coverageLevelThresholds, coverageData.lines.found, coverageData.lines.hit)
              } else {
                node = new FolderCoverageNode(absoluteFilePath, step, [], coverageLevelThresholds)
              }
              parentNode.children.push(node)
              nodesMap.set(relativeNodePath, node)
            }
          } else {
            // Weird case !
            this.logger.warn(`Could not find a parent node with parentPath = ${parentNodePath}`)
          }

          parentNodePath = relativeNodePath
          parentRelativeFilePath = relativeFilePath
        }
      }
    }
    return nodesMap
  }

  private async postProcessPaths(coverageData: Set<WorkspaceFolderCoverage>): Promise<Set<WorkspaceFolderCoverage>> {
    const workspaceFiles = await vscode.workspace.findFiles("**/*")
    return new Set(
      [...coverageData].map((folderCoverage: WorkspaceFolderCoverage) => {
        const folderCoverageData = new Map<string, CoverageSection>()
        folderCoverage.coverage.forEach((coverageSection: CoverageSection, key: string) => {
          const matches = workspaceFiles.filter((file) => file.fsPath.endsWith(coverageSection.file))
          if (matches.length === 1) {
            const matchedPath = matches[0].fsPath.replace(folderCoverage.workspaceFolder.uri.fsPath, "")
            if (coverageSection.file !== matchedPath) {
              this.logger.debug(`Replacing coverage section path ${coverageSection.file} by ${matchedPath}`)
              coverageSection.file = matchedPath
            }
          } else {
            this.logger.warn(`${coverageSection.file} did not have expected number of matches : ${matches.length}`)
          }
          folderCoverageData.set(coverageSection.file, coverageSection)
        })
        return new WorkspaceFolderCoverage(folderCoverage.workspaceFolder, folderCoverageData)
      })
    )
  }

  private readonly _onDidChangeTreeData: vscode.EventEmitter<CoverageNode | undefined> = new vscode.EventEmitter<CoverageNode | undefined>()
  readonly onDidChangeTreeData: vscode.Event<CoverageNode | undefined> = this._onDidChangeTreeData.event

  refresh(reason: string): void {
    this.logger.debug(`Refreshing due to ${reason}...`)
    this._onDidChangeTreeData.fire(undefined)
  }
}

enum CoverageLevel {
  Low = "low",
  Medium = "medium",
  High = "high"
}

class CoverageLevelThresholds {
  constructor(public readonly sufficientCoverageThreshold: number, public readonly lowCoverageThreshold: number) { }
}
export abstract class BaseNode extends vscode.TreeItem {
  constructor(
    public readonly path: string,
    public readonly label: string,
    public readonly children: CoverageNode[],
    collapsibleState: vscode.TreeItemCollapsibleState | undefined
  ) {
    super(label, collapsibleState)
  }

  // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
  public get resourceUri(): vscode.Uri {
    return vscode.Uri.file(this.path)
  }
}

export abstract class CoverageNode extends BaseNode {
  constructor(
    path: string,
    label: string,
    children: CoverageNode[],
    collapsibleState: vscode.TreeItemCollapsibleState | undefined,
    private readonly coverageLevelThresholds: CoverageLevelThresholds
  ) {
    super(path, label, children, collapsibleState)
  }

  private getCoveragePercent(): number {
    return this.totalLinesCount === 0 ? 100 : (this.coveredLinesCount / this.totalLinesCount) * 100
  }

  abstract get totalLinesCount(): number

  abstract get coveredLinesCount(): number

  // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
  get tooltip(): string {
    return `${this.label}: ${this.formatCoverage()}`
  }

  // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
  get description(): string {
    return this.formatCoverage()
  }

  private formatCoverage(): string {
    return `${+this.getCoveragePercent().toFixed(1)}%`
  }

  private getCoverageLevel(): CoverageLevel {
    const coverageLevel =
      this.getCoveragePercent() >= this.coverageLevelThresholds.sufficientCoverageThreshold
        ? CoverageLevel.High
        : this.getCoveragePercent() >= this.coverageLevelThresholds.lowCoverageThreshold
          ? CoverageLevel.Medium
          : CoverageLevel.Low
    return coverageLevel
  }

  // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
  get iconPath(): { light: string; dark: string } {
    const light = iopath.join(__dirname, "..", "resources", "light", `${this.getCoverageLevel().toString()}.svg`)
    const dark = iopath.join(__dirname, "..", "resources", "dark", `${this.getCoverageLevel().toString()}.svg`)
    return {
      light,
      dark
    }
  }
}

class RootCoverageNode extends BaseNode {
  constructor(path: string, label: string, children: CoverageNode[] = []) {
    super(path, label, children, vscode.TreeItemCollapsibleState.Collapsed)
  }

  get totalLinesCount(): number {
    let sum = 0
    this.children.forEach((n) => (sum += n.totalLinesCount))
    return sum
  }

  get coveredLinesCount(): number {
    let sum = 0
    this.children.forEach((n) => (sum += n.coveredLinesCount))
    return sum
  }
}

class FolderCoverageNode extends CoverageNode {
  constructor(path: string, label: string, children: CoverageNode[] = [], coverageLevelThresholds: CoverageLevelThresholds) {
    super(path, label, children, vscode.TreeItemCollapsibleState.Collapsed, coverageLevelThresholds)
  }

  get totalLinesCount(): number {
    let sum = 0
    this.children.forEach((n) => (sum += n.totalLinesCount))
    return sum
  }

  get coveredLinesCount(): number {
    let sum = 0
    this.children.forEach((n) => (sum += n.coveredLinesCount))
    return sum
  }
}

class FileCoverageNode extends CoverageNode {
  constructor(
    path: string,
    label: string,
    coverageLevelThresholds: CoverageLevelThresholds,
    public readonly totalLinesCount: number,
    public readonly coveredLinesCount: number
  ) {
    super(path, label, [], vscode.TreeItemCollapsibleState.None, coverageLevelThresholds)
    this.contextValue = FileCoverageNode.name
    this.command = {
      command: "vscode.open",
      title: "Open",
      arguments: [vscode.Uri.file(this.path)]
    }
  }
}
