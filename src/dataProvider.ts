import * as vscode from 'vscode';
import * as fs from 'fs';
import * as iopath from 'path';
import { CoverageParser } from './coverage-system/coverage-parser';
import { FilesLoader } from './coverage-system/files-loader';
import { Command, Uri } from 'vscode';
import { debuglog } from 'util';

export class FileCoverageDataProvider implements vscode.TreeDataProvider<CoverageNode> {
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

    getTreeItem(element: CoverageNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CoverageNode): Thenable<CoverageNode[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No file coverage in empty workspace');
            return Promise.resolve([]);
        }

        if (!element) {
            return this
                .getIndexedCoverageData()
                .then(indexedCoverageData => {
                    for(let node of indexedCoverageData.values()){
                        if (node.depth === 0) {
                            return node.children;
                        }
                    }
                });
        } else {
            return Promise.resolve(element.children);
        }
    }

    private _onDidChangeTreeData: vscode.EventEmitter<CoverageNode | undefined> = new vscode.EventEmitter<CoverageNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<CoverageNode | undefined> = this._onDidChangeTreeData.event;

    private async getRawCoverageData(): Promise<[string, any][]> {
        let coverageData = await this.filesLoader
            .findCoverageFiles()
            .then(fileNames => this.filesLoader.loadDataFiles(fileNames))
            .then(async files => Array.from(await this.coverageParser.filesToSections(files)));
        return coverageData;
    }

    private async getIndexedCoverageData(): Promise<Map<string, CoverageNode>> {

        let coverageData = await this.getRawCoverageData();
        let nodesMap: Map<string, CoverageNode> = new Map<string, CoverageNode>();
        coverageData.forEach(([fullPath, coverageData]) => {

            let pathSteps = fullPath.split('/');
            let parentPath = "";
            let path = "";

            for (let index = 0; index < pathSteps.length; index++) {
                const step = pathSteps[index];
                parentPath = path;
                path = iopath.join(path, step);

                if (!nodesMap.has(parentPath)) {
                    nodesMap.set(parentPath, new FolderCoverageNode(parentPath, parentPath, index, [], this.getCoverageLevel));
                }

                const parentNode = nodesMap.get(parentPath);
                if (parentNode instanceof FolderCoverageNode) {
                    if (index === pathSteps.length - 1) {
                        const node = new FileCoverageNode(path, step, index, this.getCoverageLevel, coverageData.lines.found, coverageData.lines.hit);
                        parentNode.children.push(node);
                        nodesMap.set(path, node);
                    } else {
                        if (!nodesMap.has(path)) {
                            const node = new FolderCoverageNode(path, step, index, [], this.getCoverageLevel);
                            parentNode.children.push(node);
                            nodesMap.set(path, node);
                        }
                    }
                } else {
                    debuglog("Weird case !!!!");
                }
            }
        });

        return nodesMap;
    }

    //TODO should be based on the config
    public getCoverageLevel(coveragePercent: number): CoverageLevel {
        const coverageLevel =
            coveragePercent >= 70 ? CoverageLevel.High :
                coveragePercent >= 50 ? CoverageLevel.Medium :
                    CoverageLevel.Low;
        return coverageLevel;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
}

enum CoverageLevel {
    Low = 'low',
    Medium = 'medium',
    High = 'high'
}

export abstract class CoverageNode extends vscode.TreeItem {
    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly children: CoverageNode[],
        protected readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
        collapsibleState: vscode.TreeItemCollapsibleState | undefined 
    ) {
        super(label, collapsibleState);
    }

    public getCoveragePercent(): number {
        return this.coveredLinesCount / this.totalLinesCount * 100;
    }

    abstract get totalLinesCount(): number;

    abstract get coveredLinesCount(): number;

    get tooltip(): string {
        return `${this.label}-${this.getCoveragePercent()}`;
    }

    get description(): string {
        return this.getCoveragePercent().toPrecision(2) + '%';
    }

    get resourceUri(): Uri {
        return Uri.file(this.path);
    }

    get command(): Command {
        return {
            command: 'vscode.open',
            title: 'Open',
            arguments: [Uri],
        };
    }

    private _getCoverageLevel(): CoverageLevel {
        return this.getCoverageLevel(this.getCoveragePercent());
    }

    get iconPath() {
        const light = iopath.join(__filename, '..', '..', 'resources', 'light', `${this._getCoverageLevel().toString()}.svg`);
        const dark = iopath.join(__filename, '..', '..', 'resources', 'dark', `${this._getCoverageLevel().toString()}.svg`);
        return {
            light: light,
            dark: dark
        };
    }
}

class FolderCoverageNode extends CoverageNode {

    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly children: CoverageNode[] = [],
        public readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
    ) {
        super(path, label, depth, children, getCoverageLevel, vscode.TreeItemCollapsibleState.Collapsed);
    }

    get totalLinesCount(): number {
        var sum = 0;
        this.children.forEach(n => sum += n.totalLinesCount);
        return sum;
    }

    get coveredLinesCount(): number {
        var sum = 0;
        this.children.forEach(n => sum += n.coveredLinesCount);
        return sum;
    }
}


class FileCoverageNode extends CoverageNode {

    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
        public readonly totalLinesCount: number,
        public readonly coveredLinesCount: number,
    ) {
        super(path, label, depth, [], getCoverageLevel, vscode.TreeItemCollapsibleState.None);
    }
}
