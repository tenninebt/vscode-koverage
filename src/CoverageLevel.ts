
export enum CoverageLevel {
    Low = "low",
    Medium = "medium",
    High = "high"
}

export class CoverageLevelThresholds {
    constructor(public readonly sufficientCoverageThreshold: number, public readonly lowCoverageThreshold: number) { }
}
