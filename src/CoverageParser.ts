import util from "util"
import * as iopath from "path"
import type * as vscode from "vscode"
import type { Logger } from "./Logger"
import { type Section as CoverageSection, source } from "lcov-parse"
import clover from "@cvrg-report/clover-json"
import cobertura from "cobertura-parse"
import jacoco from "@7sean68/jacoco-parse"
import { CoverageFile, CoverageType } from "./CoverageFile"
import { WorkspaceFolderCoverage, type WorkspaceFolderCoverageFiles } from "./WorkspaceFolderCoverageFile"

type CoverageFormat = "lcov-parse" | "clover-parse" | "jacoco-parse" | "cobertura-parse"
export class CoverageParser {
  constructor(private readonly logger: Logger) { }

  /**
   * Extracts coverage sections of type xml and lcov
   * @param workspaceFolders array of coverage files in string format
   */
  public async filesToSections(workspaceFolders: Set<WorkspaceFolderCoverageFiles>): Promise<Set<WorkspaceFolderCoverage>> {
    const workspaceCoverage = new Set<WorkspaceFolderCoverage>()

    for (const folder of workspaceFolders) {
      let workspaceFolderCoverage = new Map<string, CoverageSection>()

      for (const file of folder.coverageFiles) {
        // file is an array
        let coverage: Map<string, CoverageSection> = new Map<string, CoverageSection>()

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
      if (!section.lines?.hit || !section.lines?.found) {
        section.lines = {
          ...section.lines,
          hit: section.lines.details?.reduce((a: number, b: { hit: number }) => a + (b.hit > 0 ? 1 : 0), 0),
          found: section.lines.details?.length
        }
      }
    })
  }

  private convertSectionsToMap(workspaceFolder: vscode.WorkspaceFolder, format: CoverageFormat, sourceFile: string, data: CoverageSection[]): Map<string, CoverageSection> {
    const sections = new Map<string, CoverageSection>()
    const addToSectionsMap = (section: CoverageSection): void => {
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
        this.logError(format, sourceFile, err)
      }
    }

    // convert the array of sections into an unique map
    data.map(addToSectionsMap)
    return sections
  }

  private async xmlExtractCobertura(
    workspaceFolder: vscode.WorkspaceFolder,
    filename: string,
    xmlFile: string
  ): Promise<Map<string, CoverageSection>> {
    const parseContent = util.promisify(cobertura.parseContent)
    return await parseContent(xmlFile).then((data: any[]) => {
      const sections = this.convertSectionsToMap(workspaceFolder, "cobertura-parse", filename, data)
      return sections
    }).catch((error) => {
      this.logError("cobertura-parse", `filename: ${filename}`, error)
      return new Map<string, CoverageSection>()
    })
  }

  private async xmlExtractJacoco(workspaceFolder: vscode.WorkspaceFolder, filename: string, xmlFile: string): Promise<Map<string, CoverageSection>> {
    const parseContent = util.promisify(jacoco.parseContent)
    return await parseContent(xmlFile).then((data: any[]) => {
      const sections = this.convertSectionsToMap(workspaceFolder, "jacoco-parse", filename, data)
      return sections
    }).catch((error) => {
      this.logError("jacoco-parse", `filename: ${filename}`, error)
      return new Map<string, CoverageSection>()
    })
  }

  private async xmlExtractClover(workspaceFolder: vscode.WorkspaceFolder, filename: string, xmlFile: string): Promise<Map<string, CoverageSection>> {
    return await clover.parseContent(xmlFile).then((data: any[]) => {
      const sections = this.convertSectionsToMap(workspaceFolder, "clover-parse", filename, data)
      return sections
    }).catch((error) => {
      this.logError("clover-parse", `filename: ${filename}`, error)
      return new Map<string, CoverageSection>()
    })
  }

  private async lcovExtract(workspaceFolder: vscode.WorkspaceFolder, filename: string, lcovFile: string): Promise<Map<string, CoverageSection>> {
    return await new Promise<Map<string, CoverageSection>>((resolve, reject) => {
      try {
        source(lcovFile, (err: Error, data: any[]) => {
          if (err) {
            throw err
          }

          const sections = this.convertSectionsToMap(workspaceFolder, "lcov-parse", filename, data)
          resolve(sections)
        })
      } catch (error) {
        this.logError("lcov-parse", `filename: ${filename}`, error)
        resolve(new Map<string, CoverageSection>())
      }
    })
  }

  private logError(system: CoverageFormat, coverageFile: string, error: Error): void {
    const message = error.message ? error.message : error?.toString()
    const stackTrace = error.stack ?? ""
    this.logger.error(`[${Date.now()}][coverageparser][${system}]: filename: ${coverageFile} Error: ${message}\n${stackTrace}`)
  }
}
