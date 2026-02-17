
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { DailyMetric, TopAddonRow, TopRefillRow } from '../src/lib/types';
import { mergeWith } from 'lodash';
import { addDays } from 'date-fns';

// In the Studio environment, service account credentials are automatically provided.
// Outside of it, you'd need to set GOOGLE_APPLICATION_CREDENTIALS.
initializeApp();
const db = getFirestore();

// --- Date Helpers ---
function startOfDay(d: Date) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d: Date) { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

const getPresetDateRanges = () => {
    const now = new Date();
    const today = startOfDay(now);
    const yesterday = startOfDay(addDays(now, -1));
    
    return new Map<string, { start: Date; end: Date }>([
        ["today", { start: today, end: endOfDay(today) }],
        ["yesterday", { start: yesterday, end: endOfDay(yesterday) }],
        ["thisWeek", { start: startOfDay(addDays(now, -now.getDay())), end: endOfDay(now) }],
        ["last7", { start: startOfDay(addDays(now, -6)), end: endOfDay(now) }],
        ["last30", { start: startOfDay(addDays(now, -29)), end: endOfDay(now) }],
        ["thisMonth", { start: startOfDay(new Date(now.getFullYear(), now.getMonth(), 1)), end: endOfDay(now) }],
        ["lastMonth", { 
            start: startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), 
            end: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) 
        }],
        ["ytd", { start: startOfDay(new Date(now.getFullYear(), 0, 1)), end: endOfDay(now) }],
    ]);
};

// --- Aggregation Logic ---

function getZeroedMetric(): Omit<DailyMetric, 'meta'> {
    return {
        payments: { byMethod: {}, totalGross: 0, txCount: 0, discountsTotal: 0, chargesTotal: 0 },
        guests: { guestCountFinalTotal: 0, packageCoversBilledByPackageName: {}, packageSessionsCount: 0, guestCountFinalByPackageName: {} },
        sales: { packageSalesAmountByName: {}, packageSalesQtyByName: {}, addonSalesAmountByCategory: {}, addonSalesQtyByCategory: {}, salesAmountByHour: {}, sessionCountByHour: {}, topAddonsByQty: [] },
        kitchen: { servedCountByType: {}, cancelledCountByType: {}, durationMsSumByType: {}, durationCountByType: {} },
        sessions: { closedCount: 0, totalPaid: 0 },
        refills: { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0, topRefillsByQty: [] },
    };
}


/** Custom merger function for lodash.mergeWith */
function merger(objValue: any, srcValue: any) {
    if (typeof objValue === 'number' && typeof srcValue === 'number') {
        return objValue + srcValue;
    }
    // Let mergeWith handle non-numeric types (e.g., objects)
}

/** Aggregates an array of daily metrics into a single metric object */
function aggregateMetrics(metrics: DailyMetric[]): DailyMetric | null {
    if (metrics.length === 0) return null;
    
    // Start with a clone of the first metric, then merge the rest into it
    const base = JSON.parse(JSON.stringify(metrics[0]));
    
    for (let i = 1; i < metrics.length; i++) {
        mergeWith(base, metrics[i], merger);
    }
    
    return base;
}

/** Computes top refills from an aggregated metric */
function computeTopRefills(metric: DailyMetric, topN = 10): TopRefillRow[] {
    const servedByName = metric.refills?.servedRefillsByName || {};
    return Object.entries(servedByName)
        .map(([name, qty]) => ({ name, qty }))
        .sort((a, b) => b.qty - a.qty)
        .slice(0, topN);
}

/** Computes top addons from an aggregated metric */
function computeTopAddons(metric: DailyMetric, topN = 10): TopAddonRow[] {
    const addonSalesByItem = metric.sales?.addonSalesByItem || {};
    return Object.entries(addonSalesByItem)
        .map(([name, data]) => ({
            name,
            qty: data.qty,
            amount: data.amount,
            categoryName: data.categoryName,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, topN);
}

// --- Main Script ---

async function main() {
    console.log("Starting dashboard preset backfill script...");

    const args = process.argv.slice(2).reduce((acc, arg) => {
        const [key, value] = arg.split('=');
        acc[key.replace('--', '')] = value;
        return acc;
    }, {} as Record<string, string>);

    const storeId = args.storeId;
    const isDryRun = args.dryRun === 'true';

    if (!storeId) {
        console.error("Error: --storeId=<your-store-id> is a required argument.");
        process.exit(1);
    }

    console.log(`Store ID: ${storeId}`);
    console.log(`Mode: ${isDryRun ? 'Dry Run (read-only)' : 'Live Write'}`);

    const presetRanges = getPresetDateRanges();

    for (const [presetId, range] of presetRanges.entries()) {
        console.log(`\n--- Processing preset: ${presetId} ---`);

        const analyticsRef = db.collection(`stores/${storeId}/analytics`);
        const q = analyticsRef
            .where("meta.dayStartMs", ">=", range.start.getTime())
            .where("meta.dayStartMs", "<=", range.end.getTime());

        const snapshot = await q.get();
        let finalPresetData: DailyMetric;

        if (snapshot.empty) {
            console.log("No daily analytics docs found for this range. Writing zeroed preset.");
            finalPresetData = {
                ...getZeroedMetric(),
                meta: {
                    presetId,
                    storeId,
                    source: "backfill-script-v2-zeroed",
                    updatedAt: FieldValue.serverTimestamp(),
                    rangeStartMs: range.start.getTime(),
                    rangeEndMs: range.end.getTime(),
                },
            };
        } else {
            const dailyMetrics = snapshot.docs.map(doc => doc.data() as DailyMetric);
            console.log(`Found ${dailyMetrics.length} daily docs to aggregate.`);
            
            const aggregatedMetric = aggregateMetrics(dailyMetrics);
            if (!aggregatedMetric) {
                console.log("Aggregation resulted in null metric. Skipping.");
                continue;
            }

            // Compute top lists from the aggregated data
            const topRefills = computeTopRefills(aggregatedMetric);
            const topAddons = computeTopAddons(aggregatedMetric);

            // Add computed data and metadata to the final preset document
            finalPresetData = {
                ...aggregatedMetric,
                meta: {
                    ...(aggregatedMetric.meta || {}),
                    presetId,
                    storeId,
                    source: "backfill-script-v2",
                    updatedAt: FieldValue.serverTimestamp(),
                    rangeStartMs: range.start.getTime(),
                    rangeEndMs: range.end.getTime(),
                },
                refills: {
                    ...(aggregatedMetric.refills || { servedRefillsTotal: 0, servedRefillsByName: {}, packageSessionsCount: 0 }),
                    topRefillsByQty: topRefills,
                },
                sales: {
                  ...(aggregatedMetric.sales as any),
                  topAddonsByQty: topAddons,
                }
            };
        }
        
        console.log(`Aggregated Net Sales: ${finalPresetData.payments?.totalGross.toFixed(2)}`);
        
        if (!isDryRun) {
            const presetDocRef = db.doc(`stores/${storeId}/dashPresets/${presetId}`);
            try {
                await presetDocRef.set(finalPresetData);
                console.log(`✅ Successfully wrote preset document to: ${presetDocRef.path}`);
            } catch (error) {
                console.error(`❌ Failed to write preset document for ${presetId}:`, error);
            }
        }
    }

    console.log("\nBackfill process complete.");
}

main().catch(error => {
    console.error("An unexpected error occurred:", error);
    process.exit(1);
});
