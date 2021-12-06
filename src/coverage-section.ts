export interface CoverageSection {
    title:     string;
    file:      string;
    functions: CoverageSectionFunctions;
    lines:     CoverageSectionLines;
}

export interface CoverageSectionFunctions {
    hit:     number;
    found:   number;
    details: CoverageSectionFunctionsDetail[];
}

export interface CoverageSectionFunctionsDetail {
    name: string;
    line: number;
    hit:  number;
}

export interface CoverageSectionLines {
    found:   number;
    hit:     number;
    details: CoverageSectionLinesDetail[];
}

export interface CoverageSectionLinesDetail {
    line: number;
    hit:  number;
}
