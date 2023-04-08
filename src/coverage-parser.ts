import { parseContent as parseContentClover } from "@cvrg-report/clover-json"
import type * as vscodeLogging from "@vscode-logging/logger"
import { parseContent as parseContentCobertura } from "@cvrg-report/cobertura-json"
import { parseContent as parseContentJacoco } from "@cvrg-report/jacoco-json"
import { type Section, source } from "lcov-parse"
import * as iopath from "path"
import type * as vscode from "vscode"
import { CoverageFile, CoverageType } from "./coverage-file"
import { WorkspaceFolderCoverage, type WorkspaceFolderCoverageFiles } from "./workspace-folder-coverage-file"

export class CoverageParser {
  constructor(private readonly logger: vscodeLogging.IVSCodeExtLogger) {}

  /**
   * Extracts coverage sections of type xml and lcov
   * @param workspaceFolders array of coverage files in string format
   */
  public async filesToSections(workspaceFolders: Set<WorkspaceFolderCoverageFiles>): Promise<Set<WorkspaceFolderCoverage>> {
    const workspaceCoverage = new Set<WorkspaceFolderCoverage>()

    for (const folder of workspaceFolders) {
      let workspaceFolderCoverage = new Map<string, Section>()

      for (const file of folder.coverageFiles) {
        // file is an array
        let coverage: Map<string, Section> = new Map<string, Section>()

        // get coverage file type
        const coverageFile = new CoverageFile(file.content)
        switch (coverageFile.type) {
          case CoverageType.CLOVER:
            coverage = await this.xmlExtractClover(folder.workspaceFolder, file.path, file.content)
            break
          case CoverageType.JACOCO:
            coverage = await this.xmlExtractJacoco(folder.workspaceFolder, file.path, file.content)
            break
          case CoverageType.COBERTURA:
            coverage = await this.xmlExtractCobertura(folder.workspaceFolder, file.path, file.content)
            break
          case CoverageType.LCOV:
            coverage = await this.lcovExtract(folder.workspaceFolder, file.path, file.content)
            break
          default:
            break
        }
        // add new coverage map to existing coverages generated so far
        workspaceFolderCoverage = new Map([...workspaceFolderCoverage, ...coverage])
      }

      workspaceCoverage.add(new WorkspaceFolderCoverage(folder.workspaceFolder, workspaceFolderCoverage))
    }

    return workspaceCoverage
  }

  private recomputeStats(data: any[]): void {
    data.forEach((section) => {
      if (!section.hit || !section.found) {
        section.lines.hit = section.lines.details.reduce((a: number, b: { hit: number }) => a + (b.hit > 0 ? 1 : 0), 0)
        section.lines.found = section.lines.details.length
      }
    })
  }

  private async convertSectionsToMap(workspaceFolder: vscode.WorkspaceFolder, sourceFile: string, data: Section[]): Promise<Map<string, Section>> {
    const sections = new Map<string, Section>()
    const addToSectionsMap = async (section: { title: string; file: string }): Promise<void> => {
      try {
        if (!section.file) {
          this.logger.warn(`Invalid section in the coverage file: ${sourceFile}`)
          return
        }
        this.recomputeStats(data)
        let filePath = section.file
        if (iopath.isAbsolute(filePath)) {
          // Convert to a path relative to the workspace root
          if (filePath.toLowerCase().startsWith(workspaceFolder.uri.fsPath.toLowerCase())) {
            filePath = filePath.substring(workspaceFolder.uri.fsPath.length)
          }
          section.file = filePath
        }

        sections.set(filePath, section)
      } catch (err) {
        err.message = `Invalid coverage file: ${sourceFile}`
        this.handleError("lcov-parse", err)
      }
    }

    // convert the array of sections into an unique map
    const addPromises = data.map(addToSectionsMap)
    await Promise.all(addPromises)
    return sections
  }

  private async xmlExtractCobertura(workspaceFolder: vscode.WorkspaceFolder, filename: string, xmlFile: string): Promise<Map<string, Section>> {
    return await new Promise<Map<string, Section>>((resolve, reject) => {
      const checkError = (err: Error): void => {
        if (err) {
          err.message = `filename: ${filename} ${err.message}`
          this.handleError("cobertura-parse", err)
          resolve(new Map<string, Section>())
        }
      }

      try {
        parseContentCobertura(
          xmlFile,
          async (err: any, data: any[]) => {
            checkError(err)
            const sections = await this.convertSectionsToMap(workspaceFolder, filename, data)
            resolve(sections)
          },
          true
        )
      } catch (error) {
        checkError(error)
      }
    })
  }

  private async xmlExtractJacoco(workspaceFolder: vscode.WorkspaceFolder, filename: string, xmlFile: string): Promise<Map<string, Section>> {
    return await new Promise<Map<string, Section>>((resolve, reject) => {
      const checkError = (err: Error): void => {
        if (err) {
          err.message = `filename: ${filename} ${err.message}`
          this.handleError("jacoco-parse", err)
          resolve(new Map<string, Section>())
        }
      }

      try {
        parseContentJacoco(xmlFile, async (err: any, data: any[]) => {
          checkError(err)
          const sections = await this.convertSectionsToMap(workspaceFolder, filename, data)
          resolve(sections)
        })
      } catch (error) {
        checkError(error)
      }
    })
  }

  private async xmlExtractClover(workspaceFolder: vscode.WorkspaceFolder, filename: string, xmlFile: string): Promise<Map<string, Section>> {
    try {
      const data = await parseContentClover(xmlFile)
      const sections = await this.convertSectionsToMap(workspaceFolder, filename, data)
      return sections
    } catch (error: unknown) {
      const message = `filename: ${filename} ${(error as Error).message}`
      this.handleError("clover-parse", new Error(message))
      // return empty map (no coverage
      return new Map<string, Section>()
    }
  }

  private async lcovExtract(workspaceFolder: vscode.WorkspaceFolder, filename: string, lcovFile: string): Promise<Map<string, Section>> {
    return await new Promise<Map<string, Section>>((resolve, reject) => {
      const checkError = (err: Error): void => {
        if (err) {
          err.message = `filename: ${filename} ${err.message}`
          this.handleError("lcov-parse", err)
          resolve(new Map<string, Section>())
        }
      }

      try {
        source(lcovFile, async (err: Error, data: any[]) => {
          checkError(err)
          const sections = await this.convertSectionsToMap(workspaceFolder, filename, data)
          resolve(sections)
        })
      } catch (error) {
        checkError(error)
      }
    })
  }

  private handleError(system: string, error: Error): void {
    const message = error.message ? error.message : error?.toString()
    const stackTrace = error.stack ?? ""
    this.logger.error(`[${Date.now()}][coverageparser][${system}]: Error: ${message}\n${stackTrace}`)
  }
}
