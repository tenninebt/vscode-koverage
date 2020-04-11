import { readFile } from "fs";
import * as glob from "glob";
import * as iopath from "path";
import * as fs from 'fs';
import * as vscode from 'vscode';
import { workspace, WorkspaceFolder } from "vscode";
import { ConfigStore } from "./configStore";

export class FilesLoader {

    constructor(private readonly configStore: ConfigStore) { }

    /**
     * Finds all coverages files by xml and lcov and returns them
     * Note: Includes developer override via "manualCoverageFilePaths"
     */
    public async findCoverageFiles(): Promise<Set<string>> {
        const fileNames = this.configStore.current.coverageFileNames;
        const filesPaths = this.configStore.current.coverageFilePaths;
        const files = await this.findCoverageInWorkspace(filesPaths, fileNames);
        if (!files.size) { throw new Error("Could not find a Coverage file!"); }
        return files;
    }

    /**
     * Takes files and converts to data strings for coverage consumption
     * @param files files that are to turned into data strings
     */
    public async loadDataFiles(files: Set<string>): Promise<Map<string, string>> {
        // Load the files and convert into data strings
        const dataFiles = new Map<string, string>();
        for (const file of files) {
            dataFiles.set(file, await this.load(file));
        }
        return dataFiles;
    }

    private load(path: string) {
        return new Promise<string>((resolve, reject) => {
            readFile(path, (err, data) => {
                if (err) { return reject(err); }
                return resolve(data.toString());
            });
        });
    }

    private async findCoverageInWorkspace(filesPaths: string[], fileNames: string[]) {
        let files = new Set<string>();
        if (vscode.workspace.rootPath) {
            const rootPath = vscode.workspace.rootPath;
            for (const filePath of filesPaths) {
                for (const fileName of fileNames) {
                    const fullRelativePath = iopath.join(rootPath, filePath, fileName);
                    if (fs.existsSync(fullRelativePath) && fs.lstatSync(fullRelativePath).isFile()) {
                        files = new Set([...files, fullRelativePath]);
                    }
                }
            }
        }

        return files;
    }
}
