import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CoverageParser } from './coverage-system/coverage-parser';
import { FilesLoader } from './coverage-system/files-loader';
import { Command, Uri } from 'vscode';

export class FileCoverageDataProvider implements vscode.TreeDataProvider<FileCoverage> {
    private readonly workspaceRoot: string;
    private readonly coverageParser: CoverageParser;
    private readonly filesLoader: FilesLoader;
    constructor(workspaceRoot: string | undefined, coverageParser: CoverageParser, filesLoader: FilesLoader) {
        if (workspaceRoot === null || workspaceRoot === undefined) {
            throw new Error('workspaceRoot must be defined');
        }
        this.workspaceRoot = workspaceRoot as string;

        if (coverageParser === null || coverageParser === undefined) {
            throw new Error('coverageParser must be defined');
        }
        this.coverageParser = coverageParser;

        if (filesLoader === null || filesLoader === undefined) {
            throw new Error('filesLoader must be defined');
        }
        this.filesLoader = filesLoader;
    }

    getTreeItem(element: FileCoverage): vscode.TreeItem {
        return element;
    }

    getChildren(element?: FileCoverage): Thenable<FileCoverage[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No file coverage in empty workspace');
            return Promise.resolve([]);
        }

        if (!element) {
            const filesCoverage = this.filesLoader
                .findCoverageFiles()
                .then(fileNames => this.filesLoader.loadDataFiles(fileNames))
                .then(files => this.coverageParser.filesToSections(files))
                .then(coverage => {
                    return Array.from(coverage).map(([fileName, coverageData]) => {
                        const coveragePercent = coverageData.lines.hit / coverageData.lines.found * 100;
                        const coverageLevel = 
                            coveragePercent >= 70 ? CoverageLevel.High :
                            coveragePercent >= 50 ? CoverageLevel.Medium : 
                            CoverageLevel.Low;
                        return new FileCoverage(fileName, coveragePercent, coverageLevel, vscode.TreeItemCollapsibleState.None);
                    }).sort((a, b) => a.filePath.localeCompare(b.filePath));
                });
            return filesCoverage;
        }
        
        return Promise.resolve([]);
    }

    private _onDidChangeTreeData: vscode.EventEmitter<FileCoverage | undefined> = new vscode.EventEmitter<FileCoverage | undefined>();
    readonly onDidChangeTreeData: vscode.Event<FileCoverage | undefined> = this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

enum CoverageLevel {
    Low = 'low',
    Medium = 'medium',
    High = 'high'
}
export class FileCoverage extends vscode.TreeItem {
    constructor(
        public readonly filePath: string,
        private coveragePercent: Number,
        private coverageLevel: CoverageLevel,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(filePath, collapsibleState);
    }

    get tooltip(): string {
        return `${this.label}-${this.coveragePercent}`;
    }

    get description(): string {
        return this.coveragePercent.toPrecision(2) + '%';
    }

    get resourceUri(): Uri {
        return Uri.file(this.filePath);
    }

    get command(): Command {
        return {
            command: 'vscode.open',
            title: 'Open',
            arguments: [Uri],
        };
    }

    get iconPath() {
        const light = path.join(__filename, '..', '..', 'resources', 'light', `${this.coverageLevel.toString()}.svg`);
        const dark = path.join(__filename, '..', '..', 'resources', 'dark', `${this.coverageLevel.toString()}.svg`);
        return {
            light: light,
            dark: dark
        };
    }
}
