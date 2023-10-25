import type * as vscodeLogging from "@vscode-logging/logger"
import * as fs from "fs"
import * as iopath from "path"
import * as childProcess from "child_process"
import * as vscode from "vscode"
import { type ConfigStore } from "./ConfigStore"
import { type CoverageParser } from "./CoverageParser"
import { type FilesLoader } from "./FilesLoader"
import { type Section as CoverageSection } from "lcov-parse"
import { WorkspaceFolderCoverage } from "./WorkspaceFolderCoverageFile"
import { type Subscription, Subject, EMPTY, Observable, throttleTime, merge, map, share } from "rxjs"
import { type BaseNode, type CoverageNode, RootCoverageNode, FolderCoverageNode, FileCoverageNode } from "./TreeNodes"
import { CoverageLevelThresholds } from "./CoverageLevel"

type RefreshReason = "<RefreshCommand>" | "<ConfigUpdated>" | "<CoverageCreated>" | "<CoverageUpdated>" | "<CoverageDeleted>"

export class FileCoverageDataProvider implements vscode.TreeDataProvider<CoverageNode>, vscode.Disposable {

  private readonly rootNodeKey: string

  private readonly refreshSink: Subject<RefreshReason>
  private readonly refreshObservable: Observable<RefreshReason>
  private readonly refreshSubscription: Subscription

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

    this.rootNodeKey = ""

    this.refreshSink = new Subject<RefreshReason>()
    this.refreshObservable = merge(this.refreshSink, this.getConfigObservable(), this.getCoverageObservable())
      .pipe(throttleTime(3000))

    this.refreshSubscription = this.refreshObservable.subscribe((reason) => {
      this.logger.info(`Refreshing due to ${reason}...`)
      this._onDidChangeTreeData.fire(undefined)
    })
  }

  public getTreeItem(element: CoverageNode): vscode.TreeItem {
    return element
  }

  public getChildren(element?: CoverageNode): Thenable<CoverageNode[]> {
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

  public forceRefresh(reason: RefreshReason): void {
    this.refreshSink.next(reason)
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
            childProcess.exec(coverageCommand, { cwd: projectPath }, (err, stdout, stderr) => {
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

  private getConfigObservable(): Observable<RefreshReason> {
    return this.configStore.configChangedNotifier.pipe<RefreshReason>(map(() => "<ConfigUpdated>"))
  }

  private getCoverageObservable(): Observable<RefreshReason> {
    if (vscode.workspace.workspaceFolders == null) {
      this.logger.debug("No file coverage in empty workspace")
      return EMPTY
    }
    return merge(
      ...vscode.workspace.workspaceFolders.map((workspaceFolder) => {
        return new Observable<RefreshReason>((observer) => {
          const searchPattern = iopath.join(
            workspaceFolder.uri.fsPath,
            `**${iopath.sep}{${this.configStore.get(workspaceFolder)?.coverageFilePaths?.join(",")}}${iopath.sep}**}`
          )
          this.logger.info(`createFileSystemWatcher(Pattern = ${searchPattern})`)
          const coverageWatcher = vscode.workspace.createFileSystemWatcher(searchPattern)
          const fileWatcherEvents = new Observable<RefreshReason>(observer => {
            coverageWatcher.onDidCreate(() => observer.next("<CoverageCreated>"))
            coverageWatcher.onDidChange(() => observer.next("<CoverageUpdated>"))
            coverageWatcher.onDidDelete(() => observer.next("<CoverageDeleted>"))
          })
          const subscription = fileWatcherEvents.subscribe(observer)
          return () => {
            this.logger.info(`Dispose FileSystemWatcher(Pattern = ${searchPattern})`)
            subscription.unsubscribe()
            coverageWatcher.dispose()
          }
        })
      })
    ).pipe(share())

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

  public dispose(): void {
    this.refreshSubscription.unsubscribe()
  }

  private readonly _onDidChangeTreeData: vscode.EventEmitter<CoverageNode | undefined> = new vscode.EventEmitter<CoverageNode | undefined>()
  readonly onDidChangeTreeData: vscode.Event<CoverageNode | undefined> = this._onDidChangeTreeData.event
}


