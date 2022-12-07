import * as vscodeLogging from '@vscode-logging/logger';
import * as glob from "glob";
import * as fs from 'fs';
import { readFile } from "fs";
import * as iopath from "path";
import * as vscode from 'vscode';
import { ConfigStore } from "./config-store";
import { WorkspaceFolderCoverageFile, WorkspaceFolderCoverageFiles } from "./workspace-folder-coverage-file";

export class FilesLoader {

    constructor(private readonly configStore: ConfigStore, private readonly logger: vscodeLogging.IVSCodeExtLogger) { }


    /**
     * Takes files and converts to data strings for coverage consumption
     * @param files files that are to turned into data strings
     */
    public async loadCoverageFiles(): Promise<Set<WorkspaceFolderCoverageFiles>> {
        const fileNames = this.configStore.current.coverageFileNames;
        const filesPaths = this.configStore.current.coverageFilePaths;
        const files = await this.loadCoverageInWorkspace(filesPaths, fileNames);
        if (!files.size) {
            this.logger.warn('Could not find a Coverage file!');
        }
        return files;
    }
    private async loadCoverageInWorkspace(filesPaths: string[], fileNames: string[]): Promise<Set<WorkspaceFolderCoverageFiles>> {
        let coverageFiles = new Map<string, WorkspaceFolderCoverageFiles>();
        if (vscode.workspace.workspaceFolders) {
            for (const workspaceFolder of vscode.workspace.workspaceFolders) {
                for (const filePath of filesPaths) {
                    for (const fileName of fileNames) {
                        
                        const coverageFileFullPath = await this.globFind(workspaceFolder, fileName, filePath);

                        for (var f of coverageFileFullPath) {
                            if (!coverageFiles.has(workspaceFolder.uri.fsPath)) {
                                coverageFiles.set(workspaceFolder.uri.fsPath, new WorkspaceFolderCoverageFiles(workspaceFolder));
                            }
                            coverageFiles.get(workspaceFolder.uri.fsPath)?.coverageFiles.add(new WorkspaceFolderCoverageFile(f, await this.load(f)));
                        }
                    }
                }
            }
        } else {
            this.logger.warn('Empty workspace');
        }

        return new Set<WorkspaceFolderCoverageFiles>(coverageFiles.values());
    }

    private globFind(
        workspaceFolder: vscode.WorkspaceFolder,
        fileName: string,
        filePath: string
    ) {
        return new Promise<Set<string>>((resolve) => {
            glob(`${filePath}/${fileName}`,
                {
                    cwd: workspaceFolder.uri.fsPath,
                    dot: true,
                    ignore: this.configStore.current.ignoredPathGlobs,
                    realpath: true,
                    strict: false,
                },
                (err, files) => {
                    if (!files || !files.length) {
                        // Show any errors if no file was found.
                        if (err) {
                            vscode.window.showWarningMessage(`An error occured while looking for the coverage file ${err}`);
                        }
                        return resolve(new Set());
                    }
                    const setFiles = new Set<string>();
                    files.forEach((file) => setFiles.add(file));
                    return resolve(setFiles);
                },
            );
        });
    }

    private load(path: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            readFile(path, (err, data) => {
                if (err) { return reject(err); }
                return resolve(data.toString());
            });
        });
    }
}
