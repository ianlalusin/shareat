
export type DailyMetric = {
    date: string; // YYYY-MM-DD
    sales: number;
    transactions: number;
    paymentMix: {
        [methodName: string]: number;
    };
}
