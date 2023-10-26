import type { Logger } from "./Logger"
import { glob } from "glob"
import { readFile } from "fs"
import * as vscode from "vscode"
import { type ConfigStore } from "./ConfigStore"
import { WorkspaceFolderCoverageFile, WorkspaceFolderCoverageFiles } from "./WorkspaceFolderCoverageFile"

export class FilesLoader {
  constructor(private readonly configStore: ConfigStore, private readonly logger: Logger) { }

  /**
   * Takes files and converts to data strings for coverage consumption
   * @param files files that are to turned into data strings
   */
  public async loadCoverageFiles(): Promise<Set<WorkspaceFolderCoverageFiles>> {
    const files = await this.loadCoverageInWorkspace()
    if (!files.size) {
      this.logger.warn("Could not find a Coverage file!")
    }
    return files
  }

  private async loadCoverageInWorkspace(): Promise<Set<WorkspaceFolderCoverageFiles>> {
    const coverageFiles = new Map<string, WorkspaceFolderCoverageFiles>()

    if (!vscode.workspace.workspaceFolders) {
      this.logger.warn("Empty workspace")
      throw new Error("Empty workspace")
    }

    for (const workspaceFolder of vscode.workspace.workspaceFolders) {
      const folderConfig = this.configStore.get(workspaceFolder)
      const filesPaths = folderConfig?.coverageFilePaths ?? []
      const fileNames = folderConfig?.coverageFileNames ?? []
      for (const filePath of filesPaths) {
        for (const fileName of fileNames) {
          const coverageFileFullPath = await this.globFind(workspaceFolder, fileName, filePath)

          for (const f of coverageFileFullPath) {
            if (!coverageFiles.has(workspaceFolder.uri.fsPath)) {
              coverageFiles.set(workspaceFolder.uri.fsPath, new WorkspaceFolderCoverageFiles(workspaceFolder))
            }
            coverageFiles.get(workspaceFolder.uri.fsPath)?.coverageFiles.add(new WorkspaceFolderCoverageFile(f, await this.load(f)))
          }
        }
      }
    }

    return new Set<WorkspaceFolderCoverageFiles>(coverageFiles.values())
  }

  private async globFind(workspaceFolder: vscode.WorkspaceFolder, fileName: string, filePath: string): Promise<Set<string>> {
    return await new Promise<Set<string>>((resolve) => {
      glob(
        `${filePath}/${fileName}`,
        {
          cwd: workspaceFolder.uri.fsPath,
          dot: true,
          ignore: this.configStore.get(workspaceFolder)?.ignoredPathGlobs,
          realpath: true,
          strict: false
        },
        (err, files) => {
          if (!files || files.length === 0) {
            // Show any errors if no file was found.
            if (err != null) {
              void vscode.window.showWarningMessage(`An error occured while looking for the coverage file ${err.message}`)
            }
            resolve(new Set())
            return
          }
          const setFiles = new Set<string>()
          files.forEach((file) => setFiles.add(file))
          resolve(setFiles)
        }
      )
    })
  }

  private async load(path: string): Promise<string> {
    return await new Promise<string>((resolve, reject) => {
      readFile(path, (err, data) => {
        if (err != null) {
          reject(err)
          return
        }
        resolve(data.toString())
      })
    })
  }
}
