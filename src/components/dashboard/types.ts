
export type DailyMetric = {
    dayId: string;
    payments?: {
        totalGross?: number;
        txCount?: number;
        byMethod?: {
            [methodName: string]: number;
        }
    }
}

    